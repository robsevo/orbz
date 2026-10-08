// The budget's choices (PLAN 5.20; owner, 10-08: "the user may not have any money to start with. so ask how much they
// are willing to spend on infrastructure etc."): nothing, a little, some, more, or amounts of your own. Asked in the
// first open, on the board's report until you have said, and in Settings, where it changes any time (owner, 10-08:
// "Lets be able to change the budget as well"). What each choice is lives in budget.ts.
import { useEffect, useState, type CSSProperties } from "react";
import { Balanced } from "./Balanced.tsx";
import { checkBudget, dollars, TIERS, tierOf, type Budget } from "./budget.ts";

const card = (on: boolean): CSSProperties => ({
  display: "grid", alignContent: "start", gap: 2, padding: "10px 12px", border: 0, borderRadius: 14, cursor: "pointer", textAlign: "left", minWidth: 0,
  background: on ? "var(--accent-fill)" : "var(--card)", boxShadow: on ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 1px var(--hairline)", color: "var(--text-1)", textWrap: "balance",
});
const label: CSSProperties = { font: "700 15px/20px var(--font)" };
const sub: CSSProperties = { font: "500 13px/18px var(--font)", color: "var(--text-2)" };
const field: CSSProperties = { width: "100%", minWidth: 0, font: "600 16px/22px var(--font)", color: "var(--text-1)", background: "var(--card)", border: 0, borderRadius: 10, padding: "7px 10px", outline: 0, boxShadow: "inset 0 0 0 1px var(--hairline)" };
const button: CSSProperties = { font: "700 14px/20px var(--font)", color: "var(--text-1)", background: "var(--accent-fill)", border: 0, borderRadius: 10, padding: "8px 14px", cursor: "pointer", boxShadow: "inset 0 0 0 1.5px var(--accent)", minHeight: 38 };

export function BudgetChoice({ value, onPick }: { value: Budget | null; onPick: (b: Budget) => void }) {
  const at = tierOf(value);
  const [own, setOwn] = useState(false); // the fields for your own amounts, open
  const [start, setStart] = useState(at === "own" ? String(value!.start) : "");
  const [month, setMonth] = useState(at === "own" ? String(value!.month) : "");
  const [why, setWhy] = useState("");
  useEffect(() => {
    // the home's answer can come after the choices are drawn: your own amounts, in their fields
    if (at === "own") {
      setStart(String(value!.start));
      setMonth(String(value!.month));
    }
  }, [value?.start, value?.month]);
  const keep = (): void => {
    const r = checkBudget(start, month);
    if (!r.ok) {
      setWhy(r.why);
      return;
    }
    setWhy("");
    onPick(r.budget);
  };
  return (
    <div data-budget={at ?? "unsaid"} style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <Balanced min={140} gap={8}>
        {TIERS.map((t) => (
          <button key={t.id} type="button" data-budget-tier={t.id} data-sound="pick" aria-pressed={at === t.id} onClick={() => (setOwn(false), setWhy(""), onPick(t.budget))} style={card(at === t.id)}>
            <span style={label}>{t.label}</span>
            {/* each amount a line of its own, so neither breaks a word off alone */}
            {t.id === "nothing" ? (
              <span style={sub}>Free tools only</span>
            ) : (
              <>
                <span style={sub}>{`${dollars(t.budget.start)} to start`}</span>
                <span style={sub}>{`${dollars(t.budget.month)} a month`}</span>
              </>
            )}
          </button>
        ))}
      </Balanced>
      <button type="button" data-budget-own aria-pressed={at === "own"} aria-expanded={own} onClick={() => setOwn(!own)}
        style={{ ...card(at === "own"), justifySelf: "start", alignContent: "center", padding: "7px 12px", font: "700 14px/20px var(--font)" }}>
        {at === "own" && !own ? `Your own: ${dollars(value!.start)} to start, ${dollars(value!.month)} a month` : "Your own amounts"}
      </button>
      {own && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            keep();
          }}
          style={{ display: "grid", gap: 8, minWidth: 0 }}
        >
          {/* the two amounts side by side, Keep under them: never a button alone on a row of fields */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 8 }}>
            <label style={{ display: "grid", gap: 4, minWidth: 0 }}>
              <span style={sub}>To start</span>
              <input value={start} onChange={(e) => setStart(e.target.value)} aria-label="To start, in dollars" inputMode="numeric" placeholder="$0" size={1} style={field} />
            </label>
            <label style={{ display: "grid", gap: 4, minWidth: 0 }}>
              <span style={sub}>Each month</span>
              <input value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Each month, in dollars" inputMode="numeric" placeholder="$0" size={1} style={field} />
            </label>
          </div>
          <div>
            <button type="submit" data-sound="pick" style={button}>Keep</button>
          </div>
        </form>
      )}
      {why && <span role="alert" style={{ font: "500 13px/18px var(--font)", color: "var(--alert)" }}>{why}</span>}
    </div>
  );
}
