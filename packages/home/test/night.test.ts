// PLAN 3.2_t and 3.3_t, the night: the gym writes habits for what schedules and triggers ask, on
// the teacher (a fake brain) and the real kit, and goes back only when there is something new.
//   - A trigger's task gets a habit; the same work in a chat does not. The teacher's cost is spent
//     on the orb. A second night with nothing new asks the teacher nothing.
//   - A case a habit handed on, once you approve the brain's run of it, is in the next night's
//     tests: the recompile must pass it too, and when it fails the version before still stands.
//   - From 03:00, once a night; nights slept through run once, on waking; no teacher, it says so
//     and tries again the next night. The home's tick runs it, and closing the home waits for it.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { FakeClock, realClock } from "../src/clock.ts";
import { openDb } from "../src/db.ts";
import { EventLog } from "../src/events.ts";
import { Kit } from "../src/kit.ts";
import { Spend } from "../src/brain/spend.ts";
import { Gym, NIGHT_HOUR } from "../src/gym/night.ts";
import { promotedFor } from "../src/gym/steps.ts";
import { approved, GOOD, reply } from "./fixtures/bills.ts";
import { deadUrl, fakeBrain } from "./fakes/openai.ts";
import { openHome, tempDir } from "./helpers.ts";

const LONG = { timeout: 120_000 };
const TASK = "ada|trigger:t1|{subject}";

async function gym(t: TestContext, teacherSays: string[]) {
  const dataDir = tempDir(t);
  const db = openDb(dataDir);
  const events = new EventLog(db, realClock);
  const kit = new Kit({ events, clock: realClock, dataDir });
  t.after(async () => {
    await kit.close();
    db.close();
  });
  await kit.start();
  const teacher = await fakeBrain(t, teacherSays.map((text) => ({ text, litellmCost: 0.002 })));
  const g = new Gym({
    events, clock: realClock, dataDir, kit: (tool, args) => kit.call(tool, args), spend: new Spend(events, realClock, null),
    teacher: () => ({ name: "teacher", baseUrl: teacher.baseUrl, model: "teacher-model", retries: 0 }),
  });
  return { events, g, teacher, dataDir };
}

/** The same bills, done in a chat: approved too, but a chat's words are not a habit's. */
function chats(events: EventLog) {
  [201, 202, 203].forEach((run) => {
    const where = { orb: "ada", conversation: "chat:ada" };
    events.append("trace.step", { run, step: 0, kind: "input", items: [{ id: run, source: "chat", text: "keep my rent bill", data: {} }] }, where);
    events.append("trace.step", { run, step: 1, kind: "model", text: "Kept it.", tool_calls: [] }, where);
    events.append("run.finished", { run, outcome: "ok" }, where);
    events.append("trace.feedback", { run, verdict: "approve" }, where);
  });
}

test("a trigger's task gets a habit and a chat's does not; a night with nothing new asks the teacher nothing", LONG, async (t) => {
  const { events, g, teacher, dataDir } = await gym(t, [reply(GOOD)]);
  approved(events, "ada");
  chats(events);
  const first = await g.night();
  if (/no habit sandbox/.test(first.compiled[0]?.why ?? "")) return t.diagnostic("no habit sandbox on this machine");
  assert.deepEqual(first.compiled.map((c) => [c.key, c.promoted, c.version]), [["ada|trigger:t1|read_file>remind {subject}", true, 1]]);
  assert.equal(teacher.requests.length, 1);
  assert.match(JSON.stringify(teacher.requests[0]!.body), /Water/, "the brief has the runs");
  assert.equal(promotedFor(events, dataDir, "ada", TASK)?.version, 1);
  const spent = events.ofType("brain.spend").map((e) => [e.orb, e.data.tier]);
  assert.deepEqual(spent, [["ada", "teacher"]], "the teacher's cost is on the orb it taught");
  const second = await g.night();
  assert.deepEqual([second.compiled.length, second.left, teacher.requests.length], [0, 1, 1], "nothing new: the teacher is not asked again");
  assert.deepEqual(events.ofType("gym.night_done").map((e) => (e.data.promoted as string[]).length), [1, 0]);
  const [byHabit] = approved(events, "ada", ["Phone"], 104);
  events.append("ladder.answered", { kind: first.compiled[0]!.key, tier: "habit", run: byHabit }, { orb: "ada" });
  await g.night();
  assert.equal(teacher.requests.length, 1, "a run its habit answered, approved, is no news: a habit that works is not written again");
});

