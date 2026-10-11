// Strategies (PLAN 5.24; owner, 10-10: orbs trained on your own strategies, live on paper): the
// builder (a known setup, its numbers, a stop, a target, a trailing stop, how much a trade takes), an honest backtest of
// it on the home (the next bar's open, fees and slippage both ways), its equity against buying and holding, then kept
// and run live on paper by one of the desk's orbs you choose: training it, its trades its XP. The strategies kept, the ones live.
import { useState } from "react";
import type { Character } from "../orb/spec.ts";
import { idOf, type DeskBook, type DeskMetrics, type DeskSpec, type DeskStrategy, type DeskTrade, type Office } from "../home/link.ts";
import { Equity } from "../ui/Candles.tsx";
import { Balanced, OneLine } from "../ui/Balanced.tsx";
import { Pick } from "../ui/Pick.tsx";
import { NAMES } from "../floor/props.ts";
import { button, card, chip, field, head, pct, small, strong, SYMBOLS, TEMPLATES, TIMEFRAMES, usd, well } from "./kit.ts";

function Metrics({ m }: { m: DeskMetrics }) {
  const tile = (label: string, value: string, good?: boolean) => (
    <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
      <span style={{ ...small, font: "600 12px/16px var(--font)" }}>{label}</span>
      <span className="num" style={{ font: "800 16px/22px var(--font)", color: good === undefined ? "var(--text-1)" : good ? "var(--ok)" : "var(--off)" }}>{value}</span>
    </div>
  );
  return (
    <Balanced min={120} gap={10}>
      {tile("Return", pct(m.returnPct), m.returnPct >= 0)}
      {tile("Buy and hold", pct(m.holdPct), m.holdPct >= 0)}
      {tile("Worst drawdown", `${m.maxDrawdownPct.toFixed(2)}%`)}
      {tile("Trades", String(m.trades))}
      {tile("Won", m.winRate === null ? "–" : `${Math.round(m.winRate * 100)}%`)}
      {tile("Profit factor", m.profitFactor === null ? "–" : m.profitFactor.toFixed(2))}
    </Balanced>
  );
}

