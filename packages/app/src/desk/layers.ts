// What the desk's chart draws (PLAN 5.32; owner, 10-11: "right click and add lets say indicators, or an orbs strategy so
// we can see it visually. paper or live"): a study as a layer; a strategy as one, on paper (its rules on these bars as
// the home's paper desk ran them: what they read, over the price or in a pane, its levels, each trade in and out, where
// it ran on paper from) or live (the same rules, and where its orb really traded this coin); an orb's own trades here.
// A strategy's series are matched to the bars by time, so a chart that has moved on a bar still draws them where they
// were read. Pure, so a test can hold it.
import { HUES } from "../design/tokens.ts";
import type { DeskCandle, DeskDrawn, DeskFill, DeskMarks, DeskSeries, DeskStrategy } from "../home/link.ts";
import { priceText } from "../ui/candles.ts";
import type { Ink, Layer, Line, Mark, Pane, Span } from "../ui/Candles.tsx";
import { drawStudy, STUDIES, studyLabel, type Study } from "../ui/studies.ts";
import { pct } from "./kit.ts";

export type Mode = "paper" | "live";
export type Who = { name: string; hue: Ink };

export function studyLayer(s: Study, c: readonly DeskCandle[]): Layer {
  const d = drawStudy(s, c);
  const label = studyLabel(s);
  return STUDIES[s.kind].on === "price"
    ? { id: s.id, label, hue: s.hue, lines: d.lines, band: d.band }
    : { id: s.id, label, hue: s.hue, panes: [{ key: s.id, label, lines: d.lines, hist: d.hist, levels: d.levels, range: d.range }] };
}

/** A hue `k` steps of three round the wheel from `h` (45° apart): a strategy's second and third lines (the Dark orb's
 * second line takes the wheel from its start). */
const turn = (h: Ink, k: number): Ink => {
  if (!k) return h;
  const i = HUES.findIndex((x) => x.name === h);
  return HUES[(Math.max(0, i) + 3 * k) % HUES.length]!.name;
};

const ON_PRICE = new Set(["sma", "ema", "bb_upper", "bb_middle", "bb_lower", "highest", "lowest"]);
/** Where a series is drawn: over the price (null), or its pane. */
export function paneOf(x: DeskSeries): { key: string; label: string; range?: { lo: number; hi: number } } | null {
  if (ON_PRICE.has(x.kind) || x.kind === "price") return null;
  if (x.kind === "rsi") return { key: `rsi${x.period}`, label: `RSI ${x.period}`, range: { lo: 0, hi: 100 } };
  if (x.kind.startsWith("macd")) {
    const [f, s, g] = [x.fast ?? 12, x.slow ?? 26, x.signal ?? 9];
    return { key: `macd${f}/${s}/${g}`, label: `MACD ${f} ${s} ${g}` };
  }
  if (x.kind === "atr") return { key: `atr${x.period}`, label: `ATR ${x.period}` };
  if (x.kind === "change") return { key: `change${x.period}`, label: `Change over ${x.period}, %` };
  return { key: x.kind, label: x.kind };
}
/** A series as its line is named in a legend. */
export function shortOf(x: DeskSeries): string {
  switch (x.kind) {
    case "sma": return `MA ${x.period}`;
    case "ema": return `EMA ${x.period}`;
    case "bb_upper": return `BB upper ${x.period}`;
    case "bb_middle": return `BB middle ${x.period}`;
    case "bb_lower": return `BB lower ${x.period}`;
    case "highest": return `Highest ${x.field ?? "high"} of ${x.period}`;
    case "lowest": return `Lowest ${x.field ?? "low"} of ${x.period}`;
    case "rsi": return `RSI ${x.period}`;
    case "macd": return "MACD";
    case "macd_signal": return "Signal";
    case "macd_hist": return "Histogram";
    case "atr": return `ATR ${x.period}`;
    case "change": return `Change ${x.period}`;
    default: return x.kind;
  }
}

/** A series read over `sent`, one value to each of `now`'s bars by its time (none where it was not read). */
export function byTime(now: readonly DeskCandle[], sent: readonly DeskCandle[], values: readonly number[]): number[] {
  const at = new Map(sent.map((c, i) => [c.t, i]));
  return now.map((c) => {
    const i = at.get(c.t);
    return i !== undefined && i < values.length ? values[i]! : NaN;
  });
}

const WHY: Record<string, string> = { rule: "its rule", stop: "its stop", target: "its target", trailing: "its trailing stop", stopped: "stopped" };
const did = (f: DeskFill, who: string): string => {
  const what = f.side === "buy" ? "bought" : "sold";
  const where = f.px === null ? "" : ` at $${priceText(f.px)}`;
  return f.kind === "paper"
    ? `${who} ${what} on paper${where}${f.usd !== null ? `, $${f.usd.toFixed(2)}` : ""}`
    : `${who} ${what}${f.usd !== null ? ` $${f.usd.toFixed(2)} worth` : ""}${where}, for real${f.tx ? ` (${f.tx.slice(0, 10)}…)` : ""}`;
};
const fillMark = (f: DeskFill, who: string): Mark => ({ t: f.at, px: f.px, side: f.side, kind: f.kind, title: did(f, who) });

