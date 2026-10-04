// The lab (PLAN 2.13; owner, 10-01: "a brainstorming lab, like in an office where we keep our
// brainstorms and plans"). Every brainstorm (what was agreed, who was in it, where it was left)
// and every plan an orb showed you (its rows, how far along), newest first; a search for a word in
// any of it. A brainstorm opens where it was, or is reopened as a new session that knows it.
import { useEffect, useState, type CSSProperties } from "react";
import { Orb } from "../orb/Orb.tsx";
import type { Character } from "../orb/spec.ts";
import { Balanced } from "../ui/Balanced.tsx";
import { idOf, type LabPlan, type LabSession, type Office } from "../home/link.ts";
import type { Route } from "../ui/nav.ts";

const button: CSSProperties = { font: "600 13px/18px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "6px 12px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 32 };
const BOX: Record<LabPlan["rows"][number]["box"], string> = { "[ ]": "○", "[~]": "◐", "[x]": "●" };
const STATUS: Record<string, string> = { submitted: "Waiting for your answer", approved: "Approved", changed: "Sent back", saved: "Saved for later", declined: "Declined" };
const CHANGES = /^(plan\.|board\.|session\.)/;
const when = (t: number): string => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function LabRoom(o: { home: Office | null; office: Character[]; go: (r: Route) => void }) {
  const [q, setQ] = useState("");
  const [lab, setLab] = useState<{ sessions: LabSession[]; plans: LabPlan[] } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const load = (): void => {
    if (o.home) o.home.labOf(q).then(setLab, (e: Error) => setSaid(e.message));
  };
  useEffect(() => {
    const t = setTimeout(load, q ? 200 : 0); // a word typed, then looked for
    return () => clearTimeout(t);
  }, [o.home, q]);
  useEffect(() => {
    if (!o.home) return;
    return o.home.watch({ event: (e) => CHANGES.test(e.type) && load() });
  }, [o.home, q]);
  if (!o.home) {
    return (
      <div style={{ display: "grid", placeItems: "center", alignContent: "center", gap: "var(--s3)", padding: "var(--s7) var(--s5)", textAlign: "center" }}>
        <span style={{ font: "700 20px/26px var(--font)", color: "var(--text-1)" }}>The lab lives on your home</span>
        <span style={{ font: "400 15px/21px var(--font)", color: "var(--text-3)", maxWidth: 440 }}>Every brainstorm and every plan your orbs showed you is kept there. Start it (pnpm start) and open the link it prints.</span>
      </div>
    );
  }
  const home = o.home;
  const orbOf = (id: string): Character | undefined => o.office.find((c) => idOf(c.name) === id);
  const reopen = (id: number): void => {
    home.reopen(id).then((s) => o.go({ room: "sessions", id: s.id, tab: "brainstorm" }), (e: Error) => setSaid(e.message));
  };
  const empty = lab && !lab.sessions.length && !lab.plans.length;
  return (
    <div style={{ display: "grid", gap: "var(--s5)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      <h2 style={{ margin: 0, font: "800 28px/34px var(--font)", color: "var(--text-1)" }}>The lab</h2>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Look for a word in the lab" placeholder="A word: party, budget, invoices…" size={1} style={{ font: "500 15px/22px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 12, padding: "10px 14px", outline: 0, boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0 }} />
      {said && <span role="alert" style={{ color: "var(--alert)" }}>{said}</span>}
      {empty && <span style={{ font: "400 14px/20px var(--font)", color: "var(--text-3)" }}>{q ? `Nothing with "${q}" in it.` : "Nothing yet: a session's brainstorm and the plans your orbs show you are kept here."}</span>}
      {lab && lab.sessions.length > 0 && (
        <section aria-label="Brainstorms" style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <span style={{ font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" }}>Brainstorms</span>
          <Balanced min={300} gap={10}>
            {lab.sessions.map((s) => (
              <article key={s.id} data-brainstorm={s.id} style={{ display: "grid", gap: 8, alignContent: "start", padding: "var(--s4)", borderRadius: 16, background: "var(--card)", boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0 }}>
                <span style={{ display: "grid", minWidth: 0 }}>
                  <span style={{ font: "800 16px/22px var(--font)", color: "var(--text-1)", overflowWrap: "anywhere", textWrap: "balance" }}>{s.title}</span>
                  <span style={{ font: "400 12px/16px var(--font)", color: "var(--text-3)" }}>{when(s.createdAt)}</span>
                </span>
                <span style={{ display: "flex", gap: 2 }}>
                  {s.members.map((m) => orbOf(m)).filter((c): c is Character => Boolean(c)).slice(0, 6).map((c) => (
                    <Orb key={c.name} character={c} size={30} poke={false} still />
                  ))}
                </span>
                {s.agreed.length > 0 && (
                  <span style={{ display: "grid", gap: 2 }}>
                    {s.agreed.map((a, i) => (
                      <span key={i} style={{ font: "600 13px/18px var(--font)", color: "var(--text-1)", overflowWrap: "anywhere" }}>✓ {a}</span>
                    ))}
                  </span>
                )}
                {s.lastWords && <span style={{ font: "400 12px/17px var(--font)", color: "var(--text-3)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{s.lastWords}</span>}
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={() => o.go({ room: "sessions", id: s.id, tab: "brainstorm" })} style={button}>
                    Open
                  </button>
                  <button onClick={() => reopen(s.id)} style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}>
                    Reopen
                  </button>
                </span>
              </article>
            ))}
          </Balanced>
        </section>
      )}
      {lab && lab.plans.length > 0 && (
        <section aria-label="Plans" style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <span style={{ font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" }}>Plans</span>
          <Balanced min={300} gap={10}>
            {lab.plans.map((p) => {
              const c = orbOf(p.orb);
              const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
              return (
                <article key={p.id} data-plan={p.id} data-orb={c?.hue} style={{ display: "grid", gap: 8, alignContent: "start", padding: "var(--s4)", borderRadius: 16, background: "var(--card)", boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    {c && <Orb character={c} size={30} poke={false} still />}
                    <span style={{ display: "grid", minWidth: 0 }}>
                      <span style={{ font: "800 16px/22px var(--font)", color: "var(--text-1)", overflowWrap: "anywhere", textWrap: "balance" }}>{p.title}</span>
                      <span style={{ font: "400 12px/16px var(--font)", color: "var(--text-3)" }}>{[c?.name ?? p.orb, STATUS[p.status] ?? p.status, when(p.createdAt)].join(" · ")}</span>
                    </span>
                  </span>
                  <span data-progress={`${p.done}/${p.total}`} style={{ display: "grid", gap: 4 }}>
                    <span style={{ font: "600 12px/16px var(--font)", color: "var(--text-2)" }}>{p.done} of {p.total} done</span>
                    <span style={{ height: 8, borderRadius: 4, background: "var(--fill)", overflow: "hidden" }}>
                      <i style={{ display: "block", height: "100%", width: `${pct}%`, background: "var(--accent)", borderRadius: 4 }} />
                    </span>
                  </span>
                  <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
                    {p.rows.filter((r) => !r.test).map((r) => (
                      <li key={r.id} data-row={r.id} style={{ display: "grid", gridTemplateColumns: "auto auto minmax(0, 1fr)", gap: 6, font: "500 13px/18px var(--font)", color: "var(--text-1)" }}>
                        <span aria-label={r.box === "[x]" ? "done" : r.box === "[~]" ? "under way" : "to do"} style={{ color: "var(--accent)" }}>{BOX[r.box]}</span>
                        <span style={{ color: "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>{r.id}</span>
                        <span style={{ overflowWrap: "anywhere" }} title={r.description}>{r.feature}</span>
                      </li>
                    ))}
                  </ol>
                  {p.session !== null && (
                    <button onClick={() => o.go({ room: "sessions", id: p.session!, tab: "floor" })} style={{ ...button, justifySelf: "start" }}>
                      Open its session
                    </button>
                  )}
                </article>
              );
            })}
          </Balanced>
        </section>
      )}
    </div>
  );
}
