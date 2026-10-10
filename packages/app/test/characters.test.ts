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
import { choose, findChrome, launch, plainNewOrb, serveDir } from "./harness.ts";
import { DESIGN, PORTRAIT } from "../src/orb/renderer.ts";
import { ASH, COVERS, earsInside, EYES, GLASSES, HATS, isShades, lookOf, outline, SHAPES, type GlassesName, type HatName, type ShapeName } from "../src/orb/spec.ts";

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
  await page.goto(`${site.url}/orbs.html?splash=0&intro=0`);
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
    assert.ok(probes.length >= 10, `control: the ${tab} tab shows its options (${probes.length})`);
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

// owner, 10-09: "some just look like stupid 3d playdoh ... dont cheap out on them. make them nice, to industry
// standards". A hat is lit as the form it is: across a plain one (one material, one colour), inside its edge, the light
// runs from where it faces the light to where it turns away. Measured 10-09 on the Hat tab: 28 to 67 between the tenth
// and ninetieth brightest of its pixels; drawn flat (one normal for all of it, as the old cut-outs were inside their
// bevel) 0 to 2. The line is halfway.
const PLAIN = ["hard hat", "beret", "fez", "chef hat", "viking helmet", "bow"];
test("every plain hat is lit as a form, not flat: light to shade across it (owner, 10-09: \"stupid 3d playdoh\")", { skip }, async () => {
  await page.getByRole("tab", { name: "Hat" }).click();
  await page.waitForTimeout(300);
  const rows = await page.evaluate((plain) => {
    const px = (pick: string) => {
      const c = document.querySelector<HTMLButtonElement>(`button[data-pick="${pick}"]`)!.querySelector("canvas")!;
      return { W: c.width, H: c.height, d: c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data };
    };
    const none = px("none");
    return plain.map((pick) => {
      const { W, H, d } = px(pick);
      // the hat: solid, and not his glass (it repaints him); inside its edge, two pixels in from every side
      const m = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) m[i] = d[i * 4 + 3]! >= 250 && Math.abs(d[i * 4]! - none.d[i * 4]!) + Math.abs(d[i * 4 + 1]! - none.d[i * 4 + 1]!) + Math.abs(d[i * 4 + 2]! - none.d[i * 4 + 2]!) > 60 ? 1 : 0;
      const L: number[] = [];
      for (let y = 2; y < H - 2; y++)
        for (let x = 2; x < W - 2; x++) {
          let inside = true;
          for (let dy = -2; dy <= 2 && inside; dy++) for (let dx = -2; dx <= 2; dx++) if (!m[(y + dy) * W + x + dx]) { inside = false; break; }
          const i = y * W + x;
          if (inside) L.push(0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!);
        }
      L.sort((a, b) => a - b);
      const at = (f: number): number => L[Math.min(L.length - 1, Math.floor(f * L.length))] ?? 0;
      return { pick, n: L.length, spread: at(0.9) - at(0.1) };
    });
  }, PLAIN);
  if (process.env.ORBS_PRINT) console.log(rows.map((r) => `${r.pick} ${r.n} ${r.spread.toFixed(1)}`).join("\n"));
  for (const r of rows) {
    assert.ok(r.n > 150, `control: ${r.pick} is found inside its edge (${r.n} pixels)`);
    assert.ok(r.spread > 14, `${r.pick}: lit flat, ${r.spread.toFixed(1)} from light to shade across it`);
  }
});

