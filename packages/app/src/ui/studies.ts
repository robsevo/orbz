// What a chart can add (PLAN 5.32; owner, 10-11: "right click and add lets say indicators"): moving averages, Bollinger
// bands and VWAP over the price, RSI and MACD in panes of their own under it, each by its textbook definition, the one
// the home's strategies read (home desk/indicators.ts; test/studies.test.ts holds them alike on the same bars); which
// are on, with their numbers and colours, kept in this browser. Pure, so a test can hold it.
import { HUES, type HueName } from "../design/tokens.ts";
import type { DeskCandle } from "../home/link.ts";

export type StudyKind = "ema" | "sma" | "bb" | "vwap" | "rsi" | "macd";
/** A study on the chart: its kind, its numbers (a period; Bollinger's width; MACD's three) and its colour. */
export type Study = { id: string; kind: StudyKind; n: number[]; hue: HueName };
export type Num = { label: string; value: number; min: number; max: number; step: number };

export const STUDIES: Record<StudyKind, { name: string; short: string; on: "price" | "pane"; numbers: Num[] }> = {
  ema: { name: "Exponential moving average", short: "EMA", on: "price", numbers: [{ label: "Bars", value: 20, min: 2, max: 400, step: 1 }] },
  sma: { name: "Moving average", short: "MA", on: "price", numbers: [{ label: "Bars", value: 50, min: 2, max: 400, step: 1 }] },
  bb: { name: "Bollinger Bands", short: "BB", on: "price", numbers: [{ label: "Bars", value: 20, min: 2, max: 400, step: 1 }, { label: "Width", value: 2, min: 0.5, max: 5, step: 0.5 }] },
  vwap: { name: "VWAP, each UTC day", short: "VWAP", on: "price", numbers: [] },
  rsi: { name: "Relative strength (RSI)", short: "RSI", on: "pane", numbers: [{ label: "Bars", value: 14, min: 2, max: 100, step: 1 }] },
  macd: { name: "MACD", short: "MACD", on: "pane", numbers: [{ label: "Fast", value: 12, min: 2, max: 100, step: 1 }, { label: "Slow", value: 26, min: 3, max: 200, step: 1 }, { label: "Signal", value: 9, min: 2, max: 50, step: 1 }] },
};
export const KINDS = Object.keys(STUDIES) as StudyKind[];

/** The colours studies take, in turn: none the theme's rising green or falling red. */
export const PALETTE: HueName[] = ["amber", "violet", "cyan", "pink", "cornflower", "marigold", "orchid", "teal", "lavender", "apricot"];

/** A study as its legend names it: "EMA 20", "BB 20 2", "VWAP", "MACD 12 26 9". */
export const studyLabel = (s: Study): string => [STUDIES[s.kind].short, ...s.n].join(" ");

/** The list with one more of `kind`, at its usual numbers, in the first colour not yet worn. */
export function withStudy(list: readonly Study[], kind: StudyKind): Study[] {
  const worn = new Set(list.map((s) => s.hue));
  const hue = PALETTE.find((h) => !worn.has(h)) ?? PALETTE[list.length % PALETTE.length]!;
  let k = list.length + 1;
  while (list.some((s) => s.id === `${kind}${k}`)) k++;
  return [...list, { id: `${kind}${k}`, kind, n: STUDIES[kind].numbers.map((x) => x.value), hue }];
}
/** What a chart opens with before anything is chosen: the 20 and 50-bar EMAs it always had. */
export const FIRST: Study[] = [{ id: "ema1", kind: "ema", n: [20], hue: "amber" }, { id: "ema2", kind: "ema", n: [50], hue: "violet" }];

/** A study's numbers as its kind allows them (a slow MACD slower than its fast one), or null when one is not a number. */
export function saneNumbers(kind: StudyKind, n: readonly number[]): number[] | null {
  const spec = STUDIES[kind].numbers;
  if (n.length !== spec.length || n.some((x) => !Number.isFinite(x))) return null;
  const out = n.map((x, i) => Math.min(spec[i]!.max, Math.max(spec[i]!.min, spec[i]!.step === 1 ? Math.round(x) : Math.round(x / spec[i]!.step) * spec[i]!.step)));
  if (kind === "macd" && out[1]! <= out[0]!) out[1] = Math.min(spec[1]!.max, out[0]! + 1);
  return out;
}

// ── the indicators, as the home reads them ─────────────────────────────────────────────────────────
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

