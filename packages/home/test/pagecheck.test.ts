// PLAN 4.1_t: "an unstyled page can't be called done". Ash's pagecheck, carried into the kit, looks
// at what a built page really renders in a browser of the kit's own:
//   - an orb's check_page: a page whose stylesheet never compiled is NOT done, for that reason; the
//     same page with real rules is (the control: the check does not fail everything);
//   - a visual row of a plan's board: its test passing is not enough; the home ticks it only when
//     pagecheck passes the page it named when it started, with pagecheck's words as the evidence.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Home } from "../src/home.ts";
import { agentHome } from "./helpers.ts";

const CLASSES = Array.from({ length: 5 }, (_, i) => `p-${i + 1} bg-sky-${i + 1}00 rounded-lg flex`).join(" ");
const PAGE = `<!doctype html><html><head><title>Landing</title><link rel="stylesheet" href="style.css"></head><body>${Array.from({ length: 24 }, (_, i) => `<div class="${CLASSES}">card ${i}</div>`).join("")}</body></html>`;
const UNCOMPILED = "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n";
const COMPILED = [...Array.from({ length: 40 }, (_, i) => `.c${i} { padding: ${i}px; }`), "div { display: flex; padding: 8px; background: #1c2230; border-radius: 6px; }"].join("\n");

const PLAN = [
  "# The landing page",
  "Verified by the test under each row. Out of scope: anything else.",
  "### PHASE 1 — the page",
  "| # | Feature | Description | Done |",
  "|---|---------|-------------|------|",
  "| 1.1 | Landing page | renders the landing page (visual) | [ ] |",
  "| 1.1_t | Tests: landing | the page is there and renders styled | [ ] |",
  "| 1.2 | Readme | write README.md | [ ] |", // one feature alone would be "just do it" to the plan gate
  "| 1.2_t | Tests: readme | `test -f README.md` passes | [ ] |",
].join("\n");

const toolSays = (home: Home, conv: string) => home.conversations.list(conv).filter((m) => m.role === "tool").map((m) => m.content);

test("an orb's check_page: a page whose stylesheet never compiled is not done; with real rules it is", { timeout: 180_000 }, async (t) => {
  const { home } = await agentHome(t, [
    { calls: [{ name: "write_file", args: { path: "site/index.html", content: PAGE } }, { name: "write_file", args: { path: "site/style.css", content: UNCOMPILED } }] },
    { calls: [{ name: "check_page", args: { path: "site/index.html" } }] },
    { calls: [{ name: "write_file", args: { path: "site/style.css", content: COMPILED } }] },
    { calls: [{ name: "check_page", args: { path: "site/index.html" } }] },
    { calls: [{ name: "check_page", args: { path: "../outside.html" } }, { name: "check_page", args: { url: "https://example.com/" } }] },
    { chunks: ["Done, and checked."] },
  ], { kit: true, agent: { decide: () => "allow" } });
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "build the landing page");
  await home.inbox.idle();
  const said = toolSays(home, "chat:juniper");
  const [first, second] = said.filter((s) => /It is NOT done|It renders and is styled|Inconclusive/.test(s));
  assert.match(first!, /^It is NOT done:/, "the stylesheet never compiled: not done");
  assert.match(first!, /unprocessed @tailwind|compiled to nothing/, `for that reason: ${first}`);
  assert.match(second!, /^It renders and is styled\./, `the same page with real rules: done (${second})`);
  assert.ok(said.some((s) => /\.\.\/outside\.html is outside your workspace/.test(s)), "a page outside his workspace is not his to check");
  assert.ok(said.some((s) => /check_page checks a page you built/.test(s)), "nor someone else's page on the web");
});

test("a visual row is ticked only when its test AND pagecheck pass the page it named", { timeout: 180_000 }, async (t) => {
  const { home } = await agentHome(t, [
    { calls: [{ name: "propose_plan", args: { plan: PLAN } }] },
    { calls: [{ name: "write_file", args: { path: "site/index.html", content: PAGE } }, { name: "write_file", args: { path: "site/style.css", content: UNCOMPILED } }] },
    { calls: [{ name: "start_row", args: { plan: 1, row: "1.1", test_command: "test -f site/index.html", page: "site/index.html" } }] },
    { calls: [{ name: "check_row", args: { plan: 1, row: "1.1" } }] },
    { calls: [{ name: "write_file", args: { path: "site/style.css", content: COMPILED } }] },
    { calls: [{ name: "check_row", args: { plan: 1, row: "1.1" } }] },
    { chunks: ["Row 1.1 is done."] },
  ], { kit: true, agent: { decide: () => "allow" } });
  home.inbox.send("juniper", "chat:1", "make the landing page");
  await home.inbox.idle();
  home.answerCard(home.conversations.openCard("chat:1")!.id, "approve");
  await home.inbox.idle();
  const notices = home.conversations.list("chat:1").filter((m) => m.role === "notice").map((m) => m.content);
  assert.ok(notices.some((n) => /^Row 1\.1 stays \[~\]: the home ran `test -f site\/index\.html` and it passed, but pagecheck says site\/index\.html is not done \(fail\)/.test(n)), "its test passed; the page did not: not done");
  assert.ok(notices.some((n) => /^Row 1\.1 is done \[x\]: the home ran `test -f site\/index\.html` and pagecheck saw site\/index\.html render, styled/.test(n)), "fixed, and seen: done");
  const row = home.board.rows(1).find((r) => r.row === "1.1")!;
  assert.deepEqual([row.box, home.board.rows(1).find((r) => r.row === "1.1_t")!.box], ["[x]", "[x]"]);
  assert.match(row.evidence ?? "", /pagecheck site\/index\.html:[\s\S]*look styled/, "the evidence is pagecheck's own words");
});
