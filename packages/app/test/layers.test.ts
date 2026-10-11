// PLAN 5.32_t, what the desk's chart draws (owner, 10-11: "an orbs strategy so we can see it visually. paper or live"),
// pure:
//   - a strategy on paper: what its rules read over the price and in a pane (its fixed numbers that pane's levels), each
//     trade in and out where the paper desk made it (an exit's result on it), one still open drawn open, and where its
//     orb runs it on paper here from; live: the same rules, and only its orb's real trades here;
//   - a strategy read on bars the chart has since moved past is drawn by time, where it was read;
//   - an orb's own trades here, on paper or real; who has traded here, counted;
//   - a study over the price draws its lines (Bollinger's band too); one with a scale of its own, a pane.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeskCandle, DeskDrawn, DeskFill, DeskMarks, DeskStrategy } from "../src/home/link.ts";
import { byTime, orbLayer, paneOf, strategyLayer, studyLayer, whoTradedHere } from "../src/desk/layers.ts";

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 11);
const bars = (n: number, from = T0): DeskCandle[] => Array.from({ length: n }, (_, i) => ({ t: from + i * H, o: 10, h: 11, l: 9, c: 10 + (i % 3), v: 100 }));
const DIP: DeskStrategy = {
  id: 7, name: "RSI dip", by: "kit", words: "Buy when RSI(14) is below 30…", backtest: null, createdAt: T0,
  spec: {
    name: "RSI dip", symbol: "BTC", timeframe: "1h", sizePct: 50,
    entry: { all: [{ left: { kind: "rsi", period: 14 }, op: "<", right: { kind: "value", value: 30 } }, { left: { kind: "price", field: "close" }, op: ">", right: { kind: "sma", period: 50 } }] },
    exit: { any: [{ left: { kind: "rsi", period: 14 }, op: ">", right: { kind: "value", value: 55 } }] },
  },
};
const sent = bars(60);
const drawn: DeskDrawn = {
  metrics: { returnPct: 4.2, holdPct: 1, maxDrawdownPct: 3, trades: 2, winRate: 0.5, profitFactor: 1.4, avgTradePct: 2, exposurePct: 30, feesPaid: 6 },
  trades: [
    { entryT: T0 + 10 * H, entryPx: 10.1, exitT: T0 + 20 * H, exitPx: 10.9, qty: 1, pnl: 0.7, pnlPct: 7.9, fees: 0.1, why: "rule" },
    { entryT: T0 + 50 * H, entryPx: 10.2, exitT: T0 + 58 * H, exitPx: 10.4, qty: 1, pnl: 0.1, pnlPct: 1.9, fees: 0.1, why: "end" },
  ],
  series: [
    { series: { kind: "rsi", period: 14 }, words: "RSI(14)", values: sent.slice(0, 59).map((_, i) => (i < 14 ? NaN : 40 + i * 0.1)) },
    { series: { kind: "sma", period: 50 }, words: "the 50-bar average", values: sent.slice(0, 59).map((_, i) => (i < 49 ? NaN : 10.5)) },
  ],
  bars: 59,
};
const fill = (o: Partial<DeskFill>): DeskFill => ({ kind: "real", orb: "kit", at: T0 + 30 * H, side: "buy", px: 10.3, qty: 5, usd: 51.5, ...o });
const marks: DeskMarks = {
  fills: [fill({}), fill({ kind: "paper", at: T0 + 31 * H }), fill({ orb: "vic", at: T0 + 32 * H }), fill({ orb: null, side: "sell", at: T0 + 33 * H })],
  runs: [{ book: 1, orb: "kit", strategy: 7, startedAt: T0 + 40 * H, stoppedAt: null, state: "live" }, { book: 2, orb: "vic", strategy: 9, startedAt: T0 + 41 * H, stoppedAt: null, state: "live" }],
};
const who = { name: "Kit", hue: "amber" as const };

