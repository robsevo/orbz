// Each orb's numbers on the desk, for you (PLAN 5.39; owner, 10-11: "you can also see their ... stats etc. in real money
// or paper"): paper or real money, your choice kept on this device; for each orb what it made and its return, its trades
// and how many it won, its profit factor and average trade, its average win and loss, best and worst, deepest fall, fees
// and turnover, how long it holds and its streak, its orders, its busiest markets, and its running total as a line. The
// home works them out (desk/stats.ts); the orbs are never told any of it.
import type { CSSProperties } from "react";
import type { DeskState, DeskStats } from "../home/link.ts";
import { Balanced } from "../ui/Balanced.tsx";
import { chip, compact, head, marketName, small, usd, well } from "./kit.ts";

export type Money = "paper" | "real";
const KEY = "orbs.desk.money";
/** Paper or real money on the Orbs tab, as you last chose it on this device. */
export function keptMoney(): Money {
  try {
    return globalThis.localStorage?.getItem(KEY) === "real" ? "real" : "paper";
  } catch {
    return "paper";
  }
}
export function keepMoney(m: Money): void {
  try {
    globalThis.localStorage?.setItem(KEY, m);
  } catch {
    // a private window: kept for as long as the page is open
  }
}

export const signed = (n: number): string => `${n >= 0 ? "+" : "−"}${usd(Math.abs(n))}`;
export const tone = (n: number): CSSProperties => ({ color: n > 0 ? "var(--ok)" : n < 0 ? "var(--off)" : "var(--text-2)" });
/** How long, as a desk says it: 40m, 5h, 3d. */
const span = (ms: number): string => {
  const m = ms / 60_000;
  return m < 90 ? `${Math.max(1, Math.round(m))}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
/** Whether an orb has done anything on this money: a trade, an order, a fill. */
export const activeOn = (st: DeskStats): boolean => st.trades > 0 || st.orders.placed > 0 || st.volume > 0;
/** What an orb's money comes to: its books against what they began with, else what its closed trades made. */
export const resultOf = (st: DeskStats): number => (st.start > 0 ? st.pnl : st.realized);

export function MoneySwitch({ money, set }: { money: Money; set: (m: Money) => void }) {
  return (
    <div role="radiogroup" aria-label="Paper or real money" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      {(["paper", "real"] as const).map((m) => (
        <button key={m} type="button" className="orbs-small" role="radio" aria-checked={money === m} data-stats-money={m} onClick={() => set(m)} style={chip(money === m)}>
          {m === "paper" ? "Paper" : "Real money"}
        </button>
      ))}
    </div>
  );
}

/** Its running total as a line: up green, down red, from nothing. */
function Curve({ points }: { points: DeskStats["curve"] }) {
  if (!points.length) return null;
  const ys = [0, ...points.map((p) => p.pnl)];
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const h = 36;
  const y = (v: number): number => (hi === lo ? h / 2 : h - 2 - ((v - lo) / (hi - lo)) * (h - 4));
  const d = ys.map((v, i) => `${i ? "L" : "M"}${((i / (ys.length - 1)) * 100).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const last = ys.at(-1)!;
  return (
    <svg data-stats-curve viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden style={{ display: "block", width: "100%", height: h }}>
      <line x1="0" x2="100" y1={y(0)} y2={y(0)} stroke="var(--hairline)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke={last >= 0 ? "var(--ok)" : "var(--off)"} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Cell({ name, value, sub, data, style }: { name: string; value: string; sub?: string; data: string; style?: CSSProperties }) {
  return (
    <div data-stat={data} style={{ ...well, gap: 2, padding: "8px 10px", background: "var(--card)" }}>
      <span style={{ ...head, fontSize: 10, letterSpacing: ".06em" }}>{name}</span>
      <span className="num" style={{ font: "800 15px/20px var(--font)", color: "var(--text-1)", overflowWrap: "anywhere", ...style }}>{value}</span>
      {sub && <span className="num" style={{ ...small, fontSize: 11, lineHeight: "15px" }}>{sub}</span>}
    </div>
  );
}

/** One orb's numbers on one money, or that it has none there yet. */
export function OrbStats({ st, money, tokens, asked }: { st: DeskStats | null; money: Money; tokens?: DeskState["tokens"]; asked?: { asked: number; yes: number; sentUsd: number } }) {
  // nothing done on this money yet: said once, with what its account has
  if (!st || !activeOn(st)) {
    return <span data-stats-none className="num" style={small}>{`No trades ${money === "paper" ? "on paper" : "with real money"} yet${st && st.start > 0 ? `: ${usd(st.equity)} in its account` : ""}.`}</span>;
  }
  const streak = st.streak > 0 ? `${st.streak} won in a row` : st.streak < 0 ? `${-st.streak} lost in a row` : null;
  return (
    <div data-stats={money} style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <Curve points={st.curve} />
      <Balanced min={112} gap={6}>
        <Cell data="win-rate" name="Win rate" value={st.winRate === null ? "–" : `${Math.round(st.winRate * 100)}%`} sub={`${st.wins} won · ${st.losses} lost`} />
        <Cell data="profit-factor" name="Profit factor" value={st.profitFactor === null ? (st.wins ? "No loss" : "–") : st.profitFactor.toFixed(2)} />
        <Cell data="expectancy" name="Avg trade" value={st.expectancy === null ? "–" : signed(st.expectancy)} style={tone(st.expectancy ?? 0)} />
        <Cell data="win-loss" name="Avg win" value={st.avgWin === null ? "–" : usd(st.avgWin)} sub={`loss ${st.avgLoss === null ? "–" : usd(-st.avgLoss)}`} />
        <Cell data="best-worst" name="Best trade" value={st.best === null ? "–" : signed(st.best)} sub={`worst ${st.worst === null ? "–" : signed(st.worst)}`} />
        <Cell data="drawdown" name="Deepest fall" value={usd(st.maxDrawdown)} />
        <Cell data="fees" name="Fees" value={usd(st.fees)} sub={`${compact(st.volume)} turned over`} />
        <Cell data="held" name="Held a trade" value={st.avgHeldMs === null ? "–" : span(st.avgHeldMs)} sub={streak ?? undefined} />
      </Balanced>
      <span className="num" data-stats-line style={{ ...small, fontSize: 12 }}>
        {[`Today ${signed(st.today)}`, `7 days ${signed(st.week)}`, st.open ? `${st.open} open` : "nothing open"].join(" · ")}
      </span>
      {st.markets.length > 0 && (
        <span className="num" data-stats-markets style={{ ...small, fontSize: 12 }}>{`Most traded: ${st.markets.slice(0, 3).map((m) => `${marketName(m.market, tokens)} ${m.trades} (${signed(m.pnl)})`).join(", ")}`}</span>
      )}
      {st.orders.placed > 0 && (
        <span className="num" data-stats-orders style={{ ...small, fontSize: 12 }}>{`Orders: ${st.orders.placed} placed, ${st.orders.filled} filled${st.orders.notFilled ? `, ${st.orders.notFilled} not` : ""}${st.orders.waiting ? `, ${st.orders.waiting} waiting` : ""}`}</span>
      )}
      {money === "real" && asked && asked.asked > 0 && (
        <span className="num" style={{ ...small, fontSize: 12 }}>{`Asked you ${asked.asked} time${asked.asked === 1 ? "" : "s"}: ${asked.yes} yes${asked.sentUsd ? `, ${usd(asked.sentUsd)} sent` : ""}`}</span>
      )}
    </div>
  );
}
