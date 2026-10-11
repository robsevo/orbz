// PLAN 5.32_t, what a chart draws for the desk (owner, 10-11: "right click and add lets say indicators, or an orbs
// strategy so we can see it visually. paper or live"):
//   - A strategy over a chart's bars: the bar still forming left out by the home's clock (a close decides), the rest
//     stepped as a paper book steps them; each series its rules read, once, worded, over the same bars; a fixed number
//     and the bar's own prices are not series to draw. Bars that are not bars are refused.
//   - What was done on a market: each orb's paper fills there and nowhere else; the real trades that went (sent or
//     confirmed, not asked, denied or failed), a coin matched by its address in any case on its own chain only, a major
//     by its symbol; a real trade's price what its dollars bought; the strategies run on it on paper, from when.
//   - The door's two routes, and what they refuse.
import assert from "node:assert/strict";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { FakeClock } from "../src/clock.ts";
import { barsProblem, drawn, marksOn, seriesIn, type FillEvent } from "../src/desk/chart.ts";
import type { Book } from "../src/desk/desk.ts";
import { publicDex } from "../src/desk/dex.ts";
import { backtest, seriesOf, type Strategy } from "../src/desk/strategy.ts";
import type { Swap } from "../src/desk/swaps.ts";
import { agentHome } from "./helpers.ts";
import { standInChains, standInMarket, standInRouters } from "./fakes/market.ts";
import { MINT, START, standInDexFetch } from "./fakes/dex.ts";

const H = 3_600_000;
// up, down, up again: a 3-bar EMA crosses its 5-bar one each way
const CLOSES = [10, 10, 10, 10, 10, 11, 12, 13, 14, 15, 14, 13, 12, 11, 10, 9, 10, 11, 12, 13, 14, 15, 16];
const barsUpTo = (last: number) => CLOSES.map((c, i) => {
  const o = i ? CLOSES[i - 1]! : c;
  return { t: last - (CLOSES.length - 1 - i) * H, o, h: Math.max(o, c) + 0.2, l: Math.min(o, c) - 0.2, c, v: 100 + i };
});
const CROSS: Strategy = {
  name: "Cross", symbol: "BTC", timeframe: "1h", sizePct: 100,
  entry: { all: [{ left: { kind: "ema", period: 3 }, op: "crosses_above", right: { kind: "ema", period: 5 } }] },
  exit: { all: [{ left: { kind: "ema", period: 3 }, op: "crosses_below", right: { kind: "ema", period: 5 } }] },
};

test("a strategy over a chart's bars: the bar still forming left out, the rest stepped as a paper book steps them; each series its rules read, once, worded", () => {
  const bars = barsUpTo(START - H / 2); // the last opened half an hour ago: still forming
  const d = drawn(CROSS, bars, START);
  assert.equal(d.bars, bars.length - 1, "the bar still forming is not read: its close has not decided");
  assert.deepEqual(d.trades, backtest(CROSS, bars.slice(0, -1)).trades, "the paper desk's own steps over the closed bars");
  assert.ok(d.trades.length >= 2, "it bought and sold on these bars");
  assert.deepEqual(d.series.map((s) => s.words), ["the 3-bar EMA", "the 5-bar EMA"], "each series once, worded as the desk words it");
  assert.deepEqual(d.series[0]!.values, seriesOf({ kind: "ema", period: 3 }, bars.slice(0, -1)), "over the same bars");
  // once that bar has closed it is read
  assert.equal(drawn(CROSS, bars, START + H / 2).bars, bars.length);
  // a fixed number is a level and the bar's own price its candle: neither is a series to draw
  const dip: Strategy = { ...CROSS, entry: { all: [{ left: { kind: "rsi", period: 14 }, op: "<", right: { kind: "value", value: 30 } }, { left: { kind: "price", field: "close" }, op: ">", right: { kind: "sma", period: 50 } }] }, exit: { any: [{ left: { kind: "rsi", period: 14 }, op: ">", right: { kind: "value", value: 55 } }] } };
  assert.deepEqual(seriesIn(dip), [{ kind: "rsi", period: 14 }, { kind: "sma", period: 50 }]);
});

