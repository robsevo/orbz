// An orb's orders (PLAN 5.34; owner, 10-11: "how do we alternate between paper and real? and we dont want the orbs to
// know the difference. money is money"). An orb places an order on its account one way, `place`, whichever its account
// is (Desk.account; yours alone to set, never an orb's): on paper it fills at the price now in its own book; with real
// money it is a swap asked of you (rule 9: every real trade waits for your yes and your wallet's signature, swaps.ts),
// paid from the budget you gave its account and filled when its chain confirms it. Either way the orb is told the same:
// placed; and its fill shows in its account. A strategy run on an account of real money places its orders here, at each
// bar's close (`due`).
import type { DatabaseSync } from "node:sqlite";
import type { EventLog } from "../events.ts";
import { chainOf, tokenOf } from "./chains.ts";
import { readTokenKey } from "./dex.ts";
import { DeskError, type Book, type Desk, type PaperQuote } from "./desk.ts";
import type { Market } from "./market.ts";
import { seriesOf, signalAt, type Series } from "./strategy.ts";
import type { Swap, Swaps } from "./swaps.ts";

export type Order = {
  id: number; orb: string; book: number; market: string; side: "buy" | "sell"; usd: number; why: string;
  state: "placed" | "filled" | "not_filled"; swap: number | null; strategy: number | null;
  qty: number | null; px: number | null; reason: string | null; at: number; doneAt: number | null;
};
type Row = { id: number; orb: string; book: number; market: string; side: "buy" | "sell"; usd: number; why: string; state: Order["state"]; swap: number | null; strategy: number | null; qty: number | null; px: number | null; reason: string | null; at: number; done_at: number | null };

/** Where a major is bought with real money: its own coin on a chain the desk swaps on. */
export const ROUTES: Record<string, { chain: string; token: string }> = {
  BTC: { chain: "base", token: "cbBTC" }, ETH: { chain: "base", token: "ETH" }, SOL: { chain: "solana", token: "SOL" }, BNB: { chain: "bsc", token: "BNB" },
  LINK: { chain: "ethereum", token: "LINK" }, UNI: { chain: "ethereum", token: "UNI" }, AAVE: { chain: "ethereum", token: "AAVE" },
};
/** What an account's dollars are on every chain. */
export const CASH = "USDC";

/** An amount as a swap takes it: no more decimals than its token has, cut down (never more than is held). */
export const amountText = (qty: number, decimals: number): string => {
  const d = Math.max(0, Math.min(decimals, 9));
  const cut = Math.floor(qty * 10 ** d) / 10 ** d;
  return cut.toFixed(d).replace(/\.?0+$/, "") || "0";
};

export class Orders {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #desk: Desk;
  readonly #swaps: Swaps;
  readonly #market: Market;
  readonly #now: () => number;

  constructor(db: DatabaseSync, events: EventLog, desk: Desk, swaps: Swaps, market: Market, now: () => number) {
    this.#db = db;
    this.#events = events;
    this.#desk = desk;
    this.#swaps = swaps;
    this.#market = market;
    this.#now = now;
  }

