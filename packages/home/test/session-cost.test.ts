// PLAN 5.10_t, sessions that cost little and say little (owner, 10-06, after five orbs spent a
// ChatGPT plan's limit in a quarter of an hour), on a real home with a scripted model:
//   - an approved plan's rows are dealt evenly across the team, each to who fits it among those under
//     their share; claimed for them; each other orb sent to build its own; the lead told which are its;
//   - claim_rows refuses more than an even share while others work the tab;
//   - a tool result from before the latest message to an orb reaches the model as its head only; a
//     request to another orb, or another orb's words, begin nothing;
//   - a session can be deleted: what waits is dropped, its cards put away, its chats gone;
//   - the clock is the standing context's last line; a chime-in carries the mini constitution, an
//     asked researcher its method.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Background, type ToolContext, type ToolDef } from "../src/agent/tools.ts";
import { OLD_RESULT, trimOld } from "../src/agent/conversation.ts";
import { standingContext } from "../src/agent/standing.ts";
import { MINI, SECTION_MAP } from "../src/brain/constitution.ts";
import { dealRows } from "../src/team.ts";
import type { Home } from "../src/home.ts";
import { serve } from "../src/api.ts";
import { text } from "./fakes/model.ts";
import { agentHome, tempDir } from "./helpers.ts";

const PLAN = [
  "# The shop page",
  "Verified by the test under each row. Out of scope: payments.",
  "### PHASE 1 — the page",
  "| # | Feature | Description | Done |",
  "|---|---------|-------------|------|",
  ...["header", "footer", "prices", "photos", "reviews"].flatMap((f, i) => [`| 1.${i + 1} | ${f} | the ${f} file | [ ] |`, `| 1.${i + 1}_t | Tests: ${f} | \`test -f ${f}.txt\` passes | [ ] |`]),
].join("\n");

const settle = async (h: { home: Home; model: { agent: unknown[] } }, calls: number): Promise<void> => {
  for (let i = 0; i < 60 && h.model.agent.length < calls; i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 50));
  }
  await h.home.inbox.idle();
};

test("rows are dealt evenly: the best fit first among those under their share, never more than one row apart", () => {
  const rows = ["1.1", "1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9"].map((row) => ({ row, text: row }));
  const dealt = dealRows(rows, ["ash", "ilaria", "darius", "beatrix", "tad"], () => ["ash"]); // Ash fits every row best
  assert.deepEqual(Object.values(dealt).map((r) => r.length), [2, 2, 2, 2, 1], "nine rows, five orbs: no one holds them all (10-06, Ash held nine)");
  assert.deepEqual(dealt.ash, ["1.1", "1.2"], "the best fit gets its share first");
  const fits = dealRows(rows.slice(0, 4), ["a", "b"], (t) => (t === "1.3" ? ["b"] : ["a"]));
  assert.deepEqual(fits, { a: ["1.1", "1.2"], b: ["1.3", "1.4"] });
  assert.deepEqual(Object.values(dealRows(rows.slice(0, 2), ["a", "b", "c"], () => ["c"])).map((r) => r.length), [0, 0, 2].map((n, i) => (i === 2 ? 1 : n)).map((n, i) => (i === 0 ? 1 : n)), "two rows, three orbs: one each to two of them");
});

