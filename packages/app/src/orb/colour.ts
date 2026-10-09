// Any colour (PLAN 2.20; owner, 10-08: "We also want to be able to choose a bit more colors for our orbs and
// accessories. DNA should go with hex if possible. a lot more possibilities"): a colour as hex, the nearest of the 24 to
// it (what its words, its traits and the floor wear, so they keep the 24's tested contrast and rules), and what the
// shader's glass makes of it: its turn, found as the 24's are, and its strength and lightness as shares of azure's,
// which the 24 all share, so each of the 24 is drawn exactly as it always was. Pure.
import { parseHex, rgbToOklch } from "../design/color.ts";
import { AZURE, HUES, type HueName } from "../design/tokens.ts";
import { turnFor } from "./hues.ts";

/** A colour's hex ("#" and six digits, lower case), from what was typed (with or without its #, in any case); null
 * when it is not a colour. */
export function hexOf(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  return m ? `#${m[1]!.toLowerCase()}` : null;
}

/** The colour as the shader takes one: 0 to 1 a channel. */
export const rgb01 = (hex: string): [number, number, number] => parseHex(hex).map((v) => v / 255) as [number, number, number];

const REF = rgbToOklch(AZURE);
const wrap = (d: number): number => ((d + 540) % 360) - 180;

/** The nearest of the 24 round the wheel (a grey takes the hue it leans to). */
export function nearestHue(hex: string): HueName {
  const { h } = rgbToOklch(parseHex(hex));
  return HUES.reduce((a, b) => (Math.abs(wrap(b.angle - h)) < Math.abs(wrap(a.angle - h)) ? b : a)).name;
}

/** What the glass makes of a colour: its turn, and how strong and how light it is against azure (1 for the 24). */
export function glassOf(hex: string): { turn: number; sat: number; val: number } {
  const c = rgbToOklch(parseHex(hex));
  return { turn: turnFor(c.h), sat: Math.min(2, c.C / REF.C), val: Math.max(0.3, Math.min(1.35, c.L / REF.L)) };
}
