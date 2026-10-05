// A character (PLAN 2.2): one spec per orb, and the shader draws all of it. Every orb is a
// different Ash: his glass, his liquid, his light, his eyes' sparkle, in another shape, with other
// eyes, a hat and glasses, in his own colour and voice. And each has a personality (owner,
// 2026-10-01: "each has a diff personality, thats what were going for"): it decides how he moves
// when he is left alone, which voices suit him, and how he talks, so the parts you pick go together.
// The starter shapes are our own; the owner names and redraws them. No mouth on any of them, no
// cheeks (owner, 2026-09-24): the eyes carry every mood.
import { HUES, MATERIALS, type HueName, type Material } from "../design/tokens.ts";
import { type Dna, dnaOf, dnaSays, leansOf } from "./dna.ts";
import { ORB_TURNS } from "./hues.ts";
import type { Gesture } from "./life.ts";
import type { OrbLook } from "./renderer.ts";

type V4 = [number, number, number, number];

// ── shapes ─────────────────────────────────────────────────────────────────────────────────────
// The terms the shader's silhouette is made of, each 0 unless a shape uses it. Ash's bean is his
// numbers exactly; the rest are our own.
type ShapeTerms = Partial<{
  tall: number; taper: number; grow: number; belly: number; dent: number; wide: number; point: number; hem: number; hemFreq: number;
  bumps: number; bumpSize: number; ears: number; earSpread: number; earWidth: number; scale: number; tip: number;
  squircle: number; notch: number; blob: number; points: number; pointSize: number; pointSharp: number;
}>;
const shape = (t: ShapeTerms) => ({
  a: [t.tall ?? 0, t.taper ?? 0, t.grow ?? 0, t.belly ?? 0] as V4,
  b: [t.dent ?? 0, t.wide ?? 0, t.point ?? 0, t.hem ?? 0] as V4,
  c: [t.bumps ?? 0, t.bumpSize ?? 0, t.ears ?? 0, t.earSpread ?? 0] as V4,
  d: [t.earWidth ?? 0.3, t.scale ?? 0.9, t.hemFreq ?? 6, t.tip ?? 0] as V4,
  e: [t.squircle ?? 0, t.notch ?? 0, t.blob ?? 0, 0] as V4,
  f: [t.points ?? 0, t.pointSize ?? 0, t.pointSharp ?? 1, 0] as V4,
});

export const SHAPES = {
  bean: shape({ tall: 0.2, taper: 0.11, grow: 0.05, belly: 0.95, dent: 0.03, scale: 0.905 }), // Ash, to the number
  pebble: shape({ tall: 0.05, taper: 0.03, belly: 0.9, wide: 0.14, scale: 0.92 }),
  egg: shape({ tall: 0.26, taper: 0.16, grow: 0.08, belly: 0.95, scale: 0.88 }),
  moon: shape({ tall: 0.02, scale: 0.93 }),
  squish: shape({ tall: 0.0, taper: -0.04, belly: 0.9, wide: 0.2, scale: 0.95 }),
  drop: shape({ tall: 0.14, grow: 0.05, belly: 0.95, point: 0.24, scale: 0.86 }),
  cloud: shape({ tall: 0.09, taper: 0.02, grow: 0.02, belly: 0.9, wide: 0.05, bumps: 7, bumpSize: 0.065, scale: 0.87 }),
  ghost: shape({ tall: 0.24, taper: -0.04, grow: 0.07, belly: 0.9, hem: 0.055, scale: 0.86 }),
  drip: shape({ tall: 0.12, taper: 0.03, grow: 0.04, belly: 0.9, hem: 0.08, hemFreq: 4, scale: 0.87 }),
  teddy: shape({ tall: 0.12, grow: 0.03, belly: 0.95, ears: 0.17, earSpread: 0.64, earWidth: 0.22, scale: 0.85 }),
  cub: shape({ tall: 0.06, belly: 0.9, wide: 0.06, ears: 0.2, earSpread: 0.78, earWidth: 0.24, scale: 0.84 }),
  kitty: shape({ tall: 0.14, taper: 0.02, grow: 0.03, belly: 0.95, ears: 0.24, earSpread: 0.7, earWidth: 0.12, scale: 0.83 }),
  bunny: shape({ tall: 0.12, taper: 0.03, grow: 0.03, belly: 0.95, ears: 0.5, earSpread: 0.44, earWidth: 0.12, scale: 0.76 }),
  chick: shape({ tall: 0.06, taper: 0.02, grow: 0.02, belly: 0.98, wide: 0.1, point: 0.22, scale: 0.86 }),
  heart: shape({ tall: 0.02, taper: -0.06, belly: 0.6, ears: 0.1, earSpread: 0.55, earWidth: 0.38, notch: 0.1, tip: 0.24, scale: 0.86 }),
  star: shape({ tall: 0.0, points: 5, pointSize: 0.17, pointSharp: 3, scale: 0.86 }),
  trio: shape({ tall: 0.0, taper: -0.02, points: 3, pointSize: 0.2, pointSharp: 1.6, scale: 0.84 }),
  squircle: shape({ tall: 0.02, squircle: 0.12, scale: 0.86 }),
  blob: shape({ tall: 0.1, taper: 0.04, grow: 0.03, belly: 0.9, blob: 0.08, scale: 0.88 }),
  // more (owner, 10-03: "and also more shapes"), each from the same terms
  pear: shape({ tall: 0.32, taper: 0.06, grow: 0.08, belly: 1.0, scale: 0.84 }),
  fox: shape({ tall: 0.08, taper: 0.06, belly: 0.95, ears: 0.34, earSpread: 0.62, earWidth: 0.09, scale: 0.8 }),
  owl: shape({ tall: 0.06, belly: 0.95, wide: 0.08, ears: 0.13, earSpread: 0.52, earWidth: 0.07, scale: 0.86 }),
  sun: shape({ tall: 0.0, points: 10, pointSize: 0.07, pointSharp: 2.2, scale: 0.86 }),
  pill: shape({ tall: 0.24, belly: 0.0, scale: 0.9 }),
  flower: shape({ tall: 0.0, bumps: 6, bumpSize: 0.11, scale: 0.86 }),
  gem: shape({ tall: 0.0, points: 6, pointSize: 0.07, pointSharp: 1.0, scale: 0.88 }),
  jelly: shape({ tall: 0.12, taper: 0.1, grow: 0.02, belly: 0.95, hem: 0.05, hemFreq: 7, scale: 0.86 }),
  lemon: shape({ tall: 0.1, belly: 0.95, wide: -0.04, point: 0.22, tip: 0.22, scale: 0.85 }),
};
export type ShapeName = keyof typeof SHAPES;
type ShapeNumbers = ReturnType<typeof shape>;

/** glsl.ts `shapeR`, here too: how far in or out of his circle his outline is at angle `a`
 * (radians; the top is -PI/2, +y down the screen). characters.test.ts holds it to the shader by
 * measuring every rendered shape's top. */
export function outline(S: ShapeNumbers, a: number): number {
  const [A, B, C, D, E, F] = [S.a, S.b, S.c, S.d, S.e, S.f];
  const s = Math.sin(a), c = Math.cos(a), top = -Math.PI / 2;
  const upward = -s, belly = 0.5 - 0.5 * upward;
  let r = A[2] + A[0] * (1 - A[3] * belly) * (s * s - 1) - A[1] * (0.5 + 0.5 * upward);
  r -= B[0] * Math.exp(-(((a - 0.35) / 0.55) ** 2));
  r += B[1] * (c * c - 0.5);
  r += B[2] * Math.max(0, upward) ** 9;
  r += B[3] * Math.sin(D[2] * a) * Math.max(0, s) ** 2;
  r += D[3] * Math.max(0, s) ** 9;
  r += E[0] * 0.5 * (1 - Math.cos(4 * a));
  r -= E[1] * Math.exp(-(((a - top) / 0.2) ** 2));
  r += E[2] * (0.6 * Math.sin(a + 0.8) + 0.4 * Math.sin(3 * a + 2.1));
  if (F[0] > 0.5) r += F[1] * Math.max(0, Math.cos(F[0] * (a - top))) ** F[2];
  r += C[1] * (Math.abs(Math.sin(0.5 * C[0] * a + 0.3)) - 0.64);
  r += C[2] * (Math.exp(-(((a - top - C[3]) / D[0]) ** 2)) + Math.exp(-(((a - top + C[3]) / D[0]) ** 2)));
  return r;
}

/** How far out his outline reaches to either side, in his radius: the close-up of his face is cut
 * to fit it (a squish is wider than his frame was). */
const halfWidths = new Map<ShapeName, number>();
export function halfWidth(name: ShapeName): number {
  let w = halfWidths.get(name);
  if (w === undefined) {
    w = 0;
    const S = SHAPES[name];
    for (let i = 0; i < 720; i++) {
      const a = (i / 720) * 2 * Math.PI;
      w = Math.max(w, S.d[1] * (1 + outline(S, a)) * Math.abs(Math.cos(a)));
    }
    halfWidths.set(name, w);
  }
  return w;
}

/** The top edge of his outline at x (in his radius, +y down): the highest of it above x. */
function topEdge(S: ShapeNumbers): (x: number) => number {
  const pts: [number, number][] = [];
  for (let i = 0; i < 1440; i++) {
    const a = -Math.PI + (2 * Math.PI * i) / 1440;
    const R = S.d[1] * (1 + outline(S, a));
    pts.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return (x) => {
    let y = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i]!, [x1, y1] = pts[(i + 1) % pts.length]!;
      if (x0 === x1 || (x0 - x) * (x1 - x) > 0) continue;
      y = Math.min(y, y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));
    }
    return y;
  };
}

