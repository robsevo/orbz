// PLAN 5.45_t, the office's culture (owner, 10-14: "culture too, which is affected by everyones brand ... see what you can
// add for culture to make it fun in the code as well"):
//   - by code: from 50; everyone's brand the most of it, how the office gets on (friction weighing more), the
//     fortnight's run-ins; each part inside its reach; its words by band;
//   - the fun of it: its flavour from the office's own traits, its traditions found in the fortnight's log (only past
//     their count, a moment's only when warm, older than a fortnight never), the culture champion of the week;
//   - what it changes: run-ins oftener and warmer in a warm office (control: the same dice at the middle);
//   - on a home: the door's /culture, every orb's standing line, a band crossed said once (a notice, the office's news).
import assert from "node:assert/strict";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { FakeClock } from "../src/clock.ts";
import type { HomeEvent } from "../src/events.ts";
import { officeNews } from "../src/report.ts";
import { CULTURE_CHECK_MS, CULTURE_REACH, cultureOf, cultureWord, momentLift, momentPace } from "../src/social/culture.ts";
import { NEUTRAL, pickMoment, type Traits } from "../src/social/rules.ts";
import { MOMENT_GAP_MAX_MS, MOMENT_GAP_MIN_MS } from "../src/social/social.ts";
import { agentHome } from "./helpers.ts";

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 14, 12, 0).getTime();
const OFFICE = ["ada", "bo", "cy", "di"].map((id) => ({ id, name: id[0]!.toUpperCase() + id.slice(1) }));
const T = (o: Partial<Traits>): Traits => ({ ...NEUTRAL, ...o });
const ev = (type: string, data: Record<string, unknown>, ago = DAY, orb: string | null = null): HomeEvent => ({ seq: 0, at: NOW - ago, type, orb, conversation: null, data });
function culture(o: { brands?: number[]; weekAgo?: number[]; friends?: Record<string, number>; events?: HomeEvent[]; traits?: Record<string, Partial<Traits>> } = {}) {
  const brands = o.brands ?? [50, 50, 50, 50];
  return cultureOf({
    office: OFFICE,
    brands: OFFICE.map((x, i) => ({ orb: x.id, score: brands[i]!, word: "Steady", weekAgo: o.weekAgo?.[i] ?? brands[i]! })),
    score: (a, b) => o.friends?.[[a, b].sort().join("-")] ?? 0,
    traits: (id) => T(o.traits?.[id] ?? {}),
    events: (o.events ?? []).map((e, i) => ({ ...e, seq: i + 1 })),
    at: NOW,
  });
}
const part = (c: ReturnType<typeof culture>, key: string): number => c.parts.find((p) => p.key === key)!.points;

test("from 50 with nothing; the words by band", () => {
  const c = culture();
  assert.equal(c.score, 50);
  assert.equal(c.word, "Finding its feet");
  assert.deepEqual([c.flavour, c.traditions, c.champion], [[], [], null]);
  assert.deepEqual([80, 75, 74, 60, 59, 40, 39, 25, 24].map(cultureWord), ["Thriving", "Thriving", "Warm", "Warm", "Finding its feet", "Finding its feet", "Chilly", "Chilly", "Tense"]);
});

