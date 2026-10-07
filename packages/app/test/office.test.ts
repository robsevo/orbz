// PLAN 2.2_t, the office as rendered (owner, 2026-10-01: "call it the office ... once an orb is
// created, he can be deleted, but not edited"). The page opens on an orb in the office, fixed: no
// name to type, no tabs, no dice. A new orb is made in the creator and joins the office when
// created; a name that is empty or taken stops him. Letting him go asks first, and "Keep him" keeps him.
// And the layout rule holds everywhere, in both themes, at a phone's size and a desk's, on every
// tab: nothing scrolls sideways, spills, or is left alone on a row.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { choose, findChrome, launch, measure, profile, seedOffice, serveDir, SIZES } from "./harness.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let site: { url: string; close(): Promise<void> };
let out: string;

before(async () => {
  if (skip) return;
  out = mkdtempSync(join(tmpdir(), "orbs-office-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
  site = await serveDir(out);
  browser = await launch();
});

after(async () => {
  await browser?.close();
  await site?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

async function open(size: keyof typeof SIZES = "desk", theme: "dark" | "light" = "dark", o: { floor?: boolean } = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: SIZES[size], deviceScaleFactor: 1, colorScheme: theme });
  await seedOffice(page); // a full office to look round (an office starts with one orb now)
  await page.addInitScript(() => {
    (globalThis as { __orbsTime?: number }).__orbsTime = 3.4;
  });
  await page.goto(`${site.url}/orbs.html?splash=0&intro=0`);
  await page.waitForSelector("canvas", { state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  // the app opens on the home page (owner, 10-07): the floor and an orb's profile each by its address
  if (o.floor) await page.evaluate(() => (location.hash = "#/office"));
  else await profile(page, "Ash");
  return page;
}

const sidebar = (page: Page): Promise<string[]> => page.locator("aside button[data-orb] span span:first-child").allTextContents();

test("an orb in the office is fixed: no name to type, no creator, no dice; what he is made of, shown", { skip }, async () => {
  const page = await open();
  try {
    assert.equal(await page.getByRole("heading", { name: "Ash" }).count(), 1, "his name, as a heading");
    assert.equal(await page.getByRole("textbox", { name: "Name" }).count(), 0, "no name to type");
    assert.equal(await page.getByRole("tablist").count(), 0, "no creator's tabs");
    assert.equal(await page.getByRole("button", { name: /Roll/ }).count(), 0, "no dice");
    const facts = await page.locator("text=Made of").locator("..").locator("div > span:first-child").allTextContents();
    for (const k of ["Personality", "Specialty", "Shape", "Eyes", "Hat", "Glasses", "Colour", "Finish", "Voice"]) assert.ok(facts.some((f) => f.toLowerCase() === k.toLowerCase()), `${k} shown (${facts})`);
    // control: the creator is there for a new orb, so the checks above can see it
    await page.getByRole("button", { name: "New orb" }).first().click();
    assert.equal(await page.getByRole("tablist").count(), 1);
    assert.equal(await page.getByRole("textbox", { name: "Name" }).count(), 1);
  } finally {
    await page.close();
  }
});

test("the New orb tile is an empty seat: an orb not made yet, a + on it, filled, its words in its colour; pressed, the creator, and the seat holds the orb being made (owner, 10-03, 10-04)", { skip }, async () => {
  const page = await open();
  try {
    const seat = page.locator("[data-new-orb]");
    assert.equal(await seat.count(), 1, "one seat");
    assert.equal(await seat.locator("canvas").count(), 1, "an orb sits in it");
    assert.equal(await seat.locator("[data-plus]").count(), 1, "a + on it");
    const look = await seat.evaluate((el) => {
      const rgb = (hex: string): string => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
      const words = [...el.querySelectorAll("span")].find((x) => x.textContent === "New orb")!;
      return { fill: getComputedStyle(el).backgroundImage, words: getComputedStyle(words).color, accent: rgb(getComputedStyle(el).getPropertyValue("--accent").trim()) };
    });
    assert.match(look.fill, /gradient/, "filled with its colour, not an empty outline");
    assert.equal(await seat.locator("canvas").evaluate((c) => getComputedStyle(c).opacity), "1", "its orb at full colour: a faint one reads as not for pressing");
    // the menu's New orb asks to be pressed too: its colour's fill and ring, not a plain row
    const invite = page.locator("[data-invite]");
    assert.equal(await invite.count(), 1);
    assert.equal(await invite.textContent(), "+New orb");
    // a button, filled with its colour: not a row, and not the page you are on (that one is washed and ringed)
    const fill = (b: Element) => ({ bg: getComputedStyle(b).backgroundColor, accent: getComputedStyle(b).getPropertyValue("--accent").trim() });
    const pill = await invite.evaluate(fill);
    assert.equal(pill.bg, `rgb(${[1, 3, 5].map((i) => parseInt(pill.accent.slice(i, i + 2), 16)).join(", ")})`, "filled with its colour");
    const here = await page.locator('button[aria-current="page"]').first().evaluate(fill);
    assert.notEqual(here.bg, pill.bg, "and unlike the page you are on");
    assert.equal(await page.getByRole("button", { name: "Sessions", exact: true }).evaluate((b) => getComputedStyle(b).backgroundColor), "rgba(0, 0, 0, 0)", "control: a plain row is not filled");
    assert.equal(look.words, look.accent, "New orb in its colour, not grey");
    await seat.click();
    assert.equal(await page.getByRole("tablist").count(), 1, "pressed, the creator");
    assert.equal(await seat.getAttribute("aria-pressed"), "true", "and the seat says it is the one open");
    // on the New orb screen the seat holds the orb being made, as it is made (owner, 10-04); anywhere
    // else, the newborn
    const looks = (where: string) => page.locator(where).first().evaluate((c) => c.getAttribute("aria-label")!.replace(/, [a-z]+$/, ""));
    assert.equal(await looks("[data-new-orb] canvas"), await looks("[data-cradle] canvas"), "the seat's orb is the one being made");
    assert.equal(await seat.getAttribute("data-orb"), await page.locator("[data-cradle]").getAttribute("data-orb"), "in its colour");
    await page.getByRole("tab", { name: "Shape" }).click();
    await choose(page, "pear");
    await page.getByRole("tab", { name: "Hat" }).click();
    await choose(page, "beanie");
    assert.match(await looks("[data-new-orb] canvas"), /pear.*beanie/, "and changes as it is made");
    assert.equal(await looks("[data-new-orb] canvas"), await looks("[data-cradle] canvas"));
    await page.locator("aside").getByRole("button", { name: /Oscar/ }).click();
    assert.equal(await seat.getAttribute("aria-pressed"), "false", "control: back in the office");
    assert.doesNotMatch(await looks("[data-new-orb] canvas"), /pear/, "off the New orb screen, the newborn again");
  } finally {
    await page.close();
  }
});

test("a new orb joins the office when he is created, and is fixed from then on", { skip }, async () => {
  const page = await open();
  try {
    const before = await sidebar(page);
    await page.getByRole("button", { name: "New orb" }).first().click();
    await page.getByRole("textbox", { name: "Name" }).fill("Pip");
    assert.deepEqual(await sidebar(page), before, "not in the office until he is created");
    await page.getByRole("button", { name: "Create Pip" }).click();
    await page.waitForTimeout(300);
    assert.deepEqual(await sidebar(page), [...before, "Pip"], "in the office now, at the end");
    assert.equal(await page.getByRole("heading", { name: "Pip" }).count(), 1, "and shown, fixed");
    assert.equal(await page.getByRole("textbox", { name: "Name" }).count(), 0);
    assert.equal(await page.getByRole("tablist").count(), 0);
  } finally {
    await page.close();
  }
});

test("a name that is empty or already in the office stops him being created", { skip }, async () => {
  const page = await open();
  try {
    await page.getByRole("button", { name: "New orb" }).first().click();
    await page.getByRole("textbox", { name: "Name" }).fill("oscar");
    const create = page.getByRole("button", { name: /^Create/ });
    assert.equal(await create.isDisabled(), true, "Oscar is taken, whatever the case");
    assert.equal(await page.getByText("Someone in the office is already called oscar").count(), 1);
    await page.getByRole("textbox", { name: "Name" }).fill("  ");
    assert.equal(await create.isDisabled(), true, "no name at all");
    assert.equal(await page.getByText("Give your orb a name first").count(), 1);
    await page.getByRole("textbox", { name: "Name" }).fill("Wren");
    assert.equal(await create.isDisabled(), false, "control: a free name creates");
  } finally {
    await page.close();
  }
});

test("letting an orb go asks first; 'Keep Gus' keeps Gus, and 'Let Gus go' lets Gus go", { skip }, async () => {
  const page = await open();
  try {
    await page.locator("aside").getByRole("button", { name: /Gus/ }).click();
    await page.getByRole("button", { name: "Let Gus go…" }).click();
    const ask = page.getByRole("group", { name: "Let Gus go?" });
    assert.equal(await ask.count(), 1, "it asks");
    assert.ok((await sidebar(page)).includes("Gus"), "asking deletes nothing");
    await ask.getByRole("button", { name: "Keep Gus" }).click();
    assert.ok((await sidebar(page)).includes("Gus"), "kept");
    await page.getByRole("button", { name: "Let Gus go…" }).click();
    await page.getByRole("group", { name: "Let Gus go?" }).getByRole("button", { name: "Let Gus go", exact: true }).click();
    await page.waitForTimeout(450);
    assert.ok(!(await sidebar(page)).includes("Gus"), "gone");
    assert.equal(await page.getByRole("heading", { name: "Gus" }).count(), 0, "and someone else is shown");
    assert.equal(await page.getByRole("heading").first().count(), 1);
  } finally {
    await page.close();
  }
});

test("a role a licence stands behind says so on his sheet; a builder's sheet does not", { skip }, async () => {
  const page = await open();
  try {
    await page.getByRole("button", { name: "New orb" }).first().click();
    await page.getByRole("tab", { name: "Specialty" }).click();
    await page.getByRole("button", { name: /^Dietitian/ }).click();
    assert.equal(await page.getByText("Not a licensed dietitian", { exact: false }).count(), 1, "the dietitian says what he is not");
    await page.getByRole("button", { name: /^Accountant/ }).click();
    assert.equal(await page.getByText("Not a licensed accountant", { exact: false }).count(), 1);
    await page.getByRole("button", { name: /^Frontend Builder/ }).click();
    assert.equal(await page.getByText(/^Not a /).count(), 0, "control: a builder needs no such line");
  } finally {
    await page.close();
  }
});

for (const theme of ["dark", "light"] as const) {
  for (const size of ["phone", "desk"] as const) {
    test(`the layout rule at ${size} size in ${theme}: the office and every tab of the creator, clean`, { skip }, async () => {
      const page = await open(size, theme, { floor: true });
      try {
        await page.locator("[data-floor] [data-floor-orb]").first().waitFor();
        await page.waitForTimeout(600);
        assert.deepEqual(await measure(page), [], "the office floor (owner, 10-05)");
        await profile(page, "Ash");
        assert.deepEqual(await measure(page), [], "an orb in the office");
        await page.getByRole("button", { name: "New orb" }).first().click();
        for (const tab of ["Personality", "Specialty", "Shape", "Eyes", "Hat", "Glasses", "Colour", "Voice"]) {
          await page.getByRole("tab", { name: tab }).click();
          await page.waitForTimeout(150);
          assert.deepEqual(await measure(page), [], `a new orb, on ${tab}`);
        }
      } finally {
        await page.close();
      }
    });
  }
}
