// A character (PLAN 2.2): one spec per orb, and the shader draws all of it. Every orb is a
// different Ash: his glass, his liquid, his light, his eyes' sparkle, in another shape, with other
// eyes, a hat and glasses, in his own colour and voice. And each has a personality (owner,
// 2026-10-01: "each has a diff personality, thats what were going for"): it decides how he moves
// when he is left alone, which voices suit him, and how he talks, so the parts you pick go together.
// The starter shapes are our own; the owner names and redraws them. No mouth on any of them, no
// cheeks (owner, 2026-09-24): the eyes carry every mood.
import { HUES, MATERIALS, type HueName, type Material } from "../design/tokens.ts";
import { ORB_TURNS } from "./hues.ts";
import type { Gesture } from "./life.ts";
import type { OrbLook } from "./renderer.ts";

type V4 = [number, number, number, number];

// ── shapes ─────────────────────────────────────────────────────────────────────────────────────
// The terms the shader's silhouette is made of, each 0 unless a shape uses it. Ash's bean is his
// numbers exactly; the rest are our own.
type ShapeTerms = Partial<{
  tall: number; taper: number; grow: number; belly: number; dent: number; wide: number; point: number; hem: number; hemFreq: number;
  bumps: number; bumpSize: number; ears: number; earSpread: number; earWidth: number; scale: number; tip: number;
  squircle: number; notch: number; blob: number; points: number; pointSize: number; pointSharp: number;
}>;
const shape = (t: ShapeTerms) => ({
  a: [t.tall ?? 0, t.taper ?? 0, t.grow ?? 0, t.belly ?? 0] as V4,
  b: [t.dent ?? 0, t.wide ?? 0, t.point ?? 0, t.hem ?? 0] as V4,
  c: [t.bumps ?? 0, t.bumpSize ?? 0, t.ears ?? 0, t.earSpread ?? 0] as V4,
  d: [t.earWidth ?? 0.3, t.scale ?? 0.9, t.hemFreq ?? 6, t.tip ?? 0] as V4,
  e: [t.squircle ?? 0, t.notch ?? 0, t.blob ?? 0, 0] as V4,
  f: [t.points ?? 0, t.pointSize ?? 0, t.pointSharp ?? 1, 0] as V4,
});

export const SHAPES = {
  bean: shape({ tall: 0.2, taper: 0.11, grow: 0.05, belly: 0.95, dent: 0.03, scale: 0.905 }), // Ash, to the number
  pebble: shape({ tall: 0.05, taper: 0.03, belly: 0.9, wide: 0.14, scale: 0.92 }),
  egg: shape({ tall: 0.26, taper: 0.16, grow: 0.08, belly: 0.95, scale: 0.88 }),
  moon: shape({ tall: 0.02, scale: 0.93 }),
  squish: shape({ tall: 0.0, taper: -0.04, belly: 0.9, wide: 0.2, scale: 0.95 }),
  drop: shape({ tall: 0.14, grow: 0.05, belly: 0.95, point: 0.24, scale: 0.86 }),
  cloud: shape({ tall: 0.09, taper: 0.02, grow: 0.02, belly: 0.9, wide: 0.05, bumps: 7, bumpSize: 0.065, scale: 0.87 }),
  ghost: shape({ tall: 0.24, taper: -0.04, grow: 0.07, belly: 0.9, hem: 0.055, scale: 0.86 }),
  drip: shape({ tall: 0.12, taper: 0.03, grow: 0.04, belly: 0.9, hem: 0.08, hemFreq: 4, scale: 0.87 }),
  teddy: shape({ tall: 0.12, grow: 0.03, belly: 0.95, ears: 0.17, earSpread: 0.64, earWidth: 0.22, scale: 0.85 }),
  cub: shape({ tall: 0.06, belly: 0.9, wide: 0.06, ears: 0.2, earSpread: 0.78, earWidth: 0.24, scale: 0.84 }),
  kitty: shape({ tall: 0.14, taper: 0.02, grow: 0.03, belly: 0.95, ears: 0.24, earSpread: 0.7, earWidth: 0.12, scale: 0.83 }),
  bunny: shape({ tall: 0.12, taper: 0.03, grow: 0.03, belly: 0.95, ears: 0.5, earSpread: 0.44, earWidth: 0.12, scale: 0.76 }),
  chick: shape({ tall: 0.06, taper: 0.02, grow: 0.02, belly: 0.98, wide: 0.1, point: 0.22, scale: 0.86 }),
  heart: shape({ tall: 0.02, taper: -0.06, belly: 0.6, ears: 0.1, earSpread: 0.55, earWidth: 0.38, notch: 0.1, tip: 0.24, scale: 0.86 }),
  star: shape({ tall: 0.0, points: 5, pointSize: 0.17, pointSharp: 3, scale: 0.86 }),
  trio: shape({ tall: 0.0, taper: -0.02, points: 3, pointSize: 0.2, pointSharp: 1.6, scale: 0.84 }),
  squircle: shape({ tall: 0.02, squircle: 0.12, scale: 0.86 }),
  blob: shape({ tall: 0.1, taper: 0.04, grow: 0.03, belly: 0.9, blob: 0.08, scale: 0.88 }),
};
export type ShapeName = keyof typeof SHAPES;

// ── eyes ───────────────────────────────────────────────────────────────────────────────────────
/** [radius, aspect, gap, height], [sparkle, lids at rest, happy at rest, wink]. */
export const EYES = {
  ash: { a: [0.138, 1, 0.26, 0.1], b: [1, 0, 0, 0] }, // his own
  big: { a: [0.172, 1.06, 0.28, 0.12], b: [1, 0, 0, 0] },
  huge: { a: [0.205, 1.1, 0.3, 0.12], b: [1, 0, 0, 0] },
  ovals: { a: [0.112, 1.55, 0.23, 0.06], b: [1, 0, 0, 0] },
  beans: { a: [0.15, 0.72, 0.27, 0.12], b: [1, 0, 0, 0] },
  dots: { a: [0.072, 1, 0.24, 0.1], b: [0, 0, 0, 0] },
  tiny: { a: [0.05, 1, 0.2, 0.1], b: [0, 0, 0, 0] },
  sleepy: { a: [0.14, 1, 0.26, 0.12], b: [0.8, 0.55, 0, 0] },
  droopy: { a: [0.12, 1.4, 0.24, 0.1], b: [0.8, 0.35, 0, 0] },
  happy: { a: [0.138, 1, 0.26, 0.1], b: [1, 0, 1, 0] },
  wink: { a: [0.138, 1, 0.26, 0.1], b: [1, 0, 0, 1] },
  wide: { a: [0.13, 1, 0.34, 0.12], b: [1, 0, 0, 0] },
  close: { a: [0.13, 1, 0.18, 0.08], b: [1, 0, 0, 0] },
  low: { a: [0.14, 1, 0.26, 0.22], b: [1, 0, 0, 0] },
} satisfies Record<string, { a: V4; b: V4 }>;
export type EyesName = keyof typeof EYES;

