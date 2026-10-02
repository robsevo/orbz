// PLAN 2.2_t, the office as rendered (owner, 2026-10-01: "call it the office ... once an orb is
// created, he can be deleted, but not edited"). The page opens on an orb in the office, fixed: no
// name to type, no tabs, no dice. A new orb is made in the creator and joins the office when
// created; a name that is empty or taken stops him. Deleting asks first, and "Keep him" keeps him.
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
import { findChrome, launch, measure, seedOffice, serveDir, SIZES } from "./harness.ts";

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

async function open(size: keyof typeof SIZES = "desk", theme: "dark" | "light" = "dark"): Promise<Page> {
  const page = await browser.newPage({ viewport: SIZES[size], deviceScaleFactor: 1, colorScheme: theme });
  await seedOffice(page); // a full office to look round (an office starts with one orb now)
  await page.addInitScript(() => {
    (globalThis as { __orbsTime?: number }).__orbsTime = 3.4;
  });
  await page.goto(`${site.url}/orbs.html?splash=0&intro=0`);
  await page.waitForSelector("canvas", { state: "attached" });
  await page.evaluate(() => document.fonts.ready);
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
    assert.equal(await page.getByText("Give him a name first").count(), 1);
    await page.getByRole("textbox", { name: "Name" }).fill("Wren");
    assert.equal(await create.isDisabled(), false, "control: a free name creates");
  } finally {
    await page.close();
  }
});

test("deleting asks first; 'Keep him' keeps him, and 'Delete' lets him go", { skip }, async () => {
  const page = await open();
  try {
    await page.locator("aside").getByRole("button", { name: /Gus/ }).click();
    await page.getByRole("button", { name: "Delete Gus…" }).click();
    const ask = page.getByRole("group", { name: "Delete Gus?" });
    assert.equal(await ask.count(), 1, "it asks");
    assert.ok((await sidebar(page)).includes("Gus"), "asking deletes nothing");
    await ask.getByRole("button", { name: "Keep him" }).click();
    assert.ok((await sidebar(page)).includes("Gus"), "kept");
    await page.getByRole("button", { name: "Delete Gus…" }).click();
    await page.getByRole("group", { name: "Delete Gus?" }).getByRole("button", { name: "Delete Gus" }).click();
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
      const page = await open(size, theme);
      try {
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
