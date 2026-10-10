// The glasses as models (owner, 10-09: "can we do the same thing we did to the hats to the eyes and the glasses"). Each of
// the 21 is the pair it always was, its lenses where his eyes are and as big as the flat drawing made them (spec.ts
// GLASSES, and the eyes' own numbers), built again in 3D: rims swept along each lens's outline (fine wire in metal, or a
// rounded acetate rim), domed lenses of tinted glass you see his eyes through (sunglasses dark, a sport lens mirrored),
// a bridge, nose pads on the wire ones, hinges and temples going back round his head, a goggles' strap. Drawn by the
// renderer's second pass in his face's own space, so they look where his eyes look and tilt with his face; his face is
// drawn into depth first, so what goes round behind him hides. Units: the face block's (1 is 0.94 of his radius), +y
// up, +z toward you, his centre the origin. Pure.
import { add, bake, built, clamp, ellipsoid, grid, MAT, mix, Mesh, rbox, revolve, SLOT, spline, tube, type Built, type Look, type P2, type V3 } from "./geo.ts";

/** His face as the glasses see it: Ash's bean's body, an ellipsoid round his centre (`y` below it), `a` across and
 * deep, `b` up. Fitted 10-09 to spec.ts outline in the face block's units. */
export const FACE = { y: -0.0825, a: 0.855, b: 0.9575 } as const;
/** A face the glasses are made for: how far it reaches to either side at each height (face units, +y up), round the axis
 * as his head is; `key` names it for the renderer's caches. Every shape has its own (heads.ts faceOf; owner, 10-10: "the
 * glasses are off too on some orbs: they overlap the body and face": made for the bean's face, a pair's temples ended
 * half way across a squish and stood out past a pill). */
export type Face = { key: string; w: (y: number) => number };
/** The bean's: FACE's ellipsoid. */
export const BEAN_FACE: Face = { key: "bean", w: (y) => FACE.a * Math.sqrt(Math.max(0, 1 - ((y - FACE.y) / FACE.b) ** 2)) };
/** How far toward you the frames stand on the bean (his face is about 0.81 out at his eyes); a fuller face, further. */
const FRONT = 0.9;
const TAU = 2 * Math.PI;

/** The eyes a pair is made for: spec.ts EYES `a` (radius, aspect, gap, height down from his centre). */
export type EyeNums = readonly [number, number, number, number];

/** A lens's outline: t from 0 to 1 round it, (u out toward his side, w up) about the lens's centre. */
type Outline = (t: number) => P2;
const ellipse =
  (A: number, B: number): Outline =>
  (t) => [A * Math.cos(TAU * t), B * Math.sin(TAU * t)];
/** A superellipse: n 2 an ellipse, higher squarer. */
const superE =
  (A: number, B: number, n: number): Outline =>
  (t) => {
    const c = Math.cos(TAU * t), s = Math.sin(TAU * t);
    const r = (Math.abs(c / A) ** n + Math.abs(s / B) ** n) ** (-1 / n);
    return [r * c, r * s];
  };
const turned =
  (o: Outline, a: number, du = 0, dw = 0): Outline =>
  (t) => {
    const [u, w] = o(t);
    return [Math.cos(a) * u - Math.sin(a) * w + du, Math.sin(a) * u + Math.cos(a) * w + dw];
  };
const polar =
  (rho: (th: number) => number): Outline =>
  (t) => {
    const th = TAU * t;
    const r = rho(th);
    return [r * Math.cos(th), r * Math.sin(th)];
  };

/** How a pair is made: its lenses' outline, what its rim is, what its lenses are. */
type Design = {
  outline: (L: number, Ly: number) => Outline;
  /** "wire" (thin metal), "rim" (acetate), "thick" (heavy acetate), "brow" (half-rims: heavy on top, wire below) */
  rim: "wire" | "rim" | "thick" | "brow";
  one?: "monocle" | "visor";
  goggles?: boolean;
  /** a second bar across the top between the lenses (aviators) */
  bar?: boolean;
  /** a mirrored lens (sport) */
  mirror?: boolean;
};

