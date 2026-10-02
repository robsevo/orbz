// PLAN 3.2_t (the harness's half): an approved run becomes a case, and a habit passes only if the
// harness, replaying it, sees the same calls and the same output; what the habit says about its
// own result is never read.
//   - A run's case: what it was handed, each call with what came back, the final reply.
//   - A run that cannot be replayed (a call with no result, no reply) gives no case.
//   - A habit that "claims" a pass but makes another call, answers otherwise, refuses a run you
//     approved, or stops early is rejected, with why.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { openDb } from "../src/db.ts";
import { EventLog } from "../src/events.ts";
import { caseOf, casesOf, replay, type StepFn } from "../src/gym/cases.ts";
import { tempDir } from "./helpers.ts";

function log(t: Parameters<typeof tempDir>[0]) {
  const db = openDb(tempDir(t));
  t.after(() => db.close());
  const events = new EventLog(db, new FakeClock("2026-10-02T09:00:00Z"));
  const run = (id: number, o: { subject: string; reply?: string; dropResult?: boolean }) => {
    const where = { orb: "ada", conversation: "trigger:t1" };
    events.append("trace.step", { run: id, step: 0, kind: "input", items: [{ id, source: "trigger", text: `[Trigger: bills] New email: ${o.subject}`, data: { trigger: "t1", subject: o.subject } }] }, where);
    events.append("trace.step", { run: id, step: 1, kind: "model", text: "", tool_calls: [{ id: "a", name: "read_file", arguments: JSON.stringify({ path: "bills.csv" }) }] }, where);
    if (!o.dropResult) events.append("trace.step", { run: id, step: 2, kind: "tool", call_id: "a", name: "read_file", result: "rent,1200\n" }, where);
    events.append("trace.step", { run: id, step: 3, kind: "model", text: "", tool_calls: [{ id: "b", name: "remind", arguments: JSON.stringify({ kind: "bill", title: o.subject, due: "2026-10-06" }) }] }, where);
    events.append("trace.step", { run: id, step: 4, kind: "tool", call_id: "b", name: "remind", result: "Kept (bill 1)." }, where);
    events.append("trace.step", { run: id, step: 5, kind: "model", text: o.reply ?? `Kept ${o.subject} for you.`, tool_calls: [] }, where);
  };
  return { events, run };
}

// a habit written by hand, as the teacher would: read the bills, keep the one the mail is about
const good: StepFn = async (input, done) => {
  if (typeof input.data.subject !== "string") return { refused: "no subject" };
  if (done.length === 0) return { call: { name: "read_file", args: { path: "bills.csv" } } };
  if (done.length === 1) return { call: { name: "remind", args: { due: "2026-10-06", kind: "bill", title: input.data.subject } } }; // its keys in another order: the same call
  return { output: `Kept ${input.data.subject} for you.` };
};

test("an approved run is a case: what it was handed, each call and what came back, its reply", (t) => {
  const { events, run } = log(t);
  run(1, { subject: "Rent" });
  assert.deepEqual(caseOf(events, 1), {
    run: 1,
    input: { text: "[Trigger: bills] New email: Rent", data: { trigger: "t1", subject: "Rent" } },
    steps: [
      { call: { name: "read_file", args: { path: "bills.csv" } }, result: "rent,1200\n", isError: false },
      { call: { name: "remind", args: { kind: "bill", title: "Rent", due: "2026-10-06" } }, result: "Kept (bill 1).", isError: false },
    ],
    output: "Kept Rent for you.",
  });
  run(2, { subject: "Phone", dropResult: true });
  assert.equal(caseOf(events, 2), null, "a call that never came back: no case");
  assert.equal(casesOf(events, [1, 2]).length, 1);
  const where = { orb: "ada", conversation: "trigger:t1" };
  const two = [1, 2].map((id) => ({ id, source: "trigger", text: "[Trigger: bills] New email", data: { trigger: "t1", subject: `S${id}` } }));
  events.append("trace.step", { run: 3, step: 0, kind: "input", items: two }, where);
  events.append("trace.step", { run: 3, step: 1, kind: "model", text: "Kept both.", tool_calls: [] }, where);
  assert.equal(caseOf(events, 3), null, "two mails in one run: not one input a habit is handed");
});

test("a habit passes only if the replay sees the same calls and the same output; a claim is never read", async (t) => {
  const { events, run } = log(t);
  run(1, { subject: "Rent" });
  run(2, { subject: "Gym" });
  const cases = casesOf(events, [1, 2]);
  for (const c of cases) assert.deepEqual(await replay(good, c), { ok: true });
  const claims: StepFn = async (input, done) => (done.length === 1 ? { call: { name: "remind", args: { kind: "bill", title: "Rent", due: "2026-10-06" } } } : good(input, done)); // "I pass": it always keeps the rent
  const claimed = await replay(claims, cases[1]!);
  assert.ok(!claimed.ok && /call 2 was remind/.test(claimed.why), "its claim is never read: the replay is");
  const otherWords: StepFn = async (input, done) => (done.length === 2 ? { output: `Done: ${String(input.data.subject)}.` } : good(input, done));
  assert.deepEqual(await replay(otherWords, cases[0]!), { ok: false, why: "its answer is not the one you approved" });
  const refuses: StepFn = async () => ({ refused: "looks odd" });
  assert.match(((await replay(refuses, cases[0]!)) as { why: string }).why, /it refused a run you approved: looks odd/);
  const early: StepFn = async (input, done) => (done.length === 1 ? { output: "Kept Rent for you." } : good(input, done));
  assert.deepEqual(await replay(early, cases[0]!), { ok: false, why: "it answered after 1 of 2 calls" });
  const extra: StepFn = async (input, done) => (done.length === 2 ? { call: { name: "shell", args: { command: "true" } } } : good(input, done));
  assert.match(((await replay(extra, cases[0]!)) as { why: string }).why, /a call the approved run did not \(shell\)/);
});
