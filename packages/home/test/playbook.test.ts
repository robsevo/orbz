// PLAN 3.4_t (the own brain's playbook), with a scripted own brain:
//   - The playbook is code's: instructions and approved runs as worked examples; new runs make
//     a new version.
//   - At night the own brain sits the exam on the task's approved runs: cleared, the task moves to
//     it; under the bar it stays on the big brain; a playbook that
//     regresses against the last accepted one is refused, and that one stands.
//   - At run time a task it earned is its, the playbook in its instructions; when it cannot
//     answer, the big brain takes the run on, saying so; a chat stays on the big brain.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { realClock } from "../src/clock.ts";
import { openDb } from "../src/db.ts";
import { EventLog } from "../src/events.ts";
import { casesOf } from "../src/gym/cases.ts";
import { morningCard } from "../src/gym/card.ts";
import { findHotPaths } from "../src/gym/finder.ts";
import { Gym } from "../src/gym/night.ts";
import { playbookOf } from "../src/gym/playbook.ts";
import { earnedFor } from "../src/gym/steps.ts";
import { approved } from "./fixtures/bills.ts";
import { fakeModel, type Turn } from "./fakes/model.ts";
import { agentHome, tempDir } from "./helpers.ts";

const TASK = "ada|trigger:t1|{subject}";

/** One repeat of a bills case, as the own brain answers it: read, keep (as `title`), say so. */
const repeat = (title: string): Turn[] => [
  { calls: [{ name: "read_file", args: { path: "bills.csv" } }] },
  { calls: [{ name: "remind", args: { kind: "bill", title, due: "2026-10-06" } }] },
  { chunks: [`Done: ${title} is on your list.`] },
];

/** A sitting's script: every case, k times, each kept as `titleOf(subject, repeat)`. */
const sitting = (subjects: string[], k: number, titleOf: (s: string, i: number) => string = (s) => s): Turn[] =>
  subjects.flatMap((s) => Array.from({ length: k }, (_, i) => repeat(titleOf(s, i))).flat());

async function night(t: TestContext, script: Turn[]) {
  const db = openDb(tempDir(t));
  t.after(() => db.close());
  const events = new EventLog(db, realClock);
  const own = await fakeModel(t, script);
  const g = new Gym({
    events, clock: realClock, dataDir: tempDir(t), k: 2, teacher: () => null, kit: async () => ({ refused: "no kit here" }),
    own: () => ({ name: "own", baseUrl: own.url, model: "own-model", retries: 0 }),
  });
  return { events, g, own };
}

test("the playbook is code's: instructions and the newest approved runs as worked examples; new runs, a new version", (t) => {
  const db = openDb(tempDir(t));
  t.after(() => db.close());
  const events = new EventLog(db, realClock);
  approved(events, "ada");
  const c = findHotPaths(events, { since: 0 })[0]!;
  const pb = playbookOf(c, casesOf(events, c.runs));
  assert.match(pb.system, /It starts from trigger:t1, and it is done with read_file, then remind\./);
  assert.match(pb.system, /Example 1\nAsked: \[Trigger: bills\] New email: Water\nCalled read_file \{"path":"bills.csv"\} → rent,1200\\n\nCalled remind/);
  assert.ok(!pb.system.includes("New email: Rent"), "two examples, the newest");
  assert.equal(playbookOf(c, casesOf(events, c.runs)).version, pb.version, "the same runs, the same playbook");
  approved(events, "ada", ["Phone"], 104);
  const c2 = findHotPaths(events, { since: 0 })[0]!;
  assert.notEqual(playbookOf(c2, casesOf(events, c2.runs)).version, pb.version);
});

