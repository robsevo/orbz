// PLAN 5.44_t, an orb's brand (owner, 10-14: "how theyre perceived as a whole around the office ... bad relationships =
// worse brand, bad approved work = hit on your brand"):
//   - read by code off the log: everyone from 50; the whole office's friendships, a friction weighing more; the work you
//     judged by how hard it was, a job approved then corrected below one never approved; ideas; helping the others; the
//     record; each part inside its reach, lately counting most;
//   - what it changes: how a moment with it lands, who the others seek out, the board's votes, who fits a close call
//     (never over the work); the orb knows its own;
//   - a band crossed is said once (a notice, the board's report's office news); the door's career and /brands.
import assert from "node:assert/strict";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { FakeClock } from "../src/clock.ts";
import type { HomeEvent } from "../src/events.ts";
import { officeNews } from "../src/report.ts";
import { brandOf, brandWord, CHECK_MS, REACH, WORK_HALF_MS } from "../src/social/brand.ts";
import { NEUTRAL, pickMoment, pickPair } from "../src/social/rules.ts";
import { election } from "../src/boardroom.ts";
import { agentHome } from "./helpers.ts";

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 14, 12, 0).getTime();
const OFFICE = [{ id: "ada", name: "Ada" }, { id: "bo", name: "Bo" }, { id: "cy", name: "Cy" }, { id: "di", name: "Di" }];

/** A log written by hand, oldest first. */
function log(...rows: [type: string, data: Record<string, unknown>, orb?: string | null, ago?: number][]): HomeEvent[] {
  let feedback = 0;
  return rows.map(([type, data, orb = null, ago = 0], i) => {
    if (type === "trace.feedback") feedback = i + 1;
    // an XP entry's source "prev" is the verdict just before it, as the ledger names it
    return { seq: i + 1, at: NOW - ago, type, orb, conversation: null, data: data.source === "prev" ? { ...data, source: feedback } : data };
  });
}
const brand = (events: HomeEvent[], o: { orb?: string; seat?: string | null; at?: number } = {}) =>
  brandOf({ orb: o.orb ?? "ada", name: "Ada", office: OFFICE, events, at: o.at ?? NOW, seat: o.seat ?? null });
const part = (b: ReturnType<typeof brand>, key: string): number => b.parts.find((p) => p.key === key)!.points;
/** A job of Ada's: its run, your verdict, and the XP's tier when approved. */
const job = (run: number, verdict: "approve" | "correct", tier = "standard", ago = 0): [string, Record<string, unknown>, string | null, number][] => [
  ["run.started", { run }, "ada", ago],
  ["trace.feedback", { run, verdict }, null, ago],
  ...(verdict === "approve" ? [["xp.earned", { amount: 25, tier, source: "prev" }, "ada", ago] as [string, Record<string, unknown>, string | null, number]] : []),
];

test("everyone starts at 50, Steady, every part at nothing; the words by band", () => {
  const b = brand([]);
  assert.equal(b.score, 50);
  assert.equal(b.word, "Steady");
  assert.deepEqual(b.parts.map((p) => p.points), [0, 0, 0, 0, 0]);
  assert.deepEqual([90, 80, 79, 65, 64, 40, 39, 25, 24, 0].map(brandWord), ["Office star", "Office star", "Well regarded", "Well regarded", "Steady", "Steady", "Mixed reviews", "Mixed reviews", "On thin ice", "On thin ice"]);
});

test("people: the whole office's friendships as they stand, a friction weighing half again a friendship", () => {
  // Bo a good friend, then Cy friendly; Di, the last word with her, friction (an older higher number replaced)
  const events = log(
    ["social.met", { a: "ada", b: "bo", score: 60 }],
    ["social.moment", { a: "cy", b: "ada", score: 30 }],
    ["social.met", { a: "di", b: "ada", score: 10 }],
    ["social.moment", { a: "ada", b: "di", score: -40 }],
    ["social.met", { a: "bo", b: "cy", score: 90 }], // not Ada's: never counted
  );
  const b = brand(events);
  // (60 + 30 + -40 × 1.5) / 3 colleagues × 0.5 = 5
  assert.equal(part(b, "people"), 5);
  assert.match(b.parts[0]!.why, /1 good friend, 1 friendly, 1 friction/);
  // control: Di friendly (40) instead of at odds reads (60 + 30 + 40) / 3 × 0.5
  const even = brand(log(["social.met", { a: "ada", b: "bo", score: 60 }], ["social.met", { a: "ada", b: "cy", score: 30 }], ["social.met", { a: "ada", b: "di", score: 40 }]));
  assert.equal(part(even, "people"), 22);
  // bad relationships: everyone at odds is the bottom of its reach
  const odds = brand(log(...OFFICE.slice(1).map((o): [string, Record<string, unknown>] => ["social.met", { a: "ada", b: o.id, score: -80 }])));
  assert.equal(part(odds, "people"), -REACH.people);
  assert.ok(odds.score < 40 && odds.word === "Mixed reviews");
});

