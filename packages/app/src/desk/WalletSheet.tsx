// Connecting a wallet (owner, 10-11: "we can connect our phantom wallet. I dont see the wallet trying to connect at all
// when we say connect wallet"): the desk's Connect wallet opens the wallet's own window at once when this browser has
// one, and this sheet when it has several (each by its name and its chains) or none. None here: Orbz's own window is a
// browser profile of its own, so your wallet lives in the browser beside it; opened there, signed in, or a link copied
// for a phone's wallet app.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Office } from "../home/link.ts";
import { button, card, head, shortAddress, small, strong } from "./kit.ts";
import type { WalletHere } from "./useWallet.ts";

const PLACE = "/desk/trade";

/** No wallet in this browser: your browser opened by the home, signed in, on the Trade tab; or a link to open elsewhere. */
export function NoWallet({ home }: { home: Office }) {
  const here = ["127.0.0.1", "localhost", "[::1]"].includes(globalThis.location?.hostname ?? "");
  const [elsewhere, setElsewhere] = useState<{ link: string | null; words: string } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const act = (fn: () => Promise<void>): void => {
    setSaid(null);
    fn().catch((e: Error) => setSaid(e.message));
  };
  return (
    <div data-no-wallet style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <span style={small}>{here
        ? "No wallet in this window: it is Orbz's own, so the wallet in your browser cannot reach it. Open Orbz in your browser, signed in, and connect it there."
        : "No wallet in this browser. On a phone, open Orbz inside your wallet app (MetaMask, Phantom and the rest have a browser of their own): copy a link and open it there."}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {here && (
          <button type="button" data-open-browser style={strong} onClick={() => act(async () => {
            const r = await home.openInBrowser(PLACE);
            setElsewhere(r.opened ? { link: null, words: "Opened in your browser: connect your wallet there." } : { link: r.link, words: "No browser could be opened from here: open this link in yours (good for five minutes)." });
          })}>Open in my browser</button>
        )}
        <button type="button" data-copy-link style={here ? button : strong} onClick={() => act(async () => {
          const link = `${await home.pairPhone()}&to=${encodeURIComponent(PLACE)}`;
          const copied = await globalThis.navigator?.clipboard?.writeText(link).then(() => true, () => false);
          setElsewhere({ link, words: copied ? "Copied: open it in your wallet app's browser, or any browser with your wallet (good for five minutes)." : "Open this link in your wallet app's browser, or any browser with your wallet (good for five minutes)." });
        })}>Copy a link</button>
      </div>
      {elsewhere && <span data-elsewhere style={small}>{elsewhere.words}</span>}
      {elsewhere?.link && <code data-elsewhere-link style={{ ...small, overflowWrap: "anywhere", userSelect: "all" }}>{elsewhere.link}</code>}
      {said && <span role="alert" style={{ ...small, color: "var(--alert)" }}>{said}</span>}
    </div>
  );
}

/** The wallets this browser has, to connect one; the one connected, to let go. */
export function WalletSheet({ home, wallet, close }: { home: Office; wallet: WalletHere; close: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent): void => void (e.key === "Escape" && close());
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  const { found, linked } = wallet;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Connect a wallet" data-wallet-sheet style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", alignItems: "end", justifyItems: "center", padding: "var(--s4)" }}>
      <div aria-hidden onClick={close} style={{ position: "absolute", inset: 0, background: "var(--ground)", opacity: 0.82 }} />
      <section style={{ ...card, position: "relative", width: "min(460px, 100%)", alignSelf: "center", boxShadow: "0 18px 50px var(--shadow), inset 0 0 0 1px var(--hairline)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={head}>{linked ? "Your wallet" : "Connect a wallet"}</span>
          <button type="button" className="orbs-small" onClick={close} aria-label="Close" style={{ ...button, padding: "4px 12px" }}>✕</button>
        </div>
        {linked && (
          <div data-linked style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, font: "700 15px/20px var(--font)", color: "var(--text-1)", minWidth: 0 }}>
              {linked.f.icon && <img src={linked.f.icon} alt="" width={22} height={22} style={{ borderRadius: 6 }} />}
              {`${linked.f.name} · ${shortAddress(linked.address)}`}
            </span>
            <button type="button" data-disconnect onClick={() => (wallet.forget(), close())} style={button}>Disconnect</button>
          </div>
        )}
        {found.length > 0 ? (
          <div style={{ display: "grid", gap: 8 }}>
            {found.map((f) => (
              <button key={f.id} type="button" data-wallet-pick={f.name} disabled={wallet.busy} onClick={() => void wallet.connect(f).then(close, () => undefined)}
                style={{ ...(linked?.f.id === f.id ? strong : button), display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-start", minHeight: 48, textAlign: "left" }}>
                {f.icon ? <img src={f.icon} alt="" width={24} height={24} style={{ borderRadius: 6 }} /> : <span aria-hidden style={{ width: 24, textAlign: "center" }}>◎</span>}
                <span style={{ flex: "1 1 auto", minWidth: 0 }}>{f.name}</span>
                <span style={{ ...small, flex: "0 0 auto" }}>{f.kind === "solana" ? "Solana" : "Ethereum and its chains"}</span>
              </button>
            ))}
          </div>
        ) : (
          <NoWallet home={home} />
        )}
        {wallet.busy && <span role="status" style={small}>Your wallet's own window asks you now.</span>}
        {wallet.said && <span role="alert" style={{ ...small, color: "var(--alert)" }}>{wallet.said}</span>}
        <span style={small}>Connected for its address only: Orbz never sees a key or a seed phrase, and only your wallet can sign.</span>
      </section>
    </div>,
    document.body,
  );
}
