// Stand-ins for the public DEX data (PLAN 5.28): DexScreener's and GeckoTerminal's APIs as a test sets them, self-made
// answers in their shapes, routed by path. No network.
/** The stand-ins' "now": their pairs' ages and their bars are counted from it. */
export const START = Date.parse("2026-10-11T12:00:00Z");
// public addresses, used as text: a pump.fun mint (its address ends in "pump"), its pool, another token, an EVM token
export const MINT = "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump";
export const POOL = "Bzc9NZfMqkXR6fz1DBph7BDf9BroyEf6pnzESP7v5iiw";
export const THIN = "GSLigHiDNNWZygZ87nZBMXyxroqthDkqGzmaLfPj1uSB";
export const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
export const WSOL = "So11111111111111111111111111111111111111112";
export const EVM_TOKEN = "0x1111111111111111111111111111111111111111";

/** A DexScreener pair, self-made, in its API's shape. */
export const screener = (o: { chain?: string; dex?: string; pair: string; base: [string, string, string]; price: string | null; liq: number | null; vol?: number; created?: number }) => ({
  chainId: o.chain ?? "solana", dexId: o.dex ?? "raydium", url: `https://dexscreener.com/${o.chain ?? "solana"}/${o.pair}`, pairAddress: o.pair,
  baseToken: { address: o.base[0], name: o.base[1], symbol: o.base[2] }, quoteToken: { address: WSOL, name: "Wrapped SOL", symbol: "SOL" },
  priceNative: "0.0015", priceUsd: o.price, txns: { h24: { buys: 1200, sells: 1100 } }, volume: { h24: o.vol ?? 2_000_000 }, priceChange: { m5: 0.5, h1: -1.2, h6: 3, h24: 12.5 },
  liquidity: o.liq === null ? undefined : { usd: o.liq }, fdv: 164_000_000, marketCap: 164_000_000, pairCreatedAt: o.created ?? START - 400 * 24 * 3600_000,
  info: { imageUrl: "https://example.test/token.png", websites: [{ label: "Website", url: "https://example.test" }], socials: [{ type: "twitter", url: "https://x.com/example" }, { type: "telegram", url: "javascript:alert(1)" }] },
});

