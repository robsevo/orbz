import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { settle } from "../src/clock.ts";
import { Home } from "../src/home.ts";
import { openHome, Recorder, tempDir } from "./helpers.ts";

test("two messages to a busy orb wait, then run in order as one turn", async (t) => {
  const { home, runner } = openHome(t);
  home.inbox.addOrb("juniper", "Juniper");
  runner.hold = true;
  home.inbox.send("juniper", "chat:1", "first");
  await settle();
  assert.equal(runner.runs.length, 1, "the first message starts at once");

  home.inbox.send("juniper", "chat:1", "second");
  home.inbox.send("juniper", "chat:1", "third");
  await settle();
  assert.equal(runner.runs.length, 1, "nothing else starts while the orb is busy");
  assert.equal(home.inbox.orb("juniper")?.status, "working");

  runner.hold = false;
  runner.release();
  await home.inbox.idle();
  assert.deepEqual(runner.texts(), [["first"], ["second", "third"]]);
  assert.equal(runner.maxActive.get("juniper"), 1);
  assert.equal(home.inbox.orb("juniper")?.status, "idle");
});

test("messages for different chats are never merged, and order is kept across them", async (t) => {
  const { home, runner } = openHome(t);
  home.inbox.addOrb("juniper", "Juniper");
  runner.hold = true;
  home.inbox.send("juniper", "chat:a", "a1");
  await settle();
  home.inbox.send("juniper", "chat:a", "a2");
  home.inbox.send("juniper", "chat:b", "b1");
  home.inbox.send("juniper", "chat:a", "a3");
  runner.hold = false;
  runner.release();
  await home.inbox.idle();
  assert.deepEqual(runner.texts(), [["a1"], ["a2"], ["b1"], ["a3"]]);
  assert.deepEqual(
    runner.runs.map((r) => r.conversation),
    ["chat:a", "chat:a", "chat:b", "chat:a"],
  );
});

test("one run at a time per orb, but two orbs work side by side", async (t) => {
  const { home, runner } = openHome(t);
  home.inbox.addOrb("juniper", "Juniper");
  home.inbox.addOrb("pip", "Pip");
  runner.hold = true;
  home.inbox.send("juniper", "chat:1", "j");
  home.inbox.send("pip", "chat:1", "p");
  await settle();
  assert.equal(runner.runs.length, 2, "both orbs started");
  runner.hold = false;
  runner.release();
  runner.release();
  await home.inbox.idle();
  assert.equal(runner.maxActive.get("juniper"), 1);
  assert.equal(runner.maxActive.get("pip"), 1);
});

test("pause stops the run and keeps its work; resume picks it up first, in order", async (t) => {
  const { home, runner } = openHome(t);
  home.inbox.addOrb("juniper", "Juniper");
  runner.hold = true;
  home.inbox.send("juniper", "chat:1", "long job");
  await settle();
  home.inbox.pause("juniper");
  await settle();
  assert.equal(home.inbox.orb("juniper")?.status, "paused");
  assert.equal(runner.runs[0]?.signal.aborted, true, "the run was told to stop");

  home.inbox.send("juniper", "chat:1", "while paused");
  await settle();
  assert.equal(runner.runs.length, 1, "a paused orb starts nothing");

  runner.hold = false;
  home.inbox.resume("juniper");
  await home.inbox.idle();
  assert.deepEqual(runner.texts(), [["long job"], ["long job", "while paused"]]);
  assert.equal(runner.runs[1]?.items[0]?.data.interrupted, "paused", "the resumed item knows it was cut off");
  const outcomes = home.events.ofType("run.finished").map((e) => e.data.outcome);
  assert.deepEqual(outcomes, ["paused", "ok"]);
});

