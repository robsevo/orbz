// A strategy as rules by code (PLAN 5.24; owner, 10-10: orbs trained on your own strategies, live on paper): when to
// buy, when to sell, a stop, a target, a trailing stop, how much of the account a trade takes. Written by you in the
// builder or proposed by a strategist orb (`propose_strategy`), checked here, said back in plain words, and run by ONE
// simulator step, bar by bar, for the backtest and for a live paper run alike: a signal is read at a bar's close and
// fills at the next bar's open (nothing ever reads a bar that has not happened), with the fee and the slippage paid on
// each side; a stop and a target are checked against each later bar's low and high, the stop first when a bar reaches
// both. Long only: what a wallet can do with a swap is buy and sell, not short.
import { atr, bollinger, change, ema, highestBefore, lowestBefore, macd, rsi, sma, type Candle } from "./indicators.ts";
import { readTokenKey } from "./dex.ts";

export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export const TIMEFRAME_MS: Record<Timeframe, number> = { "1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };

export type Series =
  | { kind: "price"; field: "open" | "high" | "low" | "close" | "volume" }
  | { kind: "sma" | "ema"; period: number }
  | { kind: "rsi"; period: number }
  | { kind: "macd" | "macd_signal" | "macd_hist"; fast?: number; slow?: number; signal?: number }
  | { kind: "bb_upper" | "bb_middle" | "bb_lower"; period: number; k?: number }
  | { kind: "atr"; period: number }
  | { kind: "highest" | "lowest"; period: number; field?: "high" | "low" | "close" }
  | { kind: "change"; period: number }
  | { kind: "value"; value: number };
export const OPS = [">", "<", ">=", "<=", "crosses_above", "crosses_below"] as const;
export type Op = (typeof OPS)[number];
export type Condition = { left: Series; op: Op; right: Series };
export type Rules = { all: Condition[] } | { any: Condition[] };
export type Strategy = {
  name: string;
  symbol: string;
  timeframe: Timeframe;
  entry: Rules;
  exit?: Rules;
  /** Sell when the price falls this many percent under what was paid. */
  stopLossPct?: number;
  /** Sell when it rises this many percent over. */
  takeProfitPct?: number;
  /** Sell when it falls this many percent under its best since buying. */
  trailingStopPct?: number;
  /** How much of the account a trade takes, in percent. */
  sizePct: number;
  /** The fee and the slippage each way, in basis points (a DEX swap: 0.3% and 0.1% are its usual; PLAN 5.27). */
  feeBps?: number;
  slippageBps?: number;
};

/** The symbols a strategy can trade, as the market feed names them. */
export const SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "LINK", "DOGE", "AVAX", "UNI", "AAVE"] as const;

// ── checking ──────────────────────────────────────────────────────────────────────────────────────
const int = (v: unknown, lo: number, hi: number): boolean => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const num = (v: unknown, lo: number, hi: number): boolean => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

function seriesProblem(s: unknown, where: string): string | null {
  if (!s || typeof s !== "object") return `${where} is missing`;
  const x = s as Record<string, unknown>;
  switch (x.kind) {
    case "price":
      return ["open", "high", "low", "close", "volume"].includes(String(x.field)) ? null : `${where}: a price is its open, high, low, close or volume`;
    case "sma": case "ema": case "rsi": case "atr": case "change":
      return int(x.period, 1, 400) ? null : `${where}: a ${String(x.kind)}'s period is a whole number of bars, 1 to 400`;
    case "macd": case "macd_signal": case "macd_hist":
      return [x.fast, x.slow, x.signal].every((p) => p === undefined || int(p, 1, 200)) && (x.fast === undefined || x.slow === undefined || (x.fast as number) < (x.slow as number)) ? null : `${where}: MACD's periods are 1 to 200, the fast under the slow`;
    case "bb_upper": case "bb_middle": case "bb_lower":
      return int(x.period, 2, 400) && (x.k === undefined || num(x.k, 0.5, 5)) ? null : `${where}: Bollinger bands take a period of 2 to 400 bars and k from 0.5 to 5`;
    case "highest": case "lowest":
      return int(x.period, 1, 400) && (x.field === undefined || ["high", "low", "close"].includes(String(x.field))) ? null : `${where}: the highest or lowest of 1 to 400 bars before, of their high, low or close`;
    case "value":
      return num(x.value, -1e12, 1e12) ? null : `${where}: a value is a number`;
    default:
      return `${where}: "${String(x.kind)}" is not something a strategy can read (price, sma, ema, rsi, macd, macd_signal, macd_hist, bb_upper, bb_middle, bb_lower, atr, highest, lowest, change, value)`;
  }
}

