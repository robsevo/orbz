// PLAN 4.4_t's view, on a real home with the real kit: his lesson on his own canvas, in his
// computer's Lesson tab. The tab opens when the lesson begins; each step is the canvas's caption
// and its drawing; Next moves on (the canvas changes); your answer, which this brain cannot judge,
// gets the hint and no praise; Tell me answers it from the drawing; Stop ends it and the tab goes.
// Nothing spills at phone size.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test, type TestContext } from "node:test";
import { build } from "vite";
import type { Browser, Frame, Page } from "playwright-core";
import { findChrome, launch, measure } from "./harness.ts";
import { Home } from "../../home/src/home.ts";
import { serve } from "../../home/src/api.ts";
import { fakeModel } from "../../home/test/fakes/model.ts";

const LONG = { timeout: 180_000 };
const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-lesson-view-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
});
after(async () => {
  await browser?.close();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

async function onHome(t: TestContext, size: { width: number; height: number }) {
  const model = await fakeModel(t, []);
  const data = mkdtempSync(join(tmpdir(), "orbs-lesson-view-home-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const h = Home.open({
    dataDir: data, protect: [], spendCapUsd: null, kit: true,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
  });
  t.after(() => h.close());
  h.start();
  h.about.setName("Robin");
  h.inbox.addOrb("hazel", "Hazel", "data", { shape: "bean", eyes: "classic", hue: "amber" });
  const d = await serve(h, { port: 0, appDir: dist });
  t.after(() => d.close());
  const ctx = await browser.newContext({ viewport: size, colorScheme: "dark" });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.goto(d.pairLink());
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 }); // the app is up (at phone size the side menu, with the CEO badge, is folded away)
  await page.evaluate(() => (location.hash = "#/chat/hazel"));
  await page.locator('[data-stream="open"]').waitFor({ timeout: 20_000 });
  return { h, page };
}

/** The canvas's frame, once its API is up, and what it shows now. */
const canvas = async (page: Page): Promise<Frame> => {
  const el = await page.locator("[data-lesson] iframe").elementHandle({ timeout: 20_000 });
  const f = (await el!.contentFrame())!;
  await f.waitForFunction(() => Boolean((globalThis as { teach?: { ready?: boolean } }).teach?.ready), undefined, { timeout: 20_000 });
  return f;
};
const facts = (f: Frame): Promise<{ caption: string; groups: unknown[]; parent: Record<string, number> }> =>
  f.evaluate(() => (globalThis as unknown as { teach: { facts: () => { caption: string; groups: unknown[]; parent: Record<string, number> } } }).teach.facts());

test("his lesson in the Lesson tab: each step on the canvas, Next, an unjudged answer gets the hint, Tell me, Stop", { skip, ...LONG }, async (t) => {
  const { h, page } = await onHome(t, { width: 1280, height: 900 });
  const computer = page.locator('[data-computer="hazel"]');
  assert.equal(await computer.getByRole("tab", { name: "Lesson" }).count(), 0, "no lesson, no tab");
  const started = await h.lessons.start("hazel", "union find");
  assert.ok("lesson" in started);
  await computer.getByRole("tab", { name: "Lesson", selected: true }).waitFor({ timeout: 20_000 }); // it opens when the lesson begins
  const f = await canvas(page);
  await page.locator("[data-step]", { hasText: "Step 1 of 5" }).waitFor();
  await f.waitForFunction(() => ((globalThis as unknown as { teach: { facts: () => { groups: unknown[] } } }).teach.facts().groups.length === 8), undefined, { timeout: 20_000 });
  assert.match((await facts(f)).caption, /Eight items/, "the step's words are the canvas's caption");

  await page.getByRole("button", { name: "Next" }).click();
  await page.locator("[data-step]", { hasText: "Step 2 of 5" }).waitFor({ timeout: 20_000 });
  await f.waitForFunction(() => ((globalThis as unknown as { teach: { facts: () => { groups: unknown[] } } }).teach.facts().groups.length === 7), undefined, { timeout: 20_000 });

  await page.getByLabel("Your answer").fill("the one being pointed at");
  await page.getByRole("button", { name: "Answer" }).click();
  const said = page.locator("[data-said]");
  await said.waitFor({ timeout: 60_000 });
  assert.equal(await said.getAttribute("data-said"), "unjudged", "this brain gave no verdict");
  assert.match(await said.innerText(), /couldn't check/i);
  assert.doesNotMatch(await said.innerText(), /spot on|exactly|correct!/i, "and it is never praise");

  await page.getByRole("button", { name: "Tell me" }).click();
  await page.locator("[data-said]", { hasText: /is the root/ }).waitFor({ timeout: 20_000 });

  await page.getByRole("button", { name: "Stop" }).click();
  await computer.getByRole("tab", { name: "Lesson" }).waitFor({ state: "detached", timeout: 20_000 });
  assert.equal(h.lessons.current("hazel"), null);
});

test("the Lesson tab fits a phone", { skip, ...LONG }, async (t) => {
  const { h, page } = await onHome(t, { width: 390, height: 844 });
  await h.lessons.start("hazel", "union find");
  const computer = page.locator('[data-computer="hazel"]');
  await computer.getByRole("tab", { name: "Lesson", selected: true }).waitFor({ timeout: 20_000 });
  await canvas(page);
  await page.locator("[data-step]", { hasText: "Step 1 of 5" }).waitFor();
  assert.deepEqual(await measure(page), [], "nothing spills at phone size");
});
