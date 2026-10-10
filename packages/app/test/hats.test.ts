// PLAN 2.2_t, the hats as models (owner, 10-09: "like we like the ideas of them 100% dont change what they are, but the
// design lol. even the party hat is huge ... dont cheap out on them. make them nice, to industry standards"). Every hat
// is a sound model (finite numbers, unit normals, its light baked), sized for his head (none taller than his window
// allows, the party hat no longer huge), sitting on his head (only the halo floats), inside his window; what gives off
// light is where its glow is drawn; and the shaders share the hats' numbers. On every shape's own head (owner, 10-09: "make
// sure the beanies are snug and tight over their heads, including squirqule ... Also watch out for ears, they should be
// inside hat when on"): what goes on over his head covers it, and his ears go inside it. Pure: the rendered look is
// characters.test.ts's.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HAT_FS, HAT_VS, ORB_FS } from "../src/orb/glsl.ts";
import { BEAN_CY, built as builtOf, headAt, MAT, Mesh, onThe, outOfHead, PITCH, revolve, seatAt, SLOT } from "../src/orb/hats/geo.ts";
import { BEAN_FACE, FACE, glassesMesh, type Face } from "../src/orb/hats/glasses.ts";
import { faceOf, hasEars, hatCells, headCells, headOf, NX, NY } from "../src/orb/hats/heads.ts";
import { glowOf, hatMesh, MODELS } from "../src/orb/hats/models.ts";
import { ASH, closeUp, COVERS, earsInside, EYES, GLASSES, halfWidth, HATS, hatReach, isShades, lookOf, SHAPES, type GlassesName, type HatName, type ShapeName } from "../src/orb/spec.ts";
import { PORTRAIT } from "../src/orb/renderer.ts";

const hats = (Object.keys(HATS) as HatName[]).filter((h) => h !== "none");
const bean = headOf("bean");
const built = new Map(hats.map((h) => [h, hatMesh(HATS[h].id, bean)!]));
/** How high on the screen a point of a hat is drawn (the hats are seen from a little above), in the hat's units. */
const seenUp = (y: number, z: number): number => y * Math.cos(PITCH) - z * Math.sin(PITCH);

test("every hat is a sound model: finite, its normals unit length, its light baked, made of materials the shader has", () => {
  const kinds = new Set<number>(Object.values(MAT));
  for (const h of hats) {
    const b = built.get(h)!;
    const n = b.pos.length / 3;
    assert.ok(n > 50 && b.count >= 3 && b.count % 3 === 0, `${h}: a model (${n} vertices, ${b.count / 3} triangles)`);
    assert.ok([...b.pos, ...b.nrm, ...b.uv, ...b.mat].every(Number.isFinite), `${h}: every number finite`);
    assert.ok(b.idx.every((i) => i < n), `${h}: every triangle on its own vertices`);
    for (let v = 0; v < n; v++) {
      const l = Math.hypot(b.nrm[v * 3]!, b.nrm[v * 3 + 1]!, b.nrm[v * 3 + 2]!);
      assert.ok(Math.abs(l - 1) < 1e-3, `${h}: normal ${v} is ${l.toFixed(4)} long`);
      assert.ok(kinds.has(b.mat[v * 4]!), `${h}: a material the shader knows (${b.mat[v * 4]})`);
      const ao = b.mat[v * 4 + 2]!;
      assert.ok(ao >= 0.15 && ao <= 1, `${h}: its occlusion in range (${ao})`);
    }
    // the light is baked: somewhere it is open sky, somewhere tucked away (a model lit flat everywhere was not baked)
    const aos = Array.from({ length: n }, (_, v) => b.mat[v * 4 + 2]!);
    assert.ok(Math.max(...aos) > 0.95 && Math.min(...aos) < 0.85, `${h}: its occlusion runs ${Math.min(...aos).toFixed(2)} to ${Math.max(...aos).toFixed(2)}`);
  }
});

