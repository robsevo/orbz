// The agent loop (PLAN 1.5): tools with metadata, cards that pause a run and resume it where it
// stopped, a new message expiring an open card, and a trace of every step. A.0 is the control: a
// plain question gets a plain answer with no card and no tool.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { Home } from "../src/home.ts";
import { DENIED, EXPIRED } from "../src/agent/loop.ts";
import { trace } from "../src/agent/trace.ts";
import { agentHome } from "./helpers.ts";

const say = async (home: Home, text: string, conversation = "chat:1"): Promise<void> => {
  home.inbox.send("juniper", conversation, text);
  await home.inbox.idle();
};
const roles = (home: Home, conversation = "chat:1"): string[] => home.conversations.list(conversation).map((m) => m.role);
const lastRun = (home: Home): number => Number(home.events.ofType("run.finished").at(-1)?.data.run);

test("A.0 CONTROL: a plain question gets a plain answer, stored, traced, with no tool or card", async (t) => {
  const { home, model } = await agentHome(t, [{ chunks: ["Hel", "lo!"] }]);
  await say(home, "hi");
  assert.deepEqual(roles(home), ["user", "assistant"]);
  assert.equal(home.conversations.list("chat:1").at(-1)?.content, "Hello!");
  assert.equal(model.agent.length, 1);
  assert.equal(model.agent[0]![0]!.role, "system", "the standing context comes first");
  assert.deepEqual(trace(home.events, lastRun(home)).map((s) => s.kind), ["input", "model", "output"]);
  assert.equal(home.events.ofType("card.opened").length, 0);
});

test("A.1 an allowed tool runs, and its result goes back to the model right after the call", async (t) => {
  const { home, model } = await agentHome(t, [
    { calls: [{ name: "write_file", args: { path: "notes/todo.md", content: "buy milk" } }] },
    { chunks: ["Saved."] },
  ]);
  await say(home, "note: buy milk");
  const ws = home.agent!.workspace("juniper");
  assert.equal(readFileSync(join(ws, "notes/todo.md"), "utf8"), "buy milk");
  const second = model.agent[1]!;
  const i = second.findIndex((m) => m.role === "assistant" && Array.isArray(m.tool_calls));
  assert.equal(second[i + 1]?.role, "tool", "the result follows its call");
  assert.match(String(second[i + 1]?.content), /Wrote 8 characters/);
  assert.equal(home.conversations.list("chat:1").at(-1)?.content, "Saved.");
});

test("A.2 a call that needs approval opens a card and the run WAITS; approve runs it, deny says no", async (t) => {
  const { home, model } = await agentHome(t, [
    { calls: [{ name: "shell", args: { command: "echo approved > out.txt" } }] },
    { chunks: ["Done."] },
    { calls: [{ name: "shell", args: { command: "touch should-not-exist" } }] },
    { chunks: ["OK, I won't."] },
  ]);
  await say(home, "write out.txt");
  const card = home.conversations.openCard("chat:1")!;
  assert.equal(card.kind, "approval");
  assert.equal(card.title, "Juniper wants to run `echo approved > out.txt` in its workspace");
  assert.equal(home.inbox.orb("juniper")?.status, "waiting");
  assert.equal(home.events.ofType("run.finished").at(-1)?.data.outcome, "waiting");
  assert.equal(model.agent.length, 1, "nothing more is asked of the model while the card waits");

  home.answerCard(card.id, "approve");
  await home.inbox.idle();
  const ws = home.agent!.workspace("juniper");
  assert.equal(readFileSync(join(ws, "out.txt"), "utf8").trim(), "approved");
  assert.equal(home.conversations.list("chat:1").filter((m) => m.role === "assistant").at(-1)?.content, "Done.");

  await say(home, "now touch the file");
  const second = home.conversations.openCard("chat:1")!;
  home.answerCard(second.id, "deny");
  await home.inbox.idle();
  assert.equal(existsSync(join(ws, "should-not-exist")), false);
  assert.ok(model.agent.at(-1)!.some((m) => m.role === "tool" && m.content === DENIED), "the model is told no, in so many words");
  assert.throws(() => home.answerCard(second.id, "approve"), /is denied, not waiting/);
});

