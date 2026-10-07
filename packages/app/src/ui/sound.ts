// Sounds you can feel (owner, 2026-10-01: "when i push something, i wanna feel like im pushing it,
// with animations and sound and click but like addicting soft click"). Every sound is made here
// from a few oscillators and a breath of noise. There are no samples and nobody else's files.
//
// What makes a click soft and not tiring:
//   - it is a deep click (owner, 10-07: "more like a click and not a tok, a deep click. comforting"):
//     a low thump, a short knock and a muffled tick, all over in a few hundredths of a second. The
//     old one glided down for 65 ms, long enough to be heard as a note, the wooden "tok";
//   - it ramps in over a millisecond or two, so it never pops;
//   - no two presses are quite the same pitch;
//   - presses in quick succession climb a little, like a combo, and fall back once you stop;
//   - few things click at all (owner, 10-07: "limit them please"): what does is in feel.ts, and the
//     same sound twice within a quarter second is one (`pace`).
//
// The recipes are plain data and a pure function, so a test can render them offline and measure
// them (test/feel.test.ts).

export type Sound = "tap" | "tick" | "pick" | "roll" | "create" | "delete" | "poke" | "toggle" | "blip";

/** One voice of a sound. `at` and `dur` are in seconds; the pitch glides from f0 to f1. */
export type Note = { at: number; wave: OscillatorType | "noise"; f0: number; f1: number; dur: number; gain: number; attack: number };

/** The notes of a sound. `lift` is in semitones (the combo); `vary` is from -1 to 1 (no two presses alike). */
export function recipe(sound: Sound, lift = 0, vary = 0): Note[] {
  const k = 2 ** (lift / 12) * (1 + 0.03 * vary);
  const click = (at: number, f: number, gain: number): Note[] => [
    { at, wave: "triangle", f0: f * k, f1: f * 0.7 * k, dur: 0.045, gain, attack: 0.0015 }, // the thump, felt more than heard
    { at, wave: "sine", f0: f * 3.2 * k, f1: f * 2.6 * k, dur: 0.014, gain: gain * 0.3, attack: 0.001 }, // a knock, too short to be a note
    { at, wave: "noise", f0: 1300 * k, f1: 1300 * k, dur: 0.005, gain: gain * 0.5, attack: 0.001 }, // the latch, muffled
  ];
  switch (sound) {
    case "tap":
      return click(0, 190, 0.24);
    case "tick": // the goo slider's ratchet, a skip: lighter and a little higher
      return click(0, 280, 0.12);
    case "pick": // choosing something: the click, a little deeper and fuller
      return click(0, 170, 0.25);
    case "roll": {
      // a die tumbling: five clacks, each its own pitch and further apart, then it lands
      const out: Note[] = [];
      const gaps = [0, 0.04, 0.085, 0.14, 0.21];
      gaps.forEach((at, i) => {
        const wob = 1 + 0.08 * Math.sin(7.3 * (i + 1) + vary * 3);
        out.push({ at, wave: "sine", f0: 1500 * k * wob, f1: 1150 * k * wob, dur: 0.028, gain: 0.07 + 0.01 * i, attack: 0.001 });
      });
      return [...out, ...click(0.3, 180, 0.22)];
    }
    case "create": // a new orb: four notes rising (C E G C), and a sparkle
      return [
        ...[523.25, 659.25, 783.99, 1046.5].map((f, i): Note => ({ at: i * 0.075, wave: "triangle", f0: f, f1: f, dur: 0.24, gain: 0.14, attack: 0.004 })),
        { at: 0.3, wave: "sine", f0: 2093, f1: 2093, dur: 0.35, gain: 0.035, attack: 0.006 },
      ];
    case "delete": // a soft pop, going away
      return [{ at: 0, wave: "sine", f0: 620 * k, f1: 190 * k, dur: 0.17, gain: 0.16, attack: 0.002 }];
    case "poke": // his glass, pressed: a bubble that rises
      return [
        { at: 0, wave: "sine", f0: 240 * k, f1: 470 * k, dur: 0.12, gain: 0.18, attack: 0.002 },
        { at: 0.035, wave: "sine", f0: 480 * k, f1: 720 * k, dur: 0.08, gain: 0.06, attack: 0.002 },
      ];
    case "blip": // a letter as an orb talks: tiny and soft, in his own pitch (the lift), never twice the same
      return [{ at: 0, wave: "sine", f0: 680 * k, f1: 600 * k, dur: 0.03, gain: 0.05, attack: 0.002 }];
    case "toggle": // sounds on: two clicks rising
      return [...click(0, 200, 0.14), ...click(0.07, 280, 0.14)];
  }
}

