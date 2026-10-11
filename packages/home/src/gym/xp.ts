// XP from graded evidence only (PLAN 3.6; CLAUDE.md rule 8: nothing the model says about itself is
// evidence). An append-only ledger in the event log: each `xp.earned` / `xp.lost` names the
// evidence event it came from (its `source`), so it is given once, taken back exactly, and
// replayed to the same totals. Earned from what the person or the harness did:
//   a run you approved (more for a harder one, by how hard it was in its own area: difficulty.ts), a plan row ticked
//   with proof, a habit promoted,
//   a habit's run that answered, a lesson you kept, an exam its own brain cleared (while it holds);
// lost on: a card you denied, a verdict changed to "correct", an undo (exactly what it gave), a
//   habit rolled back, an attempt at something that is never allowed.
// A daily cap per orb (counted on the evidence's own day) means a hundred trivial jobs earn no more
// than a day's worth. The values are a start, to be tuned (PLAN: after Phase 0).
import type { EventLog, HomeEvent } from "../events.ts";
import { difficulty, type Tier } from "./difficulty.ts";

export const XP = {
  /** A job you approved, by how hard it was in its own area (owner, 10-10: "different weights based on difficulty in their
   * domain"; it was 10 a tool call, one to five, whatever the work). */
  job: { easy: 10, standard: 25, hard: 40, expert: 60 } satisfies Record<Tier, number>,
  planRow: 15, habitPromoted: 25, habitAnswered: 1, lessonKept: 5,
  /** A task type its own brain cleared the exam's bar on (PLAN 3.4); taken back when it no longer holds. */
  examCleared: 20,
  /** An idea of its in the board's report that you approved (PLAN 5.18; owner, 10-07: "so they get xp if we approve it"). */
  ideaApproved: 30,
  /** A paper trade closed in profit after both fees (PLAN 5.25): graded by the market, by how hard it was to win (tradeTier). */
  trade: { easy: 10, standard: 25, hard: 40, expert: 60 } satisfies Record<Tier, number>,
  denied: -5, habitRolledBack: -25, never: -10,
} as const;
/** The most an orb earns in a day (losses are not capped). */
export const DAILY_CAP = 150;

export type XpEntry = { seq: number; orb: string; amount: number; reason: string; source: number; at: number; area?: string };

/** How hard a winning trade was (PLAN 5.25): a strategy's by its bars (the shorter, the noisier the market it beat), an
 * orb's own by how long it held (a quick win had to beat both fees in minutes). */
export function tradeTier(t: { timeframe?: unknown; held?: unknown }): Tier {
  const tf = typeof t.timeframe === "string" ? t.timeframe : null;
  if (tf) return tf === "1m" ? "expert" : tf === "5m" || tf === "15m" ? "hard" : tf === "1h" ? "standard" : "easy";
  const held = Number(t.held) || 0;
  return held < 5 * 60_000 ? "expert" : held < 3_600_000 ? "hard" : held < 86_400_000 ? "standard" : "easy";
}

const aOrAn = (w: string): string => (/^[aeiou]/i.test(w) ? "an" : "a");

const dayOf = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/** The ledger as it stands: every entry, oldest first (a pure reading of the event log). */
export function ledger(events: EventLog): XpEntry[] {
  return [...events.ofType("xp.earned"), ...events.ofType("xp.lost")]
    .map((e) => ({ seq: e.seq, orb: String(e.orb), amount: Number(e.data.amount), reason: String(e.data.reason), source: Number(e.data.source), at: Number(e.data.at ?? e.at), ...(typeof e.data.area === "string" && { area: e.data.area }) }))
    .sort((a, b) => a.seq - b.seq);
}

/** Each orb's XP: the ledger summed. */
export function totals(events: EventLog): Record<string, number> {
  const t: Record<string, number> = {};
  for (const e of ledger(events)) t[e.orb] = (t[e.orb] ?? 0) + e.amount;
  return t;
}

export class Xp {
  readonly #events: EventLog;
  readonly #planOrb: (plan: number) => string | null;
  readonly #stop: () => void;

