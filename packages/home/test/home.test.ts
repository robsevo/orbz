// PLAN 1.2_t: the machine "asleep" 6 h on a fake clock — what came due and what happened while it
// slept runs on waking, once each; a home that was shut down for 6 h catches up the same way.
import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock } from "../src/clock.ts";
import { Home } from "../src/home.ts";
import { FakeMailbox, openHome, Recorder, tempDir } from "./helpers.ts";

const TZ = "America/Toronto"; // EDT in October: UTC-4
const MIN = 60_000;
const HOUR = 60 * MIN;

function setUp(home: Home, box: FakeMailbox) {
  home.triggers.register("mail", box);
  home.inbox.addOrb("juniper", "Juniper");
  const sweep = home.schedules.add({ orb: "juniper", name: "Hourly sweep", cron: "0 * * * *", instruction: "Sweep.", timezone: TZ });
  const brief = home.schedules.add({ orb: "juniper", name: "Morning brief", cron: "0 6 * * *", instruction: "Brief me.", timezone: TZ });
  const mail = home.triggers.add({ orb: "juniper", name: "New mail", kind: "mail", instruction: "Sort it." });
  return { sweep, brief, mail };
}

const at = (iso: string): number => Date.parse(iso);

test("asleep 6 h: on waking, every missed schedule runs once and every missed email runs, in order", async (t) => {
  const clock = new FakeClock("2026-10-01T05:30:00Z"); // 01:30 Toronto
  const box = new FakeMailbox();
  const { home, runner } = openHome(t, { clock, heartbeatMs: 30_000 });
  const { sweep, brief, mail } = setUp(home, box);
  home.start();

  await clock.advance(31 * MIN); // 02:01: the 02:00 sweep has run
  await home.inbox.idle();
  assert.deepEqual(runner.runs.map((r) => r.conversation), [`schedule:${sweep.id}`]);

  // The lid closes at 02:01 and opens at 08:01. Mail keeps arriving at the server meanwhile.
  clock.suspend(6 * HOUR);
  box.arrive("m1", at("2026-10-01T07:10:00Z"), "Dana"); // 03:10
  box.arrive("m2", at("2026-10-01T08:20:00Z"), "Eli"); // 04:20
  box.arrive("m3", at("2026-10-01T11:45:00Z"), "Fay"); // 07:45
  assert.equal(runner.runs.length, 1, "nothing ran while the machine slept");

  await clock.advance(30_000); // the first heartbeat after waking
  await home.inbox.idle();

  const woke = home.events.ofType("home.woke");
  assert.equal(woke.length, 1);
  assert.ok(Math.abs(Number(woke[0]!.data.slept_ms) - 6 * HOUR) < 1000, `slept ${woke[0]!.data.slept_ms} ms`);

  const byConv = (c: string) => runner.runs.filter((r) => r.conversation === c).flatMap((r) => r.items);
  const sweeps = byConv(`schedule:${sweep.id}`);
  assert.equal(sweeps.length, 2, "the sweep ran once more, not six more times");
  assert.equal(sweeps[1]!.data.missed, 5, "03:00-08:00 is six due times: one run, five folded in");
  assert.match(sweeps[1]!.text, /5 earlier runs were missed and folded into this one/);

  const briefs = byConv(`schedule:${brief.id}`);
  assert.equal(briefs.length, 1, "the 06:00 brief ran, late, on waking");
  assert.equal(briefs[0]!.data.due, at("2026-10-01T10:00:00Z"));

  const mails = byConv(`trigger:${mail.id}`);
  assert.deepEqual(mails.map((i) => i.data.event), ["m1", "m2", "m3"], "every email, in the order it arrived");

  const before = runner.runs.length;
  await clock.advance(10 * MIN); // more heartbeats and mail polls
  await home.inbox.idle();
  assert.equal(runner.runs.length, before, "nothing runs twice");
  assert.equal(home.events.ofType("home.woke").length, 1);
});

test("control: awake the whole 6 h, nothing is 'missed' and no wake is reported", async (t) => {
  const clock = new FakeClock("2026-10-01T05:30:00Z");
  const box = new FakeMailbox();
  const { home, runner } = openHome(t, { clock, heartbeatMs: 30_000 });
  const { sweep } = setUp(home, box);
  home.start();
  await clock.advance(6 * HOUR + 31 * MIN);
  await home.inbox.idle();
  const sweeps = runner.runs.filter((r) => r.conversation === `schedule:${sweep.id}`).flatMap((r) => r.items);
  assert.equal(sweeps.length, 7, "02:00 to 08:00, each on time");
  assert.ok(sweeps.every((i) => i.data.missed === 0));
  assert.equal(home.events.ofType("home.woke").length, 0);
});

test("shut down for 6 h: the next start catches up the same way", async (t) => {
  const dataDir = tempDir(t);
  const box = new FakeMailbox();
  const clock1 = new FakeClock("2026-10-01T05:30:00Z");
  const first = Home.open({ dataDir, clock: clock1, runner: new Recorder(), protect: [] });
  const { sweep, mail } = setUp(first, box);
  first.start();
  await clock1.advance(31 * MIN);
  await first.inbox.idle();
  await first.close();

  box.arrive("m1", at("2026-10-01T08:00:00Z"), "Dana");
  const clock2 = new FakeClock(clock1.now() + 6 * HOUR);
  const runner = new Recorder();
  const second = Home.open({ dataDir, clock: clock2, runner, protect: [] });
  t.after(() => second.close());
  second.triggers.register("mail", box); // sources are code, registered at every start
  second.start();
  await clock2.advance(1000);
  await second.inbox.idle();

  const conv = (c: string) => runner.runs.filter((r) => r.conversation === c).flatMap((r) => r.items);
  assert.deepEqual(conv(`schedule:${sweep.id}`).map((i) => i.data.missed), [5]);
  assert.deepEqual(conv(`trigger:${mail.id}`).map((i) => i.data.event), ["m1"]);
});
