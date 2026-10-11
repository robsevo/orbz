// PLAN 5.24_t, strategies by code, on a made-up market (a slow wave on a gentle trend, a little noise from a fixed
// seed: no real prices are needed to hold the arithmetic to account):
//   - Each indicator keeps to its definition, checked by a second, plainer computation written here.
//   - A strategy is checked (a bad one refused, saying why) and said back in plain words.
//   - The backtest is honest: a signal read at a bar's close fills at the next bar's open; the fee and the slippage are
//     paid both ways; a stop and a target are kept inside later bars, the stop first when one bar reaches both; a bar
//     that opens below the stop sells at its open.
//   - It never peeks: stepping bar by bar, each series computed only from the bars so far, gives the backtest's trades.
import assert from "node:assert/strict";
import { test } from "node:test";
import { atr, bollinger, ema, highestBefore, lowestBefore, macd, rsi, sma, type Candle } from "../src/desk/indicators.ts";
import { backtest, problemOf, seriesOf, startState, step, words, type Series, type Strategy, type Trade } from "../src/desk/strategy.ts";

const close = (a: number, b: number, d = 1e-9): boolean => Math.abs(a - b) <= d * Math.max(1, Math.abs(b));

/** A made-up market of n hourly bars. */
export function wave(n: number, o: { seed?: number; start?: number; drift?: number; swing?: number } = {}): Candle[] {
  let seed = o.seed ?? 7;
  const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  const out: Candle[] = [];
  let prev = o.start ?? 100;
  for (let i = 0; i < n; i++) {
    const mid = (o.start ?? 100) + i * (o.drift ?? 0.02) + (o.swing ?? 8) * Math.sin(i / 9);
    const c = mid + rand() * 1.5;
    const open = prev;
    out.push({ t: i * 3_600_000, o: open, h: Math.max(open, c) + Math.abs(rand()), l: Math.min(open, c) - Math.abs(rand()), c, v: 1_000 + 200 * rand() });
    prev = c;
  }
  return out;
}

