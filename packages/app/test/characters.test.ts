// PLAN 2.2_t, as rendered: the character creator, built by Vite and drawn by his real shader in
// Chromium (its software WebGL on a machine with no GPU), on a new orb dressed plainly (Ash's
// bean, no hat, no glasses). Every shape, eyes, hat and glasses thumbnail is drawn whole and sits
// inside its frame; every pair of glasses is drawn over his eyes, and sunglasses darken them;
// every finish can be told from the others; and
// there is no mouth, by pixels: below his eyes there is nothing as dark as an eye. The controls:
// the eye band itself is dark (so the probe sees a face when there is one), and "none" compared
// with itself differs by nothing.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { findChrome, launch, plainNewOrb, serveDir } from "./harness.ts";
import { PORTRAIT } from "../src/orb/renderer.ts";
import { ASH, EYES, GLASSES, isShades, lookOf, type GlassesName } from "../src/orb/spec.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const skip = findChrome() ? false : "no Chromium on this machine";
let browser: Browser;
let site: { url: string; close(): Promise<void> };
let out: string;
let page: Page;

before(async () => {
  if (skip) return;
  out = mkdtempSync(join(tmpdir(), "orbs-chars-"));
  await build({ root: APP, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
  site = await serveDir(out);
  browser = await launch();
  page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2, colorScheme: "dark" });
  await page.addInitScript(() => {
    (globalThis as { __orbsTime?: number }).__orbsTime = 3.4;
  });
  await page.goto(`${site.url}/orbs.html`);
  await page.waitForSelector("canvas", { state: "attached" });
  await plainNewOrb(page);
});

