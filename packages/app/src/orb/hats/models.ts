// The hats as models (owner, 10-09: "like we like the ideas of them 100% dont change what they are, but the design lol.
// even the party hat is huge ... dont cheap out on them. make them nice, to industry standards"). Each of the 42 is
// the hat it always was, built again in 3D at a size that suits his head, out of what such a hat is made of: felt
// and silk, knit, straw, cotton twill with its seams and stitching, gold with cut stones, glossy plastic, horn,
// feather, fur. Sizes are in the hat's units (geo.ts), drawn on Ash's bean and built on the head of the shape that wears
// it (heads.ts): what hugs his head hugs that one, what sits on it sits on that one. Pure: the renderer builds a hat the
// first time a shape wears it and keeps it on the GPU.
import {
  add, apply, bake, blade, built, clamp, cross, ellipsoid, facet, fromBean, gem, grid, head, headAt, headNormal, headR, MAT, mix, mm,
  Mesh, mul, noise3, norm, onHead, onThe, PITCH, Profile, radiusAt, rest, revolve, rotX, rotY, rotZ, seatAt, SLOT, smooth, spline, standing,
  star, sub, tube, type Built, type Head, type Look, type M3, type P2, type V3,
} from "./geo.ts";

const felt = (extra = 0): Look => ({ kind: MAT.felt, slot: SLOT.main, extra });
const satin2: Look = { kind: MAT.satin, slot: SLOT.second };
const gold: Look = { kind: MAT.metal, slot: SLOT.main };
const gold2: Look = { kind: MAT.metal, slot: SLOT.second };
const steel: Look = { kind: MAT.metal, slot: SLOT.steel };
const greenery: Look = { kind: MAT.leaf, slot: SLOT.leaf, extra: 1 };
const TAU = 2 * Math.PI;

/** A rotation whose columns are the given axes: local x, y, z to those. */
const basis = (x: V3, y: V3, z: V3): M3 => [
  [x[0], y[0], z[0]],
  [x[1], y[1], z[1]],
  [x[2], y[2], z[2]],
];
/** A frame facing `out`, its up as near `up` as it can be. */
const facing = (out: V3, up: V3 = [0, 1, 0]): M3 => {
  const z = norm(out);
  const x = norm(cross(up, z));
  return basis(x, cross(z, x), z);
};
/** A point round the hat's axis: angle 0 is in front of him, +PI/2 to his right. */
const around = (r: number, y: number, phi: number): V3 => [r * Math.sin(phi), y, r * Math.cos(phi)];
const circle =
  (r: number, y: number): ((t: number) => V3) =>
  (t) =>
    around(r, y, TAU * t);
/** A blade's outline: from `base` (a share of its width) at its foot, widest at `at`, closing round at its tip. */
const outline =
  (at: number, base = 0): ((t: number) => number) =>
  (t) =>
    t < at ? base + (1 - base) * Math.sin((Math.PI / 2) * (t / at)) ** 0.7 : Math.sqrt(Math.max(0, 1 - ((t - at) / (1 - at)) ** 2));
/** A leaf's: pointed at both ends, fullest a little below its middle. */
const leafy = (t: number): number => Math.sin(Math.PI * Math.min(1, t)) ** 0.8 * (1 - 0.2 * t);

/** Fur's silhouette: soft clumps over finer tufts. */
const fluff =
  (seed: number, k = 1): ((n: V3) => number) =>
  (n) =>
    k * (0.16 * (noise3(mul(add(n, [seed, 0, 0]), 5)) - 0.5) + 0.09 * (noise3(mul(add(n, [0, seed, 0]), 13)) - 0.5) + 0.05 * (noise3(mul(n, 29)) - 0.5));

/** Scales the parts made since vertex `from` about `c` (a model drawn small and grown to size). */
function grow(m: Mesh, from: number, k: number, c: V3): void {
  for (let v = from; v < m.count; v++) for (let i = 0; i < 3; i++) m.pos[v * 3 + i] = c[i]! + (m.pos[v * 3 + i]! - c[i]!) * k;
}

/** A pompom: a ball of fur. */
function pompom(m: Mesh, c: V3, r: number, slot: number, seed = 1): void {
  ellipsoid(m, c, [r, r * 0.94, r], { kind: MAT.fur, slot }, { nu: 44, nv: 28, bump: fluff(seed) });
}

/** A ribbon bow, tied on a band: two loops, the knot, two short tails; `out` is the way it faces. */
function bow(m: Mesh, c: V3, out: V3, s: number, look: Look): void {
  const B = facing(out);
  const at = (x: number, y: number, z: number): V3 => add(c, apply(B, [x, y, z]));
  const n = apply(B, [0, 0, 1]);
  for (const side of [-1, 1]) {
    blade(m, at(side * 0.15 * s, 0, 0.25 * s), apply(B, [side, 0.28, 0.12]), n, 1.15 * s, 0.55 * s, look, { shape: outline(0.55, 0.45), thick: 0.32 * s, cup: -0.15, bend: 0.06 });
    blade(m, at(side * 0.1 * s, -0.1 * s, 0.2 * s), apply(B, [side * 0.38, -1, 0.1]), n, 0.95 * s, 0.24 * s, look, { shape: (t) => 1 - t ** 10, thick: 0.06 * s, cup: 0.2 });
  }
  ellipsoid(m, at(0, 0, 0.42 * s), [s * 0.3, s * 0.42, s * 0.28], look, { R: B, nu: 18, nv: 12 });
}

/** A hat band: a ribbon round a crown whose radius at each height is `wall`, from y0 to y1, `proud` of it; `at` bends it
 * as its crown is bent. */
function band(m: Mesh, wall: (y: number) => number, y0: number, y1: number, look: Look, proud = 0.007, segs = 96, at?: (q: V3, phi: number) => V3): void {
  const rb = (y: number): number => wall(y) + proud;
  const p = new Profile(wall(y0) - 0.004, y0)
    .line(rb(y0) - 0.004, y0, 2)
    .curve(rb(y0), y0, rb(y0 + 0.006), y0 + 0.006, 4)
    .fn(10, (t) => {
      const y = mix(y0 + 0.006, y1 - 0.006, t);
      return [rb(y), y];
    })
    .curve(rb(y1), y1, rb(y1) - 0.004, y1, 4)
    .line(wall(y1) - 0.004, y1, 2);
  revolve(m, p.pts, look, { segs, at });
}

/** A brim (or any thin slab round the axis): from r0 out to r1 at height y, `th` thick, its edge rolled. */
const slab = (r0: number, r1: number, y: number, th: number): P2[] =>
  new Profile(r0, y - th / 2).line(r1 - th / 2, y - th / 2, 14).arc(r1 - th / 2, y, Math.PI / 2, 8).line(r0, y + th / 2, 14).pts;

/** How far under his outline the back of a band is let down (geo.ts rest), where seen from a little above it would show
 * over his head: his glass is drawn straight on, so the back of a band round a flat head (a pebble's, a squircle's) stood
 * over it and was cut where his head hid it (owner, 10-10: "you see the cut off in the back of the head as its trying to
 * wrap around"). Under it, his head hides it, and the band goes round behind him. */
const BAND_REST = -0.012;

/** A band that goes round his head (a sweatband, a headband): its section from `t0` to `t1` radians down his head,
 * `d` out from it, its edges rounded; `free` (a band of its own, not the rim under a hat) lets its back down out of sight. */
function headBand(m: Mesh, t0: number, t1: number, d: number, look: Look, segs = 120, free = false): void {
  const r = Math.min(0.03, d * 0.9, (t1 - t0) * 0.3);
  const p = new Profile(t1, 0).corner(t1, d, t0, d, r, 6).corner(t0, d, t0, 0, r, 6).line(t0, 0.004, 1);
  revolve(m, p.pts.map(([th, dd]) => headAt(th, dd)), look, { segs, ...(free && { at: (q: V3) => rest(q, BAND_REST) }) });
}

/** An arc over his head from ear to ear (a headband's, headphones'): at `front` radians toward you, `out` off his head,
 * from `-reach` to `reach` radians either side of his top; `free`, its back let down as a band's is. */
const overHead =
  (reach: number, out: number, front = 0, free = false): ((t: number) => V3) =>
  (t) => {
    const p = onHead(mix(-reach, reach, t), front, out);
    return free ? rest(p, BAND_REST) : p;
  };

/** A headband's arc over his top whose ends go under his head toward his sides, as a band's ends go into the hair: its
 * last part dives a little back and under his surface, where his head hides it, so no end stands in the air past his
 * outline (owner, 10-10: "some headbands are a little off"). */
const tucked =
  (reach: number, out: number, front: number): ((t: number) => V3) =>
  (t) => {
    const side = mix(-reach, reach, t);
    const e = smooth(reach - 0.38, reach, Math.abs(side));
    return rest(onHead(side, front - 0.25 * e, out - 0.07 * e), BAND_REST);
  };

/** A peak (a cap's, a visor's): out from the edge (re, ye) round the angle `phc`, `L0` deep at its middle, `w`
 * radians either side, curving down at its sides; stitched round its edge. */
function peak(m: Mesh, re: number, ye: number, L0: number, w: number, phc: number, look: Look, t = 0.012, droop = 0.09): void {
  const bottom = L0 + 0.03 - t;
  const top0 = bottom + Math.PI * t;
  const pts = new Profile(re - 0.03, ye - t).line(re + L0 - t, ye - t, 14).arc(re + L0 - t, ye, Math.PI / 2, 8).line(re - 0.03, ye + t, 14).pts;
  revolve(m, pts, look, {
    segs: 56,
    from: phc - w - Math.PI,
    to: phc + w - Math.PI,
    uv: (u, s) => [u, s >= top0 ? clamp((s - top0) / L0) : 1],
    at: (q, phi) => {
      const u = (phi - phc) / w;
      const r = Math.hypot(q[0], q[2]);
      const ext = Math.max(0, r - re);
      const sh = Math.sqrt(Math.max(0, 1 - u * u));
      const r2 = Math.min(r, re) + ext * sh;
      return around(r2, q[1] - droop * ext * sh - 0.05 * u * u * (ext / L0), phi);
    },
  });
}

// ── the hats ──────────────────────────────────────────────────────────────────────────────────