const round: Design = { outline: (L, Ly) => ellipse(L, Ly), rim: "rim" };
const DESIGNS: Record<number, Design> = {
  1: round,
  2: { outline: (L, Ly) => superE(L * 1.08, Ly * 0.82, 4.2), rim: "rim" },
  3: {
    // cat-eye: its outer top corner swept up into a point
    outline: (L, Ly) => (t) => {
      const [u, w] = superE(L * 1.06, Ly * 0.66, 2.6)(t);
      const ou = clamp(u / (L * 1.06), 0, 1), ow = clamp(w / (Ly * 0.66), 0, 1);
      return [u + 0.16 * L * ou ** 3 * ow, w + 0.62 * Ly * ou ** 3 * ow ** 0.7];
    },
    rim: "thick",
  },
  4: { outline: (L, Ly) => ellipse(L * 1.2, Ly * 1.2), rim: "thick" },
  5: {
    // reading: half-moons, flat across the top
    outline: (L, Ly) => (t) => {
      const A = L * 1.05, B = Ly * 0.85, wc = -0.06;
      if (t < 0.75) {
        const th = Math.PI + (t / 0.75) * Math.PI;
        return [A * Math.cos(th), wc + B * Math.sin(th)];
      }
      return [mix(A, -A, (t - 0.75) / 0.25), wc];
    },
    rim: "wire",
  },
  6: { outline: (L) => ellipse(L * 1.05, L * 1.05), rim: "wire", one: "monocle" },
  7: {
    // hearts
    outline: (L) => (t) => {
      const th = TAU * t;
      const k = (L * 1.12) / 16;
      return [k * 16 * Math.sin(th) ** 3, k * (13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th) + 2.5)];
    },
    rim: "rim",
  },
  8: {
    // stars, a point up
    outline: (L) => polar((th) => mix(L * 0.64, L * 1.3, (0.5 + 0.5 * Math.cos(5 * (th - Math.PI / 2))) ** 1.7)),
    rim: "wire",
  },
  9: {
    // aviators: a teardrop drooping out, flat along its top
    outline: (L, Ly) => (t) => {
      const [u, w] = turned(ellipse(L * 1.26, Ly * 0.96), -0.46, 0.05, -0.1)(t);
      return [u, Math.min(w, Ly * 0.62)];
    },
    rim: "wire",
    bar: true,
  },
  10: { outline: (L, Ly) => (t) => { const [u, w] = superE(L * 1.12, Ly * 0.74, 3.6)(t); return [u * (1 + 0.15 * (w / (Ly * 0.74))), w]; }, rim: "thick" },
  11: { outline: (L, Ly) => ellipse(L, Ly), rim: "wire" },
  12: { outline: (L, Ly) => ellipse(L * 1.22, Ly * 1.22), rim: "thick", goggles: true },
  13: { outline: (L, Ly) => superE(L, Ly * 0.68, 4), rim: "rim", one: "visor" },
  14: { outline: (L, Ly) => superE(L * 1.12, Ly * 0.62, 6), rim: "rim" },
  15: { outline: (L, Ly) => superE(L * 1.08, Ly * 0.78, 4.4), rim: "brow" },
  16: { outline: (L, Ly) => turned(superE(L * 1.4, Ly * 0.74, 2.6), -0.16, 0.03, 0), rim: "rim", mirror: true },
  17: { outline: (L, Ly) => ellipse(L, Ly), rim: "wire" },
  18: { outline: (L, Ly) => ellipse(L * 1.2, Ly * 0.72), rim: "rim" },
  19: { outline: (L) => polar((th) => (L * 1.02) / ((Math.abs(Math.cos(th)) * 0.866 + Math.abs(Math.sin(th)) * 0.5) ** 10 + Math.abs(Math.sin(th)) ** 10) ** 0.1), rim: "wire" },
  20: { outline: (L, Ly) => ellipse(L * 1.1, Ly * 1.1), rim: "thick" },
  21: { outline: (L, Ly) => turned(superE(L * 1.34, Ly * 0.86, 2.4), 0.34, 0.04, 0.03), rim: "rim" },
};

/** A pair for the eyes they sit over, made on his face (the bean's until one is given), ready for the GPU (null: no
 * glasses, or none of that number). `dark` is how much of his eyes the lens hides (spec.ts GLASSES), which is what its
 * glass is tinted to. */