after(async () => {
  await browser?.close();
  await site?.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

type Probe = { pick: string; w: number; h: number; body: number; margins: [number, number, number, number]; pieces: number };

/** Each thumbnail's pixels: how much body (alpha 128+) it holds, how far it stays from each edge of
 * its frame (top, right, bottom, left, as fractions), and how many separate pieces it is in. */
function probeThumbs(p: Page): Promise<Probe[]> {
  return p.evaluate(() =>
    [...document.querySelectorAll<HTMLButtonElement>("button[data-pick]")].map((b) => {
      const c = b.querySelector("canvas")!;
      const W = c.width;
      const H = c.height;
      const d = c.getContext("2d")!.getImageData(0, 0, W, H).data;
      const m = new Uint8Array(W * H);
      let n = 0;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let i = 0; i < W * H; i++) {
        if (d[i * 4 + 3]! >= 128) {
          m[i] = 1;
          n++;
          const x = i % W, y = (i / W) | 0;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
      // pieces of 6 pixels or more, 4-connected: a hat that floats off his head is a second piece
      const seen = new Uint8Array(W * H);
      let pieces = 0;
      for (let i = 0; i < W * H; i++) {
        if (!m[i] || seen[i]) continue;
        let size = 0;
        const stack = [i];
        seen[i] = 1;
        while (stack.length) {
          const j = stack.pop()!;
          size++;
          const x = j % W;
          for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W]) {
            if (k >= 0 && k < W * H && m[k] && !seen[k]) {
              seen[k] = 1;
              stack.push(k);
            }
          }
        }
        if (size >= 6) pieces++;
      }
      return { pick: b.dataset.pick!, w: W, h: H, body: n, margins: [y0 / H, (W - 1 - x1) / W, (H - 1 - y1) / H, x0 / W] as [number, number, number, number], pieces };
    }),
  );
}

// Measured on 2026-10-01 (tools/margins.ts): the narrowest any option comes to its frame, less a
// small cushion. A body a third too big, or a hat that floats, falls outside them. Eyes and
// glasses are shown close up (renderer.ts PORTRAIT), so he fills more of their frames.
const LIMITS: Record<string, { top: number; side: number; bottom: number }> = {
  Shape: { top: 0.33, side: 0.17, bottom: 0.18 },
  Eyes: { top: 0.1, side: 0.11, bottom: 0.04 },
  Hat: { top: 0.12, side: 0.16, bottom: 0.18 },
  Glasses: { top: 0.1, side: 0.11, bottom: 0.04 },
};
const FLOATS = new Set(["halo"]); // the one thing worn that does not touch him, on purpose

for (const tab of ["Shape", "Eyes", "Hat", "Glasses"]) {
  test(`every ${tab.toLowerCase()} is drawn whole, in one piece, with room around it in its frame`, { skip }, async () => {
    await page.getByRole("tab", { name: tab }).click();
    await page.waitForTimeout(300);
    const probes = await probeThumbs(page);
    assert.ok(probes.length >= 14, `control: the ${tab} tab shows its options (${probes.length})`);
    const L = LIMITS[tab]!;
    for (const p of probes) {
      assert.ok(p.body > p.w * p.h * 0.05, `${p.pick}: hardly drawn (${p.body} body pixels)`);
      const [top, right, bottom, left] = p.margins;
      assert.ok(top >= L.top, `${p.pick}: ${top.toFixed(3)} of room above, under ${L.top}`);
      assert.ok(Math.min(left, right) >= L.side, `${p.pick}: ${Math.min(left, right).toFixed(3)} at the side, under ${L.side}`);
      assert.ok(bottom >= L.bottom, `${p.pick}: ${bottom.toFixed(3)} below, under ${L.bottom}`);
      assert.equal(p.pieces, FLOATS.has(p.pick) ? 2 : 1, `${p.pick}: in ${p.pieces} pieces (something floats off him, or he is cut)`);
    }
  });
}

test("no mouth, by pixels: below his eyes nothing is as dark as an eye (and the eyes are)", { skip }, async () => {
  await page.getByRole("tab", { name: "Eyes" }).click();
  await page.waitForTimeout(300);
  const picks = ["ash", "big", "dots", "ovals", "beans", "sleepy"] as const;
  // where his face is, from his frame's own geometry and each eye style's numbers (spec.ts EYES)
  const geometry = { w: PORTRAIT.w, h: PORTRAIT.h, cy: PORTRAIT.cy, radius: PORTRAIT.radius, scale: lookOf(ASH).shapeD[1] };
  const eyes = Object.fromEntries(picks.map((k) => [k, EYES[k].a]));
  const bands = await page.evaluate(({ picks, geometry, eyes }) =>
    picks.map((pick) => {
      const c = document.querySelector<HTMLButtonElement>(`button[data-pick="${pick}"]`)!.querySelector("canvas")!;
      const W = c.width, H = c.height;
      const d = c.getContext("2d")!.getImageData(0, 0, W, H).data;
      const k = Math.min(W / geometry.w, H / geometry.h);
      const Rs = geometry.radius * k * geometry.scale * 0.94; // one face unit, in pixels
      const cx = W / 2, cy = H * geometry.cy;
      const [er, aspect, gap, ey] = eyes[pick]!;
      const lums = (fx0: number, fx1: number, fy0: number, fy1: number, mirror: boolean): number[] => {
        const out: number[] = [];
        for (let y = Math.round(cy + fy0 * Rs); y <= cy + fy1 * Rs; y++) {
          for (let x = 0; x < W; x++) {
            const fx = Math.abs((x - cx) / Rs);
            if (mirror ? fx < fx0 || fx > fx1 : fx > fx1) continue;
            const i = (y * W + x) * 4;
            if (d[i + 3]! >= 200) out.push((0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) / 255);
          }
        }
        return out.sort((a, b) => a - b);
      };
      const eyeBand = lums(gap! - er!, gap! + er!, ey! - er! * aspect!, ey! + er! * aspect!, true);
      const below = lums(0, 0.26, ey! + er! * aspect! + 0.05, 0.62, false);
      const glass = below[Math.floor(below.length / 2)]!;
      return { pick, glass, eye: eyeBand[0]!, below: below[0]! };
    }), { picks, geometry, eyes });
  for (const b of bands) {
    // the eyes are what is darkest on him: the control is that the probe finds them, well under his glass
    assert.ok(b.glass - b.eye > 0.1, `control: the probe sees ${b.pick}'s eyes (darkest ${b.eye.toFixed(2)}, glass ${b.glass.toFixed(2)})`);
    // and below them, nothing comes even halfway down from his glass toward an eye's darkness
    const floor = b.eye + 0.5 * (b.glass - b.eye);
    assert.ok(b.below > floor, `${b.pick}: something dark below his eyes (${b.below.toFixed(2)}, under ${floor.toFixed(2)}): a mouth?`);
  }
});

/** Each glasses thumbnail against the one with none, over his eyes: how much differs, and how much
 * darker it is there. */
function glassesOverEyes(p: Page, picks: string[]): Promise<{ pick: string; diff: number; darker: number }[]> {
  const geometry = { w: PORTRAIT.w, h: PORTRAIT.h, cy: PORTRAIT.cy, radius: PORTRAIT.radius, scale: lookOf(ASH).shapeD[1] };
  const eye = EYES.ash.a; // the plain new orb has Ash's eyes
  return p.evaluate(({ picks, geometry, eye }) => {
    const pixels = (pick: string): Uint8ClampedArray => {
      const c = document.querySelector<HTMLButtonElement>(`button[data-pick="${pick}"]`)!.querySelector("canvas")!;
      return c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    };
    const c0 = document.querySelector<HTMLButtonElement>('button[data-pick="none"]')!.querySelector("canvas")!;
    const W = c0.width, H = c0.height;
    const k = Math.min(W / geometry.w, H / geometry.h);
    const Rs = geometry.radius * k * geometry.scale * 0.94;
    const cx = W / 2, cy = H * geometry.cy;
    const [, , gap, ey] = eye as number[];
    // the band across both eyes, out to a lens's width either side
    const y0 = Math.round(cy + (ey! - 0.22) * Rs), y1 = Math.round(cy + (ey! + 0.22) * Rs);
    const x0 = Math.round(cx - (gap! + 0.3) * Rs), x1 = Math.round(cx + (gap! + 0.3) * Rs);
    const base = pixels("none");
    return picks.map((pick) => {
      const d = pixels(pick);
      let diff = 0, lumA = 0, lumB = 0, n = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = (y * W + x) * 4;
          diff += Math.abs(d[i]! - base[i]!) + Math.abs(d[i + 1]! - base[i + 1]!) + Math.abs(d[i + 2]! - base[i + 2]!);
          lumA += 0.2126 * base[i]! + 0.7152 * base[i + 1]! + 0.0722 * base[i + 2]!;
          lumB += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
          n++;
        }
      }
      return { pick, diff: diff / (n * 3 * 255), darker: (lumA - lumB) / (n * 255) };
    });
  }, { picks, geometry, eye });
}