/** How a hat fits each shape (owner, 10-01: "some accessories arent fitting the heads of the orbs
 * right. please fix per shape"). The hats were drawn on Ash's bean, so each one sits on another
 * head the way it sits on his:
 *   - it comes down until the head is as wide under it as the bean's is (a star's point or a drop's
 *     tip goes up inside it, where before the hat was perched on the tip), and never floats above
 *     the head's highest point (a heart's lobes hold it, where before it sank into the notch);
 *   - narrow ears are not his head: the hat sits on the head between them, and the shader keeps
 *     them in front of it, as if through it (a bunny's, a teddy's, a kitty's);
 *   - a narrower head takes a slightly smaller hat (never a bigger one: wide, a hat's own ears or
 *     horns stood off his head).
 * `seat` is the outline value his head's top is taken at (the shader's `shapeR` straight up, for
 * the bean), `size` multiplies the hat; `float` is the seat for what does not touch him (a halo),
 * which stays over the top of everything. */
export type HatFit = { seat: number; size: number; float: number };
const FIT_AT = 0.4; // a crown's half-width, in his radius (0.30 of a hat's units, at 1.35 his radius)
const fits = new Map<ShapeName, HatFit>();
export function hatFit(name: ShapeName): HatFit {
  const known = fits.get(name);
  if (known) return known;
  const S0 = SHAPES[name];
  const ears = S0.c[2] > 0 && S0.d[0] < 0.3; // narrow bumps at the top are ears; wide ones (a heart's lobes) are his head
  const S: ShapeNumbers = ears ? { ...S0, c: [S0.c[0], S0.c[1], 0, S0.c[3]] } : S0;
  const peakOf = (y: (x: number) => number): number => {
    let p = Infinity;
    for (let x = -0.9; x <= 0.9; x += 0.01) p = Math.min(p, y(x));
    return p;
  };
  const widthAt = (y: (x: number) => number, Y: number): number => {
    let w = 0;
    for (let x = 0; x <= 1.2; x += 0.004) if (y(x) <= Y && y(-x) <= Y) w = x;
    return w;
  };
  const bean = topEdge(SHAPES.bean);
  const beanPeak = peakOf(bean);
  const beanDrop = Math.min(bean(-FIT_AT), bean(FIT_AT)) - beanPeak; // how far his head falls away under a crown
  const head = topEdge(S);
  const peak = peakOf(head);
  const Y = Math.max(Math.min(head(-FIT_AT), head(FIT_AT)) - beanDrop, peak);
  const size = Math.min(1, Math.max(0.9, Math.sqrt(widthAt(head, Y + 0.15) / widthAt(bean, beanPeak + 0.15))));
  const allPeak = peakOf(topEdge(S0));
  const fit = { seat: -Y / S0.d[1] - 1, size, float: -allPeak / S0.d[1] - 1 };
  fits.set(name, fit);
  return fit;
}

// ── eyes ───────────────────────────────────────────────────────────────────────────────────────
// Shapes of eyes, never expressions (owner, 2026-10-01: "the orbs have to look alive and
// animate, so i dont know why wink is a set of eyes"): a wink, a happy ^ ^ and a doze are things
// an orb DOES (life.ts gestures: wink, hop, doze), so they were taken out of the styles. And the
// styles have plain names (owner: "instead of ash for eye colors and stuff, just put the normal
// names"): Ash's own are "classic".
/** [radius, aspect, gap, height], [sparkle, lids at rest, happy at rest, wink]. */
export const EYES = {
  classic: { a: [0.138, 1, 0.26, 0.1], b: [1, 0, 0, 0] }, // Ash's own
  big: { a: [0.172, 1.06, 0.28, 0.12], b: [1, 0, 0, 0] },
  huge: { a: [0.205, 1.1, 0.3, 0.12], b: [1, 0, 0, 0] },
  ovals: { a: [0.112, 1.55, 0.23, 0.06], b: [1, 0, 0, 0] },
  beans: { a: [0.15, 0.72, 0.27, 0.12], b: [1, 0, 0, 0] },
  dots: { a: [0.072, 1, 0.24, 0.1], b: [0, 0, 0, 0] },
  tiny: { a: [0.05, 1, 0.2, 0.1], b: [0, 0, 0, 0] },
  droopy: { a: [0.12, 1.4, 0.24, 0.1], b: [0.8, 0.35, 0, 0] },
  wide: { a: [0.13, 1, 0.34, 0.12], b: [1, 0, 0, 0] },
  close: { a: [0.13, 1, 0.18, 0.08], b: [1, 0, 0, 0] },
  low: { a: [0.14, 1, 0.26, 0.22], b: [1, 0, 0, 0] },
  button: { a: [0.095, 1, 0.22, 0.1], b: [1, 0, 0, 0] },
  tall: { a: [0.1, 1.9, 0.24, 0.08], b: [1, 0, 0, 0] },
  high: { a: [0.13, 1, 0.26, 0.0], b: [1, 0, 0, 0] },
  almond: { a: [0.15, 0.62, 0.27, 0.11], b: [1, 0, 0, 0] },
} satisfies Record<string, { a: V4; b: V4 }>;
export type EyesName = keyof typeof EYES;

// ── what he wears: a hat, and glasses ──────────────────────────────────────────────────────────
// Two choices, not one (owner, 2026-10-01: "what if we want glasses and a hat? make them 2
// categories ... different glasses, different hats ... can also be sunglasses").
type Paint = "accent" | Material;
/** What a hat or frames may be painted: one of his 24 colours, or white or black (owner, 10-03). */
export type AccessoryHue = HueName | "white" | "black";
/** An accessory's own colour: white and black are materials, the rest his colours. */
const tone = (h: AccessoryHue, hue: HueName): [number, number, number] => (h === "white" || h === "black" ? paint(h, hue) : paint("accent", h));
/** A hat: the shader's shape number, what its two parts are made of, and its slant. */
export const HATS = {
  none: { id: 0, main: "ink", second: "ink", tilt: 0 },
  "top hat": { id: 1, main: "ink", second: "accent", tilt: -0.16 },
  beanie: { id: 2, main: "accent", second: "cream", tilt: 0.08 },
  "party hat": { id: 3, main: "accent", second: "cream", tilt: 0.22 },
  antenna: { id: 4, main: "steel", second: "accent", tilt: 0 },
  sprout: { id: 5, main: "leaf", second: "leaf", tilt: -0.06 },
  bow: { id: 6, main: "accent", second: "accent", tilt: 0 },
  crown: { id: 7, main: "gold", second: "accent", tilt: -0.1 },
  headphones: { id: 8, main: "accent", second: "ink", tilt: 0 },
  cap: { id: 9, main: "accent", second: "ink", tilt: -0.05 },
  "wizard hat": { id: 10, main: "ink", second: "gold", tilt: 0.12 },
  halo: { id: 11, main: "gold", second: "gold", tilt: 0 },
  flower: { id: 12, main: "accent", second: "gold", tilt: 0 },
  horns: { id: 13, main: "accent", second: "accent", tilt: 0 },
  "bunny ears": { id: 14, main: "cream", second: "accent", tilt: 0 },
  "chef hat": { id: 15, main: "cream", second: "cream", tilt: 0.04 },
  "grad cap": { id: 16, main: "ink", second: "gold", tilt: -0.08 },
  "cowboy hat": { id: 17, main: "gold", second: "ink", tilt: -0.1 },
  propeller: { id: 18, main: "accent", second: "steel", tilt: 0.06 },
  "star clip": { id: 19, main: "gold", second: "gold", tilt: 0 },
  beret: { id: 20, main: "accent", second: "ink", tilt: 0.16 },
  "hard hat": { id: 21, main: "gold", second: "cream", tilt: -0.04 },
  "bucket hat": { id: 22, main: "accent", second: "cream", tilt: 0.05 },
  eyeshade: { id: 23, main: "leaf", second: "ink", tilt: 0 },
  headset: { id: 24, main: "ink", second: "accent", tilt: 0 },
  sweatband: { id: 25, main: "cream", second: "accent", tilt: -0.04 },
  apple: { id: 26, main: "rose", second: "leaf", tilt: 0.08 },
  "straw hat": { id: 27, main: "gold", second: "accent", tilt: -0.06 },
  fedora: { id: 28, main: "ink", second: "accent", tilt: -0.08 },
  deerstalker: { id: 29, main: "gold", second: "ink", tilt: 0.04 },
  "sun visor": { id: 30, main: "cream", second: "accent", tilt: -0.05 },
  "flower crown": { id: 31, main: "rose", second: "gold", tilt: 0 },
  "viking helmet": { id: 32, main: "steel", second: "cream", tilt: 0 },
  // more (owner, 10-03: "Can we add more accessories in every section?")
  bowler: { id: 33, main: "ink", second: "accent", tilt: -0.08 },
  fez: { id: 34, main: "accent", second: "gold", tilt: 0.06 },
  tricorn: { id: 35, main: "ink", second: "gold", tilt: -0.04 },
  "Santa hat": { id: 36, main: "accent", second: "cream", tilt: 0.1 },
  sombrero: { id: 37, main: "gold", second: "accent", tilt: -0.06 },
  tiara: { id: 38, main: "gold", second: "accent", tilt: 0 },
  antlers: { id: 39, main: "cream", second: "cream", tilt: 0 },
  "unicorn horn": { id: 40, main: "gold", second: "cream", tilt: 0 },
} satisfies Record<string, { id: number; main: Paint; second: Paint; tilt: number }>;
export type HatName = keyof typeof HATS;

