// The side menu and its Back (owner, 2026-10-01: "back button on the side menu, that brings you
// to different tabs ... easily navigable"), as rendered:
//   - every place is an address;
//   - the menu goes to each room and Back returns, the same as the browser's Back;
//   - a link opens straight onto its place;
//   - on a phone the menu slides in from a top bar and closes once you have chosen;
//   - the menu open on a phone, then the window made wide: the desk's own layout, and closed when
//     it is narrow again (owner, 10-06: "when we resize from mobile to desktop with menu open it glitches");
//   - Settings renames the CEO, switches the sounds and plays the story again;
//   - the layout rule holds in Settings and with the menu open.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { findChrome, launch, measure, seedOffice, serveDir, SIZES } from "./harness.ts";
import { parseRoute, routeHash, type Route } from "../src/ui/nav.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let site: { url: string; close(): Promise<void> };
let out: string;

before(async () => {
  if (skip) return;
  out = mkdtempSync(join(tmpdir(), "orbs-nav-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
  site = await serveDir(out);
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await site?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

async function open(hash = "", size: keyof typeof SIZES = "desk"): Promise<Page> {
  const ctx = await browser.newContext({ viewport: SIZES[size], colorScheme: "dark" });
  const page = await ctx.newPage();
  await seedOffice(page);
  await page.goto(`${site.url}/orbs.html?splash=0${hash}`);
  await page.waitForSelector("canvas", { state: "attached" });
  return page;
}
const where = (p: Page) => p.evaluate(() => location.hash);
const menu = (p: Page) => p.getByRole("navigation", { name: "Rooms" });

test("every place is an address, and back again", () => {
  for (const r of [{ room: "office", orb: "Ash" }, { room: "office", orb: "Zoë B" }, { room: "new" }, { room: "settings" }, { room: "recruiter", family: null }, { room: "recruiter", family: "build" }] as Route[]) assert.deepEqual(parseRoute(routeHash(r)), r);
  assert.equal(routeHash({ room: "recruiter", family: "think" }), "#/recruiter/think", "who applied to one department is a place of its own");
  // the org chart with one orb's school sheet open (owner, 10-06: "we dont see the send to school option")
  for (const r of [{ room: "org" }, { room: "org", school: "zoë" }] as Route[]) assert.deepEqual(parseRoute(routeHash(r)), r);
  assert.equal(routeHash({ room: "org", school: "cy" }), "#/org/school/cy");
  assert.deepEqual(parseRoute(""), { room: "office", orb: null }, "nothing: the office");
  assert.deepEqual(parseRoute("#/nonsense"), { room: "office", orb: null }, "an address that is not a place: the office");
});

test("the menu goes to each room, and its Back is the browser's Back", { skip }, async () => {
  const page = await open();
  try {
    assert.equal(await menu(page).getByRole("button", { name: "Back" }).isDisabled(), true, "nowhere to go back to yet");
    await menu(page).getByRole("button", { name: "Settings" }).click();
    assert.equal(await page.getByRole("heading", { name: "Settings" }).count(), 1);
    assert.equal(await where(page), "#/settings");
    await menu(page).getByRole("button", { name: "New orb" }).click();
    assert.equal(await page.getByRole("tablist").count(), 1, "the creator");
    await menu(page).getByRole("button", { name: "Back" }).click();
    assert.equal(await page.getByRole("heading", { name: "Settings" }).count(), 1, "Back: Settings again");
    await page.goBack();
    assert.equal(await page.locator("[data-floor]").count(), 1, "the browser's Back: the office, its floor");
    await page.goForward();
    assert.equal(await page.getByRole("heading", { name: "Settings" }).count(), 1, "and Forward");
    await page.locator("aside").getByRole("button", { name: /Oscar/ }).click();
    assert.equal(await where(page), "#/office/Oscar");
  } finally {
    await page.context().close();
  }
});

test("a link opens straight onto its place", { skip }, async () => {
  for (const [hash, check] of [["#/settings", "Settings"], ["#/office/Oscar", "Oscar"]] as const) {
    const page = await open(hash);
    try {
      assert.equal(await page.getByRole("heading", { name: check }).count(), 1, hash);
    } finally {
      await page.context().close();
    }
  }
  const page = await open("#/new");
  try {
    assert.equal(await page.getByRole("tablist").count(), 1, "#/new: the creator");
  } finally {
    await page.context().close();
  }
});

test("on a phone the menu slides in from the top bar, and closes once you have chosen", { skip }, async () => {
  const page = await open("", "phone");
  try {
    assert.equal(await menu(page).count(), 0, "closed, it is out of reach");
    await page.getByRole("button", { name: "Menu" }).click();
    await menu(page).waitFor();
    await page.waitForTimeout(500);
    assert.deepEqual(await measure(page), [], "the layout rule, with the menu open");
    await menu(page).getByRole("button", { name: "Settings" }).click();
    await page.getByRole("heading", { name: "Settings" }).waitFor();
    await menu(page).waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Back" }).first().click();
    assert.equal(await page.locator("[data-floor]").count(), 1, "the top bar's Back: the office floor");
    await page.getByRole("button", { name: "Menu" }).click();
    await menu(page).waitFor();
    await page.keyboard.press("Escape");
    await menu(page).waitFor({ state: "hidden" });
  } finally {
    await page.context().close();
  }
});

test("the menu open on a phone, then the window made wide: the desk's own layout; narrow again, the menu is closed", { skip }, async () => {
  const boxes = (p: Page) => p.evaluate(() => Object.fromEntries([".orbs-side", "[data-floor]"].map((sel) => {
    const r = document.querySelector(sel)!.getBoundingClientRect();
    return [sel, [r.x, r.y, r.width, r.height].map(Math.round)];
  })));
  const desk = await open("", "desk");
  const page = await open("", "phone");
  try {
    await desk.locator("[data-floor]").waitFor();
    await desk.waitForTimeout(600);
    const want = await boxes(desk);
    await page.getByRole("button", { name: "Menu" }).click();
    await menu(page).waitFor();
    await page.waitForTimeout(500);
    await page.setViewportSize(SIZES.desk);
    await page.waitForTimeout(800);
    assert.equal(await page.locator(".orbs-scrim").count(), 0, "no scrim on a desk");
    assert.deepEqual(await boxes(page), want, "the side menu and the office where a desk has them");
    assert.deepEqual(await measure(page), [], "the layout rule, made wide");
    await page.setViewportSize(SIZES.phone);
    await page.waitForTimeout(800);
    assert.equal(await page.getByRole("button", { name: "Menu" }).getAttribute("aria-expanded"), "false", "narrow again: the menu is closed, not open by itself");
    // out of reach once it has slid away (a count after a fixed wait lost the race under the gate's load)
    await menu(page).waitFor({ state: "hidden", timeout: 10_000 });
    assert.deepEqual(await measure(page), [], "the layout rule, narrow again");
  } finally {
    await page.context().close();
    await desk.context().close();
  }
});

test("Settings: the CEO's name, the sounds, and the story again", { skip }, async () => {
  const page = await open("#/settings");
  try {
    await page.getByRole("textbox", { name: "What the office calls you" }).fill("Sam");
    await page.getByRole("button", { name: "Save" }).click();
    assert.equal(await page.getByText("CEO Sam").count(), 1, "the menu calls you that now");
    await page.getByRole("region", { name: "Sounds" }).getByRole("button", { name: "Off" }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem("orbs.sounds")), "off");
    await page.getByRole("button", { name: "Play the opening story again" }).click();
    await page.locator("[data-onboarding]").waitFor();
  } finally {
    await page.context().close();
  }
});

for (const size of ["phone", "desk"] as const) {
  test(`the layout rule holds in Settings, at ${size} size`, { skip }, async () => {
    const page = await open("#/settings", size);
    try {
      await page.getByRole("heading", { name: "Settings" }).waitFor();
      assert.deepEqual(await measure(page), []);
    } finally {
      await page.context().close();
    }
  });
}
