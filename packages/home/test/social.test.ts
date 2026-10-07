// PLAN 5.9_t, office life on a real home:
//   - off in a test home unless it says so (no other test's orbs wander off to meet);
//   - on, by the home's own timer: two free orbs meet every 20 to 40 minutes in the office's day, never an
//     orb with work waiting, none at night;
//   - a friendship grows with its meetings into good friends (a notice), and orbs that rub fall out;
//   - a lesson a friend has passes only on your Keep (Not now: never), and is not offered twice;
//   - an orb's standing context names its friends and frictions; who fits a row weighs them, never over
//     the work; the door: the office's friendships, an orb's friends, its traits, Keep and Not now.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { serve } from "../src/api.ts";
import { FakeClock } from "../src/clock.ts";
import { whoFits } from "../src/org.ts";
import { MOMENT_KINDS, NEUTRAL, pickMoment, type Traits } from "../src/social/rules.ts";
import { MEETING_MS, MOMENT_GAP_MAX_MS, MOMENT_GAP_MIN_MS } from "../src/social/social.ts";
import { agentHome } from "./helpers.ts";

const HOUR = 3_600_000;
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
const T = (o: Partial<Traits>): Traits => ({ ...NEUTRAL, ...o });

async function office(t: TestContext, on: boolean, start = new Date(2026, 9, 6, 9, 0).getTime()) {
  const clock = new FakeClock(start);
  // a heartbeat of a day: only a due meeting (or another due thing) wakes the home
  const { home, model } = await agentHome(t, [{ chunks: ["Hello."] }], { clock, heartbeatMs: 86_400_000, social: { on, dice: dice(11) } });
  home.inbox.letGo("juniper"); // the helper's own orb: this office is exactly the three below
  home.inbox.addOrb("ada", "Ada", "frontend");
  home.inbox.addOrb("bo", "Bo", "frontend");
  home.inbox.addOrb("cy", "Cy", "writing");
  return { home, model, clock };
}

test("off in a test home unless it says so: no orb wanders off to meet", async (t) => {
  // a test home that says nothing of office life, as every other test's does
  const clock = new FakeClock(new Date(2026, 9, 6, 9, 0).getTime());
  const { home } = await agentHome(t, [], { clock, heartbeatMs: 86_400_000 });
  home.inbox.addOrb("ada", "Ada", "frontend");
  home.inbox.addOrb("bo", "Bo", "frontend");
  home.start();
  await clock.advance(10 * HOUR);
  assert.equal(home.events.ofType("social.met").length, 0);
  assert.equal(home.social.nextAt(), null, "and the home's timer does not wake for it");
});

test("on: two free orbs meet every 20 to 40 minutes by the home's own timer, never one with work waiting, none at night", async (t) => {
  const { home, clock } = await office(t, true);
  home.inbox.pause("cy");
  home.inbox.send("cy", "chat:cy", "please write the newsletter"); // queued while paused: Cy has work waiting
  home.start();
  await clock.advance(6 * HOUR); // 09:00 to 15:00
  const met = home.events.ofType("social.met");
  assert.ok(met.length >= 9 && met.length <= 19, `every 20 to 40 minutes over six hours (${met.length})`);
  for (const e of met) assert.deepEqual([e.data.a, e.data.b].sort(), ["ada", "bo"], "Cy has work waiting: only Ada and Bo are free");
  const gaps = met.slice(1).map((e, i) => e.at - met[i]!.at);
  assert.ok(gaps.every((g) => g >= 20 * 60_000 && g <= 40 * 60_000 + 60_000), `20 to 40 minutes apart (${gaps.map((g) => Math.round(g / 60_000)).join(", ")} min)`);
  assert.ok(home.social.current().length <= 1, "one meeting under way at a time");
  assert.ok(met.every((e) => ["coffee", "ideas", "game"].includes(String(e.data.kind))), "no lesson: neither has one to teach");

  await clock.advance(10 * HOUR); // to 01:00: the office closed at 22:30
  const evening = home.events.ofType("social.met").filter((e) => new Date(e.at).getHours() >= 23 || new Date(e.at).getHours() < 7);
  assert.equal(evening.length, 0, "no one meets at night");
  const before = home.events.ofType("social.met").length;
  await clock.advance(7 * HOUR); // to 08:00
  assert.ok(home.events.ofType("social.met").length > before, "the office's day starts again at 07:00");
});

