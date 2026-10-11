// Your wallets and real trades (PLAN 5.26-5.27; owner, 10-10: "connect any wallet, like metamask or wtv. phantom etc.";
// "base also"): the wallets this browser has, connected for their address
// only (kept by the home, so the desk and your other devices see what they hold); an address pasted instead; what each
// holds. A swap: a quote first (what you get, the price impact, the network's fee, the route), then your wallet signs it.
// An orb's proposed trade waits here for your yes; yours is your yes. Orbz never holds a key: your wallet signs.
import { useEffect, useState } from "react";
import type { Character } from "../orb/spec.ts";
import { idOf, type DeskChain, type DeskHolding, type DeskQuote, type DeskSwap, type DeskWallet, type Office } from "../home/link.ts";
import { Balanced } from "../ui/Balanced.tsx";
import { Pick } from "../ui/Pick.tsx";
import { button, card, field, head, shortAddress, small, strong, usd, well } from "./kit.ts";
import { connectWallet, discover, signAndSend, type Found } from "./wallet.ts";

const STATE_WORDS: Record<DeskSwap["state"], string> = { asked: "Waiting for your yes", approved: "Approved: waiting for your wallet", built: "In your wallet", sent: "Sent: waiting for the chain", confirmed: "Done", failed: "Failed", denied: "You said no", expired: "Expired" };

