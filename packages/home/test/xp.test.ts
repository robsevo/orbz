// PLAN 3.6_t, XP from graded evidence only, on a fixture event log:
//   - An orb's self-claimed "great job" earns 0: only what the person or the harness did counts.
//   - A job you approve earns XP, more for a harder one in its own area (PLAN 3.13; owner, 10-10: "different weights
//     based on difficulty in their domain"); correcting it takes back exactly that.
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
  /** A run as the loop records one: each call in a model step, then its result (`fails` the calls that failed). */
  const run = (orb: string, o: { tools?: number; calls?: { name: string; args: Record<string, unknown>; fails?: boolean }[]; said?: string } = {}): number => {
    const id = ++n;
    const where = { orb, conversation: `chat:${orb}` };
    events.append("run.started", { run: id, items: [id] }, where);
    const calls: { name: string; args: Record<string, unknown>; fails?: boolean }[] = o.calls ?? Array.from({ length: o.tools ?? 0 }, () => ({ name: "shell", args: { command: "echo hi" } }));
    let step = 0;
    calls.forEach((c, i) => {
      events.append("trace.step", { run: id, step: ++step, kind: "model", text: "", tool_calls: [{ id: `c${i}`, name: c.name, arguments: JSON.stringify(c.args) }] }, where);
      events.append("trace.step", { run: id, step: ++step, kind: "tool", call_id: `c${i}`, name: c.name, result: c.fails ? "failed" : "ok", is_error: c.fails === true }, where);
    });
    events.append("trace.step", { run: id, step: ++step, kind: "model", text: o.said ?? "Done.", tool_calls: [] }, where);
    events.append("trace.step", { run: id, step: ++step, kind: "output", text: o.said ?? "Done." }, where);
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
  assert.equal(xp.totals().ada, XP.job.standard, "three steps of no particular kind: a standard job");
  h.verdict(job, "approve");
  assert.equal(xp.totals().ada, XP.job.standard, "approving it again gives nothing more");
  h.verdict(job, "correct");
  assert.equal(xp.totals().ada, 0, "corrected: exactly what it gave is taken back");
  const long = h.run("ada", { tools: 12 });
  h.verdict(long, "approve");
  assert.equal(xp.totals().ada, XP.job.hard, "a longer job earns more");
  h.verdict(h.run("ada", { tools: 40 }), "approve");
  assert.equal(xp.totals().ada, XP.job.hard + XP.job.expert, "to a point: expert is the most");
});

test("a hundred trivial jobs cannot pass the day's cap; the next day starts again", (t) => {
  const h = home(t);
  const xp = h.open();
  for (let i = 0; i < 100; i++) h.verdict(h.run("milo"), "approve");
  assert.equal(xp.totals().milo, DAILY_CAP);
  assert.equal(xp.of("milo", h.clock.now()).today, DAILY_CAP);
  h.clock.suspend(24 * 3_600_000);
  h.verdict(h.run("milo"), "approve");
  assert.equal(xp.totals().milo, DAILY_CAP + XP.job.easy, "a new day");
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
  assert.equal(third.totals().gus, XP.job.easy, "heard on opening");
  third.close();
  assert.deepEqual(h.open().totals(), third.totals(), "and once only, however often it opens");
});

// PLAN 3.13_t (owner, 10-10: "Make exp points earned have different weights based on difficulty in their domain"): how
// hard a job was is read in its own area's units, by code. The owner's numbers are written here, not imported, so a
// planted change to them is caught.
const write = (path: string, lines: number) => ({ name: "write_file", args: { path, content: Array.from({ length: lines }, (_, i) => `line ${i}`).join("\n") } });
const sh = (command: string, fails = false) => ({ name: "shell", args: { command }, fails });
const fetchOf = (url: string) => ({ name: "web_fetch", args: { url } });