/** A top hat in silk plush: the crown's slight waist and flare, a brim rolled up at the sides (a D'Orsay curl), a
 * grosgrain band with its bow to his left. */
function topHat(m: Mesh): void {
  const rb = 0.238, rt = 0.262, H = 0.44;
  const y0 = seatAt(rb) - 0.018;
  const rIn = 0.255, rOut = 0.42, th = 0.02;
  const yb = y0 + th + 0.022;
  const yt = y0 + H;
  const wall = (y: number): number => {
    const s = clamp((y - yb) / (yt - yb));
    return mix(rb, rt, s ** 1.8) - 0.007 * Math.sin(Math.PI * s);
  };
  const p = new Profile(0, y0)
    .line(rOut - th / 2, y0, 10)
    .arc(rOut - th / 2, y0 + th / 2, Math.PI / 2, 10)
    .line(rIn + 0.03, y0 + th, 8)
    .curve(wall(yb), y0 + th, wall(yb), yb, 6)
    .fn(26, (t) => [wall(mix(yb, yt - 0.026, t)), mix(yb, yt - 0.026, t)])
    .corner(wall(yt), yt, 0, yt + 0.006, 0.024, 8)
    .line(0, yt + 0.006, 6);
  revolve(m, p.pts, felt(1), {
    segs: 96,
    at: (q, phi) => {
      const r = Math.hypot(q[0], q[2]);
      if (r <= rIn + 0.01) return q;
      const t = (r - rIn - 0.01) / (rOut - rIn - 0.01);
      const side = Math.sin(phi) ** 2;
      return [q[0], q[1] + t * t * (0.085 * side - 0.022 * (1 - side)), q[2]];
    },
  });
  const b0 = yb + 0.002;
  const b1 = yb + 0.082;
  band(m, wall, b0, b1, satin2, 0.006, 96);
  const phi = -0.75;
  const y = (b0 + b1) / 2;
  bow(m, around(wall(y) + 0.012, y, phi), around(1, 0, phi), 0.042, satin2);
}

/** A knitted beanie: stocking stitch over his head, standing a little proud of its top, a turned-up ribbed cuff, a fur
 * pompom. Drawn in its section as angles down his head and distances out from it. */
function beanie(m: Mesh): void {
  const dBody = (th: number): number => 0.038 + 0.075 * Math.cos(Math.min(th, Math.PI / 2)) ** 4;
  const t1 = 0.86;
  const t2 = 1.12;
  const from = t1 + 0.07;
  const body = new Profile(...headAt(from, dBody(from))).fn(48, (t) => {
    const th = from * (1 - t);
    return headAt(th, dBody(th));
  });
  revolve(m, body.pts, { kind: MAT.knit, slot: SLOT.main, extra: 42 }, { segs: 84 });
  const dC = 0.066;
  const cuff = new Profile(t2, 0.02).corner(t2, dC, t1, dC, 0.03, 8).corner(t1, dC, t1, 0.02, 0.03, 8).line(t1, 0.03, 1);
  revolve(m, cuff.pts.map(([th, d]) => headAt(th, d)), { kind: MAT.knit, slot: SLOT.second, extra: -56 }, { segs: 112 });
  pompom(m, [0, headAt(0, dBody(0) + 0.065)[1], 0], 0.088, SLOT.second, 3);
}

/** A party hat: a cone of glossy printed card, striped, a pompom on its tip; smaller than it was (owner, 10-09: "even
 * the party hat is huge"). */
function partyHat(m: Mesh): void {
  const r0 = 0.2;
  const H = 0.5;
  const y0 = seatAt(r0) - 0.014;
  const p = new Profile(0, y0).line(r0 - 0.01, y0, 6).corner(r0, y0, 0, y0 + H, 0.008, 6).tip(y0 + H, 0.02, 10);
  revolve(m, p.pts, { kind: MAT.paper, slot: SLOT.main, extra: 6 }, { segs: 96 });
  pompom(m, [0, y0 + H + 0.032, 0], 0.072, SLOT.second, 5);
}

/** An antenna: a domed foot, a coiled spring, a slim steel stalk with a little bend, and a bead of his own light in a
 * collar. */
const antennaOn = (): { FOOT: V3; TOP: V3; BEAD: { at: V3; r: number } } => {
  const FOOT = standing(0.06, 0.32, 0); // where it stands on his head: on the front of his crown, near its middle (owner, 10-09:
  // "a tad better placement"), far enough forward that on a heart it stands below the dip between its lobes
  const TOP = add(FOOT, [0.05, 0.085 + 0.31, 0]);
  return { FOOT, TOP, BEAD: { at: add(TOP, [0.004, 0.076, 0]), r: 0.074 } };
};
function antenna(m: Mesh): void {
  const { FOOT, TOP: ANTENNA_TOP, BEAD } = antennaOn();
  const metal: Look = { kind: MAT.metal, slot: SLOT.main };
  const y0 = FOOT[1];
  revolve(m, new Profile(0, -0.035).line(0.058, -0.035, 2).corner(0.062, 0.0, 0, 0.024, 0.022, 8).line(0, 0.024, 3).pts, metal, { segs: 40, at: (q) => add(FOOT, q) });
  const c0 = y0 + 0.014;
  const c1 = y0 + 0.085;
  tube(m, (t) => add([FOOT[0], 0, FOOT[2]], [0.024 * Math.sin(TAU * 4.5 * t), mix(c0, c1, t), 0.024 * Math.cos(TAU * 4.5 * t)]), () => 0.0075, metal, { n: 120, k: 8 });
  tube(m, (t) => [FOOT[0], mix(c0 - 0.01, c1 + 0.01, t), FOOT[2]], () => 0.012, metal, { n: 4, k: 10 });
  const path = spline([[FOOT[0], c1 - 0.012, FOOT[2]], [FOOT[0] + 0.004, c1 + 0.09, FOOT[2]], [FOOT[0] + 0.018, c1 + 0.19, FOOT[2]], ANTENNA_TOP]);
  tube(m, path, (t) => mix(0.019, 0.015, t), metal, { n: 30, k: 10 });
  tube(m, (t) => add(ANTENNA_TOP, [0.024 * Math.sin(TAU * t), 0.004, 0.024 * Math.cos(TAU * t)]), () => 0.011, metal, { closed: true, n: 24, k: 8 });
  ellipsoid(m, BEAD.at, [BEAD.r, BEAD.r, BEAD.r], { kind: MAT.glow, slot: SLOT.second }, { nu: 32, nv: 20 });
}

/** A sprout: a green stem from his head and two leaves unfolding from its top, veined, glossy. */
function sprout(m: Mesh): void {
  const stem: Look = { kind: MAT.leaf, slot: SLOT.second };
  const leaf: Look = { kind: MAT.leaf, slot: SLOT.main, extra: 1 };
  const f = standing(-0.03, 0.36, -0.008); // on the front of his crown, centred (owner, 10-09: "sprout needs to be centered a bit more")
  const path = spline([f, add(f, [0.004, 0.09, -0.02]), add(f, [-0.008, 0.18, -0.03]), add(f, [0.0, 0.27, -0.032])]);
  tube(m, path, (t) => mix(0.026, 0.02, t), stem, { n: 24, k: 12 });
  ellipsoid(m, add(f, mul(headNormal(f), 0.006)), [0.046, 0.046, 0.03], stem, { R: facing(headNormal(f), [0, 1, 0]), nu: 20, nv: 12 });
  const top = path(1);
  blade(m, add(top, [-0.006, 0, 0]), [-0.85, 0.5, 0.2], [0.3, 0.9, 0.25], 0.24, 0.078, leaf, { shape: leafy, cup: 0.25, bend: -0.14, thick: 0.007 });
  blade(m, add(top, [0.006, 0, 0]), [0.88, 0.42, 0.22], [-0.25, 0.92, 0.28], 0.26, 0.084, leaf, { shape: leafy, cup: 0.25, bend: -0.12, thick: 0.007 });
}

/** A big satin bow, worn to one side: two full loops folded at the knot, the knot, two tails. */
function bigBow(m: Mesh): void {
  const c = onHead(0.46, 0.25, 0.055);
  bow(m, c, norm(add(headNormal(c), [0, 0.1, 0.55])), 0.2, { kind: MAT.satin, slot: SLOT.main });
}

/** A crown of polished gold: a band with a beaded foot and its stones set in bezels, eight points with a ball on
 * each. */
function crown(m: Mesh): void {
  const r0 = 0.252;
  const r1 = 0.276;
  const hb = 0.1;
  const hp = 0.15;
  const n = 8;
  const th = 0.016;
  const y0 = seatAt(r0) - 0.012;
  const pt = (phi: number): number => {
    const w = (phi * n) / TAU;
    return Math.min(1, (1 - Math.abs(2 * (w - Math.round(w)))) ** 1.4 * 1.06);
  };
  const rAt = (h: number): number => mix(r0, r1, h);
  const p = new Profile(rAt(0) - th, 0.04)
    .corner(rAt(0) - th, 0, rAt(0) + 0.004, 0, 0.005, 3)
    .corner(rAt(0) + 0.004, 0, rAt(0.1) + 0.004, 0.1, 0.005, 3)
    .fn(16, (t) => [rAt(mix(0.03, 0.94, t)) + 0.004, mix(0.03, 0.94, t)])
    .corner(rAt(1) + 0.004, 1, rAt(1) - th, 1, 0.006, 5)
    .corner(rAt(1) - th, 1, rAt(0.9) - th, 0.9, 0.006, 5)
    .fn(12, (t) => [rAt(mix(0.94, 0.04, t)) - th, mix(0.94, 0.04, t)]);
  revolve(m, p.pts, gold, { segs: n * 20, at: (q, phi) => [q[0], y0 + q[1] * (hb + hp * pt(phi)), q[2]] });
  for (let k = 0; k < n; k++) {
    const phi = (TAU * k) / n;
    ellipsoid(m, around(rAt(1) - th / 2 + 0.002, y0 + hb + hp + 0.018, phi), [0.024, 0.024, 0.024], gold, { nu: 18, nv: 12 });
    const big = k === 0;
    const r = big ? 0.04 : 0.024;
    const sx = big ? 1.3 : 1;
    const c = around(rAt(0.25) + 0.012, y0 + hb * 0.48, phi);
    const R = mm(rotY(phi), rotX(Math.PI / 2));
    gem(m, c, r, { kind: MAT.gem, slot: big || k % 2 === 0 ? SLOT.second : SLOT.white }, { R, sx, depth: 0.7 });
    tube(m, (t) => add(c, apply(R, [r * 1.12 * sx * Math.sin(TAU * t), -0.002, r * 1.12 * Math.cos(TAU * t)])), () => 0.0065, gold, { closed: true, n: 40, k: 8 });
  }
  tube(m, circle(r0 + 0.007, y0 + 0.009), (t) => 0.0085 * (0.6 + 0.4 * Math.abs(Math.cos(Math.PI * t * 48)) ** 0.6), gold, { closed: true, n: 288, k: 8 });
  tube(m, circle(rAt(0.45) + 0.007, y0 + hb), () => 0.0055, gold, { closed: true, n: 160, k: 8 });
}

