// PLAN 4.2_t (connectors, no middleman), with a stand-in MCP server (fixtures/mcp-server.ts):
//   - A connector's tools are an orb's: each asks first (your yes runs it, and "always" is offered);
//     one that sends, pays, deletes or changes your calendar always asks, with no "always".
//   - Its secret is kept in the keychain: never in connectors.json, the log or a trace; it reaches
//     the server.
//   - It fails open: a server that never shakes hands, or is not there, is reported and left out,
//     and the rest go on; a call past its deadline says which server it was.
//   - Through the door: listed, added, removed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { MemoryStore } from "../src/chatgpt/store.ts";
import { shellFloor, toolFloor } from "../src/rules/floor.ts";
import { agentHome } from "./helpers.ts";

const SERVER = new URL("./fixtures/mcp-server.ts", import.meta.url).pathname;
const stand = (extra: string[] = []) => ({ command: process.execPath, args: [SERVER, ...extra] });
const TOKEN = "tok-not-real-1234";

test("the floor reads a connector's tool by its name: sending, paying, deleting, changing the calendar", () => {
  const cats = (n: string) => toolFloor(n).map((h) => h.category);
  assert.deepEqual(cats("send_email"), ["messaging"]);
  assert.deepEqual(cats("createPayment"), ["money"]);
  assert.deepEqual(cats("delete_file"), ["deleting"]);
  assert.deepEqual(cats("create_event"), ["calendar"]);
  assert.deepEqual(cats("list_events"), [], "reading the calendar changes nothing");
  assert.deepEqual(cats("extract_text"), []);
  assert.deepEqual(cats("list_api_keys"), ["passwords"]);
  // investing and crypto (owner, 10-02): a trade, a swap, a withdrawal always ask; reading never does
  assert.deepEqual(cats("place_trade"), ["money"]);
  assert.deepEqual(cats("swapTokens"), ["money", "passwords"], "a swap is money; and a token is a secret's word too, so it asks for both");
  assert.deepEqual(cats("withdraw_funds"), ["money"]);
  assert.deepEqual(cats("get_portfolio"), [], "reading a portfolio changes nothing");
  assert.deepEqual(cats("list_transactions"), [], "nor reading what moved");
  const shell = (c: string) => shellFloor(c, [], "/home/x").map((h) => h.category);
  assert.deepEqual(shell("curl -X POST https://api.binance.com/api/v3/order -d side=SELL"), ["money"], "an order on an exchange");
  assert.deepEqual(shell(`cast send 0xabc --value 1ether # eth_sendRawTransaction`), ["money"], "a wallet sending");
  assert.deepEqual(shell("curl https://api.coingecko.com/api/v3/simple/price?ids=bitcoin"), [], "a price is only read");
  // a bet (owner, 10-07: the sports analyst reads the odds): placing one always asks; the odds are only read
  assert.deepEqual(cats("place_bet"), ["money"]);
  assert.deepEqual(cats("get_odds"), [], "reading the odds changes nothing");
  assert.deepEqual(shell("curl -X POST https://sportsbook.draftkings.com/api/bets -d wager=10"), ["money"], "a bet at a sportsbook");
  assert.deepEqual(shell("curl https://api.the-odds-api.com/v4/sports/soccer_epl/odds"), [], "the odds, only read");
});

test("a connector's tools are an orb's: each asks first; sending always asks; what comes back runs", { timeout: 60_000 }, async (t) => {
  const { home, model } = await agentHome(t, [
    { calls: [{ name: "mcp__stand-in__echo", args: { text: "hello" } }] },
    { chunks: ["It said hello back."] },
    { calls: [{ name: "mcp__stand-in__send_email", args: { to: "bob@example.com", body: "hi" } }] },
    { chunks: ["Not sending, then."] },
  ], { kit: true, connectors: { store: new MemoryStore() } }); // the kit fences what comes back, so the orb sees it
  const added = await home.connectors.add("stand-in", stand());
  assert.deepEqual([added.state, added.tools.length], ["ready", 6], added.why ?? "");
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "say hello through the stand-in");
  await home.inbox.idle();
  const echo = home.conversations.openCard("chat:juniper")!;
  assert.match(echo.title, /Juniper wants to use stand-in's echo with \{"text":"hello"\}/);
  assert.equal(echo.meta.mayAlways, true, "an ordinary call: 'always' may be offered");
  home.answerCard(echo.id, "approve");
  await home.inbox.idle();
  assert.equal(home.conversations.list("chat:juniper").find((m) => m.role === "tool")?.content.includes("echo: hello"), true, "it ran, and what came back is the orb's");
  assert.ok(model.agent.length >= 2);

  home.inbox.enqueue("juniper", "chat:juniper", "chat", "email bob");
  await home.inbox.idle();
  const send = home.conversations.openCard("chat:juniper")!;
  assert.deepEqual([send.meta.mayAlways, (send.meta.floor as { category: string }[]).map((f) => f.category)], [false, ["messaging"]], "sending: always asks, never 'always'");
  home.answerCard(send.id, "deny");
  await home.inbox.idle();
});

