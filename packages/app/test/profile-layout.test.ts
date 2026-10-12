// PLAN 2.28_t and 5.6: the personal page follows Career's hero structure (its stats in two, the skills under its DNA on a
// desk), and Career's social history
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
      const [hero, portrait, head, controls, dna, canvas, actions, traits, skills] = await Promise.all([
        "[data-profile-hero]", "[data-profile-portrait]", "[data-sheet-head]", "[data-moves]", "[data-strand-card]",
        "[data-profile-portrait] canvas", "[data-profile-actions]", "[data-sheet-body]", "[data-sheet-skills]",
      ].map((sel) => page.locator(sel).boundingBox()));
      assert.ok(hero && portrait && head && controls && dna && canvas && actions && traits && skills);
      const gap = head.x - (portrait.x + portrait.width);
      if (process.env.ORBS_PRINT) console.log(`${width}: gap ${gap.toFixed(1)}, portrait ${(portrait.y - head.y).toFixed(1)} below the name; skills x ${skills.x} y ${skills.y}, dna x ${dna.x} bottom ${dna.y + dna.height}, traits x ${traits.x} bottom ${traits.y + traits.height}`);
      assert.ok(hero.x <= portrait.x && hero.x <= head.x && portrait.x + portrait.width <= hero.x + hero.width + 1 && head.x + head.width <= hero.x + hero.width + 1, "the orb and identity share the hero");
      if (width > 760) assert.ok(portrait.x + portrait.width <= head.x + 1, "on a desk the orb sits beside its identity, like Career");
      else assert.ok(head.y >= portrait.y + portrait.height - 1, "on a phone the identity follows the portrait in the same hero");
      assert.ok(actions.y >= canvas.y + canvas.height - 1, "Chat and Career sit directly under the orb");
      assert.ok(hero.y + hero.height <= controls.y + 1 && controls.y + controls.height <= dna.y + 1, "the compact controls follow the hero immediately above DNA");
      assert.ok(controls.height < 140, `the state card is compact (${Math.round(controls.height)} px)`);
      if (width > 760) {
        // the orb and its buttons apart from its words and level with its name (owner, 10-10: "move ash and chat + careers
        // buttons a little to the left lol. too close to description and a bit higher"): 48 px apart where they stood 24
        // (the line halfway), the row held to its top where it was centred (a long description left the orb halfway down
        // its words; this office's are short, so the rule itself is read)
        assert.ok(gap >= 36, `the orb ${gap.toFixed(0)} px from its words`);
        assert.equal(await page.locator("[data-profile-head]").evaluate((el) => getComputedStyle(el).alignItems), "flex-start", "level with its name");
        // its skills and the office under its DNA, beside its traits (owner, 10-10: "theres a big open space there with
        // nothing in it, can we split the stats container in two")
        assert.ok(Math.abs(skills.x - dna.x) <= 2 && skills.y >= dna.y + dna.height - 1, "its skills and the office under its DNA, in that column");
        assert.ok(traits.x >= skills.x + skills.width - 1, "its traits in the other column, beside them");
      } else {
        assert.ok(skills.y >= traits.y + traits.height - 1, "on a phone its skills follow its traits, one column");
        // Chat and Career under its level, over what it does (owner, 10-10)
        const [lv, bio] = await Promise.all([page.locator("[data-sheet-head] [data-level]").boundingBox(), page.locator("[data-sheet-head] [data-bio]").boundingBox()]);
        assert.ok(lv && bio && actions.y >= lv.y + lv.height - 1 && actions.y + actions.height <= bio.y + 1, "on a phone Chat and Career under its level, over what it does");
      }
      // its level right under what it is, small, its bar showing (owner, 10-10: "put lv 1 4 cp to lv. smaller and right under
      // where it says lets say the techy personal assistant"): it stood under its age, and centred on a phone its bar was 0 px
      const [titleBox, levelBox, bar] = await Promise.all([page.locator("[data-sheet-head] [data-title]").boundingBox(), page.locator("[data-sheet-head] [data-level]").boundingBox(), page.locator("[data-sheet-head] [data-level] [role=progressbar]").boundingBox()]);
      assert.ok(titleBox && levelBox && bar);
      assert.ok(levelBox.y >= titleBox.y + titleBox.height - 1 && levelBox.y - (titleBox.y + titleBox.height) <= 10, `its level right under its title (${Math.round(levelBox.y - titleBox.y - titleBox.height)} px below)`);
      assert.ok(levelBox.height <= 20 && bar.width >= 60, `small, its bar showing (${Math.round(levelBox.height)} px tall, the bar ${Math.round(bar.width)} px)`);
      // small and square, as a new orb's are (owner, 10-10: "make the chat and career buttons smaller, and square like the new
      // orb page buttons"): a pill's corners were half its height
      const chat = await page.locator("[data-chat-with]").evaluate((el) => ({ r: parseFloat(getComputedStyle(el).borderTopLeftRadius), h: el.getBoundingClientRect().height }));
      assert.ok(chat.r <= 10 && chat.h <= 32, `Chat small and square (${JSON.stringify(chat)})`);
      const moves = await page.locator("[data-shaped] [data-move]").evaluateAll((rows) => rows.map((row) => {
        const [reason, tags] = [...row.children] as HTMLElement[];
        const r = row.getBoundingClientRect(), a = reason!.getBoundingClientRect(), b = tags!.getBoundingClientRect();
        return { height: r.height, reasonTop: a.top, tagsTop: b.top, reasonRight: a.right, tagsLeft: b.left, scroll: row.scrollWidth, width: row.clientWidth };
      }));
      assert.ok(moves.length > 0 && moves.every((m) => m.height <= 18 && Math.abs(m.reasonTop - m.tagsTop) <= 2 && m.reasonRight <= m.tagsLeft + 1 && m.scroll <= m.width + 1), `each thing that shaped it is one fitted line (${JSON.stringify(moves)})`);
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
