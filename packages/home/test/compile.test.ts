// PLAN 3.2_t (the compiler): at night the teacher writes a step habit for a candidate, and the
// harness replays every approved run through it in the kit's sandbox (the real kit, a fake
// teacher). It is promoted only if every run matches, call for call and word for word; what the
// teacher says about its code is never read.
//   - The right code is promoted and kept, with the familiarity of the inputs it was proved on:
//     a new mail of the same kind gets its first call, one with a field it never saw is refused.
//   - Code that "all runs pass" but keeps the wrong bill, code that does not load, and a teacher
//     that never answers are each rejected, with why, and nothing is kept.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { realClock } from "../src/clock.ts";
import { openDb } from "../src/db.ts";
import { EventLog } from "../src/events.ts";
import { Kit } from "../src/kit.ts";
import { casesOf } from "../src/gym/cases.ts";
import { BRIEF_RESULT, BRIEF_RUNS, brief, codeOf, compile, habitDir } from "../src/gym/compile.ts";
import { findHotPaths } from "../src/gym/finder.ts";
import { approved, GOOD, reply } from "./fixtures/bills.ts";
import { agentHome, tempDir } from "./helpers.ts";

const LONG = { timeout: 120_000 }; // a sandbox per step, nine steps a compile

async function night(t: TestContext) {
  const dataDir = tempDir(t);
  const db = openDb(dataDir);
  const events = new EventLog(db, realClock);
  const kit = new Kit({ events, clock: realClock, dataDir, env: { ORBS_KIT_TEST_TOOLS: "1" } });
  t.after(async () => {
    await kit.close();
    db.close();
  });
  await kit.start();
  approved(events, "ada");
  const [candidate] = findHotPaths(events, { since: 0 });
  assert.ok(candidate, "three approved runs, done the same way: a candidate");
  const cases = casesOf(events, candidate.runs);
  const call = (tool: string, args: Record<string, unknown>) => kit.call(tool, args);
  return { dataDir, events, kit, candidate, cases, call };
}


test("the teacher's code is promoted only after every approved run replays through it; then it is kept, with what it knows", LONG, async (t) => {
  const n = await night(t);
  const briefs: string[] = [];
  const r = await compile({ candidate: n.candidate, cases: n.cases, teacher: async (b) => (briefs.push(b), reply(GOOD)), kit: n.call, dataDir: n.dataDir, events: n.events });
  assert.equal(briefs.length, 1);
  for (const s of ["Rent", "Gym", "Water", "read_file>remind {subject}"]) assert.ok(briefs[0]!.includes(s), `the brief has ${s}`);
  const dir = habitDir(n.dataDir, n.candidate, 1);
  if (!r.promoted && /no habit sandbox/.test(r.why ?? "")) {
    t.diagnostic("no habit sandbox on this machine: nothing runs, and it says why");
    assert.equal(existsSync(join(dir, "habit.py")), false);
    return;
  }
  assert.deepEqual([r.promoted, r.why], [true, null]);
  const promoted = n.events.ofType("habit.promoted");
  assert.deepEqual(promoted.map((e) => [e.orb, e.data.kind, e.data.runs]), [["ada", n.candidate.key, [101, 102, 103]]]);
  assert.equal(existsSync(join(dir, "habit.py")), true);
  const next = await n.call("habit_step", { habit_dir: dir, input: { text: "[Trigger: bills] New email: Phone", data: { trigger: "t1", subject: "Phone" } }, done: [] });
  assert.deepEqual(next, { call: { name: "read_file", args: { path: "bills.csv" } } }, "a new mail of the same kind: its first call");
  const odd = (await n.call("habit_step", { habit_dir: dir, input: { text: "[Trigger: bills] New email: Phone", data: { trigger: "t1", subject: "Phone", cc: "x@y.z" } }, done: [] })) as { refused?: string };
  assert.match(odd.refused ?? "", /unfamiliar input/, "a field it was never proved on: refused, for the brain");
});

