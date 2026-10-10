// PLAN 2.20_t, any colour for an orb and what it wears, a Dark orb, its DNA in hex (owner, 10-08: "We also want to be
// able to choose a bit more colors for our orbs and accessories. DNA should go with hex if possible. a lot more
// possibilities. and also a black version, but call it dark lol"). By code, no browser:
//   - the 24 are drawn exactly as they were, under every finish; any colour's glass lands on its hue, and its
//     lightness follows; Dark is dark glass, its eyes light, under every finish;
//   - any colour's traits are its nearest hue's; a hat or frames in any colour count as their nearest hue;
//   - every strand made before reads and is made the same (two of 10-08's pinned, white and black hats); the first
//     version's colours are written out, not built from the 24; a second-version strand carries Dark and the four
//     colours and comes back whole; every one-letter typo and every swap of neighbours is caught;
//   - a look read back keeps a colour that is one and drops one that is not.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HUES } from "../src/design/tokens.ts";
import { glassOf, hexOf, nearestHue } from "../src/orb/colour.ts";
import { dnaOf } from "../src/orb/dna.ts";
import { ASH_TURN, ORB_TURNS, tintHue } from "../src/orb/hues.ts";
import { ASH, DARK_GLASS, FINISHES, finishOf, sane, surprise, type Character, type FinishName } from "../src/orb/spec.ts";
import { readStrand, shareOf, STRAND_HUES, strandOf } from "../src/orb/strand.ts";
import { hex } from "../src/design/color.ts";

const wrap = (d: number): number => ((d + 540) % 360) - 180;
const dice = (seed: number): (() => number) => {
  let x = seed >>> 0 || 1;
  return () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 2 ** 32);
};
const anyColour = (r: () => number): string => `#${Math.floor(r() * 2 ** 24).toString(16).padStart(6, "0")}`;

test("the 24 are drawn as they always were under every finish; any colour's glass lands on its hue, its lightness followed; Dark is dark glass with light eyes", () => {
  for (const h of HUES) {
    for (const f of Object.keys(FINISHES) as FinishName[]) {
      const F: { sat: number; val: number } = FINISHES[f];
      const got = finishOf({ ...ASH, hue: h.name, finish: f });
      assert.deepEqual([got.turn, got.sat, got.val, got.turn2, got.grad], [ORB_TURNS[h.name], F.sat, F.val, ORB_TURNS[h.name], 0], `${h.name}, ${f}`);
    }
  }
  assert.equal(ORB_TURNS.azure, ASH_TURN, "Ash keeps his 200°");
  // any colour, strong enough to have a hue: its resting tint sits as far round from Ash's as the colour from azure
  const r = dice(20);
  let tried = 0;
  for (let i = 0; i < 400 && tried < 120; i++) {
    const c = anyColour(r);
    const g = glassOf(c);
    const { h, C } = hueOf(c);
    if (C < 0.06) continue; // a near-grey has no hue to land on
    tried++;
    const off = wrap(tintHue(g.turn) - tintHue(ASH_TURN));
    assert.ok(Math.abs(wrap(off - (h - HUES[0]!.angle))) <= 1.5, `${c}: its tint ${off.toFixed(1)}° round, the colour ${wrap(h - HUES[0]!.angle).toFixed(1)}°`);
  }
  assert.ok(tried >= 100, `control: enough colours with a hue (${tried})`);
  // lightness followed: a darker colour of a hue, darker glass; a grey has no colour
  assert.ok(glassOf("#2a1a50").val < glassOf("#9a7ae0").val, "the darker, the darker glass");
  assert.ok(glassOf("#808080").sat < 0.001, "a grey is grey glass");
  // Dark: under every finish, little colour and dark enough that the shader's eyes are light (under 0.45)
  for (const f of Object.keys(FINISHES) as FinishName[]) {
    const d = finishOf({ ...ASH, hue: "dark", finish: f });
    assert.ok(d.val < 0.45 && d.sat <= FINISHES[f].sat * DARK_GLASS.sat + 1e-9, `dark, ${f}: val ${d.val.toFixed(2)}, sat ${d.sat.toFixed(2)}`);
  }
  // a gradient in any colour turns its second colour to that colour's hue
  const grad = finishOf({ ...ASH, hue: "azure", hue2: "cyan", tint2: "#ff3060" });
  assert.equal(grad.grad, 1);
  assert.equal(grad.turn2, glassOf("#ff3060").turn);
});

const hueOf = (c: string): { h: number; C: number } => {
  // the colour's OKLCH hue and strength, as colour.ts reads them
  const n = Number.parseInt(c.slice(1), 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
  const [R, G, B] = lin as [number, number, number];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360, C: Math.hypot(a, b) };
};

