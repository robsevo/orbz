// PLAN 3.1_t, the hot-path finder, on fixture traces:
//   - Runs started the same way and done the same way (the same tools, in order; the same data
//     fields) are one shape; with enough approved runs it is a candidate, its runs the habit's tests.
//   - One-off tasks never qualify; a corrected run is not approved (the last word stands); a run
//     that did not finish, or before the window, is not seen.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { openDb } from "../src/db.ts";
import { EventLog } from "../src/events.ts";
import { findHotPaths, runsSince } from "../src/gym/finder.ts";
import { tempDir } from "./helpers.ts";

type Fixture = { orb: string; source: string; data?: Record<string, unknown>; tools: string[]; outcome?: string; verdicts?: ("approve" | "correct")[] };

function day(t: Parameters<typeof tempDir>[0]) {
  const clock = new FakeClock("2026-10-02T06:00:00Z");
  const db = openDb(tempDir(t));
  t.after(() => db.close());
  const events = new EventLog(db, clock);
  let n = 0;
  const run = (f: Fixture): number => {
    const id = ++n;
    const where = { orb: f.orb, conversation: `c:${f.orb}` };
    events.append("run.started", { run: id, items: [id] }, where);
    events.append("trace.step", { run: id, step: 0, kind: "input", items: [{ id, source: f.source, text: "", data: f.data ?? {} }] }, where);
    events.append("trace.step", { run: id, step: 1, kind: "model", text: "", tool_calls: f.tools.map((name, i) => ({ id: `c${i}`, name, arguments: "{}" })) }, where);
    if (f.tools.length) events.append("trace.step", { run: id, step: 2, kind: "model", text: "done", tool_calls: [] }, where);
    events.append("run.finished", { run: id, outcome: f.outcome ?? "ok" }, where);
    for (const v of f.verdicts ?? ["approve"]) events.append("trace.feedback", { run: id, verdict: v, note: "" });
    clock.suspend(60_000);
    return id;
  };
  return { events, clock, run };
}

test("one task done the same way, approved enough times, is a candidate; its runs are the tests", (t) => {
  const { events, run } = day(t);
  const bills = { orb: "ada", source: "schedule", data: { schedule: "s1", due: 1, missed: 0 }, tools: ["list_files", "read_file", "remind", "read_file"] };
  const a = [run(bills), run(bills), run(bills), run(bills)];
  const corrected = run({ ...bills, verdicts: ["approve", "correct"] }); // the last word stands
  run({ orb: "gus", source: "chat", tools: ["shell"] }); // a one-off
  // as a real trigger gives it: `outside` is where its event's words start, not one of its fields
  const mail = { orb: "milo", source: "trigger", data: { trigger: "t1", event: "m1", at: 1, outside: 31, from: "x@y.z", subject: "Hi" }, tools: ["web_fetch", "write_file"] };
  const m = [run(mail), run(mail), run(mail)];
  run({ ...mail, data: { trigger: "t1", event: "m9", at: 2, from: "x@y.z" } }); // other fields: another shape
  run({ ...bills, outcome: "failed" }); // did not finish: not seen
  const found = findHotPaths(events, { since: 0 });
  assert.deepEqual(found.map((c) => [c.orb, c.trigger, c.shape, c.runs, c.others]), [
    ["ada", "schedule:s1", "list_files>read_file>remind", a, [corrected]],
    ["milo", "trigger:t1", "web_fetch>write_file {from,subject}", m, []],
  ]);
  assert.equal(found.some((c) => c.orb === "gus"), false, "a one-off never qualifies");
  assert.equal(runsSince(events, 0).filter((s) => s.orb === "milo").length, 4, "the other shape is seen, apart");
  assert.deepEqual(findHotPaths(events, { since: 0, minApproved: 5 }), [], "five approved: not yet");
});

test("only the window counts: what came before it is not seen", (t) => {
  const { events, clock, run } = day(t);
  const job = { orb: "ada", source: "schedule", data: { schedule: "s1" }, tools: ["read_file"] };
  run(job);
  run(job);
  const since = clock.now();
  run(job);
  run(job);
  assert.equal(findHotPaths(events, { since: 0 })[0]!.runs.length, 4);
  assert.deepEqual(findHotPaths(events, { since }), [], "two in the window: not a candidate");
  run(job);
  assert.equal(findHotPaths(events, { since })[0]!.runs.length, 3);
});

test("a session's turn and a chat are told apart from schedules; no tools is a shape too", (t) => {
  const { events, run } = day(t);
  for (let i = 0; i < 3; i++) run({ orb: "hazel", source: "turn", data: { team: { session: 1 } }, tools: [] });
  for (let i = 0; i < 3; i++) run({ orb: "hazel", source: "chat", tools: [] });
  assert.deepEqual(findHotPaths(events, { since: 0 }).map((c) => [c.trigger, c.shape]), [["chat", "(no tools)"], ["session", "(no tools)"]]);
});
