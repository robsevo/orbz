// PLAN 2.5_t, the first open, played in Chromium (owner, 10-01: "we should start with only 1 orb,
// the one we make at the beginning"):
//   - It shows on a first open only, after the splash, told by your first orb: a plain bean with
//     no name yet.
//   - His words type out (with soft blips, when sounds are on), and a press finishes or moves on.
//   - He will not go on without a name; your name is used from then on.
//   - The CEO card carries it. "Make me" opens the creator on him, "Surprise me" rolls him; the
//     office then holds him and only him.
//   - The sidebar calls you CEO; a reload does not play it again.
//   - After the CEO badge, what he thinks with (owner, 10-02: ChatGPT, a Gemini key, a local coder
//     if wanted), then you make him; skipping the story never skips that.
//   - "Skip the story" still asks for your name. The layout rule holds on every beat.
//   - `?intro=0` skips it (the control the other render checks rely on).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { findChrome, launch, measure, serveDir, SIZES } from "./harness.ts";
import { checkName, line, NEWBORN_PLATE, STORY } from "../src/onboarding/story.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let site: { url: string; close(): Promise<void> };
let out: string;

before(async () => {
  if (skip) return;
  out = mkdtempSync(join(tmpdir(), "orbs-intro-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
  site = await serveDir(out);
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await site?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

type Played = { sound: string };
async function open(size: keyof typeof SIZES = "desk", query = "?splash=0"): Promise<Page> {
  const ctx = await browser.newContext({ viewport: SIZES[size], colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.addInitScript(() => ((globalThis as { __orbsSounds?: Played[] }).__orbsSounds = []));
  await page.goto(`${site.url}/orbs.html${query}`);
  return page;
}
const beat = (p: Page) => p.locator("[data-onboarding]").getAttribute("data-onboarding");
/** Presses on until the story reaches a beat of this kind. */
async function until(p: Page, kind: string, max = 40): Promise<void> {
  for (let n = 0; n < max && (await beat(p)) !== kind; n++) {
    await p.keyboard.press("Enter");
    await p.waitForTimeout(60);
  }
  assert.equal(await beat(p), kind, `reached ${kind}`);
}

test("the story's lines: a name is needed, and the person's name is in what is said after", () => {
  assert.equal(checkName("   ").ok, false);
  assert.deepEqual(checkName("  Robin   Hood "), { ok: true, name: "Robin Hood" });
  assert.equal(checkName("x".repeat(30)).ok, false, "a nameplate has room for 24");
  const asked = STORY.findIndex((b) => b.kind === "ask-name");
  assert.ok(asked > 0 && STORY.slice(asked).some((b) => b.kind === "say" && b.text.includes("{name}")), "said with the name, after asking it");
  assert.ok(STORY.slice(0, asked).every((b) => b.kind !== "say" || !b.text.includes("{name}")), "never before it is known");
  assert.ok(STORY.some((b) => b.kind === "say" && /CEO/.test(b.text)) && STORY.some((b) => b.kind === "ceo"), "you are made CEO");
  assert.ok(STORY.every((b) => b.kind !== "say" || b.who === "new"), "told by your first orb, and no one else (there is no one else yet)");
  const at = (k: string) => STORY.findIndex((b) => b.kind === k);
  assert.ok(at("ceo") < at("brains") && at("brains") < at("hire"), "after the CEO badge, the brains; then you make him (owner, 10-02)");
  assert.equal(line("So, {name}, ...", { name: "Robin" }), "So, Robin, ...");
});

test("a first open plays the story: your first orb asks your name, makes you CEO, and you make him", { skip }, async () => {
  const page = await open();
  try {
    await page.locator("[data-onboarding]").waitFor();
    assert.equal(await beat(page), "say");
    assert.match(await page.locator("[data-onboarding]").innerText(), new RegExp(NEWBORN_PLATE), "his nameplate, before he has a name");
    await page.waitForTimeout(600);
    assert.ok((await page.evaluate(() => (globalThis as { __orbsSounds?: Played[] }).__orbsSounds!)).some((s) => s.sound === "blip"), "his words blip as they type");
    await until(page, "ask-name");
    // no name, no going on
    await page.getByRole("button", { name: "That's me" }).click();
    assert.equal(await page.getByText("I need something to call you.").count(), 1);
    assert.equal(await beat(page), "ask-name");
    await page.getByRole("textbox", { name: "Your name" }).fill("Robin");
    await page.getByRole("button", { name: "That's me" }).click();
    await page.keyboard.press("Enter"); // finish typing the next line
    await page.waitForTimeout(100);
    assert.match(await page.locator("[data-onboarding]").innerText(), /Robin\. Nice\./);
    await until(page, "ceo");
    assert.match(await page.locator("[data-ceo]").innerText(), /CEO[\s\S]*Robin/);
    // then what he thinks with (owner, 10-02); with no home behind the page it says where to choose them
    await until(page, "brains");
    assert.match(await page.locator("[data-brains-step]").innerText(), /in Settings once this app is connected to your home/);
    await page.getByRole("button", { name: "Next" }).click();
    await until(page, "hire");
    await page.getByRole("button", { name: "Make me" }).click();
    await page.locator("[data-onboarding]").waitFor({ state: "detached" });
    // the creator, on him: no name yet, so not yet created
    assert.equal(await page.getByRole("tablist").count(), 1, "the creator");
    assert.equal(await page.getByRole("textbox", { name: "Name" }).inputValue(), "", "he has no name until you give him one");
    assert.equal(await page.getByRole("button", { name: /^Create/ }).isDisabled(), true);
    await page.getByRole("textbox", { name: "Name" }).fill("Pip");
    await page.getByRole("button", { name: "Create Pip" }).click();
    await page.getByRole("heading", { name: "Pip" }).waitFor();
    assert.deepEqual(await page.locator("aside button[data-orb] span span:first-child").allTextContents(), ["Pip"], "the office: him, and only him");
    assert.equal(await page.getByText("Founder Robin").count(), 1, "and the office knows its Founder (owner, 10-07)");
    await page.reload();
    await page.waitForSelector("canvas", { state: "attached" });
    assert.equal(await page.locator("[data-onboarding]").count(), 0, "a second open does not play it again");
    assert.equal(await page.getByRole("heading", { name: "Pip" }).count(), 1, "and he is still there");
  } finally {
    await page.context().close();
  }
});

test("'Surprise me' rolls him, ready to create", { skip }, async () => {
  const page = await open();
  try {
    await page.getByRole("button", { name: "Skip the story" }).click();
    await page.getByRole("textbox", { name: "Your name" }).fill("Sam");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Skip the story" }).click();
    await page.getByRole("button", { name: "Next" }).click(); // the brains: a skip never skips them
    await until(page, "hire");
    await page.getByRole("button", { name: "Surprise me" }).click();
    await page.locator("[data-onboarding]").waitFor({ state: "detached" });
    assert.notEqual(await page.getByRole("textbox", { name: "Name" }).inputValue(), "", "the dice named him");
    assert.equal(await page.getByRole("button", { name: /^Create/ }).isDisabled(), false);
  } finally {
    await page.context().close();
  }
});

test("'Skip the story' still asks what to call you, then lets you in", { skip }, async () => {
  const page = await open();
  try {
    await page.getByRole("button", { name: "Skip the story" }).click();
    assert.equal(await beat(page), "ask-name");
    await page.getByRole("textbox", { name: "Your name" }).fill("Sam");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Skip the story" }).click();
    assert.equal(await beat(page), "brains", "skipping the story never skips choosing what he thinks with");
    await page.getByRole("button", { name: "Next" }).click();
    await until(page, "hire");
    await page.getByRole("button", { name: "Make me" }).click();
    await page.locator("[data-onboarding]").waitFor({ state: "detached" });
    assert.equal(await page.getByText("Founder Sam").count(), 1);
    assert.equal(await page.getByRole("tablist").count(), 1, "in the creator, making him");
  } finally {
    await page.context().close();
  }
});

test("the music (owner, 10-02): from the first press, off with its own switch or the sounds', over with the story", { skip, timeout: 90_000 }, async () => {
  type Bars = { bar: number; at: number }[];
  const bars = (p: Page) => p.evaluate(() => (globalThis as { __orbsMusic?: Bars }).__orbsMusic!.length);
  const ctx = await browser.newContext({ viewport: SIZES.desk, colorScheme: "dark" });
  const page = await ctx.newPage();
  try {
    await page.addInitScript(() => ((globalThis as { __orbsMusic?: Bars }).__orbsMusic = []));
    await page.goto(`${site.url}/orbs.html?splash=0`);
    await page.locator("[data-onboarding]").waitFor();
    await page.waitForTimeout(400);
    assert.equal(await bars(page), 0, "nothing before a press: a browser plays nothing before one");
    await page.locator("[data-onboarding]").click({ position: { x: 200, y: 300 } });
    await page.waitForFunction(() => ((globalThis as { __orbsMusic?: Bars }).__orbsMusic?.length ?? 0) > 0, null, { timeout: 5000 });
    const toggle = page.locator("button[data-music]");
    assert.equal(await toggle.getAttribute("aria-pressed"), "true");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    const stopped = await bars(page);
    await page.waitForTimeout(3200); // more than a bar at 96 a minute
    assert.equal(await bars(page), stopped, "off: no bar more");
    await toggle.click();
    await page.waitForFunction((n) => ((globalThis as { __orbsMusic?: Bars }).__orbsMusic?.length ?? 0) > n, stopped, { timeout: 5000 });
    // over with the story
    await page.getByRole("button", { name: "Skip the story" }).click();
    await page.getByRole("textbox", { name: "Your name" }).fill("Sam");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Skip the story" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await until(page, "hire");
    await page.getByRole("button", { name: "Make me" }).click();
    await page.locator("[data-onboarding]").waitFor({ state: "detached" });
    const ended = await bars(page);
    await page.waitForTimeout(3200);
    assert.equal(await bars(page), ended, "the story over: the music is too");
  } finally {
    await ctx.close();
  }
  // with the sounds off, none at all
  const quiet = await browser.newContext({ viewport: SIZES.desk, colorScheme: "dark" });
  const hush = await quiet.newPage();
  try {
    await hush.addInitScript(() => {
      localStorage.setItem("orbs.sounds", "off");
      (globalThis as { __orbsMusic?: Bars }).__orbsMusic = [];
    });
    await hush.goto(`${site.url}/orbs.html?splash=0`);
    await hush.locator("[data-onboarding]").click({ position: { x: 200, y: 300 } });
    await hush.waitForTimeout(1500);
    assert.equal(await bars(hush), 0, "sounds off: no music");
  } finally {
    await quiet.close();
  }
});

test("with sounds off, he types in silence", { skip }, async () => {
  const ctx = await browser.newContext({ viewport: SIZES.desk, colorScheme: "dark" });
  const page = await ctx.newPage();
  try {
    await page.addInitScript(() => {
      localStorage.setItem("orbs.sounds", "off");
      (globalThis as { __orbsSounds?: Played[] }).__orbsSounds = [];
    });
    await page.goto(`${site.url}/orbs.html?splash=0`);
    await page.locator("[data-onboarding]").waitFor();
    await page.waitForTimeout(700);
    assert.deepEqual(await page.evaluate(() => (globalThis as { __orbsSounds?: Played[] }).__orbsSounds!), []);
  } finally {
    await ctx.close();
  }
});

for (const size of ["phone", "desk"] as const) {
  test(`the layout rule holds on every beat, at ${size} size`, { skip }, async () => {
    const page = await open(size);
    try {
      await page.locator("[data-onboarding]").waitFor();
      const seen = new Set<string>();
      for (let n = 0; n < 40; n++) {
        const b = (await beat(page))!;
        if (!seen.has(b)) {
          seen.add(b);
          await page.waitForTimeout(800);
          assert.deepEqual(await measure(page), [], `on a ${b} beat`);
        }
        if (b === "hire") break;
        if (b === "ask-name") {
          await page.getByRole("textbox", { name: "Your name" }).fill("Robin");
          await page.keyboard.press("Enter");
        } else if (b === "brains") await page.getByRole("button", { name: "Next" }).click(); // it waits for its own answer
        else await page.keyboard.press("Enter");
        await page.waitForTimeout(40);
      }
      assert.deepEqual([...seen].sort(), ["ask-name", "brains", "ceo", "hire", "say"]);
    } finally {
      await page.context().close();
    }
  });
}

test("?intro=0 skips it", { skip }, async () => {
  const page = await open("desk", "?splash=0&intro=0");
  try {
    await page.waitForSelector("canvas", { state: "attached" });
    assert.equal(await page.locator("[data-onboarding]").count(), 0);
  } finally {
    await page.context().close();
  }
});