// moments (owner, 10-07: "more micro interactions and situations between orbs that affect friendships that affect their
// mood in office, but not too many ... goofy and funny as well")
test("a moment: which, how it went and a line each, by code; warm moves a friendship up a point or three, flat down one or two; it lands more between orbs that get on", () => {
  const r = dice(3);
  const kinds = new Set<string>();
  const GESTURES = ["hop", "wink", "wiggle", "squish", "jelly", "look", "pout", "doze", "nod"];
  for (let i = 0; i < 2000; i++) {
    const m = pickMoment(T({ Humour: 12 }), T({ Care: 12 }), r);
    kinds.add(m.kind);
    assert.ok(m.lines.every((l) => l.trim().length > 1), "a line each");
    assert.ok(m.gestures.every((g) => GESTURES.includes(g)), `gestures an orb has (${m.gestures})`);
    if (m.tone === "warm") assert.ok(m.delta >= 1 && m.delta <= 3, `warm: +1 to +3 (${m.delta})`);
    else assert.ok(m.delta <= -1 && m.delta >= -2, `flat: -1 or -2 (${m.delta})`);
  }
  assert.deepEqual([...kinds].sort(), [...MOMENT_KINDS].sort(), "every kind comes up");
  const warmth = (a: Traits, b: Traits): number => {
    const rr = dice(9);
    let n = 0;
    for (let i = 0; i < 2000; i++) if (pickMoment(a, b, rr).tone === "warm") n++;
    return n / 2000;
  };
  const click = warmth(T({ Humour: 16, Pace: 12, Care: 14 }), T({ Humour: 16, Pace: 12, Care: 14 }));
  const rub = warmth(T({ Nerve: 18, Focus: 18, Humour: 3 }), T({ Calm: 18, Humour: 18, Care: 4 }));
  assert.ok(click > rub + 0.15, `it lands more between orbs that get on (${click.toFixed(2)} vs ${rub.toFixed(2)})`);
});

test("moments: one every 6 to 12 minutes in the office's day between two free orbs not in a meeting; each moves their friendship by its delta; none at night; none while office life is off", async (t) => {
  const { home, clock } = await office(t, true);
  home.inbox.pause("cy");
  home.inbox.send("cy", "chat:cy", "please write the newsletter"); // Cy has work waiting
  home.start();
  await clock.advance(3 * 3_600_000); // 09:00 to 12:00
  const ms = home.events.ofType("social.moment");
  assert.ok(ms.length >= 12 && ms.length <= 31, `every 6 to 12 minutes, alongside the meetings (${ms.length} in three hours)`);
  const gaps = ms.slice(1).map((e, i) => e.at - ms[i]!.at);
  // one due while the two are in a meeting waits for it to end (looked at again every five minutes)
  assert.ok(gaps.every((g) => g >= MOMENT_GAP_MIN_MS && g <= MOMENT_GAP_MAX_MS + MEETING_MS + 5 * 60_000 + 60_000), `6 to 12 minutes apart, or once the two are out of a meeting (${gaps.map((g) => Math.round(g / 60_000)).join(", ")} min)`);
  assert.ok(gaps.filter((g) => g <= MOMENT_GAP_MAX_MS + 60_000).length >= gaps.length / 2, "mostly within 12 minutes");
  for (const e of ms) assert.deepEqual([e.data.a, e.data.b].sort(), ["ada", "bo"], "Cy has work waiting: only Ada and Bo are free");
  // never with one in a meeting under way
  const met = home.events.ofType("social.met");
  for (const e of ms) assert.ok(!met.some((m) => m.at <= e.at && Number(m.data.until) > e.at), "not while a meeting is under way");
  // the friendship is the meetings' and the moments' deltas, summed
  const sum = [...met, ...ms].reduce((n, e) => n + Number(e.data.delta), 0);
  assert.equal(home.social.score("ada", "bo"), Math.max(-100, Math.min(100, sum)), "each moment moved it by its own delta");
  assert.match(String(ms[0]!.data.lines), /\w/);
  assert.deepEqual(ms[0]!.data.names, [ms[0]!.data.a === "ada" ? "Ada" : "Bo", ms[0]!.data.a === "ada" ? "Bo" : "Ada"]);
  await clock.advance(11 * 3_600_000); // to 23:00
  const night = home.events.ofType("social.moment").filter((e) => new Date(e.at).getHours() >= 23 || new Date(e.at).getHours() < 7);
  assert.equal(night.length, 0, "none at night");
});

