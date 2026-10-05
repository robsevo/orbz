// PLAN 2.14_t, the opening splash, as rendered: it shows when the app opens (the office waking,
// the wordmark, its facts), and leaves once the waking has played and what it waits for has
// answered; a slow home holds it, and it says it is waiting; a home that cannot be reached is
// said plainly, with a way to try again; the layout rule holds while it shows; `?splash=0`
// skips it (the control the other render checks rely on).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { findChrome, launch, measure, seedOffice, serveDir, SIZES } from "./harness.ts";
import { WAKE_MS } from "../src/ui/splash.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let site: { url: string; close(): Promise<void> };
let out: string;

before(async () => {
  if (skip) return;
  out = mkdtempSync(join(tmpdir(), "orbs-splash-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
  site = await serveDir(out);
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await site?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

/** Opens the app with what the splash waits on: "fast"; "held", a home that answers only when the
 * test calls `__release()` (so no test races the machine's speed); or one that refuses. */
async function open(o: { home?: "fast" | "held" | "refused"; size?: keyof typeof SIZES; query?: string } = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: SIZES[o.size ?? "desk"], colorScheme: "dark" });
  await seedOffice(page);
  await page.addInitScript((home) => {
    const g = globalThis as { __orbsReady?: Promise<unknown>; __splash?: { shown?: number; leaving?: number; gone?: number; phases: string[]; text: string; orbs: number } };
    // when the splash really appeared and left, by the page's own clock, and every phase it went through
    g.__splash = { phases: [], text: "", orbs: 0 };
    new MutationObserver(() => {
      const el = document.querySelector("[data-splash]");
      const on = Boolean(el);
      const ph = el?.getAttribute("data-splash");
      if (ph && g.__splash!.phases.at(-1) !== ph) g.__splash!.phases.push(ph);
      if (ph === "leaving" && g.__splash!.leaving === undefined) g.__splash!.leaving = performance.now();
      if (el) {
        g.__splash!.text = (el as HTMLElement).innerText || g.__splash!.text;
        g.__splash!.orbs = Math.max(g.__splash!.orbs, el.querySelectorAll("canvas").length);
      }
      if (on && g.__splash!.shown === undefined) g.__splash!.shown = performance.now();
      if (!on && g.__splash!.shown !== undefined && g.__splash!.gone === undefined) g.__splash!.gone = performance.now();
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-splash"] });
    if (home === "fast") g.__orbsReady = Promise.resolve(); // answered already: only its own waking can hold it
    if (home === "held") g.__orbsReady = new Promise((r) => ((globalThis as { __release?: () => void }).__release = () => r(undefined)));
    if (home === "refused") Object.defineProperty(g, "__orbsReady", { configurable: true, get: () => Promise.reject(new Error("connection refused")) });
  }, o.home ?? "fast");
  await page.goto(`${site.url}/orbs.html${o.query ?? "?intro=0"}`); // the first-open story is its own check (onboarding.test.ts)
  return page;
}
const splash = (p: Page) => p.locator("[data-splash]");

test("it shows when the app opens, the office waking, and leaves once the waking has played", { skip }, async () => {
  const page = await open();
  try {
    await page.waitForFunction(() => (globalThis as { __splash?: { gone?: number } }).__splash?.gone !== undefined, null, { timeout: 30_000 });
    const { leaving, phases, text, orbs } = await page.evaluate(() => (globalThis as { __splash?: { leaving: number; phases: string[]; text: string; orbs: number } }).__splash!);
    const woke = await page.evaluate(() => performance.getEntriesByName("orbs-splash-wake")[0]!.startTime);
    assert.match(text, /ORBZ[\s\S]*\d+ orbs in the office/, "the wordmark and its facts");
    assert.ok(orbs >= 5, `the orbs, popping in (${orbs})`);
    // from when its waking starts (the splash's own mark) to when it starts to leave: a slow
    // renderer stretches everything around that, never that, so a splash that skipped its waking
    // cannot pass on a slow machine
    assert.ok(leaving - woke >= WAKE_MS - 50, `it played its waking, it did not flash (left ${Math.round(leaving - woke)} ms after it woke)`);
    // how long past it depends on the machine (a software renderer is slow), so the rule is by
    // what it did: a home that was already there was never waited for
    assert.deepEqual(phases, ["waking", "leaving"], "it went straight from waking to leaving");
    assert.equal(await page.locator("[data-floor]").count(), 1, "and the office is there: its floor");
  } finally {
    await page.close();
  }
});

test("a slow home holds it, and it says it is waiting", { skip }, async () => {
  const page = await open({ home: "held" });
  try {
    await page.getByText("Waking your home…").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);
    assert.equal(await splash(page).count(), 1, "still waiting, past its waking, while the home has not answered");
    await page.evaluate(() => (globalThis as { __release?: () => void }).__release!());
    await splash(page).waitFor({ state: "detached", timeout: 20_000 });
    const { phases } = await page.evaluate(() => (globalThis as { __splash?: { phases: string[] } }).__splash!);
    assert.deepEqual(phases, ["waking", "waiting", "leaving"], "waking, waiting for the home, then leaving");
  } finally {
    await page.close();
  }
});

test("a home that cannot be reached is said plainly, and Try again tries again", { skip }, async () => {
  const page = await open({ home: "refused" });
  try {
    await page.getByText("Can't reach your home: connection refused").waitFor({ timeout: 20_000 });
    await page.evaluate(() => Object.defineProperty(globalThis, "__orbsReady", { configurable: true, get: () => Promise.resolve() }));
    await page.getByRole("button", { name: "Try again" }).click();
    await splash(page).waitFor({ state: "detached", timeout: 20_000 });
  } finally {
    await page.close();
  }
});

for (const size of ["phone", "desk"] as const) {
  test(`the layout rule holds while it shows, at ${size} size`, { skip }, async () => {
    const page = await open({ home: "held", size });
    try {
      await page.getByText("Waking your home…").waitFor({ timeout: 20_000 });
      assert.equal(await splash(page).count(), 1);
      const found = (await measure(page)).filter((f) => !/<main|orbs-window/.test(f.what));
      assert.deepEqual(found, []);
    } finally {
      await page.close();
    }
  });
}

test("?splash=0 skips it", { skip }, async () => {
  const page = await open({ query: "?splash=0&intro=0" });
  try {
    await page.waitForSelector("canvas", { state: "attached" });
    assert.equal(await splash(page).count(), 0);
  } finally {
    await page.close();
  }
});