test("sized for his head: none taller than his window allows, the party hat no longer huge, none wider than his frame", () => {
  const tall = new Map<HatName, number>();
  for (const h of hats) {
    const b = built.get(h)!;
    let top = -9;
    let low = 9;
    let wide = 0;
    for (let v = 0; v < b.pos.length / 3; v++) {
      const up = seenUp(b.pos[v * 3 + 1]!, b.pos[v * 3 + 2]!);
      top = Math.max(top, up);
      low = Math.min(low, up);
      wide = Math.max(wide, Math.abs(b.pos[v * 3]!));
    }
    tall.set(h, top);
    // his window has 38 more units above him than Ash's (renderer.ts DESIGN), 1.4 of a hat's units, and a hop needs room
    assert.ok(top <= (h === "wizard hat" ? 0.66 : 0.6), `${h}: ${top.toFixed(3)} tall over his head`);
    // the hat thumbnails keep 0.16 of their width clear at each side (characters.test.ts): 0.85 of a hat's units
    assert.ok(wide <= 0.8, `${h}: ${wide.toFixed(3)} to either side`);
    assert.ok(low >= -1.1, `${h}: hangs ${low.toFixed(3)} below the top of his head`);
  }
  // owner, 10-09: "even the party hat is huge". Its flat drawing stood 1.01 of a hat's units over his head, pompom and all
  assert.ok(tall.get("party hat")! <= 0.6, `the party hat stands ${tall.get("party hat")!.toFixed(3)} over his head`);
  assert.ok(tall.get("party hat")! > 0.35, "control: and it is still a party hat, not a cap");
});

test("on any head every hat is sound and sits on it (it reaches him), but the halo, which floats clear of him", () => {
  for (const shape of ["bean", "squircle", "star", "kitty", "pill", "heart"] as ShapeName[]) {
    for (const h of hats) {
      const on = headOf(shape, h === "halo");
      const b = shape === "bean" ? built.get(h)! : hatMesh(HATS[h].id, on)!;
      assert.ok([...b.pos, ...b.nrm, ...b.mat].every(Number.isFinite), `${shape} in a ${h}: every number finite`);
      for (let v = 0; v < b.nrm.length / 3; v++) assert.ok(Math.abs(Math.hypot(b.nrm[v * 3]!, b.nrm[v * 3 + 1]!, b.nrm[v * 3 + 2]!) - 1) < 1e-3, `${shape} in a ${h}: normal ${v} unit length`);
      let near = Infinity;
      onThe(on, () => {
        for (let v = 0; v < b.pos.length / 3; v++) {
          const p: [number, number, number] = [b.pos[v * 3]!, b.pos[v * 3 + 1]!, b.pos[v * 3 + 2]!];
          // how far out from his head, in the hat's units (his head's own radius in that direction)
          const k = outOfHead(p);
          near = Math.min(near, ((k - 1) * Math.hypot(p[0], p[1] - on.cy, p[2])) / k);
        }
      });
      if (h === "halo") assert.ok(near > 0.05, `${shape}: the halo floats, ${near.toFixed(3)} clear of him`);
      else assert.ok(near < 0.03, `${shape} in a ${h}: ${near.toFixed(3)} off his head at its nearest (it floats)`);
    }
  }
  assert.ok(Math.abs(headOf("bean").cy - BEAN_CY) < 1e-3, `the bean's centre is where the hats' angles are taken from (${headOf("bean").cy.toFixed(4)})`);
});

test("what gives off light is where its glow is drawn: the antenna's bead and the halo, and nothing else glows", () => {
  for (const h of hats) {
    const b = built.get(h)!;
    const lit: [number, number, number][] = [];
    for (let v = 0; v < b.pos.length / 3; v++) if (b.mat[v * 4] === MAT.glow) lit.push([b.pos[v * 3]!, b.pos[v * 3 + 1]!, b.pos[v * 3 + 2]!]);
    const g = glowOf(HATS[h].id, bean);
    assert.equal(Boolean(g), lit.length > 0, `${h}: a glow drawn if and only if it gives off light`);
    if (!g || !lit.length) continue;
    const seen = lit.map(([x, y, z]) => [x, -seenUp(y, z)] as const);
    const cx = seen.reduce((s, p) => s + p[0], 0) / seen.length;
    const lo = Math.min(...seen.map((p) => p[1]));
    const hi = Math.max(...seen.map((p) => p[1]));
    const wx = Math.max(...seen.map((p) => Math.abs(p[0] - cx)));
    assert.ok(Math.abs(cx - g.at[0]) < 0.01 && Math.abs((lo + hi) / 2 - g.at[1]) < 0.02, `${h}: its glow is centred on it (${g.at.map((v) => v.toFixed(3))} against ${cx.toFixed(3)}, ${((lo + hi) / 2).toFixed(3)})`);
    assert.ok(Math.abs(wx - g.a) < 0.04, `${h}: and as wide (${g.a.toFixed(3)} against ${wx.toFixed(3)})`);
  }
  assert.deepEqual(hats.filter((h) => glowOf(HATS[h].id, bean)), ["antenna", "halo"], "control: the two that glow");
});

