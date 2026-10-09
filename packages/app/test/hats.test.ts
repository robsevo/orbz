// PLAN 2.2_t, the hats as models (owner, 10-09: "like we like the ideas of them 100% dont change what they are, but the
// design lol. even the party hat is huge ... dont cheap out on them. make them nice, to industry standards"). Every hat
// is a sound model (finite numbers, unit normals, its light baked), sized for his head (none taller than his window
// allows, the party hat no longer huge), sitting on his head (only the halo floats), inside his window; what gives off
// light is where its glow is drawn; and the shaders share the hats' numbers. Pure: the rendered look is
// characters.test.ts's.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HAT_FS, HAT_VS, ORB_FS } from "../src/orb/glsl.ts";
import { HEAD, MAT, PITCH } from "../src/orb/hats/geo.ts";
import { glowOf, hatMesh, MODELS } from "../src/orb/hats/models.ts";
import { HATS, type HatName } from "../src/orb/spec.ts";

const hats = (Object.keys(HATS) as HatName[]).filter((h) => h !== "none");
const built = new Map(hats.map((h) => [h, hatMesh(HATS[h].id)!]));
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

test("every hat sits on his head (it reaches him), but the halo, which floats clear of him", () => {
  for (const h of hats) {
    const b = built.get(h)!;
    let near = Infinity;
    for (let v = 0; v < b.pos.length / 3; v++) {
      const x = b.pos[v * 3]!, y = b.pos[v * 3 + 1]!, z = b.pos[v * 3 + 2]!;
      // how far out from his head, in the hat's units (his head's own radius in that direction)
      const k = Math.hypot(x / HEAD.a, (y - HEAD.y) / HEAD.b, z / HEAD.a);
      near = Math.min(near, (k - 1) * Math.hypot(x, y - HEAD.y, z) / k);
    }
    if (h === "halo") assert.ok(near > 0.05, `the halo floats: ${near.toFixed(3)} clear of him`);
    else assert.ok(near < 0.03, `${h}: ${near.toFixed(3)} off his head at its nearest (it floats)`);
  }
});

test("what gives off light is where its glow is drawn: the antenna's bead and the halo, and nothing else glows", () => {
  for (const h of hats) {
    const b = built.get(h)!;
    const lit: [number, number, number][] = [];
    for (let v = 0; v < b.pos.length / 3; v++) if (b.mat[v * 4] === MAT.glow) lit.push([b.pos[v * 3]!, b.pos[v * 3 + 1]!, b.pos[v * 3 + 2]!]);
    const g = glowOf(HATS[h].id);
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
  assert.deepEqual(hats.filter((h) => glowOf(HATS[h].id)), ["antenna", "halo"], "control: the two that glow");
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