/** Headphones: a padded band over his head on steel sliders, and a cup over each side of his head, its shell glossy,
 * a steel ring round it, a soft cushion against him. */
function headphones(m: Mesh): void {
  const shell: Look = { kind: MAT.plastic, slot: SLOT.main };
  const pad: Look = { kind: MAT.leather, slot: SLOT.second };
  tube(m, overHead(1.32, 0.03, 0), () => 0.04, pad, { n: 64, k: 16, flat: 0.62, up: [0, 0, 1] });
  for (const s of [-1, 1]) {
    tube(m, spline([onHead(s * 1.12, 0, 0.055), onHead(s * 1.35, 0, 0.06), onHead(s * 1.5, 0, 0.07)]), () => 0.016, steel, { n: 20, k: 10, flat: 0.6, up: [0, 0, 1] });
    const [side, cy] = headAt(1.493, 0.02); // over his side, a little above his widest
    const cx = s * side;
    const cup = (q: V3): V3 => add([cx, cy, 0], apply(rotZ((-s * Math.PI) / 2), q));
    const p = new Profile(0, 0.0).line(0.12, 0.0, 4).corner(0.135, 0.0, 0.135, 0.07, 0.02, 6).corner(0.13, 0.075, 0, 0.082, 0.035, 8).line(0, 0.082, 4);
    revolve(m, p.pts, shell, { segs: 64, at: (q) => cup(q) });
    tube(m, (t) => cup([0.137 * Math.sin(TAU * t), 0.004, 0.137 * Math.cos(TAU * t)]), () => 0.008, steel, { closed: true, n: 64, k: 8 });
    const c = new Profile(0, -0.002).line(0.13, -0.002, 4).curve(0.142, -0.03, 0.11, -0.045, 6).line(0, -0.04, 6);
    revolve(m, c.pts, pad, { segs: 64, at: (q) => cup(q), flip: true });
  }
}

/** A baseball cap in cotton twill: six panels with their seams and stitching, a button on top, and a peak with rows of
 * stitching, worn turned out to his right. */
function cap(m: Mesh): void {
  const dCap = (th: number): number => 0.03 + 0.022 * Math.cos(th) ** 2;
  const thB = 0.98;
  const [re, ye] = headAt(thB, dCap(thB));
  const crown = new Profile(re - 0.02, ye - 0.004).line(re, ye, 2).fn(40, (t) => headAt(thB * (1 - t), dCap(thB * (1 - t))));
  revolve(m, crown.pts, { kind: MAT.cotton, slot: SLOT.main, extra: 6 }, { segs: 132 });
  ellipsoid(m, [0, headAt(0, dCap(0) + 0.006)[1], 0], [0.036, 0.018, 0.036], { kind: MAT.cotton, slot: SLOT.main }, { nu: 24, nv: 12 });
  peak(m, re, ye, 0.3, 0.95, 0.62, { kind: MAT.cotton, slot: SLOT.second, extra: 2 });
}

/** A wizard's hat in midnight felt: a tall cone that bends over at its top, soft folds round it, printed with gold
 * stars, on a wide floppy brim with a gold band. */
function wizardHat(m: Mesh): void {
  const r0 = 0.25;
  const H = 0.74;
  const rB = 0.5;
  const y0 = seatAt(r0) - 0.012;
  const yb = y0 + 0.012;
  revolve(m, slab(0.18, rB, y0, 0.016), felt(10), {
    segs: 128,
    at: (q, phi) => {
      const r = Math.hypot(q[0], q[2]);
      const t = clamp((r - r0) / (rB - r0));
      return [q[0], q[1] + t * t * (0.028 * Math.sin(2 * phi + 0.6) - 0.035), q[2]];
    },
  });
  const cone = new Profile(r0, yb).line(r0 * 0.5, yb + H * 0.5, 20).tip(yb + H, 0.02, 8);
  revolve(m, cone.pts, felt(10), {
    segs: 112,
    at: (q, phi) => {
      const t = clamp((q[1] - yb) / H);
      const fold = 1 - 0.035 * Math.exp(-(((t - 0.36) / 0.035) ** 2)) * (1 + 0.6 * Math.sin(phi)) - 0.03 * Math.exp(-(((t - 0.6) / 0.03) ** 2));
      return [q[0] * fold + 0.2 * t ** 2.6, q[1] - 0.06 * t ** 3, q[2] * fold - 0.05 * t ** 3];
    },
  });
  band(m, (y) => mix(r0, r0 * 0.5, (y - yb) / (H * 0.5)), yb + 0.004, yb + 0.06, gold2, 0.006, 112);
}

/** A halo: a ring of his own light, floating over his head, tipped toward you. */
const HALO = { y: 0.26, R: 0.3, r: 0.024, tilt: 0.25 };
function halo(m: Mesh): void {
  tube(m, (t) => add([0, HALO.y, 0], apply(rotX(HALO.tilt), [HALO.R * Math.sin(TAU * t), 0, HALO.R * Math.cos(TAU * t)])), () => HALO.r, { kind: MAT.glow, slot: SLOT.main }, { closed: true, n: 96, k: 14 });
}

/** A flower tucked over his ear: five velvet petals cupped round a pollen centre, two leaves behind. */
function flower(m: Mesh): void {
  const c = onHead(0.5, 0.3, 0.045);
  const out = norm(add(headNormal(c), [0, 0.15, 0.55]));
  const B = facing(out);
  const petal: Look = { kind: MAT.petal, slot: SLOT.main };
  for (let k = 0; k < 5; k++) {
    const a = (k * TAU) / 5 + 0.3;
    const d = norm(add(apply(B, [Math.cos(a), Math.sin(a), 0]), mul(out, 0.28)));
    blade(m, add(c, mul(d, 0.016)), d, out, 0.15, 0.072, petal, { shape: outline(0.55, 0.2), cup: 0.3, bend: 0.1, thick: 0.008 });
  }
  ellipsoid(m, add(c, mul(out, 0.016)), [0.046, 0.046, 0.026], { kind: MAT.fur, slot: SLOT.second }, { R: B, nu: 24, nv: 14, bump: fluff(7, 0.5) });
  for (const a of [-2.3, -0.9]) {
    const d = norm(add(apply(B, [Math.cos(a), Math.sin(a), 0]), mul(out, -0.1)));
    blade(m, add(c, mul(out, -0.014)), d, out, 0.17, 0.046, greenery, { shape: leafy, cup: 0.3, bend: -0.05, thick: 0.007 });
  }
}

/** Horns: two small curved horns, ringed at their feet, polished to a point. */
function horns(m: Mesh): void {
  for (const s of [-1, 1]) {
    const base = onHead(s * 0.42, 0.12, -0.012);
    const path = spline([base, add(base, [s * 0.035, 0.09, 0.012]), add(base, [s * 0.1, 0.17, 0.004]), add(base, [s * 0.135, 0.245, -0.018])]);
    tube(m, path, (t) => 0.063 * (1 - t) ** 0.85 + 0.004, { kind: MAT.horn, slot: SLOT.main }, { n: 40, k: 20 });
  }
}

/** Bunny ears on a headband: plush outer ears, their insides in his second colour, one a little bent. */
function bunnyEars(m: Mesh): void {
  // the band a little forward of his top, ear to ear, its ends tucked under his head (owner, 10-10: they ended in the air
  // past his sides), the ears standing on it
  tube(m, tucked(1.32, 0.012, 0.2), () => 0.024, { kind: MAT.plastic, slot: SLOT.main }, { n: 72, k: 12, flat: 0.4, up: [0, 0, 1] });
  for (const s of [-1, 1]) {
    const base = onHead(s * 0.34, 0.2, 0.0);
    const d = norm([s * 0.3, 1, -0.16]);
    const face: V3 = [0, 0.05, 1];
    const shape = (t: number): number => Math.sin(Math.PI * t) ** 0.55 * (0.8 + 0.2 * t);
    const bend = s > 0 ? -0.12 : -0.04;
    blade(m, base, d, face, 0.44, 0.085, { kind: MAT.fur, slot: SLOT.main, extra: 1 }, { shape, thick: 0.034, cup: 0.18, bend });
    const F = norm(cross(d, norm(cross(face, d))));
    blade(m, add(add(base, mul(d, 0.07)), mul(F, 0.022)), d, face, 0.31, 0.046, { kind: MAT.petal, slot: SLOT.second }, { shape, thick: 0.01, cup: 0.25, bend: bend * 1.4 });
  }
}

/** A chef's toque: a pleated band and the puffed top over it, in starched cotton. */
function chefHat(m: Mesh): void {
  const rb = 0.245;
  const hb = 0.12;
  const y0 = seatAt(rb) - 0.012;
  const cot: Look = { kind: MAT.cotton, slot: SLOT.main };
  const bandP = new Profile(rb - 0.012, y0).line(rb, y0, 1).fn(10, (t) => [rb, y0 + t * hb]).line(rb - 0.012, y0 + hb, 1);
  revolve(m, bandP.pts, cot, {
    segs: 192,
    at: (q, phi) => {
      const k = 1 + 0.02 * Math.abs(Math.sin(phi * 12)) ** 0.5; // its pleats
      return [q[0] * k, q[1], q[2] * k];
    },
  });
  const top = y0 + hb;
  const puff = new Profile(rb - 0.015, top - 0.01).cubic([0.34, top], [0.35, top + 0.14], 0.29, top + 0.21).cubic([0.24, top + 0.27], [0.12, top + 0.27], 0, top + 0.255, 16);
  revolve(m, puff.pts, cot, {
    segs: 168,
    at: (q, phi) => {
      const r = Math.hypot(q[0], q[2]);
      const lobe = Math.cos(7 * phi);
      const k = 1 + 0.06 * lobe * clamp((q[1] - top) / 0.1);
      const dip = 0.022 * (1 - lobe) * 0.5 * clamp(r / 0.3) * clamp((q[1] - top - 0.15) / 0.08);
      return [q[0] * k, q[1] - dip, q[2] * k];
    },
  });
}

