// The hats' geometry kit (owner, 10-09: "dont cheap out on them. make them nice, to industry standards"). A hat is
// a real 3D model now, drawn by the renderer's second pass over the orb (renderer.ts); until then each was a flat
// 2D cut-out with a puffy bevel, which read as "stupid 3d playdoh" beside the glass orbs.
//
// Every part is a grid of quads over a parametric surface (a profile turned round the hat's axis, a tube along a
// curve, an ellipsoid, a rounded box, a cut gem), so its normals come from its own triangles and its texture
// coordinates run along it in the hat's units. Each vertex carries what it is made of (the shader's material, which
// of the hat's colours, a number its pattern reads) and its ambient occlusion, baked here from every other part and
// the head it sits on.
//
// Units: the hat's own, as the shader has always measured a hat (1.35 times his radius); +y is up, +z toward you, the
// origin is the top of his head (the orb shader's, sunk a hair). His head is HEAD. Pure.

export type V3 = [number, number, number];
export type P2 = [number, number];
export type M3 = [V3, V3, V3]; // rows

/** His head as the hats see it: Ash's bean's (the hats are fitted to it; spec.ts hatFit seats and sizes them on every
 * other shape), an ellipsoid round the axis, its centre `y` below the origin, `a` across and `b` up. Fitted 10-09 to
 * spec.ts outline from the bean's top past its widest (within 0.002 everywhere): a good deal narrower than the ball of
 * 1/1.35 a hat's units would make him. */
export const HEAD = { y: -0.7475, a: 0.5925, b: 0.77 } as const;
/** The hats are seen a little from above (radians), so a brim shows its top and a crown its depth. The shaders take
 * the same number (glsl.ts). */
export const PITCH = 0.2;

/** What a part is made of: the shader's material (MAT), which colour (SLOT), a number its pattern reads, and whether
 * it spins about the hat's axis (a propeller's blades). */
export type Look = { kind: number; slot: number; extra?: number; spin?: boolean };

/** The shader's materials. Its `HAT_FS` has the same numbers (hats.test.ts holds them alike). */
export const MAT = {
  felt: 0, knit: 1, fur: 2, cotton: 3, straw: 4, plastic: 5, metal: 6, gem: 7, leaf: 8, petal: 9, satin: 10, leather: 11,
  glow: 12, horn: 13, pearl: 14, feather: 15, tweed: 16, paper: 17, rubber: 18, fruit: 19, wood: 20, glass: 21,
} as const;
/** Which colour: the hat's own (main), its second, or one of the shader's fixed ones. */
export const SLOT = { main: 0, second: 1, gold: 2, steel: 3, cream: 4, ink: 5, leaf: 6, wood: 7, white: 8, fur: 9, lens: 10 } as const;

export class Mesh {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  readonly uv: number[] = [];
  readonly mat: number[] = []; // kind, slot, ambient occlusion, extra (+100 when it spins)
  readonly idx: number[] = [];
  get count(): number {
    return this.pos.length / 3;
  }
}

// ── vectors ────────────────────────────────────────────────────────────────────────────────────
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0];
};
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x));
export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const rotX = (a: number): M3 => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
export const rotY = (a: number): M3 => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
export const rotZ = (a: number): M3 => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
export const apply = (m: M3, v: V3): V3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
export const mm = (a: M3, b: M3): M3 => {
  const c = (j: 0 | 1 | 2): V3 => [b[0][j], b[1][j], b[2][j]];
  return [0, 1, 2].map((i) => [dot(a[i]!, c(0)), dot(a[i]!, c(1)), dot(a[i]!, c(2))]) as M3;
};
/** Rotations applied x, then y, then z. */
export const rot = (x: number, y = 0, z = 0): M3 => mm(rotZ(z), mm(rotY(y), rotX(x)));
/** His head's outward normal at a point on (or near) it. */
export const headNormal = (p: V3): V3 => norm([p[0] / HEAD.a ** 2, (p[1] - HEAD.y) / HEAD.b ** 2, p[2] / HEAD.a ** 2]);
/** A point on his head, `out` beyond it: `side` radians from its top toward his right (+x), `front` toward you. */
export function onHead(side: number, front: number, out = 0): V3 {
  const d = norm([Math.sin(side), Math.cos(side) * Math.cos(front), Math.cos(side) * Math.sin(front)]);
  const p: V3 = [d[0] * HEAD.a, HEAD.y + d[1] * HEAD.b, d[2] * HEAD.a];
  return add(p, mul(headNormal(p), out));
}
/** In a hat's section (r, y): the point at angle `th` from his head's top, `d` out from it along its normal. */
export function headAt(th: number, d = 0): P2 {
  const n = norm([Math.sin(th) / HEAD.a, Math.cos(th) / HEAD.b, 0]);
  return [HEAD.a * Math.sin(th) + d * n[0], HEAD.y + HEAD.b * Math.cos(th) + d * n[1]];
}
/** His head's half-width at a height (0 above and below it). */
export const headR = (y: number): number => HEAD.a * Math.sqrt(Math.max(0, 1 - ((y - HEAD.y) / HEAD.b) ** 2));
/** The height on his head where it is `r` from the axis (a hat with an opening of radius r sits there). */
export const seatAt = (r: number): number => HEAD.y + HEAD.b * Math.sqrt(Math.max(0, 1 - (r / HEAD.a) ** 2));

