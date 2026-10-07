// The recruiter (PLAN 5.8; owner, 10-03: "recruiter section should show us random new orbs who have
// applied to our company for positions we are looking for which we tick off in that section"): tick
// the positions you are hiring for, and each day a few new orbs apply for each, made by the
// creator's dice from the home's seeds (the same orbs on every device). Interview one if you like
// ("add the interview part for fun"): the brain answers as the applicant, who can only talk. Hire
// brings the orb in as it applied, the interview its first chat; Pass sends it on. Orbs you let go
// apply again for their old kind of work, with their record, the most qualified first.
// Each applicant's profile opens from its card (owner, 10-05: "recruiter should also be able to show the orbs
// profile when we click on it, and which ones would best suit our team by rank"), and every applicant is
// ranked by how well it would suit the office as it is (orb/fit.ts, by code), the best first.
// A department's applicants have an address of their own (owner, 10-06: the floor's Hiring tags "should
// bring us to those who can build and think"): #/recruiter/build opens on who applied to Build, ranked
// among themselves, with All and the other departments you are hiring in one press away.
// The positions in their departments, each named, and All (owner, 10-07: "an all filter so if were looking for
// all positions, we can see everything instead of clicking, and also give them groups"): show one department's
// positions or all of them, and tick every one shown in one press (one request to the home, not one each).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Orb } from "../orb/Orb.tsx";
import { applicant, applicationNote, FAMILIES, SPECIALTIES, type Character, type Family } from "../orb/spec.ts";
import { idOf, type InterviewLine, type Office, type RecruiterState } from "../home/link.ts";
import { span } from "../orb/age.ts";
import { Balanced } from "../ui/Balanced.tsx";
import { fitOf, ranked, type Fit } from "../orb/fit.ts";