test("a plan approved in a session: its rows dealt across the Floor and claimed, each orb sent to build its own, the lead told which are its", async (t) => {
  const h = await agentHome(t, [{ chunks: ["On my rows."] }, { chunks: ["Building mine."] }, { chunks: ["Building mine too."] }], { agent: { decide: () => "allow" } });
  for (const [id, name] of [["hazel", "Hazel"], ["milo", "Milo"], ["pip", "Pip"]] as const) h.home.inbox.addOrb(id, name, "frontend", {}, id === "hazel" ? "Senior" : "Junior");
  const s = h.home.team.create("The shop page", { brainstorm: ["hazel", "milo", "pip"], floor: ["hazel", "milo", "pip"] });
  const conversation = `team:${s.id}:brainstorm`;
  const asked = h.home.conversations.add({ conversation, orb: "hazel", role: "assistant", content: "", toolCalls: [{ id: "c1", name: "propose_plan", arguments: "{}" }] });
  const plan = h.home.plans.archive({ orb: "hazel", conversation, card: 1, body: PLAN, shown: PLAN, objections: [] });
  const card = h.home.conversations.addCard({ conversation, orb: "hazel", run: 1, kind: "plan", tool: "propose_plan", callId: "c1", assistantMsg: asked.id, title: "The shop page", detail: PLAN, meta: { plan: plan.id } });
  h.home.answerCard(card.id, "approve");
  await settle(h, 3);
  const held = Object.fromEntries(h.home.claims.live(s.id).map((c) => [c.orb, c.rows]));
  assert.deepEqual(Object.values(held).map((r) => r.length).sort(), [1, 2, 2], "five rows, three orbs: 2, 2 and 1");
  assert.deepEqual(Object.values(held).flat().sort(), ["1.1", "1.2", "1.3", "1.4", "1.5"], "every row dealt, once");
  const floor = h.home.conversations.list(`team:${s.id}:floor`);
  assert.ok(floor.some((m) => m.role === "notice" && /rows, dealt evenly: Hazel .*; Milo .*; Pip /.test(m.content)), "the deal is said on the Floor");
  assert.ok(floor.some((m) => m.role === "user" && m.orb === "milo" && m.content.includes(`Your rows of plan ${plan.id}: ${held.milo!.join(", ")}`)), "Milo is sent to build his");
  const resumed = h.home.conversations.list(conversation).find((m) => m.role === "tool" && m.toolCallId === "c1")?.content ?? "";
  assert.match(resumed, new RegExp(`Yours are ${held.hazel!.join(", ").replace(/\./g, "\\.")}: build only those`), "the lead builds only its own");
  assert.match(resumed, /Milo .*; Pip /);
  const work = h.model.agent.map(text).find((x) => x.includes("You are Milo"));
  assert.match(work ?? "", /These rows of the approved plan are yours, dealt evenly/);
});

/** A tool of the home's, run as `orb` in a session's tab, the way the loop would. */
function run(home: Home, name: string, orb: string, conversation: string): (a: Record<string, unknown>) => Promise<string> {
  const def = home.agent!.toolNamed(name) as ToolDef & { run: NonNullable<ToolDef["run"]> };
  const workspace = home.workspaceFor(orb, conversation);
  mkdirSync(workspace, { recursive: true });
  const ctx: ToolContext = { orb, conversation, workspace, background: new Background(), depth: 0, note: () => {} };
  return async (a) => (await def.run(a, ctx)).content;
}

test("claim_rows refuses more than an even share while others work the tab", async (t) => {
  const { home } = await agentHome(t, [], { agent: { decide: () => "allow" } });
  for (const id of ["ash", "ilaria", "darius"]) home.inbox.addOrb(id, id[0]!.toUpperCase() + id.slice(1), "frontend");
  const s = home.team.create("Mystery night", { floor: ["ash", "ilaria", "darius"] });
  const conversation = `team:${s.id}:floor`;
  const plan = home.plans.archive({ orb: "ash", conversation, card: 1, body: PLAN, shown: PLAN, objections: [] });
  home.board.open(plan.id, PLAN);
  const claim = run(home, "claim_rows", "ash", conversation);
  assert.match(await claim({ plan: plan.id, rows: ["1.1", "1.2", "1.3", "1.4", "1.5"] }), /more than your share: 5 open rows and 3 orbs here, so 2 each/, "all five: refused (10-06, Ash took all nine)");
  assert.match(await claim({ plan: plan.id, rows: ["1.1", "1.2"] }), /Yours: rows 1\.1, 1\.2/, "an even share is his");
  assert.match(await claim({ plan: plan.id, rows: ["1.3"] }), /Claim at most 0 more/, "and no more on top of it");
  home.board.start(plan.id, "1.1", "test -f header.txt");
  home.board.record(plan.id, "1.1", true, "passed");
  // with 1.1 done, four rows are open: still two each, so 1.3 joins 1.2
  assert.match(await claim({ plan: plan.id, rows: ["1.3"] }), /Yours: rows 1\.1, 1\.2, 1\.3/, "a row done frees its place in the share");
  const alone = home.team.create("Alone", { floor: ["ash"] });
  const solo = `team:${alone.id}:floor`;
  const plan2 = home.plans.archive({ orb: "ash", conversation: solo, card: 2, body: PLAN, shown: PLAN, objections: [] });
  home.board.open(plan2.id, PLAN);
  assert.match(await run(home, "claim_rows", "ash", solo)({ plan: plan2.id, rows: ["1.1", "1.2", "1.3", "1.4", "1.5"] }), /Yours/, "working alone, every row is his");
});

