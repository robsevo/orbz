// PLAN 5.1_t and 5.2_t's view: the team's board on the Floor, on a real home.
//   - each row with its box and, when an orb holds it, his face;
//   - a junior's row that passed waits for a review: your Approve ticks it;
//   - a change an orb proposed waits for a second: your Agree puts its row on the board;
//   - what happened, in the board's own words (written by code, nothing spent);
//   - the shared computer: the session's own workspace, not each orb's;
//   - nothing spills at phone size.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser } from "playwright-core";
import { findChrome, launch, measure } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-team-board-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

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
].join("\n");

test("the team's board on the Floor: holders, your review and your second, what happened, the shared computer, a phone", { skip, timeout: 150_000 }, async (t) => {
  const data = mkdtempSync(join(tmpdir(), "orbs-team-board-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("hazel", "Hazel", "frontend", { shape: "bean", eyes: "classic", hue: "amber" }); // the first of her kind: the Senior
  h.inbox.addOrb("milo", "Milo", "frontend", { shape: "bean", eyes: "classic", hue: "teal" });
  const s = h.team.create("The shop page", { floor: ["hazel", "milo"] });
  const conversation = `team:${s.id}:floor`;
  const plan = h.plans.archive({ orb: "hazel", conversation, card: 1, body: PLAN, shown: PLAN, objections: [] });
  h.board.open(plan.id, PLAN);
  h.claims.claim({ session: s.id, plan: plan.id, orb: "hazel", rows: ["1.1"], paths: ["header.txt"] });
  h.board.start(plan.id, "1.2", "test -f footer.txt");
  h.board.awaitReview(plan.id, "1.2", "milo", "the home ran `test -f footer.txt` and it passed");
  h.amendments.propose({ session: s.id, plan: plan.id, proposer: "milo", row: "1.3", feature: "Sale banner", description: "a banner for the sale", test: "`test -f sale.txt` passes", rows: ["1.1", "1.2"] });
  const shared = h.sessionWorkspace(s.id);
  mkdirSync(shared, { recursive: true });
  writeFileSync(join(shared, "header.txt"), "The shop");

  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await page.evaluate((id) => (location.hash = `#/session/${id}/floor`), s.id);

  const board = page.locator("[data-board]");
  await board.waitFor({ timeout: 20_000 });
  await board.locator('[data-row="1.1"] [data-holder="hazel"]').waitFor();
  assert.match(await board.locator('[data-row="1.2"]').innerText(), /waits for a review/);
  assert.match(await board.locator("[aria-label='What happened']").innerText(), /Hazel took row 1\.1/);

  await board.locator('[data-row="1.2"]').getByRole("button", { name: "Approve" }).click();
  await board.locator('[data-row="1.2"][data-box="[x]"]').waitFor({ timeout: 20_000 });
  assert.equal(h.board.rows(plan.id).find((r) => r.row === "1.2")!.box, "[x]", "your review ticked it");

  await board.locator("[data-change]").getByRole("button", { name: "Agree" }).click();
  await board.locator('[data-row="1.3"]').waitFor({ timeout: 20_000 });
  assert.ok(h.board.rows(plan.id).some((r) => r.row === "1.3_t"), "the agreed row and its test are on the board");

  // the shared computer: the session's workspace, where the team works
  const computer = page.locator("[data-computer]").first();
  await computer.getByRole("tab", { name: "Files" }).click();
  await computer.getByText("header.txt").waitFor({ timeout: 20_000 });

  assert.deepEqual(await measure(page), [], "nothing spills at desk size");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page), [], "nor at phone size");
});
