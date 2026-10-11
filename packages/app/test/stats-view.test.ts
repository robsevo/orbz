// PLAN 2.19_t, the numbers behind the home page, as charts (owner, 10-08: "when we press on brain today it brings us to
// settings? how about a chart with all the stats of tokens? lol"; "same for xp this week"), on a real home with three
// days in its log:
//   - the home page's Brain today opens the tokens' charts (not Settings), its XP this week the XP's;
//   - the numbers and the bars say the home's sums: by day, by model, by kind of turn, by orb (a call no orb made its own),
//     the cache's share; the XP earned, taken back and kept, by orb;
//   - 7, 14 and 30 days; a new call shows on its own, a few seconds later;
//   - nothing spills at desk and phone.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { findChrome, launch, measure } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { FakeClock } from "../../home/src/clock.ts";
import { XP } from "../../home/src/gym/xp.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
const DAY = 86_400_000;
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-stats-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

const bars = (page: Page, section: string): Promise<[string, string, string][]> =>
  page.locator(`[aria-label="${section}"] [data-bar]`).evaluateAll((els) => els.map((el) => [el.getAttribute("data-bar") ?? "", el.querySelector("span")?.textContent ?? "", el.querySelector("[data-value]")?.textContent ?? ""] as [string, string, string]));

