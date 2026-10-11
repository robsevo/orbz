// Live prices and candles for the desk (PLAN 5.23): public market data, no key and no account anywhere (owner,
// 10-10: "nono not coinbase"; trades are decentralized, from your own wallet, PLAN 5.27: this is only what the charts
// and the strategies read). The default source is Binance's public market-data mirror (data-api.binance.vision: prices
// only, nothing to sign in to); a test hands in a stand-in. The home keeps one copy: candles cached per symbol and bar,
// refreshed only once a bar has closed; the prices at most every few seconds; a failing source rests longer each time
// (2 s doubling to 5 minutes), and a price older than a minute is said to be stale, never shown as live.
import type { Candle } from "./indicators.ts";
import { SYMBOLS, TIMEFRAME_MS, type Timeframe } from "./strategy.ts";
import { readTokenKey, type Dex } from "./dex.ts";

export type Ticker = { symbol: string; price: number; changePct: number; high: number; low: number; volume: number; at: number };
export interface MarketSource {
  readonly name: string;
  candles(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]>;
  tickers(symbols: readonly string[]): Promise<Ticker[]>;
  /** Coins' symbols by market cap, the largest first (CoinGecko's free markets list). */
  ranks?(): Promise<string[]>;
}

/** Binance's public market data (USDT pairs, read as dollars). */
export function binanceSource(o: { base?: string; fetch?: typeof fetch; gecko?: string } = {}): MarketSource {
  const base = o.base ?? "https://data-api.binance.vision";
  const coingecko = o.gecko ?? "https://api.coingecko.com/api/v3";
  const get = o.fetch ?? fetch;
  const json = async (path: string): Promise<unknown> => {
    const r = await get(`${base}${path}`, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`the market answered ${r.status}`);
    return r.json();
  };
  return {
    name: "Binance public market data",
    async candles(symbol, tf, limit) {
      const rows = (await json(`/api/v3/klines?symbol=${encodeURIComponent(`${symbol}USDT`)}&interval=${tf}&limit=${Math.min(1000, Math.max(1, limit))}`)) as unknown[][];
      return rows.map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]) }));
    },
    async ranks() {
      const r = await get(`${coingecko}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=60&page=1`, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(`CoinGecko answered ${r.status}`);
      const rows = (await r.json()) as { symbol?: unknown }[];
      return (Array.isArray(rows) ? rows : []).map((x) => String(x.symbol ?? "").toUpperCase()).filter(Boolean);
    },
    async tickers(symbols) {
      const list = encodeURIComponent(JSON.stringify(symbols.map((s) => `${s}USDT`)));
      const rows = (await json(`/api/v3/ticker/24hr?symbols=${list}`)) as Record<string, string | number>[];
      return rows.map((r) => ({
        symbol: String(r.symbol).replace(/USDT$/, ""), price: Number(r.lastPrice), changePct: Number(r.priceChangePercent),
        high: Number(r.highPrice), low: Number(r.lowPrice), volume: Number(r.quoteVolume), at: Number(r.closeTime),
      }));
    },
  };
}

export type MarketStatus = { source: string; ok: boolean; lastOk: number | null; error: string | null; restingUntil: number | null };

export class Market {
  readonly #source: MarketSource;
  readonly #now: () => number;
  /** Any token on a DEX, by its key ("solana:9BB6…pump"), where a symbol would be (dex.ts). */
  readonly #dex: Dex | null;
  readonly #candles = new Map<string, { at: number; bars: Candle[] }>();
  #tickers: { at: number; list: Ticker[] } | null = null;
  #lastOk: number | null = null;
  #error: string | null = null;
  #failures = 0;
  #restUntil = 0;
  /** At most this often the prices are asked for again. */
  static readonly PRICES_MS = 5_000;
  /** A price older than this is stale. */
  static readonly STALE_MS = 60_000;
  /** How long the forming bar is kept for a chart. */
  static readonly FORMING_MS = 2_000;
  /** How long the coins' order by market cap is kept. */
  static readonly RANKS_MS = 60 * 60_000;

  constructor(source: MarketSource, now: () => number, dex: Dex | null = null) {
    this.#source = source;
    this.#now = now;
    this.#dex = dex;
  }