export function StrategiesPanel({ home, crew, strategies, books, reload }: { home: Office; crew: Character[]; strategies: DeskStrategy[]; books: DeskBook[]; reload: () => void }) {
  const [tpl, setTpl] = useState(TEMPLATES[0]!.id);
  const t = TEMPLATES.find((x) => x.id === tpl)!;
  const [a, setA] = useState(t.a.value);
  const [b, setB] = useState(t.b?.value ?? 0);
  const [symbol, setSymbol] = useState("BTC");
  const [tf, setTf] = useState("1h");
  const [stop, setStop] = useState("3");
  const [target, setTarget] = useState("6");
  const [trail, setTrail] = useState(tpl === "breakout" ? "4" : "");
  const [size, setSize] = useState("50");
  const [name, setName] = useState("");
  const [result, setResult] = useState<{ metrics: DeskMetrics; trades: DeskTrade[]; equity: { t: number; equity: number }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [runner, setRunner] = useState("");
  const num = (s: string): number | undefined => (s.trim() === "" ? undefined : Number(s));
  const spec = (): DeskSpec => ({
    name: name.trim() || `${t.name} · ${symbol} ${tf}`, symbol, timeframe: tf, sizePct: Number(size) || 50, ...t.make(a, b),
    ...(num(stop) !== undefined && { stopLossPct: num(stop) }), ...(num(target) !== undefined && { takeProfitPct: num(target) }), ...(num(trail) !== undefined && { trailingStopPct: num(trail) }),
  });
  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setSaid(null);
    try {
      await fn();
    } catch (e) {
      setSaid((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const live = books.filter((x) => x.strategy !== null && x.state === "live");
  const who = crew.length ? (runner || idOf(crew[0]!.name)) : "";
  const pickTemplate = (id: string): void => {
    const n = TEMPLATES.find((x) => x.id === id)!;
    setTpl(id);
    setA(n.a.value);
    setB(n.b?.value ?? 0);
    setTrail(id === "breakout" ? "4" : "");
    setResult(null);
  };
  return (
    <div data-strategies style={{ display: "grid", gap: "var(--s4)", minWidth: 0 }}>
      <section aria-label="A new strategy" style={card}>
        <span style={head}>A new strategy</span>
        <OneLine gap={6}>
          {TEMPLATES.map((x) => (
            <button key={x.id} type="button" className="orbs-small" data-template={x.id} aria-pressed={tpl === x.id} onClick={() => pickTemplate(x.id)} style={chip(tpl === x.id)}>{x.name}</button>
          ))}
        </OneLine>
        <span style={small}>{t.about}</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
          <Pick title="Market" value={symbol} onChange={setSymbol} options={SYMBOLS.map((s) => [s, s] as const)} data={{ "data-builder-symbol": symbol }} />
          <Pick title="Bars" value={tf} onChange={setTf} options={TIMEFRAMES.map((x) => [x, x] as const)} data={{ "data-builder-tf": tf }} />
        </div>
        <Balanced min={118} gap={8}>
          {[
            { label: t.a.label, value: String(a), set: (v: string) => setA(Number(v)), key: "a" },
            ...(t.b ? [{ label: t.b.label, value: String(b), set: (v: string) => setB(Number(v)), key: "b" }] : []),
            { label: "Stop, %", value: stop, set: setStop, key: "stop" },
            { label: "Target, %", value: target, set: setTarget, key: "target" },
            { label: "Trailing stop, %", value: trail, set: setTrail, key: "trail" },
            { label: "Of the account, %", value: size, set: setSize, key: "size" },
          ].map((x) => (
            <label key={x.key} style={{ display: "grid", gap: 4, minWidth: 0 }}>
              <span style={{ ...head, letterSpacing: ".04em" }}>{x.label}</span>
              <input data-builder={x.key} inputMode="decimal" value={x.value} onChange={(e) => x.set(e.target.value)} size={1} style={field} />
            </label>
          ))}
        </Balanced>
        <label style={{ display: "grid", gap: 4, minWidth: 0 }}>
          <span style={{ ...head, letterSpacing: ".04em" }}>Its name</span>
          <input data-builder="name" value={name} placeholder={`${t.name} · ${symbol} ${tf}`} onChange={(e) => setName(e.target.value)} maxLength={60} size={1} style={field} />
        </label>
        <Balanced min={140} gap={8}>
          <button type="button" data-backtest disabled={busy} onClick={() => void act(async () => setResult(await home.backtest(spec())))} style={button}>{busy ? "Testing…" : "Backtest"}</button>
          <button type="button" data-save-strategy disabled={busy} onClick={() => void act(async () => (await home.saveStrategy(spec()), setName(""), reload()))} style={strong}>Keep it</button>
        </Balanced>
        {said && <span role="alert" style={{ ...small, color: "var(--alert)" }}>{said}</span>}
        {result && (
          <div data-backtest-result style={well}>
            <span style={head}>{`Backtest · the last ${result.equity.length} bars`}</span>
            <Metrics m={result.metrics} />
            <Equity points={result.equity} label={`The account through the backtest: ${pct(result.metrics.returnPct)}`} />
            <span style={small}>{`Signals filled at the next bar's open; fees ${usd(result.metrics.feesPaid)} and slippage paid both ways. A backtest is not a promise.`}</span>
          </div>
        )}
      </section>
      <section aria-label="Strategies kept" style={card}>
        <span style={head}>{`Strategies kept (${strategies.length})`}</span>
        {!strategies.length && <span style={small}>{`None yet: build one above, or ask a ${NAMES.jobs.quant.title} for one.`}</span>}
        {strategies.map((s) => {
          const running = live.filter((x) => x.strategy === s.id);
          return (
            <article key={s.id} data-strategy={s.id} style={well}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                <b style={{ font: "800 15px/20px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</b>
                <span style={{ ...small, whiteSpace: "nowrap" }}>{s.by ? `by ${crew.find((c) => idOf(c.name) === s.by)?.name ?? s.by}` : "yours"}</span>
              </div>
              <span style={{ ...small, color: "var(--text-2)" }}>{s.words}</span>
              {s.backtest && <span className="num" style={small}>{`Backtest: ${pct(s.backtest.returnPct)} against ${pct(s.backtest.holdPct)} holding · ${s.backtest.trades} trades · worst drawdown ${s.backtest.maxDrawdownPct.toFixed(1)}%`}</span>}
              {running.map((r) => (
                <div key={r.id} data-running={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span className="num" style={{ font: "700 13px/18px var(--font)", color: r.equity >= r.cashStart ? "var(--ok)" : "var(--off)" }}>
                    {`Live on paper by ${crew.find((c) => idOf(c.name) === r.orb)?.name ?? r.orb}: ${usd(r.equity)} (${pct(((r.equity - r.cashStart) / r.cashStart) * 100)})`}
                  </span>
                  <button type="button" className="orbs-small" onClick={() => void act(async () => (await home.stopBook(r.id), reload()))} style={{ ...button, padding: "4px 10px", minHeight: 30 }}>Stop</button>
                </div>
              ))}
              {crew.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 8, minWidth: 0 }}>
                  <Pick title="Run it on paper by" value={who} onChange={setRunner} options={crew.map((c) => [idOf(c.name), c.name] as const)} />
                  <button type="button" data-run={s.id} disabled={busy} onClick={() => void act(async () => (await home.runStrategy(s.id, who), reload()))} style={{ ...strong, minHeight: 36 }}>Run on paper</button>
                  <button type="button" className="orbs-small" onClick={() => void act(async () => (await home.archiveStrategy(s.id), reload()))} style={{ ...button, padding: "4px 10px", minHeight: 30 }}>Archive</button>
                </div>
              ) : (
                <span style={small}>{NAMES.hireOne}</span>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}