/** A mortarboard: a skullcap, the square board on it turned corner-on, a gold button, the tassel's cord over the edge
 * and the tassel hanging. */
function gradCap(m: Mesh): void {
  const r0 = 0.27;
  const y0 = seatAt(r0) - 0.01;
  const yt = 0.055;
  const cap = new Profile(r0 - 0.01, y0).line(r0, y0, 1).fn(6, (t) => [r0, mix(y0, yt - 0.02, t)]).corner(r0, yt, 0, yt, 0.018, 6).line(0, yt, 4);
  revolve(m, cap.pts, felt(1), { segs: 96 });
  const board: Look = { kind: MAT.felt, slot: SLOT.main, extra: 1 };
  const yb = yt + 0.012;
  const corners = (y: number): V3[] => [0, 1, 2, 3].map((k) => around(0.42, y, (k * Math.PI) / 2));
  const top = corners(yb + 0.012);
  const bot = corners(yb - 0.012);
  const mid: V3 = [0, yb, 0];
  facet(m, [top[0]!, top[1]!, top[2]!], mid, board);
  facet(m, [top[0]!, top[2]!, top[3]!], mid, board);
  facet(m, [bot[0]!, bot[2]!, bot[1]!], mid, board);
  facet(m, [bot[0]!, bot[3]!, bot[2]!], mid, board);
  for (let k = 0; k < 4; k++) {
    const j = (k + 1) % 4;
    facet(m, [top[k]!, bot[k]!, bot[j]!], mid, board);
    facet(m, [top[k]!, bot[j]!, top[j]!], mid, board);
  }
  ellipsoid(m, [0, yb + 0.02, 0], [0.028, 0.012, 0.028], gold2, { nu: 20, nv: 10 });
  const cord = spline([[0, yb + 0.022, 0], [0.18, yb + 0.022, 0.01], [0.36, yb + 0.018, 0.01], [0.425, yb + 0.004, 0.01], [0.43, yb - 0.06, 0.012], [0.43, yb - 0.11, 0.012]]);
  tube(m, cord, () => 0.0075, gold2, { n: 48, k: 8 });
  tassel(m, cord(1));
}

/** A tassel hanging from `end`: its knot, then a skirt of threads flaring as it falls. */
function tassel(m: Mesh, end: V3): void {
  ellipsoid(m, end, [0.017, 0.019, 0.017], gold2, { nu: 14, nv: 10 });
  revolve(m, new Profile(0, -0.002).line(0.012, -0.002, 1).line(0.026, -0.095, 10).line(0, -0.095, 3).pts, { kind: MAT.cotton, slot: SLOT.second, extra: 7 }, {
    segs: 48,
    at: (q) => add(end, q),
    flip: true,
  });
}

/** A cowboy hat in felt: a pinched crown with its crease, a brim swept up at the sides, a leather band with a silver
 * concho. */
function cowboyHat(m: Mesh): void {
  const r0 = 0.25;
  const rB = 0.52;
  const y0 = seatAt(r0) - 0.012;
  const H = 0.25;
  const yb = y0 + 0.015;
  const side = (phi: number): number => Math.sin(phi) ** 2;
  revolve(m, slab(0.2, rB, y0, 0.018), felt(), {
    segs: 144,
    at: (q, phi) => {
      const r = Math.hypot(q[0], q[2]);
      const t = clamp((r - r0) / (rB - r0));
      return [q[0], q[1] + 0.17 * side(phi) * t ** 1.8 - 0.035 * (1 - side(phi)) * t, q[2]];
    },
  });
  const wall = (y: number): number => r0 - 0.03 * clamp((y - yb) / H);
  const shape = (q: V3, phi: number): V3 => {
    const t = clamp((q[1] - yb) / H);
    const pinch = 1 - 0.13 * t ** 2 * (Math.exp(-(((phi - 0.5) / 0.32) ** 2)) + Math.exp(-(((phi + 0.5) / 0.32) ** 2)) + Math.exp(-(((phi - TAU + 0.5) / 0.32) ** 2)));
    const crease = 0.055 * Math.exp(-((q[0] / 0.07) ** 2)) * clamp((t - 0.7) / 0.25);
    return [q[0] * pinch, q[1] - crease, q[2] * pinch * 1.08];
  };
  const crown = new Profile(r0 - 0.01, yb).line(r0, yb, 1).fn(12, (t) => [wall(yb + t * (H - 0.05)), yb + t * (H - 0.05)]).corner(wall(yb + H), yb + H, 0, yb + H, 0.06, 10).line(0, yb + H, 6);
  revolve(m, crown.pts, felt(), { segs: 112, at: shape });
  band(m, wall, yb + 0.003, yb + 0.05, { kind: MAT.leather, slot: SLOT.second }, 0.006, 112, shape);
  const cp = -1.15;
  ellipsoid(m, shape(around(wall(yb + 0.026) + 0.016, yb + 0.026, cp), cp), [0.026, 0.026, 0.012], steel, { R: rotY(cp), nu: 20, nv: 12 });
}

/** A propeller cap: a dome of six panels in two colours, a steel stalk and hub, two twisted blades that turn (lazily,
 * and fast while he thinks). */
function propeller(m: Mesh): void {
  const d = (th: number): number => 0.022 + 0.01 * Math.cos(th) ** 2;
  const thB = 0.95;
  const dome = new Profile(...headAt(thB, 0.01)).line(...headAt(thB, d(thB)), 1).fn(40, (t) => headAt(thB * (1 - t), d(thB * (1 - t))));
  revolve(m, dome.pts, { kind: MAT.cotton, slot: SLOT.main, extra: -6 }, { segs: 132 });
  const top = headAt(0, d(0))[1];
  tube(m, (t) => [0, top - 0.01 + 0.07 * t, 0], () => 0.011, steel, { n: 6, k: 10 });
  const hub: V3 = [0, top + 0.075, 0];
  ellipsoid(m, hub, [0.024, 0.02, 0.024], steel, { nu: 18, nv: 10 });
  for (const s of [-1, 1]) {
    blade(m, add(hub, [s * 0.012, 0, 0]), [s, 0, 0], [0, 1, 0], 0.2, 0.042, { kind: MAT.plastic, slot: SLOT.main, spin: true }, { shape: outline(0.6, 0.35), thick: 0.007, twist: s * 0.5, nu: 14, nv: 18 });
  }
}

/** A star clip: a five-pointed star cut like a gem, in gold, clipped to one side of his head. */
function starClip(m: Mesh): void {
  const c = onHead(0.5, 0.32, 0.04);
  star(m, c, 0.17, 0.072, 0.055, gold, facing(norm(add(headNormal(c), [0, 0.1, 0.6])), [0.2, 1, 0]));
}

/** A beret in wool felt: its band gripping his head, its soft crown full and domed over it and slumping off to one
 * side, its little stalk on top. */
function beret(m: Mesh): void {
  const [rb, yb] = headAt(0.74, 0.012);
  const v = Math.max(1, (headAt(0)[1] + 0.022 - yb) / 0.215); // as tall as clears his head's top (a drop's point too)
  const p = new Profile(rb - 0.012, yb)
    .line(rb + 0.004, yb, 1)
    .cubic([rb + 0.07, yb + 0.004 * v], [rb + 0.12, yb + 0.03 * v], rb + 0.125, yb + 0.07 * v)
    .cubic([rb + 0.13, yb + 0.115 * v], [rb + 0.06, yb + 0.15 * v], rb - 0.06, yb + 0.175 * v)
    .cubic([0.2, yb + 0.205 * v], [0.08, yb + 0.215 * v], 0, yb + 0.215 * v, 12);
  // the slump: the crown sinks and slides toward his right, more the further out it is
  const slump = (q: V3): V3 => {
    const r = Math.hypot(q[0], q[2]);
    const up = clamp((q[1] - yb) / 0.06);
    const side = 0.5 + 0.5 * Math.tanh(q[0] / 0.25);
    const k = up * (r / (rb + 0.125)) ** 2;
    return [q[0] + 0.035 * k * side, q[1] - 0.1 * k * side + 0.03 * k * (1 - side), q[2]];
  };
  revolve(m, p.pts, felt(), { segs: 144, at: (q) => slump(q) });
  headBand(m, 0.7, 0.78, 0.018, { kind: MAT.felt, slot: SLOT.main }, 144);
  const top = slump([0, yb + 0.215 * v, 0]);
  tube(m, (t) => add(top, [0.006 * t, -0.004 + 0.04 * t, 0]), (t) => mix(0.012, 0.009, t), { kind: MAT.felt, slot: SLOT.second }, { n: 6, k: 10 });
}

/** A hard hat in glossy plastic: one moulded shell standing off his head on its harness, three ribs running over it
 * front to back, a brim all round that runs out into a peak. Made over his head (a helmet covers it), so on a wide
 * head it is as wide. */
function hardHat(m: Mesh): void {
  const dS = (t: number): number => 0.038 + 0.062 * (1 - smooth(0.3, 0.92, t)); // the shell's stand-off: the harness's room on top
  const thR = 0.92;
  const [re, ye] = headAt(thR, dS(thR));
  const rim = 0.055;
  const th = 0.017;
  const y0 = ye - 0.03 - th;
  const top = headAt(0, dS(0))[1];
  const p = new Profile(re - 0.03, y0 - th)
    .line(re + rim - th, y0 - th, 4)
    .arc(re + rim - th, y0, Math.PI / 2, 8)
    .line(re + 0.012, y0 + th, 3)
    .curve(re, y0 + th, re - 0.001, ye, 5)
    .fn(48, (t) => headAt(thR * (1 - t), dS(thR * (1 - t))));
  const rib = (x: number): number => 0.02 * Math.exp(-((x / 0.036) ** 2)) + 0.013 * (Math.exp(-(((x - 0.18) / 0.028) ** 2)) + Math.exp(-(((x + 0.18) / 0.028) ** 2)));
  revolve(m, p.pts, { kind: MAT.plastic, slot: SLOT.main }, {
    segs: 240,
    at: (q, phi) => {
      const r = Math.hypot(q[0], q[2]);
      if (r > re + 0.001 && q[1] < ye) {
        const f = Math.max(0, Math.cos(phi)) ** 2;
        const r2 = re + (r - re) * (1 + 1.7 * f);
        return around(r2, q[1] - 0.03 * f * ((r - re) / rim), phi);
      }
      // the ribs, moulded in, fading into the brim and into the crown's top
      const up = (q[1] - ye) / (top - ye);
      const k = rib(q[0]) * clamp((up - 0.06) / 0.3) * (1 - 0.6 * clamp((up - 0.93) / 0.07));
      return add(q, mul(headNormal(q), k));
    },
  });
}

