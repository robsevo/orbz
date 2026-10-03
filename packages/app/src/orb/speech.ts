// His voice in the app (PLAN 4.3): a reply spoken in the voice you chose for him, at his
// personality's pace. The home says it (Ash's Kokoro, through the kit) a phrase at a time; the page
// plays the first while the next is made, so he starts speaking almost at once. One stop silences
// him at once (the playing phrase cut, the ones queued dropped), and the conversation's own Stop
// also ends his run.
//
// With `globalThis.__orbsSpeech` set to an array (tests do), every phrase played and every stop is
// written there, with its time, so a test can hold the stop to 300 ms.
import type { Office } from "../home/link.ts";
import type { Character } from "./spec.ts";

type Said = { kind: "phrase"; text: string; seconds: number; at: number } | { kind: "ended"; at: number } | { kind: "stopped"; at: number } | { kind: "done"; at: number };
const record = (s: Said): void => {
  const log = (globalThis as { __orbsSpeech?: Said[] }).__orbsSpeech;
  if (Array.isArray(log)) log.push(s);
};

let ctx: AudioContext | null = null;
let current: { stop: () => void } | null = null;
let words = ""; // what he is saying now: the phrase sounding and the one after it (PLAN 4.7)

/** Stops him speaking now: the phrase playing is cut, the rest are never fetched. */
export function stopSpeaking(): void {
  if (!current) return;
  current.stop();
  current = null;
  record({ kind: "stopped", at: performance.now() });
}

/** Whether he is speaking now. */
export const speaking = (): boolean => current !== null;

/** What he is saying now, so his own voice coming back through the microphone is not taken for
 * yours (PLAN 4.7): the phrase sounding and the next. Empty when he is quiet. */
export const saying = (): string => (current ? words : "");

/** Speaks `text` as `c` (stopping anything he was saying). Resolves when he has finished or was
 * stopped; a voice the home cannot speak resolves at once with why. */
export async function speak(home: Office, c: Character, speed: number, text: string): Promise<string | null> {
  stopSpeaking();
  if (c.voice === "silent" || !text.trim() || typeof AudioContext === "undefined") return null;
  ctx ??= new AudioContext();
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  const audio = ctx;
  let stopped = false;
  let source: AudioBufferSourceNode | null = null;
  const me = {
    stop: () => {
      stopped = true;
      try {
        source?.stop();
      } catch {
        // already over
      }
    },
  };
  current = me;
  try {
    const phrases = await home.phrasesFor(c, text, speed);
    // the next phrase is fetched while this one plays
    let next: Promise<ArrayBuffer> | null = phrases.length ? home.spoken(c, phrases[0]!, speed) : null;
    for (let i = 0; i < phrases.length && !stopped; i++) {
      const wav = await next!;
      next = i + 1 < phrases.length ? home.spoken(c, phrases[i + 1]!, speed) : null;
      if (stopped) break;
      const buf = await audio.decodeAudioData(wav);
      if (stopped) break;
      source = audio.createBufferSource();
      source.buffer = buf;
      source.connect(audio.destination);
      // when the phrase stops sounding: at its end, or the moment a stop cuts it
      const ended = new Promise<void>((ok) => source!.addEventListener("ended", () => (record({ kind: "ended", at: performance.now() }), ok()), { once: true }));
      source.start();
      words = [phrases[i], phrases[i + 1]].filter(Boolean).join(" ");
      record({ kind: "phrase", text: phrases[i]!, seconds: buf.duration, at: performance.now() });
      await ended;
    }
    if (!stopped) record({ kind: "done", at: performance.now() });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    if (current === me) current = null;
  }
}