  constructor(events: EventLog, o: { planOrb: (plan: number) => string | null }) {
    this.#events = events;
    this.#planOrb = o.planOrb;
    // evidence that came while the home was down (or before the ledger began) is heard now, in
    // order; what was heard before is not heard again (each entry names its source)
    const done = Math.max(0, ...ledger(events).map((e) => e.source), ...events.ofType("xp.considered").map((e) => Number(e.data.source)));
    for (const e of events.since(done, 100_000)) this.#heard(e);
    const stop = events.listen((e) => this.#heard(e));
    this.#stop = () => void stop();
  }

  /** Stops listening (the home closing). */
  close(): void {
    this.#stop();
  }

  totals(): Record<string, number> {
    return totals(this.#events);
  }

  /** An orb's XP, and what it earned on the day of `at`. */
  of(orb: string, at: number): { total: number; today: number } {
    const mine = ledger(this.#events).filter((e) => e.orb === orb);
    return { total: mine.reduce((n, e) => n + e.amount, 0), today: mine.filter((e) => e.amount > 0 && dayOf(e.at) === dayOf(at)).reduce((n, e) => n + e.amount, 0) };
  }

  #give(orb: string, amount: number, reason: string, e: HomeEvent, more: Record<string, unknown> = {}): void {
    if (amount > 0) {
      const room = Math.max(0, DAILY_CAP - this.of(orb, e.at).today);
      const granted = Math.min(amount, room);
      // capped to nothing is still recorded as considered, so a restart does not give it again
      if (granted === 0) return void this.#events.append("xp.considered", { source: e.seq, reason: `${reason} (the day's cap)` }, { orb });
      this.#events.append("xp.earned", { amount: granted, reason, source: e.seq, at: e.at, ...more }, { orb });
    } else if (amount < 0) this.#events.append("xp.lost", { amount, reason, source: e.seq, at: e.at }, { orb });
  }

  /** Take back exactly what the evidence `sources` gave (an undo, a verdict changed), once. */
  #takeBack(sources: number[], reason: string, e: HomeEvent): void {
    const taken = new Set(this.#events.ofType("xp.lost").map((l) => Number(l.data.undoes)).filter(Boolean));
    for (const x of ledger(this.#events)) {
      if (!sources.includes(x.source) || x.amount <= 0 || taken.has(x.seq)) continue;
      this.#events.append("xp.lost", { amount: -x.amount, reason, source: e.seq, at: e.at, undoes: x.seq }, { orb: x.orb });
    }
  }

  #runOrb(run: number): string | null {
    return this.#events.ofType("run.started").find((s) => s.data.run === run)?.orb ?? null;
  }

  #heard(e: HomeEvent): void {
    switch (e.type) {
      case "trace.feedback": {
        const run = Number(e.data.run);
        const orb = this.#runOrb(run);
        if (!orb) return;
        const before = this.#events.ofType("trace.feedback").filter((f) => f.seq < e.seq && f.data.run === run);
        const earlier = before.at(-1);
        if (e.data.verdict === "approve" && earlier?.data.verdict !== "approve") {
          // how hard it was, in its own area, by code; the tier and its measures go with the XP, for the charts
          const d = difficulty(this.#events, run);
          this.#give(orb, XP.job[d.tier], `${aOrAn(d.tier)} ${d.tier}${d.area ? ` ${d.area}` : ""} job you approved (${d.why})`, e, { tier: d.tier, area: d.area });
        } else if (e.data.verdict !== "approve" && earlier?.data.verdict === "approve") {
          this.#takeBack(before.filter((f) => f.data.verdict === "approve").map((f) => f.seq), "you corrected a job you had approved", e);
        }
        return;
      }
      case "card.resolved":
        if (e.data.status === "denied" && e.orb) this.#give(e.orb, XP.denied, "you denied what it asked", e);
        return;
      case "board.ticked": {
        const orb = this.#planOrb(Number(e.data.plan));
        if (orb) this.#give(orb, XP.planRow, `a plan row ticked with proof (${String(e.data.row)})`, e);
        return;
      }
      case "habit.promoted":
        if (e.orb) this.#give(e.orb, XP.habitPromoted, `a habit promoted (${String(e.data.kind)})`, e);
        return;
      case "habit.rolled_back":
        if (e.orb) this.#give(e.orb, XP.habitRolledBack, `a habit rolled back (${String(e.data.kind)})`, e);
        return;
      case "ladder.answered":
        if (e.data.tier === "habit" && e.orb) this.#give(e.orb, XP.habitAnswered, `its habit answered (${String(e.data.kind)})`, e);
        return;
      case "report.idea_approved":
        if (e.orb) this.#give(e.orb, XP.ideaApproved, "an idea you approved from the board's report", e);
        return;
      case "desk.trade_closed": {
        // graded by the market (rule 8): a paper trade that made money after both fees; a loss earns nothing
        if (!e.orb || e.data.paper !== true || !(Number(e.data.pnl) > 0)) return;
        const tier = tradeTier(e.data);
        const where = `${String(e.data.symbol)}${typeof e.data.timeframe === "string" ? ` ${e.data.timeframe}` : ""}`;
        this.#give(e.orb, XP.trade[tier], `${aOrAn(tier)} ${tier} trade won on paper (${where}, +${Number(e.data.pnlPct).toFixed(2)}% after fees)`, e, { tier, area: "desk" });
        return;
      }
      case "orb.learned":
        if (e.orb) this.#give(e.orb, XP.lessonKept, "a lesson you kept", e);
        return;
      case "tool.never":
        if (e.orb) this.#give(e.orb, XP.never, `it tried what is never allowed (${String(e.data.tool)})`, e);
        return;
      case "undo":
        this.#takeBack([Number(e.data.source)], `undone: ${String(e.data.what ?? "it")}`, e);
        return;
      case "exam.sat": {
        // cleared and held: XP when a task type first clears, taken back when a sitting no longer does
        if (!e.orb || e.data.accepted !== true) return;
        const before = this.#events.ofType("exam.sat").filter((x) => x.seq < e.seq && x.orb === e.orb && x.data.kind === e.data.kind && x.data.accepted === true).at(-1);
        const held = before?.data.earned === true;
        if (e.data.earned === true && !held) this.#give(e.orb, XP.examCleared, `its own brain cleared the exam (${String(e.data.kind)})`, e);
        else if (e.data.earned !== true && held) {
          const cleared = this.#events.ofType("exam.sat").filter((x) => x.seq < e.seq && x.orb === e.orb && x.data.kind === e.data.kind && x.data.earned === true).map((x) => x.seq);
          this.#takeBack(cleared, `its own brain no longer clears the exam (${String(e.data.kind)})`, e);
        }
        return;
      }
    }
  }
}
