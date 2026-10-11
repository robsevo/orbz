// PLAN 5.24_t-5.27_t, the desk on stand-ins (a made-up market, stand-in DEX routers and chains):
//   - A strategy run live on paper starts from now (the bars before only warm its indicators) and trades exactly what
//     the backtest over the same bars trades; a stopped run's position is sold at the price now.
//   - A paper trade that made money after both fees is XP, graded by the market, in the desk's area, by how hard it was
//     to win; a losing one earns nothing, and what an orb says about its trades earns nothing.
//   - Addresses are read by their own chain's rules (built here: a checksum, a 32-byte key, base58check, bech32) and a
//     typo is refused; holdings come from the chains and are valued at the market's prices; nothing asks to sign.
//   - A real swap: an orb's only asks; it is built for a wallet only after your yes, at a fresh price no worse than the
//     one you approved past your slippage, with the token's allowance first when it needs one; sent once; followed to
//     its end on the chain; the limits, the off switch and an hour's expiry kept. Your own Swap needs no second yes.
//   - Through the door, the desk's snapshot and a swap's whole life; the keepsakes kept.
//   - The market (5.23): bars kept in order, asked for again after half a minute (the forming bar moves) or once a bar
//     has closed; a broken bar dropped; a failing feed rests, twice
//     as long each time up to five minutes, asking nothing meanwhile, then comes back; a price older than a minute is
//     stale, and a stale price is no price.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { FakeClock } from "../src/clock.ts";
import { base58, checksummed, readAddress, toUnits, fromUnits } from "../src/desk/chains.ts";
import { backtest, type Strategy } from "../src/desk/strategy.ts";
import { Market } from "../src/desk/market.ts";
import { tradeTier, XP } from "../src/gym/xp.ts";
import { radarOf } from "../src/gym/specialty.ts";
import { agentHome } from "./helpers.ts";
import { made, standInChains, standInMarket, standInRouters } from "./fakes/market.ts";

const MIN = 60_000;
const START = Date.parse("2026-10-10T12:00:00Z");

async function deskHome(t: Parameters<typeof agentHome>[0], o: { price?: (s: string) => number | null; outPer?: () => number; chains?: Parameters<typeof standInChains>[0] } = {}) {
  const clock = new FakeClock(START);
  const routers = standInRouters({ outPer: o.outPer ?? (() => 2_500) });
  const chains = standInChains(o.chains ?? {});
  const { home } = await agentHome(t, [], { clock, desk: { source: standInMarket(() => clock.now(), { price: o.price }), routers, fetch: chains } });
  home.inbox.addOrb("tess", "Tess", "dealer");
  return { home, clock, routers, chains };
}

const crossing: Strategy = {
  name: "Quick wave", symbol: "ETH", timeframe: "1m", sizePct: 50, stopLossPct: 2, takeProfitPct: 3,
  entry: { all: [{ left: { kind: "ema", period: 3 }, op: "crosses_above", right: { kind: "ema", period: 9 } }] },
  exit: { all: [{ left: { kind: "ema", period: 3 }, op: "crosses_below", right: { kind: "ema", period: 9 } }] },
};

