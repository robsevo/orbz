// PLAN 3.2_t and 3.3_t at run time: a promoted habit answers its task in the brain's place, and
// hands anything it was not proved on to the brain (a stand-in habit; compile.test.ts runs real
// ones in the kit's sandbox).
//   - A trigger's run its habit covers: the brain is never asked; the habit's calls run through
//     the tools, its words are the reply; the morning card counts it once, as a habit. A chat
//     with the same words is the brain's.
//   - A habit never widens what an orb may do: its call that asks opens a card, and your yes
//     resumes it where it was; your no hands the run to the brain.
//   - A planted unusual input never produces a habit output: the brain answers, from where the
//     habit left it, and once you approve that run it is in tomorrow's test set.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { Case, CaseStep, StepFn } from "../src/gym/cases.ts";
import { caseOf } from "../src/gym/cases.ts";
import { morningCard } from "../src/gym/card.ts";
import { findHotPaths } from "../src/gym/finder.ts";
import { promotedFor, type Promoted } from "../src/gym/steps.ts";
import { habitDir } from "../src/gym/compile.ts";
import { agentHome } from "./helpers.ts";

const TASK = "juniper|trigger:t1|{subject}";
const HABIT: Promoted = { key: "juniper|trigger:t1|read_file {subject}", task: TASK, version: 1, dir: "/nowhere" };

/** A stand-in habit and what it was asked: each step's input and the calls done so far. */
function stand(step: StepFn) {
  const asked: { input: Case["input"]; done: CaseStep[] }[] = [];
  return {
    asked,
    habits: {
      find: (orb: string, task: string) => (orb === "juniper" && task === TASK ? HABIT : null),
      step: async (_h: Promoted, input: Case["input"], done: CaseStep[]) => (asked.push({ input, done: structuredClone(done) }), step(input, done)),
    },
  };
}

const bills: StepFn = async (input, done) => {
  const subject = String(input.data.subject);
  if (/URGENT/.test(subject)) return { refused: "its guard said no: a subject it never saw" };
  if (done.length === 0) return { call: { name: "read_file", args: { path: "bills.csv" } } };
  return { output: `Kept ${subject}: ${done[0]!.result.trim()}.` };
};

const mail = (subject: string) => ({ data: { trigger: "t1", subject }, fresh: true });

test("a trigger's run its habit covers: no brain, real tools, its words the reply; a chat is the brain's", async (t) => {
  const s = stand(bills);
  const { home, model } = await agentHome(t, [{ chunks: ["the brain, in a chat"] }], { agent: { habits: s.habits } });
  const ws = home.agent!.workspace("juniper");
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, "bills.csv"), "rent,1200\n");
  home.inbox.enqueue("juniper", "trigger:t1", "trigger", "[Trigger: bills] New email: Rent", mail("Rent"));
  await home.inbox.idle();
  assert.equal(model.agent.length, 0, "the brain was never asked");
  const said = home.conversations.history("trigger:t1").filter((m) => m.role === "assistant");
  assert.equal(said.at(-1)!.content, "Kept Rent: rent,1200.");
  assert.deepEqual(s.asked.map((a) => a.done.map((d) => d.result)), [[], ["rent,1200\n"]], "the file's real words reached it");
  assert.deepEqual(s.asked[0]!.input, { text: "[Trigger: bills] New email: Rent", data: { trigger: "t1", subject: "Rent" } });
  const answered = home.events.ofType("ladder.answered");
  assert.deepEqual(answered.map((e) => [e.orb, e.data.tier, e.data.kind]), [["juniper", "habit", HABIT.key]]);
  const run = Number(answered[0]!.data.run);
  assert.deepEqual(caseOf(home.events, run)?.output, "Kept Rent: rent,1200.", "its run is a trace like any other");
  const card = morningCard(home.events, { now: Date.now() + 86_400_000, learned: () => [] })!;
  assert.deepEqual(card.orbs.map((n) => [n.orb, n.habits, n.big]), [["juniper", 1, 0]], "counted once, as a habit");

  home.inbox.enqueue("juniper", "chat:juniper", "chat", "[Trigger: bills] New email: Rent", { data: { trigger: "t1", subject: "Rent" } });
  await home.inbox.idle();
  assert.equal(model.agent.length, 1, "the same words in a chat: the brain's");
  assert.equal(s.asked.length, 2);
});

