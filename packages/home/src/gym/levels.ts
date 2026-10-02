// Levels and promotions (PLAN 3.8): Junior → Mid → Senior → Staff → Principal → Chief (one seat).
// A promotion is proposed only on evidence, all of it read off the event log by code:
//   - XP (xp.ts: graded work and your approvals, never the orb's word);
//   - the exam in its specialty: task types of its own area it has earned, by a habit promoted on
//     every approved run (compile.ts) or its own brain clearing the exam's bar (exam.ts);
//   - no regression in the last NO_REGRESSION_DAYS (a playbook refused, a habit rolled back).
// The card carries that evidence; only you promote. A level changes what the orb is called and
// what it may be trusted with next, never the floor (rules/policy.ts takes no rank).
import type { EventLog } from "../events.ts";
import type { Specialty } from "../brain/constitution.ts";
import { type Area, tagRun } from "./specialty.ts";
import { ledger } from "./xp.ts";

export const LEVELS = ["Junior", "Mid", "Senior", "Staff", "Principal", "Chief"] as const;
export type Level = (typeof LEVELS)[number];

/** What each level needs: XP, and task types earned in its specialty. */
export const NEEDS: Record<Exclude<Level, "Junior">, { xp: number; tasks: number }> = {
  Mid: { xp: 300, tasks: 1 },
  Senior: { xp: 900, tasks: 2 },
  Staff: { xp: 2000, tasks: 4 },
  Principal: { xp: 4000, tasks: 6 },
  Chief: { xp: 8000, tasks: 8 },
};
export const NO_REGRESSION_DAYS = 14;

/** The areas a specialty's work is in (specialty.ts); one with none counts every area. */
export const AREAS_OF: Partial<Record<Specialty, Area[]>> = {
  frontend: ["frontend", "design"], backend: ["backend", "data"], fullstack: ["frontend", "backend"], mobile: ["frontend"],
  devops: ["devops"], testing: ["backend", "frontend"], data: ["data"], ai: ["data", "backend"], security: ["devops", "backend"],
  automation: ["devops", "backend"], design: ["design", "frontend"], writing: ["writing"], editing: ["writing"], marketing: ["writing", "research"],
  social: ["writing"], research: ["research"], factcheck: ["research"], analyst: ["research", "data"], product: ["research", "writing"],
  accountant: ["finance"], money: ["finance"], office: ["inbox", "scheduling"], paperwork: ["inbox", "finance"], support: ["inbox"],
  assistant: ["inbox", "scheduling"], operations: ["scheduling", "inbox"], events: ["scheduling", "bookings"], travel: ["bookings"],
  tutor: ["teaching"], language: ["teaching"], coach: ["teaching"],
};

/** An orb's level now: the last promotion you said yes to. */
export function levelOf(events: EventLog, orb: string): Level {
  const last = events.ofType("orb.promoted").findLast((e) => e.orb === orb);
  return last ? (String(last.data.to) as Level) : "Junior";
}

export type Evidence = {
  xp: { has: number; needs: number };
  tasks: { has: string[]; needs: number };
  regressions: { what: string; at: number }[];
  /** Chief is one seat: who holds it, if someone else does. */
  seat: string | null;
};
export type Proposal = { orb: string; from: Level; to: Exclude<Level, "Junior">; ready: boolean; missing: string[]; evidence: Evidence };

/** The next level for an orb, and whether the evidence is there; null at the top. */
export function nextFor(events: EventLog, orb: string, o: { specialty: Specialty; now: number }): Proposal | null {
  const from = levelOf(events, orb);
  const i = LEVELS.indexOf(from);
  if (i === LEVELS.length - 1) return null;
  const to = LEVELS[i + 1] as Exclude<Level, "Junior">;
  const need = NEEDS[to];
  const xp = ledger(events).filter((e) => e.orb === orb).reduce((n, e) => n + e.amount, 0);
  const tasks = earnedTasks(events, orb, AREAS_OF[o.specialty] ?? null);
  const since = o.now - NO_REGRESSION_DAYS * 86_400_000;
  const regressions = [...events.ofType("playbook.refused"), ...events.ofType("habit.rolled_back")]
    .filter((e) => e.orb === orb && e.at >= since)
    .map((e) => ({ what: `${e.type === "playbook.refused" ? "a playbook refused" : "a habit rolled back"}: ${String(e.data.kind)}`, at: e.at }));
  const seat = to === "Chief" ? (events.ofType("orb.promoted").filter((e) => e.data.to === "Chief" && e.orb !== orb).map((e) => e.orb).find((o2) => o2 && levelOf(events, o2) === "Chief") ?? null) : null;
  const missing: string[] = [];
  if (xp < need.xp) missing.push(`${need.xp - xp} more XP`);
  if (tasks.length < need.tasks) missing.push(`${need.tasks - tasks.length} more task type(s) earned in its specialty`);
  if (regressions.length) missing.push(`no regression for ${NO_REGRESSION_DAYS} days`);
  if (seat) missing.push(`the Chief's seat is ${seat}'s`);
  return { orb, from, to, ready: missing.length === 0, missing, evidence: { xp: { has: xp, needs: need.xp }, tasks: { has: tasks, needs: need.tasks }, regressions, seat } };
}

/** The task types it has earned, in these areas (all, with none given): a habit standing (promoted,
 * not rolled back or taken back), or its own brain's last accepted exam clearing the bar. */
export function earnedTasks(events: EventLog, orb: string, areas: Area[] | null): string[] {
  const gone = new Set([...events.ofType("habit.rolled_back"), ...events.ofType("habit.undone")].map((e) => `${e.orb}|${String(e.data.kind)}|${Number(e.data.version)}`));
  const runsOf = new Map<string, number[]>();
  for (const e of events.ofType("habit.promoted")) {
    if (e.orb !== orb || gone.has(`${orb}|${String(e.data.kind)}|${Number(e.data.version)}`)) continue;
    runsOf.set(String(e.data.kind), (e.data.runs as number[] | undefined) ?? []);
  }
  const lastExam = new Map<string, { earned: boolean; runs: number[] }>();
  for (const e of events.ofType("exam.sat")) if (e.orb === orb && e.data.accepted === true) lastExam.set(String(e.data.kind), { earned: e.data.earned === true, runs: (e.data.runs as number[] | undefined) ?? [] });
  for (const [kind, x] of lastExam) if (x.earned && !runsOf.has(kind)) runsOf.set(kind, x.runs);
  return [...runsOf]
    .filter(([, runs]) => !areas || areaOf(events, runs).some((a) => areas.includes(a)))
    .map(([kind]) => kind)
    .sort();
}

/** A task type's area: what its approved runs were mostly about (specialty.ts, by code). */
function areaOf(events: EventLog, runs: number[]): Area[] {
  const n = new Map<Area, number>();
  for (const r of runs) {
    const a = tagRun(events, r).area;
    if (a) n.set(a, (n.get(a) ?? 0) + 1);
  }
  const top = Math.max(0, ...n.values());
  return top ? [...n].filter(([, c]) => c === top).map(([a]) => a) : [];
}