function rulesProblem(r: unknown, what: string): string | null {
  if (!r || typeof r !== "object") return `${what} is missing`;
  const list = (r as { all?: unknown }).all ?? (r as { any?: unknown }).any;
  if (!Array.isArray(list) || !list.length || list.length > 8) return `${what} is "all" or "any" of 1 to 8 conditions`;
  for (const [i, c] of list.entries()) {
    const where = `${what}, condition ${i + 1}`;
    if (!c || typeof c !== "object") return `${where} is missing`;
    const p = seriesProblem((c as Condition).left, `${where}'s left side`) ?? seriesProblem((c as Condition).right, `${where}'s right side`);
    if (p) return p;
    if (!OPS.includes((c as Condition).op)) return `${where}: its test is one of ${OPS.join(", ")}`;
  }
  return null;
}

/** Why a strategy cannot run, or null when it can. */
export function problemOf(s: unknown): string | null {
  if (!s || typeof s !== "object") return "a strategy is an object";
  const x = s as Strategy;
  if (typeof x.name !== "string" || !x.name.trim() || x.name.length > 60) return "a strategy needs a name, 60 letters at most";
  if (!(SYMBOLS as readonly string[]).includes(x.symbol) && !readTokenKey(String(x.symbol))) return `it trades one of ${SYMBOLS.join(", ")}, or any token by its chain and address ("solana:<mint>")`;
  if (!TIMEFRAMES.includes(x.timeframe)) return `its bars are ${TIMEFRAMES.join(", ")}`;
  const e = rulesProblem(x.entry, "when to buy") ?? (x.exit === undefined ? null : rulesProblem(x.exit, "when to sell"));
  if (e) return e;
  if (!num(x.sizePct, 1, 100)) return "a trade takes 1 to 100 percent of the account";
  for (const [k, lo, hi] of [["stopLossPct", 0.1, 50], ["takeProfitPct", 0.1, 500], ["trailingStopPct", 0.1, 50]] as const)
    if (x[k] !== undefined && !num(x[k], lo, hi)) return `${k} is ${lo} to ${hi} percent`;
  if (x.exit === undefined && x.stopLossPct === undefined && x.takeProfitPct === undefined && x.trailingStopPct === undefined) return "it needs a way out: a rule to sell, a stop, a target or a trailing stop";
  if (x.feeBps !== undefined && !num(x.feeBps, 0, 300)) return "its fee is 0 to 300 basis points";
  if (x.slippageBps !== undefined && !num(x.slippageBps, 0, 300)) return "its slippage is 0 to 300 basis points";
  return null;
}

// ── in words ──────────────────────────────────────────────────────────────────────────────────────
export function seriesWords(s: Series): string {
  switch (s.kind) {
    case "price": return `the ${s.field}`;
    case "sma": return `the ${s.period}-bar average`;
    case "ema": return `the ${s.period}-bar EMA`;
    case "rsi": return `RSI(${s.period})`;
    case "macd": return "MACD";
    case "macd_signal": return "MACD's signal";
    case "macd_hist": return "MACD's histogram";
    case "bb_upper": return `the upper band (${s.period}, ${s.k ?? 2})`;
    case "bb_middle": return `the middle band (${s.period})`;
    case "bb_lower": return `the lower band (${s.period}, ${s.k ?? 2})`;
    case "atr": return `ATR(${s.period})`;
    case "highest": return `the highest ${s.field ?? "high"} of the ${s.period} bars before`;
    case "lowest": return `the lowest ${s.field ?? "low"} of the ${s.period} bars before`;
    case "change": return `the change over ${s.period} bars (%)`;
    case "value": return String(s.value);
  }
}
const OP_WORDS: Record<Op, string> = { ">": "is above", "<": "is below", ">=": "is at or above", "<=": "is at or below", crosses_above: "crosses above", crosses_below: "crosses below" };
const rulesWords = (r: Rules): string => {
  const list = "all" in r ? r.all : r.any;
  return list.map((c) => `${seriesWords(c.left)} ${OP_WORDS[c.op]} ${seriesWords(c.right)}`).join("all" in r ? " and " : " or ");
};
/** A strategy said back: what it buys, when, how it gets out, and how much a trade takes. */
export function words(s: Strategy): string {
  const outs = [
    s.exit && `when ${rulesWords(s.exit)}`,
    s.stopLossPct !== undefined && `at a ${s.stopLossPct}% stop`,
    s.takeProfitPct !== undefined && `at a ${s.takeProfitPct}% target`,
    s.trailingStopPct !== undefined && `on a ${s.trailingStopPct}% trailing stop`,
  ].filter(Boolean);
  return `Buy ${s.symbol} on ${s.timeframe} bars when ${rulesWords(s.entry)}; sell ${outs.join(", or ")}. Each trade takes ${s.sizePct}% of the account.`;
}

