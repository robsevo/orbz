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
