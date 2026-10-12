// The war room's screen, opened over the floor (PLAN 5.28; owner, 10-11: "user can press the chart in war room
// (electronic one) and a chart opens over (modal i guess) with a search bar on top of it, make it nice professional,
// user can input the contract address and view the coin + trade manually or send a certain orb to trade it"; "no chart
// on bottom of page, only if user presses the electronic chart"): a search on top for any coin by its name, symbol or
// contract address (a pump.fun mint too; an address pasted opens its coin), what is trending on a chain and the majors
// under it, and a coin's own page (TokenPage.tsx). The whole screen on a phone; a wide window on a desk.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Character } from "../orb/spec.ts";
import type { DeskAccount, DeskChain, DeskStrategy, DeskTicker, DeskYou, DexChain, DexPair, Office } from "../home/link.ts";
import { changeText, priceText } from "../ui/candles.ts";
import { OneLine } from "../ui/Balanced.tsx";
import { useCramped } from "../ui/fill.ts";
import { button, chip, compact, field, head, picture, small } from "./kit.ts";
import { age, CHAIN_NAMES, MajorPage, TokenPage } from "./TokenPage.tsx";
import type { WalletHere } from "./useWallet.ts";

export type Picked = { kind: "major"; symbol: string } | { kind: "token"; chain: DexChain; address: string };
const LOOKED: DexChain[] = ["solana", "base", "ethereum", "bsc", "arbitrum", "polygon", "optimism"];
const SHORT: Record<DexChain, string> = { solana: "SOL", ethereum: "ETH", base: "BASE", arbitrum: "ARB", optimism: "OP", polygon: "POL", bsc: "BNB" };
const isAddress = (q: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(q) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);
const LAST = "orbs.desk.picked";

/** A change in its colour. */
const Change = ({ v, w }: { v: number | null; w?: number }) => (
  <span className="num" style={{ flex: w ? `0 0 ${w}px` : undefined, textAlign: "right", font: "700 12px/16px var(--font)", color: v === null ? "var(--text-3)" : v >= 0 ? "var(--ok)" : "var(--off)" }}>{v === null ? "–" : changeText(v)}</span>
);
/** A number in its column on a desk. */
const Col = ({ children, w }: { children: string; w: number }) => (
  <span className="num" style={{ flex: `0 0 ${w}px`, textAlign: "right", font: "600 13px/18px var(--font)", color: "var(--text-2)" }}>{children}</span>
);
/** The columns' names over a desk's list. */
function Heads() {
  const h = (words: string, w: number) => <span style={{ ...head, fontSize: 10, flex: `0 0 ${w}px`, textAlign: "right" }}>{words}</span>;
  return (
    <div aria-hidden style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px 4px", minWidth: 0 }}>
      <span style={{ ...head, fontSize: 10, flex: "1 1 auto" }}>Coin</span>
      {h("Price", 100)}{h("1h", 64)}{h("24h", 72)}{h("Liquidity", 84)}{h("Volume", 84)}{h("Mkt cap", 84)}{h("Age", 48)}
    </div>
  );
}

/** One coin in a list: its image, symbol and name, its chain and DEX, its price and day, its pool and age; on a desk the
 * numbers in columns, as a screen of them reads. */
