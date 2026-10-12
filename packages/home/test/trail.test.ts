// Reading a trail on Solana's chain (PLAN 5.42): desk/trail.ts on the stand-in RPC (test/fakes/solana.ts), whose
// bundled launch is worked out by hand there. Controls are planted in tools/home_mutants.py (the fee counted as a
// transfer, a pool taken for a buyer, a busy wallet's first money looked for, the holders' bytes read at the wrong place).
import assert from "node:assert/strict";
import { test } from "node:test";
import { changesOf, movesOf, tradesOf, Trail, toBase58 } from "../src/desk/trail.ts";
import { firstHands } from "../src/desk/trace.ts";
import { addr, bundledLaunch, LAUNCH_AT, PUMP, SOLANA_RPC, StandInChain, W } from "./fakes/solana.ts";

const reader = (c: StandInChain, budget = 200): Trail => new Trail({ fetch: c.fetch, rpcs: [SOLANA_RPC], spacingMs: 0, budget, sleep: async () => undefined });
const chain = (): StandInChain => {
  const c = new StandInChain();
  bundledLaunch(c);
  return c;
};

test("base58: an address from its 32 bytes, leading zero bytes as 1s", () => {
  assert.equal(toBase58(new Uint8Array(32)), "1".repeat(32));
  assert.equal(toBase58(Uint8Array.from([0, 0, 1])), "112");
  assert.equal(toBase58(Uint8Array.from([255])), "5Q");
  assert.match(addr("anyone"), /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
});

test("a transaction's transfers, read off balances: the fee is not one, a token account's rent is not its owner's, wrapped SOL is SOL", () => {
  const c = new StandInChain();
  c.mint(W.MINT!, 1_000_000_000);
  c.mint("So11111111111111111111111111111111111111112", 1_000_000, 9);
  c.write({ sig: "swap", slot: 7, at: LAUNCH_AT, signers: [W.B1!], fee: 5000, sol: { [W.B1!]: -0.4, [W.CURVE!]: 0.4 }, tokens: [{ owner: W.B1!, mint: W.MINT!, delta: 1000 }, { owner: W.CURVE!, mint: W.MINT!, delta: -1000, pre: 5000 }, { owner: W.B2!, mint: "So11111111111111111111111111111111111111112", delta: -0.25, pre: 1 }, { owner: W.H1!, mint: "So11111111111111111111111111111111111111112", delta: 0.25 }] });
  const tx = c.txs[0]!.tx;
  const ch = changesOf(tx);
  assert.equal(ch.get(W.B1!)?.get("SOL"), -0.4, "the fee given back to its payer");
  assert.equal(ch.get(W.B2!)?.get("SOL"), -0.25, "wrapped SOL counted as SOL");
  assert.ok(![...ch.keys()].some((k) => k.startsWith("ta:")), "a token account is no one's wallet");
  const moves = movesOf(tx, "swap").map((m) => `${m.from === W.B1 ? "B1" : m.from === W.CURVE ? "CURVE" : "B2"}>${m.to === W.CURVE ? "CURVE" : m.to === W.B1 ? "B1" : "H1"} ${m.asset === "SOL" ? "SOL" : "MINT"} ${m.amount}`).sort();
  assert.deepEqual(moves, ["B1>CURVE SOL 0.4", "B2>H1 SOL 0.25", "CURVE>B1 MINT 1000"].sort());
  assert.deepEqual(tradesOf(tx, "swap", W.MINT!).buys.map((b) => [b.wallet === W.B1, b.tokens, b.sol]), [[true, 1000, 0.4]], "the signer bought; the pool never signs");
  assert.deepEqual(tradesOf(tx, "swap", W.MINT!).sells, [], "nor sold: its coin went out, but a pool is no seller");
});

test("a coin's launch: its deployer, its pool, its first hands, a failed transaction left out", async () => {
  const c = chain();
  const t = reader(c);
  const l = await t.launch(`solana:${W.MINT}`, W.MINT!, { pages: 3 });
  assert.equal(l.deployer, W.DEV, "the payer of its creation, not the mint that also signed");
  assert.equal(l.pool, W.CURVE, "the largest receiver of the coin that did not sign");
  assert.equal(l.slot, 1000);
  assert.equal(l.at, LAUNCH_AT);
  assert.equal(l.supply, 1_000_000_000);
  assert.ok(l.reachedStart);
  const f = firstHands(l, 2);
  assert.deepEqual(new Set(f.wallets), new Set([W.DEV, W.B1, W.B2, W.B3]), "LATE bought in slot 1003, past them");
  assert.equal(f.share, 0.25);
  assert.equal(f.deployerShare, 0.05);
  assert.equal(f.inLaunchSlot, 3);
  assert.ok(!l.buys.some((b) => b.wallet === W.B4), "the failed transaction read for nothing");
  assert.ok(Math.abs(l.buys.find((b) => b.wallet === W.DEV)!.sol - 1.5) < 1e-9, "the SOL the deployer spent, its fee given back");
});

test("a launch past what a read takes: not reached, no deployer guessed, its oldest transaction never read", async () => {
  const c = new StandInChain();
  c.mint(W.MINT!, 1_000_000_000);
  c.busy.add(W.MINT!); // a thousand signatures every page
  const l = await reader(c).launch(`solana:${W.MINT}`, W.MINT!, { pages: 2 });
  assert.deepEqual([l.reachedStart, l.deployer, l.pool, l.buys.length, l.txs], [false, "", null, 0, 2000]);
  assert.ok(!c.calls.includes("getTransaction"), "the oldest read is not its creation: nothing read from it");
});

test("who holds it: every account of the mint, summed by owner, a program's account a pool", async () => {
  const c = chain();
  const h = await reader(c).holders(W.MINT!, { top: 10 });
  assert.equal(h.accounts, 8, "DEV's two accounts are two accounts");
  const by = new Map(h.holdings.map((x) => [x.owner, x]));
  assert.equal(by.get(W.DEV!)?.tokens, 10_000_000, "its two accounts summed");
  assert.deepEqual([by.get(W.CURVE!)?.pool, by.get(W.B4!)?.pool], [true, false]);
  assert.equal(h.holdings[0]!.owner, W.CURVE, "the largest first");
  assert.equal(by.get(W.H1!)?.tokens, 5_000_000);
  assert.ok(c.calls.includes("getProgramAccounts") && !c.calls.includes("getTokenLargestAccounts"), "the accounts by their program, never the call the public RPC refuses");
});

test("a wallet's first money in and when it was born; a busy wallet's not looked for; a 429 waited out once", async () => {
  const c = chain();
  const t = reader(c);
  c.throttle.add("getSignaturesForAddress");
  const dev = await t.funding(W.DEV!);
  assert.deepEqual([dev.funder, dev.sol, dev.sig, dev.born, dev.busy], [W.MOM, 1, "mom-dev", LAUNCH_AT - 3_600_000, false]);
  const late = await t.funding(W.LATE!);
  assert.equal(late.funder, null, "its first transaction spent SOL: no first money in to find");
  const cex = await t.funding(W.CEX!);
  assert.deepEqual([cex.busy, cex.funder, cex.born], [true, null, null]);
  assert.equal(await t.busy(W.CEX!), true);
  assert.equal(await t.busy(W.MULE!), false);
  const fl = await t.flows(W.DEV!, { mint: W.MINT! });
  assert.deepEqual(fl.sells.map((s) => [s.sig, s.tokens]), [["dev-sell", 40_000_000]]);
  assert.ok(fl.moves.some((m) => m.sig === "dev-mule" && m.to === W.MULE && m.amount === 3));
});

test("a read's budget: spent, and the next call refused in words", async () => {
  const c = chain();
  const t = reader(c, 2);
  await t.funding(W.DEV!);
  await assert.rejects(t.funding(W.B1!), /budget for this read is spent \(2 calls\)/);
  assert.equal(c.calls.length, 2);
  assert.equal(PUMP.length > 30, true);
});

test("a transaction of a newer version: asked again as the chain says, and read", async () => {
  const c = chain();
  c.versions.set("mom-dev", 1);
  c.versions.set("b1-buy", 2);
  const t = reader(c);
  assert.equal((await t.funding(W.DEV!)).funder, W.MOM, "version 1, read at once");
  const l = await t.launch(`solana:${W.MINT}`, W.MINT!, { pages: 3 });
  assert.ok(l.buys.some((b) => b.wallet === W.B1), "version 2: refused, asked again with 2, read");
  assert.equal(c.calls.filter((m) => m === "getTransaction").length, (await Promise.resolve(c.calls)).filter((m) => m === "getTransaction").length);
});

test("a long history whose next page the chain will not give: read as far as it goes, the wallet busy, never an error", async () => {
  const c = chain();
  c.busy.add(W.H1!);
  c.lost.add(`busy-${W.H1!.slice(0, 6)}--999`); // the first page's last signature
  const f = await reader(c).funding(W.H1!);
  assert.deepEqual([f.busy, f.funder], [true, null]);
  const g = await reader(c).funding(W.H2!);
  assert.equal(g.funder, W.B3, "the next wallet reads as before");
});
