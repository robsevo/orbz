// Who would suit the team (owner, 10-05: "which ones would best suit our team by rank"), orb/fit.ts:
//   - an applicant whose twin is already in the office brings nothing and complements nothing;
//   - the same applicant to an office that lacks its skills brings them, and says which;
//   - starting as the Senior counts, by exactly its weight;
//   - the ranking is best first, numbered from 1, a tie kept in the order it came.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applicant, surprise } from "../src/orb/spec.ts";
import { fitOf, ranked } from "../src/orb/fit.ts";

const pa = surprise(11, { specialty: "assistant" });
const dev = applicant(4242, "frontend");

test("a twin already in the office: nothing brought, nothing complemented; an office without its skills: they are brought, by name", () => {
  const twin = fitOf(dev, [{ ...dev, name: "Twin" }], "Junior");
  assert.deepEqual(twin.brings, [], "every skill already as strong in the office");
  assert.match(twin.why[0]!, /its skills your team already has/);
  assert.ok(twin.score <= 10 + 4, `only harmony and rank are left (${twin.score})`);
  const fresh = fitOf(dev, [pa], "Junior");
  assert.ok(fresh.brings.length > 0 && fresh.score > twin.score, `brings what the assistant lacks (${fresh.score} > ${twin.score})`);
  assert.match(fresh.why[0]!, /^brings \w+( and \w+)? your team is light on$/);
  assert.ok(fresh.brings.some((b) => b.skill === "Building" || b.skill === "Design"), "a frontend builder brings building or design to an assistant's office");
});

test("starting as the Senior counts by its weight, and says so", () => {
  const j = fitOf(dev, [pa], "Junior");
  const s = fitOf(dev, [pa], "Senior");
  assert.ok(Math.abs(s.score - j.score - 6) <= 1, `Senior 10 against Junior 4 (${s.score} vs ${j.score})`);
  assert.ok(s.why.includes("would lead its kind of work as the Senior"));
  assert.ok(!j.why.some((w) => /Senior/.test(w)));
});

test("ranked: the best first, numbered from 1; a tie keeps its order", () => {
  const f = (score: number) => ({ score, why: [], brings: [] });
  const r = ranked(["a", "b", "c", "d"], (x) => f({ a: 40, b: 70, c: 40, d: 90 }[x]!));
  assert.deepEqual(r.map((x) => [x.item, x.rank]), [["d", 1], ["b", 2], ["a", 3], ["c", 4]]);
  // and on real applicants: scores never rise down the list
  const pool = ["frontend", "writing", "research", "accountant"].map((k, i) => applicant(900 + i, k as never));
  const real = ranked(pool, (c) => fitOf(c, [pa], "Junior"));
  for (let i = 1; i < real.length; i++) assert.ok(real[i]!.fit.score <= real[i - 1]!.fit.score);
  for (const x of real) assert.ok(x.fit.score >= 0 && x.fit.score <= 100);
});
