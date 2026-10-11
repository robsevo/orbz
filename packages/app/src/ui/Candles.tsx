// A candlestick chart (PLAN 5.23; owner, 10-10: "complete with charts etc"), drawn here in SVG in the theme's own colours:
// a rising bar in the theme's green, a falling one in its red, volume under the price, the strategies' lines over it
// (each in an orb hue), the trades as arrows where they filled, the last price as a dashed line with its value, and the
// bar under your finger read out above. Its arithmetic is ui/candles.ts.
import { useEffect, useRef, useState } from "react";
import type { HueName } from "../design/tokens.ts";
import type { DeskCandle } from "../home/link.ts";
import { priceText, rangeOf, ticksOf, timeText, timeTicks } from "./candles.ts";

export type Line = { label: string; values: number[]; hue: HueName };
export type Mark = { t: number; px: number; side: "buy" | "sell" };

const AXIS = 64; // room on the right for the prices
const FOOT = 18; // and under, for the times

export function Candles({ candles: all, tf, lines = [], marks = [], height = 300, label }: { candles: DeskCandle[]; tf: string; lines?: Line[]; marks?: Mark[]; height?: number; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current!;
    const fit = (): void => setW(Math.max(240, el.clientWidth));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const plotW = w - AXIS;
  // the latest bars that fit at 5 px a bar or more: a phone's chart is fewer bars, each one readable
  const candles = all.slice(-Math.max(30, Math.floor(plotW / 5)));
  const n = candles.length;
  const priceH = Math.round((height - FOOT) * 0.8);
  const volTop = priceH + 6;
  const volH = height - FOOT - volTop;
  const { lo, hi } = rangeOf([...candles.flatMap((c) => [c.l, c.h]), ...lines.flatMap((l) => l.values.slice(-n))]);
  const y = (p: number): number => ((hi - p) / (hi - lo)) * priceH;
  const slot = n ? plotW / n : plotW;
  const x = (i: number): number => slot * (i + 0.5);
  const body = Math.max(1, Math.min(14, slot * 0.62));
  const vmax = Math.max(1e-12, ...candles.map((c) => c.v));
  const last = candles[n - 1];
  const shown = hover !== null ? candles[hover] : last;
  const iOf = (t: number): number => candles.findIndex((c, i) => t >= c.t && (i === n - 1 || t < candles[i + 1]!.t));
  return (
    <div ref={box} data-candles={n} style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <div aria-live="off" style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", font: "600 12px/16px var(--font)", color: "var(--text-3)", minHeight: 16 }} className="num">
        {shown && (
          <>
            <span>{timeText(shown.t, tf)}</span>
            <span>{`O ${priceText(shown.o)}`}</span>
            <span>{`H ${priceText(shown.h)}`}</span>
            <span>{`L ${priceText(shown.l)}`}</span>
            <span style={{ color: shown.c >= shown.o ? "var(--ok)" : "var(--off)" }}>{`C ${priceText(shown.c)}`}</span>
          </>
        )}
        {lines.map((l) => (
          <span key={l.label} data-orb={l.hue} style={{ color: "var(--accent)" }}>{`${l.label} ${priceText(l.values[(hover ?? n - 1) + (l.values.length - n)] ?? NaN)}`}</span>
        ))}
      </div>
      <svg role="img" aria-label={label} viewBox={`0 0 ${w} ${height}`} width="100%" height={height} style={{ display: "block", touchAction: "pan-y" }}
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.floor(((e.clientX - r.left) / r.width) * w / slot);
          setHover(i >= 0 && i < n ? i : null);
        }}
        onPointerLeave={() => setHover(null)}>
        {/* the price grid and its labels */}
        {ticksOf(lo, hi, 5).map((p) => (
          <g key={p}>
            <line x1={0} x2={plotW} y1={y(p)} y2={y(p)} style={{ stroke: "var(--sep)", strokeWidth: 1 }} />
            {/* a round price under the last price's own label is left unsaid */}
            {!(last && Math.abs(y(p) - y(last.c)) < 14) && <text x={plotW + 6} y={y(p) + 4} style={{ fill: "var(--text-3)", font: "600 11px var(--font)" }} className="num">{priceText(p)}</text>}
          </g>
        ))}
        {/* volume */}
        {candles.map((c, i) => (
          <rect key={`v${c.t}`} x={x(i) - body / 2} y={volTop + volH - (c.v / vmax) * volH} width={body} height={Math.max(0.5, (c.v / vmax) * volH)} style={{ fill: c.c >= c.o ? "var(--ok)" : "var(--off)" }} opacity={0.32} />
        ))}
        {/* the bars */}
        {candles.map((c, i) => {
          const up = c.c >= c.o;
          const colour = up ? "var(--ok)" : "var(--off)";
          return (
            <g key={c.t} data-up={up ? "1" : "0"}>
              <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} style={{ stroke: colour, strokeWidth: 1.2 }} />
              <rect x={x(i) - body / 2} y={y(Math.max(c.o, c.c))} width={body} height={Math.max(1, Math.abs(y(c.o) - y(c.c)))} rx={1} style={{ fill: colour }} />
            </g>
          );
        })}
        {/* the strategies' lines */}
        {lines.map((l) => {
          const vals = l.values.slice(-n);
          const d = vals.map((v, i) => (Number.isFinite(v) ? `${i === 0 || !Number.isFinite(vals[i - 1]!) ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}` : "")).join(" ");
          return (
            <g key={l.label} data-orb={l.hue}>
              <path d={d} style={{ stroke: "var(--accent)", strokeWidth: 1.6, fill: "none" }} />
            </g>
          );
        })}
        {/* the trades */}
        {marks.map((m, k) => {
          const i = iOf(m.t);
          if (i < 0) return null;
          const up = m.side === "buy";
          const tip = up ? y(m.px) + 14 : y(m.px) - 14;
          return (
            <path key={k} data-mark={m.side} d={up ? `M${x(i)} ${tip - 9} l-5 9 h10 z` : `M${x(i)} ${tip + 9} l-5 -9 h10 z`} style={{ fill: up ? "var(--ok)" : "var(--off)", stroke: "var(--ground)", strokeWidth: 1 }} />
          );
        })}
        {/* the last price */}
        {last && (
          <g data-last={last.c}>
            <line x1={0} x2={plotW} y1={y(last.c)} y2={y(last.c)} style={{ stroke: last.c >= last.o ? "var(--ok)" : "var(--off)", strokeWidth: 1, strokeDasharray: "3 4" }} />
            <rect x={plotW + 2} y={y(last.c) - 9} width={AXIS - 4} height={18} rx={5} style={{ fill: last.c >= last.o ? "var(--ok)" : "var(--off)" }} />
            <text x={plotW + 6} y={y(last.c) + 4} style={{ fill: "var(--ground)", font: "800 11px var(--font)" }} className="num">{priceText(last.c)}</text>
          </g>
        )}
        {/* the bar under your finger */}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={height - FOOT} style={{ stroke: "var(--text-3)", strokeWidth: 1, strokeDasharray: "2 3" }} />}
        {/* the times */}
        {timeTicks(candles.map((c) => c.t), Math.max(2, Math.floor(plotW / 110))).filter(({ i }) => x(i) > 22 && x(i) < plotW - 22).map(({ i, text }) => (
          <text key={i} x={x(i)} y={height - 4} textAnchor="middle" style={{ fill: "var(--text-3)", font: "600 11px var(--font)" }} className="num">{text}</text>
        ))}
      </svg>
    </div>
  );
}