test("every pair of glasses is drawn over his eyes, and sunglasses darken them", { skip }, async () => {
  await page.getByRole("tab", { name: "Glasses" }).click();
  await page.waitForTimeout(300);
  const names = Object.keys(GLASSES) as GlassesName[];
  const rows = await glassesOverEyes(page, names);
  const none = rows.find((r) => r.pick === "none")!;
  if (process.env.ORBS_PRINT) console.log(rows.map((r) => `${r.pick} ${r.diff.toFixed(3)} ${r.darker.toFixed(3)}`).join("\n"));
  assert.ok(none.diff < 0.001, `control: none against itself differs by nothing (${none.diff})`);
  for (const r of rows) {
    if (r.pick === "none") continue;
    // measured 10-01: a monocle (one eye) changes the least, 0.024; sunglasses darken the band by
    // 0.115 to 0.214, clear frames by at most 0.061
    assert.ok(r.diff > 0.015, `${r.pick}: hardly anything drawn over his eyes (${r.diff.toFixed(3)})`);
    if (isShades(r.pick as GlassesName)) assert.ok(r.darker > 0.085, `${r.pick}: sunglasses that do not darken his eyes (${r.darker.toFixed(3)})`);
    else assert.ok(r.darker < 0.085, `${r.pick}: clear glasses that hide his eyes (${r.darker.toFixed(3)})`);
  }
  assert.ok(names.filter(isShades).length >= 3, "there are sunglasses to choose from");
});

test("every finish can be told from every other, by the colour of his glass", { skip }, async () => {
  await page.getByRole("tab", { name: "Colour" }).click();
  await page.waitForTimeout(300);
  const means = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLButtonElement>("button[data-pick]")].map((b) => {
      const c = b.querySelector("canvas")!;
      const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
      let r = 0, g = 0, bl = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3]! < 200) continue;
        r += d[i]!; g += d[i + 1]!; bl += d[i + 2]!; n++;
      }
      return { pick: b.dataset.pick!, rgb: [r / n / 255, g / n / 255, bl / n / 255] as [number, number, number] };
    }),
  );
  assert.ok(means.length >= 9, `control: the finishes are on the page (${means.length})`);
  if (process.env.ORBS_PRINT) console.log(means.map((m) => `${m.pick} ${m.rgb.map((x) => x.toFixed(3)).join(" ")}`).join("\n"));
  let closest = { a: "", b: "", d: Infinity };
  for (const a of means) {
    for (const b of means) {
      if (a.pick >= b.pick) continue;
      const d = Math.hypot(a.rgb[0] - b.rgb[0], a.rgb[1] - b.rgb[1], a.rgb[2] - b.rgb[2]);
      if (d < closest.d) closest = { a: a.pick, b: b.pick, d };
    }
  }
  if (process.env.ORBS_PRINT) console.log("closest", closest);
  // measured 10-01: the nearest pair, frost and pearl, 0.032 apart in mean colour
  assert.ok(closest.d > 0.025, `${closest.a} and ${closest.b} look alike (${closest.d.toFixed(3)} apart)`);
});
