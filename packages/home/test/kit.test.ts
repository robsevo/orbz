// PLAN 1.3_t: Ash's kit runs beside the home as an MCP server over stdio; killing it mid-call
// restarts it and the call fails loudly, never silently. The real kit (Python, through uv) for
// the protocol and the kill; a stand-in that dies at once, on a fake clock, for the crash loop.
import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { type Clock, FakeClock, realClock } from "../src/clock.ts";
import { EventLog } from "../src/events.ts";
import { CRASH_LOOP_RESTARTS, Kit, KitDiedError, KitDownError } from "../src/kit.ts";
import { tempDir } from "./helpers.ts";

/** An in-memory log. Left open: `after` hooks run in the order they were added, and the kit's
 * close (added later) still writes its last `kit.died` here. */
function eventLog(_t: TestContext, clock: Clock): EventLog {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, type TEXT, orb TEXT, conversation TEXT, data TEXT)");
  return new EventLog(db, clock);
}

function realKit(t: TestContext) {
  const events = eventLog(t, realClock);
  const dataDir = tempDir(t);
  const kit = new Kit({ events, clock: realClock, dataDir, env: { ORBS_KIT_TEST_TOOLS: "1" } });
  t.after(() => kit.close());
  return { kit, events, dataDir };
}

async function until<T>(what: string, fn: () => T | undefined, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("the kit answers over MCP with Ash's modules, on its own state, with nothing of Ash's in its environment", async (t) => {
  const saved = { ASH_HOME: process.env.ASH_HOME, ASH_STATE_HOME: process.env.ASH_STATE_HOME };
  process.env.ASH_HOME = "/home/someone/ash/brain"; // as if the home were started from an Ash session
  process.env.ASH_STATE_HOME = "/home/someone/ash/voice";
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
  const { kit, dataDir } = realKit(t);
  const starting = kit.start();
  assert.equal(kit.state, "starting", "not 'up' until the kit has answered the handshake");
  await starting;
  assert.equal(kit.state, "up");

  const st = (await kit.call("kit_status")) as Record<string, unknown>;
  assert.equal(st.pid, kit.pid, "the pid the home supervises is the kit's own, not a launcher's");
  assert.equal(st.state, `${dataDir}/kit`);
  assert.equal(st.brain, `${dataDir}/brain`);
  assert.deepEqual(st.ash_env, [], "no ASH_* variable reaches the kit");
  assert.equal(st.zone, Intl.DateTimeFormat().resolvedOptions().timeZone, "the kit keeps the home's time zone, not Ash's owner's");

  assert.deepEqual(await kit.call("when", { text: "tomorrow at 3pm", now: Date.parse("2026-10-01T16:00:00Z") / 1000 }), {
    epoch: Date.parse("2026-10-02T19:00:00Z") / 1000,
    said: "tomorrow at 3 pm",
  });
  assert.equal(
    await kit.call("for_the_ear", { text: "I fixed **3** issues in `~/ash/brain/settings.json`, e.g. the hooks." }),
    "I fixed 3 issues in the settings file, for example the hooks.",
  );
  const key = `token = "ghp_${"A1b2C3d4E5".repeat(4)}"`;
  const found = (await kit.call("secret_findings", { text: key })) as string[];
  assert.equal(found.length, 1);
  assert.ok(!found[0]!.includes("A1b2C3d4E5A1b2"), "a finding never repeats the key");
  assert.ok(!String(await kit.call("redact_text", { text: key })).includes("A1b2C3d4E5"));
});

test("a module that prints to stdout cannot corrupt the protocol", async (t) => {
  const { kit } = realKit(t);
  await kit.start();
  assert.equal(await kit.call("test_print", { text: "hello" }), "hello");
  assert.equal(((await kit.call("kit_status")) as { pid: number }).pid, kit.pid, "the next call still parses");
});

test("killed mid-call: the call fails loudly with the reason, and the kit comes back", async (t) => {
  const { kit, events } = realKit(t);
  await kit.start();
  const first = kit.pid!;
  const call = kit.call("test_wait", { seconds: 30 });
  await new Promise((r) => setTimeout(r, 200));
  const t0 = Date.now();
  process.kill(first, "SIGKILL");
  await assert.rejects(call, (e: Error) => e instanceof KitDiedError && /test_wait.*killed by SIGKILL/.test(e.message));
  assert.ok(Date.now() - t0 < 2000, `it failed at once, not at the 60 s timeout (${Date.now() - t0} ms)`);
  assert.deepEqual(
    events.ofType("kit.call_failed").map((e) => e.data.tool),
    ["test_wait"],
    "the failure is in the event log",
  );
  assert.equal(events.ofType("kit.died")[0]?.data.why, "killed by SIGKILL");
  assert.equal(events.ofType("kit.restarting")[0]?.data.in_ms, 1000);

  // a call made while it restarts waits for the new kit rather than failing
  const st = (await kit.call("kit_status")) as { pid: number };
  assert.notEqual(st.pid, first, "a new process");
  assert.equal(st.pid, kit.pid);
});

test("a tool that fails is an error for that call, not a death", async (t) => {
  const { kit, events } = realKit(t);
  await kit.start();
  const pid = kit.pid;
  await assert.rejects(kit.call("no_such_tool"), /kit tool "no_such_tool" failed/);
  assert.equal(kit.pid, pid);
  assert.equal(events.ofType("kit.died").length, 0);
});

/** A kit that dies the moment it starts, on a fake clock: the supervisor's arithmetic. */
function dyingKit(t: TestContext, command = process.execPath, args = ["-e", "process.exit(7)"]) {
  const clock = new FakeClock("2026-10-01T12:00:00Z");
  const events = eventLog(t, clock);
  const kit = new Kit({ events, clock, dataDir: tempDir(t), command, args });
  t.after(() => kit.close());
  return { kit, events, clock };
}

test("a crash loop: restarts at 1, 2, 4, 8, 15 s, then on the 6th death in a minute it gives up loudly", async (t) => {
  const { kit, events, clock } = dyingKit(t);
  await assert.rejects(kit.start(), KitDiedError);
  for (let i = 1; i <= CRASH_LOOP_RESTARTS; i++) {
    const wait = await until(`restart ${i}`, () => events.ofType("kit.restarting")[i - 1]?.data.in_ms as number | undefined);
    await clock.advance(wait);
  }
  await until("the give-up", () => events.ofType("kit.gave_up")[0]);
  assert.deepEqual(events.ofType("kit.restarting").map((e) => e.data.in_ms), [1000, 2000, 4000, 8000, 15000]);
  assert.equal(events.ofType("kit.died").length, CRASH_LOOP_RESTARTS + 1);
  assert.equal(events.ofType("kit.died")[0]?.data.why, "exited 7", "the exit is named");
  assert.equal(events.ofType("kit.gave_up")[0]?.data.deaths, 6);
  assert.match(String(events.ofType("notify").at(-1)?.data.text), /died 6 times in a minute after 5 restarts; not restarting/);
  assert.equal(kit.state, "gave-up");
  await assert.rejects(kit.call("kit_status"), KitDownError, "a call now fails at once");
  await clock.advance(60_000);
  assert.equal(events.ofType("kit.died").length, CRASH_LOOP_RESTARTS + 1, "and nothing restarts it behind the owner's back");
});

test("control: deaths more than a minute apart never add up to a crash loop", async (t) => {
  const { kit, events, clock } = dyingKit(t);
  await assert.rejects(kit.start(), KitDiedError);
  for (let i = 1; i <= 8; i++) {
    await until(`restart ${i}`, () => events.ofType("kit.restarting")[i - 1]);
    await clock.advance(61_000); // the restart fires, and the next death is over a minute after the last
  }
  assert.equal(events.ofType("kit.gave_up").length, 0);
  assert.deepEqual(new Set(events.ofType("kit.restarting").map((e) => e.data.in_ms)), new Set([1000]), "the backoff resets too");
});

test("a kit that cannot start at all is one death per attempt, and says why", async (t) => {
  const { kit, events } = dyingKit(t, "/nonexistent/orbs-kit-python", []);
  await assert.rejects(kit.start(), /could not start: ENOENT/);
  await until("the restart", () => events.ofType("kit.restarting")[0]);
  assert.equal(events.ofType("kit.died").length, 1, "an `error` and an `exit` for one failed spawn count once");
});

test("an `error` and an `exit` for the same process count as ONE death (supervise.js's lesson)", async (t) => {
  const clock = new FakeClock("2026-10-01T12:00:00Z");
  const events = eventLog(t, clock);
  const children: EventEmitter[] = [];
  const fakeSpawn = (() => {
    const c = Object.assign(new EventEmitter(), {
      pid: 4242 + children.length,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => true,
    });
    children.push(c);
    return c as unknown as ChildProcess;
  }) as unknown as typeof import("node:child_process").spawn;
  const kit = new Kit({ events, clock, dataDir: tempDir(t), command: "fake", spawn: fakeSpawn, callTimeoutMs: 1000 });
  t.after(() => kit.close());
  const started = kit.start();
  const c = children[0]!;
  c.emit("error", Object.assign(new Error("spawn fake EACCES"), { code: "EACCES" }));
  c.emit("exit", null, "SIGKILL");
  await assert.rejects(started, /could not start: EACCES/);
  assert.equal(events.ofType("kit.died").length, 1);
  assert.deepEqual(events.ofType("kit.restarting").map((e) => e.data.restarts), [1], "and one restart, not two");
});

test("a home that closes while the kit is still starting leaves no kit behind", async (t) => {
  const events = eventLog(t, realClock);
  const kit = new Kit({ events, clock: realClock, dataDir: tempDir(t) });
  const starting = kit.start();
  await kit.close(); // before uv has even named the interpreter
  await assert.rejects(starting, KitDownError);
  assert.equal(kit.pid, undefined);
  assert.equal(events.ofType("kit.started").length, 0, "nothing was spawned after the close");
});
