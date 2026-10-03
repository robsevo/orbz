// PLAN 5.1_t and 5.2_t, the team on its plan's board, on a real home:
//   - two orbs never hold the same row or the same file (a folder holds what is in it); a claim
//     silent for 90 minutes is stale and can be recovered; what the table holds is what the log
//     replays to;
//   - a hand-off records what changed (the files he touched since he claimed), which tests ran for
//     his rows and the next row nobody holds;
//   - an AGREED change needs a second, another orb or you, and appears as a row change on the board;
//   - a request of a request goes two hands deep, never three; "@Milo" gives the turn to Milo alone,
//     and the lead speaks first;
//   - a file another orb claimed is refused to a write, naming him;
//   - a junior's passing row waits for a review by the Senior of his kind (or you), never by a
//     Senior of another kind while one of his is in the office (owner, 10-02);
//   - the chatter is the board's, written by code: an unwatched job spends nothing on it.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { Background, type ToolContext, type ToolDef } from "../src/agent/tools.ts";
import { replayClaims } from "../src/claims.ts";
import { reviewerProblem } from "../src/plans/board.ts";
import { serve } from "../src/api.ts";
import type { Home } from "../src/home.ts";
import { agentHome } from "./helpers.ts";

const PLAN = [
  "# The shop page",
  "Verified by the test under each row. Out of scope: payments.",
  "### PHASE 1 — the page",
  "| # | Feature | Description | Done |",
  "|---|---------|-------------|------|",
  "| 1.1 | Header | the header file | [ ] |",
  "| 1.1_t | Tests: header | `test -f header.txt` passes | [ ] |",
  "| 1.2 | Footer | the footer file | [ ] |",
  "| 1.2_t | Tests: footer | `test -f footer.txt` passes | [ ] |",
  "| 1.3 | Prices | the prices file | [ ] |",
  "| 1.3_t | Tests: prices | `test -f prices.txt` passes | [ ] |",
].join("\n");

/** A home with a session (Hazel and Milo on its floor) and an approved plan of three rows. */
async function team(t: Parameters<typeof agentHome>[0], o: { clock?: FakeClock; levels?: Record<string, "Junior" | "Senior"> } = {}) {
  const { home } = await agentHome(t, [], { ...(o.clock && { clock: o.clock }), agent: { decide: () => "allow" } });
  home.inbox.addOrb("hazel", "Hazel", "frontend", {}, o.levels?.hazel ?? "Senior");
  home.inbox.addOrb("milo", "Milo", "frontend", {}, o.levels?.milo ?? "Junior");
  const s = home.team.create("The shop page", { floor: ["hazel", "milo"] });
  const conversation = `team:${s.id}:floor`;
  const plan = home.plans.archive({ orb: "hazel", conversation, card: 1, body: PLAN, shown: PLAN, objections: [] });
  home.board.open(plan.id, PLAN);
  return { home, session: s.id, plan: plan.id, conversation };
}

/** A tool of the home's, run as `orb` in the session's floor, the way the loop would. */
function tool(home: Home, name: string): ToolDef & { run: NonNullable<ToolDef["run"]> } {
  const def = home.agent!.toolNamed(name);
  if (!def?.run) throw new Error(`no tool ${name}`);
  return def as ToolDef & { run: NonNullable<ToolDef["run"]> };
}
function ctxOf(home: Home, orb: string, conversation: string, notes: string[], depth = 0): ToolContext {
  const workspace = home.workspaceFor(orb, conversation);
  mkdirSync(workspace, { recursive: true });
  return {
    orb, conversation, workspace, background: new Background(), depth,
    note: (text) => void notes.push(text),
    heldBy: (p) => {
      const c = home.claims.holder(Number(conversation.split(":")[1]), p);
      return c && c.orb !== orb ? (home.inbox.orb(c.orb)?.name ?? c.orb) : null;
    },
  };
}

