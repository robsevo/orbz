// The desk's room (PLAN 5.22-5.27; owner, 10-10: "get creative. but it has to be nice and professional"; "complete with
// charts etc"; "funny, fast professional"): the market's live tape, the floor itself, and under it the desk's work in
// tabs: the market's chart, strategies (built, backtested, run on paper to train an orb), trades from your
// wallet, the paper books, the desk's team and its research, and the limits real trades keep to. All of it the home's
// (home/src/desk/); live by its events.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { SPECIALTIES, type Character } from "../orb/spec.ts";
import { Orb } from "../orb/Orb.tsx";
import type { Mood } from "../orb/mood.ts";
import { idOf, type DeskBook, type DeskEvent, type DeskSettings, type DeskState, type Office } from "../home/link.ts";
import type { Route } from "../ui/nav.ts";
import { Balanced, OneLine } from "../ui/Balanced.tsx";
import { changeText, priceText } from "../ui/candles.ts";
import { NAMES } from "../floor/props.ts";
import { DeskFloor } from "./Floor.tsx";
import { button, card, chip, field, head, marketName, pct, shortAddress, small, strong, usd, well, ago, YOU } from "./kit.ts";
import { CasesPanel } from "./Cases.tsx";
import { NewsDesk } from "./NewsDesk.tsx";
import { TokenDesk, type Picked } from "./TokenDesk.tsx";
import { AccountSwitch, YourPaper } from "./Account.tsx";
import { activeOn, keepMoney, keptMoney, MoneySwitch, OrbStats, resultOf, signed, tone, type Money } from "./Stats.tsx";
import { useWallet } from "./useWallet.ts";
import { WalletSheet } from "./WalletSheet.tsx";
import { useCramped } from "../ui/fill.ts";
import { StrategiesPanel } from "./Strategies.tsx";
import { TradePanel } from "./Trade.tsx";

// no chart under the floor (owner, 10-11: "no chart on bottom of page, only if user presses the electronic chart in war
// room"): any coin's chart is the war room's screen, over the floor (TokenDesk.tsx). On a phone the floor is a tab of its
// own, first, so each tab is one thing on its screen
// your wallet (its worth, its swaps) and each orb's P&L first (owner, 10-11: "users can see wallet balance and analytics
// as well. and each orb pnl")
// the cases (PLAN 5.42; owner, 10-12: "investigate where we lead them ... like ZachXBT does")
const TABS = [["trade", "Wallet"], ["desk", "Orbs"], ["books", "Books"], ["strategies", "Strategies"], ["cases", "Cases"], ["limits", "Limits"]] as const;
type Tab = (typeof TABS)[number][0] | "floor";
const TAB_KEY = "orbs.desk.tab";

