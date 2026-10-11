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
};
export type Settings = { perTradeUsd: number; perDayUsd: number; slippageBps: number; off: boolean };
export const DEFAULT_SETTINGS: Settings = { perTradeUsd: 100, perDayUsd: 300, slippageBps: 50, off: false };

export class DeskError extends Error {}
/** An orb's closed trades on paper, summed (PLAN 5.31). */
export type OrbPnl = { orb: string; trades: number; wins: number; realized: number; today: number; best: number | null; worst: number | null; fees: number; last: number | null };

type BookRow = { id: number; orb: string; strategy: number | null; symbol: string | null; cash_start: number; cash: number; qty: number; entry_px: number; entry_t: number; best: number; fees: number; pending: string | null; last_bar: number | null; state: "live" | "stopped"; started_at: number; stopped_at: number | null };

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
    return { id: r.id, orb: r.orb, strategy: r.strategy, symbol: r.symbol, cashStart: r.cash_start, cash: r.cash, qty: r.qty, entryPx: r.entry_px, entryT: r.entry_t, fees: r.fees, state: r.state, startedAt: r.started_at, stoppedAt: r.stopped_at, holdings };
  }

  books(): Book[] {
    return (this.#db.prepare("SELECT * FROM desk_books ORDER BY id").all() as BookRow[]).map((r) => this.#book(r));
  }

  book(id: number): Book | null {
    const r = this.#db.prepare("SELECT * FROM desk_books WHERE id = ?").get(id) as BookRow | undefined;
    return r ? this.#book(r) : null;
  }

  /** Runs a strategy live on paper, by an orb (training it: its trades are its XP). From the last closed bar on. */
  async run(strategyId: number, orb: string, cash = PAPER_START): Promise<Book> {
    const s = this.strategy(strategyId);
    if (!s) throw new DeskError(`no strategy ${strategyId}`);
    if (this.books().some((b) => b.strategy === strategyId && b.orb === orb && b.state === "live")) throw new DeskError(`${s.name} is already running for that orb`);
    const bars = await this.#market.closed(s.spec.symbol, s.spec.timeframe, 2);
    const at = this.#now();
    const { lastInsertRowid } = this.#db.prepare("INSERT INTO desk_books (orb, strategy, symbol, cash_start, cash, state, started_at, last_bar) VALUES (?, ?, ?, ?, ?, 'live', ?, ?)").run(orb, strategyId, s.spec.symbol, cash, cash, at, bars.at(-1)?.t ?? null);
    const id = Number(lastInsertRowid);
    this.#events.append("desk.run_started", { book: id, strategy: strategyId, name: s.name, symbol: s.spec.symbol, timeframe: s.spec.timeframe, cash }, { orb });
    return this.book(id)!;
  }

  /** Stops a book: a live strategy's open position is sold at the price now (a closed trade like any). */
  async stopAndSell(id: number): Promise<Book> {
    const b = this.book(id);
    if (!b) throw new DeskError(`no book ${id}`);
    if (b.strategy !== null && b.qty > 0 && b.symbol) {
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
      for (const b of this.books().filter((x) => x.state === "live" && x.strategy !== null)) {
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

  // ── an orb's own paper book ─────────────────────────────────────────────────────────────────────
  ownBook(orb: string): Book {
    const r = this.#db.prepare("SELECT * FROM desk_books WHERE orb = ? AND strategy IS NULL AND state = 'live'").get(orb) as BookRow | undefined;
    if (r) return this.#book(r);
    const { lastInsertRowid } = this.#db.prepare("INSERT INTO desk_books (orb, strategy, symbol, cash_start, cash, state, started_at) VALUES (?, NULL, NULL, ?, ?, 'live', ?)").run(orb, PAPER_START, PAPER_START, this.#now());
    return this.book(Number(lastInsertRowid))!;
  }

  /** A paper trade on an orb's own book at the price now, a swap's fee and slippage paid: buy for `usd` dollars, or sell
   * `usd` dollars' worth (all of it when that is more than it holds). */
  async paperTrade(orb: string, symbol: string, side: "buy" | "sell", usd: number): Promise<{ book: Book; px: number; trade: Record<string, unknown> | null }> {
    if (!(usd >= 1 && usd <= 1_000_000)) throw new DeskError("a paper trade is $1 to $1,000,000");
    const px = await this.#market.price(symbol);
    if (px === null) throw new DeskError(`no live price for ${symbol} now`);
    const b = this.ownBook(orb);
    const at = this.#now();
    const held = this.#db.prepare("SELECT qty, cost, since FROM desk_holdings WHERE book = ? AND symbol = ?").get(b.id, symbol) as { qty: number; cost: number; since: number } | undefined;
    if (side === "buy") {
      if (usd > b.cash) throw new DeskError(`the book has $${b.cash.toFixed(2)} of paper cash`);
      const fill = px * (1 + OWN_SLIP);
      const qty = (usd * (1 - OWN_FEE)) / fill;
      this.#db.prepare("INSERT INTO desk_holdings (book, symbol, qty, cost, since) VALUES (?, ?, ?, ?, ?) ON CONFLICT(book, symbol) DO UPDATE SET qty = qty + excluded.qty, cost = cost + excluded.cost").run(b.id, symbol, qty, usd, at);
      this.#db.prepare("UPDATE desk_books SET cash = cash - ?, fees = fees + ? WHERE id = ?").run(usd, usd * OWN_FEE, b.id);
      this.#events.append("desk.fill", { book: b.id, symbol, side: "buy", qty, px: fill, usd, paper: true }, { orb });
      return { book: this.book(b.id)!, px: fill, trade: null };
    }
    if (!held || held.qty <= 0) throw new DeskError(`the book holds no ${symbol}`);
    const fill = px * (1 - OWN_SLIP);
    const qty = Math.min(held.qty, usd / fill);
    const got = qty * fill;
    const fee = got * OWN_FEE;
    const cost = held.cost * (qty / held.qty);
    const pnl = got - fee - cost;
    this.#db.prepare("UPDATE desk_holdings SET qty = qty - ?, cost = cost - ? WHERE book = ? AND symbol = ?").run(qty, cost, b.id, symbol);
    this.#db.prepare("UPDATE desk_books SET cash = cash + ?, fees = fees + ? WHERE id = ?").run(got - fee, fee, b.id);
    this.#events.append("desk.fill", { book: b.id, symbol, side: "sell", qty, px: fill, usd: got, paper: true }, { orb });
    const trade = { book: b.id, strategy: null, symbol, timeframe: null, paper: true, entryPx: cost / qty, exitPx: fill, qty, pnl, pnlPct: (pnl / cost) * 100, fees: fee, held: at - held.since, why: "own" };
    this.#events.append("desk.trade_closed", trade, { orb });
    return { book: this.book(b.id)!, px: fill, trade };
  }

  /** Each orb's closed trades on paper, summed (owner, 10-11: "each orb pnl"): its realized P&L after fees, today's, its
   * wins, its best and worst trade, and when it last closed one; the best first. */
  pnl(): OrbPnl[] {
    const d = new Date(this.#now());
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const by = new Map<string, OrbPnl>();
    for (const e of this.#events.ofType("desk.trade_closed")) {
      const pnl = Number(e.data.pnl);
      if (!e.orb || !Number.isFinite(pnl)) continue;
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