test("a claim is never read: wrong code, code that does not load, a teacher that never answers, each rejected with why; nothing kept", LONG, async (t) => {
  const n = await night(t);
  const dir = habitDir(n.dataDir, n.candidate, 1);
  const go = (teacher: (b: string) => Promise<string>) => compile({ candidate: n.candidate, cases: n.cases, teacher, kit: n.call, dataDir: n.dataDir, events: n.events });
  const probe = await go(async () => reply(GOOD.replace('"title": subject', '"title": "Rent"'))); // "all runs pass": it always keeps the rent
  if (/no habit sandbox/.test(probe.why ?? "")) {
    t.diagnostic("no habit sandbox on this machine: nothing runs, and it says why");
    return;
  }
  assert.equal(probe.promoted, false);
  assert.match(probe.why ?? "", /^run 102: call 2 was remind\(.*"Rent".*\), the approved run's remind\(.*"Gym"/);
  const broken = await go(async () => reply("def guard(inp:\n"));
  assert.deepEqual([broken.promoted, broken.why], [false, "run 101: it refused a run you approved: the habit's code does not load"]);
  const silent = await go(async () => {
    throw new Error("503 from the teacher");
  });
  assert.deepEqual([silent.promoted, silent.why], [false, "the teacher did not answer: 503 from the teacher"]);
  assert.equal(existsSync(join(dir, "habit.py")), false, "nothing rejected is kept");
  assert.equal(n.events.ofType("habit.promoted").length, 0);
  assert.deepEqual(
    n.events.ofType("habit.rejected").map((e) => [e.orb, e.data.kind, typeof e.data.why]),
    Array.from({ length: 3 }, () => ["ada", n.candidate.key, "string"]),
  );
});

test("the brief shows the newest runs and quotes a long result in part; every run is still the test", () => {
  const big = "x".repeat(BRIEF_RESULT + 500);
  const cases = Array.from({ length: BRIEF_RUNS + 3 }, (_, i) => ({
    run: i + 1, input: { text: `mail ${i + 1}`, data: { subject: `S${i + 1}` } },
    steps: [{ call: { name: "read_file", args: { path: "bills.csv" } }, result: i === BRIEF_RUNS + 2 ? big : "rent,1200\n", isError: false }], output: `Kept S${i + 1}.`,
  }));
  const c = { key: "ada|trigger:t1|read_file {subject}", orb: "ada", trigger: "trigger:t1", task: "ada|trigger:t1|{subject}", shape: "read_file {subject}", runs: [], others: [], firstAt: 0, lastAt: 0 };
  const b = brief(c, cases);
  assert.match(b, new RegExp(`done ${BRIEF_RUNS + 3} times and the person approved every time \\(the newest ${BRIEF_RUNS} are below\\)`));
  assert.ok(!b.includes('"mail 3"') && b.includes('"mail 4"') && b.includes(`"mail ${BRIEF_RUNS + 3}"`), "the newest");
  assert.ok(!b.includes(big) && b.includes("cut here for the brief"), "a long result in part");
});

test("the teacher's code is read from its python block, or the whole reply when it gave none", () => {
  assert.equal(codeOf(reply(GOOD)), GOOD);
  assert.equal(codeOf("```py\nx = 1\n```"), "x = 1\n");
  assert.equal(codeOf("def guard(i):\n    return None\n"), "def guard(i):\n    return None\n");
});

test("the night's habit answers the next mail through the home and the kit; a subject unlike any it was proved on goes to the brain", LONG, async (t) => {
  const { home, model } = await agentHome(t, [{ chunks: ["Kept it; the euros are noted."] }], { kit: true });
  approved(home.events, "juniper");
  const [candidate] = findHotPaths(home.events, { since: 0 });
  const r = await compile({
    candidate: candidate!, cases: casesOf(home.events, candidate!.runs), teacher: async () => reply(GOOD),
    kit: (tool, args) => home.kit!.call(tool, args), dataDir: home.dataDir, events: home.events,
  });
  if (/no habit sandbox/.test(r.why ?? "")) {
    t.diagnostic("no habit sandbox on this machine: nothing runs, and it says why");
    return;
  }
  assert.equal(r.promoted, true);
  const ws = home.agent!.workspace("juniper");
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, "bills.csv"), "rent,1200\n");
  home.inbox.enqueue("juniper", "trigger:t1", "trigger", "[Trigger: bills] New email: Phone", { data: { trigger: "t1", subject: "Phone" }, fresh: true });
  await home.inbox.idle();
  assert.equal(model.agent.length, 0, "the habit answered: the brain was never asked");
  const said = () => home.conversations.history("trigger:t1").filter((m) => m.role === "assistant").at(-1)?.content;
  assert.equal(said(), "Kept Phone for you.");
  assert.ok(home.conversations.history("trigger:t1").some((m) => m.role === "tool" && /^Kept \(bill \d+\)/.test(m.content ?? "")), "its remind ran, for real");
  // the same task, a subject unlike any it was proved on (its guard would let it through)
  home.inbox.enqueue("juniper", "trigger:t1", "trigger", "[Trigger: bills] New email: Car €400", { data: { trigger: "t1", subject: "Car €400" }, fresh: true });
  await home.inbox.idle();
  assert.equal(model.agent.length, 1, "an input it was never proved on: the brain's");
  assert.equal(said(), "Kept it; the euros are noted.");
  assert.match(String(home.events.ofType("habit.fell").at(-1)?.data.why), /^unfamiliar input: unfamiliar character\(s\) '€'/);
});
