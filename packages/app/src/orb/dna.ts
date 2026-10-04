// An orb's DNA (PLAN 2.15; owner, 10-04: "the accesories define their traits also, for ex if theyre
// calm and theyre wearing headphones, its a trait mixup so care goes down by a bit but something else
// goes up ... the user never loses, just changes their traits ... no orb has the same dna in the end,
// colors affect it too, if its calm then red for example is a clash ... the gradients etc, in the end
// everything affects everything", "shape too and amount of goo affects things, everything", and "they
// all start with the same amount of weighed traits ... the weight and spread still becomes 10").
//
// Every orb has the same TOTAL of trait points. Its personality spreads them (each personality's
// nature adds up to TOTAL). Then every choice in the creator moves a few points from one trait to
// another, never adding or taking away: the shape, the goo, the colour and a gradient's second one,
// the finish, the eyes, the hat, the glasses, and the colour of each. A choice against the orb's
// nature (a calm orb in a hot red, in headphones) is a clash: it moves more, and says why. The dice
// add a little of their own. Pure: the same choices and seed give the same DNA.
import { HUES, type HueName } from "../design/tokens.ts";
import type { Character, EyesName, FinishName, GlassesName, HatName, PersonalityName, ShapeName } from "./spec.ts";

export const TRAITS = ["Pace", "Care", "Curiosity", "Humour", "Focus", "Calm", "Nerve"] as const;
export type Trait = (typeof TRAITS)[number];
/** What every orb's traits add up to, before and after everything it is. */
export const TOTAL = 70;
/** No trait goes below or above these: a move takes only what is there to take. */
export const FLOOR = 2;
export const CEILING = 18;

/** Each personality's nature, in TRAITS order; every row adds up to TOTAL. */
export const NATURE: Record<PersonalityName, readonly [number, number, number, number, number, number, number]> = {
  steady: [9, 11, 9, 6, 13, 14, 8],
  cheerful: [12, 12, 10, 13, 8, 7, 8],
  sleepy: [4, 14, 9, 11, 9, 18, 5],
  curious: [12, 9, 16, 10, 9, 7, 7],
  shy: [7, 15, 11, 7, 12, 14, 4],
  grumpy: [9, 8, 7, 9, 15, 7, 15],
  dapper: [9, 14, 9, 7, 12, 11, 8],
  dreamy: [6, 10, 16, 10, 6, 13, 9],
  brave: [12, 9, 10, 8, 9, 7, 15],
  silly: [12, 9, 11, 17, 5, 8, 8],
  wise: [6, 14, 12, 6, 14, 13, 5],
  sassy: [12, 6, 9, 15, 9, 7, 12],
  cozy: [6, 16, 9, 10, 8, 15, 6],
  techy: [11, 8, 12, 6, 16, 9, 8],
  quiet: [8, 11, 10, 4, 15, 15, 7],
};

/** Calm, lively or sharp by nature: what a clash is measured against. */
type Temper = "calm" | "lively" | "sharp";
const TEMPER: Record<PersonalityName, Temper> = {
  steady: "calm", sleepy: "calm", shy: "calm", cozy: "calm", wise: "calm", quiet: "calm", dapper: "calm", dreamy: "calm",
  cheerful: "lively", silly: "lively", brave: "lively", sassy: "lively", curious: "lively",
  techy: "sharp", grumpy: "sharp",
};
/** What a choice feels like, where it has a feel: a hot colour, something loud, soft, bold, cool, or tuned out. */
type Vibe = "hot" | "cool" | "loud" | "soft" | "bold" | "tuned";

/** One move: `n` points from one trait to another, and what made it. */
export type Move = { from: Trait; to: Trait; n: number; why: string; clash?: boolean };
/** A choice's own move, written "From>To n vibe". */
type Spec = `${Trait}>${Trait} ${number}` | `${Trait}>${Trait} ${number} ${Vibe}`;