/** A strategy on the chart: its rules' series and levels, and on paper the trades they make on these bars (where its orb
 * runs it on paper here, from when), or live its orb's real trades here. */
export function strategyLayer(o: { s: DeskStrategy; mode: Mode; drawn: { result: DeskDrawn; sent: readonly DeskCandle[] } | null; marks: DeskMarks | null; candles: readonly DeskCandle[]; who: Who; tf: string }): Layer {
  const { s, mode, who } = o;
  const id = `strategy:${s.id}:${mode}`;
  const label = `${s.name} · ${who.name}`;
  const lines: Line[] = [];
  const panes = new Map<string, Pane>();
  const levels: number[] = [];
  const series = o.drawn?.result.series ?? [];
  series.forEach((x, k) => {
    const values = byTime(o.candles, o.drawn!.sent, x.values);
    const where = paneOf(x.series);
    const line: Line = { label: shortOf(x.series), values, hue: turn(who.hue, k), dash: "6 3" };
    if (!where) return void lines.push(line);
    const pane = panes.get(where.key) ?? { key: where.key, label: `${where.label} · ${s.name}`, lines: [], levels: [], range: where.range };
    if (x.series.kind === "macd_hist") pane.hist = values;
    else pane.lines.push(line);
    panes.set(where.key, pane);
  });
  // a fixed number in a rule is a level where the series it is weighed against is drawn
  for (const r of [s.spec.entry, s.spec.exit]) {
    if (!r) continue;
    for (const c of "all" in r ? r.all : r.any) {
      const [fixed, other] = c.right.kind === "value" ? [c.right, c.left] : c.left.kind === "value" ? [c.left, c.right] : [null, null];
      if (!fixed || !other || fixed.value === undefined) continue;
      const where = paneOf(other);
      const pane = where && panes.get(where.key);
      if (pane) pane.levels = [...new Set([...(pane.levels ?? []), fixed.value])];
      else if (!where) levels.push(fixed.value);
    }
  }
  const base: Layer = { id, label, hue: who.hue, editable: false, lines, panes: [...panes.values()], levels };
  if (mode === "live") {
    const real = (o.marks?.fills ?? []).filter((f) => f.kind === "real" && f.orb === (s.by ?? null));
    return { ...base, note: real.length ? `live · ${real.length} real trade${real.length === 1 ? "" : "s"} here` : "live · no real trades here yet", marks: real.map((f) => fillMark(f, who.name)) };
  }
  const d = o.drawn?.result;
  const marks: Mark[] = [];
  const spans: Span[] = [];
  for (const t of d?.trades ?? []) {
    const open = t.why === "end"; // still held at the last closed bar
    marks.push({ t: t.entryT, px: t.entryPx, side: "buy", kind: "signal", title: `${s.name}: in at $${priceText(t.entryPx)}` });
    if (!open) marks.push({ t: t.exitT, px: t.exitPx, side: "sell", kind: "signal", title: `${s.name}: out at $${priceText(t.exitPx)} on ${WHY[t.why] ?? t.why}, ${pct(t.pnlPct)}`, label: pct(t.pnlPct, 1), win: t.pnl > 0 });
    spans.push({ from: { t: t.entryT, px: t.entryPx }, to: open ? null : { t: t.exitT, px: t.exitPx }, win: open ? null : t.pnl > 0 });
  }
  const runs = (o.marks?.runs ?? []).filter((r) => r.strategy === s.id);
  const note = d
    ? [`paper · ${d.metrics.trades} trade${d.metrics.trades === 1 ? "" : "s"}`, pct(d.metrics.returnPct, 1), d.metrics.winRate !== null && `${Math.round(d.metrics.winRate * 100)}% won`, s.spec.timeframe !== o.tf && `made for ${s.spec.timeframe}`].filter(Boolean).join(" · ")
    : "paper · reading its rules…";
  return { ...base, note, marks, spans, starts: runs.map((r) => ({ t: r.startedAt, label: `${who.name} on paper from here` })) };
}

/** An orb's own trades here (yours: `orb` null), on paper or real. */
export function orbLayer(o: { orb: string | null; mode: Mode; marks: DeskMarks | null; who: Who }): Layer {
  const kind = o.mode === "paper" ? "paper" : "real";
  const fills = (o.marks?.fills ?? []).filter((f) => f.orb === o.orb && f.kind === kind);
  return {
    id: `orb:${o.orb ?? "you"}:${o.mode}`, label: o.orb === null ? "Your trades" : `${o.who.name}'s trades`, hue: o.who.hue, editable: false,
    note: `${o.mode} · ${fills.length || "none"} here`, marks: fills.map((f) => fillMark(f, o.who.name)),
  };
}

/** Who has traded here, and how: each orb's paper fills and real trades counted, and yours (PLAN 5.38: your paper too). */
export function whoTradedHere(marks: DeskMarks | null): { orb: string | null; paper: number; real: number }[] {
  const by = new Map<string | null, { orb: string | null; paper: number; real: number }>();
  for (const f of marks?.fills ?? []) {
    const row = by.get(f.orb) ?? { orb: f.orb, paper: 0, real: 0 };
    row[f.kind === "paper" ? "paper" : "real"]++;
    by.set(f.orb, row);
  }
  return [...by.values()];
}
