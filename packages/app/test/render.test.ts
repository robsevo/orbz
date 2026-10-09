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
import { baseOf, DEFAULT_THEME, HUES, SURFACES, THEMES, type ThemeId } from "../src/design/tokens.ts";

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

test("controls: a planted too-wide row, a 9 px label, a lone last item, a one-word last line, an unreadable line and a word cut in two are each caught", { skip }, async () => {
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
      // text the ground swallows: a grey on the dark ground, far under AA
      const faint = document.createElement("p");
      faint.textContent = "a planted line nobody can read";
      faint.style.cssText = "color:rgb(40, 40, 44);font:400 14px/20px sans-serif;margin:0";
      document.querySelector("section")!.append(faint);
    });
    await page.evaluate(() => {
      // a grid of five in two columns (the fifth alone), and a title squeezed so its last word is alone
      const grid = document.createElement("div");
      grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:4px;width:200px";
      for (let i = 0; i < 5; i++) grid.append(Object.assign(document.createElement("span"), { textContent: `item ${i}` }));
      document.querySelector("section")!.append(grid);
      // a title squeezed to just less than its whole width, wrapped greedily: its last word drops alone
      const title = document.createElement("h3");
      title.textContent = "The Cheerful Frontend Builder";
      title.style.cssText = "width:max-content;font:700 20px/24px sans-serif;text-wrap:wrap;margin:0";
      document.querySelector("section")!.append(title);
      title.style.width = `${title.getBoundingClientRect().width - 12}px`;
      // a column too narrow for its words (the notice of 10-02): "promotion" cut "promotio / n"
      const squeezed = document.createElement("span");
      squeezed.textContent = "ready for promotion";
      squeezed.style.cssText = "display:block;width:52px;overflow-wrap:anywhere;font:400 12px/17px sans-serif";
      document.querySelector("section")!.append(squeezed);
    });
    const kinds = new Set((await measure(page)).map((f) => f.kind));
    assert.ok(kinds.has("spill"), "the wide row reaches outside the window");
    assert.ok(kinds.has("hscroll"), "and makes the page scroll sideways");
    assert.ok(kinds.has("minfont"), "the 9 px label is under the floor");
    assert.ok(kinds.has("orphan"), "the fifth item alone on its row is an orphan");
    assert.ok(kinds.has("widow"), "a title ending on one word alone is a widow");
    assert.ok(kinds.has("contrast"), "a line the ground swallows is under AA");
    assert.ok(kinds.has("broken"), "a word cut across two lines is a column too narrow for it");
  } finally {
    await page.close();
  }
});

// the gate of 10-08: a new orb's words ended "… from a two- / colour gradient." and the widow check, placing a word
// where it began, read "gradient." alone; a word wrapped at its hyphen counts on the line it ends on
test("a word wrapped at its hyphen counts on the line it ends on: 'a two- / colour gradient.' ends on two words, 'kept on- / chain' on one", { skip }, async () => {
  const page = await open("dark", "phone");
  try {
    const splits = await page.evaluate(() =>
      [["Its glow comes from a two-colour gradient.", "Its glow comes from a two-", "two-colour"], ["Its trades are all kept on-chain", "Its trades are all kept on-", "on-chain"]].map(([text, first, word]) => {
        // squeezed to just wider than its first line, wrapped greedily, so the line breaks at the hyphen
        const p = document.createElement("p");
        p.textContent = text!;
        p.style.cssText = "width:max-content;font:400 15px/21px sans-serif;text-wrap:wrap;margin:0";
        document.querySelector("section")!.append(p);
        const r = document.createRange();
        r.setStart(p.firstChild!, 0);
        r.setEnd(p.firstChild!, first!.length);
        p.style.width = `${r.getBoundingClientRect().width + 2}px`;
        r.setStart(p.firstChild!, text!.indexOf(word!));
        r.setEnd(p.firstChild!, text!.indexOf(word!) + word!.length);
        return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size;
      }),
    );
    assert.deepEqual(splits, [2, 2], "control: each hyphenated word wraps at its hyphen");
    const widows = (await measure(page)).filter((f) => f.kind === "widow").map((f) => f.what);
    assert.ok(!widows.some((w) => w.includes("Its glow comes")), `"colour gradient." is two words on the last line: ${widows.join("; ")}`);
    assert.ok(widows.some((w) => w.includes("Its trades are")), `"chain" is alone on the last line: ${widows.join("; ")}`);
  } finally {
    await page.close();
  }
});