test("off in a test home: no moments, and the timer does not wake for them", async (t) => {
  const { home, clock } = await office(t, false);
  home.start();
  await clock.advance(5 * 3_600_000);
  assert.equal(home.events.ofType("social.moment").length, 0);
  assert.equal(home.social.nextMomentAt(), null);
});

test("a friendship grows into good friends (a notice); orbs that rub fall out", async (t) => {
  const { home } = await office(t, false);
  home.social.setTraits("ada", T({ Humour: 15, Pace: 13, Care: 15, Curiosity: 14 }));
  home.social.setTraits("bo", T({ Humour: 15, Pace: 13, Care: 15, Curiosity: 14 }));
  home.social.setTraits("cy", T({ Nerve: 18, Focus: 17, Humour: 3 }));
  for (let i = 0; i < 400 && home.social.score("ada", "bo") < 50; i++) home.social.meet();
  assert.ok(home.social.score("ada", "bo") >= 50, "alike, they became good friends");
  assert.equal(home.events.ofType("social.friends").length, 1, "said once");
  assert.ok(home.notices.list().some((n) => n.kind === "friends" && /^(Ada and Bo|Bo and Ada) are good friends now$/.test(n.title)));
  for (let i = 0; i < 400 && home.social.score("ada", "cy") > -50; i++) home.social.meet();
  assert.ok(home.social.score("ada", "cy") <= -50, "a lot of Nerve and Focus against Ada's Humour: they fell out");
  assert.ok(home.notices.list().some((n) => n.kind === "friends" && /have fallen out$/.test(n.title)));
  const words = Object.fromEntries(home.social.of("ada").map((c) => [c.name, c.word]));
  assert.deepEqual(words, { Bo: "good friends", Cy: "don't get along" });
});

test("learning off each other: a friend's lesson passes only on your Keep, Not now keeps it out, nothing is offered twice", async (t) => {
  const { home } = await office(t, false);
  home.social.setTraits("ada", T({ Humour: 15, Care: 15 }));
  home.social.setTraits("bo", T({ Humour: 15, Care: 15 }));
  home.learned.add("ada", "Say the price first, then the reasons.");
  home.learned.add("ada", "Check the date format before sending.");
  home.inbox.letGo("cy");
  for (let i = 0; i < 400 && home.social.lessons().length === 0; i++) home.social.meet();
  const [first] = home.social.lessons();
  assert.ok(first, "friends met, and Ada had something Bo lacks");
  assert.deepEqual([first.from, first.to], ["ada", "bo"]);
  assert.ok(home.social.score("ada", "bo") >= 20, "only between friends");
  assert.ok(!home.learned.list("bo").includes(first.line), "not learned before your yes");
  const note = home.notices.list().find((n) => n.kind === "learning")!;
  assert.equal(note.lesson, first.id);
  assert.equal(note.title, "Bo could learn this from Ada");
  assert.equal(note.detail, first.line);
  home.social.keepLesson(first.id);
  assert.ok(home.learned.list("bo").includes(first.line), "your Keep: it is Bo's");
  assert.ok(!home.notices.list().some((n) => n.lesson === first.id), "and its notice is put away");
  assert.throws(() => home.social.keepLesson(first.id), /no lesson by that number is waiting/);

  for (let i = 0; i < 400 && home.social.lessons().length === 0; i++) home.social.meet();
  const [second] = home.social.lessons();
  assert.ok(second && second.line !== first.line, "the other lesson, never the same one again");
  home.social.dropLesson(second.id);
  assert.ok(!home.learned.list("bo").includes(second.line), "Not now: never learned");
  for (let i = 0; i < 200; i++) home.social.meet();
  assert.equal(home.social.lessons().length, 0, "a lesson you said no to is not offered again");
});

