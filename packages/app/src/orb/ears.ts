// His ears in the app (PLAN 4.3): you talk to him through the page, on any device. Two ways:
//
//   press to talk     the microphone records while the button is down (or until pressed again);
//                     the home hears it (Whisper, through the kit) and it becomes your message
//   hands-free        a real conversation (PLAN 4.7): his NAME wakes him ("hey Hazel"), once; then
//                     each thing you say is a turn of its own, until a quiet spell or "thanks
//                     Hazel". Your turn ends when you sound finished (Smart Turn, at your first
//                     pause, with words that do not trail off) or after quiet, 1.4 s, or 5 s when
//                     you trail off; you can talk over him (an "mhm" lets him go on, your own words
//                     stop him and he listens); what Whisper could not make out is "didn't catch
//                     that", never a message. The turns are turns.ts's, by code; this file is the
//                     microphone and the home's answers
//
// Nothing is sent while nobody speaks, and nothing at all unless you turned it on. The audio goes
// only to your own home.
import type { Office } from "../home/link.ts";
import type { Character } from "./spec.ts";
import { type Act, type Ears, LONGEST_TURN_S, RATE, Turns, VOICED, withoutCall } from "./turns.ts";

export { RATE, withoutCall, type Ears };

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

/** Press to talk: records until the returned stop, then the home hears it. Resolves the words, and
 * whether Whisper was unsure of them ("didn't catch that", PLAN 4.7). */
export async function pressToTalk(home: Office, c: Character): Promise<{ stop: () => Promise<{ words: string; unsure: boolean }> }> {
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
      if (rms(all) < VOICED / 3) return { words: "", unsure: false };
      const h = await home.hear(c, wavOf(all));
      return { words: withoutCall(h.text, c.name), unsure: h.unsure };
    },
  };
}


/** Hands-free (PLAN 4.7): his name once, then a conversation. `he` says whether he is speaking or
 * working now, `saying` what he is saying (so his own voice, coming back, is not yours). Returns
 * its stop. */
export async function listenFor(
  home: Office,
  c: Character,
  o: {
    heard: (text: string) => void;
    /** Whisper could not make out what you said: "didn't catch that". */
    missed?: () => void;
    /** You took the floor while he spoke: stop him. */
    interrupt?: () => void;
    /** He leans in when called ("hop"), nods at your pause ("nod"). */
    cue?: (cue: "hop" | "nod") => void;
    state?: (s: Ears) => void;
    failed?: (why: string) => void;
    he?: () => { speaking: boolean; busy: boolean };
    saying?: () => string;
  },
): Promise<() => void> {
  const turns = new Turns(c.name);
  const keep = RATE * LONGEST_TURN_S;
  let buf = new Float32Array(0); // the last LONGEST_TURN_S seconds
  let total = 0;
  let stopped = false;
  const slice = (from: number, to: number): Float32Array => {
    const at = total - buf.length; // the sample buf[0] is
    return buf.slice(Math.max(0, from - at), Math.max(0, to - at));
  };
  const fail = (e: unknown): void => {
    turns.failed();
    if (!stopped) o.failed?.(e instanceof Error ? e.message : String(e));
  };
  // with `globalThis.__orbsEars` set to an array (tests do), every act and every answer is kept there
  const log = (e: Record<string, unknown>): void => {
    const l = (globalThis as { __orbsEars?: unknown[] }).__orbsEars;
    if (Array.isArray(l)) l.push({ ...e, at: performance.now() });
  };
  const answered = <T extends object>(kind: string, then: (x: T) => Act[]) => (x: T): void => {
    log({ answer: kind, ...x });
    run(then(x));
  };
  const run = (acts: Act[]): void => {
    if (stopped) return;
    for (const a of acts) {
      log({ act: a.kind, ...(a.kind === "heard" ? { words: a.words } : a.kind === "ears" ? { ears: a.ears } : "from" in a ? { s: ((a.to - a.from) / RATE).toFixed(2) } : {}) });
      if (a.kind === "woken") void home.woken(c, wavOf(slice(a.from, a.to))).then(answered("woken", (w) => turns.woke(w)), fail);
      else if (a.kind === "turn") void home.turn(c, wavOf(slice(a.from, a.to))).then(answered("turn", (t) => turns.turned(t)), fail);
      else if (a.kind === "overlap") void home.overlap(c, wavOf(slice(a.from, a.to)), o.saying?.() ?? "").then(answered("overlap", (x) => turns.overheard(x)), fail);
      else if (a.kind === "heard") o.heard(a.words);
      else if (a.kind === "missed") o.missed?.();
      else if (a.kind === "interrupt") o.interrupt?.();
      else if (a.kind === "ears") o.state?.(a.ears);
      else if (a.kind === "cue") o.cue?.(a.cue);
    }
  };
  const end = await microphone((a) => {
    const next = new Float32Array(Math.min(keep, buf.length + a.length));
    next.set(buf.subarray(Math.max(0, buf.length + a.length - keep)), 0);
    next.set(a, next.length - a.length);
    buf = next;
    total += a.length;
    run(turns.hear(a.length, rms(a), o.he?.() ?? { speaking: false, busy: false }));
  });
  o.state?.("listening");
  return () => {
    stopped = true;
    end();
  };
}
