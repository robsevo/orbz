// The desk's cases (PLAN 5.42): desk/casebook.ts and the investigation's tools (desk/trace-tools.ts) on the stand-in
// chain's bundled launch (test/fakes/solana.ts, worked out by hand there): a case opened on a coin, its launch, who holds
// it, its deployer's money followed to an exchange, its patterns and leans; a second coin by the same hands seen as
// them; findings kept only on the case's own evidence. Controls are planted in tools/home_mutants.py.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ToolContext } from "../src/agent/tools.ts";
import { FakeClock } from "../src/clock.ts";
import { openDb } from "../src/db.ts";
import { EventLog } from "../src/events.ts";
import { Casebook, MAX_COINS } from "../src/desk/casebook.ts";
import { YOU } from "../src/desk/desk.ts";
import { traceTools, type Sleuth } from "../src/desk/trace-tools.ts";
import { Trail } from "../src/desk/trail.ts";
import { patternsOf } from "../src/desk/trace.ts";
import { bundledLaunch, LAUNCH_AT, SOLANA_RPC, StandInChain, W } from "./fakes/solana.ts";
import { serve } from "../src/api.ts";
import { startingGroups } from "../src/agent/groups.ts";
import { standingContext } from "../src/agent/standing.ts";
import { publicDex } from "../src/desk/dex.ts";
import { agentHome } from "./helpers.ts";
import { standInDexFetch } from "./fakes/dex.ts";

const COIN = `solana:${W.MINT}`;
const COIN2 = `solana:${W.MINT2}`;

function bench(t: { after: (f: () => void) => void }, prices: Record<string, number | null> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "orbs-cases-"));
  const db = openDb(dir);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const clock = new FakeClock(LAUNCH_AT + 3_600_000);
  const events = new EventLog(db, clock);
  const book = new Casebook(db, events, () => clock.now());
  const chain = new StandInChain();
  bundledLaunch(chain);
  const price = { ...{ [COIN]: 0.001, [COIN2]: 0.002 }, ...prices };
  const sleuth: Sleuth = {
    trail: () => new Trail({ fetch: chain.fetch, rpcs: [SOLANA_RPC], spacingMs: 0, sleep: async () => undefined }),
    labels: () => {
      const ls = book.labels();
      return { names: new Map(ls.map((l) => [l.address, l.label])), exits: new Set(ls.filter((l) => l.exit).map((l) => l.address)) };
    },
    priceOf: async (k) => ({ price: price[k] ?? null, label: k === COIN ? "BUNDL" : k === COIN2 ? "AGAIN" : null }),
  };
  const tools = new Map(traceTools({ book, sleuth, nameOf: (x) => x }).map((x) => [x.name, x]));
  const ctx = { orb: "ivy", conversation: "chat:ivy", workspace: dir } as unknown as ToolContext;
  const use = async (name: string, a: Record<string, unknown>): Promise<string> => {
    const r = await tools.get(name)!.run!(a, ctx);
    if (r.isError) throw new Error(r.content);
    return r.content;
  };
  return { book, chain, use, tools, ctx, events, price };
}

test("the tools are the on-chain job's and its head's, and read the chain as outside words", () => {
  const { tools } = bench({ after: () => undefined });
  assert.deepEqual([...tools.keys()], ["open_case", "trace_launch", "trace_holders", "trace_wallet", "case_patterns", "case_finding", "label_wallet", "close_case"]);
  for (const t of tools.values()) assert.equal(t.group?.id, "trace");
  for (const n of ["open_case", "trace_launch", "trace_holders", "trace_wallet", "case_patterns"]) assert.equal(tools.get(n)!.untrusted, "feed", n);
});

