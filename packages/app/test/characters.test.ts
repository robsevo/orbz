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
import { ASH, EYES, GLASSES, HATS, isShades, lookOf, outline, SHAPES, type GlassesName, type HatName, type ShapeName } from "../src/orb/spec.ts";

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

// Hats that go on over his head, with an opening (the rest sit on it, clip to it, or float).
const COVERS = new Set<HatName>(["top hat", "beanie", "party hat", "cap", "wizard hat", "chef hat", "grad cap", "cowboy hat", "beret", "hard hat", "bucket hat", "straw hat", "fedora", "deerstalker", "viking helmet", "bowler", "fez", "tricorn", "Santa hat", "sombrero"]);
const EARED = new Set<ShapeName>(["teddy", "cub", "kitty", "bunny", "fox", "owl"]);
const WIDEST = new Set<HatName>(["straw hat", "sombrero", "deerstalker", "tricorn"]);

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
    const rows = await p.evaluate(({ hats, Rfrac, cy, skull, eared }) => {
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
      if (eared) {
        let topC = 0;
        while (topC < H && none.d[(topC * W + Math.floor(W / 2)) * 4 + 3]! < 128) topC++;
        const k = (H * cy - topC) / (skull[90]! * R);
        for (let i = 0; i < W * H; i++) {
          if (!head(i)) continue; // his glass is drawn at 80 to 100 percent: he is there from half
          const dx = (i % W) - W / 2, dy = Math.floor(i / W) - H * cy;
          const a = Math.round((Math.atan2(dy, dx) * 180) / Math.PI) + 180;
          if (Math.hypot(dx, dy) > skull[a % 360]! * R * k + 3) ears.push(i);
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
        // an ear the hat is drawn over takes the hat's own colour (measured 10-01: 150 to 430 apart
        // from him without it); one in front of the hat is his glass, tinted by what is behind it
        // (at most about 80)
        const repainted = (i: number): boolean => Math.abs(h[i * 4]! - none.d[i * 4]!) + Math.abs(h[i * 4 + 1]! - none.d[i * 4 + 1]!) + Math.abs(h[i * 4 + 2]! - none.d[i * 4 + 2]!) > 120;
        return { hat, width: width / R, below: (bottom - headTop) / R, pieces, ears: ears.length, earCovered: ears.length ? ears.filter(repainted).length / ears.length : 0 };
      });
    }, { hats: (Object.keys(HATS) as HatName[]).filter((h) => h !== "none"), Rfrac: DESIGN.radius / DESIGN.w, cy: DESIGN.cy, skull, eared: EARED.has(shape) });
    if (process.env.ORBS_PRINT) console.log(shape, rows.filter((r) => COVERS.has(r.hat as HatName)).map((r) => `${r.hat} ${r.width.toFixed(2)}`).join(", "));
    if (process.env.ORBS_PRINT && EARED.has(shape)) console.log(shape, "ears", rows[0]?.ears, rows.filter((r) => COVERS.has(r.hat as HatName)).map((r) => `${r.hat} ${(r.earCovered * 100).toFixed(0)}%`).join(", "));
    for (const r of rows) {
      if (r.pieces !== (r.hat === "halo" ? 2 : 1)) bad.push(`${shape} in a ${r.hat}: ${r.pieces} pieces (it floats off him, or sinks through)`);
      if (COVERS.has(r.hat as HatName) && r.width < 0.45) bad.push(`${shape} in a ${r.hat}: perched (his head is ${r.width.toFixed(2)} of his radius wide under it)`);
      if (EARED.has(shape) && r.ears < 40) bad.push(`control: ${shape}'s ears are not found (${r.ears} pixels)`);
      // a hat is in front of all of him, ears too (owner, 10-03: "we shouldnt see the orbs shape inside of it"):
      // the widest cover at least 32% of every eared shape's ears (measured 10-03), drawn behind them about none
      if (EARED.has(shape) && WIDEST.has(r.hat as HatName) && r.earCovered < 0.2) bad.push(`${shape} in a ${r.hat}: his ears show through it (it covers ${Math.round(r.earCovered * 100)}% of them)`);
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
