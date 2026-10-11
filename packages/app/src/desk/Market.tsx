// The market (PLAN 5.23): a symbol and a timeframe, its candles with its 20 and 50-bar EMAs and the desk's trades on it,
// its price and its day; refreshed as bars close. The prices are public market data, read by the home.
import { useEffect, useState } from "react";
import type { DeskEvent, DeskTicker, Office, DeskCandle } from "../home/link.ts";
import { Candles } from "../ui/Candles.tsx";
import { changeText, priceText } from "../ui/candles.ts";
import { OneLine } from "../ui/Balanced.tsx";
import { card, chip, ema, head, small, SYMBOLS, TIMEFRAMES } from "./kit.ts";

export function MarketPanel({ home, prices, fills, symbol, setSymbol }: { home: Office; prices: DeskTicker[]; fills: DeskEvent[]; symbol: string; setSymbol: (s: string) => void }) {
  const [tf, setTf] = useState("1h");
  const [candles, setCandles] = useState<DeskCandle[] | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = (): void => void home.candles(symbol, tf, 160).then((c) => live && (setCandles(c), setSaid(null)), (e: Error) => live && setSaid(e.message));
    load();
    const t = window.setInterval(load, tf === "1m" ? 15_000 : 60_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [home, symbol, tf]);
  const t = prices.find((p) => p.symbol === symbol);
  const closes = (candles ?? []).map((c) => c.c);
  const marks = fills.filter((f) => f.symbol === symbol && typeof f.px === "number").map((f) => ({ t: f.at, px: Number(f.px), side: (f.side === "buy" ? "buy" : "sell") as "buy" | "sell" }));
  return (
    <section data-market aria-label="The market" style={card}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <span style={head}>{`${symbol} · US dollars`}</span>
          <span className="num" data-price style={{ font: "800 28px/34px var(--font)", color: "var(--text-1)" }}>{t ? `$${priceText(t.price)}` : "–"}</span>
          <span className="num" style={{ font: "700 13px/18px var(--font)", color: t && t.changePct >= 0 ? "var(--ok)" : "var(--off)" }}>
            {t ? `${changeText(t.changePct)} today · from $${priceText(t.low)} to $${priceText(t.high)}${t.stale ? " · stale" : ""}` : "no price yet"}
          </span>
        </div>
        <OneLine gap={4}>
          {TIMEFRAMES.map((x) => (
            <button key={x} type="button" className="orbs-small" data-tf={x} aria-pressed={tf === x} onClick={() => setTf(x)} style={chip(tf === x)}>{x}</button>
          ))}
        </OneLine>
      </div>
      <OneLine gap={6}>
        {SYMBOLS.map((s) => {
          const p = prices.find((x) => x.symbol === s);
          return (
            <button key={s} type="button" className="orbs-small" data-symbol={s} aria-pressed={symbol === s} onClick={() => setSymbol(s)} style={chip(symbol === s)}>
              {s}
              {p && <span className="num" style={{ marginLeft: 6, color: p.changePct >= 0 ? "var(--ok)" : "var(--off)" }}>{changeText(p.changePct)}</span>}
            </button>
          );
        })}
      </OneLine>
      {said && !candles && <span role="status" style={small}>{`The market cannot say now: ${said}`}</span>}
      {candles && (
        <Candles candles={candles} tf={tf} height={300} label={`${symbol} on ${tf} bars: the last ${candles.length}`} marks={marks}
          lines={[{ label: "EMA 20", values: ema(closes, 20), hue: "amber" }, { label: "EMA 50", values: ema(closes, 50), hue: "violet" }]} />
      )}
    </section>
  );
}