// ── the series a strategy reads ───────────────────────────────────────────────────────────────────
const field = (c: readonly Candle[], f: "open" | "high" | "low" | "close" | "volume"): number[] => c.map((x) => (f === "open" ? x.o : f === "high" ? x.h : f === "low" ? x.l : f === "close" ? x.c : x.v));
export function seriesOf(s: Series, c: readonly Candle[]): number[] {
  const close = field(c, "close");
  switch (s.kind) {
    case "price": return field(c, s.field);
    case "sma": return sma(close, s.period);
    case "ema": return ema(close, s.period);
    case "rsi": return rsi(close, s.period);
    case "macd": return macd(close, s.fast, s.slow, s.signal).line;
    case "macd_signal": return macd(close, s.fast, s.slow, s.signal).signal;
    case "macd_hist": return macd(close, s.fast, s.slow, s.signal).hist;
    case "bb_upper": return bollinger(close, s.period, s.k).upper;
    case "bb_middle": return bollinger(close, s.period, s.k).mid;
    case "bb_lower": return bollinger(close, s.period, s.k).lower;
    case "atr": return atr(c, s.period);
    case "highest": return highestBefore(field(c, s.field ?? "high"), s.period);
    case "lowest": return lowestBefore(field(c, s.field ?? "low"), s.period);
    case "change": return change(close, s.period);
    case "value": return c.map(() => s.value);
  }
}

/** Whether rules hold at bar i, from series computed once over the bars up to and including i. */
function holds(r: Rules, at: (s: Series) => number[], i: number): boolean {
  const test = (c: Condition): boolean => {
    const L = at(c.left);
    const R = at(c.right);
    const [l, rr] = [L[i]!, R[i]!];
    if (Number.isNaN(l) || Number.isNaN(rr)) return false;
    switch (c.op) {
      case ">": return l > rr;
      case "<": return l < rr;
      case ">=": return l >= rr;
      case "<=": return l <= rr;
      case "crosses_above": return i > 0 && L[i - 1]! <= R[i - 1]! && l > rr;
      case "crosses_below": return i > 0 && L[i - 1]! >= R[i - 1]! && l < rr;
    }
  };
  return "all" in r ? r.all.every(test) : r.any.some(test);
}

// ── the one simulator ─────────────────────────────────────────────────────────────────────────────
export type Trade = { entryT: number; entryPx: number; exitT: number; exitPx: number; qty: number; pnl: number; pnlPct: number; fees: number; why: "rule" | "stop" | "target" | "trailing" | "end" | "stopped" };
export type SimState = {
  cash: number;
  qty: number;
  entryPx: number;
  entryT: number;
  best: number;
  feesPaid: number;
  /** what was decided at the last bar's close, to fill at the next bar's open */
  pending: "buy" | "sell" | null;
  /** the last bar stepped (its open time) */
  last: number | null;
};
export const startState = (cash: number): SimState => ({ cash, qty: 0, entryPx: 0, entryT: 0, best: 0, feesPaid: 0, pending: null, last: null });

/** Sells the whole position at `px` (before slippage), the fee paid: every sale, the backtest's and the live desk's. */
export function sellAt(s: Strategy, st: SimState, px: number, t: number, why: Trade["why"]): Trade {
  const slip = (s.slippageBps ?? 10) / 10_000;
  const got = st.qty * px * (1 - slip);
  const f = got * ((s.feeBps ?? 30) / 10_000);
  const pnl = got - f - st.qty * st.entryPx;
  const trade: Trade = { entryT: st.entryT, entryPx: st.entryPx, exitT: t, exitPx: px * (1 - slip), qty: st.qty, pnl, pnlPct: (pnl / (st.qty * st.entryPx)) * 100, fees: f, why };
  st.cash += got - f;
  st.feesPaid += f;
  st.qty = 0;
  st.pending = null;
  return trade;
}

/** Steps bar i: fills what the last close decided at this bar's open, keeps the stops in this bar, then reads this bar's
 * close. `at` gives a series computed over bars 0..i at most (never later: the live desk has no later). */
