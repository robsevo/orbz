// An orb's DNA strand (owner, 10-04: "the orb should now have a unique dna strand number or string the
// user gets and can share with others or recreate the orb in question"): everything an orb is made of
// (its personality, specialty, dice, colours, finish, shape, eyes, hat, glasses and their colours, its
// voice, its goo) packed into one short string, and read back into the same orb. Its traits come back
// with it, since they are worked out from those (dna.ts); what it has grown into is earned, and is not
// in it. The name rides in front, in plain letters, and may be left off.
//
//   Basil · 10QN-B3XA-F3ZT-8HWN-C2PA-7
//
// The code is Crockford's base 32 (no I, L, O or U to misread; read back case-blind, O as 0, I and L
// as 1), "1" the version, a check letter last, so a mistyped one is caught rather than read as another
// orb. Each choice is stored as its place in its list: those lists only ever grow at the end (a hat
// added goes last), and each field has room to grow (CAP).
//
// "2" (PLAN 2.20; owner, 10-08: "DNA should go with hex if possible. a lot more possibilities"): the same fields, Dark
// at the end of the colours, and each colour chosen as any colour (his own, the gradient's, the hat's, the frames') as
// its hex, 24 bits each, with which of the four there are; it is a letter longer and five more for each. An orb of the
// 24 alone keeps the first version's strand, so every strand made so far reads, and is made, the same.
//
// "3" (owner, 10-10: "make the ears come out of the hat ... give the user the choice? which affects dna"): the second
// version and one more bit, last: his ears out of his hat. Only an orb with its ears out has it; every other orb's strand
// is as it was.
import type { HueName } from "../design/tokens.ts";
import { hexOf } from "./colour.ts";
import { type AccessoryHue, type Character, EYES, FINISHES, GLASSES, HATS, PERSONALITIES, SHAPES, SPECIALTIES, VOICES } from "./spec.ts";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const VERSION = "1";
const VERSION2 = "2";
const VERSION3 = "3";

/** The 24 as the first version lists them, written out on 10-08 and kept so: built from HUES, a colour added would
 * have moved white and black (and every colour after it) in every strand made before. */
export const STRAND_HUES = [
  "azure", "cornflower", "iris", "lavender", "violet", "plum", "orchid", "pink", "rose", "blush", "coral", "apricot",
  "amber", "marigold", "honey", "citron", "lime", "clover", "leaf", "jade", "mint", "seafoam", "teal", "cyan",
] as const satisfies readonly HueName[];

/** Each field: its list (what it stores is a place in it) and its room (the most it will ever hold). */
const voiceIds = (): string[] => ["ash", "silent", ...VOICES.map((v) => v.id).filter((v) => v !== "ash" && v !== "silent")];
const accessory = (): (AccessoryHue | null)[] => [null, ...STRAND_HUES, "white", "black"];
type Field = { key: keyof Character; list: () => readonly unknown[]; cap: number };
const FIELDS: Field[] = [
  { key: "personality", list: () => Object.keys(PERSONALITIES), cap: 32 },
  { key: "specialty", list: () => Object.keys(SPECIALTIES), cap: 64 },
  { key: "hue", list: () => STRAND_HUES, cap: 32 },
  { key: "hue2", list: () => [null, ...STRAND_HUES], cap: 33 },
  { key: "finish", list: () => Object.keys(FINISHES), cap: 32 },
  { key: "shape", list: () => Object.keys(SHAPES), cap: 64 },
  { key: "eyes", list: () => Object.keys(EYES), cap: 32 },
  { key: "hat", list: () => Object.keys(HATS), cap: 128 },
  { key: "glasses", list: () => Object.keys(GLASSES), cap: 64 },
  { key: "hatHue", list: accessory, cap: 34 },
  { key: "glassesHue", list: accessory, cap: 34 },
  { key: "voice", list: voiceIds, cap: 128 },
];
const GOO = 101; // its goo, in hundredths
const SEED = 2 ** 20; // its dice (a roll is under a million)
/** The code's length, from the fields' room: every orb's strand is this long, plus the version and the check. */
const BODY = Math.ceil(Math.log2(FIELDS.reduce((p, f) => p * f.cap, 1) * GOO * SEED) / 5);
/** The second version's fields: the first's, Dark after the 24 (the colour's field has the room). */
const FIELDS2: Field[] = FIELDS.map((f) => (f.key === "hue" ? { ...f, list: () => [...STRAND_HUES, "dark"] } : f));
/** Any colour's four places, in this order; which of them there are is four bits, each one there 24. */
const TINTS = ["tint", "tint2", "hatTint", "glassesTint"] as const;
const RGB = 2n ** 24n;
const BODY2 = (k: number): number => Math.ceil((Math.log2(FIELDS2.reduce((p, f) => p * f.cap, 1) * GOO * SEED) + 4 + 24 * k) / 5);
/** The third version's: the second's and one bit (his ears out of his hat). */
const BODY3 = (k: number): number => Math.ceil((Math.log2(FIELDS2.reduce((p, f) => p * f.cap, 1) * GOO * SEED) + 5 + 24 * k) / 5);

