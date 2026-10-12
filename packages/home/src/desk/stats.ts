// Each orb's numbers on the desk, for you (PLAN 5.39; owner, 10-11: "you can also see their ... stats etc. in real money
// or paper"): on paper and on real money apart, as a desk reads a book: how many trades it closed and won, what it made
// and lost, its profit factor and what a trade is worth on average, its best and worst, the deepest fall of its running
// total, what it paid and turned over, how long it held, its streak now, its busiest markets, its orders and what came
// of them. They are the door's, for you: no tool of an orb's reads them (money is money to an orb). Pure, so a test
// holds it.

export type Money = "paper" | "real";
/** A desk event as the log keeps it: a closed trade (`desk.trade_closed`) or a fill (`desk.fill`). */
type Ev = { orb: string | null; at: number; data: Record<string, unknown> };
type BookLike = { orb: string; real?: boolean; strategy: number | null; cashStart: number; equity: number; state: "live" | "stopped"; qty: number; holdings: readonly { qty: number }[] };
type OrderLike = { orb: string; swap: number | null; state: "placed" | "filled" | "not_filled" };

export type Stats = {
  orb: string; money: Money;
  /** its closed trades: how many, won (made money), lost; a trade that made nothing is neither */
  trades: number; wins: number; losses: number; winRate: number | null;
  /** what its closed trades made: in all, today (from the home's midnight) and over the last seven days */
  realized: number; today: number; week: number;
  /** a winning trade's average, a losing one's (below nothing); every dollar won over every dollar lost (null with no
   * loss); what a trade made on average */
  avgWin: number | null; avgLoss: number | null; profitFactor: number | null; expectancy: number | null;
  best: number | null; worst: number | null;
  /** the deepest fall of its closed trades' running total from a high, in dollars (0 if it never fell) */
  maxDrawdown: number;
  /** what it paid in fees, and the dollars it bought and sold */
  fees: number; volume: number;
  /** how long it held a trade, on average; its streak now: wins in a row (above nothing) or losses (below) */
  avgHeldMs: number | null; streak: number;
  /** its books on this money: what they began with and are worth now (open trades at the price now) */
  start: number; equity: number; pnl: number; returnPct: number | null; open: number;
  /** the orders it placed on this money, and what came of them */
  orders: { placed: number; filled: number; notFilled: number; waiting: number };
  /** its five busiest markets */
  markets: { market: string; trades: number; pnl: number }[];
  /** its closed trades' running total, the latest 60, for a line */
  curve: { at: number; pnl: number }[];
  last: number | null;
};

const DAY = 86_400_000;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : null);

