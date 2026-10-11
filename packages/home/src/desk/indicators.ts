// The indicators a strategy is written with (PLAN 5.24), each a series as long as its input, NaN until it has enough
// bars: simple and exponential moving averages, RSI and ATR by Wilder's smoothing, MACD, Bollinger bands, the highest
// and lowest of the bars before, and the change over n bars. Pure, so a test holds each to known values.

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export function sma(xs: readonly number[], n: number): number[] {
  const out = new Array<number>(xs.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i]!;
    if (i >= n) sum -= xs[i - n]!;
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** An exponential moving average, seeded with the simple average of its first n values. */
export function ema(xs: readonly number[], n: number): number[] {
  const out = new Array<number>(xs.length).fill(NaN);
  const k = 2 / (n + 1);
  let prev = NaN;
  let start = xs.findIndex((x) => !Number.isNaN(x)); // a series that begins with NaN (a MACD line) starts where it begins
  if (start < 0) return out;
  for (let i = start; i < xs.length; i++) {
    if (i < start + n - 1) continue;
    if (i === start + n - 1) {
      let s = 0;
      for (let j = start; j <= i; j++) s += xs[j]!;
      prev = s / n;
    } else prev = xs[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI: the first average gain and loss over n changes, then smoothed (n - 1)/n. */
export function rsi(closes: readonly number[], n = 14): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  const value = (): number => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[n] = value();
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    gain = (gain * (n - 1) + Math.max(0, d)) / n;
    loss = (loss * (n - 1) + Math.max(0, -d)) / n;
    out[i] = value();
  }
  return out;
}

export function macd(closes: readonly number[], fast = 12, slow = 26, signal = 9): { line: number[]; signal: number[]; hist: number[] } {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = closes.map((_, i) => f[i]! - s[i]!);
  const sig = ema(line, signal);
  return { line, signal: sig, hist: line.map((x, i) => x - sig[i]!) };
}

/** Bollinger bands: the n-bar average, and k population standard deviations either side of it. */
export function bollinger(closes: readonly number[], n = 20, k = 2): { mid: number[]; upper: number[]; lower: number[] } {
  const mid = sma(closes, n);
  const upper = new Array<number>(closes.length).fill(NaN);
  const lower = new Array<number>(closes.length).fill(NaN);
  for (let i = n - 1; i < closes.length; i++) {
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (closes[j]! - mid[i]!) ** 2;
    const sd = Math.sqrt(v / n);
    upper[i] = mid[i]! + k * sd;
    lower[i] = mid[i]! - k * sd;
  }
  return { mid, upper, lower };
}

/** Wilder's average true range. */
export function atr(c: readonly Candle[], n = 14): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  if (c.length <= n) return out;
  const tr = c.map((x, i) => (i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1]!.c), Math.abs(x.l - c[i - 1]!.c))));
  let a = 0;
  for (let i = 1; i <= n; i++) a += tr[i]!;
  a /= n;
  out[n] = a;
  for (let i = n + 1; i < c.length; i++) out[i] = a = (a * (n - 1) + tr[i]!) / n;
  return out;
}

/** The highest of the n bars BEFORE each bar (a breakout is a close above it): the bar itself is never in it. */
export function highestBefore(xs: readonly number[], n: number): number[] {
  return xs.map((_, i) => (i < n ? NaN : Math.max(...xs.slice(i - n, i))));
}
export function lowestBefore(xs: readonly number[], n: number): number[] {
  return xs.map((_, i) => (i < n ? NaN : Math.min(...xs.slice(i - n, i))));
}

/** The change over n bars, in percent. */
export function change(xs: readonly number[], n: number): number[] {
  return xs.map((x, i) => (i < n ? NaN : ((x - xs[i - n]!) / xs[i - n]!) * 100));
}