test("its secret is kept in the keychain, never in the file, the log or a trace; it reaches the server", { timeout: 60_000 }, async (t) => {
  const store = new MemoryStore();
  const { home, dataDir } = await agentHome(t, [], { connectors: { store } });
  const added = await home.connectors.add("stand-in", { ...stand(), env: { STAND_IN_TOKEN: { secret: "token" } } }, { token: TOKEN });
  assert.equal(added.state, "ready", added.why ?? "");
  assert.equal(await store.get("connector:stand-in:token"), TOKEN);
  const file = readFileSync(join(dataDir, "connectors.json"), "utf8");
  assert.ok(!file.includes(TOKEN) && file.includes('"secret": "token"'), "the file names it, never holds it");
  assert.deepEqual(await home.connectors.call("stand-in", "whoami", {}), { content: "signed in: the token reached me", isError: false });
  const log = JSON.stringify(home.events.since(0, 100_000));
  assert.ok(!log.includes(TOKEN), "nor the log");
  await home.connectors.remove("stand-in");
  assert.equal(await store.get("connector:stand-in:token"), null, "removed: its secret goes with it");
  await assert.rejects(home.connectors.add("other", { ...stand(), env: { X: { secret: "missing" } } }), /its secret "missing" was not given/);
});

test("it fails open: a server that never answers, or is not there, is left out with why; the rest go on; a slow call names its server", { timeout: 60_000 }, async (t) => {
  const { home } = await agentHome(t, [], { connectors: { store: new MemoryStore(), handshakeMs: 800, callMs: 600 } });
  await home.connectors.add("stand-in", stand());
  await home.connectors.add("slow", stand(["--hang-start"]));
  await home.connectors.add("missing", { command: "/nonexistent/orbs-no-such-server" });
  const states = Object.fromEntries(home.connectors.states().map((s) => [s.name, [s.state, s.why]]));
  assert.equal(states["stand-in"]![0], "ready");
  assert.deepEqual([states.slow![0], /gave no answer in 1 s/.test(String(states.slow![1]))], ["failed", true]);
  assert.equal(states.missing![0], "failed");
  assert.deepEqual(home.connectors.tools().map((x) => x.server).filter((v, i, a) => a.indexOf(v) === i), ["stand-in"], "only the one that is up offers tools");
  const r = await home.connectors.call("stand-in", "hang", {});
  assert.equal(r.isError, true);
  assert.match(r.content, /^The stand-in connector failed: /);
  assert.equal(home.events.ofType("connector.failed").length, 2);
});

test("through the door: listed, added with its secret, removed", { timeout: 60_000 }, async (t) => {
  const { home } = await agentHome(t, [], { connectors: { store: new MemoryStore() } });
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const call = async (method: string, path: string, b?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${path}`, { method, headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, ...(b !== undefined && { body: JSON.stringify(b) }) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  assert.deepEqual((await call("GET", "/connectors")).json.connectors, []);
  const made = await call("POST", "/connectors", { name: "stand-in", spec: { ...stand(), env: { STAND_IN_TOKEN: { secret: "token" } } }, secrets: { token: TOKEN } });
  assert.equal((made.json.connector as { state: string }).state, "ready");
  const listed = JSON.stringify((await call("GET", "/connectors")).json);
  assert.ok(listed.includes('"secret":"token"') && !listed.includes(TOKEN), "listed by name, the secret never sent back");
  assert.equal((await call("POST", "/connectors", { name: "Bad Name", spec: stand() })).status, 400);
  assert.deepEqual((await call("POST", "/connectors/stand-in/remove")).json.connectors, []);
  assert.equal((await call("POST", "/connectors/nobody/remove")).status, 404);
});

test("what a connector gives back is from outside: after reading it, acting outward in that turn needs your fresh yes", { timeout: 60_000 }, async (t) => {
  const { home } = await agentHome(t, [
    { calls: [{ name: "mcp__stand-in__list_events", args: {} }] },
    { calls: [{ name: "shell", args: { command: "echo planning" } }] },
    { chunks: ["done"] },
  ], { kit: true, connectors: { store: new MemoryStore() }, agent: { decide: () => "allow" } }); // your rules allow every call; the kit fences and switches
  await home.connectors.add("stand-in", stand());
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "check my calendar, then plan");
  await home.inbox.idle();
  assert.ok(home.conversations.list("chat:juniper").some((m) => m.role === "tool" && m.content.includes("Dentist")), "the connector's answer came back, allowed");
  const card = home.conversations.openCard("chat:juniper");
  assert.ok(card, "the shell after it waits for you: the turn read something from outside");
  assert.equal(card!.tool, "shell");
});
