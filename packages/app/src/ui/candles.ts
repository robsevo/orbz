// The candlestick chart's arithmetic (PLAN 5.23), pure so a test can hold it: the price range a chart shows (the bars'
// highs and lows and any lines over them, a little room above and below), its round ticks, a price written as a market's
// screen shows it, a bar's time as its timeframe says it, and the time axis's round times.

/** A range with room: 4% of it above and below (a flat market gets a range of its own). */
export function rangeOf(values: readonly number[]): { lo: number; hi: number } {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { lo: 0, hi: 1 };
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (hi === lo) {
    const pad = Math.abs(hi) * 0.01 || 1;
    return { lo: lo - pad, hi: hi + pad };
  }
  const pad = (hi - lo) * 0.04;
  lo -= pad;
  hi += pad;
  return { lo, hi };
}

/** About `count` round ticks inside [lo, hi]: steps of 1, 2 or 5 times a power of ten. */
export function ticksOf(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** A price as a market's screen shows it: whole dollars with separators when large, more places as it gets small. */
export function priceText(p: number): string {
  if (!Number.isFinite(p)) return "–";
  const a = Math.abs(p);
  const places = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return p.toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places });
}

/** A change in percent, its sign always shown. */
export const changeText = (pct: number): string => `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%`;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const dayText = (t: number): string => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const clockText = (t: number): string => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** A bar's time as its timeframe says it: its day and its time for intraday bars, its day for daily ones. */
export function timeText(t: number, tf: string): string {
  return tf === "1d" ? dayText(t) : `${dayText(t)} ${clockText(t)}`;
}

/** The round steps of time the axis counts in; past two weeks, months. */
const STEPS = [MIN, 5 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY];

/** The time axis's labels, about `count` of them: each where a round step of time begins on this device's clock (an
 * hour, six, a day, a week, a month), a step that holds whole bars, so they run forward evenly and say what they mean;
 * a day's start is written as the day. */
export function timeTicks(times: readonly number[], count = 5): { i: number; text: string }[] {
  const n = times.length;
  if (n < 2) return [];
  let gap = Infinity; // the bars' spacing
  for (let i = 1; i < n; i++) if (times[i]! > times[i - 1]!) gap = Math.min(gap, times[i]! - times[i - 1]!);
  const span = times[n - 1]! - times[0]!;
  const step = STEPS.find((s) => s >= span / Math.max(1, count) && s >= gap && s % gap === 0) ?? 0; // 0: months
  const local = (t: number): number => t - new Date(t).getTimezoneOffset() * MIN;
  const bucket = (t: number): number => {
    if (!step) return new Date(t).getFullYear() * 12 + new Date(t).getMonth();
    if (step >= 7 * DAY) return Math.floor(Math.floor((local(t) / DAY + 3) / 7) / (step / (7 * DAY))); // weeks from a Monday
    return Math.floor(local(t) / step);
  };
  const out: { i: number; text: string }[] = [];
  for (let i = 1; i < n; i++) {
    const t = times[i]!;
    if (bucket(t) === bucket(times[i - 1]!)) continue;
    const month = new Date(t);
    const text = !step
      ? month.getMonth() === 0 ? String(month.getFullYear()) : month.toLocaleDateString("en-GB", { month: "short" })
      : step >= DAY || local(t) % DAY === 0 ? dayText(t) : clockText(t);
    out.push({ i, text });
  }
  return out;
}
