// The desk's shared look and small arithmetic (PLAN 5.22-5.27): the cards, labels and buttons every panel uses,
// in the app's own manner; dollars and percents as a desk writes them; an address shortened; the strategies a builder
// starts from (the chart's indicators are ui/studies.ts). Pure, so a test can read it.
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
/** A market as the screen names it: a major as it is, a token ("solana:<mint>", or an address a swap keeps on its chain) by
 * its symbol when the desk knows it, else its address shortened. */
export const marketName = (m: string, tokens?: Record<string, { symbol: string }>, chain?: string): string => {
  const key = chain && !m.includes(":") && (/^0x[0-9a-fA-F]{40}$/.test(m) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)) ? `${chain}:${m}` : m;
  return tokens?.[key]?.symbol ?? (key.includes(":") ? shortAddress(key.slice(key.indexOf(":") + 1)) : m);
};
/** A coin's picture, through the home (the page shows pictures from its own address only). */
export const picture = (u: string | null): string | undefined => (u ? `../desk/dex/image?u=${encodeURIComponent(u)}` : undefined);
/** Dollars as a screen of numbers writes them: $164.7M, $8.19M, $5.0K, $312. */
export const compact = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  return a >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;
};
export const ago = (at: number, now = Date.now()): string => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86_400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86_400)}d ago`;
};

/** Where a major is swapped from your wallet (as the home's orders.ts ROUTES; held alike by test/majors.test.ts): its
 * own coin on a chain the desk swaps on. The rest of the top 10 have no market there (owner, 10-11: "add the ability to
 * trade the top 10 too"). */
export const MAJOR_ROUTES: Record<string, { chain: string; token: string }> = {
  BTC: { chain: "base", token: "cbBTC" }, ETH: { chain: "base", token: "ETH" }, SOL: { chain: "solana", token: "SOL" }, BNB: { chain: "bsc", token: "BNB" },
  LINK: { chain: "ethereum", token: "LINK" }, UNI: { chain: "ethereum", token: "UNI" }, AAVE: { chain: "ethereum", token: "AAVE" },
};

/** The majors, as the home keeps them (home desk/strategy.ts; held alike by test/majors.test.ts). */
export const SYMBOLS = ["BTC", "ETH", "BNB", "XRP", "SOL", "TRX", "DOGE", "ZEC", "HYPE", "XMR", "LINK", "ADA", "NEAR", "XLM", "BCH", "LTC", "UNI", "AVAX", "SUI", "TON", "DOT", "HBAR", "AAVE", "SHIB", "PEPE"] as const;
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
