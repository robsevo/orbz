// PLAN 5.47_t, a team's chemistry (owner, 10-14: friendships "help orbz better work together and match together"), pure:
// every two of a team, one not met counting as colleagues; its word by the mean; the best and worst pairs past their
// lines; for an orb not chosen, its worst friction first, else its best friend, else nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chemistryOf, chemistryWord, hintFor } from "../src/rooms/chemistry.ts";

const rows = [{ a: "nova", b: "pip", score: 62 }, { a: "iris", b: "nova", score: 30 }, { a: "nova", b: "remy", score: -35 }, { a: "pip", b: "iris", score: 44 }];

test("a team's chemistry: every pair, the mean's word, the best and the worst", () => {
  assert.equal(chemistryOf(rows, ["nova"]), null, "one orb: none");
  const great = chemistryOf(rows, ["nova", "pip", "iris"])!;
  assert.equal(great.score, Math.round((62 + 30 + 44) / 3));
  assert.equal(great.word, "Great chemistry");
  assert.deepEqual([great.best?.b, great.best?.word, great.worst], ["pip", "good friends", null]);
  const mixed = chemistryOf(rows, ["nova", "pip", "remy"])!;
  assert.equal(mixed.score, Math.round((62 - 35 + 0) / 3), "Pip and Remy never met: colleagues, 0");
  assert.equal(mixed.word, "Mixed");
  assert.deepEqual([mixed.worst?.b, mixed.worst?.word], ["remy", "some friction"]);
  assert.equal(chemistryOf(rows, ["nova", "remy"])!.word, "Friction");
  assert.deepEqual([40, 39, 15, 14, -14, -15].map(chemistryWord), ["Great chemistry", "Good chemistry", "Good chemistry", "Mixed", "Mixed", "Friction"]);
});

test("an orb not chosen yet: its worst friction first, else its best friend, else nothing", () => {
  assert.deepEqual(hintFor(rows, "pip", ["nova"]), { with: "nova", score: 62, word: "good friends" });
  assert.deepEqual(hintFor(rows, "remy", ["nova", "pip"]), { with: "nova", score: -35, word: "some friction" }, "a friction outweighs a friend");
  assert.deepEqual(hintFor(rows, "nova", ["remy", "pip"]), { with: "remy", score: -35, word: "some friction" });
  assert.equal(hintFor(rows, "remy", ["iris"]), null, "colleagues: nothing to say");
  assert.equal(hintFor(rows, "pip", []), null, "no one chosen yet");
});
