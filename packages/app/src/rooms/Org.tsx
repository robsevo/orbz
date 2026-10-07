// The org chart (PLAN 5.6): everyone in the office by the kind of work they do, the one who leads
// each kind first (its top-ranked orb; the first of a kind starts as its Senior, owner 10-02), the
// Chief above them all when there is one. A face is a press away from his career page.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Orb } from "../orb/Orb.tsx";
import { SPECIALTIES, type Character } from "../orb/spec.ts";
import { idOf, type OrgState, type Office } from "../home/link.ts";
import { Balanced } from "../ui/Balanced.tsx";
import { ReportCard, SchoolSheet } from "./School.tsx";

const small: CSSProperties = { font: "500 12px/16px var(--font)", color: "var(--text-3)", textWrap: "pretty" };

export function OrgRoom({ home, office, open, rehired, school = null }: { home: Office | null; office: Character[]; open: (c: Character) => void; rehired: () => void; school?: string | null }) {
  const [org, setOrg] = useState<OrgState | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  // whose school sheet is open (PLAN 5.7): the orb you let go to send to school, from its profile (owner, 10-06)
  const [sending, setSending] = useState<string | null>(school);
  useEffect(() => setSending(school), [school]);
  // that orb's place on the chart, in view once it is there (it arrives a moment after it is let go)
  const away = org?.away.some((o) => o.id === sending) ?? false;
  useEffect(() => {
    if (away && sending) document.querySelector(`[data-away="${CSS.escape(sending)}"]`)?.scrollIntoView({ block: "center" });
  }, [away, sending]);
  useEffect(() => {
    if (!home) return;
    const load = (): void => void home.org().then(setOrg, (e: Error) => setSaid(e.message));
    load();
    return home.watch({ event: (e) => void (/^(orb\.|promotion\.|school\.(enrolled|ended|graduated))/.test(e.type) && load()) }); // a hire, a let-go, a rehire, a promotion, school
  }, [home]);
  if (!home) return <p style={{ ...small, padding: "var(--s5)" }}>The org chart is the home's: open the app from your home to see it.</p>;
  if (!org) return <p style={{ ...small, padding: "var(--s5)" }}>{said ?? "Loading the office…"}</p>;
  const face = (id: string): Character | undefined => office.find((c) => idOf(c.name) === id);
  const kinds = [...new Set(org.orbs.map((o) => o.specialty))];
  const card = (id: string, lead: boolean): ReactNode => {
    const o = org.orbs.find((x) => x.id === id);
    const c = face(id);
    if (!o || !c) return null;
    return (
      <button key={id} data-org-orb={id} data-orb={c.hue} onClick={() => open(c)} aria-label={`${o.name}, ${o.level}${lead ? `, leads ${SPECIALTIES[o.specialty as keyof typeof SPECIALTIES]?.title ?? o.specialty} work` : ""}`}
        style={{ display: "grid", justifyItems: "center", gap: 2, padding: "10px 8px", border: 0, borderRadius: 14, cursor: "pointer", background: lead ? "var(--accent-fill)" : "var(--fill)", boxShadow: lead ? "inset 0 0 0 1.5px var(--accent)" : "none", minWidth: 0 }}>
        <Orb character={c} size={56} poke={false} still />
        <span style={{ font: "700 13px/18px var(--font)", color: "var(--text-1)" }}>{o.name}</span>
        <span style={small}>{lead ? `${o.level} · leads` : o.level}</span>
      </button>
    );
  };
  return (
    <div data-org style={{ display: "grid", gap: "var(--s5)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      <h2 style={{ margin: 0, font: "800 22px/28px var(--font)", color: "var(--text-1)" }}>The org chart</h2>
      {org.chief && (
        <section aria-label="Chief" style={{ display: "grid", justifyItems: "center", gap: 6 }}>
          <span style={{ font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" }}>Chief</span>
          {card(org.chief, true)}
        </section>
      )}
      {/* let go (PLAN 5.5): out of the office, still learning, a press from coming back */}
      {org.away.length > 0 && (
        <section aria-label="Away" style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <span style={{ font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" }}>Away</span>
          {org.away.map((o) => (
            <div key={o.id} data-away={o.id} style={{ display: "grid", gap: 8, padding: "8px 10px", borderRadius: 12, background: "var(--fill)", minWidth: 0 }}>
              {/* who, then what you can do: the two never wrap into one row with a button left alone under it */}
              <span style={{ minWidth: 0, display: "grid" }}>
                <span style={{ font: "600 13px/18px var(--font)", color: "var(--text-1)" }}>{`${o.name}, ${o.level}`}</span>
                {(o.atSchool || o.diplomas.length > 0) && <span style={small}>{[o.atSchool ? "At school" : null, ...o.diplomas.map((d) => `🎓 ${d}`)].filter(Boolean).join(" · ")}</span>}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                {!o.atSchool && (
                  <button type="button" aria-expanded={sending === o.id} onClick={() => setSending(sending === o.id ? null : o.id)} style={{ font: "600 12px/16px var(--font)", border: 0, borderRadius: 8, padding: "5px 10px", background: "var(--raised)", color: "var(--text-1)", cursor: "pointer", flex: "0 0 auto" }}>
                    {`Send ${o.name} to school`}
                  </button>
                )}
                <button type="button" onClick={() => void home.rehire(o.id).then(() => rehired(), (e: Error) => setSaid(e.message))} style={{ font: "600 12px/16px var(--font)", border: 0, borderRadius: 8, padding: "5px 10px", background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)", color: "var(--text-1)", cursor: "pointer", flex: "0 0 auto" }}>
                  Rehire {o.name}
                </button>
              </div>
              {sending === o.id && !o.atSchool && <SchoolSheet home={home} orb={o.id} name={o.name} sent={() => setSending(null)} />}
              <ReportCard home={home} orb={o.id} name={o.name} />
            </div>
          ))}
        </section>
      )}
      {kinds.map((k) => {
        const lead = org.leads[k];
        const rest = org.orbs.filter((o) => o.specialty === k && o.id !== lead && o.id !== org.chief).map((o) => o.id);
        return (
          <section key={k} data-kind={k} aria-label={SPECIALTIES[k as keyof typeof SPECIALTIES]?.title ?? k} style={{ display: "grid", gap: 8, minWidth: 0 }}>
            <span style={{ font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" }}>{SPECIALTIES[k as keyof typeof SPECIALTIES]?.title ?? k}</span>
            <Balanced min={120}>
              {[lead && lead !== org.chief ? card(lead, true) : null, ...rest.map((id) => card(id, false))].filter(Boolean)}
            </Balanced>
          </section>
        );
      })}
    </div>
  );
}
