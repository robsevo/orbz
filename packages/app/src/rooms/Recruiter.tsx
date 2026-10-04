// The recruiter (PLAN 5.8; owner, 10-03: "recruiter section should show us random new orbs who have
// applied to our company for positions we are looking for which we tick off in that section"): tick
// the positions you are hiring for, and each day a few new orbs apply for each, made by the
// creator's dice from the home's seeds (the same orbs on every device). Interview one if you like
// ("add the interview part for fun"): the brain answers as the applicant, who can only talk. Hire
// brings the orb in as it applied, the interview its first chat; Pass sends it on. Orbs you let go
// apply again for their old kind of work, with their record, the most qualified first.
import { useEffect, useState, type CSSProperties } from "react";
import { Orb } from "../orb/Orb.tsx";
import { applicant, applicationNote, FAMILIES, SPECIALTIES, type Character, type Family } from "../orb/spec.ts";
import { idOf, type InterviewLine, type Office, type RecruiterState } from "../home/link.ts";
import { span } from "../orb/age.ts";
import { Balanced } from "../ui/Balanced.tsx";

const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" };
const small: CSSProperties = { font: "500 13px/18px var(--font)", color: "var(--text-3)", textWrap: "pretty", overflowWrap: "anywhere" };
const button: CSSProperties = { font: "600 13px/18px var(--font)", border: 0, borderRadius: 10, padding: "6px 12px", background: "var(--fill)", color: "var(--text-1)", cursor: "pointer", minHeight: 32 };
const strong: CSSProperties = { ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" };

type Kind = keyof typeof SPECIALTIES;

export function RecruiterRoom({ home, office, hired }: { home: Office | null; office: Character[]; hired: () => void }) {
  const [state, setState] = useState<RecruiterState | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null); // whose interview is open
  useEffect(() => {
    if (!home) return;
    const load = (): void => void home.recruiting().then(setState, (e: Error) => setSaid(e.message));
    load();
    return home.watch({ event: (e) => void (/^(position\.|applicant\.|orb\.)/.test(e.type) && load()) });
  }, [home]);
  if (!home) return <p style={{ ...small, padding: "var(--s5)" }}>The recruiter is the home's: open the app from your home to see who applied.</p>;
  if (!state) return <p style={{ ...small, padding: "var(--s5)" }}>{said ?? "Loading…"}</p>;
  const taken = (name: string): boolean => [...office.map((c) => c.name), ...state.returning.map((r) => r.name)].some((n) => n.toLowerCase() === name.toLowerCase());
  const tick = (k: Kind): void => void home.setPosition(k, !state.positions.includes(k)).then((positions) => setState({ ...state, positions }), (e: Error) => setSaid(e.message));
  const families = Object.keys(FAMILIES) as Family[];
  return (
    <div data-recruiter style={{ display: "grid", gap: "var(--s5)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      <h2 style={{ margin: 0, font: "800 22px/28px var(--font)", color: "var(--text-1)" }}>Recruiter</h2>
      <section aria-label="Positions" style={{ display: "grid", gap: 10, minWidth: 0 }}>
        <span style={head}>Positions you are hiring for</span>
        {families.map((f) => (
          <div key={f} role="group" aria-label={FAMILIES[f]} style={{ minWidth: 0 }}>
            {/* a balanced grid: never one position alone on a row */}
            <Balanced min={150} gap={6}>
              {(Object.keys(SPECIALTIES) as Kind[]).filter((k) => SPECIALTIES[k].family === f).map((k) => {
                const on = state.positions.includes(k);
                return (
                  <button key={k} type="button" aria-pressed={on} data-position={k} onClick={() => tick(k)} style={{ ...(on ? strong : button), minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {on ? "✓ " : ""}{SPECIALTIES[k].title}
                  </button>
                );
              })}
            </Balanced>
          </div>
        ))}
      </section>
      {state.returning.length > 0 && (
        <section aria-label="Applied again" style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <span style={head}>Applied again</span>
          {state.returning.map((r) => (
            <div key={r.id} data-returning={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 12, background: "var(--fill)", minWidth: 0 }}>
              <span style={{ flex: "1 1 auto", minWidth: 0, display: "grid" }}>
                <span style={{ font: "700 14px/19px var(--font)", color: "var(--text-1)" }}>{`${r.name}, ${r.level} ${SPECIALTIES[r.specialty as Kind]?.title ?? r.specialty}`}</span>
                <span style={small}>{[`${r.xp.toLocaleString("en-GB")} XP`, `${span(r.hired, r.left ?? r.now)} in the company before`, ...r.diplomas.map((d) => `🎓 ${d}`)].join(" · ")}</span>
              </span>
              <button type="button" onClick={() => void home.rehire(r.id).then(hired, (e: Error) => setSaid(e.message))} style={{ ...strong, flex: "0 0 auto" }}>
                {`Rehire ${r.name}`}
              </button>
            </div>
          ))}
        </section>
      )}
      {state.positions.map((k) => {
        const who = state.applicants.filter((a) => a.specialty === k);
        return (
          <section key={k} data-applying={k} aria-label={`Applying: ${SPECIALTIES[k as Kind]?.title ?? k}`} style={{ display: "grid", gap: 10, minWidth: 0 }}>
            <span style={head}>{`Applying: ${SPECIALTIES[k as Kind]?.title ?? k}`}</span>
            {!who.length && <span style={small}>No one yet: new applicants come each day.</span>}
            {who.map((a) => {
              const c = applicant(a.seed, k as Kind, taken);
              return (
                <article key={a.id} data-applicant={a.id} data-orb={c.hue} style={{ display: "grid", gap: 8, padding: "var(--s3)", borderRadius: 16, background: "var(--card)", boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
                    <Orb character={c} size={64} poke={false} still />
                    <span style={{ display: "grid", minWidth: 0 }}>
                      <span style={{ font: "800 16px/22px var(--font)", color: "var(--accent)" }}>{c.name}</span>
                      <span style={small}>{`${SPECIALTIES[c.specialty].title} · would start as ${a.startsAs === "Senior" ? "the Senior" : "a Junior"}`}</span>
                    </span>
                  </div>
                  <span style={{ font: "400 14px/20px var(--font)", color: "var(--text-2)", textWrap: "pretty", overflowWrap: "anywhere" }}>{applicationNote(c)}</span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)} style={button}>{`Interview ${c.name}`}</button>
                    <button type="button" data-sound="pick" onClick={() => void home.hireApplicant(a.id, c).then(hired, (e: Error) => setSaid(e.message))} style={strong}>{`Hire ${c.name}`}</button>
                    <button type="button" onClick={() => void home.passApplicant(a.id).catch((e: Error) => setSaid(e.message))} style={button}>Pass</button>
                  </div>
                  {open === a.id && <Interview home={home} id={a.id} c={c} />}
                </article>
              );
            })}
          </section>
        );
      })}
      {said && <span role="status" style={small}>{said}</span>}
    </div>
  );
}

/** An interview: your questions, and the applicant's answers in the applicant's own manner. */
function Interview({ home, id, c }: { home: Office; id: number; c: Character }) {
  const [lines, setLines] = useState<InterviewLine[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    void home.interviewOf(id).then(setLines, () => {});
  }, [id]);
  const ask = (): void => {
    const q = draft.trim();
    if (!q || busy) return;
    setDraft("");
    setBusy(true);
    setLines((l) => [...l, { role: "you", text: q, at: Date.now() }]);
    home.interview(id, c, q).then(
      (answer) => setLines((l) => [...l, { role: "orb", text: answer, at: Date.now() }]),
      (e: Error) => setSaid(e.message),
    ).finally(() => setBusy(false));
  };
  return (
    <div role="group" aria-label={`Interviewing ${c.name}`} data-interview={idOf(c.name)} style={{ display: "grid", gap: 6, padding: "var(--s3)", borderRadius: 12, background: "var(--fill)", minWidth: 0 }}>
      {lines.map((l, i) => (
        <span key={i} data-from={l.role === "you" ? "you" : "applicant"} style={{ font: "400 14px/20px var(--font)", color: l.role === "you" ? "var(--text-1)" : "var(--accent)", overflowWrap: "anywhere", textWrap: "pretty" }}>
          <b>{l.role === "you" ? "You" : c.name}:</b> {l.text}
        </span>
      ))}
      {busy && <span style={small}>{`${c.name} is thinking…`}</span>}
      <form onSubmit={(e) => { e.preventDefault(); ask(); }} style={{ display: "flex", gap: 6, minWidth: 0 }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`A question for ${c.name}`} placeholder={`Ask ${c.name} something`} size={1}
          style={{ flex: "1 1 auto", minWidth: 0, font: "400 14px/20px var(--font)", color: "var(--text-1)", background: "var(--raised)", border: 0, borderRadius: 8, padding: "6px 10px" }} />
        <button type="submit" disabled={busy || !draft.trim()} style={button}>Ask</button>
      </form>
      {said && <span role="status" style={small}>{said}</span>}
    </div>
  );
}
