// Sounds you can feel (owner, 2026-10-01: "when i push something, i wanna feel like im pushing it,
// with animations and sound and click but like addicting soft click"). Every sound is made here
// from a few oscillators and a breath of noise. There are no samples and nobody else's files.
//
// What makes a click soft and not tiring:
//   - it is low and round: a short wooden "tock", not a bright beep;
//   - it ramps in over a millisecond or two, so it never pops;
//   - it dies in well under a tenth of a second;
//   - no two presses are quite the same pitch;
//   - presses in quick succession climb a little, like a combo, and fall back once you stop.
//
// The recipes are plain data and a pure function, so a test can render them offline and measure
// them (test/feel.test.ts).

export type Sound = "tap" | "tick" | "pick" | "roll" | "create" | "delete" | "poke" | "toggle" | "blip";

/** One voice of a sound. `at` and `dur` are in seconds; the pitch glides from f0 to f1. */
export type Note = { at: number; wave: OscillatorType | "noise"; f0: number; f1: number; dur: number; gain: number; attack: number };

/** The notes of a sound. `lift` is in semitones (the combo); `vary` is from -1 to 1 (no two presses alike). */
export function recipe(sound: Sound, lift = 0, vary = 0): Note[] {
  const k = 2 ** (lift / 12) * (1 + 0.03 * vary);
  const tock = (at: number, f: number, gain: number): Note[] => [
    { at, wave: "sine", f0: f * k, f1: f * 0.62 * k, dur: 0.065, gain, attack: 0.0015 }, // the body: a round wooden tock
    { at, wave: "noise", f0: 3200 * k, f1: 3200 * k, dur: 0.01, gain: gain * 0.22, attack: 0.001 }, // its tip
  ];
  switch (sound) {
    case "tap":
      return tock(0, 540, 0.22);
    case "tick": // a tab, the goo slider's ratchet: lighter and higher
      return [{ at: 0, wave: "sine", f0: 1250 * k, f1: 1050 * k, dur: 0.032, gain: 0.08, attack: 0.0012 }];
    case "pick": // choosing something: the tock, and a little ding a fifth above
      return [...tock(0, 540, 0.2), { at: 0.016, wave: "sine", f0: 810 * k * 1.5, f1: 810 * k * 1.5, dur: 0.11, gain: 0.07, attack: 0.003 }];
    case "roll": {
      // a die tumbling: five clacks, each its own pitch and further apart, then it lands
      const out: Note[] = [];
      const gaps = [0, 0.04, 0.085, 0.14, 0.21];
      gaps.forEach((at, i) => {
        const wob = 1 + 0.08 * Math.sin(7.3 * (i + 1) + vary * 3);
        out.push({ at, wave: "sine", f0: 1500 * k * wob, f1: 1150 * k * wob, dur: 0.028, gain: 0.07 + 0.01 * i, attack: 0.001 });
      });
      return [...out, ...tock(0.3, 470, 0.22)];
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
    case "toggle": // sounds on: two ticks rising
      return [
        { at: 0, wave: "sine", f0: 900, f1: 860, dur: 0.035, gain: 0.08, attack: 0.0012 },
        { at: 0.055, wave: "sine", f0: 1350, f1: 1300, dur: 0.045, gain: 0.08, attack: 0.0012 },
      ];
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
let last = -1e9;
let streak = 0;

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

/** Plays a sound now, if sounds are on. Taps and picks in quick succession climb (the combo); a
 * blip is pitched by `voice` (semitones: each orb talks in his own register). */
export function play(sound: Sound, voice = 0): void {
  if (!on) return;
  const t = performance.now();
  if (sound === "tap" || sound === "pick") {
    streak = t - last < 650 ? Math.min(streak + 1, 6) : 0;
    last = t;
  }
  const lift = sound === "tap" || sound === "pick" ? streak * 0.7 : sound === "blip" ? voice : 0;
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
