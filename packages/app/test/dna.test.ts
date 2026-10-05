// PLAN 2.15_t: an orb's DNA. Every orb's traits add up to the same total whatever it is made of
// (owner, 10-04: "they all start with the same amount of weighed traits ... the weight and spread still
// becomes 10"); every option of every part moves something; a choice against its nature is a clash
// (calm and red, calm and headphones) and says so; no two rolled orbs share their DNA.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HUES } from "../src/design/tokens.ts";
import { CEILING, dnaOf, FLOOR, movesOf, NATURE, TOTAL, TRAITS } from "../src/orb/dna.ts";
import { ASH, type Character, EYES, FINISHES, GLASSES, HATS, sheetOf, SHAPES, surprise } from "../src/orb/spec.ts";
import { readStrand, shareOf, strandOf } from "../src/orb/strand.ts";

/** What is wrong with a set of traits: a total that is not TOTAL, or one past the floor or the ceiling. */
function traitProblems(values: number[]): string[] {
  const out: string[] = [];
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum !== TOTAL) out.push(`adds up to ${sum}, not ${TOTAL}`);
  values.forEach((v, i) => (v < FLOOR || v > CEILING ? out.push(`${TRAITS[i]} is ${v}`) : undefined));
  return out;
}

test("every nature adds up to the same total, and so does every orb, whatever it is made of", () => {
  for (const [p, row] of Object.entries(NATURE)) assert.deepEqual(traitProblems([...row]), [], p);
  for (let seed = 0; seed < 2000; seed++) {
    const c = surprise(seed);
    assert.deepEqual(traitProblems(dnaOf(c).traits.map((t) => t.value)), [], `seed ${seed}`);
  }
  // the most extreme orb we can dress: everything pulling the same way still adds up
  const loud: Character = { ...ASH, personality: "steady", hue: "coral", hue2: "teal", finish: "neon", hat: "party hat", glasses: "stars", hatHue: "rose", glassesHue: "black", goo: 1 };
  assert.deepEqual(traitProblems(dnaOf(loud).traits.map((t) => t.value)), []);
  // controls: a point added, a point lost, a trait through its floor
  const ok = dnaOf(ASH).traits.map((t) => t.value);
  assert.deepEqual(traitProblems(ok.map((v, i) => (i === 0 ? v + 1 : v))), [`adds up to ${TOTAL + 1}, not ${TOTAL}`]);
  assert.deepEqual(traitProblems(ok.map((v, i) => (i === 0 ? v - 1 : v))), [`adds up to ${TOTAL - 1}, not ${TOTAL}`]);
  assert.ok(traitProblems([1, ...ok.slice(1, -1), ok[0]! + ok.at(-1)! - 1]).includes("Pace is 1"));
});

test("every option of every part moves something, and says what it was", () => {
  const parts: [keyof Character, string[]][] = [["shape", Object.keys(SHAPES)], ["eyes", Object.keys(EYES)], ["hat", Object.keys(HATS)], ["glasses", Object.keys(GLASSES)], ["finish", Object.keys(FINISHES)], ["hue", HUES.map((h) => h.name)]];
  for (const [part, options] of parts) {
    for (const o of options) {
      const c = { ...ASH, [part]: o } as Character;
      const all = movesOf(c);
      const word = o === "none" ? (part === "hat" ? "no hat" : "no glasses") : o === "bean" ? "the bean" : o;
      assert.ok(all.some((m) => m.n >= 1 && m.why.includes(word)), `${part} ${o} moves nothing it names`);
    }
  }
  // the goo, a gradient and an accessory's colour count too
  assert.ok(movesOf({ ...ASH, goo: 1 }).some((m) => m.why === "all that goo" && m.to === "Humour"));
  assert.ok(movesOf({ ...ASH, goo: 0 }).some((m) => m.why === "a firm body" && m.to === "Focus"));
  assert.ok(movesOf({ ...ASH, hue2: "coral" }).some((m) => /gradient|opposites/.test(m.why)));
  assert.ok(movesOf({ ...ASH, hat: "beanie", hatHue: "black" }).some((m) => m.why === "the hat in black"));
});