// a small value noise, for fur, straw and knots: the same everywhere it is asked
const hash3 = (x: number, y: number, z: number): number => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};
export function noise3(p: V3): number {
  const i = p.map(Math.floor) as V3;
  const f = p.map((v, k) => v - i[k]!) as V3;
  const u = f.map((t) => t * t * (3 - 2 * t)) as V3;
  let s = 0;
  for (let z = 0; z < 2; z++)
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) s += hash3(i[0] + x, i[1] + y, i[2] + z) * (x ? u[0] : 1 - u[0]) * (y ? u[1] : 1 - u[1]) * (z ? u[2] : 1 - u[2]);
  return s;
}

const spow = (x: number, e: number): number => Math.sign(x) * Math.abs(x) ** e;

// ── the grid every part is made of ────────────────────────────────────────────────────────────
type GridOpts = { flip?: boolean; uv?: (u: number, v: number) => P2; weld?: boolean };

/** A grid of nu x nv quads over `at(u, v)`, u and v from 0 to 1. Its normals are its own triangles', averaged
 * where points meet (a seam, a pole), so a part is smooth unless it is made of separate faces (a gem). */
export function grid(m: Mesh, nu: number, nv: number, at: (u: number, v: number) => V3, look: Look, o: GridOpts = {}): void {
  const base = m.count;
  const W = nu + 1;
  const extra = (look.extra ?? 0) + (look.spin ? 100 : 0);
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const v = j / nv;
      const p = at(u, v);
      m.pos.push(p[0], p[1], p[2]);
      const t: P2 = o.uv ? o.uv(u, v) : [u, v];
      m.uv.push(t[0], t[1]);
      m.mat.push(look.kind, look.slot, 1, extra);
      m.nrm.push(0, 0, 0);
    }
  }
  const first = m.idx.length;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = base + j * W + i;
      const b = a + 1;
      const c = a + W + 1;
      const d = a + W;
      if (o.flip) m.idx.push(a, c, b, a, d, c);
      else m.idx.push(a, b, c, a, c, d);
    }
  }
  normals(m, base, first);
  if (o.weld !== false) weld(m, base, nu, nv);
}

/** Each vertex's normal: the area-weighted sum of its triangles'. */
function normals(m: Mesh, base: number, first: number): void {
  const P = m.pos;
  const N = m.nrm;
  for (let k = first; k < m.idx.length; k += 3) {
    const a = m.idx[k]! * 3;
    const b = m.idx[k + 1]! * 3;
    const c = m.idx[k + 2]! * 3;
    const e1x = P[b]! - P[a]!, e1y = P[b + 1]! - P[a + 1]!, e1z = P[b + 2]! - P[a + 2]!;
    const e2x = P[c]! - P[a]!, e2y = P[c + 1]! - P[a + 1]!, e2z = P[c + 2]! - P[a + 2]!;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      N[v] = N[v]! + nx;
      N[v + 1] = N[v + 1]! + ny;
      N[v + 2] = N[v + 2]! + nz;
    }
  }
  for (let v = base * 3; v < N.length; v += 3) {
    const l = Math.hypot(N[v]!, N[v + 1]!, N[v + 2]!) || 1;
    N[v] = N[v]! / l;
    N[v + 1] = N[v + 1]! / l;
    N[v + 2] = N[v + 2]! / l;
  }
}

/** Where a grid meets itself (the seam down a part's back, a closed tube's ends) or shrinks to a point (a pole), its
 * points share one normal, so the part is smooth there. */
