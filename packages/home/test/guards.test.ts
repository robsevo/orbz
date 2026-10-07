// Ash's guards and recitation in the home (owner, 10-07: "build the ash stuff next, the repeat guard and
// recitation"), on a real home with a scripted model:
//   - a reply that repeats one sentence, or cycles between two, is stopped where the loop began and kept
//     up to there; a varied reply, short repeated lines and a code block never trip it (controls);
//   - the same call, unchanged, is said to the model from its second run, and the fourth ends the turn
//     with a notice; different calls never are (control);
//   - an orb with open rows has them restated last in every request, alone with you (the conversation's
//     approved plan) and in a session (the rows it holds); nothing open, nothing restated; on the
//     ChatGPT plan the restatement stays at the end, as the developer's, not in the instructions.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LoopGuard } from "../src/agent/loopguard.ts";
import { toResponsesInput } from "../src/agent/responses.ts";
import { REPEAT_LIMIT } from "../src/agent/loop.ts";
import { text } from "./fakes/model.ts";
import { agentHome } from "./helpers.ts";

const feed = (g: LoopGuard, s: string, size = 7): ReturnType<LoopGuard["push"]> => {
  let trip = null;
  for (let i = 0; i < s.length && !trip; i += size) trip = g.push(s.slice(i, i + size));
  return trip;
};
const LOOP = "The codebase includes all the necessary testing considerations as outlined in the plan.md file. ";