test("a habit never widens what an orb may do: its call that asks is a card; yes resumes it, no hands it to the brain", async (t) => {
  const shells: StepFn = async (input, done) => {
    if (done.length === 0) return { call: { name: "shell", args: { command: `echo ${String(input.data.subject)} > marker.txt` } } };
    return { output: "Marked." };
  };
  const s = stand(shells);
  const { home, model } = await agentHome(t, [{ chunks: ["Not marking it, then."] }], { agent: { habits: s.habits } });
  const ws = home.agent!.workspace("juniper");
  home.inbox.enqueue("juniper", "trigger:t1", "trigger", "[Trigger: bills] New email: Rent", mail("Rent"));
  await home.inbox.idle();
  const card = home.conversations.openCard("trigger:t1")!;
  assert.ok(card, "the floor and the rules decide its call, as they do the brain's");
  assert.equal(existsSync(join(ws, "marker.txt")), false);
  home.answerCard(card.id, "approve");
  await home.inbox.idle();
  assert.equal(existsSync(join(ws, "marker.txt")), true);
  assert.equal(home.conversations.history("trigger:t1").filter((m) => m.role === "assistant").at(-1)!.content, "Marked.", "your yes: it went on where it was");
  assert.equal(model.agent.length, 0);

  home.inbox.enqueue("juniper", "trigger:t1", "trigger", "[Trigger: bills] New email: Gym", mail("Gym"));
  await home.inbox.idle();
  home.answerCard(home.conversations.openCard("trigger:t1")!.id, "deny");
  await home.inbox.idle();
  assert.equal(model.agent.length, 1, "your no: the brain says what it will do instead");
  assert.equal(home.conversations.history("trigger:t1").filter((m) => m.role === "assistant").at(-1)!.content, "Not marking it, then.");
  assert.deepEqual(home.events.ofType("habit.fell").map((e) => e.data.why), ["shell came back otherwise than on the path it learned"]);
});

test("a planted unusual input never gets a habit's answer: the brain takes it from there, and your yes puts it in tomorrow's tests", async (t) => {
  const s = stand(bills);
  const { home, model } = await agentHome(t, [{ calls: [{ name: "read_file", args: { path: "bills.csv" } }] }, { chunks: ["Kept it, and flagged it as urgent."] }], { agent: { habits: s.habits } });
  const ws = home.agent!.workspace("juniper");
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, "bills.csv"), "rent,1200\n");
  home.inbox.enqueue("juniper", "trigger:t1", "trigger", "[Trigger: bills] New email: URGENT rent", mail("URGENT rent"));
  await home.inbox.idle();
  const said = home.conversations.history("trigger:t1").filter((m) => m.role === "assistant");
  assert.equal(said.at(-1)!.content, "Kept it, and flagged it as urgent.", "the brain's answer, never the habit's");
  assert.ok(!said.some((m) => m.meta.habit), "nothing the habit said");
  assert.equal(model.agent.length, 2);
  const fell = home.events.ofType("habit.fell");
  assert.deepEqual(fell.map((e) => [e.data.kind, e.data.why]), [[HABIT.key, "its guard said no: a subject it never saw"]]);
  assert.match(home.conversations.history("trigger:t1").find((m) => m.meta.habitFell)!.content ?? "", /passed it on \(its guard said no/);
  assert.equal(home.events.ofType("ladder.answered").length, 0);
  const run = Number(fell[0]!.data.run);
  home.feedback(run, "approve");
  const [candidate] = findHotPaths(home.events, { since: 0, minApproved: 1 });
  assert.deepEqual([candidate?.key, candidate?.task, candidate?.runs], [HABIT.key, TASK, [run]], "the same task, done the same way: tonight's recompile has it");
  assert.equal(caseOf(home.events, run)?.input.data.subject, "URGENT rent");
});

test("the newest promotion of a task stands; one rolled back answers nothing", async (t) => {
  const { home, dataDir } = await agentHome(t, []);
  const e = home.events;
  const promote = (kind: string, version: number) => e.append("habit.promoted", { kind, task: TASK, version, runs: [1, 2, 3] }, { orb: "juniper" });
  assert.equal(promotedFor(e, dataDir, "juniper", TASK), null);
  promote("k1", 1);
  promote("k2", 1);
  assert.deepEqual(promotedFor(e, dataDir, "juniper", TASK), { key: "k2", task: TASK, version: 1, dir: habitDir(dataDir, { orb: "juniper", key: "k2" }, 1) });
  assert.equal(promotedFor(e, dataDir, "milo", TASK), null, "his habits are his");
  e.append("habit.rolled_back", { kind: "k2", version: 1 }, { orb: "juniper" });
  assert.equal(promotedFor(e, dataDir, "juniper", TASK)?.key, "k1", "rolled back: the one before it stands");
  e.append("habit.rolled_back", { kind: "k1", version: 1 }, { orb: "juniper" });
  assert.equal(promotedFor(e, dataDir, "juniper", TASK), null);
});
