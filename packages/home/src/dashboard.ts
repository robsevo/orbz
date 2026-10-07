// The home page's look at the office (owner, 10-07: "a nice home page the app can default to with the same logo
// and splash on it with a nice dashboard and stats and i dont know, make it nice and inviting like the rest of the
// site. placed well, organized"): who is working and who waits for you, the XP and the brain spent today and this
// week, the top of the office, what was finished lately, the sessions, the office's life, what is coming up and who
// is applying. All of it read by code from the log and the home's stores: no brain is asked, nothing is written
// (the recruiter's list turns over at the day's turn, as it does whenever anyone looks).
import { calendarOf, type CalendarEntry } from "./calendar.ts";
import type { Home } from "./home.ts";
import { recentWork, type Work } from "./worklog.ts";
import { tabConversation } from "./team.ts";

/** A run started this long ago and never heard to finish (the home stopped under it) no longer counts as work. */
export const STALE_RUN_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;

export type Dashboard = {
  now: number;
  name: string | null;
  orbs: number;
  /** In the office: a run under way, and a card open for you. */
  working: string[];
  waiting: string[];
  notices: number;
  xp: { today: number; week: number; top: { orb: string; name: string; xp: number }[] };
  brain: { today: { tokens: number; requests: number }; week: { tokens: number; requests: number } };
  lately: (Work & { name: string })[];
  sessions: { id: number; title: string; orbs: number; at: number }[];
  meetings: { at: number; a: string; b: string; kind: string; place: string; idea: string | null }[];
  coming: CalendarEntry[];
  hiring: { positions: number; applicants: number };
};

const dayOf = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const midnight = (t: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

export function dashboardOf(home: Home): Dashboard {
  const now = home.clock.now();
  const today = midnight(now);
  const week = today - 6 * DAY_MS; // today and the six days before
  const office = home.inbox.orbs();
  const ids = new Set(office.map((o) => o.id));
  const nameOf = (id: string): string => home.inbox.orb(id)?.name ?? id;

  // runs under way and cards open, the way an orb's mood reads them (app/src/orb/mood.ts)
  const runs = new Map<number, { orb: string; at: number }>();
  for (const e of home.events.ofType("run.started")) if (e.orb) runs.set(Number(e.data.run), { orb: e.orb, at: e.at });
  for (const e of home.events.ofType("run.finished")) runs.delete(Number(e.data.run));
  const working = new Set([...runs.values()].filter((r) => now - r.at < STALE_RUN_MS && ids.has(r.orb)).map((r) => r.orb));
  const cards = new Map<number, string>();
  for (const e of home.events.ofType("card.opened")) if (e.orb) cards.set(Number(e.data.card), e.orb);
  for (const e of home.events.ofType("card.resolved")) cards.delete(Number(e.data.card));
  const waiting = new Set([...cards.values()].filter((o) => ids.has(o)));

  // XP earned (what was taken back counts against it), and the brain's tokens and requests
  let xpToday = 0, xpWeek = 0;
  for (const e of [...home.events.ofType("xp.earned"), ...home.events.ofType("xp.lost")]) {
    const at = Number(e.data.at ?? e.at);
    const n = Number(e.data.amount) || 0;
    if (at >= week) xpWeek += n;
    if (at >= today) xpToday += n;
  }
  const brain = { today: { tokens: 0, requests: 0 }, week: { tokens: 0, requests: 0 } };
  for (const e of home.events.ofType("brain.spend")) {
    if (e.at < week) continue;
    const tokens = (Number(e.data.prompt_tokens) || 0) + (Number(e.data.completion_tokens) || 0);
    brain.week.tokens += tokens;
    brain.week.requests++;
    if (e.at >= today) {
      brain.today.tokens += tokens;
      brain.today.requests++;
    }
  }

  // the sessions most lately spoken in
  const sessions = home.team.list().map((s) => {
    const at = Math.max(s.createdAt, ...(["brainstorm", "floor"] as const).map((t) => home.conversations.list(tabConversation(s.id, t)).at(-1)?.at ?? 0));
    return { id: s.id, title: s.title, orbs: new Set([...s.brainstorm, ...s.floor]).size, at };
  }).sort((a, b) => b.at - a.at).slice(0, 3);

  const meetings = home.events.ofType("social.met").slice(-3).reverse().map((e) => {
    const ideas = (Array.isArray(e.data.ideas) ? e.data.ideas : []) as { orb: string; text: string }[];
    return { at: e.at, a: nameOf(String(e.data.a)), b: nameOf(String(e.data.b)), kind: String(e.data.kind), place: String(e.data.place), idea: ideas[0]?.text ?? null };
  });

  // what is coming: today's and the next two days' bills, reminders and scheduled runs, from now on
  const at = (c: CalendarEntry): string => `${c.day} ${c.time ?? "00:00"}`;
  const nowKey = `${dayOf(now)} ${new Date(now).toTimeString().slice(0, 5)}`;
  const coming = calendarOf(home, dayOf(now), dayOf(today + 2 * DAY_MS))
    .filter((c) => (c.kind === "schedule" ? c.enabled : true) && (c.time === null ? c.day >= dayOf(now) : at(c) >= nowKey))
    .sort((a, b) => at(a).localeCompare(at(b)))
    .slice(0, 5);

  return {
    now,
    name: home.about.get().name,
    orbs: office.length,
    working: [...working],
    waiting: [...waiting],
    notices: home.notices.list().length,
    xp: { today: xpToday, week: xpWeek, top: home.ranking().slice(0, 5) },
    brain,
    lately: recentWork(home.events, null, { limit: 6 }).filter((w) => ids.has(w.orb)).map((w) => ({ ...w, name: nameOf(w.orb) })),
    sessions,
    meetings,
    coming,
    hiring: { positions: home.recruiter.positions().length, applicants: home.recruiter.applicants().length },
  };
}
