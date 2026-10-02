// PLAN 2.1_t, the parts that are arithmetic. A grid never leaves one item alone, and gives up a
// column to fill every row. A soft click is soft on paper: it ramps in, it is quiet, it is short,
// no two presses are the same pitch, and quick presses climb. (test/feel.test.ts renders the
// sounds and measures them; this checks the recipes.)
import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutOf, planGrid, rowsOf } from "../src/ui/balance.ts";
import { lengthOf, recipe, type Note, type Sound } from "../src/ui/sound.ts";

test("a grid never leaves one item alone on its last row, at any count and any width", () => {
  for (let n = 1; n <= 60; n++) {
    for (let max = 1; max <= 8; max++) {
      const plan = planGrid(n, max);
      const rows = rowsOf(plan);
      assert.equal(rows.reduce((a, b) => a + b, 0), n, `${n} at ${max}: every item placed`);
      assert.ok(Math.max(...rows) <= Math.max(1, max), `${n} at ${max}: no row wider than fits (${rows})`);
      // one alone on the last row only when it takes the whole row
      if (Math.max(...rows) > 1 && rows.at(-1) === 1) assert.equal(plan.spans.at(-1), plan.cols, `${n} at ${max}: one alone (${rows})`);
      for (const s of plan.spans) assert.ok(Number.isInteger(s) && s >= 1, `${n} at ${max}: a span of ${s}`);
      if (max >= 2 && n >= 2) assert.ok(rows.length < n, `${n} at ${max}: fell back to one column (${rows})`);
    }
  }
  assert.deepEqual(rowsOf(planGrid(8, 4)), [4, 4], "eight in fours");
  assert.deepEqual(rowsOf(planGrid(8, 3)), [2, 2, 2, 2], "eight: four rows of two, not 3 + 3 + 2");
  assert.deepEqual(rowsOf(planGrid(13, 4)), [4, 3, 3, 3], "thirteen at four across: even rows, not one column");
  assert.deepEqual(rowsOf(planGrid(13, 5)), [5, 5, 3]);
  assert.deepEqual(rowsOf(planGrid(24, 16)), [12, 12], "24 in twelves, not 16 + 8");
  // control: the check above does see a lone item when there is one
  assert.deepEqual(rowsOf({ cols: 2, spans: [1, 1, 1] }), [2, 1]);
  assert.deepEqual(planGrid(7, 2), { cols: 2, spans: [1, 1, 1, 1, 1, 1, 2] }, "seven, two across: three pairs and a full row");
});

test("an 'add one' tile takes the whole first row when that is what saves the rest", () => {
  const spanned = layoutOf(12, 2, true);
  assert.equal(spanned.spanLead, true, "13 in two columns would leave one: the tile spans, twelve in pairs");
  assert.deepEqual(rowsOf(spanned.plan), [2, 2, 2, 2, 2, 2]);
  const cell = layoutOf(12, 5, true);
  assert.equal(cell.spanLead, false, "13 in fives is 5 + 5 + 3: the tile is a cell");
  assert.deepEqual(rowsOf(cell.plan), [5, 5, 3]);
  assert.equal(layoutOf(0, 4, true).spanLead, false, "an empty office: the tile alone");
});

/** Why a sound would not be soft, if it would not. */
function harsh(notes: Note[], longest: number): string[] {
  const out: string[] = [];
  for (const n of notes) {
    if (n.attack < 0.001) out.push(`a ${n.wave} starts in ${n.attack * 1000} ms: it pops`);
    if (n.gain > 0.25) out.push(`a ${n.wave} at gain ${n.gain}: loud`);
    if (n.wave === "square" || n.wave === "sawtooth") out.push(`a ${n.wave}: buzzy`);
  }
  if (lengthOf(notes) > longest) out.push(`${lengthOf(notes).toFixed(3)} s long, over ${longest}`);
  return out;
}

const LONGEST: Record<Sound, number> = { tap: 0.08, tick: 0.04, pick: 0.13, roll: 0.37, create: 0.66, delete: 0.18, poke: 0.13, toggle: 0.11 };

test("every sound is soft: it ramps in, it is quiet, it is round, and it is over quickly", () => {
  for (const s of Object.keys(LONGEST) as Sound[]) assert.deepEqual(harsh(recipe(s), LONGEST[s]), [], s);
  // control: a planted click that pops, is loud, buzzes and rings on is caught on every count
  const bad: Note[] = [{ at: 0, wave: "square", f0: 3000, f1: 3000, dur: 0.4, gain: 0.9, attack: 0 }];
  assert.equal(harsh(bad, LONGEST.tap).length, 4);
});

test("no two presses alike, and quick presses climb", () => {
  const f = (lift: number, vary: number): number => recipe("tap", lift, vary)[0]!.f0;
  assert.notEqual(f(0, -1), f(0, 1), "the same press, a different pitch each time");
  assert.ok(Math.abs(f(0, 1) / f(0, -1) - 1) < 0.07, "but only a little different");
  assert.ok(f(2.1, 0) > f(1.4, 0) && f(1.4, 0) > f(0.7, 0) && f(0.7, 0) > f(0, 0), "a combo climbs");
  assert.ok(Math.abs(f(12, 0) / f(0, 0) - 2) < 1e-9, "a lift is in semitones");
});
