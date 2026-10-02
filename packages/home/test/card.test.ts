// PLAN 3.5_t (the morning card), on a fixture day:
//   - The card's split (habits / own brain / big brain), cost and tokens match the event log,
//     orb by orb, for yesterday only.
//   - What he learned is on it, with a one-tap undo that names the line to take back.
//   - A quiet night says nothing: no card.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { openDb } from "../src/db.ts";
import { EventLog } from "../src/events.ts";
import { morningCard, yesterday } from "../src/gym/card.ts";
import { tempDir } from "./helpers.ts";

function log(t: Parameters<typeof tempDir>[0]) {
  const clock = new FakeClock(new Date(2026, 9, 1, 9, 0).getTime()); // 1 Oct, 09:00 local: yesterday's work
  const db = openDb(tempDir(t));
  t.after(() => db.close());
  return { clock, events: new EventLog(db, clock) };
}

test("the card's split, cost and lessons match the event log, orb by orb, for yesterday only", (t) => {
  const { clock, events } = log(t);
  const answered = (orb: string, tier: string) => events.append("ladder.answered", { kind: "inbox", tier }, { orb });
  for (let i = 0; i < 3; i++) answered("ada", "habit");
  answered("ada", "own");
  answered("ada", "big");
  events.append("run.finished", { run: 1, outcome: "ok" }, { orb: "ada", conversation: "chat:ada" });
  events.append("run.finished", { run: 2, outcome: "failed" }, { orb: "ada", conversation: "chat:ada" }); // not an answer
  events.append("brain.spend", { tier: "big", cost_usd: 0.0123, prompt_tokens: 900, completion_tokens: 100 }, { orb: "ada" });
  events.append("brain.spend", { tier: "big", cost_usd: 0.004, prompt_tokens: 300, completion_tokens: 50 }, { orb: "ada" });
  events.append("orb.learned", { line: "Invoices go out on the 1st.", count: 1 }, { orb: "ada" });
  answered("milo", "big");
  clock.suspend(24 * 3_600_000); // the next morning
  answered("ada", "habit"); // today's: not on yesterday's card
  const card = morningCard(events, { now: clock.now(), learned: (orb) => (orb === "ada" ? ["Invoices go out on the 1st."] : []) })!;
  assert.equal(card.day, "2026-10-01");
  assert.deepEqual(card.orbs.map((n) => [n.orb, n.habits, n.own, n.big, n.costUsd, n.tokens, n.learned]), [
    ["ada", 3, 1, 2, 0.0163, 1350, ["Invoices go out on the 1st."]],
    ["milo", 0, 0, 1, 0, 0, []],
  ]);
  assert.deepEqual(card.orbs[0]!.undo, [{ kind: "lesson", orb: "ada", line: "Invoices go out on the 1st.", index: 0 }], "one tap takes the lesson back");
  assert.equal(yesterday(clock.now()).day, "2026-10-01");
});

test("the night after the day is on its card: what the gym promoted from 03:00, each with its undo until it is taken back", (t) => {
  const { clock, events } = log(t);
  events.append("habit.promoted", { kind: "old", version: 1 }, { orb: "ada" }); // 1 Oct 09:00: the card of 30 Sep's night
  clock.suspend(18 * 3_600_000 + 5 * 60_000); // 2 Oct, 03:05: tonight's
  events.append("habit.promoted", { kind: "bills", version: 2 }, { orb: "ada" });
  events.append("habit.promoted", { kind: "quotes", version: 1 }, { orb: "ada" });
  clock.suspend(6 * 3_600_000); // 09:05, the morning
  const card = morningCard(events, { now: clock.now(), learned: () => [] })!;
  assert.equal(card.day, "2026-10-01");
  assert.deepEqual(card.orbs.map((n) => [n.orb, n.promoted, n.undo.map((u) => u.kind === "habit" && `${u.habit} v${u.version}`)]), [["ada", ["bills", "quotes"], ["bills v2", "quotes v1"]]]);
  events.append("habit.undone", { kind: "bills", version: 2 }, { orb: "ada" });
  const after = morningCard(events, { now: clock.now(), learned: () => [] })!;
  assert.deepEqual(after.orbs[0]!.undo.map((u) => u.kind === "habit" && u.habit), ["quotes"], "taken back: not offered again");
});

test("a quiet night says nothing", (t) => {
  const { clock, events } = log(t);
  events.append("home.started", {});
  events.append("orb.added", { name: "Ada" }, { orb: "ada" });
  clock.suspend(24 * 3_600_000);
  assert.equal(morningCard(events, { now: clock.now(), learned: () => [] }), null);
});
