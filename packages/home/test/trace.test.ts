// On-chain investigations (PLAN 5.42): desk/trace.ts, pure, on made wallets and transfers whose answers are worked out
// below. Controls are planted in tools/home_mutants.py (an exchange's withdrawals merging strangers, the first hands
// counted past their slots, a finding kept on evidence the case never read, a pattern's record taken from the cases
// without it).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cited, clustersOf, concentration, emptyGraph, firstHands, freshOf, leansOf, patternsOf, repeats, roundTrips, soldTogether,
  trackRecord, waysOut, withMoves, withNode, type Funding, type Launch, type Move,
} from "../src/desk/trace.ts";

const H = 3_600_000;
const T = Date.parse("2026-10-12T12:00:00Z");
const move = (sig: string, from: string, to: string, amount: number, o: { asset?: string; at?: number; slot?: number } = {}): Move =>
  ({ sig, from, to, amount, asset: o.asset ?? "SOL", at: o.at ?? T, slot: o.slot ?? 1 });
const fund = (wallet: string, funder: string | null, o: Partial<Funding> = {}): Funding =>
  ({ wallet, funder, at: T - H, sig: `f-${wallet}`, sol: 1, born: T - H, busy: false, ...o });

test("the money as a graph: a pair's moves of an asset summed on one edge, a transfer read twice counted once", () => {
  const g = emptyGraph();
  withMoves(g, [move("s1", "A", "B", 2, { at: T }), move("s2", "A", "B", 3, { at: T + H }), move("s3", "A", "B", 5, { asset: "MINT" }), move("s1", "A", "B", 2), move("s4", "B", "B", 9), move("s5", "A", "C", 0)]);
  assert.equal(g.edges.length, 2, "SOL and the coin apart; a wallet to itself and nothing moved left out");
  const sol = g.edges.find((e) => e.asset === "SOL")!;
  assert.deepEqual([sol.amount, sol.count, sol.first, sol.last, sol.sigs], [5, 2, T, T + H, ["s1", "s2"]], "s1 read twice: once");
  assert.deepEqual(g.nodes.map((n) => n.address).sort(), ["A", "B"]);
  withNode(g, "A", { role: "deployer", coin: "c1", label: "the deployer" });
  withNode(g, "A", { role: "deployer", coin: "c1" });
  assert.deepEqual(g.nodes.find((n) => n.address === "A"), { address: "A", roles: ["deployer"], label: "the deployer", coins: ["c1"] });
  assert.deepEqual(cited(g, ["s2", "A", "s9", "Z"]), { known: ["s2", "A"], unknown: ["s9", "Z"] }, "a finding cites only what the case read");
});

const launch = (buys: Launch["buys"], o: Partial<Launch> = {}): Launch =>
  ({ coin: "solana:MINT", deployer: "DEV", sig: "create", slot: 100, at: T, supply: 1_000_000, buys, pool: "CURVE", reachedStart: true, ...o });

test("a coin's first hands: the buys in the launch's slot and the two after it, the deployer's share apart", () => {
  const l = launch([
    { wallet: "DEV", sig: "create", slot: 100, at: T, tokens: 60_000, sol: 2 },
    { wallet: "B1", sig: "b1", slot: 100, at: T, tokens: 50_000, sol: 1.5 },
    { wallet: "B2", sig: "b2", slot: 101, at: T + 400, tokens: 40_000, sol: 1.2 },
    { wallet: "B1", sig: "b1b", slot: 102, at: T + 800, tokens: 10_000, sol: 0.3 },
    { wallet: "LATE", sig: "late", slot: 103, at: T + 1200, tokens: 90_000, sol: 3 },
    { wallet: "CURVE", sig: "odd", slot: 100, at: T, tokens: 5, sol: 0 },
  ]);
  const f = firstHands(l, 2);
  assert.deepEqual(f.wallets, ["DEV", "B1", "B2"], "slot 103 is past the first three; the curve is not a buyer");
  assert.equal(f.buys, 4);
  assert.equal(f.tokens, 160_000);
  assert.equal(f.share, 0.16);
  assert.equal(f.deployerShare, 0.06);
  assert.equal(f.inLaunchSlot, 2, "the deployer and B1 bought in the launch's own slot");
  assert.ok(Math.abs(f.sol - 5) < 1e-9);
  assert.deepEqual(firstHands(l, 0).wallets, ["DEV", "B1"]);
});

