// PLAN 2.1_t, the parts that are numbers: text contrast meets WCAG AA in both themes, every orb
// hue reads as text where it is used, the grid and the type scale hold, and the token lint finds
// no colour outside the tokens. Each check is shown to fail on a planted defect first (the controls).
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { contrast, hex, rgbToOklch, type RGB } from "../src/design/color.ts";
import { AZURE, backgrounds, HUE_STEP, HUES, MIN_FONT, RADIUS, SPACE, stylesheet, SURFACES, TYPE, type Theme } from "../src/design/tokens.ts";
import { lintSource, lintTree } from "./lint.ts";

const THEMES: Theme[] = ["dark", "light"];
const AA = 4.5;

/** The worst contrast a colour gets on the surfaces it is used on (all of them, unless named), and where. */
function worst(c: RGB, t: Theme, on: string[] | null = null): { ratio: number; on: string } {
  return Object.entries(backgrounds(t))
    .filter(([name]) => !on || on.includes(name))
    .map(([on, bg]) => ({ ratio: contrast(c, bg), on }))
    .sort((a, b) => a.ratio - b.ratio)[0]!;
}

// Where each kind of text is used. A chip (a chosen control's fill) holds a label, never an alert
// or a status: those sit on the window's surfaces.
const WHERE: Record<"text1" | "text2" | "text3" | "alert", string[] | null> = {
  text1: null, text2: null, text3: null, alert: ["ground", "card", "side", "raised"],
};

test("text contrast meets WCAG AA (4.5:1) on every surface, in both themes", () => {
  for (const t of THEMES) {
    for (const k of ["text1", "text2", "text3", "alert"] as const) {
      const w = worst(SURFACES[t][k], t, WHERE[k]);
      assert.ok(w.ratio >= AA, `${t} ${k} ${hex(SURFACES[t][k])} is ${w.ratio.toFixed(2)}:1 on ${w.on}`);
    }
  }
  for (const t of THEMES) {
    for (const k of ["ok", "busy", "off"] as const) {
      // a status dot is not text, but it is how you know he is awake: 3:1 against what it sits on (WCAG 1.4.11)
      assert.ok(worst(SURFACES[t][k], t, ["card", "chip"]).ratio >= 3, `${t} status ${k}`);
    }
  }
  // control: the same check fails the quiet grey, which is why it is never a text colour
  for (const t of THEMES) assert.ok(worst(SURFACES[t].quiet, t).ratio < AA, `control: ${t} quiet should fail as text`);
});

test("every orb hue reads as text in both themes; Ash keeps his azure", () => {
  assert.equal(HUES.length, 24, "a lot of choices (owner, 10-01)");
  assert.equal(new Set(HUES.map((h) => h.name)).size, HUES.length);
  assert.equal(hex(HUES[0]!.dark), hex(AZURE), "azure is chartlive's #5EB3DE");
  for (const h of HUES) {
    for (const t of THEMES) {
      const w = worst(h[t], t);
      assert.ok(w.ratio >= AA, `${h.name} in ${t} ${hex(h[t])} is ${w.ratio.toFixed(2)}:1 on ${w.on}`);
    }
  }
});

test("the hues are one family: the same lightness in the dark, evenly round the wheel, and each tellable from the next", () => {
  const dark = HUES.map((h) => rgbToOklch(h.dark));
  const L = dark.map((c) => c.L);
  assert.ok(Math.max(...L) - Math.min(...L) < 0.02, `dark lightness spread ${(Math.max(...L) - Math.min(...L)).toFixed(3)}`);
  HUES.forEach((h, i) => assert.equal(Math.round((h.angle - HUES[0]!.angle + 360) % 360), Math.round(i * HUE_STEP)));
  for (const t of THEMES) {
    for (let i = 0; i < HUES.length; i++) {
      const a = rgbToOklch(HUES[i]![t]);
      const b = rgbToOklch(HUES[(i + 1) % HUES.length]![t]);
      const da = a.C * Math.cos((a.h * Math.PI) / 180) - b.C * Math.cos((b.h * Math.PI) / 180);
      const db = a.C * Math.sin((a.h * Math.PI) / 180) - b.C * Math.sin((b.h * Math.PI) / 180);
      const dE = Math.hypot(a.L - b.L, da, db);
      // OKLab's just-noticeable difference is about 0.02: neighbours must be at least that far apart
      assert.ok(dE > 0.02, `${t}: ${HUES[i]!.name} and ${HUES[(i + 1) % HUES.length]!.name} are too alike (ΔE ${dE.toFixed(3)})`);
    }
  }
});

test("the 8-point grid, 16 margins, a 22 radius, and no text under the floor of 10", () => {
  for (const v of Object.values(SPACE)) assert.equal(v % 4, 0, `${v} is off the grid (8 points, with the half step)`);
  assert.equal(RADIUS.card, 22);
  for (const [name, [size, line]] of Object.entries(TYPE)) {
    assert.ok(size >= MIN_FONT && size >= 11, `${name} is ${size}px`);
    assert.ok(line >= size, `${name}'s line is shorter than its size`);
  }
  const css = stylesheet();
  assert.match(css, /--margin: 16px;/);
  assert.match(css, /:root\[data-theme="light"\] \{ color-scheme: light;/, "light by choice");
  assert.match(css, /@media \(prefers-color-scheme: light\)/, "and by the system's setting");
  assert.match(css, /prefers-reduced-motion: reduce/, "motion stops for those who ask");
  assert.match(css, /\.num \{ font-variant-numeric: tabular-nums; \}/);
});

test("the token lint finds no colour outside the tokens (and finds every planted one)", () => {
  const planted = [
    `const a = { color: "#ff3b30" };`,
    `const b = "background: rgba(0, 0, 0, .5)";`,
    `.x { border: 1px solid white; }`,
    `<div style={{ backgroundColor: "black" }} />`,
    `.hint { color: var(--quiet); }`,
    `const c = \`oklch(0.7 0.1 200)\`;`,
  ];
  for (const p of planted) assert.equal(lintSource("planted.tsx", p).length, 1, `control: the lint missed ${p}`);
  assert.equal(lintSource("prose.tsx", "issue #123").length, 1, "control: three hex digits are a colour unless the line says otherwise");
  const clean = [`.x { color: var(--text-2); background: var(--card); }`, `<a href="#top">top</a>`, `const id = "#root";`, `issue #123 {/* lint: not a colour */}`];
  for (const c of clean) assert.deepEqual(lintSource("clean.tsx", c), [], `a false finding in ${c}`);
  const src = fileURLToPath(new URL("../src", import.meta.url));
  assert.deepEqual(lintTree(src), []);
});
