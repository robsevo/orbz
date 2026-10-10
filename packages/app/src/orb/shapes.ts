// The orbs' shapes (PLAN 2.2), the outline they draw and where a hat sits on each, out of spec.ts so the hats' own code
// (hats/heads.ts) can read them: spec.ts gives them to the character. Pure; it imports nothing.

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
export type ShapeNumbers = ReturnType<typeof shape>;

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
