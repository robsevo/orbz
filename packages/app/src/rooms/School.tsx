// School (PLAN 5.7; owner, 10-03: "school happens when we fire, we can actually send them back to
// school"): `SchoolSheet` sends an orb you let go to school (the subjects you pick, your own too,
// and the mark that makes a diploma), from the org chart's Away list; `ReportCard` is how school
// goes, on the career page and on the Away list while the orb is there: each subject's starting
// score and its score now, the pass mark, a diploma when it is earned, the syllabus (yours to
// change), the notebook (only notes that raised the exam), and in Talking with you the answers that
// wait for your thumbs.
import { useEffect, useState, type CSSProperties } from "react";
import type { Office, ReportCardState, SchoolSubject } from "../home/link.ts";
import { Balanced } from "../ui/Balanced.tsx";

const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" };
const small: CSSProperties = { font: "500 13px/18px var(--font)", color: "var(--text-3)", textWrap: "pretty", overflowWrap: "anywhere" };
const button: CSSProperties = { font: "600 13px/18px var(--font)", border: 0, borderRadius: 10, padding: "6px 12px", background: "var(--fill)", color: "var(--text-1)", cursor: "pointer", minHeight: 32 };
const strong: CSSProperties = { ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" };

export const SUBJECTS = [
  { kind: "maths", name: "Mathematics" },
  { kind: "cpp", name: "C++" },
  { kind: "speech", name: "Speech" },
  { kind: "talking", name: "Talking with you" },
  { kind: "ai", name: "AI" },
] as const;
export const PASS_MARKS = [0.6, 0.7, 0.8, 0.9] as const;
const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** Send an orb you let go to school: subjects, your own, and a pass mark. */
export function SchoolSheet({ home, orb, name, sent }: { home: Office; orb: string; name: string; sent: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [own, setOwn] = useState("");
  const [mark, setMark] = useState<number>(0.8);
  const [said, setSaid] = useState<string | null>(null);
  const subjects = [...SUBJECTS.filter((s) => picked.includes(s.kind)).map((s) => ({ kind: s.kind as string })), ...(own.trim() ? [{ kind: "custom", name: own.trim() }] : [])];
  const toggle = (k: string): void => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  return (
    <div role="group" aria-label={`Send ${name} to school`} data-school-sheet={orb} style={{ display: "grid", gap: 10, padding: "var(--s3)", borderRadius: 14, background: "var(--card)", boxShadow: "inset 0 0 0 .5px var(--hairline)", minWidth: 0 }}>
      <span style={head}>Subjects</span>
      <Balanced min={140} gap={6}>
        {SUBJECTS.map((s) => {
          const on = picked.includes(s.kind);
          return (
            <button key={s.kind} type="button" aria-pressed={on} data-subject={s.kind} onClick={() => toggle(s.kind)} style={{ ...(on ? strong : button), minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {on ? "✓ " : ""}{s.name}
            </button>
          );
        })}
      </Balanced>
      <input value={own} onChange={(e) => setOwn(e.target.value)} aria-label="Your own subject" placeholder="Your own subject: Spanish, bookkeeping…" maxLength={40} size={1}
        style={{ minWidth: 0, font: "400 14px/20px var(--font)", color: "var(--text-1)", background: "var(--raised)", border: 0, borderRadius: 8, padding: "6px 10px" }} />
      <span style={head}>Pass mark</span>
      <div role="radiogroup" aria-label="Pass mark" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {PASS_MARKS.map((m) => (
          <button key={m} type="button" role="radio" aria-checked={mark === m} data-mark={m} onClick={() => setMark(m)} style={mark === m ? strong : button}>{pct(m)}</button>
        ))}
      </div>
      <span style={small}>{`A diploma when ${name} reaches ${pct(mark)} twice in a row. It counts when you ask who is more qualified for a job; it never promotes.`}</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" disabled={!subjects.length} onClick={() => void home.sendToSchool(orb, subjects, mark).then(sent, (e: Error) => setSaid(e.message))} style={strong}>{`Send ${name} to school`}</button>
      </div>
      {said && <span role="status" style={small}>{said}</span>}
    </div>
  );
}

/** How school goes: the report card. Nothing at all for an orb that never went. */
export function ReportCard({ home, orb, name }: { home: Office; orb: string; name: string }) {
  const [card, setCard] = useState<ReportCardState | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    const load = (): void => void home.reportCard(orb).then(setCard, (e: Error) => setSaid(e.message));
    load();
    return home.watch({ event: (e) => void (e.orb === orb && /^school\./.test(e.type) && load()) });
  }, [home, orb]);
  if (!card || (!card.subjects.length && !card.diplomas.length)) return said ? <span role="status" style={small}>{said}</span> : null;
  return (
    <section aria-label={`${name}'s report card`} data-report-card={orb} style={{ display: "grid", gap: 10, minWidth: 0 }}>
      <span style={head}>{card.atSchool ? `At school · pass mark ${pct(card.passMark ?? 0.8)}` : "Report card"}</span>
      {card.diplomas.length > 0 && <span data-diplomas style={{ ...small, color: "var(--text-1)" }}>{`Diplomas: ${card.diplomas.map((d) => `${d.name} (${pct(d.score)})`).join(" · ")}`}</span>}
      {card.subjects.map((s) => <Subject key={s.id} home={home} s={s} name={name} open={card.atSchool} mark={card.passMark ?? 0.8} said={setSaid} />)}
      {said && <span role="status" style={small}>{said}</span>}
    </section>
  );
}

function Subject({ home, s, name, open, mark, said }: { home: Office; s: SchoolSubject; name: string; open: boolean; mark: number; said: (m: string) => void }) {
  const [showNotes, setShowNotes] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const now = s.now ?? s.started;
  return (
    <article data-school-subject={s.kind} aria-label={s.name} style={{ display: "grid", gap: 6, padding: "var(--s3)", borderRadius: 14, background: "var(--fill)", minWidth: 0 }}>
      <span style={{ font: "700 14px/19px var(--font)", color: "var(--text-1)" }}>{s.graduatedAt ? `🎓 ${s.name}` : s.name}</span>
      <span style={small}>{s.how}</span>
      <div role="progressbar" aria-label={`${s.name}: ${now === null ? "not sat yet" : pct(now)}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={now === null ? 0 : Math.round(now * 100)}
        style={{ position: "relative", height: 8, borderRadius: 4, background: "var(--fill-2)", overflow: "hidden" }}>
        <i style={{ display: "block", height: "100%", width: `${(now ?? 0) * 100}%`, background: "var(--accent)" }} />
        <i aria-hidden style={{ position: "absolute", top: 0, bottom: 0, left: `${mark * 100}%`, width: 2, background: "var(--text-2)" }} />
      </div>
      <span data-scores style={small}>
        {s.started === null ? (s.rate ? "The starting exam waits for your thumbs." : s.sittings[0]?.state === "void" ? "The starting exam could not be marked: the next one counts." : "The starting exam comes first.") : `Started at ${pct(s.started)} · now ${pct(now ?? 0)}${s.graduatedAt ? " · diploma" : ` · pass mark ${pct(mark)}`}`}
        {` · ${s.lessons} ${s.lessons === 1 ? "lesson" : "lessons"} · ${s.notes.length} ${s.notes.length === 1 ? "note" : "notes"} kept`}
      </span>
      {s.trouble && <span style={small}>{s.trouble}</span>}
      {s.rate && (
        <div role="group" aria-label={`Rate ${name}'s answers`} style={{ display: "grid", gap: 6, minWidth: 0 }}>
          <span style={small}>{`Rate ${name}'s answers: your thumbs are this exam's marks.`}</span>
          {s.rate.answers.map((a) => (
            <div key={a.n} data-answer={a.n} style={{ display: "grid", gap: 4, padding: "8px 10px", borderRadius: 10, background: "var(--raised)", minWidth: 0 }}>
              <span style={small}>{a.ask}</span>
              <span style={{ font: "400 14px/20px var(--font)", color: "var(--text-1)", overflowWrap: "anywhere", textWrap: "pretty" }}>{a.answer}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" aria-pressed={a.up === true} aria-label={`Thumbs up for answer ${a.n}`} onClick={() => void home.thumb(s.rate!.sitting, a.n, true).catch((e: Error) => said(e.message))} style={a.up === true ? strong : button}>👍</button>
                <button type="button" aria-pressed={a.up === false} aria-label={`Thumbs down for answer ${a.n}`} onClick={() => void home.thumb(s.rate!.sitting, a.n, false).catch((e: Error) => said(e.message))} style={a.up === false ? strong : button}>👎</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {s.notes.length > 0 && <button type="button" aria-expanded={showNotes} onClick={() => setShowNotes(!showNotes)} style={button}>Notebook</button>}
        {open && s.syllabus && editing === null && <button type="button" onClick={() => setEditing(s.syllabus!.join("\n"))} style={button}>Change the syllabus</button>}
      </div>
      {showNotes && (
        <ol data-notebook style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}>
          {s.notes.map((n, i) => <li key={i} style={small}>{n.text}</li>)}
        </ol>
      )}
      {editing === null ? (
        s.syllabus && <span data-syllabus style={small}>{`Syllabus: ${s.syllabus.join(" · ")}`}</span>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void home.setSyllabus(s.id, editing.split("\n")).then(() => setEditing(null), (err: Error) => said(err.message)); }} style={{ display: "grid", gap: 6 }}>
          <textarea value={editing} onChange={(e) => setEditing(e.target.value)} aria-label={`${s.name}: the syllabus, a topic a line`} rows={6}
            style={{ minWidth: 0, font: "400 14px/20px var(--font)", color: "var(--text-1)", background: "var(--raised)", border: 0, borderRadius: 8, padding: "6px 10px", resize: "vertical" }} />
          <div style={{ display: "flex", gap: 6 }}>
            <button type="submit" style={strong}>Save the syllabus</button>
            <button type="button" onClick={() => setEditing(null)} style={button}>Cancel</button>
          </div>
        </form>
      )}
    </article>
  );
}