/** Every orb's numbers, a row for each money it has anything on. `now` is the home's clock: today begins at its midnight. */
export function deskStats(o: { closed: readonly Ev[]; fills: readonly Ev[]; books: readonly BookLike[]; orders: readonly OrderLike[]; now: number }): Stats[] {
  const d = new Date(o.now);
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const weekFrom = midnight - 6 * DAY;
  const moneyOf = (e: Ev): Money => (e.data.paper === false ? "real" : "paper");
  const keys = new Set<string>();
  const key = (orb: string, m: Money): string => `${m} ${orb}`;
  for (const e of [...o.closed, ...o.fills]) if (e.orb) keys.add(key(e.orb, moneyOf(e)));
  // an account's real money is its own book; a strategy run on real money keeps no dollars of its own (orders.ts)
  for (const b of o.books) if (!b.real || b.strategy === null) keys.add(key(b.orb, b.real ? "real" : "paper"));
  for (const x of o.orders) keys.add(key(x.orb, x.swap === null ? "paper" : "real"));
  return [...keys].map((k) => {
    const money = k.slice(0, k.indexOf(" ")) as Money;
    const orb = k.slice(k.indexOf(" ") + 1);
    const closed = o.closed.filter((e) => e.orb === orb && moneyOf(e) === money && num(e.data.pnl) !== null).sort((a, b) => a.at - b.at);
    const fills = o.fills.filter((e) => e.orb === orb && moneyOf(e) === money);
    const books = o.books.filter((b) => b.orb === orb && (money === "real" ? b.real === true && b.strategy === null : !b.real));
    const orders = o.orders.filter((x) => x.orb === orb && (x.swap === null) === (money === "paper"));
    const pnls = closed.map((e) => num(e.data.pnl)!);
    const won = pnls.filter((p) => p > 0);
    const lost = pnls.filter((p) => p < 0);
    const grossLoss = -lost.reduce((n, p) => n + p, 0);
    // the running total, its high and its deepest fall from one
    let run = 0;
    let high = 0;
    let fall = 0;
    const curve: { at: number; pnl: number }[] = [];
    for (const [i, e] of closed.entries()) {
      run += pnls[i]!;
      high = Math.max(high, run);
      fall = Math.max(fall, high - run);
      curve.push({ at: e.at, pnl: run });
    }
    let streak = 0;
    for (let i = pnls.length - 1; i >= 0; i--) {
      const p = pnls[i]!;
      if (p > 0 && streak >= 0) streak++;
      else if (p < 0 && streak <= 0) streak--;
      else break;
    }
    const by = new Map<string, { market: string; trades: number; pnl: number }>();
    for (const [i, e] of closed.entries()) {
      const market = String(e.data.symbol ?? "?");
      const m = by.get(market) ?? { market, trades: 0, pnl: 0 };
      m.trades++;
      m.pnl += pnls[i]!;
      by.set(market, m);
    }
    // fees: each closed trade's (a strategy's both ways; an account's sale), and what an account's buys paid on the way in
    const fees = closed.reduce((n, e) => n + (num(e.data.fees) ?? 0), 0) + fills.filter((e) => e.data.side === "buy").reduce((n, e) => n + (num(e.data.fee) ?? 0), 0);
    const volume = fills.reduce((n, e) => n + Math.abs(num(e.data.usd) ?? (num(e.data.qty) ?? 0) * (num(e.data.px) ?? 0)), 0);
    const held = closed.map((e) => num(e.data.held)).filter((h): h is number => h !== null && h >= 0);
    const start = books.reduce((n, b) => n + b.cashStart, 0);
    const equity = books.reduce((n, b) => n + b.equity, 0);
    const realized = pnls.reduce((n, p) => n + p, 0);
    return {
      orb, money,
      trades: pnls.length, wins: won.length, losses: lost.length, winRate: pnls.length ? won.length / pnls.length : null,
      realized, today: closed.filter((e) => e.at >= midnight).reduce((n, e) => n + num(e.data.pnl)!, 0), week: closed.filter((e) => e.at >= weekFrom).reduce((n, e) => n + num(e.data.pnl)!, 0),
      avgWin: mean(won), avgLoss: mean(lost), profitFactor: grossLoss > 0 ? won.reduce((n, p) => n + p, 0) / grossLoss : null, expectancy: mean(pnls),
      best: pnls.length ? Math.max(...pnls) : null, worst: pnls.length ? Math.min(...pnls) : null,
      maxDrawdown: fall, fees, volume, avgHeldMs: mean(held), streak,
      start, equity, pnl: equity - start, returnPct: start > 0 ? ((equity - start) / start) * 100 : null,
      open: books.filter((b) => b.state === "live").reduce((n, b) => n + (b.qty > 0 ? 1 : 0) + b.holdings.filter((h) => h.qty > 0).length, 0),
      orders: { placed: orders.length, filled: orders.filter((x) => x.state === "filled").length, notFilled: orders.filter((x) => x.state === "not_filled").length, waiting: orders.filter((x) => x.state === "placed").length },
      markets: [...by.values()].sort((a, b) => b.trades - a.trades || Math.abs(b.pnl) - Math.abs(a.pnl)).slice(0, 5),
      curve: curve.slice(-60),
      last: closed.at(-1)?.at ?? null,
    };
  }).sort((a, b) => a.orb.localeCompare(b.orb) || a.money.localeCompare(b.money));
}
