// PLAN 5.18_t, the board's daily report in the app (owner, 10-07: "The board also sends you a status report every day
// about ideas they think are great for the startup to make money, news around the world, news around the office, if we
// feel like someones not a fit or if theyre doing good. best new candidates to hire for the day ... we need to know
// where the idea comes from too as well(which orb in the office, so they get xp if we approve it)"), on a real home:
//   - its notice opens it; the Home page shows it, its ideas waiting;
//   - each idea with the orb whose idea it is and what approving it gives (its button names the home's XP.ideaApproved,
//     so the two cannot drift): approved, that orb has the XP; passed, nothing; once each;
//   - the best to hire today ranked by fit, the people, the office, the world with who found it, the money with the
//     CFO's name and the bills coming up;
//   - nothing spills, at desk or phone size.
// PLAN 5.20_t (owner, 10-08: "we have to keep in mind that the user may not have any money to start with. so ask how much
// they are willing to spend on infrastructure etc."; "Lets be able to change the budget as well"):
//   - the page asks what the company can spend until you have said (control: once said, a line, not the question);
//     chosen, the home keeps it; Change on the report and the Budget panel in Settings change it, the home keeping each;
//   - each idea says who pays, which orbs do it, the Founder's part, what it costs and the first step; an idea that does
//     not fit the budget, office or work they can safely do is left out and counted.
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
import { XP } from "../../home/src/gym/xp.ts";
import { fakeModel } from "../../home/test/fakes/model.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-report-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