function weld(m: Mesh, base: number, nu: number, nv: number): void {
  const P = m.pos;
  const N = m.nrm;
  const W = nu + 1;
  const at = (i: number, j: number): number => base + j * W + i;
  const same = (a: number, b: number): boolean => Math.abs(P[a * 3]! - P[b * 3]!) + Math.abs(P[a * 3 + 1]! - P[b * 3 + 1]!) + Math.abs(P[a * 3 + 2]! - P[b * 3 + 2]!) < 1e-6;
  const share = (vs: number[]): void => {
    let x = 0, y = 0, z = 0;
    for (const v of vs) {
      x += N[v * 3]!;
      y += N[v * 3 + 1]!;
      z += N[v * 3 + 2]!;
    }
    const l = Math.hypot(x, y, z) || 1;
    for (const v of vs) {
      N[v * 3] = x / l;
      N[v * 3 + 1] = y / l;
      N[v * 3 + 2] = z / l;
    }
  };
  for (let j = 0; j <= nv; j++) {
    if (same(at(0, j), at(nu >> 1, j)) && same(at(0, j), at(nu >> 2, j))) share(Array.from({ length: W }, (_, i) => at(i, j)));
    else if (same(at(0, j), at(nu, j))) share([at(0, j), at(nu, j)]);
  }
  for (let i = 0; i <= nu; i++) if (same(at(i, 0), at(i, nv))) share([at(i, 0), at(i, nv)]);
}

// ── profiles ───────────────────────────────────────────────────────────────────────────────────
/** A profile in (r, y), drawn as a pen goes: lines, arcs and curves, each sampled finely enough to be smooth. */
export class Profile {
  readonly pts: P2[] = [];
  constructor(r: number, y: number) {
    this.pts.push([r, y]);
  }
  get end(): P2 {
    return this.pts[this.pts.length - 1]!;
  }
  line(r: number, y: number, n = 2): this {
    const [r0, y0] = this.end;
    for (let i = 1; i <= n; i++) this.pts.push([mix(r0, r, i / n), mix(y0, y, i / n)]);
    return this;
  }
  /** A quadratic curve through a control point. */
  curve(cr: number, cy: number, r: number, y: number, n = 10): this {
    const [r0, y0] = this.end;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      this.pts.push([(1 - t) * (1 - t) * r0 + 2 * (1 - t) * t * cr + t * t * r, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * cy + t * t * y]);
    }
    return this;
  }
  /** A cubic curve. */
  cubic(c1: P2, c2: P2, r: number, y: number, n = 14): this {
    const [r0, y0] = this.end;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3;
      this.pts.push([a * r0 + b * c1[0] + c * c2[0] + d * r, a * y0 + b * c1[1] + c * c2[1] + d * y]);
    }
    return this;
  }
  /** An arc about (cr, cy) from where the pen is to the angle `to` (radians, 0 along +r, counter-clockwise). */
  arc(cr: number, cy: number, to: number, n = 10): this {
    const [r0, y0] = this.end;
    const rad = Math.hypot(r0 - cr, y0 - cy);
    let a0 = Math.atan2(y0 - cy, r0 - cr);
    if (to - a0 > Math.PI) a0 += 2 * Math.PI;
    if (a0 - to > Math.PI) a0 -= 2 * Math.PI;
    for (let i = 1; i <= n; i++) {
      const a = mix(a0, to, i / n);
      this.pts.push([cr + rad * Math.cos(a), cy + rad * Math.sin(a)]);
    }
    return this;
  }
  /** Points along a function of t from 0 to 1 (its first point is where the pen already is, so it is skipped). */
  fn(n: number, f: (t: number) => P2): this {
    for (let i = 1; i <= n; i++) this.pts.push(f(i / n));
    return this;
  }
  /** A point on the axis (a cone's tip) reached with a round of radius `rad`: the pen heads for (0, y). */
  tip(y: number, rad: number, n = 8): this {
    const [r0, y0] = this.end;
    const d1 = norm([0 - r0, y - y0, 0]);
    const d2: V3 = [d1[0], -d1[1], 0]; // down the other side, mirrored across the axis
    const half = Math.acos(clamp(-(d1[0] * d2[0] + d1[1] * d2[1]), -1, 1)) / 2;
    const cut = Math.min(rad / Math.tan(half), Math.hypot(r0, y - y0) * 0.6);
    const a: P2 = [0 - d1[0] * cut, y - d1[1] * cut];
    this.line(a[0], a[1], 2);
    for (let i = 1; i <= n; i++) {
      const t = (i / n) * 0.5; // the first half of the round: it ends on the axis
      const b: P2 = [-a[0], a[1]];
      this.pts.push([(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * 0 + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * y + t * t * b[1]]);
    }
    this.pts[this.pts.length - 1] = [0, this.end[1]];
    return this;
  }
  /** A corner rounded with radius `rad`: from the pen toward (r, y), turning there toward (r2, y2). */
  corner(r: number, y: number, r2: number, y2: number, rad: number, n = 8): this {
    const [r0, y0] = this.end;
    const d1 = norm([r - r0, y - y0, 0]);
    const d2 = norm([r2 - r, y2 - y, 0]);
    const cosT = clamp(-(d1[0] * d2[0] + d1[1] * d2[1]), -1, 1);
    const half = Math.acos(cosT) / 2; // half the angle between the two edges
    const cut = Math.min(rad / Math.tan(half), Math.hypot(r - r0, y - y0) * 0.5, Math.hypot(r2 - r, y2 - y) * 0.5);
    const a: P2 = [r - d1[0] * cut, y - d1[1] * cut];
    const b: P2 = [r + d2[0] * cut, y + d2[1] * cut];
    this.line(a[0], a[1], 2);
    return this.curve(r, y, b[0], b[1], n);
  }
}

