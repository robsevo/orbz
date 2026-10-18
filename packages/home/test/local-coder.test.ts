// The local coder on a CPU (10-18): its server keeps what it has read, so the clock goes after the conversation, the
// home reads each orb's chat into it before anyone writes, it is given time to read (past Node's fetch, which waits
// 300 s for headers whatever its signal says), and a chat is tidied before it outgrows the coder's window.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import { Brains, LOCAL_CONTEXT_TOKENS, LOCAL_TIMEOUT_MS } from "../src/brain/brains.ts";
import { type Endpoint, FETCH_HEADERS_MS, fetchFor, patientFetch } from "../src/brain/openai.ts";
import { MemoryStore } from "../src/chatgpt/store.ts";
import { FakeClock } from "../src/clock.ts";
import { Home, type HomeOptions } from "../src/home.ts";
import { fakeModel, type Turn } from "./fakes/model.ts";
import { tempDir } from "./helpers.ts";

type Msg = { role: string; content?: string };
const CLOCK = /It is .* where the person is/;

/** A home whose one brain is the fake model, with its endpoint's flags as given (a local coder's, by default). */
async function coderHome(t: TestContext, script: Turn[], ep: Partial<Endpoint> = { prefixCache: true }, more: Partial<HomeOptions> = {}) {
  const model = await fakeModel(t, script);
  const clock = new FakeClock(new Date("2026-10-18T09:49").getTime());
  const home = Home.open({
    dataDir: tempDir(t),
    protect: [],
    spendCapUsd: null,
    clock,
    brain: { preset: { id: "t", title: "t", own: null, big: { name: "big", baseUrl: model.url, model: "m", retries: 0, ...ep }, teacher: null } },
    agent: { passWaitMs: 20 },
    ...more,
  });
  t.after(() => home.close());
  home.inbox.addOrb("juniper", "Juniper", "general", {}, "Junior");
  home.start();
  return { home, model, clock, ep: { name: "big", baseUrl: model.url, model: "m", retries: 0, ...ep } as Endpoint };
}

