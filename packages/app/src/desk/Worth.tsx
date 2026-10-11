// Your wallets' worth (PLAN 5.31; owner, 10-11: "users can see wallet balance and analytics as well"): every coin your
// kept wallets hold, on every chain of their kind, valued (a coin the desk knows at the market's price, any other at
// its pair's), how much the whole moved today, how it is spread (a bar, the biggest coins first), each wallet's own
// total, and each coin a press away from its page on the war room's screen. Read from public chains by the home,
// a minute at most old; nothing here moves anything.
import { useEffect, useState } from "react";
import { idOf, type DeskHolding, type DeskOrbPnl, type DeskWallet, type Office } from "../home/link.ts";
import { Orb } from "../orb/Orb.tsx";
import type { Character } from "../orb/spec.ts";
import type { HueName } from "../design/tokens.ts";
import { changeText, priceText } from "../ui/candles.ts";
import { card, compact, head, picture, shortAddress, small, strong, well } from "./kit.ts";

const HUES: HueName[] = ["azure", "mint", "amber", "violet", "coral", "lime", "teal", "pink", "honey"];
type Read = { w: DeskWallet; holdings: DeskHolding[]; errors: string[] };
type Coin = { id: string; symbol: string; name: string | null; chain: string; key: string | null; image: string | null; amount: number; usd: number | null; change24h: number | null };

/** The coins of every wallet, each once (the same coin in two wallets is summed). */
export function coinsOf(reads: readonly Read[]): Coin[] {
  const by = new Map<string, Coin>();
  for (const r of reads) {
    for (const h of r.holdings) {
      const id = h.key ?? `${h.chain}:${h.symbol}`;
      const was = by.get(id);
      const amount = Number(h.amount);
      if (was) {
        was.amount += amount;
        was.usd = was.usd === null || h.usd === null ? (was.usd ?? h.usd) : was.usd + h.usd;
      } else by.set(id, { id, symbol: h.symbol, name: h.name ?? null, chain: h.chain, key: h.key ?? null, image: h.image ?? null, amount, usd: h.usd, change24h: h.change24h ?? null });
    }
  }
  return [...by.values()].sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
}

/** What the whole is worth, and how much it moved today (each coin by its own day; one with no day counted as still). */
export function worthOf(coins: readonly Coin[]): { total: number; moved: number; movedPct: number | null; valued: number } {
  let total = 0;
  let before = 0;
  let valued = 0;
  for (const c of coins) {
    if (c.usd === null) continue;
    valued++;
    total += c.usd;
    before += c.change24h === null ? c.usd : c.usd / (1 + c.change24h / 100);
  }
  return { total, moved: total - before, movedPct: before > 0 ? ((total - before) / before) * 100 : null, valued };
}

