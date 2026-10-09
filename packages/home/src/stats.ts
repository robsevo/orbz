// The numbers behind the home page, as charts (PLAN 2.19; owner, 10-08: "when we press on brain today it brings us to
// settings? how about a chart with all the stats of tokens? lol"; "same for xp this week"): the brains' tokens and the
// XP over the last 7, 14 or 30 days, by day, and the tokens by model, kind of turn and orb, the XP by orb. Read by code
// from the log as the dashboard is (`brain.spend`, `xp.earned`, `xp.lost`), its days the home's own: no brain is asked,
// nothing is written.
import { kindOf, modelOf } from "./brain/cost.ts";
import type { Home } from "./home.ts";

/** The ranges a chart can show. */
export const STAT_DAYS = [7, 14, 30] as const;
export type Tokens = { calls: number; input: number; cached: number; output: number };
export type Stats = {
  /** The range's days, oldest first, as the home's own dates (YYYY-MM-DD). */
  days: string[];
  brain: {
    total: Tokens;
    byDay: Tokens[];
    byModel: (Tokens & { model: string })[];
    byKind: (Tokens & { kind: string })[];
    /** `orb` null: a call no orb made (school's, an interview's, a lesson's plan). */
    byOrb: (Tokens & { orb: string | null; name: string })[];
  };
  xp: {
    total: { earned: number; lost: number };
    byDay: { earned: number; lost: number }[];
    byOrb: { orb: string; name: string; earned: number; lost: number }[];
  };
};

const pad = (n: number): string => String(n).padStart(2, "0");
const dateOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const none = (): Tokens => ({ calls: 0, input: 0, cached: 0, output: 0 });
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/** The last `range` days to now (today the last of them), a range of 7, 14 or 30. */
export function statsOf(home: Home, range: number): Stats {
  const n = (STAT_DAYS as readonly number[]).includes(range) ? range : 7;
  const now = new Date(home.clock.now());
  // by the calendar, so a day the clocks change is still one day
  const days = Array.from({ length: n }, (_, i) => dateOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1 - i))));
  const index = new Map(days.map((d, i) => [d, i]));
  const at = (t: number): number | undefined => index.get(dateOf(new Date(t)));
  const nameOf = (id: string | null): string => (id === null ? "No orb" : (home.inbox.orb(id)?.name ?? id));

  const total = none();
  const byDay = days.map(none);
  const byModel = new Map<string, Tokens & { model: string }>();
  const byKind = new Map<string, Tokens & { kind: string }>();
  const byOrb = new Map<string | null, Tokens & { orb: string | null; name: string }>();
  for (const e of home.events.ofType("brain.spend")) {
    const i = at(e.at);
    if (i === undefined) continue;
    const row = { orb: e.orb, conversation: e.conversation, data: e.data };
    const model = modelOf(row);
    const kind = kindOf(row);
    const lines = [
      total,
      byDay[i]!,
      byModel.get(model) ?? byModel.set(model, { ...none(), model }).get(model)!,
      byKind.get(kind) ?? byKind.set(kind, { ...none(), kind }).get(kind)!,
      byOrb.get(e.orb) ?? byOrb.set(e.orb, { ...none(), orb: e.orb, name: nameOf(e.orb) }).get(e.orb)!,
    ];
    for (const l of lines) {
      l.calls++;
      l.input += num(e.data.prompt_tokens);
      l.cached += num(e.data.cached_tokens);
      l.output += num(e.data.completion_tokens);
    }
  }
  const most = <T extends Tokens>(m: Map<unknown, T>): T[] => [...m.values()].sort((a, b) => b.input + b.output - (a.input + a.output));

  const xpTotal = { earned: 0, lost: 0 };
  const xpByDay = days.map(() => ({ earned: 0, lost: 0 }));
  const xpByOrb = new Map<string, { orb: string; name: string; earned: number; lost: number }>();
  for (const e of [...home.events.ofType("xp.earned"), ...home.events.ofType("xp.lost")]) {
    // XP is dated by the work it is for, as the dashboard dates it
    const i = at(num(e.data.at ?? e.at));
    if (i === undefined || !e.orb) continue;
    const amount = num(e.data.amount);
    const who = xpByOrb.get(e.orb) ?? xpByOrb.set(e.orb, { orb: e.orb, name: nameOf(e.orb), earned: 0, lost: 0 }).get(e.orb)!;
    for (const l of [xpTotal, xpByDay[i]!, who]) {
      if (amount >= 0) l.earned += amount;
      else l.lost += -amount;
    }
  }
  return {
    days,
    brain: { total, byDay, byModel: most(byModel), byKind: most(byKind), byOrb: most(byOrb) },
    xp: { total: xpTotal, byDay: xpByDay, byOrb: [...xpByOrb.values()].sort((a, b) => b.earned - b.lost - (a.earned - a.lost)) },
  };
}