test("a strategy on paper: its rules' series over the price and in a pane, its fixed numbers that pane's levels; each trade in and out, one still open drawn open; where it runs on paper from", () => {
  const l = strategyLayer({ s: DIP, mode: "paper", drawn: { result: drawn, sent }, marks, candles: sent, who, tf: "1h" });
  assert.equal(l.id, "strategy:7:paper");
  assert.deepEqual(l.lines!.map((x) => x.label), ["MA 50"], "its average over the price");
  assert.deepEqual(l.panes!.map((p) => [p.key, p.levels, p.range]), [["rsi14", [30, 55], { lo: 0, hi: 100 }]], "RSI in its own pane, its 30 and 55 there");
  assert.deepEqual(l.marks!.map((m) => [m.side, m.kind, m.t]), [["buy", "signal", T0 + 10 * H], ["sell", "signal", T0 + 20 * H], ["buy", "signal", T0 + 50 * H]], "the open trade has no way out drawn");
  assert.deepEqual([l.marks![1]!.label, l.marks![1]!.win], ["+7.9%", true], "an exit says what it made");
  assert.deepEqual(l.spans!.map((s) => s.win), [true, null], "in to out; the open one to now");
  assert.deepEqual(l.starts!.map((s) => s.t), [T0 + 40 * H], "its own run here, not another strategy's");
  assert.match(l.note!, /^paper · 2 trades · \+4\.2% · 50% won$/);
  assert.equal(l.lines![0]!.values.length, sent.length, "one value to each bar");
  assert.ok(Number.isNaN(l.lines![0]!.values.at(-1)!), "the bar still forming was not read");
  // made for another timeframe: said
  assert.match(strategyLayer({ s: DIP, mode: "paper", drawn: { result: drawn, sent }, marks, candles: sent, who, tf: "15m" }).note!, /made for 1h$/);
});

test("live: the same rules, and only its orb's real trades here (not its paper, not another orb's)", () => {
  const l = strategyLayer({ s: DIP, mode: "live", drawn: { result: drawn, sent }, marks, candles: sent, who, tf: "1h" });
  assert.equal(l.id, "strategy:7:live");
  assert.deepEqual(l.marks!.map((m) => [m.kind, m.t]), [["real", T0 + 30 * H]]);
  assert.equal(l.spans, undefined, "no paper trades on it");
  assert.match(l.note!, /^live · 1 real trade here$/);
  assert.deepEqual(l.panes!.map((p) => p.key), ["rsi14"], "its rules drawn all the same");
  const yours = strategyLayer({ s: { ...DIP, by: null }, mode: "live", drawn: null, marks, candles: sent, who: { name: "You", hue: "azure" }, tf: "1h" });
  assert.deepEqual(yours.marks!.map((m) => m.side), ["sell"], "a strategy of yours: your own real trades");
  assert.equal(strategyLayer({ s: DIP, mode: "live", drawn: null, marks: { fills: [], runs: [] }, candles: sent, who, tf: "1h" }).note, "live · no real trades here yet");
});

test("a strategy read on bars the chart has since moved past is drawn by time, where it was read", () => {
  const moved = bars(60, T0 + 2 * H); // two bars on
  const l = strategyLayer({ s: DIP, mode: "paper", drawn: { result: drawn, sent }, marks, candles: moved, who, tf: "1h" });
  const rsi = l.panes![0]!.lines[0]!.values;
  assert.equal(rsi[0], drawn.series[0]!.values[2], "the chart's first bar is the third it was read on");
  assert.ok(Number.isNaN(rsi[58]!), "bars it was not read on have nothing");
  assert.deepEqual(byTime(moved.slice(0, 2), sent, [1, 2, 3, 4]), [3, 4]);
});

test("an orb's own trades here, on paper or real; who has traded here, counted; a study's lines, band and pane", () => {
  assert.deepEqual(orbLayer({ orb: "kit", mode: "paper", marks, who }).marks!.map((m) => m.kind), ["paper"]);
  assert.deepEqual(orbLayer({ orb: "kit", mode: "live", marks, who }).marks!.map((m) => m.kind), ["real"]);
  const you = orbLayer({ orb: null, mode: "live", marks, who: { name: "You", hue: "azure" } });
  assert.deepEqual([you.id, you.label, you.marks!.length], ["orb:you:live", "Your trades", 1]);
  assert.match(you.marks![0]!.title, /^You sold \$51\.50 worth at \$10\.30, for real/);
  assert.deepEqual(whoTradedHere(marks), [{ orb: "kit", paper: 1, real: 1 }, { orb: "vic", paper: 0, real: 1 }, { orb: null, paper: 0, real: 1 }]);
  const c = bars(80);
  const bb = studyLayer({ id: "bb1", kind: "bb", n: [20, 2], hue: "violet" }, c);
  assert.deepEqual([bb.lines!.map((l) => l.label), Boolean(bb.band), bb.panes], [["Upper", "Middle", "Lower"], true, undefined]);
  const r = studyLayer({ id: "rsi1", kind: "rsi", n: [14], hue: "lavender" }, c);
  assert.deepEqual([r.lines, r.panes!.map((p) => [p.label, p.levels])], [undefined, [["RSI 14", [30, 70]]]]);
  assert.equal(paneOf({ kind: "macd_signal", fast: 5, slow: 35, signal: 5 })!.key, paneOf({ kind: "macd", fast: 5, slow: 35, signal: 5 })!.key, "MACD and its signal share a pane");
});
