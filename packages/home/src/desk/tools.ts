// The desk's tools (PLAN 5.25, 5.34), its orbs' (and the money orbs', by specialty): prices and charts, a strategy
// backtested, kept and run on an orb's account, an order placed on that account, research notes on a coin, your wallets'
// holdings (read only). An orb's account is on paper or real money as you set it (desk.ts `account`), and nothing an orb
// reads here says which (owner, 10-11: "we dont want the orbs to know the difference. money is money"): an order is
// placed the one way (orders.ts), and an order of real money is only ever asked of you there (it waits for your yes and
// your wallet's signature, swaps.ts); no tool here moves anything.
import type { ToolDef, ToolResult } from "../agent/tools.ts";
import { GROUPS } from "../agent/groups.ts";
import { atr, ema, macd, rsi, type Candle } from "./indicators.ts";
import type { Desk } from "./desk.ts";
import type { Orders } from "./orders.ts";
import type { Wallets } from "./wallets.ts";
import { OPS, problemOf, SYMBOLS, TIMEFRAMES, words, type Strategy, type Timeframe } from "./strategy.ts";
import { DEX_CHAINS, isDexChain, isTokenAddress, readTokenKey, tokenKey, type Dex, type DexChain, type DexPair } from "./dex.ts";
import type { Safety } from "./safety.ts";
import { CHAINS } from "./chains.ts";

