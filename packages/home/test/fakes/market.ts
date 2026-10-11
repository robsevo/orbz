// Stand-ins for the desk's outside world (PLAN 5.23-5.27): a made-up market whose bars are a fixed function of
// time (only the bars that have opened by the clock are given), DEX routers that quote at the market's price and build
// a transaction, and chains that answer balances, allowances and receipts as a test sets them. Nothing reaches a network.
import type { Candle } from "../../src/desk/indicators.ts";
import type { MarketSource, Ticker } from "../../src/desk/market.ts";
import type { Quote, Routers } from "../../src/desk/swaps.ts";
import { TIMEFRAME_MS, type Timeframe } from "../../src/desk/strategy.ts";

/** Where the made-up market's bars are counted from (bar 0), so its drift stays gentle whatever the clock says. */
const REF = Date.parse("2026-10-01T00:00:00Z");
/** A symbol's made-up close at bar i: a slow wave on a gentle drift, its own level per symbol. */
export const levelOf = (symbol: string): number => ({ BTC: 80_000, ETH: 2_500, SOL: 110 } as Record<string, number>)[symbol] ?? 50;
export function made(symbol: string, i: number): number {
  const base = levelOf(symbol);
  return base * (1 + 0.00001 * i + 0.03 * Math.sin(i / 7) + 0.006 * Math.sin(i * 1.7));
}

export function standInMarket(now: () => number, o: { fail?: () => boolean; price?: (symbol: string) => number | null; ranks?: () => string[] } = {}): MarketSource & { asks: number } {
  const src = {
    name: "stand-in market",
    asks: 0,
    ...(o.ranks && { ranks: async (): Promise<string[]> => (src.asks++, o.ranks!()) }),
    async candles(symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> {
      src.asks++;
      if (o.fail?.()) throw new Error("the stand-in market is down");
      const ms = TIMEFRAME_MS[tf];
      const last = Math.floor((now() - REF) / ms); // the bar forming now, counted from REF
      const out: Candle[] = [];
      for (let i = last - limit + 1; i <= last; i++) {
        const c = made(symbol, i);
        const open = made(symbol, i - 1);
        out.push({ t: REF + i * ms, o: open, h: Math.max(open, c) * 1.002, l: Math.min(open, c) * 0.998, c, v: 100 });
      }
      return out;
    },
    async tickers(symbols: readonly string[]): Promise<Ticker[]> {
      src.asks++;
      if (o.fail?.()) throw new Error("the stand-in market is down");
      return symbols.map((s) => {
        const p = o.price?.(s) ?? made(s, Math.floor((now() - REF) / 60_000));
        return { symbol: s, price: p, changePct: 1, high: p * 1.02, low: p * 0.98, volume: 1e6, at: now() };
      });
    },
  };
  return src;
}

/** Routers that quote at a price a test moves (`outPer`: how much of what is bought one of what is sold gets). */
export function standInRouters(o: { outPer: () => number }): Routers & { built: number } {
  const quote = (units: bigint, inDec: number, outDec: number): Quote & { raw: unknown } => {
    const out = BigInt(Math.floor((Number(units) / 10 ** inDec) * o.outPer() * 10 ** outDec));
    return { amountIn: units.toString(), amountOut: out.toString(), out: (Number(out) / 10 ** outDec).toString(), priceImpactPct: 0.05, feeUsd: 0.01, route: ["stand-in pool"], router: "0x1111111111111111111111111111111111111111", raw: { units: units.toString() } };
  };
  const r = {
    built: 0,
    async evmQuote(_c: unknown, sell: { decimals: number }, buy: { decimals: number }, units: bigint) {
      return quote(units, sell.decimals, buy.decimals);
    },
    async evmBuild(_c: unknown, _raw: unknown, _from: string) {
      r.built++;
      return { to: "0x1111111111111111111111111111111111111111", data: "0xdeadbeef", value: "0", gas: "200000", amountOut: "0" };
    },
    async solQuote(sell: { decimals: number }, buy: { decimals: number }, units: bigint) {
      return quote(units, sell.decimals, buy.decimals);
    },
    async solBuild() {
      r.built++;
      return { transaction: "AQAB" };
    },
  };
  return r as Routers & { built: number };
}

/** A chain's JSON-RPC as a test sets it: each method's answer by a function of its params. */
/** Stand-in chains: each JSON-RPC method answered by its handler, which is told which endpoint was asked and refuses by
 * throwing (a JSON-RPC error, as an endpoint that will not answer gives one); "GET /path" handlers answer a plain GET
 * whose path starts so (Jupiter's balances), with their value as the body, and anything else a GET asks is a 404. */
export function standInChains(answers: Record<string, (params: unknown[], url: string) => unknown>): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const json = (v: unknown, status = 200): Response => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!init?.body) {
      const path = new URL(url).pathname;
      const route = Object.keys(answers).find((k) => k.startsWith("GET ") && path.startsWith(k.slice(4)));
      calls.push(route ?? `GET ${path}`);
      return route ? json(answers[route]!([], url)) : json({ error: "no such page" }, 404);
    }
    const { method, params } = JSON.parse(String(init.body)) as { method: string; params: unknown[] };
    calls.push(method);
    const answer = answers[method];
    if (!answer) return json({ jsonrpc: "2.0", id: 1, error: { message: `no ${method} here` } });
    try {
      return json({ jsonrpc: "2.0", id: 1, result: answer(params, url) });
    } catch (e) {
      return json({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: e instanceof Error ? e.message : String(e) } });
    }
  }) as typeof fetch & { calls: string[] };
  f.calls = calls;
  return f;
}