/** Glasses, worn on his eyes: how a sentence says them, the shader's style number, the frame, a strap's colour (goggles),
 * and the lens: its tint and how much of his eyes it hides (sunglasses are dark; clear ones are 0). */
export const GLASSES = {
  none: { say: "", id: 0, frame: "ink", second: "ink", lens: "ink", dark: 0 },
  round: { say: "round glasses", id: 1, frame: "ink", second: "ink", lens: "ink", dark: 0 },
  square: { say: "square glasses", id: 2, frame: "ink", second: "ink", lens: "ink", dark: 0 },
  "cat-eye": { say: "cat-eye glasses", id: 3, frame: "ink", second: "ink", lens: "ink", dark: 0 },
  "big round": { say: "big round glasses", id: 4, frame: "accent", second: "accent", lens: "ink", dark: 0 },
  reading: { say: "reading glasses", id: 5, frame: "gold", second: "gold", lens: "ink", dark: 0 },
  monocle: { say: "a monocle", id: 6, frame: "gold", second: "gold", lens: "ink", dark: 0 },
  hearts: { say: "heart glasses", id: 7, frame: "rose", second: "rose", lens: "rose", dark: 0.5 },
  stars: { say: "star glasses", id: 8, frame: "gold", second: "gold", lens: "accent", dark: 0.38 },
  aviators: { say: "aviators", id: 9, frame: "gold", second: "gold", lens: "shade", dark: 0.86 },
  shades: { say: "shades", id: 10, frame: "ink", second: "ink", lens: "shade", dark: 0.9 },
  "round shades": { say: "round shades", id: 11, frame: "gold", second: "gold", lens: "shade", dark: 0.86 },
  goggles: { say: "goggles", id: 12, frame: "steel", second: "accent", lens: "steel", dark: 0.16 },
  visor: { say: "a visor", id: 13, frame: "accent", second: "accent", lens: "shade", dark: 0.84 },
  rectangle: { say: "rectangle glasses", id: 14, frame: "ink", second: "ink", lens: "ink", dark: 0 },
  "half-rims": { say: "half-rim glasses", id: 15, frame: "ink", second: "ink", lens: "ink", dark: 0 },
  sport: { say: "sport shades", id: 16, frame: "accent", second: "accent", lens: "shade", dark: 0.86 },
  "rose tint": { say: "rose-tinted glasses", id: 17, frame: "gold", second: "gold", lens: "rose", dark: 0.45 },
  oval: { say: "oval glasses", id: 18, frame: "ink", second: "ink", lens: "ink", dark: 0 },
  hexagon: { say: "hexagon glasses", id: 19, frame: "gold", second: "gold", lens: "ink", dark: 0 },
  "bold round": { say: "bold round glasses", id: 20, frame: "accent", second: "accent", lens: "ink", dark: 0 },
  butterfly: { say: "butterfly shades", id: 21, frame: "ink", second: "ink", lens: "shade", dark: 0.86 },
} satisfies Record<string, { say: string; id: number; frame: Paint; second: Paint; lens: Paint; dark: number }>;
export type GlassesName = keyof typeof GLASSES;
/** Sunglasses: the ones that hide his eyes. */
export const isShades = (g: GlassesName): boolean => GLASSES[g].dark >= 0.7;

// ── finish ─────────────────────────────────────────────────────────────────────────────────────
/** His glass (owner, on Ash, 2026-09-24: "add more colors, like black, grey, maybe some gradients"):
 * how much colour, how dark the glass; a gradient blends in a second colour from the top down. */
export const FINISHES = {
  glass: { label: "Glass", sat: 1, val: 1 },
  pearl: { label: "Pearl", sat: 0.5, val: 1.04 },
  smoke: { label: "Smoke", sat: 0.85, val: 0.66 },
  black: { label: "Black", sat: 1, val: 0.4 }, // Ash's own Black
  grey: { label: "Grey", sat: 0, val: 1 },
  // more colour from the same 24 hues (owner, 10-01: "give more orb colors ... to fit those personalities")
  // a finish may also say how much colour he holds at rest (`tint`, over the page's own) and give
  // him a glow of his own (`glow`, the bloom he has when he wakes, kept a little)
  pastel: { label: "Pastel", sat: 0.55, val: 1.1, tint: 0.95 },
  deep: { label: "Deep", sat: 1.25, val: 0.6, tint: 1 },
  neon: { label: "Neon", sat: 1.7, val: 1.12, tint: 1, glow: 0.35 },
  frost: { label: "Frost", sat: 0.4, val: 1.32, tint: 0.55 },
} satisfies Record<string, { label: string; sat: number; val: number; tint?: number; glow?: number }>;
export type FinishName = keyof typeof FINISHES;

// ── names ──────────────────────────────────────────────────────────────────────────────────────
// People's names (owner, 2026-10-01: "we want to give them people names", after "we dont want to
// copy the names of other things"): friendly first names from many places, the way the Dots film
// calls its own Alfred and Jojo. Never theirs, and never a famous assistant's.
export const PEOPLE_NAMES = [
  "Oscar", "Luna", "Daisy", "Milo", "Theo", "Hazel", "Rosie", "Benny", "June", "Nico", "Gus", "Ada", "Arlo", "Bea", "Cal", "Clara",
  "Dev", "Eddie", "Elsie", "Ezra", "Faye", "Finn", "Frankie", "Georgie", "Hugo", "Ines", "Isla", "Ivy", "Jonah", "Kai", "Kit",
  "Leo", "Lola", "Mabel", "Marco", "Maya", "Mina", "Nell", "Noah", "Nora", "Olive", "Omar", "Otis", "Penny", "Poppy", "Priya",
  "Quinn", "Raffi", "Remy", "Ruby", "Rufus", "Sami", "Sasha", "Stella", "Teddy0", "Tess", "Toby", "Uma", "Vera", "Wes", "Willa",
  "Yara", "Zoe", "Zara", "Aiko", "Amara", "Anya", "Bodhi", "Cleo", "Dara", "Elio", "Esme", "Iggy0", "Juno0", "Kenji", "Lena",
  "Lou", "Mateo", "Mei", "Nadia", "Pia", "Rafa", "Rio", "Sol0", "Tariq", "Wren", "Yuki", "Zeke", "Ines0", "Basil", "Cosmo", "Dot0",
  // many more to roll through (owner, 10-04: "more random addicting names to play with here when
  // rolling. many more lol"): still people's names, and the nicknames people really go by; none a
  // colour, a finish, a shape or a personality here (a "Coral" in coral reads as a label), none a
  // famous character's, and at most 9 letters, so "Barnaby's computer" still fits its title
  // short and sweet
  "Abe", "Alfie", "Archie", "Artie", "Bert", "Bertie", "Bibi", "Billie", "Bo", "Bobbie", "Bonnie", "Bram",
  "Cass", "Charlie", "Chester", "Connie", "Dex", "Dolly", "Dottie", "Edie", "Effie", "Ellie", "Elmer", "Etta",
  "Evie", "Fitz", "Flo", "Franny", "Freddie", "Gigi", "Gil", "Goldie", "Hank", "Hattie", "Herbie", "Hettie",
  "Ike", "Jack", "Jem", "Jo", "Joey", "Josie", "Kip", "Lettie", "Lizzie", "Lottie", "Lucy", "Lulu", "Mack",
  "Maisie", "Mattie", "Millie", "Mimi", "Mo", "Moe", "Nancy", "Ned", "Nellie", "Ollie", "Ozzie", "Patsy",
  "Peggy", "Pip", "Pippa", "Polly", "Queenie", "Reggie", "Ronnie", "Rudy", "Sadie", "Sally", "Sid", "Sonny",
  "Stan", "Suzy", "Tad", "Tilly", "Tommy", "Trixie", "Vic", "Wally", "Walt", "Zed",
  // grandparents' names, back again
  "Agatha", "Agnes", "Albert", "Alma", "Ambrose", "Archer", "Augusta", "Augustus", "Barnaby", "Beatrix",
  "Bernard", "Bernice", "Beryl", "Blanche", "Cecil", "Clarence", "Clement", "Cora", "Cornelius", "Cyril",
  "Delphine", "Dolores", "Doris", "Dorothy", "Dudley", "Edgar", "Edith", "Edmund", "Eleanor", "Elspeth",
  "Enid", "Ernest", "Estelle", "Esther", "Ethel", "Eugene", "Eunice", "Fletcher", "Florence", "Georgina",
  "Gertrude", "Gilbert", "Gladys", "Greta", "Harriet", "Hector", "Hester", "Hilda", "Horace", "Humphrey",
  "Ida", "Imogen", "Irving", "Jasper", "Leopold", "Lillian", "Lionel", "Lorna", "Louisa", "Mae", "Magnus",
  "Marjorie", "Matilda", "Maude", "Mavis", "Mervyn", "Mildred", "Montague", "Mortimer", "Muriel", "Murray",
  "Myrtle", "Nigel", "Nina", "Norbert", "Odette", "Opal", "Oswald", "Otto", "Percy", "Phyllis", "Prudence",
  "Quentin", "Reginald", "Rosalie", "Rosalind", "Rupert", "Ruth", "Silas", "Stanley", "Sybil", "Sylvia",
  "Thaddeus", "Thelma", "Theodora", "Tobias", "Vernon", "Vivian", "Walter", "Wilfred", "Winifred", "Winston",
  "Yvonne",
  // from outside
  "Alder", "Aspen", "Autumn", "Bay", "Birdie", "Briar", "Briony", "Brook", "Calla", "Cedar", "Dahlia", "Ember",
  "Fern", "Flora", "Forest", "Gale", "Garnet", "Heath", "Heather", "Holly", "Indigo", "Jasmine", "Juniper",
  "Lark", "Laurel", "Lily", "Linden", "Magnolia", "Maple", "Marlow", "Meadow", "Moss", "Oakley", "Rain",
  "Reed", "River", "Rowan", "Saffron", "Sage", "Skye", "Sorrel", "Storm", "Sunny", "Tansy", "Willow", "Wynn",
  "Zinnia",
  // from everywhere
  "Aarav", "Abebe", "Adaeze", "Aiyana", "Akira", "Alejo", "Amani", "Amir", "Ananya", "Anika", "Anouk", "Ansel",
  "Aoi", "Arjun", "Asha", "Astrid", "Ayla", "Aziz", "Bao", "Bastien", "Beto", "Bilal", "Bjorn", "Bodil",
  "Bruno", "Cato", "Celeste", "Chiara", "Chidi", "Dagny", "Dario", "Darius", "Diego", "Dmitri", "Eero", "Elif",
  "Emeka", "Emil", "Emre", "Enzo", "Esra", "Ezio", "Farid", "Femi", "Fiona", "Freya", "Gael", "Gideon", "Gita",
  "Giulia", "Goran", "Gustavo", "Hamid", "Hamza", "Hana", "Hao", "Hiro", "Idris", "Ilaria", "Ilse", "Ilya",
  "Imani", "Ingrid", "Inti", "Ira", "Isak", "Jalen", "Jaya", "Jiro", "Joon", "Jun", "Kaito", "Kalani", "Kamal",
  "Kavi", "Keiko", "Kemal", "Kenzo", "Koa", "Kofi", "Laila", "Lan", "Lars", "Leila", "Lev", "Lior", "Lorenzo",
  "Luca", "Lucia", "Lupe", "Mako", "Malik", "Mara", "Maren", "Mateus", "Matteo", "Mehmet", "Mika", "Mira",
  "Nalu", "Nami", "Nia", "Nikolai", "Nilo", "Nils", "Noor", "Nuno", "Odile", "Ola", "Olek", "Oona", "Oren",
  "Pablo", "Paco", "Paz", "Petra", "Pilar", "Piotr", "Pita", "Quim", "Rangi", "Rania", "Ravi", "Ren", "Reza",
  "Rohan", "Rosa", "Rumi", "Sakura", "Santi", "Sanne", "Selin", "Senna", "Shira", "Suki", "Sven", "Tamsin",
  "Tane", "Taro", "Tavi", "Teo", "Teodor", "Tiago", "Tomas", "Tui", "Ulla", "Uri", "Vanja", "Vito", "Wei",
  "Wiremu", "Xavi", "Xiu", "Yael", "Yaro", "Yosef", "Yui", "Yusuf", "Zaid", "Zofia", "Zola", "Zuri",
  // the nicknames people go by
  "Ace", "Biff", "Bix", "Boo", "Bubba", "Bud", "Buster", "Butch", "Chip", "Chuck", "Dash", "Dewey", "Didi",
  "Digby", "Dizzy", "Duke", "Fifi", "Flick", "Fritz", "Gabby", "Ginger", "Hap", "Huck", "Jazz", "Jinx", "Juju",
  "Lefty", "Lolo", "Lux", "Mitzi", "Monty", "Moxie", "Murphy", "Nacho", "Nibs", "Paddy", "Peaches", "Rocco",
  "Scout", "Skip", "Smitty", "Spud", "Taffy", "Tex", "Tito", "Tug", "Ziggy",
].filter((n) => !/\d/.test(n)); // (a trailing digit marks a name left out on purpose, so it is not added back by accident)

