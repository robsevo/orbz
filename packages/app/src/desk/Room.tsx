// The desk's room (PLAN 5.22-5.27; owner, 10-10: "get creative. but it has to be nice and professional"; "complete with
// charts etc"; "funny, fast professional"): the market's live tape, the floor itself, and under it the desk's work in
// tabs: the market's chart, strategies (built, backtested, run on paper to train an orb), trades from your
// wallet, the paper books, the desk's team and its research, and the limits real trades keep to. All of it the home's
// (home/src/desk/); live by its events.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { SPECIALTIES, type Character } from "../orb/spec.ts";
import { Orb } from "../orb/Orb.tsx";
import type { Mood } from "../orb/mood.ts";
import { idOf, type DeskEvent, type DeskSettings, type DeskState, type Office } from "../home/link.ts";
import type { Route } from "../ui/nav.ts";
import { Balanced, OneLine } from "../ui/Balanced.tsx";
import { changeText, priceText } from "../ui/candles.ts";
import { NAMES } from "../floor/props.ts";
import { DeskFloor } from "./Floor.tsx";
import { button, card, chip, field, head, pct, small, strong, usd, well, ago } from "./kit.ts";
import { MarketPanel } from "./Market.tsx";
import { StrategiesPanel } from "./Strategies.tsx";
import { TradePanel } from "./Trade.tsx";

const TABS = [["market", "Market"], ["strategies", "Strategies"], ["trade", "Trade"], ["books", "Books"], ["desk", "The desk"], ["limits", "Limits"]] as const;
type Tab = (typeof TABS)[number][0];
const TAB_KEY = "orbs.desk.tab";