test("an orb knows its friends and frictions; who fits weighs them, never over the work; the door", async (t) => {
  const { home, model } = await office(t, false);
  home.social.setTraits("ada", T({ Humour: 15, Pace: 13, Care: 15 }));
  home.social.setTraits("bo", T({ Humour: 15, Pace: 13, Care: 15 }));
  home.social.setTraits("cy", T({ Nerve: 18, Focus: 17, Humour: 3 }));
  for (let i = 0; i < 600 && (home.social.score("ada", "bo") < 50 || home.social.score("bo", "cy") > -20); i++) home.social.meet();
  const line = home.social.colleaguesLine("bo")!;
  assert.match(line, /You get on well with Ada \(good friends\)/);
  assert.match(line, /There is friction with Cy \((some friction|don't get along)\)/);

  // in its standing context, every turn
  home.inbox.send("bo", "chat:bo", "hello");
  await home.inbox.idle();
  const system = String((model.agent.at(-1)![0] as { content?: unknown }).content);
  assert.match(system, /How you get on with the office/);
  assert.match(system, /You get on well with Ada/);

  // who fits: Di (made last, friends with Ada) against Cy (who rubs everyone), on Ada's team, for a row that
  // names no one's kind of work and with no XP between them: without friendships Cy comes first (made
  // earlier); with them, Di does
  home.inbox.addOrb("di", "Di", "frontend");
  home.social.setTraits("di", T({ Humour: 15, Pace: 13, Care: 15 }));
  for (let i = 0; i < 800 && (home.social.score("ada", "di") < 20 || home.social.score("di", "cy") > -20); i++) home.social.meet();
  assert.ok(home.social.score("ada", "di") >= 20 && home.social.score("di", "cy") <= -20, "Ada and Di friendly, Cy rubbing Di");
  const members = home.inbox.orbs().map((o) => ({ id: o.id, name: o.name, specialty: o.specialty, level: "Senior" as const, createdAt: o.createdAt }));
  const team = ["ada", "cy", "di"].map((id) => members.find((m) => m.id === id)!);
  const at = (rows: { name: string }[], name: string): number => rows.findIndex((r) => r.name === name);
  const plain = whoFits(home.events, "tidy up the shared folder", team);
  assert.ok(at(plain, "Cy") < at(plain, "Di"), "without friendships: Cy, made first, before Di");
  const ranked = whoFits(home.events, "tidy up the shared folder", team, () => [], (orb, others) => home.social.affinity(orb, others));
  assert.ok(at(ranked, "Di") < at(ranked, "Cy"), `with them: Di, who works well with Ada, before Cy (${ranked.map((r) => r.name).join(", ")})`);
  assert.match(ranked.find((r) => r.name === "Di")!.why, /works well with Ada/);
  assert.match(ranked.find((r) => r.name === "Cy")!.why, /some friction with/);
  const work = whoFits(home.events, "write the release notes", team, () => [], (orb, others) => home.social.affinity(orb, others));
  assert.equal(work[0]!.name, "Cy", "writing is Cy's kind of work: friendship never outranks the work");

  // the door
  const d = await serve(home, { port: 0 });
  t.after(() => d.close());
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${d.port}${path}`, { method, headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  const social = (await call("GET", "/social")).json as { friendships: { a: string; b: string; word: string }[]; meetings: unknown[] };
  assert.ok(social.friendships.some((f) => f.a === "ada" && f.b === "bo" && f.word === "good friends"));
  assert.ok(social.meetings.length > 0);
  const friends = (await call("GET", "/orbs/bo/friends")).json.friends as { name: string }[];
  assert.equal(friends[0]!.name, "Ada", "best friend first");
  assert.equal((await call("PUT", "/orbs/ada/traits", { traits: { ...NEUTRAL, Humour: 16 } })).status, 200);
  assert.equal(home.social.traitsOf("ada").Humour, 16);
  assert.equal((await call("PUT", "/orbs/ada/traits", { traits: { Pace: 10 } })).status, 400);
  assert.equal((await call("PUT", "/orbs/nobody/traits", { traits: NEUTRAL })).status, 404);
});

// PLAN 5.9 and 5.6 (owner, 10-07: "beatrix exchanged ideas with another orb, what are those ideas? put it in the
// career section too, its where we see the orbs growth")
test("an exchange of ideas is each orb's own latest work, by code; the career page has its work, meetings, friends and lessons", async (t) => {
  const { plain, recentWork } = await import("../src/worklog.ts");
  assert.equal(plain("**Kits sell for $39 to $60**, and six to eight players is the norm. Two sources agree."), "Kits sell for $39 to $60, and six to eight players is the norm.");
  assert.equal(plain("x".repeat(300)).length, 160, "cut to a line");
  const { home } = await agentHome(t, [], { heartbeatMs: 86_400_000, social: { dice: dice(5) } });
  home.inbox.addOrb("beatrix", "Beatrix", "research");
  home.inbox.addOrb("darius", "Darius", "backend");
  home.inbox.letGo("juniper"); // the test home's own: two in the office, so they meet each other
  home.events.append("run.finished", { run: 1, outcome: "ok", summary: "**Mystery kits sell for $39 to $60.** Two sources agree." }, { orb: "beatrix", conversation: "team:1:brainstorm" });
  home.events.append("run.finished", { run: 2, outcome: "ok", summary: "no brain answered" }, { orb: "darius", conversation: "chat:darius" });
  home.events.append("run.finished", { run: 3, outcome: "ok", summary: "Set up the kit's folders and a check that every file is there." }, { orb: "darius", conversation: "team:1:floor" });
  home.events.append("run.finished", { run: 4, outcome: "ok", summary: "passed" }, { orb: "darius", conversation: "team:1:brainstorm" });
  assert.deepEqual(recentWork(home.events, "darius").map((w) => w.summary), ["Set up the kit's folders and a check that every file is there."], "a pass or a run with no brain is not work");
  let ideas: { orb: string; text: string }[] | null = null;
  for (let i = 0; i < 40 && !ideas; i++) {
    const m = home.social.meet();
    if (m?.kind === "ideas") ideas = home.events.ofType("social.met").at(-1)!.data.ideas as { orb: string; text: string }[];
  }
  assert.ok(ideas, "an exchange of ideas came round");
  assert.deepEqual(Object.fromEntries(ideas!.map((i) => [i.orb, i.text])), {
    beatrix: "Mystery kits sell for $39 to $60.",
    darius: "Set up the kit's folders and a check that every file is there.",
  }, "each brought its own latest work");
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const c = (await (await fetch(`http://127.0.0.1:${door.port}/orbs/beatrix/career`, { headers: { authorization: `Bearer ${door.token}` } })).json()) as {
    work: { summary: string }[]; meetings: { kind: string; with: string; brought: string | null; heard: string | null }[]; friends: { name: string }[]; lessons: unknown[];
  };
  assert.deepEqual(c.work.map((w) => w.summary), ["Mystery kits sell for $39 to $60."]);
  const traded = c.meetings.find((m) => m.kind === "ideas")!;
  assert.deepEqual([traded.with, traded.brought, traded.heard], ["Darius", "Mystery kits sell for $39 to $60.", "Set up the kit's folders and a check that every file is there."]);
  assert.deepEqual(c.friends.map((f) => f.name), ["Darius"]);
  assert.deepEqual(c.lessons, []);
});