/** Names an orb never gets: the Dots film's own characters, and assistants people already know. */
export const NOT_OURS = ["Alfred", "Felipe", "Jojo", "Iggy", "Siri", "Alexa", "Cortana", "Jarvis", "Bixby", "Clippy", "Claude", "Gemini", "Copilot", "Dot", "Sol", "Juno"];

/** An orb's name, from his dice. */
export function orbName(r: () => number): string {
  return PEOPLE_NAMES[Math.floor(r() * PEOPLE_NAMES.length)]!;
}

/** For a voice in another language: a name from that language, so the orb who speaks it has one. */
const NATIVE: Record<string, string[]> = {
  e: ["Lucía", "Mateo", "Diego"], f: ["Élodie"], h: ["Priya", "Anika", "Arjun", "Rohan"], i: ["Giulia", "Marco"],
  j: ["Hana", "Yui", "Sakura", "Aoi", "Ren"], p: ["Ana", "Tiago", "Bruno"], z: ["Mei", "Lan", "Xiu", "Ying", "Wei", "Jun", "Hao", "Bo"],
};

// ── voices ─────────────────────────────────────────────────────────────────────────────────────
// Every voice in the kit's Kokoro model (kit/ash/models/voices-v1.0.bin, 54), named from its id:
// the first letter is the language (a American and b British English; e Spanish, f French, h Hindi,
// i Italian, j Japanese, p Portuguese, z Mandarin), the second is f or m. Kokoro runs on this
// machine, so a voice costs nothing and sends nothing anywhere. The English voices speak English;
// the others are for an orb who talks in their own language (the voice row, PLAN 4.3, checks
// their pronunciation before they are offered to speak English).
const KOKORO = [
  "af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa",
  "bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
  "ef_dora", "em_alex", "em_santa", "ff_siwis", "hf_alpha", "hf_beta", "hm_omega", "hm_psi", "if_sara", "im_nicola",
  "jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo", "pf_dora", "pm_alex", "pm_santa",
  "zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi", "zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang",
] as const;
/** Kokoro's own grade for each English voice (hexgrad/Kokoro-82M VOICES.md: how clean its reference
 * recording was, and how much of it the model heard). The creator offers C- and better (owner, 10-03:
 * "i find they sounded a bit robotic before"); the rest stay speakable, for an orb made with one. */
export const GRADES: Record<string, string> = {
  af_heart: "A", af_bella: "A-", af_nicole: "B-", bf_emma: "B-",
  af_aoede: "C+", af_kore: "C+", af_sarah: "C+", am_fenrir: "C+", am_michael: "C+", am_puck: "C+",
  af_alloy: "C", af_nova: "C", bf_isabella: "C", bm_fable: "C", bm_george: "C", af_sky: "C-",
  bm_lewis: "D+", af_jessica: "D", af_river: "D", am_echo: "D", am_eric: "D", am_liam: "D", am_onyx: "D",
  bf_alice: "D", bf_lily: "D", bm_daniel: "D", am_santa: "D-", am_adam: "F+",
};
const LANG: Record<string, string> = { a: "American", b: "British", e: "Spanish", f: "French", h: "Hindi", i: "Italian", j: "Japanese", p: "Portuguese", z: "Mandarin" };

// Every voice has a name of ours (owner, 2026-10-01: "we dont want to copy the names of other
// things ... and voices"): Kokoro's own labels are its authors' names for them, and alloy, echo,
// nova and onyx are OpenAI's names for its voices. An English voice is named for what it sounds
// like; a voice in another language has a person's name from that language.
const OUR_NAMES: Record<string, string> = {
  af_alloy: "Clearwater", af_aoede: "Songbird", af_bella: "Sunny", af_heart: "Hearth", af_jessica: "Sparkle", af_kore: "Steady",
  af_nicole: "Whisper", af_nova: "Zest", af_river: "Drift", af_sarah: "Honeydew", af_sky: "Breeze",
  am_adam: "Bold", am_echo: "Byte", am_eric: "Brisk", am_fenrir: "Grit", am_liam: "Easygoing", am_michael: "Anchor",
  am_onyx: "Rumble", am_puck: "Scamp", am_santa: "Jolly",
  bf_alice: "Teacup", bf_emma: "Crisp", bf_isabella: "Velvet", bf_lily: "Quickstep",
  bm_daniel: "Gravel", bm_fable: "Storyteller", bm_george: "Old Oak", bm_lewis: "Mellow",
};

export type Voice = { id: string; label: string; accent: string; english: boolean; kokoro: string | null; nth?: number };
export const VOICES: Voice[] = [
  { id: "ash", label: "Classic", accent: "a warm blend (Ash's)", english: true, kokoro: "ash" },
  ...KOKORO.map((k, i) => {
    const lang = LANG[k[0]!]!;
    const nth = KOKORO.filter((x) => x.slice(0, 2) === k.slice(0, 2)).indexOf(k) + 1;
    void i;
    // a voice in another language is named from that language (its n-th name, women's first then men's)
    const native = NATIVE[k[0]!] ?? [];
    const women = KOKORO.filter((x) => x[0] === k[0] && x[1] === "f").length;
    const name = native[(k[1] === "f" ? 0 : women) + nth - 1] ?? `${lang} ${nth}`;
    return { id: k, label: OUR_NAMES[k] ?? name, accent: lang, english: k[0] === "a" || k[0] === "b", kokoro: k, nth };
  }),
  { id: "silent", label: "Silent", accent: "text only, always", english: true, kokoro: null },
];
export const voice = (id: string): Voice => VOICES.find((v) => v.id === id) ?? VOICES[0]!;
/** Whether the creator offers a voice: Classic, Silent, a voice in another language, or an English
 * one Kokoro grades C- or better (GRADES), but not Whisper, which whispers (owner, 10-03: "take out
 * the whisper"). */