// ── what he wears: a hat, and glasses ──────────────────────────────────────────────────────────
// Two choices, not one (owner, 2026-10-01: "what if we want glasses and a hat? make them 2
// categories ... different glasses, different hats ... can also be sunglasses").
type Paint = "accent" | Material;
/** A hat: the shader's shape number, what its two parts are made of, and its slant. */
export const HATS = {
  none: { id: 0, main: "ink", second: "ink", tilt: 0 },
  "top hat": { id: 1, main: "ink", second: "accent", tilt: -0.16 },
  beanie: { id: 2, main: "accent", second: "cream", tilt: 0.08 },
  "party hat": { id: 3, main: "accent", second: "cream", tilt: 0.22 },
  antenna: { id: 4, main: "steel", second: "accent", tilt: 0 },
  sprout: { id: 5, main: "leaf", second: "leaf", tilt: -0.06 },
  bow: { id: 6, main: "accent", second: "accent", tilt: 0 },
  crown: { id: 7, main: "gold", second: "accent", tilt: -0.1 },
  headphones: { id: 8, main: "accent", second: "ink", tilt: 0 },
  cap: { id: 9, main: "accent", second: "ink", tilt: -0.05 },
  "wizard hat": { id: 10, main: "ink", second: "gold", tilt: 0.12 },
  halo: { id: 11, main: "gold", second: "gold", tilt: 0 },
  flower: { id: 12, main: "accent", second: "gold", tilt: 0 },
  horns: { id: 13, main: "accent", second: "accent", tilt: 0 },
  "bunny ears": { id: 14, main: "cream", second: "accent", tilt: 0 },
  "chef hat": { id: 15, main: "cream", second: "cream", tilt: 0.04 },
  "grad cap": { id: 16, main: "ink", second: "gold", tilt: -0.08 },
  "cowboy hat": { id: 17, main: "gold", second: "ink", tilt: -0.1 },
  propeller: { id: 18, main: "accent", second: "steel", tilt: 0.06 },
  "star clip": { id: 19, main: "gold", second: "gold", tilt: 0 },
  beret: { id: 20, main: "accent", second: "ink", tilt: 0.16 },
  "hard hat": { id: 21, main: "gold", second: "cream", tilt: -0.04 },
  "bucket hat": { id: 22, main: "accent", second: "cream", tilt: 0.05 },
  eyeshade: { id: 23, main: "leaf", second: "ink", tilt: 0 },
  headset: { id: 24, main: "ink", second: "accent", tilt: 0 },
  sweatband: { id: 25, main: "cream", second: "accent", tilt: -0.04 },
  apple: { id: 26, main: "rose", second: "leaf", tilt: 0.08 },
  "straw hat": { id: 27, main: "gold", second: "accent", tilt: -0.06 },
  fedora: { id: 28, main: "ink", second: "accent", tilt: -0.08 },
  deerstalker: { id: 29, main: "gold", second: "ink", tilt: 0.04 },
  "sun visor": { id: 30, main: "cream", second: "accent", tilt: -0.05 },
  "flower crown": { id: 31, main: "rose", second: "gold", tilt: 0 },
  "viking helmet": { id: 32, main: "steel", second: "cream", tilt: 0 },
} satisfies Record<string, { id: number; main: Paint; second: Paint; tilt: number }>;
export type HatName = keyof typeof HATS;

/** Glasses, worn on his eyes: how a sentence says them, the shader's style number, the frame, a strap's colour (goggles),
 * and the lens: its tint and how much of his eyes it hides (sunglasses are dark; clear ones are 0). */
export const GLASSES = {
  none: { say: "", id: 0, frame: "ink", second: "ink", lens: "ink", dark: 0 },
  round: { say: "round glasses", id: 1, frame: "ink", second: "ink", lens: "ink", dark: 0 },
  square: { say: "square glasses", id: 2, frame: "ink", second: "ink", lens: "ink", dark: 0 },
  "cat-eye": { say: "cat-eye glasses", id: 3, frame: "ink", second: "ink", lens: "ink", dark: 0 },
  "big round": { say: "big round glasses", id: 4, frame: "accent", second: "accent", lens: "ink", dark: 0 },
  reading: { say: "reading glasses", id: 5, frame: "gold", second: "gold", lens: "ink", dark: 0 },
  monocle: { say: "a monocle", id: 6, frame: "gold", second: "gold", lens: "ink", dark: 0 },
  hearts: { say: "heart glasses", id: 7, frame: "rose", second: "rose", lens: "rose", dark: 0.5 },
  stars: { say: "star glasses", id: 8, frame: "gold", second: "gold", lens: "accent", dark: 0.38 },
  aviators: { say: "aviators", id: 9, frame: "gold", second: "gold", lens: "shade", dark: 0.86 },
  shades: { say: "shades", id: 10, frame: "ink", second: "ink", lens: "shade", dark: 0.9 },
  "round shades": { say: "round shades", id: 11, frame: "gold", second: "gold", lens: "shade", dark: 0.86 },
  goggles: { say: "goggles", id: 12, frame: "steel", second: "accent", lens: "steel", dark: 0.16 },
  visor: { say: "a visor", id: 13, frame: "accent", second: "accent", lens: "shade", dark: 0.84 },
  rectangle: { say: "rectangle glasses", id: 14, frame: "ink", second: "ink", lens: "ink", dark: 0 },
  "half-rims": { say: "half-rim glasses", id: 15, frame: "ink", second: "ink", lens: "ink", dark: 0 },
  sport: { say: "sport shades", id: 16, frame: "accent", second: "accent", lens: "shade", dark: 0.86 },
  "rose tint": { say: "rose-tinted glasses", id: 17, frame: "gold", second: "gold", lens: "rose", dark: 0.45 },
} satisfies Record<string, { say: string; id: number; frame: Paint; second: Paint; lens: Paint; dark: number }>;
export type GlassesName = keyof typeof GLASSES;
/** Sunglasses: the ones that hide his eyes. */
export const isShades = (g: GlassesName): boolean => GLASSES[g].dark >= 0.7;

