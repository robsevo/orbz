// What a chart draws for the desk (PLAN 5.32; owner, 10-11: "right click and add lets say indicators, or an orbs
// strategy so we can see it visually. paper or live"): a strategy over the very bars a chart shows, the bars still
// forming left out (a bar's close decides, PLAN 5.24), what its rules read there and the trades the paper desk's own
// `step` makes of them; and what was really done on a market: each orb's paper fills, the real trades that went (yours
// and the orbs'), and the strategies run on it on paper, from when. Pure, so a test holds it.
import type { Candle } from "./indicators.ts";
import { backtest, seriesOf, seriesWords, TIMEFRAME_MS, type Backtest, type Rules, type Series, type Strategy } from "./strategy.ts";
import { chainOf, tokenOf } from "./chains.ts";
import { readTokenKey } from "./dex.ts";
import { YOU, type Book } from "./desk.ts";
import type { Swap } from "./swaps.ts";

/** The most bars a chart may hand in: a coin's chart shows 300, and 400 of them fit inside the door's 64 KB body. */
export const MOST_BARS = 400;

/** What is wrong with bars handed in, or null: each a time, open, high, low, close and volume, in time order. */
export function barsProblem(x: unknown): string | null {
  if (!Array.isArray(x) || x.length < 2 || x.length > MOST_BARS) return `bars: 2 to ${MOST_BARS} of them`;
  let last = -Infinity;
  for (const b of x as unknown[]) {
    const c = (b ?? {}) as Record<string, unknown>;
    if (![c.t, c.o, c.h, c.l, c.c, c.v].every((v) => typeof v === "number" && Number.isFinite(v))) return "bars: each a time, an open, a high, a low, a close and a volume";
    const k = c as unknown as Candle;
    if (!Number.isInteger(k.t) || k.t <= last) return "bars: in time order, each once";
    if (!(k.o > 0 && k.h > 0 && k.l > 0 && k.c > 0) || k.v < 0 || k.h < k.l) return "bars: prices above nothing, each high at or over its low";
    last = k.t;
  }
  return null;
}

/** Every series a strategy's rules read that a chart can draw, each once, in the order the rules name them: a fixed
 * number is a level the chart draws, and the bar's own prices are its candles. */
export function seriesIn(s: Strategy): Series[] {
  const seen = new Map<string, Series>();
  for (const r of [s.entry, s.exit].filter((x): x is Rules => x !== undefined))
    for (const c of "all" in r ? r.all : r.any)
      for (const x of [c.left, c.right]) {
        const k = JSON.stringify(x);
        if (x.kind !== "value" && x.kind !== "price" && !seen.has(k)) seen.set(k, x);
      }
  return [...seen.values()];
}

export type Drawn = Backtest & { series: { series: Series; words: string; values: number[] }[]; bars: number };

/** A strategy over a chart's bars (checked by the caller): the bars still forming at `now` left out, the rest stepped
 * as a paper book steps them, from the same cash; its series over the same bars. A trade still open at the end is the
 * backtest's last ("end"), which a chart draws as open. */
export function drawn(s: Strategy, bars: readonly Candle[], now: number): Drawn {
  const closed = bars.filter((b) => b.t + TIMEFRAME_MS[s.timeframe] <= now);
  return { ...backtest(s, closed), series: seriesIn(s).map((x) => ({ series: x, words: seriesWords(x), values: seriesOf(x, closed) })), bars: closed.length };
}

/** A fill on a market: an orb's on paper, or a real trade that went (an orb's, or yours: `orb` null). */
export type Fill = {
  kind: "paper" | "real"; orb: string | null; at: number; side: "buy" | "sell";
  /** what one coin cost: a real trade's dollars over what they bought (null when it cannot say) */
  px: number | null; qty: number | null; usd: number | null;
  book?: number; strategy?: number | null; swap?: number; state?: string; tx?: string | null; why?: string;
};
/** A strategy run on a market on paper, from when (and until, once stopped). */
export type Run = { book: number; orb: string; strategy: number; startedAt: number; stoppedAt: number | null; state: "live" | "stopped" };
export type FillEvent = { at: number; orb: string | null; data: Record<string, unknown> };

const finite = (n: number): number | null => (Number.isFinite(n) && n > 0 ? n : null);

/** What was done on a market (a major by its symbol, any coin by its "chain:address"), oldest first. */
export function marksOn(market: string, o: { fills: readonly FillEvent[]; swaps: readonly Swap[]; books: readonly Book[] }): { fills: Fill[]; runs: Run[] } {
  const key = readTokenKey(market);
  // a swap's side is this market: a coin by its address (or the chain's token it names), a major by its symbol
  const isIt = (chainId: string, side: string): boolean => {
    if (!key) return side === market;
    if (chainId !== key.chain) return false;
    const chain = chainOf(chainId);
    const address = (chain && tokenOf(chain, side)?.address) || side;
    return address.toLowerCase() === key.address.toLowerCase();
  };
  const paper: Fill[] = o.fills
    // a fill of real money is the real trade's (its swap, below): on paper only here
    .filter((e) => e.data.symbol === market && e.data.paper !== false && (e.data.side === "buy" || e.data.side === "sell"))
    .map((e) => ({
      // your own paper (PLAN 5.38) is yours on the chart, as your real trades are
      kind: "paper", orb: e.orb === YOU ? null : e.orb, at: e.at, side: e.data.side as "buy" | "sell",
      px: finite(Number(e.data.px)), qty: finite(Number(e.data.qty)), usd: typeof e.data.usd === "number" ? e.data.usd : null,
      book: Number(e.data.book), strategy: typeof e.data.strategy === "number" ? e.data.strategy : null, ...(typeof e.data.why === "string" && { why: e.data.why }),
    }));
  const real: Fill[] = o.swaps
    .filter((s) => (s.state === "sent" || s.state === "confirmed") && (isIt(s.chain, s.buy) || isIt(s.chain, s.sell)))
    .map((s) => {
      const buy = isIt(s.chain, s.buy);
      const qty = finite(Number(buy ? s.quote?.out : s.amount));
      return { kind: "real", orb: s.orb, at: s.settledAt ?? s.createdAt, side: buy ? "buy" : "sell", px: qty === null ? null : finite(s.usd / qty), qty, usd: s.usd, swap: s.id, state: s.state, tx: s.tx, ...(s.why ? { why: s.why } : {}) };
    });
  const runs: Run[] = o.books
    .filter((b) => b.strategy !== null && b.symbol === market)
    .map((b) => ({ book: b.id, orb: b.orb, strategy: b.strategy!, startedAt: b.startedAt, stoppedAt: b.stoppedAt, state: b.state }));
  return { fills: [...paper, ...real].sort((a, b) => a.at - b.at), runs };
}
