// PLAN 2.2_t, as rendered: the character creator, built by Vite and drawn by his real shader in
// Chromium (its software WebGL on a machine with no GPU). Every shape, eyes and wear thumbnail is
// drawn and sits inside its box; and there is no mouth, by pixels: below his eyes there is nothing as
// dark as an eye. The controls: the eye band itself is dark (so the probe sees a face when there is
// one), and a pixel probe on an empty canvas finds no body.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { build } from "vite";
import type { Browser, Page } from "playwright-core";
import { findChrome, launch, serveDir } from "./harness.ts";
import { DESIGN } from "../src/orb/renderer.ts";
import { ASH, EYES, lookOf } from "../src/orb/spec.ts";

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
// small cushion. A body a third too big, or a hat that floats, falls outside them.
const LIMITS: Record<string, { top: number; side: number; bottom: number }> = {
  Shape: { top: 0.33, side: 0.17, bottom: 0.18 },
  Eyes: { top: 0.33, side: 0.17, bottom: 0.18 },
  Wears: { top: 0.09, side: 0.14, bottom: 0.18 },
};
const FLOATS = new Set(["halo"]); // the one thing worn that does not touch him, on purpose

for (const tab of ["Shape", "Eyes", "Wears"]) {
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
  const geometry = { w: DESIGN.w, h: DESIGN.h, cy: DESIGN.cy, radius: DESIGN.radius, scale: lookOf(ASH).shapeD[1] };
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