// A hat is a model round his head now: what goes round behind him hides behind him (his head is drawn into depth
// first), so a sweatband shows only its front half across his forehead; and a hat casts a soft shadow on his glass just
// under its edge, so it sits on him rather than over him. Measured 10-09 on the Hat tab: the sweatband 16 px tall down
// his middle (25 with nothing hiding its back half), his glass under the straw hat's brim 15% darker than bare (none
// with no shadow). The lines are halfway.
const BAND_TALL = 21;
const SHADE_SEEN = 0.075;
test("what goes round behind his head hides behind him, and his hat shades him just under it", { skip }, async () => {
  await page.getByRole("tab", { name: "Hat" }).click();
  await page.waitForTimeout(300);
  const r = await page.evaluate((cy) => {
    const px = (pick: string) => {
      const c = document.querySelector<HTMLButtonElement>(`button[data-pick="${pick}"]`)!.querySelector("canvas")!;
      return { W: c.width, H: c.height, d: c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data };
    };
    const none = px("none");
    const { W, H } = none;
    const off = (a: { d: Uint8ClampedArray }, i: number): number => Math.abs(a.d[i * 4]! - none.d[i * 4]!) + Math.abs(a.d[i * 4 + 1]! - none.d[i * 4 + 1]!) + Math.abs(a.d[i * 4 + 2]! - none.d[i * 4 + 2]!);
    const lum = (a: { d: Uint8ClampedArray }, i: number): number => 0.299 * a.d[i * 4]! + 0.587 * a.d[i * 4 + 1]! + 0.114 * a.d[i * 4 + 2]!;
    const x = Math.floor(W / 2);
    // down his middle: how tall the sweatband is, from its top to its foot
    const band = px("sweatband");
    let top = -1;
    let foot = -1;
    for (let y = 0; y < H * cy; y++) {
      if (band.d[(y * W + x) * 4 + 3]! >= 128 && off(band, y * W + x) > 40) {
        if (top < 0) top = y;
        foot = y;
      }
    }
    // his glass just under the straw hat's brim, in his middle, against the same place bare
    const straw = px("straw hat");
    let lowest = -1;
    for (let y = 0; y < H * cy; y++) if (straw.d[(y * W + x) * 4 + 3]! >= 250 && off(straw, y * W + x) > 60) lowest = y;
    let a = 0;
    let b = 0;
    for (let y = lowest + 2; y < lowest + 6; y++) for (let xx = x - 6; xx <= x + 6; xx++) {
      a += lum(straw, y * W + xx);
      b += lum(none, y * W + xx);
    }
    return { tall: foot - top + 1, shade: 1 - a / b, lowest, H };
  }, DESIGN.cy);
  if (process.env.ORBS_PRINT) console.log("sweatband tall", r.tall, "shade under the straw hat", r.shade.toFixed(3), "at", r.lowest, "of", r.H);
  assert.ok(r.lowest > 0 && r.tall > 3, "control: the straw hat's brim and the sweatband are found");
  assert.ok(r.tall < BAND_TALL, `a sweatband ${r.tall} px tall down his middle: its back half shows over his head`);
  assert.ok(r.shade > SHADE_SEEN, `under its brim his glass is ${(r.shade * 100).toFixed(1)}% darker than bare (a hat that casts no shadow)`);
});