/** Seeded with the simple average of its first n values; a series that begins with gaps (MACD's) begins where it does. */
export function ema(xs: readonly number[], n: number): number[] {
  const out = new Array<number>(xs.length).fill(NaN);
  const k = 2 / (n + 1);
  const start = xs.findIndex((x) => !Number.isNaN(x));
  if (start < 0) return out;
  let prev = NaN;
  for (let i = start + n - 1; i < xs.length; i++) {
    if (i === start + n - 1) {
      let s = 0;
      for (let j = start; j <= i; j++) s += xs[j]!;
      prev = s / n;
    } else prev = xs[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's: the first average gain and loss over n changes, then smoothed by (n - 1)/n. */
export function rsi(closes: readonly number[], n: number): number[] {
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

export function macd(closes: readonly number[], fast: number, slow: number, signal: number): { line: number[]; signal: number[]; hist: number[] } {
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = closes.map((_, i) => f[i]! - s[i]!);
  const sig = ema(line, signal);
  return { line, signal: sig, hist: line.map((x, i) => x - sig[i]!) };
}

/** The n-bar average and k population standard deviations either side of it. */
export function bollinger(closes: readonly number[], n: number, k: number): { mid: number[]; upper: number[]; lower: number[] } {
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

const DAY = 86_400_000;
/** The volume-weighted average of each bar's typical price ((high + low + close) / 3), from the start of each UTC day;
 * none until a day has traded. */
export function vwap(c: readonly DeskCandle[]): number[] {
  let day = NaN;
  let pv = 0;
  let v = 0;
  return c.map((b) => {
    const d = Math.floor(b.t / DAY);
    if (d !== day) [day, pv, v] = [d, 0, 0];
    pv += ((b.h + b.l + b.c) / 3) * b.v;
    v += b.v;
    return v > 0 ? pv / v : NaN;
  });
}

/** What a study draws: its lines (over the price, or in its pane), a band filled between two of them, a histogram,
 * its levels and its pane's fixed scale. */
export type Drawn = { lines: { label: string; values: number[]; hue: HueName }[]; band?: [number[], number[]]; hist?: number[]; levels?: number[]; range?: { lo: number; hi: number } };

/** Second colours for a study that draws two lines (MACD's signal): the next in the palette. */
const second = (h: HueName): HueName => PALETTE[(PALETTE.indexOf(h) + 1) % PALETTE.length]!;

export function drawStudy(s: Study, c: readonly DeskCandle[]): Drawn {
  const close = c.map((b) => b.c);
  const [a = 0, b = 0, d = 0] = s.n;
  switch (s.kind) {
    case "ema": return { lines: [{ label: studyLabel(s), values: ema(close, a), hue: s.hue }] };
    case "sma": return { lines: [{ label: studyLabel(s), values: sma(close, a), hue: s.hue }] };
    case "bb": {
      const x = bollinger(close, a, b);
      return { lines: [{ label: "Upper", values: x.upper, hue: s.hue }, { label: "Middle", values: x.mid, hue: s.hue }, { label: "Lower", values: x.lower, hue: s.hue }], band: [x.upper, x.lower] };
    }
    case "vwap": return { lines: [{ label: "VWAP", values: vwap(c), hue: s.hue }] };
    case "rsi": return { lines: [{ label: studyLabel(s), values: rsi(close, a), hue: s.hue }], levels: [30, 70], range: { lo: 0, hi: 100 } };
    case "macd": {
      const x = macd(close, a, b, d);
      return { lines: [{ label: "MACD", values: x.line, hue: s.hue }, { label: "Signal", values: x.signal, hue: second(s.hue) }], hist: x.hist, levels: [0] };
    }
  }
}

// ── kept in this browser ───────────────────────────────────────────────────────────────────────────
const KEY = "orbs.chart";
export type Kept = { studies: Study[]; strategies: { id: number; mode: "paper" | "live" }[] };

/** What this browser's charts wear, read back and checked; the first chart's when nothing was kept (or it is not read). */
export function readKept(raw: string | null): Kept {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<Kept> | null;
    if (!v || !Array.isArray(v.studies)) return { studies: FIRST, strategies: [] };
    const studies = v.studies.flatMap((s): Study[] => {
      if (!s || typeof s.id !== "string" || !KINDS.includes(s.kind) || !Array.isArray(s.n) || !HUES.some((h) => h.name === s.hue)) return [];
      const n = saneNumbers(s.kind, s.n);
      return n ? [{ id: s.id.slice(0, 20), kind: s.kind, n, hue: s.hue }] : [];
    });
    const strategies = (Array.isArray(v.strategies) ? v.strategies : []).filter((x) => x && Number.isInteger(x.id) && (x.mode === "paper" || x.mode === "live"));
    return { studies: studies.slice(0, 12), strategies: strategies.slice(0, 6) };
  } catch {
    return { studies: FIRST, strategies: [] };
  }
}
export function loadKept(): Kept {
  try {
    return readKept(globalThis.localStorage?.getItem(KEY) ?? null);
  } catch {
    return readKept(null);
  }
}
export function keep(k: Kept): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(k));
  } catch {
    // a private window: for as long as the page is open
  }
}