/** The code alone (no name), for an orb. */
export function strandOf(c: Character): string {
  if (!Number.isInteger(c.seed) || c.seed < 0 || c.seed >= SEED) throw new Error(`${c.name}'s dice (${c.seed}) do not fit a strand`);
  const tints = TINTS.map((k) => hexOf(c[k]));
  const v3 = c.ears === "out";
  const v2 = c.hue === "dark" || tints.some(Boolean) || v3;
  let n = 0n;
  for (const f of v2 ? FIELDS2 : FIELDS) {
    const at = f.list().indexOf(c[f.key] ?? null);
    if (at < 0) throw new Error(`${c.name}'s ${f.key} (${String(c[f.key])}) is not one a strand knows`);
    n = n * BigInt(f.cap) + BigInt(at);
  }
  n = n * BigInt(GOO) + BigInt(Math.round(Math.max(0, Math.min(1, c.goo)) * 100));
  n = n * BigInt(SEED) + BigInt(c.seed);
  if (v2) {
    // each colour there, then which they are, last: a reader finds out first how many to take back
    for (const t of tints) if (t) n = n * RGB + BigInt(Number.parseInt(t.slice(1), 16));
    n = n * 16n + BigInt(tints.reduce((flags, t, i) => flags | (t ? 1 << i : 0), 0));
    if (v3) n = n * 2n + 1n; // his ears out, the very last
  }
  let body = "";
  while (n > 0n) {
    body = ALPHABET[Number(n % 32n)] + body;
    n /= 32n;
  }
  const k = tints.filter(Boolean).length;
  const code = (v3 ? VERSION3 : v2 ? VERSION2 : VERSION) + body.padStart(v3 ? BODY3(k) : v2 ? BODY2(k) : BODY, "0");
  return group(code + check(code));
}

/** What to share: the name, then the code. */
export const shareOf = (c: Character): string => `${c.name} · ${strandOf(c)}`;

/** A strand read back (with or without its name in front) into the orb it was, or why it does not read. */
export function readStrand(text: string, fallbackName = "Orb"): { ok: true; orb: Character } | { ok: false; why: string } {
  const t = text.trim();
  const dot = t.lastIndexOf("·");
  const name = dot > 0 ? t.slice(0, dot).trim() : "";
  const raw = (dot > 0 ? t.slice(dot + 1) : t).toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (!raw) return { ok: false, why: "There is no DNA there to read." };
  if (/[^0-9A-Z]/.test(raw) || /U/.test(raw)) return { ok: false, why: "That is not a DNA strand: it has letters a strand never uses." };
  if (raw[0] !== VERSION && raw[0] !== VERSION2 && raw[0] !== VERSION3) return { ok: false, why: "That strand is from a newer Orbz than this one." };
  const v3 = raw[0] === VERSION3;
  const v2 = raw[0] === VERSION2 || v3;
  const code = raw.slice(0, -1);
  const mistyped = { ok: false as const, why: "That DNA does not check out: a letter is missing or mistyped." };
  if (check(code) !== raw.at(-1) || (!v2 && raw.length !== BODY + 2)) return mistyped;
  let n = 0n;
  for (const ch of code.slice(1)) n = n * 32n + BigInt(ALPHABET.indexOf(ch));
  const tints: Partial<Record<(typeof TINTS)[number], string>> = {};
  let ears: "out" | null = null;
  if (v3) {
    ears = n % 2n === 1n ? "out" : null;
    n /= 2n;
  }
  if (v2) {
    const flags = Number(n % 16n);
    n /= 16n;
    for (let i = TINTS.length - 1; i >= 0; i--) {
      if (!(flags & (1 << i))) continue;
      tints[TINTS[i]!] = `#${(n % RGB).toString(16).padStart(6, "0")}`;
      n /= RGB;
    }
    if (raw.length !== (v3 ? BODY3 : BODY2)(Object.keys(tints).length) + 2) return mistyped;
  }
  const seed = Number(n % BigInt(SEED));
  n /= BigInt(SEED);
  const goo = Number(n % BigInt(GOO)) / 100;
  n /= BigInt(GOO);
  const orb: Record<string, unknown> = { name: name || fallbackName, seed, goo, ...tints, ...(ears && { ears }) };
  for (const f of [...(v2 ? FIELDS2 : FIELDS)].reverse()) {
    const at = Number(n % BigInt(f.cap));
    n /= BigInt(f.cap);
    const list = f.list();
    if (at >= list.length) return { ok: false, why: "That orb wears something this Orbz does not have yet." };
    orb[f.key] = list[at] ?? null;
  }
  if (n !== 0n) return { ok: false, why: "That DNA does not check out: it is too long." };
  return { ok: true, orb: orb as Character };
}

/** A check letter over the code: a weighted sum in the field of 32 (GF(2^5)), each place weighted by a
 * different power of a generator, so any one letter typed wrong (its change times a weight that is never
 * zero) and any two neighbours swapped (their difference times two different weights) always change it. */
function check(code: string): string {
  let sum = 0;
  let w = 1;
  for (let i = 0; i < code.length; i++) {
    w = gfMul(w, 2);
    sum ^= gfMul(w, ALPHABET.indexOf(code[i]!));
  }
  return ALPHABET[sum]!;
}
/** Multiplication in GF(32), by the primitive x^5 + x^2 + 1. */
function gfMul(a: number, b: number): number {
  let p = 0;
  for (let i = 0; i < 5; i++) {
    if (b & 1) p ^= a;
    b >>= 1;
    a <<= 1;
    if (a & 32) a ^= 0b100101;
  }
  return p;
}
const group = (s: string): string => s.match(/.{1,4}/g)!.join("-");
export type { HueName };