test("an earlier turn's tool results reach the model as their head; this turn's whole; another orb's request begins nothing", async (t) => {
  const { home } = await agentHome(t, []);
  const c = home.conversations;
  const conv = "team:9:brainstorm";
  const page = "x".repeat(5000);
  c.add({ conversation: conv, orb: "ash", role: "user", content: "Research it" });
  c.add({ conversation: conv, orb: "ash", role: "assistant", content: "", toolCalls: [{ id: "a1", name: "web_fetch", arguments: "{}" }] });
  c.add({ conversation: conv, orb: "ash", role: "tool", toolCallId: "a1", content: page });
  c.add({ conversation: conv, orb: "ash", role: "assistant", content: "Found it." });
  c.add({ conversation: conv, orb: "ash", role: "user", content: "Now the prices" });
  c.add({ conversation: conv, orb: "ash", role: "assistant", content: "", toolCalls: [{ id: "a2", name: "web_fetch", arguments: "{}" }] });
  c.add({ conversation: conv, orb: "ash", role: "tool", toolCallId: "a2", content: page });
  c.add({ conversation: conv, orb: "milo", role: "user", content: "[Ash asks Milo]: check the venue", meta: { asked: "milo" } });
  c.add({ conversation: conv, orb: "milo", role: "assistant", content: "On it." });
  const seen = c.toModel(c.history(conv), { me: "ash", nameOf: (o) => o });
  const results = seen.filter((m) => m.role === "tool").map((m) => m.content);
  assert.equal(results[0], trimOld(page), "the earlier turn's page: its head");
  assert.ok(results[0]!.length < OLD_RESULT + 200 && /4,400 more characters, from an earlier turn: run the tool again/.test(results[0]!));
  assert.equal(results[1], page, "this turn's page, whole, though Milo was asked and answered since");
  assert.equal(trimOld("short"), "short", "a short result is left as it is");
  const milo = c.toModel(c.history(conv), { me: "milo", nameOf: (o) => o });
  assert.ok(!milo.some((m) => m.role === "tool"), "Milo never sees Ash's results");
});