test("a hat casts its shadow just under where it ends; a halo, all light, casts none", () => {
  for (const h of hats) {
    const e = [...built.get(h)!.edge];
    const set = e.filter((v) => v > -5);
    if (h === "halo") assert.equal(set.length, 0, "the halo casts no shadow");
    else {
      assert.ok(set.length >= 3, `${h}: its lowest edge across ${set.length} columns`);
      assert.ok(set.every((v) => v > -0.7 && v < 1.1), `${h}: and where it is (${set.map((v) => v.toFixed(2)).join(" ")})`);
    }
  }
});

test("the shaders share the hats' numbers: where his hat sits each frame, how it is seen, what it is made of", () => {
  // the vertex shader does the orb shader's own sums for the top of his head, so the hat and his glow never part
  const line = (src: string, start: string): string => src.split("\n").map((l) => l.trim()).find((l) => l.startsWith(start)) ?? "";
  for (const start of ["float Rtop =", "float Rhat =", "float depth =", "float Rg ="]) {
    assert.ok(line(HAT_VS, start).length > 10, `the hats' vertex shader has ${start}`);
    assert.equal(line(HAT_VS, start).replace(/\s+/g, ""), line(ORB_FS, start).replace(/\s+/g, ""), `${start} is the orb shader's own`);
  }
  assert.match(HAT_VS, new RegExp(`PITCH = ${PITCH}\\b`), "seen from as high as the models are made for");
  const decl = /const int ([^;]+);/.exec(HAT_FS)![1]!;
  const inShader = Object.fromEntries(decl.split(",").map((d) => d.trim().split(/\s*=\s*/)).map(([k, v]) => [k!.toLowerCase(), Number(v)]));
  assert.deepEqual(inShader, { ...MAT }, "every material is the same number in the shader");
  assert.equal(Object.keys(MODELS).length, hats.length, "control: every hat has a model to read");
});

