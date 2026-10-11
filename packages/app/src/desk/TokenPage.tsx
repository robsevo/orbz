// A coin's own page, in the war room's screen (PLAN 5.28; owner, 10-11: "user can input the contract address and view
// the coin + trade manually or send a certain orb to trade it"; "structure it better, for pros man"): its name, chain
// and contract, its price over four windows, its chart at any timeframe, the numbers a desk reads (market cap, FDV,
// liquidity, volume, buys and sells, its pair's age), what it can do to whoever holds it, its last trades; a swap from
// your wallet, and an orb sent to it, on paper or for real (each real trade still asked of you). Every number is the
// home's, from the public DEX data; nothing here is advice.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { Character } from "../orb/spec.ts";
import { idOf, type DeskCandle, type DeskChain, type DeskQuote, type DeskTicker, type DexChain, type DexPair, type DexTrade, type Office, type TokenSafety } from "../home/link.ts";
import { Candles } from "../ui/Candles.tsx";
import { changeText, priceText } from "../ui/candles.ts";
import { Balanced, OneLine } from "../ui/Balanced.tsx";
import { Pick } from "../ui/Pick.tsx";
import { button, card, chip, compact, ema, field, head, picture, shortAddress, small, strong, TIMEFRAMES, well } from "./kit.ts";
import type { WalletHere } from "./useWallet.ts";

