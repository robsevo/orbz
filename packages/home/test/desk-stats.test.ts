// Each orb's numbers on the desk, for you (PLAN 5.39; owner, 10-11: "you can also see their ... stats etc. in real money
// or paper"): desk/stats.ts, pure, on a hand-made log whose every number is worked out below.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deskStats } from "../src/desk/stats.ts";

const H = 3_600_000;
// the home's clock: noon on a day, so its midnight is twelve hours back and three days ago is in the week
const now = new Date(2026, 9, 11, 12, 0, 0).getTime();
const closed = (orb: string, at: number, pnl: number, o: { paper?: boolean; symbol?: string; fees?: number; held?: number } = {}) =>
  ({ orb, at, data: { symbol: o.symbol ?? "SOL", pnl, fees: o.fees ?? 0.5, held: o.held ?? 2 * H, paper: o.paper ?? true } });

test("an orb's numbers, on paper and real money apart: closed and won, made and lost, its profit factor and average, its deepest fall, fees and turnover, its hold and streak, its books and orders", () => {
  const rows = deskStats({
    now,
    closed: [
      // on paper: +10, then -4 (a fall of 4 from 10), then +6, the last today
      closed("tess", now - 3 * 24 * H, 10, { held: 1 * H }),
      closed("tess", now - 2 * 24 * H, -4, { held: 3 * H }),
      closed("tess", now - 1 * H, 6, { symbol: "BTC", held: 2 * H }),
      // real money: one loss, and nothing of it counted on paper
      closed("tess", now - 2 * H, -2, { paper: false, fees: 0 }),
      // another orb's
      closed("rae", now - 2 * H, 1),
    ],
    fills: [
      { orb: "tess", at: now - 4 * 24 * H, data: { side: "buy", usd: 100, fee: 0.3, paper: true } },
      { orb: "tess", at: now - 3 * 24 * H, data: { side: "sell", qty: 2, px: 55, fee: 0.2, paper: true } }, // $110 by its count and price
      { orb: "tess", at: now - 3 * H, data: { side: "buy", usd: 40, paper: false } },
    ],
    books: [
      { orb: "tess", strategy: null, cashStart: 1_000, equity: 1_012, state: "live", qty: 0, holdings: [{ qty: 3 }, { qty: 0 }] },
      { orb: "tess", strategy: 4, cashStart: 500, equity: 500, state: "stopped", qty: 0, holdings: [] },
      { orb: "tess", real: true, strategy: null, cashStart: 100, equity: 98, state: "live", qty: 0, holdings: [] },
      // a strategy run on real money keeps no dollars of its own: left out
      { orb: "tess", real: true, strategy: 3, cashStart: 0, equity: 0, state: "live", qty: 0, holdings: [] },
    ],
    orders: [
      { orb: "tess", swap: null, state: "filled" },
      { orb: "tess", swap: 7, state: "placed" },
      { orb: "tess", swap: 8, state: "not_filled" },
    ],
  });
  assert.deepEqual(rows.map((r) => `${r.orb} ${r.money}`), ["rae paper", "tess paper", "tess real"], "a row for each money it has anything on");
  const paper = rows.find((r) => r.orb === "tess" && r.money === "paper")!;
  assert.deepEqual(
    [paper.trades, paper.wins, paper.losses, paper.winRate, paper.realized, paper.today, paper.week],
    [3, 2, 1, 2 / 3, 12, 6, 12],
    "three closed, two won; $12 made, $6 of it today, all of it in the week",
  );
  assert.deepEqual([paper.avgWin, paper.avgLoss, paper.profitFactor, paper.expectancy, paper.best, paper.worst], [8, -4, 4, 4, 10, -4], "$16 won over $4 lost");
  assert.equal(paper.maxDrawdown, 4, "from 10 down to 6");
  assert.ok(Math.abs(paper.fees - 1.8) < 1e-9, "each closed trade's 50 cents, and 30 cents its buy paid on the way in");
  assert.equal(paper.volume, 210, "$100 bought, $110 sold");
  assert.deepEqual([paper.avgHeldMs, paper.streak], [2 * H, 1], "two hours a trade; a win now");
  assert.deepEqual([paper.start, paper.equity, paper.pnl, paper.returnPct, paper.open], [1_500, 1_512, 12, 0.8, 1], "its two paper books; one coin still held");
  assert.deepEqual(paper.orders, { placed: 1, filled: 1, notFilled: 0, waiting: 0 });
  assert.deepEqual(paper.markets, [{ market: "SOL", trades: 2, pnl: 6 }, { market: "BTC", trades: 1, pnl: 6 }]);
  assert.deepEqual(paper.curve.map((c) => c.pnl), [10, 6, 12]);
  const real = rows.find((r) => r.orb === "tess" && r.money === "real")!;
  assert.deepEqual(
    [real.trades, real.losses, real.realized, real.profitFactor, real.streak, real.volume, real.start, real.equity, real.pnl, real.returnPct],
    [1, 1, -2, 0, -1, 40, 100, 98, -2, -2],
    "real money's own: a loss, its $40 bought, its account's book only",
  );
  assert.deepEqual(real.orders, { placed: 2, filled: 0, notFilled: 1, waiting: 1 });
  const rae = rows.find((r) => r.orb === "rae")!;
  assert.deepEqual([rae.trades, rae.profitFactor, rae.maxDrawdown, rae.start, rae.returnPct], [1, null, 0, 0, null], "no loss: no profit factor; no book: no return");
});