/** DexScreener's and GeckoTerminal's public APIs as a test sets them, routed by path; every URL asked for kept. */
export function standInDexFetch(o: { price?: () => string; fail?: () => boolean } = {}): typeof fetch & { urls: string[] } {
  const urls: string[] = [];
  const f = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    url.pathname = url.pathname.replace(/^\/api\/v2/, ""); // GeckoTerminal's base path
    urls.push(url.pathname + url.search);
    if (o.fail?.()) return new Response("{}", { status: 503 });
    const json = (v: unknown): Response => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });
    // a coin's picture, on an image host: a few bytes of PNG, or an SVG and a picture too big, to be refused
    if (url.hostname === "dd.dexscreener.com") {
      if (url.pathname.endsWith(".svg")) return new Response("<svg xmlns='http://www.w3.org/2000/svg'/>", { headers: { "content-type": "image/svg+xml" } });
      return new Response(new Uint8Array(url.pathname.includes("big") ? 500_000 : 8).fill(137), { headers: { "content-type": "image/png" } });
    }
    const fart = screener({ pair: POOL, base: [MINT, "Fartcoin", "Fartcoin"], price: o.price?.() ?? "0.16", liq: 8_000_000 });
    if (url.pathname === "/latest/dex/search") {
      return json({ pairs: [
        screener({ pair: THIN, dex: "pumpfun", base: [MINT, "Fartcoin", "Fartcoin"], price: "0.15", liq: 5_000 }),
        fart,
        screener({ pair: "BONKpairBONKpairBONKpairBONKpairBONKpair1", base: [BONK, "Bonk", "Bonk"], price: "0.0000034", liq: 370_000 }),
        screener({ chain: "tron", pair: "TRONpair", base: ["TXYZ", "On Tron", "TRX1"], price: "1", liq: 9_000_000 }),
      ] });
    }
    const tokens = /^\/tokens\/v1\/([a-z]+)\/(.+)$/.exec(url.pathname);
    if (tokens) {
      if (tokens[2] === MINT) return json([screener({ pair: THIN, dex: "pumpfun", base: [MINT, "Fartcoin", "Fartcoin"], price: "0.15", liq: 5_000, created: START - 3600_000 }), fart]);
      if (tokens[2] === EVM_TOKEN) return json([screener({ chain: "base", dex: "uniswap", pair: "0x2222222222222222222222222222222222222222", base: [EVM_TOKEN, "Test", "TST"], price: "2", liq: 50_000 })]);
      return json([]);
    }
    const ohlcv = /^\/networks\/([a-z_]+)\/pools\/([^/]+)\/ohlcv\/(minute|hour|day)$/.exec(url.pathname);
    if (ohlcv) {
      const step = url.searchParams.get("aggregate") === "5" ? 300 : 60;
      const at = Math.floor(START / 1000);
      // newest first, as GeckoTerminal gives them
      return json({ data: { attributes: { ohlcv_list: [0, 1, 2, 3].map((i) => [at - i * step, 0.16 + i * 0.001, 0.17, 0.15, 0.16 - i * 0.001, 1000 + i]) } } });
    }
    if (/^\/networks\/solana\/pools\/[^/]+\/trades$/.test(url.pathname)) {
      return json({ data: [
        { attributes: { block_timestamp: "2026-10-11T11:59:00Z", tx_hash: "sig1", tx_from_address: "buyer1", kind: "buy", from_token_address: WSOL, to_token_address: MINT, from_token_amount: "1", to_token_amount: "680", price_from_in_usd: "110", price_to_in_usd: "0.161", volume_in_usd: "110" } },
        { attributes: { block_timestamp: "2026-10-11T11:58:00Z", tx_hash: "sig2", tx_from_address: "seller1", kind: "sell", from_token_address: MINT, to_token_address: WSOL, from_token_amount: "15000", to_token_amount: "22", price_from_in_usd: "0.164", price_to_in_usd: "109", volume_in_usd: "2460" } },
      ] });
    }
    if (url.pathname === "/networks/solana/trending_pools") {
      return json({
        data: [{ attributes: { address: THIN, base_token_price_usd: "0.0000451", base_token_price_native_currency: "0.0000004", pool_created_at: "2026-10-10T19:01:06Z", fdv_usd: "45179", market_cap_usd: null, price_change_percentage: { m5: "0", h1: "2", h6: "10", h24: "1193.8" }, transactions: { h24: { buys: 40, sells: 12 } }, volume_usd: { h24: "52000" }, reserve_in_usd: "18000" }, relationships: { base_token: { data: { id: `solana_${MINT}` } }, quote_token: { data: { id: `solana_${WSOL}` } }, dex: { data: { id: "pump-fun" } } } }, { attributes: { address: POOL, base_token_price_usd: "0.0000451", base_token_price_native_currency: "0.0000004", pool_created_at: "2026-10-10T19:01:06Z", fdv_usd: "45179", market_cap_usd: null, price_change_percentage: { m5: "0", h1: "2", h6: "10", h24: "1193.8" }, transactions: { h24: { buys: 40, sells: 12 } }, volume_usd: { h24: "52000" }, reserve_in_usd: "8000000" }, relationships: { base_token: { data: { id: `solana_${MINT}` } }, quote_token: { data: { id: `solana_${WSOL}` } }, dex: { data: { id: "pump-fun" } } } }],
        included: [{ id: `solana_${MINT}`, type: "token", attributes: { address: MINT, name: "Fartcoin", symbol: "Fartcoin", image_url: "https://example.test/t.png" } }, { id: `solana_${WSOL}`, type: "token", attributes: { address: WSOL, name: "Wrapped SOL", symbol: "SOL" } }],
      });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch & { urls: string[] };
  f.urls = urls;
  return f;
}

