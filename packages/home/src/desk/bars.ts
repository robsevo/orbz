// A pool's bars, kept (PLAN 5.35; owner, 10-11: "No chart now: ... api.geckoterminal.com asked us to slow down (429)"):
// a chart's bars survive a restart, and only what has formed since the last kept bar is asked for again. In the home's
// database (`sqliteBars`), or in memory for a home without one (`memoryBars`); the latest 1,000 of each kept.
import type { DatabaseSync } from "node:sqlite";
import type { Candle } from "./indicators.ts";

export type BarKey = { chain: string; pool: string; token: string; tf: string };
export interface BarStore {
  /** The latest `limit` bars kept, oldest first. */
  read(k: BarKey, limit: number): Candle[];
  /** Bars kept (a bar of the same time replaced: the one forming moves), the oldest beyond 1,000 let go. */
  write(k: BarKey, bars: readonly Candle[]): void;
}
export const MOST_KEPT = 1_000;

export function memoryBars(): BarStore {
  const kept = new Map<string, Map<number, Candle>>();
  const id = (k: BarKey): string => `${k.chain}|${k.pool}|${k.token}|${k.tf}`;
  return {
    read(k, limit) {
      return [...(kept.get(id(k))?.values() ?? [])].sort((a, b) => a.t - b.t).slice(-limit);
    },
    write(k, bars) {
      const m = kept.get(id(k)) ?? new Map<number, Candle>();
      for (const b of bars) m.set(b.t, b);
      const ts = [...m.keys()].sort((a, b) => a - b);
      for (const t of ts.slice(0, Math.max(0, ts.length - MOST_KEPT))) m.delete(t);
      kept.set(id(k), m);
    },
  };
}

export function sqliteBars(db: DatabaseSync): BarStore {
  const read = db.prepare("SELECT t, o, h, l, c, v FROM desk_bars WHERE chain = ? AND pool = ? AND token = ? AND tf = ? ORDER BY t DESC LIMIT ?");
  const put = db.prepare("INSERT INTO desk_bars (chain, pool, token, tf, t, o, h, l, c, v) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chain, pool, token, tf, t) DO UPDATE SET o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c, v = excluded.v");
  const trim = db.prepare("DELETE FROM desk_bars WHERE chain = ? AND pool = ? AND token = ? AND tf = ? AND t < (SELECT t FROM desk_bars WHERE chain = ? AND pool = ? AND token = ? AND tf = ? ORDER BY t DESC LIMIT 1 OFFSET ?)");
  return {
    read(k, limit) {
      return (read.all(k.chain, k.pool, k.token, k.tf, limit) as Candle[]).reverse();
    },
    write(k, bars) {
      for (const b of bars) put.run(k.chain, k.pool, k.token, k.tf, b.t, b.o, b.h, b.l, b.c, b.v);
      trim.run(k.chain, k.pool, k.token, k.tf, k.chain, k.pool, k.token, k.tf, MOST_KEPT - 1);
    },
  };
}