// ── finish ─────────────────────────────────────────────────────────────────────────────────────
/** His glass (owner, on Ash, 2026-09-24: "add more colors, like black, grey, maybe some gradients"):
 * how much colour, how dark the glass; a gradient blends in a second colour from the top down. */
export const FINISHES = {
  glass: { label: "Glass", sat: 1, val: 1 },
  pearl: { label: "Pearl", sat: 0.5, val: 1.04 },
  smoke: { label: "Smoke", sat: 0.85, val: 0.66 },
  black: { label: "Black", sat: 1, val: 0.4 }, // Ash's own Black
  grey: { label: "Grey", sat: 0, val: 1 },
  // more colour from the same 24 hues (owner, 10-01: "give more orb colors ... to fit those personalities")
  // a finish may also say how much colour he holds at rest (`tint`, over the page's own) and give
  // him a glow of his own (`glow`, the bloom he has when he wakes, kept a little)
  pastel: { label: "Pastel", sat: 0.55, val: 1.1, tint: 0.95 },
  deep: { label: "Deep", sat: 1.25, val: 0.6, tint: 1 },
  neon: { label: "Neon", sat: 1.7, val: 1.12, tint: 1, glow: 0.35 },
  frost: { label: "Frost", sat: 0.4, val: 1.32, tint: 0.55 },
} satisfies Record<string, { label: string; sat: number; val: number; tint?: number; glow?: number }>;
export type FinishName = keyof typeof FINISHES;

// ── names ──────────────────────────────────────────────────────────────────────────────────────
// People's names (owner, 2026-10-01: "we want to give them people names", after "we dont want to
// copy the names of other things"): friendly first names from many places, the way the Dots film
// calls its own Alfred and Jojo. Never theirs, and never a famous assistant's.
export const PEOPLE_NAMES = [
  "Oscar", "Luna", "Daisy", "Milo", "Theo", "Hazel", "Rosie", "Benny", "June", "Nico", "Gus", "Ada", "Arlo", "Bea", "Cal", "Clara",
  "Dev", "Eddie", "Elsie", "Ezra", "Faye", "Finn", "Frankie", "Georgie", "Hugo", "Ines", "Isla", "Ivy", "Jonah", "Kai", "Kit",
  "Leo", "Lola", "Mabel", "Marco", "Maya", "Mina", "Nell", "Noah", "Nora", "Olive", "Omar", "Otis", "Penny", "Poppy", "Priya",
  "Quinn", "Raffi", "Remy", "Ruby", "Rufus", "Sami", "Sasha", "Stella", "Teddy", "Tess", "Toby", "Uma", "Vera", "Wes", "Willa",
  "Yara", "Zoe", "Zara", "Aiko", "Amara", "Anya", "Bodhi", "Cleo", "Dara", "Elio", "Esme", "Iggy0", "Juno0", "Kenji", "Lena",
  "Lou", "Mateo", "Mei", "Nadia", "Pia", "Rafa", "Rio", "Sol0", "Tariq", "Wren", "Yuki", "Zeke", "Ines0", "Basil", "Cosmo", "Dot0",
].filter((n) => !/\d/.test(n)); // (a trailing digit marks a name left out on purpose, so it is not added back by accident)

/** Names an orb never gets: the Dots film's own characters, and assistants people already know. */
export const NOT_OURS = ["Alfred", "Felipe", "Jojo", "Iggy", "Siri", "Alexa", "Cortana", "Jarvis", "Bixby", "Clippy", "Claude", "Gemini", "Copilot", "Dot", "Sol", "Juno"];

/** An orb's name, from his dice. */
export function orbName(r: () => number): string {
  return PEOPLE_NAMES[Math.floor(r() * PEOPLE_NAMES.length)]!;
}

/** For a voice in another language: a name from that language, so the orb who speaks it has one. */
const NATIVE: Record<string, string[]> = {
  e: ["Lucía", "Mateo", "Diego"], f: ["Élodie"], h: ["Priya", "Anika", "Arjun", "Rohan"], i: ["Giulia", "Marco"],
  j: ["Hana", "Yui", "Sakura", "Aoi", "Ren"], p: ["Ana", "Tiago", "Bruno"], z: ["Mei", "Lan", "Xiu", "Ying", "Wei", "Jun", "Hao", "Bo"],
};

// ── voices ─────────────────────────────────────────────────────────────────────────────────────
// Every voice in the kit's Kokoro model (kit/ash/models/voices-v1.0.bin, 54), named from its id:
// the first letter is the language (a American and b British English; e Spanish, f French, h Hindi,
// i Italian, j Japanese, p Portuguese, z Mandarin), the second is f or m. Kokoro runs on this
// machine, so a voice costs nothing and sends nothing anywhere. The English voices speak English;
// the others are for an orb who talks in their own language (the voice row, PLAN 4.3, checks
// their pronunciation before they are offered to speak English).
const KOKORO = [
  "af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa",
  "bf_alice", "bf_emma", "bf_isabella", "bf_lily", "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
  "ef_dora", "em_alex", "em_santa", "ff_siwis", "hf_alpha", "hf_beta", "hm_omega", "hm_psi", "if_sara", "im_nicola",
  "jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo", "pf_dora", "pm_alex", "pm_santa",
  "zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi", "zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang",
] as const;
const LANG: Record<string, string> = { a: "American", b: "British", e: "Spanish", f: "French", h: "Hindi", i: "Italian", j: "Japanese", p: "Portuguese", z: "Mandarin" };