test("no mouth, by pixels: below his eyes nothing is as dark as an eye (and the eyes are)", { skip }, async () => {
  await page.getByRole("tab", { name: "Eyes" }).click();
  await page.waitForTimeout(300);
  const picks = ["classic", "big", "dots", "ovals", "beans", "droopy"] as const;
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

// owner, 10-09: "can we do the same thing we did to the hats to the eyes". Each eye is a glossy dome set into his glass,
// not a flat dark disc: low in it, where no sparkle is (the big one is up to the left, the small one down to the right),
// the light it lets through glows in his colour, so its shade runs across it. Measured 10-09 in the Eyes tab between the
// tenth and ninetieth of those pixels (the lesser of his two eyes): 0.046 to 0.093; drawn flat, as they were, 0.017 to
// 0.023. The line is halfway.
const EYE_DEPTH = 0.034;
test("his eyes are glossy domes, not flat discs: across the low part of each, its shade runs (owner, 10-09)", { skip }, async () => {
  await page.getByRole("tab", { name: "Eyes" }).click();
  await page.waitForTimeout(300);
  const picks = ["classic", "big", "huge", "beans"] as const;
  const geometry = { w: PORTRAIT.w, h: PORTRAIT.h, cy: PORTRAIT.cy, radius: PORTRAIT.radius, scale: lookOf(ASH).shapeD[1] };
  const eyes = Object.fromEntries(picks.map((k) => [k, EYES[k].a]));
  const rows = await page.evaluate(({ picks, geometry, eyes }) =>
    picks.map((pick) => {
      const c = document.querySelector<HTMLButtonElement>(`button[data-pick="${pick}"]`)!.querySelector("canvas")!;
      const W = c.width, H = c.height;
      const d = c.getContext("2d")!.getImageData(0, 0, W, H).data;
      const k = Math.min(W / geometry.w, H / geometry.h);
      const Rs = geometry.radius * k * geometry.scale * 0.94;
      const cx = W / 2, cy = H * geometry.cy;
      const [er, aspect, gap, ey] = eyes[pick]!;
      const spreads: number[] = [];
      for (const sx of [-1, 1]) {
        const L: number[] = [];
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            // in the eye's own units, the low quarter away from both sparkles
            const vx = ((x - cx) / Rs - sx * gap!) / er!, vy = ((y - cy) / Rs - ey!) / (er! * aspect!);
            if (vx > -0.15 || vx < -0.8 || vy < 0.15 || vy > 0.8 || Math.hypot(vx, vy) > 0.82) continue;
            const i = (y * W + x) * 4;
            L.push((0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) / 255);
          }
        L.sort((a, b) => a - b);
        spreads.push(L.length ? L[Math.floor(L.length * 0.9)]! - L[Math.floor(L.length * 0.1)]! : 0);
        spreads.push(L.length);
      }
      return { pick, left: spreads[0]!, nLeft: spreads[1]!, right: spreads[2]!, nRight: spreads[3]! };
    }), { picks, geometry, eyes });
  if (process.env.ORBS_PRINT) console.log(rows.map((r) => `${r.pick} ${r.left.toFixed(3)} ${r.right.toFixed(3)} (${r.nLeft}, ${r.nRight} px)`).join("\n"));
  for (const r of rows) {
    assert.ok(r.nLeft > 20 && r.nRight > 20, `control: ${r.pick}'s eyes are found (${r.nLeft}, ${r.nRight} px)`);
    assert.ok(Math.min(r.left, r.right) > EYE_DEPTH, `${r.pick}: flat eyes, their shade ${Math.min(r.left, r.right).toFixed(3)} across`);
  }
});

/** Each glasses thumbnail against the one with none, over his eyes: how much differs, and how much
 * darker it is there. */
function glassesOverEyes(p: Page, picks: string[]): Promise<{ pick: string; diff: number; darker: number }[]> {
  const geometry = { w: PORTRAIT.w, h: PORTRAIT.h, cy: PORTRAIT.cy, radius: PORTRAIT.radius, scale: lookOf(ASH).shapeD[1] };
  const eye = EYES.classic.a; // the plain new orb has Ash's classic eyes
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
    // measured 10-01 at the 96 px thumbnails (the band's edges fall on other pixels at another size:
    // at 88 the same pairs read a little darker): a monocle (one eye) changes the least, 0.024;
    // sunglasses darken the band by 0.082 (round shades) to 0.177, clear frames by at most 0.061
    // (cat-eye). The line is halfway between.
    assert.ok(r.diff > 0.015, `${r.pick}: hardly anything drawn over his eyes (${r.diff.toFixed(3)})`);
    if (isShades(r.pick as GlassesName)) assert.ok(r.darker > 0.072, `${r.pick}: sunglasses that do not darken his eyes (${r.darker.toFixed(3)})`);
    else assert.ok(r.darker < 0.072, `${r.pick}: clear glasses that hide his eyes (${r.darker.toFixed(3)})`);
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

// Hats that go on over his head, with an opening (the rest sit on it, clip to it, or float): spec.ts COVERS.
const EARED = new Set<ShapeName>(["teddy", "cub", "kitty", "bunny", "fox", "owl"]);

// owner, 10-01: "some accessories arent fitting the heads of the orbs right. please fix per shape".
// At twice the pixels (a hat's fit is a few pixels at the thumbnails' size), on one page
// for every shape, each shape its own test (a whole sheet runs past a test's minute).
let sharp: Promise<Page> | null = null;
const sharpPage = (): Promise<Page> =>
  (sharp ??= (async () => {
    const p = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 2, colorScheme: "dark" }); // an orb draws at 2 at most
    await p.addInitScript(() => {
      (globalThis as { __orbsTime?: number }).__orbsTime = 3.4;
    });
    await p.goto(`${site.url}/orbs.html?splash=0&intro=0`);
    await p.waitForSelector("canvas", { state: "attached" });
    await plainNewOrb(p);
    return p;
  })());