const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" };
const small: CSSProperties = { font: "500 13px/18px var(--font)", color: "var(--text-3)", textWrap: "pretty", overflowWrap: "anywhere" };
const button: CSSProperties = { font: "600 13px/18px var(--font)", border: 0, borderRadius: 10, padding: "6px 12px", background: "var(--fill)", color: "var(--text-1)", cursor: "pointer", minHeight: 32 };
const fits: CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const strong: CSSProperties = { ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" };

type Kind = keyof typeof SPECIALTIES;

type Starts = "Senior" | "Junior";
const startsOf = (s: string): Starts => (s === "Senior" ? "Senior" : "Junior");

export function RecruiterRoom({ home, office, family, pick, hired, profile }: { home: Office | null; office: Character[]; family: string | null; pick: (family: Family | null) => void; hired: () => void; profile: (c: Character, startsAs: Starts) => ReactNode }) {
  const [state, setState] = useState<RecruiterState | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null); // whose interview is open
  const [seeing, setSeeing] = useState<number | null>(null); // whose profile is open
  const [group, setGroup] = useState<Family | null>(null); // the positions shown: one department's, or all
  const applying = useRef<HTMLElement>(null);
  const dept = family && family in FAMILIES ? (family as Family) : null; // the department shown, or all
  useEffect(() => {
    if (!home) return;
    const load = (): void => void home.recruiting().then(setState, (e: Error) => setSaid(e.message));
    load();
    return home.watch({ event: (e) => void (/^(position\.|applicant\.|orb\.)/.test(e.type) && load()) });
  }, [home]);
  // arriving at a department (from the floor's Hiring tag), its applicants come into view, past the positions
  const loaded = state !== null;
  useEffect(() => {
    if (!dept || !loaded) return;
    // two frames on, once the grids above have measured themselves and stopped moving it
    let id = requestAnimationFrame(() => (id = requestAnimationFrame(() => applying.current?.scrollIntoView({ block: "start" }))));
    return () => cancelAnimationFrame(id);
  }, [dept, loaded]);
  if (!home) return <p style={{ ...small, padding: "var(--s5)" }}>The recruiter is the home's: open the app from your home to see who applied.</p>;
  if (!state) return <p style={{ ...small, padding: "var(--s5)" }}>{said ?? "Loading…"}</p>;
  const taken = (name: string): boolean => [...office.map((c) => c.name), ...state.returning.map((r) => r.name)].some((n) => n.toLowerCase() === name.toLowerCase());
  const tick = (k: Kind): void => void home.setPosition(k, !state.positions.includes(k)).then((positions) => setState({ ...state, positions }), (e: Error) => setSaid(e.message));
  const families = Object.keys(FAMILIES) as Family[];
  const familyOf = (k: string): Family | undefined => SPECIALTIES[k as Kind]?.family;
  const inDept = (k: string): boolean => !dept || familyOf(k) === dept;
  const hiringIn = families.filter((f) => state.positions.some((k) => familyOf(k) === f)); // the departments you are hiring in
  const shownKinds = (Object.keys(SPECIALTIES) as Kind[]).filter((k) => !group || SPECIALTIES[k].family === group);
  const allShown = shownKinds.every((k) => state.positions.includes(k));
  const tickShown = (): void => void home.setPositions(shownKinds, !allShown).then((positions) => setState({ ...state, positions }), (e: Error) => setSaid(e.message));
  // everyone applying for a position you are hiring for (in the department shown), ranked by how well each would suit the office
  const order = ranked(
    state.applicants.filter((a) => state.positions.includes(a.specialty) && inDept(a.specialty)).map((a) => ({ a, c: applicant(a.seed, a.specialty as Kind, taken) })),
    (x) => fitOf(x.c, office, x.a.startsAs),
  );
  const placed = new Map(order.map((r) => [r.item.a.id, r]));
  const hire = (id: number, c: Character): void => void home.hireApplicant(id, c).then(hired, (e: Error) => setSaid(e.message));
  const pass = (id: number): void => void home.passApplicant(id).catch((e: Error) => setSaid(e.message));
  const shown = seeing === null ? undefined : placed.get(seeing);
  return (
    <div data-recruiter style={{ display: "grid", gap: "var(--s5)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      <h2 style={{ margin: 0, font: "800 22px/28px var(--font)", color: "var(--text-1)" }}>Recruiter</h2>
      <section aria-label="Positions" style={{ display: "grid", gap: 10, minWidth: 0 }}>
        <span style={head}>Positions you are hiring for</span>
        {/* which department's positions are shown, or all of them (a balanced grid: never one alone on a row) */}
        <Balanced min={96} gap={6}>
          {[null, ...families].map((f) => (
            <button key={f ?? "all"} type="button" aria-pressed={group === f} data-position-filter={f ?? "all"} onClick={() => setGroup(f)} style={{ ...(group === f ? strong : button), ...fits }}>
              {f ? FAMILIES[f] : "All"}
            </button>
          ))}
        </Balanced>
        {/* every position shown, ticked (or unticked) in one press */}
        <button type="button" aria-pressed={allShown} data-tick-shown onClick={tickShown} style={{ ...(allShown ? strong : button), ...fits, justifySelf: "start", maxWidth: "100%" }}>
          {`${allShown ? "✓ " : ""}${group ? `All of ${FAMILIES[group]}` : "All positions"}`}
        </button>
        {(group ? [group] : families).map((f) => {
          const kinds = shownKinds.filter((k) => SPECIALTIES[k].family === f);
          const ticked = kinds.filter((k) => state.positions.includes(k)).length;
          return (
            <div key={f} role="group" aria-label={FAMILIES[f]} data-position-group={f} style={{ display: "grid", gap: 6, minWidth: 0 }}>
              <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                <b style={{ font: "800 14px/20px var(--font)", color: "var(--text-1)" }}>{FAMILIES[f]}</b>
                <span style={{ ...small, whiteSpace: "nowrap" }}>{`${ticked} of ${kinds.length}`}</span>
              </span>
              {/* a balanced grid: never one position alone on a row */}
              <Balanced min={150} gap={6}>
                {kinds.map((k) => {
                  const on = state.positions.includes(k);
                  return (
                    <button key={k} type="button" aria-pressed={on} data-position={k} onClick={() => tick(k)} style={{ ...(on ? strong : button), minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {on ? "✓ " : ""}{SPECIALTIES[k].title}
                    </button>
                  );
                })}
              </Balanced>
            </div>
          );
        })}
      </section>
      {(hiringIn.length > 0 || dept) && (
        <section ref={applying} data-applicants-of={dept ?? "all"} aria-label="Who applied" style={{ display: "grid", gap: 8, minWidth: 0, scrollMarginTop: "var(--s5)" }}>
          <span style={head}>{dept ? `Who applied: ${FAMILIES[dept]}` : "Who applied"}</span>
          {/* a balanced grid: never one department alone on a row */}
          <Balanced min={110} gap={6}>
            {[null, ...hiringIn].map((f) => (
              <button key={f ?? "all"} type="button" aria-pressed={dept === f} data-department={f ?? "all"} onClick={() => pick(f)} style={{ ...(dept === f ? strong : button), ...fits }}>
                {f ? FAMILIES[f] : "All"}
              </button>
            ))}
          </Balanced>
          {dept && !hiringIn.includes(dept) && <span style={small}>{`You are not hiring in ${FAMILIES[dept]} now: tick a position above.`}</span>}
        </section>
      )}
      {order.length > 1 && (
        <section data-best aria-label="Best for your team" style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <span style={head}>Best for your team</span>
          {order.slice(0, 5).map(({ item: { a, c }, fit, rank }) => (
            <button key={a.id} type="button" data-ranked={rank} data-orb={c.hue} onClick={() => setSeeing(a.id)} aria-label={`#${rank}: ${c.name}, ${SPECIALTIES[c.specialty].title}, fit ${fit.score}. See the profile`}
              style={{ ...button, display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 12, textAlign: "left", minWidth: 0 }}>
              <span className="num" style={{ ...rankChip(rank), flex: "0 0 auto" }}>{`#${rank}`}</span>
              <Orb character={c} size={36} poke={false} still />
              <span style={{ flex: "1 1 auto", minWidth: 0, display: "grid" }}>
                <span style={{ font: "700 14px/19px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{`${c.name} · ${SPECIALTIES[c.specialty].title}`}</span>
                <span style={{ ...small, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cap(fit.why[0] ?? "")}</span>
              </span>
              <span className="num" style={{ flex: "0 0 auto", font: "700 13px/18px var(--font)", color: "var(--accent)", whiteSpace: "nowrap" }}>{`Fit ${fit.score}`}</span>
            </button>
          ))}
        </section>
      )}
      {state.returning.some((r) => inDept(r.specialty)) && (
        <section aria-label="Applied again" style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <span style={head}>Applied again</span>
          {state.returning.filter((r) => inDept(r.specialty)).map((r) => (
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
      {state.positions.filter(inDept).map((k) => {
        const who = state.applicants.filter((a) => a.specialty === k).sort((x, y) => (placed.get(x.id)?.rank ?? 0) - (placed.get(y.id)?.rank ?? 0));
        return (
          <section key={k} data-applying={k} aria-label={`Applying: ${SPECIALTIES[k as Kind]?.title ?? k}`} style={{ display: "grid", gap: 10, minWidth: 0 }}>
            <span style={head}>{`Applying: ${SPECIALTIES[k as Kind]?.title ?? k}`}</span>
            {!who.length && <span style={small}>No one yet: new applicants come each day.</span>}
            {who.map((a) => {
              const c = applicant(a.seed, k as Kind, taken);
              const r = placed.get(a.id);
              return (
                <article key={a.id} data-applicant={a.id} data-orb={c.hue} style={{ display: "grid", gap: 8, padding: "var(--s3)", borderRadius: 16, background: "var(--card)", boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0 }}>
                  {/* the orb and its name open its profile */}
                  <button type="button" data-profile-open={a.id} onClick={() => setSeeing(a.id)} aria-label={`See ${c.name}'s profile`}
                    style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0, padding: 0, border: 0, background: "transparent", textAlign: "left", cursor: "pointer", color: "inherit" }}>
                    <Orb character={c} size={64} poke={false} still />
                    <span style={{ display: "grid", minWidth: 0, flex: "1 1 auto" }}>
                      <span style={{ font: "800 16px/22px var(--font)", color: "var(--accent)" }}>{c.name}</span>
                      <span style={small}>{`${SPECIALTIES[c.specialty].title} · would start as ${a.startsAs === "Senior" ? "the Senior" : "a Junior"}`}</span>
                    </span>
                    <span style={{ flex: "0 0 auto", font: "600 13px/18px var(--font)", color: "var(--text-3)", whiteSpace: "nowrap" }}>Profile ›</span>
                  </button>
                  {r && <FitLine fit={r.fit} rank={r.rank} of={order.length} />}
                  <span style={{ font: "400 14px/20px var(--font)", color: "var(--text-2)", textWrap: "pretty", overflowWrap: "anywhere" }}>{applicationNote(c)}</span>
                  {/* a balanced grid: a long name never leaves one button alone on a row (owner, 10-05) */}
                  <Balanced min={150} gap={6}>
                    <button type="button" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)} style={{ ...button, ...fits }}>{`Interview ${c.name}`}</button>
                    <button type="button" data-sound="pick" onClick={() => hire(a.id, c)} style={{ ...strong, ...fits }}>{`Hire ${c.name}`}</button>
                    <button type="button" onClick={() => pass(a.id)} style={{ ...button, ...fits }}>Pass</button>
                  </Balanced>
                  {open === a.id && <Interview home={home} id={a.id} c={c} />}
                </article>
              );
            })}
          </section>
        );
      })}
      {said && <span role="status" style={small}>{said}</span>}
      {shown && (
        <Profile
          c={shown.item.c}
          title={SPECIALTIES[shown.item.c.specialty].title}
          fit={shown.fit}
          rank={shown.rank}
          of={order.length}
          sheet={profile(shown.item.c, startsOf(shown.item.a.startsAs))}
          onClose={() => setSeeing(null)}
          onInterview={() => { setSeeing(null); setOpen(shown.item.a.id); }}
          onHire={() => { setSeeing(null); hire(shown.item.a.id, shown.item.c); }}
          onPass={() => { setSeeing(null); pass(shown.item.a.id); }}
        />
      )}
    </div>
  );
}

const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
const rankChip = (rank: number): CSSProperties => ({
  padding: "1px 8px", borderRadius: 999, font: "800 12px/18px var(--font)", whiteSpace: "nowrap",
  ...(rank === 1 ? { color: "var(--ground)", background: "var(--accent)" } : { color: "var(--text-1)", background: "var(--fill-2)" }),
});

/** Where it ranks for your team, its fit, and why, in a few words each. */
function FitLine({ fit, rank, of }: { fit: Fit; rank: number; of: number }) {
  return (
    <div data-fit={fit.score} style={{ display: "grid", gap: 4, minWidth: 0 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="num" style={rankChip(rank)}>{rank === 1 ? "#1 for your team" : `#${rank} of ${of} for your team`}</span>
        <span className="num" style={{ font: "700 13px/18px var(--font)", color: "var(--accent)" }}>{`Fit ${fit.score}`}</span>
      </span>
      {/* a reason a line, balanced, so none ends on a word alone */}
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 2 }}>
        {fit.why.map((w) => (
          <li key={w} style={{ ...small, textWrap: "balance" }}>{`· ${cap(w)}`}</li>
        ))}
      </ul>
    </div>
  );
}

/** An applicant's profile: the orb, where it ranks for your team, and its card as the office shows one. */
function Profile({ c, title, fit, rank, of, sheet, onClose, onInterview, onHire, onPass }: { c: Character; title: string; fit: Fit; rank: number; of: number; sheet: ReactNode; onClose: () => void; onInterview: () => void; onHire: () => void; onPass: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const closing = useRef(onClose); // the room renders again on every home event: focus once, on opening
  closing.current = onClose;
  useEffect(() => {
    close.current?.focus();
    const key = (e: KeyboardEvent): void => {
      if (e.key === "Escape") closing.current();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // on the page itself, not inside the app's window, which clips what it holds
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`${c.name}'s profile`} data-profile={c.name} style={{ position: "fixed", inset: 0, zIndex: 35, display: "grid", placeItems: "center", padding: "var(--s5) var(--margin)" }}>
      <div aria-hidden onClick={onClose} style={{ position: "absolute", inset: 0, background: "var(--ground)", opacity: 0.78 }} />
      <div data-orb={c.hue} style={{ position: "relative", width: "min(980px, 100%)", maxHeight: "100%", overflowY: "auto", overscrollBehavior: "contain", borderRadius: 20, background: "var(--card)", boxShadow: "0 0 0 1px var(--hairline), 0 24px 64px var(--shadow)", padding: "var(--s5)", display: "grid", gap: "var(--s4)", alignContent: "start", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
          <span style={head}>{`Applying: ${title}`}</span>
          <button ref={close} type="button" onClick={onClose} style={button}>Close</button>
        </div>
        <div style={{ display: "grid", gap: "var(--s4)", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", alignItems: "start", minWidth: 0 }}>
          <div style={{ display: "grid", gap: "var(--s3)", justifyItems: "center", alignContent: "start", minWidth: 0 }}>
            <Orb character={c} size={168} />
            <div style={{ justifySelf: "stretch" }}>
              <FitLine fit={fit} rank={rank} of={of} />
            </div>
            <div style={{ justifySelf: "stretch" }}>
              <Balanced min={150} gap={6}>
                <button type="button" onClick={onInterview} style={{ ...button, ...fits }}>{`Interview ${c.name}`}</button>
                <button type="button" data-sound="pick" onClick={onHire} style={{ ...strong, ...fits }}>{`Hire ${c.name}`}</button>
                <button type="button" onClick={onPass} style={{ ...button, ...fits }}>Pass</button>
              </Balanced>
            </div>
          </div>
          {sheet}
        </div>
      </div>
    </div>,
    document.body,
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