test("work you judged: by how hard it was; a job approved then corrected falls below one never approved", () => {
  const easy = brand(log(...job(1, "approve", "easy")));
  const expert = brand(log(...job(1, "approve", "expert")));
  assert.equal(part(easy, "work"), 1);
  assert.equal(part(expert, "work"), 4);
  // the owner's "bad approved work": approved, then corrected
  const bad = brand(log(...job(1, "approve"), ["trace.feedback", { run: 1, verdict: "correct" }]));
  const corrected = brand(log(["run.started", { run: 1 }, "ada"], ["trace.feedback", { run: 1, verdict: "correct" }]));
  assert.equal(part(bad, "work"), 2 - 5);
  assert.equal(part(corrected, "work"), -3);
  assert.ok(part(bad, "work") < 0 && part(bad, "work") < part(brand([]), "work"));
  // an ask denied, an undo; another orb's run is never Ada's
  const denied = brand(log(["card.resolved", { card: 1, status: "denied" }, "ada"], ["undo", { source: 9 }, "ada"], ["run.started", { run: 7 }, "bo"], ["trace.feedback", { run: 7, verdict: "approve" }]));
  assert.equal(part(denied, "work"), -5);
  assert.match(denied.parts[1]!.why, /1 ask denied, 1 undone/);
  // lately counts most: a fortnight-old approval is half of today's
  const old = brand(log(...[1, 2, 3, 4].flatMap((r) => job(r, "approve", "expert", WORK_HALF_MS))));
  const fresh = brand(log(...[1, 2, 3, 4].flatMap((r) => job(r, "approve", "expert"))));
  assert.equal(part(fresh, "work"), 16);
  assert.equal(part(old, "work"), 8);
  // and never past its reach
  const lots = brand(log(...Array.from({ length: 30 }, (_, i) => job(i + 1, "approve", "expert")).flat()));
  assert.equal(part(lots, "work"), REACH.work);
});

test("ideas, helping the others and the record", () => {
  const ideas = brand(log(["report.idea_approved", { idea: "a" }, "ada"], ["report.idea_passed", { idea: "b" }, "ada"], ["report.idea_approved", { idea: "c" }, "bo"]));
  assert.equal(part(ideas, "ideas"), 3);
  const help = brand(log(
    ["social.lesson", { lesson: 1, from: "ada", to: "bo" }], ["social.lesson_kept", { lesson: 1 }, "bo"],
    ["social.lesson", { lesson: 2, from: "ada", to: "cy" }], ["social.lesson_dropped", { lesson: 2 }, "cy"], // not kept: nothing
    ["social.lesson", { lesson: 3, from: "bo", to: "ada" }], ["social.lesson_kept", { lesson: 3 }, "ada"], // learned, not taught
    ["habit.promoted", { kind: "k", shared: { from: "ada" } }, "di"],
    ["board.ticked", { plan: 1, row: "1.1", reviewer: "ada" }],
  ));
  assert.equal(part(help, "helping"), 3 + 3 + 1);
  assert.match(help.parts[3]!.why, /1 lesson taught, 1 habit passed on, 1 review given/);
  const reviews = brand(log(...Array.from({ length: 20 }, (_, i): [string, Record<string, unknown>] => ["board.ticked", { plan: 1, row: `${i}`, reviewer: "ada" }])));
  assert.equal(part(reviews, "helping"), REACH.helping);
  assert.equal(part(brand([], { seat: "director" }), "record"), 4);
  assert.equal(part(brand([], { seat: "chair" }), "record"), 6);
  const record = brand(log(["orb.promoted", { to: "Mid" }, "ada"], ["tool.never", { tool: "rm" }, "ada"], ["orb.let_go", { name: "Ada" }, "ada", 30 * DAY]));
  assert.equal(part(record, "record"), 4 - 6 - 5);
  // only what had happened by `at` counts
  assert.equal(brand(log(["orb.promoted", { to: "Mid" }, "ada"]), { at: NOW - 1 }).score, 50);
});