const SHAPE: Record<ShapeName, Spec> = {
  bean: "Nerve>Calm 1", pebble: "Pace>Calm 2 soft", egg: "Nerve>Curiosity 1", moon: "Pace>Curiosity 2 cool", squish: "Focus>Humour 2 soft",
  drop: "Nerve>Calm 1 cool", cloud: "Pace>Calm 2 soft", ghost: "Nerve>Curiosity 2", drip: "Focus>Humour 1", teddy: "Nerve>Care 2 soft",
  cub: "Calm>Pace 1", kitty: "Care>Curiosity 2", bunny: "Calm>Pace 2", chick: "Focus>Care 1 soft", heart: "Focus>Care 3 soft",
  star: "Calm>Nerve 2 bold", trio: "Focus>Humour 2 loud", squircle: "Humour>Focus 2", blob: "Focus>Humour 2 soft", pear: "Pace>Care 1",
  fox: "Care>Curiosity 2", owl: "Pace>Focus 2", sun: "Calm>Pace 2 hot", pill: "Humour>Focus 1", flower: "Nerve>Care 2 soft",
  gem: "Humour>Focus 2 bold", jelly: "Focus>Humour 2", lemon: "Calm>Humour 1",
};
const EYES: Record<EyesName, Spec> = {
  classic: "Nerve>Calm 1", big: "Focus>Curiosity 2", huge: "Calm>Curiosity 2", ovals: "Pace>Care 1", beans: "Care>Humour 1",
  dots: "Humour>Focus 2", tiny: "Curiosity>Focus 1", droopy: "Pace>Calm 2", wide: "Calm>Pace 1", close: "Curiosity>Focus 2",
  low: "Pace>Care 1", button: "Nerve>Humour 1", tall: "Calm>Nerve 1", high: "Care>Curiosity 1", almond: "Humour>Nerve 1",
};
const HAT: Record<HatName, Spec> = {
  none: "Pace>Calm 1", "top hat": "Humour>Focus 2 bold", beanie: "Nerve>Calm 2 soft", "party hat": "Focus>Humour 3 loud", antenna: "Calm>Curiosity 2",
  sprout: "Nerve>Care 2 soft", bow: "Nerve>Care 1 soft", crown: "Care>Nerve 3 bold", headphones: "Care>Focus 2 tuned", cap: "Calm>Pace 1",
  "wizard hat": "Focus>Curiosity 2", halo: "Nerve>Care 3 soft", flower: "Pace>Care 1 soft", horns: "Care>Humour 2 bold", "bunny ears": "Focus>Humour 2 loud",
  "chef hat": "Pace>Care 2", "grad cap": "Humour>Focus 2", "cowboy hat": "Calm>Nerve 2 bold", propeller: "Focus>Humour 3 loud", "star clip": "Calm>Humour 1 loud",
  beret: "Focus>Curiosity 2", "hard hat": "Humour>Focus 1", "bucket hat": "Focus>Calm 1 soft", eyeshade: "Humour>Focus 2", headset: "Focus>Care 1",
  sweatband: "Calm>Pace 2 hot", apple: "Pace>Curiosity 1", "straw hat": "Pace>Calm 2 soft", fedora: "Care>Nerve 1 bold", deerstalker: "Humour>Curiosity 2",
  "sun visor": "Calm>Pace 1 hot", "flower crown": "Nerve>Care 2 soft", "viking helmet": "Calm>Nerve 3 bold", bowler: "Humour>Care 1", fez: "Focus>Humour 2 loud",
  tricorn: "Care>Nerve 2 bold", "Santa hat": "Focus>Care 2 loud", sombrero: "Focus>Humour 2 loud", tiara: "Calm>Nerve 1 bold", antlers: "Calm>Curiosity 1",
  "unicorn horn": "Focus>Curiosity 3 loud",
};
const GLASSES: Record<GlassesName, Spec> = {
  none: "Nerve>Pace 1", round: "Pace>Curiosity 1", square: "Humour>Focus 1", "cat-eye": "Care>Humour 2 bold", "big round": "Pace>Curiosity 2",
  reading: "Pace>Focus 2", monocle: "Humour>Focus 2 bold", hearts: "Focus>Care 3 soft", stars: "Focus>Humour 2 loud", aviators: "Calm>Nerve 2 bold",
  shades: "Care>Nerve 2 tuned", "round shades": "Care>Calm 2 tuned", goggles: "Calm>Curiosity 2", visor: "Humour>Focus 2", rectangle: "Humour>Focus 1",
  "half-rims": "Pace>Focus 1", sport: "Calm>Pace 2 hot", "rose tint": "Nerve>Care 2 soft", oval: "Nerve>Calm 1", hexagon: "Calm>Curiosity 1",
  "bold round": "Care>Nerve 1 bold", butterfly: "Focus>Humour 2 loud",
};
const FINISH: Record<FinishName, Spec> = {
  glass: "Nerve>Calm 1", pearl: "Pace>Care 2 soft", smoke: "Humour>Curiosity 2 cool", black: "Humour>Nerve 2 bold", grey: "Curiosity>Focus 2 cool",
  pastel: "Nerve>Care 2 soft", deep: "Pace>Focus 2", neon: "Calm>Pace 3 loud", frost: "Care>Calm 2 cool",
};
/** A colour's own move; the reds and oranges run hot, the blues and greens cool. */
const HUE: Record<HueName, Spec> = {
  azure: "Nerve>Calm 1 cool", cornflower: "Pace>Care 1 cool", iris: "Pace>Curiosity 1 cool", lavender: "Nerve>Calm 2 soft", violet: "Focus>Curiosity 2",
  plum: "Humour>Focus 1", orchid: "Focus>Curiosity 1 loud", pink: "Nerve>Care 2 soft", rose: "Calm>Nerve 2 hot", blush: "Nerve>Care 1 soft",
  coral: "Calm>Pace 2 hot", apricot: "Calm>Humour 1 hot", amber: "Calm>Pace 2 hot", marigold: "Focus>Humour 2 hot", honey: "Nerve>Care 1",
  citron: "Calm>Humour 2 loud", lime: "Calm>Pace 1 loud", clover: "Nerve>Care 1", leaf: "Pace>Calm 1", jade: "Pace>Focus 1",
  mint: "Nerve>Calm 2 cool", seafoam: "Pace>Calm 2 cool", teal: "Humour>Focus 1 cool", cyan: "Calm>Curiosity 1 cool",
};
/** What a clash moves: a choice whose feel goes against the orb's nature. */
const CLASH: Partial<Record<Temper, Partial<Record<Vibe, { from: Trait; to: Trait; n: number; says: string }>>>> = {
  calm: {
    hot: { from: "Calm", to: "Pace", n: 2, says: "quicker off the mark than most calm orbs" },
    loud: { from: "Calm", to: "Humour", n: 2, says: "lets more jokes out than most calm orbs" },
    tuned: { from: "Care", to: "Focus", n: 2, says: "tunes out a little care, and tunes in focus" },
    bold: { from: "Care", to: "Nerve", n: 1, says: "braver than it looks" },
  },
  lively: {
    cool: { from: "Pace", to: "Calm", n: 2, says: "steadier than most lively orbs" },
    soft: { from: "Nerve", to: "Care", n: 2, says: "kinder than most lively orbs" },
    tuned: { from: "Humour", to: "Focus", n: 1, says: "fewer jokes, more done" },
  },
  sharp: {
    loud: { from: "Focus", to: "Humour", n: 2, says: "lighter than most sharp orbs" },
    soft: { from: "Nerve", to: "Care", n: 2, says: "softer than it lets on" },
    hot: { from: "Calm", to: "Nerve", n: 1, says: "a shorter fuse than most" },
  },
};

