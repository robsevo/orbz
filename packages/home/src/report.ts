// The board's daily report (PLAN 5.18; owner, 10-07: "The board also sends you a status report every day about ideas
// they think are great for the startup to make money, news around the world, news around the office, if we feel like
// someones not a fit or if theyre doing good. best new candidates to hire for the day, thingslike that. expand, we need
// to know where the idea comes from too as well(which orb in the office, so they get xp if we approve it)").
//
// Once a day, from 08:00, the board's Chair (the CEO) sends you one report:
//   - ideas to make money, each from a named orb, asked of the cheapest brain; a few orbs a day, in turn, so everyone
//     is asked; one you approve gives its orb XP (gym/xp.ts hears `report.idea_approved`), and the orbs hear it;
//   - the world: what the reading library (PLAN 3.12) brought in since the last report, each with the orb who follows it;
//   - the office: who joined and left, promotions, the board's elections and decisions, friendships, habits learned,
//     the jobs each finished, by code from the log;
//   - people: who is doing well and who may not be a fit, by code from each orb's week (gym/performance.ts), never a
//     model's opinion (CLAUDE.md rule 8);
//   - hiring: today's applicants and who is applying again, for the app to rank by fit (orb/fit.ts);
//   - money: what the brain cost yesterday and this week, and the bills coming up, kept by the CFO.
// Kept as events (report.*), so the log replays to the same reports. The office's own news is never asked of a model.
import type { Clock } from "./clock.ts";
import type { EventLog, HomeEvent } from "./events.ts";

const DAY = 86_400_000;
/** When the day's report goes out: 08:00, an hour into the office's day. */
export const REPORT_HOUR = 8;
/** How many orbs are asked for an idea each day. */
export const PITCHERS = 3;

export type Idea = { id: string; orb: string; name: string; text: string; verdict: "approved" | "passed" | null };
export type NewsItem = { title: string; url: string; host: string; orb: string; name: string };
export type OfficeItem = { text: string; orb: string | null };
export type PersonNote = { orb: string; name: string; why: string };
export type Report = {
  id: number; at: number; day: string;
  chair: { orb: string; name: string } | null;
  ideas: Idea[];
  world: NewsItem[];
  office: OfficeItem[];
  people: { well: PersonNote[]; fit: PersonNote[] };
  hiring: { positions: string[]; applicants: number[]; returning: { id: string; name: string; specialty: string }[] };
  money: { treasurer: string | null; yesterdayUsd: number; weekUsd: number; bills: { title: string; due: string; amount: string | null }[] };
};

export type ReportOrb = { id: string; name: string; specialty: string; createdAt: number };
export type Week = { xp: number; approved: number; judged: number; suggest: string; why: string };

export type ReportOptions = {
  office: () => ReportOrb[];
  /** The board's seats, the Chair first (boardroom.ts). */
  board: () => { orb: string; name: string; post: string }[];
  company: () => string | null;
  founder: () => string | null;
  /** One orb's idea, asked of the cheapest brain; null when no brain answers. */
  ask: (orb: string, prompt: string) => Promise<string | null>;
  /** What the reading library brought in after `since`, newest first. */
  news: (since: number) => { title: string; url: string; host: string; orb: string }[];
  /** An orb's week, by code (gym/performance.ts). */
  week: (orb: ReportOrb) => Week;
  /** What the brain cost from `from` to `to`, in dollars. */
  spent: (from: number, to: number) => number;
  /** The bills not yet done, due by `until` (a day, 2026-10-12). */
  bills: (until: string) => { title: string; due: string; amount: string | null }[];
  hiring: () => { positions: string[]; applicants: { id: number }[]; returning: { id: string; name: string; specialty: string }[] };
};

const dayOf = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
/** 08:00 on the day of `t`, in the home's own time. */
const reportTimeOn = (t: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), REPORT_HOUR).getTime();
};
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** An idea as a pitch reads: one or two sentences, no preamble, no quotes round it. */
export function readIdea(text: string | null): string | null {
  const t = (text ?? "").replace(/\s+/g, " ").replace(/^(idea|my idea|pitch)\s*[:\-–]\s*/i, "").replace(/^["“]|["”]$/g, "").trim();
  if (t.length < 12) return null;
  return t.length > 400 ? `${t.slice(0, 399).replace(/\s+\S*$/, "")}…` : t;
}

/** Who pitches today: the orbs asked longest ago first (never asked, first of all), then the board's, then the first
 * to join; at most `n`. */
export function pitchers(office: ReportOrb[], board: string[], lastAsked: (orb: string) => number, n = PITCHERS): ReportOrb[] {
  const seat = (id: string): number => (board.includes(id) ? board.indexOf(id) : board.length);
  return [...office].sort((a, b) => lastAsked(a.id) - lastAsked(b.id) || seat(a.id) - seat(b.id) || a.createdAt - b.createdAt).slice(0, n);
}

