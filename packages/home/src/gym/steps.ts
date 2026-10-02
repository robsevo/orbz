// An orb's habits at run time (PLAN 3.2, 3.3). A habit the gym promoted (compile.ts) answers its
// task (finder.ts `taskOf`: what started the run and the fields it was handed) in place of the
// brain: the loop asks it for each step, and every call it makes goes through the guard and the
// floor like the brain's. The newest promotion of a task stands, until it is rolled back.
import type { EventLog } from "../events.ts";
import { habitDir } from "./compile.ts";

export type Promoted = { key: string; task: string; version: number; dir: string };

/** The habit that answers this orb's task now, if one was promoted and not rolled back. */
export function promotedFor(events: EventLog, dataDir: string, orb: string, task: string): Promoted | null {
  // rolled back by the exam, or taken back by you on the morning card
  const back = new Set([...events.ofType("habit.rolled_back"), ...events.ofType("habit.undone")].map((e) => `${e.orb}|${String(e.data.kind)}|${Number(e.data.version)}`));
  let found: Promoted | null = null;
  for (const e of events.ofType("habit.promoted")) {
    if (e.orb !== orb || e.data.task !== task) continue;
    const key = String(e.data.kind);
    const version = Number(e.data.version);
    if (back.has(`${orb}|${key}|${version}`)) continue;
    found = { key, task, version, dir: habitDir(dataDir, { orb, key }, version) }; // the log's order: the newest stands
  }
  return found;
}

export type Earned = { kind: string; task: string; version: string; system: string };

/** The playbook this orb's own brain (`brain`, by model) earned for a task (PLAN 3.4): its last
 * accepted exam, if that cleared the bar. A refused playbook changes nothing; a sitting that fell
 * under the bar takes the task back to the big brain. */
export function earnedFor(events: EventLog, orb: string, task: string, brain: string): Earned | null {
  const last = events.ofType("exam.sat").findLast((e) => e.orb === orb && e.data.task === task && e.data.brain === brain && e.data.accepted === true);
  if (!last || last.data.earned !== true) return null;
  return { kind: String(last.data.kind), task, version: String(last.data.version), system: String(last.data.system ?? "") };
}
