// His head as the hats see it, on every shape (owner, 10-09: "make sure the beanies are snug and tight over their heads,
// including squirqule, or else we get this ... Also watch out for ears, they should be inside hat when on"). The hats
// were drawn on Ash's bean and were only seated and sized on any other shape (shapes.ts hatFit), so a squircle's flat
// top and corners stood out from under a beanie made for the bean's round one. Now each hat is built on the head of the
// shape that wears it (geo.ts onThe), in that shape's own hat frame (hatFit: where its top is taken, how big a hat is on
// it): a beanie, a cap, a helmet, a band hugs that head as it hugs the bean's, and what sits on a head sits on that one.
//
// His head is his outline without narrow ears, round the axis, as wide as his wider side at each angle (a blob is
// lopsided), and over the top a smooth dome on it (dome): his outline itself where that is smooth, over a star's point,
// a heart's notch or a cloud's puffs as a hat goes over them. Below where hats reach it is his outline. Pure.
import { hatFit, outline, SHAPES, type ShapeName, type ShapeNumbers } from "../shapes.ts";
import { headFrom, PITCH, type Built, type Head } from "./geo.ts";
import { BEAN_FACE, type Face } from "./glasses.ts";

/** Narrow bumps at his top are ears; wide ones (a heart's lobes) are his head (shapes.ts hatFit says the same). */
export const hasEars = (S: ShapeNumbers): boolean => S.c[2] > 0 && S.d[0] < 0.3;
const earless = (S: ShapeNumbers): ShapeNumbers => ({ ...S, c: [S.c[0], S.c[1], 0, S.c[3]] });

/** A shape's hat frame, in his radius: how far over his centre its origin is (the orb shaders' Rtop at rest), and a hat's
 * unit (their Rhat). A halo's is over all of him, ears too. */
export function frameOf(name: ShapeName, floating = false): { top: number; unit: number } {
  const f = hatFit(name);
  return { top: SHAPES[name].d[1] * (1 + (floating ? f.float : f.seat)) - 0.03, unit: 1.35 * f.size };
}

/** How far his outline is from his centre at `al` from straight up, the wider of his two sides, in hat units (the
 * angle as the shader's atan2 has it, -PI to PI). */
const wrap = (a: number): number => (a <= -Math.PI ? a + 2 * Math.PI : a > Math.PI ? a - 2 * Math.PI : a);
const reach = (S: ShapeNumbers, unit: number, al: number): number =>
  (S.d[1] * Math.max(1 + outline(S, wrap(-Math.PI / 2 + al)), 1 + outline(S, wrap(-Math.PI / 2 - al)))) / unit;

const OVER = (125 * Math.PI) / 180; // a hat reaches no lower down him than this (headphones' cups at 98 degrees)
const BLEND = (25 * Math.PI) / 180; // the last of it, where his head goes from the dome over him to his outline
const K = 4; // the dome's terms, cos(k al) for k to 4: Ash's bean is 3 of them, a squircle 4, a star's points none

/** Solves the k x k system M x = b (Gaussian elimination, partial pivots). */
function solve(M: number[][], b: number[]): number[] {
  const n = b.length;
  const A = M.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k <= n; k++) A[r]![k]! -= f * A[c]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let t = A[r]![n]!;
    for (let k = r + 1; k < n; k++) t -= A[r]![k]! * x[k]!;
    x[r] = t / A[r]![r]!;
  }
  return x;
}

/** The dome over his top a hat is made on: the smoothest curve of K terms that is nowhere inside his outline and as close
 * to it as it can be (a fit raised to his outline wherever it fell inside it, again until it holds still, then lifted
 * clear). On Ash's bean or a squircle it is his outline itself; over a star's point, a cloud's puffs or a heart's notch
 * it rides over them, as a knitted hat would. */
