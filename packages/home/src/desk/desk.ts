// The desk (PLAN 5.24-5.25): the strategies kept, the paper books (a strategy run live by the orb you give it,
// or an orb's own book for the trades it chooses), the research notes, and the settings real trades keep to (PLAN 5.27).
// A live run is stepped at each bar's close by the home's tick (`due`, `nextAt`), by desk/strategy.ts's one simulator
// step: what you see in a backtest is what the run does. A run starts from now: the past bars warm its indicators, they
// never trade. Each fill and each closed trade is an event (`desk.fill`, `desk.trade_closed`); a closed trade is the
// evidence a desk orb's XP is graded on, by the market, never by what the orb says (gym/xp.ts, rule 8).
import type { DatabaseSync } from "node:sqlite";
import type { EventLog } from "../events.ts";
import type { Market } from "./market.ts";
import { backtest, problemOf, sellAt, seriesOf, step, TIMEFRAME_MS, words, type Backtest, type Series, type SimState, type Strategy, type Trade } from "./strategy.ts";

/** What a new paper book starts with, in dollars. */
export const PAPER_START = 10_000;
/** The fee and slippage of an orb's own paper trade, each way: a DEX swap's (PLAN 5.27). */
const OWN_FEE = 0.003;
const OWN_SLIP = 0.001;

export type StrategyRow = { id: number; name: string; by: string | null; spec: Strategy; words: string; backtest: Backtest["metrics"] | null; createdAt: number };
export type Book = {
  id: number; orb: string; strategy: number | null; symbol: string | null; cashStart: number; cash: number;
  qty: number; entryPx: number; entryT: number; fees: number; state: "live" | "stopped"; startedAt: number; stoppedAt: number | null;
  holdings: { symbol: string; qty: number; cost: number; since: number }[];
  /** Real money (PLAN 5.34): an orb's account with a budget you gave it, or a strategy run on that account. */
  real: boolean;
  /** A run's last bar read, and the best price since it bought (a real run keeps them, orders.ts). */
  lastBar: number | null;
  best: number;
};
/** An orb's account (PLAN 5.34; owner, 10-11: "money is money"): on paper, or real money up to the budget you set; the
 * orb trades it one way whichever it is, and is never told which. */
export type Account = { orb: string; mode: "paper" | "real"; budget: number; paper: number; book: Book };
export type Settings = { perTradeUsd: number; perDayUsd: number; slippageBps: number; off: boolean };
export const DEFAULT_SETTINGS: Settings = { perTradeUsd: 100, perDayUsd: 300, slippageBps: 50, off: false };

export class DeskError extends Error {}
/** A router's quote for a paper trade's size (PLAN 5.38): the coins bought (or sold), the dollars paid (or brought),
 * the network's fee in dollars, its price impact. */
export type PaperQuote = { qty: number; usd: number; feeUsd: number; impact: number | null };
/** Your own paper account (PLAN 5.38; owner, 10-11: "still cant decide what amount we want to paper trade"): kept as an
 * orb's is, under a name no orb can have (an orb's id is letters, digits and dashes). */
export const YOU = "~you";
/** An orb's closed trades on paper, summed (PLAN 5.31). */
export type OrbPnl = { orb: string; trades: number; wins: number; realized: number; today: number; best: number | null; worst: number | null; fees: number; last: number | null };

type BookRow = { id: number; real: number; orb: string; strategy: number | null; symbol: string | null; cash_start: number; cash: number; qty: number; entry_px: number; entry_t: number; best: number; fees: number; pending: string | null; last_bar: number | null; state: "live" | "stopped"; started_at: number; stopped_at: number | null };

export class Desk {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #market: Market;
  readonly #now: () => number;
  #stepping: Promise<void> | null = null;

  constructor(db: DatabaseSync, events: EventLog, market: Market, now: () => number) {
    this.#db = db;
    this.#events = events;
    this.#market = market;
    this.#now = now;
  }

  get market(): Market {
    return this.#market;
  }

