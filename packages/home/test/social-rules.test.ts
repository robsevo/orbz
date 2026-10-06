// PLAN 5.9_t, office life's rules, by code:
//   - how two orbs' traits get on: the same both ways; alike clicks; Nerve against Calm and Focus against
//     Humour rub; Care both have brings them together; two middling orbs get on a little;
//   - who meets: anyone with anyone (every pair, over many meetings), the sociable start more of them,
//     never the same two twice running unless no one else is free;
//   - what they do: a lesson only between friends with one to teach; more games the more Humour;
//   - how a meeting moves a friendship, its words, the office's day, the traits the app may send.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compat, deltaOf, inOfficeDay, NEUTRAL, nextOpening, pickKind, pickPair, readTraits, type Traits, wordOf,
} from "../src/social/rules.ts";

const T = (o: Partial<Traits>): Traits => ({ ...NEUTRAL, ...o });
/** Dice that repeat: the same rules, the same draws. */
function dice(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("how traits get on: symmetric; alike clicks, Nerve against Calm and Focus against Humour rub, shared Care helps", () => {
  const r = dice(1);
  for (let i = 0; i < 200; i++) {
    const a = T({ Pace: 2 + r() * 16, Humour: 2 + r() * 16, Calm: 2 + r() * 16, Nerve: 2 + r() * 16, Focus: 2 + r() * 16, Care: 2 + r() * 16 });
    const b = T({ Pace: 2 + r() * 16, Humour: 2 + r() * 16, Calm: 2 + r() * 16, Nerve: 2 + r() * 16, Focus: 2 + r() * 16, Care: 2 + r() * 16 });
    assert.equal(compat(a, b), compat(b, a), "the same both ways");
    assert.ok(compat(a, b) >= -1 && compat(a, b) <= 1);
  }
  const middling = compat(NEUTRAL, NEUTRAL);
  assert.ok(middling > 0 && middling < 0.3, `two middling orbs get on a little (${middling})`);
  assert.ok(compat(T({ Humour: 16, Pace: 15 }), T({ Humour: 15, Pace: 16 })) > compat(T({ Humour: 16, Pace: 15 }), T({ Humour: 4, Pace: 4 })), "alike clicks");
  assert.ok(compat(T({ Nerve: 18 }), T({ Calm: 18 })) < -0.5, "a lot of Nerve against a lot of Calm rubs");
  assert.ok(compat(T({ Focus: 17, Humour: 6 }), T({ Humour: 17, Focus: 6 })) < 0, "a lot of Focus against a lot of Humour rubs");
  assert.ok(compat(T({ Care: 16 }), T({ Care: 16 })) > compat(T({ Care: 4 }), T({ Care: 4 })), "Care both have brings them together");
});

test("who meets: anyone with anyone, the sociable start more, never the same two twice running unless no one else is free", () => {
  const traits: Record<string, Traits> = { ada: T({ Humour: 17, Care: 15, Pace: 15 }), bo: NEUTRAL, cy: NEUTRAL, di: T({ Humour: 3, Care: 3, Pace: 3 }) };
  const free = Object.keys(traits);
  const r = dice(7);
  const pairs = new Map<string, number>();
  const first = new Map<string, number>();
  let last: [string, string] | null = null;
  for (let i = 0; i < 3000; i++) {
    const p: [string, string] = pickPair(free, (o) => traits[o]!, () => 0, last, r)!;
    assert.notEqual(p[0], p[1]);
    if (last) assert.ok(!(last.includes(p[0]) && last.includes(p[1])), "not the same two twice running");
    const key = [...p].sort().join("+");
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
    first.set(p[0], (first.get(p[0]) ?? 0) + 1);
    last = p;
  }
  assert.equal(pairs.size, 6, `every two of four met (${[...pairs.keys()].join(", ")})`);
  assert.ok(first.get("ada")! > first.get("di")! * 1.5, `the sociable start more meetings (${first.get("ada")} against ${first.get("di")})`);
  assert.deepEqual(pickPair(["ada", "bo"], () => NEUTRAL, () => 0, ["ada", "bo"], r)!.sort(), ["ada", "bo"], "two free: they meet again");
  assert.equal(pickPair(["ada"], () => NEUTRAL, () => 0, null, r), null, "one free: no meeting");
  // a friend is a little likelier to be the one met, never the only one: of the meetings Ada starts, Bo (her
  // friend) is met more often than Cy, and Cy still sometimes
  const met = { bo: 0, cy: 0 };
  const r2 = dice(99);
  for (let i = 0; i < 4000; i++) {
    const [a, b] = pickPair(["ada", "bo", "cy"], () => NEUTRAL, (x, y) => ([x, y].includes("ada") && [x, y].includes("bo") ? 90 : 0), null, r2)!;
    if (a === "ada") met[b as "bo" | "cy"]++;
  }
  assert.ok(met.bo > met.cy * 1.5, `her friend met more often (${met.bo} against ${met.cy})`);
  assert.ok(met.cy > 0, "but not always");
});

test("what they do: a lesson only between friends with one to teach; more games the more Humour", () => {
  const r = dice(3);
  const kinds = (a: Traits, b: Traits, o: { lesson: boolean; score: number }): Map<string, number> => {
    const n = new Map<string, number>();
    for (let i = 0; i < 2000; i++) {
      const k = pickKind(a, b, o, r);
      n.set(k, (n.get(k) ?? 0) + 1);
    }
    return n;
  };
  assert.equal(kinds(NEUTRAL, NEUTRAL, { lesson: true, score: 10 }).get("lesson") ?? 0, 0, "not friends yet: no lesson");
  assert.equal(kinds(NEUTRAL, NEUTRAL, { lesson: false, score: 80 }).get("lesson") ?? 0, 0, "nothing to teach: no lesson");
  assert.ok((kinds(NEUTRAL, NEUTRAL, { lesson: true, score: 30 }).get("lesson") ?? 0) > 0, "friends with a lesson to teach");
  assert.ok((kinds(T({ Humour: 17 }), T({ Humour: 17 }), { lesson: false, score: 0 }).get("game") ?? 0) > (kinds(T({ Humour: 3 }), T({ Humour: 3 }), { lesson: false, score: 0 }).get("game") ?? 0));
});

test("a meeting moves a friendship by how they get on; a game lost by a sore loser stings; the words", () => {
  const mid = () => 0.5; // no noise
  assert.ok(deltaOf("coffee", compat(NEUTRAL, NEUTRAL), {}, mid) > 0, "middling orbs warm a little over coffee");
  assert.ok(deltaOf("coffee", compat(T({ Nerve: 18 }), T({ Calm: 18 })), {}, mid) < 0, "a clash cools, whatever they do");
  const c = compat(NEUTRAL, NEUTRAL);
  assert.ok(deltaOf("game", c, { loser: T({ Nerve: 18, Humour: 3 }) }, mid) < deltaOf("game", c, { loser: T({ Humour: 16, Nerve: 5 }) }, mid), "a sore loser stings");
  assert.deepEqual([60, 50, 25, 20, 0, -19, -20, -49, -50, -90].map(wordOf), [
    "good friends", "good friends", "friendly", "friendly", "colleagues", "colleagues", "some friction", "some friction", "don't get along", "don't get along",
  ]);
});

test("the office's day, and the traits the app may send", () => {
  assert.equal(inOfficeDay(new Date(2026, 9, 6, 6, 59).getTime()), false);
  assert.equal(inOfficeDay(new Date(2026, 9, 6, 7, 0).getTime()), true);
  assert.equal(inOfficeDay(new Date(2026, 9, 6, 22, 29).getTime()), true);
  assert.equal(inOfficeDay(new Date(2026, 9, 6, 22, 30).getTime()), false);
  assert.equal(nextOpening(new Date(2026, 9, 6, 23, 0).getTime()), new Date(2026, 9, 7, 7, 0).getTime());
  assert.equal(nextOpening(new Date(2026, 9, 6, 3, 0).getTime()), new Date(2026, 9, 6, 7, 0).getTime());
  assert.deepEqual(readTraits({ ...NEUTRAL, Pace: 12.34 }), { ...NEUTRAL, Pace: 12.3 });
  assert.equal(readTraits({ ...NEUTRAL, Pace: "fast" }), null);
  assert.equal(readTraits({ Pace: 10 }), null, "all seven");
  assert.equal(readTraits({ ...NEUTRAL, Nerve: 99 }), null);
});