export const CHAIN_NAMES: Record<DexChain, string> = { solana: "Solana", ethereum: "Ethereum", base: "Base", arbitrum: "Arbitrum", optimism: "Optimism", polygon: "Polygon", bsc: "BNB Chain" };
const EXPLORER: Partial<Record<DexChain, string>> = { solana: "https://solscan.io", bsc: "https://bscscan.com" };
/** How old a pair is, as a screen of numbers says it: 40m, 5h, 12d, 1.1y. */
export const age = (at: number | null, now: number): string => {
  if (at === null) return "–";
  const m = (now - at) / 60_000;
  return m < 60 ? `${Math.max(1, Math.round(m))}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : m < 365 * 1440 ? `${Math.round(m / 1440)}d` : `${(m / 525_600).toFixed(1)}y`;
};
const tone = (n: number | null): CSSProperties => ({ color: n === null ? "var(--text-3)" : n >= 0 ? "var(--ok)" : "var(--off)" });
const money = (n: number | null): string => (n === null ? "–" : `$${priceText(n)}`);

/** A number with its name over it, as a desk's stats read. */
function Stat({ name, value, sub, data }: { name: string; value: ReactNode; sub?: ReactNode; data?: string }) {
  return (
    <div data-stat={data ?? name} style={{ ...well, gap: 2, padding: "10px 12px" }}>
      <span style={{ ...head, fontSize: 10 }}>{name}</span>
      <span className="num" style={{ font: "800 16px/22px var(--font)", color: "var(--text-1)", overflowWrap: "anywhere" }}>{value}</span>
      {sub && <span className="num" style={{ ...small, fontSize: 12 }}>{sub}</span>}
    </div>
  );
}

/** The timeframes, and the chart at the one chosen, with its 20 and 50-bar EMAs. */
function Chart({ load, tfKey, label, phone }: { load: (tf: string) => Promise<DeskCandle[]>; tfKey: string; label: string; phone: boolean }) {
  const [tf, setTf] = useState("15m");
  const [candles, setCandles] = useState<DeskCandle[] | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setCandles(null);
    const get = (): void => void load(tf).then((c) => live && (setCandles(c), setSaid(null)), (e: Error) => live && setSaid(e.message));
    get();
    const t = window.setInterval(get, tf === "1m" ? 15_000 : 30_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [tfKey, tf]);
  const closes = (candles ?? []).map((c) => c.c);
  return (
    <div data-token-chart style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <OneLine gap={4} style={{ justifyContent: "flex-start" }}>
        {TIMEFRAMES.map((x) => (
          <button key={x} type="button" className="orbs-small" data-tf={x} aria-pressed={tf === x} onClick={() => setTf(x)} style={chip(tf === x)}>{x}</button>
        ))}
      </OneLine>
      {candles && candles.length > 1 ? (
        <Candles candles={candles} tf={tf} height={phone ? 280 : 380} label={`${label} on ${tf} bars: the last ${candles.length}`}
          lines={[{ label: "EMA 20", values: ema(closes, 20), hue: "amber" }, { label: "EMA 50", values: ema(closes, 50), hue: "violet" }]} />
      ) : (
        <div style={{ ...well, height: phone ? 280 : 380, placeItems: "center", alignContent: "center" }}>
          <span role="status" style={small}>{said ? `No chart now: ${said}` : candles ? "Too few trades for a chart yet." : "Drawing the chart…"}</span>
        </div>
      )}
    </div>
  );
}

/** A swap from your wallet: buy with the chain's coin or USDC, or sell for one; quoted as the amount settles; signed by
 * your wallet after the desk's limits are kept (the Limits tab). */
function TradeBox({ home, chain, token, symbol, chains, wallet, openWallet }: { home: Office; chain: DexChain; token: string; symbol: string; chains: DeskChain[]; wallet: WalletHere; openWallet: (kind: "evm" | "solana") => void }) {
  const desk = chains.find((c) => c.id === chain);
  const coin = desk?.kind === "solana" ? "SOL" : desk?.tokens.find((t) => t.symbol === "ETH" || t.symbol === "POL")?.symbol ?? "ETH";
  const pays = desk ? [coin, "USDC"].filter((x) => desk.tokens.some((t) => t.symbol === x)) : [];
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [pay, setPay] = useState(pays[0] ?? "");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<(DeskQuote & { usd: number | null }) | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [said, setSaid] = useState<{ ok: boolean; words: string } | null>(null);
  const sell = side === "buy" ? pay : token;
  const buy = side === "buy" ? token : pay;
  useEffect(() => {
    setQuote(null);
    if (!desk || !(Number(amount) > 0)) return;
    let live = true;
    const t = window.setTimeout(() => void home.quote({ chain: desk.id, sell, buy, amount }).then((q) => live && (setQuote(q), setSaid(null)), (e: Error) => live && setSaid({ ok: false, words: e.message })), 450);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [side, pay, amount, token]);
  if (!desk) {
    return (
      <section data-token-trade aria-label="Swap it" style={card}>
        <span style={head}>Swap</span>
        <span style={small}>{`Swaps on ${CHAIN_NAMES[chain]} are not here yet: watch it here, or send an orb to it on paper.`}</span>
      </section>
    );
  }
  const kind = desk.kind;
  const ready = wallet.linked !== null && wallet.linked.f.kind === kind;
  const presets = side === "sell" ? [] : pay === "USDC" ? ["10", "25", "50", "100"] : coin === "SOL" ? ["0.1", "0.25", "0.5", "1"] : ["0.005", "0.01", "0.02", "0.05"];
  const go = async (): Promise<void> => {
    setSaid(null);
    try {
      const sw = await home.swap({ chain: desk.id, sell, buy, amount });
      await wallet.sign(sw.id, kind, setStep);
      setSaid({ ok: true, words: `Sent: ${amount} ${side === "buy" ? pay : symbol} for about ${quote?.out ?? "?"} ${side === "buy" ? symbol : pay}. It is followed on the chain: the Trade tab says when it lands.` });
      setAmount("");
    } catch (e) {
      setSaid({ ok: false, words: (e as Error).message });
    } finally {
      setStep(null);
    }
  };
  return (
    <section data-token-trade aria-label="Swap it" style={card}>
      <div role="tablist" aria-label="Buy or sell" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {(["buy", "sell"] as const).map((x) => (
          <button key={x} type="button" role="tab" aria-selected={side === x} data-side={x} onClick={() => (setSide(x), setAmount(""))}
            style={{ ...(side === x ? strong : button), minHeight: 40, font: "800 15px/20px var(--font)", ...(side === x ? { background: "var(--fill-2)", color: `var(--${x === "buy" ? "ok" : "off"})`, boxShadow: `inset 0 0 0 1.5px var(--${x === "buy" ? "ok" : "off"})` } : {}) }}>
            {x === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
          </button>
        ))}
      </div>
      <OneLine gap={6}>
        <span style={{ ...small, alignSelf: "center" }}>{side === "buy" ? "Pay with" : "For"}</span>
        {pays.map((x) => (
          <button key={x} type="button" className="orbs-small" data-pay={x} aria-pressed={pay === x} onClick={() => setPay(x)} style={chip(pay === x)}>{x}</button>
        ))}
      </OneLine>
      <label style={{ display: "grid", gap: 4, minWidth: 0 }}>
        <span style={head}>{side === "buy" ? `Amount of ${pay}` : `Amount of ${symbol}`}</span>
        <input data-amount inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.0" size={1}
          style={{ ...field, font: "800 20px/28px var(--font)" }} />
      </label>
      {presets.length > 0 && (
        <Balanced min={60} gap={6}>
          {presets.map((x) => (
            <button key={x} type="button" className="orbs-small" data-preset={x} onClick={() => setAmount(x)} style={chip(amount === x)}>{`${x} ${pay}`}</button>
          ))}
        </Balanced>
      )}
      <span data-token-quote className="num" style={{ ...small, minHeight: 18 }}>
        {quote ? `≈ ${quote.out} ${side === "buy" ? symbol : pay}${quote.usd !== null ? ` · about $${priceText(quote.usd)}` : ""}${quote.priceImpactPct !== null ? ` · impact ${quote.priceImpactPct.toFixed(2)}%` : ""}${quote.route.length ? ` · via ${quote.route.slice(0, 3).join(", ")}` : ""}` : Number(amount) > 0 ? "Quoting…" : "A quote shows as you type."}
      </span>
      {ready ? (
        <button type="button" data-swap-token disabled={!quote || step !== null} onClick={() => void go()} style={{ ...strong, minHeight: 46, font: "800 15px/20px var(--font)", opacity: quote && step === null ? 1 : 0.6 }}>
          {step ?? `Swap with ${wallet.linked!.f.name}`}
        </button>
      ) : (
        <button type="button" data-swap-connect onClick={() => openWallet(kind)} style={{ ...strong, minHeight: 46, font: "800 15px/20px var(--font)" }}>
          {`Connect a ${kind === "solana" ? "Solana" : "Base or Ethereum"} wallet`}
        </button>
      )}
      {said && <span role={said.ok ? "status" : "alert"} style={{ ...small, color: said.ok ? "var(--ok)" : "var(--alert)" }}>{said.words}</span>}
      <span style={{ ...small, fontSize: 12 }}>Your own swap: your wallet asks you to sign it, inside the desk's limits (the Limits tab). Not advice: a token can go to nothing.</span>
    </section>
  );
}

/** An orb sent to it: on paper, or for real (each real trade still asked of you); told in its chat, it walks to the
 * war room's screen. */
function SendOrb({ home, crew, market, label }: { home: Office; crew: Character[]; market: string; label: string }) {
  const [who, setWho] = useState(crew[0]?.name ?? "");
  const [mode, setMode] = useState<"paper" | "real">("paper");
  const [budget, setBudget] = useState("100");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<{ ok: boolean; words: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!crew.length) {
    return (
      <section data-send-orb aria-label="Send an orb" style={card}>
        <span style={head}>Send an orb</span>
        <span style={small}>No orb on the desk yet: hire one, and send it to any coin from here.</span>
      </section>
    );
  }
  const send = async (): Promise<void> => {
    setBusy(true);
    setSent(null);
    try {
      const orb = crew.find((c) => c.name === who) ?? crew[0]!;
      await home.sendOrb({ orb: idOf(orb.name), market, mode, budget: budget ? Number(budget) : null, note });
      setSent({ ok: true, words: `${orb.name} has ${label}, ${mode === "paper" ? "on paper" : "for real: each trade it wants comes to you for a yes"}${budget ? `, up to $${budget}` : ""}. It reads the coin and its chart, then says what it sees in its chat.` });
      setNote("");
    } catch (e) {
      setSent({ ok: false, words: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section data-send-orb aria-label="Send an orb" style={card}>
      <span style={head}>Send an orb</span>
      <Pick title="Orb" label="The orb to send" value={who} options={crew.map((c) => [c.name, c.name] as const)} onChange={setWho} data={{ "data-send-who": who }} />
      <div role="radiogroup" aria-label="Paper or real" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {(["paper", "real"] as const).map((x) => (
          <button key={x} type="button" role="radio" aria-checked={mode === x} data-send-mode={x} onClick={() => setMode(x)} style={chip(mode === x)}>{x === "paper" ? "On paper" : "For real"}</button>
        ))}
      </div>
      <Balanced min={130} gap={8}>
        <label style={{ display: "grid", gap: 4, minWidth: 0 }}>
          <span style={head}>Up to ($)</span>
          <input data-send-budget inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ""))} size={1} style={field} />
        </label>
        <label style={{ display: "grid", gap: 4, minWidth: 0 }}>
          <span style={head}>A note (optional)</span>
          <input data-send-note value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Under $0.15 only" size={1} style={field} />
        </label>
      </Balanced>
      <button type="button" data-send-go disabled={busy} onClick={() => void send()} style={{ ...strong, minHeight: 44 }}>{`Send ${who || "an orb"} to ${label}`}</button>
      <span style={{ ...small, fontSize: 12 }}>{mode === "paper" ? "Paper: it learns from what the market does to its trades, and its wins are its XP." : "Real: it asks you for each trade, a card here, then your wallet signs. Never on its own."}</span>
      {sent && <span data-sent role={sent.ok ? "status" : "alert"} style={{ ...small, color: sent.ok ? "var(--ok)" : "var(--alert)" }}>{sent.words}</span>}
    </section>
  );
}

/** The flags against a coin, read from its own chain and its pair. */
function Safety({ safety }: { safety: TokenSafety | null }) {
  return (
    <section data-safety aria-label="What it can do" style={card}>
      <span style={head}>What it can do to holders</span>
      {!safety ? (
        <span role="status" style={small}>Reading its chain…</span>
      ) : safety.flags.length === 0 ? (
        <span style={{ ...small, color: "var(--ok)" }}>{`Nothing found against it in ${safety.checked.join(" and ") || "what could be read"}. That is not a promise.`}</span>
      ) : (
        <ul style={{ display: "grid", gap: 6, margin: 0, padding: 0, listStyle: "none" }}>
          {safety.flags.map((f, i) => (
            <li key={i} data-flag={f.level} style={{ ...small, display: "flex", gap: 8, color: f.level === "warn" ? "var(--alert)" : "var(--text-2)" }}>
              <span aria-hidden>{f.level === "warn" ? "▲" : "•"}</span>
              <span>{f.words}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The pool's last trades, the newest first. */
function Recent({ trades, symbol, now }: { trades: DexTrade[] | null; symbol: string; now: number }) {
  return (
    <section data-recent aria-label="Its last trades" style={card}>
      <span style={head}>Last trades</span>
      {!trades ? (
        <span role="status" style={small}>Reading its pool…</span>
      ) : !trades.length ? (
        <span style={small}>No trades in its pool lately.</span>
      ) : (
        <div style={{ display: "grid", gap: 2, maxHeight: 320, overflowY: "auto", overscrollBehavior: "contain" }}>
          {trades.slice(0, 30).map((t) => (
            <div key={`${t.tx}:${t.at}:${t.side}`} data-trade-row={t.side} className="num" style={{ display: "grid", gridTemplateColumns: "44px 44px minmax(0, 1fr) minmax(0, 1fr)", gap: 8, font: "600 12px/18px var(--font)", color: "var(--text-2)", padding: "3px 0", borderBottom: "1px solid var(--sep)" }}>
              <span style={{ color: "var(--text-3)" }}>{age(t.at, now)}</span>
              <span style={{ fontWeight: 800, ...tone(t.side === "buy" ? 1 : -1) }}>{t.side === "buy" ? "Buy" : "Sell"}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`${compact(t.usd)} · ${t.amount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${symbol}`}</span>
              <span style={{ textAlign: "right" }}>{money(t.priceUsd)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** A coin on a DEX: its pairs read every 20 s, its safety once, its last trades every 20 s. */
export function TokenPage({ home, chain, address, chains, crew, wallet, openWallet, phone, back }: {
  home: Office; chain: DexChain; address: string; chains: DeskChain[]; crew: Character[]; wallet: WalletHere; openWallet: (kind: "evm" | "solana") => void; phone: boolean; back: () => void;
}) {
  const [pairs, setPairs] = useState<DexPair[] | null>(null);
  const [at, setAt] = useState(0);
  const [safety, setSafety] = useState<TokenSafety | null>(null);
  const [trades, setTrades] = useState<DexTrade[] | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let live = true;
    setPairs(null);
    setAt(0);
    setSafety(null);
    const get = (): void => void home.dexToken(chain, address).then((p) => live && (setPairs(p), setSaid(null), setNow(Date.now())), (e: Error) => live && setSaid(e.message));
    get();
    void home.dexSafety(chain, address).then((s) => live && setSafety(s), () => live && setSafety({ checked: [], flags: [{ level: "note", words: "its chain could not be read just now" }] }));
    const t = window.setInterval(get, 20_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [chain, address]);
  const p = pairs?.[at] ?? pairs?.[0] ?? null;
  useEffect(() => {
    if (!p) return;
    let live = true;
    const get = (): void => void home.dexTrades(chain, p.pair, address).then((x) => live && setTrades(x), () => live && setTrades([]));
    get();
    const t = window.setInterval(get, 20_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [p?.pair]);
  if (!pairs) {
    return (
      <div data-token-page={`${chain}:${address}`} style={{ ...card, minHeight: 200, placeItems: "center", alignContent: "center" }}>
        <span role="status" style={small}>{said ? `The DEX data cannot say now: ${said}` : "Reading the coin…"}</span>
      </div>
    );
  }
  if (!p) {
    return (
      <div data-token-page={`${chain}:${address}`} style={{ ...card, gap: 10 }}>
        <button type="button" onClick={back} style={{ ...button, justifySelf: "start" }}>‹ Back</button>
        <span style={small}>{`No pool trades ${shortAddress(address)} on ${CHAIN_NAMES[chain]} now.`}</span>
      </div>
    );
  }
  const sym = p.base.symbol || shortAddress(address);
  const market = `${chain}:${address}`;
  const explorer = chain === "solana" || chain === "bsc" ? EXPLORER[chain]! : chains.find((c) => c.id === chain)?.explorer ?? null;
  const links: { label: string; url: string }[] = [
    ...p.links,
    ...(p.url ? [{ label: "DexScreener", url: p.url }] : []),
    ...(explorer ? [{ label: chain === "solana" ? "Solscan" : "Explorer", url: `${explorer}/token/${address}` }] : []),
    ...(chain === "solana" && address.endsWith("pump") ? [{ label: "pump.fun", url: `https://pump.fun/coin/${address}` }] : []),
  ];
  const header = (
    <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <button type="button" data-token-back onClick={back} aria-label="Back to the list" style={{ ...button, padding: "6px 12px", flex: "0 0 auto" }}>‹</button>
        {p.image ? <img src={picture(p.image)} alt="" width={40} height={40} onError={(e) => (e.currentTarget.style.visibility = "hidden")} style={{ borderRadius: 12, flex: "0 0 auto", background: "var(--fill)" }} /> : <span aria-hidden style={{ width: 40, height: 40, borderRadius: 12, background: "var(--fill)", flex: "0 0 auto" }} />}
        <div style={{ display: "grid", minWidth: 0 }}>
          <span style={{ font: "900 22px/28px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sym}</span>
          <span style={{ ...small, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`${p.base.name} · ${CHAIN_NAMES[chain]} · ${p.dex} · ${p.quote.symbol} pair`}</span>
        </div>
      </div>
      <OneLine gap={6} style={{ justifyContent: "flex-start" }}>
        <button type="button" className="orbs-small" data-copy-address onClick={() => void globalThis.navigator?.clipboard?.writeText(address).then(() => (setCopied(true), window.setTimeout(() => setCopied(false), 1500)), () => undefined)}
          style={{ ...chip(false), fontFamily: "var(--mono)" }} title={address}>{copied ? "Copied" : `${shortAddress(address)} ⧉`}</button>
        {links.map((l) => (
          <a key={`${l.label}${l.url}`} href={l.url} target="_blank" rel="noopener noreferrer" className="orbs-small" style={{ ...chip(false), textDecoration: "none", display: "inline-flex", alignItems: "center" }}>{l.label} ↗</a>
        ))}
      </OneLine>
      {pairs.length > 1 && (
        <Pick title="Pool" label="Which pool" value={String(at)} options={pairs.slice(0, 8).map((x, i) => [String(i), `${x.dex} · ${x.quote.symbol} · ${compact(x.liquidityUsd)}`] as const)} onChange={(v) => setAt(Number(v))} data={{ "data-pool": String(at) }} />
      )}
    </div>
  );
  const price = (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 14, rowGap: 2, minWidth: 0 }}>
        <span className="num" data-token-price style={{ font: "900 32px/38px var(--font)", color: "var(--text-1)", overflowWrap: "anywhere" }}>{money(p.priceUsd)}</span>
        <span className="num" data-token-quick style={{ ...small, color: "var(--text-2)" }}>{`MC ${compact(p.marketCap ?? p.fdv)} · Liq ${compact(p.liquidityUsd)} · Vol ${compact(p.volume24h)}`}</span>
      </div>
      <OneLine gap={6} style={{ justifyContent: "flex-start" }}>
        {([["5m", p.change.m5], ["1h", p.change.h1], ["6h", p.change.h6], ["24h", p.change.h24]] as const).map(([k, v]) => (
          <span key={k} data-change={k} className="num" style={{ ...chip(false), cursor: "default", background: "transparent", boxShadow: "inset 0 0 0 1px var(--hairline)", ...tone(v) }}>{`${k} ${v === null ? "–" : changeText(v)}`}</span>
        ))}
      </OneLine>
    </div>
  );
  const stats = (
    <Balanced min={120} gap={8}>
      <Stat name="Market cap" value={compact(p.marketCap)} data="mcap" />
      <Stat name="FDV" value={compact(p.fdv)} data="fdv" />
      <Stat name="Liquidity" value={compact(p.liquidityUsd)} data="liquidity" />
      <Stat name="Volume 24h" value={compact(p.volume24h)} data="volume" />
      <Stat name="Buys / sells 24h" value={`${p.buys24h ?? "–"} / ${p.sells24h ?? "–"}`} data="txns" />
      <Stat name="Pair age" value={age(p.createdAt, now)} data="age" />
    </Balanced>
  );
  const chart = <Chart load={(tf) => home.dexCandles(chain, p.pair, address, tf, 300)} tfKey={`${p.pair}`} label={sym} phone={phone} />;
  const trade = <TradeBox home={home} chain={chain} token={address} symbol={sym} chains={chains} wallet={wallet} openWallet={openWallet} />;
  const send = <SendOrb home={home} crew={crew} market={market} label={sym} />;
  if (phone) {
    return (
      <div data-token-page={market} style={{ display: "grid", gap: "var(--s3)", minWidth: 0 }}>
        {header}
        {price}
        {chart}
        {trade}
        {stats}
        {send}
        <Safety safety={safety} />
        <Recent trades={trades} symbol={sym} now={now} />
      </div>
    );
  }
  return (
    <div data-token-page={market} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: "var(--s4)", alignItems: "start", minWidth: 0 }}>
      <div style={{ display: "grid", gap: "var(--s3)", minWidth: 0 }}>
        {header}
        {price}
        {chart}
        <Recent trades={trades} symbol={sym} now={now} />
      </div>
      <div style={{ display: "grid", gap: "var(--s3)", minWidth: 0 }}>
        {trade}
        {send}
        <section aria-label="Its numbers" style={card}>{stats}</section>
        <Safety safety={safety} />
      </div>
    </div>
  );
}

