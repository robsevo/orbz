// The desk's risk (PLAN 5.40; owner, 10-11: three more of the desk's jobs, "like a real ... firm"): an account as a risk
// analyst reads it: what it holds and what that is worth, how much of it is in coins and how much rides on its largest;
// its value at risk over a day (the loss its holdings now would have passed on only one day in twenty of the days behind
// them, each coin moving as it really did on the same days) and the worst of those days replayed on what it holds now.
// The desk's own is every account together. Pure over what is handed in: the tool (tools.ts) hands in each account
// (whichever money it is: to an orb an account is an account) and each coin's daily closes.

export type Holding = { market: string; qty: number; px: number | null };
export type Closes = readonly { t: number; c: number }[];
export type Exposure = {
  who: string; cash: number; value: number; equity: number;
  positions: { market: string; qty: number; value: number; pct: number }[];
  /** the share of the account in coins, and in its largest one */
  investedPct: number; largestPct: number | null;
  /** a day's value at risk at 95% and the worst day, as dollars lost (0 or more), over `days` days on which every coin
   * measured has a close; null with fewer than ten such days or nothing held */
  var95: number | null; worstDay: number | null; days: number;
  /** the coins held without a price now or without daily closes: not in the value at risk */
  unmeasured: string[];
};

/** Each day's move of a coin, by the day it ended: the close against the close before. */
function movesOf(closes: Closes): Map<number, number> {
  const out = new Map<number, number>();
  const s = [...closes].sort((a, b) => a.t - b.t);
  for (let i = 1; i < s.length; i++) if (s[i - 1]!.c > 0) out.set(s[i]!.t, s[i]!.c / s[i - 1]!.c - 1);
  return out;
}

export function exposureOf(who: string, cash: number, holdings: readonly Holding[], closes: ReadonlyMap<string, Closes>, maxDays = 90): Exposure {
  const held = holdings.filter((h) => h.qty > 0);
  const priced = held.filter((h) => h.px !== null && h.px > 0);
  const value = priced.reduce((n, h) => n + h.qty * h.px!, 0);
  const equity = cash + value;
  const positions = priced.map((h) => ({ market: h.market, qty: h.qty, value: h.qty * h.px!, pct: equity > 0 ? ((h.qty * h.px!) / equity) * 100 : 0 })).sort((a, b) => b.value - a.value);
  const moves = new Map(priced.map((h) => [h.market, movesOf(closes.get(h.market) ?? [])] as const));
  const measured = priced.filter((h) => (moves.get(h.market)?.size ?? 0) > 0);
  const unmeasured = held.filter((h) => !measured.includes(h)).map((h) => h.market);
  // the days every measured coin moved on, the latest `maxDays` of them
  let days: number[] = measured.length ? [...moves.get(measured[0]!.market)!.keys()] : [];
  for (const h of measured.slice(1)) days = days.filter((d) => moves.get(h.market)!.has(d));
  days = days.sort((a, b) => a - b).slice(-maxDays);
  const losses = days.map((d) => -measured.reduce((n, h) => n + h.qty * h.px! * moves.get(h.market)!.get(d)!, 0)).sort((a, b) => a - b);
  const enough = measured.length > 0 && losses.length >= 10;
  return {
    who, cash, value, equity, positions,
    investedPct: equity > 0 ? (value / equity) * 100 : 0,
    largestPct: positions[0]?.pct ?? null,
    var95: enough ? Math.max(0, losses[Math.ceil(losses.length * 0.95) - 1]!) : null,
    worstDay: enough ? Math.max(0, losses.at(-1)!) : null,
    days: enough ? losses.length : 0,
    unmeasured,
  };
}

/** Accounts together: their dollars and what they hold, a coin held by several once. */
export function together(who: string, accounts: readonly { cash: number; holdings: readonly Holding[] }[]): { who: string; cash: number; holdings: Holding[] } {
  const by = new Map<string, Holding>();
  for (const a of accounts) for (const h of a.holdings) {
    const was = by.get(h.market);
    by.set(h.market, { market: h.market, qty: (was?.qty ?? 0) + h.qty, px: was?.px ?? h.px });
  }
  return { who, cash: accounts.reduce((n, a) => n + a.cash, 0), holdings: [...by.values()] };
}
