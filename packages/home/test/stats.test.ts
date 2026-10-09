// PLAN 2.19_t, the numbers behind the home page, as charts (owner, 10-08: "how about a chart with all the stats of
// tokens? lol"; "same for xp this week"): the home's sums over a seeded log, by day, model, kind of turn and orb, and
// the XP earned and taken back by day and orb; controls: a call and XP before the range, a call no orb made, a range
// the charts do not offer.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { statsOf } from "../src/stats.ts";
import { agentHome } from "./helpers.ts";

const DAY = 24 * 3_600_000;

test("the charts' sums, by code from the log: tokens by day, model, kind of turn and orb; XP earned and taken back by day and orb; only the range", async (t) => {
  const now = new Date(2026, 9, 7, 12, 0).getTime();
  const clock = new FakeClock(now - 10 * DAY); // the clock only moves on: it walks through the days to noon
  const { home } = await agentHome(t, [], { clock });
  for (const [id, name, sp] of [["ada", "Ada", "frontend"], ["bea", "Bea", "research"]] as const) home.inbox.addOrb(id, name, sp);
  const to = (at: number): void => clock.suspend(at - clock.now());
  const spend = (orb: string | null, conversation: string | null, data: Record<string, unknown>): void =>
    void home.events.append("brain.spend", { tier: "big", cost_usd: null, cost_source: "none", ...data }, { orb, conversation });
  const xp = (orb: string, amount: number): void => void home.events.append(amount >= 0 ? "xp.earned" : "xp.lost", { amount, reason: "work", source: 1, at: clock.now() }, { orb });

  // ten days ago: before a week's range (control)
  spend("ada", "chat:ada", { model: "gpt-5", turn: "work", prompt_tokens: 9_000, cached_tokens: 0, completion_tokens: 900 });
  xp("ada", 100);
  // two days ago: a session's lead, and a chat
  to(now - 2 * DAY);
  spend("ada", "team:1:brainstorm", { model: "gpt-5", turn: "lead", prompt_tokens: 1_000, cached_tokens: 200, completion_tokens: 100 });
  spend("bea", "chat:bea", { model: "mini", prompt_tokens: 400, completion_tokens: 50 });
  xp("ada", 15);
  // yesterday: a call no orb made (school's), XP earned and taken back
  to(now - DAY);
  spend(null, null, { model: "mini", prompt_tokens: 300, completion_tokens: 30 });
  xp("bea", 40);
  xp("bea", -5);
  // today
  to(now);
  spend("ada", "chat:ada", { model: "gpt-5", turn: "work", prompt_tokens: 2_000, cached_tokens: 1_500, completion_tokens: 200 });
  xp("ada", 10);

  const s = statsOf(home, 7);
  assert.deepEqual(s.days, ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"], "the last seven days, today the last");
  assert.deepEqual(s.brain.total, { calls: 4, input: 3_700, cached: 1_700, output: 380 }, "ten days ago is not in a week");
  assert.deepEqual(s.brain.byDay.slice(4), [{ calls: 2, input: 1_400, cached: 200, output: 150 }, { calls: 1, input: 300, cached: 0, output: 30 }, { calls: 1, input: 2_000, cached: 1_500, output: 200 }]);
  assert.deepEqual(s.brain.byDay.slice(0, 4).map((d) => d.calls), [0, 0, 0, 0], "a day with nothing is there, empty");
  assert.deepEqual(s.brain.byModel.map((m) => [m.model, m.calls, m.input, m.cached, m.output]), [["gpt-5", 2, 3_000, 1_700, 300], ["mini", 2, 700, 0, 80]], "by model, the most first");
  assert.deepEqual(s.brain.byKind.map((k) => [k.kind, k.input + k.output]), [["work", 2_200], ["lead", 1_100], ["chat", 450], ["other", 330]], "by kind of turn: a chat with no turn named is a chat, a call with no conversation is other");
  assert.deepEqual(s.brain.byOrb.map((o) => [o.orb, o.name, o.input + o.output]), [["ada", "Ada", 3_300], ["bea", "Bea", 450], [null, "No orb", 330]], "by orb, the call no orb made its own");
  assert.deepEqual(s.xp.total, { earned: 65, lost: 5 });
  assert.deepEqual(s.xp.byDay.slice(4), [{ earned: 15, lost: 0 }, { earned: 40, lost: 5 }, { earned: 10, lost: 0 }]);
  assert.deepEqual(s.xp.byOrb.map((o) => [o.name, o.earned, o.lost]), [["Bea", 40, 5], ["Ada", 25, 0]], "by orb, the most kept first");

  // thirty days hold ten days ago; a range the charts do not offer is a week
  const month = statsOf(home, 30);
  assert.equal(month.days.length, 30);
  assert.deepEqual([month.brain.total.calls, month.xp.total.earned], [5, 165]);
  assert.equal(statsOf(home, 9).days.length, 7);
});