/** A part turned round the hat's axis. A profile drawn counter-clockwise in (r, y) (out along the bottom, up the
 * outside, in across the top) faces out. u runs round from the back (its seam is behind his head), v along the
 * profile in the hat's units. `at` bends it afterwards (a brim's curl, a crown's pinch). */
export function revolve(
  m: Mesh,
  pts: P2[],
  look: Look,
  o: { segs?: number; from?: number; to?: number; at?: (p: V3, phi: number, s: number) => V3; flip?: boolean; uv?: (u: number, s: number) => P2 } = {},
): void {
  const L = [0];
  for (let k = 1; k < pts.length; k++) L.push(L[k - 1]! + Math.hypot(pts[k]![0] - pts[k - 1]![0], pts[k]![1] - pts[k - 1]![1]));
  const nv = pts.length - 1;
  const a0 = o.from ?? 0;
  const a1 = o.to ?? 2 * Math.PI;
  const angle = (u: number): number => Math.PI + a0 + (a1 - a0) * u; // u = 0 at the back
  grid(
    m,
    o.segs ?? 72,
    nv,
    (u, v) => {
      const j = Math.round(v * nv);
      const [r, y] = pts[j]!;
      const phi = angle(u);
      const p: V3 = [r * Math.sin(phi), y, r * Math.cos(phi)];
      return o.at ? o.at(p, phi, L[j]!) : p;
    },
    look,
    { flip: o.flip, uv: (u, v) => (o.uv ? o.uv(u, L[Math.round(v * nv)]!) : [u, L[Math.round(v * nv)]!]) },
  );
}

/** A tube along a curve, its radius along it, its ends rounded. u runs round it, v along it in the hat's units.
 * `flat` squashes its section (a ribbon, a blade); `twist` turns the section along it. */