test("a case on a bundled launch: its first hands, who funded them, who holds it, its deployer's money to an exchange, its patterns", async (t) => {
  const { book, use, chain, events } = bench(t);
  const opened = await use("open_case", { coins: [COIN], question: "Is this launch clean?" });
  assert.match(opened, /^Case 1 \("BUNDL"\) opened on BUNDL at \$0\.001000/);
  assert.equal(book.get(1)!.coins[0]!.priceAtOpen, 0.001);
  assert.equal(events.ofType("desk.case_opened").length, 1);

  const launch = await use("trace_launch", { case: 1, coin: COIN });
  assert.match(launch, /Its first hands \(its launch's slot and the 2 after\): 4 wallets, 4 buys, 25% of the supply for 2\.280 SOL; 3 bought in the launch's own slot; the deployer's own buy 5\.0%/);
  assert.match(launch, /The deployer's first money in: 1\.000 SOL from .* at 2026-10-12 11:00, the minute it was born \(signature mom-dev\); that wallet's own: 3\.000 SOL from .* at 2026-10-12 09:00\./);
  assert.match(launch, /New wallets: 3 of the 4 first hands were born within a day before they bought/, "DEV, B1 and B2; B3 is weeks old");
  assert.match(launch, /First hands funded from one place: /);
  assert.ok(!chain.calls.includes("getTokenLargestAccounts"));
  let c = book.get(1)!;
  const coin = c.coins[0]!;
  assert.equal(coin.launch?.deployer, W.DEV);
  const group = c.graph.nodes.filter((n) => n.roles.includes("first")).map((n) => n.address).sort();
  assert.deepEqual(group, [W.B1, W.B2, W.B3].sort(), "the deployer is the deployer, not a first hand");
  assert.ok(c.graph.edges.some((e) => e.from === W.MOM && e.to === W.DEV && e.sigs.includes("mom-dev")), "the funding is on the graph, with its signature");
  assert.ok(!c.graph.nodes.find((n) => n.address === W.CEX)?.roles.includes("busy"), "CEX funded one wallet read so far: never checked, it groups no strangers");

  const holders = await use("trace_holders", { case: 1, coin: COIN });
  assert.match(holders, /its pools hold 67%/);
  assert.match(holders, /Holders funded from one place: .*'s 3 hold 3\.0%/, "B3 funded H1 and H2: 20M + 5M + 5M");
  assert.match(holders, /\(its deployer\)/);
  assert.ok(book.get(1)!.graph.nodes.find((n) => n.address === W.CEX)?.roles.includes("busy"), "CEX funded B3 and B4: checked, and busy");

  const dev = await use("trace_wallet", { case: 1, wallet: W.DEV, coin: COIN });
  assert.match(dev, /bought 50,000,000, sold 40,000,000 \(as read\): it is the deployer/);
  await use("trace_wallet", { case: 1, wallet: W.MULE, coin: COIN });
  for (const w of [W.B1, W.B2]) await use("trace_wallet", { case: 1, wallet: w, coin: COIN });
  c = book.get(1)!;
  assert.equal(c.coins[0]!.facts?.devSoldShare, 0.8);

  const pats = await use("case_patterns", { case: 1 });
  assert.match(pats, /BUNDL: bundled \(.*\); devHeavy .*; fresh .*; devSold .*; soldTogether .*; cashOut /);
  assert.match(pats, /wary: 4 wallets took 25% of the supply in the launch's first 3 slots/);
  assert.match(pats, /timing: its deployer has already sold 80% of what it bought/);
  assert.match(pats, /No record yet/);
  c = book.get(1)!;
  assert.deepEqual(patternsOf(c.coins[0]!.facts!), ["bundled", "devHeavy", "fresh", "devSold", "soldTogether", "cashOut"], "kept on the case");
});

test("findings: an orb's kept only on what the case read; yours as you say them; a case closes with its write-up", async (t) => {
  const { book, use } = bench(t);
  await use("open_case", { coins: [COIN], question: "Who is behind it?" });
  await use("trace_launch", { case: 1, coin: COIN });
  await assert.rejects(use("case_finding", { case: 1, words: "MOM funded the deployer", evidence: ["made-up-signature"], weight: "strong" }), /not in this case: made-up-signature/);
  await assert.rejects(use("case_finding", { case: 1, words: "MOM funded the deployer", evidence: [], weight: "strong" }), /needs its evidence/);
  assert.equal(await use("case_finding", { case: 1, words: "MOM funded the deployer and two of its first hands", evidence: ["mom-dev", W.MOM!], weight: "strong" }), "Kept as finding 1 (strong).");
  const yours = book.find(1, YOU, "the same team as last week's rug, I think", [], "hunch");
  assert.equal(yours.by, YOU);
  await assert.rejects(use("close_case", { case: 1, summary: " ", play: "" }), /closes with its write-up/);
  const closed = await use("close_case", { case: 1, summary: "MOM funded DEV, B1 and B2 within the hour...", play: "Avoid: 25% bought at the floor." });
  assert.equal(closed, "Case 1 closed with 2 findings.");
  assert.ok(book.get(1)!.closedAt);
  await assert.rejects(use("open_case", { coins: Array.from({ length: MAX_COINS + 1 }, (_, i) => `solana:${W.MINT!.slice(0, -2)}${String(i).padStart(2, "0")}`), question: "too many" }), /1 to 10 coins|not a coin|items/);
  await assert.rejects(use("trace_launch", { case: 1, coin: "base:0x1111111111111111111111111111111111111111" }), /not in case 1/);
  await assert.rejects(use("open_case", { coins: ["base:0x1111111111111111111111111111111111111111"], question: "an EVM coin" }), /only Solana's coins are traced yet/);
});

test("a second coin by the same hands: seen before, the wallets to follow, and the record of the first case's patterns", async (t) => {
  const { use, price } = bench(t);
  await use("open_case", { coins: [COIN], question: "first" });
  await use("trace_launch", { case: 1, coin: COIN });
  await use("case_patterns", { case: 1 });
  price[COIN] = 0.0002; // it fell 80% since the case opened
  await use("open_case", { coins: [COIN2], question: "second" });
  const l2 = await use("trace_launch", { case: 2, coin: COIN2 });
  assert.match(l2, /The deployer's first money in: 1\.000 SOL from /);
  const p = await use("case_patterns", { case: 2 });
  assert.match(p, /seenBefore/);
  assert.match(p, / was funder in 1 other coin: solana:/, "MOM funded both deployers");
  assert.match(p, / was first in 1 other coin: solana:/, "B1 was among both coins' first hands");
  assert.match(p, /follow: .* was among the first hands of 2 coins the desk has looked into/);
  assert.match(p, /The record \(1 earlier coins, price now against price at the case's opening\): bundled 1 coins, median -80%, 1 down/);
});

test("a wallet labelled a way out: money reaching it is out, and the wallets it funded are strangers", async (t) => {
  const { book, use } = bench(t);
  await use("open_case", { coins: [COIN], question: "?" });
  assert.match(await use("label_wallet", { address: W.MOM, label: "an exchange's hot wallet", exit: true }), /"an exchange's hot wallet", a way out, for every case/);
  const launch = await use("trace_launch", { case: 1, coin: COIN });
  assert.match(launch, /from an exchange's hot wallet/, "a label read in place of the address");
  assert.match(launch, /No two of the first hands share a funder/, "MOM, now an exchange, funded strangers");
  assert.equal(book.labels()[0]!.by, "ivy");
  await assert.rejects(use("label_wallet", { address: "not-an-address", label: "x", exit: false }), /not a Solana address/);
  const n = book.notice("deployers funded within the hour before launch", YOU);
  assert.match(await use("case_patterns", { case: 1 }), /What the person has noticed before; check this case for each: "deployers funded within the hour before launch"/);
  book.forget(n.id);
  assert.deepEqual(book.noticed(), []);
});

test("the on-chain job and the desk's head start with the investigation's tools; a dealer loads them only when its work needs them", () => {
  assert.ok(startingGroups({ family: "desk", specialty: "onchain", session: false }).has("trace"));
  assert.ok(startingGroups({ family: "desk", specialty: "deskhead", session: false }).has("trace"));
  assert.ok(!startingGroups({ family: "desk", specialty: "dealer", session: false }).has("trace"));
});

test("at the door: a case opened on coins and the orb sent to work it; your findings, labels and what you notice; what is not a case refused", async (t) => {
  const chain = new StandInChain();
  bundledLaunch(chain);
  const { home } = await agentHome(t, [], { clock: new FakeClock(LAUNCH_AT), desk: { fetch: chain.fetch, dex: publicDex({ fetch: standInDexFetch() }) } });
  home.inbox.addOrb("ivy", "Ivy", "onchain");
  assert.ok(home.sleuth().trail() instanceof Trail);
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const call = async (method: string, path: string, b?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${path}`, { method, headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, ...(b !== undefined && { body: JSON.stringify(b) }) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  const opened = await call("POST", "/desk/cases", { orb: "ivy", coins: [COIN, COIN, COIN2], question: "Same team?" });
  assert.equal(opened.status, 200);
  const c = opened.json.case as { id: number; coins: { key: string }[]; orb: string };
  assert.deepEqual([c.id, c.coins.map((k) => k.key), c.orb], [1, [COIN, COIN2], "ivy"], "a coin named twice is one coin");
  const told = opened.json.item as { conversation: string; text: string };
  assert.equal(told.conversation, "chat:ivy");
  assert.match(told.text, /^Investigate case 1: .*solana:.* My question: Same team\? Read each coin's launch \(trace_launch\)/);
  assert.equal(home.events.ofType("desk.sent").at(-1)?.orb, "ivy", "it walks to the war room's screen");
  const list = await call("GET", "/desk/cases");
  assert.deepEqual((list.json.cases as { id: number; coins: string[] }[]).map((x) => [x.id, x.coins.length]), [[1, 2]]);
  assert.equal(((await call("GET", "/desk/cases/1")).json.case as { question: string }).question, "Same team?");
  assert.equal((await call("GET", "/desk/cases/9")).status, 404);
  const mine = await call("POST", "/desk/cases/1/findings", { words: "the same deployer's funder, I bet", weight: "hunch" });
  assert.equal((mine.json.finding as { by: string }).by, YOU, "yours, no evidence asked");
  assert.equal((await call("POST", "/desk/labels", { address: W.CEX, label: "Big Exchange hot wallet", exit: true })).status, 200);
  assert.equal(home.cases.labels()[0]!.exit, true);
  assert.equal((await call("POST", "/desk/labels", { address: "0xnope", label: "x" })).status, 400);
  const n = await call("POST", "/desk/noticed", { words: "devs that fund from a fresh wallet an hour before" });
  assert.equal((n.json.noticed as { by: string }).by, YOU);
  assert.deepEqual((await call("DELETE", `/desk/noticed/${(n.json.noticed as { id: number }).id}`)).json.noticed, []);
  // refused: an EVM coin, too many coins, no such orb, a finding with no words
  assert.equal((await call("POST", "/desk/cases", { orb: "ivy", coins: ["base:0x1111111111111111111111111111111111111111"] })).status, 400);
  assert.equal((await call("POST", "/desk/cases", { orb: "ivy", coins: Array.from({ length: 11 }, () => COIN) })).status, 400);
  assert.equal((await call("POST", "/desk/cases", { orb: "nobody", coins: [COIN] })).status, 404);
  assert.equal((await call("POST", "/desk/cases/1/findings", { words: "  " })).status, 400);
});

test("the investigator's method comes with its tools: ZachXBT's way, no person named, every idea tested on paper first; not to a chime-in, nor to a run without them", () => {
  const turn = (kinds: string[], chime = false) => standingContext({ orbName: "Ivy", brainDir: "/nonexistent-orbs-brain", workspace: "/tmp", specialty: "onchain", kinds: new Set(kinds), ...(chime && { team: { session: 1, title: "Coins", tab: "brainstorm" as const, with: ["Ivy", "Ada"], role: "chime" as const } }) });
  assert.match(turn(["desk", "trace"]), /## How you investigate\n[\s\S]*ZachXBT[\s\S]*trace_launch[\s\S]*name no person[\s\S]*test on paper first[\s\S]*close_case/);
  assert.doesNotMatch(turn(["desk"]), /How you investigate/, "control: without the tools, no method");
  assert.doesNotMatch(turn(["desk", "trace"], true), /How you investigate/, "control: a chime-in is a line or three");
});
