// Any token on a DEX (PLAN 5.28; owner, 10-11: "We want this to be decentralized, shitcoins, anything. with a search bar
// for any contract address, like https://dexscreener.com/ s search. Pump.funs addresses can be entered as well"):
// DexScreener's public API for a search and a token's pairs, GeckoTerminal's for a pool's candles, its last trades and
// what is trending. No key and no account. The home asks (one copy for the page and the orbs), keeps each answer a few
// seconds, and a source that fails rests longer each time, as the market does (market.ts); the two rest apart.
// A token is kept where a symbol would be as its chain and address, "solana:9BB6…pump" (`tokenKey`), so the market's
// prices and candles, the paper books and the swaps take one as they take "BTC".
import type { Candle } from "./indicators.ts";
import type { Timeframe } from "./strategy.ts";
import { base58 } from "./chains.ts";

/** The chains a token is looked for on: the ones the desk can also swap on, and BNB Chain to look at. */
export const DEX_CHAINS = ["solana", "ethereum", "base", "arbitrum", "optimism", "polygon", "bsc"] as const;
export type DexChain = (typeof DEX_CHAINS)[number];
/** GeckoTerminal's name for each chain. */
const GECKO: Record<DexChain, string> = { solana: "solana", ethereum: "eth", base: "base", arbitrum: "arbitrum", optimism: "optimism", polygon: "polygon_pos", bsc: "bsc" };

export type DexToken = { address: string; name: string; symbol: string };
export type DexPair = {
  chain: DexChain; dex: string; pair: string; url: string | null;
  base: DexToken; quote: DexToken;
  priceUsd: number | null; priceNative: number | null;
  change: { m5: number | null; h1: number | null; h6: number | null; h24: number | null };
  volume24h: number | null; liquidityUsd: number | null; fdv: number | null; marketCap: number | null;
  buys24h: number | null; sells24h: number | null; createdAt: number | null;
  image: string | null; links: { label: string; url: string }[];
};
/** One swap in a pool, for its token (`side` is the token's: a buy took it out of the pool). */
export type DexTrade = { at: number; side: "buy" | "sell"; usd: number; amount: number; priceUsd: number; tx: string; from: string | null };

/** Where a coin's picture may come from: the DEX data's own image hosts. The page shows it through the home, at the home's
 * own address, so no third party sees which coins you look at, and the page's rules stay tight (img-src 'self'). */
const IMAGE_HOSTS = new Set(["dd.dexscreener.com", "cdn.dexscreener.com", "assets.geckoterminal.com", "coin-images.coingecko.com", "assets.coingecko.com"]);
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const IMAGE_MAX = 400_000;
export const imageAllowed = (u: string): boolean => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && IMAGE_HOSTS.has(x.hostname);
  } catch {
    return false;
  }
};
export type Picture = { type: string; bytes: Uint8Array };

export interface DexSource {
  readonly name: string;
  /** A coin's picture, from one of the image hosts: never an SVG (it can carry a script), never over 400 KB. */
  image?(url: string): Promise<Picture>;
  search(q: string): Promise<DexPair[]>;
  pairs(chain: DexChain, address: string): Promise<DexPair[]>;
  candles(chain: DexChain, pool: string, token: string, tf: Timeframe, limit: number): Promise<Candle[]>;
  trades(chain: DexChain, pool: string, token: string): Promise<DexTrade[]>;
  trending(chain: DexChain): Promise<DexPair[]>;
}

// ── a token's key and address ───────────────────────────────────────────────────────────────────────
export const isDexChain = (c: string): c is DexChain => (DEX_CHAINS as readonly string[]).includes(c);
/** An address as its chain writes it: 0x and 40 hex digits on the EVM chains, a 32-byte key in base58 on Solana (a
 * pump.fun token's ends in "pump" and is one like any other). */
export const isTokenAddress = (chain: DexChain, a: string): boolean =>
  chain === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a) && base58(a)?.length === 32 : /^0x[0-9a-fA-F]{40}$/.test(a);
