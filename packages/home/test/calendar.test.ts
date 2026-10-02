// PLAN 2.12_t, the calendar on the home, on a fake clock (local time):
//   - A fixture month: the bills and reminders on their days (one at its time), and every
//     schedule's runs as the home will run them (a daily one 31 times, a weekly one on its 4 Mondays).
//   - A schedule given a new time in the calendar is the schedule the home runs, at that time.
//   - An orb's move is a card, and nothing moves until it is approved (the floor: never silent,
//     whatever the rules say); a denied one moves nothing.
//   - Through the door: the days, the person's own move, done, a schedule's time and pause.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { serve } from "../src/api.ts";
import { calendarOf } from "../src/calendar.ts";
import { agentHome } from "./helpers.ts";

const local = (s: string): number => new Date(s).getTime();

async function month(t: Parameters<typeof agentHome>[0], script: Parameters<typeof agentHome>[1] = [], more: Parameters<typeof agentHome>[2] = {}) {
  const clock = new FakeClock(local("2026-10-01T08:00"));
  const h = await agentHome(t, script, { clock, ...more });
  h.home.inbox.addOrb("ada", "Ada", "accountant");
  h.home.inbox.addOrb("gus", "Gus", "devops");
  h.home.notices.remind({ orb: "ada", kind: "bill", title: "Rent", due: "2026-10-06", amount: "$1,200" });
  h.home.notices.remind({ orb: "ada", kind: "reminder", title: "Dentist", due: "2026-10-14T15:00" });
  h.home.notices.remind({ orb: "ada", kind: "bill", title: "Phone", due: "2026-11-02" });
  const digest = h.home.schedules.add({ orb: "gus", name: "Morning digest", cron: "30 7 * * *", instruction: "Summarise the night" });
  const books = h.home.schedules.add({ orb: "ada", name: "Weekly books", cron: "0 9 * * 1", instruction: "Do the books" });
  return { ...h, clock, digest, books };
}

