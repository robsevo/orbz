// The opening story's music (owner, 10-02: "opening story should have some cool ass music too").
// Made here, like every sound in the app (sound.ts): oscillators and a breath of noise, no samples,
// nobody else's files. A synthwave groove at 96 beats a minute in D minor, on the old epic loop
// (Dm, B flat, F, C): a warm pad under a filter and a round bass first, the kick coming in, then the
// hats, the snare and an arpeggio with an echo, then a little tune. After the build it loops, and it
// fades out when the story ends.
//
// The score is plain data from a pure function, so a test can read every note of it: in key, on the
// beat, never too loud (test/music.test.ts). The player starts on a press (a browser plays nothing
// before one) and only with sounds on.
import { schedule, soundsOn, type Note } from "./sound.ts";

export const BPM = 96;
export const BEAT = 60 / BPM;
export const BAR = 4 * BEAT;
const SIXTEENTH = BEAT / 4;
/** Bars before the loop (the build), and the bars that loop after it. */
export const INTRO_BARS = 4;
export const LOOP_BARS = 16;

/** MIDI note numbers: the chords of the loop, each as its root and its tones. */
const CHORDS: { root: number; tones: number[] }[] = [
  { root: 38, tones: [62, 65, 69] }, // D minor: D F A
  { root: 34, tones: [58, 62, 65] }, // B flat: B♭ D F
  { root: 41, tones: [65, 69, 72] }, // F: F A C
  { root: 36, tones: [60, 64, 67] }, // C: C E G
];
/** D natural minor, which is F major: every pitched note is one of these (by pitch class). */
export const KEY = new Set([2, 4, 5, 7, 9, 10, 0]);
/** The tune, by bar of the loop: [sixteenth, MIDI note, sixteenths long]. */
const TUNE: [number, number, number][][] = [
  [[0, 74, 4], [6, 72, 2], [8, 69, 6]],
  [[0, 70, 4], [4, 69, 2], [6, 65, 2], [8, 62, 8]],
  [[0, 72, 3], [3, 74, 3], [6, 77, 4], [12, 76, 4]],
  [[0, 74, 6], [8, 72, 2], [10, 69, 6]],
];

export type Layer = "pad" | "bass" | "arp" | "lead" | "kick" | "snare" | "hat";
export type Part = { layer: Layer; note: Note; midi: number | null };
const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** One bar's notes (times from the bar's start): bar 0 is the first of the story, and from
 * INTRO_BARS on the loop repeats. */
export function bar(n: number): Part[] {
  const looped = n < INTRO_BARS ? n : INTRO_BARS + ((n - INTRO_BARS) % LOOP_BARS);
  const chord = CHORDS[looped % 4]!;
  const inLoop = looped - INTRO_BARS; // < 0 in the build
  const out: Part[] = [];
  const pitched = (layer: Layer, midi: number, at: number, dur: number, gain: number, wave: OscillatorType, attack: number): void => {
    out.push({ layer, midi, note: { at, wave, f0: hz(midi), f1: hz(midi), dur, gain, attack } });
  };
  // the pad: the chord held for the bar, a slow swell (two detuned voices make it wide)
  for (const m of chord.tones) {
    pitched("pad", m, 0, BAR * 0.98, 0.022, "sawtooth", 0.45);
    pitched("pad", m - 12, 0, BAR * 0.98, 0.026, "triangle", 0.5);
  }
  // the bass: the root on the beat, an octave bounce on the off-beats once the loop starts
  for (let b = 0; b < 4; b++) {
    pitched("bass", chord.root, b * BEAT, BEAT * 0.55, 0.11, "triangle", 0.008);
    if (inLoop >= 0) pitched("bass", chord.root + 12, b * BEAT + BEAT / 2, BEAT * 0.3, 0.06, "triangle", 0.006);
  }
  // the kick from the third bar; four on the floor
  if (looped >= 2) for (let b = 0; b < 4; b++) out.push({ layer: "kick", midi: null, note: { at: b * BEAT, wave: "sine", f0: 150, f1: 45, dur: 0.22, gain: 0.24, attack: 0.002 } });
  if (inLoop >= 0) {
    // the hats on every eighth, the off-beats a little louder (the groove)
    for (let e = 0; e < 8; e++) out.push({ layer: "hat", midi: null, note: { at: e * (BEAT / 2), wave: "noise", f0: 8200, f1: 8200, dur: 0.035, gain: e % 2 ? 0.05 : 0.03, attack: 0.001 } });
    // the snare on two and four: a crack of noise and a little body under it
    for (const b of [1, 3]) {
      out.push({ layer: "snare", midi: null, note: { at: b * BEAT, wave: "noise", f0: 1900, f1: 1900, dur: 0.05, gain: 0.13, attack: 0.001 } });
      out.push({ layer: "snare", midi: null, note: { at: b * BEAT, wave: "triangle", f0: 210, f1: 150, dur: 0.09, gain: 0.07, attack: 0.002 } });
    }
    // the arpeggio: the chord's tones up and back down in sixteenths, an octave up
    const up = [...chord.tones, chord.tones[0]! + 12];
    const steps = [...up, ...up.slice(1, -1).reverse()];
    for (let s = 0; s < 16; s++) pitched("arp", steps[s % steps.length]! + 12, s * SIXTEENTH, SIXTEENTH * 0.8, 0.028, "square", 0.004);
  }
  // the tune, in the second half of the loop
  if (inLoop >= 8) {
    for (const [s, m, len] of TUNE[inLoop % 4]!) pitched("lead", m, s * SIXTEENTH, len * SIXTEENTH * 0.92, 0.05, "triangle", 0.02);
  }
  return out;
}