export function glassesMesh(id: number, eyes: EyeNums, dark: number, face: Face = BEAN_FACE): Built | null {
  const D = DESIGNS[id];
  if (!D) return null;
  /** Where his face is, this far round his centre (the glasses' temples and a strap lie against it). */
  const faceZ = (x: number, y: number): number => Math.sqrt(Math.max(0, face.w(y) ** 2 - x ** 2));
  const m = new Mesh();
  // the lenses' size and place, as the flat drawing measured them (glsl.ts specsSDF, until 10-09)
  const L = clamp(eyes[0] * 1.5, 0.15, 0.25);
  const Ly = L * clamp(eyes[1] * 0.85, 1, 1.35);
  const cx = Math.max(eyes[2], L + 0.035);
  const ey = -eyes[3];
  const frame: Look = { kind: D.rim === "wire" ? MAT.metal : MAT.plastic, slot: SLOT.main };
  const lensLook: Look = { kind: MAT.glass, slot: SLOT.lens, extra: D.mirror || D.one === "visor" ? Math.max(dark, 0.92) : dark };
  const wire = 0.0085, acetate = 0.018, thick = 0.026;
  const rr = D.rim === "wire" ? wire : D.rim === "thick" ? thick : acetate;
  const span = cx + L * 1.4; // how far out the frame wraps back (a visor across both eyes as far as a pair)
  // the frame's front: a gentle wrap back toward his sides, as far out of a fuller face as of the bean's
  const front = face === BEAN_FACE ? FRONT : Math.max(FRONT, faceZ(cx, ey) + (FRONT - 0.8145));
  const zAt = (x: number): number => front - 0.07 * (x / span) ** 2;
  const at = (x: number, y: number, dz = 0): V3 => [x, y, zAt(x) + dz];
  const lenses = D.one === "monocle" ? [1] : D.one === "visor" ? [0] : [-1, 1];
  const ring = (o: Outline, side: number, c: P2): ((t: number) => V3) => (t) => {
    const [u, w] = o(t);
    return at(c[0] + side * u, c[1] + w);
  };
  let hinge: V3[] = [];
  let inner: V3[] = [];
  for (const side of lenses) {
    const centre: P2 = D.one === "visor" ? [0, ey] : [side * cx, ey];
    const o = D.one === "visor" ? superE(cx + L * 1.05, Ly * 0.8, 4) : D.outline(L, Ly);
    const path = ring(o, side === 0 ? 1 : side, centre);
    // the lens: a shallow dome of glass filling its outline
    grid(
      m,
      72,
      10,
      (u, v) => {
        const p = path(u);
        const k = v * 0.985;
        return [centre[0] + (p[0] - centre[0]) * k, centre[1] + (p[1] - centre[1]) * k, zAt(centre[0] + (p[0] - centre[0]) * k) - 0.004 + 0.016 * (1 - k * k)];
      },
      lensLook,
      { uv: (u, v) => [u, v] },
    );
    // the rim, swept round it (half-rims: a heavy acetate brow over a fine wire)
    if (D.rim === "brow") {
      tube(m, (t) => path(t * 0.5), () => 0.024, { kind: MAT.plastic, slot: SLOT.main }, { n: 60, k: 12, up: [0, 0, 1], flat: 1.2, square: 0.55 });
      tube(m, (t) => path(0.5 + t * 0.5), () => 0.0065, { kind: MAT.metal, slot: SLOT.steel }, { n: 60, k: 8, up: [0, 0, 1] });
    } else {
      tube(m, path, () => rr, frame, { closed: true, n: 120, k: D.rim === "wire" ? 8 : 12, up: [0, 0, 1], flat: D.rim === "wire" ? 1 : 1.25, square: D.rim === "wire" ? undefined : 0.55 });
      if (D.goggles) tube(m, (t) => add(path(t), [0, 0, -0.03]), () => rr * 0.85, { kind: MAT.rubber, slot: SLOT.ink }, { closed: true, n: 120, k: 10, up: [0, 0, 1], flat: 1.4 });
    }
    // where the hinge and the bridge meet it: its outermost and innermost points, a little above its middle
    let out = path(0), inn = path(0);
    for (let i = 0; i < 120; i++) {
      const p = path(i / 120);
      if (p[1] > ey - Ly * 0.2) {
        if (side * p[0] > side * out[0] || (side === 0 && Math.abs(p[0]) > Math.abs(out[0]))) out = p;
        if (side * p[0] < side * inn[0]) inn = p;
      }
    }
    if (D.one === "visor") {
      for (const s of [-1, 1]) {
        let best = path(0);
        for (let i = 0; i < 120; i++) {
          const p = path(i / 120);
          if (p[1] > ey - Ly * 0.2 && s * p[0] > s * best[0]) best = p;
        }
        hinge.push(best);
      }
    } else {
      hinge.push(out);
      inner.push(inn);
    }
    if (D.one === "monocle") {
      // its chain, a run of little beads hanging from its rim down past his cheek
      const from = path(0.88);
      const chain = spline([from, add(from, [0.06, -0.12, -0.02]), add(from, [0.1, -0.3, -0.06]), add(from, [0.12, -0.46, -0.1])]);
      tube(m, chain, (t) => 0.0075 * (0.55 + 0.45 * Math.abs(Math.cos(Math.PI * t * 26)) ** 0.5), frame, { n: 160, k: 8 });
    }
  }
  // the bridge between the lenses, arched over where his nose would be; aviators have a bar over it too
  if (inner.length === 2) {
    const [a, b] = inner as [V3, V3];
    const top = Math.max(a[1], b[1]) + 0.03;
    tube(m, spline([a, at(0, top, 0.004), b]), () => rr * (D.rim === "wire" ? 1.1 : 0.85), frame, { n: 24, k: 10, up: [0, 0, 1], square: D.rim === "wire" ? undefined : 0.6 });
    if (D.bar) {
      const o = D.outline(L, Ly);
      let hi: P2 = o(0);
      for (let i = 0; i < 120; i++) if (o(i / 120)[1] > hi[1] - 1e-9 && o(i / 120)[0] < hi[0]) hi = o(i / 120);
      tube(m, spline([at(-cx - hi[0] * 0.2, ey + Ly * 0.6), at(0, ey + Ly * 0.66, 0.004), at(cx + hi[0] * 0.2, ey + Ly * 0.6)]), () => wire * 0.9, frame, { n: 24, k: 8 });
    }
    // nose pads on the wire frames: a little arm in and back from each lens's inner foot, a clear pad on it
    if (D.rim === "wire") {
      for (const s of [-1, 1]) {
        const foot = at(s * (cx - L * 0.62), ey - Ly * 0.42);
        const pad = add(foot, [-s * 0.035, -0.012, -0.03]);
        tube(m, spline([foot, add(foot, [-s * 0.02, -0.004, -0.015]), pad]), () => 0.004, frame, { n: 10, k: 6 });
        ellipsoid(m, pad, [0.012, 0.022, 0.006], { kind: MAT.glass, slot: SLOT.white, extra: 0 }, { nu: 14, nv: 8 });
      }
    }
  }
  // hinges and temples, back round his head (his face hides them past its edge), or a goggles' strap round it
  for (const h of hinge) {
    const s = Math.sign(h[0]) || 1;
    if (D.goggles || D.one === "monocle") continue;
    rbox(m, add(h, [s * 0.012, 0, -0.012]), [0.016, 0.014, 0.024], frame, { e: 0.35, nu: 16, nv: 10 });
    const y = h[1];
    const side = face.w(y);
    // back along his head, just off it, so face on it shows from the hinge to his edge and no further
    const temple = spline([add(h, [s * 0.016, 0, -0.03]), [s * side * 0.86, y, faceZ(side * 0.86, y) + 0.035], [s * side * 0.97, y - 0.008, faceZ(side * 0.97, y) + 0.02], [s * side * 0.96, y - 0.03, -0.25]]);
    tube(m, temple, () => (D.rim === "wire" ? 0.008 : 0.011), frame, { n: 40, k: 8, up: [0, 1, 0], flat: D.rim === "wire" ? 1 : 0.55 });
  }
  if (D.goggles) {
    // the strap: right round his head at his eyes, wide and soft, from cup to cup
    const yS = ey + 0.01;
    const ra = face.w(yS) * 0.985 + 0.004; // against his head
    const from = Math.asin(Math.min(0.99, (cx + L * 1.1) / ra)); // from each cup's outer edge, round behind him
    tube(m, (t) => { const a = mix(from, TAU - from, t); return [ra * Math.sin(a), yS, ra * Math.cos(a)]; }, () => 0.05, { kind: MAT.cotton, slot: SLOT.second, extra: 0 }, { n: 120, k: 10, up: [0, 1, 0], flat: 0.22 });
  }
  bake(m, { head: false, strength: 0.6 });
  return built(m);
}

