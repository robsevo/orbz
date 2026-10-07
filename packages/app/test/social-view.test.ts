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
import { meetPlan, momentPlan } from "../src/floor/plan.ts";

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

  // back and forth (owner, 10-06: "every time i go back and forth if two orbs are interacting or playing a game
  // the animation restarts"): a meeting under way for a while is shown where it is, never walked to again
  for (let i = 0; i < 200 && Date.now() - m.at <= 12_500; i++) await page.waitForTimeout(100);
  await page.evaluate(() => (location.hash = "#/calendar"));
  await page.waitForTimeout(800);
  await page.evaluate(() => (location.hash = "#/office"));
  const where = `meet:${m.place}:${m.b === "ada" ? "Ada" : "Bo"}`;
  const first = await page.waitForFunction(
    ({ name, where }) => {
      const b = document.querySelector(`[data-floor-orb="${name}"]`);
      return b?.getAttribute("data-at") === where ? b.getAttribute("data-arrived") : null; // the first moment it is the meeting's
    },
    { name: m.a === "ada" ? "Ada" : "Bo", where },
    { timeout: 20_000, polling: "raf" },
  );
  assert.equal(await first.jsonValue(), "true", "back in the office: already at the meeting, not walking to it again");

  // the profile: how Ada gets on with Bo, and their last moment
  for (let i = 0; i < 40; i++) h.social.meet(); // a few more meetings: a friendship with a word
  await page.evaluate(() => (location.hash = "#/office/Ada"));
  const bo = page.locator('[data-colleagues] [data-friend="Bo"]');
  await bo.waitFor({ timeout: 20_000 });
  const word = h.social.of("ada")[0]!.word;
  const says = new RegExp(`Bo\\s+${word.charAt(0).toUpperCase() + word.slice(1)}[\\s\\S]*(coffee|ideas|ping-pong|arcade|lesson)[\\s\\S]*·`, "i");
  // the row is there before the forty meetings' word reaches it (a busy gate showed "Colleagues" a moment): wait for the word
  await page.waitForFunction((src) => new RegExp(src, "i").test((document.querySelector('[data-colleagues] [data-friend="Bo"]') as HTMLElement | null)?.innerText ?? ""), says.source, { timeout: 20_000 }).catch(() => undefined);
  assert.match(await bo.innerText(), says);
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

test("a moment on the floor (owner, 10-07: \"micro interactions ... goofy and funny as well. fun to watch\"): the two meet at its spot, each says its line, the feed has it, their friendship moved; desk", { skip, timeout: 150_000 }, async (t) => {
  const data = mkdtempSync(join(tmpdir(), "orbs-moment-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({ dataDir: data, protect: [], spendCapUsd: null });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("ada", "Ada", "assistant", { shape: "egg", eyes: "classic", hue: "azure" });
  h.inbox.addOrb("bo", "Bo", "frontend", { shape: "bean", eyes: "classic", hue: "coral" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  const ten = new Date();
  ten.setHours(10, 0, 0, 0);
  await page.clock.install({ time: ten }); // the floor's orbs are awake from 06:00
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  await page.evaluate(() => (location.hash = "#/office"));
  await page.locator("[data-floor]").waitFor({ timeout: 20_000 });
  // every line said on the floor, kept as it is said: a line stays five seconds, and in a busy gate both orbs' walks can
  // take longer than that (10-07: red in a full gate, green alone), so the lines are looked for in what was said
  await page.evaluate(() => {
    const said: string[] = ((window as unknown as { said: string[] }).said = []);
    new MutationObserver(() => {
      document.querySelectorAll("[data-speech]").forEach((el) => {
        if (el.textContent && !said.includes(el.textContent)) said.push(el.textContent);
      });
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  const before = h.social.score("ada", "bo");
  const mo = h.social.moment()!;
  assert.ok(mo, "two free orbs ran into each other");
  assert.equal(h.social.score("ada", "bo"), before + mo.delta, "their friendship moved by the moment's delta");
  const name = (id: string): string => (id === "ada" ? "Ada" : "Bo");
  const shown = { ...mo, a: name(mo.a), b: name(mo.b) };
  for (const who of ["Ada", "Bo"]) {
    const plan = momentPlan(shown, who);
    await page.waitForFunction(
      ({ who, where }) => {
        const b = document.querySelector(`[data-floor-orb="${who}"]`);
        return b?.getAttribute("data-at") === where && b?.getAttribute("data-arrived") === "true";
      },
      { who, where: `meet:${plan.place}:${plan.with}` },
      { timeout: 60_000 },
    );
    assert.match(await page.locator("[data-floor]").innerText(), new RegExp(plan.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${who}: ${plan.label}`);
  }
  // each says its line there, the second a beat after the first
  for (const line of mo.lines) {
    await page.waitForFunction((line) => (window as unknown as { said: string[] }).said.includes(line), line, { timeout: 30_000 });
  }
  assert.match(await page.locator('[aria-label="Activity"]').innerText(), new RegExp(`${name(mo.a)}: “`), "the feed has it");
  assert.deepEqual(await measure(page), [], "the floor, with a moment on it");
});