// Every voice has a name of ours (owner, 2026-10-01: "we dont want to copy the names of other
// things ... and voices"): Kokoro's own labels are its authors' names for them, and alloy, echo,
// nova and onyx are OpenAI's names for its voices. An English voice is named for what it sounds
// like; a voice in another language has a person's name from that language.
const OUR_NAMES: Record<string, string> = {
  af_alloy: "Clearwater", af_aoede: "Songbird", af_bella: "Sunny", af_heart: "Hearth", af_jessica: "Sparkle", af_kore: "Steady",
  af_nicole: "Whisper", af_nova: "Zest", af_river: "Drift", af_sarah: "Honeydew", af_sky: "Breeze",
  am_adam: "Bold", am_echo: "Byte", am_eric: "Brisk", am_fenrir: "Grit", am_liam: "Easygoing", am_michael: "Anchor",
  am_onyx: "Rumble", am_puck: "Scamp", am_santa: "Jolly",
  bf_alice: "Teacup", bf_emma: "Crisp", bf_isabella: "Velvet", bf_lily: "Quickstep",
  bm_daniel: "Gravel", bm_fable: "Storyteller", bm_george: "Old Oak", bm_lewis: "Mellow",
};

export type Voice = { id: string; label: string; accent: string; english: boolean; kokoro: string | null; nth?: number };
export const VOICES: Voice[] = [
  { id: "ash", label: "Ash's own", accent: "his blend", english: true, kokoro: "ash" },
  ...KOKORO.map((k, i) => {
    const lang = LANG[k[0]!]!;
    const sex = k[1] === "f" ? "female" : "male";
    const nth = KOKORO.filter((x) => x.slice(0, 2) === k.slice(0, 2)).indexOf(k) + 1;
    void i;
    // a voice in another language is named from that language (its n-th name, women's first then men's)
    const native = NATIVE[k[0]!] ?? [];
    const women = KOKORO.filter((x) => x[0] === k[0] && x[1] === "f").length;
    const name = native[(k[1] === "f" ? 0 : women) + nth - 1] ?? `${lang} ${nth}`;
    return { id: k, label: OUR_NAMES[k] ?? name, accent: `${lang} ${sex}`, english: k[0] === "a" || k[0] === "b", kokoro: k, nth };
  }),
  { id: "silent", label: "Silent", accent: "text only, always", english: true, kokoro: null },
];
export const voice = (id: string): Voice => VOICES.find((v) => v.id === id) ?? VOICES[0]!;

/** How replies arrive, for every orb at once (Ash's own three): spoken and shown, shown, or neither aloud. */
export const REPLIES = { speak: "Speak & show", text: "Text only", silent: "Silent" } as const;
export type Replies = keyof typeof REPLIES;

// ── personality ────────────────────────────────────────────────────────────────────────────────
/** Who he is: how he talks (a line the brain is given), which voices suit him and how fast he
 * speaks, how he moves when left alone (which fidgets, how often), how soft he is, the eyes that
 * suit him. Picking one suggests the rest; any part can still be changed. */
export type Personality = {
  label: string;
  blurb: string;
  tone: string;
  voices: string[];
  speed: number;
  fidgets: Gesture[];
  every: [number, number];
  breath: number;
  sway: number;
  goo: number;
  eyes: EyesName;
};

export const PERSONALITIES = {
  steady: { label: "Steady", blurb: "Calm and capable; does the job, says what he did", tone: "calm, plain, kind; short sentences", voices: ["ash", "bm_george", "am_michael"], speed: 1, fidgets: ["look", "nod", "jelly"], every: [7, 12], breath: 1, sway: 1, goo: 0.55, eyes: "ash" },
  cheerful: { label: "Cheerful", blurb: "Bubbly, quick to cheer you on", tone: "bright and warm, a little exclamation now and then", voices: ["af_bella", "af_nova", "af_jessica", "am_puck"], speed: 1.06, fidgets: ["hop", "wiggle", "jelly", "hop"], every: [3, 6], breath: 1.2, sway: 1.5, goo: 0.75, eyes: "happy" },
  sleepy: { label: "Sleepy", blurb: "Slow, soft, always half a nap away", tone: "slow, soft, gentle; never in a hurry", voices: ["af_sky", "af_river", "bm_lewis"], speed: 0.9, fidgets: ["doze", "nod", "doze"], every: [6, 10], breath: 0.7, sway: 0.7, goo: 0.65, eyes: "sleepy" },
  curious: { label: "Curious", blurb: "Notices everything, asks good questions", tone: "eager and inquisitive; asks one good question", voices: ["am_puck", "af_kore", "bf_lily"], speed: 1.04, fidgets: ["look", "look", "hop", "nod"], every: [3, 6], breath: 1.1, sway: 1.2, goo: 0.6, eyes: "big" },
  shy: { label: "Shy", blurb: "Quiet, careful, gets there", tone: "quiet and careful; gentle, never pushy", voices: ["af_nicole", "bf_alice", "af_aoede"], speed: 0.95, fidgets: ["look", "squish"], every: [6, 10], breath: 0.9, sway: 0.6, goo: 0.6, eyes: "droopy" },
  grumpy: { label: "Grumpy", blurb: "Grumbles, then does it perfectly", tone: "dry, a little grumbly, secretly fond of you", voices: ["am_onyx", "bm_daniel", "am_fenrir"], speed: 0.97, fidgets: ["pout", "look", "nod"], every: [8, 12], breath: 0.9, sway: 0.8, goo: 0.4, eyes: "beans" },
  dapper: { label: "Dapper", blurb: "Proper, polished, a touch formal", tone: "polished and courteous; a touch formal", voices: ["bm_fable", "bm_george", "bf_emma"], speed: 0.98, fidgets: ["nod", "look"], every: [8, 12], breath: 0.9, sway: 0.7, goo: 0.3, eyes: "ovals" },
  dreamy: { label: "Dreamy", blurb: "Floaty and imaginative", tone: "airy and imaginative; paints a picture", voices: ["af_sky", "af_aoede", "bf_isabella"], speed: 0.95, fidgets: ["jelly", "look", "doze"], every: [6, 10], breath: 0.85, sway: 1.1, goo: 0.9, eyes: "huge" },
  brave: { label: "Brave", blurb: "Up for anything, first to try", tone: "confident and direct; up for it", voices: ["am_adam", "am_fenrir", "af_kore"], speed: 1.02, fidgets: ["hop", "nod"], every: [5, 8], breath: 1.05, sway: 1.1, goo: 0.45, eyes: "wide" },
  silly: { label: "Silly", blurb: "Goofy, playful, gets a laugh", tone: "playful and goofy; a joke when it helps", voices: ["am_puck", "af_jessica", "am_santa"], speed: 1.08, fidgets: ["wiggle", "hop", "squish", "jelly"], every: [2.5, 5], breath: 1.25, sway: 1.7, goo: 0.85, eyes: "wink" },
  wise: { label: "Wise", blurb: "Unhurried, thoughtful, a good explainer", tone: "thoughtful and unhurried; explains well", voices: ["bm_george", "am_michael", "bf_emma"], speed: 0.92, fidgets: ["nod", "look"], every: [9, 14], breath: 0.8, sway: 0.6, goo: 0.35, eyes: "close" },
  sassy: { label: "Sassy", blurb: "Quick wit, big opinions", tone: "witty and frank; a bit of sass", voices: ["af_nova", "bf_lily", "af_alloy"], speed: 1.05, fidgets: ["wiggle", "look", "pout"], every: [4, 7], breath: 1.1, sway: 1.4, goo: 0.6, eyes: "wink" },
  cozy: { label: "Cozy", blurb: "Warm as a blanket", tone: "warm and homely; reassuring", voices: ["af_heart", "af_river", "am_liam"], speed: 0.96, fidgets: ["jelly", "doze", "nod"], every: [6, 10], breath: 0.85, sway: 0.9, goo: 0.8, eyes: "happy" },
  techy: { label: "Techy", blurb: "Precise, nerdy, loves a good detail", tone: "precise and nerdy; gets the details right", voices: ["am_echo", "af_alloy", "am_eric"], speed: 1.03, fidgets: ["look", "nod", "wiggle"], every: [5, 9], breath: 1, sway: 0.9, goo: 0.45, eyes: "dots" },
  quiet: { label: "Quiet", blurb: "Says it in writing; never speaks aloud", tone: "brief and calm", voices: ["silent"], speed: 1, fidgets: ["look"], every: [10, 15], breath: 0.85, sway: 0.6, goo: 0.5, eyes: "tiny" },
} satisfies Record<string, Personality>;
export type PersonalityName = keyof typeof PERSONALITIES;