  status(): MarketStatus {
    return { source: this.#source.name, ok: this.#failures === 0 && this.#lastOk !== null, lastOk: this.#lastOk, error: this.#error, restingUntil: this.#restUntil > this.#now() ? this.#restUntil : null };
  }

  async #ask<T>(what: () => Promise<T>): Promise<T> {
    if (this.#restUntil > this.#now()) throw new Error(`the market is resting after ${this.#failures} failed asks: ${this.#error ?? "no answer"}`);
    try {
      const v = await what();
      this.#failures = 0;
      this.#error = null;
      this.#lastOk = this.#now();
      return v;
    } catch (e) {
      this.#failures++;
      this.#error = e instanceof Error ? e.message : String(e);
      this.#restUntil = this.#now() + Math.min(300_000, 2_000 * 2 ** (this.#failures - 1));
      throw e;
    }
  }

  /** The last `limit` bars of a symbol, the forming one last: kept for half a minute at most (the forming bar moves),
   * and asked again at once when the bar that was forming has closed. */
  async candles(symbol: string, tf: Timeframe, limit = 300): Promise<Candle[]> {
    const token = readTokenKey(symbol);
    if (token) {
      if (!this.#dex) throw new Error("no DEX data in this home");
      return this.#dex.tokenCandles(token.chain, token.address, tf, limit);
    }
    const key = `${symbol}:${tf}`;
    const have = this.#candles.get(key);
    const ms = TIMEFRAME_MS[tf];
    const last = have?.bars.at(-1);
    const fresh = have && last && this.#now() < last.t + ms && have.bars.length >= limit && this.#now() - have.at < Math.min(ms, 30_000);
    if (fresh) return have.bars.slice(-limit);
    const bars = (await this.#ask(() => this.#source.candles(symbol, tf, Math.max(limit, have?.bars.length ?? 0))))
      .filter((b) => [b.t, b.o, b.h, b.l, b.c, b.v].every(Number.isFinite))
      .sort((a, b) => a.t - b.t);
    this.#candles.set(key, { at: this.#now(), bars });
    return bars.slice(-limit);
  }

  readonly #forming = new Map<string, { at: number; bar: Candle }>();
  /** The bar forming now, kept two seconds: a chart's live bar between its bars (PLAN 5.33; owner, 10-11: "the
   * candlestick freezes at what we started the chart on, price too"). */
  async forming(symbol: string, tf: Timeframe): Promise<Candle | null> {
    const key = `${symbol}:${tf}`;
    const have = this.#forming.get(key);
    if (have && this.#now() - have.at < Market.FORMING_MS) return have.bar;
    const bar = (await this.#ask(() => this.#source.candles(symbol, tf, 1))).filter((b) => [b.t, b.o, b.h, b.l, b.c, b.v].every(Number.isFinite)).at(-1) ?? null;
    if (bar) this.#forming.set(key, { at: this.#now(), bar });
    return bar;
  }

  #ranks: { at: number; top: string[] } | null = null;
  #ranksFailedAt = 0;
  /** The top `n` majors by market cap (owner, 10-11: "have top 10 cryptos clickable on the top"): CoinGecko's order of
   * the coins, the majors' among them (no stablecoin is a major), read once an hour; when it cannot say, its last order,
   * or the majors' own (the largest first, as kept). Asked again no sooner than five minutes after failing. */
  async top(n = 10): Promise<string[]> {
    const now = this.#now();
    if (this.#source.ranks && (!this.#ranks || now - this.#ranks.at >= Market.RANKS_MS) && now - this.#ranksFailedAt >= 5 * 60_000) {
      try {
        const ranked = await this.#source.ranks();
        const majors = [...new Set(ranked.filter((s) => (SYMBOLS as readonly string[]).includes(s)))];
        if (majors.length >= n) this.#ranks = { at: now, top: majors };
        else throw new Error("too few of the majors ranked");
      } catch {
        this.#ranksFailedAt = now;
      }
    }
    return (this.#ranks?.top ?? [...SYMBOLS]).slice(0, n);
  }

  /** The bars that have closed by now (a strategy reads only these). */
  async closed(symbol: string, tf: Timeframe, limit = 300): Promise<Candle[]> {
    const now = this.#now();
    return (await this.candles(symbol, tf, limit + 1)).filter((b) => b.t + TIMEFRAME_MS[tf] <= now).slice(-limit);
  }

  /** The prices now, each said stale when older than a minute. */
  async tickers(symbols: readonly string[]): Promise<(Ticker & { stale: boolean })[]> {
    const now = this.#now();
    if (!this.#tickers || now - this.#tickers.at >= Market.PRICES_MS) {
      try {
        // every symbol the floor knows, in one ask: one copy for every caller
        this.#tickers = { at: now, list: await this.#ask(() => this.#source.tickers(SYMBOLS)) };
      } catch {
        if (!this.#tickers) return [];
      }
    }
    return this.#tickers!.list.filter((t) => symbols.includes(t.symbol)).map((t) => ({ ...t, stale: now - this.#tickers!.at > Market.STALE_MS }));
  }

  /** A price now, or null when the market cannot say. */
  async price(symbol: string): Promise<number | null> {
    const token = readTokenKey(symbol);
    if (token) return this.#dex ? this.#dex.price(token.chain, token.address).catch(() => null) : null;
    const t = (await this.tickers([symbol])).find((x) => x.symbol === symbol);
    return t && !t.stale ? t.price : null;
  }
}

/** A test home's market when it hands in none: no network, and it says so. */
export function offlineSource(): MarketSource {
  const no = async (): Promise<never> => {
    throw new Error("the market is not connected in this home");
  };
  return { name: "no market (a test home)", candles: no, tickers: no };
}
/** A test home's network for the chains and the routers when it hands in none. */
export const offlineFetch: typeof fetch = async () => {
  throw new Error("no network in this home");
};
