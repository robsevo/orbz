// The calendar (PLAN 2.12; owner, 10-01: "in app calendar"). What is on each day, from the home:
// the bills and reminders orbs keep for you (notices.ts), and when every orb's schedules run
// (schedule.ts, each run worked out from its pattern, as the home itself will run it). Days are
// the home's local days. Your own calendar, through a connector, joins it with 4.2.
import type { Notices } from "./notices.ts";
import { cronOf, type Schedules } from "./schedule.ts";

export type CalendarEntry =
  | { kind: "bill" | "reminder"; id: number; orb: string; title: string; day: string; time: string | null; amount: string | null; conversation: string | null }
  | { kind: "schedule"; id: string; orb: string; title: string; day: string; time: string; cron: string; enabled: boolean };

/** At most this many days in one look (a month and a bit either side). */
export const SPAN_DAYS = 62;
/** At most this many runs of one schedule in one look (one that runs every minute is not 89,000 entries). */
export const RUNS_CAP = 400;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number): string => String(n).padStart(2, "0");
const dayOf = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const timeOf = (t: number): string => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
function startOf(day: string): number {
  const m = DAY.exec(day);
  if (!m) throw new Error(`a day is YYYY-MM-DD, not "${day}"`);
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (dayOf(t.getTime()) !== day) throw new Error(`there is no ${day}`);
  return t.getTime();
}

/** Everything on the days from `from` to `to` (both kept), in order of day and time. */
export function calendarOf(o: { notices: Notices; schedules: Schedules }, from: string, to: string): CalendarEntry[] {
  const start = startOf(from);
  const endDay = startOf(to);
  if (endDay < start) throw new Error("the calendar runs forward: from comes before to");
  const end = new Date(new Date(endDay).getFullYear(), new Date(endDay).getMonth(), new Date(endDay).getDate() + 1).getTime(); // the next midnight
  if ((end - start) / 86_400_000 > SPAN_DAYS + 1) throw new Error(`at most ${SPAN_DAYS} days at a time`);
  const out: CalendarEntry[] = [];
  for (const r of o.notices.reminders()) {
    const day = r.due.slice(0, 10);
    if (day < from || day > to) continue;
    out.push({ kind: r.kind, id: r.id, orb: r.orb, title: r.title, day, time: r.due.length > 10 ? r.due.slice(11, 16) : null, amount: r.amount, conversation: r.conversation });
  }
  for (const s of o.schedules.list()) {
    const cron = cronOf(s.cron, s.timezone);
    let at = cron.nextRun(new Date(start - 1));
    for (let n = 0; at && at.getTime() < end && n < RUNS_CAP; n++) {
      out.push({ kind: "schedule", id: s.id, orb: s.orb, title: s.name, day: dayOf(at.getTime()), time: timeOf(at.getTime()), cron: s.cron, enabled: s.enabled });
      at = cron.nextRun(at);
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));
}
