// The desk's research (PLAN 5.40; owner, 10-11: three more of the desk's jobs, "like a real ... firm"): what its
// researchers and developers do with a market's history, by code. An event study: each time a condition first held,
// what the price did over the bars after, against what it did after any bar (the base rate), and how sure that is.
// Strategies compared honestly: one simulation over all the bars, each judged on the earlier part it was chosen on and on
// the later part it never saw. One strategy stressed: its fees and slippage doubled and tripled, each half of its history
// alone, the same rules on other bars (its neighbouring timeframes, other markets). Pure over the bars handed in, so a
// test holds it; the tools (tools.ts) fetch the bars.
import type { Candle } from "./indicators.ts";
import { backtest, holds, seriesOf, type Backtest, type Rules, type Series, type Strategy } from "./strategy.ts";

const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : null);
const median = (xs: readonly number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const stdev = (xs: readonly number[]): number | null => {
  const m = mean(xs);
  if (m === null || xs.length < 2) return null;
  return Math.sqrt(xs.reduce((n, x) => n + (x - m) ** 2, 0) / (xs.length - 1));
};

export type After = {
  /** bars after the event */
  bars: number;
  /** the events far enough from the end to have that many bars after them */
  n: number;
  avgPct: number | null; medianPct: number | null; upRate: number | null;
  /** what followed any bar: the base rate the events are measured against */
  basePct: number | null; baseUpRate: number | null;
  /** the events' average less the base rate's, in standard errors of the events' moves (above 2 or under -2: unlikely
   * to be chance alone; the moves of events closer than `bars` overlap, which makes it look surer than it is) */
  t: number | null;
};
export type EventStudy = { bars: number; events: number; after: After[]; latest: { t: number; px: number }[] };

/** What followed each time `when` first held: a bar where it holds and did not at the bar before (one event a stretch). */
export function eventStudy(when: Rules, c: readonly Candle[], horizons: readonly number[]): EventStudy {
  const cache = new Map<string, number[]>();
  const at = (x: Series): number[] => {
    const k = JSON.stringify(x);
    return cache.get(k) ?? cache.set(k, seriesOf(x, c)).get(k)!;
  };
  const starts: number[] = [];
  let before = false;
  for (let i = 0; i < c.length; i++) {
    const now = holds(when, at, i);
    if (now && !before) starts.push(i);
    before = now;
  }
  const move = (i: number, h: number): number | null => (i + h < c.length && c[i]!.c > 0 ? ((c[i + h]!.c - c[i]!.c) / c[i]!.c) * 100 : null);
  const after = horizons.map((h): After => {
    const ev = starts.map((i) => move(i, h)).filter((x): x is number => x !== null);
    const base: number[] = [];
    for (let i = 0; i + h < c.length; i++) base.push(move(i, h)!);
    const avg = mean(ev);
    const b = mean(base);
    const sd = stdev(ev);
    return {
      bars: h, n: ev.length, avgPct: avg, medianPct: median(ev), upRate: ev.length ? ev.filter((x) => x > 0).length / ev.length : null,
      basePct: b, baseUpRate: base.length ? base.filter((x) => x > 0).length / base.length : null,
      // moves all alike have no spread to measure against (their rounding is not one)
      t: avg !== null && b !== null && sd !== null && sd > 1e-9 ? (avg - b) / (sd / Math.sqrt(ev.length)) : null,
    };
  });
  return { bars: c.length, events: starts.length, after, latest: starts.slice(-5).reverse().map((i) => ({ t: c[i]!.t, px: c[i]!.c })) };
}

/** A part of one simulation: its return from where the part began, its deepest fall in it, and the trades entered in it. */
export type Part = { returnPct: number; maxDrawdownPct: number; trades: number; winRate: number | null; profitFactor: number | null; avgTradePct: number | null };

/** The part of a backtest from time `from` (inclusive) to `to` (exclusive), as if begun with what it had at `from`. */
export function partOf(bt: Backtest, from: number, to: number, cash = 10_000): Part {
  const before = bt.equity.filter((e) => e.t < from).at(-1)?.equity ?? cash;
  const inside = bt.equity.filter((e) => e.t >= from && e.t < to);
  let peak = before;
  let fall = 0;
  for (const e of inside) {
    peak = Math.max(peak, e.equity);
    fall = Math.max(fall, (peak - e.equity) / peak);
  }
  const end = inside.at(-1)?.equity ?? before;
  const trades = bt.trades.filter((t) => t.entryT >= from && t.entryT < to);
  const won = trades.filter((t) => t.pnl > 0);
  const lost = -trades.filter((t) => t.pnl <= 0).reduce((n, t) => n + t.pnl, 0);
  return {
    returnPct: before > 0 ? ((end - before) / before) * 100 : 0,
    maxDrawdownPct: fall * 100,
    trades: trades.length,
    winRate: trades.length ? won.length / trades.length : null,
    profitFactor: lost > 0 ? won.reduce((n, t) => n + t.pnl, 0) / lost : null,
    avgTradePct: mean(trades.map((t) => t.pnlPct)),
  };
}

export type Compared = {
  /** the bar the later part begins at, and how many bars each part has */
  splitAt: number; fitBars: number; testBars: number;
  rows: { name: string; fit: Part; test: Part }[];
  /** the one best on the earlier part, and how it did on the later */
  best: string | null;
  warning: string | null;
};

/** Strategies over the same bars, each judged on the earlier `split` of them (where a choice among them is made) and on
 * the rest (which that choice never saw). One simulation each over all the bars: the later part keeps its indicators'
 * history and anything still held across the line. */
export function compareFitted(strategies: readonly Strategy[], c: readonly Candle[], split = 0.7): Compared {
  const cut = Math.min(c.length - 1, Math.max(1, Math.floor(c.length * split)));
  const at = c[cut]?.t ?? Infinity;
  const rows = strategies.map((s) => {
    const bt = backtest(s, c);
    return { name: s.name, fit: partOf(bt, -Infinity, at), test: partOf(bt, at, Infinity) };
  });
  const best = [...rows].sort((a, b) => b.fit.returnPct - a.fit.returnPct)[0] ?? null;
  const rank = best ? [...rows].sort((a, b) => b.test.returnPct - a.test.returnPct).indexOf(best) + 1 : 0;
  const warning = !best
    ? null
    : best.fit.returnPct > 0 && best.test.returnPct < 0
      ? `${best.name} was best on the earlier part and lost money on the part it never saw: fitted to the past, not an edge`
      : rows.length > 2 && rank > Math.ceil(rows.length / 2)
        ? `${best.name} was best on the earlier part and only ${rank} of ${rows.length} on the part it never saw: its lead did not carry`
        : null;
  return { splitAt: at, fitBars: cut, testBars: c.length - cut, rows, best: best?.name ?? null, warning };
}

export type Stressed = {
  base: Part & { holdPct: number };
  /** its fees and slippage doubled, and tripled */
  costs2: Part; costs3: Part;
  firstHalf: Part; secondHalf: Part;
  /** the same rules on other bars: its neighbouring timeframes, other markets */
  others: { label: string; part: Part | null; holdPct: number | null }[];
  verdicts: string[];
};

const FEE_BPS = 30;
const SLIP_BPS = 10;

/** One strategy stressed, as a developer tests it before it runs: does its edge outlast its costs, both halves of its
 * history, and other bars? */
export function stress(s: Strategy, c: readonly Candle[], others: readonly { label: string; bars: readonly Candle[] }[] = []): Stressed {
  const whole = (x: Strategy, bars: readonly Candle[]): Part & { holdPct: number } => {
    const bt = backtest(x, bars);
    return { ...partOf(bt, -Infinity, Infinity), holdPct: bt.metrics.holdPct };
  };
  const costs = (k: number): Strategy => ({ ...s, feeBps: (s.feeBps ?? FEE_BPS) * k, slippageBps: (s.slippageBps ?? SLIP_BPS) * k });
  const base = whole(s, c);
  const bt = backtest(s, c);
  const mid = c[Math.floor(c.length / 2)]?.t ?? Infinity;
  const firstHalf = partOf(bt, -Infinity, mid);
  const secondHalf = partOf(bt, mid, Infinity);
  const costs2 = whole(costs(2), c);
  const costs3 = whole(costs(3), c);
  const rest = others.map((o) => (o.bars.length > 1 ? (() => {
    const w = whole(s, o.bars);
    return { label: o.label, part: w as Part, holdPct: w.holdPct };
  })() : { label: o.label, part: null, holdPct: null }));
  const verdicts: string[] = [];
  if (base.trades < 10) verdicts.push(`Only ${base.trades} trade${base.trades === 1 ? "" : "s"}: too few to say much either way.`);
  if (base.returnPct > 0 && costs2.returnPct <= 0) verdicts.push("Its edge is no bigger than its costs: with fees and slippage doubled it loses money.");
  else if (base.returnPct > 0 && costs3.returnPct > 0) verdicts.push("It still makes money with fees and slippage tripled.");
  if ((firstHalf.returnPct > 0) !== (secondHalf.returnPct > 0)) verdicts.push(`It made money in one half of the history only (${firstHalf.returnPct.toFixed(1)}% then ${secondHalf.returnPct.toFixed(1)}%).`);
  if (base.returnPct < base.holdPct) verdicts.push(`Holding the coin did better (${base.holdPct.toFixed(1)}% against ${base.returnPct.toFixed(1)}%).`);
  const measured = rest.filter((r) => r.part !== null);
  if (measured.length) verdicts.push(`It made money on ${measured.filter((r) => r.part!.returnPct > 0).length} of ${measured.length} other timeframes and markets.`);
  return { base, costs2, costs3, firstHalf, secondHalf, others: rest, verdicts };
}
