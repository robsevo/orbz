// PLAN 2.9_t, sessions on the home, with a scripted model:
//   - What the person says goes into the tab once, and each of the tab's orbs takes a turn, in
//     order.
//   - The second orb sees the first one's words as his, by name, never as his own.
//   - Each is told who he is with, and what the tab is for.
//   - A decision is recorded for everyone as "✓ Agreed".
//   - A round waits while an orb waits on the person's OK, and goes on once it is given.
//   - A session's turn is attended (your words in a tab): your rules decide, as in a chat.
//   - Only orbs in the office can be brought in; a tab with no one in it says so.
import assert from "node:assert/strict";
import { test } from "node:test";
import { text } from "./fakes/model.ts";
import { agentHome } from "./helpers.ts";

const said = (h: Awaited<ReturnType<typeof agentHome>>, conv: string) =>
  h.home.conversations.list(conv).filter((m) => m.role !== "tool").map((m) => `${m.role}${m.role === "assistant" ? `(${m.orb})` : ""}: ${m.content}`);

test("the Brainstorm: your words once, each orb a turn in order, each hearing the others by name, a decision agreed", async (t) => {
  const h = await agentHome(t, [
    { chunks: ["Saturday works, at the park."] }, // Hazel's turn
    { calls: [{ name: "agree", args: { decision: "The party is Saturday, at the park" } }] }, // Milo's turn: he agrees
    { chunks: ["Agreed: Saturday at the park."] },
  ]);
  h.home.inbox.addOrb("hazel", "Hazel", "planning");
  h.home.inbox.addOrb("milo", "Milo", "research");
  const s = h.home.team.create("A birthday party", { brainstorm: ["hazel", "milo"] });
  h.home.team.say(s.id, "brainstorm", "Plan a party for June");
  await h.home.inbox.idle();
  await new Promise((r) => setTimeout(r, 200));
  await h.home.inbox.idle();
  const conv = `team:${s.id}:brainstorm`;
  assert.deepEqual(said(h, conv), [
    "user: Plan a party for June",
    "assistant(hazel): Saturday works, at the park.",
    "assistant(milo): ",
    "notice: ✓ Agreed: The party is Saturday, at the park",
    "assistant(milo): Agreed: Saturday at the park.",
  ]);
  assert.equal(h.model.agent.length, 3);
  const [hazel, milo] = [text(h.model.agent[0]!), h.model.agent[1]!];
  assert.match(hazel, /You are Hazel[\s\S]*session, "A birthday party", with Milo and the person[\s\S]*the Brainstorm/);
  const heard = milo.find((m) => m.role === "user" && String(m.content).startsWith("[Hazel]:"));
  assert.equal(heard?.content, "[Hazel]: Saturday works, at the park.", "Milo hears Hazel, by name");
  assert.ok(!milo.some((m) => m.role === "assistant" && String(m.content).includes("Saturday works")), "never as his own words");
  assert.match(text(milo), /You are Milo/);
  assert.equal(h.home.conversations.list(conv).filter((m) => m.role === "user").length, 1, "the person's words, once");
});

test("a round waits while an orb waits on your OK, and goes on once you give it", async (t) => {
  const h = await agentHome(t, [
    { calls: [{ name: "shell", args: { command: "echo floor-work" } }] }, // Gus's turn: a command, which asks
    { chunks: ["Built it."] },
    { chunks: ["Tested it."] }, // Nico's turn, only after Gus's is done
  ], { agent: { decide: (def) => (def.name === "shell" ? "ask" : "allow") } });
  h.home.inbox.addOrb("gus", "Gus", "devops");
  h.home.inbox.addOrb("nico", "Nico", "testing");
  const s = h.home.team.create("Ship the site", { floor: ["gus", "nico"] });
  h.home.team.say(s.id, "floor", "Build and test it");
  await h.home.inbox.idle();
  const conv = `team:${s.id}:floor`;
  const card = h.home.conversations.openCard(conv);
  assert.ok(card, "Gus waits on a card");
  assert.equal(h.model.agent.length, 1, "and Nico has not started: the round waits");
  h.home.answerCard(card!.id, "approve");
  for (let i = 0; i < 20 && h.model.agent.length < 3; i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.deepEqual(said(h, conv).filter((l) => l.startsWith("assistant") && !l.endsWith(": ")), ["assistant(gus): Built it.", "assistant(nico): Tested it."]);
  assert.match(text(h.model.agent[2]!), /\[Gus\]: Built it\./, "Nico hears what Gus did");
});

test("a session's turn is attended: your words in a tab, so your rules decide, as in a chat", async (t) => {
  const h = await agentHome(t, [
    { calls: [{ name: "shell", args: { command: "echo attended" } }] },
    { chunks: ["Ran it."] },
  ], { agent: { decide: () => "allow" } });
  h.home.inbox.addOrb("gus", "Gus", "devops");
  const s = h.home.team.create("Ship it", { floor: ["gus"] });
  h.home.team.say(s.id, "floor", "Run it");
  for (let i = 0; i < 20 && h.model.agent.length < 2; i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 50));
  }
  const conv = `team:${s.id}:floor`;
  assert.equal(h.home.conversations.openCard(conv), undefined, "no card: your rules allow it, and you are there");
  assert.ok(h.home.conversations.list(conv).some((m) => m.role === "tool" && m.content.includes("attended")), "it ran");
});

test("only orbs in the office can be brought in, and a tab with no one in it says so", async (t) => {
  const h = await agentHome(t, []);
  h.home.inbox.addOrb("ada", "Ada", "accountant");
  assert.throws(() => h.home.team.create("Taxes", { brainstorm: ["nobody"] }), /not in the office/);
  h.home.inbox.letGo("ada");
  assert.throws(() => h.home.team.create("Taxes", { floor: ["ada"] }), /not in the office/, "one let go is not");
  const s = h.home.team.create("Taxes");
  assert.throws(() => h.home.team.say(s.id, "brainstorm", "hello"), /no orb works this session's brainstorm yet/);
  assert.deepEqual(h.home.team.list().map((x) => x.title), ["Taxes"]);
});