/** What the office's news is read from. */
export const NEWS_TYPES = ["orb.added", "orb.rehired", "orb.let_go", "orb.promoted", "habit.promoted", "board.decided", "board.elected", "social.friends", "social.fell_out", "run.finished"];

/** The office's own news between two times, by code from the log. */
export function officeNews(events: readonly HomeEvent[], nameOf: (orb: string) => string): OfficeItem[] {
  const out: OfficeItem[] = [];
  const jobs = new Map<string, number>();
  for (const e of events) {
    const orb = e.orb ?? null;
    const who = orb ? nameOf(orb) : "";
    switch (e.type) {
      case "orb.added": out.push({ orb, text: `${who} joined as ${String(e.data.level ?? "a Junior") === "Senior" ? "a Senior" : "a Junior"}` }); break;
      case "orb.rehired": out.push({ orb, text: `${who} came back` }); break;
      case "orb.let_go": out.push({ orb, text: `${String(e.data.name ?? who)} was let go` }); break;
      case "orb.promoted": out.push({ orb, text: `${who} was promoted to ${String(e.data.to)}` }); break;
      case "habit.promoted": out.push({ orb, text: `${who} learned a habit` }); break;
      case "board.decided": out.push({ orb: null, text: `The board ${e.data.carried ? "carried" : "turned down"} a proposal, ${Number(e.data.yes)}–${Number(e.data.no)}` }); break;
      case "board.elected": out.push({ orb: null, text: `Everyone voted for the board (${plural(Number(e.data.size), "seat")})` }); break;
      case "social.friends":
      case "social.fell_out": {
        const [x, y] = (e.data.names as string[] | undefined) ?? [];
        if (x && y) out.push({ orb: null, text: e.type === "social.friends" ? `${x} and ${y} became good friends` : `${x} and ${y} fell out` });
        break;
      }
      case "run.finished":
        if (orb && e.data.outcome === "ok") jobs.set(orb, (jobs.get(orb) ?? 0) + 1);
        break;
    }
  }
  for (const [orb, n] of [...jobs].sort((a, b) => b[1] - a[1]).slice(0, 5)) out.push({ orb, text: `${nameOf(orb)} finished ${plural(n, "job")}` });
  return out;
}

/** Who is doing well and who may not be a fit, from each orb's week, by code. */
export function peopleNotes(office: ReportOrb[], week: (o: ReportOrb) => Week): { well: PersonNote[]; fit: PersonNote[] } {
  const weeks = office.map((o) => ({ o, w: week(o) }));
  const well = weeks
    .filter(({ w }) => w.suggest === "promote" || w.xp >= 30)
    .sort((a, b) => b.w.xp - a.w.xp)
    .slice(0, 3)
    .map(({ o, w }) => ({ orb: o.id, name: o.name, why: w.suggest === "promote" ? `ready for a promotion: ${w.why}` : w.why }));
  const fit = weeks
    .filter(({ w }) => w.suggest === "retrain" || w.suggest === "let go")
    .map(({ o, w }) => ({ orb: o.id, name: o.name, why: `${w.suggest === "let go" ? "no work lately" : "work sent back"}: ${w.why}` }));
  return { well, fit };
}

export class BoardReports {
  readonly #events: EventLog;
  readonly #clock: Clock;
  readonly #o: ReportOptions;
  #making: Promise<Report | null> | null = null;

  constructor(events: EventLog, clock: Clock, o: ReportOptions) {
    this.#events = events;
    this.#clock = clock;
    this.#o = o;
  }