export function DeskRoom({ home, office, moods, go }: { home: Office | null; office: Character[]; moods: Record<string, Mood>; go: (r: Route) => void }) {
  const [s, setS] = useState<DeskState | null>(null);
  const [events, setEvents] = useState<DeskEvent[]>([]);
  const [said, setSaid] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("BTC");
  const [spark, setSpark] = useState<number[]>([]);
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      const t = globalThis.localStorage?.getItem(TAB_KEY);
      return TABS.some(([k]) => k === t) ? (t as Tab) : "market";
    } catch {
      return "market";
    }
  });
  const setTab = (t: Tab): void => {
    setTabState(t);
    try {
      globalThis.localStorage?.setItem(TAB_KEY, t);
    } catch {
      // a private window: for as long as the page is open
    }
  };
  const loading = useRef(0);
  const heard = useRef(0);
  const load = (): void => {
    if (!home) return;
    window.clearTimeout(loading.current);
    loading.current = window.setTimeout(() => void home.desk().then((d) => (setS(d), setSaid(null)), (e: Error) => setSaid(e.message)), 250);
  };
  useEffect(() => {
    if (!home) return;
    load();
    void home.candles("BTC", "1h", 48).then((c) => setSpark(c.map((x) => x.c)), () => {});
    const prices = window.setInterval(load, 10_000);
    const stop = home.watch({
      event: (e) => {
        if (!String(e.type).startsWith("desk.")) return;
        heard.current += 1; // the stream's order, for the floor's moments
        setEvents((list) => [...list.slice(-80), { ...e.data, seq: heard.current, at: e.at ?? Date.now(), orb: e.orb, type: e.type } as DeskEvent]);
        load();
      },
    });
    return () => {
      stop();
      window.clearInterval(prices);
      window.clearTimeout(loading.current);
    };
  }, [home]);
  const crew = useMemo(() => office.filter((c) => SPECIALTIES[c.specialty].family === "desk"), [office]);
  if (!home) {
    return (
      <div style={{ display: "grid", placeItems: "center", alignContent: "center", gap: "var(--s3)", padding: "var(--s7) var(--s5)", textAlign: "center" }}>
        <span style={{ font: "700 20px/26px var(--font)", color: "var(--text-1)" }}>{NAMES.home}</span>
        <span style={{ font: "400 15px/21px var(--font)", color: "var(--text-3)", maxWidth: 440 }}>Its prices, strategies and books are kept there. Open the app from your home to trade.</span>
      </div>
    );
  }
  const today = new Date();
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const pnlToday = new Map<string, number>();
  for (const t of s?.trades ?? []) if (t.at >= midnight && t.orb) pnlToday.set(t.orb, (pnlToday.get(t.orb) ?? 0) + Number(t.pnl ?? 0));
  const board = crew.map((c) => ({ c, pnl: pnlToday.get(idOf(c.name)) ?? 0 })).sort((a, b) => b.pnl - a.pnl);
  const most = Math.max(1, ...board.map((b) => Math.abs(b.pnl)));
  const prices = s?.prices ?? [];
  return (
    <div data-desk-room style={{ display: "grid", gap: "var(--s4)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", justifyContent: "space-between", gap: "var(--s3)", minWidth: 0 }}>
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <span style={head}>Crypto never closes</span>
          <h2 style={{ margin: 0, font: "800 26px/32px var(--font)", color: "var(--text-1)" }}>{NAMES.room}</h2>
        </div>
        <span data-market-status={s?.market.ok ? "live" : "down"} style={{ display: "inline-flex", alignItems: "center", gap: 8, font: "700 12px/16px var(--font)", color: "var(--text-2)" }}>
          <i aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: s?.market.ok ? "var(--ok)" : "var(--off)" }} />
          {s ? (s.market.ok ? `Live · ${s.market.source}` : `The market is not answering${s.market.error ? `: ${s.market.error}` : ""}`) : said ?? "Opening the desk…"}
        </span>
      </div>
      {/* the tape: every market, its price and its day, going by */}
      {prices.length > 0 && (
        <div data-tape data-viewport aria-label="The market's prices" style={{ overflow: "hidden", borderRadius: 12, background: "var(--card)", boxShadow: "inset 0 0 0 1px var(--hairline)", maskImage: "linear-gradient(90deg, transparent, black 24px, black calc(100% - 24px), transparent)" }}>
          <div className="orbs-trade-tape" style={{ display: "flex", width: "max-content", gap: 28, padding: "8px 14px" }}>
            {[...prices, ...prices].map((p, i) => (
              <span key={i} data-tick={i < prices.length ? p.symbol : undefined} className="num" style={{ display: "inline-flex", gap: 8, font: "700 13px/18px var(--font)", color: "var(--text-1)", whiteSpace: "nowrap" }}>
                <b>{p.symbol}</b>
                <span>{`$${priceText(p.price)}`}</span>
                <span style={{ color: p.changePct >= 0 ? "var(--ok)" : "var(--off)" }}>{`${p.changePct >= 0 ? "▲" : "▼"} ${changeText(p.changePct)}`}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <DeskFloor crew={crew} moods={moods} events={events} prices={prices.map((p) => ({ symbol: p.symbol, up: p.changePct >= 0 }))} spark={spark.length ? spark : [1, 1]}
        notes={s?.notes.length ?? 0} strategies={s?.strategies.length ?? 0} riskOn={!(s?.settings.off ?? false)} go={go}
        board={board.map((b) => ({ name: b.c.name, hue: b.c.hue, bar: (Math.abs(b.pnl) / most) * 110, up: b.pnl >= 0 }))} />
      {!crew.length && (
        <div data-no-crew style={{ ...card, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ ...small, flex: "1 1 260px" }}>{NAMES.empty}</span>
          <button type="button" onClick={() => go({ room: "recruiter", family: "desk" })} style={strong}>Hire for the desk</button>
        </div>
      )}
      <OneLine gap={6}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} data-desk-tab={k} onClick={() => setTab(k)} style={chip(tab === k)}>
            {label}
            {k === "trade" && (s?.swaps.filter((x) => x.state === "asked").length ?? 0) > 0 && <span style={{ marginLeft: 6, color: "var(--alert)" }}>●</span>}
          </button>
        ))}
      </OneLine>
      {!s ? (
        <span role="status" style={small}>{said ?? "Opening the desk…"}</span>
      ) : tab === "market" ? (
        <MarketPanel home={home} prices={prices} fills={s.fills} symbol={symbol} setSymbol={setSymbol} />
      ) : tab === "strategies" ? (
        <StrategiesPanel home={home} crew={crew} strategies={s.strategies} books={s.books} reload={load} />
      ) : tab === "trade" ? (
        <TradePanel home={home} crew={crew} wallets={s.wallets} swaps={s.swaps} chains={s.chains} reload={load} />
      ) : tab === "books" ? (
        <Books s={s} crew={crew} />
      ) : tab === "desk" ? (
        <Desk s={s} crew={crew} pnl={pnlToday} go={go} />
      ) : (
        <Limits home={home} settings={s.settings} reload={load} />
      )}
    </div>
  );
}

