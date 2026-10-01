// PLAN 2.1_t, as rendered: the design system's page, built by Vite and opened in a real Chromium,
// in both themes, at a phone's size and a desk's: no sideways scroll, nothing spilling out of its
// box, no text under 10, and the house font really loaded. The controls: an element planted too
// wide and a 9 px label are each caught. The renders are kept (renders/) for the owner to look at.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser } from "playwright-core";
import { findChrome, launch, measure, serveDir, SIZES } from "./harness.ts";
import { HUES, SURFACES } from "../src/design/tokens.ts";

const groundOf = (t: "dark" | "light"): string => `rgb(${SURFACES[t].ground.join(", ")})`;

const APP = fileURLToPath(new URL("..", import.meta.url));
const RENDERS = join(APP, "renders");
const skip = findChrome() ? false : "no Chromium on this machine (set ORBS_CHROME, or `npx playwright install chromium`)";

let browser: Browser;
let site: { url: string; close(): Promise<void> };
let out: string;

before(async () => {
  if (skip) return;
  out = mkdtempSync(join(tmpdir(), "orbs-app-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
  site = await serveDir(out);
  browser = await launch();
  mkdirSync(RENDERS, { recursive: true });
});

after(async () => {
  await browser?.close();
  await site?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

async function open(theme: "dark" | "light", size: keyof typeof SIZES) {
  const page = await browser.newPage({ viewport: SIZES[size], deviceScaleFactor: 2, colorScheme: theme });
  await page.goto(`${site.url}/specimen.html`);
  await page.waitForSelector("main");
  await page.evaluate(() => document.fonts.ready);
  return page;
}

for (const theme of ["dark", "light"] as const) {
  for (const size of ["phone", "desk"] as const) {
    test(`the design system at ${size} size in ${theme}: nothing scrolls sideways, spills or is under 10 px`, { skip }, async () => {
      const page = await open(theme, size);
      try {
        assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), theme, "the theme follows the system's setting");
        assert.equal(await page.evaluate(() => document.fonts.check("17px Nunito")), true, "Nunito loaded, not a fallback");
        assert.deepEqual(await measure(page), []);
        // every orb name in its own colour, for this theme (the bug the first render showed: all azure)
        const shown = await page.evaluate(() => [...document.querySelectorAll("[data-orb]")].map((el) => [el.getAttribute("data-orb"), getComputedStyle(el).color]));
        const want = Object.fromEntries(HUES.map((h) => [h.name, `rgb(${h[theme].join(", ")})`]));
        assert.ok(shown.length >= 12, "control: the names are on the page");
        for (const [name, colour] of shown) assert.equal(colour, want[name!], `${name} in ${theme}`);
        await page.screenshot({ path: join(RENDERS, `design-${theme}-${size}.png`), fullPage: true });
      } finally {
        await page.close();
      }
    });
  }
}

test("controls: an element planted too wide and a 9 px label are both caught", { skip }, async () => {
  const page = await open("dark", "phone");
  try {
    assert.deepEqual(await measure(page), [], "control's baseline: the page is clean before the plant");
    await page.evaluate(() => {
      const wide = document.createElement("div");
      wide.textContent = "a planted row that is far too wide";
      wide.style.width = "900px";
      document.querySelector("section")!.append(wide);
      const tiny = document.createElement("span");
      tiny.textContent = "a planted label";
      tiny.style.fontSize = "9px";
      document.querySelector("section")!.append(tiny);
    });
    const kinds = new Set((await measure(page)).map((f) => f.kind));
    assert.ok(kinds.has("spill"), "the wide row reaches outside the window");
    assert.ok(kinds.has("hscroll"), "and makes the page scroll sideways");
    assert.ok(kinds.has("minfont"), "the 9 px label is under the floor");
  } finally {
    await page.close();
  }
});

test("data-theme overrides the system's setting, both ways", { skip }, async () => {
  for (const [system, chosen] of [["dark", "light"], ["light", "dark"]] as const) {
    const page = await browser.newPage({ viewport: SIZES.phone, colorScheme: system });
    try {
      await page.goto(`${site.url}/specimen.html`);
      await page.waitForSelector("main");
      const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.equal(before, groundOf(system), "control: it starts on the system's setting");
      await page.evaluate((t) => (document.documentElement.dataset.theme = t), chosen);
      const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert.equal(ground, groundOf(chosen), `${system} system, ${chosen} chosen`);
    } finally {
      await page.close();
    }
  }
});