test("two orbs never hold the same row or file; a stale claim is recovered; the log replays to the table", async (t) => {
  const clock = new FakeClock(new Date(2026, 9, 2, 9, 0).getTime());
  const { home, session, plan } = await team(t, { clock });
  const c = home.claims;
  const ada = c.claim({ session, plan, orb: "hazel", rows: ["1.1"], paths: ["src/ui"] });
  assert.throws(() => c.claim({ session, plan, orb: "milo", rows: ["1.1"], paths: [] }), /row 1\.1 is hazel's/);
  assert.throws(() => c.claim({ session, plan, orb: "milo", rows: ["1.2"], paths: ["src/ui/button.tsx"] }), /meets src\/ui, which hazel holds/, "a folder holds what is in it");
  assert.throws(() => c.claim({ session, plan, orb: "milo", rows: ["1.2"], paths: ["src"] }), /meets src\/ui/, "and a folder holding his is his too");
  assert.throws(() => c.claim({ session, plan, orb: "milo", rows: ["1.2"], paths: ["../etc"] }), /not a path in the team's workspace/);
  c.claim({ session, plan, orb: "milo", rows: ["1.2"], paths: ["src/api"] });
  c.claim({ session: session + 1, plan, orb: "milo", rows: ["1.1"], paths: ["src/ui"] }); // another session is another team
  assert.equal(c.holder(session, "src/ui/x.css")?.orb, "hazel");

  clock.suspend(91 * 60_000);
  c.pulse(session, "milo"); // Milo acted; Hazel was silent
  const live = c.live(session);
  assert.deepEqual(live.map((x) => [x.orb, x.stale]), [["hazel", true], ["milo", false]]);
  assert.throws(() => c.recover(session, live[1]!.id, "hazel"), /not stale/);
  c.recover(session, ada.id, "milo");
  assert.deepEqual(c.live(session).map((x) => [x.orb, x.rows]), [["milo", ["1.1"]], ["milo", ["1.2"]]], "a stale claim taken over is his");
  const replayed = replayClaims(home.events, session).map((x) => [x.id, x.orb, x.rows, x.paths]);
  assert.deepEqual(replayed, c.live(session).map((x) => [x.id, x.orb, x.rows, x.paths]), "the board replays to the same state");
});

test("a hand-off says what changed, which tests ran and the next free row", async (t) => {
  const { home, session, plan, conversation } = await team(t);
  const notes: string[] = [];
  const hazel = ctxOf(home, "hazel", conversation, notes);
  assert.match((await tool(home, "claim_rows").run({ plan, rows: ["1.1"], paths: ["header.txt"] }, hazel)).content, /Yours: rows? 1\.1/);
  writeFileSync(join(hazel.workspace, "header.txt"), "Shop");
  writeFileSync(join(hazel.workspace, "notes.md"), "for later");
  home.board.start(plan, "1.1", "test -f header.txt");
  home.board.record(plan, "1.1", true, "passed");
  const r = await tool(home, "hand_off").run({}, hazel);
  assert.match(r.content, /Hazel handed off 1\.1: changed header\.txt, notes\.md; tests 1\.1 \[x\] \(`test -f header\.txt`\); next 1\.2\./);
  assert.equal(home.claims.live(session).length, 0, "handed off: nobody holds 1.1");
  assert.ok(notes.some((n) => /handed off/.test(n)), "the team is told, in the tab");
});

test("a write to a file another orb claimed is refused, naming him", async (t) => {
  const { home, session, plan, conversation } = await team(t);
  home.claims.claim({ session, plan, orb: "hazel", rows: ["1.1"], paths: ["header.txt"] });
  const write = tool(home, "write_file");
  const milo = ctxOf(home, "milo", conversation, []);
  assert.match(write.precheck?.({ path: "header.txt", content: "x" }, milo) ?? "", /header\.txt is Hazel's/);
  assert.equal(write.precheck?.({ path: "footer.txt", content: "x" }, milo) ?? null, null, "a file nobody holds is his to write");
  assert.equal(write.precheck?.({ path: "header.txt", content: "x" }, ctxOf(home, "hazel", conversation, [])) ?? null, null, "and hers is hers");
});

test("an agreed change needs a second, another orb or you, and the board then has its rows", async (t) => {
  const { home, plan, conversation } = await team(t);
  const notes: string[] = [];
  const r = await tool(home, "propose_change").run({ plan, row: "1.4", feature: "Sale banner", description: "a banner for the sale", test: "`test -f sale.txt` passes" }, ctxOf(home, "milo", conversation, notes));
  assert.match(r.content, /Proposed as change (\d+)/);
  const id = Number(/change (\d+)/.exec(r.content)![1]);
  const alone = await tool(home, "agree_change").run({ id }, ctxOf(home, "milo", conversation, notes));
  assert.equal(alone.isError, true);
  assert.match(alone.content, /needs a second/, "the one who proposed it cannot be its second");
  assert.ok(!home.board.rows(plan).some((x) => x.row === "1.4"), "one orb alone changes nothing");
  await tool(home, "agree_change").run({ id }, ctxOf(home, "hazel", conversation, notes));
  assert.deepEqual(home.board.rows(plan).filter((x) => x.row.startsWith("1.4")).map((x) => [x.row, x.box]), [["1.4", "[ ]"], ["1.4_t", "[ ]"]]);
  assert.ok(notes.some((n) => /✓ Agreed: row 1\.4, Sale banner/.test(n)));

  // and you can be the second, through the door
  const p2 = await tool(home, "propose_change").run({ plan, row: "1.5", feature: "Newsletter", description: "a sign-up box", test: "`test -f news.txt` passes" }, ctxOf(home, "milo", conversation, notes));
  const id2 = Number(/change (\d+)/.exec(p2.content)![1]);
  const d = await serve(home, { port: 0 });
  t.after(() => d.close());
  const res = await fetch(`http://127.0.0.1:${d.port}/amendments/${id2}/agree`, { method: "POST", headers: { authorization: `Bearer ${d.token}` } });
  assert.equal(res.status, 200);
  assert.ok(home.board.rows(plan).some((x) => x.row === "1.5"));
  assert.ok(home.conversations.list(conversation).some((m) => m.orb === "you" && /seconded by you/.test(m.content)));
});

test("a request of a request goes two hands deep, never three", async (t) => {
  const { home, session, conversation } = await team(t);
  home.inbox.addOrb("june", "June", "writing");
  home.team.setMembers(session, "floor", ["hazel", "milo", "june"]);
  const ask = tool(home, "ask_orb");
  assert.match((await ask.run({ to: "Milo", request: "the footer, please" }, ctxOf(home, "hazel", conversation, []))).content, /Asked Milo/);
  assert.match((await ask.run({ to: "June", request: "the words for it" }, ctxOf(home, "milo", conversation, [], 1))).content, /Asked June/);
  const third = await ask.run({ to: "Hazel", request: "check it" }, ctxOf(home, "june", conversation, [], 2));
  assert.equal(third.isError, true);
  assert.match(third.content, /two hands deep|2 hands deep/);
  assert.deepEqual(home.events.ofType("session.asked").map((e) => [e.data.from, e.data.to, e.data.depth]), [["hazel", "milo", 1], ["milo", "june", 2]]);
});

test("@Milo gives the turn to Milo alone; otherwise the lead speaks first", async (t) => {
  const { home, session } = await team(t, { levels: { hazel: "Junior", milo: "Senior" } });
  const said = home.team.say(session, "floor", "Morning, both.");
  assert.deepEqual(said.turns, ["milo", "hazel"], "Milo, the Senior, leads the floor");
  await home.inbox.idle();
  assert.deepEqual(home.team.say(session, "floor", "@Hazel what's left?").turns, ["hazel"]);
  await home.inbox.idle();
});

test("who reviews a junior's row: the Senior of his kind when there is one, else any Senior, never himself", () => {
  const office = [
    { id: "ada", name: "Ada", specialty: "frontend", level: "Senior" as const },
    { id: "bea", name: "Bea", specialty: "frontend", level: "Junior" as const },
    { id: "cy", name: "Cy", specialty: "writing", level: "Senior" as const },
    { id: "dee", name: "Dee", specialty: "writing", level: "Junior" as const },
  ];
  assert.equal(reviewerProblem("ada", "bea", office), null);
  assert.match(reviewerProblem("cy", "bea", office) ?? "", /Ada reviews it, the Senior of its kind/);
  assert.match(reviewerProblem("dee", "bea", office) ?? "", /reviews are a Senior's: you are a Junior/);
  assert.match(reviewerProblem("bea", "bea", office) ?? "", /not by the orb whose row it is/);
  const noAda = office.filter((o) => o.id !== "ada");
  assert.equal(reviewerProblem("cy", "bea", noAda), null, "with no Senior of his kind in the office, any Senior");
});

test("a junior's passing row waits for the Senior of his kind; you can review it too; the chatter is the board's", async (t) => {
  const { home, session, plan, conversation } = await team(t);
  home.inbox.addOrb("june", "June", "writing", {}, "Senior");
  const check = tool(home, "check_row");
  const review = tool(home, "review_row");
  const milo = ctxOf(home, "milo", conversation, []);
  writeFileSync(join(milo.workspace, "footer.txt"), "Thanks");
  home.board.start(plan, "1.2", "test -f footer.txt");
  const r = await check.run({ plan, row: "1.2" }, milo);
  assert.match(r.content, /passed .* waits for a review/);
  assert.equal(home.board.rows(plan).find((x) => x.row === "1.2")!.box, "[~]", "not ticked by his own pass");
  const byJune = await review.run({ plan, row: "1.2", approve: true }, ctxOf(home, "june", conversation, []));
  assert.equal(byJune.isError, true, "June is a Senior, but of writing, and Hazel leads frontend");
  await review.run({ plan, row: "1.2", approve: true, note: "good" }, ctxOf(home, "hazel", conversation, []));
  assert.equal(home.board.rows(plan).find((x) => x.row === "1.2")!.box, "[x]");

  // you, through the door, on another of his rows
  writeFileSync(join(milo.workspace, "prices.txt"), "£1");
  home.board.start(plan, "1.3", "test -f prices.txt");
  await check.run({ plan, row: "1.3" }, milo);
  const d = await serve(home, { port: 0 });
  t.after(() => d.close());
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${d.port}${path}`, { method, headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  assert.equal((await call("POST", `/plans/${plan}/rows/1.3/review`, { approve: false, note: "use dollars" })).status, 200);
  assert.equal(home.board.rows(plan).find((x) => x.row === "1.3")!.box, "[~]");
  const b = (await (await call("GET", `/sessions/${session}/board`)).json()) as { chatter: { text: string }[]; plans: { rows: { row: string; box: string }[] }[] };
  const lines = b.chatter.map((x) => x.text);
  assert.ok(lines.includes("Row 1.2 is done [x], reviewed by Hazel."), JSON.stringify(lines));
  assert.ok(lines.includes("You asked for changes on row 1.3.") || lines.some((l) => /asked for changes on row 1\.3/.test(l)), JSON.stringify(lines));
  // the chatter is code's: no model was asked for it
  assert.equal(home.events.ofType("brain.spend").length, 0, "an unwatched team job spends nothing on its chatter");
  // and it matches the board: every row the board shows done, the chatter says done
  const done = b.plans[0]!.rows.filter((x) => !x.row.endsWith("_t") && x.box === "[x]").map((x) => x.row);
  for (const row of done) assert.ok(lines.some((l) => l.startsWith(`Row ${row} is done [x]`)), `the chatter has row ${row} done`);
});

test("what another orb did on the board reaches everyone in the session as a [Board] line; his own is not told back to him", async (t) => {
  const { home, conversation } = await team(t);
  home.conversations.add({ conversation, orb: "hazel", role: "notice", content: "Hazel took row 1.1.", meta: { board: true, claim: 1 } });
  const history = home.conversations.list(conversation);
  const milo = home.conversations.toModel(history, { me: "milo", nameOf: (o) => home.inbox.orb(o)?.name ?? o });
  assert.ok(milo.some((m) => m.role === "user" && m.content === "[Board]: Hazel took row 1.1."), JSON.stringify(milo));
  const hazel = home.conversations.toModel(history, { me: "hazel" });
  assert.ok(!hazel.some((m) => String(m.content ?? "").startsWith("[Board]")), "his own is his");
});

test("the shared computer through the door: a session's workspace, only for an orb who works it", async (t) => {
  const { home, session } = await team(t);
  mkdirSync(home.sessionWorkspace(session), { recursive: true });
  writeFileSync(join(home.sessionWorkspace(session), "header.txt"), "The shop");
  const d = await serve(home, { port: 0 });
  t.after(() => d.close());
  const get = (path: string) => fetch(`http://127.0.0.1:${d.port}${path}`, { headers: { authorization: `Bearer ${d.token}` } });
  const r = await get(`/orbs/hazel/workspace?session=${session}`);
  assert.equal(r.status, 200);
  assert.ok(((await r.json()) as { entries: { path: string }[] }).entries.some((e) => e.path === "header.txt"), "the team's file, in the session's workspace");
  assert.equal((await get(`/orbs/juniper/workspace?session=${session}`)).status, 404, "Juniper does not work this session: not his to read");
  assert.equal((await get(`/orbs/hazel/workspace/file?session=${session}&path=header.txt`)).status, 200);
});
