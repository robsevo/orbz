// PLAN 2.2_t, the creator's choices (owner, 10-01):
//   - "same amount of orbs and accessories per tab, with page numbers. 3 per row": every picture
//     tab is three across and nine to a page; a short last page is filled with empty slots the
//     size of a choice; the page numbers sit under it, and every page keeps the layout rule.
//   - A roll of the dice that lands on another page turns to it.
//   - "change the colors of our accessories": a hat's colour and the frames' colour, chosen like
//     his own; "Its own" puts them back; the card says it, and the office keeps it.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { choose, findChrome, launch, measure, plainNewOrb, serveDir, SIZES } from "./harness.ts";
import { EYES, FINISHES, GLASSES, HATS, SHAPES } from "../src/orb/spec.ts";
import { PER_PAGE } from "../src/ui/pages.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let site: { url: string; close(): Promise<void> };
let out: string;

before(async () => {
  if (skip) return;
  out = mkdtempSync(join(tmpdir(), "orbs-creator-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
  site = await serveDir(out);
  browser = await launch();
});
after(async () => {
  await browser?.close();
  await site?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

async function open(size: keyof typeof SIZES): Promise<Page> {
  const page = await browser.newPage({ viewport: SIZES[size], colorScheme: "dark" });
  await page.goto(`${site.url}/orbs.html?splash=0&intro=0`);
  await page.waitForSelector("canvas", { state: "attached" });
  return page;
}

const TABS: [tab: string, paged: string, n: number][] = [
  ["Shape", "Shapes", Object.keys(SHAPES).length],
  ["Eyes", "Eyes", Object.keys(EYES).length],
  ["Hat", "Hats", Object.keys(HATS).length],
  ["Glasses", "Glasses", Object.keys(GLASSES).length],
  ["Colour", "Finishes", Object.keys(FINISHES).length],
];

test("control: some picture tab has more than one page", () => {
  assert.ok(TABS.some(([, , n]) => n > PER_PAGE));
});

// one page per size, dressed plainly once, each tab its own test (all of them in one ran past a
// test's minute in the gate, where every suite draws at once)
const sized = new Map<keyof typeof SIZES, Promise<Page>>();
const plainAt = (size: keyof typeof SIZES): Promise<Page> => {
  let p = sized.get(size);
  if (!p) {
    p = open(size).then(async (page) => {
      await plainNewOrb(page);
      return page;
    });
    sized.set(size, p);
  }
  return p;
};
after(async () => {
  for (const p of sized.values()) await (await p).close().catch(() => {}); // the browser may be gone first
});

for (const size of ["desk", "phone"] as const) {
  for (const [tab, label, n] of TABS) {
    test(`the ${label.toLowerCase()}, at ${size} size: three across, nine to a page, numbered, a short page filled`, { skip }, async () => {
      const page = await plainAt(size);
      await page.getByRole("tab", { name: tab }).click();
      const paged = page.locator(`[data-paged="${label}"]`);
      await paged.waitFor();
      const pages = Math.ceil(n / PER_PAGE);
      assert.equal(await paged.getByRole("button", { name: /^Page \d+$/ }).count(), pages > 1 ? pages : 0, `${label}: a number for each page`);
      if (pages > 1) await paged.getByRole("button", { name: "Page 1", exact: true }).click();
      for (let p = 1; p <= pages; p++) {
        if (p > 1) await paged.getByRole("button", { name: "Next page" }).click();
        const shown = paged.locator("[data-page]:not([hidden])");
        assert.equal(await shown.getAttribute("data-page"), String(p), `${label}: page ${p} is the one shown`);
        assert.equal(await shown.locator("button[data-pick]").count(), Math.min(PER_PAGE, n - (p - 1) * PER_PAGE), `${label} page ${p}: its choices`);
        const findings = await measure(page); // which waits for a choice's bounce to settle, too
        const boxes = await shown.evaluate((el) => [...el.children].map((c) => {
          const r = c.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), empty: c.hasAttribute("data-empty") };
        }));
        assert.equal(boxes.length, PER_PAGE, `${label} page ${p}: nine slots, the empty ones too`);
        assert.equal(new Set(boxes.map((b) => b.x)).size, 3, `${label} page ${p}: three across`);
        assert.equal(new Set(boxes.map((b) => b.y)).size, 3, `${label} page ${p}: three rows`);
        const [w, h] = [boxes[0]!.w, boxes[0]!.h];
        assert.ok(boxes.every((b) => Math.abs(b.w - w) <= 1 && Math.abs(b.h - h) <= 1), `${label} page ${p}: an empty slot is the size of a choice`);
        if (p < pages) assert.ok(!boxes.some((b) => b.empty), `${label}: only the last page has empty slots`);
        assert.deepEqual(findings, [], `${label} page ${p}: the layout rule`);
      }
    });
  }
}

test("a roll of the dice that lands on another page turns to it", { skip }, async () => {
  // shapes: a roll changes no thumbnail (each shows its own shape), so nothing is redrawn and the
  // test stays quick in the gate (a hat's roll can change its colour, and every thumbnail with it)
  const page = await plainAt("desk");
  await page.getByRole("tab", { name: "Shape" }).click();
  const pagesSeen = new Set<string>();
  for (let i = 0; i < 12; i++) { // 12 rolls of 19 shapes on 3 pages all land on one about once in 4,000
    await page.getByRole("button", { name: "Roll shape", exact: true }).click();
    const on = page.locator('[data-paged="Shapes"] button[data-pick][aria-pressed="true"]');
    assert.ok(await on.isVisible(), `roll ${i}: the shape he got is on the page shown`);
    pagesSeen.add((await on.evaluate((b) => b.closest("[data-page]")!.getAttribute("data-page")))!);
  }
  assert.ok(pagesSeen.size > 1, `control: the rolls landed on more than one page (${[...pagesSeen]})`);
});

/** The mean colour of the top `share` of a thumbnail's body (where a hat sits), or of a band (glasses). */
function meanOf(page: Page, pick: string, y0: number, y1: number): Promise<[number, number, number]> {
  return page.evaluate(({ pick, y0, y1 }) => {
    const c = document.querySelector<HTMLButtonElement>(`button[data-pick="${pick}"]`)!.querySelector("canvas")!;
    const d = c.getContext("2d")!.getImageData(0, Math.round(c.height * y0), c.width, Math.max(1, Math.round(c.height * (y1 - y0)))).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! < 200) continue;
      r += d[i]!; g += d[i + 1]!; b += d[i + 2]!; n++;
    }
    return [r / n / 255, g / n / 255, b / n / 255] as [number, number, number];
  }, { pick, y0, y1 });
}
const apart = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + Math.abs(x - b[i]!), 0);