/** How long a sound lasts, in seconds. */
export const lengthOf = (notes: Note[]): number => Math.max(...notes.map((n) => n.at + n.dur));

const noiseOf = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Plays a sound's notes into `out`, starting at `t0` on the context's clock. */
export function schedule(ctx: BaseAudioContext, out: AudioNode, notes: Note[], t0: number): void {
  for (const n of notes) {
    const start = t0 + n.at;
    const end = start + n.dur;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(n.gain, start + n.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    g.connect(out);
    let src: AudioScheduledSourceNode;
    if (n.wave === "noise") {
      let buf = noiseOf.get(ctx);
      if (!buf) {
        buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.05), ctx.sampleRate);
        const d = buf.getChannelData(0);
        let x = 12345;
        for (let i = 0; i < d.length; i++) d[i] = ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
        noiseOf.set(ctx, buf);
      }
      const b = ctx.createBufferSource();
      b.buffer = buf;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = n.f0;
      band.Q.value = 1.4;
      b.connect(band).connect(g);
      src = b;
    } else {
      const o = ctx.createOscillator();
      o.type = n.wave;
      o.frequency.setValueAtTime(n.f0, start);
      if (n.f1 !== n.f0) o.frequency.exponentialRampToValueAtTime(n.f1, start + n.dur * 0.6);
      o.connect(g);
      src = o;
    }
    src.start(start);
    src.stop(end + 0.01);
  }
}

// ── the player ───────────────────────────────────────────────────────────────────────────────

const KEY = "orbs.sounds";
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let on = ((): boolean => {
  try {
    return globalThis.localStorage?.getItem(KEY) !== "off";
  } catch {
    return true;
  }
})();
const paced: Pace = { last: {}, pressed: -1e9, streak: 0 };

declare global {
  /** Set to an array by a test (or a curious person): each sound played is noted there. */
  var __orbsSounds: { sound: Sound; lift: number }[] | undefined;
}

export const soundsOn = (): boolean => on;

export function setSounds(next: boolean): void {
  on = next;
  try {
    globalThis.localStorage?.setItem(KEY, next ? "on" : "off");
  } catch {
    // a private window: the choice lasts as long as the page
  }
  if (next) play("toggle");
}

export const QUIET_MS = 250;
export const COMBO_MS = 650;
export type Pace = { last: Partial<Record<Sound, number>>; pressed: number; streak: number };

/** How a sound at `t` (ms) is played after the ones before it, in `p`: null, not at all (the same
 * sound within QUIET_MS: a double press is one click); else its lift in semitones. Taps and picks in
 * quick succession climb (the combo); a blip, a letter as an orb talks, keeps its own pace and is
 * pitched by `voice`. No clock or audio of its own, so a test walks it on a clock it chooses. */
export function pace(p: Pace, sound: Sound, t: number, voice = 0): number | null {
  if (sound === "blip") return voice;
  if (t - (p.last[sound] ?? -1e9) < QUIET_MS) return null;
  p.last[sound] = t;
  if (sound !== "tap" && sound !== "pick") return 0;
  p.streak = t - p.pressed < COMBO_MS ? Math.min(p.streak + 1, 6) : 0;
  p.pressed = t;
  return p.streak * 0.7;
}

/** Plays a sound now, if sounds are on and its pace allows. */
export function play(sound: Sound, voice = 0): void {
  if (!on) return;
  const lift = pace(paced, sound, performance.now(), voice);
  if (lift === null) return;
  globalThis.__orbsSounds?.push({ sound, lift });
  try {
    ctx ??= new AudioContext({ latencyHint: "interactive" });
    if (!master) {
      master = ctx.createGain();
      master.gain.value = 0.8;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    schedule(ctx, master, recipe(sound, lift, Math.random() * 2 - 1), ctx.currentTime + 0.002);
  } catch {
    // no audio on this machine: the press still moves
  }
}