export function Worth({ home, wallets, openCoin, connect }: { home: Office; wallets: DeskWallet[]; openCoin: (key: string) => void; connect: () => void }) {
  const [reads, setReads] = useState<Read[] | null>(null);
  const ids = wallets.map((w) => w.id).join(",");
  useEffect(() => {
    if (!wallets.length) return void setReads([]);
    let live = true;
    const get = (): void => void Promise.all(wallets.map(async (w) => {
      const r = await home.holdings(w.id).catch((e: Error) => ({ holdings: [], errors: [e.message], at: 0 }));
      return { w, holdings: r.holdings, errors: r.errors };
    })).then((x) => live && setReads(x));
    get();
    const t = window.setInterval(get, 60_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [ids]);
  if (!wallets.length) {
    return (
      <section data-worth aria-label="Your worth" style={card}>
        <span style={head}>Your worth</span>
        <span style={small}>Connect a wallet to see every coin it holds, what it is worth, and how it moved today.</span>
        <button type="button" onClick={connect} style={{ ...strong, justifySelf: "start" }}>Connect wallet</button>
      </section>
    );
  }
  if (!reads) {
    return (
      <section data-worth aria-label="Your worth" style={card}>
        <span style={head}>Your worth</span>
        <span role="status" style={small}>Reading your wallets on their chains…</span>
      </section>
    );
  }
  const coins = coinsOf(reads);
  const w = worthOf(coins);
  const shown = coins.filter((c) => (c.usd ?? 0) > 0);
  const top = shown.slice(0, 6);
  const rest = shown.slice(6).reduce((n, c) => n + (c.usd ?? 0), 0);
  const errors = reads.flatMap((r) => r.errors.map((e) => `${shortAddress(r.w.address)}: ${e}`));
  return (
    <section data-worth aria-label="Your worth" style={card}>
      <span style={head}>Your worth</span>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 12, rowGap: 2 }}>
        <span className="num" data-worth-total style={{ font: "900 30px/36px var(--font)", color: "var(--text-1)" }}>{`$${w.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</span>
        {w.movedPct !== null && (
          <span className="num" data-worth-moved style={{ font: "700 14px/20px var(--font)", color: w.moved >= 0 ? "var(--ok)" : "var(--off)" }}>{`${changeText(w.movedPct)} today (${w.moved >= 0 ? "+" : "−"}$${Math.abs(w.moved).toFixed(2)})`}</span>
        )}
      </div>
      {w.total > 0 && (
        <div aria-label="How it is spread" data-spread style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: "var(--fill)" }}>
          {top.map((c, i) => (
            <span key={c.id} data-orb={HUES[i % HUES.length]} title={`${c.symbol} ${(((c.usd ?? 0) / w.total) * 100).toFixed(1)}%`} style={{ width: `${((c.usd ?? 0) / w.total) * 100}%`, background: "var(--accent)" }} />
          ))}
          {rest > 0 && <span title={`Others ${((rest / w.total) * 100).toFixed(1)}%`} style={{ width: `${(rest / w.total) * 100}%`, background: "var(--text-3)" }} />}
        </div>
      )}
      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
        {coins.map((c, i) => {
          const share = w.total > 0 && c.usd !== null ? (c.usd / w.total) * 100 : null;
          const row = (
            <>
              <span aria-hidden data-orb={HUES[i % HUES.length]} style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: i < 6 ? "var(--accent)" : "var(--text-3)", flex: "0 0 4px" }} />
              {c.image ? <img src={picture(c.image)} alt="" width={28} height={28} loading="lazy" onError={(e) => (e.currentTarget.style.visibility = "hidden")} style={{ borderRadius: 8, background: "var(--fill)", flex: "0 0 28px" }} /> : <span aria-hidden style={{ width: 28, height: 28, borderRadius: 8, background: "var(--fill)", flex: "0 0 28px" }} />}
              <span style={{ display: "grid", flex: "1 1 auto", minWidth: 0 }}>
                <b style={{ font: "800 14px/19px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.symbol}</b>
                <span className="num" style={{ ...small, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`${c.amount.toLocaleString("en-US", { maximumFractionDigits: 6 })} · ${c.chain}${share !== null ? ` · ${share.toFixed(1)}%` : ""}`}</span>
              </span>
              <span className="num" style={{ display: "grid", justifyItems: "end", flex: "0 0 auto" }}>
                <span style={{ font: "800 14px/19px var(--font)", color: "var(--text-1)" }}>{c.usd === null ? "no price" : `$${priceText(c.usd)}`}</span>
                <span style={{ font: "700 12px/16px var(--font)", color: c.change24h === null ? "var(--text-3)" : c.change24h >= 0 ? "var(--ok)" : "var(--off)" }}>{c.change24h === null ? "–" : changeText(c.change24h)}</span>
              </span>
            </>
          );
          const style = { display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "6px 8px", borderRadius: 12, minWidth: 0, width: "100%", border: 0, background: "transparent", color: "inherit", textAlign: "left" as const };
          return c.key ? (
            <button key={c.id} type="button" data-coin={c.key} onClick={() => openCoin(c.key!)} style={{ ...style, cursor: "pointer" }} aria-label={`${c.symbol}: open it on the war room's screen`}>{row}</button>
          ) : (
            <div key={c.id} data-coin={c.id} style={style}>{row}</div>
          );
        })}
        {!coins.length && <span style={small}>Nothing in these wallets yet.</span>}
      </div>
      {reads.length > 1 && (
        <div style={{ ...well, gap: 4 }}>
          {reads.map((r) => (
            <span key={r.w.id} className="num" data-wallet-worth={r.w.id} style={{ ...small, display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`${r.w.wallet || r.w.label || "A wallet"} · ${shortAddress(r.w.address)}`}</span>
              <b style={{ color: "var(--text-1)" }}>{compact(r.holdings.reduce((n, h) => n + (h.usd ?? 0), 0))}</b>
            </span>
          ))}
        </div>
      )}
      {errors.length > 0 && <span style={{ ...small, color: "var(--alert)" }}>{`Not read just now: ${errors.slice(0, 3).join("; ")}`}</span>}
    </section>
  );
}

/** Your orbs' P&L at a glance, on the wallet's dashboard (owner, 10-11: "a wallet dashboard also where like we said we can
 * see the orbs pnl"): the whole desk's, today's, and the orbs that did most, each a press from the Orbs tab. */
export function OrbsAtAGlance({ orbs, people, more }: { orbs: readonly DeskOrbPnl[]; people: readonly Character[]; more: () => void }) {
  const named = orbs.map((p) => ({ p, c: people.find((c) => idOf(c.name) === p.orb) })).filter((x): x is { p: DeskOrbPnl; c: Character } => x.c !== undefined);
  const total = orbs.reduce((n, p) => n + p.pnl, 0);
  const today = orbs.reduce((n, p) => n + p.today, 0);
  const signed = (n: number): string => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const tone = (n: number) => ({ color: n > 0 ? "var(--ok)" : n < 0 ? "var(--off)" : "var(--text-2)" });
  return (
    <section data-orbs-glance aria-label="Your orbs' P&L" style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={head}>Your orbs' P&L</span>
        <button type="button" className="orbs-small" data-orbs-more onClick={more} style={{ ...strong, padding: "4px 12px", minHeight: 30 }}>All of it ›</button>
      </div>
      {!named.length ? (
        <span style={small}>No orb has traded yet: send one to a coin from the war room's screen.</span>
      ) : (
        <>
          <span className="num" style={small}>
            <b style={{ font: "900 20px/26px var(--font)", ...tone(total) }}>{signed(total)}</b>
            {` on paper · today ${signed(today)}`}
          </span>
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            {named.slice(0, 5).map(({ p, c }) => (
              <div key={p.orb} data-orb-glance={c.name} className="num" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40, minWidth: 0 }}>
                <Orb character={c} size={28} poke={false} still />
                <b data-orb={c.hue} style={{ font: "800 14px/19px var(--font)", color: "var(--accent)", flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</b>
                <span style={{ ...small, flex: "0 0 auto" }}>{p.trades ? `${Math.round((p.wins / p.trades) * 100)}% won` : "no trades"}</span>
                <span style={{ font: "800 14px/19px var(--font)", flex: "0 0 auto", ...tone(p.pnl) }}>{signed(p.pnl)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