test("cleared, the task moves to the own brain; a regressing playbook is refused and the one before stands", async (t) => {
  // the newest two runs are the playbook's examples, the rest its exam. First night: Rent, right
  // twice. The second (Bus and Phone the examples): Rent, Gym and Water, each kept as the rent
  const { events, g, own } = await night(t, [...sitting(["Rent"], 2), ...sitting(["Rent", "Gym", "Water"], 2, () => "Rent")]);
  approved(events, "ada");
  const first = await g.night();
  assert.deepEqual(first.sat, [{ kind: "ada|trigger:t1|read_file>remind {subject}", verdict: "pass", earned: true }]);
  const earned = earnedFor(events, "ada", TASK, "own-model")!;
  assert.match(earned.system, /Example 1/);
  assert.equal(own.agent.length, 6, "one case held out from the examples, twice, 3 steps each");
  const asked = new Set(own.agent.map((m) => String(m.find((x) => x.role === "user")?.content)));
  assert.deepEqual([...asked], ["[Trigger: bills] New email: Rent"], "the examples (Gym, Water) are not its exam");
  assert.match(String(own.agent[0]![0]!.content), /This is a task you have done before/, "sat with its playbook");
  await g.night();
  assert.equal(own.agent.length, 6, "nothing new: not sat again");
  const [bus] = approved(events, "ada", ["Bus"], 110);
  events.append("ladder.answered", { kind: earned.kind, tier: "own", run: bus }, { orb: "ada" });
  await g.night();
  assert.equal(own.agent.length, 6, "a run it answered itself, approved, is no news");
  approved(events, "ada", ["Phone"], 104);
  const second = await g.night();
  assert.deepEqual(second.sat.map((s) => [s.verdict, s.earned]), [["regressed", false]]);
  assert.equal(events.ofType("playbook.refused").length, 1);
  assert.equal(earnedFor(events, "ada", TASK, "own-model")?.version, earned.version, "the one before stands");
  assert.equal(earnedFor(events, "ada", TASK, "other-model"), null, "earned by that brain, not any");
});

test("under the bar it stays on the big brain", async (t) => {
  const { events, g } = await night(t, sitting(["Rent"], 2, (s, i) => (i === 0 ? s : "Gym")));
  approved(events, "ada");
  const r = await g.night();
  assert.deepEqual(r.sat.map((s) => [s.verdict, s.earned]), [["pass", false]], "1 of 2: under the bar");
  assert.equal(earnedFor(events, "ada", TASK, "own-model"), null, "no move");
});

test("a task it earned is the own brain's at run time, its playbook in its instructions; when it cannot answer, the big brain takes over", async (t) => {
  const own = await fakeModel(t, [{ calls: [{ name: "read_file", args: { path: "bills.csv" } }] }, { chunks: ["Kept Rent: 1200."] }, { status: 500 }]);
  const ep = { name: "own", baseUrl: own.url, model: "own-model", retries: 0 };
  const find = (orb: string, task: string) => (orb === "juniper" && task === "juniper|trigger:t1|{subject}" ? { kind: "bills", task, version: "p1", system: "PLAYBOOK: read the bills, keep the one asked.", ep } : null);
  const { home, model } = await agentHome(t, [{ chunks: ["The big brain kept it."] }, { chunks: ["The big brain, in a chat."] }], { agent: { own: { find } } });
  const ws = home.agent!.workspace("juniper");
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, "bills.csv"), "rent,1200\n");
  const mail = (subject: string) => home.inbox.enqueue("juniper", "trigger:t1", "trigger", `[Trigger: bills] New email: ${subject}`, { data: { trigger: "t1", subject }, fresh: true });
  mail("Rent");
  await home.inbox.idle();
  const said = () => home.conversations.history("trigger:t1").filter((m) => m.role === "assistant").at(-1)?.content;
  assert.equal(said(), "Kept Rent: 1200.");
  assert.equal(model.agent.length, 0, "the big brain was not asked");
  assert.match(String(own.agent[0]![0]!.content), /PLAYBOOK: read the bills/, "the playbook is in its instructions");
  assert.deepEqual(home.events.ofType("ladder.answered").map((e) => [e.data.tier, e.data.kind]), [["own", "bills"]]);
  assert.ok(home.events.ofType("brain.spend").every((e) => e.data.tier === "own"));
  const card = morningCard(home.events, { now: Date.now() + 86_400_000, learned: () => [] })!;
  assert.deepEqual(card.orbs.map((n) => [n.own, n.big]), [[1, 0]], "counted once, as his own brain's");

  mail("Gym"); // the own brain answers 500
  await home.inbox.idle();
  assert.equal(said(), "The big brain kept it.");
  assert.equal(home.events.ofType("own.fell").length, 1);
  assert.ok(home.conversations.history("trigger:t1").some((m) => m.meta.ownFell === "bills"), "said so");

  home.inbox.enqueue("juniper", "chat:juniper", "chat", "[Trigger: bills] New email: Rent", { data: { trigger: "t1", subject: "Rent" } });
  await home.inbox.idle();
  assert.equal(model.agent.length, 2, "a chat: the big brain's");
  assert.equal(own.agent.length, 3);
});