export function tube(
  m: Mesh,
  path: (t: number) => V3,
  radius: (t: number) => number,
  look: Look,
  o: { n?: number; k?: number; caps?: boolean; closed?: boolean; flat?: number; twist?: (t: number) => number; up?: V3; bump?: (u: number, v: number) => number; square?: number } = {},
): void {
  const n = o.n ?? 32;
  const k = o.k ?? 14;
  const closed = o.closed ?? false;
  const C: V3[] = [];
  for (let i = 0; i <= n; i++) C.push(path(closed ? (i % n) / n : i / n));
  const T: V3[] = C.map((_, i) => {
    const a = closed ? C[(i - 1 + n) % n]! : C[Math.max(0, i - 1)]!;
    const b = closed ? C[(i + 1) % n]! : C[Math.min(n, i + 1)]!;
    return norm(sub(b, a));
  });
  // a frame carried along without twisting (parallel transport)
  const N: V3[] = [];
  let up = o.up ?? (Math.abs(T[0]![1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]);
  let f = norm(sub(up, mul(T[0]!, dot(up, T[0]!))));
  for (let i = 0; i <= n; i++) {
    f = norm(sub(f, mul(T[i]!, dot(f, T[i]!))));
    N.push(f);
  }
  up = f;
  const S: number[] = [0];
  for (let i = 1; i <= n; i++) S.push(S[i - 1]! + len(sub(C[i]!, C[i - 1]!)));
  const caps = o.caps ?? !closed;
  const capN = caps ? 6 : 0;
  // rings: the start cap, the body, the end cap
  type Ring = { c: V3; t: V3; n: V3; r: number; s: number; tw: number };
  const rings: Ring[] = [];
  const at = (i: number): Ring => ({ c: C[i]!, t: T[i]!, n: N[i]!, r: radius(i / n), s: S[i]!, tw: o.twist ? o.twist(i / n) : 0 });
  if (caps) {
    const r0 = at(0);
    for (let q = capN; q >= 1; q--) {
      const a = (q / capN) * (Math.PI / 2);
      rings.push({ ...r0, c: sub(r0.c, mul(r0.t, r0.r * Math.sin(a))), r: r0.r * Math.cos(a) + 1e-5, s: -r0.r * Math.sin(a) });
    }
  }
  for (let i = 0; i <= n; i++) rings.push(at(i));
  if (caps) {
    const r1 = at(n);
    for (let q = 1; q <= capN; q++) {
      const a = (q / capN) * (Math.PI / 2);
      rings.push({ ...r1, c: add(r1.c, mul(r1.t, r1.r * Math.sin(a))), r: r1.r * Math.cos(a) + 1e-5, s: r1.s + r1.r * Math.sin(a) });
    }
  }
  const flat = o.flat ?? 1;
  grid(
    m,
    k,
    rings.length - 1,
    (u, v) => {
      const g = rings[Math.round(v * (rings.length - 1))]!;
      const b = cross(g.t, g.n);
      const a = 2 * Math.PI * u + g.tw;
      const r = g.r * (1 + (o.bump ? o.bump(u, v) : 0));
      // a section from round (1) toward a rounded square (an acetate rim's, 0.5)
      const ca = o.square ? spow(Math.cos(a), o.square) : Math.cos(a);
      const sa = o.square ? spow(Math.sin(a), o.square) : Math.sin(a);
      return add(g.c, add(mul(g.n, ca * r), mul(b, sa * r * flat)));
    },
    look,
    { uv: (u, v) => [u, rings[Math.round(v * (rings.length - 1))]!.s] },
  );
}

/** An ellipsoid at `c` with radii `r`, turned by `R`; `bump` pushes its surface out along the unit direction (fur, a
 * puff). u runs round it, v from its bottom to its top. */
export function ellipsoid(m: Mesh, c: V3, r: V3, look: Look, o: { R?: M3; nu?: number; nv?: number; bump?: (n: V3) => number; v0?: number; v1?: number } = {}): void {
  const v0 = o.v0 ?? 0;
  const v1 = o.v1 ?? 1;
  grid(
    m,
    o.nu ?? 40,
    o.nv ?? 24,
    (u, v) => {
      const th = Math.PI * (1 - mix(v0, v1, v));
      const ph = Math.PI + 2 * Math.PI * u;
      const n: V3 = [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
      const s = 1 + (o.bump ? o.bump(n) : 0);
      const p: V3 = [n[0] * r[0] * s, n[1] * r[1] * s, n[2] * r[2] * s];
      return add(c, o.R ? apply(o.R, p) : p);
    },
    look,
    { uv: (u, v) => [u, mix(v0, v1, v) * Math.PI * Math.max(...r)] },
  );
}

/** A rounded box (a superellipsoid): half-sizes `h`, `e` how square (0.1 nearly a box, 1 an ellipsoid). */
export function rbox(m: Mesh, c: V3, h: V3, look: Look, o: { R?: M3; e?: number; nu?: number; nv?: number } = {}): void {
  const e = o.e ?? 0.25;
  grid(
    m,
    o.nu ?? 32,
    o.nv ?? 20,
    (u, v) => {
      const th = Math.PI * (1 - v);
      const ph = Math.PI + 2 * Math.PI * u;
      const p: V3 = [h[0] * spow(Math.sin(th), e) * spow(Math.sin(ph), e), h[1] * spow(Math.cos(th), e), h[2] * spow(Math.sin(th), e) * spow(Math.cos(ph), e)];
      return add(c, o.R ? apply(o.R, p) : p);
    },
    look,
  );
}

/** One flat face (a gem's, a cut star's): its own three vertices, turned outward from `c`. */
export function facet(m: Mesh, tri: V3[], c: V3, look: Look): void {
  let q = tri;
  let n = norm(cross(sub(q[1]!, q[0]!), sub(q[2]!, q[0]!)));
  const mid = mul(add(add(q[0]!, q[1]!), q[2]!), 1 / 3);
  if (dot(n, sub(mid, c)) < 0) {
    q = [q[0]!, q[2]!, q[1]!];
    n = mul(n, -1);
  }
  const base = m.count;
  for (const p of q) {
    m.pos.push(...p);
    m.nrm.push(...n);
    m.uv.push(0, 0);
    m.mat.push(look.kind, look.slot, 1, look.extra ?? 0);
  }
  m.idx.push(base, base + 1, base + 2);
}

/** A cut stone: a table, crown facets, a girdle and the pavilion down to its point; flat faces, so each one catches
 * the light on its own. `sx` stretches it (an oval, a drop), `R` turns it to face out. */
export function gem(m: Mesh, c: V3, r: number, look: Look, o: { R?: M3; sides?: number; sx?: number; depth?: number } = {}): void {
  const s = o.sides ?? 8;
  const sx = o.sx ?? 1;
  const d = o.depth ?? 0.8;
  const ring = (rad: number, y: number, off: number): V3[] =>
    Array.from({ length: s }, (_, i) => {
      const a = ((i + off) / s) * 2 * Math.PI;
      return [Math.sin(a) * rad * sx, y, Math.cos(a) * rad] as V3;
    });
  const place = (p: V3): V3 => add(c, o.R ? apply(o.R, p) : p);
  const table = ring(r * 0.55, r * 0.32, 0.5).map(place);
  const girdle = ring(r, 0, 0).map(place);
  const culet = place([0, -r * d, 0]);
  const top = place([0, r * 0.32, 0]);
  const mid = place([0, 0, 0]);
  for (let i = 0; i < s; i++) {
    const j = (i + 1) % s;
    facet(m, [top, table[j]!, table[i]!], mid, look);
    facet(m, [table[i]!, table[j]!, girdle[j]!], mid, look);
    facet(m, [table[i]!, girdle[j]!, girdle[i]!], mid, look);
    facet(m, [girdle[i]!, girdle[j]!, culet], mid, look);
  }
}

/** A star with n points, cut like a gem: a ridge up each arm to its raised middle, flat behind. `B` turns it so its
 * face looks along B's z. */
export function star(m: Mesh, c: V3, R: number, r: number, h: number, look: Look, B: M3, n = 5): void {
  const pts: V3[] = [];
  for (let i = 0; i < 2 * n; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / n;
    const rad = i % 2 ? r : R;
    pts.push(add(c, apply(B, [Math.cos(a) * rad, Math.sin(a) * rad, 0])));
  }
  const top = add(c, apply(B, [0, 0, h]));
  const back = add(c, apply(B, [0, 0, -h * 0.3]));
  const mid = c;
  for (let i = 0; i < 2 * n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % (2 * n)]!;
    facet(m, [top, a, b], mid, look);
    facet(m, [back, b, a], mid, look);
  }
}

/** A smooth path through points (Catmull-Rom), t from 0 to 1. */
export function spline(pts: V3[]): (t: number) => V3 {
  const n = pts.length - 1;
  return (t) => {
    const x = clamp(t) * n;
    const i = Math.min(n - 1, Math.floor(x));
    const f = x - i;
    const p0 = pts[Math.max(0, i - 1)]!, p1 = pts[i]!, p2 = pts[i + 1]!, p3 = pts[Math.min(n, i + 2)]!;
    const f2 = f * f, f3 = f2 * f;
    return [0, 1, 2].map(
      (k) => 0.5 * (2 * p1[k]! + (-p0[k]! + p2[k]!) * f + (2 * p0[k]! - 5 * p1[k]! + 4 * p2[k]! - p3[k]!) * f2 + (-p0[k]! + 3 * p1[k]! - 3 * p2[k]! + p3[k]!) * f3),
    ) as V3;
  };
}

/** A thin blade (a leaf, a petal, a feather's vane, an ear): from `at` along `dir` for `len`, its face toward `up`, its
 * half-width `wid` times `shape(t)` along it, `thick` through, cupped across (`cup`, a share of its width) and bent
 * toward its face along its length (`bend`, in its length). u runs across it (-1 to 1, both faces), v along it. */
export function blade(
  m: Mesh,
  at: V3,
  dir: V3,
  up: V3,
  len: number,
  wid: number,
  look: Look,
  o: { shape?: (t: number) => number; cup?: number; bend?: number; thick?: number; twist?: number; nu?: number; nv?: number } = {},
): void {
  const d = norm(dir);
  const A = norm(cross(up, d)); // across
  const F = cross(d, A); // its face
  const shape = o.shape ?? ((t: number) => Math.sin(Math.PI * Math.min(1, t)) ** 0.8);
  const cup = o.cup ?? 0;
  const bend = o.bend ?? 0;
  const thick = o.thick ?? 0.008;
  const tw = o.twist ?? 0;
  let rowV = -1;
  let row = { c: [0, 0, 0] as V3, ax: [0, 0, 0] as V3, fx: [0, 0, 0] as V3, w: 0, th: 0 };
  grid(
    m,
    o.nu ?? 18,
    o.nv ?? 26,
    (u, v) => {
      if (v !== rowV) {
        // this row's place and frame along the blade, worked out once for the row
        rowV = v;
        const t = v;
        const T = norm(add(mul(d, len), mul(F, 2 * bend * len * t)));
        const Fp = norm(sub(F, mul(T, dot(F, T))));
        const Ap = cross(Fp, T);
        const a = tw * t;
        row = {
          c: add(add(at, mul(d, len * t)), mul(F, bend * len * t * t)),
          ax: add(mul(Ap, Math.cos(a)), mul(Fp, Math.sin(a))),
          fx: add(mul(Fp, Math.cos(a)), mul(Ap, -Math.sin(a))),
          w: wid * shape(t),
          th: thick * (0.35 + 0.65 * Math.min(1, shape(t) * 1.5)),
        };
      }
      const ang = 2 * Math.PI * u;
      const x = Math.cos(ang) * row.w;
      const y = Math.sin(ang) * row.th + cup * wid * (x / Math.max(wid, 1e-6)) ** 2;
      const { c, ax, fx } = row;
      return [c[0] + ax[0] * x + fx[0] * y, c[1] + ax[1] * x + fx[1] * y, c[2] + ax[2] * x + fx[2] * y];
    },
    look,
    { uv: (u, v) => [Math.cos(2 * Math.PI * u), v] },
  );
}

// ── light it ahead: what each point of the hat can see of the sky ──────────────────────────────
/** Bakes each vertex's ambient occlusion: how much of the hat lies out along its normal, read from the hat's area
 * spread over a coarse grid, and how much of his head (an ellipsoid) it faces. A fold, a brim's underside, the foot
 * of a crown where it meets the brim come out darker; an open surface does not. Linear in the vertices. */
export function bake(m: Mesh, o: { strength?: number; head?: boolean } = {}): void {
  const k = o.strength ?? 0.85;
  const n = m.count;
  const P = m.pos;
  const Nn = m.nrm;
  const area = new Float64Array(n);
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t]! * 3, b = m.idx[t + 1]! * 3, c = m.idx[t + 2]! * 3;
    const e1x = P[b]! - P[a]!, e1y = P[b + 1]! - P[a + 1]!, e1z = P[b + 2]! - P[a + 2]!;
    const e2x = P[c]! - P[a]!, e2y = P[c + 1]! - P[a + 1]!, e2z = P[c + 2]! - P[a + 2]!;
    const A = Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x) / 6;
    area[a / 3] = area[a / 3]! + A;
    area[b / 3] = area[b / 3]! + A;
    area[c / 3] = area[c / 3]! + A;
  }
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++)
    for (let c = 0; c < 3; c++) {
      lo[c] = Math.min(lo[c]!, P[v * 3 + c]!);
      hi[c] = Math.max(hi[c]!, P[v * 3 + c]!);
    }
  const pad = 0.15;
  const h = (Math.max(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) + 2 * pad) / 44;
  const DX = Math.ceil((hi[0]! - lo[0]! + 2 * pad) / h) + 2;
  const DY = Math.ceil((hi[1]! - lo[1]! + 2 * pad) / h) + 2;
  const DZ = Math.ceil((hi[2]! - lo[2]! + 2 * pad) / h) + 2;
  const g = new Float32Array(DX * DY * DZ);
  const ox = lo[0]! - pad, oy = lo[1]! - pad, oz = lo[2]! - pad;
  const inv = 1 / h;
  const A0 = 1 / (h * h);
  for (let v = 0; v < n; v++) {
    const gx = (P[v * 3]! - ox) * inv, gy = (P[v * 3 + 1]! - oy) * inv, gz = (P[v * 3 + 2]! - oz) * inv;
    const ix = gx | 0, iy = gy | 0, iz = gz | 0;
    const fx = gx - ix, fy = gy - iy, fz = gz - iz;
    const A = area[v]! * A0;
    const at = (iz * DY + iy) * DX + ix;
    const X = 1, Y = DX, Z = DX * DY;
    g[at] = g[at]! + A * (1 - fx) * (1 - fy) * (1 - fz);
    g[at + X] = g[at + X]! + A * fx * (1 - fy) * (1 - fz);
    g[at + Y] = g[at + Y]! + A * (1 - fx) * fy * (1 - fz);
    g[at + X + Y] = g[at + X + Y]! + A * fx * fy * (1 - fz);
    g[at + Z] = g[at + Z]! + A * (1 - fx) * (1 - fy) * fz;
    g[at + X + Z] = g[at + X + Z]! + A * fx * (1 - fy) * fz;
    g[at + Y + Z] = g[at + Y + Z]! + A * (1 - fx) * fy * fz;
    g[at + X + Y + Z] = g[at + X + Y + Z]! + A * fx * fy * fz;
  }
  const sample = (x: number, y: number, z: number): number => {
    const gx = (x - ox) * inv, gy = (y - oy) * inv, gz = (z - oz) * inv;
    if (gx < 0 || gy < 0 || gz < 0 || gx >= DX - 1 || gy >= DY - 1 || gz >= DZ - 1) return 0;
    const ix = gx | 0, iy = gy | 0, iz = gz | 0;
    const fx = gx - ix, fy = gy - iy, fz = gz - iz;
    const at = (iz * DY + iy) * DX + ix;
    const Y = DX, Z = DX * DY;
    const a0 = g[at]! + (g[at + 1]! - g[at]!) * fx, a1 = g[at + Y]! + (g[at + Y + 1]! - g[at + Y]!) * fx;
    const b0 = g[at + Z]! + (g[at + Z + 1]! - g[at + Z]!) * fx, b1 = g[at + Y + Z]! + (g[at + Y + Z + 1]! - g[at + Y + Z]!) * fx;
    const a = a0 + (a1 - a0) * fy, b = b0 + (b1 - b0) * fy;
    return a + (b - a) * fz;
  };
  for (let v = 0; v < n; v++) {
    const px = P[v * 3]!, py = P[v * 3 + 1]!, pz = P[v * 3 + 2]!;
    const nx = Nn[v * 3]!, ny = Nn[v * 3 + 1]!, nz = Nn[v * 3 + 2]!;
    let occ = 0;
    occ += 0.34 * Math.min(1.2, sample(px + nx * 2 * h, py + ny * 2 * h, pz + nz * 2 * h) * 0.9);
    occ += 0.28 * Math.min(1.2, sample(px + nx * 3.4 * h, py + ny * 3.4 * h, pz + nz * 3.4 * h) * 0.9);
    occ += 0.22 * Math.min(1.2, sample(px + nx * 5.2 * h, py + ny * 5.2 * h, pz + nz * 5.2 * h) * 0.9);
    occ += 0.16 * Math.min(1.2, sample(px + nx * 7.6 * h, py + ny * 7.6 * h, pz + nz * 7.6 * h) * 0.9);
    if (o.head !== false) {
      // his head, taken as a ball of its size where it is nearest
      const sx = px / HEAD.a, sy = (py - HEAD.y) / HEAD.b, sz = pz / HEAD.a;
      const kk = Math.sqrt(sx * sx + sy * sy + sz * sz); // 1 on his head
      const hx = -px, hy = HEAD.y - py, hz = -pz;
      const d = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
      const rad = d / (kk || 1);
      const ci = (nx * hx + ny * hy + nz * hz) / d;
      if (ci > 0) occ += kk > 1 ? (rad / d) ** 2 * ci * 0.9 : 1;
    }
    m.mat[v * 4 + 2] = clamp(1 - k * occ, 0.15, 1);
  }
}

