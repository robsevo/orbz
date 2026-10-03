// PLAN 3.5_t and 3.8_t in the app, on a real home with three days of an orb's work behind it:
//   - The morning card shows yesterday's split, its cost, what he learned and the habit the night
//     made, each a tap from being taken back; taken back, it is gone from the card and the home.
//   - A promotion the night proposed waits as a notice; Promote gives the level the evidence names.
//   - Nothing spills at phone or desk size.
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
import { levelOf } from "../../home/src/gym/levels.ts";
import { approved } from "../../home/test/fixtures/bills.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-morning-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

const HABIT = "dana|trigger:t1|read_file>remind {subject}";

test("the morning card: yesterday's split, its cost, what he learned and the night's habit, each taken back in a tap; a promotion given", { skip, timeout: 120_000 }, async (t) => {
  const clock = new FakeClock(new Date(2026, 8, 29, 9, 0).getTime()); // three days of work, then the morning
  const data = mkdtempSync(join(tmpdir(), "orbs-morning-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null, clock });
  t.after(() => h.close());
  h.about.setName("Robin");
  h.inbox.addOrb("dana", "Dana", "data", { shape: "bean", eyes: "classic", hue: "teal" }, "Junior"); // hired a Junior, so her promotion is to Mid
  for (let day = 0; day < 3; day++) {
    approved(h.events, "dana", ["Rent", "Gym", "Water", "Phone", "Car"].map((s) => `${s} ${day}`), 100 + day * 10);
    if (day < 2) clock.suspend(86_400_000);
  }
  // yesterday (1 Oct): two answered by a habit, a lesson kept, what the big brain cost
  h.events.append("ladder.answered", { kind: HABIT, tier: "habit", run: 900 }, { orb: "dana" });
  h.events.append("ladder.answered", { kind: HABIT, tier: "habit", run: 901 }, { orb: "dana" });
  h.events.append("brain.spend", { tier: "big", cost_usd: 0.0123, prompt_tokens: 900, completion_tokens: 100 }, { orb: "dana" });
  h.learned.add("dana", "Invoices go out on the 1st.");
  clock.suspend(86_400_000); // 2 Oct, 09:00: last night made a habit, and Dana is ready for Mid
  h.events.append("habit.promoted", { kind: HABIT, task: "dana|trigger:t1|{subject}", version: 1, runs: [120, 121, 122] }, { orb: "dana" });
  assert.deepEqual((await h.gym.night()).proposed, ["dana"], "control: the evidence is there");
  h.start();

  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const device = async (size: { width: number; height: number }): Promise<Page> => {
    const ctx = await browser.newContext({ viewport: size, colorScheme: "dark" });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    await page.goto(d.pairLink());
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
    await page.goto(page.url().replace(/#.*$/, "#/notices"));
    return page;
  };
  const desk = await device({ width: 1280, height: 900 });
  const card = desk.locator('[data-morning="2026-10-01"]');
  await card.waitFor({ timeout: 20_000 });
  const dana = card.locator('[data-morning-orb="dana"]');
  const words = await dana.innerText();
  assert.match(words, /Dana[\s\S]*\$0\.0123 · 1,000 tokens/);
  assert.match(words, /2 by habit · 0 by his own brain · 5 by the big brain/, "yesterday's split, as the log has it");
  assert.match(words, /Learned: “Invoices go out on the 1st\.”/);
  assert.match(words, /A new habit: A trigger \(t1\): read file, then remind/);
  assert.deepEqual(await desk.locator("[data-split]").evaluateAll((els) => els.map((e) => e.getAttribute("data-split"))), ["habits", "big"]);
  assert.deepEqual(await measure(desk), [], "nothing spills at desk size");
  const phone = await device({ width: 390, height: 844 });
  await phone.locator('[data-morning="2026-10-01"]').waitFor({ timeout: 20_000 });
  assert.deepEqual(await measure(phone), [], "nor at phone size");

  // the promotion first (the habit is part of its evidence), then the takes-back
  const promotion = desk.locator('[data-notice="promotion"]');
  assert.match(await promotion.innerText(), /Dana is ready for Mid[\s\S]*Ready for promotion/);
  await promotion.getByRole("button", { name: "Promote" }).click();
  await promotion.waitFor({ state: "detached", timeout: 20_000 });
  assert.equal(levelOf(h.events, "dana"), "Mid");
  await desk.goto(desk.url().replace(/#.*$/, "#/office/Dana"));
  await desk.getByText(/^Mid · 33\d XP · /).waitFor({ timeout: 20_000 }); // her card says where she stands, from the home
  await desk.getByText("Age 3 days · 3 days in the company", { exact: true }).waitFor({ timeout: 20_000 }); // made on the 29th, read on the 2nd
  await phone.goto(phone.url().replace(/#.*$/, "#/office/Dana"));
  await phone.getByText("Age 3 days · 3 days in the company", { exact: true }).waitFor({ timeout: 20_000 });
  assert.deepEqual(await measure(phone), [], "her card's lines fit a phone");
  await desk.goto(desk.url().replace(/#.*$/, "#/notices"));
  await card.waitFor({ timeout: 20_000 });

  const takeBack = (what: RegExp) => dana.locator("div", { hasText: what }).last().getByRole("button", { name: "Take back" });
  await takeBack(/^A new habit/).click();
  await dana.getByText(/A new habit/).waitFor({ state: "detached", timeout: 20_000 });
  assert.equal(h.events.ofType("habit.undone").length, 1, "taken back on the home");
  await takeBack(/^Learned/).click();
  await dana.getByText(/Learned:/).waitFor({ state: "detached", timeout: 20_000 });
  assert.deepEqual(h.learned.list("dana"), []);
});