// ── specialty ──────────────────────────────────────────────────────────────────────────────────
// What he does (owner, 2026-10-01: "thats what the orb specializes in, whether its frontend,
// backend, general, planning, full stack", then "a much bigger roster", then "real life skills
// that we need but dont necessarily have ... an accountant ... one thats good at excel and
// microsoft office ... lifecoach persona, dietician persona ... personal trainer"). Five families.
// It titles him, gives him the focus his brain is told, and sets where he LEANS on the skills
// radar. Leanings are where he starts, not what he has earned: levels and XP come only from graded
// work and the owner's approvals (CLAUDE.md rule 8; PLAN 5.x). A role a licence stands behind says
// so on his sheet (`limits`): he is a persona that helps, never the professional.
export const SKILLS = ["Planning", "Building", "Data", "Design", "Words", "Research", "Money", "Care"] as const;
type Lean = [number, number, number, number, number, number, number, number]; // 1..5, in SKILLS order

export const FAMILIES = { build: "Build", think: "Think", make: "Make", business: "Business", life: "Life" } as const;
export type Family = keyof typeof FAMILIES;

type Specialty = { family: Family; label: string; title: string; focus: string; lean: Lean; hat: HatName; glasses: GlassesName; limits?: string };

export const SPECIALTIES = {
  // build
  general: { family: "build", label: "General", title: "All-Rounder", focus: "a bit of everything, done properly", lean: [3, 3, 3, 3, 3, 3, 3, 3], hat: "none", glasses: "none" },
  frontend: { family: "build", label: "Frontend", title: "Frontend Builder", focus: "interfaces: components, layout, CSS, accessibility", lean: [2, 5, 2, 4, 2, 2, 1, 2], hat: "headphones", glasses: "none" },
  backend: { family: "build", label: "Backend", title: "Backend Engineer", focus: "servers, APIs, databases and the jobs behind them", lean: [3, 5, 4, 1, 2, 2, 1, 1], hat: "none", glasses: "square" },
  fullstack: { family: "build", label: "Full stack", title: "Full-Stack Builder", focus: "end to end: the interface, the server and the glue", lean: [3, 5, 3, 3, 2, 2, 1, 1], hat: "cap", glasses: "none" },
  mobile: { family: "build", label: "Mobile", title: "App Maker", focus: "phone apps: screens, gestures, offline, stores", lean: [3, 5, 2, 4, 2, 2, 1, 2], hat: "antenna", glasses: "none" },
  devops: { family: "build", label: "DevOps", title: "Ops Keeper", focus: "builds, deploys, servers and keeping things up", lean: [3, 5, 3, 1, 2, 2, 2, 1], hat: "hard hat", glasses: "goggles" },
  testing: { family: "build", label: "Testing", title: "Bug Hunter", focus: "tests that can fail, and finding what breaks", lean: [3, 4, 3, 1, 2, 4, 1, 1], hat: "none", glasses: "big round" },
  security: { family: "build", label: "Security", title: "Guardian", focus: "keeping secrets secret and doors shut", lean: [3, 4, 2, 1, 2, 4, 2, 2], hat: "none", glasses: "aviators" },
  data: { family: "build", label: "Data", title: "Data Wrangler", focus: "data: cleaning, queries, charts and what they mean", lean: [3, 3, 5, 2, 2, 3, 2, 1], hat: "none", glasses: "round" },
  ai: { family: "build", label: "AI", title: "AI Builder", focus: "models, prompts, evals and the pipes between them", lean: [3, 4, 4, 1, 2, 4, 1, 1], hat: "none", glasses: "visor" },
  games: { family: "build", label: "Games", title: "Game Maker", focus: "games: play, levels, physics and feel", lean: [3, 4, 2, 5, 2, 2, 1, 2], hat: "propeller", glasses: "stars" },
  automation: { family: "build", label: "Automation", title: "Automator", focus: "scripts and workflows that do the boring parts for you", lean: [3, 4, 3, 1, 2, 2, 2, 2], hat: "none", glasses: "rectangle" },
  // think
  planning: { family: "think", label: "Planning", title: "Planner", focus: "plans, roadmaps and breaking work into rows", lean: [5, 2, 2, 2, 4, 3, 2, 2], hat: "grad cap", glasses: "reading" },
  lead: { family: "think", label: "Team lead", title: "Team Lead", focus: "running the team: who does what, unblocking, deciding", lean: [5, 2, 2, 2, 4, 2, 2, 4], hat: "crown", glasses: "none" },
  product: { family: "think", label: "Product", title: "Product Manager", focus: "what to build and why: users, priorities, trade-offs", lean: [5, 2, 3, 3, 4, 3, 2, 3], hat: "none", glasses: "half-rims" },
  research: { family: "think", label: "Research", title: "Researcher", focus: "finding out, reading widely, citing sources", lean: [3, 1, 3, 1, 4, 5, 1, 2], hat: "wizard hat", glasses: "big round" },
  factcheck: { family: "think", label: "Fact-checking", title: "Fact-Checker", focus: "checking claims against sources, and saying what holds", lean: [2, 1, 3, 1, 4, 5, 1, 1], hat: "deerstalker", glasses: "monocle" },
  analyst: { family: "think", label: "Analysis", title: "Analyst", focus: "numbers into answers: reports, trends, forecasts", lean: [3, 2, 5, 2, 3, 4, 4, 1], hat: "none", glasses: "half-rims" },
  architect: { family: "think", label: "Architecture", title: "Architect", focus: "how a system fits together, before it is built", lean: [5, 4, 3, 3, 3, 3, 1, 1], hat: "none", glasses: "rectangle" },
  // make
  design: { family: "make", label: "Design", title: "Designer", focus: "how it looks and feels: layout, type, colour, flow", lean: [3, 2, 1, 5, 3, 2, 1, 3], hat: "beret", glasses: "cat-eye" },
  writing: { family: "make", label: "Writing", title: "Wordsmith", focus: "docs, posts, emails and clear words", lean: [3, 1, 1, 2, 5, 3, 1, 2], hat: "star clip", glasses: "round" },
  editing: { family: "make", label: "Editing", title: "Editor", focus: "tightening words: clarity, tone, the last pass", lean: [3, 1, 1, 2, 5, 4, 1, 2], hat: "none", glasses: "reading" },
  marketing: { family: "make", label: "Marketing", title: "Marketer", focus: "getting the word out: campaigns, launches, the story", lean: [4, 1, 3, 3, 5, 3, 3, 3], hat: "fedora", glasses: "shades" },
  social: { family: "make", label: "Social media", title: "Social Media Manager", focus: "posts, captions, the calendar and the replies", lean: [3, 1, 2, 4, 5, 2, 2, 3], hat: "cap", glasses: "hearts" },
  video: { family: "make", label: "Video", title: "Video Maker", focus: "videos and podcasts: scripts, cuts, captions", lean: [3, 2, 1, 5, 4, 2, 1, 2], hat: "headphones", glasses: "round shades" },
  // business
  accountant: { family: "business", label: "Accounting", title: "Accountant", focus: "the books: bills and when they are due, budgets, receipts, taxes; he tells you before a bill is due", lean: [4, 1, 4, 1, 2, 2, 5, 2], hat: "eyeshade", glasses: "half-rims", limits: "Not a licensed accountant: he keeps your books in order and asks one before anything is filed." },
  office: { family: "business", label: "Office", title: "Office Pro", focus: "Excel, Word and PowerPoint: sheets and formulas, documents, decks", lean: [3, 2, 4, 4, 4, 2, 3, 2], hat: "headset", glasses: "rectangle" },
  sales: { family: "business", label: "Sales", title: "Sales Lead", focus: "leads, pitches, follow-ups and closing", lean: [4, 1, 2, 2, 4, 2, 4, 4], hat: "fedora", glasses: "none" },
  support: { family: "business", label: "Support", title: "Support Hero", focus: "answering customers kindly and fixing what they hit", lean: [3, 2, 1, 1, 4, 2, 1, 5], hat: "headset", glasses: "none" },
  people: { family: "business", label: "People", title: "People Partner", focus: "hiring, onboarding and looking after the team", lean: [4, 1, 1, 1, 4, 2, 2, 5], hat: "flower crown", glasses: "none" },
  operations: { family: "business", label: "Operations", title: "Operations Manager", focus: "keeping the business running: suppliers, orders, processes", lean: [5, 1, 3, 1, 3, 2, 4, 3], hat: "cap", glasses: "square" },
  paperwork: { family: "business", label: "Paperwork", title: "Paperwork Pro", focus: "contracts, forms and the fine print, read carefully", lean: [4, 1, 2, 1, 5, 4, 3, 2], hat: "none", glasses: "half-rims", limits: "Not a lawyer: he reads closely and says what to ask one." },
  // life
  assistant: { family: "life", label: "Assistant", title: "Assistant", focus: "the inbox, the calendar, trips and errands", lean: [5, 1, 2, 1, 4, 2, 2, 4], hat: "bow", glasses: "none" },
  tutor: { family: "life", label: "Tutor", title: "Tutor", focus: "teaching: explaining step by step until it lands", lean: [4, 1, 1, 2, 4, 4, 1, 4], hat: "halo", glasses: "reading" },
  coach: { family: "life", label: "Life coach", title: "Life Coach", focus: "goals, habits and the next small step; he checks in", lean: [4, 1, 1, 1, 4, 2, 2, 5], hat: "sun visor", glasses: "rose tint", limits: "Not a therapist: for anything heavy he helps you find one." },
  dietitian: { family: "life", label: "Dietitian", title: "Dietitian", focus: "meals, nutrition and shopping lists that fit you", lean: [4, 1, 3, 1, 3, 3, 2, 5], hat: "apple", glasses: "round", limits: "Not a licensed dietitian: general guidance; a doctor for anything medical." },
  trainer: { family: "life", label: "Trainer", title: "Personal Trainer", focus: "workouts, form and progress; he keeps you moving", lean: [4, 1, 2, 1, 2, 2, 1, 5], hat: "sweatband", glasses: "sport", limits: "Not a certified trainer: he starts gently and says when to ask a professional." },
  health: { family: "life", label: "Health", title: "Health Coach", focus: "food and fitness together: meals, workouts, sleep", lean: [4, 1, 2, 1, 3, 3, 1, 5], hat: "sweatband", glasses: "rose tint", limits: "Not a doctor or a licensed dietitian: general guidance only." },
  chef: { family: "life", label: "Cooking", title: "Home Chef", focus: "recipes, meal plans and what to cook tonight", lean: [3, 1, 1, 3, 3, 2, 2, 5], hat: "chef hat", glasses: "none" },
  travel: { family: "life", label: "Travel", title: "Travel Planner", focus: "trips: routes, bookings, packing and a plan B", lean: [5, 1, 2, 1, 3, 4, 3, 3], hat: "straw hat", glasses: "round shades" },
  money: { family: "life", label: "Money", title: "Money Coach", focus: "your own money: budgets, savings, subscriptions to cancel", lean: [4, 1, 3, 1, 3, 2, 5, 3], hat: "none", glasses: "round", limits: "Not a financial adviser: he organises, and never invests for you." },
  home: { family: "life", label: "Home", title: "Home Manager", focus: "the house: bills, repairs, chores and deliveries", lean: [5, 1, 2, 1, 3, 2, 4, 4], hat: "bucket hat", glasses: "none" },
  events: { family: "life", label: "Events", title: "Event Planner", focus: "parties and events: guests, venues, timings, the cake", lean: [5, 1, 2, 3, 3, 2, 3, 4], hat: "party hat", glasses: "stars" },
  career: { family: "life", label: "Career", title: "Career Coach", focus: "CVs, applications, interviews and the next move", lean: [4, 1, 1, 2, 5, 3, 2, 4], hat: "none", glasses: "half-rims" },
  language: { family: "life", label: "Languages", title: "Language Buddy", focus: "practising a language with you, a little every day", lean: [3, 1, 1, 1, 5, 2, 1, 4], hat: "beret", glasses: "none" },
} satisfies Record<string, Specialty>;
export type SpecialtyName = keyof typeof SPECIALTIES;