const read = (spec: Spec): { from: Trait; to: Trait; n: number; vibe: Vibe | null } => {
  const [pair, n, vibe] = spec.split(" ");
  const [from, to] = pair!.split(">") as [Trait, Trait];
  return { from, to, n: Number(n), vibe: (vibe as Vibe | undefined) ?? null };
};
const hueIndex = (h: HueName): number => HUES.findIndex((x) => x.name === h);

/** Every choice the orb is made of, as moves with their reasons, in the order they are applied; the
 * clashes after the choices that cause them. */
export function movesOf(c: Character): Move[] {
  const temper = TEMPER[c.personality];
  const out: Move[] = [];
  const add = (spec: Spec, why: string, scale = 1): void => {
    const m = read(spec);
    const n = Math.max(1, Math.round(m.n * scale));
    out.push({ from: m.from, to: m.to, n, why });
    const clash = m.vibe ? CLASH[temper]?.[m.vibe] : undefined;
    if (clash) out.push({ from: clash.from, to: clash.to, n: clash.n, why: `${why} on a ${temper} orb: ${clash.says}`, clash: true });
  };
  add(SHAPE[c.shape], c.shape === "bean" ? "the bean" : `the ${c.shape} shape`);
  add(HUE[c.hue], `the ${c.hue}`);
  if (c.hue2 && c.hue2 !== c.hue) {
    // a gradient: its second colour at half weight, and how far apart the two are
    add(HUE[c.hue2], `the ${c.hue2} in the gradient`, 0.5);
    const d = Math.abs(hueIndex(c.hue) - hueIndex(c.hue2));
    const apart = Math.min(d, HUES.length - d);
    if (apart <= 2) add("Pace>Calm 1", "a gentle gradient");
    else if (apart <= 6) add("Focus>Curiosity 2", "a two-colour gradient");
    else add("Calm>Curiosity 2 loud", `${c.hue} into ${c.hue2}, opposites`);
  }
  add(FINISH[c.finish], `the ${c.finish} finish`);
  add(EYES[c.eyes], `the ${c.eyes} eyes`);
  add(HAT[c.hat], c.hat === "none" ? "no hat" : `the ${c.hat}`);
  add(GLASSES[c.glasses], c.glasses === "none" ? "no glasses" : `the ${c.glasses} glasses`);
  // an accessory's colour: its own (nothing more), his own (a match), white, black, or another colour
  for (const [part, hue, on] of [["hat", c.hatHue, c.hat !== "none"], ["glasses", c.glassesHue, c.glasses !== "none"]] as const) {
    if (!on || !hue) continue;
    if (hue === c.hue) add("Nerve>Calm 1", `the ${part} matching`);
    else if (hue === "white") add("Nerve>Care 1 soft", `the ${part} in white`);
    else if (hue === "black") add("Care>Nerve 1 bold", `the ${part} in black`);
    else add(HUE[hue], `the ${part} in ${hue}`);
  }
  // the goo: soft and gooey is lighter, firm is more focused
  const goo = Math.round((Math.round(c.goo * 100) / 100 - 0.5) * 6); // in hundredths, as the slider and a strand keep it
  if (goo > 0) add(`Focus>Humour ${goo}` as Spec, "all that goo");
  else if (goo < 0) add(`Humour>Focus ${-goo}` as Spec, "a firm body");
  else add("Nerve>Calm 1", "middling goo");
  return out;
}