test("bars that are not bars are refused: too few or too many, a number missing, out of time order or twice, a high under its low, a price of nothing", () => {
  const good = barsUpTo(START);
  assert.equal(barsProblem(good), null, "the control: good bars pass");
  assert.match(barsProblem("bars")!, /2 to 400/);
  assert.match(barsProblem(good.slice(0, 1))!, /2 to 400/);
  assert.match(barsProblem(Array.from({ length: 401 }, (_, i) => ({ ...good[0]!, t: i })))!, /2 to 400/);
  assert.equal(barsProblem(Array.from({ length: 400 }, (_, i) => ({ ...good[0]!, t: i }))), null, "400 is the most");
  assert.match(barsProblem([good[0], { ...good[1]!, c: Number.NaN }])!, /a close/);
  assert.match(barsProblem([good[1], good[0]])!, /time order/);
  assert.match(barsProblem([good[0], good[0]])!, /time order/);
  assert.match(barsProblem([good[0], { ...good[1]!, h: 1, l: 2 }])!, /high at or over its low/);
  assert.match(barsProblem([good[0], { ...good[1]!, o: 0 }])!, /above nothing/);
});

const EVM = "0x4200000000000000000000000000000000000042";
const swap = (o: Partial<Swap>): Swap => ({ id: 1, orb: "tess", chain: "solana", sell: "SOL", buy: MINT, amount: "0.5", usd: 80, why: "", quote: null, state: "sent", tx: "tx", error: null, createdAt: START, settledAt: null, ...o });
const quoted = (out: string): Swap["quote"] => ({ amountIn: "1", amountOut: "1", out, priceImpactPct: null, feeUsd: null, route: [], router: null });
const book = (o: Partial<Book>): Book => ({ id: 1, orb: "tess", strategy: 7, symbol: `solana:${MINT}`, cashStart: 10_000, cash: 10_000, qty: 0, entryPx: 0, entryT: 0, fees: 0, state: "live", startedAt: START - H, stoppedAt: null, holdings: [], ...o });

test("what was done on a market: its paper fills only; the real trades that went, a coin by its address on its own chain, a major by its symbol, each at what its dollars bought; the strategies run on it", () => {
  const coin = `solana:${MINT}`;
  const fills: FillEvent[] = [
    { at: START - 2 * H, orb: "tess", data: { book: 1, strategy: 7, symbol: coin, side: "buy", qty: 1000, px: 0.15, paper: true } },
    { at: START - H, orb: "kit", data: { book: 2, symbol: coin, side: "sell", qty: 400, px: 0.17, usd: 68, paper: true } },
    { at: START - H, orb: "kit", data: { book: 2, symbol: "BTC", side: "buy", qty: 0.01, px: 60_000, paper: true } }, // another market
  ];
  const swaps: Swap[] = [
    swap({ id: 1, buy: MINT, quote: quoted("500"), usd: 80, createdAt: START - 30 * 60_000, settledAt: START - 29 * 60_000 }), // a buy: $80 for 500
    swap({ id: 2, sell: MINT, buy: "SOL", amount: "250", usd: 50, state: "confirmed", orb: null, createdAt: START - 10 * 60_000 }), // yours: a sale, 250 for $50
    swap({ id: 3, state: "asked" }), swap({ id: 4, state: "denied" }), swap({ id: 5, state: "failed" }), swap({ id: 6, state: "expired" }),
  ];
  const books = [book({ id: 1 }), book({ id: 2, orb: "kit", strategy: null }), book({ id: 3, orb: "kit", strategy: 9, symbol: "BTC" })];
  const m = marksOn(coin, { fills, swaps, books });
  assert.deepEqual(m.fills.map((f) => [f.kind, f.orb, f.side, f.px]), [["paper", "tess", "buy", 0.15], ["paper", "kit", "sell", 0.17], ["real", "tess", "buy", 0.16], ["real", null, "sell", 0.2]], "oldest first; this market's only; a real trade only once it went");
  assert.equal(m.fills[0]!.strategy, 7, "a strategy's fill names it");
  assert.equal(m.fills[2]!.at, START - 29 * 60_000, "a real trade when it settled");
  assert.deepEqual(m.runs.map((r) => [r.book, r.orb, r.strategy]), [[1, "tess", 7]], "a strategy run on it; an orb's own book and another market's run are not");
  // a coin by its address in any case, on its own chain only
  const base = `base:${EVM}`;
  const evm = marksOn(base, { fills: [], swaps: [swap({ chain: "base", sell: "USDC", buy: EVM.toLowerCase(), quote: quoted("4"), usd: 10 }), swap({ id: 2, chain: "ethereum", sell: "USDC", buy: EVM, quote: quoted("4"), usd: 10 })], books: [] });
  assert.deepEqual(evm.fills.map((f) => [f.swap, f.px]), [[1, 2.5]], "the same address on another chain is another coin");
  // a major by its symbol: selling SOL is a sale of SOL
  const sol = marksOn("SOL", { fills: [], swaps: [swap({ id: 1, sell: "SOL", buy: MINT, amount: "0.5", usd: 80 })], books: [] });
  assert.deepEqual(sol.fills.map((f) => [f.side, f.px]), [["sell", 160]]);
});