test("a strategy runs live on paper from now, making the trades the backtest over the same bars makes; stopped, it sells at the price now", async (t) => {
  const { home, clock } = await deskHome(t);
  const s = home.desk.save(crossing, null);
  const book = await home.desk.run(s.id, "tess");
  const startBar = book.startedAt;
  for (let i = 0; i < 240; i++) {
    clock.suspend(MIN);
    await home.desk.due();
  }
  const live = home.events.ofType("desk.trade_closed").filter((e) => e.data.book === book.id).map((e) => [e.data.entryPx, e.data.exitPx, e.data.why]);
  // the same bars, as the market gives them, stepped by the backtest: only the trades opened after the run began
  const bars = await home.market.closed("ETH", "1m", 500);
  const bt = backtest(crossing, bars).trades.filter((x) => x.entryT > startBar && x.why !== "end").map((x) => [x.entryPx, x.exitPx, x.why]);
  assert.ok(live.length >= 3, `enough trades to mean something (${live.length})`);
  // the same trades; their prices to the ninth digit (the backtest's cash before the run began rounds differently)
  const same = (a: unknown[], b: unknown[]): boolean => a[2] === b[2] && [0, 1].every((k) => Math.abs(Number(a[k]) - Number(b[k])) <= 1e-9 * Number(b[k]));
  assert.equal(live.length, Math.min(live.length, bt.length));
  assert.ok(live.every((x, k) => same(x, bt[k]!)), `live paper and the backtest agree, trade for trade: ${JSON.stringify(live.slice(0, 3))} vs ${JSON.stringify(bt.slice(0, 3))}`);
  assert.ok(live.every((x) => Number(x[0]) > 1_500 && Number(x[0]) < 4_000), "at ETH's made-up level");
  assert.ok(home.events.ofType("desk.trade_closed").every((e) => Number(e.data.held) > 0 && Number(e.data.entryPx) > 0));
  // nothing before the run began was traded
  assert.ok(home.events.ofType("desk.fill").filter((e) => e.data.book === book.id).every((e) => e.at >= startBar));
  // stopped: an open position sold at the price now (a closed trade like any)
  const st = home.desk.book(book.id)!;
  const stopped = await home.desk.stopAndSell(book.id);
  assert.equal(stopped.state, "stopped");
  if (st.qty > 0) assert.equal(home.events.ofType("desk.trade_closed").at(-1)!.data.why, "stopped");
  assert.equal(home.desk.book(book.id)!.qty, 0);
});

test("a winning paper trade is XP graded by the market, by how hard it was; a loss and a claim earn nothing", async (t) => {
  let px = 2_500;
  const { home, clock } = await deskHome(t, { price: () => px });
  await home.desk.paperTrade("tess", "ETH", "buy", 1_000);
  clock.suspend(2 * MIN);
  px = 2_600; // up 4%: past both fees and both slips
  const won = await home.desk.paperTrade("tess", "ETH", "sell", 2_000);
  assert.ok((won.trade!.pnl as number) > 0);
  const xp = home.events.ofType("xp.earned").filter((e) => e.orb === "tess");
  assert.equal(xp.length, 1);
  assert.deepEqual([xp[0]!.data.amount, xp[0]!.data.tier, xp[0]!.data.area], [XP.trade.expert, "expert", "desk"], "held two minutes: a quick win is the hardest");
  assert.match(String(xp[0]!.data.reason), /^an expert trade won \(ETH, \+\d+\.\d\d% after its costs\)$/);
  assert.equal(radarOf(home.events, "tess").desk.xp, XP.trade.expert, "the radar puts it in the desk's area");
  // a loss: nothing
  await home.desk.paperTrade("tess", "ETH", "buy", 1_000);
  px = 2_550;
  await home.desk.paperTrade("tess", "ETH", "sell", 2_000);
  assert.equal(home.events.ofType("xp.earned").filter((e) => e.orb === "tess").length, 1, "a losing trade earns nothing");
  // a round trip at one price loses its fees: nothing either
  await home.desk.paperTrade("tess", "ETH", "buy", 500);
  await home.desk.paperTrade("tess", "ETH", "sell", 2_000);
  assert.equal(home.events.ofType("xp.earned").filter((e) => e.orb === "tess").length, 1, "flipping at one price pays its fees, not XP");
  // tiers by bars and by holding
  assert.deepEqual(["1m", "5m", "15m", "1h", "4h", "1d"].map((timeframe) => tradeTier({ timeframe })), ["expert", "hard", "hard", "standard", "easy", "easy"]);
  assert.deepEqual([60_000, 30 * MIN, 5 * 60 * MIN, 2 * 86_400_000].map((held) => tradeTier({ held })), ["expert", "hard", "standard", "easy"]);
});

