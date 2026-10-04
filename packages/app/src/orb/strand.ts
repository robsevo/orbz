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
import { HUES, type HueName } from "../design/tokens.ts";
import { type AccessoryHue, type Character, EYES, FINISHES, GLASSES, HATS, PERSONALITIES, SHAPES, SPECIALTIES, VOICES } from "./spec.ts";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const VERSION = "1";

/** Each field: its list (what it stores is a place in it) and its room (the most it will ever hold). */
const voiceIds = (): string[] => ["ash", "silent", ...VOICES.map((v) => v.id).filter((v) => v !== "ash" && v !== "silent")];
const accessory = (): (AccessoryHue | null)[] => [null, ...HUES.map((h) => h.name), "white", "black"];
type Field = { key: keyof Character; list: () => readonly unknown[]; cap: number };
const FIELDS: Field[] = [
  { key: "personality", list: () => Object.keys(PERSONALITIES), cap: 32 },
  { key: "specialty", list: () => Object.keys(SPECIALTIES), cap: 64 },
  { key: "hue", list: () => HUES.map((h) => h.name), cap: 32 },
  { key: "hue2", list: () => [null, ...HUES.map((h) => h.name)], cap: 33 },
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

/** The code alone (no name), for an orb. */
export function strandOf(c: Character): string {
  if (!Number.isInteger(c.seed) || c.seed < 0 || c.seed >= SEED) throw new Error(`${c.name}'s dice (${c.seed}) do not fit a strand`);
  let n = 0n;
  for (const f of FIELDS) {
    const at = f.list().indexOf(c[f.key] ?? null);
    if (at < 0) throw new Error(`${c.name}'s ${f.key} (${String(c[f.key])}) is not one a strand knows`);
    n = n * BigInt(f.cap) + BigInt(at);
  }
  n = n * BigInt(GOO) + BigInt(Math.round(Math.max(0, Math.min(1, c.goo)) * 100));
  n = n * BigInt(SEED) + BigInt(c.seed);
  let body = "";
  while (n > 0n) {
    body = ALPHABET[Number(n % 32n)] + body;
    n /= 32n;
  }
  const code = VERSION + body.padStart(BODY, "0");
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
  if (raw[0] !== VERSION) return { ok: false, why: "That strand is from a newer Orbz than this one." };
  const code = raw.slice(0, -1);
  if (raw.length !== BODY + 2 || check(code) !== raw.at(-1)) return { ok: false, why: "That DNA does not check out: a letter is missing or mistyped." };
  let n = 0n;
  for (const ch of code.slice(1)) n = n * 32n + BigInt(ALPHABET.indexOf(ch));
  const seed = Number(n % BigInt(SEED));
  n /= BigInt(SEED);
  const goo = Number(n % BigInt(GOO)) / 100;
  n /= BigInt(GOO);
  const orb: Record<string, unknown> = { name: name || fallbackName, seed, goo };
  for (const f of [...FIELDS].reverse()) {
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
