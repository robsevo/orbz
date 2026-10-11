// A candlestick chart (PLAN 5.23, 5.32; owner, 10-10: "complete with charts etc"; 10-11: "more advanced, we want to be
// able to right click and add lets say indicators, or an orbs strategy so we can see it visually. paper or live"; "time
// before a bar closes too"), drawn here in SVG in the theme's own colours: a rising bar in the theme's green, a falling
// one in its red, volume under the price; over it the layers it is given (studies and strategies: their lines, a band,
// their levels, their trades and where a run began), and under it a pane for each that reads on a scale of its own (RSI,
// MACD), on the same bars and the same crosshair; the last price with the time left before its bar closes; the bar under
// your finger read out above, each layer's value with it. A right-click, or a long press on a phone, asks the page for
// its menu. Its arithmetic is ui/candles.ts.
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import type { HueName } from "../design/tokens.ts";
import type { DeskCandle } from "../home/link.ts";
import { OneLine } from "./Balanced.tsx";
import { closesAt, leftText, paneText, priceText, rangeOf, ticksOf, timeText, timeTicks } from "./candles.ts";

/** The colour a layer is drawn in: an orb's hue (the Dark orb's too), through `data-orb`. */
export type Ink = HueName | "dark";
/** A line: one value to each of the chart's bars, oldest first (NaN where it has none); dashed, a strategy's rule. */
export type Line = { label: string; values: number[]; hue: Ink; dash?: string };
/** A trade on the chart: a strategy's on these bars, a paper fill, or a real trade. */
export type Mark = { t: number; px: number | null; side: "buy" | "sell"; kind: "signal" | "paper" | "real"; title: string; label?: string; win?: boolean };
/** A trade from where it went in to where it came out, or to now while it is open. */
export type Span = { from: { t: number; px: number }; to: { t: number; px: number } | null; win: boolean | null };
/** A scale of its own, under the price. */
export type Pane = { key: string; label: string; lines: Line[]; hist?: number[]; levels?: number[]; range?: { lo: number; hi: number } };
/** All one study or strategy draws, and its name in the legend. */
export type Layer = {
  id: string; label: string; hue: Ink; note?: string; editable?: boolean;
  lines?: Line[]; band?: [number[], number[]]; levels?: number[]; panes?: Pane[];
  marks?: Mark[]; spans?: Span[]; starts?: { t: number; label: string }[];
};

const AXIS = 64; // room on the right for the prices
const FOOT = 18; // and under, for the times
const GAP = 8; // between the price and each pane
const LONG_PRESS = 550;
const label11 = { font: "600 11px var(--font)", fill: "var(--text-3)" };
const tiny = { flex: "0 0 auto", border: 0, background: "none", color: "var(--text-3)", font: "700 13px/18px var(--font)", padding: "4px 8px", cursor: "pointer", borderRadius: 6 } as const;