/** A bucket hat in cotton: a soft crown of four panels, a band, and a brim sloping down and out, its rows of stitching
 * round it, steel eyelets in its sides. */
function bucketHat(m: Mesh): void {
  const r0 = 0.32;
  const y0 = seatAt(r0) - 0.01;
  const H = 0.23;
  const wall = (y: number): number => r0 - 0.022 * clamp((y - y0) / H);
  const crown = new Profile(r0 - 0.01, y0).line(r0, y0, 1).fn(10, (t) => [wall(y0 + t * (H - 0.06)), y0 + t * (H - 0.06)]).corner(wall(y0 + H), y0 + H, 0, y0 + H + 0.01, 0.06, 10).line(0, y0 + H + 0.01, 6);
  revolve(m, crown.pts, { kind: MAT.cotton, slot: SLOT.main, extra: 4 }, { segs: 96 });
  const a = 0.48; // the brim's slope
  revolve(m, slab(0, 0.17, 0, 0.018), { kind: MAT.cotton, slot: SLOT.main, extra: 5 }, {
    segs: 96,
    at: (q, phi) => {
      const s = Math.hypot(q[0], q[2]);
      return around(r0 - 0.008 + s * Math.cos(a), y0 + 0.006 - s * Math.sin(a) + q[1], phi);
    },
  });
  band(m, wall, y0 + 0.004, y0 + 0.05, { kind: MAT.cotton, slot: SLOT.second }, 0.005, 96);
  for (const phi of [Math.PI / 2 - 0.22, Math.PI / 2 + 0.22, -Math.PI / 2 - 0.22, -Math.PI / 2 + 0.22]) {
    const c = around(wall(y0 + 0.13) + 0.002, y0 + 0.13, phi);
    const R = mm(rotY(phi), rotX(Math.PI / 2));
    tube(m, (t) => add(c, apply(R, [0.011 * Math.sin(TAU * t), 0, 0.011 * Math.cos(TAU * t)])), () => 0.004, steel, { closed: true, n: 20, k: 6 });
  }
}

/** An accountant's eyeshade: a band round his head and a visor of tinted, see-through celluloid over his brow, bound
 * at its edge. */
function eyeshade(m: Mesh): void {
  headBand(m, 0.86, 0.96, 0.014, { kind: MAT.rubber, slot: SLOT.second }, 120, true);
  const [re, ye] = headAt(0.96, 0.014);
  const L = 0.27;
  const w = 1.1;
  const pts = new Profile(re - 0.02, ye - 0.004).line(re + L, ye - 0.004, 12).line(re + L, ye + 0.004, 1).line(re - 0.02, ye + 0.004, 12).pts;
  const place = (q: V3, phi: number): V3 => {
    const u = phi / w;
    const r = Math.hypot(q[0], q[2]);
    const ext = Math.max(0, r - re) * (1 - 0.38 * u * u);
    const k = 0.62; // it slopes down over his eyes
    return around(Math.min(r, re) + ext * Math.cos(k), q[1] - ext * Math.sin(k), phi);
  };
  revolve(m, pts, { kind: MAT.glass, slot: SLOT.main, extra: 0.57 }, { segs: 64, from: -w - Math.PI, to: w - Math.PI, at: place });
  tube(m, (t) => place([0, ye, re + L], mix(-w, w, t)), () => 0.006, { kind: MAT.rubber, slot: SLOT.second }, { n: 64, k: 8 });
}

/** A headset: a slim band over his head, one cup on his left, a boom mic curving round toward the front, its foam in
 * his second colour. */
function headset(m: Mesh): void {
  const shell: Look = { kind: MAT.plastic, slot: SLOT.main };
  tube(m, overHead(1.36, 0.04, 0), () => 0.026, shell, { n: 60, k: 12, flat: 0.75, up: [0, 0, 1] });
  const [side, cy] = headAt(1.506, 0.015);
  const cx = -side;
  const cup = (q: V3): V3 => add([cx, cy, 0], apply(rotZ(Math.PI / 2), q));
  const p = new Profile(0, 0).line(0.09, 0, 3).corner(0.1, 0, 0.1, 0.05, 0.016, 6).corner(0.095, 0.058, 0, 0.064, 0.025, 8).line(0, 0.064, 3);
  revolve(m, p.pts, shell, { segs: 56, at: cup });
  revolve(m, new Profile(0, -0.002).line(0.096, -0.002, 3).curve(0.104, -0.026, 0.08, -0.034, 6).line(0, -0.03, 4).pts, { kind: MAT.leather, slot: SLOT.main }, { segs: 56, at: cup, flip: true });
  // the boom round in front of his face, as far off it as it is off the bean's
  const boom = spline([[cx + 0.02, cy - 0.04, 0.06], fromBean([-0.6, -0.74, 0.25]), fromBean([-0.5, -0.88, 0.38]), fromBean([-0.3, -0.95, 0.47])]);
  tube(m, boom, (t) => mix(0.017, 0.014, t), shell, { n: 40, k: 10 });
  ellipsoid(m, add(boom(1), [0.028, -0.004, 0.006]), [0.04, 0.026, 0.028], { kind: MAT.fur, slot: SLOT.second }, { R: rotZ(-0.25), nu: 28, nv: 16, bump: fluff(11, 0.25) });
}

/** A terry sweatband round his forehead, a stripe through its middle. */
function sweatband(m: Mesh): void {
  headBand(m, 0.78, 1.0, 0.038, { kind: MAT.cotton, slot: SLOT.main, extra: 3 }, 120, true);
  headBand(m, 0.87, 0.91, 0.042, { kind: MAT.cotton, slot: SLOT.second, extra: 3 }, 120, true);
}

/** An apple sat on his head: a glossy, lightly streaked apple with its five soft lobes, a woody stem and a leaf. */
function apple(m: Mesh): void {
  const k0 = m.count;
  const y0 = 0.006;
  const p = new Profile(0, y0 + 0.016)
    .curve(0.05, y0 - 0.006, 0.1, y0 + 0.015, 6)
    .cubic([0.16, y0 + 0.05], [0.172, y0 + 0.16], 0.14, y0 + 0.235)
    .curve(0.11, y0 + 0.282, 0.05, y0 + 0.268, 8)
    .curve(0.015, y0 + 0.26, 0, y0 + 0.24, 6);
  revolve(m, p.pts, { kind: MAT.fruit, slot: SLOT.main }, {
    segs: 96,
    at: (q, phi) => {
      const k = 1 + 0.03 * Math.cos(5 * phi) * clamp((q[1] - y0) / 0.25);
      return [q[0] * k, q[1], q[2] * k];
    },
  });
  const stem = spline([[0, y0 + 0.235, 0], [0.004, y0 + 0.28, 0], [0.018, y0 + 0.32, 0.004], [0.034, y0 + 0.345, 0.006]]);
  tube(m, stem, (t) => mix(0.016, 0.013, t), { kind: MAT.wood, slot: SLOT.wood }, { n: 16, k: 10 });
  blade(m, stem(0.45), [0.85, 0.32, 0.3], [-0.25, 0.9, 0.25], 0.12, 0.042, { kind: MAT.leaf, slot: SLOT.second, extra: 1 }, { shape: leafy, cup: 0.3, bend: -0.1, thick: 0.006 });
  grow(m, k0, 1.3, [0, 0.0, 0]);
  const lift = seatAt(0.12) - 0.0066; // where his head is as wide as the apple's foot, against the bean's
  for (let v = k0; v < m.count; v++) {
    m.pos[v * 3 + 1] = m.pos[v * 3 + 1]! - 0.03 + lift;
    m.pos[v * 3 + 2] = m.pos[v * 3 + 2]! + 0.05;
  }
}

/** A straw hat: a plaited straw brim with a slight droop, a low crown, a ribbon band tied in a bow. */
function strawHat(m: Mesh): void {
  const rc = 0.27;
  const rOut = 0.58;
  const H = 0.17;
  const th = 0.02;
  const y0 = seatAt(rc) - 0.01;
  const yb = y0 + th + 0.03;
  const yt = y0 + H;
  const wall = (y: number): number => rc - 0.014 * clamp((y - yb) / (yt - yb));
  const p = new Profile(0, y0)
    .line(rOut - th / 2, y0, 18)
    .arc(rOut - th / 2, y0 + th / 2, Math.PI / 2, 8)
    .line(rc + 0.03, y0 + th, 12)
    .curve(rc, y0 + th, rc, yb, 5)
    .fn(10, (t) => [wall(mix(yb, yt - 0.035, t)), mix(yb, yt - 0.035, t)])
    .corner(wall(yt), yt, 0, yt + 0.014, 0.034, 8)
    .line(0, yt + 0.014, 8);
  revolve(m, p.pts, { kind: MAT.straw, slot: SLOT.main, extra: 150 }, {
    segs: 100,
    at: (q, phi) => {
      const r = Math.hypot(q[0], q[2]);
      if (r <= rc + 0.03) return q;
      const t = (r - rc - 0.03) / (rOut - rc - 0.03);
      return [q[0], q[1] - t * t * (0.042 - 0.008 * Math.sin(3 * phi + 0.7)), q[2]];
    },
  });
  const b0 = yb;
  const b1 = yb + 0.055;
  band(m, wall, b0, b1, satin2, 0.006, 96);
  const phi = 1.05;
  const y = (b0 + b1) / 2;
  bow(m, around(wall(y) + 0.012, y, phi), around(1, 0, phi), 0.04, satin2);
}