const rng = (seed: number): (() => number) => {
  let x = (Math.abs(Math.floor(seed * 7919)) % 2147483646) + 1;
  return () => (x = (x * 48271) % 2147483647) / 2147483647;
};

export type Dna = {
  /** Each trait now, in TRAITS order; they add up to TOTAL. */
  traits: { name: Trait; value: number; nature: number }[];
  /** What moved them, as applied (a move cut short by a floor or a ceiling says the points it moved). */
  moves: Move[];
};

/** Moves `m` as far as the floor and the ceiling let it; the points actually moved. */
function apply(v: number[], m: { from: Trait; to: Trait; n: number }): number {
  const f = TRAITS.indexOf(m.from);
  const t = TRAITS.indexOf(m.to);
  const n = Math.max(0, Math.min(m.n, v[f]! - FLOOR, CEILING - v[t]!));
  v[f] = v[f]! - n;
  v[t] = v[t]! + n;
  return n;
}

/** The orb's DNA: its nature, everything it is made of, and its dice. */
export function dnaOf(c: Character): Dna {
  const nature = [...NATURE[c.personality]];
  const v = [...nature];
  const moves: Move[] = [];
  for (const m of movesOf(c)) {
    const n = apply(v, m);
    if (n > 0) moves.push({ ...m, n });
  }
  // the dice: three single points, its own
  const r = rng(c.seed + 1);
  for (let i = 0; i < 3; i++) {
    const from = TRAITS[Math.floor(r() * TRAITS.length)]!;
    const to = TRAITS[Math.floor(r() * TRAITS.length)]!;
    if (from !== to && apply(v, { from, to, n: 1 })) moves.push({ from, to, n: 1, why: "the dice" });
  }
  return { traits: TRAITS.map((name, i) => ({ name, value: v[i]!, nature: nature[i]! })), moves };
}