test("calm and red clash, calm and blue do not; headphones on a calm orb take from its care", () => {
  const calm: Character = { ...ASH, personality: "steady" };
  const clashes = (c: Character): string[] => movesOf(c).filter((m) => m.clash).map((m) => m.why);
  assert.ok(clashes({ ...calm, hue: "coral" }).some((w) => w.startsWith("the coral on a calm orb")), "calm in coral");
  assert.ok(clashes({ ...calm, hue: "rose" }).some((w) => w.startsWith("the rose on a calm orb")), "calm in rose");
  assert.deepEqual(clashes({ ...calm, hue: "azure" }), [], "control: calm in azure is no clash");
  const phones = movesOf({ ...calm, hat: "headphones" }).filter((m) => m.clash);
  assert.ok(phones.some((m) => m.from === "Care" && m.to === "Focus"), "the headphones take care and give focus");
  assert.deepEqual(clashes({ ...calm, personality: "silly", hat: "headphones" }).filter((w) => w.includes("calm")), [], "control: on a lively orb it is not a calm clash");
  // and it shows: the calm orb in coral is quicker than the same orb in azure, by the same total
  const red = dnaOf({ ...calm, hue: "coral" }).traits;
  const blue = dnaOf({ ...calm, hue: "azure" }).traits;
  assert.ok(red.find((t) => t.name === "Pace")!.value > blue.find((t) => t.name === "Pace")!.value);
  assert.ok(red.find((t) => t.name === "Calm")!.value < blue.find((t) => t.name === "Calm")!.value);
});

test("no two rolled orbs share their DNA, and the bio says what made them", () => {
  const codes = new Set<string>();
  const shapes = new Set<string>();
  for (let seed = 0; seed < 2000; seed++) {
    const c = surprise(seed);
    const d = dnaOf(c);
    codes.add(strandOf(c));
    shapes.add(d.traits.map((t) => t.value).join(","));
  }
  assert.equal(codes.size, 2000, "a strand each");
  assert.ok(shapes.size > 1500, `only ${shapes.size} different spreads in 2000 orbs`);
  // the bio names the biggest clash
  const c: Character = { ...ASH, personality: "steady", hat: "headphones" };
  assert.match(sheetOf(c).bio, /The headphones on a calm orb: tunes out a little care, and tunes in focus\./);
  assert.match(sheetOf(ASH).bio, /Most of all: calm\./, "Ash, steady and azure, is calm above all");
});

// PLAN 3.11_t: growing into a niche, from earned XP only (owner, 10-04: "obviously get better over
// time ... learn well and have a niche ... take off somewhere else to add somewhere else ... but not
// too much of a difference either").
import { grownOf, grownSays, SKILL_NAMES } from "../src/orb/dna.ts";
import { SKILLS } from "../src/orb/spec.ts";

/** What is wrong with a growth: no net gain, a give-back over its share (a tenth of the gain, two
 * points a skill), or a skill that went down that its work trained. */
function growthProblems(before: number[], after: number[], trained: boolean[], each = 2): string[] {
  const out: string[] = [];
  const gained = after.reduce((s, v, i) => s + Math.max(0, v - before[i]!), 0);
  const gave = after.reduce((s, v, i) => s + Math.max(0, before[i]! - v), 0);
  if (gained > 0 && gained - gave <= 0) out.push("no net gain");
  if (gave > gained * 0.1 + 1e-9) out.push(`gave back ${gave.toFixed(1)} of ${gained.toFixed(1)}`);
  after.forEach((v, i) => {
    if (before[i]! - v > each + 1e-9) out.push(`${SKILL_NAMES[i]} lost ${(before[i]! - v).toFixed(1)}`);
    if (trained[i] && v < before[i]!) out.push(`${SKILL_NAMES[i]} was trained and went down`);
  });
  return out;
}