test("the board's report: its notice and the Home page open it; each idea an orb's, approved for its XP or passed; who to hire, the people, the office, the world, the money; desk and phone", { skip, timeout: 180_000 }, async (t) => {
  const model = await fakeModel(t, []);
  const data = mkdtempSync(join(tmpdir(), "orbs-report-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.about.setCompany("Acme Orbs");
  for (const [id, name, sp, hue] of [["max", "Max", "ceo", "honey"], ["pip", "Pip", "assistant", "azure"], ["fin", "Fin", "cfo", "mint"], ["tia", "Tia", "tutor", "rose"]] as const) h.inbox.addOrb(id, name, sp, { shape: "bean", eyes: "classic", hue });
  h.boardroom.elect();
  h.recruiter.setPosition("travel", true); // Life is open: its head is your assistant
  h.events.append("reading.read", { source: 1, host: "news.example", changedPages: [{ title: "Small shops turn to AI helpers", url: "https://news.example/shops" }] }, { orb: "tia" });
  h.events.append("social.friends", { a: "tia", b: "pip", names: ["Tia", "Pip"] });
  h.notices.remind({ orb: "fin", kind: "bill", title: "Hosting", due: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10), amount: "$12" });
  model.replies.push(
    "Idea: Sell the office's habits to small shops as a service. They already work, so each sale is nearly all profit.\nWho pays: Small shops, about $30 a month each.\nWho does it: Max and Tia\nYour part: Approve or pass\nCosts: $0 to start, $0 a month.\nFirst step: List the three habits that work best.",
    "Idea: Offer a weekly brief to founders. It costs us an hour.\nWho pays: Founders, $10 a month.\nWho does it: Pip\nYour part: Approve it\nCosts: nothing.\nFirst step: Write the first brief.",
    "Idea: Keep small firms' books for a monthly fee.\nWho pays: Small firms.\nWho does it: Fin\nYour part: Nothing\nCosts: $500 to start.\nFirst step: Buy the software.", // more than nothing: asked again
    "Idea: Keep small firms' books for a monthly fee, on paid software.\nWho pays: Small firms.\nWho does it: Fin\nYour part: Nothing\nCosts: $100 a month.\nFirst step: Subscribe.", // still more: left out
  );
  await h.reports.make();
  const r = h.reports.latest()!;
  assert.deepEqual([r.ideas.map((x) => x.name), r.left], [["Max", "Pip"], 1]);

  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });

  // the Home page: from the board, its ideas waiting
  await page.evaluate(() => (location.hash = "#/home"));
  const onHome = page.locator("[data-home-report]");
  await onHome.waitFor({ timeout: 20_000 });
  assert.match(await onHome.innerText(), /from Max: 2 ideas to make money, 2 waiting for your verdict[\s\S]*Max: “Sell the office's habits/);
  // its notice opens it
  await page.evaluate(() => (location.hash = "#/notices"));
  await page.locator('[data-notice="report"]').getByRole("button", { name: "Read the report" }).click({ timeout: 20_000 });
  const room = page.locator("[data-report-room]");
  await room.waitFor({ timeout: 20_000 });
  assert.equal(await page.evaluate(() => location.hash), "#/report");
  assert.match(await room.innerText(), /The board's report[\s\S]*from Max, the Chairperson/);

  // what the company can spend: asked until you have said, the board taking it as nothing till then
  const ask = room.locator('[data-report-budget="ask"]');
  await ask.waitFor({ timeout: 10_000 });
  assert.match(await ask.innerText(), /What can Acme Orbs spend, for hosting, tools and ads\?[\s\S]*Until you say, it takes it as nothing/);
  assert.deepEqual(await measure(page), [], "the question, at desk size");
  await ask.getByRole("button", { name: "A little" }).click();
  const fits = room.locator('[data-report-budget="fits"]');
  await fits.waitFor({ timeout: 10_000 });
  assert.match(await fits.innerText(), /fit what Acme Orbs can spend: \$50 to start, \$20 a month/);
  for (let i = 0; i < 50 && !h.about.get().budget; i++) await page.waitForTimeout(50);
  assert.deepEqual(h.about.get().budget, { start: 50, month: 20 }, "kept by the home");
  assert.equal(await room.locator('[data-report-budget="ask"]').count(), 0, "said: a line now, not the question (control)");
  // changed on the report: amounts of your own
  await fits.getByRole("button", { name: "Change" }).click();
  const change = room.locator('[data-report-budget="change"]');
  await change.getByRole("button", { name: "Your own amounts" }).click();
  await change.getByRole("textbox", { name: "To start, in dollars" }).fill("$100");
  await change.getByRole("textbox", { name: "Each month, in dollars" }).fill("30");
  await change.getByRole("button", { name: "Keep" }).click();
  await room.locator('[data-report-budget="fits"]').filter({ hasText: "$100 to start, $30 a month" }).waitFor({ timeout: 10_000 });
  for (let i = 0; i < 50 && h.about.get().budget?.start !== 100; i++) await page.waitForTimeout(50);
  assert.deepEqual(h.about.get().budget, { start: 100, month: 30 }, "the home keeps the change");

  // each idea: who pays, who does it, your part, what it costs, the first step; one that does not fit, counted
  assert.match(await room.locator('[data-idea-by="max"]').innerText(), /who pays\s*Small shops, about \$30 a month each\.[\s\S]*who does it\s*Max and Tia[\s\S]*your part\s*Approve or pass[\s\S]*costs\s*Nothing: free tools and free tiers[\s\S]*first step\s*List the three habits that work best\./i);
  assert.match(await room.locator("[data-report-left]").innerText(), /^1 idea was left out: it did not fit your budget, your office, or the work they can safely do\.$/);

  // each idea an orb's: Max's approved, his XP; Pip's passed, nothing
  const ideas = room.locator("[data-idea]");
  assert.deepEqual(await ideas.evaluateAll((xs) => xs.map((x) => x.getAttribute("data-idea-by"))), ["max", "pip"]);
  assert.match(await ideas.first().innerText(), /Max · Chief Executive Officer[\s\S]*Sell the office's habits/);
  const approve = room.getByRole("button", { name: `Approve · +${XP.ideaApproved} XP to Max` });
  const before = h.xp.of("max", Date.now()).total;
  await approve.click();
  await room.locator('[data-idea-by="max"][data-verdict="approved"]').waitFor({ timeout: 10_000 });
  assert.equal(h.xp.of("max", Date.now()).total - before, XP.ideaApproved, "Max has the XP for his idea");
  assert.match(await room.locator('[data-idea-by="max"]').innerText(), new RegExp(`Approved · Max earned ${XP.ideaApproved} XP`));
  const pip = h.xp.of("pip", Date.now()).total;
  await room.locator('[data-idea-by="pip"]').getByRole("button", { name: "Pass" }).click();
  await room.locator('[data-idea-by="pip"][data-verdict="passed"]').waitFor({ timeout: 10_000 });
  assert.equal(h.xp.of("pip", Date.now()).total, pip, "a passed idea gives nothing");
  assert.equal(await room.locator('[data-idea-by="max"] button').count(), 0, "a verdict once");

  // who to hire, the people, the office, the world, the money
  const best = room.locator("[data-best-hire]");
  assert.ok((await best.count()) >= 1, "today's applicants for Travel Planner, ranked");
  assert.match(await best.first().innerText(), /Travel Planner[\s\S]*Fit \d+/);
  assert.match(await room.locator("[data-report-office]").innerText(), /Tia and Pip became good friends/);
  assert.match(await room.locator("[data-report-world]").innerText(), /Small shops turn to AI helpers[\s\S]*news\.example · found by Tia/);
  assert.match(await room.locator("[data-report-money]").innerText(), /from Fin, the Treasurer[\s\S]*Hosting, \$12/i);
  assert.deepEqual(await measure(page), [], "nothing spills at desk size");

  // changed in Settings too (owner, 10-08: "Lets be able to change the budget as well"): it shows what you chose there
  await page.evaluate(() => (location.hash = "#/settings"));
  const panel = page.getByRole("region", { name: "Budget" });
  await panel.waitFor({ timeout: 10_000 });
  assert.match(await panel.innerText(), /What Acme Orbs can spend[\s\S]*Your own: \$100 to start, \$30 a month/);
  assert.equal(await panel.locator("[data-budget-own]").getAttribute("aria-pressed"), "true");
  await panel.getByRole("button", { name: "Nothing yet" }).click();
  for (let i = 0; i < 50 && h.about.get().budget?.start !== 0; i++) await page.waitForTimeout(50);
  assert.deepEqual(h.about.get().budget, { start: 0, month: 0 }, "nothing, from Settings");
  assert.equal(await panel.locator('[data-budget-tier="nothing"]').getAttribute("aria-pressed"), "true");
  await page.evaluate(() => (location.hash = "#/report"));
  assert.match(await page.locator('[data-report-budget="fits"]').innerText({ timeout: 10_000 }), /nothing yet, free tools only/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page), [], "nor at phone size");
  // the choices again, at phone size
  await page.locator('[data-report-budget="fits"]').getByRole("button", { name: "Change" }).click();
  await page.locator('[data-report-budget="change"]').getByRole("button", { name: "Your own amounts" }).click();
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page), [], "the budget's choices, at phone size");
});