// ── the player ───────────────────────────────────────────────────────────────────────────────

declare global {
  /** Set to an array by a test: each bar the music plays is noted there. */
  var __orbsMusic: { bar: number; at: number }[] | undefined;
}

type Running = { ctx: AudioContext; out: GainNode; buses: Record<"pad" | "arp" | "dry", AudioNode>; next: number; n: number; timer: ReturnType<typeof setInterval> };
let running: Running | null = null;
/** How far ahead bars are put on the clock, so a busy page never stutters it. */
const AHEAD = 1.2;
export const VOLUME = 0.42;

/** Starts the music (on a press, with sounds on); a second start while it plays does nothing. */
export function startMusic(): void {
  if (running || !soundsOn()) return;
  try {
    const ctx = new AudioContext({ latencyHint: "playback" });
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, ctx.currentTime);
    out.gain.linearRampToValueAtTime(VOLUME, ctx.currentTime + 2.5); // it comes up, it never starts with a bang
    out.connect(ctx.destination);
    // the pad through a warm low-pass; the arpeggio into a dotted-eighth echo
    const warm = ctx.createBiquadFilter();
    warm.type = "lowpass";
    warm.frequency.value = 1500;
    warm.Q.value = 0.7;
    warm.connect(out);
    const echo = ctx.createDelay(1);
    echo.delayTime.value = BEAT * 0.75;
    const back = ctx.createGain();
    back.gain.value = 0.32;
    const arp = ctx.createGain();
    arp.connect(out);
    arp.connect(echo);
    echo.connect(back).connect(echo);
    echo.connect(out);
    const r: Running = { ctx, out, buses: { pad: warm, arp, dry: out }, next: ctx.currentTime + 0.1, n: 0, timer: setInterval(() => tick(r), 250) };
    running = r;
    if (ctx.state === "suspended") void ctx.resume();
    tick(r);
  } catch {
    running = null; // no audio here: the story plays on in silence
  }
}

function tick(r: Running): void {
  while (r.next < r.ctx.currentTime + AHEAD) {
    for (const p of bar(r.n)) schedule(r.ctx, p.layer === "pad" ? r.buses.pad : p.layer === "arp" ? r.buses.arp : r.buses.dry, [p.note], r.next);
    globalThis.__orbsMusic?.push({ bar: r.n, at: r.next });
    r.n++;
    r.next += BAR;
  }
}

/** Fades the music out and lets it go (the story ending, or the music turned off). */
export function stopMusic(fade = 1.5): void {
  const r = running;
  if (!r) return;
  running = null;
  clearInterval(r.timer);
  try {
    const now = r.ctx.currentTime;
    r.out.gain.cancelScheduledValues(now);
    r.out.gain.setValueAtTime(r.out.gain.value, now);
    r.out.gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => void r.ctx.close().catch(() => {}), (fade + 0.2) * 1000);
  } catch {
    // gone already
  }
}

export const musicPlaying = (): boolean => running !== null;