const obj = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({ type: "object", properties, required, additionalProperties: false });
const s = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const usd = (n: number): string => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number | null): string => (n === null || !Number.isFinite(n) ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
const fail = (e: unknown): ToolResult => ({ content: e instanceof Error ? e.message : String(e), isError: true });
const majorParam = { type: "string", enum: [...SYMBOLS] };
/** A market: one of the majors, or any token on a DEX by its chain and address (PLAN 5.28). */
const symbolParam = { type: "string", description: `${SYMBOLS.join(", ")}; or any token by its chain and address, as "solana:<mint>" or "base:0x…" (token_search finds them; a pump.fun token's mint ends in "pump")` };
/** A market as given, or why it is not one. */
const marketOf = (v: unknown): string | Error => {
  const x = s(v).trim();
  return (SYMBOLS as readonly string[]).includes(x) || readTokenKey(x) ? x : new Error(`"${x}" is not a market: one of ${SYMBOLS.join(", ")}, or a token as "solana:<mint>" or "base:0x…"`);
};
const money = (n: number | null): string => (n === null ? "n/a" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`);
const ago = (at: number | null, now: number): string => {
  if (at === null) return "n/a";
  const h = (now - at) / 3600_000;
  return h < 1 ? `${Math.round(h * 60)} minutes` : h < 48 ? `${Math.round(h)} hours` : `${Math.round(h / 24)} days`;
};
/** A pair in a line a model can read. */
const pairLine = (p: DexPair, now: number): string =>
  `${p.base.symbol} (${p.base.name}) on ${p.chain}, ${tokenKey(p.chain, p.base.address)}: ${p.priceUsd === null ? "no price" : `$${p.priceUsd.toPrecision(6)}`}, ${pct(p.change.h24)} 24h, ${pct(p.change.h1)} 1h; liquidity ${money(p.liquidityUsd)}, 24h volume ${money(p.volume24h)}, market cap ${money(p.marketCap ?? p.fdv)}; ${p.buys24h ?? "?"} buys and ${p.sells24h ?? "?"} sells in 24h; its pair ${ago(p.createdAt, now)} old, on ${p.dex}.`;

/** The strategy's shape, for the model: what `propose_strategy` and `backtest_strategy` take. */
const SERIES = {
  type: "object",
  description: "A series: {kind:'price', field:'close'|'open'|'high'|'low'|'volume'}, {kind:'sma'|'ema'|'rsi'|'atr'|'change', period}, {kind:'macd'|'macd_signal'|'macd_hist'}, {kind:'bb_upper'|'bb_middle'|'bb_lower', period, k}, {kind:'highest'|'lowest', period, field}: of the bars BEFORE, or {kind:'value', value}.",
};
const RULES = { type: "object", description: `{all:[conditions]} or {any:[conditions]}, 1 to 8; a condition is {left: series, op: one of ${OPS.join(", ")}, right: series}.`, properties: { all: { type: "array", items: { type: "object", properties: { left: SERIES, op: { type: "string", enum: [...OPS] }, right: SERIES } } }, any: { type: "array", items: { type: "object" } } } };
const STRATEGY = {
  type: "object",
  description: "A long-only strategy: a signal read at a bar's close fills at the next bar's open, a swap's fee and slippage paid both ways.",
  properties: {
    name: { type: "string" }, symbol: symbolParam, timeframe: { type: "string", enum: [...TIMEFRAMES] }, entry: RULES, exit: RULES,
    stopLossPct: { type: "number" }, takeProfitPct: { type: "number" }, trailingStopPct: { type: "number" }, sizePct: { type: "number", description: "Of the account a trade takes, 1 to 100." },
  },
  required: ["name", "symbol", "timeframe", "entry", "sizePct"],
};

/** A chart said in numbers a model can read: where the price is against its averages, its momentum, its range. */
export function chartWords(symbol: string, tf: Timeframe, c: readonly Candle[]): string {
  if (c.length < 30) return `${symbol} on ${tf}: only ${c.length} bars, too few to read.`;
  const closes = c.map((b) => b.c);
  const last = c[c.length - 1]!;
  const [e20, e50] = [ema(closes, 20).at(-1)!, ema(closes, 50).at(-1)!];
  const r = rsi(closes, 14).at(-1)!;
  const h = macd(closes).hist;
  const a = atr(c, 14).at(-1)!;
  const hi = Math.max(...c.slice(-50).map((b) => b.h));
  const lo = Math.min(...c.slice(-50).map((b) => b.l));
  const trend = last.c > e20 && e20 > e50 ? "up (the price over its 20-bar EMA, that over its 50-bar)" : last.c < e20 && e20 < e50 ? "down (the price under its 20-bar EMA, that under its 50-bar)" : "mixed";
  return [
    `${symbol} on ${tf} bars, the last ${c.length} closed: last close ${last.c.toPrecision(6)}, ${pct(((last.c - c[c.length - 25]!.c) / c[c.length - 25]!.c) * 100)} over 24 bars.`,
    `Trend: ${trend}. EMA20 ${e20.toPrecision(6)}, EMA50 ${Number.isNaN(e50) ? "n/a" : e50.toPrecision(6)}.`,
    `Momentum: RSI(14) ${r.toFixed(1)}${r > 70 ? " (stretched up)" : r < 30 ? " (stretched down)" : ""}; MACD's histogram ${h.at(-1)! >= 0 ? "above" : "below"} zero, ${Math.abs(h.at(-1)!) > Math.abs(h.at(-2)!) ? "growing" : "shrinking"}.`,
    `Range: ATR(14) ${a.toPrecision(4)} (${((a / last.c) * 100).toFixed(2)}% a bar); the last 50 bars from ${lo.toPrecision(6)} to ${hi.toPrecision(6)}.`,
    `The last 12 closes: ${closes.slice(-12).map((x) => x.toPrecision(6)).join(", ")}.`,
  ].join("\n");
}

