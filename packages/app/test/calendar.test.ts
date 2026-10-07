// PLAN 2.12_t, the calendar in the app, on a real home, this month:
//   - The month, Monday first, holds the bills and reminders on their days and every schedule's
//     runs (the daily one on every day), each in its orb's colour.
//   - The day you pick lists what is on it; a bill moved there is moved on the home (your own
//     change: at once), and the month shows it on its new day.
//   - A schedule given another time there is the schedule the home runs; paused there, it pauses.
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
  dist = mkdtempSync(join(tmpdir(), "orbs-calendar-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

const pad = (n: number): string => String(n).padStart(2, "0");
const now = new Date();
const thisMonth = (d: number): string => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(d)}`;
const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

test("the calendar: a month of bills and schedules, a bill moved, a schedule's time and pause the home's own", { skip, ...LONG }, async (t) => {
  const data = mkdtempSync(join(tmpdir(), "orbs-calendar-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("ada", "Ada", "accountant", { shape: "bean", eyes: "classic", hue: "teal" });
  h.inbox.addOrb("gus", "Gus", "devops", { shape: "bean", eyes: "classic", hue: "amber" });
  const rent = h.notices.remind({ orb: "ada", kind: "bill", title: "Rent", due: thisMonth(10), amount: "$1,200" });
  h.notices.remind({ orb: "ada", kind: "reminder", title: "Dentist", due: `${thisMonth(20)}T15:00` });
  const digest = h.schedules.add({ orb: "gus", name: "Morning digest", cron: "30 7 * * *", instruction: "Summarise the night" });

  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.getByText("Founder Robin").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  assert.equal(await page.evaluate(() => location.hash), "#/calendar");
  await page.locator(`[data-month="${thisMonth(1).slice(0, 7)}"]`).waitFor();
  const cells = await page.locator("[data-day]").count();
  assert.ok(cells % 7 === 0 && cells >= 28, `whole weeks (${cells} days)`);
  assert.equal(await page.locator("[data-day]").first().evaluate((el) => new Date(`${el.getAttribute("data-day")}T00:00`).getDay()), 1, "Monday first");
  const day = (n: number) => page.locator(`[data-day="${thisMonth(n)}"]`);
  await day(10).locator('[data-entry="bill"]').waitFor({ timeout: 20_000 });
  assert.match(await day(10).innerText(), /Rent/);
  assert.match(await day(20).innerText(), /15:00 Dentist/);
  for (let n = 1; n <= daysIn; n++) assert.match(await day(n).innerText(), /07:30 Morning digest/, `the digest on day ${n}`);
  assert.deepEqual(await measure(page), [], "nothing spills at desk size");

  // the day you pick: move the rent (your own change: at once)
  await day(10).click();
  const agenda = page.locator(`[data-agenda="${thisMonth(10)}"]`);
  await agenda.locator('[data-item="bill"]').waitFor();
  assert.match(await agenda.innerText(), /Rent[\s\S]*Ada · bill, \$1,200/);
  await agenda.getByLabel("Move Rent to").fill(thisMonth(12));
  for (let i = 0; i < 40 && h.notices.reminder(rent.id)!.due !== thisMonth(12); i++) await page.waitForTimeout(50);
  assert.equal(h.notices.reminder(rent.id)!.due, thisMonth(12), "moved on the home");
  await day(12).locator('[data-entry="bill"]').waitFor({ timeout: 20_000 });
  assert.equal(await day(10).locator('[data-entry="bill"]').count(), 0, "and off its old day");

  // a schedule's time and pause are the home's own schedule's
  const when = agenda.getByLabel("When Morning digest runs");
  await when.fill("06:45"); // kept once you stop changing it
  for (let i = 0; i < 40 && h.schedules.get(digest.id)!.cron !== "45 6 * * *"; i++) await page.waitForTimeout(50);
  assert.equal(h.schedules.get(digest.id)!.cron, "45 6 * * *", "the schedule the home runs");
  await day(3).locator('[data-entry="schedule"]', { hasText: "06:45 Morning digest" }).waitFor({ timeout: 20_000 });
  await agenda.getByRole("button", { name: "Pause" }).click();
  for (let i = 0; i < 40 && h.schedules.get(digest.id)!.enabled; i++) await page.waitForTimeout(50);
  assert.equal(h.schedules.get(digest.id)!.enabled, false, "paused on the home");
  await agenda.getByRole("button", { name: "Resume" }).waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page), [], "nor at phone size");
});