// ── the glasses as models (owner, 10-09: "can we do the same thing we did to the hats to the eyes and the glasses") ──
test("every pair of glasses is a sound model for every eyes, its lenses over his eyes, in front of his face", () => {
  for (const [name, g] of Object.entries(GLASSES)) {
    if (!g.id) continue;
    for (const [eyesName, e] of Object.entries(EYES)) {
      const b = glassesMesh(g.id, e.a, g.dark)!;
      const n = b.pos.length / 3;
      const what = `${name} on ${eyesName} eyes`;
      assert.ok(n > 50 && b.count % 3 === 0, `${what}: a model`);
      assert.ok([...b.pos, ...b.nrm, ...b.mat].every(Number.isFinite), `${what}: every number finite`);
      // the lenses: over his eyes (one for a monocle, on his left; one across both for a visor)
      const lens: [number, number, number][] = [];
      for (let v = 0; v < n; v++) if (b.mat[v * 4] === MAT.glass && b.mat[v * 4 + 1] === SLOT.lens) lens.push([b.pos[v * 3]!, b.pos[v * 3 + 1]!, b.pos[v * 3 + 2]!]);
      const [, , gap, height] = e.a;
      const sides = name === "visor" ? [0] : name === "monocle" ? [1] : [-1, 1];
      for (const s of sides) {
        const mine = lens.filter(([x]) => (s === 0 ? true : Math.sign(x) === s));
        const cx = mine.reduce((t, p) => t + p[0], 0) / mine.length;
        const cy = mine.reduce((t, p) => t + p[1], 0) / mine.length;
        const ex = s === 0 ? 0 : s * Math.max(gap, Math.min(0.25, Math.max(0.15, e.a[0] * 1.5)) + 0.035);
        assert.ok(Math.abs(cx - ex) < 0.06 && Math.abs(cy + height) < 0.09, `${what}: a lens over his ${s < 0 ? "right" : s > 0 ? "left" : "two"} eye${s ? "" : "s"} (${cx.toFixed(3)}, ${cy.toFixed(3)})`);
        // in front of his face, where his eyes are seen through it: every point of it before the face just behind it
        const zFace = (x: number, y: number): number => FACE.a * Math.sqrt(Math.max(0, 1 - (x / FACE.a) ** 2 - ((y - FACE.y) / FACE.b) ** 2));
        assert.ok(mine.every((p) => p[2] > zFace(p[0], p[1]) + 0.01), `${what}: its lens in front of his face`);
      }
      // inside his outline, face on: nothing in front of him reaches past his sides
      let wide = 0;
      for (let v = 0; v < n; v++) if (b.pos[v * 3 + 2]! > 0.25) wide = Math.max(wide, Math.abs(b.pos[v * 3]!));
      assert.ok(wide < 0.9, `${what}: ${wide.toFixed(3)} to his side, past his edge`);
    }
    // sunglasses are tinted dark; clear glasses are clear
    const lensKinds = new Set<number>();
    const b = glassesMesh(g.id, EYES.classic.a, g.dark)!;
    for (let v = 0; v < b.pos.length / 3; v++) if (b.mat[v * 4 + 1] === SLOT.lens) lensKinds.add(b.mat[v * 4 + 3]!);
    const tint = Math.max(...lensKinds);
    if (isShades(name as GlassesName)) assert.ok(tint >= 0.7, `${name}: sunglasses tinted dark (${tint})`);
    else if (g.dark === 0) assert.ok(tint < 0.05, `${name}: clear glass (${tint})`);
  }
});

// ── on every head (owner, 10-09: "make sure the beanies are snug and tight over their heads, including squirqule, or else
// we get this [a squircle's corners out from under a beanie made for the bean] ... Also watch out for ears, they should
// be inside hat when on") ──
/** The hats made over his head, which hug it. */
const HUGS: HatName[] = ["beanie", "cap", "hard hat", "deerstalker", "viking helmet", "propeller", "beret"];
/** His head out from under a hat, as it is drawn: the cells of him above where the hat ends (in their own column, or as
 * far out as it reaches) that it is not drawn over, as a share of all of him there. */
function poking(hat: Uint8Array, head: Uint8Array): number {
  const low = new Array<number>(NX).fill(-1);
  for (let i = 0; i < NX; i++)
    for (let j = 0; j < NY; j++)
      if (hat[j * NX + i]) {
        low[i] = j;
        break;
      }
  const first = low.findIndex((v) => v >= 0);
  const last = NX - 1 - [...low].reverse().findIndex((v) => v >= 0);
  for (let i = 0; i < first; i++) low[i] = low[first]!;
  for (let i = last + 1; i < NX; i++) low[i] = low[last]!;
  let under = 0;
  let out = 0;
  for (let i = 0; i < NX; i++)
    for (let j = low[i]! + 1; j < NY; j++) {
      if (!head[j * NX + i]) continue;
      under++;
      if (!hat[j * NX + i]) out++;
    }
  return out / Math.max(1, under);
}

test("a hat made over his head covers it on every shape, a squircle's corners too: none of him out from under it", () => {
  for (const shape of Object.keys(SHAPES) as ShapeName[]) {
    const head = headCells(shape, false);
    for (const h of HUGS) {
      const look = lookOf({ ...ASH, shape, hat: h });
      const out = poking(hatCells(hatMesh(look.acc, look.head)!, look.accTilt), head);
      // measured 10-10: 0.5% at most (a cell at an edge)
      assert.ok(out < 0.015, `${shape} in a ${h}: ${(out * 100).toFixed(1)}% of his head out from under it`);
    }
  }
  // control: the bean's beanie on a squircle, as every shape wore one until 10-10 (7.3% of its head out, at its corners)
  const bean = poking(hatCells(hatMesh(HATS.beanie.id, headOf("bean"))!, HATS.beanie.tilt), headCells("squircle", false));
  assert.ok(bean > 0.05, `control: a beanie made for the bean leaves ${(bean * 100).toFixed(1)}% of a squircle out`);
});