after(async () => {
  if (sharp) await (await sharp).close().catch(() => {}); // the browser may be gone first
});

for (const shape of Object.keys(SHAPES) as ShapeName[]) {
  test(`every hat sits on a ${shape}'s head (over a point, on a heart's lobes, between ears), and his close-up holds all of him`, { skip }, async () => {
    const p = await sharpPage();
    const bad: string[] = [];
    await p.getByRole("tab", { name: "Shape" }).click();
    await choose(p, shape);
    await p.getByRole("tab", { name: "Hat" }).click();
    await p.waitForTimeout(150);
    // where his head would end without his ears, at every degree (spec.ts outline): what lies beyond is ear
    const S = SHAPES[shape];
    const skull = Array.from({ length: 360 }, (_, i) => S.d[1] * (1 + outline({ ...S, c: [S.c[0], S.c[1], 0, S.c[3]] }, ((i - 180) * Math.PI) / 180)));
    // and with them: an ear is between the two (not the glow round the CEO, which is out past all of him)
    const whole = Array.from({ length: 360 }, (_, i) => S.d[1] * (1 + outline(S, ((i - 180) * Math.PI) / 180)));
    const rows = await p.evaluate(({ hats, Rfrac, cy, skull, whole, eared }) => {
      const px = (pick: string) => {
        const c = document.querySelector<HTMLButtonElement>(`button[data-pick="${pick}"]`)!.querySelector("canvas")!;
        return { W: c.width, H: c.height, d: c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data };
      };
      const none = px("none");
      const { W, H } = none;
      const R = W * Rfrac;
      const head = (i: number): boolean => none.d[i * 4 + 3]! >= 128;
      let headTop = H;
      for (let i = 0; i < W * H && headTop === H; i++) if (head(i)) headTop = Math.floor(i / W);
      // his ears: where he is drawn beyond his skull (3 pixels beyond, for the edge). His size on
      // the canvas is his frame's radius grown by being awake and his breath, so it is read off
      // him: the top of his head straight up, against his skull's outline there.
      const ears: number[] = [];
      let earsDue = 0; // the pixels his outline has ears in, drawn or not
      if (eared) {
        let topC = 0;
        while (topC < H && none.d[(topC * W + Math.floor(W / 2)) * 4 + 3]! < 128) topC++;
        const k = (H * cy - topC) / (skull[90]! * R);
        for (let i = 0; i < W * H; i++) {
          const dx = (i % W) - W / 2, dy = Math.floor(i / W) - H * cy;
          const a = Math.round((Math.atan2(dy, dx) * 180) / Math.PI) + 180;
          const d = Math.hypot(dx, dy);
          if (!(d > skull[a % 360]! * R * k + 3 && d < whole[a % 360]! * R * k - 1)) continue;
          earsDue++;
          if (head(i)) ears.push(i); // his glass is drawn at 80 to 100 percent: he is there from half
        }
      }
      return hats.map((hat) => {
        const h = px(hat).d;
        const isHat = (i: number): boolean => h[i * 4 + 3]! >= 128 && (!head(i) || Math.abs(h[i * 4]! - none.d[i * 4]!) + Math.abs(h[i * 4 + 1]! - none.d[i * 4 + 1]!) + Math.abs(h[i * 4 + 2]! - none.d[i * 4 + 2]!) > 60);
        // the hat's lowest edge over his middle, and how wide his head is just under it
        let bottom = -1;
        for (let y = 0; y < H; y++) for (let x = Math.round(W / 2 - 0.12 * R); x <= W / 2 + 0.12 * R; x++) if (isHat(y * W + x)) bottom = Math.max(bottom, y);
        let width = 0;
        const row = Math.min(H - 1, bottom + 2);
        for (let x = 0; x < W; x++) if (head(row * W + x)) width++;
        // pieces of what is drawn, 4-connected (a hat floating off him is a second piece)
        const m = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) m[i] = h[i * 4 + 3]! >= 128 ? 1 : 0;
        const seen = new Uint8Array(W * H);
        let pieces = 0;
        for (let i = 0; i < W * H; i++) {
          if (!m[i] || seen[i]) continue;
          let n = 0;
          const st = [i];
          seen[i] = 1;
          while (st.length) {
            const j = st.pop()!;
            n++;
            const x = j % W;
            for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W]) if (k >= 0 && k < W * H && m[k] && !seen[k]) { seen[k] = 1; st.push(k); }
          }
          if (n >= 20) pieces++;
        }
        // an ear still there: his glass, drawn just as it was without the hat, to a few levels (where it went inside,
        // nothing is drawn there, or the hat is, which a dark felt over his dark glass can come within 60 of)
        const still = (i: number): boolean => h[i * 4 + 3]! >= 128 && Math.abs(h[i * 4]! - none.d[i * 4]!) + Math.abs(h[i * 4 + 1]! - none.d[i * 4 + 1]!) + Math.abs(h[i * 4 + 2]! - none.d[i * 4 + 2]!) <= 12;
        return { hat, width: width / R, below: (bottom - headTop) / R, pieces, ears: ears.length, earsDue, earShown: ears.length ? ears.filter(still).length / ears.length : 0 };
      });
    }, { hats: (Object.keys(HATS) as HatName[]).filter((h) => h !== "none"), Rfrac: DESIGN.radius / DESIGN.w, cy: DESIGN.cy, skull, whole, eared: EARED.has(shape) });
    if (process.env.ORBS_PRINT) console.log(shape, rows.filter((r) => COVERS.has(r.hat as HatName)).map((r) => `${r.hat} ${r.width.toFixed(2)}`).join(", "));
    if (process.env.ORBS_PRINT && EARED.has(shape)) console.log(shape, "ears", rows[0]?.ears, rows.map((r) => `${r.hat} ${(r.earShown * 100).toFixed(0)}%`).join(", "));
    for (const r of rows) {
      if (r.pieces !== (r.hat === "halo" ? 2 : 1)) bad.push(`${shape} in a ${r.hat}: ${r.pieces} pieces (it floats off him, or sinks through)`);
      if (COVERS.has(r.hat as HatName) && r.width < 0.45) bad.push(`${shape} in a ${r.hat}: perched (his head is ${r.width.toFixed(2)} of his radius wide under it)`);
      // control: without a hat his ears are drawn where his outline has them (an owl's tufts are 8 pixels here, a bunny's 254)
      if (EARED.has(shape) && (r.earsDue < 5 || r.ears < 0.8 * r.earsDue)) bad.push(`control: ${shape}'s ears are not found (${r.ears} of ${r.earsDue} pixels)`);
      // his ears are inside a hat over his head that would be drawn over them (owner, 10-09: "watch out for ears, they
      // should be inside hat when on"): none of them shows; what leaves them shows most of them (a party hat, a bow)
      if (EARED.has(shape) && earsInside(r.hat as HatName, shape) && r.earShown > 0.05) bad.push(`${shape} in a ${r.hat}: ${Math.round(r.earShown * 100)}% of his ears out of it`);
      if (EARED.has(shape) && (r.hat === "party hat" || r.hat === "antenna") && r.earShown < 0.6) bad.push(`control: ${shape} with ${r.hat}: his ears are gone (${Math.round(r.earShown * 100)}% of them show)`);
    }
    // and his close-up (eyes, glasses) holds all of him, a wide shape too
    await p.getByRole("tab", { name: "Glasses" }).click();
    await p.waitForTimeout(150);
    const closeUps = await probeThumbs(p);
    if (process.env.ORBS_PRINT) console.log(shape, "close-up side", Math.min(...closeUps.map((g) => Math.min(g.margins[1], g.margins[3]))).toFixed(3));
    for (const g of closeUps) {
      const side = Math.min(g.margins[1], g.margins[3]);
      // measured 10-01: framed to fit, the least room is a squish's, 0.083; cut off by the frame's
      // edge (its fade hides the cut), 0.03
      if (side < 0.06) bad.push(`${shape} in ${g.pick}: cut at the side of his close-up (${side.toFixed(3)})`);
    }
    assert.deepEqual(bad, []);
  });
}
