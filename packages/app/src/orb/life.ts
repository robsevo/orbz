// An orb is never still (PLAN 2.1-2.3; owner, 2026-10-01: "more gooey and more anims"). At rest he
// breathes unevenly, blinks now and then, his shape drifts toward and away from a clean sphere,
// his eyes wander, and every few seconds he fidgets: looks round, wiggles, does a little hop. On
// top of that, gestures can be played: a hop (stretch to take off, squash to land, happy eyes), a
// wiggle, a squish when he is pressed, a jelly wobble, a pop when he appears, a doze, a pout, a nod,
// a wink.
// Ash's page gets the like from orblife.js and his voice; here each orb has a seed, so a page of
// them never moves in step. Pure: the same seed, gestures and time give the same frame.
import type { OrbFrame } from "./renderer.ts";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";
export type Gesture = "hop" | "wiggle" | "squish" | "jelly" | "look" | "pop" | "doze" | "pout" | "nod" | "wink";
export type Play = { gesture: Gesture; at: number };

const STATE: Record<OrbState, number> = { idle: 0, listening: 1, thinking: 2, speaking: 3 };
export const LENGTH: Record<Gesture, number> = { hop: 0.95, wiggle: 1.1, squish: 0.8, jelly: 1.7, look: 2.6, pop: 0.9, doze: 4.5, pout: 1.6, nod: 0.7, wink: 0.75 };

const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** Smooth value noise in one dimension, 0..1. */
function noise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i + seed * 13.7) * (1 - u) + hash(i + 1 + seed * 13.7) * u;
}
const bump = (x: number): number => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x) ** 2); // 0 → 1 → 0

/** 0..1 blink: closed for a moment every 2.5-6 s, on the orb's own rhythm; now and then twice in a
 * row, the way a face does. */
function blinkAt(t: number, seed: number): number {
  let at = hash(seed) * 3;
  for (let k = 0; at <= t + 1; k++) {
    const d = t - at;
    if (d >= 0 && d < 0.22) return bump(d / 0.22);
    if (hash(seed * 11.3 + k) < 0.2 && d >= 0.3 && d < 0.5) return bump((d - 0.3) / 0.2);
    at += 2.5 + 3.5 * hash(seed * 7.3 + k);
  }
  return 0;
}

/** Where his eyes go on their own between the slow wander: a quick glance to a new spot every two
 * or three seconds, held there, and now and then back to you (owner, 10-04: "have them feel just a
 * little more alive"; the wander alone read as a daydream). One slot at a time, so it costs the same
 * an hour in. */
function glanceAt(t: number, seed: number, reach: number): [number, number] {
  const P = 2.4;
  const u = t / P + hash(seed * 2.3);
  const k = Math.floor(u);
  const into = (u - k) * P;
  const when = 0.3 + hash(seed * 4.1 + k) * 1.5; // when in this slot the eyes move
  const spot = (j: number): [number, number] => (hash(seed * 6.7 + j) < 0.3 ? [0, 0] : [0.4 * reach * (hash(seed * 8.3 + j) - 0.5), 0.22 * reach * (hash(seed * 9.9 + j) - 0.5)]);
  const a = spot(k - 1);
  const b = spot(k);
  const x = Math.min(1, Math.max(0, (into - when) / 0.11));
  const e = x * x * (3 - 2 * x);
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
}

/** How a personality moves when left alone: which fidgets, how often, how deep he breathes, how far he sways. */
export type Motion = { kinds: Gesture[]; every: [number, number]; breath: number; sway: number };
const DEFAULT_MOTION: Motion = { kinds: ["look", "wiggle", "jelly", "hop", "nod", "look", "jelly"], every: [5, 11], breath: 1, sway: 1 };

/** The fidgets an idle orb does on his own, on his personality's rhythm. */
export function fidgets(seed: number, until: number, m: Motion = DEFAULT_MOTION): Play[] {
  const out: Play[] = [];
  // a little more often than each personality's rhythm says (owner, 10-04: "a little more alive")
  const [lo, hi] = [m.every[0] * 0.85, m.every[1] * 0.85];
  let at = 1.5 + hash(seed * 3.1) * lo;
  for (let k = 0; at < until; k++) {
    out.push({ gesture: m.kinds[Math.floor(hash(seed * 5.7 + k) * m.kinds.length)]!, at });
    at += lo + (hi - lo) * hash(seed * 1.9 + k);
  }
  return out;
}