export function DeskRoom({ home, office, moods, go, tab: opening = null }: { home: Office | null; office: Character[]; moods: Record<string, Mood>; go: (r: Route) => void; tab?: string | null }) {
  const [s, setS] = useState<DeskState | null>(null);
  const [events, setEvents] = useState<DeskEvent[]>([]);
  const [said, setSaid] = useState<string | null>(null);
  const [spark, setSpark] = useState<number[]>([]);
  const phone = useCramped("(max-width: 760px)");
  const [tab, setTabState] = useState<Tab | null>(() => {
    try {
      const t = globalThis.localStorage?.getItem(TAB_KEY);
      return t === "floor" || TABS.some(([k]) => k === t) ? (t as Tab) : null;
    } catch {
      return null;
    }
  });
  const shown: Tab = tab === "floor" && !phone ? "trade" : tab ?? (phone ? "floor" : "trade");
  const tabs: readonly (readonly [Tab, string])[] = phone ? [["floor", "Floor"], ...TABS] : TABS;
  // the war room's screen open over the floor; the wallet sheet open over it all
  const [screen, setScreen] = useState(false);
  const [screenAt, setScreenAt] = useState<Picked | null>(null);
  /** A coin's page on the war room's screen, by its key ("solana:<mint>"): from your wallet's coins. */
  const openCoin = (key: string): void => {
    const at = key.indexOf(":");
    setScreenAt({ kind: "token", chain: key.slice(0, at) as Extract<Picked, { kind: "token" }>["chain"], address: key.slice(at + 1) });
    setScreen(true);
  };
  /** A major's page on the war room's screen: from the tape. */
  const openMajor = (symbol: string): void => {
    setScreenAt({ kind: "major", symbol });
    setScreen(true);
  };
  const [sheet, setSheet] = useState(false);
  /** The research corner's TV pressed: the news over the floor (PLAN 5.43). */
  const [newsOpen, setNewsOpen] = useState(false);
  /** A case just opened from a coin's page: the Cases tab opens on it. */
  const [caseOpening, setCaseOpening] = useState<number | null>(null);
  const investigate = async (orb: string, market: string): Promise<void> => {
    if (!home) return;
    const c = await home.openCase({ orb, coins: [market] });
    setScreen(false);
    setCaseOpening(c.id);
    setTab("cases");
  };
  const wallet = useWallet(home, () => load());
  const setTab = (t: Tab): void => {
    setTabState(t);
    try {
      globalThis.localStorage?.setItem(TAB_KEY, t);
    } catch {
      // a private window: for as long as the page is open
    }
  };
  // the address's tab (#/desk/trade: a link made to connect a wallet opens there)
  useEffect(() => {
    if (opening && (opening === "floor" || TABS.some(([k]) => k === opening))) setTab(opening as Tab);
  }, [opening]);
  /** Connect wallet (owner, 10-11: "I dont see the wallet trying to connect at all when we say connect wallet"): the
   * wallet's own window at once when this browser has one (of the kind asked for), else the sheet: several to choose
   * from, the one connected, or none here and how to open Orbz where yours is. */
  const openWallet = (kind?: "evm" | "solana"): void => {
    const fit = wallet.found.filter((f) => !kind || f.kind === kind);
    if (fit.length === 1 && (!wallet.linked || (kind !== undefined && wallet.linked.f.kind !== kind))) {
      void wallet.connect(fit[0]!).catch(() => setSheet(true));
      return;
    }
    setSheet(true);
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
        {/* a phone not signed in to its home is a preview with no home behind it (owner, 10-11: "why cant we view the
            charts on mobile?"): how to sign it in, said plainly */}
        <span data-desk-sign-in style={{ font: "400 15px/21px var(--font)", color: "var(--text-3)", maxWidth: 440 }}>Its prices, charts and books are kept on your home, and this device is not signed in to it yet. On your computer, open Settings, then Devices, then Add a phone, and scan its code with this device's camera.</span>
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
  // the top 10 by market cap, in its order (the home's; until it has said, the first ten majors as kept)
  const top = (s?.top ?? prices.map((p) => p.symbol)).slice(0, 10);
  const tape = top.flatMap((sym) => prices.filter((p) => p.symbol === sym));
  const floor = (
    <DeskFloor crew={crew} moods={moods} events={events} prices={prices.map((p) => ({ symbol: p.symbol, up: p.changePct >= 0 }))} spark={spark.length ? spark : [1, 1]}
      notes={s?.notes.length ?? 0} strategies={s?.strategies.length ?? 0} riskOn={!(s?.settings.off ?? false)} go={go} onScreen={() => (setScreenAt(null), setScreen(true))} onNews={() => setNewsOpen(true)}
      board={board.map((b) => ({ name: b.c.name, hue: b.c.hue, bar: (Math.abs(b.pnl) / most) * 110, up: b.pnl >= 0 }))} />
  );
  const noCrew = !crew.length && (
    <div data-no-crew style={{ ...card, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span style={{ ...small, flex: "1 1 260px" }}>{NAMES.empty}</span>
      <button type="button" onClick={() => go({ room: "recruiter", family: "desk" })} style={strong}>Hire for the desk</button>
    </div>
  );
  return (
    <div data-desk-room style={{ display: "grid", gap: "var(--s4)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", justifyContent: "space-between", gap: "var(--s3)", minWidth: 0 }}>
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <span style={head}>Crypto never closes</span>
          <h2 style={{ margin: 0, font: "800 26px/32px var(--font)", color: "var(--text-1)" }}>{NAMES.room}</h2>
        </div>
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "var(--s3)", minWidth: 0 }}>
        <button type="button" data-connect-wallet onClick={() => openWallet()} disabled={wallet.busy} style={{ ...(wallet.linked ? button : strong), display: "inline-flex", alignItems: "center", gap: 8 }}>
          {wallet.linked?.f.icon ? <img src={wallet.linked.f.icon} alt="" width={16} height={16} style={{ borderRadius: 4 }} /> : <i aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: wallet.linked ? "var(--ok)" : "var(--text-3)" }} />}
          {wallet.busy ? "Asking your wallet…" : wallet.linked ? shortAddress(wallet.linked.address) : "Connect wallet"}
        </button>
        <span data-market-status={s?.market.ok ? "live" : "down"} style={{ display: "inline-flex", alignItems: "center", gap: 8, font: "700 12px/16px var(--font)", color: "var(--text-2)" }}>
          <i aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: s?.market.ok ? "var(--ok)" : "var(--off)" }} />
          {s ? (s.market.ok ? `Live · ${s.market.source}` : `The market is not answering${s.market.error ? `: ${s.market.error}` : ""}`) : said ?? "Opening the desk…"}
        </span>
        </span>
      </div>
      {/* the tape: the top 10 by market cap, the largest first, going by; each pressed opens its chart on the war room's
          screen, and a pointer over it holds it still (owner, 10-11: "have top 10 cryptos clickable on the top") */}
      {tape.length > 0 && (
        <div data-tape data-viewport aria-label="The top 10 by market cap" style={{ overflow: "hidden", borderRadius: 12, background: "var(--card)", boxShadow: "inset 0 0 0 1px var(--hairline)", maskImage: "linear-gradient(90deg, transparent, black 24px, black calc(100% - 24px), transparent)" }}>
          <div className="orbs-trade-tape" style={{ display: "flex", width: "max-content", gap: 28, padding: "8px 14px" }}>
            {[...tape, ...tape].map((p, i) => (
              <button key={i} type="button" className="orbs-tag" data-tick={i < tape.length ? p.symbol : undefined} aria-hidden={i >= tape.length || undefined} tabIndex={i < tape.length ? 0 : -1}
                aria-label={`${p.symbol}: $${priceText(p.price)}, ${changeText(p.changePct)} today. Open its chart`} onClick={() => openMajor(p.symbol)}
                style={{ position: "relative", display: "inline-flex", gap: 8, font: "700 13px/18px var(--font)", color: "var(--text-1)", whiteSpace: "nowrap", border: 0, background: "none", padding: 0, cursor: "pointer" }}>
                <b>{p.symbol}</b>
                <span className="num">{`$${priceText(p.price)}`}</span>
                <span className="num" style={{ color: p.changePct >= 0 ? "var(--ok)" : "var(--off)" }}>{`${p.changePct >= 0 ? "▲" : "▼"} ${changeText(p.changePct)}`}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {!phone && floor}
      {!phone && noCrew}
      <div data-desk-tabs style={{ minWidth: 0, ...(phone && { position: "sticky", top: 0, zIndex: 20, background: "var(--ground)", padding: "6px 0", margin: "-6px 0" }) }}>
        <OneLine gap={6}>
          {tabs.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={shown === k} data-desk-tab={k} onClick={() => setTab(k)} style={chip(shown === k)}>
              {label}
              {k === "trade" && (s?.swaps.filter((x) => x.state === "asked").length ?? 0) > 0 && <span style={{ marginLeft: 6, color: "var(--alert)" }}>●</span>}
            </button>
          ))}
        </OneLine>
      </div>
      {shown === "floor" ? (
        <div style={{ display: "grid", gap: "var(--s3)", minWidth: 0 }}>
          {floor}
          <span style={{ ...small, textAlign: "center" }}>Tap the war room's screen for any coin: its chart, a swap, or an orb sent to it.</span>
          {noCrew}
        </div>
      ) : !s ? (
        <span role="status" style={small}>{said ?? "Opening the desk…"}</span>
      ) : shown === "strategies" ? (
        <StrategiesPanel home={home} crew={crew} strategies={s.strategies} books={s.books} reload={load} />
      ) : shown === "trade" ? (
        <TradePanel home={home} crew={crew} wallets={s.wallets} swaps={s.swaps} chains={s.chains} reload={load} wallet={wallet} labels={s.tokens} openCoin={openCoin} connectWallet={() => openWallet()} orbs={s.orbs} people={office} openOrbs={() => setTab("desk")} />
      ) : shown === "books" ? (
        <Books home={home} s={s} crew={crew} reload={() => void load()} />
      ) : shown === "desk" ? (
        <Desk home={home} s={s} crew={crew} office={office} go={go} reload={() => void load()} />
      ) : shown === "cases" ? (
        <CasesPanel home={home} crew={crew} opening={caseOpening} opened={() => setCaseOpening(null)} />
      ) : (
        <Limits home={home} settings={s.settings} reload={load} />
      )}
      {screen && s && <TokenDesk home={home} prices={tape} chains={s.chains} crew={crew} strategies={s.strategies} accounts={s.accounts ?? []} you={s.you ?? null} reload={() => void load()} wallet={wallet} openWallet={openWallet} start={screenAt} close={() => setScreen(false)} investigate={investigate} />}
      {newsOpen && <NewsDesk home={home} close={() => setNewsOpen(false)} openMajor={(s) => (setNewsOpen(false), openMajor(s))} />}
      {sheet && <WalletSheet home={home} wallet={wallet} close={() => setSheet(false)} />}
    </div>
  );
}

function Books({ home, s, crew, reload }: { home: Office; s: DeskState; crew: Character[]; reload: () => void }) {
  const nameOf = (orb: string | null): string => (orb === YOU ? "You" : crew.find((c) => idOf(c.name) === orb)?.name ?? orb ?? "?");
  // on paper only here: an orb's real money is its P&L's (the Orbs tab); yours is your own, above them
  const live = s.books.filter((b) => b.state === "live" && !b.real && b.orb !== YOU);
  const mine = s.books.find((b) => b.orb === YOU && b.strategy === null) ?? null;
  const paperTrades = s.trades.filter((t) => t.paper !== false);
  const yours = (s.stats ?? []).find((x) => x.orb === YOU && x.money === "paper") ?? null;
  const held = (b: DeskBook): string =>
    b.qty > 0 ? `Holding ${b.qty.toPrecision(4)} ${marketName(b.symbol ?? "", s.tokens)}, paid ${usd(b.entryPx)} each` : b.holdings.length ? `Holding ${b.holdings.map((h) => `${h.qty.toPrecision(4)} ${marketName(h.symbol, s.tokens)}`).join(", ")}` : `All cash: ${usd(b.cash)}`;
  const row: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, minWidth: 0, font: "600 13px/18px var(--font)", color: "var(--text-2)" };
  return (
    <div data-books style={{ display: "grid", gap: "var(--s4)", minWidth: 0 }}>
      {/* your own paper (PLAN 5.38): what it is worth, what it holds, its amount yours to change */}
      <section aria-label="Your paper" data-books-you style={card}>
        <span style={head}>Your paper</span>
        {mine && (
          <span className="num" style={{ font: "800 20px/26px var(--font)", color: mine.equity >= mine.cashStart ? "var(--ok)" : "var(--off)" }}>{`${usd(mine.equity)} · ${pct(((mine.equity - mine.cashStart) / mine.cashStart) * 100)}`}</span>
        )}
        <span className="num" style={small}>{mine ? held(mine) : "Trade any coin on paper from its page in the war room: as much as you say, filled as the market would."}</span>
        {yours && yours.trades > 0 && <OrbStats st={yours} money="paper" tokens={s.tokens} />}
        <YourPaper home={home} you={s.you ?? null} changed={reload} />
      </section>
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
                <span className="num" style={small}>{held(b)}</span>
              </article>
            );
          })}
        </Balanced>
      </section>
      <section aria-label="Trades closed" style={card}>
        <span style={head}>Trades closed, on paper</span>
        {!paperTrades.length && <span style={small}>None yet.</span>}
        {paperTrades.slice(0, 20).map((t) => (
          <div key={t.seq} data-trade-closed={t.seq} style={row} className="num">
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`${nameOf(t.orb)} · ${marketName(String(t.symbol), s.tokens)}${t.timeframe ? ` ${String(t.timeframe)}` : ""} · ${String(t.why)} · ${ago(t.at, s.now)}`}</span>
            <b style={{ color: Number(t.pnl) > 0 ? "var(--ok)" : "var(--off)", whiteSpace: "nowrap" }}>{`${pct(Number(t.pnlPct))} (${usd(Number(t.pnl))})`}</b>
          </div>
        ))}
      </section>
    </div>
  );
}

