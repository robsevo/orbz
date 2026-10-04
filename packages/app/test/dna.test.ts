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
function growthProblems(before: number[], after: number[], trained: boolean[]): string[] {
  const out: string[] = [];
  const gained = after.reduce((s, v, i) => s + Math.max(0, v - before[i]!), 0);
  const gave = after.reduce((s, v, i) => s + Math.max(0, before[i]! - v), 0);
  if (gained > 0 && gained - gave <= 0) out.push("no net gain");
  if (gave > gained * 0.1 + 1e-9) out.push(`gave back ${gave.toFixed(1)} of ${gained.toFixed(1)}`);
  after.forEach((v, i) => {
    if (before[i]! - v > 2 + 1e-9) out.push(`${SKILL_NAMES[i]} lost ${(before[i]! - v).toFixed(1)}`);
    if (trained[i] && v < before[i]!) out.push(`${SKILL_NAMES[i]} was trained and went down`);
  });
  return out;
}

test("work grows an orb into its niche: more gained than given back, the most-worked area most", () => {
  assert.deepEqual([...SKILL_NAMES], [...SKILLS], "the same skills as the sheet");
  const c = surprise(7);
  const leans = sheetOf(c).leans;
  const radar = { finance: { xp: 1800 }, data: { xp: 600 }, research: { xp: 150 } };
  const g = grownOf(c, leans, radar, [{ word: "invoices" }]);
  const before = g.skills.map((k) => k.start);
  const after = g.skills.map((k) => k.value);
  const trained = SKILL_NAMES.map((n) => n === "Money" || n === "Data" || n === "Research");
  assert.deepEqual(growthProblems(before, after, trained), []);
  assert.equal(g.niche?.skill, "Money", "the area it works most in is its niche");
  const grew = (n: string): number => g.skills.find((k) => k.name === n)!.value - g.skills.find((k) => k.name === n)!.start;
  assert.ok(grew("Money") > grew("Data") && grew("Data") > grew("Research"), "and grows most");
  assert.deepEqual(traitProblems(g.traits.map((t) => t.value)), [], "the trait total holds through growth");
  assert.ok(g.moves.some((m) => m.why === "finance work"), "its traits drift with its work");
  assert.equal(grownSays(g), "Grown into money work, invoices above all.");
  // no work, no growth, nothing given back, nothing said
  const none = grownOf(c, leans, {});
  assert.deepEqual(none.skills.map((k) => k.value), before);
  assert.equal(grownSays(none), null);
  // controls: a give-back larger than the gain, a trained skill that fell, a loss past two points
  assert.ok(growthProblems([10, 10], [12, 7.5], [true, false]).some((p) => p.startsWith("gave back")));
  assert.ok(growthProblems([10, 10], [9, 10], [true, false]).includes("Planning was trained and went down"));
  assert.ok(growthProblems([10, 10, 10], [20, 7, 10], [true, false, false]).includes("Building lost 3.0"));
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
