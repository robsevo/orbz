// The desk's shared look and small arithmetic (PLAN 5.22-5.27): the cards, labels and buttons every panel uses,
// in the app's own manner; dollars and percents as a desk writes them; an address shortened; an EMA for the chart's
// lines; the strategies a builder starts from. Pure, so a test can read it.
import type { CSSProperties } from "react";
import type { DeskSpec } from "../home/link.ts";

export const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" };
export const small: CSSProperties = { font: "500 13px/18px var(--font)", color: "var(--text-3)", textWrap: "pretty", overflowWrap: "anywhere" };
export const card: CSSProperties = { display: "grid", gap: 12, alignContent: "start", padding: "var(--s4)", borderRadius: 18, background: "var(--card)", boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0 };
export const well: CSSProperties = { display: "grid", gap: 10, alignContent: "start", padding: "var(--s3)", borderRadius: 14, background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", minWidth: 0 };
export const button: CSSProperties = { font: "600 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 14px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 36 };
export const strong: CSSProperties = { ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" };
export const field: CSSProperties = { minWidth: 0, font: "600 15px/21px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 12px", outline: 0, boxShadow: "inset 0 0 0 1px var(--hairline)" };
export const chip = (on: boolean): CSSProperties => ({ ...(on ? strong : button), padding: "6px 12px", minHeight: 32, font: "700 13px/18px var(--font)", whiteSpace: "nowrap" });

export const usd = (n: number, places = 2): string => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: places, maximumFractionDigits: places })}`;
export const pct = (n: number | null | undefined, places = 2): string => (n === null || n === undefined || !Number.isFinite(n) ? "–" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(places)}%`);
export const shortAddress = (a: string): string => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
export const ago = (at: number, now = Date.now()): string => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86_400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86_400)}d ago`;
};

/** An exponential average for the chart's lines (the home's strategies read their own: desk/indicators.ts). */
export function ema(xs: readonly number[], n: number): number[] {
  const out = new Array<number>(xs.length).fill(NaN);
  if (xs.length < n) return out;
  let prev = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = prev;
  for (let i = n; i < xs.length; i++) out[i] = prev = xs[i]! * (2 / (n + 1)) + prev * (1 - 2 / (n + 1));
  return out;
}

export const SYMBOLS = ["BTC", "ETH", "SOL", "LINK", "DOGE", "AVAX", "UNI", "AAVE"] as const;
export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;

/** The strategies a builder starts from, each a known setup with its two numbers to tune. */
export type Template = { id: string; name: string; about: string; a: { label: string; value: number }; b: { label: string; value: number } | null; make: (a: number, b: number) => Pick<DeskSpec, "entry" | "exit"> };
export const TEMPLATES: Template[] = [
  {
    id: "cross", name: "EMA crossover", about: "Buy when the fast average crosses above the slow one; sell when it crosses back.",
    a: { label: "Fast EMA", value: 9 }, b: { label: "Slow EMA", value: 21 },
    make: (a, b) => ({ entry: { all: [{ left: { kind: "ema", period: a }, op: "crosses_above", right: { kind: "ema", period: b } }] }, exit: { all: [{ left: { kind: "ema", period: a }, op: "crosses_below", right: { kind: "ema", period: b } }] } }),
  },
  {
    id: "rsi", name: "RSI dip", about: "Buy when RSI(14) falls under its floor; sell when it climbs past its ceiling.",
    a: { label: "Buy under", value: 30 }, b: { label: "Sell over", value: 55 },
    make: (a, b) => ({ entry: { all: [{ left: { kind: "rsi", period: 14 }, op: "<", right: { kind: "value", value: a } }] }, exit: { all: [{ left: { kind: "rsi", period: 14 }, op: ">", right: { kind: "value", value: b } }] } }),
  },
  {
    id: "breakout", name: "Breakout", about: "Buy when the close beats the highest high of the bars before; a trailing stop takes it out.",
    a: { label: "Bars back", value: 20 }, b: null,
    make: (a) => ({ entry: { all: [{ left: { kind: "price", field: "close" }, op: ">", right: { kind: "highest", period: a, field: "high" } }] } }),
  },
  {
    id: "bands", name: "Bollinger bounce", about: "Buy a close under the lower band; sell back at the middle.",
    a: { label: "Bars", value: 20 }, b: { label: "Width (k)", value: 2 },
    make: (a, b) => ({ entry: { all: [{ left: { kind: "price", field: "close" }, op: "<", right: { kind: "bb_lower", period: a, k: b } }] }, exit: { all: [{ left: { kind: "price", field: "close" }, op: ">", right: { kind: "bb_middle", period: a, k: b } }] } }),
  },
  {
    id: "macd", name: "MACD momentum", about: "Buy when MACD crosses above its signal; sell when it crosses back under.",
    a: { label: "Fast", value: 12 }, b: { label: "Slow", value: 26 },
    make: (a, b) => ({ entry: { all: [{ left: { kind: "macd", fast: a, slow: b }, op: "crosses_above", right: { kind: "macd_signal", fast: a, slow: b } }] }, exit: { all: [{ left: { kind: "macd", fast: a, slow: b }, op: "crosses_below", right: { kind: "macd_signal", fast: a, slow: b } }] } }),
  },
];