function dome(target: (al: number) => number): (al: number) => number {
  const M = 240, T = K + 1;
  const X = new Float64Array((M + 1) * T);
  const y = new Float64Array(M + 1);
  for (let n = 0; n <= M; n++) {
    const al = (OVER * n) / M;
    for (let k = 0; k < T; k++) X[n * T + k] = Math.cos(k * al);
    y[n] = target(al);
  }
  const XtX = Array.from({ length: T }, (_, i) => Array.from({ length: T }, (_, j) => {
    let s = 0;
    for (let n = 0; n <= M; n++) s += X[n * T + i]! * X[n * T + j]!;
    return s;
  }));
  const at = (c: number[], n: number): number => {
    let s = 0;
    for (let k = 0; k < T; k++) s += X[n * T + k]! * c[k]!;
    return s;
  };
  const fit = (raise: number[] | null): number[] => {
    const b = new Array<number>(T).fill(0);
    for (let n = 0; n <= M; n++) {
      const t = raise ? Math.max(y[n]!, at(raise, n)) : y[n]!;
      for (let k = 0; k < T; k++) b[k] = b[k]! + X[n * T + k]! * t;
    }
    return solve(XtX, b);
  };
  let c = fit(null);
  for (let it = 0; it < 2000; it++) {
    const next = fit(c);
    const moved = Math.max(...next.map((v, k) => Math.abs(v - c[k]!)));
    c = next;
    if (moved < 1e-7) break;
  }
  let lift = 0;
  for (let n = 0; n <= M; n++) lift = Math.max(lift, y[n]! - at(c, n));
  c[0] = c[0]! + lift;
  return (al) => {
    let s = 0;
    for (let k = 0; k < T; k++) s += Math.cos(k * al) * c[k]!;
    return s;
  };
}

const heads = new Map<string, Head>();
/** A shape's head, in its hat frame (a halo's, `floating`). */
export function headOf(name: ShapeName, floating = false): Head {
  const key = `${name}${floating ? "/halo" : ""}`;
  let h = heads.get(key);
  if (h) return h;
  const S0 = SHAPES[name];
  const S = hasEars(S0) ? earless(S0) : S0;
  const { top, unit } = frameOf(name, floating);
  const raw = (al: number): number => reach(S, unit, al);
  const over = dome(raw);
  const radius = (al: number): number => {
    if (al >= OVER) return raw(al);
    const t = Math.min(1, Math.max(0, (al - (OVER - BLEND)) / BLEND));
    return Math.max(raw(al), over(al) + (raw(al) - over(al)) * t * t * (3 - 2 * t));
  };
  // the highest of all of him, his ears too
  let peak = -Infinity;
  for (let i = 0; i < 1440; i++) {
    const a = (2 * Math.PI * i) / 1440 - Math.PI;
    peak = Math.max(peak, -Math.sin(a) * S0.d[1] * (1 + outline(S0, a)));
  }
  h = { ...headFrom(key, -top / unit, radius, (peak - top) / unit), skin: headFrom(`${key}/skin`, -top / unit, raw, (peak - top) / unit) };
  heads.set(key, h);
  return h;
}

// ── his face, as the glasses see it ─────────────────────────────────────────────────────────────
const faces = new Map<string, Face>();
/** A shape's face for its glasses (glasses.ts Face; owner, 10-10: "the glasses are off too on some orbs: they overlap the
 * body and face"): how far his outline reaches to either side at each height, the wider of his two sides, his ears left
 * out, in the face block's units (1 is 0.94 of his radius, his centre the origin, +y up). The bean's is FACE's ellipsoid,
 * which its pairs were made and measured on. */
export function faceOf(name: ShapeName): Face {
  if (name === "bean") return BEAN_FACE;
  let f = faces.get(name);
  if (f) return f;
  const S0 = SHAPES[name];
  const S = hasEars(S0) ? earless(S0) : S0;
  // his outline as points, +y up
  const N = 2048;
  const pts: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const a = -Math.PI + (2 * Math.PI * i) / N;
    const r = (S.d[1] * (1 + outline(S, a))) / 0.94;
    pts.push([r * Math.cos(a), -r * Math.sin(a)]);
  }
  // his reach at each height: the widest of where his outline crosses it
  const Y0 = -1.6, STEP = 0.005, NY = Math.round(3.2 / STEP);
  const w = new Float64Array(NY + 1);
  for (let k = 0; k < N; k++) {
    const [x0, y0] = pts[k]!, [x1, y1] = pts[k + 1]!;
    const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
    for (let j = Math.ceil((lo - Y0) / STEP); j <= Math.floor((hi - Y0) / STEP); j++) {
      const y = Y0 + j * STEP;
      const x = Math.abs(hi === lo ? x0 : x0 + ((x1 - x0) * (y - y0)) / (y1 - y0));
      if (x > w[j]!) w[j] = x;
    }
  }
  f = {
    key: name,
    w: (y) => {
      const u = (y - Y0) / STEP;
      if (u <= 0 || u >= NY) return 0;
      const j = Math.floor(u);
      return w[j]! + (w[j + 1]! - w[j]!) * (u - j);
    },
  };
  faces.set(name, f);
  return f;
}

