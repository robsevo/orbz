// A voice, heard before it is chosen (owner, 2026-10-02: "when user presses on a voice when
// creating their orb, we preview it"). Every voice says one short line in its own language,
// rendered ahead of time on the kit's Kokoro by `tools/voice_samples.py` (each one heard back by
// Whisper before it is kept) and shipped in `public/voices/`, so a preview needs no home, works on
// a phone and sends nothing anywhere. It plays at his personality's pace, the pitch kept; one
// plays at a time, and a new press stops the last.

// Each voice has several takes, a different line in each (owner, 10-04: "make the voices say something
// else each time when pressing them to preview"): takes.json, written by the same tool, lists the ones
// Whisper heard right, in order, and each press plays the next.
import TAKES from "./takes.json" with { type: "json" };

/** Where a voice's sample is, beside the page: its first take, or its `take`-th (from 0). */
export const sampleOf = (id: string, take = 0): string => {
  const list = (TAKES as Record<string, string[]>)[id] ?? [`${id}.mp3`];
  return `voices/${list[take % list.length] ?? `${id}.mp3`}`;
};
/** How many takes a voice has. */
export const takesOf = (id: string): number => (TAKES as Record<string, string[]>)[id]?.length ?? 1;

let playing: HTMLAudioElement | null = null;
const pressed = new Map<string, number>(); // how many times each voice has been heard: the next take is the one after

/** Plays a voice's next take at `speed` (his personality's), stopping any other; Silent stops only. */
export function preview(id: string, speed = 1): void {
  playing?.pause();
  playing = null;
  if (id === "silent" || typeof Audio === "undefined") return;
  const n = pressed.get(id) ?? 0;
  pressed.set(id, n + 1);
  const a = new Audio(sampleOf(id, n));
  a.preservesPitch = true;
  a.playbackRate = speed;
  playing = a;
  // a sample not there, or a browser that will not play: the press still picks the voice
  void a.play().catch(() => {});
}

/** Stops a preview (the creator closing, say). */
export function stopPreview(): void {
  playing?.pause();
  playing = null;
}