test("indicators keep to their definitions", () => {
  const xs = wave(120).map((b) => b.c);
  // a simple average: n values summed, over n
  const s = sma(xs, 5);
  for (let i = 0; i < xs.length; i++) assert.ok(i < 4 ? Number.isNaN(s[i]!) : close(s[i]!, xs.slice(i - 4, i + 1).reduce((a, b) => a + b, 0) / 5), `sma at ${i}`);
  // an exponential average: seeded with the first n's average, then each value weighted 2/(n+1)
  const e = ema(xs, 10);
  assert.ok(e.slice(0, 9).every(Number.isNaN));
  assert.ok(close(e[9]!, xs.slice(0, 10).reduce((a, b) => a + b, 0) / 10), "seeded with the simple average");
  for (let i = 10; i < xs.length; i++) assert.ok(close(e[i]!, xs[i]! * (2 / 11) + e[i - 1]! * (9 / 11)), `ema at ${i}`);
  // RSI by Wilder: a second computation from the gains and losses listed out
  const r = rsi(xs, 14);
  const moves = xs.slice(1).map((x, i) => x - xs[i]!);
  let up = moves.slice(0, 14).filter((m) => m > 0).reduce((a, b) => a + b, 0) / 14;
  let down = -moves.slice(0, 14).filter((m) => m < 0).reduce((a, b) => a + b, 0) / 14;
  for (let i = 14; i < xs.length; i++) {
    if (i > 14) {
      up = (up * 13 + Math.max(0, moves[i - 1]!)) / 14;
      down = (down * 13 + Math.max(0, -moves[i - 1]!)) / 14;
    }
    assert.ok(close(r[i]!, 100 - 100 / (1 + up / down)), `rsi at ${i}`);
  }
  assert.ok(rsi([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14).at(-1) === 100, "only rising: 100");
  assert.ok(rsi([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 14).at(-1) === 0, "only falling: 0");
  assert.equal(rsi([5, 6, 5, 6, 5, 6, 5, 6, 5, 6, 5, 6, 5, 6, 5], 14)[14], 50, "as much up as down: 50");
  // MACD: the 12-bar EMA less the 26-bar, its signal the 9-bar EMA of that
  const m = macd(xs);
  const [f, sl] = [ema(xs, 12), ema(xs, 26)];
  for (let i = 25; i < xs.length; i++) assert.ok(close(m.line[i]!, f[i]! - sl[i]!), `macd at ${i}`);
  const sig = ema(m.line.slice(25), 9);
  for (let i = 25 + 8; i < xs.length; i++) assert.ok(close(m.signal[i]!, sig[i - 25]!), `signal at ${i}`);
  // Bollinger: the average and k population deviations about it
  const flat = bollinger([4, 4, 4, 4, 4], 5, 2);
  assert.deepEqual([flat.lower[4], flat.mid[4], flat.upper[4]], [4, 4, 4], "no spread, no band");
  const b = bollinger([1, 2, 3, 4, 5], 5, 2);
  assert.ok(close(b.upper[4]!, 3 + 2 * Math.sqrt(2)) && close(b.lower[4]!, 3 - 2 * Math.sqrt(2)));
  // ATR: bars that always range by 2 and never gap
  const even: Candle[] = Array.from({ length: 30 }, (_, i) => ({ t: i, o: 10, h: 11, l: 9, c: 10, v: 1 }));
  assert.equal(atr(even, 14)[29], 2);
  // the highest and lowest of the bars BEFORE: never the bar itself
  const hb = highestBefore([1, 5, 2, 9, 3], 2);
  assert.deepEqual(hb.slice(2), [5, 5, 9], "bar 3's 9 is not in its own window");
  assert.deepEqual(lowestBefore([4, 1, 6, 0, 8], 2).slice(2), [1, 1, 0]);
});

const crossing: Strategy = {
  name: "Wave rider", symbol: "ETH", timeframe: "1h", sizePct: 50, stopLossPct: 4, takeProfitPct: 8,
  entry: { all: [{ left: { kind: "ema", period: 5 }, op: "crosses_above", right: { kind: "ema", period: 20 } }] },
  exit: { all: [{ left: { kind: "ema", period: 5 }, op: "crosses_below", right: { kind: "ema", period: 20 } }] },
};

test("a strategy is checked, saying why when it cannot run, and said back in plain words", () => {
  assert.equal(problemOf(crossing), null);
  assert.equal(words(crossing), "Buy ETH on 1h bars when the 5-bar EMA crosses above the 20-bar EMA; sell when the 5-bar EMA crosses below the 20-bar EMA, or at a 4% stop, or at a 8% target. Each trade takes 50% of the account.");
  const bad: [Partial<Strategy>, RegExp][] = [
    [{ symbol: "SHIB" }, /trades one of BTC, ETH/],
    [{ timeframe: "2m" as never }, /bars are 1m, 5m/],
    [{ sizePct: 0 }, /1 to 100 percent/],
    [{ stopLossPct: 80 }, /stopLossPct is 0.1 to 50/],
    [{ entry: { all: [] } }, /1 to 8 conditions/],
    [{ entry: { all: [{ left: { kind: "sma", period: 0 } as Series, op: ">", right: { kind: "value", value: 1 } }] } }, /whole number of bars, 1 to 400/],
    [{ entry: { all: [{ left: { kind: "future" } as unknown as Series, op: ">", right: { kind: "value", value: 1 } }] } }, /is not something a strategy can read/],
    [{ exit: undefined, stopLossPct: undefined, takeProfitPct: undefined }, /needs a way out/],
  ];
  for (const [change, why] of bad) assert.match(problemOf({ ...crossing, ...change }) ?? "", why, JSON.stringify(change));
});

test("the backtest is honest: fills at the next open, fees and slippage both ways, the stop first, a gap sold at its open", () => {
  // a market that rises steadily from bar 30, so a rule "close above 100" first holds a few closes later; each bar opens
  // a little above the last close (a gap), so a fill at the next open is never the price of the close before it
  const bars: Candle[] = Array.from({ length: 60 }, (_, i) => {
    const c = i < 30 ? 95 : 95 + (i - 29) * 2;
    const o = i < 31 ? 95 : 95 + (i - 30) * 2 + 0.5;
    return { t: i * 60_000, o, h: Math.max(c, o) + 0.5, l: Math.min(c, o) - 0.5, c, v: 1 };
  });
  const s: Strategy = { name: "Above 100", symbol: "BTC", timeframe: "1m", sizePct: 100, feeBps: 30, slippageBps: 10, takeProfitPct: 10, entry: { all: [{ left: { kind: "price", field: "close" }, op: ">", right: { kind: "value", value: 100 } }] } };
  const r = backtest(s, bars, 10_000);
  const first = r.trades[0]!;
  const signalBar = bars.findIndex((b) => b.c > 100);
  assert.equal(first.entryT, bars[signalBar + 1]!.t, "filled at the open after the close that said so, never on it");
  const fill = bars[signalBar + 1]!.o * 1.001;
  const qty = (10_000 * 0.997) / fill;
  assert.ok(close(first.qty, qty) && close(first.entryPx, 10_000 / qty), "bought at the open plus slippage, the fee out of the money spent");
  assert.equal(first.why, "target");
  const target = first.entryPx * 1.1;
  const sold = Math.max(bars.find((b) => b.t === first.exitT)!.o, target);
  assert.ok(close(first.exitPx, sold * 0.999), "sold at the target less slippage");
  assert.ok(close(first.pnl, qty * sold * 0.999 * 0.997 - 10_000), "its profit after both fees and both slips");
  // with no fee and no slippage the same trades earn exactly what those took
  const free = backtest({ ...s, feeBps: 0, slippageBps: 0 }, bars, 10_000);
  assert.ok(free.metrics.returnPct > r.metrics.returnPct, "costs cost");
  // what each buy spent is its quantity at its entry price (the entry carries the fee), and 0.3% of that was the fee
  assert.ok(close(r.metrics.feesPaid, r.trades.reduce((n, t) => n + t.fees + t.qty * t.entryPx * 0.003, 0), 1e-6), "the fees paid are the trades' both ways");

  // one bar that reaches both the stop and the target: the stop (the careful reading)
  const both = [...bars.slice(0, signalBar + 2)];
  const entry = both[signalBar + 1]!;
  both.push({ t: entry.t + 60_000, o: entry.c, h: entry.c * 1.5, l: entry.c * 0.5, c: entry.c, v: 1 });
  const hit = backtest({ ...s, stopLossPct: 5 }, both, 10_000).trades[0]!;
  assert.equal(hit.why, "stop", "a bar that reaches both is a stop");
  // a bar that opens under the stop is sold at its open, never at the stop it skipped
  const gap = [...bars.slice(0, signalBar + 2)];
  gap.push({ t: entry.t + 60_000, o: entry.c * 0.8, h: entry.c * 0.82, l: entry.c * 0.79, c: entry.c * 0.81, v: 1 });
  const g = backtest({ ...s, stopLossPct: 5 }, gap, 10_000).trades[0]!;
  assert.ok(g.why === "stop" && close(g.exitPx, entry.c * 0.8 * 0.999), "sold at the gap's open");
});

test("it never peeks: stepping bar by bar on only the bars so far gives the backtest's trades", () => {
  const bars = wave(400, { seed: 11 });
  for (const s of [crossing, { ...crossing, name: "RSI dip", entry: { all: [{ left: { kind: "rsi", period: 14 }, op: "<", right: { kind: "value", value: 35 } }] }, exit: { any: [{ left: { kind: "rsi", period: 14 }, op: ">", right: { kind: "value", value: 60 } }] }, trailingStopPct: 3 } as Strategy, { ...crossing, name: "Breakout", entry: { all: [{ left: { kind: "price", field: "close" }, op: ">", right: { kind: "highest", period: 20 } }] }, exit: undefined, stopLossPct: 3, takeProfitPct: undefined, trailingStopPct: 5 } as Strategy]) {
    const whole = backtest(s, bars, 10_000).trades.filter((t) => t.why !== "end");
    const st = startState(10_000);
    const live: Trade[] = [];
    for (let i = 0; i < bars.length; i++) {
      const sofar = bars.slice(0, i + 1);
      live.push(...step(s, st, sofar, i, (x) => seriesOf(x, sofar)));
    }
    assert.ok(whole.length >= 3, `${s.name}: enough trades to mean something (${whole.length})`);
    assert.deepEqual(live, whole, `${s.name}: the same trades, bar by bar`);
  }
});