// ── addresses, built here by each chain's own rules ───────────────────────────────────────────────
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const toB58 = (b: Uint8Array): string => {
  let n = BigInt(`0x${Buffer.from(b).toString("hex") || "0"}`);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const x of b) {
    if (x !== 0) break;
    out = `1${out}`;
  }
  return out;
};
const sha = (b: Uint8Array): Buffer => createHash("sha256").update(b).digest();
function bech32(hrp: string, version: number, program: Uint8Array): string {
  const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const words: number[] = [version];
  let acc = 0, bits = 0;
  for (const v of program) {
    acc = (acc << 8) | v;
    bits += 8;
    while (bits >= 5) words.push((acc >> (bits -= 5)) & 31);
  }
  if (bits) words.push((acc << (5 - bits)) & 31);
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  const poly = (vs: number[]): number => {
    let chk = 1;
    for (const v of vs) {
      const top = chk >>> 25;
      chk = ((chk & 0x1ffffff) << 5) ^ v;
      for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i]!;
    }
    return chk;
  };
  const expand = [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  const mod = poly([...expand, ...words, 0, 0, 0, 0, 0, 0]) ^ (version === 0 ? 1 : 0x2bc830a3);
  const check = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...check].map((w) => CHARSET[w]).join("")}`;
}
const bytes = (n: number, seed: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (seed * 31 + i * 17) % 256);

test("the top 10 majors by market cap (owner, 10-11: \"have top 10 cryptos clickable on the top\"): CoinGecko's order, no stablecoin or coin the market has not; kept an hour; its last order, or the majors' own, when it cannot say", async () => {
  let now = Date.parse("2026-10-11T12:00:00Z");
  let ranks: () => string[] = () => ["BTC", "ETH", "USDT", "BNB", "XRP", "USDC", "SOL", "TRX", "FIGR_HELOC", "ZEC", "HYPE", "DOGE", "USDS", "XMR", "LINK", "WBT", "ADA"];
  const src = standInMarket(() => now, { ranks: () => ranks() });
  const market = new Market(src, () => now);
  const ten = ["BTC", "ETH", "BNB", "XRP", "SOL", "TRX", "ZEC", "HYPE", "DOGE", "XMR"];
  assert.deepEqual(await market.top(10), ten, "stablecoins and coins with no market here left out, the order kept");
  ranks = () => ["ETH", "BTC", "SOL", "BNB", "XRP", "TRX", "ZEC", "HYPE", "DOGE", "XMR", "ADA"];
  const asks = src.asks;
  assert.deepEqual(await market.top(10), ten, "kept an hour");
  assert.equal(src.asks, asks, "not asked again");
  now += 61 * 60_000;
  assert.deepEqual((await market.top(3)), ["ETH", "BTC", "SOL"], "an hour on: the order now");
  ranks = () => {
    throw new Error("CoinGecko answered 429");
  };
  now += 61 * 60_000;
  assert.deepEqual(await market.top(3), ["ETH", "BTC", "SOL"], "it cannot say: its last order stands");
  const fresh = new Market(standInMarket(() => now, { ranks: () => ranks() }), () => now);
  assert.deepEqual(await fresh.top(4), ["BTC", "ETH", "BNB", "XRP"], "never read: the majors' own order");
  const few = new Market(standInMarket(() => now, { ranks: () => ["BTC", "USDT"] }), () => now);
  assert.deepEqual(await few.top(2), ["BTC", "ETH"], "too few majors in its list is no order");
});

test("addresses are read by their own chain's rules, and a typo is refused", () => {
  const evm = checksummed(`0x${Buffer.from(bytes(20, 3)).toString("hex")}`);
  assert.deepEqual(readAddress(evm), { chain: "evm", address: evm });
  assert.deepEqual(readAddress(evm.toLowerCase()), { chain: "evm", address: evm }, "all lower case: no checksum to check, kept checksummed");
  const i = [...evm].findIndex((c, k) => k > 1 && /[a-f]/i.test(c));
  const typo = evm.slice(0, i) + (evm[i] === evm[i]!.toUpperCase() ? evm[i]!.toLowerCase() : evm[i]!.toUpperCase()) + evm.slice(i + 1);
  assert.match((readAddress(typo) as { why: string }).why, /EIP-55/, "one capital wrong");
  const sol = toB58(bytes(32, 7));
  assert.deepEqual(readAddress(sol), { chain: "solana", address: sol });
  assert.equal(base58(sol)!.length, 32);
  assert.match((readAddress(toB58(bytes(31, 7))) as { why: string }).why, /32 bytes/);
  const body = Uint8Array.from([0, ...bytes(20, 5)]);
  const legacy = toB58(Uint8Array.from([...body, ...sha(sha(body)).subarray(0, 4)]));
  assert.deepEqual(readAddress(legacy), { chain: "bitcoin", address: legacy });
  const badSum = toB58(Uint8Array.from([...body, 1, 2, 3, 4]));
  assert.match((readAddress(badSum) as { why: string }).why, /checksum/);
  const seg = bech32("bc", 0, bytes(20, 9));
  const taproot = bech32("bc", 1, bytes(32, 9));
  assert.deepEqual([readAddress(seg), readAddress(taproot)], [{ chain: "bitcoin", address: seg }, { chain: "bitcoin", address: taproot }]);
  const flip = seg.slice(0, -1) + (seg.at(-1) === "q" ? "p" : "q");
  assert.match((readAddress(flip) as { why: string }).why, /bech32/);
  assert.match((readAddress("hello") as { why: string }).why, /not an address/);
  // amounts exactly, past a token's decimals refused
  assert.equal(toUnits("1.5", 18), 1_500_000_000_000_000_000n);
  assert.equal(fromUnits(1_234_567n, 6), "1.234567");
  assert.throws(() => toUnits("0.0000001", 6), /6 decimals/);
});

test("a wallet's holdings come from its chains, valued at the market's prices; the home keeps only its address", async (t) => {
  const evm = checksummed(`0x${Buffer.from(bytes(20, 4)).toString("hex")}`);
  const { home, chains } = await deskHome(t, {
    price: (s) => ({ ETH: 2_500, BTC: 80_000 } as Record<string, number>)[s] ?? 10,
    chains: {
      eth_chainId: () => "0x2105",
      eth_getBalance: () => `0x${(2n * 10n ** 18n).toString(16)}`, // 2 ETH on every chain
      eth_call: (p) => {
        const data = String((p[0] as { data: string; to: string }).data);
        const to = String((p[0] as { to: string }).to).toLowerCase();
        if (!data.startsWith("0x70a08231")) return "0x0";
        return to === "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" ? `0x${(150n * 10n ** 6n).toString(16)}` : "0x0"; // 150 USDC on Base
      },
    },
  });
  const w = home.wallets.add(evm, { wallet: "MetaMask", label: "Main" });
  assert.deepEqual([w.chain, w.address, w.wallet], ["evm", evm, "MetaMask"]);
  const h = await home.wallets.holdings(w.id);
  assert.deepEqual(h.errors, []);
  const base = h.holdings.filter((x) => x.chain === "Base");
  assert.deepEqual(base.map((x) => [x.symbol, x.amount, x.usd]), [["ETH", "2", 5_000], ["USDC", "150", 150]]);
  assert.equal(h.holdings.filter((x) => x.symbol === "ETH").length, 4, "2 ETH on each of the four ETH chains");
  assert.ok(!chains.calls.some((m) => /sign|send|request/i.test(m)), "nothing asks a chain to sign or send");
  assert.throws(() => home.wallets.add(evm.slice(0, -1) + "Z"), /not an address/);
});

test("a real swap: an orb's only asks; built after your yes at a fresh price no worse than you approved; an allowance first; sent once; followed to its end", async (t) => {
  let rate = 2_500; // USDC a WETH gets on the stand-in router
  let status: string | null = null;
  const { home, routers } = await deskHome(t, {
    price: (s) => ({ ETH: 2_500 } as Record<string, number>)[s] ?? 1,
    outPer: () => rate,
    chains: { eth_call: () => "0x0", eth_getTransactionReceipt: () => (status ? { status } : null) },
  });
  home.desk.setSettings({ perTradeUsd: 200, perDayUsd: 400, slippageBps: 50 });
  const asked = await home.swaps.ask({ by: "tess", chain: "base", sell: "WETH", buy: "USDC", amount: "0.04", why: "taking profit" });
  assert.deepEqual([asked.state, asked.usd, asked.quote!.out], ["asked", 100, "100"]);
  const from = checksummed(`0x${Buffer.from(bytes(20, 8)).toString("hex")}`);
  await assert.rejects(() => home.swaps.build(asked.id, from), /waits for your yes/, "nothing is built before your yes");
  assert.equal(routers.built, 0);
  home.swaps.answer(asked.id, true);
  // the price moves against you past your slippage: refused, nothing built
  rate = 2_480; // 0.8% worse
  await assert.rejects(() => home.swaps.build(asked.id, from), /the price moved/);
  rate = 2_490; // 0.4% worse: inside 0.5%
  const { built } = await home.swaps.build(asked.id, from);
  assert.equal(built.kind, "evm");
  assert.ok(built.kind === "evm" && built.approve !== null && built.approve.data.startsWith("0x095ea7b3"), "WETH is a token: its allowance (approve) first, for exactly this much");
  assert.ok(built.kind === "evm" && built.chainId === 8453 && built.tx.to === "0x1111111111111111111111111111111111111111");
  const tx = `0x${"ab".repeat(32)}`;
  home.swaps.sent(asked.id, tx);
  assert.throws(() => home.swaps.sent(asked.id, tx), /already sent/, "a retry is refused: sent once");
  await home.swaps.due();
  assert.equal(home.swaps.get(asked.id)!.state, "sent", "the chain has not said yet");
  status = "0x1";
  await home.swaps.due();
  assert.equal(home.swaps.get(asked.id)!.state, "confirmed");
  assert.equal(home.events.ofType("desk.swap_settled").at(-1)!.data.state, "confirmed");
  // the limits and the off switch
  await assert.rejects(() => home.swaps.ask({ by: "tess", chain: "base", sell: "WETH", buy: "USDC", amount: "0.1" }), /over the desk's limit of \$200 a trade/);
  await home.swaps.ask({ by: null, chain: "base", sell: "WETH", buy: "USDC", amount: "0.07" }); // $175 of yours: approved as you ask
  await assert.rejects(() => home.swaps.ask({ by: null, chain: "base", sell: "WETH", buy: "USDC", amount: "0.07" }), /over the desk's \$400 a day/);
  home.desk.setSettings({ off: true });
  await assert.rejects(() => home.swaps.ask({ by: null, chain: "base", sell: "WETH", buy: "USDC", amount: "0.01" }), /switched off/);
  home.desk.setSettings({ off: false });
  // denied, and expired
  const no = await home.swaps.ask({ by: "tess", chain: "base", sell: "WETH", buy: "USDC", amount: "0.01" });
  assert.equal(home.swaps.answer(no.id, false).state, "denied");
  await assert.rejects(() => home.swaps.build(no.id, from), /denied/);
  const late = await home.swaps.ask({ by: "tess", chain: "base", sell: "WETH", buy: "USDC", amount: "0.01" });
  (home.clock as FakeClock).suspend(61 * MIN);
  await home.swaps.due();
  assert.equal(home.swaps.get(late.id)!.state, "expired");
});

test("through the door: the desk's snapshot, a strategy kept and run, your own swap's life, the keepsakes", async (t) => {
  const { home, clock } = await deskHome(t, { chains: { eth_call: () => `0x${(10n ** 30n).toString(16)}` } });
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${path}`, { method, headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  clock.suspend(400 * MIN); // a market with history
  const snap = (await call("GET", "/desk")).json;
  assert.ok(Array.isArray(snap.prices) && (snap.prices as unknown[]).length >= 3);
  assert.equal((snap.market as { source: string }).source, "stand-in market");
  const c = await call("GET", "/desk/candles?symbol=BTC&tf=1h&n=50");
  assert.equal((c.json.candles as unknown[]).length, 50);
  assert.equal((await call("GET", "/desk/candles?symbol=NOPE&tf=1h")).status, 400);
  const bt = await call("POST", "/desk/backtest", { strategy: crossing });
  assert.ok(typeof (bt.json.backtest as { metrics: { returnPct: number } }).metrics.returnPct === "number");
  assert.equal((await call("POST", "/desk/backtest", { strategy: { ...crossing, symbol: "NOPE" } })).status, 409, "a strategy that cannot run says why");
  const kept = (await call("POST", "/desk/strategies", { strategy: crossing })).json.strategy as { id: number; words: string };
  assert.match(kept.words, /^Buy ETH on 1m bars/);
  const run = await call("POST", "/desk/runs", { strategy: kept.id, orb: "tess" });
  assert.equal((run.json.book as { state: string }).state, "live");
  const mine = (await call("POST", "/desk/swaps", { chain: "base", sell: "USDC", buy: "ETH", amount: "50" })).json.swap as { id: number; state: string };
  assert.equal(mine.state, "approved", "your own Swap is your yes");
  const from = checksummed(`0x${Buffer.from(bytes(20, 2)).toString("hex")}`);
  const b = await call("POST", `/desk/swaps/${mine.id}/build`, { from });
  assert.equal(b.status, 200);
  assert.equal(((b.json as { built: { approve: unknown } }).built).approve, null, "an allowance already large enough asks nothing more");
  assert.equal((await call("POST", `/desk/swaps/${mine.id}/sent`, { tx: "not-a-hash" })).status, 409);
  assert.equal((await call("POST", `/desk/swaps/${mine.id}/unsent`, { why: "you closed the wallet's window" })).json.swap && "ok", "ok");
  assert.deepEqual((await call("PUT", "/me/keepsakes", { id: "ab12" })).json, { keepsakes: ["ab12"] });
  assert.equal((await call("PUT", "/me/keepsakes", { id: "Not Allowed" })).status, 400);
  assert.deepEqual((await call("GET", "/me/keepsakes")).json, { keepsakes: ["ab12"] });
  assert.ok(made("ETH", 1) > 0);
});

