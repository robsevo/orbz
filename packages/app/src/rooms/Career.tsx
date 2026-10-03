// An orb's career page (PLAN 5.6), all of it read off the home's log: his level and the XP to the
// next, his age and days in the company (owner 10-02), the radar of what he does (the house chart),
// the words his work leans on, the habits he shipped (and any passed to him), the reviews he gave
// and asked for, and his last weekly performance card. Promote and Not yet when he is ready: only
// you promote.
import { useEffect, useState, type CSSProperties } from "react";
import { Orb } from "../orb/Orb.tsx";
import { SPECIALTIES, type Character } from "../orb/spec.ts";
import { idOf, type CareerState, type Office } from "../home/link.ts";
import { span } from "../orb/age.ts";
import { Radar } from "../ui/Radar.tsx";

const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" };
const small: CSSProperties = { font: "500 13px/18px var(--font)", color: "var(--text-3)", textWrap: "pretty", overflowWrap: "anywhere" };
const button: CSSProperties = { font: "600 13px/18px var(--font)", border: 0, borderRadius: 10, padding: "8px 12px", background: "var(--fill)", color: "var(--text-1)", cursor: "pointer", minHeight: 34 };
const SUGGEST: Record<string, string> = { promote: "Promote him", keep: "Keep going", retrain: "Some practice", "let go": "Give him work, or let him go" };

export function CareerRoom({ home, orb }: { home: Office | null; orb: Character }) {
  const [c, setC] = useState<CareerState | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    if (!home) return;
    const load = (): void => void home.career(orb).then(setC, (e: Error) => setSaid(e.message));
    load();
    return home.watch({ event: (e) => void (e.orb === idOf(orb.name) && /^(xp\.|orb\.|promotion\.|habit\.|performance\.|board\.)/.test(e.type) && load()) });
  }, [home, orb.name]);
  if (!home) return <p style={{ ...small, padding: "var(--s5)" }}>His career is the home's: open the app from your home to see it.</p>;
  if (!c) return <p style={{ ...small, padding: "var(--s5)" }}>{said ?? "Loading…"}</p>;
  const areas = Object.entries(c.radar);
  const top = Math.max(1, ...areas.map(([, a]) => a.xp));
  const toNext = c.next ? Math.min(1, c.next.evidence.xp.has / Math.max(1, c.next.evidence.xp.needs)) : 1;
  return (
    <div data-career={idOf(orb.name)} data-orb={orb.hue} style={{ display: "grid", gap: "var(--s5)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      <header style={{ display: "flex", gap: "var(--s4)", alignItems: "center", minWidth: 0 }}>
        <Orb character={orb} size={88} poke={false} framing="portrait" />
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <h2 style={{ margin: 0, font: "800 24px/30px var(--font)", color: "var(--accent)" }}>{orb.name}</h2>
          <span style={{ font: "600 15px/20px var(--font)", color: "var(--text-1)" }}>{`${c.level} ${SPECIALTIES[orb.specialty].title}`}</span>
          <span data-tenure style={small}>{`Age ${span(c.born, c.now)} · ${c.left === null ? `${span(c.hired, c.now)} in the company` : `${span(c.hired, c.left)} in the company, then let go`}`}</span>
        </div>
      </header>
      <section aria-label="Level" style={{ display: "grid", gap: 6 }}>
        <span style={head}>{c.next ? `Toward ${c.next.to}` : "At the top"}</span>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(toNext * 100)} style={{ height: 8, borderRadius: 4, background: "var(--fill-2)", overflow: "hidden" }}>
          <i style={{ display: "block", height: "100%", width: `${toNext * 100}%`, background: "var(--accent)" }} />
        </div>
        <span style={small}>{c.next ? `${c.xp.toLocaleString("en-GB")} XP · ${c.next.ready ? `ready for ${c.next.to}` : c.next.missing.join("; ")}` : `${c.xp.toLocaleString("en-GB")} XP`}</span>
        {c.next?.ready && (
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => void home.promote(orb, c.next!.to).catch((e: Error) => setSaid(e.message))} style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}>Promote</button>
            <button type="button" onClick={() => void home.notYet(orb, c.next!.to).catch((e: Error) => setSaid(e.message))} style={button}>Not yet</button>
          </div>
        )}
      </section>
      <section aria-label="What he does" style={{ display: "grid", gap: 6 }}>
        <span style={head}>What he does</span>
        <Radar items={areas.map(([name, a]) => ({ name, value: Math.round((a.xp / top) * 5) }))} />
        {areas.every(([, a]) => a.xp === 0) && <span style={small}>Nothing yet: finished work you approve fills this in, by the kind of work it was.</span>}
      </section>
      {c.niches.length > 0 && (
        <section aria-label="His niches" style={{ display: "grid", gap: 6 }}>
          <span style={head}>His work leans on</span>
          <span style={small}>{c.niches.map((n) => n.word).join(" · ")}</span>
        </section>
      )}
      <section aria-label="Habits" style={{ display: "grid", gap: 4 }}>
        <span style={head}>Habits</span>
        {c.habits.length ? c.habits.map((h) => (
          <span key={h.task} style={small}>{`${h.task.split("|").slice(1).join(" ")} (v${h.version})${h.shared ? `, from ${h.shared.from}` : ""}`}</span>
        )) : <span style={small}>None yet: the gym writes one from work you approve, night by night.</span>}
      </section>
      <section aria-label="Reviews" style={{ display: "grid", gap: 4 }}>
        <span style={head}>Reviews</span>
        <span style={small}>{`${c.reviews.given} given · ${c.reviews.received} asked of others`}</span>
      </section>
      {c.performance && (
        <section aria-label="This week" style={{ display: "grid", gap: 4 }}>
          <span style={head}>{`This week: ${SUGGEST[c.performance.suggest] ?? c.performance.suggest}`}</span>
          <span style={small}>{c.performance.why}</span>
        </section>
      )}
      {said && <span role="status" style={small}>{said}</span>}
    </div>
  );
}