/** What the mix comes to, in a sentence or two: the biggest clash, else the trait it moved most. */
export function dnaSays(c: Character, d: Dna = dnaOf(c)): string {
  const clash = [...d.moves].filter((m) => m.clash).sort((a, b) => b.n - a.n)[0];
  const shifted = [...d.traits].sort((a, b) => b.value - b.nature - (a.value - a.nature))[0]!;
  const top = [...d.traits].sort((a, b) => b.value - a.value)[0]!;
  const lead = `Most of all: ${top.name.toLowerCase()}.`;
  if (clash) return `${lead} ${cap(clash.why)}.`;
  if (shifted.value - shifted.nature >= 2) {
    const by = d.moves.filter((m) => m.to === shifted.name).sort((a, b) => b.n - a.n)[0];
    return `${lead} More ${shifted.name.toLowerCase()} than its nature${by ? `, from ${by.why}` : ""}.`;
  }
  return `${lead} True to its nature.`;
}
const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

// ── growing into a niche (PLAN 3.11; owner, 10-04: "obviously get better over time ... when they learn,
// we really want them to learn well and have a niche sort of thing. If we can take off somewhere else
// to add somewhere else it makes it funner, but not too much of a difference either") ──────────────
// What an orb has grown into comes only from the XP its graded work earned in each area (the home's
// radar, gym/specialty.ts; CLAUDE.md rule 8: nothing it says about itself). Skills climb with it, with
// diminishing returns; the area it works in most climbs most (its niche); the skills it never uses give
// a little back, never more than a tenth of what it gained and two points each. Its traits drift with
// the kind of work it does, inside the same TOTAL.

/** The skills (spec.ts SKILLS), in order. */
export const SKILL_NAMES = ["Planning", "Building", "Data", "Design", "Words", "Research", "Money", "Care"] as const;
export type Skill = (typeof SKILL_NAMES)[number];
/** Each area of work (the home's AREAS) and the skills it trains. */
export const AREA_SKILLS: Record<string, Partial<Record<Skill, number>>> = {
  frontend: { Building: 0.6, Design: 0.4 }, backend: { Building: 1 }, data: { Data: 1 }, devops: { Building: 1 },
  design: { Design: 1 }, research: { Research: 1 }, writing: { Words: 1 }, inbox: { Care: 0.5, Words: 0.5 },
  scheduling: { Planning: 1 }, finance: { Money: 1 }, bookings: { Planning: 0.6, Care: 0.4 }, teaching: { Care: 0.5, Words: 0.5 },
};
/** The kind of work and the trait it brings out (inside the total): a move per HABIT_XP earned, at most 3. */
const AREA_TRAIT: Record<string, Spec> = {
  frontend: "Focus>Curiosity 1", backend: "Humour>Focus 1", data: "Humour>Focus 1", devops: "Calm>Nerve 1", design: "Focus>Curiosity 1",
  research: "Pace>Curiosity 1", writing: "Nerve>Care 1", inbox: "Curiosity>Care 1", scheduling: "Pace>Focus 1", finance: "Humour>Focus 1",
  bookings: "Curiosity>Care 1", teaching: "Nerve>Care 1",
};
const HABIT_XP = 400;
/** A skill's points from its starting lean (1..5): 4 to 20, out of SKILL_MAX once grown. */
export const SKILL_MAX = 40;
const GAIN_MAX = 16; // what a skill can gain from work, at most (before its niche)
const NICHE = 1.25; // the niche gains a quarter more
const GIVE_BACK = 0.1; // the unused give back at most this share of the gain
const GIVE_EACH = 2; // and at most this many points each