  #of(r: Row): Order {
    return { id: r.id, orb: r.orb, book: r.book, market: r.market, side: r.side, usd: r.usd, why: r.why, state: r.state, swap: r.swap, strategy: r.strategy, qty: r.qty, px: r.px, reason: r.reason, at: r.at, doneAt: r.done_at };
  }
  get(id: number): Order | null {
    const r = this.#db.prepare("SELECT * FROM desk_orders WHERE id = ?").get(id) as Row | undefined;
    return r ? this.#of(r) : null;
  }
  /** An orb's orders, the newest first. */
  list(orb: string, limit = 20): Order[] {
    return (this.#db.prepare("SELECT * FROM desk_orders WHERE orb = ? ORDER BY id DESC LIMIT ?").all(orb, limit) as Row[]).map((r) => this.#of(r));
  }

  #insert(o: Omit<Order, "id" | "doneAt"> & { doneAt?: number | null }): Order {
    const { lastInsertRowid } = this.#db.prepare("INSERT INTO desk_orders (orb, book, market, side, usd, why, state, swap, strategy, qty, px, reason, at, done_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(o.orb, o.book, o.market, o.side, o.usd, o.why, o.state, o.swap, o.strategy, o.qty, o.px, o.reason, o.at, o.doneAt ?? null);
    const order = this.get(Number(lastInsertRowid))!;
    this.#events.append("desk.order", { order: order.id, market: o.market, side: o.side, usd: o.usd, strategy: o.strategy }, { orb: o.orb });
    return order;
  }

  /** An order on an orb's account: `usd` dollars of `market` bought, or that many dollars' worth of what it holds sold. */
  async place(orb: string, o: { market: string; side: "buy" | "sell"; usd: number; why?: string; strategy?: number | null }): Promise<Order> {
    if (!(o.usd >= 1 && o.usd <= 1_000_000)) throw new DeskError("an order is $1 to $1,000,000");
    if (o.side !== "buy" && o.side !== "sell") throw new DeskError("an order buys or sells");
    const why = (o.why ?? "").slice(0, 400);
    const a = this.#desk.account(orb);
    const at = this.#now();
    if (a.mode === "paper") {
      const r = await this.paper(orb, o);
      return this.#insert({ orb, book: a.book.id, market: o.market, side: o.side, usd: o.usd, why, state: "filled", swap: null, strategy: o.strategy ?? null, qty: r.qty, px: r.px, reason: null, at, doneAt: at });
    }
    // real money: a swap asked of you, from the budget its account has left (what waits to be bought is spoken for)
    if (o.side === "buy") {
      const left = a.book.cash - this.#waiting(orb).filter((x) => x.side === "buy").reduce((n, x) => n + x.usd, 0);
      if (o.usd > left + 1e-9) throw new DeskError(`the account has $${Math.max(0, left).toFixed(2)} to spend`);
    }
    const route = await this.#route(a.book, o);
    let sw: Swap;
    try {
      sw = await this.#swaps.ask({ by: orb, chain: route.chain, sell: route.sell, buy: route.buy, amount: route.amount, why });
    } catch (e) {
      // a coin with fewer decimals than six: its own count, once
      const d = /has (\d+) decimals/.exec(e instanceof Error ? e.message : "");
      if (!d || o.side !== "sell") throw e;
      sw = await this.#swaps.ask({ by: orb, chain: route.chain, sell: route.sell, buy: route.buy, amount: amountText(route.qty, Number(d[1])), why });
    }
    return this.#insert({ orb, book: a.book.id, market: o.market, side: o.side, usd: o.usd, why, state: "placed", swap: sw.id, strategy: o.strategy ?? null, qty: null, px: null, reason: null, at });
  }

  /** A paper trade as the market would fill it now (PLAN 5.38; owner, 10-11: "simulate slippage etc."): at the router's
   * own quote for its size where the coin has a route (the route a real order takes: its pools' slippage, its price
   * impact, its network fee), else at the market's price and the desk's usual cost. An orb's paper orders, and yours. */
  async paper(orb: string, o: { market: string; side: "buy" | "sell"; usd: number }): ReturnType<Desk["paperTrade"]> {
    const quote = await this.#quote(this.#desk.ownBook(orb), o).catch(() => null);
    return this.#desk.paperTrade(orb, o.market, o.side, o.usd, quote ?? undefined);
  }

  /** The router's quote for a paper trade's size, or null where the coin has no route (or no quote now). */
  async #quote(book: Book, o: { market: string; side: "buy" | "sell"; usd: number }): Promise<PaperQuote | null> {
    const key = readTokenKey(o.market);
    const where = key ? { chain: key.chain, token: key.address } : ROUTES[o.market];
    const chain = where && chainOf(where.chain);
    if (!where || !chain) return null;
    if (o.side === "buy") {
      const q = await this.#swaps.quote({ chain: where.chain, sell: CASH, buy: where.token, amount: o.usd.toFixed(2) });
      const qty = Number(q.out);
      return qty > 0 ? { qty, usd: o.usd, feeUsd: q.feeUsd ?? 0, impact: q.priceImpactPct } : null;
    }
    const held = book.holdings.find((h) => h.symbol === o.market);
    const px = await this.#market.price(o.market);
    if (!held || px === null) return null;
    const amount = amountText(Math.min(held.qty, o.usd / px), tokenOf(chain, where.token)?.decimals ?? 6);
    const q = await this.#swaps.quote({ chain: where.chain, sell: where.token, buy: CASH, amount });
    const got = Number(q.out);
    return got > 0 && Number(amount) > 0 ? { qty: Number(amount), usd: got, feeUsd: q.feeUsd ?? 0, impact: q.priceImpactPct } : null;
  }

  /** An orb's orders still waiting to fill. */
  #waiting(orb: string): Order[] {
    return (this.#db.prepare("SELECT * FROM desk_orders WHERE orb = ? AND state = 'placed'").all(orb) as Row[]).map((r) => this.#of(r));
  }

  /** Where a real order goes: the market's chain, paid in its dollars; a sale of what the account holds. */
  async #route(book: Book, o: { market: string; side: "buy" | "sell"; usd: number }): Promise<{ chain: string; sell: string; buy: string; amount: string; qty: number }> {
    const key = readTokenKey(o.market);
    const where = key ? { chain: key.chain, token: key.address } : ROUTES[o.market];
    const chain = where && chainOf(where.chain);
    if (!where || !chain) throw new DeskError(`${o.market} cannot be traded from this account now: it has no market on the chains it trades`);
    if (o.side === "buy") return { chain: where.chain, sell: CASH, buy: where.token, amount: o.usd.toFixed(2), qty: o.usd };
    const held = book.holdings.find((h) => h.symbol === o.market);
    if (!held || held.qty <= 0) throw new DeskError(`the account holds no ${o.market}`);
    const px = await this.#market.price(o.market);
    if (px === null) throw new DeskError(`no live price for ${o.market} now`);
    const qty = Math.min(held.qty, o.usd / px);
    const decimals = tokenOf(chain, where.token)?.decimals ?? 6;
    return { chain: where.chain, sell: where.token, buy: CASH, amount: amountText(qty, decimals), qty };
  }

  /** A real order's swap is done (swaps.ts `onSettled`): confirmed, it fills into the account, what was bought or the
   * dollars a sale brought as its quote said; denied, failed or expired, it did not fill, and its dollars are free. */
  settled(s: Swap): void {
    const r = this.#db.prepare("SELECT * FROM desk_orders WHERE swap = ?").get(s.id) as Row | undefined;
    if (!r || r.state !== "placed") return;
    const at = this.#now();
    if (s.state === "confirmed") {
      const out = Number(s.quote?.out);
      const [qty, usd] = r.side === "buy" ? [out, r.usd] : [Number(s.amount), out];
      if (qty > 0 && usd > 0) {
        this.#desk.realFill({ orb: r.orb, market: r.market, side: r.side, qty, usd, strategy: r.strategy, order: r.id });
        this.#db.prepare("UPDATE desk_orders SET state = 'filled', qty = ?, px = ?, done_at = ? WHERE id = ?").run(qty, usd / qty, at, r.id);
        this.#events.append("desk.order_filled", { order: r.id, market: r.market, side: r.side, qty, px: usd / qty }, { orb: r.orb });
        return;
      }
    }
    if (s.state === "confirmed" || s.state === "denied" || s.state === "failed" || s.state === "expired") {
      this.#db.prepare("UPDATE desk_orders SET state = 'not_filled', reason = ?, done_at = ? WHERE id = ?").run("it did not go through", at, r.id);
      this.#events.append("desk.order_not_filled", { order: r.id, market: r.market, side: r.side }, { orb: r.orb });
    }
  }

  /** Each strategy run on an account of real money, at each bar's close: what its rules say for the account (holding
   * its market or not) is an order, unless one of the orb's orders in that market is still waiting. */
  async due(): Promise<void> {
    for (const b of this.#desk.books().filter((x) => x.real && x.strategy !== null && x.state === "live")) {
      const s = this.#desk.strategy(b.strategy!);
      const a = this.#desk.account(b.orb);
      if (!s || a.mode !== "real") continue; // made paper again: the run waits
      let bars;
      try {
        bars = await this.#market.closed(s.spec.symbol, s.spec.timeframe, 500);
      } catch {
        continue; // the market is resting: the next tick asks again
      }
      const last = bars.at(-1);
      if (!last || (b.lastBar !== null && last.t <= b.lastBar)) continue;
      const held = a.book.holdings.find((h) => h.symbol === s.spec.symbol && h.qty > 0);
      const best = held ? Math.max(b.best, last.h) : 0;
      this.#desk.markRun(b.id, last.t, best);
      if (this.#waiting(b.orb).some((x) => x.market === s.spec.symbol)) continue;
      const cache = new Map<string, number[]>();
      const read = (x: Series): number[] => cache.get(JSON.stringify(x)) ?? cache.set(JSON.stringify(x), seriesOf(x, bars)).get(JSON.stringify(x))!;
      const signal = signalAt(s.spec, bars, bars.length - 1, read, held ? { entryPx: held.cost / held.qty, best } : null);
      if (!signal) continue;
      const usd = signal === "buy" ? (a.book.cash * s.spec.sizePct) / 100 : held!.qty * last.c;
      try {
        if (usd >= 1) await this.place(b.orb, { market: s.spec.symbol, side: signal, usd: Math.floor(usd * 100) / 100, why: `${s.name}: its ${signal === "buy" ? "entry" : "exit"} at the close`, strategy: s.id });
      } catch (e) {
        this.#events.append("desk.order_refused", { book: b.id, strategy: s.id, market: s.spec.symbol, side: signal, error: e instanceof Error ? e.message : String(e) }, { orb: b.orb });
      }
    }
  }
}
