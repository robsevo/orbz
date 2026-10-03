// The day (PLAN 4.5): Ash's carried day, on what the home has. Your calendars' events
// (connectors/calendars.ts) and the bills and reminders the orbs keep for you (notices.ts) are
// handed to the kit, whose `eds` is that hand-off (kit/ash/eds.py), and Ash's own code answers:
// the morning brief in his words, and what clashes among what is already on (two that overlap,
// two too close to get from one to the other); and the replies you owe (mail.ts: what came from a
// person this week that you have not answered). Read only: nothing here changes a calendar or
// sends a word.
import { calendarOf } from "./calendar.ts";
import type { Calendars } from "./connectors/calendars.ts";
import type { Mail, Owed } from "./connectors/mail.ts";
import type { Kit } from "./kit.ts";
import type { ToolDef } from "./agent/tools.ts";
import type { Notices } from "./notices.ts";
import type { Schedules } from "./schedule.ts";

export type DayClash = { kind: "overlap" | "prep" | "travel"; first: string; second: string; at: number; gapMinutes: number | null };
export type Day = { brief: string; clashes: DayClash[]; owed: Owed[] } | { why: string };
type Home = { calendars: Calendars; notices: Notices; schedules: Schedules; kit: Kit | null; mail?: Mail };

/** How far ahead the day looks: Ash's agenda reads nine days, and a clash two. */
export const AHEAD_DAYS = 10;
export const CLASH_DAYS = 2;

const pad = (n: number): string => String(n).padStart(2, "0");
const ymd = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** What the kit's `eds` is handed: event rows and to-do rows in Ash's shape (epoch seconds). */
export async function feedOf(h: Home, now: number): Promise<{ events: Record<string, unknown>[]; todos: Record<string, unknown>[]; failed: Record<string, unknown>[] }> {
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const end = start + (AHEAD_DAYS + 1) * 86_400_000;
  const events = (await h.calendars.events(start, end)).map((e) => ({
    summary: e.title, start: Math.floor(e.start / 1000), end: Math.floor(e.end / 1000), all_day: e.allDay,
    location: e.location ?? "", uid: `${e.uid}@${e.start}`, calendar: e.calendar,
  }));
  // a bill or reminder due on a day (no time) is due by that day's end: never overdue the same morning
  const todos = calendarOf(h, ymd(start), ymd(end - 1))
    .flatMap((e) => (e.kind === "bill" || e.kind === "reminder" ? [e] : []))
    .map((e) => ({
      summary: e.kind === "bill" && e.amount ? `${e.title} (${e.amount})` : e.title,
      due: Math.floor((e.time ? new Date(`${e.day}T${e.time}`).getTime() : new Date(`${e.day}T23:59:59`).getTime()) / 1000),
      uid: `notice:${e.id}`, list: e.orb,
    }));
  const failed = h.calendars.list().filter((c) => c.why).map((c) => ({ calendar: c.label, error: c.why }));
  return { events, todos, failed };
}

/** The day as Ash says it: the brief and what clashes; or why it cannot be said now. */
export async function dayOf(h: Home, now: number): Promise<Day> {
  if (!h.kit) return { why: "the kit is not running, so the day cannot be read out" };
  const feed = await feedOf(h, now);
  try {
    const brief = (await h.kit.call("day_brief", { ...feed, now: now / 1000 })) as { said: string };
    // a list comes back unwrapped (kit.ts)
    const clashes = (await h.kit.call("day_clashes", { events: feed.events, now: now / 1000, days: CLASH_DAYS })) as { kind: DayClash["kind"]; first: string; second: string; at: number; gap_minutes: number | null }[];
    const owed = h.mail && Object.keys(h.mail.accounts()).length ? (await h.mail.owed(now)).owed : [];
    return {
      owed,
      brief: brief.said,
      clashes: clashes.map((c) => ({ kind: c.kind, first: c.first, second: c.second, at: c.at * 1000, gapMinutes: c.gap_minutes })),
    };
  } catch (e) {
    return { why: `the day could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** A clash in a sentence: what it is, when. */
export function clashWords(c: DayClash): string {
  const at = new Date(c.at);
  const when = `${at.toLocaleDateString("en-GB", { weekday: "short" })} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  if (c.kind === "overlap") return `${c.first} and ${c.second} overlap (${when})`;
  const gap = c.gapMinutes === 0 ? "no time" : `${c.gapMinutes} min`;
  return c.kind === "travel" ? `${gap} to get from ${c.first} to ${c.second}, somewhere else (${when})` : `${gap} between ${c.first} and ${c.second} (${when})`;
}

/** An orb's way to ask about your day in plain words, answered by Ash's day from your calendars
 * and the list: read only, and what it says is from outside (an invite's title is its sender's). */
export function dayTools(h: Home, now: () => number): ToolDef[] {
  return [
    {
      name: "ask_day",
      label: "Looking at your day",
      description: "Ask about the person's day in plain words ('what's next', 'what's my day', 'am I free thursday afternoon', 'plan my day'): answered from their own calendars and the bills and reminders you keep, by code. It never books, moves or cancels anything.",
      parameters: { type: "object", properties: { question: { type: "string" } }, required: ["question"], additionalProperties: false },
      describe: (a) => `ask about your day: "${typeof a.question === "string" ? a.question : ""}"`,
      decision: "allow",
      untrusted: "calendar",
      async run(a) {
        if (!h.kit) return { content: "The day cannot be read now: the kit is not running.", isError: true };
        const t = now();
        try {
          const r = (await h.kit.call("day_answer", { text: typeof a.question === "string" ? a.question : "", ...(await feedOf(h, t)), now: t / 1000 })) as { kind: string; said: string };
          return { content: r.kind === "read_only" ? `${r.said} (Orbs reads the person's calendars; a change is theirs to make.)` : r.said };
        } catch (e) {
          return { content: `The day could not be read: ${e instanceof Error ? e.message : String(e)}`, isError: true };
        }
      },
    },
  ];
}

/** The replies you owe, in a sentence: who, and what about (the first three named). */
export function owedWords(owed: Owed[]): string | null {
  if (!owed.length) return null;
  const who = (o: Owed): string => `${(/^"?([^"<]+?)"?\s*</.exec(o.from)?.[1] ?? o.from).trim()} ("${o.subject || "no subject"}")`;
  const named = owed.slice(0, 3).map(who);
  const rest = owed.length - named.length;
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
  return `${owed.length === 1 ? "One email waits" : `${owed.length} emails wait`} for your reply: ${list}${rest > 0 ? `, and ${rest} more` : ""}.`;
}
