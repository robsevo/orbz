// Each orb's glass, matched to its colour in the app (PLAN 2.1). His shader colours him by turning
// one palette about the grey axis (`hueRot`, uHue in turns), and Ash's own azure is 200° of that
// turn. The app's twelve hues are 30° apart in OKLCH, which a turn about the grey axis does not
// keep, so each orb's turn is found, not assumed: the turn whose resting tint (the mean of his
// listening palette, which uTint holds at rest) sits as far round from Ash's as the orb's colour
// sits from azure. Ash keeps exactly his 200°.
import { rgbToOklch } from "../design/color.ts";
import { HUES, type HueName } from "../design/tokens.ts";

type V3 = [number, number, number];

/** The shader's hueRot: a rotation about the grey axis, so brightness and saturation stay. */
export function hueRot(c: V3, turns: number): V3 {
  const a = turns * 2 * Math.PI;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const k = 1 / Math.sqrt(3);
  const dot = k * (c[0] + c[1] + c[2]);
  // c*cos + (k x c)*sin + k*(k.c)*(1 - cos)
  const cross: V3 = [k * c[2] - k * c[1], k * c[0] - k * c[2], k * c[1] - k * c[0]];
  return [0, 1, 2].map((i) => c[i]! * ca + cross[i]! * sa + k * dot * (1 - ca)) as V3;
}

// his listening palette (LST0..2 in the shader), whose mean is the tint he holds at rest
const REST: V3 = [(0.847 + 0.847 + 0.754) / 3, (0.473 + 0.691 + 0.847) / 3, (0.504 + 0.473 + 0.473) / 3];
export const ASH_TURN = 200 / 360;

export const tintHue = (turns: number): number => {
  const c = hueRot(REST, turns).map((v) => Math.max(0, Math.min(255, Math.round(v * 255)))) as V3;
  return rgbToOklch(c).h;
};
const wrap = (d: number): number => ((d + 540) % 360) - 180;

/** The turn for a colour at `angle` (its OKLCH hue): the one whose resting tint sits as far round from Ash's as the
 * colour sits from azure, a quarter degree of turn at a time. */
function searchTurn(angle: number): number {
  const want = (tintHue(ASH_TURN) + (angle - HUES[0]!.angle) + 360) % 360;
  let best = 0;
  let err = Infinity;
  for (let d = 0; d < 360; d += 0.25) {
    const e = Math.abs(wrap(tintHue(d / 360) - want));
    if (e < err) {
      err = e;
      best = d / 360;
    }
  }
  return best;
}
/** Any colour's turn (PLAN 2.20), turned as the 24 are; its angle to a quarter degree, kept once found. */
const turns = new Map<number, number>();
export function turnFor(angle: number): number {
  const key = Math.round((((angle % 360) + 360) % 360) * 4) / 4;
  const kept = turns.get(key) ?? searchTurn(key);
  turns.set(key, kept);
  return kept;
}

// the 24 by their own angles, exactly as they always were
export const ORB_TURNS: Record<HueName, number> = Object.fromEntries(HUES.map((h) => [h.name, h.name === "azure" ? ASH_TURN : searchTurn(h.angle)])) as Record<HueName, number>;

/** How far round from Ash's an orb's resting tint sits, in degrees (for the tests). */
export const tintOffset = (name: HueName): number => wrap(tintHue(ORB_TURNS[name]) - tintHue(ASH_TURN));
