// An orb's account (PLAN 5.34; owner, 10-11: "how do we alternate between paper and real? and we dont want the orbs to
// know the difference. money is money"): on paper or real money, the budget real money has and how much its paper is
// (PLAN 5.37: "why cant we choose how much paper cash we have?"), yours to set here (the Orbs tab, and Send an orb); the
// orb places its orders the one way whichever it is, and is never told which.
import { useState } from "react";
import type { DeskAccount, Office } from "../home/link.ts";
import { button, chip, field, small, usd } from "./kit.ts";

export function AccountSwitch({ home, orb, name, account, changed }: { home: Office; orb: string; name: string; account: DeskAccount | null; changed: () => void }) {
  const mode = account?.mode ?? "paper";
  // real money chosen, or its budget changed, or its paper's amount: how much, asked first
  const [asking, setAsking] = useState<"real" | "paper" | null>(null);
  const [budget, setBudget] = useState(String(account?.budget || 100));
  const [paper, setPaper] = useState(String(account?.paper ?? 10_000));
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = async (m: "paper" | "real", b?: number, p?: number): Promise<void> => {
    setBusy(true);
    try {
      await home.setDeskAccount(orb, m, b, p);
      setAsking(null);
      setSaid(null);
      changed();
    } catch (e) {
      setSaid((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const amount = Number(budget);
  return (
    <div data-account={orb} data-account-mode={mode} style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <div role="radiogroup" aria-label={`${name}'s account`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <button type="button" className="orbs-small" role="radio" aria-checked={mode === "paper"} data-account-paper disabled={busy} onClick={() => (setAsking(null), mode !== "paper" && void set("paper"))} style={chip(mode === "paper")}>Paper</button>
        <button type="button" className="orbs-small" role="radio" aria-checked={mode === "real"} data-account-real disabled={busy} onClick={() => setAsking("real")} style={chip(mode === "real")}>Real money</button>
      </div>
      {asking === "real" && (
        <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
          <input data-account-budget inputMode="decimal" aria-label={`${name}'s budget of real money, in dollars`} value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^0-9.]/g, ""))} size={1} style={{ ...field, flex: "1 1 auto" }} />
          <button type="button" data-account-set disabled={busy || !(amount >= 0)} onClick={() => void set("real", amount)} style={{ ...button, flex: "0 0 auto" }}>{mode === "real" ? "Set the budget" : "Use real money"}</button>
        </div>
      )}
      {asking === "paper" && (
        <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
          <input data-account-paper-amount inputMode="decimal" aria-label={`How much paper ${name} has, in dollars`} value={paper} onChange={(e) => setPaper(e.target.value.replace(/[^0-9.]/g, ""))} size={1} style={{ ...field, flex: "1 1 auto" }} />
          <button type="button" data-account-set-paper disabled={busy || !(Number(paper) >= 0)} onClick={() => void set(mode, undefined, Number(paper))} style={{ ...button, flex: "0 0 auto" }}>Set its paper</button>
        </div>
      )}
      <span data-account-words style={{ ...small, fontSize: 12 }}>
        {mode === "real"
          ? `Real money: ${usd(account?.cash ?? 0)} left of ${usd(account?.budget ?? 0)}. Each order ${name} places comes to you for a yes, then your wallet signs. ${name} is never told which.`
          : `Paper: ${usd(account?.paper ?? 10_000)} of practice money. ${name} is never told which, and trades it as it would real money.`}
      </span>
      {mode === "paper" && asking !== "paper" && (
        <button type="button" className="orbs-small" data-account-change-paper onClick={() => setAsking("paper")} style={{ justifySelf: "start", border: 0, background: "none", padding: 0, font: "600 12px/18px var(--font)", color: "var(--accent)", textDecoration: "underline", cursor: "pointer", whiteSpace: "nowrap" }}>{`Change ${name}'s paper`}</button>
      )}
      {said && <span role="alert" style={{ ...small, color: "var(--alert)" }}>{said}</span>}
    </div>
  );
}
