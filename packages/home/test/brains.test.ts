// PLAN 1.11_t, the brain order end to end: ChatGPT, then one Gemini key, then the local coder,
// against stand-ins for each (a fake Gemini that speaks the OpenAI protocol at its own root, a
// fake local coder, the ChatGPT fake). A limit or an absence at each step moves to the next, in
// order, and says so; a rested brain is first again; with none answering, three passes and then
// the one error naming each; the Gemini key is checked before it is kept, and never reaches a
// file the home writes, the event log, a trace or the door.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { serve } from "../src/api.ts";
import { pickGeminiModel } from "../src/brain/brains.ts";
import { MemoryStore } from "../src/chatgpt/store.ts";
import { browse, fakeChatGPT } from "./fakes/chatgpt.ts";
import { fakeModel, type Turn } from "./fakes/model.ts";
import { agentHome } from "./helpers.ts";

const KEY = "test-gemini-key-not-real-0123456789"; // not shaped like a Google key: the secret scan (kit S.4) would rightly flag one

/** A home with no preset key: the order is ChatGPT, Gemini, the local coder. */
async function home(t: TestContext, o: { gemini?: Turn[]; local?: Turn[] | "down"; chatgpt?: boolean } = {}) {
  const gemini = await fakeModel(t, o.gemini ?? []);
  gemini.models = ["models/gemini-3.5-flash", "models/gemini-3.8-flash", "models/gemini-3.8-flash-lite", "models/gemini-3-flash-preview", "models/gemma-4-31b-it"];
  const local = o.local === "down" ? null : await fakeModel(t, o.local ?? []);
  const store = new MemoryStore();
  const openai = o.chatgpt ? await fakeChatGPT(t) : null;
  const h = await agentHome(t, [], {
    brain: undefined,
    brains: { store, geminiBase: gemini.url },
    ...(openai && { chatgpt: { store: new MemoryStore(), issuer: openai.issuer, apiBase: openai.apiBase } }),
  });
  if (o.gemini) await h.home.brains.setGemini(KEY);
  // a local coder that is down: an address where nothing listens
  if (o.local !== undefined) h.home.brains.setLocal({ baseUrl: local ? local.url : "http://127.0.0.1:9/v1", model: "coder" });
  return { ...h, gemini, local, store, openai };
}

const said = (h: Awaited<ReturnType<typeof home>>) => h.home.conversations.list("chat:1").filter((m) => m.role !== "user").map((m) => `${m.role}: ${m.content}`);

test("Gemini answers when it is the first brain there is; the newest plain flash is the one picked", async (t) => {
  const h = await home(t, { gemini: [{ chunks: ["from gemini"] }] });
  assert.equal(h.home.brains.status().gemini?.model, "gemini-3.8-flash", "not the lite, not the preview");
  h.home.inbox.send("juniper", "chat:1", "hello");
  await h.home.inbox.idle();
  assert.deepEqual(said(h), ["assistant: from gemini"]);
  assert.equal(h.gemini.keys.at(-1), `Bearer ${KEY}`, "asked with the key");
  assert.equal(pickGeminiModel(["models/gemma-4-31b-it"]), "gemini-3.5-flash", "control: no flash listed, the fallback");
});

