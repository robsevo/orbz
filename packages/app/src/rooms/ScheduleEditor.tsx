// A new schedule (PLAN 2.4: "daily at a time, or every N with a 15-minute minimum, with a
// plain-words preview"), from the calendar. Who does it, what it is, what to do each time, and
// when: daily at a time (on the days you pick, or every day), or every 15, 20 or 30 minutes, or
// every 1 to 12 hours, evenly. The preview is the home's: the words read back off the very
// pattern it will run, and when it runs next.
import { useEffect, useState, type CSSProperties } from "react";
import type { Character } from "../orb/spec.ts";
import { idOf, type Office, type ScheduleRule } from "../home/link.ts";
import { OneLine } from "../ui/Balanced.tsx";

const field: CSSProperties = { font: "600 15px/21px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 12px", outline: 0, boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0, width: "100%" };
const label: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" };
const chip = (on: boolean): CSSProperties => ({
  font: "600 13px/18px var(--font)", border: 0, borderRadius: 999, padding: "6px 12px", cursor: "pointer", minHeight: 32,
  background: on ? "var(--accent-fill)" : "var(--fill)", color: on ? "var(--text-1)" : "var(--text-2)", boxShadow: on ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 .5px var(--hairline)",
});
const button: CSSProperties = { font: "600 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 14px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 36 };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STEPS: { n: number; unit: "minutes" | "hours"; words: string }[] = [
  ...[15, 20, 30].map((n) => ({ n, unit: "minutes" as const, words: `${n} min` })),
  ...[1, 2, 3, 4, 6, 8, 12].map((n) => ({ n, unit: "hours" as const, words: `${n} h` })),
];

export function ScheduleEditor(o: { home: Office; office: Character[]; done: () => void }) {
  const [orb, setOrb] = useState(o.office[0] ? idOf(o.office[0].name) : "");
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [kind, setKind] = useState<"daily" | "every">("daily");
  const [time, setTime] = useState("09:00");
  const [days, setDays] = useState<number[]>([]);
  const [step, setStep] = useState(STEPS[0]!);
  const [shown, setShown] = useState<{ words: string; next: number[] } | { error: string } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const rule: ScheduleRule = kind === "daily" ? { kind, time, ...(days.length && { days }) } : { kind, n: step.n, unit: step.unit };
  const key = JSON.stringify(rule);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      o.home.schedulePreview(rule).then((p) => live && setShown(p), (e: Error) => live && setShown({ error: e.message }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key]);
  const save = (): void => {
    setSaid(null);
    if (!name.trim() || !instruction.trim()) return setSaid("Give it a name, and what to do each time.");
    o.home.addSchedule({ orb, name: name.trim(), instruction: instruction.trim(), rule }).then(o.done, (e: Error) => setSaid(e.message));
  };
  const next = shown && "next" in shown ? shown.next.slice(0, 2).map((t) => new Date(t).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) : [];
  const who = o.office.find((c) => idOf(c.name) === orb);
  return (
    <section aria-label="A new schedule" data-orb={who?.hue} style={{ display: "grid", gap: "var(--s3)", padding: "var(--s4)", borderRadius: 18, background: "var(--card)", boxShadow: "inset 0 0 0 1.5px var(--accent)", minWidth: 0 }}>
      <span style={{ font: "800 17px/22px var(--font)", color: "var(--text-1)" }}>A new schedule</span>
      <span style={label}>Who</span>
      <OneLine style={{ justifyContent: "start" }}>
        {o.office.map((c) => (
          <button key={c.name} data-orb={c.hue} aria-pressed={orb === idOf(c.name)} onClick={() => setOrb(idOf(c.name))} style={chip(orb === idOf(c.name))}>
            {c.name}
          </button>
        ))}
      </OneLine>
      <label style={{ display: "grid", gap: 6 }}>
        <span style={label}>What it is</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Inbox sweep" style={field} />
      </label>
      <label style={{ display: "grid", gap: 6 }}>
        <span style={label}>What to do each time</span>
        <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={2000} rows={3} placeholder="Sort the morning's mail, and keep any bill for me." style={{ ...field, resize: "vertical", font: "400 15px/21px var(--font)" }} />
      </label>
      <span style={label}>When</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button aria-pressed={kind === "daily"} onClick={() => setKind("daily")} style={chip(kind === "daily")}>
          At a time
        </button>
        <button aria-pressed={kind === "every"} onClick={() => setKind("every")} style={chip(kind === "every")}>
          Every…
        </button>
      </div>
      {kind === "daily" ? (
        <div style={{ display: "grid", gap: "var(--s2)" }}>
          <input type="time" aria-label="At" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} style={{ ...field, width: "auto", justifySelf: "start" }} />
          <div role="group" aria-label="On these days (none: every day)" style={{ minWidth: 0 }}>
            <OneLine style={{ justifyContent: "start" }}>
            {DAYS.map((d, i) => (
              <button key={d} aria-pressed={days.includes(i + 1)} onClick={() => setDays((xs) => (xs.includes(i + 1) ? xs.filter((x) => x !== i + 1) : [...xs, i + 1].sort()))} style={chip(days.includes(i + 1))}>
                {d}
              </button>
            ))}
            </OneLine>
          </div>
        </div>
      ) : (
        <div role="group" aria-label="How often" style={{ minWidth: 0 }}>
          <OneLine style={{ justifyContent: "start" }}>
          {STEPS.map((x) => (
            <button key={x.words} aria-pressed={x === step} onClick={() => setStep(x)} style={chip(x === step)}>
              {x.words}
            </button>
          ))}
          </OneLine>
        </div>
      )}
      <span data-preview aria-live="polite" style={{ font: "600 14px/20px var(--font)", color: shown && "error" in shown ? "var(--alert)" : "var(--text-1)", textWrap: "balance" }}>
        {!shown ? "…" : "error" in shown ? shown.error : `${shown.words}${next.length ? ` · next ${next.join(", then ")}` : ""}`}
      </span>
      {said && <span role="alert" style={{ color: "var(--alert)", font: "600 13px/18px var(--font)" }}>{said}</span>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button data-sound="pick" onClick={save} style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}>
          Keep it
        </button>
        <button onClick={o.done} style={button}>
          Cancel
        </button>
      </div>
    </section>
  );
}