test("A.3 a question card waits for the person's answer and hands it to the model", async (t) => {
  const { home, model } = await agentHome(t, [{ calls: [{ name: "ask_owner", args: { question: "Which colour?" } }] }, { chunks: ["Blue it is."] }]);
  await say(home, "paint the logo");
  const card = home.conversations.openCard("chat:1")!;
  assert.deepEqual([card.kind, card.detail], ["question", "Which colour?"]);
  assert.throws(() => home.answerCard(card.id, "approve"), /is a question: answer it/);
  home.answerCard(card.id, "answer", "blue");
  await home.inbox.idle();
  assert.ok(model.agent.at(-1)!.some((m) => m.role === "tool" && m.content === "The person answered: blue"));
});

test("A.4 a new message instead of an answer EXPIRES the card; its calls are answered 'not done'", async (t) => {
  const { home, model } = await agentHome(t, [
    { calls: [{ name: "shell", args: { command: "touch one" } }, { name: "shell", args: { command: "touch two" } }] },
    { chunks: ["Never mind then."] },
  ]);
  await say(home, "touch two files");
  const card = home.conversations.openCard("chat:1")!;
  await say(home, "actually, forget it");
  assert.equal(home.conversations.card(card.id)?.status, "expired");
  const req = model.agent.at(-1)!;
  const tools = req.filter((m) => m.role === "tool");
  assert.deepEqual(tools.map((m) => m.content), [EXPIRED, EXPIRED], "both calls, the carded one and the one after it");
  assert.equal(req.at(-1)?.content, "actually, forget it", "and the new message comes after them");
  assert.throws(() => home.answerCard(card.id, "approve"), /is expired/);
  const ws = home.agent!.workspace("juniper");
  assert.equal(existsSync(join(ws, "one")) || existsSync(join(ws, "two")), false);
});

test("A.5 a schedule's firing starts from a fresh context in its own conversation", async (t) => {
  const { home, model } = await agentHome(t, [{ chunks: ["first brief"] }, { chunks: ["second brief"] }]);
  home.inbox.enqueue("juniper", "schedule:x", "schedule", "[Schedule: Brief] Brief me.", { fresh: true });
  await home.inbox.idle();
  home.inbox.enqueue("juniper", "schedule:x", "schedule", "[Schedule: Brief] Brief me.", { fresh: true });
  await home.inbox.idle();
  const second = model.agent[1]!;
  assert.equal(second.filter((m) => m.role === "user").length, 1, "the second firing does not see the first");
  assert.ok(!second.some((m) => m.content === "first brief"));
});