// ── the character sheet ────────────────────────────────────────────────────────────────────────
/** Traits, 1..5: flavour from his personality (and a little of his seed), shown as bars. */
export const TRAITS = ["Pace", "Care", "Curiosity", "Humour", "Focus"] as const;
const TRAIT_BASE: Record<PersonalityName, [number, number, number, number, number]> = {
  steady: [3, 4, 3, 2, 5], cheerful: [4, 4, 3, 4, 3], sleepy: [1, 4, 2, 3, 2], curious: [4, 3, 5, 3, 3], shy: [2, 5, 3, 2, 4],
  grumpy: [3, 3, 2, 3, 5], dapper: [3, 5, 3, 2, 4], dreamy: [2, 3, 5, 3, 2], brave: [5, 3, 4, 3, 3], silly: [4, 3, 4, 5, 2],
  wise: [2, 5, 4, 2, 5], sassy: [4, 2, 3, 5, 3], cozy: [2, 5, 3, 3, 3], techy: [4, 3, 4, 2, 5], quiet: [3, 4, 3, 1, 5],
};
const QUIRKS = [
  "hums while the tests run", "tidies files nobody asked him to tidy", "names his branches after weather", "keeps a tiny notebook of what you like",
  "counts the commas in long sentences", "naps between deploys", "wiggles when a build goes green", "talks to the cursor",
  "collects error messages like stamps", "always leaves the code a little neater", "reads the docs first, every time", "gets the hiccups when he's nervous",
  "bounces when he finds a bug", "saves the best biscuit for last", "rounds every number to something friendly", "writes his to-do list in rhyme",
  "polishes his glass when he's thinking", "lights up a shade brighter when you say thanks", "can't resist a good chart", "insists on one more check",
];
const CATCHPHRASES: Record<PersonalityName, string[]> = {
  steady: ["Done. Here's what I did.", "Leave it with me."], cheerful: ["Ooh, let's do it!", "That went great!"], sleepy: ["Mm... on it.", "Five more minutes... kidding, it's done."],
  curious: ["Wait, why does it do that?", "Ooh, what's this?"], shy: ["I, um, finished it.", "If that's okay with you..."], grumpy: ["Fine. It's fixed.", "Who wrote this? ...Oh. Me."],
  dapper: ["Splendid. All in order.", "At your service."], dreamy: ["Picture this...", "What if it floated?"], brave: ["I'll go first.", "Bring it on."],
  silly: ["Ta-da!", "Boop. Fixed it."], wise: ["Let's think it through.", "Slowly is fast."], sassy: ["Obviously.", "You're welcome."],
  cozy: ["There we go, all snug.", "No rush, I've got it."], techy: ["Nominal. Ship it.", "Logging that."], quiet: ["(done)", "(it's in your drafts)"],
};

