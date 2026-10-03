// The weekly performance card (PLAN 5.5): once a week, for each orb in the office, a suggestion
// (promote, keep, retrain or let go) and the evidence it stands on, all read off the log by code.
// It never acts: promoting is yours (3.8), and so is letting go (5.5).
//
//   promote   the evidence for his next level is all there (levels.ts nextFor)
//   retrain   you turned down most of what he did this week, or a habit or playbook of his regressed
//   let go    no work at all for LET_GO_DAYS: give him some, or let him go (he still learns away)
//   keep      otherwise
import type { Specialty } from "../brain/constitution.ts";
import type { EventLog } from "../events.ts";
import { nextFor } from "./levels.ts";
import { ledger } from "./xp.ts";

export const WEEK_MS = 7 * 86_400_000;
export const LET_GO_DAYS = 28;
export type Suggestion = "promote" | "keep" | "retrain" | "let go";
export type Week = {
  orb: string; xp: number; xpBefore: number; approved: number; judged: number; regressions: number;
  idleDays: number; suggest: Suggestion; why: string;
};

const DAY_MS = 86_400_000;

/** His week to `now`: what he earned against the week before, what you approved of what you judged,
 * what regressed, how long since he last finished anything (since he joined, if never), and the
 * suggestion that follows. */
export function weekOf(events: EventLog, orb: string, o: { specialty: Specialty; hired: number; now: number }): Week {
  const since = o.now - WEEK_MS;
  const mine = ledger(events).filter((e) => e.orb === orb);
  const xpIn = (from: number, to: number): number => mine.filter((e) => e.at >= from && e.at < to).reduce((n, e) => n + e.amount, 0);
  const xp = xpIn(since, o.now + 1);
  const xpBefore = xpIn(since - WEEK_MS, since);
  const judgedRuns = events.ofType("trace.feedback").filter((e) => e.orb === orb && e.at >= since);
  const approved = judgedRuns.filter((e) => e.data.verdict === "approve").length;
  const regressions = ["playbook.refused", "habit.rolled_back", "habit.undone"].flatMap((t) => events.ofType(t)).filter((e) => e.orb === orb && e.at >= since).length;
  const lastWork = events.ofType("run.finished").filter((e) => e.orb === orb && e.data.outcome === "ok").at(-1)?.at ?? o.hired;
  const idleDays = Math.floor((o.now - Math.max(lastWork, o.hired)) / DAY_MS);
  const ready = nextFor(events, orb, { specialty: o.specialty, now: o.now })?.ready === true;

  const suggest: Suggestion =
    ready ? "promote" : regressions > 0 || (judgedRuns.length >= 3 && approved / judgedRuns.length < 0.5) ? "retrain" : idleDays >= LET_GO_DAYS ? "let go" : "keep";
  const parts = [
    `${xp} XP this week (${xpBefore} the week before)`,
    judgedRuns.length ? `${approved} of ${judgedRuns.length} runs you judged approved` : "nothing judged this week",
    regressions ? `${regressions} ${regressions === 1 ? "regression" : "regressions"}` : "no regression",
    idleDays === 0 ? "worked today" : `last worked ${idleDays} ${idleDays === 1 ? "day" : "days"} ago`,
  ];
  return { orb, xp, xpBefore, approved, judged: judgedRuns.length, regressions, idleDays, suggest, why: parts.join("; ") };
}

/** Whether his card is due: a week since his last one, or since he joined. */
export function cardDue(events: EventLog, orb: string, o: { hired: number; now: number }): boolean {
  const last = events.ofType("performance.card").findLast((e) => e.orb === orb)?.at ?? o.hired;
  return o.now - last >= WEEK_MS;
}
