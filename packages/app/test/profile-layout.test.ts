// PLAN 2.28_t and 5.6: the personal page follows Career's hero structure, and Career's social history
// stays in one bounded scroll. This focused suite is also the control for their planted layout defects;
// phones.test.ts still checks the same rooms as part of the app-wide responsive pass.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser } from "playwright-core";
import { Home } from "../../home/src/home.ts";
import { serve, type HomeDoor } from "../../home/src/api.ts";
import { findChrome, launch, measure } from "./harness.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let dist: string;
let data: string;
let home: Home;
let door: HomeDoor;

before(async () => {
  if (skip) return;
  dist = mkdtempSync(join(tmpdir(), "orbs-profile-layout-dist-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: dist, emptyOutDir: true } });
  browser = await launch();
  data = mkdtempSync(join(tmpdir(), "orbs-profile-layout-home-"));
  home = Home.open({ dataDir: data, protect: [], spendCapUsd: null });
  home.start();
  home.about.setName("Robin");
  home.inbox.addOrb("ada", "Ada", "frontend", { shape: "kitty", eyes: "classic", hue: "coral", hat: "beanie" });
  door = await serve(home, { port: 0, appDir: dist });
});

after(async () => {
  await browser?.close();
  await door?.close();
  await home?.close();
  for (const d of [dist, data]) if (d) rmSync(d, { recursive: true, force: true });
});

const open = async (width: number, height: number) => {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: "dark", hasTouch: width <= 760, isMobile: width <= 760 });
  const page = await ctx.newPage();
  await page.goto(door.pairLink().replace("orbs.html", "orbs.html?splash=0"));
  await page.locator(".orbs-window").waitFor({ timeout: 30_000 });
  return { ctx, page };
};

test("the profile uses one Career-like hero, then compact controls and DNA", { skip, timeout: 120_000 }, async () => {
  for (const [width, height] of [[1280, 900], [390, 844]] as const) {
    const { ctx, page } = await open(width, height);
    try {
      await page.evaluate(() => (location.hash = "#/office/Ada"));
      await page.locator("[data-moves]").waitFor({ timeout: 20_000 });
      await page.waitForTimeout(400);
      const [hero, portrait, head, controls, dna, canvas, actions] = await Promise.all([
        "[data-profile-hero]", "[data-profile-portrait]", "[data-sheet-head]", "[data-moves]", "[data-strand-card]",
        "[data-profile-portrait] canvas", "[data-profile-actions]",
      ].map((sel) => page.locator(sel).boundingBox()));
      assert.ok(hero && portrait && head && controls && dna && canvas && actions);
      assert.ok(hero.x <= portrait.x && hero.x <= head.x && portrait.x + portrait.width <= hero.x + hero.width + 1 && head.x + head.width <= hero.x + hero.width + 1, "the orb and identity share the hero");
      if (width > 760) assert.ok(portrait.x + portrait.width <= head.x + 1, "on a desk the orb sits beside its identity, like Career");
      else assert.ok(head.y >= portrait.y + portrait.height - 1, "on a phone the identity follows the portrait in the same hero");
      assert.ok(actions.y >= canvas.y + canvas.height - 1, "Chat and Career sit directly under the orb");
      assert.ok(hero.y + hero.height <= controls.y + 1 && controls.y + controls.height <= dna.y + 1, "the compact controls follow the hero immediately above DNA");
      assert.ok(controls.height < 140, `the state card is compact (${Math.round(controls.height)} px)`);
      assert.deepEqual(await measure(page), [], `the profile fits at ${width} px`);
    } finally {
      await ctx.close();
    }
  }
});

test("Career keeps all of With the others in one bounded scroll", { skip, timeout: 120_000 }, async () => {
  const { ctx, page } = await open(390, 844);
  try {
    await page.evaluate(() => (location.hash = "#/career/Ada"));
    const social = page.getByLabel("With the others, every friend, meeting and lesson");
    await social.waitFor({ timeout: 20_000 });
    const box = await social.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { max: parseFloat(cs.maxHeight), overflow: cs.overflowY };
    });
    assert.ok(box.max <= 0.49 * 844, `With the others is bounded to part of the screen (${box.max} px)`);
    assert.equal(box.overflow, "auto", "friends, meetings and lessons share one vertical scroll");
    assert.equal(await page.getByLabel("With the others").locator(".orbs-tall").count(), 1, "the card has one scroller, not one per list");
    assert.deepEqual(await measure(page), [], "the bounded Career card fits a phone");
  } finally {
    await ctx.close();
  }
});