test("a fixture month: bills and reminders on their days, every schedule's runs as the home will run them", async (t) => {
  const h = await month(t);
  const oct = calendarOf(h.home, "2026-10-01", "2026-10-31");
  const of = (title: string) => oct.filter((e) => e.title === title);
  assert.deepEqual(of("Rent").map((e) => [e.kind, e.day, e.time, e.kind !== "schedule" && e.amount]), [["bill", "2026-10-06", null, "$1,200"]]);
  assert.deepEqual(of("Dentist").map((e) => [e.kind, e.day, e.time]), [["reminder", "2026-10-14", "15:00"]]);
  assert.equal(of("Phone").length, 0, "November's bill is not in October");
  assert.equal(of("Morning digest").length, 31, "every day of October, at 07:30");
  assert.ok(of("Morning digest").every((e) => e.time === "07:30"));
  assert.deepEqual(of("Weekly books").map((e) => e.day), ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"], "its four Mondays");
  assert.deepEqual(oct.filter((e) => e.day === "2026-10-05").map((e) => `${e.time} ${e.title}`), ["07:30 Morning digest", "09:00 Weekly books"], "in the order of the day");
  assert.throws(() => calendarOf(h.home, "2026-10-31", "2026-10-01"), /runs forward/);
  assert.throws(() => calendarOf(h.home, "2026-02-30", "2026-03-01"), /no 2026-02-30/);
  assert.throws(() => calendarOf(h.home, "2026-01-01", "2026-06-01"), /at most 62 days/);
});

test("a schedule given a new time in the calendar is the one the home runs, at that time", async (t) => {
  const h = await month(t);
  h.home.schedules.setTime(h.digest.id, 6, 15);
  assert.equal(h.home.schedules.get(h.digest.id)!.cron, "15 6 * * *");
  assert.ok(calendarOf(h.home, "2026-10-02", "2026-10-02").some((e) => e.title === "Morning digest" && e.time === "06:15"));
  assert.equal(h.home.schedules.nextDueAt(), local("2026-10-02T06:15"), "the home wakes for it at the new time");
  const before = h.home.events.head();
  h.clock.suspend(local("2026-10-02T06:16") - h.clock.now());
  await h.home.tick();
  assert.ok(h.home.events.since(before).some((e) => e.type.startsWith("schedule.") && e.orb === "gus"), "and runs it then");
  const tick = h.home.schedules.add({ orb: "gus", name: "Ping", cron: "*/5 * * * *", instruction: "ping" });
  assert.throws(() => h.home.schedules.setTime(tick.id, 7, 0), /does not run at one time of day/);
  assert.throws(() => h.home.schedules.setTime(h.digest.id, 24, 0), /00:00 to 23:59/);
});

test("an orb's move is a card: nothing moves until you approve it, whatever your rules say", async (t) => {
  const h = await month(t, [
    { calls: [{ name: "list_reminders", args: {} }] },
    { calls: [{ name: "move_reminder", args: { id: 1, title: "Rent", due: "2026-10-08", why: "payday is the 8th" } }] },
    { chunks: ["Moved the rent to payday."] },
    { calls: [{ name: "move_reminder", args: { id: 2, title: "Dentist", due: "2026-10-20T09:00" } }] },
    { chunks: ["All right, it stays."] },
  ], { agent: { decide: () => "allow" } }); // even with every rule allowing
  h.home.inbox.send("ada", "chat:ada", "move the rent to payday");
  await h.home.inbox.idle();
  const card = h.home.conversations.openCard("chat:ada")!;
  assert.ok(card, "a card");
  assert.match(card.title, /move Rent to 2026-10-08 \(payday is the 8th\)/);
  assert.equal(card.meta.mayAlways, false, "never 'always allow': the floor");
  assert.equal(h.home.notices.reminder(1)!.due, "2026-10-06", "nothing moved yet");
  h.home.answerCard(card.id, "approve");
  for (let i = 0; i < 20 && h.home.notices.reminder(1)!.due !== "2026-10-08"; i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.equal(h.home.notices.reminder(1)!.due, "2026-10-08", "approved: moved");
  h.home.inbox.send("ada", "chat:ada", "and the dentist");
  for (let i = 0; i < 20 && !h.home.conversations.openCard("chat:ada"); i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 30));
  }
  h.home.answerCard(h.home.conversations.openCard("chat:ada")!.id, "deny");
  for (let i = 0; i < 20 && h.model.agent.length < 5; i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.equal(h.home.notices.reminder(2)!.due, "2026-10-14T15:00", "denied: it stays");
});

test("through the door: the days, your own move, done, a schedule's time and pause", async (t) => {
  const h = await month(t);
  const door = await serve(h.home, { port: 0 });
  t.after(() => door.close());
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${path}`, { method, headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  const days = async () => (await call("GET", "/calendar?from=2026-10-01&to=2026-10-31")).json.entries as { kind: string; title: string; day: string; time: string | null; enabled?: boolean }[];
  assert.equal((await days()).length, 31 + 4 + 2);
  assert.equal((await call("GET", "/calendar?from=2026-10-31&to=2026-10-01")).status, 400);
  // your own move is yours: no card
  assert.equal((await call("POST", "/reminders/1", { due: "2026-10-07" })).status, 200);
  assert.equal((await days()).find((e) => e.title === "Rent")!.day, "2026-10-07");
  assert.equal((await call("POST", "/reminders/1", { due: "soon" })).status, 400);
  assert.equal((await call("POST", "/reminders/2/done")).status, 200);
  assert.ok(!(await days()).some((e) => e.title === "Dentist"), "done: off the calendar");
  assert.equal((await call("POST", "/reminders/99/done")).status, 404);
  assert.equal((await call("POST", `/schedules/${h.digest.id}`, { time: "07:00" })).status, 200);
  assert.ok((await days()).filter((e) => e.title === "Morning digest").every((e) => e.time === "07:00"));
  assert.equal((await call("POST", `/schedules/${h.books.id}`, { enabled: false })).status, 200);
  const paused = (await days()).filter((e) => e.title === "Weekly books");
  assert.deepEqual(paused.map((e) => e.enabled), [false, false, false, false], "paused, still shown (its four Mondays), so it can be resumed");
  assert.equal((await call("POST", `/schedules/${h.digest.id}`, { time: "7am" })).status, 400);
  assert.equal((await call("POST", "/schedules/nope", { time: "07:00" })).status, 404);
});