test("his ears go inside a hat over his head that would be drawn over them; one between them, or no hat at all, leaves them", () => {
  const eared = (Object.keys(SHAPES) as ShapeName[]).filter((n) => hasEars(SHAPES[n]));
  assert.deepEqual(eared, ["teddy", "cub", "kitty", "bunny", "fox", "owl"], "control: the shapes with ears");
  for (const shape of eared) {
    for (const h of [...HUGS, "sombrero", "straw hat"] as HatName[]) assert.ok(earsInside(h, shape), `${shape} in a ${h}: his ears inside it`);
    assert.ok(!earsInside("party hat", shape), `${shape} in a party hat: his ears beside it`);
    for (const h of Object.keys(HATS) as HatName[]) if (!COVERS.has(h)) assert.ok(!earsInside(h, shape), `${shape} with ${h}: what does not go on over his head leaves his ears`);
    // and the shader is told: drawn without them where they are inside
    assert.equal(lookOf({ ...ASH, shape, hat: "beanie" }).shapeC[2], 0, `${shape} in a beanie: drawn without his ears`);
    assert.equal(lookOf({ ...ASH, shape, hat: "party hat" }).shapeC[2], SHAPES[shape].c[2], `${shape} in a party hat: with them`);
  }
  for (const shape of Object.keys(SHAPES) as ShapeName[]) if (!eared.includes(shape)) assert.ok(!earsInside("beanie", shape), `${shape}: no ears to put away`);
  // measured 10-10: a top hat's brim is over 6% of a kitty's ears (between them), 25% of a teddy's (over them)
  assert.ok(!earsInside("top hat", "kitty") && earsInside("top hat", "teddy"), "a top hat: between a kitty's ears, over a teddy's");
});

// owner, 10-10: "Org chart ceo orb hat crown is cut off on top". A close-up of his face (the org chart, the board, the
// editor's head, a computer's avatar) keeps his hat in: its frame grows above his head by as much as the hat stands out.
test("a close-up keeps his hat in: every hat on every shape stands inside its frame, and with none the frame is as it was", () => {
  const cut: string[] = [];
  for (const shape of Object.keys(SHAPES) as ShapeName[])
    for (const hat of Object.keys(HATS) as HatName[]) {
      const f = closeUp(PORTRAIT, { shape, hat });
      if (f.cy * f.h - hatReach({ shape, hat }) * f.radius * 1.06 < 0) cut.push(`${hat} on a ${shape}`);
    }
  assert.deepEqual(cut, [], "every hat inside its close-up");
  // the control: the close-up as it was, cut to his width with no room above, cuts the CEO's crown on Ash's bean
  const was = { ...PORTRAIT, radius: Math.min(PORTRAIT.radius, PORTRAIT.w / 2 / (halfWidth("bean") + PORTRAIT.edge + 0.04)) };
  assert.ok(was.cy * was.h - hatReach({ shape: "bean", hat: "crown" }) * was.radius < 0, "control: the old close-up cuts the crown");
  assert.equal(closeUp(PORTRAIT, { shape: "bean", hat: "none" }).h, PORTRAIT.h, "no hat: the frame the eye checks measured");
});