test("deleting a session stops its work, puts its cards away and removes its chats; the door says so", async (t) => {
  const h = await agentHome(t, [{ chunks: ["slow"], hang: true }], { agent: { decide: () => "allow" } });
  h.home.inbox.addOrb("hazel", "Hazel", "planning");
  h.home.inbox.addOrb("milo", "Milo", "research");
  const s = h.home.team.create("A party", { brainstorm: ["hazel", "milo"] });
  const keep = h.home.team.create("Keep me", { brainstorm: ["hazel"] });
  const conv = `team:${s.id}:brainstorm`;
  h.home.team.say(s.id, "brainstorm", "Plan it");
  for (let i = 0; i < 60 && h.model.agent.length < 1; i++) await new Promise((r) => setTimeout(r, 50)); // Hazel's reply is under way, and holds
  assert.equal(h.home.inbox.open(conv), 1, "Hazel at work; Milo's turn comes when hers ends");
  const msg = h.home.conversations.add({ conversation: conv, orb: "hazel", role: "assistant", content: "", toolCalls: [{ id: "q", name: "shell", arguments: "{}" }] });
  const card = h.home.conversations.addCard({ conversation: conv, orb: "hazel", run: 1, kind: "approval", tool: "shell", callId: "q", assistantMsg: msg.id, title: "Run it?", detail: "" });
  await h.home.team.remove(s.id);
  assert.deepEqual(h.home.team.list().map((x) => x.id), [keep.id], "gone from the list");
  assert.equal(h.home.conversations.list(conv).length, 0, "its chat is gone");
  assert.equal(h.home.conversations.card(card.id)?.status, "expired", "its card is put away");
  assert.ok(!h.home.conversations.pendingCards().some((c) => c.id === card.id), "and no longer waits in the notifications");
  assert.equal(h.home.inbox.open(conv), 0, "nothing waits or runs in it");
  assert.equal(h.model.agent.length, 1, "Milo's turn never started");
  await assert.rejects(h.home.team.remove(s.id), /no session/);
  // the door: DELETE /sessions/<id>, and a session that is not there is a 404
  const d = await serve(h.home, { port: 0 });
  t.after(() => d.close());
  const del = (id: number) => fetch(`http://127.0.0.1:${d.port}/sessions/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${d.token}` } });
  assert.equal((await del(keep.id)).status, 200);
  assert.deepEqual(h.home.team.list(), []);
  assert.equal((await del(keep.id)).status, 404);
});