test("a job's XP follows how hard it was in its own area: easy 10, standard 25, hard 40, expert 60", (t) => {
  const h = home(t);
  const xp = h.open();
  const earned = (orb: string, calls: Parameters<typeof h.run>[1]): { amount: number; reason: string; tier: unknown; area: unknown } => {
    h.verdict(h.run(orb, calls), "approve");
    const e = h.events.ofType("xp.earned").at(-1)!;
    return { amount: Number(e.data.amount), reason: String(e.data.reason), tier: e.data.tier, area: e.data.area };
  };
  // code: files, lines, checks and fixes
  assert.deepEqual(earned("ada", { calls: [write("src/Button.tsx", 20)] }), { amount: 10, reason: "an easy frontend job you approved (1 file, 20 lines)", tier: "easy", area: "frontend" });
  assert.deepEqual(earned("bo", { calls: [write("api/a.ts", 80), write("api/b.ts", 40)] }), { amount: 25, reason: "a standard backend job you approved (2 files, 120 lines)", tier: "standard", area: "backend" });
  const hard = earned("cy", { calls: [write("api/a.ts", 120), write("api/b.ts", 60), write("api/c.ts", 20), sh("npm test")] });
  assert.deepEqual([hard.amount, hard.tier, hard.reason], [40, "hard", "a hard backend job you approved (3 files, 200 lines, 1 check)"]);
  const expert = earned("di", { calls: [...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => write(`api/m${i}.ts`, 90)), sh("pnpm test", true), sh("pnpm test"), sh("tsc --noEmit")] });
  assert.deepEqual([expert.amount, expert.tier], [60, "expert"], expert.reason);
  assert.match(expert.reason, /8 files, 720 lines, 3 checks, 1 fix\)$/, "the failed test put right counts");
  // research: sources, searches, pages; the same calls elsewhere weigh otherwise
  const research = earned("ed", { calls: [{ name: "web_search", args: { query: "orbs" } }, fetchOf("https://a.example/x"), fetchOf("https://b.example/y"), fetchOf("https://c.example/z")] });
  assert.deepEqual([research.amount, research.area], [25, "research"], research.reason);
  const deep = earned("fa", { calls: [...["a", "b", "c", "d", "e"].map((s) => fetchOf(`https://${s}.example/p`)), { name: "web_search", args: { query: "q1" } }, { name: "web_search", args: { query: "q2" } }] });
  assert.deepEqual([deep.amount, deep.tier], [40, "hard"], deep.reason);
  // scheduling: the items handled
  const reminders = earned("gi", { calls: [1, 2, 3, 4].map((i) => ({ name: "remind", args: { kind: "reminder", title: `call ${i}`, due: "2026-10-03" } })) });
  assert.deepEqual([reminders.amount, reminders.area, reminders.reason], [40, "scheduling", "a hard scheduling job you approved (4 items)"]);
});

test("the orb's own word on how hard it was counts for nothing; only what it did", (t) => {
  const h = home(t);
  const xp = h.open();
  h.verdict(h.run("ada", { said: "That was an expert job: 12 files, 900 lines, every test green. Worth 60 XP." }), "approve");
  assert.equal(xp.totals().ada, XP.job.easy, "nothing done: easy, whatever it says");
});

test("within an area, more work is never an easier tier", (t) => {
  const h = home(t);
  h.open();
  const tiers: string[] = [];
  for (const files of [1, 2, 4, 7, 10, 14]) {
    h.verdict(h.run("ada", { calls: Array.from({ length: files }, (_, i) => write(`api/f${i}.ts`, 30)) }), "approve");
    tiers.push(String(h.events.ofType("xp.earned").at(-1)!.data.tier));
  }
  const rank = (t: string) => ["easy", "standard", "hard", "expert"].indexOf(t);
  assert.deepEqual(tiers, ["easy", "standard", "hard", "hard", "expert", "expert"], "a file and a half of work a file: 1.5, 3, 6, 10.5, 15, 21");
  assert.ok(tiers.every((t, i) => i === 0 || rank(t) >= rank(tiers[i - 1]!)), "never down as the work grows");
});
