// PLAN 5.9_t's view, office life on a real home (its own orbs never wander off: the test makes each
// meeting), with the browser's clock at 10:00 so the floor's orbs are awake whenever it runs:
//   - the app tells the home each orb's traits, as its DNA has them;
//   - a meeting the home decided is played on the floor: the two go to its place together, and the day at a
//     glance says what they are doing;
//   - an orb's profile shows how it gets on with each colleague, and their last moment together;
//   - a lesson a friend offered waits in the notifications, and Keep it is what makes it the other's;
//   - nothing spills at desk or phone size.
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
import { NEUTRAL } from "../../home/src/social/rules.ts";
import { meetPlan } from "../src/floor/plan.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-social-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

test("office life: traits sent, a meeting played on the floor, colleagues on the profile, a lesson kept; desk and phone", { skip, timeout: 150_000 }, async (t) => {
  const data = mkdtempSync(join(tmpdir(), "orbs-social-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("ada", "Ada", "assistant", { shape: "egg", eyes: "classic", hue: "azure" });
  h.inbox.addOrb("bo", "Bo", "frontend", { shape: "bean", eyes: "classic", hue: "coral" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const open = async (size: { width: number; height: number }, hash: string): Promise<Page> => {
    const ctx = await browser.newContext({ viewport: size, colorScheme: "dark" });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    const ten = new Date();
    ten.setHours(10, 0, 0, 0);
    await page.clock.install({ time: ten }); // the floor's orbs are awake from 06:00
    await page.goto(d.pairLink());
    await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
    await page.evaluate((x) => (location.hash = x), hash);
    return page;
  };
  const page = await open({ width: 1280, height: 900 }, "#/office");
  await page.locator("[data-floor]").waitFor({ timeout: 20_000 });

  // the app tells the home each orb's traits (the home cannot read DNA)
  for (let i = 0; i < 100 && JSON.stringify(h.social.traitsOf("bo")) === JSON.stringify(NEUTRAL); i++) await page.waitForTimeout(100);
  assert.notDeepEqual(h.social.traitsOf("bo"), NEUTRAL, "Bo's traits, as its DNA has them");
  assert.equal(Object.values(h.social.traitsOf("ada")).reduce((n, v) => n + v, 0), 70, "seventy points, like every orb's");

  // a meeting the home decided, played on the floor
  const m = h.social.meet()!;
  assert.ok(m, "two free orbs met");
  for (const [id, name] of [["ada", "Ada"], ["bo", "Bo"]] as const) {
    const other = id === m.a ? (m.b === "ada" ? "Ada" : "Bo") : (m.a === "ada" ? "Ada" : "Bo");
    await page.waitForFunction(
      ({ name, where }) => {
        const b = document.querySelector(`[data-floor-orb="${name}"]`);
        return b?.getAttribute("data-at") === where && b?.getAttribute("data-arrived") === "true";
      },
      { name, where: `meet:${m.place}:${other}` },
      { timeout: 60_000 },
    );
    const label = meetPlan({ ...m, a: m.a === "ada" ? "Ada" : "Bo", b: m.b === "ada" ? "Ada" : "Bo", winner: null }, name).label;
    assert.match(await page.locator("[data-floor]").innerText(), new RegExp(label), `${name}: ${label}`);
  }
  assert.deepEqual(await measure(page), [], "the floor, with a meeting on it");

  // the profile: how Ada gets on with Bo, and their last moment
  for (let i = 0; i < 40; i++) h.social.meet(); // a few more meetings: a friendship with a word
  await page.evaluate(() => (location.hash = "#/office/Ada"));
  const bo = page.locator('[data-colleagues] [data-friend="Bo"]');
  await bo.waitFor({ timeout: 20_000 });
  const word = h.social.of("ada")[0]!.word;
  assert.match(await bo.innerText(), new RegExp(`Bo\\s+${word.charAt(0).toUpperCase() + word.slice(1)}[\\s\\S]*(coffee|ideas|ping-pong|arcade|lesson)[\\s\\S]*·`, "i"));
  await page.waitForTimeout(400);
  assert.deepEqual(await measure(page), [], "the profile with its colleagues, at desk size");
  const phone = await open({ width: 390, height: 844 }, "#/office/Ada");
  await phone.locator('[data-colleagues] [data-friend="Bo"]').waitFor({ timeout: 20_000 });
  await phone.waitForTimeout(400);
  assert.deepEqual(await measure(phone), [], "and at phone size");

  // a lesson a friend offered: Keep it makes it Bo's
  h.social.setTraits("ada", { ...NEUTRAL, Humour: 15, Care: 15 });
  h.social.setTraits("bo", { ...NEUTRAL, Humour: 15, Care: 15 });
  h.learned.add("ada", "Say the price first, then the reasons.");
  for (let i = 0; i < 400 && !h.social.lessons().length; i++) h.social.meet();
  const lesson = h.social.lessons()[0]!;
  assert.ok(lesson, "friends, and Ada had a lesson Bo lacks");
  await page.evaluate(() => (location.hash = "#/notices"));
  const note = page.locator('[data-notice="learning"]');
  await note.waitFor({ timeout: 20_000 });
  const learner = lesson.to === "bo" ? "Bo" : "Ada";
  assert.match(await note.innerText(), new RegExp(`${learner} could learn this from ${learner === "Bo" ? "Ada" : "Bo"}`));
  assert.ok(!h.learned.list(lesson.to).includes(lesson.line), "not before your yes");
  await note.getByRole("button", { name: "Keep it" }).click();
  await note.waitFor({ state: "detached", timeout: 20_000 });
  assert.ok(h.learned.list(lesson.to).includes(lesson.line), "Keep it: learned");
});
