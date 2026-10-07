// PLAN 2.9_t and 5.10_t, sessions on the home, with a scripted model:
//   - What the person says goes into the tab once; the lead takes a whole turn, then each other
//     orb chimes in (no tools, what was said and agreed only), or passes; @Name gives whole turns.
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

test("the Brainstorm: your words once; the lead takes a whole turn, then each other orb chimes in by name, or passes", async (t) => {
  const h = await agentHome(t, [
    { calls: [{ name: "agree", args: { decision: "The party is Saturday, at the park" } }] }, // Hazel leads: she agrees
    { chunks: ["Saturday works, at the park."] },
    { chunks: ["Book the shelter in case it rains."] }, // Milo chimes in
    { chunks: ["pass"] }, // Pip has nothing to add
  ]);
  h.home.inbox.addOrb("hazel", "Hazel", "planning");
  h.home.inbox.addOrb("milo", "Milo", "research");
  h.home.inbox.addOrb("pip", "Pip", "writing");
  const s = h.home.team.create("A birthday party", { brainstorm: ["hazel", "milo", "pip"] });
  h.home.team.say(s.id, "brainstorm", "Plan a party for June");
  for (let i = 0; i < 40 && h.model.agent.length < 4; i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 50));
  }
  await h.home.inbox.idle();
  const conv = `team:${s.id}:brainstorm`;
  assert.deepEqual(said(h, conv), [
    "user: Plan a party for June",
    "assistant(hazel): ",
    "notice: ✓ Agreed: The party is Saturday, at the park",
    "assistant(hazel): Saturday works, at the park.",
    "assistant(milo): Book the shelter in case it rains.",
    "notice: Pip passed.",
  ]);
  assert.equal(h.model.agent.length, 4);
  const [hazel, milo, pip] = [text(h.model.agent[0]!), h.model.agent[2]!, text(h.model.agent[3]!)];
  assert.match(hazel, /You are Hazel[\s\S]*session, "A birthday party", with Milo, Pip and the person[\s\S]*the Brainstorm[\s\S]*You lead this turn/);
  assert.ok((h.model.bodies[0]!.tools as unknown[]).length > 10, "the lead has its tools");
  assert.equal(h.model.bodies[2]!.tools, undefined, "a chime-in has none");
  assert.match(text(milo), /You are Milo[\s\S]*chime in: one to three short sentences[\s\S]*reply with exactly: pass/);
  assert.doesNotMatch(text(milo), /record it with the agree tool/, "nor the tab's word about tools");
  const heard = milo.find((m) => m.role === "user" && String(m.content).startsWith("[Hazel]:"));
  assert.equal(heard?.content, "[Hazel]: Saturday works, at the park.", "Milo hears Hazel, by name");
  assert.ok(milo.some((m) => m.role === "user" && String(m.content).includes("[Agreed so far]: The party is Saturday, at the park")), "and what was agreed");
  assert.ok(!milo.some((m) => m.role === "tool" || (m.role === "assistant" && m.tool_calls)), "a chime-in reads what was said, never a call or a result");
  assert.ok(!milo.some((m) => m.role === "assistant" && String(m.content).includes("Saturday works")), "never as his own words");
  assert.match(pip, /\[Milo\]: Book the shelter/, "Pip hears Milo");
  assert.equal(h.home.conversations.list(conv).filter((m) => m.role === "user").length, 1, "the person's words, once");
});

test("@Name gives the orbs named whole turns, and only them", async (t) => {
  const h = await agentHome(t, [{ chunks: ["Here's the budget."] }, { chunks: ["And the venues."] }]);
  h.home.inbox.addOrb("hazel", "Hazel", "planning");
  h.home.inbox.addOrb("milo", "Milo", "research");
  h.home.inbox.addOrb("pip", "Pip", "writing");
  const s = h.home.team.create("A birthday party", { brainstorm: ["hazel", "milo", "pip"] });
  h.home.team.say(s.id, "brainstorm", "@Milo @Pip what do you think?");
  for (let i = 0; i < 40 && h.model.agent.length < 2; i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 50));
  }
  await h.home.inbox.idle();
  assert.equal(h.model.agent.length, 2, "Hazel was not named, and does not speak");
  for (const b of h.model.bodies) assert.ok((b.tools as unknown[]).length > 10, "each named orb has its tools: a whole turn");
  // a whole turn hears the others by name, never as its own words (the chime-in's view is its own: the first test)
  const pip = h.model.agent[1]!;
  assert.ok(pip.some((m) => m.role === "user" && m.content === "[Milo]: Here's the budget."), "Pip hears Milo, by name");
  assert.ok(!pip.some((m) => m.role === "assistant" && String(m.content).includes("Here's the budget")), "never as Pip's own words");
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