function Row({ p, now, pick, wide }: { p: DexPair; now: number; pick: () => void; wide: boolean }) {
  return (
    <button type="button" data-token-row={`${p.chain}:${p.base.address}`} onClick={pick}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 56, padding: "8px 10px", border: 0, borderRadius: 12, background: "transparent", color: "inherit", textAlign: "left", cursor: "pointer" }}>
      {p.image ? <img src={picture(p.image)} alt="" width={32} height={32} loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} style={{ borderRadius: 10, background: "var(--fill)", flex: "0 0 32px" }} /> : <span aria-hidden style={{ width: 32, height: 32, borderRadius: 10, background: "var(--fill)", flex: "0 0 32px" }} />}
      <span style={{ display: "grid", flex: "1 1 auto", minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
          <b style={{ font: "800 15px/20px var(--font)", color: "var(--text-1)", flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.base.symbol}</b>
          <span style={{ ...small, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.base.name}</span>
        </span>
        <span className="num" style={{ ...small, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {wide ? `${CHAIN_NAMES[p.chain]} · ${p.dex}` : `${SHORT[p.chain]} · ${p.dex} · ${age(p.createdAt, now)} · liq ${compact(p.liquidityUsd)} · vol ${compact(p.volume24h)}`}
        </span>
      </span>
      {wide && (
        <>
          <Col w={100}>{p.priceUsd === null ? "–" : `$${priceText(p.priceUsd)}`}</Col>
          <Change v={p.change.h1} w={64} />
          <Change v={p.change.h24} w={72} />
          <Col w={84}>{compact(p.liquidityUsd)}</Col>
          <Col w={84}>{compact(p.volume24h)}</Col>
          <Col w={84}>{compact(p.marketCap ?? p.fdv)}</Col>
          <Col w={48}>{age(p.createdAt, now)}</Col>
        </>
      )}
      {!wide && <span className="num" style={{ display: "grid", justifyItems: "end", flex: "0 0 auto" }}>
        <span style={{ font: "800 14px/20px var(--font)", color: "var(--text-1)" }}>{p.priceUsd === null ? "–" : `$${priceText(p.priceUsd)}`}</span>
        <span style={{ font: "700 12px/16px var(--font)", color: p.change.h24 === null ? "var(--text-3)" : p.change.h24 >= 0 ? "var(--ok)" : "var(--off)" }}>{p.change.h24 === null ? "–" : changeText(p.change.h24)}</span>
      </span>}
    </button>
  );
}

/** The list under the search: what it found, or what is trending on a chain and the majors. */
function Finder({ home, q, prices, pick, wide }: { home: Office; q: string; prices: DeskTicker[]; pick: (p: Picked) => void; wide: boolean }) {
  const [found, setFound] = useState<DexPair[] | null>(null);
  const [chain, setChain] = useState<DexChain>("solana");
  const [trending, setTrending] = useState<DexPair[] | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const query = q.trim();
  useEffect(() => {
    setFound(null);
    setSaid(null);
    if (!query) return;
    let live = true;
    // a moment's rest between letters; an address goes at once, and opens its coin when it is one
    const t = window.setTimeout(() => void home.dexSearch(query).then((list) => {
      if (!live) return;
      setFound(list);
      setNow(Date.now());
      const top = list[0];
      if (isAddress(query) && top && top.base.address.toLowerCase() === query.toLowerCase()) pick({ kind: "token", chain: top.chain, address: top.base.address });
    }, (e: Error) => live && setSaid(e.message)), isAddress(query) ? 0 : 320);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [query]);
  useEffect(() => {
    if (query) return;
    let live = true;
    setTrending(null);
    const get = (): void => void home.dexTrending(chain).then((list) => live && (setTrending(list), setNow(Date.now())), (e: Error) => live && setSaid(e.message));
    get();
    const t = window.setInterval(get, 60_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [chain, query]);
  if (query) {
    return (
      <div data-token-results style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span style={head}>{found ? `${found.length} found` : "Searching…"}</span>
        {said && <span role="alert" style={{ ...small, color: "var(--alert)" }}>{`The DEX data cannot say now: ${said}`}</span>}
        {found?.length === 0 && <span style={small}>Nothing found: try its symbol, or paste its contract address.</span>}
        {wide && !!found?.length && <Heads />}
        {found?.map((p) => <Row key={`${p.chain}:${p.base.address}`} p={p} now={now} wide={wide} pick={() => pick({ kind: "token", chain: p.chain, address: p.base.address })} />)}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: "var(--s3)", minWidth: 0 }}>
      <div data-majors style={{ display: "grid", gap: 6, minWidth: 0 }}>
        <span style={head}>The majors · top 10 by market cap</span>
        <OneLine gap={6} style={{ justifyContent: "flex-start" }}>
          {prices.map((t) => (
            <button key={t.symbol} type="button" className="orbs-small" data-major={t.symbol} onClick={() => pick({ kind: "major", symbol: t.symbol })} style={chip(false)}>
              {t.symbol}
              <span className="num" style={{ marginLeft: 6, color: t.changePct >= 0 ? "var(--ok)" : "var(--off)" }}>{changeText(t.changePct)}</span>
            </button>
          ))}
        </OneLine>
      </div>
      <div data-trending style={{ display: "grid", gap: 6, minWidth: 0 }}>
        <span style={head}>Trending now</span>
        <OneLine gap={6} style={{ justifyContent: "flex-start" }}>
          {LOOKED.map((c) => (
            <button key={c} type="button" className="orbs-small" data-trend-chain={c} aria-pressed={chain === c} onClick={() => setChain(c)} style={chip(chain === c)}>{CHAIN_NAMES[c]}</button>
          ))}
        </OneLine>
        {said && !trending && <span role="alert" style={{ ...small, color: "var(--alert)" }}>{`The DEX data cannot say now: ${said}`}</span>}
        {!trending && !said && <span role="status" style={small}>Reading what is trending…</span>}
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          {wide && !!trending?.length && <Heads />}
          {trending?.slice(0, 20).map((p) => <Row key={`${p.chain}:${p.base.address}:${p.pair}`} p={p} now={now} wide={wide} pick={() => pick({ kind: "token", chain: p.chain, address: p.base.address })} />)}
        </div>
      </div>
    </div>
  );
}

/** The screen, over the floor: a search on top, the list or a coin's page under it. */
export function TokenDesk({ home, prices, chains, crew, strategies, accounts, you, reload, wallet, openWallet, close, start = null }: {
  home: Office; prices: DeskTicker[]; chains: DeskChain[]; crew: Character[]; strategies: DeskStrategy[]; accounts: DeskAccount[]; you: DeskYou | null; reload: () => void; wallet: WalletHere; openWallet: (kind: "evm" | "solana") => void; close: () => void;
  /** A coin to open on (one of your wallet's, pressed); else the coin last open here, or the list. */
  start?: Picked | null;
}) {
  const phone = useCramped("(max-width: 760px)");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Picked | null>(() => {
    if (start) return start;
    try {
      return JSON.parse(globalThis.localStorage?.getItem(LAST) ?? "null") as Picked | null;
    } catch {
      return null;
    }
  });
  const pick = (p: Picked | null): void => {
    setPicked(p);
    try {
      globalThis.localStorage?.setItem(LAST, JSON.stringify(p));
    } catch {
      // a private window: for as long as the screen is open
    }
  };
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!picked) input.current?.focus();
    const esc = (e: KeyboardEvent): void => void (e.key === "Escape" && close());
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  const search = (v: string): void => {
    setQ(v);
    if (v.trim() && picked) pick(null); // typing again is a new search: the list comes back
  };
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="The war room's screen" data-token-desk style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: phone ? "stretch" : "center", padding: phone ? 0 : "var(--s4)" }}>
      <div aria-hidden onClick={close} style={{ position: "absolute", inset: 0, background: "var(--ground)", opacity: 0.86, backdropFilter: "blur(6px)" }} />
      <section style={{ position: "relative", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", width: phone ? "100%" : "min(1180px, 100%)", height: phone ? "100dvh" : "min(900px, 100%)", borderRadius: phone ? 0 : 22, background: "var(--card)", boxShadow: "0 24px 70px var(--shadow), inset 0 0 0 1px var(--hairline)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: phone ? "12px 12px 10px" : "16px 18px 12px", borderBottom: "1px solid var(--sep)", minWidth: 0 }}>
          <span aria-hidden style={{ font: "800 18px/1 var(--font)", color: "var(--text-3)", flex: "0 0 auto" }}>⌕</span>
          <input ref={input} type="search" data-token-search value={q} onChange={(e) => search(e.target.value)} aria-label="Search any coin: its name, symbol or contract address"
            placeholder={phone ? "Name, symbol or contract address" : "Search any coin: name, symbol or contract address (pump.fun too)"} autoComplete="off" spellCheck={false} inputMode="search" size={1}
            style={{ ...field, flex: "1 1 auto", font: "600 16px/24px var(--font)", padding: "10px 14px" }} />
          <button type="button" data-token-close onClick={close} aria-label="Close the screen" style={{ ...button, flex: "0 0 auto", padding: "8px 14px" }}>✕</button>
        </div>
        <div data-token-body style={{ overflowY: "auto", overscrollBehavior: "contain", padding: phone ? "12px 12px 28px" : "18px", minWidth: 0 }}>
          {picked?.kind === "token" ? (
            <TokenPage home={home} chain={picked.chain} address={picked.address} chains={chains} crew={crew} strategies={strategies} accounts={accounts} you={you} reload={reload} wallet={wallet} openWallet={openWallet} phone={phone} back={() => pick(null)} />
          ) : picked?.kind === "major" ? (
            <MajorPage home={home} symbol={picked.symbol} ticker={prices.find((t) => t.symbol === picked.symbol) ?? null} crew={crew} strategies={strategies} accounts={accounts} you={you} reload={reload} chains={chains} wallet={wallet} openWallet={openWallet} phone={phone} back={() => pick(null)} />
          ) : (
            <Finder home={home} q={q} prices={prices} wide={!phone} pick={(p) => (pick(p), setQ(""))} />
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
