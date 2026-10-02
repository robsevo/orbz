// PLAN 2.4_t (the schedule editor's rules): a schedule is daily at a time (on chosen days), or
// every N with a 15-minute minimum, evenly spaced; the words are read back off the pattern the home
// will run, with the next runs; through the door a rule is previewed, kept, listed and removed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { cronFor, preview, wordsOf } from "../src/schedule-rules.ts";
import { agentHome } from "./helpers.ts";

test("a rule is a pattern; the words are read back off it, as the home will run it", () => {
  const cases: [Parameters<typeof cronFor>[0], string, string][] = [
    [{ kind: "daily", time: "09:00" }, "0 9 * * *", "Every day at 09:00"],
    [{ kind: "daily", time: "8:30", days: [1, 2, 3, 4, 5] }, "30 8 * * 1,2,3,4,5", "Weekdays at 08:30"],
    [{ kind: "daily", time: "10:05", days: [7, 6] }, "5 10 * * 0,6", "Weekends at 10:05"],
    [{ kind: "daily", time: "18:00", days: [4, 1] }, "0 18 * * 1,4", "Mondays and Thursdays at 18:00"],
    [{ kind: "daily", time: "07:15", days: [1, 2, 3, 4, 5, 6, 7] }, "15 7 * * *", "Every day at 07:15"],
    [{ kind: "every", n: 15, unit: "minutes" }, "*/15 * * * *", "Every 15 minutes"],
    [{ kind: "every", n: 1, unit: "hours" }, "0 * * * *", "Every hour"],
    [{ kind: "every", n: 6, unit: "hours" }, "0 */6 * * *", "Every 6 hours"],
  ];
  for (const [rule, cron, words] of cases) {
    assert.equal(cronFor(rule), cron, JSON.stringify(rule));
    assert.equal(wordsOf(cron), words);
  }
  assert.equal(wordsOf("5 4 1 * *"), "On its own pattern (5 4 1 * *)", "a pattern made some other way is said as it is");
});

test("never under 15 minutes, always evenly spaced, and a time or a day that is not one is refused", () => {
  for (const [rule, why] of [
    [{ kind: "every", n: 5, unit: "minutes" }, /never under 15/],
    [{ kind: "every", n: 45, unit: "minutes" }, /evenly through the hour/],
    [{ kind: "every", n: 5, unit: "hours" }, /evenly through the day/],
    [{ kind: "daily", time: "25:00" }, /not a time of day/],
    [{ kind: "daily", time: "09:00", days: [8] }, /1 \(Monday\) to 7 \(Sunday\)/],
  ] as const) assert.throws(() => cronFor(rule as Parameters<typeof cronFor>[0]), why);
});

test("the preview says when it runs next", () => {
  const from = new Date("2026-10-02T08:07:00Z");
  assert.deepEqual(preview({ kind: "every", n: 15, unit: "minutes" }, "UTC", from).next.map((t) => new Date(t).toISOString().slice(11, 16)), ["08:15", "08:30", "08:45"]);
  const daily = preview({ kind: "daily", time: "09:00", days: [6, 7] }, "UTC", from);
  assert.deepEqual([daily.words, daily.next.map((t) => new Date(t).toISOString().slice(0, 16))], ["Weekends at 09:00", ["2026-10-03T09:00", "2026-10-04T09:00", "2026-10-10T09:00"]]);
});

test("through the door: previewed, kept, listed in words, removed; a bad rule or an unknown orb refused", async (t) => {
  const { home } = await agentHome(t, []);
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${path}`, { method, headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  const rule = { kind: "daily", time: "08:30", days: [1, 2, 3, 4, 5] };
  const seen = await call("POST", "/schedules/preview", { rule });
  assert.deepEqual([seen.json.cron, seen.json.words, (seen.json.next as number[]).length], ["30 8 * * 1,2,3,4,5", "Weekdays at 08:30", 3]);
  const made = await call("POST", "/schedules", { orb: "juniper", name: "Inbox sweep", instruction: "Sort the morning's mail.", rule });
  assert.equal(made.status, 200, JSON.stringify(made.json));
  const id = (made.json.schedule as { id: string }).id;
  assert.equal(home.schedules.get(id)?.cron, "30 8 * * 1,2,3,4,5", "the home runs the pattern it previewed");
  const listed = (await call("GET", "/schedules?orb=juniper")).json.schedules as { id: string; words: string; next: number }[];
  assert.deepEqual(listed.map((s) => [s.id, s.words, typeof s.next]), [[id, "Weekdays at 08:30", "number"]]);
  assert.equal((await call("POST", "/schedules", { orb: "juniper", name: "x", instruction: "x", rule: { kind: "every", n: 5, unit: "minutes" } })).status, 400);
  assert.equal((await call("POST", "/schedules", { orb: "nobody", name: "x", instruction: "x", rule })).status, 404);
  assert.equal((await call("POST", `/schedules/${id}/remove`)).json.removed, true);
  assert.equal(home.schedules.list().length, 0);
});

test("an orb sets itself a schedule only on your yes, the card saying when in plain words; a rule that cannot be one never reaches you", async (t) => {
  const job = (args: Record<string, unknown>) => ({ calls: [{ name: "schedule_job", args: { name: "Inbox sweep", instruction: "Sort the morning's mail.", ...args } }] });
  const { home, model } = await agentHome(t, [job({ kind: "daily", time: "08:30", days: [1, 2, 3, 4, 5] }), { chunks: ["Set for weekdays."] }, job({ kind: "every", every: 5, unit: "minutes" }), { chunks: ["Every 15 minutes, then?"] }]);
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "sweep my inbox every weekday morning");
  await home.inbox.idle();
  const card = home.conversations.openCard("chat:juniper")!;
  assert.match(card.title, /Juniper wants to set a schedule: "Inbox sweep", weekdays at 08:30/);
  assert.equal(home.schedules.list().length, 0, "nothing until you say yes");
  home.answerCard(card.id, "approve");
  await home.inbox.idle();
  assert.deepEqual(home.schedules.list().map((s) => [s.orb, s.name, s.cron]), [["juniper", "Inbox sweep", "30 8 * * 1,2,3,4,5"]]);
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "actually every 5 minutes");
  await home.inbox.idle();
  assert.ok(!home.conversations.openCard("chat:juniper"), "no card for a rule that cannot be one");
  const told = model.agent.at(-1)!.filter((m) => m.role === "tool").at(-1);
  assert.match(String(told?.content), /^Refused: every 5 minutes: choose 15, 20 or 30/);
  assert.equal(home.schedules.list().length, 1);
});
