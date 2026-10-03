// His ears in the app (PLAN 4.3): you talk to him through the page, on any device. Two ways:
//
//   press to talk     the microphone records while the button is down (or until pressed again);
//                     the home hears it (Whisper, through the kit) and it becomes your message
//   hands-free        the page listens for his NAME ("hey Hazel"): a few seconds at a time, and
//                     only when something was said, are asked "was that him being called?"; once
//                     called, your turn is followed until you sound finished (Smart Turn, at the
//                     first 0.4 s pause) or a longer silence (1.4 s) ends it; what you said becomes
//                     your message, without the "hey Hazel" in front
//
// Nothing is sent while nobody speaks, and nothing at all unless you turned it on. The audio goes
// only to your own home.
import type { Office } from "../home/link.ts";
import type { Character } from "./spec.ts";

export const RATE = 16000;
/** Louder than this (RMS) is someone speaking. */
const VOICED = 0.012;
/** A pause this long asks whether you have finished; this long ends the turn whatever it says. */
export const EARLY_S = 0.4;
export const ENDPOINT_S = 1.4;
const WINDOW_S = 2.5;
const LONGEST_TURN_S = 20;

/** 16 kHz mono float samples as a 16-bit WAV, the way the home's ears read it. */
export function wavOf(samples: Float32Array, rate = RATE): Blob {
  const data = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string): void => [...s].forEach((ch, i) => data.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  data.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, 1, true);
  data.setUint32(24, rate, true);
  data.setUint32(28, rate * 2, true);
  data.setUint16(32, 2, true);
  data.setUint16(34, 16, true);
  text(36, "data");
  data.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => data.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
  return new Blob([data.buffer], { type: "audio/wav" });
}

/** What was said, without the call in front of it ("Hey Hazel, what's on?" → "what's on?"). */
export function withoutCall(text: string, name: string): string {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`^\\s*(?:(?:hey|hi|hello|okay|ok|yo)[,\\s]+)?${n}[,.!?\\s]*`, "i"), "").trim();
}

const rms = (a: Float32Array): number => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / Math.max(1, a.length));

/** The microphone at 16 kHz, its samples handed to `chunk` as they come. Returns its stop. */
async function microphone(chunk: (a: Float32Array) => void): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  const ctx = new AudioContext({ sampleRate: RATE });
  const src = ctx.createMediaStreamSource(stream);
  // a script processor rather than a worklet: a worklet's module would have to come from a URL of
  // the page's own, and this is the one node every browser still runs from the page itself
  const node = ctx.createScriptProcessor(2048, 1, 1);
  node.onaudioprocess = (e) => chunk(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(node);
  node.connect(ctx.destination);
  return () => {
    node.disconnect();
    src.disconnect();
    for (const t of stream.getTracks()) t.stop();
    void ctx.close();
  };
}

/** Press to talk: records until the returned stop, then the home hears it. Resolves the words. */
export async function pressToTalk(home: Office, c: Character): Promise<{ stop: () => Promise<string> }> {
  const got: Float32Array[] = [];
  const end = await microphone((a) => got.push(a));
  return {
    stop: async () => {
      end();
      const all = new Float32Array(got.reduce((n, a) => n + a.length, 0));
      let at = 0;
      for (const a of got) {
        all.set(a, at);
        at += a.length;
      }
      if (rms(all) < VOICED / 3) return "";
      return withoutCall(await home.hear(c, wavOf(all)), c.name);
    },
  };
}

export type Ears = "listening" | "called" | "hearing";

/** Hands-free: listens for his name, then for your turn; `heard` gets your words. Returns its stop. */
export async function listenFor(home: Office, c: Character, o: { heard: (text: string) => void; state?: (s: Ears) => void; failed?: (why: string) => void }): Promise<() => void> {
  const keep = RATE * LONGEST_TURN_S;
  let buf = new Float32Array(0); // the last LONGEST_TURN_S seconds
  let since = 0; // samples since the last question
  let voicedAt = -Infinity; // sample index of the last voiced chunk
  let total = 0;
  let turnFrom: number | null = null; // where the turn being followed began (a sample index)
  let asking = false;
  let askedThisPause = false;
  const tail = (s: number): Float32Array => buf.slice(Math.max(0, buf.length - Math.round(s * RATE)));
  const fromTurn = (): Float32Array => buf.slice(Math.max(0, buf.length - (total - (turnFrom ?? total))));
  const ask = async (fn: () => Promise<void>): Promise<void> => {
    asking = true;
    try {
      await fn();
    } catch (e) {
      o.failed?.(e instanceof Error ? e.message : String(e));
    } finally {
      asking = false;
    }
  };
  const end = await microphone((a) => {
    const next = new Float32Array(Math.min(keep, buf.length + a.length));
    next.set(buf.subarray(Math.max(0, buf.length + a.length - keep)), 0);
    next.set(a, next.length - a.length);
    buf = next;
    total += a.length;
    since += a.length;
    if (rms(a) > VOICED) {
      voicedAt = total;
      askedThisPause = false;
    }
    if (asking) return;
    const quiet = (total - voicedAt) / RATE;
    if (turnFrom === null) {
      // waiting for his name: a few seconds at a time, only after something was said
      if (since >= RATE * 1.2 && quiet < 1.5) {
        since = 0;
        const clip = tail(WINDOW_S);
        const cutAt = total; // where the clip ended: the answer comes back later, with more heard since
        void ask(async () => {
          const w = await home.woken(c, wavOf(clip));
          if (w.woken && turnFrom === null) {
            turnFrom = cutAt - clip.length; // the call and what follows it are one turn, however slow the answer
            askedThisPause = false;
            o.state?.("called");
          }
        });
      }
      return;
    }
    const long = (total - turnFrom) / RATE >= LONGEST_TURN_S - 0.5;
    const done = async (): Promise<void> => {
      const turn = fromTurn();
      turnFrom = null;
      o.state?.("hearing");
      const words = withoutCall(await home.hear(c, wavOf(turn)), c.name);
      o.state?.("listening");
      if (words) o.heard(words);
    };
    if (quiet >= ENDPOINT_S || long) void ask(done);
    else if (quiet >= EARLY_S && !askedThisPause) {
      askedThisPause = true; // once per pause: more silence is not news about what you said
      const turn = fromTurn();
      void ask(async () => {
        if ((await home.finished(c, wavOf(turn))).finished) await done();
      });
    }
  });
  o.state?.("listening");
  return end;
}
