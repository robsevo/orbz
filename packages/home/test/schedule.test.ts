import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock, settle } from "../src/clock.ts";
import { scheduleConversation } from "../src/schedule.ts";
import { openHome } from "./helpers.ts";

const TZ = "America/Toronto"; // EDT in October: UTC-4
const MIN = 60_000;
const HOUR = 60 * MIN;

test("a schedule runs at its time, in its own conversation, from a fresh context", async (t) => {
  const clock = new FakeClock("2026-10-01T05:30:00Z"); // 01:30 in Toronto
  const { home, runner } = openHome(t, { clock });
  home.inbox.addOrb("juniper", "Juniper");
  const s = home.schedules.add({ orb: "juniper", name: "Hourly sweep", cron: "0 * * * *", instruction: "Sweep the inbox.", timezone: TZ });
  home.start();

  await clock.advance(30 * MIN - 1);
  assert.equal(runner.runs.length, 0, "nothing before 02:00");
  await clock.advance(1);
  await home.inbox.idle();
  assert.equal(runner.runs.length, 1);
  const run = runner.runs[0]!;
  assert.equal(run.conversation, scheduleConversation(s.id));
  assert.equal(run.fresh, true);
  assert.equal(run.items[0]?.text, "[Schedule: Hourly sweep] Sweep the inbox.");
  assert.equal(run.items[0]?.data.missed, 0);
});

test("a new schedule never runs for times before it existed", async (t) => {
  const clock = new FakeClock("2026-10-01T10:00:30Z");
  const { home, runner } = openHome(t, { clock });
  home.inbox.addOrb("juniper", "Juniper");
  home.schedules.add({ orb: "juniper", name: "Six", cron: "0 6 * * *", instruction: "Brief.", timezone: TZ });
  home.start();
  await clock.advance(MIN);
  await home.inbox.idle();
  assert.equal(runner.runs.length, 0, "06:00 Toronto passed 30 s before the schedule was made");
});

test("a schedule never overlaps itself: due times during its run fold into it", async (t) => {
  const clock = new FakeClock("2026-10-01T05:59:00Z");
  const { home, runner } = openHome(t, { clock });
  home.inbox.addOrb("juniper", "Juniper");
  home.schedules.add({ orb: "juniper", name: "Hourly", cron: "0 * * * *", instruction: "Go.", timezone: TZ });
  runner.hold = true;
  home.start();
  await clock.advance(MIN); // 02:00 fires and holds
  await clock.advance(2 * HOUR); // 03:00 and 04:00 come due while it is still running
  assert.equal(runner.runs.length, 1);
  assert.equal(home.events.ofType("schedule.folded").length, 2);
  runner.hold = false;
  runner.release();
  await home.inbox.idle();
  assert.equal(runner.runs.length, 1, "the folded due times did not queue more runs");
  await clock.advance(HOUR); // control: 05:00 runs normally once the schedule is free
  await home.inbox.idle();
  assert.equal(runner.runs.length, 2);
});

test("an unreadable cron pattern is refused when the schedule is made", (t) => {
  const { home } = openHome(t);
  home.inbox.addOrb("juniper", "Juniper");
  assert.throws(() => home.schedules.add({ orb: "juniper", name: "Bad", cron: "every morning", instruction: "x" }));
  assert.throws(
    () => home.schedules.add({ orb: "nobody", name: "Orphan", cron: "0 * * * *", instruction: "x" }),
    /no orb called "nobody"/,
  );
  assert.equal(home.schedules.list().length, 0);
});

test("a switched-off schedule stays quiet, and switching it on does not replay the time it was off", async (t) => {
  const clock = new FakeClock("2026-10-01T05:30:00Z");
  const { home, runner } = openHome(t, { clock });
  home.inbox.addOrb("juniper", "Juniper");
  const s = home.schedules.add({ orb: "juniper", name: "Hourly", cron: "0 * * * *", instruction: "Go.", timezone: TZ });
  home.schedules.setEnabled(s.id, false);
  home.start();
  await clock.advance(3 * HOUR);
  assert.equal(runner.runs.length, 0);
  home.schedules.setEnabled(s.id, true);
  await home.tick();
  await home.inbox.idle();
  assert.equal(runner.runs.length, 0, "the three hours it was off are not owed");
  await clock.advance(HOUR);
  await home.inbox.idle();
  assert.equal(runner.runs.length, 1);
});

test("schedules keep the orb's time zone", async (t) => {
  const clock = new FakeClock("2026-10-01T09:59:00Z"); // 05:59 Toronto
  const { home, runner } = openHome(t, { clock });
  home.inbox.addOrb("juniper", "Juniper");
  home.schedules.add({ orb: "juniper", name: "Brief", cron: "0 6 * * *", instruction: "Morning brief.", timezone: TZ });
  home.start();
  await clock.advance(MIN);
  await settle();
  await home.inbox.idle();
  assert.equal(runner.runs.length, 1);
  assert.equal(new Date(clock.now()).toISOString(), "2026-10-01T10:00:00.000Z");
});