function Books({ s, crew }: { s: DeskState; crew: Character[] }) {
  const nameOf = (orb: string | null): string => crew.find((c) => idOf(c.name) === orb)?.name ?? orb ?? "?";
  const live = s.books.filter((b) => b.state === "live");
  const row: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, minWidth: 0, font: "600 13px/18px var(--font)", color: "var(--text-2)" };
  return (
    <div data-books style={{ display: "grid", gap: "var(--s4)", minWidth: 0 }}>
      <section aria-label="Paper books" style={card}>
        <span style={head}>{`Paper books (${live.length})`}</span>
        {!live.length && <span style={small}>{NAMES.noBook}</span>}
        <Balanced min={240} gap={10}>
          {live.map((b) => {
            const name = b.strategy !== null ? (s.strategies.find((x) => x.id === b.strategy)?.name ?? `Strategy ${b.strategy}`) : "Its own book";
            const ch = ((b.equity - b.cashStart) / b.cashStart) * 100;
            return (
              <article key={b.id} data-book={b.id} style={well}>
                <span style={{ font: "800 14px/19px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`${nameOf(b.orb)} · ${name}`}</span>
                <span className="num" style={{ font: "800 20px/26px var(--font)", color: ch >= 0 ? "var(--ok)" : "var(--off)" }}>{`${usd(b.equity)} · ${pct(ch)}`}</span>
                <span className="num" style={small}>{b.qty > 0 ? `Holding ${b.qty.toPrecision(4)} ${b.symbol}, paid ${usd(b.entryPx)} each` : b.holdings.length ? `Holding ${b.holdings.map((h) => `${h.qty.toPrecision(4)} ${h.symbol}`).join(", ")}` : `All cash: ${usd(b.cash)}`}</span>
              </article>
            );
          })}
        </Balanced>
      </section>
      <section aria-label="Trades closed" style={card}>
        <span style={head}>Trades closed, on paper</span>
        {!s.trades.length && <span style={small}>None yet.</span>}
        {s.trades.slice(0, 20).map((t) => (
          <div key={t.seq} data-trade-closed={t.seq} style={row} className="num">
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`${nameOf(t.orb)} · ${String(t.symbol)}${t.timeframe ? ` ${String(t.timeframe)}` : ""} · ${String(t.why)} · ${ago(t.at, s.now)}`}</span>
            <b style={{ color: Number(t.pnl) > 0 ? "var(--ok)" : "var(--off)", whiteSpace: "nowrap" }}>{`${pct(Number(t.pnlPct))} (${usd(Number(t.pnl))})`}</b>
          </div>
        ))}
      </section>
    </div>
  );
}

