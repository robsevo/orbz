// The calendar (PLAN 2.12; owner, 10-01: "in app calendar. all those things"). A month, Monday
// first: the bills and reminders orbs keep for you, and when every orb's schedules run, each in its
// orb's colour; today ringed. Under it, the day you pick: move a bill or a reminder, mark it done,
// give a schedule another time or pause it. Those are your own changes, so they happen at once; an
// orb's move comes to you as a card (the home's floor: moving what is on your calendar is never
// silent). Kept up to date as it changes, here or on another device.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Orb } from "../orb/Orb.tsx";
import type { Character } from "../orb/spec.ts";
import { idOf, type CalendarEntry, type Office } from "../home/link.ts";
import { ScheduleEditor } from "./ScheduleEditor.tsx";

const pad = (n: number): string => String(n).padStart(2, "0");
const dayOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MARK: Record<CalendarEntry["kind"], string> = { bill: "¤", reminder: "◷", schedule: "↻", event: "▣" };
/** The orb an entry is his, if any: your own calendar's events are yours. */
const orbIdOf = (e: CalendarEntry): string | null => (e.kind === "event" ? null : e.orb);
const CHANGES = /^(reminder\.(added|moved|done)|schedule\.(added|changed|enabled|disabled|removed))$/;
const button: CSSProperties = { font: "600 13px/18px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "6px 12px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 32 };

/** A time, kept once you stop changing it (a time field's hour and minute are two stops, so it
 * cannot wait to be left: Tab moves between them), or at once on Enter. */
function TimeField({ label, value, set }: { label: string; value: string; set: (t: string) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keep = (v: string): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (v && v !== value) set(v);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <input
      type="time"
      aria-label={label}
      defaultValue={value}
      onChange={(ev) => {
        const v = ev.target.value;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => keep(v), 700);
      }}
      onKeyDown={(ev) => ev.key === "Enter" && keep(ev.currentTarget.value)}
      style={{ ...button, font: "600 13px/18px var(--font)", padding: "4px 8px" }}
    />
  );
}

/** The six weeks a month is shown in: Monday before its first day to the Sunday after its last. */
export function gridOf(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // days since Monday
  const last = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((lead + last) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => new Date(year, month, 1 - lead + i));
}