test("everyone's brand the most of it; how the office gets on, friction weighing more; the floor's run-ins", () => {
  assert.equal(part(culture({ brands: [70, 66, 58, 50] }), "brands"), 11);
  assert.equal(part(culture({ brands: [100, 100, 100, 100] }), "brands"), CULTURE_REACH.brands);
  assert.equal(part(culture({ brands: [20, 30, 40, 30] }), "brands"), -20);
  // six pairs: three friendly, one at odds
  const friends = { "ada-bo": 40, "ada-cy": 25, "bo-cy": 60, "cy-di": -30 };
  assert.equal(part(culture({ friends }), "together"), Math.round(((3 - 1.5) / 6) * 30));
  // control: the same pair friendly instead
  assert.equal(part(culture({ friends: { ...friends, "cy-di": 30 } }), "together"), CULTURE_REACH.together);
  // the floor: warm run-ins against flat ones; one older than a fortnight never counts
  const moments = [...Array(3)].map(() => ev("social.moment", { kind: "bump", tone: "warm" })).concat(ev("social.moment", { kind: "bump", tone: "flat" }), ev("social.moment", { kind: "bump", tone: "flat" }, 15 * DAY));
  assert.equal(part(culture({ events: moments }), "floor"), 5);
  assert.match(culture({ events: moments }).parts[2]!.why, /3 of the fortnight's 4 run-ins/);
  const all = culture({ brands: [70, 66, 58, 50], friends, events: moments });
  assert.equal(all.score, 50 + 11 + 8 + 5);
  assert.equal(all.word, "Warm", "74: a point short of thriving");
  assert.deepEqual(all.brands.map((b) => b.orb), ["ada", "bo", "cy", "di"], "everyone's brand, the best first");
});

test("the fun of it: the office's flavour, its traditions, the culture champion of the week", () => {
  const c = culture({ traits: { ada: { Humour: 16, Curiosity: 13 }, bo: { Humour: 14, Curiosity: 12 }, cy: { Humour: 12, Focus: 8 } } });
  assert.deepEqual(c.flavour, ["playful", "curious"]);
  assert.deepEqual(culture({ traits: { ada: { Calm: 11 } } }).flavour, [], "a trait barely over the middle is no flavour");
  const games = [...Array(4)].map(() => ev("social.met", { kind: "game", place: "pingpong" }));
  const dances = [ev("social.moment", { kind: "dance", tone: "warm" }), ev("social.moment", { kind: "dance", tone: "warm" }), ev("social.moment", { kind: "dance", tone: "flat" })];
  const ideas = [...Array(2)].map(() => ev("social.met", { kind: "ideas", place: "bistro1" })); // two: not yet a tradition
  const old = [...Array(5)].map(() => ev("social.met", { kind: "coffee", place: "coffee" }, 20 * DAY)); // too long ago
  const t = culture({ events: [...games, ...dances, ...ideas, ...old] }).traditions;
  assert.deepEqual(t, [{ key: "pingpong", name: "Ping-pong after lunch", times: 4 }, { key: "disco", name: "Kitchen disco", times: 2 }]);
  // control: a third ideas meeting makes it one
  assert.ok(culture({ events: [...ideas, ev("social.met", { kind: "ideas", place: "bistro2" })] }).traditions.some((x) => x.key === "ideas"));
  const champ = culture({ brands: [60, 66, 55, 50], weekAgo: [58, 55, 56, 50] });
  assert.deepEqual(champ.champion, { orb: "bo", name: "Bo", rise: 11 });
  assert.equal(culture({ brands: [50, 50, 50, 50], weekAgo: [52, 51, 50, 50] }).champion, null, "no one rose: no champion");
});

test("what it changes: a warm office's run-ins come oftener and land warmer, a tense one's rarer and flatter", () => {
  assert.equal(momentPace(50), 1);
  assert.equal(momentPace(75), 0.75);
  assert.equal(momentPace(20), 1.25);
  assert.ok(momentLift(90) > 0 && momentLift(10) < 0 && momentLift(50) === 0);
  let flips = 0;
  for (let i = 0; i < 200; i++) {
    const seq = [((i * 37) % 100) / 100, ((i * 61) % 100) / 100, ((i * 13) % 100) / 100, 0.5, 0.5];
    const roll = (): (() => number) => { let k = 0; return () => seq[k++ % seq.length]!; };
    const warm = pickMoment(NEUTRAL, NEUTRAL, roll(), 50, momentLift(90)), tense = pickMoment(NEUTRAL, NEUTRAL, roll(), 50, momentLift(10));
    assert.ok(!(warm.tone === "flat" && tense.tone === "warm"));
    if (warm.tone === "warm" && tense.tone === "flat") flips++;
    assert.deepEqual(pickMoment(NEUTRAL, NEUTRAL, roll(), 50, momentLift(50)), pickMoment(NEUTRAL, NEUTRAL, roll(), 50), "control: the middle changes nothing");
  }
  assert.ok(flips > 15, `${flips} run-ins turned by the culture alone`);
});

test("on a home: the door's /culture, every orb's standing line, a band crossed said once", async (t) => {
  const clock = new FakeClock(NOW);
  const { home } = await agentHome(t, [], { clock, heartbeatMs: 86_400_000 });
  home.inbox.letGo("juniper");
  for (const o of OFFICE) home.inbox.addOrb(o.id, o.name, "frontend");
  for (const [x, y] of [["ada", "bo"], ["ada", "cy"], ["ada", "di"], ["bo", "cy"], ["bo", "di"], ["cy", "di"]] as const) {
    home.events.append("social.met", { a: x, b: y, score: 70, kind: "game", place: "pingpong" });
  }
  for (let i = 0; i < 4; i++) home.events.append("social.moment", { a: "ada", b: "bo", kind: "highfive", tone: "warm", score: 70 });
  const c = home.culture.now();
  assert.ok(c.score >= 75, `culture ${c.score}`);
  assert.equal(c.word, "Thriving");
  assert.deepEqual(c.traditions.map((x) => x.key), ["pingpong", "highfives"]);
  assert.match(home.culture.line()!, /The office's culture .*: thriving\.\n- Its traditions: Ping-pong after lunch, High fives in the aisle/);
  assert.doesNotMatch(home.culture.line()!, /\d/, "words, never its numbers (the cached prefix)");

  await clock.advance(CULTURE_CHECK_MS); // the home looked when it opened, before any of this
  assert.equal(home.culture.due(), true);
  assert.equal(home.culture.due(), false, "not again within the check's minutes");
  await clock.advance(CULTURE_CHECK_MS);
  assert.equal(home.culture.due(), false, "nor once it is said");
  const changed = home.events.ofType("culture.changed");
  assert.equal(changed.length, 1);
  assert.equal(changed[0]!.data.to, "Thriving");
  assert.ok(home.notices.list().some((n) => n.title === "The office's culture: thriving"));
  assert.deepEqual(officeNews(changed, (o) => o).map((x) => x.text), ["The office's culture is thriving now"]);

  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const got = (await (await fetch(`http://127.0.0.1:${door.port}/culture`, { headers: { authorization: `Bearer ${door.token}` } })).json()) as { culture: { score: number; brands: unknown[]; parts: { key: string }[] } };
  assert.equal(got.culture.score, c.score);
  assert.equal(got.culture.brands.length, 4);
  assert.deepEqual(got.culture.parts.map((p) => p.key), ["brands", "together", "floor"]);
});

test("on a home with office life on: the next run-in comes sooner in a thriving office, by its pace", async (t) => {
  const clock = new FakeClock(NOW);
  const { home } = await agentHome(t, [], { clock, heartbeatMs: 86_400_000, social: { on: true, dice: () => 0.5 } });
  home.inbox.letGo("juniper");
  for (const o of OFFICE) home.inbox.addOrb(o.id, o.name, "frontend");
  const gapAfter = (): { at: number; base: number } => {
    const last = home.events.ofType("social.moment").at(-1)!;
    // the usual gap, as social.ts draws it from the last run-in's own number
    return { at: last.at, base: MOMENT_GAP_MIN_MS + ((last.seq * 2654435761) % 1000) / 1000 * (MOMENT_GAP_MAX_MS - MOMENT_GAP_MIN_MS) };
  };
  // a new office, its culture near the middle: about the usual gap, by its pace
  home.events.append("social.moment", { a: "ada", b: "bo", kind: "bump", tone: "warm", score: 2 });
  home.events.append("social.moment", { a: "cy", b: "di", kind: "bump", tone: "flat", score: -1 });
  const plain = gapAfter();
  const pace = momentPace(home.culture.now().score);
  assert.ok(pace > 0.9 && pace <= 1.1, `near the middle: ${home.culture.now().score}`);
  assert.equal(home.social.nextMomentAt(), plain.at + Math.round(plain.base * pace));
  // a thriving office: a quarter sooner
  for (const [x, y] of [["ada", "bo"], ["ada", "cy"], ["ada", "di"], ["bo", "cy"], ["bo", "di"], ["cy", "di"]] as const) home.events.append("social.met", { a: x, b: y, score: 70, kind: "coffee", place: "coffee" });
  for (let i = 0; i < 4; i++) home.events.append("social.moment", { a: "ada", b: "bo", kind: "highfive", tone: "warm", score: 70 });
  await clock.advance(60_000); // the culture is read again a minute on
  const warm = gapAfter();
  assert.equal(home.culture.now().word, "Thriving");
  assert.equal(home.social.nextMomentAt(), warm.at + Math.round(warm.base * 0.75));
});
