// PLAN 2.3_t (the living orb's moods), on a fake event stream: every mood, and every moment, from
// the events that cause them; another orb's events move nothing in his.
//   - A run: thinking, then working while a tool runs, then thinking again; a card waits for you
//     (it outranks the run); your yes is a hop, your no a pout; finished well, a sparkle; failed, a pout.
//   - The night's gym is his gym look; quiet for ten minutes he dozes; late at night, asleep; anything
//     of his wakes him.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DOZE_AFTER_MS, MoodOf, SLEEP_AFTER_MS } from "../src/orb/mood.ts";

const noon = new Date(2026, 9, 2, 12, 0).getTime();

test("a run: thinking, working while a tool runs, waiting on a card; yes a hop, no a pout; done a sparkle, failed a pout", () => {
  const m = new MoodOf("ada", noon);
  const moments: (string | null)[] = [];
  const hear = (type: string, data: Record<string, unknown>, orb = "ada") => moments.push(m.hear({ type, orb, at: noon, data }));
  assert.equal(m.at(noon), "idle");
  hear("run.started", { run: 1 });
  assert.equal(m.at(noon), "thinking");
  hear("trace.step", { run: 1, kind: "model", tool_calls: [{ name: "shell" }] });
  assert.equal(m.at(noon), "working", "a call made: its tool is running");
  hear("trace.step", { run: 1, kind: "tool" });
  assert.equal(m.at(noon), "thinking");
  hear("trace.step", { run: 1, kind: "model", tool_calls: [{ name: "shell" }] });
  hear("card.opened", { card: 7 });
  hear("run.finished", { run: 1, outcome: "waiting" });
  assert.equal(m.at(noon), "waiting", "a card of his waits for you");
  hear("run.started", { run: 2 });
  assert.equal(m.at(noon), "waiting", "waiting outranks a run");
  hear("card.resolved", { card: 7, status: "approved" });
  assert.equal(m.at(noon), "thinking");
  hear("run.finished", { run: 2, outcome: "ok" });
  hear("card.opened", { card: 8 });
  hear("card.resolved", { card: 8, status: "denied" });
  hear("run.started", { run: 3 });
  hear("run.finished", { run: 3, outcome: "failed" });
  hear("card.opened", { card: 9 }, "milo");
  assert.equal(m.at(noon), "idle", "another orb's card is not his");
  assert.deepEqual(moments.filter(Boolean), ["hop", "sparkle", "pout", "pout"]);
});

test("the night's gym, a doze, sleep late at night; anything of his wakes him", () => {
  const m = new MoodOf("ada", noon);
  m.hear({ type: "gym.night", orb: null, at: noon });
  assert.equal(m.at(noon), "gym");
  m.hear({ type: "gym.night_done", orb: null, at: noon });
  assert.equal(m.at(noon + DOZE_AFTER_MS - 1), "idle");
  assert.equal(m.at(noon + DOZE_AFTER_MS), "dozing");
  assert.equal(m.at(noon + SLEEP_AFTER_MS), "dozing", "half past twelve is not late at night");
  const night = new Date(2026, 9, 2, 23, 40).getTime();
  const n = new MoodOf("ada", night - SLEEP_AFTER_MS);
  assert.equal(n.at(night), "asleep");
  n.hear({ type: "notice.added", orb: "ada", at: night, data: {} });
  assert.equal(n.at(night), "idle", "anything of his wakes him");
  n.hear({ type: "notice.added", orb: "milo", at: night + SLEEP_AFTER_MS, data: {} });
  assert.equal(n.at(night + SLEEP_AFTER_MS), "asleep", "another orb's news does not");
});
