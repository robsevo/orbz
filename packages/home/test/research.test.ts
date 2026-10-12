// The desk's research and its risk (PLAN 5.40): desk/research.ts and desk/risk.ts, pure, on made bars whose answers are
// worked out below. Controls are planted in tools/home_mutants.py (an event counted at every bar it holds, a comparison
// judged on the bars it was chosen on, the value at risk read off the wrong tail).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candle } from "../src/desk/indicators.ts";
import { compareFitted, eventStudy, stress } from "../src/desk/research.ts";
import { exposureOf, together } from "../src/desk/risk.ts";
import type { Strategy } from "../src/desk/strategy.ts";

const H = 3_600_000;
/** Bars from closes: each opens at the close before it, its high and low its open and close. */
const barsOf = (closes: readonly number[]): Candle[] => closes.map((c, i) => {
  const o = i ? closes[i - 1]! : c;
  return { t: i * H, o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1 };
});
const near = (a: number | null, b: number, eps = 1e-9): boolean => a !== null && Math.abs(a - b) < eps;

test("an event study: each time a condition first held, what followed, against what followed any bar", () => {
  // 100 all along, but 90 for three bars from every twentieth bar's tenth: ten dips, each held three bars
  const closes = Array.from({ length: 200 }, (_, i) => (i % 20 >= 10 && i % 20 <= 12 ? 90 : 100));
  const st = eventStudy({ all: [{ left: { kind: "price", field: "close" }, op: "<", right: { kind: "value", value: 95 } }] }, barsOf(closes), [1, 3]);
  assert.equal(st.events, 10, "one event a dip, at its first bar, not three");
  const [one, three] = st.after;
  assert.deepEqual([one!.n, one!.avgPct, one!.upRate], [10, 0, 0], "a bar after: still 90");
  assert.ok(near(three!.avgPct, (100 / 90 - 1) * 100) && three!.upRate === 1, "three bars after: back to 100, every time");
  assert.ok(three!.basePct !== null && three!.basePct < three!.avgPct!, "more than any bar's three after");
  assert.equal(three!.t, null, "every event moved the same: no spread, no t statistic");
  assert.deepEqual(st.latest.map((e) => e.t / H), [190, 170, 150, 130, 110], "the latest first");
});

/** A strategy over made bars: always in (its entry holds at every close) or never. */
const always = (name: string, o: Partial<Strategy> = {}): Strategy => ({ name, symbol: "BTC", timeframe: "1h", entry: { all: [{ left: { kind: "price", field: "close" }, op: ">", right: { kind: "value", value: 0 } }] }, sizePct: 100, ...o });
const never = (name: string): Strategy => ({ name, symbol: "BTC", timeframe: "1h", entry: { all: [{ left: { kind: "price", field: "close" }, op: "<", right: { kind: "value", value: 0 } }] }, sizePct: 100 });

test("strategies compared: judged on the earlier part and on the later one no choice saw; a lead that did not carry is said to be one", () => {
  // up from 100 to 170 over 140 bars, then down to 100 over 60
  const closes = [...Array.from({ length: 141 }, (_, i) => 100 + i * 0.5), ...Array.from({ length: 60 }, (_, i) => 170 - (i + 1) * (70 / 60))];
  const cmp = compareFitted([always("In"), never("Out")], barsOf(closes), 0.7);
  assert.equal(cmp.fitBars, 140);
  const [inn, out] = cmp.rows;
  assert.ok(inn!.fit.returnPct > 50 && inn!.test.returnPct < -30, `in all along: up on the earlier part, down on the later (${inn!.fit.returnPct}, ${inn!.test.returnPct})`);
  assert.deepEqual([out!.fit.trades, out!.test.trades, out!.fit.returnPct, out!.test.returnPct], [0, 0, 0, 0]);
  assert.equal(cmp.best, "In");
  assert.match(cmp.warning ?? "", /^In was best on the earlier part and lost money on the part it never saw/);
  // all up: the same lead carries, and nothing is said
  const up = compareFitted([always("In"), never("Out")], barsOf(Array.from({ length: 200 }, (_, i) => 100 + i)), 0.7);
  assert.deepEqual([up.best, up.warning], ["In", null]);
});

