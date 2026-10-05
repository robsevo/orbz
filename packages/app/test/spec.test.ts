// PLAN 2.2_t, the parts that are rules: every name is a person's name and none is borrowed, every
// voice has a name of ours, the same dice make the same orb, a personality brings what suits it,
// the sheet stays in range, Ash's bean keeps his numbers, and there is no mouth anywhere.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type HueName, HUES, MATERIALS } from "../src/design/tokens.ts";
import { ORB_FS } from "../src/orb/glsl.ts";
import {
  ASH, EYES, FAMILIES, FINISHES, GLASSES, GRADES, hatFit, HATS, inHarmony, isShades, lookOf, NOT_OURS, offered, outline, PEOPLE_NAMES, PERSONALITIES, sane, SHAPES, sheetOf, SPECIALTIES, surprise, voice, VOICES, wearing, wheelSteps, withPersonality,
  type Family, type GlassesName, type HatName, type PersonalityName, type ShapeName, type SpecialtyName,
} from "../src/orb/spec.ts";

test("names: people's names from our list, never the Dots film's own or an assistant's", () => {
  assert.deepEqual(PEOPLE_NAMES.filter((n) => NOT_OURS.includes(n)), [], "the list keeps out the names it must");
  for (let seed = 0; seed < 500; seed++) {
    const n = surprise(seed).name;
    assert.ok(PEOPLE_NAMES.includes(n) && !NOT_OURS.includes(n), `seed ${seed} named its orb ${n}`);
  }
  assert.ok(new Set(Array.from({ length: 200 }, (_, i) => surprise(i).name)).size > 40, "and plenty of them, not the same few");
});

/** What is wrong with a list of names: a repeat, a name that is not one plain word, one too long for a
 * title, or one that is also a colour, a finish, a shape or a personality's (it would read as a label). */