const proxies = new Map<string, Built>();
/** His face as the glasses see it: what hides their temples and a strap where they go round behind him (depth only); the
 * bean's an ellipsoid, any other his outline turned round the axis. */
export function faceMesh(face: Face = BEAN_FACE): Built {
  let b = proxies.get(face.key);
  if (!b) {
    const m = new Mesh();
    if (face === BEAN_FACE) ellipsoid(m, [0, FACE.y, 0], [FACE.a * 0.985, FACE.b * 0.985, FACE.a * 0.985], { kind: 0, slot: 0 }, { nu: 48, nv: 32 });
    else {
      // from his foot to his top, where he has width
      const pts: P2[] = [];
      for (let y = -1.6; y <= 1.6; y += 0.02) if (face.w(y) > 0.002) pts.push([face.w(y) * 0.985, y]);
      const [lo, hi] = [pts[0]!, pts[pts.length - 1]!];
      revolve(m, [[0, lo[1] - 0.01], ...pts, [0, hi[1] + 0.01]], { kind: 0, slot: 0 }, { segs: 64 });
    }
    b = built(m);
    proxies.set(face.key, b);
  }
  return b;
}

/** Every pair's design, by its number in spec.ts GLASSES (0, none, has none). */
export const GLASSES_MODELS = DESIGNS;