test("levels, Pokémon's way: XP brings a level; each level adds a point to its traits and half a point to its web, its niche most", async () => {
  const { levelOf, xpFor, TRAIT_PER_LEVEL, SKILL_PER_LEVEL, SKILL_TOTAL } = await import("../src/orb/dna.ts");
  // the curve: 1 at nothing, 2 at 4, 5 at 256, 10 at 2,916, never past 100, never back
  assert.deepEqual([0, 3, 4, 255, 256, 2915, 2916, 1e12].map((x) => levelOf(x).level), [1, 1, 2, 4, 5, 9, 10, 100]);
  for (let l = 1; l < 100; l++) assert.ok(xpFor(l + 1) > xpFor(l), `level ${l + 1} needs more than ${l}`);
  assert.deepEqual(SKILL_NAMES, SKILLS, "the same skills as the sheet");
  const c = surprise(7);
  const sheet = sheetOf(c);
  const radar = { finance: { xp: 1800 }, data: { xp: 600 }, research: { xp: 150 } };
  const g = grownOf(c, sheet.leans, radar, [{ word: "invoices" }]);
  const L = g.level.level;
  assert.equal(L, levelOf(2550).level);
  const before = g.skills.map((k) => k.start);
  const after = g.skills.map((k) => k.value);
  const trained = SKILL_NAMES.map((n) => n === "Money" || n === "Data" || n === "Research");
  assert.deepEqual(growthProblems(before, after, trained, 0.3), []);
  const web = after.reduce((a, b) => a + b, 0);
  assert.ok(web <= SKILL_TOTAL + SKILL_PER_LEVEL * (L - 1) + 0.05 && web >= SKILL_TOTAL + SKILL_PER_LEVEL * (L - 1) * 0.9 - 0.05, `the web grew by about ${SKILL_PER_LEVEL} a level (${web.toFixed(1)} at Lv. ${L})`);
  assert.equal(g.traits.reduce((a, t) => a + t.value, 0), TOTAL + TRAIT_PER_LEVEL * (L - 1), "a trait point a level, on the same total every orb began with");
  assert.equal(g.niche?.skill, "Money", "the area it works most in is its niche");
  const grew = (n: string): number => g.skills.find((k) => k.name === n)!.value - g.skills.find((k) => k.name === n)!.start;
  assert.ok(grew("Money") > grew("Data") && grew("Data") > grew("Research"), "and grows most");
  assert.ok(g.moves.some((m) => m.why === "finance work"), "its traits drift with its work");
  assert.equal(Object.values(g.last.traits).reduce((a, b) => a + b!, 0), TRAIT_PER_LEVEL, "its last level gave one trait point");
  assert.ok(Object.keys(g.last.skills).includes("Money"), "and some of its niche");
  assert.equal(grownSays(g), "Grown into money work, invoices above all.");
  // no work, no level, no change, nothing said
  const none = grownOf(c, sheet.leans, {});
  assert.equal(none.level.level, 1);
  assert.deepEqual(none.skills.map((k) => k.value), before);
  assert.deepEqual(none.traits.map((t) => t.value), sheet.dna.traits.map((t) => t.value));
  assert.equal(grownSays(none), null);
  // controls: a give-back larger than its share, a trained skill that fell, a loss past the limit
  assert.ok(growthProblems([3, 3], [4, 2.5], [true, false], 0.3).some((p) => p.startsWith("gave back")));
  assert.ok(growthProblems([3, 3], [2.9, 3], [true, false], 0.3).includes("Planning was trained and went down"));
  assert.ok(growthProblems([3, 3, 3], [6, 2.5, 3], [true, false, false], 0.3).includes("Building lost 0.5"));
});