test("wallets grouped by who funded them, up the chain; an exchange's withdrawals never make strangers one group", () => {
  const fundings = [
    fund("B1", "MOM"), fund("B2", "MOM"), fund("MOM", "GRAN"), fund("B3", "GRAN"),
    fund("C1", "CEX"), fund("C2", "CEX"), fund("CEX", null, { busy: true, born: null }),
    fund("D1", "BRIDGE"), fund("D2", "BRIDGE"),
    fund("LONE", "SOMEONE"),
  ];
  const c = clustersOf(fundings, new Set(["BRIDGE"]));
  assert.deepEqual(c, [{ root: "GRAN", wallets: ["B1", "B2", "B3", "MOM"] }], "C1, C2 through a busy wallet and D1, D2 through a labelled one stay apart; LONE alone is no group");
  const all = clustersOf(fundings);
  assert.deepEqual(all.map((x) => x.wallets), [["B1", "B2", "B3", "MOM"], ["D1", "D2"]], "unlabelled, the bridge's two are one group");
});

test("fresh wallets: born within a day before their first buy", () => {
  const buys = [{ wallet: "NEW", sig: "a", slot: 1, at: T, tokens: 1, sol: 1 }, { wallet: "NEW", sig: "b", slot: 2, at: T + 5 * H, tokens: 1, sol: 1 }, { wallet: "OLD", sig: "c", slot: 1, at: T, tokens: 1, sol: 1 }, { wallet: "ODD", sig: "d", slot: 1, at: T, tokens: 1, sol: 1 }];
  const fundings = [fund("NEW", "X", { born: T - 2 * H }), fund("OLD", "X", { born: T - 30 * 24 * H }), fund("ODD", "X", { born: T + H })];
  assert.deepEqual(freshOf(fundings, buys), ["NEW"], "born two hours before its first buy; ODD born after its buy is a misread, not fresh");
  assert.deepEqual(freshOf(fundings, buys, 1), []);
});

test("who holds it: the top ten and each group's share, its pools apart", () => {
  const holders = [
    { owner: "CURVE", tokens: 600_000, pool: true },
    { owner: "B1", tokens: 80_000, pool: false }, { owner: "B2", tokens: 70_000, pool: false }, { owner: "MOM", tokens: 10_000, pool: false },
    ...Array.from({ length: 12 }, (_, i) => ({ owner: `H${i}`, tokens: 20_000 - i * 1000, pool: false })),
    { owner: "EMPTY", tokens: 0, pool: false },
  ];
  const c = concentration(holders, 1_000_000, [{ root: "GRAN", wallets: ["B1", "B2", "B3", "MOM"] }, { root: "X", wallets: ["H0", "NOBODY"] }]);
  assert.equal(c.holders, 15, "the pool and an empty account are not holders");
  assert.equal(c.pools, 0.6);
  // the ten largest wallets: 80k, 70k, then H0..H7 (20k..13k: 132k)
  assert.ok(Math.abs(c.top10 - (80_000 + 70_000 + 132_000) / 1_000_000) < 1e-12);
  assert.deepEqual(c.groups, [{ root: "GRAN", wallets: ["B1", "B2", "MOM"], share: 0.16 }], "a group needs two holders in it: X has one");
});

test("a group that sold within a minute; money round in a circle; the ways out to a busy wallet", () => {
  const clusters = [{ root: "GRAN", wallets: ["B1", "B2", "B3"] }, { root: "Y", wallets: ["Y1", "Y2"] }];
  const sells = [
    { wallet: "B1", at: T, sig: "s1", tokens: 1 }, { wallet: "B2", at: T + 30_000, sig: "s2", tokens: 1 }, { wallet: "B3", at: T + 50_000, sig: "s3", tokens: 1 },
    { wallet: "Y1", at: T, sig: "y1", tokens: 1 }, { wallet: "Y2", at: T + 5 * 60_000, sig: "y2", tokens: 1 },
    { wallet: "B1", at: T + H, sig: "s4", tokens: 1 },
  ];
  assert.deepEqual(soldTogether(sells, clusters), [{ root: "GRAN", wallets: ["B1", "B2", "B3"], from: T, to: T + 50_000, sigs: ["s1", "s2", "s3"] }], "Y's two sold five minutes apart");

  const g = withMoves(emptyGraph(), [move("a", "W1", "W2", 10), move("b", "W2", "W1", 9.5), move("c", "W3", "W4", 10), move("d", "W4", "W3", 2)]);
  assert.deepEqual(roundTrips(g), [{ a: "W1", b: "W2", asset: "SOL", there: 10, back: 9.5 }], "10 out, 2 back is not a circle");
  withMoves(g, [move("e", "W5", "POOL", 4, { asset: "MINT" }), move("f", "POOL", "W5", 4, { asset: "MINT" })]);
  withNode(g, "POOL", { role: "pool" });
  assert.equal(roundTrips(g).length, 1, "a coin bought from a pool and sold back to it is a trade, not a circle");

  const h = withMoves(emptyGraph(), [move("1", "DEV", "M1", 5), move("2", "M1", "M2", 5), move("3", "M2", "CEX", 5), move("4", "DEV", "BR", 1), move("5", "M1", "DEV", 1)]);
  withNode(h, "CEX", { role: "busy" });
  withNode(h, "BR", { role: "exit" });
  assert.deepEqual(waysOut(h, "DEV"), [["DEV", "BR"], ["DEV", "M1", "M2", "CEX"]], "the shortest first; back to DEV is no way out");
  assert.deepEqual(waysOut(h, "DEV", 2), [["DEV", "BR"]], "three hops is past two");
  const k = withMoves(emptyGraph(), [move("p1", "BOT1", "CURVE", 1), move("p2", "CURVE", "BOT2", 1)]);
  withNode(k, "CURVE", { role: "pool" });
  withNode(k, "BOT2", { role: "busy" });
  assert.deepEqual(waysOut(k, "BOT1"), [], "a trade through a pool is no one's way out");
});