/** A token where a symbol would be: its chain and address. */
export const tokenKey = (chain: DexChain, address: string): string => `${chain}:${address}`;
export function readTokenKey(key: string): { chain: DexChain; address: string } | null {
  const m = /^([a-z]+):(\S+)$/.exec(key);
  return m && isDexChain(m[1]!) && isTokenAddress(m[1]! as DexChain, m[2]!) ? { chain: m[1]! as DexChain, address: m[2]! } : null;
}

// ── the public sources ─────────────────────────────────────────────────────────────────────────────
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v: unknown, max = 80): string => String(v ?? "").slice(0, max);
/** A link a page may show: http(s) only. */
const safeUrl = (u: unknown): string | null => (typeof u === "string" && /^https:\/\/[^\s"<>]+$/.test(u) ? u.slice(0, 300) : null);

/** A DexScreener pair as the desk keeps it, or null for a chain it does not look at. */
function fromScreener(p: Record<string, unknown>): DexPair | null {
  const chain = String(p.chainId ?? "");
  if (!isDexChain(chain)) return null;
  const base = (p.baseToken ?? {}) as Record<string, unknown>;
  const quote = (p.quoteToken ?? {}) as Record<string, unknown>;
  const change = (p.priceChange ?? {}) as Record<string, unknown>;
  const info = (p.info ?? {}) as { imageUrl?: unknown; websites?: { label?: unknown; url?: unknown }[]; socials?: { type?: unknown; url?: unknown }[] };
  const txns = ((p.txns ?? {}) as Record<string, { buys?: unknown; sells?: unknown }>).h24;
  const links = [
    ...(info.websites ?? []).map((w) => ({ label: text(w.label, 30) || "Website", url: safeUrl(w.url) })),
    ...(info.socials ?? []).map((s) => ({ label: text(s.type, 30), url: safeUrl(s.url) })),
  ].filter((l): l is { label: string; url: string } => l.url !== null && l.label !== "").slice(0, 8);
  return {
    chain, dex: text(p.dexId, 40), pair: text(p.pairAddress, 100), url: safeUrl(p.url),
    base: { address: text(base.address, 100), name: text(base.name), symbol: text(base.symbol, 30) },
    quote: { address: text(quote.address, 100), name: text(quote.name), symbol: text(quote.symbol, 30) },
    priceUsd: num(p.priceUsd), priceNative: num(p.priceNative),
    change: { m5: num(change.m5), h1: num(change.h1), h6: num(change.h6), h24: num(change.h24) },
    volume24h: num((p.volume as Record<string, unknown> | undefined)?.h24), liquidityUsd: num((p.liquidity as Record<string, unknown> | undefined)?.usd),
    fdv: num(p.fdv), marketCap: num(p.marketCap), buys24h: num(txns?.buys), sells24h: num(txns?.sells), createdAt: num(p.pairCreatedAt),
    image: safeUrl(info.imageUrl), links,
  };
}

/** A GeckoTerminal pool (with its tokens and dex from `included`) as a pair, its base the token. */
function fromGecko(chain: DexChain, p: { attributes?: Record<string, unknown>; relationships?: Record<string, { data?: { id?: string } }> }, tokens: Map<string, Record<string, unknown>>): DexPair | null {
  const a = p.attributes ?? {};
  const base = tokens.get(p.relationships?.base_token?.data?.id ?? "");
  const quote = tokens.get(p.relationships?.quote_token?.data?.id ?? "");
  if (!base) return null;
  const change = (a.price_change_percentage ?? {}) as Record<string, unknown>;
  const h24 = ((a.transactions ?? {}) as Record<string, { buys?: unknown; sells?: unknown }>).h24;
  const created = Date.parse(String(a.pool_created_at ?? ""));
  return {
    chain, dex: text(p.relationships?.dex?.data?.id, 40), pair: text(a.address, 100), url: null,
    base: { address: text(base.address, 100), name: text(base.name), symbol: text(base.symbol, 30) },
    quote: { address: text(quote?.address, 100), name: text(quote?.name), symbol: text(quote?.symbol, 30) },
    priceUsd: num(a.base_token_price_usd), priceNative: num(a.base_token_price_native_currency),
    change: { m5: num(change.m5), h1: num(change.h1), h6: num(change.h6), h24: num(change.h24) },
    volume24h: num((a.volume_usd as Record<string, unknown> | undefined)?.h24), liquidityUsd: num(a.reserve_in_usd),
    fdv: num(a.fdv_usd), marketCap: num(a.market_cap_usd), buys24h: num(h24?.buys), sells24h: num(h24?.sells), createdAt: Number.isFinite(created) ? created : null,
    image: safeUrl(base.image_url), links: [],
  };
}

/** GeckoTerminal's candle size for each of the desk's timeframes. */
const GECKO_TF: Record<Timeframe, [string, number]> = { "1m": ["minute", 1], "5m": ["minute", 5], "15m": ["minute", 15], "1h": ["hour", 1], "4h": ["hour", 4], "1d": ["day", 1] };

/** DexScreener's and GeckoTerminal's public APIs. */
export function publicDex(o: { fetch?: typeof fetch; screener?: string; gecko?: string } = {}): DexSource {
  const screener = o.screener ?? "https://api.dexscreener.com";
  const gecko = o.gecko ?? "https://api.geckoterminal.com/api/v2";
  const get = o.fetch ?? fetch;
  const json = async (url: string): Promise<unknown> => {
    const r = await get(url, { signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
    return r.json();
  };
  return {
    name: "DexScreener and GeckoTerminal public data",
    async image(url) {
      if (!imageAllowed(url)) throw new Error("not one of the image hosts");
      const r = await get(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
      const type = (r.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!r.ok || !IMAGE_TYPES.has(type)) throw new Error(`no picture there (${r.status}, ${type || "no type"})`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > IMAGE_MAX) throw new Error("the picture is too big");
      return { type, bytes };
    },
    async search(q) {
      const d = (await json(`${screener}/latest/dex/search?q=${encodeURIComponent(q)}`)) as { pairs?: Record<string, unknown>[] };
      return (d.pairs ?? []).map(fromScreener).filter((p): p is DexPair => p !== null);
    },
    async pairs(chain, address) {
      const d = (await json(`${screener}/tokens/v1/${chain}/${encodeURIComponent(address)}`)) as Record<string, unknown>[];
      return (Array.isArray(d) ? d : []).map(fromScreener).filter((p): p is DexPair => p !== null);
    },
    async candles(chain, pool, token, tf, limit) {
      const [size, aggregate] = GECKO_TF[tf];
      const d = (await json(`${gecko}/networks/${GECKO[chain]}/pools/${encodeURIComponent(pool)}/ohlcv/${size}?aggregate=${aggregate}&limit=${Math.min(1000, Math.max(1, limit))}&currency=usd&token=${encodeURIComponent(token)}`)) as { data?: { attributes?: { ohlcv_list?: number[][] } } };
      return (d.data?.attributes?.ohlcv_list ?? []).map((r) => ({ t: Number(r[0]) * 1000, o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]) }));
    },
    async trades(chain, pool, token) {
      const d = (await json(`${gecko}/networks/${GECKO[chain]}/pools/${encodeURIComponent(pool)}/trades`)) as { data?: { attributes?: Record<string, unknown> }[] };
      return (d.data ?? []).map((x) => {
        const a = x.attributes ?? {};
        // the token's side of it: bought when it left the pool for whoever swapped, sold when it came in
        const bought = String(a.to_token_address ?? "").toLowerCase() === token.toLowerCase();
        return {
          at: Date.parse(String(a.block_timestamp ?? "")), side: bought ? "buy" as const : "sell" as const, usd: Number(a.volume_in_usd),
          amount: Number(bought ? a.to_token_amount : a.from_token_amount), priceUsd: Number(bought ? a.price_to_in_usd : a.price_from_in_usd),
          tx: text(a.tx_hash, 120), from: typeof a.tx_from_address === "string" ? a.tx_from_address.slice(0, 100) : null,
        };
      }).filter((t) => Number.isFinite(t.at) && Number.isFinite(t.usd) && Number.isFinite(t.priceUsd));
    },
    async trending(chain) {
      const d = (await json(`${gecko}/networks/${GECKO[chain]}/trending_pools?include=base_token,quote_token,dex`)) as { data?: Parameters<typeof fromGecko>[1][]; included?: { id: string; type: string; attributes?: Record<string, unknown> }[] };
      const tokens = new Map((d.included ?? []).filter((i) => i.type === "token").map((i) => [i.id, i.attributes ?? {}]));
      return (d.data ?? []).map((p) => fromGecko(chain, p, tokens)).filter((p): p is DexPair => p !== null);
    },
  };
}

// ── the desk's one copy ────────────────────────────────────────────────────────────────────────────
/** A source's health and its rest after failing, kept apart for each of the two. */
class Rest {
  #failures = 0;
  #until = 0;
  error: string | null = null;
  lastOk: number | null = null;
  readonly now: () => number;
  constructor(now: () => number) {
    this.now = now;
  }
  async ask<T>(what: () => Promise<T>): Promise<T> {
    if (this.#until > this.now()) throw new Error(`resting after ${this.#failures} failed asks: ${this.error ?? "no answer"}`);
    try {
      const v = await what();
      this.#failures = 0;
      this.error = null;
      this.lastOk = this.now();
      return v;
    } catch (e) {
      this.#failures++;
      this.error = e instanceof Error ? e.message : String(e);
      this.#until = this.now() + Math.min(300_000, 2_000 * 2 ** (this.#failures - 1));
      throw e;
    }
  }
  get resting(): number | null {
    return this.#until > this.now() ? this.#until : null;
  }
}

export type DexStatus = { source: string; ok: boolean; error: string | null; restingUntil: number | null };

export class Dex {
  readonly #source: DexSource;
  readonly #now: () => number;
  readonly #screener: Rest;
  readonly #gecko: Rest;
  readonly #kept = new Map<string, { at: number; v: unknown }>();
  /** How long each kind of answer is kept: a search and a token's pairs move fast; what is trending, slower. */
  static readonly KEEP_MS = { search: 20_000, pairs: 15_000, candles: 30_000, trades: 15_000, trending: 60_000 } as const;

  constructor(source: DexSource, now: () => number) {
    this.#source = source;
    this.#now = now;
    this.#screener = new Rest(now);
    this.#gecko = new Rest(now);
  }

  status(): DexStatus {
    const error = this.#screener.error ?? this.#gecko.error;
    return { source: this.#source.name, ok: error === null, error, restingUntil: this.#screener.resting ?? this.#gecko.resting };
  }

  async #keep<T>(key: string, ms: number, rest: Rest, what: () => Promise<T>): Promise<T> {
    const have = this.#kept.get(key);
    if (have && this.#now() - have.at < ms) return have.v as T;
    const v = await rest.ask(what);
    this.#kept.set(key, { at: this.#now(), v });
    if (this.#kept.size > 500) this.#kept.delete(this.#kept.keys().next().value!); // the oldest first
    return v;
  }

  /** What a search finds, by name, symbol or address: each token once, on its most liquid pair, the most liquid first.
   * A Solana address is looked up as one (a pump.fun token still on its curve too). */
  async search(q: string): Promise<DexPair[]> {
    const query = q.trim().slice(0, 100);
    if (!query) return [];
    const pairs = isTokenAddress("solana", query)
      ? await this.token("solana", query)
      : await this.#keep(`search:${query.toLowerCase()}`, Dex.KEEP_MS.search, this.#screener, () => this.#source.search(query));
    const best = new Map<string, DexPair>();
    for (const p of pairs) {
      const k = tokenKey(p.chain, p.base.address);
      const was = best.get(k);
      if (!was || (p.liquidityUsd ?? -1) > (was.liquidityUsd ?? -1)) best.set(k, p);
    }
    return [...best.values()].sort((a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1) || (b.volume24h ?? -1) - (a.volume24h ?? -1));
  }

  /** Every pair of a token, the most liquid first. */
  async token(chain: DexChain, address: string): Promise<DexPair[]> {
    if (!isTokenAddress(chain, address)) throw new Error(`not a ${chain} token address`);
    const pairs = await this.#keep(`pairs:${chain}:${address}`, Dex.KEEP_MS.pairs, this.#screener, () => this.#source.pairs(chain, address));
    return pairs.filter((p) => p.base.address.toLowerCase() === address.toLowerCase()).sort((a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1));
  }

  /** A token's price in dollars on its most liquid pair, or null when no pair says one. */
  async price(chain: DexChain, address: string): Promise<number | null> {
    const top = (await this.token(chain, address)).find((p) => p.priceUsd !== null);
    return top?.priceUsd ?? null;
  }

  /** A pool's bars for a token in dollars, oldest first, the forming one last. */
  async candles(chain: DexChain, pool: string, token: string, tf: Timeframe, limit = 300): Promise<Candle[]> {
    const bars = await this.#keep(`candles:${chain}:${pool}:${token}:${tf}:${limit}`, Dex.KEEP_MS.candles, this.#gecko, () => this.#source.candles(chain, pool, token, tf, limit));
    return bars.filter((b) => [b.t, b.o, b.h, b.l, b.c, b.v].every(Number.isFinite)).sort((a, b) => a.t - b.t).slice(-limit);
  }

  /** A token's bars on its most liquid pair. */
  async tokenCandles(chain: DexChain, address: string, tf: Timeframe, limit = 300): Promise<Candle[]> {
    const top = (await this.token(chain, address))[0];
    if (!top) throw new Error("no pair trades this token");
    return this.candles(chain, top.pair, address, tf, limit);
  }

  /** A pool's last trades for a token, the newest first. */
  async trades(chain: DexChain, pool: string, token: string): Promise<DexTrade[]> {
    const list = await this.#keep(`trades:${chain}:${pool}:${token}`, Dex.KEEP_MS.trades, this.#gecko, () => this.#source.trades(chain, pool, token));
    return [...list].sort((a, b) => b.at - a.at).slice(0, 100);
  }

  readonly #pictures = new Map<string, Picture>();
  /** A coin's picture, kept (the 200 seen last): from an image host only. */
  async image(url: string): Promise<Picture> {
    if (!imageAllowed(url) || !this.#source.image) throw new Error("no such picture");
    const have = this.#pictures.get(url);
    if (have) return have;
    const pic = await this.#source.image(url);
    this.#pictures.set(url, pic);
    if (this.#pictures.size > 200) this.#pictures.delete(this.#pictures.keys().next().value!);
    return pic;
  }

  /** The pools trending on a chain now. */
  async trending(chain: DexChain): Promise<DexPair[]> {
    const pools = await this.#keep(`trending:${chain}`, Dex.KEEP_MS.trending, this.#gecko, () => this.#source.trending(chain));
    // each coin once, where it first trends (a coin on two pools is one coin)
    const seen = new Set<string>();
    return pools.filter((p) => {
      const k = p.base.address.toLowerCase();
      return seen.has(k) ? false : (seen.add(k), true);
    });
  }
}

/** A test home's DEX when it hands in none: no network, and it says so. */
export function offlineDex(): DexSource {
  const no = async (): Promise<never> => {
    throw new Error("the DEX data is not connected in this home");
  };
  return { name: "no DEX data (a test home)", search: no, pairs: no, candles: no, trades: no, trending: no };
}

