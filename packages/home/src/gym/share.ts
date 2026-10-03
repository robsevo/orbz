// A habit passed on (PLAN 5.4 mentoring, with your OK; PLAN 5.5 a let-go orb's hand-off, your act):
// a copy of the version that answers now, re-keyed to the receiving orb's own task (a task's key
// begins with its orb, finder.ts taskOf), promoted for him as his own next version. It runs under
// HIS rules and HIS floor like any habit of his (the loop checks every call a habit makes), and the
// giver keeps his: nothing is moved, only copied, and the log says where it came from.
import { cpSync, existsSync } from "node:fs";
import type { EventLog } from "../events.ts";
import { habitDir } from "./compile.ts";
import { type Promoted, promotedFor } from "./steps.ts";

export class ShareError extends Error {}

/** An orb's habits now: for each task he has had one for, the version that answers. */
export function habitsOf(events: EventLog, dataDir: string, orb: string): Promoted[] {
  const tasks = [...new Set(events.ofType("habit.promoted").filter((e) => e.orb === orb).map((e) => String(e.data.task)))];
  return tasks.map((t) => promotedFor(events, dataDir, orb, t)).filter((p): p is Promoted => p !== null);
}

const rekey = (s: string, from: string, to: string): string => (s.startsWith(`${from}|`) ? `${to}|${s.slice(from.length + 1)}` : s);

/** Copies `from`'s habit for `task` to `to`: the key and task he will run it under. */
export function shareHabit(events: EventLog, dataDir: string, o: { from: string; to: string; task: string; why: "mentoring" | "hand-off" }): { key: string; task: string; version: number } {
  if (o.from === o.to) throw new ShareError("a habit is passed to someone else");
  const h = promotedFor(events, dataDir, o.from, o.task);
  if (!h) throw new ShareError(`${o.from} has no habit for ${o.task}`);
  if (!existsSync(h.dir)) throw new ShareError("that habit's files are gone");
  const key = rekey(h.key, o.from, o.to);
  const task = rekey(h.task, o.from, o.to);
  const version = Math.max(0, ...events.ofType("habit.promoted").filter((e) => e.orb === o.to && String(e.data.kind) === key).map((e) => Number(e.data.version))) + 1;
  cpSync(h.dir, habitDir(dataDir, { orb: o.to, key }, version), { recursive: true });
  events.append("habit.promoted", { kind: key, task, version, runs: [], shared: { from: o.from, key: h.key, version: h.version, why: o.why } }, { orb: o.to });
  return { key, task, version };
}
