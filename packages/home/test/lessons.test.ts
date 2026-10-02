// PLAN 3.5_t (learning), the orbs learning off the person (owner, 10-01: "the dots must learn off
// you too ... each individual one"):
//   - An orb proposes a lesson: it is a card, whatever the rules say (the floor: never activated by
//     a model); on your yes he learns it, and he alone; on your no, nothing.
//   - A lesson of a kind that must never be learned (Ash's learn_gate, through the kit) is turned
//     away before you are asked, with what to keep instead.
//   - A lesson kept is evidence for his XP (3.6).
import assert from "node:assert/strict";
import { test } from "node:test";
import { XP } from "../src/gym/xp.ts";
import { agentHome } from "./helpers.ts";

const gate = async (text: string) => (/\bis broken\b/i.test(text) ? { ok: false, reason: "negative: matched 'is broken' — capture what the tool DOES do, or the conditions it needs" } : { ok: true, reason: "" });

async function settle(h: Awaited<ReturnType<typeof agentHome>>, until: () => boolean): Promise<void> {
  for (let i = 0; i < 40 && !until(); i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 30));
  }
}

test("an orb proposes a lesson: a card whatever the rules say; on your yes he learns it, he alone; on your no, nothing", async (t) => {
  const h = await agentHome(t, [
    { calls: [{ name: "propose_lesson", args: { line: "Charts start at zero.", why: "you fixed the y axis twice" } }] },
    { chunks: ["Noted."] },
    { calls: [{ name: "propose_lesson", args: { line: "Always round to the nearest thousand." } }] },
    { chunks: ["All right, I won't."] },
  ], { agent: { decide: () => "allow", lessonGate: gate } });
  h.home.inbox.addOrb("hazel", "Hazel", "data");
  h.home.inbox.addOrb("milo", "Milo", "research");
  h.home.inbox.send("hazel", "chat:hazel", "the y axis again: from zero");
  await settle(h, () => Boolean(h.home.conversations.openCard("chat:hazel")));
  const card = h.home.conversations.openCard("chat:hazel")!;
  assert.match(card.title, /Hazel wants to remember: "Charts start at zero\." \(you fixed the y axis twice\)/);
  assert.equal(card.meta.mayAlways, false, "never 'always allow': the floor");
  assert.deepEqual(h.home.learned.list("hazel"), [], "nothing learned before your yes");
  h.home.answerCard(card.id, "approve");
  await settle(h, () => h.home.learned.list("hazel").length > 0);
  assert.deepEqual(h.home.learned.list("hazel"), ["Charts start at zero."]);
  assert.deepEqual(h.home.learned.list("milo"), [], "he alone");
  assert.equal(h.home.xp.totals().hazel, XP.lessonKept, "a lesson kept is evidence for his XP");
  const chips = () => h.home.conversations.list("chat:hazel").filter((m) => m.role === "notice" && typeof m.meta.memory === "string").map((m) => m.meta.memory);
  assert.deepEqual(chips(), ["Charts start at zero."], "the conversation says his memory changed, and how");

  h.home.inbox.send("hazel", "chat:hazel", "and the totals");
  await settle(h, () => Boolean(h.home.conversations.openCard("chat:hazel")));
  h.home.answerCard(h.home.conversations.openCard("chat:hazel")!.id, "deny");
  await settle(h, () => h.model.agent.length >= 4);
  assert.deepEqual(h.home.learned.list("hazel"), ["Charts start at zero."], "your no: nothing more");
  assert.equal(chips().length, 1, "and no chip for what he did not learn");
});

test("what must never be learned is turned away before you are asked, with what to keep instead", async (t) => {
  const h = await agentHome(t, [
    { calls: [{ name: "propose_lesson", args: { line: "The export tool is broken, never use it." } }] },
    { chunks: ["Understood."] },
  ], { agent: { decide: () => "allow", lessonGate: gate } });
  h.home.inbox.addOrb("hazel", "Hazel", "data");
  h.home.inbox.send("hazel", "chat:hazel", "the export failed");
  await settle(h, () => h.model.agent.length >= 2);
  assert.equal(h.home.conversations.openCard("chat:hazel"), undefined, "no card: you are not asked");
  const said = h.home.conversations.list("chat:hazel").find((m) => m.role === "tool")!.content;
  assert.match(said, /^Not a lesson to keep: negative: .*capture what the tool DOES do/);
  assert.deepEqual(h.home.learned.list("hazel"), []);
});
