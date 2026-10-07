// PLAN 2.13_t, the lab on the home:
//   - Every session's brainstorm (what was agreed, who was in it, its last words) and every plan
//     shown (1.7's archive) is in it, newest first, a plan with its rows and how far along it is
//     (1.8's board).
//   - A word in a plan's rows finds it; a word agreed in a brainstorm finds that.
//   - What one orb agreed reaches the others in the tab.
//   - A brainstorm reopened is a new session whose orbs are told what was agreed and where it was left.
//   - Through the door.
import assert from "node:assert/strict";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { labOf, reopen } from "../src/lab.ts";
import { text } from "./fakes/model.ts";
import { agentHome } from "./helpers.ts";

const PLAN = [
  "# The party",
  "",
  "Verified by the tests under each row. Out of scope: anything not listed.",
  "",
  "### PHASE 1 — the work",
  "",
  "| # | Feature | Description | Done |",
  "|---|---------|-------------|------|",
  "| 1.1 | Invitations | send the invitations | [ ] |",
  "| 1.1_t | Tests: invitations | every guest has one | [ ] |",
  "| 1.2 | Bunting | hang the bunting in the park | [ ] |",
  "| 1.2_t | Tests: bunting | it is up by noon | [ ] |",
].join("\n");

async function party(t: Parameters<typeof agentHome>[0], more: { chunks?: string[] }[] = []) {
  const h = await agentHome(t, [
    { calls: [{ name: "agree", args: { decision: "Saturday, at the park" } }] }, // Hazel leads, and records it (PLAN 5.10)
    { chunks: ["Saturday works, at the park."] },
    { chunks: ["Agreed: Saturday."] }, // Milo chimes in
    ...more,
  ]);
  h.home.inbox.addOrb("hazel", "Hazel", "planning");
  h.home.inbox.addOrb("milo", "Milo", "research");
  const s = h.home.team.create("A birthday party", { brainstorm: ["hazel", "milo"], floor: ["hazel"] });
  h.home.team.say(s.id, "brainstorm", "Plan a party for June");
  for (let i = 0; i < 30 && h.model.agent.length < 3; i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 30));
  }
  await h.home.inbox.idle();
  const plan = h.home.plans.archive({ orb: "hazel", conversation: `team:${s.id}:floor`, card: 0, body: PLAN, shown: PLAN, objections: [] });
  h.home.plans.mark(plan.id, "approved");
  h.home.board.open(plan.id, PLAN);
  h.home.board.record(plan.id, "1.1", true, "every guest has one: 12 of 12");
  return { ...h, session: s, plan };
}

test("every brainstorm and every plan shown is in the lab: what was agreed, the rows, how far along", async (t) => {
  const h = await party(t);
  const lab = labOf(h.home);
  assert.deepEqual(lab.sessions.map((s) => [s.title, s.members, s.agreed, s.lastWords, s.plans]), [["A birthday party", ["hazel", "milo"], ["Saturday, at the park"], "Agreed: Saturday.", [h.plan.id]]]);
  const p = lab.plans[0]!;
  assert.deepEqual([p.title, p.orb, p.session, p.status, p.done, p.total], ["The party", "hazel", h.session.id, "approved", 1, 2]);
  assert.deepEqual(p.rows.map((r) => [r.id, r.box]), [["1.1", "[x]"], ["1.1_t", "[x]"], ["1.2", "[ ]"], ["1.2_t", "[ ]"]], "the board's boxes, not the frozen text's");
  // a word in its rows
  assert.deepEqual(labOf(h.home, "BUNTING").plans.map((x) => x.title), ["The party"]);
  assert.deepEqual(labOf(h.home, "bunting").sessions, [], "and only what has it");
  assert.deepEqual(labOf(h.home, "saturday").sessions.map((s) => s.title), ["A birthday party"]);
  assert.deepEqual(labOf(h.home, "fireworks"), { sessions: [], plans: [] });
});

test("what one orb agreed reaches the others; a brainstorm reopened is a session whose orbs know it", async (t) => {
  const h = await party(t, [{ chunks: ["Where were we? Saturday, at the park."] }, { chunks: ["Yes."] }]);
  const s2 = reopen(h.home, h.session.id);
  assert.equal(s2.title, "A birthday party (reopened)");
  assert.deepEqual([s2.brainstorm, s2.floor], [["hazel", "milo"], ["hazel"]], "the same orbs");
  h.home.team.say(s2.id, "brainstorm", "Let's pick it up again");
  for (let i = 0; i < 30 && h.model.agent.length < 5; i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 30));
  }
  const hazel = text(h.model.agent[3]!);
  assert.match(hazel, /Summary of the earlier conversation:[\s\S]*"A birthday party", reopened[\s\S]*What was agreed then:\n- Saturday, at the park[\s\S]*Where it was left: Agreed: Saturday\./);
  assert.throws(() => reopen(h.home, 99), /no session 99/);
  // Milo, named, agreed; Hazel heard it on her next turn, as agreed, by no one's mouth
  const later = await agentHome(t, [
    { calls: [{ name: "agree", args: { decision: "Saturday, at the park" } }] }, // @Milo: a whole turn, his tools with it
    { chunks: ["Agreed."] },
    { chunks: ["Then I'll book the park."] }, // Hazel leads the next
    { chunks: ["Good."] }, // Milo chimes in
  ]);
  later.home.inbox.addOrb("hazel", "Hazel", "planning");
  later.home.inbox.addOrb("milo", "Milo", "research");
  const s = later.home.team.create("Party", { brainstorm: ["hazel", "milo"] });
  later.home.team.say(s.id, "brainstorm", "@Milo when?");
  for (let i = 0; i < 30 && later.model.agent.length < 2; i++) {
    await later.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 30));
  }
  later.home.team.say(s.id, "brainstorm", "Who books it?");
  for (let i = 0; i < 30 && later.model.agent.length < 3; i++) {
    await later.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 30));
  }
  const heard = later.model.agent[2]!.filter((m) => m.role === "user").map((m) => String(m.content));
  assert.ok(heard.includes("[Agreed]: Saturday, at the park"), `Hazel hears what Milo agreed (${heard.join(" | ")})`);
});

test("through the door: the lab, a search, a brainstorm reopened", async (t) => {
  const h = await party(t);
  const door = await serve(h.home, { port: 0 });
  t.after(() => door.close());
  const call = async (method: string, path: string) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${path}`, { method, headers: { authorization: `Bearer ${door.token}` } });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  const all = (await call("GET", "/lab")).json as { sessions: { title: string }[]; plans: { title: string; done: number; total: number }[] };
  assert.deepEqual([all.sessions.length, all.plans.map((p) => [p.title, p.done, p.total])], [1, [["The party", 1, 2]]]);
  assert.deepEqual(((await call("GET", "/lab?q=bunting")).json.plans as unknown[]).length, 1);
  const r = await call("POST", `/lab/sessions/${h.session.id}/reopen`);
  assert.equal(r.status, 200);
  assert.equal((r.json.session as { title: string }).title, "A birthday party (reopened)");
  assert.equal((await call("POST", "/lab/sessions/99/reopen")).status, 404);
});