test("what it changes: a moment with it lands warmer, the others seek it out, the board's votes lean to it", () => {
  // the same dice: at the top of its brand a moment lands warm that falls flat at the bottom
  let flips = 0;
  for (let i = 0; i < 200; i++) {
    const seq = [((i * 37) % 100) / 100, ((i * 61) % 100) / 100, ((i * 13) % 100) / 100, 0.5, 0.5];
    const roll = (): (() => number) => { let k = 0; return () => seq[k++ % seq.length]!; };
    const top = pickMoment(NEUTRAL, NEUTRAL, roll(), 100), bottom = pickMoment(NEUTRAL, NEUTRAL, roll(), 0);
    assert.ok(!(top.tone === "flat" && bottom.tone === "warm"), "never warmer for the lower brand");
    if (top.tone === "warm" && bottom.tone === "flat") flips++;
    // control: the same brand, the same moment
    assert.deepEqual(pickMoment(NEUTRAL, NEUTRAL, roll(), 50), pickMoment(NEUTRAL, NEUTRAL, roll(), 50));
  }
  assert.ok(flips > 20, `${flips} moments turned by brand alone`);
  // who is sought out: Ada starts every pick (the dice), Bo and Cy alike but for Cy's brand
  const seeded = (s: number): (() => number) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const met = (regard: (o: string) => number): number => {
    const r = seeded(7);
    let cy = 0;
    for (let i = 0; i < 1000; i++) {
      let k = 0;
      const p = pickPair(["ada", "bo", "cy"], () => NEUTRAL, () => 0, null, () => (k++ === 0 ? 0 : r()), regard);
      if (p?.[1] === "cy") cy++;
    }
    return cy;
  };
  const sought = met((o) => (o === "cy" ? 100 : 50)), even = met(() => 50);
  assert.ok(sought > 550, `Cy met ${sought} times in 1,000`);
  assert.ok(even > 430 && even < 570, `control: alike, Cy met ${even} times in 1,000`);
  // the board: Bo's and Cy's work alike, the voters as close to each; the brand folded into how they get on decides
  const m = (id: string, at: number) => ({ id, name: id, specialty: "frontend" as const, xp: 0, rank: 0, createdAt: at });
  const office = [m("ada", 1), m("bo", 2), m("cy", 3), m("di", 4)];
  const plain = election(office, { recent: () => 0, gets: () => 0 });
  const liked = election(office, { recent: () => 0, gets: (_v, o) => (o === "cy" ? 15 : 0) });
  assert.notEqual(plain.ranking[0], "cy");
  assert.equal(liked.ranking[0], "cy");
});

test("on a home: the door's career and /brands, the standing line, a band crossed said once", async (t) => {
  const clock = new FakeClock(NOW);
  const { home } = await agentHome(t, [], { clock, heartbeatMs: 86_400_000 });
  home.inbox.letGo("juniper");
  for (const o of OFFICE) home.inbox.addOrb(o.id, o.name, "frontend");
  // Ada: two good friends, an expert job approved, an idea taken; Di: friction with everyone, work corrected
  for (const [x, y, s] of [["ada", "bo", 70], ["ada", "cy", 60], ["ada", "di", 40], ["di", "bo", -70], ["di", "cy", -60]] as const)
    home.events.append("social.met", { a: x, b: y, score: s, meeting: 0 });
  for (const run of [1, 2, 3]) {
    home.events.append("run.started", { run }, { orb: "ada" });
    const f = home.events.append("trace.feedback", { run, verdict: "approve" });
    home.events.append("xp.earned", { amount: 60, tier: "expert", source: f, reason: "t" }, { orb: "ada" });
  }
  home.events.append("report.idea_approved", { idea: "x" }, { orb: "ada" });
  home.events.append("run.started", { run: 9 }, { orb: "di" });
  home.events.append("trace.feedback", { run: 9, verdict: "correct" });
  const ada = home.brand.of("ada"), di = home.brand.of("di");
  assert.ok(ada.score >= 65, `Ada ${ada.score}`);
  assert.ok(di.score < 40, `Di ${di.score}`);
  assert.equal(home.brand.all()[0]!.orb, "ada");
  assert.equal(home.brand.all().at(-1)!.orb, "di");
  assert.equal(home.brand.history("ada").length, 14);
  assert.equal(home.brand.history("ada").at(-1), ada.score);
  // the orb knows its own
  assert.match(home.brand.line("ada")!, /^Your brand around the office .*: (well regarded|office star)\.$/m);
  assert.match(home.brand.line("di")!, /held back by: how the office gets on with di\./i);
  assert.doesNotMatch(home.brand.line("ada")!, /\d/, "words, never its numbers (the cached prefix)");

  // a band crossed: said once, a notice and the office's news; not again until it moves
  await clock.advance(CHECK_MS); // the home looked when it opened, before any of this
  assert.equal(home.brand.due(), 2);
  assert.equal(home.brand.due(), 0, "not again within the check's minutes");
  await clock.advance(10 * 60_000);
  assert.equal(home.brand.due(), 0, "nor once it is said");
  const changed = home.events.ofType("brand.changed");
  assert.deepEqual(changed.map((e) => [e.orb, e.data.up]).sort(), [["ada", true], ["di", false]]);
  const notes = home.notices.list().filter((n) => /brand/.test(n.title));
  assert.equal(notes.length, 2);
  assert.ok(notes.some((n) => n.title === "Di's brand: mixed reviews" || n.title === "Di's brand: on thin ice"));
  const news = officeNews(home.events.ofType("brand.changed"), (o) => o).map((x) => x.text);
  assert.ok(news.some((x) => /^Ada's brand is (well regarded|office star) now$/.test(x)));

  // the door
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const get = async (path: string) => (await fetch(`http://127.0.0.1:${door.port}${path}`, { headers: { authorization: `Bearer ${door.token}` } })).json();
  const career = (await get("/orbs/ada/career")) as { brand: { score: number; word: string; parts: { key: string }[]; history: number[] } };
  assert.equal(career.brand.score, ada.score);
  assert.deepEqual(career.brand.parts.map((p) => p.key), ["people", "work", "ideas", "helping", "record"]);
  assert.equal(career.brand.history.length, 14);
  const all = (await get("/brands")) as { brands: { orb: string }[] };
  assert.equal(all.brands[0]!.orb, "ada");
});
