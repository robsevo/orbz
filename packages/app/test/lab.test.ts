// PLAN 2.13_t, the lab in the app, on a real home:
//   - The side menu's lab holds every brainstorm (what was agreed, who was in it) and every plan
//     shown (its rows, how far along: the board's), newest first.
//   - A word finds a plan by its rows; one that is nowhere says so.
//   - Reopen starts a new session from the brainstorm, and opens it: it says where it came from.
//   - Nothing spills at desk or phone size.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
// one flow, start to end, on a home and a real browser: it can take more than a test's default minute in the gate
const LONG = { timeout: 150_000 };

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-lab-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

const PLAN = [
  "# The party", "", "Verified by the tests under each row. Out of scope: anything not listed.", "", "### PHASE 1 — the work", "",
  "| # | Feature | Description | Done |", "|---|---------|-------------|------|",
  "| 1.1 | Invitations | send the invitations | [ ] |", "| 1.1_t | Tests: invitations | every guest has one | [ ] |",
  "| 1.2 | Bunting | hang the bunting in the park | [ ] |", "| 1.2_t | Tests: bunting | it is up by noon | [ ] |",
].join("\n");

test("the lab: brainstorms and plans kept, found by a word, a brainstorm reopened", { skip, ...LONG }, async (t) => {
  const data = mkdtempSync(join(tmpdir(), "orbs-lab-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("hazel", "Hazel", "planning", { shape: "bean", eyes: "classic", hue: "amber" });
  h.inbox.addOrb("milo", "Milo", "research", { shape: "bean", eyes: "classic", hue: "teal" });
  const s = h.team.create("A birthday party", { brainstorm: ["hazel", "milo"], floor: ["hazel"] });
  const conv = `team:${s.id}:brainstorm`;
  h.conversations.add({ conversation: conv, orb: "milo", role: "notice", content: "✓ Agreed: Saturday, at the park", meta: { agreed: "Saturday, at the park" } });
  h.conversations.add({ conversation: conv, orb: "milo", role: "assistant", content: "Agreed: Saturday." });
  const plan = h.plans.archive({ orb: "hazel", conversation: `team:${s.id}:floor`, card: 0, body: PLAN, shown: PLAN, objections: [] });
  h.plans.mark(plan.id, "approved");
  h.board.open(plan.id, PLAN);
  h.board.record(plan.id, "1.1", true, "every guest has one");

  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.getByText("CEO Robin").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "The lab", exact: true }).click();
  assert.equal(await page.evaluate(() => location.hash), "#/lab");
  const brainstorm = page.locator(`[data-brainstorm="${s.id}"]`);
  await brainstorm.waitFor({ timeout: 20_000 });
  assert.match(await brainstorm.innerText(), /A birthday party[\s\S]*✓ Saturday, at the park[\s\S]*Agreed: Saturday\./);
  const card = page.locator(`[data-plan="${plan.id}"]`);
  assert.match(await card.innerText(), /The party[\s\S]*Hazel · Approved[\s\S]*1 of 2 done/);
  assert.deepEqual(await card.locator("[data-row]").evaluateAll((els) => els.map((e) => e.textContent)), ["●1.1Invitations", "○1.2Bunting"], "the board's boxes");
  assert.deepEqual(await measure(page), [], "nothing spills at desk size");

  // a word in its rows
  const search = page.getByRole("searchbox", { name: "Look for a word in the lab" });
  await search.fill("bunting");
  await page.getByRole("region", { name: "Brainstorms" }).waitFor({ state: "detached", timeout: 10_000 });
  assert.equal(await card.count(), 1, "the plan with it");
  await search.fill("fireworks");
  await page.getByText('Nothing with "fireworks" in it.').waitFor({ timeout: 10_000 });
  await search.fill("");
  await brainstorm.waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page), [], "nor at phone size");
  await page.setViewportSize({ width: 1280, height: 1000 });

  // reopened: a new session, opened, saying where it came from
  await brainstorm.getByRole("button", { name: "Reopen" }).click();
  await page.waitForFunction(() => /^#\/session\/\d+\/brainstorm$/.test(location.hash));
  const id = Number((await page.evaluate(() => location.hash)).split("/")[2]);
  assert.notEqual(id, s.id);
  assert.equal(h.team.get(id)!.title, "A birthday party (reopened)");
  await page.getByText('Reopened from "A birthday party": everyone here knows what was agreed.').waitFor({ timeout: 20_000 });
});
