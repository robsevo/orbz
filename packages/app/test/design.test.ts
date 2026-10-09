// PLAN 2.1_t, the parts that are numbers: text contrast meets WCAG AA in both themes, every orb
// hue reads as text where it is used, the grid and the type scale hold, and the token lint finds
// no colour outside the tokens. Each check is shown to fail on a planted defect first (the controls).
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { contrast, hex, rgbToOklch, type RGB } from "../src/design/color.ts";
import { AZURE, backgrounds, baseOf, HUE_STEP, HUES, MIN_FONT, RADIUS, SPACE, stylesheet, SURFACES, THEMES as ALL, TYPE, type Theme, type ThemeId, DARK_ORB } from "../src/design/tokens.ts";
import { lintSource, lintTree } from "./lint.ts";

// every theme you can choose (owner, 10-02: "besides light or dark"), each held to the same checks
const THEMES = Object.keys(ALL) as ThemeId[];
const BASES: Theme[] = ["dark", "light"];
const AA = 4.5;

/** The worst contrast a colour gets on the surfaces it is used on (all of them, unless named), and where. */
function worst(c: RGB, t: ThemeId, on: string[] | null = null): { ratio: number; on: string } {
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

test("text contrast meets WCAG AA (4.5:1) on every surface, in every theme", () => {
  assert.ok(THEMES.length >= 7, "light, dark and more (owner, 10-02)");
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

test("every orb hue reads as text in every theme; Ash keeps his azure", () => {
  assert.equal(HUES.length, 24, "a lot of choices (owner, 10-01)");
  assert.equal(new Set(HUES.map((h) => h.name)).size, HUES.length);
  assert.equal(hex(HUES[0]!.dark), hex(AZURE), "azure is chartlive's #5EB3DE");
  for (const h of HUES) {
    for (const t of THEMES) {
      const c = h[baseOf(t)]; // a theme wears its base's colour of each hue
      const w = worst(c, t);
      assert.ok(w.ratio >= AA, `${h.name} in ${t} ${hex(c)} is ${w.ratio.toFixed(2)}:1 on ${w.on}`);
    }
  }
});

// the Dark orb (PLAN 2.20; owner, 10-08): its words a quiet grey, held to AA in every theme as the 24 are
test("Dark's words read as text in every theme, a grey and not a colour", () => {
  for (const t of THEMES) {
    const c = DARK_ORB[baseOf(t)];
    const w = worst(c, t);
    assert.ok(w.ratio >= AA, `dark in ${t} ${hex(c)} is ${w.ratio.toFixed(2)}:1 on ${w.on}`);
  }
  for (const c of [DARK_ORB.dark, DARK_ORB.light]) assert.ok(rgbToOklch(c).C < 0.03, `${hex(c)}: a grey`);
});

test("the hues are one family: the same lightness in the dark, evenly round the wheel, and each tellable from the next", () => {
  const dark = HUES.map((h) => rgbToOklch(h.dark));
  const L = dark.map((c) => c.L);
  assert.ok(Math.max(...L) - Math.min(...L) < 0.02, `dark lightness spread ${(Math.max(...L) - Math.min(...L)).toFixed(3)}`);
  HUES.forEach((h, i) => assert.equal(Math.round((h.angle - HUES[0]!.angle + 360) % 360), Math.round(i * HUE_STEP)));
  for (const t of BASES) {
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
  const clean = [`.x { color: var(--text-2); background: var(--card); }`, `<a href="#top">top</a>`, `const id = "#root";`, `issue #123 {/* lint: not a colour */}`, `* { scrollbar-color: var(--quiet) transparent; }`];
  for (const c of clean) assert.deepEqual(lintSource("clean.tsx", c), [], `a false finding in ${c}`);
  const src = fileURLToPath(new URL("../src", import.meta.url));
  assert.deepEqual(lintTree(src), []);
});

test("Light is not paper, Rose is rose, Sand is sand; the floor's walls and furniture are their own colours (owner, 10-06)", () => {
  const ok = (c: RGB) => rgbToOklch(c);
  // "light mode, wayy too light": a soft grey day, its card under paper white
  assert.ok(ok(SURFACES.light.card).L < 0.95 && ok(SURFACES.light.ground).L < 0.88, `light card L ${ok(SURFACES.light.card).L.toFixed(3)}`);
  // "rose is not rose enough", "neither is sand": each wears its colour where you see it most, the card and the side
  for (const [t, from, to] of [["rose", 330, 30], ["sand", 55, 95]] as const) {
    for (const k of ["ground", "card", "side"] as const) {
      const c = ok(SURFACES[t][k]);
      const h = (c.h + 360) % 360;
      const inArc = from < to ? h >= from && h <= to : h >= from || h <= to;
      assert.ok(c.C >= (k === "card" ? 0.025 : 0.04) && inArc, `${t} ${k} ${hex(SURFACES[t][k])}: chroma ${c.C.toFixed(3)} at ${h.toFixed(0)}°`);
    }
  }
  // "make the furniture and walls their own color": the wall and the wood stand apart from the app's surfaces and each other
  const dE = (a: RGB, b: RGB): number => {
    const x = ok(a), y = ok(b);
    return Math.hypot(x.L - y.L, x.C * Math.cos((x.h * Math.PI) / 180) - y.C * Math.cos((y.h * Math.PI) / 180), x.C * Math.sin((x.h * Math.PI) / 180) - y.C * Math.sin((y.h * Math.PI) / 180));
  };
  for (const t of THEMES) {
    const s = SURFACES[t];
    for (const k of ["wall", "wood"] as const) for (const bg of ["card", "side", "raised"] as const) assert.ok(dE(s[k], s[bg]) > 0.05, `${t}: the ${k} is too like the ${bg}`);
    assert.ok(dE(s.wall, s.wood) > 0.05, `${t}: wall and wood alike`);
    assert.ok(ok(s.wood).C > 0.03, `${t}: the wood has no warmth`);
  }
});
