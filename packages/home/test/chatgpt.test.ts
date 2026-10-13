// PLAN 1.10_t: Continue with ChatGPT, against a stand-in for OpenAI (fakes/chatgpt.ts). PKCE, the
// state and the nonce are checked; an ID token with a bad signature, issuer, audience, nonce or
// expiry is refused and nothing is kept; tokens never appear in the event log, a trace, the
// conversation, a file or a reply from the door; a usage limit says so with Manage usage first and
// the next brain answers; the badge is on a reply only when the plan served it. C.0 is the control:
// the same sign-in, with nothing wrong, connects.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { serve } from "../src/api.ts";
import { MANAGE_USAGE } from "../src/chatgpt/chatgpt.ts";
import { ALOUD } from "../src/agent/standing.ts";
import { FakeClock } from "../src/clock.ts";
import { KeychainStore, MemoryStore } from "../src/chatgpt/store.ts";
import type { Turn } from "./fakes/model.ts";
import { browse, fakeChatGPT, type FakeChatGPT } from "./fakes/chatgpt.ts";
import { agentHome, tempDir } from "./helpers.ts";

async function home(t: TestContext, fallback: Turn[] = [], more: Parameters<typeof agentHome>[2] = {}) {
  const openai = await fakeChatGPT(t);
  const store = new MemoryStore();
  const h = await agentHome(t, fallback, { chatgpt: { store, issuer: openai.issuer, apiBase: openai.apiBase }, ...more });
  return { ...h, openai, store };
}

async function signIn(h: Awaited<ReturnType<typeof home>>) {
  const { url, done } = await h.home.chatgpt.begin();
  const page = await browse(url);
  return { url, page, status: await done.catch((e: Error) => e) };
}

const notices = (h: Awaited<ReturnType<typeof home>>) => h.home.conversations.list("chat:1").filter((m) => m.role === "notice");