test("the guard stops a run of one sentence and a cycle of two, keeping what came before; prose, short lines and code never trip it", () => {
  const before = "I read the plan and the tests. ";
  const g = new LoopGuard();
  const t = feed(g, before + LOOP.repeat(40));
  assert.equal(t?.kind, "run");
  assert.equal(t?.count, 5, "five in a row is a loop");
  assert.equal((before + LOOP.repeat(40)).slice(0, t!.cutAt).trim(), (before + LOOP).trim(), "kept up to the first time it said it");
  const c = new LoopGuard();
  const a = "Let me check the configuration file again now. ";
  const b = "The configuration file looks correct to me here. ";
  const ct = feed(c, "First, a real point about the work. " + (a + b).repeat(10));
  assert.equal(ct?.kind, "cycle");
  assert.equal(("First, a real point about the work. " + (a + b).repeat(10)).slice(0, ct!.cutAt).trim(), ("First, a real point about the work. " + a + b).trim(), "a cycle: kept through its first turn");
  // controls
  const prose = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} says something new about step ${i * 7}. `).join("");
  assert.equal(feed(new LoopGuard(), prose), null, "a long varied reply is not a loop");
  assert.equal(feed(new LoopGuard(), "Done. ".repeat(50)), null, "a short line repeated is not counted");
  assert.equal(feed(new LoopGuard(), "Here is the log:\n```\n" + "Retrying the request to the server in one second now. ".repeat(30) + "\n```\nThat is all of it. "), null, "nor a code block, however alike its lines");
  assert.equal(feed(new LoopGuard(), before + LOOP.repeat(4)), null, "four in a row is not yet a loop");
});

test("a reply that loops is stopped where the loop began: kept once, said so, and the run ends", async (t) => {
  const h = await agentHome(t, [{ chunks: ["I checked it. ", ...Array.from({ length: 60 }, () => LOOP)] }]);
  h.home.inbox.send("juniper", "chat:1", "is it tested?");
  await h.home.inbox.idle();
  const said = h.home.conversations.list("chat:1").filter((m) => m.role !== "user");
  assert.equal(said[0]!.role, "assistant");
  assert.equal(said[0]!.content, `I checked it. ${LOOP.trim()}`, "the reply up to its first time");
  assert.equal(said[0]!.meta.looped, "run");
  assert.match(said[1]!.content, /^Juniper began saying the same thing over and over \("The codebase includes .*", 5 times\), so the reply was stopped there\.$/);
  assert.ok(h.home.events.ofType("trace.step").some((e) => e.data.kind === "looped"), "in the trace");
});

test(`the same call, unchanged, is said to the model from its second run, and the ${REPEAT_LIMIT}th ends the turn; different calls never are`, async (t) => {
  const same = { name: "list_files", args: { path: "." } };
  const h = await agentHome(t, [{ calls: [same] }, { calls: [same] }, { calls: [same] }, { calls: [same] }, { chunks: ["never asked"] }], { agent: { decide: () => "allow" } });
  h.home.inbox.send("juniper", "chat:1", "what's here?");
  await h.home.inbox.idle();
  const results = h.home.conversations.list("chat:1").filter((m) => m.role === "tool").map((m) => m.content);
  assert.equal(results.length, 4);
  assert.ok(!results[0]!.includes("REPEATED CALL"), "the first is just its answer");
  assert.match(results[1]!, /--- REPEATED CALL \(2x\) ---/);
  assert.match(results[2]!, /--- REPEATED CALL \(3x\) ---/);
  assert.equal(h.model.agent.length, 4, "the fourth ended the turn: no fifth request");
  const notice = h.home.conversations.list("chat:1").findLast((m) => m.role === "notice");
  assert.match(notice!.content, /^Juniper tried to .+ 4 times and got the same result each time, so there was nothing more to learn from it and the turn stopped there\. Say what to try instead\.$/);
  // control: four different calls run on
  const k = await agentHome(t, ["a", "b", "c", "d"].map((p) => ({ calls: [{ name: "list_files", args: { path: p } }] })).concat([{ chunks: ["done"] } as never]), { agent: { decide: () => "allow" } });
  k.home.inbox.send("juniper", "chat:1", "look around");
  await k.home.inbox.idle();
  assert.ok(!k.home.conversations.list("chat:1").some((m) => m.content.includes("REPEATED CALL")));
  assert.equal(k.model.agent.length, 5, "and the turn ended by the model's own reply");
});

const PLAN = [
  "# The shop page",
  "Verified by the test under each row.",
  "### PHASE 1 — the page",
  "| # | Feature | Description | Done |",
  "|---|---------|-------------|------|",
  "| 1.1 | Header | the header file | [ ] |",
  "| 1.1_t | Tests: header | `test -f header.txt` passes | [ ] |",
  "| 1.2 | Footer | the footer file | [ ] |",
  "| 1.2_t | Tests: footer | `test -f footer.txt` passes | [ ] |",
].join("\n");

test("an orb's open rows are restated last in every request, alone with you and in a session; nothing open, nothing restated", async (t) => {
  const h = await agentHome(t, [{ chunks: ["on it"] }, { chunks: ["done"] }, { chunks: ["mine"] }]);
  const plan = h.home.plans.archive({ orb: "juniper", conversation: "chat:1", card: 1, body: PLAN, shown: PLAN, objections: [] });
  h.home.plans.mark(plan.id, "approved");
  h.home.board.open(plan.id, PLAN);
  h.home.board.start(plan.id, "1.1", "test -f header.txt");
  h.home.inbox.send("juniper", "chat:1", "go on");
  await h.home.inbox.idle();
  const last = h.model.agent[0]!.at(-1)!;
  assert.equal(last.role, "system", "last, after the conversation");
  assert.match(String(last.content), /^Your plan, restated by the home \(it is not the person speaking\):\nPlan \d+, "The shop page": 0 of 2 done\. Still open: 1\.1 Header \[~\] \(its test: `test -f header\.txt`\); 1\.2 Footer \[ \]\. You are on 1\.1\.\nDon't end your turn while one of these is open: build it, then check_row it\./);
  // all done: nothing restated
  h.home.board.record(plan.id, "1.1", true, "ok");
  h.home.board.start(plan.id, "1.2", "test -f footer.txt");
  h.home.board.record(plan.id, "1.2", true, "ok");
  h.home.inbox.send("juniper", "chat:1", "anything else?");
  await h.home.inbox.idle();
  assert.ok(!text(h.model.agent[1]!).includes("Your plan, restated"), "a finished plan is not restated");
  // a session: only the rows it holds
  h.home.inbox.addOrb("hazel", "Hazel", "frontend");
  h.home.inbox.addOrb("milo", "Milo", "frontend");
  const s = h.home.team.create("Shop", { floor: ["hazel", "milo"] });
  const p2 = h.home.plans.archive({ orb: "hazel", conversation: `team:${s.id}:floor`, card: 2, body: PLAN, shown: PLAN, objections: [] });
  h.home.plans.mark(p2.id, "approved");
  h.home.board.open(p2.id, PLAN);
  h.home.claims.claim({ session: s.id, plan: p2.id, orb: "hazel", rows: ["1.1"], paths: [] });
  h.home.claims.claim({ session: s.id, plan: p2.id, orb: "milo", rows: ["1.2"], paths: [] });
  h.home.team.say(s.id, "floor", "@Milo build yours");
  for (let i = 0; i < 40 && h.model.agent.length < 3; i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 30));
  }
  const milo = String(h.model.agent[2]!.at(-1)!.content);
  assert.match(milo, /0 of 1 of your rows done\. Still open: 1\.2 Footer \[ \]\.[\s\S]*and hand_off when all of yours are done/);
  assert.doesNotMatch(milo, /1\.1 Header/, "not another orb's rows");
});

test("on the ChatGPT plan the restatement stays last, as the developer's, never in the instructions", () => {
  const { instructions, input } = toResponsesInput([
    { role: "system", content: "WHO YOU ARE" },
    { role: "user", content: "go on" },
    { role: "assistant", content: "on it" },
    { role: "system", content: "Your plan, restated" },
  ]);
  assert.equal(instructions, "WHO YOU ARE");
  assert.deepEqual(input.at(-1), { type: "message", role: "developer", content: "Your plan, restated" });
});