test("the clock is the standing context's last line; a chime-in carries the mini constitution, an asked researcher its method", (t) => {
  const dir = tempDir(t);
  const brain = join(dir, "brain");
  mkdirSync(brain, { recursive: true });
  // a stand-in shaped like the owner's file: a section per heading, its key written in it
  const keys = ["title", ...Object.keys(SECTION_MAP).filter((k) => k !== "title")];
  writeFileSync(join(brain, "CONSTITUTION.md"), keys.map((k, i) => `${i === 0 ? "#" : "##"} ${k === "title" ? "Serge — System Prompt" : k.replace(/_/g, " ")}\nSECTION-${k}\n`).join("\n"));
  const team = { session: 1, title: "x", tab: "brainstorm" as const, with: ["Milo", "Pip"] };
  const now = new Date(2026, 9, 6, 17, 4).getTime();
  const lead = standingContext({ orbName: "Milo", brainDir: brain, workspace: "/w", specialty: "research", team: { ...team, role: "lead" }, now });
  const chime = standingContext({ orbName: "Milo", brainDir: brain, workspace: "/w", specialty: "research", team: { ...team, role: "chime" }, now });
  const asked = standingContext({ orbName: "Milo", brainDir: brain, workspace: "/w", specialty: "research", team: { ...team, role: "asked" }, now });
  for (const s of [lead, chime, asked]) assert.match(s.split("\n\n").at(-1)!, /^It is Tuesday, 6 October 2026 at 17:04/, "the clock last: what comes before it is the same from step to step");
  const loaded = (s: string): string[] => keys.filter((k) => s.includes(`SECTION-${k}\n`) || s.endsWith(`SECTION-${k}`) || s.includes(`SECTION-${k}`));
  assert.deepEqual(loaded(chime).sort(), [...MINI].sort(), "a chime-in: the mini constitution, and nothing more");
  for (const k of MINI) assert.equal(SECTION_MAP[k]?.to, "core", `${k} is a core section`);
  assert.ok(loaded(lead).length > MINI.length + 4, "the lead: the big one, its specialty's sections too");
  assert.match(asked, /## How you research/, "an asked researcher: its method");
  assert.doesNotMatch(chime, /## How you research/);
});

test("an orb another asked reads its request, what was agreed and the last few lines, not the whole session (Ash's subagents: only the brief)", async (t) => {
  const { home } = await agentHome(t, []);
  const c = home.conversations;
  const conv = "team:7:brainstorm";
  c.add({ conversation: conv, orb: "ash", role: "user", content: "Let's plan the launch" });
  for (let i = 0; i < 12; i++) c.add({ conversation: conv, orb: i % 2 ? "ash" : "ilaria", role: "assistant", content: `idea ${i}` });
  c.add({ conversation: conv, orb: "ash", role: "assistant", content: "", toolCalls: [{ id: "w1", name: "web_fetch", arguments: "{}" }] });
  c.add({ conversation: conv, orb: "ash", role: "tool", toolCallId: "w1", content: "PAGE ".repeat(500) });
  c.add({ conversation: conv, orb: "ash", role: "notice", content: "✓ Agreed: launch in May", meta: { agreed: "launch in May" } });
  c.add({ conversation: conv, orb: "beatrix", role: "user", content: "[Ash asks Beatrix]: price three rivals", meta: { asked: "beatrix" } });
  c.add({ conversation: conv, orb: "beatrix", role: "assistant", content: "", toolCalls: [{ id: "b1", name: "web_search", arguments: "{}" }] });
  c.add({ conversation: conv, orb: "beatrix", role: "tool", toolCallId: "b1", content: "RESULTS ".repeat(300) });
  const seen = c.toModel(c.history(conv), { me: "beatrix", nameOf: (o) => o, brief: true });
  const said = seen.map((m) => String(m.content ?? ""));
  assert.ok(said.some((x) => x.includes("[Agreed so far]: launch in May")), "what was agreed");
  assert.ok(!said.some((x) => x.includes("idea 0") || x.includes("idea 3")), "not the whole brainstorm");
  assert.ok(said.some((x) => x.includes("idea 11")), "the last few lines of it");
  assert.ok(!said.some((x) => x.includes("PAGE")), "no other orb's results");
  assert.equal(said.filter((x) => x.includes("[Ash asks Beatrix]: price three rivals")).length, 1, "the request, once");
  assert.ok(seen.some((m) => m.role === "tool" && String(m.content).startsWith("RESULTS")), "its own work on it, whole");
  assert.ok(said.indexOf(said.find((x) => x.includes("price three rivals"))!) > said.indexOf(said.find((x) => x.includes("idea 11"))!), "in order");
});

test("at most two orbs of a tab work on asks at once; a third is told to wait or do it", async (t) => {
  const h = await agentHome(t, [{ chunks: ["…"], hang: true }, { chunks: ["…"], hang: true }], { agent: { decide: () => "allow" } });
  for (const id of ["ash", "ilaria", "darius", "beatrix"]) h.home.inbox.addOrb(id, id[0]!.toUpperCase() + id.slice(1), "research");
  const s = h.home.team.create("Research", { brainstorm: ["ash", "ilaria", "darius", "beatrix"] });
  h.home.team.ask(s.id, "brainstorm", "ash", "ilaria", "find A", 1);
  h.home.team.ask(s.id, "brainstorm", "ash", "darius", "find B", 1);
  assert.throws(() => h.home.team.ask(s.id, "brainstorm", "ash", "beatrix", "find C", 1), /Not asked: Ilaria and Darius are already working on asks here/);
  h.home.team.ask(s.id, "brainstorm", "ash", "ilaria", "and D", 1); // one already at work may be asked more
  const run = h.home.agent!.toolNamed("ask_orb") as { run: (a: Record<string, unknown>, ctx: unknown) => Promise<{ content: string; isError?: boolean }> };
  const r = await run.run({ to: "Beatrix", request: "find C" }, { orb: "ash", conversation: `team:${s.id}:brainstorm`, workspace: "/tmp", depth: 0 });
  assert.deepEqual([r.isError, /already working on asks/.test(r.content)], [true, true], "the tool says so to the orb that asked");
  await h.home.team.remove(s.id); // ends the held runs
});