  // ── strategies ──────────────────────────────────────────────────────────────────────────────────
  /** Keeps a strategy (checked first), and its backtest when one was run. */
  save(spec: Strategy, by: string | null, bt: Backtest | null = null): StrategyRow {
    const p = problemOf(spec);
    if (p) throw new DeskError(p);
    const at = this.#now();
    const { lastInsertRowid } = this.#db.prepare("INSERT INTO desk_strategies (name, by_orb, spec, backtest, created_at) VALUES (?, ?, ?, ?, ?)").run(spec.name.trim(), by, JSON.stringify(spec), bt ? JSON.stringify(bt.metrics) : null, at);
    const id = Number(lastInsertRowid);
    this.#events.append("desk.strategy_saved", { strategy: id, name: spec.name, by, words: words(spec), ...(bt && { metrics: bt.metrics }) }, { orb: by });
    return this.strategy(id)!;
  }

  strategy(id: number): StrategyRow | null {
    const r = this.#db.prepare("SELECT * FROM desk_strategies WHERE id = ?").get(id) as { id: number; name: string; by_orb: string | null; spec: string; backtest: string | null; created_at: number } | undefined;
    if (!r) return null;
    const spec = JSON.parse(r.spec) as Strategy;
    return { id: r.id, name: r.name, by: r.by_orb, spec, words: words(spec), backtest: r.backtest ? (JSON.parse(r.backtest) as Backtest["metrics"]) : null, createdAt: r.created_at };
  }

  strategies(): StrategyRow[] {
    return (this.#db.prepare("SELECT id FROM desk_strategies WHERE archived = 0 ORDER BY id DESC").all() as { id: number }[]).map((r) => this.strategy(r.id)!);
  }

  archive(id: number): void {
    this.#db.prepare("UPDATE desk_strategies SET archived = 1 WHERE id = ?").run(id);
    for (const b of this.books().filter((x) => x.strategy === id && x.state === "live")) this.stop(b.id);
  }

  /** A strategy over the last `bars` closed bars of its market. */
  async backtest(spec: Strategy, bars = 500): Promise<Backtest> {
    const p = problemOf(spec);
    if (p) throw new DeskError(p);
    const c = await this.#market.closed(spec.symbol, spec.timeframe, bars);
    if (c.length < 30) throw new DeskError(`the market gave ${c.length} bars: too few to test on`);
    return backtest(spec, c);
  }

  // ── books ───────────────────────────────────────────────────────────────────────────────────────
  #book(r: BookRow): Book {
    const holdings = this.#db.prepare("SELECT symbol, qty, cost, since FROM desk_holdings WHERE book = ? AND qty > 0 ORDER BY symbol").all(r.id) as Book["holdings"];
    return { id: r.id, orb: r.orb, strategy: r.strategy, symbol: r.symbol, cashStart: r.cash_start, cash: r.cash, qty: r.qty, entryPx: r.entry_px, entryT: r.entry_t, fees: r.fees, state: r.state, startedAt: r.started_at, stoppedAt: r.stopped_at, holdings, real: r.real === 1, lastBar: r.last_bar, best: r.best };
  }