/** A fedora in felt: a teardrop crown with its centre dent and front pinches, a brim snapped down in front and up
 * behind, a grosgrain band with a flat bow. */
function fedora(m: Mesh): void {
  const r0 = 0.245;
  const rB = 0.43;
  const y0 = seatAt(r0) - 0.012;
  const H = 0.23;
  const yb = y0 + 0.014;
  revolve(m, slab(0.2, rB, y0, 0.016), felt(), {
    segs: 144,
    at: (q, phi) => {
      const r = Math.hypot(q[0], q[2]);
      const t = clamp((r - r0) / (rB - r0));
      const front = Math.max(0, Math.cos(phi)) ** 2;
      const back = Math.max(0, -Math.cos(phi)) ** 2;
      return [q[0], q[1] - 0.05 * front * t + 0.05 * back * t ** 1.5 + 0.02 * Math.sin(phi) ** 2 * t, q[2]];
    },
  });
  const wall = (y: number): number => r0 - 0.03 * clamp((y - yb) / H);
  const shape = (q: V3, phi: number): V3 => {
    const t = clamp((q[1] - yb) / H);
    const narrow = 1 - 0.07 * Math.max(0, Math.cos(phi)) * t;
    const pinch = 1 - 0.12 * t ** 2 * (Math.exp(-(((phi - 0.55) / 0.3) ** 2)) + Math.exp(-(((phi + 0.55) / 0.3) ** 2)) + Math.exp(-(((phi - TAU + 0.55) / 0.3) ** 2)));
    const dent = 0.05 * Math.exp(-((q[0] / 0.075) ** 2)) * clamp((t - 0.72) / 0.22);
    return [q[0] * narrow * pinch, q[1] - dent, q[2] * pinch * 1.06];
  };
  const crown = new Profile(r0 - 0.01, yb).line(r0, yb, 1).fn(12, (t) => [wall(yb + t * (H - 0.05)), yb + t * (H - 0.05)]).corner(wall(yb + H), yb + H, 0, yb + H, 0.055, 10).line(0, yb + H, 6);
  revolve(m, crown.pts, felt(), { segs: 112, at: shape });
  band(m, wall, yb + 0.003, yb + 0.058, satin2, 0.006, 112, shape);
  const phi = -1.2;
  const y = yb + 0.03;
  const at = shape(around(wall(y) + 0.012, y, phi), phi);
  blade(m, at, around(1, 0.15, phi - 0.6), around(1, 0, phi), 0.05, 0.022, satin2, { shape: (t) => 1 - t ** 8, thick: 0.004 });
  blade(m, at, around(1, -0.1, phi + 0.6), around(1, 0, phi), 0.046, 0.02, satin2, { shape: (t) => 1 - t ** 8, thick: 0.004 });
}

/** A deerstalker in checked tweed: a cap of six panels, a peak before and behind, ear flaps down at his sides, a bow
 * on top. */
function deerstalker(m: Mesh): void {
  const tw: Look = { kind: MAT.tweed, slot: SLOT.main };
  const d = 0.042;
  const thB = 0.98;
  const [re, ye] = headAt(thB, d);
  const crown = new Profile(re - 0.02, ye - 0.004).line(re, ye, 2).fn(40, (t) => headAt(thB * (1 - t), d + 0.012 * Math.cos(thB * (1 - t)) ** 2));
  revolve(m, crown.pts, tw, { segs: 132 });
  peak(m, re, ye, 0.14, 0.78, 0, tw, 0.011, 0.25);
  peak(m, re, ye, 0.13, 0.78, Math.PI, tw, 0.011, 0.25);
  const yAt = (th: number): number => headAt(th)[1];
  for (const s of [-1, 1]) {
    const phc = (s * Math.PI) / 2;
    const p = new Profile(1.26, -0.012).corner(1.26, 0.012, 0.84, 0.012, 0.01, 4).corner(0.84, 0.012, 0.84, -0.012, 0.01, 4).line(0.84, -0.008, 1);
    revolve(m, p.pts.map(([th, dd]) => headAt(th, d + dd)), tw, {
      segs: 40,
      from: phc - 0.45 - Math.PI,
      to: phc + 0.45 - Math.PI,
      at: (q, phi) => {
        const lower = clamp((yAt(1.0) - q[1]) / (yAt(1.0) - yAt(1.26)));
        return around(Math.hypot(q[0], q[2]), q[1], phc + (phi - phc) * Math.sqrt(Math.max(0.02, 1 - lower * lower)));
      },
    });
  }
  bow(m, [0, headAt(0, d + 0.017)[1], 0.01], [0, 1, 0.35], 0.03, { kind: MAT.satin, slot: SLOT.second });
}

/** A sun visor: a band round his head and a wide peak with its edge piped in his second colour, no crown. */
function sunVisor(m: Mesh): void {
  headBand(m, 0.74, 0.9, 0.016, { kind: MAT.cotton, slot: SLOT.main }, 120, true);
  const [re, ye] = headAt(0.9, 0.016);
  const L = 0.3;
  const w = 1.15;
  const droop = 0.12;
  peak(m, re, ye, L, w, 0, { kind: MAT.plastic, slot: SLOT.main }, 0.011, droop);
  tube(
    m,
    (t) => {
      const phi = mix(-w * 0.999, w * 0.999, t);
      const u = phi / w;
      const sh = Math.sqrt(Math.max(0, 1 - u * u));
      return around(re + L * sh, ye - droop * L * sh - 0.05 * u * u, phi);
    },
    () => 0.0085,
    { kind: MAT.plastic, slot: SLOT.second },
    { n: 72, k: 8 },
  );
}

/** A crown of flowers round his head on a green vine: small flowers, their petals in his colour, gold centres, leaves
 * between, round his front and sides. */
function flowerCrown(m: Mesh): void {
  const [rv, yv] = headAt(0.62, 0.016);
  // the vine's back, round a flat head, lies on it; the flowers go round his front and sides, where they are seen (round
  // behind him, their petals stood up over a flat head's top with nothing under them)
  tube(m, (t) => rest(around(rv, yv, TAU * t), BAND_REST), () => 0.009, greenery, { closed: true, n: 120, k: 8 });
  const petal: Look = { kind: MAT.petal, slot: SLOT.main };
  [-1.7, -1.13, -0.56, 0, 0.56, 1.13, 1.7].forEach((phi, i) => {
    const sz = i % 2 ? 0.8 : 1;
    const c = around(rv + 0.012, yv + 0.006, phi);
    const out = norm(add(around(1, 0, phi), [0, 0.75, 0]));
    const B = facing(out);
    for (let k = 0; k < 5; k++) {
      const a = (k * TAU) / 5 + i;
      const d = norm(add(apply(B, [Math.cos(a), Math.sin(a), 0]), mul(out, 0.3)));
      blade(m, add(c, mul(d, 0.008 * sz)), d, out, 0.058 * sz, 0.03 * sz, petal, { shape: outline(0.55, 0.2), cup: 0.3, bend: 0.1, thick: 0.005, nu: 12, nv: 14 });
    }
    ellipsoid(m, add(c, mul(out, 0.008)), [0.018 * sz, 0.018 * sz, 0.011 * sz], { kind: MAT.fur, slot: SLOT.second }, { R: B, nu: 16, nv: 10, bump: fluff(i, 0.5) });
    const lp = phi + 0.28;
    blade(m, around(rv + 0.004, yv, lp), around(1, 0.3, lp + 1.3), norm(add(around(1, 0, lp), [0, 0.6, 0])), 0.06, 0.018, greenery, { shape: leafy, cup: 0.3, thick: 0.004, nu: 10, nv: 12 });
  });
}

/** A viking's helmet in hammered steel: a dome with a riveted rim and a riveted strip over its top, and two curved
 * horns of ivory. */
function vikingHelmet(m: Mesh): void {
  const met: Look = { kind: MAT.metal, slot: SLOT.main };
  const d = 0.03;
  const thB = 0.98;
  const [re, ye] = headAt(thB, d);
  revolve(m, new Profile(re - 0.02, ye - 0.004).line(re, ye, 2).fn(40, (t) => headAt(thB * (1 - t), d)).pts, met, { segs: 132 });
  headBand(m, 0.86, thB + 0.02, d + 0.018, met, 132);
  const strip = (t: number): V3 => {
    const th = mix(-0.92, 0.92, t);
    const [r, y] = headAt(Math.abs(th), d + 0.012);
    return [0, y, th >= 0 ? r : -r];
  };
  tube(m, strip, () => 0.026, met, { n: 60, k: 12, flat: 0.4, up: [1, 0, 0] });
  const rivet = (p: V3): void => ellipsoid(m, p, [0.011, 0.011, 0.011], met, { nu: 12, nv: 8 });
  for (let k = 0; k < 16; k++) {
    const [r, y] = headAt(0.92, d + 0.018);
    rivet(around(r, y, (k * TAU) / 16));
  }
  for (const t of [0.12, 0.3, 0.5, 0.7, 0.88]) {
    const p = strip(t);
    rivet(add(p, mul(headNormal(p), 0.008)));
  }
  for (const s of [-1, 1]) {
    const base = onHead(s * 0.95, 0.12, d);
    const path = spline([base, add(base, [s * 0.08, 0.04, 0.01]), add(base, [s * 0.16, 0.13, 0.01]), add(base, [s * 0.17, 0.25, -0.02])]);
    tube(m, path, (t) => 0.056 * (1 - t) ** 0.8 + 0.004, { kind: MAT.horn, slot: SLOT.second }, { n: 40, k: 18 });
  }
}

/** A bowler in felt: a round crown, a short brim curled up at the sides, a ribbon band with a small bow. */
function bowler(m: Mesh): void {
  const r0 = 0.29;
  const rB = 0.42;
  const y0 = seatAt(r0) - 0.012;
  const yb = y0 + 0.014;
  revolve(m, slab(0.2, rB, y0, 0.016), felt(), {
    segs: 128,
    at: (q, phi) => {
      const r = Math.hypot(q[0], q[2]);
      const t = clamp((r - r0) / (rB - r0));
      return [q[0], q[1] + 0.055 * Math.sin(phi) ** 2 * t * t - 0.012 * Math.cos(phi) ** 2 * t, q[2]];
    },
  });
  const H = 0.24;
  const crown = new Profile(r0 - 0.01, yb).line(r0, yb, 1).fn(24, (t) => {
    const a = (t * Math.PI) / 2;
    return [r0 * Math.cos(a) ** 0.85, yb + H * Math.sin(a)];
  });
  revolve(m, crown.pts, felt(), { segs: 96 });
  const wall = (y: number): number => r0 * Math.cos(Math.asin(clamp((y - yb) / H))) ** 0.85;
  band(m, wall, yb + 0.002, yb + 0.045, satin2, 0.006, 96);
  const phi = -0.9;
  bow(m, around(wall(yb + 0.024) + 0.01, yb + 0.024, phi), around(1, 0, phi), 0.03, satin2);
}

