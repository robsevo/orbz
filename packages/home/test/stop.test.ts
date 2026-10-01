// Ash's engine test `stop-turn`, ported as behaviour (PLAN 1.5_t). Ash's version reads its UI's
// source; the guarantees are what matter: a stopped turn keeps what the model had written and
// says it was stopped; an error keeps it too and names the transport's cause; the stop reaches
// the tool; and a stop does not leak into the next turn.
import assert from "node:assert/strict";
import { test } from "node:test";
import { agentHome } from "./helpers.ts";

const notices = (home: Awaited<ReturnType<typeof agentHome>>["home"]) =>
  home.conversations.list("chat:1").filter((m) => m.role === "notice").map((m) => m.content);

test("a stop while the reply streams keeps what had arrived, says it was stopped, and is prompt", async (t) => {
  let first: () => void;
  const arrived = new Promise<void>((r) => (first = r));
  const { home } = await agentHome(t, [{ chunks: ["Half a thou", "ght"], gapMs: 50, hang: true }], {
    agent: { onText: () => first() },
  });
  home.inbox.send("juniper", "chat:1", "think out loud");
  await arrived;
  await new Promise((r) => setTimeout(r, 120));
  const t0 = Date.now();
  home.inbox.stop("juniper");
  await home.inbox.idle();
  assert.ok(Date.now() - t0 < 1000, `the stop took ${Date.now() - t0} ms`);
  const reply = home.conversations.list("chat:1").find((m) => m.role === "assistant");
  assert.equal(reply?.content, "Half a thought", "the partial reply is kept, not thrown away");
  assert.equal(reply?.meta.stopped, true);
  assert.deepEqual(notices(home), ["Stopped by the user."]);
});

test("an error mid-reply keeps the partial reply, and the notice names the transport's cause", async (t) => {
  const { home } = await agentHome(t, [{ chunks: ["Part of it"], drop: true }]);
  home.inbox.send("juniper", "chat:1", "go");
  await home.inbox.idle();
  const reply = home.conversations.list("chat:1").find((m) => m.role === "assistant");
  assert.equal(reply?.content, "Part of it");
  const n = notices(home).at(-1) ?? "";
  assert.match(n, /^I couldn't finish: big: /);
  assert.match(n, /UND_ERR_SOCKET|ECONNRESET|terminated|other side closed/, `the cause, not just "failed": ${n}`);
  assert.equal(home.events.ofType("run.finished").at(-1)?.data.outcome, "error");
});

test("a server that refuses says how (the HTTP status), and keeps nothing it did not write", async (t) => {
  // refused on all three passes through the brain order (PLAN 1.11): then the one error
  const { home } = await agentHome(t, [{ status: 503 }, { status: 503 }, { status: 503 }]);
  home.inbox.send("juniper", "chat:1", "go");
  await home.inbox.idle();
  assert.match(notices(home).at(-1) ?? "", /^No brain could answer after 3 tries\..*it failed \(503\)/);
  assert.equal(home.conversations.list("chat:1").some((m) => m.role === "assistant"), false);
});

test("a server that refuses once is tried again on the next pass, and answers", async (t) => {
  const { home } = await agentHome(t, [{ status: 503 }, { chunks: ["back again"] }]);
  home.inbox.send("juniper", "chat:1", "go");
  await home.inbox.idle();
  assert.equal(home.conversations.list("chat:1").filter((m) => m.role === "assistant").at(-1)?.content, "back again");
  assert.match(notices(home)[0] ?? "", /^My other brain: it failed \(503\)\./, "and said why it stepped aside");
});

test("the stop reaches the running tool: a long command ends at once and the run says so", async (t) => {
  const { home } = await agentHome(t, [{ calls: [{ name: "shell", args: { command: "sleep 60" } }] }], {
    agent: { decide: () => "allow" },
  });
  home.inbox.send("juniper", "chat:1", "wait a minute");
  await new Promise((r) => setTimeout(r, 400));
  const t0 = Date.now();
  home.inbox.stop("juniper");
  await home.inbox.idle();
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms; the command alone takes 60 s`);
  const tool = home.conversations.list("chat:1").find((m) => m.role === "tool");
  assert.equal(tool?.meta.stopped, true);
  assert.deepEqual(notices(home), ["Stopped by the user."]);
});

test("a stop does not leak into the next turn", async (t) => {
  const { home } = await agentHome(t, [{ chunks: ["…"], hang: true }, { chunks: ["Fresh answer."] }]);
  home.inbox.send("juniper", "chat:1", "first");
  await new Promise((r) => setTimeout(r, 200));
  home.inbox.stop("juniper");
  await home.inbox.idle();
  home.inbox.send("juniper", "chat:1", "second");
  await home.inbox.idle();
  assert.equal(home.conversations.list("chat:1").filter((m) => m.role === "assistant").at(-1)?.content, "Fresh answer.");
  assert.equal(home.events.ofType("run.finished").at(-1)?.data.outcome, "ok");
});

test("a pause is named as a pause, and resuming continues without saying the person's words twice", async (t) => {
  const { home, model } = await agentHome(t, [{ chunks: ["Starting…"], hang: true }, { chunks: ["Finished."] }]);
  home.inbox.send("juniper", "chat:1", "do the thing");
  await new Promise((r) => setTimeout(r, 200));
  home.inbox.pause("juniper");
  await home.inbox.idle();
  assert.match(notices(home).at(-1) ?? "", /^Paused\./);
  home.inbox.resume("juniper");
  await home.inbox.idle();
  const users = model.agent.at(-1)!.filter((m) => m.role === "user");
  assert.deepEqual(users.map((m) => m.content), ["do the thing"]);
  assert.equal(home.conversations.list("chat:1").filter((m) => m.role === "user").length, 1);
  assert.equal(home.conversations.list("chat:1").filter((m) => m.role === "assistant").at(-1)?.content, "Finished.");
});
