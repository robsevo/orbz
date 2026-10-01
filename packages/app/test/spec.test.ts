// PLAN 2.2_t, the parts that are rules: every name is a person's name and none is borrowed, every
// voice has a name of ours, the same dice make the same orb, a personality brings what suits it,
// the sheet stays in range, Ash's bean keeps his numbers, and there is no mouth anywhere.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ORB_FS } from "../src/orb/glsl.ts";
import {
  ASH, EYES, GLASSES, HATS, isShades, lookOf, NOT_OURS, PEOPLE_NAMES, PERSONALITIES, SHAPES, sheetOf, SPECIALTIES, surprise, VOICES, wearing, withPersonality,
  type GlassesName, type HatName, type PersonalityName,
} from "../src/orb/spec.ts";

test("names: people's names from our list, never the Dots film's own or an assistant's", () => {
  assert.deepEqual(PEOPLE_NAMES.filter((n) => NOT_OURS.includes(n)), [], "the list keeps out the names it must");
  for (let seed = 0; seed < 500; seed++) {
    const n = surprise(seed).name;
    assert.ok(PEOPLE_NAMES.includes(n) && !NOT_OURS.includes(n), `seed ${seed} named its orb ${n}`);
  }
  assert.ok(new Set(Array.from({ length: 200 }, (_, i) => surprise(i).name)).size > 40, "and plenty of them, not the same few");
});

test("voices: every one has a name of ours; no Kokoro label survives, and none is a fallback", () => {
  const labels = VOICES.map((v) => v.label);
  assert.equal(new Set(labels).size, labels.length, "no two voices share a name");
  for (const v of VOICES) {
    if (!v.kokoro || v.kokoro === "ash") continue;
    const theirs = v.kokoro.slice(3);
    assert.notEqual(v.label.toLowerCase(), theirs, `${v.kokoro} still goes by Kokoro's name`);
    assert.doesNotMatch(v.label, /\d|female|male/, `${v.kokoro} has a stand-in name: ${v.label}`);
  }
  assert.ok(VOICES.filter((v) => v.english && v.kokoro && v.kokoro !== "ash").length >= 28, "every English voice is offered");
  assert.ok(VOICES.some((v) => v.id === "silent") && VOICES.some((v) => v.id === "ash"));
});

test("the same dice make the same orb; different dice, different orbs", () => {
  assert.deepEqual(surprise(42), surprise(42));
  const distinct = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(surprise(i * 7919))));
  assert.ok(distinct.size >= 49, `50 rolls made only ${distinct.size} different orbs`);
});

test("a personality brings what suits it: a voice from its list, its eyes, its softness", () => {
  for (const p of Object.keys(PERSONALITIES) as PersonalityName[]) {
    const c = withPersonality({ ...ASH, name: "Oscar" }, p);
    assert.ok((PERSONALITIES[p].voices as readonly string[]).includes(c.voice) || c.voice !== "ash", `${p}: ${c.voice}`);
    assert.notEqual(c.voice, "ash", "only Ash speaks in Ash's own voice");
    assert.equal(c.eyes, PERSONALITIES[p].eyes);
    assert.equal(c.goo, PERSONALITIES[p].goo);
  }
  assert.equal(withPersonality(ASH, "steady").voice, "ash", "Ash himself keeps his");
});

test("the character sheet: traits and leanings in 1..5, a title from both, the article right", () => {
  for (let seed = 0; seed < 100; seed++) {
    const c = surprise(seed);
    const sh = sheetOf(c);
    assert.equal(sh.traits.length, 5);
    assert.equal(sh.leans.length, 8);
    for (const t of [...sh.traits, ...sh.leans]) assert.ok(t.value >= 1 && t.value <= 5 && Number.isInteger(t.value), `${t.name} ${t.value}`);
    assert.equal(sh.title, `the ${PERSONALITIES[c.personality].label} ${SPECIALTIES[c.specialty].title}`);
    assert.doesNotMatch(sh.bio, /\ba [aeiou]/i, sh.bio);
  }
  assert.match(sheetOf(ASH).bio, /^Ash is an azure glass bean/);
});

test("Ash's bean keeps his numbers exactly", () => {
  assert.deepEqual(lookOf(ASH).shapeA, [0.2, 0.11, 0.05, 0.95]);
  assert.equal(lookOf(ASH).shapeB[0], 0.03, "his one soft dent");
  assert.equal(lookOf(ASH).shapeD[1], 0.905, "his size");
  assert.deepEqual(lookOf(ASH).eyeA, [0.138, 1, 0.26, 0.1], "his eyes");
});

test("no mouth anywhere: not in the spec, and not in the shader's code (its comments say so, its code does not draw one)", () => {
  const keys = [...Object.keys(SHAPES), ...Object.keys(EYES), ...Object.keys(HATS), ...Object.keys(GLASSES), ...Object.keys(PERSONALITIES)];
  assert.deepEqual(keys.filter((k) => /\b(mouths?|smiles?|lips?|cheeks?|grins?)\b/i.test(k)), [], "(whole words: a star clip is not a lip)");
  const code = ORB_FS.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  assert.doesNotMatch(code, /mouth|smile|cheek|grin/i);
  assert.match(ORB_FS, /NO MOUTH/, "control: the scan reads the shader (the owner's rule is in its comments)");
});

test("a hat and glasses are two choices: both can be worn at once, and each reaches the shader", () => {
  const hats = Object.keys(HATS) as HatName[];
  const glasses = Object.keys(GLASSES) as GlassesName[];
  assert.ok(!hats.some((h) => /glasses|shades|monocle|goggles/.test(h)), "no glasses left among the hats");
  assert.equal(new Set(hats.map((h) => HATS[h].id)).size, hats.length, "every hat its own shape number");
  assert.equal(new Set(glasses.map((g) => GLASSES[g].id)).size, glasses.length, "every pair its own style number");
  for (const h of hats) {
    for (const g of glasses) {
      const look = lookOf({ ...ASH, hat: h, glasses: g });
      assert.equal(look.acc, HATS[h].id);
      assert.equal(look.specs, GLASSES[g].id);
    }
  }
  assert.ok(glasses.filter(isShades).length >= 3, "sunglasses among them (owner, 10-01: 'can also be sunglasses')");
  assert.equal(wearing({ hat: "beret", glasses: "round" }, "in"), " in a beret and round glasses");
  assert.equal(wearing({ hat: "antenna", glasses: "none" }, "with"), " with an antenna");
  assert.equal(wearing({ hat: "none", glasses: "aviators" }, "with"), " with aviators");
  assert.equal(wearing({ hat: "none", glasses: "none" }, "in"), "", "control: nothing on, nothing said");
  const rolled = Array.from({ length: 400 }, (_, i) => surprise(i * 31));
  assert.ok(rolled.some((c) => c.hat !== "none" && c.glasses !== "none"), "the dice put both on sometimes");
  assert.ok(rolled.some((c) => c.glasses === "none"), "and leave his eyes bare sometimes");
});