export type Sheet = { title: string; traits: { name: string; value: number }[]; leans: { name: string; value: number }[]; bio: string; quirk: string; catchphrase: string };

const rng = (seed: number): (() => number) => {
  let x = Math.abs(Math.floor(seed * 9973)) % 233280;
  return () => (x = (x * 9301 + 49297) % 233280) / 233280;
};

/** His character sheet: what a game would show on his card. All of it from his choices and his seed. */
export function sheetOf(c: Character): Sheet {
  const P = PERSONALITIES[c.personality];
  const S = SPECIALTIES[c.specialty];
  const r = rng(c.seed);
  const clamp = (v: number): number => Math.max(1, Math.min(5, Math.round(v)));
  const shapeWord = c.shape === "bean" ? "glass bean" : `${c.shape}-shaped orb`;
  const wear = wearing(c, "in");
  return {
    title: `the ${P.label} ${S.title}`,
    traits: TRAITS.map((name, i) => ({ name, value: clamp(TRAIT_BASE[c.personality][i]! + (r() - 0.5) * 1.2) })),
    leans: SKILLS.map((name, i) => ({ name, value: clamp(S.lean[i]! + (r() - 0.5) * 0.9) })),
    bio: `${c.name} is ${/^[aeiou]/.test(c.hue) ? "an" : "a"} ${c.hue} ${shapeWord}${wear} who handles ${S.focus}. ${P.blurb}.`,
    quirk: QUIRKS[Math.floor(r() * QUIRKS.length)]!,
    catchphrase: CATCHPHRASES[c.personality][Math.floor(r() * CATCHPHRASES[c.personality].length)]!,
  };
}