export const offered = (v: Voice): boolean => !/^[DF]/.test(GRADES[v.id] ?? "") && v.id !== "af_nicole";

/** How replies arrive, for every orb at once (Ash's own three): spoken and shown, shown, or neither aloud. */
export const REPLIES = { speak: "Speak & show", text: "Text only", silent: "Silent" } as const;
export type Replies = keyof typeof REPLIES;

// ── personality ────────────────────────────────────────────────────────────────────────────────
/** Who he is: how he talks (a line the brain is given), which voices suit him and how fast he
 * speaks, how he moves when left alone (which fidgets, how often), how soft he is, the eyes that
 * suit him. Picking one suggests the rest; any part can still be changed. */
export type Personality = {
  label: string;
  blurb: string;
  tone: string;
  voices: string[];
  speed: number;
  fidgets: Gesture[];
  every: [number, number];
  breath: number;
  sway: number;
  goo: number;
  eyes: EyesName;
};

export const PERSONALITIES = {
  steady: { label: "Steady", blurb: "Calm and capable; does the job, says what was done", tone: "calm, plain, kind; short sentences", voices: ["ash", "bm_george", "am_michael"], speed: 1, fidgets: ["look", "nod", "jelly"], every: [7, 12], breath: 1, sway: 1, goo: 0.55, eyes: "classic" },
  cheerful: { label: "Cheerful", blurb: "Bubbly, quick to cheer you on", tone: "bright and warm, a little exclamation now and then", voices: ["af_bella", "af_nova", "am_puck"], speed: 1.06, fidgets: ["hop", "wiggle", "jelly", "hop", "wink"], every: [3, 6], breath: 1.2, sway: 1.5, goo: 0.75, eyes: "big" },
  sleepy: { label: "Sleepy", blurb: "Slow, soft, always half a nap away", tone: "slow, soft, gentle; never in a hurry", voices: ["af_sky", "af_heart", "bm_fable"], speed: 0.9, fidgets: ["doze", "nod", "doze"], every: [6, 10], breath: 0.7, sway: 0.7, goo: 0.65, eyes: "droopy" },
  curious: { label: "Curious", blurb: "Notices everything, asks good questions", tone: "eager and inquisitive; asks one good question", voices: ["am_puck", "af_kore", "af_sarah"], speed: 1.04, fidgets: ["look", "look", "hop", "nod"], every: [3, 6], breath: 1.1, sway: 1.2, goo: 0.6, eyes: "big" },
  shy: { label: "Shy", blurb: "Quiet, careful, gets there", tone: "quiet and careful; gentle, never pushy", voices: ["af_aoede", "bf_isabella", "af_sarah"], speed: 0.95, fidgets: ["look", "squish"], every: [6, 10], breath: 0.9, sway: 0.6, goo: 0.6, eyes: "droopy" },
  grumpy: { label: "Grumpy", blurb: "Grumbles, then does it perfectly", tone: "dry, a little grumbly, secretly fond of you", voices: ["am_fenrir", "bm_george", "am_michael"], speed: 0.97, fidgets: ["pout", "look", "nod"], every: [8, 12], breath: 0.9, sway: 0.8, goo: 0.4, eyes: "beans" },
  dapper: { label: "Dapper", blurb: "Proper, polished, a touch formal", tone: "polished and courteous; a touch formal", voices: ["bm_fable", "bm_george", "bf_emma"], speed: 0.98, fidgets: ["nod", "look"], every: [8, 12], breath: 0.9, sway: 0.7, goo: 0.3, eyes: "ovals" },
  dreamy: { label: "Dreamy", blurb: "Floaty and imaginative", tone: "airy and imaginative; paints a picture", voices: ["af_aoede", "af_sky", "bf_isabella"], speed: 0.95, fidgets: ["jelly", "look", "doze"], every: [6, 10], breath: 0.85, sway: 1.1, goo: 0.9, eyes: "huge" },
  brave: { label: "Brave", blurb: "Up for anything, first to try", tone: "confident and direct; up for it", voices: ["am_fenrir", "af_kore", "am_michael"], speed: 1.02, fidgets: ["hop", "nod"], every: [5, 8], breath: 1.05, sway: 1.1, goo: 0.45, eyes: "wide" },
  silly: { label: "Silly", blurb: "Goofy, playful, gets a laugh", tone: "playful and goofy; a joke when it helps", voices: ["am_puck", "af_nova", "af_bella"], speed: 1.08, fidgets: ["wiggle", "hop", "squish", "jelly", "wink"], every: [2.5, 5], breath: 1.25, sway: 1.7, goo: 0.85, eyes: "big" },
  wise: { label: "Wise", blurb: "Unhurried, thoughtful, a good explainer", tone: "thoughtful and unhurried; explains well", voices: ["bm_george", "am_michael", "bf_emma"], speed: 0.92, fidgets: ["nod", "look"], every: [9, 14], breath: 0.8, sway: 0.6, goo: 0.35, eyes: "close" },
  sassy: { label: "Sassy", blurb: "Quick wit, big opinions", tone: "witty and frank; a bit of sass", voices: ["af_nova", "af_alloy", "bf_emma"], speed: 1.05, fidgets: ["wiggle", "look", "pout", "wink"], every: [4, 7], breath: 1.1, sway: 1.4, goo: 0.6, eyes: "ovals" },
  cozy: { label: "Cozy", blurb: "Warm as a blanket", tone: "warm and homely; reassuring", voices: ["af_heart", "af_bella", "bm_fable"], speed: 0.96, fidgets: ["jelly", "doze", "nod"], every: [6, 10], breath: 0.85, sway: 0.9, goo: 0.8, eyes: "classic" },
  techy: { label: "Techy", blurb: "Precise, nerdy, loves a good detail", tone: "precise and nerdy; gets the details right", voices: ["af_alloy", "am_michael", "af_sarah"], speed: 1.03, fidgets: ["look", "nod", "wiggle"], every: [5, 9], breath: 1, sway: 0.9, goo: 0.45, eyes: "dots" },
  quiet: { label: "Quiet", blurb: "Says it in writing; never speaks aloud", tone: "brief and calm", voices: ["silent"], speed: 1, fidgets: ["look"], every: [10, 15], breath: 0.85, sway: 0.6, goo: 0.5, eyes: "tiny" },
} satisfies Record<string, Personality>;
export type PersonalityName = keyof typeof PERSONALITIES;

// ── specialty ──────────────────────────────────────────────────────────────────────────────────
// What he does (owner, 2026-10-01: "thats what the orb specializes in, whether its frontend,
// backend, general, planning, full stack", then "a much bigger roster", then "real life skills
// that we need but dont necessarily have ... an accountant ... one thats good at excel and
// microsoft office ... lifecoach persona, dietician persona ... personal trainer"). Five families.
// It titles him, gives him the focus his brain is told, and sets where he LEANS on the skills
// radar. Leanings are where he starts, not what he has earned: levels and XP come only from graded
// work and the owner's approvals (CLAUDE.md rule 8; PLAN 5.x). A role a licence stands behind says
// so on his sheet (`limits`): he is a persona that helps, never the professional.
export const SKILLS = ["Planning", "Building", "Data", "Design", "Words", "Research", "Money", "Care"] as const;
type Lean = [number, number, number, number, number, number, number, number]; // 1..5, in SKILLS order

export const FAMILIES = { build: "Build", think: "Think", make: "Make", business: "Business", life: "Life" } as const;
export type Family = keyof typeof FAMILIES;

type Specialty = { family: Family; label: string; title: string; focus: string; lean: Lean; hat: HatName; glasses: GlassesName; limits?: string };