async function until(what: string, ok: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("the local coder: its server keeps what it has read, it is given longer than a cold read takes, its window is known", (t) => {
  const brains = new Brains({ dataDir: tempDir(t), store: new MemoryStore(), chatgpt: () => null });
  brains.setLocal({ baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3-orbz" });
  const ep = brains.chain.links.find((l) => l.id === "local")!.endpoint()!;
  assert.equal(ep.prefixCache, true);
  assert.equal(ep.timeoutMs, LOCAL_TIMEOUT_MS);
  assert.ok(LOCAL_TIMEOUT_MS > 385_000, "past the 385 s a cold Orbz prompt took on the CPU (the stream's own is 300 s)");
  assert.equal(ep.contextTokens, LOCAL_CONTEXT_TOKENS);
});

test("the local coder is asked over node:http, which waits for headers as long as its signal allows; another brain over fetch", (t) => {
  const brains = new Brains({ dataDir: tempDir(t), store: new MemoryStore(), chatgpt: () => null });
  brains.setLocal({ baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3-orbz" });
  assert.ok(LOCAL_TIMEOUT_MS > FETCH_HEADERS_MS);
  assert.equal(fetchFor(brains.chain.links.find((l) => l.id === "local")!.endpoint()!), patientFetch);
  // CONTROL: a brain with no long wait keeps Node's fetch, as one with a wait inside fetch's own
  assert.equal(fetchFor({ name: "big", baseUrl: "http://x/v1", model: "m" }), fetch);
  assert.equal(fetchFor({ name: "big", baseUrl: "http://x/v1", model: "m", timeoutMs: FETCH_HEADERS_MS }), fetch);
});

/** A server that answers after `delayMs` with `chunks`, a gap between each; and every request's body. */
async function slowServer(t: TestContext, delayMs: number, chunks: string[], status = 200) {
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += String(d)));
    req.on("end", () => {
      bodies.push(raw);
      setTimeout(async () => {
        res.writeHead(status, { "content-type": "text/event-stream", "x-seen": req.headers["content-type"] ?? "" });
        for (const c of chunks) {
          res.write(c);
          await new Promise((r) => setTimeout(r, 20));
        }
        res.end();
      }, delayMs);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/chat/completions`, bodies };
}

test("patientFetch: the body sent, the status, headers and the reply as it streams, as fetch gives them", async (t) => {
  const s = await slowServer(t, 200, ["data: one\n\n", "data: two\n\n"], 201);
  const res = await patientFetch(s.url, { method: "POST", headers: { "content-type": "application/json" }, body: '{"a":1}' });
  assert.equal(res.status, 201);
  assert.equal(res.ok, true);
  assert.equal(res.headers.get("x-seen"), "application/json", "its headers went");
  assert.deepEqual(s.bodies, ['{"a":1}']);
  const reader = res.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.equal(first, "data: one\n\n", "the first part before the reply ends");
  let rest = "";
  for (let r = await reader.read(); !r.done; r = await reader.read()) rest += new TextDecoder().decode(r.value);
  assert.equal(rest, "data: two\n\n");
});

test("patientFetch: a signal stops it while it waits, and nothing listening fails as fetch does", async (t) => {
  const s = await slowServer(t, 5000, ["late"]);
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 100);
  const t0 = Date.now();
  await assert.rejects(patientFetch(s.url, { method: "POST", body: "{}", signal: stop.signal }), { name: "AbortError" });
  assert.ok(Date.now() - t0 < 2000, "stopped at once, not when the reply came");
  await assert.rejects(patientFetch("http://127.0.0.1:1/v1/chat/completions", { method: "POST", body: "{}" }), /ECONNREFUSED/);
});

test("on a brain that keeps what it has read the clock goes after the conversation, and the next run reads on from the last", async (t) => {
  const { home, model, clock } = await coderHome(t, [{ chunks: ["Morning."] }, { chunks: ["Later."] }]);
  home.inbox.send("juniper", "chat:juniper", "hello");
  await home.inbox.idle();
  await clock.advance(60 * 60_000);
  home.inbox.send("juniper", "chat:juniper", "and later?");
  await home.inbox.idle();
  const [first, second] = model.agent as Msg[][];
  assert.doesNotMatch(String(first![0]!.content), CLOCK, "no clock in the instructions");
  assert.equal(second![0]!.content, first![0]!.content, "the same instructions an hour on");
  assert.equal(first!.at(-1)!.role, "system");
  assert.match(String(first!.at(-1)!.content), /^It is .*09:49 where the person is/, "the clock: last");
  assert.match(String(second!.at(-1)!.content), /^It is .*10:49 where the person is/);
  assert.deepEqual(second!.slice(0, first!.length - 1), first!.slice(0, -1), "the first request, but for its clock, is the start of the second");
  assert.deepEqual(model.bodies[1]!.tools, model.bodies[0]!.tools, "and the same tools");
});

test("CONTROL: a brain that keeps nothing still reads the clock at the end of its instructions", async (t) => {
  const { home, model } = await coderHome(t, [{ chunks: ["Morning."] }], {});
  home.inbox.send("juniper", "chat:juniper", "hello");
  await home.inbox.idle();
  const first = model.agent[0] as Msg[];
  assert.match(String(first[0]!.content), /It is .*09:49 where the person is/);
  assert.deepEqual(first.map((m) => m.role), ["system", "user"]);
});

test("the warm-up sends what the orb's next run will, but for the clock and the new message, for one token", async (t) => {
  const { home, model, ep } = await coderHome(t, [{ chunks: ["Morning."] }, { chunks: ["x"] }, { chunks: ["Later."] }]);
  home.inbox.send("juniper", "chat:juniper", "hello");
  await home.inbox.idle();
  await home.agent!.warm(ep, ["juniper"]);
  home.inbox.send("juniper", "chat:juniper", "and later?");
  await home.inbox.idle();
  const [, warm, run] = model.agent as Msg[][];
  assert.equal(model.bodies[1]!.max_tokens, 1, "one token of reply");
  assert.deepEqual(model.bodies[1]!.tools, model.bodies[2]!.tools, "the run's tools");
  assert.deepEqual(run!.slice(0, warm!.length), warm, "all it read is the start of the run's request");
  assert.deepEqual(run!.slice(warm!.length).map((m) => m.role), ["user", "system"], "after it only the new message and the clock");
  assert.equal(home.conversations.list("chat:juniper").filter((m) => m.role === "assistant").length, 2, "the warm-up's word is never kept");
});

test("CONTROL: a brain that keeps nothing is never warmed", async (t) => {
  const { home, model, ep } = await coderHome(t, [], {});
  await home.agent!.warm({ ...ep, prefixCache: false }, ["juniper"]);
  assert.equal(model.agent.length, 0);
});

test("a run stops a warm-up under way and is answered", async (t) => {
  const { home, model, ep } = await coderHome(t, [{ hang: true }, { chunks: ["Hi."] }]);
  const warming = home.agent!.warm(ep, ["juniper"]);
  await until("the warm-up's request", () => model.agent.length === 1);
  home.inbox.send("juniper", "chat:juniper", "hello");
  await home.inbox.idle();
  // over: the run stopped it (left alone it hangs, as the control shows)
  await Promise.race([warming, new Promise((_, no) => setTimeout(() => no(new Error("the run never stopped the warm-up")), 5000))]);
  assert.equal(home.conversations.list("chat:juniper").find((m) => m.role === "assistant")?.content, "Hi.");
});

test("CONTROL: a warm-up nobody stops stays under way", async (t) => {
  const { home, model, ep } = await coderHome(t, [{ hang: true }]);
  let over = false;
  const warming = home.agent!.warm(ep, ["juniper"]).then(() => (over = true));
  await until("the warm-up's request", () => model.agent.length === 1);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(over, false, "still reading");
  home.agent!.stopWarming();
  await warming;
});

/** A chat of four long messages (about 4,000 tokens each): with the instructions, some 18,000 tokens, far under the
 * 100k other brains are tidied at, but past what a 32k window holds once its tools and a reply are counted. */
function longChat(home: Home): void {
  for (const role of ["user", "assistant", "user", "assistant"] as const) home.conversations.add({ conversation: "chat:juniper", orb: "juniper", role, content: "word ".repeat(3200) });
}

test("a chat is tidied before it outgrows the coder's window, its tools and a reply counted", async (t) => {
  const { home, model } = await coderHome(t, [{ chunks: ["Done."] }], { prefixCache: true, contextTokens: LOCAL_CONTEXT_TOKENS });
  longChat(home);
  home.inbox.send("juniper", "chat:juniper", "and now?");
  await home.inbox.idle();
  assert.equal(model.summaries, 1, "a part summarised, though the chat is far under 100k");
  assert.equal(home.conversations.list("chat:juniper").find((m) => m.role === "assistant" && m.content === "Done.")?.content, "Done.");
});

test("CONTROL: the same chat on a brain with no window is left whole", async (t) => {
  const { home, model } = await coderHome(t, [{ chunks: ["Done."] }], { prefixCache: true });
  longChat(home);
  home.inbox.send("juniper", "chat:juniper", "and now?");
  await home.inbox.idle();
  assert.equal(model.summaries, 0);
});

/** A home on `dataDir` whose only brain is a local coder at the fake model, with two orbs, Pip spoken to last. */
async function officeWithCoder(t: TestContext, warm: boolean) {
  const model = await fakeModel(t, [{ chunks: ["x"] }, { chunks: ["y"] }]);
  const clock = new FakeClock(new Date("2026-10-18T09:49").getTime());
  const home = Home.open({ dataDir: tempDir(t), protect: [], spendCapUsd: null, clock, warm, agent: { passWaitMs: 20 } });
  t.after(() => home.close());
  home.brains.setLocal({ baseUrl: model.url, model: "qwen3-orbz" });
  home.inbox.addOrb("juniper", "Juniper", "general", {}, "Junior");
  home.inbox.addOrb("pip", "Pip", "general", {}, "Junior");
  home.conversations.add({ conversation: "chat:juniper", orb: "juniper", role: "user", content: "hello Juniper" });
  await clock.advance(60_000);
  home.conversations.add({ conversation: "chat:pip", orb: "pip", role: "user", content: "hello Pip" });
  home.start();
  return { home, model };
}

test("a home with warm on reads every orb's chat into its local coder at the start, the one last spoken to first", async (t) => {
  const { model } = await officeWithCoder(t, true);
  await until("both warm-ups", () => model.agent.length === 2);
  const names = (model.agent as Msg[][]).map((m) => /You are (\w+)/.exec(String(m[0]!.content))?.[1]);
  assert.deepEqual(names, ["Pip", "Juniper"]);
  assert.deepEqual(model.bodies.map((b) => b.max_tokens), [1, 1]);
});

test("CONTROL: a home with warm off never warms", async (t) => {
  const { model } = await officeWithCoder(t, false);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(model.agent.length, 0);
});