/** Each orb's P&L (owner, 10-11: "each orb pnl") and its numbers (PLAN 5.39; owner, 10-11: "you can also see their ...
 * stats etc. in real money or paper"): on paper or real money as you choose here, the whole desk's result and each orb's,
 * its trades, how many it won, its profit factor, its deepest fall and the rest (Stats.tsx); the real trades it asked you
 * for. An orb of the money kind with a book of its own is here too. */
function Desk({ home, s, crew, office, go, reload }: { home: Office; s: DeskState; crew: Character[]; office: Character[]; go: (r: Route) => void; reload: () => void }) {
  const [money, setMoney] = useState<Money>(keptMoney);
  const choose = (m: Money): void => {
    setMoney(m);
    keepMoney(m);
  };
  const of = new Map((s.orbs ?? []).map((p) => [p.orb, p]));
  const stats = new Map((s.stats ?? []).filter((x) => x.money === money && x.orb !== YOU).map((x) => [x.orb, x]));
  const has = (c: Character): boolean => of.has(idOf(c.name)) || (s.stats ?? []).some((x) => x.orb === idOf(c.name));
  const people = [...crew, ...office.filter((o) => !crew.includes(o) && has(o))];
  const rows = people.map((c) => ({ c, p: of.get(idOf(c.name)) ?? null, st: stats.get(idOf(c.name)) ?? null })).sort((a, b) => (b.st ? resultOf(b.st) : 0) - (a.st ? resultOf(a.st) : 0));
  const all = [...stats.values()];
  const total = all.reduce((n, x) => n + resultOf(x), 0);
  const start = all.reduce((n, x) => n + x.start, 0);
  const today = all.reduce((n, x) => n + x.today, 0);
  const trades = all.reduce((n, x) => n + x.trades, 0);
  const wins = all.reduce((n, x) => n + x.wins, 0);
  return (
    <div data-desk data-money={money} style={{ display: "grid", gap: "var(--s4)", minWidth: 0 }}>
      <section aria-label="Each orb's P&L" style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={head}>{`Each orb's P&L (${people.length})`}</span>
          <button type="button" className="orbs-small" onClick={() => go({ room: "recruiter", family: "desk" })} style={{ ...button, padding: "4px 10px", minHeight: 30 }}>Hire</button>
        </div>
        {/* the numbers on one money at a time: a dollar of paper is not a real one to you (PLAN 5.34) */}
        <MoneySwitch money={money} set={choose} />
        <div data-desk-pnl style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 12, rowGap: 2 }}>
          <span className="num" style={{ font: "900 26px/32px var(--font)", ...tone(total) }}>{signed(total)}</span>
          <span className="num" style={small}>{`${money === "paper" ? "on paper" : "real money"}, the whole desk${start > 0 ? ` (${pct((total / start) * 100)})` : ""} · today ${signed(today)} · ${trades} trades${trades ? `, ${Math.round((wins / trades) * 100)}% won` : ""}`}</span>
        </div>
        {!people.length && <span style={small}>No one on the desk yet.</span>}
        <Balanced min={280} gap={10}>
          {rows.map(({ c, p, st }) => (
            <div key={c.name} data-orb-pnl={c.name} data-orb={c.hue} style={{ ...well, display: "grid", gap: 8, minWidth: 0 }}>
              <button type="button" data-orb-open={c.name} onClick={() => go({ room: "office", orb: c.name })} aria-label={`${c.name}'s page`} style={{ display: "grid", gap: 6, border: 0, background: "none", padding: 0, color: "inherit", textAlign: "left", cursor: "pointer", minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <Orb character={c} size={40} poke={false} still />
                  <span style={{ display: "grid", minWidth: 0 }}>
                    <b style={{ font: "800 14px/19px var(--font)", color: "var(--accent)" }}>{c.name}</b>
                    <span style={{ ...small, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{SPECIALTIES[c.specialty].title}</span>
                  </span>
                </span>
                {st && activeOn(st) && (
                  <>
                    <span className="num" data-pnl style={{ font: "900 20px/26px var(--font)", ...tone(resultOf(st)) }}>{`${signed(resultOf(st))}${st.returnPct !== null ? ` · ${pct(st.returnPct)}` : ""}`}</span>
                    <span className="num" style={small}>{`${money === "paper" ? "On paper" : "Real money"}: ${st.trades} trade${st.trades === 1 ? "" : "s"}${st.trades ? `, ${Math.round((st.winRate ?? 0) * 100)}% won` : ""}`}</span>
                  </>
                )}
              </button>
              <OrbStats st={st} money={money} tokens={s.tokens} asked={p?.real} />
              <AccountSwitch home={home} orb={idOf(c.name)} name={c.name} account={(s.accounts ?? []).find((a) => a.orb === idOf(c.name)) ?? null} changed={reload} />
            </div>
          ))}
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