test("the door: a strategy over the bars handed in, closed ones only by the home's clock; what was done on a market; what each refuses", async (t) => {
  const clock = new FakeClock(START);
  const { home } = await agentHome(t, [], { clock, desk: { source: standInMarket(() => clock.now()), routers: standInRouters({ outPer: () => 680 }), fetch: standInChains({}), dex: publicDex({ fetch: standInDexFetch() }) } });
  home.inbox.addOrb("tess", "Tess", "dealer");
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const ask = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`http://127.0.0.1:${door.port}${path}`, { ...init, headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" } });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const bars = barsUpTo(START - H / 2);
  const ok = await ask("/desk/backtest", { method: "POST", body: JSON.stringify({ strategy: CROSS, bars }) });
  assert.equal(ok.status, 200);
  const bt = ok.body.backtest as { bars: number; trades: unknown[]; series: { words: string; values: number[] }[] };
  assert.equal(bt.bars, bars.length - 1, "by the home's clock, the bar still forming left out");
  assert.deepEqual(bt.series.map((s) => [s.words, s.values.length]), [["the 3-bar EMA", bars.length - 1], ["the 5-bar EMA", bars.length - 1]]);
  assert.deepEqual(bt.trades, JSON.parse(JSON.stringify(backtest(CROSS, bars.slice(0, -1)).trades)));
  const bad = await ask("/desk/backtest", { method: "POST", body: JSON.stringify({ strategy: CROSS, bars: [bars[1], bars[0]] }) });
  assert.deepEqual([bad.status, bad.body.error], [400, "bars: in time order, each once"]);
  const noRules = await ask("/desk/backtest", { method: "POST", body: JSON.stringify({ strategy: { ...CROSS, sizePct: 0 }, bars }) });
  assert.equal(noRules.status, 400, "a strategy that is not one is refused before any bar is read");
  // a paper fill on a coin is its mark there
  const coin = `solana:${MINT}`;
  await home.desk.paperTrade("tess", coin, "buy", 500);
  const marks = await ask(`/desk/marks?market=${encodeURIComponent(coin)}`);
  assert.deepEqual((marks.body.fills as { kind: string; orb: string; side: string }[]).map((f) => [f.kind, f.orb, f.side]), [["paper", "tess", "buy"]]);
  assert.deepEqual(((await ask("/desk/marks?market=BTC")).body.fills as unknown[]).length, 0, "and nowhere else");
  assert.equal((await ask("/desk/marks?market=solana%3Anot-an-address")).status, 400, "a market the desk does not know is refused");
});