/** A fez in wool felt: a short tapered crown, flat on top, a gold button and a tassel on its cord, hanging off it. */
function fez(m: Mesh): void {
  const r0 = 0.22;
  const r1 = 0.18;
  const H = 0.26;
  const y0 = seatAt(r0) - 0.012;
  const p = new Profile(r0 - 0.01, y0).line(r0, y0, 1).line(r1, y0 + H - 0.02, 8).corner(r1 - 0.004, y0 + H, 0, y0 + H + 0.006, 0.02, 8).line(0, y0 + H + 0.006, 6);
  revolve(m, p.pts, felt(), { segs: 112 });
  const top: V3 = [0, y0 + H + 0.006, 0];
  ellipsoid(m, add(top, [0, 0.004, 0]), [0.022, 0.01, 0.022], gold2, { nu: 16, nv: 8 });
  const cord = spline([add(top, [0, 0.01, 0]), add(top, [0.08, 0.008, -0.04]), add(top, [r1 - 0.01, -0.004, -0.07]), [r1 + 0.03, y0 + H - 0.06, -0.08], [r1 + 0.045, y0 + H - 0.13, -0.075]]);
  tube(m, cord, () => 0.0055, gold2, { n: 40, k: 8 });
  tassel(m, cord(1));
}

/** A tricorn in black felt: its brim turned up on three sides against the crown, three corners standing out (one
 * toward you), gold braid along its edge. */
function tricorn(m: Mesh): void {
  const rc = 0.245;
  const y0 = seatAt(rc) - 0.012;
  revolve(m, new Profile(rc - 0.01, y0).line(rc, y0, 1).fn(16, (t) => {
    const a = (t * Math.PI) / 2;
    return [rc * Math.cos(a) ** 0.7, y0 + 0.17 * Math.sin(a)];
  }).pts, felt(), { segs: 112 });
  const third = TAU / 3;
  const corner = (phi: number): number => {
    const k = (((phi % third) + third) % third) - Math.PI / 3; // 0 between corners, +-PI/3 at one
    return 0.5 / Math.cos(k * 0.94);
  };
  const Rc = 0.76;
  const wallH = (phi: number): number => 0.19 - 0.24 * (corner(phi) - 0.5);
  // the brim's mid-surface, a share s of the way from the crown out to its fold and up its wall
  const mid = (s: number, phi: number): P2 => {
    const rf = Math.max(rc + 0.02, Rc * corner(phi));
    const flat = clamp(s / 0.55);
    const up = clamp((s - 0.55) / 0.45);
    return [mix(rc - 0.02, rf, flat) - 0.03 * up, y0 + up * wallH(phi)];
  };
  const p = new Profile(0, -0.008).line(1, -0.008, 24).arc(1, 0, Math.PI / 2, 6).line(0, 0.008, 24);
  revolve(m, p.pts, felt(), {
    segs: 180,
    at: (q, phi) => {
      const s = clamp(Math.hypot(q[0], q[2]), 0, 1.01);
      const a = mid(Math.max(0, s - 0.01), phi);
      const b = mid(Math.min(1, s + 0.01), phi);
      const t = norm([b[0] - a[0], b[1] - a[1], 0]);
      const c = mid(Math.min(1, s), phi);
      const off = q[1] + (s > 1 ? 0 : 0);
      return around(c[0] - t[1] * off + t[0] * Math.max(0, s - 1) * 0.5, c[1] + t[0] * off, phi);
    },
  });
  tube(m, (t) => {
    const phi = TAU * t + Math.PI;
    const c = mid(1, phi);
    return around(c[0], c[1] + 0.006, phi);
  }, () => 0.009, gold2, { closed: true, n: 240, k: 8 });
}

/** A Santa hat in red velvet: a soft cone flopping over to one side, a thick fur trim, a fur pompom on its tip. Pulled on
 * as a beanie is, as far down his head on any head as on the bean's, so a wide head has a wider one. */
function santaHat(m: Mesh): void {
  const [r0, yh] = headAt(0.4733); // where the bean's head is 0.27 across
  const y0 = yh - 0.02;
  const k = Math.min(1.3, r0 / 0.27); // the cone as much bigger as its opening
  const path = spline(([[0, 0, 0], [0.0, 0.17, -0.005], [0.05, 0.31, -0.015], [0.18, 0.36, -0.02], [0.3, 0.3, -0.01], [0.36, 0.19, 0.01]] as V3[]).map((q) => add([0, y0, 0], mul(q, k))));
  tube(m, path, (t) => mix(r0, 0.026 * k, t ** 0.8) * (1 + 0.035 * Math.sin(t * 22)), felt(2), { n: 72, k: 40, caps: false, up: [0, 0, 1] });
  const end = path(1);
  ellipsoid(m, end, [0.03, 0.03, 0.03], felt(2), { nu: 16, nv: 10 });
  tube(m, circle(headR(y0 + 0.01) + 0.03, y0 + 0.012), () => 0.06, { kind: MAT.fur, slot: SLOT.second }, {
    closed: true,
    n: 120,
    k: 24,
    bump: (u, v) => 0.22 * (noise3([u * 7, v * 60, 1]) - 0.5) + 0.1 * (noise3([u * 19, v * 160, 4]) - 0.5),
  });
  pompom(m, add(end, [0.03, -0.045, 0.01]), 0.068, SLOT.second, 9);
}

/** A sombrero in straw: a tall round crown, a very wide brim rolled up at its edge and piped, an embroidered band. */
function sombrero(m: Mesh): void {
  const r0 = 0.21;
  const rB = 0.78;
  const y0 = seatAt(r0) - 0.012;
  const st: Look = { kind: MAT.straw, slot: SLOT.main, extra: 190 };
  const lift = (t: number): number => 0.13 * clamp((t - 0.55) / 0.45) ** 2 - 0.02 * t;
  revolve(m, slab(0.17, rB, y0, 0.018), st, {
    segs: 144,
    at: (q, phi) => {
      const r = Math.hypot(q[0], q[2]);
      const t = clamp((r - r0) / (rB - r0));
      return [q[0], q[1] + lift(t) + 0.006 * Math.sin(4 * phi) * t, q[2]];
    },
  });
  tube(m, (t) => {
    const phi = TAU * t + Math.PI;
    return around(rB - 0.004, y0 + lift(1) + 0.006 * Math.sin(4 * phi), phi);
  }, () => 0.014, { kind: MAT.satin, slot: SLOT.second }, { closed: true, n: 240, k: 8 });
  const H = 0.32;
  const yb = y0 + 0.01;
  const wall = (y: number): number => r0 - 0.03 * clamp((y - yb) / H);
  const crown = new Profile(r0 - 0.01, yb).line(r0, yb, 1).fn(12, (t) => [wall(yb + t * (H - 0.09)), yb + t * (H - 0.09)]).corner(wall(yb + H), yb + H, 0, yb + H + 0.01, 0.1, 12).line(0, yb + H + 0.01, 4);
  revolve(m, crown.pts, st, { segs: 96 });
  band(m, wall, yb + 0.004, yb + 0.07, { kind: MAT.satin, slot: SLOT.second, extra: 2 }, 0.007, 96);
}

/** A tiara: a fine gold band over the front of his head, rising to three pointed arches of gold wire, a teardrop stone
 * in the middle one, small stones and pearls on the others. */
function tiara(m: Mesh): void {
  const [rb, yb] = headAt(0.5, 0.012);
  tube(m, (t) => around(rb, yb, mix(-1.45, 1.45, t)), () => 0.014, gold, { n: 80, k: 8, flat: 0.55, up: [0, 1, 0] });
  const lean: M3 = basis([1, 0, 0], norm([0, 1, -0.32]), norm([0, 0.32, 1]));
  const o = around(rb, yb, 0);
  const at = (x: number, y: number, z = 0): V3 => add(o, apply(lean, [x, y, z]));
  const arch = (cx: number, w: number, h: number): void =>
    tube(m, spline([at(cx - w, 0), at(cx - w * 0.7, h * 0.55), at(cx - w * 0.2, h * 0.92), at(cx, h), at(cx + w * 0.2, h * 0.92), at(cx + w * 0.7, h * 0.55), at(cx + w, 0)]), () => 0.0105, gold, { n: 48, k: 8 });
  arch(0, 0.07, 0.2);
  arch(-0.135, 0.055, 0.13);
  arch(0.135, 0.055, 0.13);
  for (const s of [-1, 1]) {
    tube(m, (t) => at(s * (0.215 + 0.03 * Math.cos(TAU * t * 0.85)), 0.022 + 0.03 * Math.sin(TAU * t * 0.85)), () => 0.0095, gold, { n: 24, k: 6 });
    gem(m, at(s * 0.135, 0.066, 0.004), 0.021, { kind: MAT.gem, slot: SLOT.white }, { R: mm(lean, rotX(Math.PI / 2)), depth: 0.6 });
    ellipsoid(m, at(s * 0.135, 0.14), [0.014, 0.014, 0.014], { kind: MAT.pearl, slot: SLOT.white }, { nu: 12, nv: 8 });
  }
  gem(m, at(0, 0.094, 0.006), 0.04, { kind: MAT.gem, slot: SLOT.second }, { R: mm(lean, mm(rotX(Math.PI / 2), rotY(Math.PI / 2))), sx: 0.7, depth: 0.7 });
  ellipsoid(m, at(0, 0.212), [0.017, 0.017, 0.017], { kind: MAT.pearl, slot: SLOT.white }, { nu: 12, nv: 8 });
}