/** The time left on the bar forming now, ticking on its own each second. */
function BarClock({ tf, x, y }: { tf: string; x: number; y: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const at = closesAt(tf, now);
  return at === null ? null : <text data-bar-clock x={x} y={y} style={{ fill: "var(--ground)", font: "700 10px var(--font)" }} className="num">{leftText(at - now)}</text>;
}

export function Candles({ candles: all, tf, layers = [], height = 300, paneHeight = 96, label, menu, onEdit, onRemove }: {
  candles: DeskCandle[]; tf: string; layers?: Layer[]; height?: number; paneHeight?: number; label: string;
  /** a right-click or a long press at this point of the screen */
  menu?: (at: { x: number; y: number }) => void;
  onEdit?: (layer: string) => void;
  onRemove?: (layer: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<{ i: number; y: number } | null>(null);
  useEffect(() => {
    const el = box.current!;
    const fit = (): void => setW(Math.max(240, el.clientWidth));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => window.clearTimeout(press.current?.timer), []);
  const plotW = w - AXIS;
  // the latest bars that fit at 5 px a bar or more: a phone's chart is fewer bars, each one readable
  const n = Math.min(all.length, Math.max(30, Math.floor(plotW / 5)));
  const off = all.length - n;
  const candles = all.slice(off);
  /** a line's value at the i-th bar shown */
  const at = (values: readonly number[], i: number): number => values[off + i] ?? NaN;
  const shownOf = (values: readonly number[]): number[] => candles.map((_, i) => at(values, i));
  const panes = layers.flatMap((l) => (l.panes ?? []).map((p) => ({ ...p, layer: l.id })));
  const chartH = height - FOOT;
  const priceH = Math.round(chartH * 0.8);
  const volTop = priceH + 6;
  const volH = chartH - volTop;
  const paneTop = (k: number): number => chartH + GAP + k * (paneHeight + GAP);
  const bottom = chartH + panes.length * (paneHeight + GAP);
  const total = bottom + FOOT;
  const { lo, hi } = rangeOf([
    ...candles.flatMap((c) => [c.l, c.h]),
    ...layers.flatMap((l) => [...(l.lines ?? []).flatMap((x) => shownOf(x.values)), ...(l.band ? [...shownOf(l.band[0]), ...shownOf(l.band[1])] : [])]),
  ]);
  const y = (p: number): number => ((hi - p) / (hi - lo)) * priceH;
  const slot = n ? plotW / n : plotW;
  const x = (i: number): number => slot * (i + 0.5);
  const body = Math.max(1, Math.min(14, slot * 0.62));
  const vmax = Math.max(1e-12, ...candles.map((c) => c.v));
  const last = candles[n - 1];
  const idx = hover?.i ?? n - 1;
  const shown = candles[idx];
  const iOf = (t: number): number => (n && t >= candles[0]!.t ? candles.findIndex((c, i) => i === n - 1 || t < candles[i + 1]!.t) : -1);
  const path = (values: readonly number[], yy: (v: number) => number): string => {
    let d = "";
    let pen = false;
    for (let i = 0; i < n; i++) {
      const v = at(values, i);
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${yy(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const band = (u: readonly number[], l: readonly number[]): string => {
    const is = candles.map((_, i) => i).filter((i) => Number.isFinite(at(u, i)) && Number.isFinite(at(l, i)));
    if (is.length < 2) return "";
    const pt = (i: number, v: number): string => `${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    return `M${is.map((i) => pt(i, at(u, i))).join(" L")} L${[...is].reverse().map((i) => pt(i, at(l, i))).join(" L")} Z`;
  };
  // where the pointer is, in the drawing's own units
  const spot = (e: PointerEvent<SVGSVGElement> | MouseEvent<SVGSVGElement>): { i: number; y: number } => {
    const r = e.currentTarget.getBoundingClientRect();
    return { i: Math.floor((((e.clientX - r.left) / r.width) * w) / slot), y: ((e.clientY - r.top) / r.height) * total };
  };
  const unpress = (): void => {
    window.clearTimeout(press.current?.timer);
    press.current = null;
  };
  // the last price, with the time its bar has left under it
  const clock = closesAt(tf, 0) !== null;
  const tagH = clock ? 30 : 18;
  const tagY = last ? Math.min(Math.max(y(last.c) - 9, 0), priceH - tagH) : 0;
  // the crosshair's level, on the price or in a pane, and what it reads there
  const level = ((): { y: number; text: string } | null => {
    if (!hover) return null;
    if (hover.y >= 0 && hover.y <= priceH) return { y: hover.y, text: priceText(hi - (hover.y / priceH) * (hi - lo)) };
    return null;
  })();
  /** a line's value at the bar read out: the latest it has at or before it (a strategy's is not read on the bar still forming) */
  const value = (values: readonly number[], pane: boolean): string => {
    let i = idx;
    while (i > 0 && !Number.isFinite(at(values, i))) i--;
    return (pane ? paneText : priceText)(at(values, i));
  };
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
      </div>
      {layers.length > 0 && (() => {
        const chips = layers.map((l) => {
            const lines = [...(l.lines ?? []).map((x) => ({ x, pane: false })), ...(l.panes ?? []).flatMap((p) => p.lines.map((x) => ({ x, pane: true })))];
            return (
              <span key={l.id} data-layer={l.id} data-orb={l.hue} style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: w < 560 ? "none" : "100%", flex: "0 0 auto", minWidth: 0, padding: "2px 4px 2px 10px", borderRadius: 9, background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", font: "600 12px/18px var(--font)", color: "var(--text-2)" }}>
                <span aria-hidden style={{ flex: "0 0 auto", width: 8, height: 8, borderRadius: 4, background: "var(--accent)" }} />
                <span style={{ color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{l.label}</span>
                {lines.length > 0 && lines.length <= 3 && <span className="num" data-layer-value style={{ whiteSpace: "nowrap" }}>{lines.map(({ x: ln, pane }) => value(ln.values, pane)).join("  ")}</span>}
                {l.note && <span style={{ color: "var(--text-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{l.note}</span>}
                {onEdit && l.editable !== false && (
                  <button type="button" className="orbs-small" data-layer-edit={l.id} aria-label={`Change ${l.label}`} onClick={() => onEdit(l.id)} style={tiny}>⚙</button>
                )}
                {onRemove && (
                  <button type="button" className="orbs-small" data-layer-remove={l.id} aria-label={`Take ${l.label} off the chart`} onClick={() => onRemove(l.id)} style={tiny}>✕</button>
                )}
              </span>
            );
        });
        // a phone's chart keeps its legend to one row, scrolled sideways; a desk's wraps
        return w < 560
          ? <div data-chart-legend style={{ minWidth: 0 }}><OneLine gap={6} style={{ justifyContent: "flex-start" }}>{chips}</OneLine></div>
          : <div data-chart-legend style={{ display: "flex", flexWrap: "wrap", gap: 6, minWidth: 0 }}>{chips}</div>;
      })()}
      <svg role="img" aria-label={label} viewBox={`0 0 ${w} ${total}`} width="100%" height={total} data-panes={panes.length} style={{ display: "block", touchAction: "pan-y", WebkitTouchCallout: "none", userSelect: "none" }}
        onPointerMove={(e) => {
          const p = spot(e);
          setHover(p.i >= 0 && p.i < n ? p : null);
          if (press.current && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 10) unpress();
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" || !menu) return;
          const p = { x: e.clientX, y: e.clientY };
          unpress();
          press.current = { ...p, timer: window.setTimeout(() => (unpress(), menu(p)), LONG_PRESS) };
        }}
        onPointerUp={unpress}
        onPointerCancel={unpress}
        onPointerLeave={() => (setHover(null), unpress())}
        onContextMenu={(e) => {
          if (!menu) return;
          e.preventDefault();
          unpress();
          menu({ x: e.clientX, y: e.clientY });
        }}>
        {/* the price grid and its labels; a round price under the last price's own label is left unsaid */}
        {ticksOf(lo, hi, 5).map((p) => (
          <g key={p}>
            <line x1={0} x2={plotW} y1={y(p)} y2={y(p)} style={{ stroke: "var(--sep)", strokeWidth: 1 }} />
            {!(last && y(p) > tagY - 6 && y(p) < tagY + tagH + 6) && <text x={plotW + 6} y={y(p) + 4} style={label11} className="num">{priceText(p)}</text>}
          </g>
        ))}
        {/* volume */}
        {candles.map((c, i) => (
          <rect key={`v${c.t}`} x={x(i) - body / 2} y={volTop + volH - (c.v / vmax) * volH} width={body} height={Math.max(0.5, (c.v / vmax) * volH)} style={{ fill: c.c >= c.o ? "var(--ok)" : "var(--off)" }} opacity={0.32} />
        ))}
        {/* the layers' bands and levels, under the bars */}
        {layers.map((l) => (
          <g key={`under-${l.id}`} data-orb={l.hue}>
            {l.band && <path d={band(l.band[0], l.band[1])} style={{ fill: "var(--accent)" }} opacity={0.08} />}
            {(l.levels ?? []).filter((v) => v > lo && v < hi).map((v) => (
              <line key={v} data-level={v} x1={0} x2={plotW} y1={y(v)} y2={y(v)} style={{ stroke: "var(--accent)", strokeWidth: 1, strokeDasharray: "6 4" }} opacity={0.7} />
            ))}
          </g>
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
        {/* the layers' lines over the price */}
        {layers.flatMap((l) => (l.lines ?? []).map((ln) => (
          <g key={`${l.id}:${ln.label}`} data-orb={ln.hue} data-line={`${l.id}:${ln.label}`}>
            <path d={path(ln.values, y)} style={{ stroke: "var(--accent)", strokeWidth: 1.6, fill: "none", strokeDasharray: ln.dash }} />
          </g>
        )))}
        {/* the trades: from in to out, where each filled, where a run began */}
        {layers.map((l) => {
          let lastLabel = -Infinity;
          return (
            <g key={`marks-${l.id}`} data-orb={l.hue} data-layer-marks={l.id}>
              {(l.starts ?? []).map((s) => {
                const i = iOf(s.t);
                if (i < 0) return null;
                const right = x(i) > plotW * 0.6;
                return (
                  <g key={`s${s.t}`} data-start={s.t}>
                    <line x1={x(i)} x2={x(i)} y1={0} y2={priceH} style={{ stroke: "var(--accent)", strokeWidth: 1, strokeDasharray: "2 3" }} />
                    <text x={x(i) + (right ? -5 : 5)} y={12} textAnchor={right ? "end" : "start"} style={{ ...label11, fill: "var(--accent)" }}>{s.label}</text>
                  </g>
                );
              })}
              {(l.spans ?? []).map((s, k) => {
                const a = iOf(s.from.t);
                const b = s.to ? iOf(s.to.t) : n - 1;
                if (a < 0 && b < 0) return null;
                const endPx = s.to ? s.to.px : (last?.c ?? s.from.px);
                return (
                  <line key={`p${k}`} data-span={s.win === null ? "open" : s.win ? "won" : "lost"} x1={x(Math.max(0, a))} y1={y(s.from.px)} x2={x(b)} y2={y(endPx)}
                    style={{ stroke: s.win === null ? "var(--accent)" : s.win ? "var(--ok)" : "var(--off)", strokeWidth: 1.4, strokeDasharray: "4 3" }} opacity={0.9} />
                );
              })}
              {(l.marks ?? []).map((m, k) => {
                const i = iOf(m.t);
                if (i < 0) return null;
                const py = y(m.px ?? candles[i]!.c);
                const buy = m.side === "buy";
                const showLabel = m.label !== undefined && x(i) - lastLabel > 40;
                if (showLabel) lastLabel = x(i);
                return (
                  <g key={k} data-mark={m.side} data-mark-kind={m.kind} data-t={m.t}>
                    <title>{m.title}</title>
                    {m.kind === "real" ? (
                      <>
                        <circle cx={x(i)} cy={py} r={8} style={{ fill: "var(--accent)", stroke: "var(--ground)", strokeWidth: 1.5 }} />
                        <text x={x(i)} y={py + 3.5} textAnchor="middle" style={{ fill: "var(--ground)", font: "900 10px var(--font)" }}>{buy ? "B" : "S"}</text>
                      </>
                    ) : m.kind === "paper" ? (
                      <path d={`M${x(i)} ${py - 6} l6 6 l-6 6 l-6 -6 z`} style={{ fill: "var(--accent)", stroke: "var(--ground)", strokeWidth: 1.2 }} />
                    ) : (
                      <path d={buy ? `M${x(i)} ${py + 5} l-5 9 h10 z` : `M${x(i)} ${py - 5} l-5 -9 h10 z`} style={{ fill: "var(--accent)", stroke: "var(--ground)", strokeWidth: 1 }} />
                    )}
                    {showLabel && (
                      <g data-mark-label>
                        <rect x={x(i) - 19} y={(buy ? py + 26 : py - 18) - 10} width={38} height={14} rx={4} style={{ fill: "var(--ground)" }} opacity={0.85} />
                        <text x={x(i)} y={buy ? py + 26 : py - 18} textAnchor="middle" style={{ font: "700 10px var(--font)", fill: m.win === undefined ? "var(--text-2)" : m.win ? "var(--ok)" : "var(--off)" }} className="num">{m.label}</text>
                      </g>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
        {/* the panes: each its own scale, the same bars */}
        {panes.map((p, k) => {
          const top = paneTop(k);
          const r = p.range ?? rangeOf([...p.lines.flatMap((l) => shownOf(l.values)), ...(p.hist ? shownOf(p.hist) : []), ...(p.levels ?? [])]);
          const py = (v: number): number => top + ((r.hi - v) / (r.hi - r.lo)) * paneHeight;
          const marks = p.range ? p.levels ?? [] : [r.hi - (r.hi - r.lo) * 0.04, r.lo + (r.hi - r.lo) * 0.04];
          return (
            <g key={`${p.layer}:${p.key}`} data-pane={p.key} data-pane-of={p.layer}>
              <line x1={0} x2={w} y1={top - GAP / 2} y2={top - GAP / 2} style={{ stroke: "var(--sep)", strokeWidth: 1 }} />
              {(p.levels ?? []).map((v) => (
                <line key={v} x1={0} x2={plotW} y1={py(v)} y2={py(v)} style={{ stroke: "var(--text-3)", strokeWidth: 1, strokeDasharray: "3 4" }} opacity={0.6} />
              ))}
              {marks.map((v) => <text key={`a${v}`} x={plotW + 6} y={py(v) + 4} style={label11} className="num">{paneText(v)}</text>)}
              {p.hist && candles.map((_, i) => {
                const v = at(p.hist!, i);
                if (!Number.isFinite(v)) return null;
                return <rect key={`h${i}`} x={x(i) - body / 2} y={Math.min(py(0), py(v))} width={body} height={Math.max(0.5, Math.abs(py(v) - py(0)))} style={{ fill: v >= 0 ? "var(--ok)" : "var(--off)" }} opacity={0.45} />;
              })}
              {p.lines.map((ln) => (
                <g key={ln.label} data-orb={ln.hue}>
                  <path d={path(ln.values, py)} style={{ stroke: "var(--accent)", strokeWidth: 1.5, fill: "none", strokeDasharray: ln.dash }} />
                </g>
              ))}
              <text x={6} y={top + 12} style={{ font: "700 11px var(--font)" }} className="num">
                <tspan style={{ fill: "var(--text-3)" }}>{p.label}</tspan>
                {p.lines.map((ln) => <tspan key={ln.label} data-orb={ln.hue} dx={8} style={{ fill: "var(--accent)" }}>{value(ln.values, true)}</tspan>)}
              </text>
            </g>
          );
        })}
        {/* the last price, and the time its bar has left (owner, 10-11: "time before a bar closes too") */}
        {last && (
          <g data-last={last.c}>
            <line x1={0} x2={plotW} y1={y(last.c)} y2={y(last.c)} style={{ stroke: last.c >= last.o ? "var(--ok)" : "var(--off)", strokeWidth: 1, strokeDasharray: "3 4" }} />
            <rect x={plotW + 2} y={tagY} width={AXIS - 4} height={tagH} rx={5} style={{ fill: last.c >= last.o ? "var(--ok)" : "var(--off)" }} />
            <text x={plotW + 6} y={tagY + 13} style={{ fill: "var(--ground)", font: "800 11px var(--font)" }} className="num">{priceText(last.c)}</text>
            {clock && <BarClock tf={tf} x={plotW + 6} y={tagY + 25} />}
          </g>
        )}
        {/* the crosshair: the bar under your finger through every pane, and the price at its height */}
        {hover && <line x1={x(hover.i)} x2={x(hover.i)} y1={0} y2={bottom} style={{ stroke: "var(--text-3)", strokeWidth: 1, strokeDasharray: "2 3" }} />}
        {level && (
          <g data-crosshair-price>
            <line x1={0} x2={plotW} y1={level.y} y2={level.y} style={{ stroke: "var(--text-3)", strokeWidth: 1, strokeDasharray: "2 3" }} />
            <rect x={plotW + 2} y={level.y - 9} width={AXIS - 4} height={18} rx={5} style={{ fill: "var(--text-2)" }} />
            <text x={plotW + 6} y={level.y + 4} style={{ fill: "var(--ground)", font: "800 11px var(--font)" }} className="num">{level.text}</text>
          </g>
        )}
        {/* the times */}
        {timeTicks(candles.map((c) => c.t), Math.max(2, Math.floor(plotW / 110))).filter(({ i }) => x(i) > 22 && x(i) < plotW - 22).map(({ i, text }) => (
          <text key={i} x={x(i)} y={total - 4} textAnchor="middle" style={label11} className="num">{text}</text>
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