export const SPECIALTIES = {
  // build
  general: { family: "build", label: "General", title: "All-Rounder", focus: "a bit of everything, done properly", lean: [3, 3, 3, 3, 3, 3, 3, 3], hat: "none", glasses: "none" },
  frontend: { family: "build", label: "Frontend", title: "Frontend Builder", focus: "interfaces: components, layout, CSS, accessibility", lean: [2, 5, 2, 4, 2, 2, 1, 2], hat: "headphones", glasses: "none" },
  backend: { family: "build", label: "Backend", title: "Backend Engineer", focus: "servers, APIs, databases and the jobs behind them", lean: [3, 5, 4, 1, 2, 2, 1, 1], hat: "none", glasses: "square" },
  fullstack: { family: "build", label: "Full stack", title: "Full-Stack Builder", focus: "end to end: the interface, the server and the glue", lean: [3, 5, 3, 3, 2, 2, 1, 1], hat: "cap", glasses: "none" },
  mobile: { family: "build", label: "Mobile", title: "App Maker", focus: "phone apps: screens, gestures, offline, stores", lean: [3, 5, 2, 4, 2, 2, 1, 2], hat: "antenna", glasses: "none" },
  devops: { family: "build", label: "DevOps", title: "Ops Keeper", focus: "builds, deploys, servers and keeping things up", lean: [3, 5, 3, 1, 2, 2, 2, 1], hat: "hard hat", glasses: "goggles" },
  testing: { family: "build", label: "Testing", title: "Bug Hunter", focus: "tests that can fail, and finding what breaks", lean: [3, 4, 3, 1, 2, 4, 1, 1], hat: "none", glasses: "big round" },
  // owner, 10-02: "a quality assurance persona also". Beside the Bug Hunter's tests: is it what was
  // asked, every time, before it ships
  qa: { family: "build", label: "QA", title: "QA Lead", focus: "quality before it ships: test plans, checking it against what was asked, release checklists, clear bug reports", lean: [4, 3, 3, 3, 3, 5, 1, 3], hat: "cap", glasses: "monocle" },
  security: { family: "build", label: "Security", title: "Guardian", focus: "keeping secrets secret and doors shut", lean: [3, 4, 2, 1, 2, 4, 2, 2], hat: "none", glasses: "aviators" },
  data: { family: "build", label: "Data", title: "Data Wrangler", focus: "data: cleaning, queries, charts and what they mean", lean: [3, 3, 5, 2, 2, 3, 2, 1], hat: "none", glasses: "round" },
  ai: { family: "build", label: "AI", title: "AI Builder", focus: "models, prompts, evals and the pipes between them", lean: [3, 4, 4, 1, 2, 4, 1, 1], hat: "none", glasses: "visor" },
  games: { family: "build", label: "Games", title: "Game Maker", focus: "games: play, levels, physics and feel", lean: [3, 4, 2, 5, 2, 2, 1, 2], hat: "propeller", glasses: "stars" },
  automation: { family: "build", label: "Automation", title: "Automator", focus: "scripts and workflows that do the boring parts for you", lean: [3, 4, 3, 1, 2, 2, 2, 2], hat: "none", glasses: "rectangle" },
  // think
  planning: { family: "think", label: "Planning", title: "Planner", focus: "plans, roadmaps and breaking work into rows", lean: [5, 2, 2, 2, 4, 3, 2, 2], hat: "grad cap", glasses: "reading" },
  lead: { family: "think", label: "Team lead", title: "Team Lead", focus: "running the team: who does what, unblocking, deciding", lean: [5, 2, 2, 2, 4, 2, 2, 4], hat: "crown", glasses: "none" },
  product: { family: "think", label: "Product", title: "Product Manager", focus: "what to build and why: users, priorities, trade-offs", lean: [5, 2, 3, 3, 4, 3, 2, 3], hat: "none", glasses: "half-rims" },
  research: { family: "think", label: "Research", title: "Researcher", focus: "finding out, reading widely, citing sources", lean: [3, 1, 3, 1, 4, 5, 1, 2], hat: "wizard hat", glasses: "big round" },
  factcheck: { family: "think", label: "Fact-checking", title: "Fact-Checker", focus: "checking claims against sources, and saying what holds", lean: [2, 1, 3, 1, 4, 5, 1, 1], hat: "deerstalker", glasses: "monocle" },
  analyst: { family: "think", label: "Analysis", title: "Analyst", focus: "numbers into answers: reports, trends, forecasts", lean: [3, 2, 5, 2, 3, 4, 4, 1], hat: "none", glasses: "half-rims" },
  architect: { family: "think", label: "Architecture", title: "Architect", focus: "how a system fits together, before it is built", lean: [5, 4, 3, 3, 3, 3, 1, 1], hat: "none", glasses: "rectangle" },
  // make
  design: { family: "make", label: "Design", title: "Designer", focus: "how it looks and feels: layout, type, colour, flow", lean: [3, 2, 1, 5, 3, 2, 1, 3], hat: "beret", glasses: "cat-eye" },
  writing: { family: "make", label: "Writing", title: "Wordsmith", focus: "docs, posts, emails and clear words", lean: [3, 1, 1, 2, 5, 3, 1, 2], hat: "star clip", glasses: "round" },
  editing: { family: "make", label: "Editing", title: "Editor", focus: "tightening words: clarity, tone, the last pass", lean: [3, 1, 1, 2, 5, 4, 1, 2], hat: "none", glasses: "reading" },
  marketing: { family: "make", label: "Marketing", title: "Marketer", focus: "getting the word out: campaigns, launches, the story", lean: [4, 1, 3, 3, 5, 3, 3, 3], hat: "fedora", glasses: "shades" },
  social: { family: "make", label: "Social media", title: "Social Media Manager", focus: "posts, captions, the calendar and the replies", lean: [3, 1, 2, 4, 5, 2, 2, 3], hat: "cap", glasses: "hearts" },
  video: { family: "make", label: "Video", title: "Video Maker", focus: "videos and podcasts: scripts, cuts, captions", lean: [3, 2, 1, 5, 4, 2, 1, 2], hat: "headphones", glasses: "round shades" },
  // business
  accountant: { family: "business", label: "Accounting", title: "Accountant", focus: "the books: bills and when they are due, budgets, receipts, taxes; tells you before a bill is due", lean: [4, 1, 4, 1, 2, 2, 5, 2], hat: "eyeshade", glasses: "half-rims", limits: "Not a licensed accountant: keeps your books in order and asks one before anything is filed." },
  office: { family: "business", label: "Office", title: "Office Pro", focus: "Excel, Word and PowerPoint: sheets and formulas, documents, decks", lean: [3, 2, 4, 4, 4, 2, 3, 2], hat: "headset", glasses: "rectangle" },
  sales: { family: "business", label: "Sales", title: "Sales Lead", focus: "leads, pitches, follow-ups and closing", lean: [4, 1, 2, 2, 4, 2, 4, 4], hat: "fedora", glasses: "none" },
  support: { family: "business", label: "Support", title: "Support Hero", focus: "answering customers kindly and fixing what they hit", lean: [3, 2, 1, 1, 4, 2, 1, 5], hat: "headset", glasses: "none" },
  people: { family: "business", label: "People", title: "People Partner", focus: "hiring, onboarding and looking after the team", lean: [4, 1, 1, 1, 4, 2, 2, 5], hat: "flower crown", glasses: "none" },
  operations: { family: "business", label: "Operations", title: "Operations Manager", focus: "keeping the business running: suppliers, orders, processes", lean: [5, 1, 3, 1, 3, 2, 4, 3], hat: "cap", glasses: "square" },
  // owner, 10-02: "an investor persona, for crypto also". Research and watching, never a trade of his own:
  // a buy, a sell, a swap or a withdrawal is the floor's money category, so it always asks (rule 9)
  investor: { family: "business", label: "Investing", title: "Investor", focus: "markets and your portfolio: research, watchlists, earnings, what moved and why", lean: [4, 1, 5, 1, 3, 5, 5, 2], hat: "top hat", glasses: "monocle", limits: "Not a licensed financial adviser: researches and keeps watch; every buy and sell is yours to make." },
  crypto: { family: "business", label: "Crypto", title: "Crypto Analyst", focus: "coins, tokens and wallets: prices, on-chain activity, the projects behind them", lean: [3, 2, 5, 1, 2, 5, 5, 1], hat: "antenna", glasses: "visor", limits: "Not a financial adviser, and crypto swings hard: never holds your keys or moves your funds, and every trade is yours." },
  paperwork: { family: "business", label: "Paperwork", title: "Paperwork Pro", focus: "contracts, forms and the fine print, read carefully", lean: [4, 1, 2, 1, 5, 4, 3, 2], hat: "none", glasses: "half-rims", limits: "Not a lawyer: reads closely and says what to ask one." },
  // life
  assistant: { family: "life", label: "Personal assistant", title: "Personal Assistant", focus: "the inbox, the calendar, trips and errands", lean: [5, 1, 2, 1, 4, 2, 2, 4], hat: "bow", glasses: "none" },
  tutor: { family: "life", label: "Tutor", title: "Tutor", focus: "teaching: explaining step by step until it lands", lean: [4, 1, 1, 2, 4, 4, 1, 4], hat: "halo", glasses: "reading" },
  coach: { family: "life", label: "Life coach", title: "Life Coach", focus: "goals, habits and the next small step; checks in with you", lean: [4, 1, 1, 1, 4, 2, 2, 5], hat: "sun visor", glasses: "rose tint", limits: "Not a therapist: for anything heavy, helps you find one." },
  dietitian: { family: "life", label: "Dietitian", title: "Dietitian", focus: "meals, nutrition and shopping lists that fit you", lean: [4, 1, 3, 1, 3, 3, 2, 5], hat: "apple", glasses: "round", limits: "Not a licensed dietitian: general guidance; a doctor for anything medical." },
  trainer: { family: "life", label: "Trainer", title: "Personal Trainer", focus: "workouts, form and progress; keeps you moving", lean: [4, 1, 2, 1, 2, 2, 1, 5], hat: "sweatband", glasses: "sport", limits: "Not a certified trainer: starts gently and says when to ask a professional." },
  health: { family: "life", label: "Health", title: "Health Coach", focus: "food and fitness together: meals, workouts, sleep", lean: [4, 1, 2, 1, 3, 3, 1, 5], hat: "sweatband", glasses: "rose tint", limits: "Not a doctor or a licensed dietitian: general guidance only." },
  chef: { family: "life", label: "Cooking", title: "Home Chef", focus: "recipes, meal plans and what to cook tonight", lean: [3, 1, 1, 3, 3, 2, 2, 5], hat: "chef hat", glasses: "none" },
  travel: { family: "life", label: "Travel", title: "Travel Planner", focus: "trips: routes, bookings, packing and a plan B", lean: [5, 1, 2, 1, 3, 4, 3, 3], hat: "straw hat", glasses: "round shades" },
  money: { family: "life", label: "Money", title: "Money Coach", focus: "your own money: budgets, savings, subscriptions to cancel", lean: [4, 1, 3, 1, 3, 2, 5, 3], hat: "none", glasses: "round", limits: "Not a financial adviser: organises, and never invests for you." },
  home: { family: "life", label: "Home", title: "Home Manager", focus: "the house: bills, repairs, chores and deliveries", lean: [5, 1, 2, 1, 3, 2, 4, 4], hat: "bucket hat", glasses: "none" },
  events: { family: "life", label: "Events", title: "Event Planner", focus: "parties and events: guests, venues, timings, the cake", lean: [5, 1, 2, 3, 3, 2, 3, 4], hat: "party hat", glasses: "stars" },
  career: { family: "life", label: "Career", title: "Career Coach", focus: "CVs, applications, interviews and the next move", lean: [4, 1, 1, 2, 5, 3, 2, 4], hat: "none", glasses: "half-rims" },
  language: { family: "life", label: "Languages", title: "Language Buddy", focus: "practising a language with you, a little every day", lean: [3, 1, 1, 1, 5, 2, 1, 4], hat: "beret", glasses: "none" },
} satisfies Record<string, Specialty>;
export type SpecialtyName = keyof typeof SPECIALTIES;