/** Antlers on a headband: a beam each side curving up and out, with its tines, in bone. */
function antlers(m: Mesh): void {
  // as the bunny ears' band: its ends tucked under his head, the antlers on it
  tube(m, tucked(1.32, 0.012, 0.2), () => 0.022, { kind: MAT.leather, slot: SLOT.second }, { n: 72, k: 12, flat: 0.45, up: [0, 0, 1] });
  const bone: Look = { kind: MAT.horn, slot: SLOT.main, extra: 1 };
  for (const s of [-1, 1]) {
    const base = onHead(s * 0.4, 0.2, 0.01);
    const beam = spline([base, add(base, [s * 0.03, 0.08, 0]), add(base, [s * 0.1, 0.17, -0.01]), add(base, [s * 0.15, 0.27, -0.02]), add(base, [s * 0.13, 0.36, -0.03])]);
    tube(m, beam, (t) => mix(0.024, 0.011, t), bone, { n: 40, k: 12 });
    const tine = (t: number, d: V3, l: number, r: number): void => {
      const p = beam(t);
      tube(m, spline([p, add(p, mul(d, l * 0.5)), add(p, add(mul(d, l), [0, 0.02, 0]))]), (k) => mix(r, 0.005, k), bone, { n: 16, k: 10 });
    };
    tine(0.32, norm([-s * 0.35, 1, 0.15]), 0.09, 0.015);
    tine(0.58, norm([s * 0.9, 0.8, 0.0]), 0.08, 0.013);
    tine(0.8, norm([s * 0.1, 0.7, 0.6]), 0.07, 0.011);
  }
}

/** A unicorn's horn: a slim spiral horn with a pearly sheen, its groove winding up it, on a gold ring at its foot. */
const UNICORN = { lean: 0.34, len: 0.36 };
function unicornHorn(m: Mesh): void {
  const base = standing(0, 0.3, -0.008);
  const R = rotX(UNICORN.lean);
  const p = new Profile(0, 0)
    .line(0.058, 0, 2)
    .fn(30, (t) => {
      const s = t * 0.94;
      return [0.058 * (1 - s) ** 0.9 + 0.004 * (1 - s), s * UNICORN.len];
    })
    .tip(UNICORN.len, 0.008, 6);
  revolve(m, p.pts, { kind: MAT.pearl, slot: SLOT.main, extra: 1 }, {
    segs: 96,
    at: (q, phi) => {
      const t = clamp(q[1] / UNICORN.len);
      const k = 1 - 0.13 * Math.max(0, Math.cos(phi - TAU * 3.2 * t)) ** 3;
      return add(base, apply(R, [q[0] * k, q[1], q[2] * k]));
    },
  });
  tube(m, (t) => add(base, apply(R, [0.064 * Math.sin(TAU * t), 0.006, 0.064 * Math.cos(TAU * t)])), () => 0.009, gold2, { closed: true, n: 48, k: 8 });
}

/** A laurel wreath, the CEO's: two gold branches round the top of his head meeting in front at a stone, their leaves in
 * pairs, smaller toward the front. */
function laurel(m: Mesh): void {
  const [r, y] = headAt(0.48, 0.018);
  for (const s of [-1, 1]) {
    const angle = (t: number): number => s * mix(Math.PI - 0.15, 0.14, t);
    const branch = (t: number): V3 => rest(around(r, y, angle(t)), 0.03); // round the back of a flat head, down onto it
    tube(m, branch, () => 0.01, gold, { n: 64, k: 8 });
    for (let k = 0; k < 9; k++) {
      const t = (k + 0.5) / 9;
      const p = branch(t);
      const along = norm(sub(branch(Math.min(1, t + 0.02)), branch(Math.max(0, t - 0.02))));
      const out = norm(add(around(1, 0, angle(t)), [0, 0.45, 0]));
      const size = mix(1.1, 0.8, t);
      for (const side of [-1, 1]) {
        const d = norm(add(add(along, mul(cross(out, along), side * 0.6)), mul(out, 0.1)));
        blade(m, p, d, out, 0.14 * size, 0.04 * size, gold, { shape: leafy, cup: 0.35, bend: 0.06, thick: 0.005, nu: 12, nv: 14 });
      }
    }
  }
  const c = around(r + 0.012, y + 0.01, 0);
  const R = rotX(Math.PI / 2 - 0.5);
  gem(m, c, 0.044, { kind: MAT.gem, slot: SLOT.second }, { R, depth: 0.7 });
  tube(m, (t) => add(c, apply(R, [0.049 * Math.sin(TAU * t), -0.002, 0.049 * Math.cos(TAU * t)])), () => 0.008, gold, { closed: true, n: 40, k: 8 });
}

/** A quill, the CFO's: a long feather tucked at the side of his head, its vane barbed and soft, a gold nib at its foot;
 * the books are kept. */
function quill(m: Mesh): void {
  const base = onHead(0.48, 0.2, 0.012);
  const d = norm([0.36, 1, -0.22]);
  const face = norm(add(headNormal(base), [0, 0, 0.8]));
  const len = 0.36;
  const bend = -0.12;
  const F = cross(d, norm(cross(face, d)));
  const spine = (t: number): V3 => add(add(base, mul(d, 0.02 + len * t)), mul(F, bend * len * t * t)); // the vane's own middle
  blade(m, add(base, mul(d, 0.02)), d, face, len, 0.075, { kind: MAT.feather, slot: SLOT.main }, {
    shape: (t) => (t < 0.1 ? 0.5 + 5 * t : 1) * Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.08)) ** 0.6,
    thick: 0.005,
    bend,
    cup: 0.12,
    nu: 14,
    nv: 32,
  });
  tube(m, spline([add(base, mul(d, -0.04)), add(base, mul(d, 0.02)), spine(0.25), spine(0.5), spine(0.75), spine(1.02)]), (t) => mix(0.016, 0.004, t ** 0.7), { kind: MAT.horn, slot: SLOT.cream, extra: 1 }, { n: 36, k: 8 });
  const nibAt = add(base, mul(d, -0.04));
  const B = facing(d, [0, 0, 1]);
  revolve(m, new Profile(0, 0).line(0.018, 0, 1).line(0.004, -0.055, 8).line(0, -0.058, 1).pts, gold2, { segs: 24, at: (q) => add(nibAt, apply(B, [q[0], q[2], -q[1]])), flip: true });
}

// ── the set ────────────────────────────────────────────────────────────────────────────────────
/** Every hat's model, by its number in spec.ts HATS. */
export const MODELS: Record<number, (m: Mesh) => void> = {
  1: topHat, 2: beanie, 3: partyHat, 4: antenna, 5: sprout, 6: bigBow, 7: crown, 8: headphones, 9: cap, 10: wizardHat,
  11: halo, 12: flower, 13: horns, 14: bunnyEars, 15: chefHat, 16: gradCap, 17: cowboyHat, 18: propeller, 19: starClip,
  20: beret, 21: hardHat, 22: bucketHat, 23: eyeshade, 24: headset, 25: sweatband, 26: apple, 27: strawHat, 28: fedora,
  29: deerstalker, 30: sunVisor, 31: flowerCrown, 32: vikingHelmet, 33: bowler, 34: fez, 35: tricorn, 36: santaHat,
  37: sombrero, 38: tiara, 39: antlers, 40: unicornHorn, 41: laurel, 42: quill,
};

/** What stands on him, clips to him or goes round him, built on his skin (his outline itself), not on the dome a hat goes
 * over: the antenna, the sprout, the bow, headphones, the flower, the horns, bunny ears, the star clip, the eyeshade, a
 * headset, the sweatband, the apple, the sun visor, the flower crown, the tiara, antlers, the unicorn's horn, the laurel,
 * the quill. A band over his head lies on him (a cup on his side and the band it hangs from on one head, so they meet). */
const ON_SKIN = new Set([4, 5, 6, 8, 12, 13, 14, 19, 23, 24, 25, 26, 30, 31, 38, 39, 40, 41, 42]);
const surface = (id: number, on: Head): Head => (ON_SKIN.has(id) ? (on.skin ?? on) : on);
/** Every hat built, by its number and the head it was built on. */
const made = new Map<string, Built | null>();
/** A hat ready for the GPU, built on `on` (a shape's head, heads.ts) and lit (null: none, or not modelled). The renderer
 * keeps what it uploads. */
export function hatMesh(id: number, on: Head): Built | null {
  const key = `${id}|${on.key}`;
  if (!made.has(key)) {
    const make = MODELS[id];
    made.set(key, make ? onThe(surface(id, on), () => {
      const m = new Mesh();
      make(m);
      bake(m);
      return built(m);
    }) : null);
  }
  return made.get(key)!;
}

/** What on a hat gives off light, as the orb's shader draws its glow round it: in the hat's flat units (x right, y down
 * from the top of his head, seen as the hat is, from a little above), a bead's centre and radius, or a ring's centre and
 * its two radii. */
export function glowOf(id: number, on: Head): { kind: 1 | 2; at: [number, number]; a: number; b: number; slot: "main" | "second" } | null {
  const seen = (p: V3): [number, number] => [p[0], -(p[1] * Math.cos(PITCH) - p[2] * Math.sin(PITCH))];
  if (id === 4) {
    const { BEAD } = onThe(surface(id, on), antennaOn);
    return { kind: 1, at: seen(BEAD.at), a: BEAD.r, b: BEAD.r, slot: "second" };
  }
  if (id === 11) return { kind: 2, at: seen([0, HALO.y, 0]), a: HALO.R, b: HALO.R * Math.sin(HALO.tilt + PITCH), slot: "main" };
  return null;
}

const heads = new Map<string, Built>();
/** His head as the hat sees it: what hides the parts of a hat that go round behind him (drawn into depth only), a hair
 * inside his skin (the dome over a drop's point would hide a horn's foot that is drawn standing on him). */
export function headMesh(on: Head): Built {
  let b = heads.get(on.key);
  if (!b) {
    const m = new Mesh();
    onThe(on.skin ?? on, () =>
      grid(m, 48, 40, (u, v) => {
        const al = Math.PI * v;
        const ph = 2 * Math.PI * u;
        const R = radiusAt(al) - 0.01;
        return [R * Math.sin(al) * Math.sin(ph), head().cy + R * Math.cos(al), R * Math.sin(al) * Math.cos(ph)];
      }, { kind: 0, slot: 0 }),
    );
    b = built(m);
    heads.set(on.key, b);
  }
  return b;
}