for (const when of ["opened", "waiting"] as const) {
  test(`A.6 killed ${when === "opened" ? "the moment the card opens" : "while the card waits"}: after a restart, approving resumes at the same step`, async (t) => {
    const { spawn } = await import("node:child_process");
    const { fakeModel } = await import("./fakes/model.ts");
    const { tempDir } = await import("./helpers.ts");
    const model = await fakeModel(t, [{ calls: [{ name: "shell", args: { command: "echo resumed > marker.txt" } }] }, { chunks: ["All done."] }]);
    const dataDir = tempDir(t);
    const child = spawn(process.execPath, [new URL("./fixtures/card-then-die.ts", import.meta.url).pathname, dataDir, model.url, when], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const cardId = await new Promise<number>((resolve, reject) => {
      child.stdout.on("data", (b: Buffer) => {
        const m = /(?:card|waiting) (\d+)/.exec(b.toString());
        if (m) resolve(Number(m[1]));
      });
      child.once("exit", (code) => reject(new Error(`the child exited early (${code})`)));
    });
    child.kill("SIGKILL");
    await new Promise((r) => child.once("exit", r));
    assert.equal(model.agent.length, 1);

    // A new home on the same data, talking to the same model (which still holds the rest of the script).
    const again = Home.open({
      dataDir,
      protect: [],
      spendCapUsd: null,
      brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
    });
    t.after(() => again.close());
    again.start();
    await again.inbox.idle();
    assert.equal(again.events.ofType("home.started").at(-1)?.data.recovered, when === "opened" ? 1 : 0,
      when === "opened" ? "the kill landed mid-run: the restart found it cut off" : "the run had ended waiting before the kill");
    assert.equal(again.conversations.openCard("chat:1")?.id, cardId, "the card is still waiting after the restart");
    assert.equal(model.agent.length, 1, "nothing was asked again: the run is waiting, not starting over");

    again.answerCard(cardId, "approve");
    await again.inbox.idle();
    const ws = again.agent!.workspace("juniper");
    assert.equal(readFileSync(join(ws, "marker.txt"), "utf8").trim(), "resumed", "the approved call ran, after the restart");
    assert.equal(model.agent.length, 2, "and the model was asked once more, for the step AFTER the call");
    assert.deepEqual(roles(again), ["user", "assistant", "notice", "tool", "assistant"]);
    assert.equal(again.conversations.list("chat:1").at(-1)?.content, "All done.");
  });
}

test("A.7 a trace replays: its model replies and tool results reproduce the run, touching nothing real", async (t) => {
  const { fakeModel } = await import("./fakes/model.ts");
  const { script, trace } = await import("../src/agent/trace.ts");
  const { TOOLS } = await import("../src/agent/tools.ts");
  const { home } = await agentHome(t, [
    { calls: [{ name: "write_file", args: { path: "notes.md", content: "milk, eggs" } }, { name: "shell", args: { command: "cat notes.md" } }] },
    { chunks: ["Here it is: milk, eggs."] },
  ]);
  await say(home, "make a shopping note and show it");
  home.answerCard(home.conversations.openCard("chat:1")!.id, "approve");
  await home.inbox.idle();
  const runs = [...new Set(home.events.ofType("trace.step").map((e) => Number(e.data.run)))];
  assert.equal(runs.length, 2, "a card splits the job into two runs");
  const sc = script(home.events, runs);
  assert.equal(sc.replies.length, 2);
  assert.deepEqual([...sc.results.values()].map((r) => r.content), ["Wrote 10 characters to notes.md.", "milk, eggs"]);
  assert.equal(sc.output, "Here it is: milk, eggs.");
  home.feedback(runs.at(-1)!, "approve");
  assert.equal(home.events.ofType("trace.feedback").at(-1)?.data.verdict, "approve");

  // the replay: the recorded replies are the model, the recorded results are the tools
  const byCall = new Map(sc.replies.flatMap((r) => r.toolCalls).map((c) => [`${c.name}:${c.arguments}`, sc.results.get(c.id)!]));
  const stubs = TOOLS.map((d) => ({ ...d, run: async (args: Record<string, unknown>) => {
    const r = byCall.get(`${d.name}:${JSON.stringify(args)}`);
    return r ? { content: r.content, isError: r.isError } : { content: "NOT IN THE TRACE", isError: true };
  } }));
  const model = await fakeModel(t, sc.replies.map((r) => ({
    chunks: r.text ? [r.text] : [],
    calls: r.toolCalls.map((c) => ({ id: c.id, name: c.name, args: JSON.parse(c.arguments) as Record<string, unknown> })),
  })));
  const { Home: H } = await import("../src/home.ts");
  const { tempDir } = await import("./helpers.ts");
  const replay = H.open({
    dataDir: tempDir(t), protect: [], spendCapUsd: null, agent: { tools: stubs },
    brain: { preset: { id: "r", title: "r", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0 }, teacher: null } },
  });
  t.after(() => replay.close());
  replay.inbox.addOrb("juniper", "Juniper", "general", {}, "Junior"); // a Junior, as the first home hired him
  replay.start();
  for (const input of sc.inputs.filter((i) => i.source === "chat")) replay.inbox.send("juniper", "chat:1", input.text);
  await replay.inbox.idle();
  replay.answerCard(replay.conversations.openCard("chat:1")!.id, "approve");
  await replay.inbox.idle();

  const shape = (h: Home, rs: number[]) => rs.flatMap((r) => trace(h.events, r)).filter((s) => s.kind !== "input")
    .map((s) => [s.kind, s.data.text ?? s.data.result ?? s.data.tool ?? ""]);
  const replayRuns = [...new Set(replay.events.ofType("trace.step").map((e) => Number(e.data.run)))];
  assert.deepEqual(shape(replay, replayRuns), shape(home, runs), "the same steps, the same words, the same results");
  assert.equal(script(replay.events, replayRuns).output, sc.output);
  assert.equal(existsSync(join(replay.agent!.workspace("juniper"), "notes.md")), false, "the replay wrote nothing: the trace answered");
});