test("a case a habit handed on is in the next night's tests; a recompile that fails it leaves the version before standing", LONG, async (t) => {
  const { events, g, teacher, dataDir } = await gym(t, [reply(GOOD), reply(GOOD)]);
  approved(events, "ada");
  const first = await g.night();
  if (!first.compiled[0]?.promoted) return t.diagnostic(`no habit to begin with: ${first.compiled[0]?.why}`);
  // the habit handed "URGENT rent" on; the brain flagged it, and you approved that
  const [urgent] = approved(events, "ada", ["URGENT rent"], 104, (s) => `Kept ${s} for you, and flagged it.`);
  const next = await g.night();
  assert.equal(teacher.requests.length, 2, "something new: the teacher writes it again");
  assert.match(JSON.stringify(teacher.requests[1]!.body), /URGENT rent/, "with the case it handed on");
  assert.deepEqual(next.compiled.map((c) => [c.version, c.promoted]), [[2, false]]);
  assert.match(next.compiled[0]!.why ?? "", new RegExp(`^run ${urgent}: its answer is not the one you approved`));
  assert.equal(promotedFor(events, dataDir, "ada", TASK)?.version, 1, "the version before still stands");
  await g.night();
  assert.equal(teacher.requests.length, 2, "tried on those runs already: not again until there is something new");
});

test("from 03:00, once a night; nights slept through run once; no teacher, it says so and tries the next night", async (t) => {
  const clock = new FakeClock(new Date(2026, 9, 2, 9, 0).getTime()); // 2 Oct, 09:00 local
  const db = openDb(tempDir(t));
  t.after(() => db.close());
  const events = new EventLog(db, clock);
  let teacher: { name: string; baseUrl: string; model: string; retries: number } | null = null;
  const kitCalls: string[] = [];
  const g = new Gym({ events, clock, dataDir: tempDir(t), kit: async (tool) => (kitCalls.push(tool), { refused: "stand-in" }), teacher: () => teacher });
  const tonight = new Date(2026, 9, 3, NIGHT_HOUR).getTime();
  assert.equal(g.nextAt(), tonight, "a new home waits for its first night");
  assert.equal(g.due(), null);
  approved(events, "ada");
  clock.suspend(tonight - clock.now());
  const r = await g.due()!;
  assert.deepEqual([r.night, r.left, r.stopped], [tonight, 1, "no teacher brain is set up"]);
  assert.deepEqual(kitCalls, [], "nothing was tried");
  assert.equal(g.due(), null, "once a night");
  assert.equal(g.nextAt(), tonight + 86_400_000);
  clock.suspend(3 * 86_400_000 + 3_600_000); // asleep for three nights; 04:00 on the 6th
  const woke = await g.due()!;
  assert.equal(woke.night, new Date(2026, 9, 6, NIGHT_HOUR).getTime(), "the nights slept through: run once, as tonight's");
  assert.equal(g.due(), null);
  assert.equal(events.ofType("gym.night").length, 2);
  teacher = { name: "teacher", baseUrl: await deadUrl(), model: "m", retries: 0 };
  clock.suspend(86_400_000);
  const third = await g.due()!;
  assert.deepEqual([third.compiled.length, third.left], [1, 0], "a teacher now: it tries");
  assert.match(third.compiled[0]!.why ?? "", /^the teacher did not answer/);
});

test("the home's tick runs the night; closing the home cuts the teacher short and waits, and those runs wait for another night", LONG, async (t) => {
  const clock = new FakeClock(new Date(2026, 9, 2, 2, 59).getTime());
  const teacher = await fakeBrain(t, [{ text: reply(GOOD), delayMs: 30_000 }]);
  const preset = { id: "t", title: "t", own: null, big: null, teacher: { name: "teacher", baseUrl: teacher.baseUrl, model: "teacher-model", retries: 0 } };
  const { home, dataDir } = openHome(t, { clock, kit: true, brain: { preset } });
  approved(home.events, "ada");
  home.start();
  await home.tick();
  assert.equal(home.events.ofType("gym.night").length, 0, "02:59: not yet");
  clock.suspend(60_000);
  await home.tick();
  for (let i = 0; teacher.requests.length === 0; i++) {
    assert.ok(i < 500, "the teacher was asked");
    await new Promise((r) => setTimeout(r, 10));
  }
  await home.close(); // well before the teacher's 30 s
  const db = openDb(dataDir);
  t.after(() => db.close());
  const after = new EventLog(db, clock);
  assert.deepEqual(after.ofType("gym.night_done").map((e) => [e.data.left, e.data.stopped]), [[1, "the home was closing"]], "it finished before the home let go");
  assert.equal(after.ofType("habit.rejected").length, 0, "a teacher cut short is not a rejection: those runs are tried another night");
  const { home: bare } = openHome(t, {});
  approved(bare.events, "ada");
  const r = await bare.gym.night();
  assert.deepEqual([r.compiled.length, r.left], [0, 1], "no kit: no habit is written where it cannot be proved; the rest of the night still runs");
});
