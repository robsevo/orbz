// PLAN 5.46_t, the CEO's brand watch (owner, 10-14: "we want our CEO to be absolutely obsessed with it please, thats how he
// chooses and lets you know who to promote. and skills too ... the ceo verifies and tracks each employees brand"):
//   - each orb's verdict by code: Promote (ready and a brand of 50 or more), Brand first (ready, under 50), Watch (under
//     40), Rising (up 5 this week), Steady; the CEO never on its own watch; the best merit first, skills counting
//     (control: the same brand, more skills, first);
//   - a Promote recommended to you once, with Promote and Not yet (only you promote), the evidence's own notice put away;
//     no CEO, no watch; the CEO's standing line, and no one else's; the door's /watch.
import assert from "node:assert/strict";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { FakeClock } from "../src/clock.ts";
import { BrandWatch, meritOf, verdictOf, watchOf, WATCH_CHECK_MS, type WatchRow } from "../src/social/watch.ts";
import { agentHome } from "./helpers.ts";

const NOW = new Date(2026, 9, 14, 12, 0).getTime();
const row = (orb: string, o: Partial<WatchRow> = {}): Omit<WatchRow, "verdict" | "merit"> => ({ orb, name: orb[0]!.toUpperCase() + orb.slice(1), brand: 55, word: "Steady", week: 0, skill: { area: "design", xp: 400 }, skills: 400, level: "Senior", next: "Staff", ready: false, ...o });
const CEO = { orb: "ada", name: "Ada" };

test("each orb's verdict by brand, readiness and its week; the CEO is never on its own watch; the best merit first", () => {
  assert.equal(verdictOf({ brand: 66, week: 0, ready: true }), "Promote");
  assert.equal(verdictOf({ brand: 50, week: 0, ready: true }), "Promote");
  assert.equal(verdictOf({ brand: 49, week: 9, ready: true }), "Brand first");
  assert.equal(verdictOf({ brand: 39, week: 9, ready: false }), "Watch");
  assert.equal(verdictOf({ brand: 55, week: 5, ready: false }), "Rising");
  assert.equal(verdictOf({ brand: 55, week: 4, ready: false }), "Steady");
  assert.equal(meritOf(60, 400), 68);
  assert.equal(meritOf(60, 9000), 90, "skills count up to 30");
  const w = watchOf(CEO, [row("ada", { brand: 90 }), row("nova", { brand: 66, week: 11, ready: true }), row("pip", { brand: 66, skills: 0, skill: null, ready: true }), row("remy", { brand: 38 })]);
  assert.deepEqual(w.rows.map((r) => r.orb), ["nova", "pip", "remy"], "the CEO left out; the same brand, more skills first");
  assert.deepEqual(w.rows.map((r) => r.verdict), ["Promote", "Promote", "Watch"]);
  assert.deepEqual(w.pick, { orb: "nova", name: "Nova", to: "Staff", why: "Brand 66, steady, up 11 this week; 400 XP in design." });
  assert.equal(watchOf(null, [row("nova", { brand: 66, ready: true })]).pick, null, "no CEO: no one recommends");
  assert.equal(watchOf(CEO, [row("nova", { brand: 45, ready: true })]).pick, null, "ready on paper, the brand not yet");
});

test("on a home: a Promote recommended to you once, Promote and Not yet; the CEO's line; the door's /watch", async (t) => {
  const clock = new FakeClock(NOW);
  const { home } = await agentHome(t, [], { clock, heartbeatMs: 86_400_000 });
  home.inbox.letGo("juniper");
  home.inbox.addOrb("ada", "Ada", "ceo");
  home.inbox.addOrb("nova", "Nova", "design");
  home.inbox.addOrb("remy", "Remy", "writing");
  // the evidence's own notice first, as the night's gym leaves it
  home.events.append("promotion.proposed", { from: "Senior", to: "Staff", evidence: { xp: { has: 2100, needs: 2000 }, tasks: { has: ["a", "b", "c", "d"], needs: 4 } } }, { orb: "nova" });
  const ready = new Set(["nova"]);
  const watch = new BrandWatch(home.events, clock, {
    ceo: () => ({ orb: "ada", name: "Ada" }),
    office: () => home.inbox.orbs().map((o) => ({ id: o.id, name: o.name })),
    brand: (orb, at) => ({ score: orb === "nova" ? (at && at < NOW ? 55 : 66) : 41, word: orb === "nova" ? "Well regarded" : "Steady" }),
    skills: (orb) => ({ areas: { design: orb === "nova" ? 760 : 0, writing: orb === "remy" ? 300 : 0 }, own: orb === "nova" ? ["design", "frontend"] : ["writing"] }),
    next: (orb) => ({ level: "Senior", to: "Staff", ready: ready.has(orb) }),
  });
  assert.equal(watch.due(), 1);
  assert.equal(watch.due(), 0, "not again within the check's minutes");
  await clock.advance(WATCH_CHECK_MS);
  assert.equal(watch.due(), 0, "nor for the same orb and level");
  const notes = home.notices.list().filter((n) => n.orb === "nova" && n.kind === "promotion");
  assert.deepEqual(notes.map((n) => n.title), ["Ada, your CEO, recommends promoting Nova to Staff"], "the CEO's in place of the evidence's own");
  assert.equal(notes[0]!.detail, "Brand 66, well regarded, up 11 this week; 760 XP in design. Only you promote.");
  // only you promote: the notice's yes is the one that promotes, as every promotion's is
  assert.equal(home.events.ofType("orb.promoted").length, 0);

  assert.match(watch.line("ada")!, /^You are the CEO, and you are obsessed with brand/);
  assert.match(watch.line("ada")!, /- Nova: well regarded, strongest in design; you recommend Staff\./);
  assert.match(watch.line("ada")!, /- Remy: steady, strongest in writing; steady\./);
  assert.doesNotMatch(watch.line("ada")!, /\d/, "words, never the numbers (the cached prefix)");
  assert.equal(watch.line("nova"), null, "only the CEO is obsessed");

  // the home's own: no CEO in this office's hands yet means none; with one, the door answers
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const got = (await (await fetch(`http://127.0.0.1:${door.port}/watch`, { headers: { authorization: `Bearer ${door.token}` } })).json()) as { watch: { ceo: { name: string } | null; rows: { orb: string }[] } };
  assert.equal(got.watch.ceo?.name, "Ada");
  assert.deepEqual(got.watch.rows.map((r) => r.orb).sort(), ["nova", "remy"]);
});