test("a DNA strand makes the same orb again, name and traits and all; a typo is caught, not read as another", () => {
  for (let seed = 0; seed < 2000; seed++) {
    const c = surprise(seed);
    const read = readStrand(shareOf(c));
    assert.ok(read.ok, `seed ${seed}: ${!read.ok && read.why}`);
    const back = read.orb;
    assert.deepEqual({ ...back, goo: Math.round(back.goo * 100) }, { ...c, hatHue: c.hatHue ?? null, glassesHue: c.glassesHue ?? null, goo: Math.round(c.goo * 100) }, `seed ${seed}`);
    assert.deepEqual(dnaOf(back).traits, dnaOf(c).traits, "the same traits");
  }
  const c = surprise(3);
  const strand = strandOf(c);
  assert.match(strand, /^1[0-9A-Z]{3}(-[0-9A-Z]{4})+(-[0-9A-Z]{1,4})?$/, strand);
  assert.equal(strand.replace(/-/g, "").length, strandOf(ASH).replace(/-/g, "").length, "every strand the same length");
  // read case-blind, without its dashes, without its name (the name it is given then)
  const plainRead = readStrand(strand.toLowerCase().replace(/-/g, " "), "Nameless");
  assert.ok(plainRead.ok && plainRead.orb.name === "Nameless" && plainRead.orb.hat === c.hat);
  // controls: every one-letter typo and every swap of two neighbours is caught
  const flat = strand.replace(/-/g, "");
  const ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let caught = 0;
  let tried = 0;
  for (let i = 1; i < flat.length; i++) {
    for (const ch of ALPHA) {
      if (ch === flat[i]) continue;
      tried++;
      if (!readStrand(flat.slice(0, i) + ch + flat.slice(i + 1)).ok) caught++;
    }
  }
  assert.equal(caught, tried, `${tried - caught} of ${tried} one-letter typos read as another orb`);
  for (let i = 1; i < flat.length - 1; i++) {
    if (flat[i] === flat[i + 1]) continue;
    const swapped = flat.slice(0, i) + flat[i + 1] + flat[i] + flat.slice(i + 2);
    assert.equal(readStrand(swapped).ok, false, `a swap at ${i} read as another orb`);
  }
  assert.equal(readStrand("").ok, false);
  assert.equal(readStrand(`2${flat.slice(1)}`).ok, false, "a newer version is refused, not misread");
});

test("the skills web is weighed like the traits: 24 points for every orb, pulled by its traits", async () => {
  const { leansOf, SKILL_TOTAL } = await import("../src/orb/dna.ts");
  const { SPECIALTIES } = await import("../src/orb/spec.ts");
  const still = (): number => 0.5; // no dice
  const traits = (over: Partial<Record<string, number>>) => TRAITS.map((name) => ({ name, value: over[name] ?? 10, nature: 10 }));
  for (const [k, sp] of Object.entries(SPECIALTIES)) {
    const web = leansOf(sp.lean, traits({}), still);
    assert.equal(Math.round(web.reduce((a, s) => a + s.value, 0) * 10), SKILL_TOTAL * 10, `${k} weighs ${SKILL_TOTAL}`);
    assert.ok(web.every((s) => s.value >= 1 && s.value <= 5), k);
  }
  const lean = SPECIALTIES.general.lean;
  const research = (t: ReturnType<typeof traits>) => leansOf(lean, t, still).find((s) => s.name === "Research")!.value;
  const care = (t: ReturnType<typeof traits>) => leansOf(lean, t, still).find((s) => s.name === "Care")!.value;
  assert.ok(research(traits({ Curiosity: 16, Focus: 4 })) > research(traits({ Curiosity: 4, Focus: 16 })), "curiosity pulls toward research");
  assert.ok(care(traits({ Care: 17, Nerve: 3 })) > care(traits({ Care: 3, Nerve: 17 })), "care pulls toward care");
  assert.deepEqual(leansOf(lean, traits({ Calm: 14, Pace: 6 }), still), leansOf(lean, traits({ Calm: 14, Pace: 6 }), still), "control: the same traits, the same web");
  // and on the card: the same orb, two hats, two webs, the same weight
  const a = sheetOf({ ...ASH, hat: "wizard hat" }).leans;
  const b = sheetOf({ ...ASH, hat: "eyeshade" }).leans;
  assert.notDeepEqual(a, b, "a change of traits changes the web");
  assert.equal(Math.round(a.reduce((x, s) => x + s.value, 0) * 10), Math.round(b.reduce((x, s) => x + s.value, 0) * 10));
});