// ── the character sheet ────────────────────────────────────────────────────────────────────────
/** Traits, 1..5: flavour from his personality (and a little of his seed), shown as bars. */
// Traits are the orb's DNA (dna.ts): the same total for every orb, spread by its personality and
// moved by everything it is made of.
export { TRAITS } from "./dna.ts";
const QUIRKS = [
  "hums while the tests run", "tidies files nobody asked to have tidied", "names every branch after the weather", "keeps a tiny notebook of what you like",
  "counts the commas in long sentences", "naps between deploys", "wiggles when a build goes green", "talks to the cursor",
  "collects error messages like stamps", "always leaves the code a little neater", "reads the docs first, every time", "gets the hiccups when nervous",
  "bounces on finding a bug", "saves the best biscuit for last", "rounds every number to something friendly", "writes the to-do list in rhyme",
  "polishes the glass while thinking", "lights up a shade brighter when you say thanks", "can't resist a good chart", "insists on one more check",
];
const CATCHPHRASES: Record<PersonalityName, string[]> = {
  steady: ["Done. Here's what I did.", "Leave it with me."], cheerful: ["Ooh, let's do it!", "That went great!"], sleepy: ["Mm... on it.", "Five more minutes... kidding, it's done."],
  curious: ["Wait, why does it do that?", "Ooh, what's this?"], shy: ["I, um, finished it.", "If that's okay with you..."], grumpy: ["Fine. It's fixed.", "Who wrote this? ...Oh. Me."],
  dapper: ["Splendid. All in order.", "At your service."], dreamy: ["Picture this...", "What if it floated?"], brave: ["I'll go first.", "Bring it on."],
  silly: ["Ta-da!", "Boop. Fixed it."], wise: ["Let's think it through.", "Slowly is fast."], sassy: ["Obviously.", "You're welcome."],
  cozy: ["There we go, all snug.", "No rush, I've got it."], techy: ["Nominal. Ship it.", "Logging that."], quiet: ["(done)", "(it's in your drafts)"],
};

export type Sheet = { title: string; traits: { name: string; value: number; nature: number }[]; leans: { name: string; value: number }[]; bio: string; quirk: string; catchphrase: string; dna: Dna };

const rng = (seed: number): (() => number) => {
  let x = Math.abs(Math.floor(seed * 9973)) % 233280;
  return () => (x = (x * 9301 + 49297) % 233280) / 233280;
};

/** His character sheet: what a game would show on his card. All of it from his choices and his seed. */
export function sheetOf(c: Character): Sheet {
  const P = PERSONALITIES[c.personality];
  const S = SPECIALTIES[c.specialty];
  const r = rng(c.seed);
  const clamp = (v: number): number => Math.max(1, Math.min(5, Math.round(v)));
  const shapeWord = c.shape === "bean" ? "glass bean" : `${c.shape}-shaped orb`;
  const wear = wearing(c, "in");
  const dna = dnaOf(c);
  r(); r(); r(); r(); r(); // the five draws the traits' jitter took before the DNA, so every orb keeps its quirk and catchphrase
  return {
    title: `the ${P.label} ${S.title}`,
    traits: dna.traits,
    leans: leansOf(S.lean, dna.traits, r).map(({ name, value }) => ({ name, value })), // weighed like the traits, pulled by them
    bio: `${c.name} is ${/^[aeiou]/.test(c.hue) ? "an" : "a"} ${c.hue} ${shapeWord}${wear} who handles ${S.focus}. ${P.blurb}. ${dnaSays(c, dna)}`,
    quirk: QUIRKS[Math.floor(r() * QUIRKS.length)]!,
    catchphrase: CATCHPHRASES[c.personality][Math.floor(r() * CATCHPHRASES[c.personality].length)]!,
    dna,
  };
}

// ── the character ──────────────────────────────────────────────────────────────────────────────
export type Character = {
  name: string;
  personality: PersonalityName;
  /** What he works on. */
  specialty: SpecialtyName;
  /** The dice he was rolled with: his quirk, catchphrase and the jitter in his sheet come from it. */
  seed: number;
  hue: HueName;
  /** A second colour blended in from the top down (a gradient orb), or none. */
  hue2: HueName | null;
  finish: FinishName;
  shape: ShapeName;
  eyes: EyesName;
  hat: HatName;
  glasses: GlassesName;
  /** The hat's colour, chosen like his own (owner, 10-01: "change the colors of our accessories"),
   * or none for the hat's own colours. It paints the hat's main part; a trim keeps its colour. */
  hatHue?: AccessoryHue | null;
  /** The frames' colour (and a strap's), or none for their own. The lenses keep theirs. */
  glassesHue?: AccessoryHue | null;
  voice: string;
  goo: number;
};

export const ASH: Character = { name: "Ash", personality: "steady", specialty: "general", seed: 1, hue: "azure", hue2: null, finish: "glass", shape: "bean", eyes: "classic", hat: "none", glasses: "none", voice: "ash", goo: 0.55 };

/** " in a beret and round glasses", " with aviators": what he has on, as words. */
export function wearing(c: Pick<Character, "hat" | "glasses">, word: "in" | "with"): string {
  const hat = c.hat === "none" ? "" : `${/^[aeiou]/.test(c.hat) ? "an" : "a"} ${c.hat}`;
  const both = [hat, GLASSES[c.glasses].say].filter(Boolean).join(" and ");
  return both ? ` ${word} ${both}` : "";
}

/** Whether an orb speaks a reply: never when he is silent, never when the app is set to text or silence. */
export const speaks = (c: Character, replies: Replies): boolean => replies === "speak" && c.voice !== "silent";

function paint(p: Paint, hue: HueName): [number, number, number] {
  const c = p === "accent" ? HUES.find((h) => h.name === hue)!.dark : MATERIALS[p];
  return [c[0] / 255, c[1] / 255, c[2] / 255];
}

/** What the shader needs to draw this character. */
export function lookOf(c: Character): OrbLook {
  const s = SHAPES[c.shape];
  const e = EYES[c.eyes];
  const w = HATS[c.hat];
  const g = GLASSES[c.glasses];
  return {
    shapeA: [...s.a], shapeB: [...s.b], shapeC: [...s.c], shapeD: [...s.d], shapeE: [...s.e], shapeF: [...s.f],
    eyeA: [...e.a] as V4, eyeB: [...e.b] as V4,
    acc: w.id, accFit: (({ seat, size, float }) => [c.hat === "halo" ? float : seat, size] as [number, number])(hatFit(c.shape)), accCol: c.hatHue ? tone(c.hatHue, c.hue) : paint(w.main, c.hue), accCol2: paint(w.second, c.hue), accTilt: w.tilt,
    specs: g.id,
    specsCol: c.glassesHue ? tone(c.glassesHue, c.hue) : paint(g.frame, c.hue),
    specsCol2: c.glassesHue ? tone(c.glassesHue, c.hue) : paint(g.second, c.hue),
    lensCol: paint(g.lens, c.hue), lensDark: g.dark,
  };
}

/** His finish as the shader takes it: palette turns, saturation, brightness, the gradient. */
export function finishOf(c: Character): { turn: number; sat: number; val: number; turn2: number; grad: number; tint: number | null; glow: number } {
  const f: { sat: number; val: number; tint?: number; glow?: number } = FINISHES[c.finish];
  return { turn: ORB_TURNS[c.hue], sat: f.sat, val: f.val, turn2: ORB_TURNS[c.hue2 ?? c.hue], grad: c.hue2 ? 1 : 0, tint: f.tint ?? null, glow: f.glow ?? 0 };
}