test("C.0 CONTROL: a sign-in with nothing wrong connects, and says what it sent", async (t) => {
  const h = await home(t);
  const { url, page, status } = await signIn(h);
  assert.ok(!(status instanceof Error), String(status));
  assert.equal(status.connected, true);
  assert.deepEqual(status.account, { email: "owner@example.com", name: "The Owner" });
  assert.equal(status.sharing, true);
  assert.equal(status.model, "gpt-6", "the plan's listed model; a hidden one is not offered");
  assert.deepEqual(status.models.map((m) => m.slug), ["gpt-6"]);
  assert.match(page.page, /<h1[^>]*>You(&#39;|')re using your ChatGPT plan<\/h1>/);
  const q = new URL(url).searchParams;
  assert.equal(q.get("client_id"), "dynamic_agent_client", "a first sign-in registers the app during the flow");
  assert.equal(q.get("scope"), "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.equal(q.get("resource"), "https://api.openai.com/v1");
  assert.equal(q.get("agent_name_hint"), "Orbz");
  assert.match(q.get("redirect_uri")!, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  assert.ok(q.get("state") && q.get("nonce") && q.get("state") !== q.get("nonce"));
  const host = JSON.parse(readFileSync(join(h.dataDir, "chatgpt-host.json"), "utf8")) as { hostId: string };
  assert.match(host.hostId, /^urn:uuid:[0-9a-f-]{36}$/);
  assert.equal(q.get("ext_agent_host_id"), host.hostId);
  // PKCE: the verifier sent with the code is the one whose hash was the challenge
  const exchange = h.openai.token.find((p) => p.grant_type === "authorization_code")!;
  assert.equal(createHash("sha256").update(exchange.code_verifier!).digest("base64url"), q.get("code_challenge"));
  assert.equal(exchange.client_id, "oaiapp_test_client", "the code is exchanged by the issued client");
  const reg = JSON.parse(readFileSync(join(h.dataDir, "chatgpt-auth.json"), "utf8")) as Record<string, unknown>;
  assert.equal(reg.clientId, "oaiapp_test_client");
  assert.equal(h.store.values.size, 1, "the tokens are in the store");
  assert.equal(statSync(join(h.dataDir, "chatgpt-auth.json")).mode & 0o077, 0, "the registration is the owner's to read");
});

test("a callback with another sign-in's state is refused, and nothing is kept", async (t) => {
  const h = await home(t);
  h.openai.callback = "wrong-state";
  const { page, status } = await signIn(h);
  assert.ok(status instanceof Error);
  assert.match(status.message, /a state this sign-in did not send/);
  assert.equal(page.status, 400);
  assert.equal(h.openai.token.length, 0, "the code was never exchanged");
  assert.equal(h.store.values.size, 0);
  assert.equal((await h.home.chatgpt.status()).connected, false);
  assert.equal(h.home.events.ofType("chatgpt.sign_in_failed").length, 1);
});

test("an ID token with a bad signature, issuer, audience, nonce or expiry is refused, and nothing is kept", async (t) => {
  const h = await home(t);
  const why = {
    "bad-signature": /signature does not verify/,
    "bad-issuer": /issued by https:\/\/not-openai\.example/,
    "bad-audience": /issued for another app/,
    "bad-nonce": /nonce does not match/,
    expired: /has expired/,
    missing: /sent no ID token/,
  } as const;
  for (const [flaw, re] of Object.entries(why)) {
    h.openai.idToken = flaw as keyof typeof why;
    const { status } = await signIn(h);
    assert.ok(status instanceof Error, `${flaw} was accepted`);
    assert.match(status.message, re, flaw);
    assert.equal(h.store.values.size, 0, `${flaw}: no tokens kept`);
    assert.equal((await h.home.chatgpt.status()).connected, false);
  }
  h.openai.idToken = "none";
  assert.ok(!((await signIn(h)).status instanceof Error), "control: the same home signs in once the token is right");
});

test("a server that refuses the code (PKCE, a used code) leaves the home signed out", async (t) => {
  const h = await home(t);
  h.openai.tokenError = "invalid_grant";
  const { status } = await signIn(h);
  assert.ok(status instanceof Error);
  assert.match(status.message, /refused the token request \(HTTP 400, invalid_grant\)/);
  assert.equal(h.store.values.size, 0);
});

test("the plan answers through the Responses API, and only its completed replies carry the badge", async (t) => {
  const h = await home(t, [{ chunks: ["from the router"] }]);
  await signIn(h);
  h.openai.script = [
    { chunks: ["Let me look."], calls: [{ name: "list_files", args: { path: "." } }] },
    { chunks: ["It's ", "empty."] },
  ];
  h.home.inbox.send("juniper", "chat:1", "what's in the folder?");
  await h.home.inbox.idle();
  const replies = h.home.conversations.list("chat:1").filter((m) => m.role === "assistant");
  assert.deepEqual(replies.map((m) => [m.content, m.meta.plan]), [["Let me look.", "chatgpt"], ["It's empty.", "chatgpt"]]);
  assert.equal(h.model.agent.length, 0, "the router was not asked");
  const [first, second] = h.openai.responses;
  assert.equal(first!.body.store, false);
  assert.equal(first!.body.stream, true);
  assert.equal(first!.body.model, "gpt-6");
  assert.match(String(first!.body.instructions), /Juniper/, "the standing context goes as instructions");
  assert.ok((first!.body.tools as { type: string; name: string }[]).some((x) => x.type === "function" && x.name === "list_files"));
  assert.ok(h.openai.secrets.includes(first!.bearer), "with the access token from the sign-in");
  const input = second!.body.input as { type: string; call_id?: string; output?: string }[];
  const call = input.find((i) => i.type === "function_call");
  const out = input.find((i) => i.type === "function_call_output");
  assert.ok(call && out && call.call_id === out.call_id, "the tool call and its result go back as a pair");
  const spent = h.home.events.ofType("brain.spend").map((e) => e.data.cost_usd);
  assert.deepEqual(spent, [0, 0], "the plan pays: nothing counts against the spend cap");
});

for (const how of ["HTTP 429", "response.failed"] as const) {
  test(`a usage limit (${how}) says so with Manage usage first, then the next brain answers without the badge`, async (t) => {
    const h = await home(t, [{ chunks: ["from the router"] }, { chunks: ["router again"] }]);
    await signIn(h);
    h.openai.script = [how === "HTTP 429" ? { status: 429, code: "subscription_sharing_usage_limit_exceeded" } : { failed: "subscription_sharing_usage_limit_exceeded" }];
    h.home.inbox.send("juniper", "chat:1", "hello");
    await h.home.inbox.idle();
    const rows = h.home.conversations.list("chat:1").filter((m) => m.role !== "user");
    assert.equal(rows[0]!.role, "notice");
    assert.equal(rows[0]!.content, "Usage limit reached. Review your plan or this app's limit in ChatGPT settings.");
    assert.deepEqual(rows[0]!.meta.action, { label: "Manage usage", url: MANAGE_USAGE }, "Manage usage is the action, and it comes first");
    assert.match(rows[1]!.content, /^Answering with my other brain until then\./);
    assert.equal(rows[2]!.role, "assistant");
    assert.equal(rows[2]!.content, "from the router");
    assert.equal(rows[2]!.meta.plan, undefined, "the router's reply does not wear the plan's badge");
    assert.equal((await h.home.chatgpt.status()).paused?.why, "usage-limit");
    // paused: the next turn does not knock on the plan again
    const asked = h.openai.responses.length;
    h.home.inbox.send("juniper", "chat:1", "and again");
    await h.home.inbox.idle();
    assert.equal(h.openai.responses.length, asked);
    assert.equal(h.home.conversations.list("chat:1").at(-1)!.content, "router again");
    // control: resumed, the plan answers again, with its badge
    h.home.chatgpt.resume();
    h.openai.script = [{ chunks: ["the plan is back"] }];
    h.home.inbox.send("juniper", "chat:1", "once more");
    await h.home.inbox.idle();
    const last = h.home.conversations.list("chat:1").at(-1)!;
    assert.deepEqual([last.content, last.meta.plan], ["the plan is back", "chatgpt"]);
  });
}

test("a token about to lapse is refreshed before the request, by the issued client", async (t) => {
  const h = await home(t);
  h.openai.expiresIn = 30; // inside the minute's margin
  await signIn(h);
  h.openai.script = [{ chunks: ["fresh"] }];
  h.home.inbox.send("juniper", "chat:1", "hi");
  await h.home.inbox.idle();
  const refreshes = h.openai.token.filter((p) => p.grant_type === "refresh_token");
  assert.ok(refreshes.length >= 1);
  assert.equal(refreshes[0]!.client_id, "oaiapp_test_client");
  assert.notEqual(h.openai.responses[0]!.bearer, h.openai.secrets[0], "not the token that was about to lapse");
  assert.equal(h.home.conversations.list("chat:1").at(-1)!.content, "fresh");
});

test("a refused refresh forgets the tokens, keeps the registration, and the next brain answers", async (t) => {
  const h = await home(t, [{ chunks: ["from the router"] }]);
  h.openai.expiresIn = 30;
  await signIn(h);
  h.openai.refreshError = "invalid_grant";
  h.home.inbox.send("juniper", "chat:1", "hi");
  await h.home.inbox.idle();
  assert.match(notices(h).map((m) => m.content).join("\n"), /The ChatGPT sign-in has lapsed\. Sign in again to use your plan/);
  assert.equal(h.home.conversations.list("chat:1").at(-1)!.content, "from the router");
  assert.equal(h.store.values.size, 0);
  const s = await h.home.chatgpt.status();
  assert.equal(s.connected, false);
  // signing in again reuses the issued client: the same app, not a new registration
  h.openai.refreshError = null;
  const again = await signIn(h);
  assert.equal(new URL(again.url).searchParams.get("client_id"), "oaiapp_test_client");
});

test("a plan that is not allowed for the account (403) is explained, turned off, and never looped through sign-in", async (t) => {
  const h = await home(t, [{ chunks: ["from the router"] }, { chunks: ["router"] }]);
  await signIn(h);
  const authorized = h.openai.authorize.length;
  h.openai.script = [{ status: 403, code: "subscription_sharing_user_not_eligible" }];
  h.home.inbox.send("juniper", "chat:1", "hi");
  await h.home.inbox.idle();
  assert.match(notices(h)[0]!.content, /isn't available for this account, workspace or policy/);
  assert.equal((await h.home.chatgpt.status()).sharing, false);
  h.home.inbox.send("juniper", "chat:1", "again");
  await h.home.inbox.idle();
  assert.equal(h.openai.responses.length, 1, "not asked again");
  assert.equal(h.openai.authorize.length, authorized, "no sign-in was started on its own");
});

test("a reply cut off before response.completed is not an answer", async (t) => {
  const h = await home(t);
  await signIn(h);
  h.openai.script = [{ chunks: ["half a"], cut: true }];
  h.home.inbox.send("juniper", "chat:1", "hi");
  await h.home.inbox.idle();
  const kept = h.home.conversations.list("chat:1").find((m) => m.role === "assistant");
  assert.equal(kept?.meta.error, "chatgpt: the reply ended before it completed");
  assert.equal(kept?.meta.plan, undefined, "no badge on a reply the plan did not complete");
});

test("sign-out revokes and forgets the tokens; the registration stays", async (t) => {
  const h = await home(t);
  await signIn(h);
  await h.home.chatgpt.signOut();
  assert.equal(h.openai.revoked.length, 1);
  assert.ok(h.openai.revoked[0]!.startsWith("rt-"), "the refresh token is what gets revoked");
  assert.equal(h.store.values.size, 0);
  assert.equal((await h.home.chatgpt.status()).connected, false);
  assert.equal(h.home.chatgpt.endpoint(), null);
  assert.equal((JSON.parse(readFileSync(join(h.dataDir, "chatgpt-auth.json"), "utf8")) as { clientId: string }).clientId, "oaiapp_test_client");
});

test("no token, by value, in the event log, a trace, the conversation, a file or a reply from the door", async (t) => {
  const h = await home(t);
  h.openai.expiresIn = 30; // so a refresh hands out a second set
  await signIn(h);
  h.openai.script = [{ chunks: ["Looking."], calls: [{ name: "list_files", args: { path: "." } }] }, { chunks: ["Done."] }];
  h.home.inbox.send("juniper", "chat:1", "look around");
  await h.home.inbox.idle();
  const door = await serve(h.home);
  t.after(() => door.close());
  const get = async (p: string) => (await fetch(`http://127.0.0.1:${door.port}${p}`, { headers: { authorization: `Bearer ${door.token}` } })).text();
  const replies = [await get("/chatgpt"), await get("/events?since=0&limit=1000"), await get("/conversations/chat%3A1/messages")];
  assert.ok(h.openai.secrets.length >= 5, "control: there are tokens to look for (two sign-ins' worth)");
  assert.ok(h.openai.responses.length >= 2 && h.openai.token.some((p) => p.grant_type === "refresh_token"));
  await h.home.close();
  const db = new DatabaseSync(join(h.dataDir, "home.db"));
  t.after(() => db.close());
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
  const dump = tables.map((name) => JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all())).join("\n");
  const files = (function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  })(h.dataDir);
  const everything = [dump, ...replies, ...files.map((f) => readFileSync(f).toString("latin1"))].join("\n");
  assert.ok(dump.includes("chatgpt.connected"), "control: the scan reads the event log");
  for (const s of h.openai.secrets) assert.equal(everything.includes(s), false, `a token was written down: ${s.slice(0, 6)}…`);
});

test("the keychain gets the secret on stdin, never on the command line; a missing Secret Service is not a keychain", async (t) => {
  const dir = tempDir(t);
  const log = join(dir, "argv.log");
  const tool = join(dir, "secret-tool");
  writeFileSync(tool, `#!/bin/sh
echo "$@" >> "${log}"
key="$(echo "$@" | sed 's/.* key //')"
case "$1" in
  store) cat > "${dir}/s.$key" ;;
  lookup) if [ "$key" = "__orbs_probe__" ] && [ -f "${dir}/broken" ]; then echo "Cannot autolaunch D-Bus" >&2; exit 1; fi
          [ -f "${dir}/s.$key" ] && cat "${dir}/s.$key" || exit 1 ;;
  clear) rm -f "${dir}/s.$key" ;;
esac
`);
  chmodSync(tool, 0o755);
  const k = new KeychainStore({ tool, platform: "linux" });
  assert.equal(await k.available(), true, "a lookup that finds nothing is a working keychain");
  await k.set("chatgpt:host", "{\"accessToken\":\"at-SECRET\"}");
  assert.equal(await k.get("chatgpt:host"), "{\"accessToken\":\"at-SECRET\"}");
  await k.delete("chatgpt:host");
  assert.equal(await k.get("chatgpt:host"), null);
  assert.doesNotMatch(readFileSync(log, "utf8"), /SECRET/, "the secret never reached argv");
  assert.match(readFileSync(log, "utf8"), /^store --label=Orbz: ChatGPT sign-in service orbs key chatgpt:host$/m, "control: the log records the calls");
  writeFileSync(join(dir, "broken"), "");
  assert.equal(await k.available(), false, "no Secret Service: the home falls back to a file and says so");
});

// PLAN 5.10_t: what the plan costs (10-06: five orbs on the flagship spent a plan's limit in a quarter of an hour)
const PLAN_MODELS = ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"].map((slug) => ({ slug, display_name: slug, visibility: "list" }));

test("a usage limit sent as an `error` event, its code inside `error`, is a usage limit: said, paused, the next brain answers", async (t) => {
  const h = await home(t, [{ chunks: ["from the router"] }]);
  await signIn(h);
  h.openai.script = [{ error: "subscription_sharing_usage_limit_exceeded" }];
  h.home.inbox.send("juniper", "chat:1", "hello");
  await h.home.inbox.idle();
  const rows = h.home.conversations.list("chat:1").filter((m) => m.role !== "user");
  assert.equal(rows[0]!.content, "Usage limit reached. Review your plan or this app's limit in ChatGPT settings.", "10-06: it came back as \"the stream reported an error\", and nothing paused");
  assert.equal((await h.home.chatgpt.status()).paused?.why, "usage-limit");
  assert.equal(rows.at(-1)!.content, "from the router");
});

test("until you choose, the main model is a middle one, never the first-listed flagship; the light one is the newest Luna", async (t) => {
  const h = await home(t);
  h.openai.models = [...PLAN_MODELS, { slug: "gpt-6-luna", display_name: "GPT-6 Luna", visibility: "list" }];
  await signIn(h);
  assert.equal((await h.home.chatgpt.status()).model, "gpt-5.6-terra");
  assert.equal(h.home.chatgpt.endpoint({ light: true })?.model, "gpt-6-luna");
  assert.equal(h.home.chatgpt.endpoint()?.model, "gpt-5.6-terra");
  h.home.chatgpt.setModel("gpt-6-astra");
  assert.equal(h.home.chatgpt.endpoint()?.model, "gpt-6-astra", "what you choose is yours");
  assert.equal(h.home.chatgpt.endpoint({ light: true })?.model, "gpt-6-luna", "and the helpers stay light");
});

test("at one model's usage limit a lighter one of the plan answers, saying so; the model that met it rests until you resume", async (t) => {
  const h = await home(t, [{ chunks: ["from the router"] }]);
  h.openai.models = PLAN_MODELS;
  await signIn(h);
  h.openai.script = [{ failed: "subscription_sharing_usage_limit_exceeded" }, { chunks: ["from luna"] }, { chunks: ["luna again"] }];
  h.home.inbox.send("juniper", "chat:1", "hello");
  await h.home.inbox.idle();
  assert.deepEqual(h.openai.responses.map((r) => r.body.model), ["gpt-5.6-terra", "gpt-5.6-luna"]);
  const rows = h.home.conversations.list("chat:1").filter((m) => m.role !== "user");
  assert.equal(rows[0]!.content, "Usage limit reached for gpt-5.6-terra on your ChatGPT plan. Answering with gpt-5.6-luna until it resets.");
  assert.deepEqual(rows[0]!.meta.action, { label: "Manage usage", url: MANAGE_USAGE });
  assert.deepEqual([rows[1]!.content, rows[1]!.meta.plan], ["from luna", "chatgpt"], "still the plan");
  assert.equal(h.model.agent.length, 0, "the plan's other model answered: the router was not asked");
  assert.equal((await h.home.chatgpt.status()).paused, null, "the plan is not paused");
  h.home.inbox.send("juniper", "chat:1", "and again");
  await h.home.inbox.idle();
  assert.equal(h.openai.responses.at(-1)!.body.model, "gpt-5.6-luna", "the main model rests: not knocked on again");
  h.home.chatgpt.resume();
  assert.equal(h.home.chatgpt.endpoint()?.model, "gpt-5.6-terra", "resumed: the main model again");
});

test("a server error on the plan (a 520, 10-13): Luna answers the step, saying so; when Luna fails too the error names the status, never \"nothing answered\"", async (t) => {
  const h = await home(t, [{ chunks: ["from the router"] }]);
  h.openai.models = PLAN_MODELS;
  await signIn(h);
  h.openai.script = [{ status: 520 }, { chunks: ["from luna"] }];
  h.home.inbox.send("juniper", "chat:1", "hello");
  await h.home.inbox.idle();
  assert.deepEqual(h.openai.responses.map((r) => r.body.model), ["gpt-5.6-terra", "gpt-5.6-luna"]);
  assert.deepEqual(notices(h).map((m) => m.content), ["ChatGPT: gpt-5.6-terra failed (520); answering with gpt-5.6-luna."]);
  assert.equal(h.home.conversations.list("chat:1").at(-1)!.content, "from luna");
  assert.equal(h.model.agent.length, 0, "the plan still answered: the router was not asked");
  // Luna fails as well: the plan steps aside, by its status, and the next brain answers
  h.openai.script = [{ status: 520 }, { status: 520 }];
  h.home.inbox.send("juniper", "chat:1", "again");
  await h.home.inbox.idle();
  assert.equal(notices(h).at(-1)!.content, "ChatGPT: it failed (520); answering with my other brain.");
  assert.equal(h.home.conversations.list("chat:1").at(-1)!.content, "from the router");
});

test("a chime-in on the plan goes to the light model, thinking little and saying little; a field the plan refuses is dropped and never sent again", async (t) => {
  const h = await home(t, [], { agent: { decide: () => "allow" } });
  h.openai.models = PLAN_MODELS;
  await signIn(h);
  const { forgetRefused } = await import("../src/agent/responses.ts");
  forgetRefused();
  t.after(forgetRefused);
  h.home.inbox.addOrb("hazel", "Hazel", "planning");
  h.home.inbox.addOrb("milo", "Milo", "research");
  h.home.inbox.addOrb("pip", "Pip", "writing");
  h.openai.script = [{ chunks: ["Saturday."], cached: 100 }, { status: 400, code: "subscription_sharing_unsupported_capability", param: "text.verbosity" }, { chunks: ["Book a shelter."] }, { chunks: ["pass"] }];
  const s = h.home.team.create("A party", { brainstorm: ["hazel", "milo", "pip"] });
  h.home.team.say(s.id, "brainstorm", "Plan it");
  for (let i = 0; i < 60 && h.openai.responses.length < 4; i++) {
    await h.home.inbox.idle();
    await new Promise((r) => setTimeout(r, 50));
  }
  await h.home.inbox.idle();
  const [lead, refused, milo, pip] = h.openai.responses.map((r) => r.body);
  assert.equal(lead!.model, "gpt-5.6-terra", "the lead: the main model");
  assert.equal(lead!.reasoning, undefined, "the lead thinks as it will");
  assert.ok((lead!.tools as unknown[]).length > 10);
  assert.equal(refused!.model, "gpt-5.6-luna", "a chime-in: the light model");
  assert.deepEqual([refused!.reasoning, refused!.text, refused!.tools], [{ effort: "low" }, { verbosity: "low" }, undefined]);
  assert.deepEqual([milo!.reasoning, milo!.text], [{ effort: "low" }, undefined], "refused once: sent again without it");
  assert.deepEqual([pip!.reasoning, pip!.text], [{ effort: "low" }, undefined], "and never asked for again");
  const said = h.home.conversations.list(`team:${s.id}:brainstorm`).filter((m) => m.role === "assistant" || m.role === "notice").map((m) => m.content);
  assert.deepEqual(said, ["Saturday.", "Book a shelter.", "Pip passed."]);
  const spend = h.home.events.ofType("brain.spend").map((e) => [e.data.model, e.data.turn, e.data.cached_tokens ?? 0]);
  assert.deepEqual(spend, [["gpt-5.6-terra", "lead", 100], ["gpt-5.6-luna", "chime", 0], ["gpt-5.6-luna", "chime", 0]], "each call's model, kind and cache, measured");
});

test("on the plan, what changes from run to run comes after the conversation: an hour on, said aloud, the XP table moved, the same instructions and the first request the start of the second; a cache key a conversation, dropped for good when refused", async (t) => {
  const clock = new FakeClock(new Date("2026-10-05T14:07").getTime());
  const h = await home(t, [], { clock });
  await signIn(h);
  const { forgetRefused } = await import("../src/agent/responses.ts");
  forgetRefused();
  t.after(forgetRefused);
  h.openai.script = [
    { chunks: ["Morning."] },
    { chunks: ["Sure."] },
    { status: 400, code: "subscription_sharing_unsupported_capability", param: "prompt_cache_key" },
    { chunks: ["Done."] },
    { chunks: ["Again."] },
  ];
  h.home.inbox.send("juniper", "chat:1", "hello");
  await h.home.inbox.idle();
  await clock.advance(60 * 60_000);
  h.home.events.append("xp.earned", { amount: 10, reason: "a run you approved", source: 1, at: clock.now() }, { orb: "juniper" });
  h.home.inbox.send("juniper", "chat:1", "and later?", { said: true });
  await h.home.inbox.idle();
  const [first, second] = h.openai.responses.map((r) => r.body as { instructions: string; input: { type: string; role?: string; content?: string }[]; prompt_cache_key?: string });
  assert.equal(second!.instructions, first!.instructions, "the same instructions an hour on, said aloud, the table moved");
  assert.doesNotMatch(first!.instructions, /today is|XP;|with \d+ XP|will hear your answer/, "nothing in them that moves from run to run");
  assert.match(first!.instructions, /What you want most: to be the best orb/, "the wish stays in them");
  assert.deepEqual(second!.input.slice(0, first!.input.length - 1), first!.input.slice(0, -1), "the first request, but for its note, is the start of the second");
  const note = (b: typeof first) => b!.input.at(-1)!;
  assert.equal(note(first).role, "developer", "the note: last, the developer's");
  assert.match(note(first).content!, /^It is .*14:07 where the person is[\s\S]*today is 2026-10-05[\s\S]*You are the only orb in the office so far, with 0 XP\.$/);
  assert.match(note(second).content!, /^It is .*15:07 where the person is[\s\S]*with 10 XP\.[\s\S]*will hear your answer read aloud/, "an hour on, its place moved, said aloud");
  assert.match(first!.prompt_cache_key ?? "", /^[0-9a-f]{32}$/, "a cache key, a hash: no name in it");
  assert.equal(second!.prompt_cache_key, first!.prompt_cache_key, "one key for the conversation");
  // another conversation, another key; the plan refuses it: sent again without, and never asked for again
  h.home.inbox.send("juniper", "chat:2", "a new chat");
  await h.home.inbox.idle();
  const [, , refused, resent] = h.openai.responses.map((r) => r.body);
  assert.ok(refused!.prompt_cache_key && refused!.prompt_cache_key !== first!.prompt_cache_key, "another conversation, another key");
  assert.equal(resent!.prompt_cache_key, undefined, "refused: sent again without it");
  assert.equal(h.home.conversations.list("chat:2").find((m) => m.role === "assistant")?.content, "Done.", "the turn is answered all the same");
  h.home.inbox.send("juniper", "chat:1", "once more");
  await h.home.inbox.idle();
  assert.equal(h.openai.responses.at(-1)!.body.prompt_cache_key, undefined, "and never asked for again");
});

test("CONTROL: another brain still reads the note at the end of its instructions, nothing after the conversation", async (t) => {
  const clock = new FakeClock(new Date("2026-10-05T14:07").getTime());
  const h = await home(t, [{ chunks: ["Morning."] }], { clock });
  h.home.inbox.send("juniper", "chat:1", "hello", { said: true });
  await h.home.inbox.idle();
  const msgs = h.model.agent[0]! as { role: string; content?: string }[];
  assert.deepEqual(msgs.map((m) => m.role), ["system", "user"], "the router: the instructions, then the conversation");
  const system = String(msgs[0]!.content);
  assert.match(system, /What you want most[\s\S]*It is .*14:07 where the person is[\s\S]*with 0 XP\./);
  assert.ok(system.endsWith(ALOUD), "the note at the end of its instructions, as before");
  assert.equal(h.model.bodies[0]!.prompt_cache_key, undefined, "no cache key off the plan");
});