test("stop drops what is waiting and stops the run; the orb is not paused", async (t) => {
  const { home, runner } = openHome(t);
  home.inbox.addOrb("juniper", "Juniper");
  runner.hold = true;
  home.inbox.send("juniper", "chat:1", "job");
  await settle();
  home.inbox.send("juniper", "chat:1", "queued 1");
  home.inbox.send("juniper", "chat:2", "queued 2");
  home.inbox.stop("juniper");
  await home.inbox.idle();
  assert.equal(runner.runs.length, 1, "nothing that was waiting ran");
  assert.equal(home.inbox.queued("juniper").length, 0);
  assert.equal(home.inbox.orb("juniper")?.status, "idle");
  assert.deepEqual(home.events.ofType("orb.stopped").map((e) => e.data.dropped), [2]);
  assert.equal(home.events.ofType("run.finished")[0]?.data.outcome, "stopped");

  runner.hold = false;
  home.inbox.send("juniper", "chat:1", "after stop");
  await home.inbox.idle();
  assert.deepEqual(runner.texts().at(-1), ["after stop"], "new work runs normally after a stop");
});

test("a run that fails is recorded with its error, and the next item still runs", async (t) => {
  const { home, runner } = openHome(t);
  home.inbox.addOrb("juniper", "Juniper");
  runner.fail = "the brain said no";
  home.inbox.send("juniper", "chat:1", "will fail");
  await home.inbox.idle();
  runner.fail = null;
  home.inbox.send("juniper", "chat:1", "will work");
  await home.inbox.idle();
  const ends = home.events.ofType("run.finished").map((e) => [e.data.outcome, e.data.error ?? null]);
  assert.deepEqual(ends, [
    ["error", "the brain said no"],
    ["ok", null],
  ]);
});

test("the activity line shows while working and clears when the run ends", async (t) => {
  const { home } = openHome(t, {
    runner: {
      async run(ctx) {
        ctx.activity("Reading 12 emails");
        assert.equal(home.inbox.orb("juniper")?.activity, "Reading 12 emails");
        return {};
      },
    },
  });
  home.inbox.addOrb("juniper", "Juniper");
  home.inbox.send("juniper", "chat:1", "digest");
  await home.inbox.idle();
  assert.equal(home.inbox.orb("juniper")?.activity, null);
  assert.deepEqual(home.events.ofType("orb.activity").map((e) => e.data.text), ["Reading 12 emails"]);
});

test("a runner that ignores stop is let go after the grace period", async (t) => {
  const { home, runner, clock } = openHome(t, { graceMs: 5000 });
  home.inbox.addOrb("juniper", "Juniper");
  runner.hold = true;
  runner.deaf = true;
  home.inbox.send("juniper", "chat:1", "hangs");
  await settle();
  home.inbox.stop("juniper");
  await clock.advance(4999);
  assert.equal(home.events.ofType("run.finished").length, 0, "still inside the grace period");
  await clock.advance(1);
  await settle();
  const end = home.events.ofType("run.finished")[0];
  assert.equal(end?.data.outcome, "stopped");
  assert.equal(end?.data.abandoned, true);
  runner.hold = false;
  runner.deaf = false;
  runner.release();
});

test("a home killed mid-run puts that run's work back at the head of the queue", async (t) => {
  const dataDir = tempDir(t);
  const child = spawn(process.execPath, [new URL("./fixtures/crash-mid-run.ts", import.meta.url).pathname, dataDir], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    child.stdout.on("data", (b: Buffer) => {
      if (b.toString().includes("running")) resolve();
    });
    child.once("exit", (code) => reject(new Error(`the fixture exited early (${code})`)));
  });
  child.kill("SIGKILL");
  await new Promise((r) => child.once("exit", r));

  const runner = new Recorder();
  const home = Home.open({ dataDir, runner, protect: [] });
  t.after(() => home.close());
  assert.equal(home.events.ofType("run.interrupted").length, 1);
  home.start();
  await home.inbox.idle();
  assert.deepEqual(runner.texts(), [["the job that was cut off", "sent after it"]]);
  assert.equal(runner.runs[0]?.items[0]?.data.interrupted, "interrupted");
  assert.equal(home.events.ofType("home.started").at(-1)?.data.recovered, 1);
});