function nameProblems(names: readonly string[]): string[] {
  const words = new Set([...HUES.map((h) => h.name), ...Object.keys(FINISHES), ...Object.keys(SHAPES), ...Object.keys(PERSONALITIES)].map((w) => w.toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const k = n.toLowerCase();
    if (seen.has(k)) out.push(`${n} twice`);
    seen.add(k);
    if (!/^\p{Lu}\p{Ll}+$/u.test(n)) out.push(`${n} is not one plain word`);
    if (n.length > 9) out.push(`${n} is too long for a title`);
    if (words.has(k)) out.push(`${n} is also a look's name`);
  }
  return out;
}
test("names: hundreds to roll through, each once, plain, short, and never a look's name", () => {
  assert.deepEqual(nameProblems(PEOPLE_NAMES), []);
  assert.ok(PEOPLE_NAMES.length >= 500, `only ${PEOPLE_NAMES.length} names to roll`);
  // controls: each kind of problem is caught
  assert.deepEqual(nameProblems(["Milo", "Milo", "Mary Ann", "Bartholomew", "Coral"]), ["Milo twice", "Mary Ann is not one plain word", "Bartholomew is too long for a title", "Coral is also a look's name"]);
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

test("the character sheet: its traits are its DNA, leanings in 1..5, a title from both, the article right", () => {
  for (let seed = 0; seed < 100; seed++) {
    const c = surprise(seed);
    const sh = sheetOf(c);
    assert.equal(sh.traits.length, 7);
    assert.equal(sh.leans.length, 8);
    assert.deepEqual(sh.traits, sh.dna.traits, "the sheet's traits are the DNA's");
    for (const t of sh.leans) assert.ok(t.value >= 1 && t.value <= 5, `${t.name} ${t.value}`);
    assert.equal(Math.round(sh.leans.reduce((a, t) => a + t.value, 0) * 10), 240, "the web weighs 24 points, like every orb's");
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

test("a hat's colour and the frames' colour, like his own: each paints its own part, and only that", () => {
  const plain = lookOf({ ...ASH, hat: "top hat", glasses: "aviators" });
  const coral = HUES.find((h) => h.name === "coral")!.dark.map((v) => v / 255);
  const hat = lookOf({ ...ASH, hat: "top hat", glasses: "aviators", hatHue: "coral" });
  assert.deepEqual(hat.accCol, coral, "the hat's main part is coral");
  assert.deepEqual(hat.accCol2, plain.accCol2, "its trim keeps its colour");
  assert.deepEqual([hat.specsCol, hat.specsCol2, hat.lensCol], [plain.specsCol, plain.specsCol2, plain.lensCol], "the glasses are not touched");
  const frames = lookOf({ ...ASH, hat: "top hat", glasses: "aviators", glassesHue: "coral" });
  assert.deepEqual([frames.specsCol, frames.specsCol2], [coral, coral], "the frames (and a strap) are coral");
  assert.deepEqual(frames.lensCol, plain.lensCol, "the lenses keep their tint");
  assert.deepEqual(frames.accCol, plain.accCol, "the hat is not touched");
  assert.notDeepEqual(plain.accCol, coral, "control: a top hat is not coral on its own");
  // kept and read back: a colour there is stays, one there is not falls back, none is none
  assert.equal(sane({ ...ASH, hatHue: "coral" }, ASH).hatHue, "coral");
  assert.equal(sane({ ...ASH, hatHue: "chartreuse-ish" as never }, ASH).hatHue, null);
  assert.equal(sane({ ...ASH, glassesHue: null }, { ...ASH, glassesHue: "coral" }).glassesHue, null, "none, chosen, stays none");
  assert.equal(sane({ name: "Old" }, ASH).hatHue, null, "an orb kept before colours had them: their own");
});

test("a hat fits each shape the way it fits the bean it was drawn on", () => {
  const top = (n: ShapeName): number => outline(SHAPES[n], -Math.PI / 2);
  const bean = hatFit("bean");
  assert.ok(Math.abs(bean.seat - top("bean")) < 1e-9 && bean.size === 1, "control: on the bean every hat is where it was drawn");
  for (const n of ["star", "trio", "drop", "chick"] as const) {
    assert.ok(top(n) - hatFit(n).seat > 0.05, `${n}: the hat comes down over its point, not perched on the tip (${top(n).toFixed(3)} → ${hatFit(n).seat.toFixed(3)})`);
  }
  assert.ok(hatFit("heart").seat > top("heart") + 0.05, "a heart's hat sits on its lobes, not sunk in the notch");
  // a bunny's ears stand far above his head: the hat sits on his head, between them, not on their tips
  assert.ok(hatFit("bunny").seat < top("bunny") + 0.01 && hatFit("bunny").float > hatFit("bunny").seat + 0.2, "on his head between the ears; a halo over them");
  for (const n of Object.keys(SHAPES) as ShapeName[]) {
    const f = hatFit(n);
    assert.ok(f.size >= 0.9 && f.size <= 1, `${n}: a hat stays a hat's size (${f.size})`);
    assert.deepEqual(lookOf({ ...ASH, shape: n, hat: "beanie" }).accFit, [f.seat, f.size], `${n}: the fit reaches the shader`);
    assert.deepEqual(lookOf({ ...ASH, shape: n, hat: "halo" }).accFit, [f.float, f.size], `${n}: and a halo's`);
  }
});

test("the roster: five families, wide enough to staff an office, the real-life roles the owner named among them", () => {
  const all = Object.keys(SPECIALTIES) as SpecialtyName[];
  assert.ok(all.length >= 40, `${all.length} specialties`);
  for (const f of Object.keys(FAMILIES) as Family[]) assert.ok(all.filter((k) => SPECIALTIES[k].family === f).length >= 5, `${f} has a handful`);
  // owner, 10-01: an accountant (bills due), Excel and Office, a life coach, a dietitian, both at once, a personal trainer
  for (const k of ["accountant", "office", "coach", "dietitian", "health", "trainer", "research", "planning", "frontend", "backend", "fullstack", "general"]) assert.ok(k in SPECIALTIES, k);
  assert.match(SPECIALTIES.accountant.focus, /bill/, "the accountant keeps the bills, and their due dates");
  assert.match(SPECIALTIES.office.focus, /Excel/);
  for (const k of all) {
    const S = SPECIALTIES[k];
    assert.ok(S.hat in HATS && S.glasses in GLASSES, `${k} wears what exists`);
    assert.equal(S.lean.length, 8);
  }
  assert.equal(new Set(all.map((x) => SPECIALTIES[x].title)).size, all.length, "no two share a title");
  // a role a licence stands behind says so on his sheet, and the rest do not pretend to need it
  for (const k of ["accountant", "dietitian", "trainer", "health", "coach", "money", "paperwork", "investor", "crypto"] as SpecialtyName[]) assert.match((SPECIALTIES[k] as { limits?: string }).limits ?? "", /^Not a/, `${k} says what he is not`);
  assert.equal((SPECIALTIES.frontend as { limits?: string }).limits, undefined, "control: a builder needs no such line");
  // owner, 10-02: a quality assurance persona, a builder beside the Bug Hunter
  assert.deepEqual([SPECIALTIES.qa.family, SPECIALTIES.qa.title], ["build", "QA Lead"]);
  // owner, 10-02: an investor, and one for crypto; each says every trade is yours
  for (const k of ["investor", "crypto"] as SpecialtyName[]) assert.match((SPECIALTIES[k] as { limits?: string }).limits ?? "", /financial adviser[\s\S]*yours/, `${k}: not an adviser, and the trades are yours`);
  assert.ok(Object.keys(FINISHES).length >= 9 && Object.keys(HATS).length >= 30 && Object.keys(GLASSES).length >= 17, "more colours, hats and glasses to suit them");
});

test("eye styles are shapes, never expressions: a wink, a happy face and a doze are things an orb does", () => {
  for (const [k, e] of Object.entries(EYES)) {
    assert.equal(e.b[2], 0, `${k} is happy at rest: that is a hop's face, not a style`);
    assert.equal(e.b[3], 0, `${k} winks at rest: a wink is a gesture`);
  }
  for (const gone of ["wink", "happy", "sleepy", "ash"]) assert.ok(!(gone in EYES), `"${gone}" is not a style (owner, 10-01: plain names, and he must look alive)`);
  assert.ok("classic" in EYES, "Ash's own eyes, by a plain name");
  assert.ok(Object.values(PERSONALITIES).some((p) => (p.fidgets as readonly string[]).includes("wink")), "and some orbs wink, now and then");
});

test("the creator offers no voice Kokoro grades D or F; every personality speaks with offered ones; no voice is female or male", () => {
  for (const v of VOICES) {
    assert.doesNotMatch(v.accent, /female|male/, `${v.id}'s description says nothing of female or male: ${v.accent}`);
    if (/^[DF]/.test(GRADES[v.id] ?? "")) assert.equal(offered(v), false, `${v.id} (graded ${GRADES[v.id]}) is not offered`);
  }
  for (const v of VOICES.filter((x) => x.english && x.kokoro && x.id !== "ash")) assert.ok(v.id in GRADES, `${v.id} has Kokoro's grade, so it is not offered ungraded`);
  for (const [p, P] of Object.entries(PERSONALITIES)) {
    for (const id of P.voices) assert.ok(id === "ash" || offered(voice(id)), `${p} speaks with ${id}, an offered voice`);
  }
  for (let seed = 1; seed <= 200; seed++) assert.ok(offered(voice(surprise(seed).voice)), `surprise(${seed}) speaks with an offered voice`);
  assert.equal(offered(voice("af_nicole")), false, "Whisper is not offered: it whispers (owner, 10-03)");
  assert.equal(sane({ ...ASH, name: "Rex", personality: "brave", voice: "am_adam" }, ASH).voice, "am_adam", "an orb made with a voice no longer offered keeps it");
});

test("white and black for a hat and frames (owner, 10-03); every hat and pair of glasses has its drawing; no two share a number", () => {
  const look = lookOf({ ...ASH, hat: "top hat", hatHue: "white", glasses: "round", glassesHue: "black" });
  assert.deepEqual(look.accCol, [...MATERIALS.white].map((x) => x / 255), "a white hat is the tokens' white");
  assert.deepEqual([look.specsCol, look.specsCol2], [[...MATERIALS.black].map((x) => x / 255), [...MATERIALS.black].map((x) => x / 255)], "black frames, all of them");
  assert.equal(sane({ ...ASH, name: "Rex", hatHue: "white" }, ASH).hatHue, "white", "kept when the office loads him");
  assert.equal(sane({ ...ASH, name: "Rex", glassesHue: "black" }, ASH).glassesHue, "black");
  assert.equal(sane({ ...ASH, name: "Rex", hatHue: "silver" as never }, ASH).hatHue ?? null, ASH.hatHue ?? null, "a colour that is not one is not taken");
  // a hat's or glasses' number with no drawing in the shader draws nothing at all. Each is looked
  // for in its own function: hats and glasses both have an 18 to 21.
  const body = (head: string): string => {
    const at = ORB_FS.indexOf(head);
    assert.ok(at >= 0, `the shader has ${head}`);
    return ORB_FS.slice(at, ORB_FS.indexOf("\n}\n", at));
  };
  const hats = body("vec2 accSDF(vec2 q){"), specs = body("vec4 specsSDF(vec2 f){");
  for (const [name, h] of Object.entries(HATS)) if (h.id) assert.match(hats, new RegExp(`if \\(id == ${h.id}\\) \\{`), `${name} (${h.id}) is drawn`);
  const roundish = new Set([1, 11, 17]); // round, round shades and rose tint take the round lens
  for (const [name, g] of Object.entries(GLASSES)) if (g.id && !roundish.has(g.id)) assert.match(specs, new RegExp(`id == ${g.id}\\b`), `${name} (${g.id}) is drawn`);
  assert.doesNotMatch(specs, /id == 40\b/, "control: the glasses are read apart from the hats");
  const ids = (o: Record<string, { id: number }>) => Object.values(o).map((x) => x.id);
  assert.equal(new Set(ids(HATS)).size, ids(HATS).length, "no two hats share a number");
  assert.equal(new Set(ids(GLASSES)).size, ids(GLASSES).length, "no two glasses share a number");
});

test("every shape is its own: no two outlines alike (owner, 10-03: \"more shapes\", each one new)", () => {
  const names = Object.keys(SHAPES) as ShapeName[];
  const at = (n: ShapeName) => Array.from({ length: 72 }, (_, i) => SHAPES[n].d[1] * (1 + outline(SHAPES[n], -Math.PI + (i / 72) * 2 * Math.PI))); // (-π..π: his ears sit either side of -π/2)
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = at(names[i]!), b = at(names[j]!);
      const most = Math.max(...a.map((x, k) => Math.abs(x - b[k]!)));
      assert.ok(most > 0.03, `${names[i]} and ${names[j]} are the same outline (at most ${most.toFixed(3)} apart)`);
    }
  }
});

test("no pow of a base that can dip below zero, and a solid hat replaces what is under it (owner, 10-04: a black line through every hat)", () => {
  // GLSL leaves pow undefined below zero and a GPU makes it NaN, painted black: on the owner's card
  // |N.y| rounded a hair past 1 at the top of the head, and the hat's mix (col*0 + hat) kept the NaN
  const code = ORB_FS.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  const baseOf = (i: number): string => {
    let d = 0, j = i;
    for (; j < code.length; j++) {
      const ch = code[j];
      if (ch === "(") d++;
      else if (ch === ")") { if (d === 0) break; d--; }
      else if (ch === "," && d === 0) break;
    }
    return code.slice(i, j).trim();
  };
  const bases = [...code.matchAll(/\bpow\(/g)].map((m) => baseOf(m.index + 4));
  assert.ok(bases.length > 10, `control: the scan finds the shader's pows (${bases.length})`);
  const safe = (b: string): boolean => /^(max|clamp|smoothstep|exp)\(/.test(b);
  assert.deepEqual(bases.filter((b) => !safe(b)), [], "a pow's base that can go below zero");
  assert.ok(!safe("1.0 - abs(N.y)") && !safe("(a - 0.35)/0.55"), "control: the old bases are caught");
  assert.match(code, /col = aa >= 1\.0 \? c : mix\(col, c, aa\);/, "a solid hat replaces what is under it, a NaN too");
});

test("a roll's colours go together on the colour wheel, accessories too, and every kind turns up", () => {
  /** What clashes in an orb's colours: a gradient that is not analogous, an accessory off the scheme. */
  const clashes = (c: { hue: HueName; hue2: HueName | null; hatHue?: string | null; glassesHue?: string | null }): string[] => {
    const out: string[] = [];
    if (c.hue2 && !(inHarmony(c.hue, c.hue2) && wheelSteps(c.hue, c.hue2) <= 3)) out.push(`gradient ${c.hue} to ${c.hue2}`);
    for (const a of [c.hatHue, c.glassesHue]) if (a && a !== "white" && a !== "black" && !inHarmony(c.hue, a as HueName)) out.push(`${a} on ${c.hue}`);
    return out;
  };
  const seen = { hat: new Set<string>(), glasses: new Set<string>() };
  for (let seed = 0; seed < 600; seed++) {
    const c = surprise(seed);
    assert.deepEqual(clashes(c), [], `seed ${seed}`);
    if (c.hat === "none") assert.equal(c.hatHue, null, "no hat, no hat colour");
    seen.hat.add(c.hatHue === null ? "own" : c.hatHue === c.hue ? "his" : c.hatHue === "white" || c.hatHue === "black" ? "neutral" : "partner");
    seen.glasses.add(c.glassesHue === null ? "own" : c.glassesHue === c.hue ? "his" : c.glassesHue === "white" || c.glassesHue === "black" ? "neutral" : "partner");
  }
  assert.deepEqual([...seen.hat].sort(), ["his", "neutral", "own", "partner"], "a hat takes every kind of colour");
  assert.deepEqual([...seen.glasses].sort(), ["his", "neutral", "own", "partner"], "and so do the glasses");
  // controls: a muddy gradient, an accessory five steps off
  assert.deepEqual(clashes({ hue: "azure", hue2: "coral" }), ["gradient azure to coral"]);
  assert.deepEqual(clashes({ hue: "azure", hue2: null, hatHue: HUES[5]!.name }), [`${HUES[5]!.name} on azure`]);
  assert.ok(inHarmony("azure", HUES[12]!.name) && inHarmony("azure", HUES[8]!.name), "across, and a third round, go together");
});

test("a roll for the first orb is always an assistant; the dice decide the rest as they would", () => {
  for (let seed = 0; seed < 300; seed++) {
    const first = surprise(seed, { specialty: "assistant" });
    const any = surprise(seed);
    assert.equal(first.specialty, "assistant");
    assert.equal(first.hue, any.hue, "the same dice: the same colour");
    assert.equal(first.name, any.name, "and name");
  }
  assert.ok(new Set(Array.from({ length: 300 }, (_, s) => surprise(s).specialty)).size > 20, "control: without it, the dice pick from all of them");
});