/** One gesture's contribution, `d` seconds in. */
function apply(f: OrbFrame, g: Gesture, d: number): void {
  const L = LENGTH[g];
  if (d < 0 || d > L) return;
  const x = d / L;
  switch (g) {
    case "hop": {
      // crouch, stretch up and away, the arc, squash on landing, wobble out
      const crouch = d < 0.12 ? bump(d / 0.24) : 0;
      const air = d >= 0.12 && d < 0.56 ? (d - 0.12) / 0.44 : -1;
      const land = d >= 0.56 ? d - 0.56 : -1;
      f.squash += 0.28 * crouch;
      if (air >= 0) {
        f.sway[1] -= 16 * Math.sin(Math.PI * air); // 16: a top hat still clears his frame at the top of a hop
        f.squash -= 0.2 * (1 - air) * (air < 0.5 ? 1 : 0.4);
      }
      if (land >= 0) {
        f.squash += 0.34 * Math.exp(-land * 9) * Math.cos(land * 22);
        f.jiggle += 0.5 * Math.exp(-land * 5) * Math.sin(land * 24);
      }
      f.happy = Math.max(f.happy, bump(Math.min(1, x * 1.15)));
      break;
    }
    case "wiggle":
      f.sway[0] += 6 * Math.sin(d * 17) * Math.exp(-d * 2.6);
      f.tilt += 0.14 * Math.sin(d * 17 + 0.6) * Math.exp(-d * 2.6);
      f.jiggle += 0.25 * Math.sin(d * 17) * Math.exp(-d * 3);
      break;
    case "squish":
      f.squash += 0.5 * Math.exp(-d * 5.5) * Math.cos(d * 15);
      f.happy = Math.max(f.happy, bump(x));
      break;
    case "jelly":
      f.jiggle += Math.exp(-d * 2.4) * Math.sin(d * 2 * Math.PI * 3.1);
      break;
    case "look": {
      const s = Math.sin(x * 2 * Math.PI);
      f.gaze[0] += 0.55 * s;
      f.gaze[1] += 0.12 * Math.sin(x * 4 * Math.PI);
      f.tilt += 0.05 * s;
      break;
    }
    case "pop":
      f.wake = Math.max(f.wake, Math.exp(-d * 3.5));
      f.squash -= 0.32 * Math.exp(-d * 6) * Math.cos(d * 13);
      break;
    case "doze":
      f.sleepy = Math.max(f.sleepy, 0.9 * bump(x));
      f.breath *= 1 + 0.6 * bump(x);
      break;
    case "pout":
      f.mad = Math.max(f.mad, bump(x));
      f.sway[0] += 2.5 * Math.sin(d * 30) * bump(x);
      break;
    case "wink":
      // one eye shut for a moment, his head tipped toward it, a little squash of glee
      if (x > 0.12 && x < 0.72) f.wink = 1;
      f.tilt += 0.09 * bump(x);
      f.squash += 0.06 * bump(x);
      break;
    case "nod":
      f.sway[1] += 5 * Math.sin(x * 2 * Math.PI) * (1 - x);
      f.squash += 0.08 * Math.sin(x * 2 * Math.PI);
      break;
  }
}

export type LifeInput = {
  seed: number;
  turn: number;
  tint: number;
  goo: number;
  state: OrbState;
  /** His finish (spec.ts FINISHES) and a gradient's second colour. */
  sat?: number;
  val?: number;
  turn2?: number;
  grad?: number;
  /** A finish's own: how much colour he holds at rest (over `tint`), and a glow he keeps. */
  tintOf?: number;
  glow?: number;
  motion?: Motion;
  plays?: Play[];
  /** Where the pointer is, from his centre, in his radii (null when it is away). */
  pointer?: [number, number] | null;
  /** A still (a thumbnail): eyes open, no gesture, nothing that would catch him mid-move. */
  still?: boolean;
  /** A still that holds one moment of a gesture instead (the app's icon: a wink, happy eyes), `into` seconds in. */
  pose?: { gesture: Gesture; into: number };
};

export function lifeFrame(o: LifeInput, t: number): OrbFrame {
  const s = o.seed;
  const talking = o.state === "speaking" || o.state === "listening";
  // Ash's stand-in voice when there is no real one (index.1.js `fake`)
  const level = talking ? Math.max(0, 0.3 + 0.3 * Math.sin(t * 5.1 + s) + 0.22 * Math.sin(t * 11.3 + s * 2)) : 0;
  const m = o.motion ?? DEFAULT_MOTION;
  const f: OrbFrame = {
    hue: o.turn, tint: o.tintOf ?? o.tint, state: STATE[o.state], level, wake: o.glow ?? 0,
    breath: Math.sin(t * 1.15 * m.breath + s * 4) * (0.7 + 0.3 * noise(t * 0.2, s)),
    blink: blinkAt(t, s),
    morph: 0.25 + 0.6 * noise(t * 0.07, s + 3),
    gaze: (() => {
      const g = glanceAt(t, s, Math.min(1.2, 0.7 + 0.3 * m.sway));
      return [0.22 * (noise(t * 0.11, s + 5) - 0.5) + g[0], 0.16 * (noise(t * 0.09, s + 9) - 0.5) + g[1]] as [number, number];
    })(),
    sway: [1.2 * m.sway * (noise(t * 0.13, s + 11) - 0.5), 0.8 * m.sway * (noise(t * 0.17, s + 17) - 0.5)],
    happy: 0, sleepy: 0, yawn: 0, surprise: 0, tilt: 0.06 * (noise(t * 0.05, s + 23) - 0.5), mad: 0, jiggle: 0,
    sat: o.sat ?? 1, val: o.val ?? 1, hue2: o.turn2 ?? o.turn, grad: o.grad ?? 0, goo: o.goo, squash: 0, wink: 0,
  };
  f.sway[1] -= 0.6 * f.breath; // he rises a touch as he breathes in
  if (o.pointer) {
    // he looks at you, and leans a little toward you
    const [px, py] = o.pointer;
    const m = Math.min(1, Math.hypot(px, py) / 3);
    f.gaze = [Math.max(-0.8, Math.min(0.8, px * 0.35)) * (1 - 0.4 * m), Math.max(-0.6, Math.min(0.6, py * 0.3)) * (1 - 0.4 * m)];
    f.sway[0] += 1.5 * Math.max(-1, Math.min(1, px * 0.5));
  }
  if (o.still) {
    // a portrait: the same pose for every orb, so a picker compares the choices and not the moment
    Object.assign(f, { blink: 0, breath: 0, morph: 0.55, gaze: [0, 0], sway: [0, 0], tilt: 0 });
    if (o.pose) apply(f, o.pose.gesture, o.pose.into);
    return f;
  }
  for (const p of o.plays ?? []) apply(f, p.gesture, t - p.at);
  return f;
}