test("Gemini at its daily limit steps aside, says so, and the local coder answers", async (t) => {
  const exhausted = { status: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric: GenerateRequestsPerDayPerProjectPerModel-FreeTier" } } };
  const h = await home(t, { gemini: [exhausted], local: [{ chunks: ["from the local coder"] }] });
  h.home.inbox.send("juniper", "chat:1", "hello");
  await h.home.inbox.idle();
  const rows = said(h);
  assert.match(rows[0]!, /^notice: Gemini: its daily limit is reached; answering with the local coder until about \d\d:\d\d\.$/);
  assert.equal(rows[1], "assistant: from the local coder");
  // resting: the next message does not knock on Gemini again
  const asked = h.gemini.agent.length;
  h.local!.script.push({ chunks: ["local again"] });
  h.home.inbox.send("juniper", "chat:1", "and again");
  await h.home.inbox.idle();
  assert.equal(h.gemini.agent.length, asked, "Gemini rests until its limit resets");
  assert.equal(said(h).at(-1), "assistant: local again");
});

test("a rested brain is first again: a short limit (Retry-After) passes, and Gemini answers", async (t) => {
  const h = await home(t, { gemini: [{ status: 429, retryAfter: 1, body: { error: { message: "rate limit" } } }, { chunks: ["gemini is back"] }], local: [{ chunks: ["local meanwhile"] }] });
  h.home.inbox.send("juniper", "chat:1", "one");
  await h.home.inbox.idle();
  assert.equal(said(h).at(-1), "assistant: local meanwhile");
  await new Promise((r) => setTimeout(r, 1100));
  h.home.inbox.send("juniper", "chat:1", "two");
  await h.home.inbox.idle();
  assert.equal(said(h).at(-1), "assistant: gemini is back");
});

test("ChatGPT at its limit hands over to Gemini by name", async (t) => {
  const h = await home(t, { chatgpt: true, gemini: [{ chunks: ["gemini here"] }] });
  const { url, done } = await h.home.chatgpt.begin();
  await browse(url);
  await done;
  h.openai!.script = [{ status: 429, code: "subscription_sharing_usage_limit_exceeded" }];
  h.home.inbox.send("juniper", "chat:1", "hello");
  await h.home.inbox.idle();
  const rows = said(h);
  assert.match(rows[0]!, /^notice: Usage limit reached\./, "Manage usage first, as always");
  assert.equal(rows[1], "notice: Answering with Gemini until then.");
  assert.equal(rows[2], "assistant: gemini here");
});

test("none answering: three passes, then one error that names each brain, why, and what would fix it", async (t) => {
  const down = { status: 503 };
  const h = await home(t, { gemini: [down, down, down, down], local: "down" });
  h.home.inbox.send("juniper", "chat:1", "hello");
  await h.home.inbox.idle();
  const last = said(h).at(-1)!;
  assert.match(last, /^notice: No brain could answer after 3 tries\./);
  assert.match(last, /ChatGPT: not set up \(sign in with ChatGPT/, "what to do about the missing one");
  assert.match(last, /Gemini: it failed \(503\)/);
  assert.match(last, /The local coder: nothing answered/);
  assert.equal(h.gemini.agent.length, 3, "Gemini was asked once a pass, three passes");
  assert.equal(said(h).some((r) => r.startsWith("assistant:")), false);
  // control: with Gemini answering on a later pass, there is no error
  const h2 = await home(t, { gemini: [down, { chunks: ["second pass"] }], local: "down" });
  h2.home.inbox.send("juniper", "chat:1", "hello");
  await h2.home.inbox.idle();
  assert.equal(said(h2).at(-1), "assistant: second pass");
});

test("the Gemini key: refused keys are never kept; a kept one is in the keychain only, never in a file, the log, a trace or the door", async (t) => {
  const h = await home(t, { gemini: [{ chunks: ["ok"] }] });
  const door = await serve(h.home, { port: 0 });
  t.after(() => door.close());
  const call = (method: string, path: string, body?: unknown) =>
    fetch(`http://127.0.0.1:${door.port}${path}`, { method, headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  // a refused key: 400 with the reason, and the kept key stays the kept key
  h.gemini.modelsStatus = 400;
  const refused = await call("POST", "/brains/gemini", { key: "test-gemini-key-refused-000000000" });
  assert.equal(refused.status, 400);
  assert.match(((await refused.json()) as { error: string }).error, /refused that key/);
  assert.equal(await h.store.get("orbs.gemini"), KEY, "a refused key replaced nothing");
  h.gemini.modelsStatus = undefined;
  const status = await (await call("GET", "/brains")).text();
  assert.ok(!status.includes(KEY) && status.includes("gemini-3.8-flash"), "the door says which model, never the key");
  h.home.inbox.send("juniper", "chat:1", "hello");
  await h.home.inbox.idle();
  // every file the home wrote, and every event, without the key
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
  for (const f of files(h.dataDir)) assert.ok(!readFileSync(f).includes(KEY), `the key is in ${f}`);
  assert.ok(!JSON.stringify(h.home.events.since(0, 100000)).includes(KEY), "the key is in the event log");
  // control: the scan sees the key where it is
  assert.equal(await h.store.get("orbs.gemini"), KEY);
  await call("DELETE", "/brains/gemini");
  assert.equal(await h.store.get("orbs.gemini"), null, "removed means removed");
  assert.equal(h.home.brains.status().gemini, null);
});

test("an AQ. key, the kind AI Studio makes now, is checked and kept like the old kind (owner, 10-03)", async (t) => {
  const h = await home(t);
  const aq = "AQ.test-gemini-auth-key-not-real-0123456789"; // the dot is the new kind's; the rest says it is not real
  assert.deepEqual(await h.home.brains.setGemini(`  ${aq}\n`), { model: "gemini-3.8-flash" });
  assert.equal(await h.store.get("orbs.gemini"), aq, "kept as pasted, trimmed");
  assert.equal(h.gemini.keys.at(-1), `Bearer ${aq}`, "checked as a Bearer, the way Google takes one");
  // control: what is not a key is still turned away before anything is asked
  const asked = h.gemini.keys.length;
  await assert.rejects(h.home.brains.setGemini("my key is AQ.test-gemini-auth-key"), /doesn't look like a Gemini API key \(they start with AIza or AQ\.\)/);
  assert.equal(h.gemini.keys.length, asked, "nothing sent for it");
});