export function step(s: Strategy, st: SimState, c: readonly Candle[], i: number, at: (x: Series) => number[]): Trade[] {
  const bar = c[i]!;
  const fee = (s.feeBps ?? 30) / 10_000;
  const slip = (s.slippageBps ?? 10) / 10_000;
  const trades: Trade[] = [];
  const sell = (px: number, why: Trade["why"]): void => void trades.push(sellAt(s, st, px, bar.t, why));
  // the open: what the last close decided
  if (st.pending === "buy" && st.qty === 0) {
    const spend = st.cash * (s.sizePct / 100);
    const px = bar.o * (1 + slip);
    const f = spend * fee;
    // the entry price carries the fee, so a trade's profit is after both fees
    st.qty = (spend - f) / px;
    st.entryPx = spend / st.qty;
    st.entryT = bar.t;
    st.best = bar.o;
    st.cash -= spend;
    st.feesPaid += f;
  } else if (st.pending === "sell" && st.qty > 0) sell(bar.o, "rule");
  st.pending = null;
  // inside the bar: the stop first when it reaches both (the careful assumption), then the target, then the trailing stop
  if (st.qty > 0) {
    const paid = st.entryPx;
    const stop = s.stopLossPct !== undefined ? paid * (1 - s.stopLossPct / 100) : -Infinity;
    const target = s.takeProfitPct !== undefined ? paid * (1 + s.takeProfitPct / 100) : Infinity;
    const trail = s.trailingStopPct !== undefined ? st.best * (1 - s.trailingStopPct / 100) : -Infinity;
    if (bar.l <= stop) sell(Math.min(bar.o, stop), "stop");
    else if (bar.l <= trail) sell(Math.min(bar.o, trail), "trailing");
    else if (bar.h >= target) sell(Math.max(bar.o, target), "target");
    else st.best = Math.max(st.best, bar.h);
  }
  // the close: decide for the next bar
  if (st.qty === 0 && holds(s.entry, at, i)) st.pending = "buy";
  else if (st.qty > 0 && s.exit && holds(s.exit, at, i)) st.pending = "sell";
  st.last = bar.t;
  return trades;
}

export type Backtest = {
  trades: Trade[];
  equity: { t: number; equity: number }[];
  metrics: { returnPct: number; holdPct: number; maxDrawdownPct: number; trades: number; winRate: number | null; profitFactor: number | null; avgTradePct: number | null; exposurePct: number; feesPaid: number };
};

/** The strategy over these bars from `cash`; an open position is sold at the last close. */
export function backtest(s: Strategy, c: readonly Candle[], cash = 10_000): Backtest {
  const cache = new Map<string, number[]>();
  const at = (x: Series): number[] => {
    const k = JSON.stringify(x);
    return cache.get(k) ?? cache.set(k, seriesOf(x, c)).get(k)!;
  };
  const st = startState(cash);
  const trades: Trade[] = [];
  const equity: { t: number; equity: number }[] = [];
  let peak = cash;
  let maxDd = 0;
  let held = 0;
  for (let i = 0; i < c.length; i++) {
    trades.push(...step(s, st, c, i, at));
    if (st.qty > 0) held++;
    const eq = st.cash + st.qty * c[i]!.c;
    equity.push({ t: c[i]!.t, equity: eq });
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, (peak - eq) / peak);
  }
  if (st.qty > 0 && c.length) {
    const last = c[c.length - 1]!;
    trades.push(sellAt(s, st, last.c, last.t, "end"));
    equity[equity.length - 1] = { t: last.t, equity: st.cash };
  }
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const lost = -losses.reduce((n, t) => n + t.pnl, 0);
  const end = equity.at(-1)?.equity ?? cash;
  return {
    trades,
    equity,
    metrics: {
      returnPct: ((end - cash) / cash) * 100,
      holdPct: c.length > 1 ? ((c[c.length - 1]!.c - c[0]!.o) / c[0]!.o) * 100 : 0,
      maxDrawdownPct: maxDd * 100,
      trades: trades.length,
      winRate: trades.length ? wins.length / trades.length : null,
      profitFactor: lost > 0 ? wins.reduce((n, t) => n + t.pnl, 0) / lost : null,
      avgTradePct: trades.length ? trades.reduce((n, t) => n + t.pnlPct, 0) / trades.length : null,
      exposurePct: c.length ? (held / c.length) * 100 : 0,
      feesPaid: st.feesPaid,
    },
  };
}