  /** The reports sent, newest first, with each idea's verdict. */
  list(limit = 7): Report[] {
    const verdicts = new Map<string, "approved" | "passed">();
    for (const e of [...this.#events.ofType("report.idea_approved"), ...this.#events.ofType("report.idea_passed")].sort((a, b) => a.seq - b.seq)) {
      verdicts.set(String(e.data.idea), e.type === "report.idea_approved" ? "approved" : "passed");
    }
    return this.#events.ofType("report.made").slice(-limit).reverse().map((e) => {
      const d = e.data as Omit<Report, "id" | "at" | "ideas"> & { ideas: Omit<Idea, "id" | "verdict">[] };
      return { ...d, id: e.seq, at: e.at, ideas: d.ideas.map((x, i) => ({ ...x, id: `${e.seq}.${i}`, verdict: verdicts.get(`${e.seq}.${i}`) ?? null })) };
    });
  }

  /** The newest report, if one has been sent. */
  latest(): Report | null {
    return this.list(1)[0] ?? null;
  }

  /** Your verdict on an idea: approved, its orb is given XP (gym/xp.ts) and every orb hears it; or passed. Once. */
  judge(idea: string, verdict: "approved" | "passed"): Idea {
    const [seq, i] = idea.split(".").map(Number);
    const r = this.list(1000).find((x) => x.id === seq);
    const found = r?.ideas[i ?? -1];
    if (!r || !found) throw new Error(`no idea ${idea}`);
    if (found.verdict) throw new Error(`that idea is already ${found.verdict}`);
    this.#events.append(verdict === "approved" ? "report.idea_approved" : "report.idea_passed", { idea, report: r.id, text: found.text }, { orb: found.orb });
    return { ...found, verdict };
  }

  /** The ideas you approved lately, newest first, for every orb to hear (company.ts). */
  approved(limit = 3): { name: string; text: string }[] {
    return this.list(30).flatMap((r) => r.ideas.filter((x) => x.verdict === "approved")).slice(0, limit).map((x) => ({ name: x.name, text: x.text }));
  }

  /** The home's tick: today's report, from 08:00, once there is a CEO to send it. */
  due(): Promise<Report | null> | null {
    const now = this.#clock.now();
    if (this.#making || now < reportTimeOn(now)) return null;
    if (!this.#o.board().length && !this.#o.office().length) return null;
    const last = this.#events.ofType("report.made").at(-1);
    if (last && dayOf(last.at) === dayOf(now)) return null;
    return this.make();
  }

  /** When the next report is due, for the home's timer: 08:00 tomorrow once today's is sent, else 08:00 today. */
  nextAt(): number | null {
    // none while one is being made or there is no one to send it (else the home's timer would wake at once, again and again)
    if (this.#making || !this.#o.office().length) return null;
    const now = this.#clock.now();
    const last = this.#events.ofType("report.made").at(-1);
    const today = reportTimeOn(now);
    if (last && dayOf(last.at) === dayOf(now)) return reportTimeOn(now + DAY);
    return Math.max(today, now);
  }

  /** Makes and sends a report now (the tick's, or yours from the app). One at a time. */
  make(): Promise<Report | null> {
    if (this.#making) return this.#making;
    this.#making = this.#make().finally(() => (this.#making = null));
    return this.#making;
  }

  async #make(): Promise<Report | null> {
    const office = this.#o.office();
    if (!office.length) return null;
    const now = this.#clock.now();
    const last = this.#events.ofType("report.made").at(-1);
    const since = last?.at ?? now - DAY;
    const nameOf = (id: string): string => office.find((o) => o.id === id)?.name ?? this.#events.ofType("orb.added").findLast((e) => e.orb === id)?.data.name as string ?? id;
    const board = this.#o.board();
    const chair = board.find((s) => s.post === "chair") ?? null;
    const company = this.#o.company() ?? "the company";
    const founder = this.#o.founder() ?? "the Founder";

    // ideas to make money, a few orbs a day, in turn
    const asked = new Map<string, number>();
    for (const e of this.#events.ofType("report.asked")) asked.set(String(e.orb), e.at);
    const ideas: Omit<Idea, "id" | "verdict">[] = [];
    for (const o of pitchers(office, board.map((s) => s.orb), (id) => asked.get(id) ?? 0)) {
      this.#events.append("report.asked", {}, { orb: o.id });
      const prompt = `You work at ${company}, an Orb startup its Founder ${founder} runs, as its ${o.specialty === "assistant" ? "personal assistant" : o.specialty}. The board's report today asks a few colleagues for one idea each to make the company money. Give the one idea you think is best, from what your work knows: what to do, and why it would pay. Two sentences, plain words, no preamble.`;
      let text: string | null = null;
      try {
        text = readIdea(await this.#o.ask(o.id, prompt));
      } catch (e) {
        this.#events.append("report.ask_failed", { why: e instanceof Error ? e.message : String(e) }, { orb: o.id });
      }
      if (text) ideas.push({ orb: o.id, name: o.name, text });
    }

    const world = this.#o.news(since).slice(0, 6).map((n) => ({ ...n, name: nameOf(n.orb) }));
    const happened = NEWS_TYPES.flatMap((t) => this.#events.ofType(t, last?.seq ?? 0)).filter((e) => e.at > since && e.at <= now).sort((a, b) => a.seq - b.seq);
    const until = dayOf(now + 7 * DAY);
    const treasurer = board.find((s) => s.post === "treasurer")?.name ?? null;
    const h = this.#o.hiring();
    const report: Omit<Report, "id" | "at" | "ideas"> & { ideas: typeof ideas } = {
      day: dayOf(now),
      chair: chair ? { orb: chair.orb, name: chair.name } : null,
      ideas,
      world,
      office: officeNews(happened, nameOf),
      people: peopleNotes(office, this.#o.week),
      hiring: { positions: h.positions, applicants: h.applicants.map((a) => a.id), returning: h.returning.map((r) => ({ id: r.id, name: r.name, specialty: r.specialty })) },
      money: { treasurer, yesterdayUsd: this.#o.spent(reportTimeOn(now - DAY) - REPORT_HOUR * 3_600_000, reportTimeOn(now) - REPORT_HOUR * 3_600_000), weekUsd: this.#o.spent(now - 7 * DAY, now), bills: this.#o.bills(until) },
    };
    const seq = this.#events.append("report.made", report, chair ? { orb: chair.orb } : {});
    return { ...report, id: seq, at: now, ideas: ideas.map((x, i) => ({ ...x, id: `${seq}.${i}`, verdict: null })) };
  }
}
