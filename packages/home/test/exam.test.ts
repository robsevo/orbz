// PLAN 3.5_t (the exam) and 3.4_t's bar, by Ash's eval gate (`brain/evals/run.mjs`), with scripted
// brains:
//   - Each case is sat k times and judged on its rate: the same calls, then an answer in its own
//     words. One that "claims" a pass without doing the work fails.
//   - A rate limit or an outage is no evidence: a case with nothing but is not judged, and says so.
//   - Against a baseline: a case that fell by the task margin, or the whole sitting by the suite
//     margin, regressed; ordinary noise did not. Another model, other sampling, or a sitting cut
//     short cannot be compared. With no baseline, nothing to fall from.
//   - The bar: only a full sitting, sampled more than once, every case judged, clears it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BrainCallError } from "../src/brain/openai.ts";
import type { Case, StepFn } from "../src/gym/cases.ts";
import { BAR, clears, gate, K, type Sitting, sit } from "../src/gym/exam.ts";

const bill = (run: number, subject: string): Case => ({
  run,
  input: { text: `[Trigger: bills] New email: ${subject}`, data: { trigger: "t1", subject } },
  steps: [
    { call: { name: "read_file", args: { path: "bills.csv" } }, result: "rent,1200\n", isError: false },
    { call: { name: "remind", args: { kind: "bill", title: subject, due: "2026-10-06" } }, result: "Kept (bill 1).", isError: false },
  ],
  output: `Kept ${subject} for you.`,
});
const CASES = [bill(1, "Rent"), bill(2, "Gym"), bill(3, "Water")];

/** A brain that does the work, in its own words, except on the repeats `wrong` names, by case. */
function brain(wrong: Record<number, number[]> = {}, limited: Record<number, number[]> = {}) {
  const seen = new Map<number, number>();
  return (c: Case): StepFn => {
    const n = seen.get(c.run) ?? 0;
    seen.set(c.run, n + 1);
    return async (input, done) => {
      if (limited[c.run]?.includes(n)) throw new BrainCallError("own", "rate limited", 429);
      const subject = String(input.data.subject);
      if (done.length === 0) return { call: { name: "read_file", args: { path: "bills.csv" } } };
      if (done.length === 1) return { call: { name: "remind", args: { kind: "bill", title: wrong[c.run]?.includes(n) ? "Rent" : subject, due: "2026-10-06" } } };
      return { output: `Done: ${subject} is on your list.` };
    };
  };
}

const sitting = (rates: Record<string, number | null>, o: Partial<Sitting> = {}): Sitting => {
  const r = Object.values(rates).filter((x): x is number => x !== null);
  return { kind: "bills", brain: "own-model", version: "p1", k: K, rates, suite: r.length ? r.reduce((a, b) => a + b, 0) / r.length : null, missing: [], ...o };
};

test("each case is sat k times and judged on its rate; its own words pass, a claim without the work does not", async () => {
  const s = await sit({ kind: "bills", brain: "own-model", version: "p1", cases: CASES, step: brain({ 2: [0, 3] }) });
  assert.deepEqual(s.rates, { 1: 1, 2: 0.6, 3: 1 }, "Gym kept as the rent twice in five");
  assert.equal(s.suite, 13 / 15);
  assert.equal(s.k, K);
  const claims = await sit({ kind: "bills", brain: "own-model", version: "p1", cases: CASES, k: 2, step: () => async () => ({ output: "All three pass, every time." }) });
  assert.deepEqual([claims.rates, claims.suite], [{ 1: 0, 2: 0, 3: 0 }, 0], "what it says about itself is never read");
});

test("a rate limit is no evidence: a case with nothing else is not judged, and says so", async () => {
  const s = await sit({ kind: "bills", brain: "own-model", version: "p1", cases: CASES, step: brain({}, { 1: [0, 1, 2, 3, 4], 2: [0] }) });
  assert.deepEqual(s.rates, { 1: null, 2: 1, 3: 1 }, "case 2's one limited repeat simply does not count");
  assert.equal(s.suite, 1);
  const v = gate(sitting({ 1: 1, 2: 1, 3: 1 }), s);
  assert.equal(v.verdict, "pass");
  assert.ok(v.why.includes("case 1: the brain could not be asked, not judged"), "said out loud");
  assert.equal(clears(s), false, "not every case judged: no move");
});

test("the gate: a case down by the margin or the sitting down by its margin regressed; noise did not; the incomparable is said so", () => {
  const base = sitting({ 1: 1, 2: 1, 3: 1 });
  assert.deepEqual(gate(base, sitting({ 1: 1, 2: 0.6, 3: 1 })).regressed, ["2"], "two of five lost");
  assert.equal(gate(base, sitting({ 1: 1, 2: 0.8, 3: 1 })).verdict, "pass", "one of five lost is noise");
  const ten = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i + 1), 1]));
  const v = gate(sitting(ten), sitting(Object.fromEntries(Object.keys(ten).map((k) => [k, 0.8]))));
  assert.deepEqual([v.verdict, v.regressed], ["regressed", []], "every case a little worse: the whole sitting fell");
  assert.match(v.why.join(" "), /the whole sitting fell from 100% to 80%/);
  assert.match(gate(base, sitting({ 1: 0, 2: 0, 3: 0 }, { brain: "other-model" })).why[0]!, /that is the model, not the playbook/);
  assert.equal(gate(base, sitting({ 1: 0, 2: 0, 3: 0 }, { brain: "other-model" })).verdict, "incomparable");
  assert.equal(gate(sitting({ 1: 1, 2: 1, 3: 1 }, { k: 1 }), sitting({ 1: 0.6, 2: 1, 3: 1 })).verdict, "incomparable", "one coin flip against a rate");
  assert.equal(gate(base, sitting({ 1: 1 }, { missing: [2, 3] })).verdict, "incomparable", "cut short");
  assert.deepEqual(gate(null, sitting({ 1: 0.2 })), { verdict: "pass", regressed: [], why: ["no baseline: nothing to fall from"] });
  assert.equal(gate(base, sitting({ 1: 1, 2: 1, 3: 1, 4: 0 })).regressed.length, 0, "a new case has nothing to fall from");
});

test("the bar: only a full sitting, sampled more than once, every case judged, at the bar, clears it", () => {
  assert.equal(clears(sitting({ 1: 1, 2: 0.6, 3: 1 })), 13 / 15 >= BAR);
  assert.equal(clears(sitting({ 1: 1, 2: 0.2, 3: 0.6 })), false, "under the bar");
  assert.equal(clears(sitting({ 1: 1, 2: 1, 3: 1 }, { k: 1 })), false, "once each is a coin flip");
  assert.equal(clears(sitting({ 1: 1 }, { missing: [2] })), false);
  assert.equal(clears(null), false, "no rate, no move");
});
