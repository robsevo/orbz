// PLAN 1.7_t: a feature missing its _t row never reaches you; a typed count is refused; "but X"
// adds rows and re-shows; a declined plan is still archived; a one-line task gets no plan.
// P.0 is the control: a plan in the house format is shown, with its counts generated.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { test } from "node:test";
import { gate } from "../src/plans/gate.ts";
import { agentHome } from "./helpers.ts";

/** A plan in the house format: `n` features in one phase (and an optional second phase). */
function plan(n: number, o: { title?: string; skipTest?: number; typed?: string; extra?: string; cite?: string } = {}): string {
  const rows = Array.from({ length: n }, (_, i) => {
    const id = `1.${i + 1}`;
    const f = `| ${id} | Step ${i + 1} | builds part ${i + 1} | [ ] |`;
    return i + 1 === o.skipTest ? f : `${f}\n| ${id}_t | Tests: step ${i + 1} | asserts part ${i + 1} works | [ ] |`;
  });
  return [
    `# ${o.title ?? "Build the thing"}`,
    "",
    `Verified by the tests under each row. Out of scope: anything not listed.${o.cite ? ` It changes \`${o.cite}\`.` : ""}`,
    "",
    "### PHASE 1 — the work",
    "",
    "| # | Feature | Description | Done |",
    "|---|---------|-------------|------|",
    ...rows,
    o.extra ?? "",
    o.typed ?? "",
  ].join("\n");
}

test("P.0 CONTROL: a plan in the house format passes the gate", () => {
  const g = gate(plan(3), { roots: [] });
  assert.deepEqual([g.hard, g.soft], [[], []]);
  assert.equal([...g.counts.features.values()][0], 3);
});

test("the gate's hard rules: a missing _t row, a wrong typed count, one feature, a feature ahead of its test", () => {
  assert.match(gate(plan(3, { skipTest: 2 }), { roots: [] }).hard.join(";"), /feature 1\.2 has no 1\.2_t test row/);
  assert.match(gate(plan(3, { typed: "| **Total** | 5 | 5 |" }), { roots: [] }).hard.join(";"), /the total says 5 and 5; the rows say 3 and 3/);
  assert.deepEqual(gate(plan(3, { typed: "| **Total** | 3 | 3 |" }), { roots: [] }).hard, [], "control: a typed count that is right is not refused");
  assert.match(gate(plan(1), { roots: [] }).hard.join(";"), /one feature: small enough to just do/);
  const ahead = plan(2).replace("| 1.1 | Step 1 | builds part 1 | [ ] |", "| 1.1 | Step 1 | builds part 1 | [x] |");
  assert.match(gate(ahead, { roots: [] }).hard.join(";"), /feature 1\.1 is \[x\] but its test 1\.1_t is \[ \]/);
  assert.match(gate(plan(2), { roots: [], changedFrom: plan(2) }).hard.join(";"), /asked for a change and it has no new rows/);
});

test("the gate's soft rules: a cited file must exist unless it is marked new", (t) => {
  const g = gate(plan(2, { cite: "src/nowhere.ts" }), { roots: [] });
  assert.match(g.soft.join(";"), /cites 1 file\(s\) that do not exist.*src\/nowhere\.ts/);
  const marked = plan(2, { cite: "src/nowhere.ts" }).replace("It changes", "It creates (new)");
  assert.deepEqual(gate(marked, { roots: [] }).soft.filter((s) => /cites/.test(s)), [], "a file marked (new) is not expected to exist");
  const inRow = plan(2).replace("| 1.1 | Step 1 | builds part 1 | [ ] |", "| 1.1 | Step 1 | builds `src/later.ts` | [ ] |");
  assert.deepEqual(gate(inRow, { roots: [] }).soft.filter((s) => /cites/.test(s)), [], "a file named by an unchecked row is future work (Ash's rule)");
  void t;
});

const cardIn = (home: Awaited<ReturnType<typeof agentHome>>["home"]) => home.conversations.openCard("chat:1");

test("a feature missing its _t row never reaches you; fixed, it does, with its counts generated", async (t) => {
  const { home, model } = await agentHome(t, [
    { calls: [{ name: "propose_plan", args: { plan: plan(3, { skipTest: 2 }) } }] },
    { calls: [{ name: "propose_plan", args: { plan: plan(3) } }] },
  ]);
  home.inbox.send("juniper", "chat:1", "plan the thing");
  await home.inbox.idle();
  const back = model.agent[1]!.findLast((m) => m.role === "tool");
  assert.match(String(back?.content), /The plan was not shown: feature 1\.2 has no 1\.2_t test row/);
  const card = cardIn(home)!;
  assert.equal(card.kind, "plan");
  assert.match(card.detail, /### Count summary[\s\S]*\| Phase 1 \| 3 \| 3 \|[\s\S]*\(Counted by the home, not typed\.\)/);
  assert.equal(home.plans.list().length, 1, "only the plan that reached the person is archived");
  assert.equal(home.plans.list()[0]!.status, "submitted");
});

test("a typed count that is wrong is refused, never shown", async (t) => {
  const { home, model } = await agentHome(t, [{ calls: [{ name: "propose_plan", args: { plan: plan(3, { typed: "| **Total** | 7 | 7 |" }) } }] }, { chunks: ["…"] }]);
  home.inbox.send("juniper", "chat:1", "plan it");
  await home.inbox.idle();
  assert.equal(cardIn(home), undefined);
  assert.match(String(model.agent[1]!.findLast((m) => m.role === "tool")?.content), /the total says 7 and 7; the rows say 3 and 3/);
});

test("soft objections send a plan back twice, then it is shown with them attached", async (t) => {
  const p = plan(2, { cite: "src/missing.ts" });
  const { home, model } = await agentHome(t, [
    { calls: [{ name: "propose_plan", args: { plan: p } }] },
    { calls: [{ name: "propose_plan", args: { plan: p } }] },
    { calls: [{ name: "propose_plan", args: { plan: p } }] },
  ]);
  home.inbox.send("juniper", "chat:1", "plan it");
  await home.inbox.idle();
  assert.match(String(model.agent[1]!.findLast((m) => m.role === "tool")?.content), /sent it back \(1 of 2\)/);
  assert.match(String(model.agent[2]!.findLast((m) => m.role === "tool")?.content), /sent it back \(2 of 2\).*nearly unchanged/);
  const card = cardIn(home)!;
  assert.match(card.detail, /The plan gate still objects: it cites 1 file/);
  assert.deepEqual(home.plans.list()[0]!.objections.length > 0, true);
});

test("'go with it, but X' adds rows and re-shows; the first plan stays archived as changed", async (t) => {
  const { home, model } = await agentHome(t, [
    { calls: [{ name: "propose_plan", args: { plan: plan(2) } }] },
    { calls: [{ name: "propose_plan", args: { plan: plan(2, { title: "Same rows" }) } }] },
    { calls: [{ name: "propose_plan", args: { plan: plan(3, { title: "With dark mode" }) } }] },
  ]);
  home.inbox.send("juniper", "chat:1", "plan the site");
  await home.inbox.idle();
  home.answerCard(cardIn(home)!.id, "change", "add a dark mode");
  await home.inbox.idle();
  assert.match(String(model.agent[1]!.findLast((m) => m.role === "tool")?.content), /go with it, but add a dark mode\. Add rows/);
  assert.match(String(model.agent[2]!.findLast((m) => m.role === "tool")?.content), /asked for a change and it has no new rows/, "a re-show with no new rows is refused");
  const again = cardIn(home)!;
  assert.match(again.title, /With dark mode/);
  const [newest, first] = home.plans.list();
  assert.deepEqual([first!.status, newest!.status], ["changed", "submitted"]);
  assert.throws(() => home.answerCard(again.id, "change", "  "), /a change says what to change/);
});

test("a declined plan is still archived, its text frozen; save and approve tell the model what to do", async (t) => {
  const { home, model, dataDir } = await agentHome(t, [
    { calls: [{ name: "propose_plan", args: { plan: plan(2, { title: "Declined one" }) } }] }, { chunks: ["OK, what instead?"] },
    { calls: [{ name: "propose_plan", args: { plan: plan(2, { title: "Saved one" }) } }] }, { chunks: ["Saved."] },
    { calls: [{ name: "propose_plan", args: { plan: plan(2, { title: "Approved one" }) } }] }, { chunks: ["Building row 1.1."] },
  ]);
  for (const [ask, choice] of [["plan A", "deny"], ["plan B", "save"], ["plan C", "approve"]] as const) {
    home.inbox.send("juniper", "chat:1", ask);
    await home.inbox.idle();
    home.answerCard(cardIn(home)!.id, choice);
    await home.inbox.idle();
  }
  const byTitle = Object.fromEntries(home.plans.list().map((p) => [p.title, p]));
  assert.deepEqual([byTitle["Declined one"]?.status, byTitle["Saved one"]?.status, byTitle["Approved one"]?.status], ["declined", "saved", "approved"]);
  assert.equal(byTitle["Declined one"]!.body, plan(2, { title: "Declined one" }), "the archived text is what was proposed, byte for byte");
  const toolResults = model.agent.map((req) => String(req.findLast((m) => m.role === "tool")?.content ?? ""));
  assert.ok(toolResults.some((c) => /declined the plan\. Don't build it/.test(c)));
  assert.ok(toolResults.some((c) => /saved the plan without running it/.test(c)));
  assert.ok(toolResults.some((c) => /approved the plan \(plan \d+\)\. Build it row by row/.test(c)));
  await home.close();
  const db = new DatabaseSync(join(dataDir, "home.db"));
  t.after(() => db.close());
  assert.throws(() => db.exec("UPDATE plans SET body = 'rewritten'"), /a shown plan is history/);
  db.exec("UPDATE plans SET status = 'declined' WHERE id = 1"); // control: the status can still move
});

test("a one-line task gets no plan: a one-feature plan is refused with 'just do it'", async (t) => {
  const { home, model } = await agentHome(t, [{ calls: [{ name: "propose_plan", args: { plan: plan(1, { title: "Rename a file" }) } }] }, { chunks: ["Done, renamed."] }]);
  home.inbox.send("juniper", "chat:1", "rename notes.txt to notes.md");
  await home.inbox.idle();
  assert.equal(cardIn(home), undefined);
  assert.equal(home.plans.list().length, 0);
  assert.match(String(model.agent[1]!.findLast((m) => m.role === "tool")?.content), /small enough to just do, so do it/);
});