test("a strategy stressed: an edge under twice its costs is said to be; each half, holding the coin, other bars", () => {
  // 100, 101, 100, 101...: bought after each fall at the next open (100), sold after the rise at the next open (101): 1% a
  // trade, before its costs
  const closes = Array.from({ length: 200 }, (_, i) => (i % 2 ? 101 : 100));
  const s: Strategy = {
    name: "Dip", symbol: "BTC", timeframe: "1h", sizePct: 100, feeBps: 20, slippageBps: 10,
    entry: { all: [{ left: { kind: "change", period: 1 }, op: "<", right: { kind: "value", value: 0 } }] },
    exit: { all: [{ left: { kind: "change", period: 1 }, op: ">", right: { kind: "value", value: 0 } }] },
  };
  const flat = barsOf(Array.from({ length: 200 }, () => 100));
  const st = stress(s, barsOf(closes), [{ label: "BTC on 4h", bars: flat }, { label: "ETH on 1h", bars: [] }]);
  assert.ok(st.base.returnPct > 0 && st.costs2.returnPct < 0, `in profit as written, at a loss with its costs doubled (${st.base.returnPct}, ${st.costs2.returnPct})`);
  assert.ok(st.base.trades >= 90 && st.firstHalf.returnPct > 0 && st.secondHalf.returnPct > 0);
  assert.ok(st.verdicts.includes("Its edge is no bigger than its costs: with fees and slippage doubled it loses money."));
  assert.ok(!st.verdicts.some((v) => /one half of the history only/.test(v)), "both halves made money");
  assert.deepEqual(st.others.map((x) => [x.label, x.part?.trades ?? null]), [["BTC on 4h", 0], ["ETH on 1h", null]], "flat bars: no trade; no bars: not measured");
  assert.ok(st.verdicts.includes("It made money on 0 of 1 other timeframes and markets."));
});

test("an account's risk: what rides on its largest coin, a day's value at risk at 95% and its worst day, on the coin's own days; a coin with no closes left out of them", () => {
  // twenty days of BTC: down 10%, down 5%, then up 1% eighteen times
  const moves = [-0.1, -0.05, ...Array.from({ length: 18 }, () => 0.01)];
  const closes = [{ t: 0, c: 100 }];
  for (const [i, m] of moves.entries()) closes.push({ t: (i + 1) * 24 * H, c: closes.at(-1)!.c * (1 + m) });
  const x = exposureOf("Tess", 800, [{ market: "BTC", qty: 2, px: 100 }, { market: "solana:Mint", qty: 5, px: 2 }, { market: "PEPE", qty: 9, px: null }], new Map([["BTC", closes]]));
  assert.deepEqual([x.value, x.equity, x.positions.map((p) => p.market)], [210, 1_010, ["BTC", "solana:Mint"]], "what has a price now, the largest first");
  assert.ok(near(x.investedPct, (210 / 1_010) * 100) && near(x.largestPct, (200 / 1_010) * 100));
  // its $200 of BTC each day: lost $20, lost $10, then made $2 eighteen times; the loss passed one day in twenty: $10
  assert.ok(near(x.var95, 10, 1e-6) && near(x.worstDay, 20, 1e-6) && x.days === 20, `${x.var95} ${x.worstDay} ${x.days}`);
  assert.deepEqual(x.unmeasured, ["solana:Mint", "PEPE"], "no closes, or no price: not in the value at risk");
  // too few days to say
  const short = exposureOf("Rae", 0, [{ market: "BTC", qty: 1, px: 100 }], new Map([["BTC", closes.slice(0, 6)]]));
  assert.deepEqual([short.var95, short.worstDay, short.days], [null, null, 0]);
  // accounts together: a coin held by two once
  const all = together("The desk", [{ cash: 10, holdings: [{ market: "BTC", qty: 1, px: 100 }] }, { cash: 5, holdings: [{ market: "BTC", qty: 2, px: 100 }] }]);
  assert.deepEqual([all.cash, all.holdings], [15, [{ market: "BTC", qty: 3, px: 100 }]]);
});
