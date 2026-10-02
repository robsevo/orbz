// A habit's tests (PLAN 3.2: "its tests are your approved runs, and the harness re-runs them
// itself"). Each approved run of a candidate (finder.ts) becomes a case: what it was handed, every
// tool call it made with what came back, and its final reply. A habit stands in for such a run as
// a step function, `step(input, done)`: given the input and the calls made so far (with their
// results), it returns the next call, or the output. Replaying a case feeds it the recorded
// results; a habit passes only if it makes the very same calls and gives the very same output,
// byte for byte. At run time each call it makes goes through the guard and the floor like any
// other (a habit never widens what an orb may do).
import type { EventLog } from "../events.ts";
import { trace } from "../agent/trace.ts";

export type Call = { name: string; args: Record<string, unknown> };
export type CaseStep = { call: Call; result: string; isError: boolean };
export type Case = { run: number; input: { text: string; data: Record<string, unknown> }; steps: CaseStep[]; output: string };

/** One approved run as a case, or null if its trace cannot be replayed (a call with no result, no reply). */
export function caseOf(events: EventLog, run: number): Case | null {
  const steps = trace(events, run);
  // one thing asked (the loop hands a habit only a run with one), as the finder reads it
  const items = ((steps.find((s) => s.kind === "input")?.data.items ?? []) as { source: string; text: string; data: Record<string, unknown> }[]).filter((i) => i.source !== "system");
  const first = items[0];
  if (!first || items.length > 1) return null;
  const results = new Map<string, { content: string; isError: boolean }>();
  for (const s of steps) if (s.kind === "tool") results.set(String(s.data.call_id), { content: String(s.data.result ?? ""), isError: s.data.is_error === true });
  const out: CaseStep[] = [];
  let output: string | null = null;
  for (const s of steps) {
    if (s.kind !== "model" || s.data.stopped || s.data.error) continue;
    const calls = (s.data.tool_calls ?? []) as { id: string; name: string; arguments: string }[];
    for (const c of calls) {
      const r = results.get(c.id);
      if (!r) return null; // a call that never came back: not a run to learn from
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(c.arguments || "{}") as Record<string, unknown>;
      } catch {
        return null;
      }
      out.push({ call: { name: c.name, args }, result: r.content, isError: r.isError });
    }
    if (!calls.length && typeof s.data.text === "string" && s.data.text.trim()) output = s.data.text;
  }
  if (output === null) return null;
  return { run, input: { text: first.text, data: first.data ?? {} }, steps: out, output };
}

/** The cases a candidate's runs give (those that can be replayed). */
export function casesOf(events: EventLog, runs: number[]): Case[] {
  return runs.map((r) => caseOf(events, r)).filter((c): c is Case => c !== null);
}

export type StepFn = (input: Case["input"], done: CaseStep[]) => Promise<{ call: Call } | { output: string } | { refused: string }>;

/** Replays a case through a habit: the same calls, in order, with the same arguments, and the same
 * output, byte for byte; or why not. A brain's exam (exam.ts) asks only that it answers, `said`:
 * a model's words are never the same twice, its calls are what it did. */
export async function replay(step: StepFn, c: Case, o: { maxSteps?: number; answer?: "exact" | "said" } = {}): Promise<{ ok: true } | { ok: false; why: string }> {
  const done: CaseStep[] = [];
  for (let i = 0; i <= Math.min(o.maxSteps ?? 50, c.steps.length); i++) {
    const next = await step(c.input, done);
    if ("refused" in next) return { ok: false, why: `it refused a run you approved: ${next.refused}` };
    if ("output" in next) {
      if (i < c.steps.length) return { ok: false, why: `it answered after ${i} of ${c.steps.length} calls` };
      if (o.answer === "said") return next.output.trim() ? { ok: true } : { ok: false, why: "it said nothing" };
      return next.output === c.output ? { ok: true } : { ok: false, why: "its answer is not the one you approved" };
    }
    const want = c.steps[i];
    if (!want) return { ok: false, why: `it made a call the approved run did not (${next.call.name})` };
    if (next.call.name !== want.call.name || JSON.stringify(sorted(next.call.args)) !== JSON.stringify(sorted(want.call.args))) {
      return { ok: false, why: `call ${i + 1} was ${next.call.name}(${JSON.stringify(next.call.args)}), the approved run's ${want.call.name}(${JSON.stringify(want.call.args)})` };
    }
    done.push(want); // the recorded result, as the run had it
  }
  return { ok: false, why: "it never answered" };
}

const sorted = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