  books(): Book[] {
    return (this.#db.prepare("SELECT * FROM desk_books ORDER BY id").all() as BookRow[]).map((r) => this.#book(r));
  }

  book(id: number): Book | null {
    const r = this.#db.prepare("SELECT * FROM desk_books WHERE id = ?").get(id) as BookRow | undefined;
    return r ? this.#book(r) : null;
  }

  /** Runs a strategy live on paper, by an orb (training it: its trades are its XP). From the last closed bar on. */
  async run(strategyId: number, orb: string, cash?: number): Promise<Book> {
    const s = this.strategy(strategyId);
    if (!s) throw new DeskError(`no strategy ${strategyId}`);
    if (this.books().some((b) => b.strategy === strategyId && b.orb === orb && b.state === "live")) throw new DeskError(`${s.name} is already running for that orb`);
    const bars = await this.#market.closed(s.spec.symbol, s.spec.timeframe, 2);
    const at = this.#now();
    // on a real account the run trades the account itself (its orders, orders.ts): a book of no cash of its own
    // on paper a run begins with the orb's paper amount (yours to set; $10,000 till you do)
    const acct = this.account(orb);
    const real = acct.mode === "real";
    cash = real ? 0 : cash ?? acct.paper;
    const { lastInsertRowid } = this.#db.prepare("INSERT INTO desk_books (orb, strategy, symbol, cash_start, cash, state, started_at, last_bar, real) VALUES (?, ?, ?, ?, ?, 'live', ?, ?, ?)").run(orb, strategyId, s.spec.symbol, cash, cash, at, bars.at(-1)?.t ?? null, real ? 1 : 0);
    const id = Number(lastInsertRowid);
    this.#events.append("desk.run_started", { book: id, strategy: strategyId, name: s.name, symbol: s.spec.symbol, timeframe: s.spec.timeframe, cash, real }, { orb });
    return this.book(id)!;
  }

  /** Stops a book: a live strategy's open position is sold at the price now (a closed trade like any). */
  async stopAndSell(id: number): Promise<Book> {
    const b = this.book(id);
    if (!b) throw new DeskError(`no book ${id}`);
    if (!b.real && b.strategy !== null && b.qty > 0 && b.symbol) {
      const px = await this.#market.price(b.symbol);
      if (px === null) throw new DeskError("the market cannot say a price now: try again in a moment");
      const s = this.strategy(b.strategy)!;
      const st = this.#stateOf(b.id);
      // sold at the price now, the same fee and slippage as any sale
      this.#keep(b, st, [sellAt(s.spec, st, px, this.#now(), "stopped")], s);
    }
    return this.stop(id);
  }

  stop(id: number): Book {
    this.#db.prepare("UPDATE desk_books SET state = 'stopped', stopped_at = ? WHERE id = ? AND state = 'live'").run(this.#now(), id);
    const b = this.book(id);
    if (!b) throw new DeskError(`no book ${id}`);
    this.#events.append("desk.run_stopped", { book: id, strategy: b.strategy }, { orb: b.orb });
    return b;
  }

  #stateOf(id: number): SimState {
    const r = this.#db.prepare("SELECT * FROM desk_books WHERE id = ?").get(id) as BookRow;
    return { cash: r.cash, qty: r.qty, entryPx: r.entry_px, entryT: r.entry_t, best: r.best, feesPaid: r.fees, pending: (r.pending as SimState["pending"]) ?? null, last: r.last_bar };
  }