// a request's command, shown as code on its notice (10-08): a program's lines are its own, so its last line "PY" is
// no widow and a name it wraps is not a word cut in two
test("a program's lines are not prose: a command shown as code, ending on 'PY' alone, is neither a widow nor broken", { skip }, async () => {
  const page = await open("dark", "phone");
  try {
    await page.evaluate(() => {
      const code = document.createElement("code");
      code.textContent = "python3 - <<'PY'\nfor name in ('base', 'lean', 'stressed'): print(name, monthly_price)\nPY";
      code.style.cssText = "display:block;white-space:pre-wrap;overflow-wrap:anywhere;width:150px;font:500 12px/17px monospace";
      document.querySelector("section")!.append(code);
    });
    const lines = await page.locator("code").evaluate((el) => el.getClientRects().length && Math.round(el.getBoundingClientRect().height / 17));
    assert.ok(lines >= 4, `control: the command wraps over its lines (${lines})`);
    const found = (await measure(page)).filter((f) => f.what.includes("python3"));
    assert.deepEqual(found, [], "nothing said of the command");
  } finally {
    await page.close();
  }
});

// the themes besides light and dark (owner, 10-02): each on the design system's page, its own ground,
// every orb name in its base's colour, and the checks clean (contrast read off what is really behind)
for (const t of (Object.keys(THEMES) as ThemeId[]).filter((x) => x !== "dark" && x !== "light")) {
  test(`the ${t} theme: its own ground, every name in its colour, nothing unreadable or spilling`, { skip }, async () => {
    const system = baseOf(t) === "dark" ? "light" : "dark"; // the system says the other way: the choice wins
    const page = await browser.newPage({ viewport: SIZES.phone, colorScheme: system });
    try {
      await page.goto(`${site.url}/specimen.html`);
      await page.waitForSelector("main");
      await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
      await page.evaluate(() => document.fonts.ready);
      // a button's colour eases to the new theme: read it once it has arrived
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), `rgb(${SURFACES[t].ground.join(", ")})`);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), baseOf(t));
      const shown = await page.evaluate(() => [...document.querySelectorAll("[data-orb]")].map((el) => [el.getAttribute("data-orb"), getComputedStyle(el).color]));
      const want = Object.fromEntries(HUES.map((h) => [h.name, `rgb(${h[baseOf(t)].join(", ")})`]));
      assert.ok(shown.length >= 12, "control: the names are on the page");
      for (const [name, color] of shown) assert.equal(color, want[name!], `${name} in ${t}`);
      assert.deepEqual(await measure(page), []);
    } finally {
      await page.close();
    }
  });
}

test("Settings' theme: Midnight until you choose; chosen, worn at once, kept on a reload; System gives it back to the device, and stays", { skip }, async () => {
  const page = await browser.newPage({ viewport: SIZES.phone, colorScheme: "dark" });
  try {
    await page.goto(`${site.url}/orbs.html?splash=0&intro=0#/settings`);
    const ground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // a device that never chose wears the app's default (owner, 10-06: "make midnight the app default")
    await page.locator('button[data-theme-choice="midnight"][aria-pressed="true"]').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), DEFAULT_THEME);
    assert.equal(await ground(), `rgb(${SURFACES[DEFAULT_THEME].ground.join(", ")})`);
    await page.locator('button[data-theme-choice="light"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
    const midnight = page.locator('button[data-theme-choice="midnight"]');
    await midnight.click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "midnight");
    assert.equal(await ground(), `rgb(${SURFACES.midnight.ground.join(", ")})`);
    assert.equal(await midnight.getAttribute("aria-pressed"), "true");
    assert.deepEqual(await measure(page), [], "Settings in Midnight: nothing unreadable or spilling");
    await page.reload();
    await page.locator('button[data-theme-choice="midnight"]').waitFor();
    assert.equal(await ground(), `rgb(${SURFACES.midnight.ground.join(", ")})`, "kept on this device");
    await page.locator('button[data-theme-choice="system"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme ?? null), null);
    assert.equal(await ground(), `rgb(${SURFACES.dark.ground.join(", ")})`, "the device's own again");
    await page.reload();
    await page.locator('button[data-theme-choice="system"][aria-pressed="true"]').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme ?? null), null, "System is kept: not Midnight again after a reload");
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
