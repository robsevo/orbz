// A voice, heard before it is chosen (owner, 2026-10-02: "when user presses on a voice when
// creating their orb, we preview it"). Every voice says one short line in its own language,
// rendered ahead of time on the kit's Kokoro by `tools/voice_samples.py` (each one heard back by
// Whisper before it is kept) and shipped in `public/voices/`, so a preview needs no home, works on
// a phone and sends nothing anywhere. It plays at his personality's pace, the pitch kept; one
// plays at a time, and a new press stops the last.

/** Where a voice's sample is, beside the page. */
export const sampleOf = (id: string): string => `voices/${id}.mp3`;

let playing: HTMLAudioElement | null = null;

/** Plays a voice's sample at `speed` (his personality's), stopping any other; Silent stops only. */
export function preview(id: string, speed = 1): void {
  playing?.pause();
  playing = null;
  if (id === "silent" || typeof Audio === "undefined") return;
  const a = new Audio(sampleOf(id));
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