// ── his ears, inside a hat ───────────────────────────────────────────────────────────────────
// A hat seen from in front, as it is drawn (from a little above, at its slant), in a grid of cells over his hat frame;
// his head and his ears in the same grid.
export const CELL = 0.01;
export const GRID = { x0: -1, x1: 1, y0: -1.4, y1: 0.8 } as const;
export const NX = Math.round((GRID.x1 - GRID.x0) / CELL), NY = Math.round((GRID.y1 - GRID.y0) / CELL);

/** The cells of a shape's hat frame inside his outline (with his ears, or without them), row by row from the bottom. */
const outlines = new Map<string, Uint8Array>();
export function headCells(name: ShapeName, ears: boolean): Uint8Array {
  const key = `${name}${ears ? "+ears" : ""}`;
  let g = outlines.get(key);
  if (g) return g;
  g = new Uint8Array(NX * NY);
  const S = ears || !hasEars(SHAPES[name]) ? SHAPES[name] : earless(SHAPES[name]);
  const { top, unit } = frameOf(name);
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      // his own space: from his centre, in his radius, +y down the screen (shapes.ts outline's)
      const X = (GRID.x0 + (i + 0.5) * CELL) * unit, Y = -((GRID.y0 + (j + 0.5) * CELL) * unit + top);
      if (Math.hypot(X, Y) < S.d[1] * (1 + outline(S, Math.atan2(Y, X)))) g[j * NX + i] = 1;
    }
  outlines.set(key, g);
  return g;
}

/** The cells a hat is drawn over, at its slant (HAT_VS: seen from above by PITCH, then turned). */
export function hatCells(b: Built, tilt: number): Uint8Array {
  const seen = new Uint8Array(NX * NY);
  const cp = Math.cos(PITCH), sp = Math.sin(PITCH), ct = Math.cos(tilt), st = Math.sin(tilt);
  const n = b.pos.length / 3;
  const sx = new Float64Array(n), sy = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    const x = b.pos[v * 3]!, y = b.pos[v * 3 + 1]! * cp - b.pos[v * 3 + 2]! * sp;
    sx[v] = ct * x - st * y;
    sy[v] = st * x + ct * y;
  }
  for (let t = 0; t < b.idx.length; t += 3) {
    const a = b.idx[t]!, c = b.idx[t + 1]!, d = b.idx[t + 2]!;
    const ax = sx[a]!, ay = sy[a]!, bx = sx[c]!, by = sy[c]!, cx = sx[d]!, cy = sy[d]!;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-14) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - GRID.x0) / CELL)), i1 = Math.min(NX - 1, Math.floor((Math.max(ax, bx, cx) - GRID.x0) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - GRID.y0) / CELL)), j1 = Math.min(NY - 1, Math.floor((Math.max(ay, by, cy) - GRID.y0) / CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * NX + i;
        if (seen[k]) continue;
        const px = GRID.x0 + (i + 0.5) * CELL, py = GRID.y0 + (j + 0.5) * CELL;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        if (w0 >= 0 && w1 >= 0 && 1 - w0 - w1 >= 0) seen[k] = 1;
      }
  }
  return seen;
}

/** How much of a shape's ears a hat, at its slant, is drawn over (0 to 1; 0 for a shape without ears). */
export function earsUnder(b: Built, name: ShapeName, tilt: number): number {
  if (!hasEars(SHAPES[name])) return 0;
  const all = headCells(name, true), head = headCells(name, false);
  const hat = hatCells(b, tilt);
  let ears = 0, under = 0;
  for (let k = 0; k < all.length; k++) {
    if (!all[k] || head[k]) continue;
    ears++;
    under += hat[k]!;
  }
  return ears ? under / ears : 0;
}