test("any colour's traits are its nearest hue's; a hat or frames in any colour count as their nearest; each of the 24 is its own nearest", () => {
  for (const h of HUES) assert.equal(nearestHue(hex(h.dark)), h.name, `${h.name} is its own nearest`);
  const r = dice(7);
  for (let i = 0; i < 200; i++) {
    const base = surprise(Math.floor(r() * 200_000));
    const tint = anyColour(r);
    const tinted: Character = { ...base, hue: nearestHue(tint), tint, hat: "beanie", hatTint: anyColour(r) };
    const named: Character = { ...base, hue: nearestHue(tint), hat: "beanie", hatHue: nearestHue(tinted.hatTint!) };
    assert.deepEqual(dnaOf(tinted).traits, dnaOf(named).traits, `${tint} on seed ${base.seed}`);
  }
  // Dark has a move of its own (control: its traits are not azure's)
  const dark = dnaOf({ ...ASH, hue: "dark" }).traits;
  assert.notDeepEqual(dark, dnaOf(ASH).traits);
});

test("every strand made before reads and is made the same; a second-version strand carries Dark and any colour whole; typos and swaps are caught", () => {
  // two strands made on 10-08, before any colour (white and black on the first)
  const basil: Character = { ...surprise(4242), name: "Basil", hat: "beanie", hatHue: "white", glasses: "round", glassesHue: "black" };
  assert.equal(shareOf(basil), "Basil · 12BW-JRVY-RAG9-BQT1-RNC9-Z");
  const read = readStrand("Basil · 12BW-JRVY-RAG9-BQT1-RNC9-Z");
  assert.ok(read.ok);
  assert.deepEqual([read.orb.hue, read.orb.hatHue, read.orb.glassesHue, read.orb.seed], ["citron", "white", "black", 808329]);
  assert.equal(strandOf({ ...surprise(77), name: "Wren", hatHue: null, glassesHue: null, hue2: "teal" }), "124X-21SV-KVMB-ZFDN-MRP9-J");
  assert.deepEqual([...STRAND_HUES], HUES.map((h) => h.name), "the first version's colours, written out, are today's 24");
  // the second version: Dark and each colour chosen as any colour, back whole
  const r = dice(31);
  for (let i = 0; i < 300; i++) {
    const c: Character = { ...surprise(Math.floor(r() * 200_000)), name: "Inky", hat: "beanie", glasses: "round" };
    const o: Character = { ...c, ...(r() < 0.3 ? { hue: "dark" as const } : {}), ...(r() < 0.6 && { tint: anyColour(r) }), ...(r() < 0.4 && { tint2: anyColour(r), hue2: c.hue2 ?? "teal" }), ...(r() < 0.5 && { hatTint: anyColour(r) }), ...(r() < 0.5 && { glassesTint: anyColour(r) }) };
    const s = strandOf(o);
    const plain = o.hue !== "dark" && !o.tint && !o.tint2 && !o.hatTint && !o.glassesTint;
    assert.equal(s[0], plain ? "1" : "2", `an orb of the 24 alone keeps the first version: ${s}`);
    const back = readStrand(s, "Inky");
    assert.ok(back.ok, `${s}: ${!back.ok && back.why}`);
    for (const k of ["hue", "hue2", "tint", "tint2", "hatTint", "glassesTint", "hat", "glasses", "seed"] as const) assert.equal(back.orb[k] ?? null, o[k] ?? null, `${k} of ${s}`);
    assert.equal(strandOf(back.orb), s, "made again, the same strand");
  }
  // controls on one with all four colours: every one-letter typo and every swap of neighbours is caught
  const all = strandOf({ ...ASH, hue: "dark", tint: "#7a3fe0", tint2: "#10ff80", hue2: "mint", hat: "beanie", hatTint: "#000001", glasses: "round", glassesTint: "#ffffff" }).replace(/-/g, "");
  const ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let tried = 0;
  let caught = 0;
  for (let i = 1; i < all.length; i++) {
    for (const ch of ALPHA) {
      if (ch === all[i]) continue;
      tried++;
      if (!readStrand(all.slice(0, i) + ch + all.slice(i + 1)).ok) caught++;
    }
  }
  assert.equal(caught, tried, `${tried - caught} of ${tried} one-letter typos read as another orb`);
  for (let i = 1; i < all.length - 1; i++) {
    if (all[i] === all[i + 1]) continue;
    assert.equal(readStrand(all.slice(0, i) + all[i + 1] + all[i] + all.slice(i + 2)).ok, false, `a swap at ${i}`);
  }
  assert.equal(readStrand(all.slice(0, -6) + all.slice(-1)).ok, false, "a strand cut short does not read");
});

test("a look read back keeps a colour that is one and drops one that is not; Dark is kept", () => {
  const kept = sane({ ...ASH, hue: "dark", tint: "#7A3FE0", tint2: "nope", hatTint: "7a3fe0", glassesTint: 12 as unknown as string }, ASH);
  assert.equal(kept.hue, "dark");
  assert.equal(kept.tint, "#7a3fe0", "kept, in one spelling");
  assert.equal(kept.hatTint, "#7a3fe0", "with or without its #");
  assert.equal("tint2" in kept, false, "not a colour: dropped");
  assert.equal("glassesTint" in kept, false);
  assert.equal(sane({ ...ASH, hue: "mauve" as never }, ASH).hue, ASH.hue, "control: an unknown name falls back");
  assert.deepEqual([hexOf("#ABCDEF"), hexOf("abcdef"), hexOf("#abcd"), hexOf(null)], ["#abcdef", "#abcdef", null, null]);
});
