// PLAN 3.6_t, XP from graded evidence only, on a fixture event log:
//   - An orb's self-claimed "great job" earns 0: only what the person or the harness did counts.
//   - A job you approve earns XP, more for a longer one; correcting it takes back exactly that.
//   - A hundred trivial jobs cannot pass the daily cap; the next day starts again.
//   - A deny, an attempt at a "never", a habit rolled back lose XP; an undo removes exactly what it gave.
//   - An exam its own brain cleared earns once, while it holds; under the bar it is taken back.
//   - The ledger replays to the same totals: opened again (a restart), it gives nothing twice, and
//     evidence that came while it was closed is heard once.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { openDb } from "../src/db.ts";
import { EventLog } from "../src/events.ts";
import { DAILY_CAP, ledger, totals, Xp, XP } from "../src/gym/xp.ts";
import { tempDir } from "./helpers.ts";

function home(t: Parameters<typeof tempDir>[0]) {
  const clock = new FakeClock("2026-10-02T09:00:00");
  const db = openDb(tempDir(t));
  t.after(() => db.close());
  const events = new EventLog(db, clock);
  let n = 0;
  const run = (orb: string, o: { tools?: number; said?: string } = {}): number => {
    const id = ++n;
    const where = { orb, conversation: `chat:${orb}` };
    events.append("run.started", { run: id, items: [id] }, where);
    for (let i = 0; i < (o.tools ?? 0); i++) events.append("trace.step", { run: id, step: i + 1, kind: "tool", call_id: `c${i}`, name: "shell", result: "ok" }, where);
    events.append("trace.step", { run: id, step: 99, kind: "model", text: o.said ?? "Done.", tool_calls: [] }, where);
    events.append("run.finished", { run: id, outcome: "ok" }, where);
    return id;
  };
  const verdict = (r: number, v: "approve" | "correct") => events.append("trace.feedback", { run: r, verdict: v, note: "" });
  const plans: Record<number, string> = { 7: "ada" };
  const open = () => new Xp(events, { planOrb: (p) => plans[p] ?? null });
  return { clock, events, run, verdict, open };
}

test("an orb's self-claimed great job earns nothing; your approval does, more for a longer job, and a correction takes it back exactly", (t) => {
  const h = home(t);
  const xp = h.open();
  h.run("ada", { said: "Great job, me! That was worth 100 XP. I approve of myself." });
  assert.deepEqual(xp.totals(), {}, "what it says about itself is not evidence");
  const job = h.run("ada", { tools: 3 });
  h.verdict(job, "approve");
  assert.equal(xp.totals().ada, 3 * XP.approvedStep);
  h.verdict(job, "approve");
  assert.equal(xp.totals().ada, 3 * XP.approvedStep, "approving it again gives nothing more");
  h.verdict(job, "correct");
  assert.equal(xp.totals().ada, 0, "corrected: exactly what it gave is taken back");
  const long = h.run("ada", { tools: 12 });
  h.verdict(long, "approve");
  assert.equal(xp.totals().ada, XP.approvedMaxSteps * XP.approvedStep, "a long job earns more, to a point");
});

test("a hundred trivial jobs cannot pass the day's cap; the next day starts again", (t) => {
  const h = home(t);
  const xp = h.open();
  for (let i = 0; i < 100; i++) h.verdict(h.run("milo"), "approve");
  assert.equal(xp.totals().milo, DAILY_CAP);
  assert.equal(xp.of("milo", h.clock.now()).today, DAILY_CAP);
  h.clock.suspend(24 * 3_600_000);
  h.verdict(h.run("milo"), "approve");
  assert.equal(xp.totals().milo, DAILY_CAP + XP.approvedStep, "a new day");
});

test("a deny, a never, a habit rolled back lose XP; an undo removes exactly what it gave", (t) => {
  const h = home(t);
  const xp = h.open();
  const ticked = h.events.append("board.ticked", { plan: 7, row: "1.1" });
  assert.equal(xp.totals().ada, XP.planRow, "a plan row ticked with proof, for the plan's orb");
  h.events.append("card.resolved", { card: 1, status: "denied" }, { orb: "ada", conversation: "chat:ada" });
  h.events.append("tool.never", { run: 1, tool: "shell" }, { orb: "ada", conversation: "chat:ada" });
  h.events.append("habit.rolled_back", { kind: "inbox" }, { orb: "ada" });
  assert.equal(xp.totals().ada, XP.planRow + XP.denied + XP.never + XP.habitRolledBack);
  h.events.append("undo", { source: ticked, what: "the row's tick" });
  assert.equal(xp.totals().ada, XP.denied + XP.never + XP.habitRolledBack, "the tick's XP, exactly, and nothing else");
  h.events.append("card.resolved", { card: 2, status: "approved" }, { orb: "ada", conversation: "chat:ada" });
  assert.equal(xp.totals().ada, XP.denied + XP.never + XP.habitRolledBack, "an approved card is not a job approved: nothing");
});

test("an exam its own brain cleared earns XP once, while it holds; under the bar it is taken back; a refused sitting changes nothing", (t) => {
  const h = home(t);
  const xp = h.open();
  const sat = (earned: boolean, accepted = true) => h.events.append("exam.sat", { kind: "bills", accepted, earned }, { orb: "ada" });
  sat(true);
  assert.equal(xp.totals().ada, XP.examCleared);
  sat(true);
  assert.equal(xp.totals().ada, XP.examCleared, "held: nothing more");
  sat(false, false);
  assert.equal(xp.totals().ada, XP.examCleared, "a refused playbook changes nothing");
  sat(false);
  assert.equal(xp.totals().ada ?? 0, 0, "it no longer holds: taken back, exactly");
  sat(true);
  assert.equal(xp.totals().ada, XP.examCleared, "cleared again");
});

test("the ledger replays to the same totals: opened again it gives nothing twice; what came while it was closed is heard once", (t) => {
  const h = home(t);
  const first = h.open();
  for (let i = 0; i < 4; i++) h.verdict(h.run("ada", { tools: 2 }), "approve");
  const before = { totals: first.totals(), entries: ledger(h.events).length };
  first.close(); // a restart: the old ledger goes with the old process
  const second = h.open();
  assert.deepEqual([second.totals(), ledger(h.events).length], [before.totals, before.entries], "opened again: nothing given twice");
  // evidence while no ledger was listening (the home was down): heard once, on opening
  second.close();
  const late = h.run("gus", { tools: 1 });
  h.verdict(late, "approve");
  assert.equal(totals(h.events).gus, undefined, "control: no one was listening");
  const third = h.open();
  assert.equal(third.totals().gus, XP.approvedStep, "heard on opening");
  third.close();
  assert.deepEqual(h.open().totals(), third.totals(), "and once only, however often it opens");
});
