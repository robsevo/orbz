// PLAN 5.6_t: the org chart and career pages, on a real home, at desk and phone sizes.
//   - the org chart: everyone by the kind of work they do, the lead of each kind first;
//   - a face opens his career page: his level and the next one's evidence, his age and days in the
//     company, the radar, his habits;
//   - his weekly card: a notice that opens his career page;
//   - let go, his habits handed to another orb; away on the org chart; rehired, back in the office;
//   - nothing spills, at desk or phone size.
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
import { habitDir } from "../../home/src/gym/compile.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-org-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

test("the org chart and a career page; let go with a hand-off, away, rehired; let go and sent to school from a profile; desk and phone", { skip, timeout: 150_000 }, async (t) => {
  const data = mkdtempSync(join(tmpdir(), "orbs-org-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("ada", "Ada", "frontend", { shape: "bean", eyes: "classic", hue: "amber" }); // the first of his kind: he leads it
  h.inbox.addOrb("bea", "Bea", "frontend", { shape: "bean", eyes: "classic", hue: "teal" });
  h.inbox.addOrb("cy", "Cy", "writing", { shape: "bean", eyes: "classic", hue: "rose" });
  const key = "ada|trigger:t1|read_file {subject}";
  mkdirSync(habitDir(data, { orb: "ada", key }, 1), { recursive: true });
  writeFileSync(join(habitDir(data, { orb: "ada", key }, 1), "habit.py"), "# the steps\n");
  h.events.append("habit.promoted", { kind: key, task: "ada|trigger:t1|{subject}", version: 1, runs: [1, 2, 3] }, { orb: "ada" });

  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await page.evaluate(() => (location.hash = "#/org"));

  const org = page.locator("[data-org]");
  await org.waitFor({ timeout: 20_000 });
  const frontend = org.locator('[data-kind="frontend"]');
  await frontend.getByRole("button", { name: /^Ada, Senior, leads Frontend Builder work/ }).waitFor();
  await frontend.getByRole("button", { name: /^Bea, Junior$/ }).waitFor();
  await org.locator('[data-kind="writing"]').getByRole("button", { name: /^Cy, Senior, leads/ }).waitFor();
  // the company's shape (owner, 10-07): you at its top, the Founder; each department under its head, or none yet
  assert.match(await org.locator("[data-founder]").innerText(), /Founder\s+Robin/i);
  assert.deepEqual(await org.locator("[data-department]").evaluateAll((ds) => ds.map((d) => d.getAttribute("data-department"))), ["build", "make"], "the departments with orbs, in the company's order");
  assert.equal(await org.locator('[data-department="build"] [data-head]').innerText(), "No Chief Technology Officer yet");
  assert.equal(await org.locator('[data-department="build"] [data-kind="frontend"]').count(), 1, "its kinds of work inside it");
  assert.deepEqual(await measure(page), [], "the org chart, at desk size");

  // a face opens his career page
  await frontend.getByRole("button", { name: /^Ada, Senior/ }).click();
  const career = page.locator('[data-career="ada"]');
  await career.waitFor({ timeout: 20_000 });
  assert.equal(await page.evaluate(() => location.hash), "#/career/Ada");
  const words = await career.innerText();
  assert.match(words, /Senior Frontend Builder/);
  assert.match(words, /Age 0 days · 0 days in the company/);
  assert.match(words, /trigger:t1/, "his habit is on his page");
  await career.getByRole("img", { name: /Leans toward/ }).waitFor();
  // richer (owner, 10-07): the ladder with its rung, its seven traits, its level; the whole orb, hat and all
  await career.locator('[data-rung="Senior"][aria-current="step"]').waitFor();
  assert.equal(await career.locator("[data-trait]").count(), 7);
  assert.match(await career.locator("[data-level]").innerText(), /^Lv\. \d+$/);
  assert.equal(await career.locator("[data-career-portrait]").evaluate((el) => getComputedStyle(el.querySelector("canvas")!.parentElement!).overflow === "hidden" ? "cut" : "whole"), "whole");
  // what it wants, and the office by XP (owner, 10-07: "they also want to be the best orb also")
  assert.match(await career.locator("[data-ambition]").innerText(), /^Ada wants to be the best orb in the office, not only the best Frontend Builder: the most XP, and your approval\.$/);
  assert.deepEqual(await career.locator("[data-rank-orb]").evaluateAll((ls) => ls.map((l) => l.getAttribute("data-rank-orb"))), h.ranking().map((r) => r.orb), "the office by XP, the most first");
  assert.equal(await career.locator('[data-rank-orb][aria-current="true"]').getAttribute("data-rank-orb"), "ada", "it, marked");
  assert.match(await career.locator("[data-standing]").innerText(), new RegExp(`^${h.ranking().findIndex((r) => r.orb === "ada") + 1}(st|nd|rd|th) of 3, `));
  assert.deepEqual(await measure(page), [], "his career page, at desk size");

  // his week: a notice for you, a press from his career page
  h.events.append("performance.card", { orb: "cy", xp: 0, xpBefore: 0, approved: 0, judged: 0, regressions: 0, idleDays: 0, suggest: "keep", why: "0 XP this week (0 the week before); nothing judged this week; no regression; worked today" }, { orb: "cy" });
  await page.evaluate(() => (location.hash = "#/notices"));
  const cy = page.locator('[data-notices="cy"]');
  await cy.waitFor({ timeout: 20_000 });
  assert.match(await cy.innerText(), /Cy's week: keep going[\s\S]*Weekly card · 0 XP this week/);
  await cy.getByRole("button", { name: "Cy's career" }).click();
  await page.locator('[data-career="cy"]').waitFor({ timeout: 20_000 });
  assert.equal(await page.evaluate(() => location.hash), "#/career/Cy");
  assert.match(await page.locator('[data-career="cy"]').innerText(), /This week: Keep going/i); // a heading, in capitals on the page

  // let go from his card in the office, his habits handed to Bea
  await page.evaluate(() => (location.hash = "#/office/Ada"));
  await page.getByRole("button", { name: "Let Ada go…" }).click();
  const ask = page.getByRole("group", { name: "Let Ada go?" });
  await ask.getByRole("combobox").selectOption("bea");
  await ask.getByRole("button", { name: "Let Ada go", exact: true }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Let Ada go…"), undefined, { timeout: 20_000 });
  for (let i = 0; i < 50 && !h.inbox.orb("ada")!.letGoAt; i++) await page.waitForTimeout(100);
  assert.ok(h.inbox.orb("ada")!.letGoAt, "Ada was let go");
  assert.ok(h.events.ofType("habit.promoted").some((e) => e.orb === "bea" && e.data.task === "bea|trigger:t1|{subject}"), "his habit is Bea's now");

  // away on the org chart; rehired from there, back in the office
  await page.evaluate(() => (location.hash = "#/org"));
  const away = page.locator('[data-away="ada"]');
  await away.waitFor({ timeout: 20_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page), [], "the org chart with someone away, at phone size");
  await away.getByRole("button", { name: "Rehire Ada" }).click();
  await away.waitFor({ state: "detached", timeout: 20_000 });
  assert.equal(h.inbox.orb("ada")!.letGoAt, null, "rehired");

  // Bea's career page at phone size: the habit Ada handed her says where it came from
  await page.evaluate(() => (location.hash = "#/career/Bea"));
  const bea = page.locator('[data-career="bea"]');
  await bea.waitFor({ timeout: 20_000 });
  assert.match(await bea.innerText(), /trigger:t1 \{subject\} \(v1\), from Ada/);
  assert.deepEqual(await measure(page), [], "a career page, at phone size");

  // school from where you let an orb go (owner, 10-06: "we dont see the send to school option"):
  // one press lets Cy go and opens the org chart on Cy's school sheet
  await page.evaluate(() => (location.hash = "#/office/Cy"));
  await page.getByRole("button", { name: "Let Cy go…" }).click();
  await page.getByRole("group", { name: "Let Cy go?" }).getByRole("button", { name: "Let Cy go and send to school" }).click();
  await page.waitForFunction(() => location.hash === "#/org/school/cy", undefined, { timeout: 20_000 });
  const sheet = page.locator('[data-away="cy"] [data-school-sheet="cy"]');
  await sheet.waitFor({ timeout: 20_000 });
  assert.ok(h.inbox.orb("cy")!.letGoAt, "Cy was let go");
  await sheet.getByRole("button", { name: "Send Cy to school" }).waitFor();
  assert.deepEqual(await measure(page), [], "the school sheet, opened from a profile, at phone size");
});