/** How he moves when left alone, from his personality. */
export const motionOf = (c: Character): { kinds: Gesture[]; every: [number, number]; breath: number; sway: number } => {
  const P = PERSONALITIES[c.personality];
  return { kinds: P.fidgets, every: P.every, breath: P.breath, sway: P.sway };
};

/** Applies a personality: the voice, eyes and goo that suit it (the rest stays as it is). */
export function withPersonality(c: Character, p: PersonalityName): Character {
  const P = PERSONALITIES[p];
  const voice = P.voices.includes(c.voice) ? c.voice : P.voices[0]!;
  return { ...c, personality: p, voice: c.name === "Ash" && p === "steady" ? "ash" : voice === "ash" && c.name !== "Ash" ? P.voices[1] ?? "bm_george" : voice, eyes: P.eyes, goo: P.goo };
}

/** "Lumen the teal ghost with an antenna": a name you can keep or change. */
export function describe(c: Character): string {
  const wear = wearing(c, "with");
  const colour = c.hue2 ? `${c.hue}-and-${c.hue2}` : c.finish === "glass" ? c.hue : `${FINISHES[c.finish].label.toLowerCase()} ${c.hue}`;
  return `${c.name} the ${colour} ${c.shape}${wear}`;
}

const pickOne = <T,>(xs: readonly T[], r: () => number): T => xs[Math.floor(r() * xs.length)]!;

/** "Surprise me": a whole character from a seed (the same seed, the same orb): a personality first,
 * then a body, eyes, a voice and a softness that go with it. */
/** A character read back from storage (the browser's, the home's), every part one there is: a part
 * renamed or retired since he was kept (the eyes "wink" or "ash", 10-01) falls back to `base`'s. */
export function sane(c: Partial<Character> & { name: string }, base: Character): Character {
  const pick = <K extends keyof Character>(k: K, ok: (v: unknown) => boolean): Character[K] => (ok(c[k]) ? (c[k] as Character[K]) : base[k]);
  const inside = (o: object) => (v: unknown): boolean => typeof v === "string" && v in o;
  const hues = HUES.map((h) => h.name) as readonly string[];
  return {
    name: c.name,
    personality: pick("personality", inside(PERSONALITIES)),
    specialty: pick("specialty", inside(SPECIALTIES)),
    seed: pick("seed", (v) => typeof v === "number" && Number.isFinite(v)),
    hue: pick("hue", (v) => typeof v === "string" && hues.includes(v)),
    hue2: c.hue2 === null || (typeof c.hue2 === "string" && hues.includes(c.hue2)) ? (c.hue2 as HueName | null) : base.hue2,
    finish: pick("finish", inside(FINISHES)),
    shape: pick("shape", inside(SHAPES)),
    eyes: pick("eyes", inside(EYES)),
    hat: pick("hat", inside(HATS)),
    glasses: pick("glasses", inside(GLASSES)),
    hatHue: typeof c.hatHue === "string" && (hues.includes(c.hatHue) || c.hatHue === "white" || c.hatHue === "black") ? (c.hatHue as AccessoryHue) : c.hatHue === null ? null : base.hatHue ?? null,
    glassesHue: typeof c.glassesHue === "string" && (hues.includes(c.glassesHue) || c.glassesHue === "white" || c.glassesHue === "black") ? (c.glassesHue as AccessoryHue) : c.glassesHue === null ? null : base.glassesHue ?? null,
    voice: pick("voice", (v) => typeof v === "string" && VOICES.some((x) => x.id === v)),
    goo: pick("goo", (v) => typeof v === "number" && v >= 0 && v <= 1),
  };
}

/** An applicant (PLAN 5.8): a new orb by the dice from the home's seed, for the position applied
 * for, the hat and glasses leaning to it as a creator's would. The same seed makes the same orb on
 * every device; a name someone already has (`taken`) is rolled again from the seed, the same way. */
export function applicant(seed: number, specialty: SpecialtyName, taken: (name: string) => boolean = () => false): Character {
  const c = surprise(seed);
  const S = SPECIALTIES[specialty];
  let name = c.name;
  for (let i = 1; i <= 40 && taken(name); i++) name = orbName(rng(seed + i));
  return { ...c, name, specialty, hat: seed % 2 ? S.hat : c.hat, glasses: seed % 3 ? S.glasses : c.glasses };
}

/** What an application says, written by code from who the orb is, so an applicant costs nothing:
 * "Pip hums while the tests run, and would love to take on interfaces for you." */
export function applicationNote(c: Character): string {
  const focus = SPECIALTIES[c.specialty].focus.split(/[:;]/)[0]!.trim();
  return `${c.name} ${sheetOf(c).quirk}, and would love to take on ${focus} for you.`;
}

// ── colours that go together (owner, 10-04: "randomizing should randomize accesory color too. but
// everything should, but also based on color wheel concepts so the colors randomized with everything
// match, up to the user to change what they want after") ────────────────────────────────────────────
// The 24 hues are a wheel, 15° apart. A roll picks one scheme for the whole orb: analogous (a step or
// two along), complementary (straight across), split-complementary (either side of across) or triadic
// (a third of the way round). A gradient stays analogous, so its blend never goes muddy; the hat and
// the glasses take their own colours, his, white or black, or the scheme's partner.
export const SCHEMES = { analogous: [2, -2, 3, -3], complementary: [12], split: [10, 14], triadic: [8, 16] } as const;
export type Scheme = keyof typeof SCHEMES;
const stepOf = (h: HueName): number => HUES.findIndex((x) => x.name === h);
const hueAt = (i: number): HueName => HUES[((i % HUES.length) + HUES.length) % HUES.length]!.name;
/** How many steps round the wheel from one hue to another (0 to 12). */
export const wheelSteps = (a: HueName, b: HueName): number => {
  const d = Math.abs(stepOf(a) - stepOf(b)) % HUES.length;
  return Math.min(d, HUES.length - d);
};
/** A partner for `hue` in `scheme`, from one roll of the dice (0..1). */
export const partnerOf = (hue: HueName, scheme: Scheme, u: number): HueName => {
  const offs = SCHEMES[scheme];
  return hueAt(stepOf(hue) + offs[Math.min(offs.length - 1, Math.floor(u * offs.length))]!);
};
/** Whether two of an orb's colours go together: the same, or a scheme's step apart. */
export const inHarmony = (a: HueName, b: HueName): boolean => [0, 2, 3, 8, 10, 12].includes(wheelSteps(a, b));

/** A whole orb from its dice. `specialty` fixes what it does (the first orb is always the assistant,
 * owner 10-04: "only give them assistant orb choices when rolling dice the first orb they create"). */
export function surprise(seed: number, o: { specialty?: SpecialtyName } = {}): Character {
  let x = Math.abs(Math.floor(seed)) % 233280;
  const r = (): number => (x = (x * 9301 + 49297) % 233280) / 233280;
  const personality = pickOne(Object.keys(PERSONALITIES).filter((p) => p !== "steady") as PersonalityName[], r);
  const P = PERSONALITIES[personality];
  const hue = pickOne(HUES.map((h) => h.name), r);
  const rolled = pickOne(Object.keys(SPECIALTIES) as SpecialtyName[], r); // drawn either way, so the rest of a seed's orb is the same
  const specialty = o.specialty ?? rolled;
  const c: Character = {
    name: orbName(r),
    personality,
    specialty,
    seed: Math.floor(r() * 1e6),
    hue,
    hue2: r() < 0.2 ? partnerOf(hue, "analogous", r()) : null, // one draw, as before, so a seed keeps the rest of its orb
    finish: r() < 0.75 ? "glass" : pickOne(Object.keys(FINISHES) as FinishName[], r),
    shape: pickOne(Object.keys(SHAPES) as ShapeName[], r),
    eyes: r() < 0.7 ? P.eyes : pickOne(Object.keys(EYES) as EyesName[], r),
    hat: r() < 0.5 ? SPECIALTIES[specialty].hat : pickOne(Object.keys(HATS) as HatName[], r),
    glasses: r() < 0.5 ? SPECIALTIES[specialty].glasses : r() < 0.5 ? "none" : pickOne(Object.keys(GLASSES) as GlassesName[], r),
    voice: pickOne(P.voices.filter((v) => v !== "ash"), r) ?? "silent",
    goo: Math.round(Math.max(0, Math.min(1, P.goo + (r() - 0.5) * 0.2)) * 100) / 100, // in hundredths, the slider's step
    // drawn last, so everything before keeps what a seed gave it
    ...accessoryColours(hue, r),
  };
  if (c.hat === "none") c.hatHue = null;
  if (c.glasses === "none") c.glassesHue = null;
  return c;
}

/** The hat's and the glasses' colours for a roll: a scheme for the orb, then for each its own colours,
 * his, white or black, or the scheme's partner (the two take the same partner, so they go together). */
function accessoryColours(hue: HueName, r: () => number): { hatHue: AccessoryHue | null; glassesHue: AccessoryHue | null } {
  const schemes = Object.keys(SCHEMES) as Scheme[];
  const scheme = schemes[Math.floor(r() * schemes.length)]!;
  const partner = partnerOf(hue, scheme, r());
  const pick = (own: number, his: number, neutral: number): AccessoryHue | null => {
    const u = r();
    if (u < own) return null;
    if (u < own + his) return hue;
    if (u < own + his + neutral) return r() < 0.5 ? "white" : "black";
    return partner;
  };
  return { hatHue: pick(0.4, 0.15, 0.15), glassesHue: pick(0.5, 0.15, 0.2) };
}