test("the market: bars in order, kept half a minute and asked again once a bar closes; a failing feed rests longer each time and comes back; a price a minute old is stale, and no price", async () => {
  const clock = new FakeClock(START + 17 * MIN); // inside an hour's bar
  let fail = false;
  const src = standInMarket(() => clock.now(), { fail: () => fail });
  // a feed that gives its bars backwards, one of them broken
  const m = new Market({ ...src, candles: async (sym, tf, n) => [...(await src.candles(sym, tf, n))].reverse().map((b, i) => (i === 3 ? { ...b, c: Number.NaN } : b)) }, () => clock.now());
  const bars = await m.candles("BTC", "1h", 50);
  assert.ok(bars.every((b, i) => i === 0 || b.t > bars[i - 1]!.t), "oldest first");
  assert.ok(bars.every((b) => Number.isFinite(b.c)) && bars.length === 49, "a broken bar is dropped");
  const asked = src.asks;
  clock.suspend(20_000);
  await m.candles("BTC", "1h", 40);
  assert.equal(src.asks, asked, "asked a moment ago: kept");
  clock.suspend(15_000);
  await m.candles("BTC", "1h", 40);
  assert.equal(src.asks, asked + 1, "half a minute on, the forming bar is asked for again");
  clock.suspend(10_000);
  await m.candles("BTC", "1h", 40);
  assert.equal(src.asks, asked + 1);
  clock.suspend(60 * MIN);
  await m.candles("BTC", "1h", 40);
  assert.equal(src.asks, asked + 2, "a bar closed: asked again");
  // the feed fails: it rests 2 s, then 4, then 8 ..., asking nothing while it rests, up to five minutes
  fail = true;
  const rests: number[] = [];
  for (let k = 0; k < 10; k++) {
    clock.suspend(60 * MIN); // a new bar each time, so it must ask
    await assert.rejects(() => m.candles("BTC", "1h", 50));
    const st = m.status();
    assert.equal(st.ok, false);
    rests.push(st.restingUntil! - clock.now());
    const before = src.asks;
    await assert.rejects(() => m.candles("ETH", "1h", 50), /resting/);
    assert.equal(src.asks, before, "resting, it asks nothing");
  }
  assert.deepEqual(rests, [2_000, 4_000, 8_000, 16_000, 32_000, 64_000, 128_000, 256_000, 300_000, 300_000]);
  fail = false;
  clock.suspend(300_001);
  assert.equal((await m.candles("BTC", "1h", 40)).length, 40, "back, once it has rested");
  assert.equal(m.status().ok, true);
  // prices: fresh, then a minute old with the feed down again: stale, and no price
  const [fresh] = await m.tickers(["BTC"]);
  assert.equal(fresh!.stale, false);
  assert.ok((await m.price("BTC"))! > 0);
  fail = true;
  clock.suspend(61_000);
  const [old] = await m.tickers(["BTC"]);
  assert.equal(old!.stale, true, "kept, but said stale");
  assert.equal(await m.price("BTC"), null, "a stale price is no price");
});
