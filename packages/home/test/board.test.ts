// PLAN 1.8_t: row by row, ticked with proof. A failing test can't be [x]; the orb's own "done" can't
// tick a box; ticks survive a restart. The control: the same command, once the work exists, does
// tick the row — so the refusals below are refusals of something.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Home } from "../src/home.ts";
import { TOOLS } from "../src/agent/tools.ts";
import { agentHome } from "./helpers.ts";

const PLAN = [
  "# Hello files",
  "Verified by the test under each row. Out of scope: anything else.",
  "### PHASE 1 — files",
  "| # | Feature | Description | Done |",
  "|---|---------|-------------|------|",
  "| 1.1 | Hello file | write hello.txt | [ ] |",
  "| 1.1_t | Tests: hello | `test -f hello.txt` passes | [ ] |",
  "| 1.2 | Banner | renders the banner (visual) | [ ] |",
  "| 1.2_t | Tests: banner | the render matches | [ ] |",
].join("\n");

const allow = { agent: { decide: () => "allow" as const } };
const boxes = (home: Home, plan = 1) => Object.fromEntries(home.board.rows(plan).map((r) => [r.row, r.box]));
const notices = (home: Home) => home.conversations.list("chat:1").filter((m) => m.role === "notice").map((m) => m.content);

async function approved(t: import("node:test").TestContext, turns: Parameters<typeof agentHome>[1], dataDir?: string) {
  const h = await agentHome(t, [{ calls: [{ name: "propose_plan", args: { plan: PLAN } }] }, ...turns], { ...allow, ...(dataDir && { dataDir }) });
  h.home.inbox.send("juniper", "chat:1", "make the hello files");
  await h.home.inbox.idle();
  h.home.answerCard(h.home.conversations.openCard("chat:1")!.id, "approve");
  await h.home.inbox.idle();
  return h;
}

test("a failing test can't be [x]; the same command, once the work exists, ticks it (the control)", async (t) => {
  const { home, model } = await approved(t, [
    { calls: [{ name: "start_row", args: { plan: 1, row: "1.1", test_command: "test -f hello.txt" } }] },
    { calls: [{ name: "check_row", args: { plan: 1, row: "1.1" } }] },
    { calls: [{ name: "write_file", args: { path: "hello.txt", content: "hi" } }] },
    { calls: [{ name: "check_row", args: { plan: 1, row: "1.1" } }] },
    { chunks: ["Row 1.1 is done."] },
  ]);
  assert.match(String(model.agent[1]!.findLast((m) => m.role === "tool")?.content), /approved the plan \(plan 1\)/);
  const n = notices(home);
  assert.ok(n.some((x) => /^Row 1\.1 stays \[~\]: the home ran `test -f hello\.txt` and it failed\./.test(x)), "the failure is shown");
  assert.ok(n.some((x) => /^Row 1\.1 is done \[x\]: the home ran `test -f hello\.txt` and it passed\./.test(x)), "and so is the pass");
  assert.deepEqual(boxes(home), { "1.1": "[x]", "1.1_t": "[x]", "1.2": "[ ]", "1.2_t": "[ ]" }, "the feature and its test, together");
  const events = home.events.ofType("board.failed").length + home.events.ofType("board.ticked").length;
  assert.equal(events, 2);
});

test("the orb's own 'done' ticks nothing: no tool sets a box, a test that cannot fail is refused", async (t) => {
  const { home } = await approved(t, [
    { calls: [{ name: "start_row", args: { plan: 1, row: "1.1", test_command: "true" } }] },
    { calls: [{ name: "start_row", args: { plan: 1, row: "1.1", test_command: "echo all tests passed" } }] },
    { calls: [{ name: "check_row", args: { plan: 1, row: "1.1" } }] },
    { chunks: ["Row 1.1 is done, I checked it myself."] },
  ]);
  assert.deepEqual(boxes(home)["1.1"], "[ ]", "the model saying so moved nothing");
  const results = home.conversations.list("chat:1").filter((m) => m.role === "tool").map((m) => m.content);
  assert.ok(results.some((r) => /`true` cannot fail, so it proves nothing/.test(r)));
  assert.ok(results.some((r) => /`echo all tests passed` cannot fail/.test(r)));
  assert.ok(results.some((r) => /row 1\.1 has not been started, so it has no test to run/.test(r)));
  const writers = [...TOOLS.map((d) => d.name), "propose_plan", "start_row", "check_row"];
  assert.equal(writers.some((n) => /tick|set_box|mark/.test(n)), false, "there is no tool that writes a box");
});

test("starting a row moves the feature and its test together; a visual row names its page, and without pagecheck it is not ticked", async (t) => {
  const { home } = await approved(t, [
    { calls: [{ name: "start_row", args: { plan: 1, row: "1.2", test_command: "test -f banner.html" } }] },
    { calls: [{ name: "start_row", args: { plan: 1, row: "1.2", test_command: "test -f banner.html", page: "../banner.html" } }] },
    { calls: [{ name: "start_row", args: { plan: 1, row: "1.2", test_command: "test -f banner.html", page: "https://example.com/" } }] },
    { calls: [{ name: "start_row", args: { plan: 1, row: "1.2", test_command: "test -f banner.html", page: "banner.html" } }] },
    { calls: [{ name: "write_file", args: { path: "banner.html", content: "<h1>hi</h1>" } }] },
    { calls: [{ name: "check_row", args: { plan: 1, row: "1.2" } }] },
    { chunks: ["The banner needs a render check."] },
  ]);
  const results = home.conversations.list("chat:1").filter((m) => m.role === "tool").map((m) => m.content);
  assert.ok(results.some((r) => /row 1\.2 is visual: name the page it builds/.test(r)), "a visual row cannot start without its page");
  assert.ok(results.some((r) => /\.\.\/banner\.html is not a page this row can be checked on/.test(r)), "nor with a page outside the workspace");
  assert.ok(results.some((r) => /https:\/\/example\.com\/ is not a page this row can be checked on/.test(r)), "nor with someone else's page");
  assert.deepEqual([boxes(home)["1.2"], boxes(home)["1.2_t"]], ["[~]", "[~]"], "started with its page: never a feature ahead of its test");
  assert.equal(home.board.page(1, "1.2"), "banner.html");
  assert.ok(results.some((r) => /Row 1\.2 stays \[~\]: it is visual, and pagecheck runs in the kit, which is not running/.test(r)), "its test would pass, but nothing looked at the page: not done");
});

test("ticks survive a restart", async (t) => {
  const first = await approved(t, [
    { calls: [{ name: "write_file", args: { path: "hello.txt", content: "hi" } }] },
    { calls: [{ name: "start_row", args: { plan: 1, row: "1.1", test_command: "test -f hello.txt" } }] },
    { calls: [{ name: "check_row", args: { plan: 1, row: "1.1" } }] },
    { chunks: ["done"] },
  ]);
  assert.equal(boxes(first.home)["1.1"], "[x]");
  await first.home.close();
  const again = Home.open({ dataDir: first.dataDir, protect: [], spendCapUsd: null });
  t.after(() => again.close());
  assert.deepEqual(boxes(again), { "1.1": "[x]", "1.1_t": "[x]", "1.2": "[ ]", "1.2_t": "[ ]" });
  assert.match(again.board.rows(1).find((r) => r.row === "1.1")!.evidence ?? "", /no output/, "with the evidence the home saw");
});