/** Where a hat ends, seen from in front (from a little above, as it is drawn): its lowest point in each of 32 columns
 * across it, x from -0.9 to 0.9, in the hat's flat units (+y down; -9 where none of it is). What gives off light is
 * left out: a halo casts no shadow. */
export function lowestEdge(m: Mesh): Float32Array {
  const E = new Float32Array(32).fill(-9);
  const c = Math.cos(PITCH), s = Math.sin(PITCH);
  for (let v = 0; v < m.count; v++) {
    if (m.mat[v * 4] === MAT.glow) continue;
    const x = m.pos[v * 3]!, y = m.pos[v * 3 + 1]!, z = m.pos[v * 3 + 2]!;
    if ((x / HEAD.a) ** 2 + ((y - HEAD.y) / HEAD.b) ** 2 + (z / HEAD.a) ** 2 < 0.97) continue; // inside his head: never seen
    const i = Math.round(((x + 0.9) / 1.8) * 31);
    if (i < 0 || i > 31) continue;
    E[i] = Math.max(E[i]!, -(y * c - z * s));
  }
  // a column a thin part skipped takes its neighbours' (no gap in the shadow under a brim)
  const out = new Float32Array(E);
  for (let i = 1; i < 31; i++) if (E[i]! < -5 && E[i - 1]! > -5 && E[i + 1]! > -5) out[i] = (E[i - 1]! + E[i + 1]!) / 2;
  return out;
}

/** The hat as the GPU takes it, and where it ends (lowestEdge). */
export type Built = { pos: Float32Array; nrm: Float32Array; uv: Float32Array; mat: Float32Array; idx: Uint32Array; count: number; edge: Float32Array };
export const built = (m: Mesh): Built => ({
  pos: new Float32Array(m.pos),
  nrm: new Float32Array(m.nrm),
  uv: new Float32Array(m.uv),
  mat: new Float32Array(m.mat),
  idx: new Uint32Array(m.idx),
  count: m.idx.length,
  edge: lowestEdge(m),
});