export function deskTools(o: { desk: Desk; wallets: Wallets; orders: Orders; dex: Dex; safety: (chain: DexChain, address: string) => Promise<Safety>; now: () => number; nameOf: (orb: string) => string }): ToolDef[] {
  const { desk, wallets, orders, dex } = o;
  const g = GROUPS.desk;
  return [
    // any token on a DEX (PLAN 5.28; owner, 10-11: "shitcoins, anything", pump.fun's too): found, then read
    {
      name: "token_search", group: g, label: "Looking up a token",
      description: "Find any token on a DEX by its name, symbol or contract address (a pump.fun token's mint ends in \"pump\"), on Solana, Ethereum, Base, Arbitrum, Optimism, Polygon and BNB Chain: each with its price, change, liquidity, volume, market cap, buys and sells, and its pair's age. The key it gives (\"solana:<mint>\") is what market_chart, place_order and token_info take.",
      parameters: obj({ query: { type: "string" } }, ["query"]),
      describe: (a) => `look up ${s(a.query)}`, decision: "allow",
      async run(a) {
        try {
          const found = (await dex.search(s(a.query))).slice(0, 8);
          return { content: found.length ? found.map((p) => pairLine(p, o.now())).join("\n") : `Nothing found for "${s(a.query)}".` };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "token_info", group: g, label: "Reading a token",
      description: "One token in full: its most liquid pairs, and what it can do to whoever holds it, read from its own chain (on Solana an authority that can freeze what you hold or mint more, or a fee on every transfer; on the EVM chains functions that can stop you selling, or a proxy). Read it before any trade in a token you have not traded.",
      parameters: obj({ chain: { type: "string", enum: [...DEX_CHAINS] }, address: { type: "string" } }, ["chain", "address"]),
      describe: (a) => `read ${s(a.chain)} token ${s(a.address).slice(0, 10)}…`, decision: "allow",
      async run(a) {
        try {
          const chain = s(a.chain);
          const address = s(a.address).trim();
          if (!isDexChain(chain) || !isTokenAddress(chain, address)) return fail(new Error(`not a ${chain} token address`));
          const pairs = (await dex.token(chain, address)).slice(0, 4);
          if (!pairs.length) return { content: "No pair trades this token now." };
          const safe = await o.safety(chain, address);
          return { content: [...pairs.map((p) => pairLine(p, o.now())), `Checked ${safe.checked.join(", ") || "nothing"}: ${safe.flags.length ? safe.flags.map((f) => `${f.level === "warn" ? "WARN" : "note"}: ${f.words}`).join("; ") : "nothing found against it."}`].join("\n") };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "market_prices", group: g, label: "Reading the prices",
      description: `The price now of ${SYMBOLS.join(", ")} (in dollars), with the change, high and low over 24 hours; a price older than a minute is said stale.`,
      parameters: obj({ symbols: { type: "array", items: majorParam } }, []),
      describe: () => "read the market's prices", decision: "allow",
      async run(a) {
        try {
          const list = await desk.market.tickers(Array.isArray(a.symbols) && a.symbols.length ? (a.symbols as string[]) : [...SYMBOLS]);
          if (!list.length) return { content: `The market cannot say now: ${desk.market.status().error ?? "no answer"}.`, isError: true };
          return { content: list.map((t) => `${t.symbol} ${usd(t.price)} ${pct(t.changePct)} (24h ${usd(t.low)} to ${usd(t.high)})${t.stale ? " STALE" : ""}`).join("\n") };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "market_chart", group: g, label: "Reading a chart",
      description: "A market's chart read in numbers: the trend against its 20 and 50-bar EMAs, RSI, MACD, its range (ATR) and its last closes, from the bars that have closed.",
      parameters: obj({ symbol: symbolParam, timeframe: { type: "string", enum: [...TIMEFRAMES] } }, ["symbol", "timeframe"]),
      describe: (a) => `read ${s(a.symbol)}'s ${s(a.timeframe)} chart`, decision: "allow",
      async run(a) {
        try {
          const m = marketOf(a.symbol);
          if (m instanceof Error) return fail(m);
          return { content: chartWords(m, s(a.timeframe) as Timeframe, await desk.market.closed(m, s(a.timeframe) as Timeframe, 200)) };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "backtest_strategy", group: g, label: "Backtesting a strategy",
      description: "Backtest a strategy on the last 500 closed bars of its market, honestly (next-bar fills, fees and slippage both ways, stops inside bars): its return against buying and holding, drawdown, trades, win rate, profit factor. Test before you propose.",
      parameters: obj({ strategy: STRATEGY }, ["strategy"]),
      describe: (a) => `backtest ${s((a.strategy as Strategy | undefined)?.name)}`, decision: "allow",
      async run(a) {
        try {
          const spec = a.strategy as Strategy;
          const bt = await desk.backtest(spec);
          const m = bt.metrics;
          return { content: [words(spec), `Over ${bt.equity.length} bars: ${pct(m.returnPct)} against ${pct(m.holdPct)} for buying and holding; worst drawdown ${m.maxDrawdownPct.toFixed(2)}%; ${m.trades} trades, ${m.winRate === null ? "none won" : `${Math.round(m.winRate * 100)}% won`}, profit factor ${m.profitFactor?.toFixed(2) ?? "n/a"}, in the market ${m.exposurePct.toFixed(0)}% of the time, fees ${usd(m.feesPaid)}.`, ...bt.trades.slice(-5).map((t) => `  ${new Date(t.entryT).toISOString().slice(0, 16)} → ${new Date(t.exitT).toISOString().slice(0, 16)}: ${pct(t.pnlPct)} (${t.why})`)].join("\n") };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "propose_strategy", group: g, label: "Proposing a strategy",
      description: "Keep a strategy on the desk, with its backtest, for the person to see and run (or for you to run on your account with run_strategy). Say why in one line.",
      parameters: obj({ strategy: STRATEGY, why: { type: "string" } }, ["strategy", "why"]),
      describe: (a) => `propose the strategy ${s((a.strategy as Strategy | undefined)?.name)}`, decision: "allow",
      precheck: (a) => problemOf(a.strategy),
      async run(a, ctx) {
        try {
          const spec = a.strategy as Strategy;
          const bt = await desk.backtest(spec).catch(() => null);
          const row = desk.save(spec, ctx.orb, bt);
          return { content: `Kept as strategy ${row.id}: ${row.words}${bt ? ` Backtest: ${pct(bt.metrics.returnPct)} against ${pct(bt.metrics.holdPct)} holding.` : ""}` };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "run_strategy", group: g, label: "Running a strategy",
      description: "Run a kept strategy on your account from now on: at each bar's close it places the order its rules say, from your account's dollars (a trade takes the strategy's sizePct of them). Its closed trades are your XP when they make money after their costs.",
      parameters: obj({ strategy: { type: "number", description: "The strategy's number." } }, ["strategy"]),
      describe: (a) => `run strategy ${s(a.strategy)} on its account`, decision: "allow",
      async run(a, ctx) {
        try {
          const b = await desk.run(Number(a.strategy), ctx.orb);
          return { content: `Running on your account as run ${b.id}, from the next bar's close.` };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "place_order", group: g, label: "Placing an order",
      description: "Place an order on your account: buy `usd` dollars of a market at the price now, or sell `usd` dollars' worth of what you hold of it (all of it when that is more). Its fill shows in your account (desk_book). A trade sold for more than it cost after its costs is XP; a loss is not. Say why in one line.",
      parameters: obj({ market: symbolParam, side: { type: "string", enum: ["buy", "sell"] }, usd: { type: "number", description: "Dollars, 1 to 1,000,000." }, why: { type: "string" } }, ["market", "side", "usd", "why"]),
      describe: (a) => `place an order: ${s(a.side)} ${usd(Number(a.usd))} of ${s(a.market)}`, decision: "allow",
      async run(a, ctx) {
        try {
          const m = marketOf(a.market);
          if (m instanceof Error) return fail(m);
          const order = await orders.place(ctx.orb, { market: m, side: s(a.side) as "buy" | "sell", usd: Number(a.usd), why: s(a.why) });
          return { content: `Order ${order.id} placed: ${order.side} ${usd(order.usd)} of ${m}. Its fill shows in your account (desk_book).` };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "desk_book", group: g, label: "Reading the account",
      description: "Your account: its dollars, what it holds valued now, its result since it began; your orders still to fill and the last that did; each strategy you run on it.",
      parameters: obj({}, []),
      describe: () => "read its account", decision: "allow",
      async run(_a, ctx) {
        try {
          const a = desk.account(ctx.orb);
          const b = a.book;
          const prices = new Map<string, number>();
          for (const h of b.holdings) {
            const p = await desk.market.price(h.symbol).catch(() => null);
            if (p !== null) prices.set(h.symbol, p);
          }
          const held = b.holdings.reduce((n, h) => n + h.qty * (prices.get(h.symbol) ?? h.cost / h.qty), 0);
          const eq = b.cash + held;
          const lines = [
            `Your account: ${usd(eq)}${b.cashStart > 0 ? ` (${pct(((eq - b.cashStart) / b.cashStart) * 100)} since it began with ${usd(b.cashStart)})` : ""}; ${usd(b.cash)} to spend.`,
            b.holdings.length ? `Holding: ${b.holdings.map((h) => `${h.qty.toPrecision(5)} ${h.symbol} (cost ${usd(h.cost)}${prices.has(h.symbol) ? `, now ${usd(h.qty * prices.get(h.symbol)!)}` : ""})`).join("; ")}.` : "Holding nothing.",
          ];
          const list = orders.list(ctx.orb, 12);
          const waiting = list.filter((x) => x.state === "placed");
          const done = list.filter((x) => x.state !== "placed").slice(0, 6);
          if (waiting.length) lines.push(`Orders to fill: ${waiting.map((x) => `#${x.id} ${x.side} ${usd(x.usd)} of ${x.market}`).join("; ")}.`);
          if (done.length) lines.push(`Last orders: ${done.map((x) => (x.state === "filled" ? `#${x.id} ${x.side === "buy" ? "bought" : "sold"} ${x.qty?.toPrecision(5)} ${x.market} at ${usd(x.px ?? 0)}` : `#${x.id} ${x.side} ${x.market}: not filled, ${x.reason ?? "it did not go through"}`)).join("; ")}.`);
          const runs = desk.books().filter((x) => x.orb === ctx.orb && x.strategy !== null && x.state === "live");
          for (const r of runs) {
            const st = desk.strategy(r.strategy!);
            const closed = desk.closedTrades(ctx.orb, r.strategy!);
            lines.push(`Run ${r.id}, ${st?.name ?? `strategy ${r.strategy}`} on ${r.symbol}: ${closed.n} closed trade${closed.n === 1 ? "" : "s"}, ${usd(closed.pnl)} after their costs.`);
          }
          return { content: lines.join("\n") };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "market_note", group: g, label: "Writing a market note",
      description: "Pin a research note on a coin to the desk's wall (its fundamentals, on-chain facts, a risk, what changed), for the person and the desk. Cite where each fact came from.",
      parameters: obj({ symbol: { type: "string" }, title: { type: "string" }, text: { type: "string" } }, ["symbol", "title", "text"]),
      describe: (a) => `pin a note on ${s(a.symbol)}`, decision: "allow",
      async run(a, ctx) {
        try {
          return { content: `Pinned as note ${desk.note(ctx.orb, s(a.symbol), s(a.title), s(a.text)).id}.` };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "wallet_holdings", group: g, label: "Reading the wallets",
      description: "What the person's connected wallets hold now, by chain, valued at the market's prices (read only: nothing here can move anything).",
      parameters: obj({}, []),
      describe: () => "read the person's wallets' holdings", decision: "allow",
      async run() {
        const list = wallets.list();
        if (!list.length) return { content: "No wallet is connected yet." };
        const out: string[] = [];
        for (const w of list) {
          const h = await wallets.holdings(w.id).catch((e: Error) => ({ holdings: [], errors: [e.message], at: 0 }));
          out.push(`${w.label || w.wallet || w.chain} (${w.chain}): ${h.holdings.map((x) => `${x.amount} ${x.symbol} on ${x.chain}${x.usd === null ? "" : ` (${usd(x.usd)})`}`).join(", ") || "nothing held"}${h.errors.length ? `; not read: ${h.errors.join("; ")}` : ""}`);
        }
        return { content: out.join("\n") };
      },
    },
  ];
}