/** A major (BTC, ETH, SOL and the rest): its chart from the market, its day, an orb sent to it on paper. */
export function MajorPage({ home, symbol, ticker, crew, phone, back }: { home: Office; symbol: string; ticker: DeskTicker | null; crew: Character[]; phone: boolean; back: () => void }) {
  const head1 = (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" data-token-back onClick={back} aria-label="Back to the list" style={{ ...button, padding: "6px 12px" }}>‹</button>
        <span style={{ font: "900 22px/28px var(--font)", color: "var(--text-1)" }}>{symbol}</span>
        <span style={small}>US dollars · the majors' market</span>
      </div>
      <span className="num" data-token-price style={{ font: "900 32px/38px var(--font)", color: "var(--text-1)" }}>{ticker ? money(ticker.price) : "–"}</span>
      {ticker && <span className="num" style={{ ...small, ...tone(ticker.changePct) }}>{`${changeText(ticker.changePct)} today · from ${money(ticker.low)} to ${money(ticker.high)}${ticker.stale ? " · stale" : ""}`}</span>}
    </div>
  );
  const chart = <Chart load={(tf) => home.candles(symbol, tf, 200)} tfKey={symbol} label={symbol} phone={phone} />;
  const send = <SendOrb home={home} crew={crew} market={symbol} label={symbol} />;
  return phone ? (
    <div data-major-page={symbol} style={{ display: "grid", gap: "var(--s3)", minWidth: 0 }}>{head1}{chart}{send}</div>
  ) : (
    <div data-major-page={symbol} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: "var(--s4)", alignItems: "start", minWidth: 0 }}>
      <div style={{ display: "grid", gap: "var(--s3)", minWidth: 0 }}>{head1}{chart}</div>
      <div style={{ display: "grid", gap: "var(--s3)", minWidth: 0 }}>{send}</div>
    </div>
  );
}