// in two steps on one page (each colour pressed redraws every thumbnail on the tab, slow in software
// WebGL: as one test it ran past a test's minute in the gate)
let dressing: Promise<Page> | null = null;
after(async () => {
  if (dressing) await (await dressing).close().catch(() => {});
});

test("a hat in any colour, like his own: it paints the hat, and Its own puts its colour back", { skip }, async () => {
  const page = await (dressing ??= open("desk").then(async (p) => {
    await plainNewOrb(p);
    return p;
  }));
  await page.getByRole("tab", { name: "Hat" }).click();
  await choose(page, "beanie");
  const hatBefore = await meanOf(page, "beanie", 0, 0.35);
  await page.getByRole("button", { name: "hat in coral" }).click();
  await page.waitForTimeout(250);
  const hatCoral = await meanOf(page, "beanie", 0, 0.35);
  assert.ok(apart(hatBefore, hatCoral) > 0.08, `the beanie turns coral (${apart(hatBefore, hatCoral).toFixed(3)})`);
  await page.getByRole("button", { name: "Its own" }).click();
  await page.waitForTimeout(250);
  assert.ok(apart(hatBefore, await meanOf(page, "beanie", 0, 0.35)) < 0.01, "Its own puts its colour back");
});

test("frames in any colour too; the card says both, and the office keeps them", { skip }, async () => {
  assert.ok(dressing, "after the hat");
  const page = await dressing;
  await page.getByRole("button", { name: "hat in coral" }).click();
  await page.getByRole("tab", { name: "Glasses" }).click();
  await choose(page, "none");
  assert.equal(await page.getByText("Frame colour").count(), 0, "no glasses, no frames to colour");
  await choose(page, "round");
  const eyesBefore = await meanOf(page, "round", 0.3, 0.55);
  await page.getByRole("button", { name: "frame in honey" }).click();
  await page.waitForTimeout(250);
  assert.ok(apart(eyesBefore, await meanOf(page, "round", 0.3, 0.55)) > 0.02, "the frames turn honey");

  await page.getByRole("textbox", { name: "Name" }).fill("Pip");
  await page.getByRole("button", { name: "Create Pip" }).click();
  await page.getByRole("heading", { name: "Pip" }).waitFor();
  const card = await page.locator("main").innerText();
  assert.match(card, /Beanie, coral/);
  assert.match(card, /Round, honey frames/);
  await page.reload();
  await page.getByRole("heading", { name: "Pip" }).waitFor();
  assert.match(await page.locator("main").innerText(), /Beanie, coral[\s\S]*Round, honey frames/, "the office keeps it");
});