// owner, 10-10: "the glasses are off too on some orbs: they overlap the body and face". A pair is made on the face of the
// shape that wears it: face on, nothing of it shows past his outline, and its temples reach his edge (on the bean's face,
// they ended half way across a squish and stood out past a pill).
test("a pair of glasses fits the face of the shape that wears it: nothing past his edge, its temples reaching it", () => {
  /** Face on, how far past his outline anything of the pair shows (hidden only where it is behind his face), and how far
   * out its temples reach, as a share of his half-width there. */
  const fit = (shape: ShapeName, id: number, face: Face): { past: number; reach: number } => {
    const b = glassesMesh(id, EYES.classic.a, 0, face)!;
    const own = faceOf(shape);
    let past = 0, reach = 0;
    for (let v = 0; v < b.pos.length / 3; v++) {
      const x = Math.abs(b.pos[v * 3]!), y = b.pos[v * 3 + 1]!, z = b.pos[v * 3 + 2]!;
      const w = own.w(y);
      if (w <= 0) continue;
      const behind = x < w && z < Math.sqrt(w * w - x * x);
      if (!behind) past = Math.max(past, x - w);
      if (w > 0.2) reach = Math.max(reach, Math.min(x / w, 1.05)); // at whatever height its temples are
    }
    return { past, reach };
  };
  const PAST = 0.045; // a temple's thickness at his very edge
  for (const shape of ["pill", "squish", "pebble", "egg", "kitty", "star", "squircle"] as ShapeName[])
    for (const g of ["round", "hearts", "aviators", "cat-eye"] as GlassesName[]) {
      const r = fit(shape, GLASSES[g].id, faceOf(shape));
      assert.ok(r.past < PAST, `${g} on a ${shape}: ${r.past.toFixed(3)} past his outline`);
      assert.ok(r.reach > 0.93, `${g} on a ${shape}: its temples reach ${(r.reach * 100).toFixed(0)}% of the way to his edge`);
    }
  // the controls: made on the bean's face, a pair stands out past a pill and stops short on a squish
  assert.ok(fit("pill", GLASSES.round.id, BEAN_FACE).past > PAST, "control: the bean's pair stands out past a pill");
  assert.ok(fit("squish", GLASSES.round.id, BEAN_FACE).reach < 0.9, "control: the bean's pair stops short on a squish");
});

// owner, 10-10: "some headbands are a little off, you see the cut off in the back of the head as its trying to wrap
// around". Seen from a little above, the back of a band round a flat head stood over his outline (his glass is drawn
// straight on) and was cut where his head hid it. Now the back of a band of its own is let down out of sight: nothing
// of it behind his middle is seen over his outline.
test("the back of a headband never shows over a flat head: a band round his head goes round behind him", () => {
  /** How far over his outline (hat units) the most of its band (what is made of `kind`) behind his middle is seen, as the
   * renderer draws it: an ear or an antler standing up over him is meant to be seen. */
  const over = (b: { pos: ArrayLike<number>; mat: ArrayLike<number> }, kind: number): number => {
    const cp = Math.cos(PITCH), sp = Math.sin(PITCH);
    let most = -1;
    for (let v = 0; v < b.pos.length / 3; v++) {
      const x = b.pos[v * 3]!, y = b.pos[v * 3 + 1]!, z = b.pos[v * 3 + 2]!;
      if (z >= -0.02 || b.mat[v * 4] !== kind) continue;
      most = Math.max(most, y * cp - z * sp - seatAt(Math.abs(x)));
    }
    return most;
  };
  for (const shape of ["pebble", "squircle", "squish", "bean"] as ShapeName[])
    for (const [hat, kind] of [["sweatband", MAT.cotton], ["eyeshade", MAT.rubber], ["sun visor", MAT.cotton], ["bunny ears", MAT.plastic], ["antlers", MAT.leather]] as [HatName, number][]) {
      const head = headOf(shape);
      const seen = onThe(head, () => over(hatMesh(HATS[hat].id, head)!, kind));
      assert.ok(seen <= 0.005, `${hat} on a ${shape}: its back seen ${seen.toFixed(3)} over his outline`);
    }
  // the control: a sweatband's ring as it was, round a pebble's head with nothing let down, is seen over it
  const head = headOf("pebble");
  const ring = onThe(head, () => {
    const m = new Mesh();
    revolve(m, [headAt(1.0, 0), headAt(1.0, 0.038), headAt(0.78, 0.038), headAt(0.78, 0)], { kind: MAT.cotton, slot: SLOT.main }, { segs: 120 });
    return over(builtOf(m), MAT.cotton);
  });
  assert.ok(ring > 0.02, `control: a band's ring round a pebble, as it was, is seen ${ring.toFixed(3)} over his outline`);
});
