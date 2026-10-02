// PLAN 2.4_t (the schedule editor), in a real browser on a real home:
//   - New schedule, from the calendar: who, what, what to do; weekdays at 08:30, previewed in the
//     home's own words with when it runs next; kept, it is the pattern the home runs, on the month.
//   - "Every" offers only even steps, never under 15 minutes; its preview says so.
//   - A schedule is removed from its day. Nothing spills at desk or phone size.
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

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-editor-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

test("a new schedule: weekdays at 08:30 in the home's words, kept as it runs; every N only evenly; removed from its day", { skip, timeout: 150_000 }, async (t) => {
  const data = mkdtempSync(join(tmpdir(), "orbs-editor-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("ada", "Ada", "accountant", { shape: "bean", eyes: "classic", hue: "teal" });
  h.inbox.addOrb("gus", "Gus", "devops", { shape: "bean", eyes: "classic", hue: "amber" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());

  for (const size of [{ width: 1280, height: 1000 }, { width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: size, colorScheme: "dark" });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    await page.goto(d.pairLink());
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
    await page.goto(page.url().replace(/#.*$/, "#/calendar"));
    await page.getByRole("button", { name: "New schedule" }).click();
    const editor = page.getByRole("region", { name: "A new schedule" });
    await editor.waitFor();
    const preview = editor.locator("[data-preview]");
    if (size.width > 1000) {
      await editor.getByRole("button", { name: "Ada" }).click();
      await editor.getByPlaceholder("Inbox sweep").fill("Inbox sweep");
      await editor.getByPlaceholder(/Sort the morning's mail/).fill("Sort the morning's mail, and keep any bill for me.");
      await editor.getByLabel("At", { exact: true }).fill("08:30");
      for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) await editor.getByRole("button", { name: day, exact: true }).click();
      await preview.getByText(/^Weekdays at 08:30 · next /).waitFor({ timeout: 20_000 });
      // every N: only even steps, none under 15 minutes
      await editor.getByRole("button", { name: "Every…" }).click();
      const steps = await editor.getByRole("group", { name: "How often" }).getByRole("button").allInnerTexts();
      assert.deepEqual(steps, ["15 min", "20 min", "30 min", "1 h", "2 h", "3 h", "4 h", "6 h", "8 h", "12 h"]);
      await editor.getByRole("button", { name: "2 h", exact: true }).click();
      await preview.getByText(/^Every 2 hours · next /).waitFor({ timeout: 20_000 });
      await editor.getByRole("button", { name: "At a time" }).click();
      await preview.getByText(/^Weekdays at 08:30/).waitFor({ timeout: 20_000 });
      assert.deepEqual(await measure(page), [], "the editor spills nothing at desk size");
      await editor.getByRole("button", { name: "Keep it" }).click();
      await editor.waitFor({ state: "detached", timeout: 20_000 });
      assert.deepEqual(h.schedules.list().map((s) => [s.orb, s.name, s.cron]), [["ada", "Inbox sweep", "30 8 * * 1,2,3,4,5"]], "the pattern the home runs is the one previewed");
      // on the month: removed from its day
      await page.locator('[data-day]:has([data-entry="schedule"])').first().click(); // a weekday it runs on
      await page.getByRole("button", { name: "Remove the schedule Inbox sweep" }).first().click();
      for (let i = 0; i < 40 && h.schedules.list().length; i++) await new Promise((r) => setTimeout(r, 50));
      assert.equal(h.schedules.list().length, 0);
    } else {
      await preview.getByText(/^Every day at 09:00 · next /).waitFor({ timeout: 20_000 });
      assert.deepEqual(await measure(page), [], "nor at phone size");
    }
  }
});