export type Growth = {
  skills: { name: Skill; value: number; start: number }[];
  /** The skill it has grown into most, and the word its work is most about, once it has grown. */
  niche: { skill: Skill; word: string | null } | null;
  /** Its traits after its work, inside the same TOTAL, and what moved them. */
  traits: Dna["traits"];
  moves: Move[];
};

/** What an orb has grown into from its earned XP by area (`radar`) and its niche words. */
export function grownOf(c: Character, leans: { name: string; value: number }[], radar: Record<string, { xp: number }>, niches: { word: string }[] = [], dna: Dna = dnaOf(c)): Growth {
  const start = SKILL_NAMES.map((n) => (leans.find((l) => l.name === n)?.value ?? 1) * 4);
  const xp = SKILL_NAMES.map((n) => Object.entries(radar).reduce((sum, [area, r]) => sum + (AREA_SKILLS[area]?.[n] ?? 0) * Math.max(0, r.xp), 0));
  const top = xp.indexOf(Math.max(...xp));
  const tenth = (x: number): number => Math.floor(x * 10 + 1e-9) / 10; // down to a tenth, so the share is never overshot
  // what each skill gains, as far as its ceiling lets it
  const gain = xp.map((x, i) => (x <= 0 ? 0 : tenth(Math.min(SKILL_MAX - start[i]!, GAIN_MAX * (1 - Math.exp(-x / 600)) * (i === top ? NICHE : 1)))));
  const gained = gain.reduce((a, b) => a + b, 0);
  // the unused give back, evenly, within their share and their own limit
  const unused = xp.map((x, i) => (x <= 0 ? i : -1)).filter((i) => i >= 0);
  const each = unused.length ? tenth(Math.min(GIVE_EACH, (gained * GIVE_BACK) / unused.length)) : 0;
  const skills = SKILL_NAMES.map((name, i) => {
    const v = start[i]! + gain[i]! - (unused.includes(i) ? Math.min(each, start[i]! - 1) : 0);
    return { name, value: Math.round(v * 10) / 10, start: start[i]! };
  });
  // the traits drift with the work, inside the total
  const v = dna.traits.map((t) => t.value);
  const moves: Move[] = [];
  for (const [area, r] of Object.entries(radar)) {
    const spec = AREA_TRAIT[area];
    if (!spec || r.xp < HABIT_XP) continue;
    const m = read(spec);
    const moved = apply(v, { ...m, n: Math.min(3, Math.floor(r.xp / HABIT_XP)) });
    if (moved) moves.push({ from: m.from, to: m.to, n: moved, why: `${area} work` });
  }
  const niche = gained > 0 ? { skill: SKILL_NAMES[top]!, word: niches[0]?.word ?? null } : null;
  return { skills, niche, traits: dna.traits.map((t, i) => ({ ...t, value: v[i]! })), moves };
}

/** What it has grown into, in a sentence, once it has. */
export const grownSays = (g: Growth): string | null =>
  g.niche ? `Grown into ${g.niche.skill.toLowerCase()} work${g.niche.word ? `, ${g.niche.word} above all` : ""}.` : null;