export function CalendarRoom(o: { home: Office | null; office: Character[] }) {
  const today = new Date();
  const [at, setAt] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [picked, setPicked] = useState(dayOf(today));
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [said, setSaid] = useState<string | null>(null);
  const [making, setMaking] = useState(false); // the schedule editor is open (PLAN 2.4)
  const days = gridOf(at.year, at.month);
  const from = dayOf(days[0]!);
  const to = dayOf(days[days.length - 1]!);
  const load = (): void => {
    if (o.home) o.home.calendar(from, to).then(setEntries, (e: Error) => setSaid(e.message));
  };
  useEffect(() => {
    if (!o.home) return;
    load();
    return o.home.watch({ event: (e) => CHANGES.test(e.type) && load() });
  }, [o.home, from, to]);
  if (!o.home) {
    return (
      <div style={{ display: "grid", placeItems: "center", alignContent: "center", gap: "var(--s3)", padding: "var(--s7) var(--s5)", textAlign: "center" }}>
        <span style={{ font: "700 20px/26px var(--font)", color: "var(--text-1)" }}>The calendar lives on your home</span>
        <span style={{ font: "400 15px/21px var(--font)", color: "var(--text-3)", maxWidth: 440 }}>Bills, reminders and every orb's schedules are kept there. Start it (pnpm start) and open the link it prints.</span>
      </div>
    );
  }
  const home = o.home;
  const orbOf = (id: string): Character | undefined => o.office.find((c) => idOf(c.name) === id);
  const onDay = (d: string): CalendarEntry[] => entries.filter((e) => e.day === d);
  const step = (n: number): void => setAt((a) => ({ year: new Date(a.year, a.month + n, 1).getFullYear(), month: new Date(a.year, a.month + n, 1).getMonth() }));
  const act = (p: Promise<void>): void => {
    setSaid(null);
    p.then(load, (e: Error) => setSaid(e.message));
  };
  const title = new Date(at.year, at.month, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const agenda = onDay(picked);
  return (
    <div style={{ display: "grid", gap: "var(--s4)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
        <h2 data-month={`${at.year}-${pad(at.month + 1)}`} style={{ margin: 0, font: "800 26px/32px var(--font)", color: "var(--text-1)" }}>{title}</h2>
        <span style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
          <button aria-label="The month before" onClick={() => step(-1)} style={button}>‹</button>
          <button onClick={() => { setAt({ year: today.getFullYear(), month: today.getMonth() }); setPicked(dayOf(today)); }} style={button}>Today</button>
          <button aria-label="The month after" onClick={() => step(1)} style={button}>›</button>
        </span>
      </div>
      {o.office.length > 0 && !making && (
        <span>
          <button onClick={() => setMaking(true)} style={button}>
            New schedule
          </button>
        </span>
      )}
      {making && (
        <ScheduleEditor
          home={home}
          office={o.office}
          done={() => {
            setMaking(false);
            load();
          }}
        />
      )}
      <div role="grid" aria-label={title} style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4, minWidth: 0 }}>
        {WEEKDAYS.map((w) => (
          <span key={w} role="columnheader" style={{ font: "700 11px/16px var(--font)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-3)", textAlign: "center" }}>
            {w}
          </span>
        ))}
        {days.map((d) => {
          const key = dayOf(d);
          const list = onDay(key);
          const inMonth = d.getMonth() === at.month;
          const isToday = key === dayOf(today);
          return (
            <button
              key={key}
              role="gridcell"
              data-day={key}
              aria-selected={picked === key}
              aria-label={`${d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}${list.length ? `, ${list.length} on it` : ""}`}
              onClick={() => setPicked(key)}
              className="orbs-calday"
              style={{ display: "grid", alignContent: "start", gap: 2, minWidth: 0, minHeight: 64, padding: "4px 5px", border: 0, borderRadius: 10, cursor: "pointer", textAlign: "left", background: picked === key ? "var(--accent-fill)" : "var(--fill)", boxShadow: isToday ? "inset 0 0 0 1.5px var(--accent)" : picked === key ? "inset 0 0 0 1px var(--accent)" : "none", opacity: inMonth ? 1 : 0.45 }}
            >
              <span className="orbs-calnum" style={{ font: `${isToday ? 800 : 600} 12px/16px var(--font)`, color: isToday ? "var(--accent)" : "var(--text-1)" }}>{d.getDate()}</span>
              {/* on a wide screen what is on it, in its orb's colour; on a phone (the stylesheet) a dot each */}
              {list.slice(0, 3).map((e, i) => (
                <span key={`${e.kind}-${e.id}-${i}`} data-entry={e.kind} data-orb={orbIdOf(e) === null ? undefined : orbOf(orbIdOf(e)!)?.hue} className="orbs-calentry" style={{ display: "flex", alignItems: "center", gap: 3, minWidth: 0, font: "600 10px/14px var(--font)", color: "var(--text-1)", opacity: e.kind === "schedule" && !e.enabled ? 0.5 : 1 }}>
                  <i aria-hidden style={{ flex: "0 0 auto", width: 6, height: 6, borderRadius: "50%", background: "var(--accent)" }} />
                  <span className="orbs-calword" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.time ? `${e.time} ` : ""}{e.title}</span>
                </span>
              ))}
              {list.length > 3 && <span className="orbs-calword" style={{ font: "600 10px/14px var(--font)", color: "var(--text-3)" }}>+{list.length - 3} more</span>}
            </button>
          );
        })}
      </div>
      {said && <span role="alert" style={{ font: "500 13px/18px var(--font)", color: "var(--alert)" }}>{said}</span>}
      <section aria-label={`On ${picked}`} data-agenda={picked} style={{ display: "grid", gap: 6, minWidth: 0 }}>
        <span style={{ font: "800 16px/22px var(--font)", color: "var(--text-1)" }}>{new Date(`${picked}T00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span>
        {!agenda.length && <span style={{ font: "400 13px/18px var(--font)", color: "var(--text-3)" }}>Nothing on this day.</span>}
        {agenda.map((e, i) => {
          const id = orbIdOf(e);
          const c = id === null ? undefined : orbOf(id);
          return (
            <div key={`${e.kind}-${e.id}-${i}`} data-orb={c?.hue} data-item={e.kind} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 10, alignItems: "start", padding: "8px 10px", borderRadius: 12, background: "var(--card)", boxShadow: e.kind === "bill" ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 .5px var(--hairline)", minWidth: 0 }}>
              {c ? <Orb character={c} size={30} poke={false} still /> : <span aria-hidden style={{ width: 30 }}>{MARK[e.kind]}</span>}
              <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                <span style={{ display: "grid", minWidth: 0 }}>
                  <span style={{ font: "700 14px/19px var(--font)", color: "var(--text-1)", overflowWrap: "anywhere", textWrap: "balance" }}>
                    <span aria-hidden style={{ color: "var(--accent)" }}>{MARK[e.kind]} </span>
                    {e.time ? `${e.time}${e.kind === "event" && e.until && e.until !== e.time ? `–${e.until}` : ""} · ` : ""}
                    {e.title}
                  </span>
                  <span style={{ font: "400 12px/17px var(--font)", color: "var(--text-3)" }}>
                    {e.kind === "event"
                      ? [e.calendar, e.location].filter(Boolean).join(" · ")
                      : [c?.name ?? e.orb, e.kind === "schedule" ? (e.enabled ? "runs then" : "paused") : e.kind === "bill" ? ["bill", e.amount].filter(Boolean).join(", ") : "reminder"].join(" · ")}
                  </span>
                </span>
                {/* your own calendar's events are read here, changed in your calendar */}
                {e.kind !== "event" && <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {e.kind === "schedule" ? (
                    <>
                      <TimeField key={`${e.id}-${e.time}`} label={`When ${e.title} runs`} value={e.time} set={(time) => act(home.setSchedule(e.id, { time }))} />
                      <span style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => act(home.setSchedule(e.id, { enabled: !e.enabled }))} style={button}>
                          {e.enabled ? "Pause" : "Resume"}
                        </button>
                        <button onClick={() => act(home.removeSchedule(e.id))} aria-label={`Remove the schedule ${e.title}`} style={button}>
                          Remove
                        </button>
                      </span>
                    </>
                  ) : (
                    <>
                      <input type="date" aria-label={`Move ${e.title} to`} defaultValue={e.day} key={`${e.id}-${e.day}`} onChange={(ev) => ev.target.value && ev.target.value !== e.day && act(home.moveReminder(e.id, e.time ? `${ev.target.value}T${e.time}` : ev.target.value))} style={{ ...button, font: "600 13px/18px var(--font)", padding: "4px 8px" }} />
                      <button onClick={() => act(home.doneReminder(e.id))} style={button}>
                        {e.kind === "bill" ? "Paid" : "Done"}
                      </button>
                    </>
                  )}
                </span>}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