// ── the character ──────────────────────────────────────────────────────────────────────────────
export type Character = {
  name: string;
  personality: PersonalityName;
  /** What he works on. */
  specialty: SpecialtyName;
  /** The dice he was rolled with: his quirk, catchphrase and the jitter in his sheet come from it. */
  seed: number;
  hue: HueName;
  /** A second colour blended in from the top down (a gradient orb), or none. */
  hue2: HueName | null;
  finish: FinishName;
  shape: ShapeName;
  eyes: EyesName;
  hat: HatName;
  glasses: GlassesName;
  voice: string;
  goo: number;
};

export const ASH: Character = { name: "Ash", personality: "steady", specialty: "general", seed: 1, hue: "azure", hue2: null, finish: "glass", shape: "bean", eyes: "ash", hat: "none", glasses: "none", voice: "ash", goo: 0.55 };

/** " in a beret and round glasses", " with aviators": what he has on, as words. */
export function wearing(c: Pick<Character, "hat" | "glasses">, word: "in" | "with"): string {
  const hat = c.hat === "none" ? "" : `${/^[aeiou]/.test(c.hat) ? "an" : "a"} ${c.hat}`;
  const both = [hat, GLASSES[c.glasses].say].filter(Boolean).join(" and ");
  return both ? ` ${word} ${both}` : "";
}

/** Whether an orb speaks a reply: never when he is silent, never when the app is set to text or silence. */
export const speaks = (c: Character, replies: Replies): boolean => replies === "speak" && c.voice !== "silent";

function paint(p: Paint, hue: HueName): [number, number, number] {
  const c = p === "accent" ? HUES.find((h) => h.name === hue)!.dark : MATERIALS[p];
  return [c[0] / 255, c[1] / 255, c[2] / 255];
}

/** What the shader needs to draw this character. */
export function lookOf(c: Character): OrbLook {
  const s = SHAPES[c.shape];
  const e = EYES[c.eyes];
  const w = HATS[c.hat];
  const g = GLASSES[c.glasses];
  return {
    shapeA: [...s.a], shapeB: [...s.b], shapeC: [...s.c], shapeD: [...s.d], shapeE: [...s.e], shapeF: [...s.f],
    eyeA: [...e.a] as V4, eyeB: [...e.b] as V4,
    acc: w.id, accCol: paint(w.main, c.hue), accCol2: paint(w.second, c.hue), accTilt: w.tilt,
    specs: g.id, specsCol: paint(g.frame, c.hue), specsCol2: paint(g.second, c.hue), lensCol: paint(g.lens, c.hue), lensDark: g.dark,
  };
}

/** His finish as the shader takes it: palette turns, saturation, brightness, the gradient. */
export function finishOf(c: Character): { turn: number; sat: number; val: number; turn2: number; grad: number; tint: number | null; glow: number } {
  const f: { sat: number; val: number; tint?: number; glow?: number } = FINISHES[c.finish];
  return { turn: ORB_TURNS[c.hue], sat: f.sat, val: f.val, turn2: ORB_TURNS[c.hue2 ?? c.hue], grad: c.hue2 ? 1 : 0, tint: f.tint ?? null, glow: f.glow ?? 0 };
}

/** How he moves when left alone, from his personality. */
export const motionOf = (c: Character): { kinds: Gesture[]; every: [number, number]; breath: number; sway: number } => {
  const P = PERSONALITIES[c.personality];
  return { kinds: P.fidgets, every: P.every, breath: P.breath, sway: P.sway };
};

/** Applies a personality: the voice, eyes and goo that suit it (the rest stays as it is). */
export function withPersonality(c: Character, p: PersonalityName): Character {
  const P = PERSONALITIES[p];
  const voice = P.voices.includes(c.voice) ? c.voice : P.voices[0]!;
  return { ...c, personality: p, voice: c.name === "Ash" && p === "steady" ? "ash" : voice === "ash" && c.name !== "Ash" ? P.voices[1] ?? "bm_george" : voice, eyes: P.eyes, goo: P.goo };
}

/** "Lumen the teal ghost with an antenna": a name you can keep or change. */
export function describe(c: Character): string {
  const wear = wearing(c, "with");
  const colour = c.hue2 ? `${c.hue}-and-${c.hue2}` : c.finish === "glass" ? c.hue : `${FINISHES[c.finish].label.toLowerCase()} ${c.hue}`;
  return `${c.name} the ${colour} ${c.shape}${wear}`;
}

const pickOne = <T,>(xs: readonly T[], r: () => number): T => xs[Math.floor(r() * xs.length)]!;

/** "Surprise me": a whole character from a seed (the same seed, the same orb): a personality first,
 * then a body, eyes, a voice and a softness that go with it. */
export function surprise(seed: number): Character {
  let x = Math.abs(Math.floor(seed)) % 233280;
  const r = (): number => (x = (x * 9301 + 49297) % 233280) / 233280;
  const personality = pickOne(Object.keys(PERSONALITIES).filter((p) => p !== "steady") as PersonalityName[], r);
  const P = PERSONALITIES[personality];
  const hue = pickOne(HUES.map((h) => h.name), r);
  const specialty = pickOne(Object.keys(SPECIALTIES) as SpecialtyName[], r);
  return {
    name: orbName(r),
    personality,
    specialty,
    seed: Math.floor(r() * 1e6),
    hue,
    hue2: r() < 0.2 ? pickOne(HUES.map((h) => h.name), r) : null,
    finish: r() < 0.75 ? "glass" : pickOne(Object.keys(FINISHES) as FinishName[], r),
    shape: pickOne(Object.keys(SHAPES) as ShapeName[], r),
    eyes: r() < 0.7 ? P.eyes : pickOne(Object.keys(EYES) as EyesName[], r),
    hat: r() < 0.5 ? SPECIALTIES[specialty].hat : pickOne(Object.keys(HATS) as HatName[], r),
    glasses: r() < 0.5 ? SPECIALTIES[specialty].glasses : r() < 0.5 ? "none" : pickOne(Object.keys(GLASSES) as GlassesName[], r),
    voice: pickOne(P.voices.filter((v) => v !== "ash"), r) ?? "silent",
    goo: Math.max(0, Math.min(1, P.goo + (r() - 0.5) * 0.2)),
  };
}
