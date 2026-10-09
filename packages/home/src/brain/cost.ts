// What the brains cost, read back (PLAN 1.16; owner, 10-07: "cut token costs ... while still keeping the current flow
// and logic"): each call's tokens by model and kind of turn, with how much of what it read the provider's cache served
// (`brain.spend`'s cached_tokens). The ChatGPT plan counts cached input at a tenth, so that share is what the plan's
// cache saves. `pnpm cost` prints it (tools/cost.ts); `pnpm cost --probe` asks the plan whether its cache serves at
// all (`probeCache`), with a control it must not serve.
import { randomBytes } from "node:crypto";
import { streamResponses } from "../agent/responses.ts";
import { RESEARCH_METHOD } from "./constitution.ts";
import type { Endpoint } from "./openai.ts";
import { valuesFor } from "./values.ts";

/** A `brain.spend` event as the log keeps it. */
export type SpendRow = { orb: string | null; conversation: string | null; data: Record<string, unknown> };
export type CostLine = { model: string; kind: string; calls: number; input: number; cached: number; output: number };

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Each model's calls by kind of turn (a session's lead, chime, asked or work; a summary, a note, the board's, the
 * report's; "chat" for a chat or a schedule's run; "other" for what no conversation asked: school, an interview, a
 * lesson's plan), the most read first, and all of them. */
export function costTable(rows: SpendRow[]): { lines: CostLine[]; total: CostLine } {
  const by = new Map<string, CostLine>();
  const total: CostLine = { model: "all", kind: "all", calls: 0, input: 0, cached: 0, output: 0 };
  for (const r of rows) {
    const model = modelOf(r);
    const kind = kindOf(r);
    const line = by.get(`${model}\u0000${kind}`) ?? { model, kind, calls: 0, input: 0, cached: 0, output: 0 };
    for (const l of [line, total]) {
      l.calls++;
      l.input += count(r.data.prompt_tokens);
      l.cached += count(r.data.cached_tokens);
      l.output += count(r.data.completion_tokens);
    }
    by.set(`${model}\u0000${kind}`, line);
  }
  return { lines: [...by.values()].sort((a, b) => b.input - a.input || a.model.localeCompare(b.model) || a.kind.localeCompare(b.kind)), total };
}

/** A call's model, as it said it. */
export const modelOf = (r: SpendRow): string => (typeof r.data.model === "string" ? r.data.model : "?");
/** A call's kind of turn, as `costTable` and the charts (stats.ts) both count it. */
export const kindOf = (r: SpendRow): string => (typeof r.data.turn === "string" ? r.data.turn : r.conversation ? "chat" : "other");

/** Of what was read, the share the cache served, in whole percent. */
export const cachedShare = (l: Pick<CostLine, "input" | "cached">): number => (l.input ? Math.round((100 * l.cached) / l.input) : 0);

export type ProbeCall = { input: number; cached: number; output: number; error: string | null };
export type Probe = { model: string; first: ProbeCall; again: ProbeCall; control: ProbeCall; served: boolean; said: string };

/** Asks the plan three short questions: the same instructions twice, the second of which its cache should serve, and
 * a CONTROL whose instructions differ from their first line on, which it must not (CLAUDE.md rule 4: a check that
 * cannot fail proves nothing). Each some 1,500 tokens of Orbs' own text, nothing of the person's, on the model `ep`
 * names (the plan's light one, tools/cost.ts). `served` only when the repeat read more from the cache than the control
 * and the first did. */
export async function probeCache(ep: Endpoint, o: { signal?: AbortSignal; settleMs?: number } = {}): Promise<Probe> {
  const tag = (): string => randomBytes(6).toString("hex");
  const text = (t: string): string => `Cache probe ${t}. Read what follows, then answer with one word.\n\n${valuesFor("Probe")}\n\n${RESEARCH_METHOD}`;
  const key = `probe-${tag()}`;
  const ask = async (instructions: string): Promise<ProbeCall> => {
    const r = await streamResponses(ep, { messages: [{ role: "system", content: instructions }, { role: "user", content: "Reply with the word ok." }], brief: true, cacheKey: key }, o);
    return { input: r.promptTokens, cached: r.cachedTokens, output: r.completionTokens, error: r.error };
  };
  const same = text(tag());
  const first = await ask(same);
  await new Promise((r) => setTimeout(r, o.settleMs ?? 2000)); // the first one's prefix written to the cache
  const again = await ask(same);
  const control = await ask(text(tag()));
  const failed = [first, again, control].find((c) => c.error);
  const served = !failed && again.cached > control.cached && again.cached > first.cached;
  const said = failed
    ? `The probe could not finish: ${failed.error}`
    : served
      ? `The plan's cache served ${again.cached.toLocaleString("en")} of ${again.input.toLocaleString("en")} tokens on the repeat (${cachedShare(again)}%); the control, its first line changed, had ${control.cached.toLocaleString("en")}.`
      : again.cached === 0
        ? `The plan served nothing from its cache on the repeat (${again.input.toLocaleString("en")} tokens read at the full price).`
        : `The control read as much from the cache as the repeat (${control.cached.toLocaleString("en")} and ${again.cached.toLocaleString("en")}): this probe cannot tell the cache's work apart here.`;
  return { model: ep.model, first, again, control, served, said };
}
