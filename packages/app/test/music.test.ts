// PLAN 2.5_t, the opening story's music (owner, 10-02: "some cool ... music"), read note by note from
// its score (src/ui/music.ts), no audio needed:
//   - Every pitched note is in D minor; every note starts on the sixteenth grid, inside its bar.
//   - Never too loud: what sounds at once stays under full scale before the volume is even applied.
//   - The build: the pad and bass alone, then the kick, then the groove, then the tune; after the
//     build it loops, bar for bar.
//   - The key check's control: a planted note out of key is caught.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BAR, bar, BEAT, INTRO_BARS, KEY, LOOP_BARS, type Part } from "../src/ui/music.ts";

const SIXTEENTH = BEAT / 4;
const outOfKey = (parts: Part[]): number[] => parts.flatMap((p) => (p.midi !== null && !KEY.has(((p.midi % 12) + 12) % 12) ? [p.midi] : []));
const all = Array.from({ length: INTRO_BARS + LOOP_BARS }, (_, n) => bar(n));

test("in key, on the grid, inside its bar", () => {
  for (const [n, parts] of all.entries()) {
    assert.deepEqual(outOfKey(parts), [], `bar ${n}: every note in D minor`);
    for (const p of parts) {
      const steps = p.note.at / SIXTEENTH;
      assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9, `bar ${n} ${p.layer} at ${p.note.at}s is off the sixteenth grid`);
      assert.ok(p.note.at >= 0 && p.note.at < BAR && p.note.at + p.note.dur <= BAR + 1e-9, `bar ${n} ${p.layer} stays in its bar`);
    }
  }
  assert.deepEqual(outOfKey([{ layer: "lead", midi: 63, note: all[0]![0]!.note }]), [63], "control: an E flat is out of key, and is caught");
});

test("never too loud: what sounds at once stays under full scale", () => {
  for (const [n, parts] of all.entries()) {
    for (let s = 0; s < 16; s++) {
      const t = s * SIXTEENTH + 0.001;
      const sum = parts.filter((p) => p.note.at <= t && p.note.at + p.note.dur > t).reduce((a, p) => a + p.note.gain, 0);
      assert.ok(sum < 0.9, `bar ${n}, sixteenth ${s}: ${sum.toFixed(2)}`);
    }
  }
});

test("the build, then the loop", () => {
  const has = (n: number, layer: Part["layer"]) => bar(n).some((p) => p.layer === layer);
  assert.ok(has(0, "pad") && has(0, "bass") && !has(0, "kick") && !has(0, "hat"), "it opens on the pad and the bass alone");
  assert.ok(has(2, "kick") && !has(2, "snare"), "then the kick");
  assert.ok(["snare", "hat", "arp"].every((l) => has(INTRO_BARS, l as Part["layer"])) && !has(INTRO_BARS, "lead"), "then the groove");
  assert.ok(has(INTRO_BARS + 8, "lead"), "then the tune");
  for (let k = 0; k < LOOP_BARS; k++) assert.deepEqual(bar(INTRO_BARS + LOOP_BARS + k), bar(INTRO_BARS + k), `after the build it loops (bar ${k})`);
  assert.notDeepEqual(bar(1), bar(INTRO_BARS + 1), "control: the build is not the loop");
});