  #keep(b: Book, st: SimState, trades: Trade[], s: StrategyRow): void {
    const before = this.book(b.id)!;
    this.#db.prepare("UPDATE desk_books SET cash = ?, qty = ?, entry_px = ?, entry_t = ?, best = ?, fees = ?, pending = ?, last_bar = ? WHERE id = ?")
      .run(st.cash, st.qty, st.entryPx, st.entryT, st.best, st.feesPaid, st.pending, st.last, b.id);
    if (before.qty === 0 && st.qty > 0) this.#events.append("desk.fill", { book: b.id, strategy: s.id, symbol: s.spec.symbol, side: "buy", qty: st.qty, px: st.entryPx, paper: true }, { orb: b.orb });
    for (const t of trades) {
      this.#events.append("desk.fill", { book: b.id, strategy: s.id, symbol: s.spec.symbol, side: "sell", qty: t.qty, px: t.exitPx, paper: true, why: t.why }, { orb: b.orb });
      this.#events.append("desk.trade_closed", { book: b.id, strategy: s.id, symbol: s.spec.symbol, timeframe: s.spec.timeframe, paper: true, entryPx: t.entryPx, exitPx: t.exitPx, qty: t.qty, pnl: t.pnl, pnlPct: t.pnlPct, fees: t.fees, held: t.exitT - t.entryT, why: t.why }, { orb: b.orb });
    }
  }

  /** Steps every live strategy book through the bars that have closed since its last. */
  due(): Promise<void> {
    if (this.#stepping) return this.#stepping;
    this.#stepping = (async () => {
      // a run on paper is stepped by the simulator; a run of real money places its orders (orders.ts `due`)
      for (const b of this.books().filter((x) => x.state === "live" && x.strategy !== null && !x.real)) {
        const s = this.strategy(b.strategy!);
        if (!s) continue;
        let bars;
        try {
          bars = await this.#market.closed(s.spec.symbol, s.spec.timeframe, 500);
        } catch {
          continue; // the market is resting: the next tick tries again
        }
        const st = this.#stateOf(b.id);
        const from = bars.findIndex((x) => st.last === null || x.t > st.last);
        if (from < 0) continue;
        const cache = new Map<string, number[]>();
        const at = (x: Series): number[] => {
          const k = JSON.stringify(x);
          return cache.get(k) ?? cache.set(k, seriesOf(x, bars)).get(k)!;
        };
        const trades: Trade[] = [];
        for (let i = from; i < bars.length; i++) trades.push(...step(s.spec, st, bars, i, at));
        this.#keep(b, st, trades, s);
      }
    })().finally(() => (this.#stepping = null));
    return this.#stepping;
  }

  /** When the next bar any live book waits for closes (a few seconds after, for the market to have it). */
  nextAt(): number | null {
    const live = this.books().filter((x) => x.state === "live" && x.strategy !== null);
    if (!live.length) return null;
    const now = this.#now();
    return Math.min(...live.map((b) => {
      const ms = TIMEFRAME_MS[this.strategy(b.strategy!)!.spec.timeframe];
      return Math.floor(now / ms) * ms + ms + 3_000;
    }));
  }

  // ── an orb's account: its own book, on paper or real money (PLAN 5.34) ─────────────────────────────
  /** An orb's own book of the kind asked: paper ($10,000 to start), or real money (the budget you gave it). */
  ownBook(orb: string, real = false): Book {
    const r = this.#db.prepare("SELECT * FROM desk_books WHERE orb = ? AND strategy IS NULL AND state = 'live' AND real = ?").get(orb, real ? 1 : 0) as BookRow | undefined;
    if (r) return this.#book(r);
    const row = this.#accountRow(orb);
    const cash = real ? row?.budget ?? 0 : row?.paper ?? PAPER_START;
    const { lastInsertRowid } = this.#db.prepare("INSERT INTO desk_books (orb, strategy, symbol, cash_start, cash, state, started_at, real) VALUES (?, NULL, NULL, ?, ?, 'live', ?, ?)").run(orb, cash, cash, this.#now(), real ? 1 : 0);
    return this.book(Number(lastInsertRowid))!;
  }

  #accountRow(orb: string): { mode: "paper" | "real"; budget: number; paper: number | null } | undefined {
    return this.#db.prepare("SELECT mode, budget, paper FROM desk_accounts WHERE orb = ?").get(orb) as { mode: "paper" | "real"; budget: number; paper: number | null } | undefined;
  }

  /** Every account you have set: each orb's mode, budget and what its real money has left to spend. */
  accounts(): { orb: string; mode: "paper" | "real"; budget: number; paper: number; cash: number | null }[] {
    return (this.#db.prepare("SELECT orb, mode, budget, COALESCE(paper, ?) AS paper FROM desk_accounts ORDER BY orb").all(PAPER_START) as { orb: string; mode: "paper" | "real"; budget: number; paper: number }[]).map((r) => {
      const real = this.#db.prepare("SELECT cash FROM desk_books WHERE orb = ? AND strategy IS NULL AND state = 'live' AND real = 1").get(r.orb) as { cash: number } | undefined;
      return { ...r, cash: real?.cash ?? null };
    });
  }

  /** An orb's account: paper unless you have made it real money, and its own book of that kind. */
  account(orb: string): Account {
    const r = this.#accountRow(orb);
    const mode = r?.mode ?? "paper";
    return { orb, mode, budget: r?.budget ?? 0, paper: r?.paper ?? PAPER_START, book: this.ownBook(orb, mode === "real") };
  }

  /** Yours alone to set (never an orb's tool): an orb's account on paper, or real money up to `budget` dollars; and
   * how much its paper is (`paper`; owner, 10-11: "why cant we choose how much paper cash we have?"). Either raised adds
   * to what it can spend; lowered, takes from it, never below what it has spent. */
  setAccount(orb: string, mode: "paper" | "real", budget?: number, paper?: number): Account {
    const was = this.#accountRow(orb);
    const next = budget ?? was?.budget ?? 0;
    if (!(Number.isFinite(next) && next >= 0 && next <= 1_000_000)) throw new DeskError("a budget is $0 to $1,000,000");
    const paperNext = paper ?? was?.paper ?? null;
    if (paper !== undefined) {
      if (!(Number.isFinite(paper) && paper >= 0 && paper <= 1_000_000)) throw new DeskError("paper is $0 to $1,000,000");
      const book = this.ownBook(orb, false);
      const diff = paper - book.cashStart;
      if (book.cash + diff < -1e-9) throw new DeskError(`its paper has spent $${(book.cashStart - book.cash).toFixed(2)}: an amount under that cannot be`);
      if (diff) this.#db.prepare("UPDATE desk_books SET cash = cash + ?, cash_start = cash_start + ? WHERE id = ?").run(diff, diff, book.id);
    }
    if (mode === "real" || was?.mode === "real" || next !== (was?.budget ?? 0)) {
      const book = this.ownBook(orb, true);
      const diff = next - (was?.budget ?? book.cashStart);
      if (book.cash + diff < -1e-9) throw new DeskError(`its account has spent $${(book.cashStart - book.cash).toFixed(2)} of its budget: a budget under that cannot be`);
      if (diff) this.#db.prepare("UPDATE desk_books SET cash = cash + ?, cash_start = cash_start + ? WHERE id = ?").run(diff, diff, book.id);
    }
    this.#db.prepare("INSERT INTO desk_accounts (orb, mode, budget, paper, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(orb) DO UPDATE SET mode = excluded.mode, budget = excluded.budget, paper = excluded.paper, at = excluded.at").run(orb, mode, next, paperNext, this.#now());
    this.#events.append("desk.account", { mode, budget: next, paper: paperNext }, { orb });
    return this.account(orb);
  }

  /** An orb's closed trades of one strategy, counted and summed (its runs, whatever its account). */
  closedTrades(orb: string, strategy: number): { n: number; pnl: number } {
    const mine = this.#events.ofType("desk.trade_closed").filter((e) => e.orb === orb && e.data.strategy === strategy);
    return { n: mine.length, pnl: mine.reduce((n, e) => n + (Number(e.data.pnl) || 0), 0) };
  }

  /** A real run's last bar read and its best price since buying (orders.ts `due`). */
  markRun(id: number, lastBar: number, best: number): void {
    this.#db.prepare("UPDATE desk_books SET last_bar = ?, best = ? WHERE id = ?").run(lastBar, best, id);
  }

  /** A real order filled (orders.ts): what it bought, or sold, into or out of the orb's real book; a sale is a closed
   * trade like any (its P&L after what it cost; XP when it made money). */
  realFill(o: { orb: string; market: string; side: "buy" | "sell"; qty: number; usd: number; strategy: number | null; order: number }): void {
    const b = this.ownBook(o.orb, true);
    const at = this.#now();
    if (o.side === "buy") {
      this.#db.prepare("INSERT INTO desk_holdings (book, symbol, qty, cost, since) VALUES (?, ?, ?, ?, ?) ON CONFLICT(book, symbol) DO UPDATE SET qty = qty + excluded.qty, cost = cost + excluded.cost").run(b.id, o.market, o.qty, o.usd, at);
      this.#db.prepare("UPDATE desk_books SET cash = cash - ? WHERE id = ?").run(o.usd, b.id);
      this.#events.append("desk.fill", { book: b.id, order: o.order, strategy: o.strategy, symbol: o.market, side: "buy", qty: o.qty, px: o.usd / o.qty, usd: o.usd, paper: false }, { orb: o.orb });
      return;
    }
    const held = this.#db.prepare("SELECT qty, cost, since FROM desk_holdings WHERE book = ? AND symbol = ?").get(b.id, o.market) as { qty: number; cost: number; since: number } | undefined;
    const qty = Math.min(held?.qty ?? 0, o.qty);
    const cost = held && held.qty > 0 ? held.cost * (qty / held.qty) : 0;
    if (held) this.#db.prepare("UPDATE desk_holdings SET qty = qty - ?, cost = cost - ? WHERE book = ? AND symbol = ?").run(qty, cost, b.id, o.market);
    this.#db.prepare("UPDATE desk_books SET cash = cash + ? WHERE id = ?").run(o.usd, b.id);
    this.#events.append("desk.fill", { book: b.id, order: o.order, strategy: o.strategy, symbol: o.market, side: "sell", qty, px: qty ? o.usd / qty : 0, usd: o.usd, paper: false }, { orb: o.orb });
    if (cost > 0) {
      const pnl = o.usd - cost;
      this.#events.append("desk.trade_closed", { book: b.id, strategy: o.strategy, symbol: o.market, timeframe: null, paper: false, entryPx: cost / qty, exitPx: o.usd / qty, qty, pnl, pnlPct: (pnl / cost) * 100, fees: 0, held: at - (held?.since ?? at), why: "order" }, { orb: o.orb });
    }
  }

  /** A paper trade on an orb's own book (or yours, YOU), filled as the market would fill it now (PLAN 5.38; owner, 10-11:
   * "simulate slippage etc."): given `quoted`, the router's own quote for this size (the coins the dollars buy, or the
   * dollars a sale brings: its pools' slippage and price impact; and its network fee, paid too); else the market's price,
   * the desk's usual slippage and fee. Buy for `usd` dollars, or sell `usd` dollars' worth (all of it when that is more
   * than it holds). */
  async paperTrade(orb: string, symbol: string, side: "buy" | "sell", usd: number, quoted?: PaperQuote): Promise<{ book: Book; px: number; qty: number; trade: Record<string, unknown> | null; quoted: boolean; impact: number | null; feeUsd: number }> {
    if (!(usd >= 1 && usd <= 1_000_000)) throw new DeskError("an order is $1 to $1,000,000");
    const b = this.ownBook(orb);
    const at = this.#now();
    const held = this.#db.prepare("SELECT qty, cost, since FROM desk_holdings WHERE book = ? AND symbol = ?").get(b.id, symbol) as { qty: number; cost: number; since: number } | undefined;
    const said = { quoted: Boolean(quoted), impact: quoted?.impact ?? null };
    const price = async (): Promise<number> => {
      const px = await this.#market.price(symbol);
      if (px === null) throw new DeskError(`no live price for ${symbol} now`);
      return px;
    };
    if (side === "buy") {
      // what it costs (the dollars and the network's fee) and the coins it brings
      let spend: number;
      let fee: number;
      let qty: number;
      if (quoted) [spend, fee, qty] = [usd + quoted.feeUsd, quoted.feeUsd, quoted.qty];
      else {
        const fill = (await price()) * (1 + OWN_SLIP);
        [spend, fee, qty] = [usd, usd * OWN_FEE, (usd * (1 - OWN_FEE)) / fill];
      }
      if (!(qty > 0)) throw new DeskError(`no ${symbol} for $${usd.toFixed(2)} now`);
      if (spend > b.cash + 1e-9) throw new DeskError(`the account has $${b.cash.toFixed(2)} to spend`);
      this.#db.prepare("INSERT INTO desk_holdings (book, symbol, qty, cost, since) VALUES (?, ?, ?, ?, ?) ON CONFLICT(book, symbol) DO UPDATE SET qty = qty + excluded.qty, cost = cost + excluded.cost").run(b.id, symbol, qty, spend, at);
      this.#db.prepare("UPDATE desk_books SET cash = cash - ?, fees = fees + ? WHERE id = ?").run(spend, fee, b.id);
      this.#events.append("desk.fill", { book: b.id, symbol, side: "buy", qty, px: spend / qty, usd: spend, paper: true, ...said, fee }, { orb });
      return { book: this.book(b.id)!, px: spend / qty, qty, trade: null, ...said, feeUsd: fee };
    }
    if (!held || held.qty <= 0) throw new DeskError(`the account holds no ${symbol}`);
    // what it sells, and the dollars it brings after the fee
    let qty: number;
    let got: number;
    let fee: number;
    if (quoted) {
      qty = Math.min(held.qty, quoted.qty);
      fee = quoted.feeUsd;
      got = quoted.usd * (qty / quoted.qty) - fee;
    } else {
      const fill = (await price()) * (1 - OWN_SLIP);
      qty = Math.min(held.qty, usd / fill);
      fee = qty * fill * OWN_FEE;
      got = qty * fill - fee;
    }
    const cost = held.cost * (qty / held.qty);
    const pnl = got - cost;
    this.#db.prepare("UPDATE desk_holdings SET qty = qty - ?, cost = cost - ? WHERE book = ? AND symbol = ?").run(qty, cost, b.id, symbol);
    this.#db.prepare("UPDATE desk_books SET cash = cash + ?, fees = fees + ? WHERE id = ?").run(got, fee, b.id);
    this.#events.append("desk.fill", { book: b.id, symbol, side: "sell", qty, px: got / qty, usd: got, paper: true, ...said, fee }, { orb });
    const trade = { book: b.id, strategy: null, symbol, timeframe: null, paper: true, entryPx: cost / qty, exitPx: got / qty, qty, pnl, pnlPct: (pnl / cost) * 100, fees: fee, held: at - held.since, why: "own" };
    this.#events.append("desk.trade_closed", trade, { orb });
    return { book: this.book(b.id)!, px: got / qty, qty, trade, ...said, feeUsd: fee };
  }

  /** Each orb's closed trades on paper, summed (owner, 10-11: "each orb pnl"): its realized P&L after fees, today's, its
   * wins, its best and worst trade, and when it last closed one; the best first. */
  pnl(): OrbPnl[] {
    const d = new Date(this.#now());
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const by = new Map<string, OrbPnl>();
    for (const e of this.#events.ofType("desk.trade_closed")) {
      const pnl = Number(e.data.pnl);
      // on paper: real money's closed trades are summed apart (api.ts `money`), a dollar of each not the same to you
      if (!e.orb || !Number.isFinite(pnl) || e.data.paper === false) continue;
      const p = by.get(e.orb) ?? { orb: e.orb, trades: 0, wins: 0, realized: 0, today: 0, best: null, worst: null, fees: 0, last: null };
      p.trades++;
      if (pnl > 0) p.wins++;
      p.realized += pnl;
      if (e.at >= midnight) p.today += pnl;
      p.best = p.best === null ? pnl : Math.max(p.best, pnl);
      p.worst = p.worst === null ? pnl : Math.min(p.worst, pnl);
      p.fees += Number(e.data.fees) || 0;
      p.last = e.at;
      by.set(e.orb, p);
    }
    return [...by.values()].sort((a, b) => b.realized - a.realized);
  }

  // ── notes ───────────────────────────────────────────────────────────────────────────────────────
  note(orb: string, symbol: string, title: string, text: string): { id: number } {
    if (!title.trim() || title.length > 120) throw new DeskError("a note's title is 1 to 120 letters");
    if (!text.trim() || text.length > 8_000) throw new DeskError("a note is 1 to 8,000 letters");
    const { lastInsertRowid } = this.#db.prepare("INSERT INTO desk_notes (orb, symbol, title, text, at) VALUES (?, ?, ?, ?, ?)").run(orb, symbol.toUpperCase().slice(0, 12), title.trim(), text.trim(), this.#now());
    this.#events.append("desk.note", { note: Number(lastInsertRowid), symbol, title }, { orb });
    return { id: Number(lastInsertRowid) };
  }

  notes(limit = 40): { id: number; orb: string; symbol: string; title: string; text: string; at: number }[] {
    return this.#db.prepare("SELECT * FROM desk_notes ORDER BY id DESC LIMIT ?").all(limit) as { id: number; orb: string; symbol: string; title: string; text: string; at: number }[];
  }

  // ── settings (what real trades keep to, PLAN 5.27) ──────────────────────────────────────────────
  settings(): Settings {
    const rows = this.#db.prepare("SELECT key, value FROM desk_settings").all() as { key: string; value: string }[];
    const got = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]));
    return { ...DEFAULT_SETTINGS, ...(got as Partial<Settings>) };
  }

  setSettings(next: Partial<Settings>): Settings {
    const s = { ...this.settings(), ...next };
    if (!(s.perTradeUsd >= 1 && s.perTradeUsd <= 1_000_000) || !(s.perDayUsd >= s.perTradeUsd && s.perDayUsd <= 10_000_000)) throw new DeskError("a trade's limit is $1 or more, and a day's at least a trade's");
    if (!(s.slippageBps >= 1 && s.slippageBps <= 500)) throw new DeskError("slippage is 0.01% to 5%");
    if (typeof s.off !== "boolean") throw new DeskError("off is yes or no");
    const put = this.#db.prepare("INSERT INTO desk_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    for (const [k, v] of Object.entries(s)) put.run(k, JSON.stringify(v));
    this.#events.append("desk.settings", s);
    return s;
  }
}