test("the same hands in other coins: deployers, funders and first hands, never an exchange or a pool", () => {
  const r = repeats([
    { coin: "c1", address: "DEV", role: "deployer" }, { coin: "c2", address: "DEV", role: "first" }, { coin: "c3", address: "DEV", role: "funder" },
    { coin: "c1", address: "SNIPER", role: "first" }, { coin: "c2", address: "SNIPER", role: "first" },
    { coin: "c1", address: "CEX", role: "busy" }, { coin: "c2", address: "CEX", role: "busy" },
    { coin: "c1", address: "ONCE", role: "first" }, { coin: "c1", address: "ONCE", role: "holder" },
  ]);
  assert.deepEqual(r, [{ address: "DEV", coins: ["c1", "c2", "c3"], roles: ["deployer", "first", "funder"] }, { address: "SNIPER", coins: ["c1", "c2"], roles: ["first"] }]);
});

test("the patterns, each by its threshold, and how each moved prices in the cases before", () => {
  const first = { slots: 2, wallets: ["DEV", "B1", "B2", "B3"], buys: 4, tokens: 250_000, share: 0.25, sol: 9, deployerShare: 0.06, inLaunchSlot: 3 };
  const facts = { coin: "c", first, fresh: 2, concentration: { holders: 30, top10: 0.4, pools: 0.5, groups: [{ root: "GRAN", wallets: ["B1", "B2"], share: 0.12 }] }, devSoldShare: 0.5, soldTogether: 1, roundTrips: 0, cashOut: 1, seenBefore: 2 };
  assert.deepEqual(patternsOf(facts), ["bundled", "devHeavy", "oneFunder", "fresh", "devSold", "soldTogether", "cashOut", "seenBefore"]);
  assert.deepEqual(patternsOf({ coin: "c", first: { ...first, share: 0.199, deployerShare: 0.0499 }, fresh: 1, concentration: { holders: 30, top10: 0.2, pools: 0.5, groups: [{ root: "G", wallets: ["a", "b"], share: 0.05 }] }, devSoldShare: 0.49 }), [], "each just under its line");
  assert.deepEqual(patternsOf({ coin: "c", first: { ...first, share: 0.05, deployerShare: 0 }, fresh: 0, concentration: { holders: 300, top10: 0.2, pools: 0.5, groups: [] } }), ["spread"]);

  const track = trackRecord([
    { patterns: ["bundled"], change: -0.8 }, { patterns: ["bundled", "fresh"], change: -0.5 }, { patterns: ["bundled"], change: 0.2 },
    { patterns: [], change: 0.4 }, { patterns: ["spread"], change: 0.1 }, { patterns: ["bundled"], change: null },
  ]);
  const b = track.find((t) => t.pattern === "bundled")!;
  assert.deepEqual([b.n, b.median, b.fell, b.without.n, b.without.median], [3, -0.5, 2, 2, 0.25], "an unpriced case counts in neither");
  assert.ok(!track.some((t) => t.pattern === "devSold"), "a pattern no case found has no record");

  const leans = leansOf(facts, { track: [{ ...b }, { pattern: "devSold", n: 2, median: -0.9, fell: 2, without: { n: 0, median: null } }], followers: [{ address: "SNIPERxyz", coins: ["c1", "c2"] }] });
  assert.deepEqual(leans.map((l) => l.kind), ["wary", "wary", "wary", "timing", "timing", "timing", "follow", "edge"], "devSold's record of two is too few to say");
  assert.match(leans[0]!.words, /4 wallets took 25% of the supply in the launch's first 3 slots/);
  assert.match(leans.at(-1)!.words, /in 3 earlier cases where .* the price moved -50% \(median\)/);
  assert.match(leans[5]!.words, /reached 1 busy wallet \(an exchange, a bridge, a bot\)/);
});