export function TradePanel({ home, crew, wallets, swaps, chains, reload }: { home: Office; crew: Character[]; wallets: DeskWallet[]; swaps: DeskSwap[]; chains: DeskChain[]; reload: () => void }) {
  const [found, setFound] = useState<Found[]>([]);
  const [linked, setLinked] = useState<{ f: Found; address: string } | null>(null);
  const [paste, setPaste] = useState("");
  const [holdings, setHoldings] = useState<Record<number, { holdings: DeskHolding[]; errors: string[] }>>({});
  const [said, setSaid] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  useEffect(() => discover(setFound), []);
  // no wallet in this browser (owner, 10-11: "how does the user connect their wallet? i dont see any way?"): Orbz's own
  // window is a browser profile of its own, so a wallet lives in the browser beside it, or in a phone's wallet app
  const here = ["127.0.0.1", "localhost", "[::1]"].includes(globalThis.location?.hostname ?? "");
  const [elsewhere, setElsewhere] = useState<{ link: string | null; words: string } | null>(null);
  const PLACE = "/desk/trade";
  const chainList = chains.length ? chains : [{ id: "base", name: "Base", kind: "evm" as const, explorer: "", tokens: [] }];
  const [chain, setChain] = useState("base");
  const c = chainList.find((x) => x.id === chain) ?? chainList[0]!;
  const tokens = c.tokens.map((t) => t.symbol);
  const [sell, setSell] = useState("USDC");
  const [buy, setBuy] = useState("ETH");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<(DeskQuote & { usd: number | null }) | null>(null);
  useEffect(() => {
    // a chain's own tokens: keep the choice when it trades there, or take its first two
    if (!tokens.includes(sell)) setSell(tokens.find((t) => /^USDC$/.test(t)) ?? tokens[0] ?? "");
    if (!tokens.includes(buy)) setBuy(tokens.find((t) => t !== sell) ?? "");
    setQuote(null);
  }, [chain]);
  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setSaid(null);
    try {
      await fn();
    } catch (e) {
      setSaid((e as Error).message);
    } finally {
      setStep(null);
    }
  };
  const connect = (f: Found): Promise<void> => act(async () => {
    const address = await connectWallet(f);
    setLinked({ f, address });
    await home.addWallet(address, { wallet: f.name });
    reload();
  });
  /** A swap kept by the home, built for the wallet connected here, signed by it, its hash told back. */
  const signIt = async (s: DeskSwap): Promise<void> => {
    const kind = chainList.find((x) => x.id === s.chain)?.kind ?? "evm";
    if (!linked || linked.f.kind !== kind) throw new Error(`Connect a ${kind === "solana" ? "Solana" : "Base or Ethereum"} wallet here first: it is what signs.`);
    setStep("Building the transaction for your wallet");
    const { built } = await home.buildSwap(s.id, linked.address);
    try {
      const tx = await signAndSend(linked.f, linked.address, built, setStep);
      await home.sentSwap(s.id, tx);
    } catch (e) {
      await home.unsentSwap(s.id, (e as Error).message).catch(() => undefined);
      throw e;
    }
    reload();
  };
  const waiting = swaps.filter((s) => s.state === "asked");
  const mine = linked ? wallets.find((w) => w.address.toLowerCase() === linked.address.toLowerCase()) : null;
  return (
    <div data-trade style={{ display: "grid", gap: "var(--s4)", minWidth: 0 }}>
      {waiting.length > 0 && (
        <section aria-label="Waiting for your yes" style={{ ...card, boxShadow: "inset 0 0 0 1.5px var(--alert)" }}>
          <span style={head}>{`Waiting for your yes (${waiting.length})`}</span>
          {waiting.map((s) => (
            <article key={s.id} data-swap-asked={s.id} style={well}>
              <b style={{ font: "800 15px/20px var(--font)", color: "var(--text-1)" }}>{`${crew.find((o) => idOf(o.name) === s.orb)?.name ?? s.orb ?? "An orb"} asks: ${s.amount} ${s.sell} for about ${s.quote?.out ?? "?"} ${s.buy} on ${chainList.find((x) => x.id === s.chain)?.name ?? s.chain}`}</b>
              {s.why && <span style={{ ...small, color: "var(--text-2)" }}>{`“${s.why}”`}</span>}
              <span className="num" style={small}>{`About ${usd(s.usd)}${s.quote?.priceImpactPct != null ? ` · price impact ${s.quote.priceImpactPct.toFixed(2)}%` : ""}${s.quote?.route.length ? ` · via ${s.quote.route.join(", ")}` : ""}`}</span>
              <Balanced min={140} gap={8}>
                <button type="button" data-approve-swap={s.id} onClick={() => void act(async () => (await home.answerSwap(s.id, true), await signIt({ ...s, state: "approved" })))} style={strong}>Approve and sign</button>
                <button type="button" data-deny-swap={s.id} onClick={() => void act(async () => (await home.answerSwap(s.id, false), reload()))} style={button}>Deny</button>
              </Balanced>
            </article>
          ))}
        </section>
      )}
      <section aria-label="Your wallets" data-wallets style={card}>
        <span style={head}>Your wallets</span>
        <span style={small}>Connected here for their address only: Orbz never sees a key or a seed phrase, and only your wallet can sign.</span>
        {found.length > 0 ? (
          <Balanced min={150} gap={8}>
            {found.map((f) => (
              <button key={f.id} type="button" data-wallet-found={f.name} onClick={() => void connect(f)} style={{ ...(linked?.f.id === f.id ? strong : button), display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                {f.icon && <img src={f.icon} alt="" width={18} height={18} style={{ borderRadius: 4 }} />}
                {linked?.f.id === f.id ? `${f.name} · ${shortAddress(linked.address)}` : `Connect ${f.name}`}
              </button>
            ))}
          </Balanced>
        ) : (
          <div data-no-wallet style={{ display: "grid", gap: 8, minWidth: 0 }}>
            <span style={small}>{here
              ? "No wallet in this window: it is Orbz's own, so the wallet in your browser cannot reach it. Open Orbz in your browser, signed in, and connect it there."
              : "No wallet in this browser. On a phone, open Orbz inside your wallet app (MetaMask, Phantom and the rest have a browser of their own): copy a link and open it there."}</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {here && (
                <button type="button" data-open-browser style={strong} onClick={() => void act(async () => {
                  const r = await home.openInBrowser(PLACE);
                  setElsewhere(r.opened ? { link: null, words: "Opened in your browser: connect your wallet there." } : { link: r.link, words: "No browser could be opened from here: open this link in yours (good for five minutes)." });
                })}>Open in my browser</button>
              )}
              <button type="button" data-copy-link style={here ? button : strong} onClick={() => void act(async () => {
                const link = `${await home.pairPhone()}&to=${encodeURIComponent(PLACE)}`;
                const copied = await globalThis.navigator?.clipboard?.writeText(link).then(() => true, () => false);
                setElsewhere({ link, words: copied ? "Copied: open it in your wallet app's browser, or any browser with your wallet (good for five minutes)." : "Open this link in your wallet app's browser, or any browser with your wallet (good for five minutes)." });
              })}>Copy a link</button>
            </div>
            {elsewhere && <span data-elsewhere style={small}>{elsewhere.words}</span>}
            {elsewhere?.link && <code data-elsewhere-link style={{ ...small, overflowWrap: "anywhere", userSelect: "all" }}>{elsewhere.link}</code>}
            <span style={small}>Or watch an address, to see what it holds:</span>
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); void act(async () => (await home.addWallet(paste.trim()), setPaste(""), reload())); }} style={{ display: "flex", gap: 8, minWidth: 0 }}>
          <input aria-label="A wallet's public address" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="0x…, a Solana or a Bitcoin address" size={1} style={{ ...field, flex: "1 1 auto" }} />
          <button type="submit" disabled={!paste.trim()} style={button}>Watch it</button>
        </form>
        {wallets.map((w) => (
          <article key={w.id} data-wallet={w.id} style={well}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span style={{ display: "grid", minWidth: 0 }}>
                <b style={{ font: "800 14px/19px var(--font)", color: "var(--text-1)" }}>{w.label || w.wallet || (w.chain === "evm" ? "An EVM wallet" : w.chain === "solana" ? "A Solana wallet" : "A Bitcoin wallet")}</b>
                <span className="num" style={small}>{`${shortAddress(w.address)} · ${w.chain === "evm" ? "Ethereum, Base and kin" : w.chain === "solana" ? "Solana" : "Bitcoin"}${mine?.id === w.id ? " · connected here" : ""}`}</span>
              </span>
              <span style={{ display: "flex", gap: 6 }}>
                <button type="button" className="orbs-small" data-holdings={w.id} onClick={() => void act(async () => setHoldings({ ...holdings, [w.id]: await home.holdings(w.id) }))} style={{ ...button, padding: "4px 10px", minHeight: 30 }}>Holdings</button>
                <button type="button" className="orbs-small" aria-label={`Forget ${shortAddress(w.address)}`} onClick={() => void act(async () => (await home.removeWallet(w.id), reload()))} style={{ ...button, padding: "4px 10px", minHeight: 30 }}>Forget</button>
              </span>
            </div>
            {holdings[w.id] && (
              <div data-holdings-of={w.id} style={{ display: "grid", gap: 4, minWidth: 0 }}>
                {!holdings[w.id]!.holdings.length && <span style={small}>Nothing held on the chains read.</span>}
                {holdings[w.id]!.holdings.map((h) => (
                  <div key={`${h.chain}${h.symbol}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, font: "600 13px/18px var(--font)", color: "var(--text-2)" }} className="num">
                    <span>{`${h.amount} ${h.symbol} · ${h.chain}`}</span>
                    <span style={{ color: "var(--text-1)" }}>{h.usd === null ? "–" : usd(h.usd)}</span>
                  </div>
                ))}
                {holdings[w.id]!.errors.map((e) => <span key={e} style={small}>{`Not read: ${e}`}</span>)}
              </div>
            )}
          </article>
        ))}
      </section>
      <section aria-label="A trade" style={card}>
        <span style={head}>A trade from your wallet</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
          <Pick title="Network" value={chain} onChange={setChain} options={chainList.map((x) => [x.id, x.name] as const)} data={{ "data-trade-chain": chain }} />
          <Pick title="Sell" value={sell} onChange={(v) => (setSell(v), setQuote(null))} options={tokens.map((x) => [x, x] as const)} data={{ "data-trade-sell": sell }} />
          <Pick title="Buy" value={buy} onChange={(v) => (setBuy(v), setQuote(null))} options={tokens.filter((x) => x !== sell).map((x) => [x, x] as const)} data={{ "data-trade-buy": buy }} />
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void act(async () => setQuote(await home.quote({ chain, sell, buy, amount: amount.trim() }))); }} style={{ display: "flex", gap: 8, minWidth: 0 }}>
          <input aria-label={`How much ${sell} to sell`} inputMode="decimal" value={amount} onChange={(e) => (setAmount(e.target.value), setQuote(null))} placeholder={`How much ${sell}`} size={1} style={{ ...field, flex: "1 1 auto" }} />
          <button type="submit" data-quote disabled={!amount.trim()} style={button}>Quote</button>
        </form>
        {quote && (
          <div data-quote-result style={well}>
            <b className="num" style={{ font: "800 18px/24px var(--font)", color: "var(--text-1)" }}>{`About ${quote.out} ${buy}`}</b>
            <span className="num" style={small}>{`For ${amount} ${sell}${quote.usd !== null ? ` (${usd(quote.usd)})` : ""}${quote.priceImpactPct !== null ? ` · price impact ${quote.priceImpactPct.toFixed(2)}%` : ""}${quote.feeUsd !== null ? ` · network fee about ${usd(quote.feeUsd)}` : ""}${quote.route.length ? ` · via ${quote.route.join(", ")}` : ""}`}</span>
            <button type="button" data-swap-go onClick={() => void act(async () => signIt(await home.swap({ chain, sell, buy, amount: amount.trim() })))} style={strong}>
              {linked ? `Swap with ${linked.f.name}` : "Connect a wallet to swap"}
            </button>
          </div>
        )}
        {step && <span role="status" data-step style={{ ...small, color: "var(--text-1)" }}>{step}</span>}
        {said && <span role="alert" style={{ ...small, color: "var(--alert)" }}>{said}</span>}
      </section>
      {swaps.filter((s) => s.state !== "asked").length > 0 && (
        <section aria-label="Your trades" style={card}>
          <span style={head}>Your trades</span>
          {swaps.filter((s) => s.state !== "asked").slice(0, 12).map((s) => {
            const ex = chainList.find((x) => x.id === s.chain)?.explorer;
            return (
              <div key={s.id} data-swap={s.id} data-state={s.state} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, minWidth: 0, font: "600 13px/18px var(--font)", color: "var(--text-2)" }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`${s.amount} ${s.sell} → ${s.buy} · ${chainList.find((x) => x.id === s.chain)?.name ?? s.chain}`}</span>
                {s.tx && ex ? <a href={`${ex}${s.tx}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", whiteSpace: "nowrap" }}>{STATE_WORDS[s.state]}</a> : <span style={{ whiteSpace: "nowrap", color: s.state === "failed" ? "var(--off)" : s.state === "confirmed" ? "var(--ok)" : "var(--text-3)" }}>{STATE_WORDS[s.state]}</span>}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
