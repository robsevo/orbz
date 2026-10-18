// The game studio's career paths (orb/careers.ts; owner, 10-18: "career paths more intricate ... to industry
// standards"), held to the roster and the home's ladder: every studio job has its six titles, every move leads to a job
// that exists, and the ladder is the home's own.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LEVELS as HOME_LEVELS } from "../../home/src/gym/levels.ts";
import { ladderOf, LEVELS, movesOf, PATHS, pathOf, titleAt, TRACKS } from "../src/orb/careers.ts";
import { SPECIALTIES } from "../src/orb/spec.ts";

const studio = Object.entries(SPECIALTIES).filter(([, v]) => (v as { family: string }).family === "studio").map(([k]) => k);

test("the ladder is the home's: the same six levels, in order", () => {
  assert.deepEqual([...LEVELS], [...HOME_LEVELS]);
});

test("every studio job has a path, and every path is a studio job (a job added to one and not the other fails)", () => {
  assert.ok(studio.length >= 27, `the studio has ${studio.length} jobs`);
  assert.deepEqual(Object.keys(PATHS).sort(), [...studio].sort());
});

test("each path climbs: six different titles, each rung's scope its track's, and its Senior rung the job's own title or its seniority", () => {
  for (const s of studio) {
    const ladder = ladderOf(s)!;
    assert.equal(ladder.length, 6, s);
    assert.equal(new Set(ladder.map((r) => r.title)).size, 6, `${s}: a title repeats`);
    for (const r of ladder) assert.ok(r.title && r.scope.endsWith("."), `${s} ${r.level}`);
    assert.deepEqual(ladder.map((r) => r.scope), [...TRACKS[pathOf(s)!.track].scope], s);
  }
  // the studio's own words, where a tech company's would be wrong
  assert.equal(titleAt("leveldesign", "Staff"), "Lead Level Designer");
  assert.equal(titleAt("gameplay", "Chief"), "Technical Director");
  assert.equal(titleAt("producer", "Junior"), "Associate Producer");
  assert.equal(titleAt("gameqa", "Junior"), "QA Tester");
  assert.equal(titleAt("studiohead", "Senior"), "Studio Head");
  assert.equal(titleAt("gamedirector", "Senior"), "Game Director");
});

test("a job outside the studio keeps the level before its title", () => {
  assert.equal(pathOf("data"), null);
  assert.equal(titleAt("data", "Senior"), `Senior ${SPECIALTIES.data.title}`);
  assert.equal(ladderOf("data"), null);
  assert.deepEqual(movesOf("data", "Senior"), []);
});

test("every move leads to a job that exists, never back to itself, and starts a level under (a Junior stays a Junior)", () => {
  for (const s of studio) {
    const p = pathOf(s)!;
    assert.ok(p.leads.length >= 1, `${s} leads nowhere`);
    for (const to of p.leads) {
      assert.ok(to in SPECIALTIES, `${s} leads to ${to}, which is not a job`);
      assert.notEqual(to, s);
    }
  }
  assert.deepEqual(movesOf("gameplay", "Senior").map((m) => m.title), ["AI Programmer", "Engine Programmer", "Game Designer", "Tools Programmer"]);
  assert.deepEqual(movesOf("gameplay", "Junior").map((m) => m.title)[0], "Junior AI Programmer");
  // into the office: the job's title alone, the office's ladder is the home's
  assert.equal(movesOf("studiohead", "Senior")[0]!.title, SPECIALTIES.ceo.title);
});

test("someone can always climb to run the studio: every job reaches the studio head by its moves", () => {
  for (const s of studio) {
    const seen = new Set([s]);
    const queue = [s];
    while (queue.length) for (const to of pathOf(queue.shift()!)?.leads ?? []) if (!seen.has(to)) (seen.add(to), queue.push(to));
    assert.ok(seen.has("studiohead") || s === "studiohead", `${s} never reaches the studio head`);
  }
});