test("the home page's numbers open their charts: the brains' tokens by day, model, kind of turn and orb; the XP by day and orb; 7, 14 and 30 days; desk and phone", { skip, timeout: 200_000 }, async (t) => {
  const now = Date.now();
  const clock = new FakeClock(now - 2 * DAY);
  const data = mkdtempSync(join(tmpdir(), "orbs-stats-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null, clock });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("pip", "Pip", "assistant", { shape: "bean", eyes: "classic", hue: "mint" });
  h.inbox.addOrb("ada", "Ada", "frontend", { shape: "bean", eyes: "classic", hue: "coral" });
  const spend = (orb: string | null, conversation: string | null, model: string, turn: string | null, input: number, cached: number, output: number): void =>
    void h.events.append("brain.spend", { tier: "big", model, ...(turn && { turn }), prompt_tokens: input, cached_tokens: cached, completion_tokens: output, cost_usd: null, cost_source: "none" }, { orb, conversation });
  const xp = (orb: string, amount: number, tier?: string): void => void h.events.append(amount >= 0 ? "xp.earned" : "xp.lost", { amount, reason: "work", source: 1, at: clock.now(), ...(tier && { tier }) }, { orb });
  // two days ago a session's lead; yesterday a chat and a call no orb made, XP earned and taken back; today a chat
  spend("ada", "team:1:brainstorm", "gpt-5.1", "lead", 10_000, 4_000, 1_000);
  xp("ada", 30);
  clock.suspend(DAY);
  spend("pip", "chat:pip", "gpt-5.1-mini", null, 2_000, 0, 500);
  spend(null, null, "gpt-5.1-mini", null, 1_000, 0, 200);
  xp("pip", 20, "standard");
  xp("ada", -5);
  clock.suspend(now - clock.now());
  spend("pip", "chat:pip", "gpt-5.1", null, 3_000, 1_500, 300);
  xp("pip", 10, "easy");
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await page.evaluate(() => (location.hash = "#/home"));
  // Brain today: the tokens' charts, not Settings
  const brain = page.locator('[data-tile="brain"]');
  await brain.filter({ hasText: "3.3k" }).waitFor({ timeout: 20_000 });
  await brain.click();
  await page.waitForFunction(() => location.hash === "#/stats/brain", undefined, { timeout: 10_000 });
  const stat = (id: string) => page.locator(`[data-stat="${id}"]`).innerText();
  await page.locator('[data-stat="tokens"]').filter({ hasText: "18k" }).waitFor({ timeout: 20_000 });
  assert.match(await stat("tokens"), /18k[\s\S]*4 calls/);
  assert.match(await stat("today"), /3\.3k[\s\S]*1 call\b/);
  assert.match(await stat("cache"), /34%/, "5.5k of 16k read came from the cache");
  assert.equal(await page.locator("[data-columns]").getAttribute("data-columns"), "7");
  assert.deepEqual(await bars(page, "By model"), [["gpt-5.1", "gpt-5.1", "14k"], ["gpt-5.1-mini", "gpt-5.1-mini", "3.7k"]]);
  assert.deepEqual(await bars(page, "By kind of turn"), [["lead", "A session's lead", "11k"], ["chat", "A chat or a schedule", "5.8k"], ["other", "With no conversation", "1.2k"]]);
  assert.deepEqual(await bars(page, "By orb"), [["ada", "Ada", "11k"], ["pip", "Pip", "5.8k"], ["none", "No orb", "1.2k"]], "the call no orb made, its own");
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page), [], "the tokens' charts at desk size");
  // the ranges
  await page.locator('[data-range="14"]').click();
  await page.locator('[data-columns="14"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-range="30"]').click();
  await page.locator('[data-columns="30"]').waitFor({ timeout: 10_000 });
  assert.match(await stat("tokens"), /^TOKENS, 30 DAYS[\s\S]*18k/i, "the same sums: nothing before the three days");
  await page.locator('[data-range="7"]').click();
  // a new call shows on its own
  spend("ada", "chat:ada", "gpt-5.1", null, 1_000, 0, 0);
  await page.locator('[data-stat="today"]').filter({ hasText: "4.3k" }).waitFor({ timeout: 20_000 });

  // the XP: its tab, then the home page's XP this week
  await page.getByRole("tab", { name: "XP" }).click();
  await page.waitForFunction(() => location.hash === "#/stats/xp", undefined, { timeout: 10_000 });
  await page.locator('[data-stat="kept"]').filter({ hasText: "55" }).waitFor({ timeout: 20_000 });
  assert.match(await stat("earned"), /\+60[\s\S]*\+10 today/);
  assert.match(await stat("lost"), /−5/);
  assert.deepEqual(await bars(page, "XP by orb"), [["pip", "Pip", "30"], ["ada", "Ada", "25"]], "the most kept first");
  // by how hard the work was (PLAN 3.13): the four tiers, each with its jobs and what one earns, the home's own numbers
  assert.deepEqual(await bars(page, "XP by how hard the work was"), [["easy", "Easy", "10"], ["standard", "Standard", "20"], ["hard", "Hard", "0"], ["expert", "Expert", "0"]]);
  const each = await page.locator("[data-xp-tiers] [data-bar]").evaluateAll((rows) => rows.map((r) => r.lastElementChild!.textContent));
  assert.deepEqual(each, [`1 job · ${XP.job.easy} XP each`, `1 job · ${XP.job.standard} XP each`, `0 jobs · ${XP.job.hard} XP each`, `0 jobs · ${XP.job.expert} XP each`], "what one job earns, as the home gives it");
  assert.deepEqual(await measure(page), [], "the XP's charts at desk size");
  await page.evaluate(() => (location.hash = "#/home"));
  await page.locator('[data-tile="xp"]').click();
  await page.waitForFunction(() => location.hash === "#/stats/xp", undefined, { timeout: 10_000 });

  // a phone: both, nothing spilling
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark", hasTouch: true, isMobile: true });
  t.after(() => phone.close());
  const p = await phone.newPage();
  await p.goto(d.pairLink());
  await p.locator(".orbs-window").waitFor({ timeout: 30_000 });
  for (const tab of ["brain", "xp"]) {
    await p.evaluate((x) => (location.hash = `#/stats/${x}`), tab);
    await p.locator(`[data-stats="${tab}"] [data-stat]`).first().waitFor({ timeout: 20_000 });
    await p.locator('[data-range="30"]').click();
    await p.locator('[data-columns="30"]').waitFor({ timeout: 10_000 });
    await p.waitForTimeout(400);
    assert.deepEqual(await measure(p), [], `${tab}, 30 days, on a phone`);
  }
});