/** An equity curve: a strategy's account through its backtest or its live run, against buying and holding. */
export function Equity({ points, height = 120, label }: { points: { t: number; equity: number }[]; height?: number; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(400);
  useEffect(() => {
    const el = box.current!;
    const fit = (): void => setW(Math.max(200, el.clientWidth));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (points.length < 2) return <div ref={box} />;
  const { lo, hi } = rangeOf(points.map((p) => p.equity));
  const start = points[0]!.equity;
  const end = points[points.length - 1]!.equity;
  const d = points.map((p, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * w).toFixed(1)} ${(((hi - p.equity) / (hi - lo)) * height).toFixed(1)}`).join(" ");
  const base = ((hi - start) / (hi - lo)) * height;
  return (
    <div ref={box} style={{ minWidth: 0 }}>
      <svg role="img" aria-label={label} viewBox={`0 0 ${w} ${height}`} width="100%" height={height} style={{ display: "block" }}>
        <line x1={0} x2={w} y1={base} y2={base} style={{ stroke: "var(--sep)", strokeWidth: 1, strokeDasharray: "3 4" }} />
        <path d={`${d} L${w} ${height} L0 ${height} Z`} style={{ fill: end >= start ? "var(--ok)" : "var(--off)" }} opacity={0.12} />
        <path d={d} style={{ stroke: end >= start ? "var(--ok)" : "var(--off)", strokeWidth: 2, fill: "none" }} />
      </svg>
    </div>
  );
}