function Desk({ s, crew, pnl, go }: { s: DeskState; crew: Character[]; pnl: Map<string, number>; go: (r: Route) => void }) {
  return (
    <div data-desk style={{ display: "grid", gap: "var(--s4)", minWidth: 0 }}>
      <section aria-label="The desk's team" style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={head}>{`The desk's team (${crew.length})`}</span>
          <button type="button" className="orbs-small" onClick={() => go({ room: "recruiter", family: "desk" })} style={{ ...button, padding: "4px 10px", minHeight: 30 }}>Hire</button>
        </div>
        {!crew.length && <span style={small}>No one on the desk yet.</span>}
        <Balanced min={220} gap={10}>
          {crew.map((c) => {
            const p = pnl.get(idOf(c.name)) ?? 0;
            return (
              <button key={c.name} type="button" data-crew={c.name} data-orb={c.hue} onClick={() => go({ room: "office", orb: c.name })} style={{ ...well, display: "flex", alignItems: "center", gap: 10, border: 0, cursor: "pointer", textAlign: "left", color: "inherit" }}>
                <Orb character={c} size={44} poke={false} still />
                <span style={{ display: "grid", minWidth: 0 }}>
                  <b style={{ font: "800 14px/19px var(--font)", color: "var(--accent)" }}>{c.name}</b>
                  <span style={{ ...small, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{SPECIALTIES[c.specialty].title}</span>
                  <span className="num" style={{ font: "700 12px/16px var(--font)", color: p >= 0 ? "var(--ok)" : "var(--off)" }}>{`Today on paper ${usd(p)}`}</span>
                </span>
              </button>
            );
          })}
        </Balanced>
      </section>
      <section aria-label="Research" style={card}>
        <span style={head}>{`Research (${s.notes.length})`}</span>
        {!s.notes.length && <span style={small}>The desk's analysts pin their notes on a coin here.</span>}
        {s.notes.slice(0, 12).map((n) => (
          <article key={n.id} data-note={n.id} style={well}>
            <b style={{ font: "800 14px/19px var(--font)", color: "var(--text-1)" }}>{`${n.symbol} · ${n.title}`}</b>
            <span style={{ ...small, color: "var(--text-2)", whiteSpace: "pre-wrap" }}>{n.text.length > 600 ? `${n.text.slice(0, 600)}…` : n.text}</span>
            <span style={small}>{`${crew.find((c) => idOf(c.name) === n.orb)?.name ?? n.orb} · ${ago(n.at, s.now)}`}</span>
          </article>
        ))}
      </section>
    </div>
  );
}

function Limits({ home, settings, reload }: { home: Office; settings: DeskSettings; reload: () => void }) {
  const [trade, setTrade] = useState(String(settings.perTradeUsd));
  const [day, setDay] = useState(String(settings.perDayUsd));
  const [slip, setSlip] = useState(String(settings.slippageBps / 100));
  const [said, setSaid] = useState<string | null>(null);
  const save = (next: Partial<DeskSettings>): void => void home.setDeskSettings(next).then(() => (setSaid("Kept."), reload()), (e: Error) => setSaid(e.message));
  return (
    <section data-limits aria-label="Limits" style={card}>
      <span style={head}>What real trades keep to</span>
      <span style={small}>Every real trade waits for your yes and your wallet's signature. These limits are checked when an orb asks and again just before your wallet signs.</span>
      <Balanced min={150} gap={8}>
        {[["A trade, at most ($)", trade, setTrade, "trade"], ["A day, at most ($)", day, setDay, "day"], ["Slippage, at most (%)", slip, setSlip, "slip"]].map(([label, v, set, k]) => (
          <label key={k as string} style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <span style={{ ...head, letterSpacing: ".04em" }}>{label as string}</span>
            <input data-limit={k as string} inputMode="decimal" value={v as string} onChange={(e) => (set as (x: string) => void)(e.target.value)} size={1} style={field} />
          </label>
        ))}
      </Balanced>
      <Balanced min={160} gap={8}>
        <button type="button" data-save-limits onClick={() => save({ perTradeUsd: Number(trade), perDayUsd: Number(day), slippageBps: Math.round(Number(slip) * 100) })} style={strong}>Keep the limits</button>
        <button type="button" data-off={settings.off ? "on" : "off"} aria-pressed={settings.off} onClick={() => save({ off: !settings.off })} style={{ ...button, ...(settings.off && { boxShadow: "inset 0 0 0 1.5px var(--off)" }) }}>
          {settings.off ? "Real trades are off: turn them on" : "Turn real trades off"}
        </button>
      </Balanced>
      {said && <span role="status" style={small}>{said}</span>}
    </section>
  );
}
