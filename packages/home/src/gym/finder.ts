// The hot-path finder (PLAN 3.1): the gym's first look at the night. It groups an orb's runs by
// what started them (a schedule, a trigger, a session's turn, a chat) and by their shape (the
// tools they used, in order, and the fields of the data they were handed), and keeps a group as a
// candidate for a habit (3.2) once enough of its runs were approved by the person. A one-off task
// never qualifies; a run the person corrected is not approved, nor is one that did not finish.
//
// Everything here is read from the event log: the runs, their traces (agent/trace.ts) and the
// person's verdicts (`trace.feedback`). Nothing the orb says about its own work counts.
import type { EventLog } from "../events.ts";
import { trace } from "../agent/trace.ts";

/** How many approved runs make a shape a candidate (the spike promoted after a handful). */
export const MIN_APPROVED = 3;

export type Candidate = {
  /** orb | trigger | shape: one task, done the same way. */
  key: string;
  orb: string;
  /** What started it: schedule:<id>, trigger:<id>, session, or chat. */
  trigger: string;
  /** orb | trigger | the data's fields: what a habit for it answers at run time, before any tool is used. */
  task: string;
  /** The tools in the order first used, and the data's fields: "list_files>read_file>write_file {from,subject}". */
  shape: string;
  /** Its approved runs, oldest first: the habit's tests (3.2). */
  runs: number[];
  /** Its runs that finished but were not approved (corrected, or never judged). */
  others: number[];
  firstAt: number;
  lastAt: number;
};

export type Seen = Omit<Candidate, "runs" | "others"> & { run: number; approved: boolean };

/** Every finished run since `since`, as the finder sees it. */
export function runsSince(events: EventLog, since: number): Seen[] {
  const verdict = new Map<number, "approve" | "correct">();
  for (const e of events.ofType("trace.feedback")) verdict.set(Number(e.data.run), e.data.verdict === "approve" ? "approve" : "correct"); // the last word stands
  const out: Seen[] = [];
  for (const f of events.ofType("run.finished")) {
    if (f.at < since || f.data.outcome !== "ok" || !f.orb) continue;
    const run = Number(f.data.run);
    const steps = trace(events, run);
    const items = (steps.find((s) => s.kind === "input")?.data.items ?? []) as { source: string; data: Record<string, unknown> }[];
    const tools: string[] = [];
    for (const s of steps) {
      if (s.kind !== "model") continue;
      for (const c of (s.data.tool_calls ?? []) as { name: string }[]) if (!tools.includes(c.name)) tools.push(c.name);
    }
    out.push({ ...describe(f.orb, items, tools), run, approved: verdict.get(run) === "approve", firstAt: f.at, lastAt: f.at });
  }
  return out;
}

function describe(orb: string, items: { source: string; data: Record<string, unknown> }[], tools: string[]): Omit<Seen, "run" | "approved" | "firstAt" | "lastAt"> {
  const t = taskOf(orb, items);
  const shape = `${tools.join(">") || "(no tools)"}${t.fields.length ? ` {${t.fields.join(",")}}` : ""}`;
  return { key: `${orb}|${t.trigger}|${shape}`, orb, trigger: t.trigger, task: t.task, shape };
}

/** What a run was asked, before it did anything: what started it and the fields of the data it was
 * handed (a schedule's own bookkeeping is not the task's). The loop asks it too, to find a habit. */
export function taskOf(orb: string, items: { source: string; data: Record<string, unknown> }[]): { trigger: string; fields: string[]; task: string } {
  const first = items.find((i) => i.source !== "system") ?? items[0];
  const d = first?.data ?? {};
  const trigger =
    typeof d.schedule === "string" ? `schedule:${d.schedule}` : typeof d.trigger === "string" ? `trigger:${d.trigger}` : first?.source === "turn" ? "session" : "chat";
  const fields = Object.keys(d).filter((k) => !["schedule", "due", "missed", "trigger", "event", "at", "outside", "team", "resume"].includes(k)).sort();
  return { trigger, fields, task: `${orb}|${trigger}|{${fields.join(",")}}` };
}

/** The candidates since `since`: shapes with at least `minApproved` approved runs, most approved first. */
export function findHotPaths(events: EventLog, o: { since: number; minApproved?: number }): Candidate[] {
  const min = o.minApproved ?? MIN_APPROVED;
  const groups = new Map<string, Candidate>();
  for (const s of runsSince(events, o.since)) {
    const g = groups.get(s.key) ?? { key: s.key, orb: s.orb, trigger: s.trigger, task: s.task, shape: s.shape, runs: [], others: [], firstAt: s.firstAt, lastAt: s.lastAt };
    (s.approved ? g.runs : g.others).push(s.run);
    g.firstAt = Math.min(g.firstAt, s.firstAt);
    g.lastAt = Math.max(g.lastAt, s.lastAt);
    groups.set(s.key, g);
  }
  return [...groups.values()].filter((g) => g.runs.length >= min).sort((a, b) => b.runs.length - a.runs.length || a.key.localeCompare(b.key));
}
