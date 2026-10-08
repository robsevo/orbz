// The board's daily report (PLAN 5.18; owner, 10-07: "The board also sends you a status report every day about ideas
// they think are great for the startup to make money, news around the world, news around the office, if we feel like
// someones not a fit or if theyre doing good. best new candidates to hire for the day, thingslike that. expand, we need
// to know where the idea comes from too as well(which orb in the office, so they get xp if we approve it)").
//
// Once a day, from 08:00, the board's Chair (the CEO) sends you one report:
//   - ideas to make money, each from a named orb, asked of the cheapest brain; a few orbs a day, in turn, so everyone
//     is asked; one you approve gives its orb XP (gym/xp.ts hears `report.idea_approved`), and the orbs hear it. Since
//     10-08 (PLAN 5.20; owner: "we have to keep in mind that the user may not have any money to start with. so ask how
//     much they are willing to spend on infrastructure etc."), each pitch is told what the company can spend (never
//     said is nothing), who is in the office and the ideas approved and passed, and comes in four lines (the idea, who
//     pays, what it costs, the first step); its costs are read by code, and one that costs more than the company can
//     spend, or does not say, is asked again once, then left out (the report says how many);
//   - the world: what the reading library (PLAN 3.12) brought in since the last report, each with the orb who follows it;
//   - the office: who joined and left, promotions, the board's elections and decisions, friendships, habits learned,
//     the jobs each finished, by code from the log;
//   - people: who is doing well and who may not be a fit, by code from each orb's week (gym/performance.ts), never a
//     model's opinion (CLAUDE.md rule 8);
//   - hiring: today's applicants and who is applying again, for the app to rank by fit (orb/fit.ts);
//   - money: what the brain cost yesterday and this week, and the bills coming up, kept by the CFO.
// Kept as events (report.*), so the log replays to the same reports. The office's own news is never asked of a model.
import { budgetLine, dollars, type Budget } from "./about.ts";
import type { Clock } from "./clock.ts";
import type { EventLog, HomeEvent } from "./events.ts";

const DAY = 86_400_000;
/** When the day's report goes out: 08:00, an hour into the office's day. */
export const REPORT_HOUR = 8;
/** How many orbs are asked for an idea each day. */
export const PITCHERS = 3;

/** An idea: its orb's, in its words; who pays, what it costs (whole dollars, inside the budget), the first step. A report
 * from before 10-08 has the words alone. */
export type Idea = {
  id: string; orb: string; name: string; text: string; verdict: "approved" | "passed" | null;
  who?: string | null; start?: number; month?: number; first?: string | null;
};
export type NewsItem = { title: string; url: string; host: string; orb: string; name: string };
export type OfficeItem = { text: string; orb: string | null };
export type PersonNote = { orb: string; name: string; why: string };
export type Report = {
  id: number; at: number; day: string;
  chair: { orb: string; name: string } | null;
  ideas: Idea[];
  /** Pitches left out: they cost more than the company can spend, or did not say what they cost (none before 10-08). */
  left?: number;
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
  /** What the company can spend (about.ts); null, never said: nothing. */
  budget: () => Budget | null;
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

/** What a pitch says it costs: whole dollars to start and each month, null where it does not say. */
export type Costs = { start: number | null; month: number | null };
/** A pitch as read by code: the idea, who pays, what it costs, the first step. */
export type Pitch = { text: string; who: string | null; costs: Costs; first: string | null };

/** What a pitch's Costs line says, by code: the first amount it gives to start and the first it gives a month. "Free"
 * and "nothing" are $0; an amount a year is paid at the start; one per sale comes out of what it earns, so it is no
 * cost here; a range, its top. Said for one and not the other, the other is nothing; for neither, both unknown. */
export function costsOf(raw: string | null): Costs {
  if (!raw) return { start: null, month: null };
  const s = ` ${raw.toLowerCase()} `.replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/\b(free|nothing|none|zero|no cost|no money)\b/g, "$$0");
  let start: number | null = null;
  let month: number | null = null;
  for (const m of s.matchAll(/\$\s?(\d+(?:\.\d+)?)\s*(k\b)?(?:\s*(?:-|–|to)\s*\$?\s?(\d+(?:\.\d+)?)\s*(k\b)?)?/g)) {
    const top = Number(m[3] ?? m[1]) * ((m[3] ? m[4] : m[2]) ? 1000 : 1);
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 24);
    if (/^\s*(?:\/\s*|a |an |per |each |every )?(?:sale|order|transaction|user|customer|signup|booking)s?\b/.test(after)) continue;
    if (/^\s*(?:\/\s*(?:mo|month)\b|(?:a|per|each|every) month\b|monthly\b|\/m\b|pm\b)/.test(after)) month ??= Math.round(top);
    else start ??= Math.round(top); // to start, up front, once, a year (paid at the start), or said plainly
  }
  return start === null && month === null ? { start: null, month: null } : { start: start ?? 0, month: month ?? 0 };
}

const LABEL = /^(idea|who pays|costs?|first step)\s*[:\-–—]\s*(.*)$/i;

/** A pitch read by code: the four lines asked for (Idea, Who pays, Costs, First step), each running on until the next;
 * from a brain that did not keep to them, the whole answer as the idea and its costs unknown. Null: no idea in it. */
export function readPitch(raw: string | null): Pitch | null {
  const parts: Record<string, string[]> = {};
  const loose: string[] = [];
  let at: string | null = null;
  for (const line of (raw ?? "").split(/\r?\n/)) {
    const l = line.replace(/\*\*|__/g, "").replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (!l) continue;
    const m = LABEL.exec(l);
    if (m) (parts[(at = m[1]!.toLowerCase().replace(/^cost$/, "costs"))] ??= []).push(m[2]!);
    else (at ? parts[at]! : loose).push(l);
  }
  const text = readIdea((parts.idea ?? loose).join(" "));
  if (!text) return null;
  const said = (k: string): string | null => {
    const s = (parts[k] ?? []).join(" ").replace(/\s+/g, " ").trim();
    return !s ? null : s.length > 200 ? `${s.slice(0, 199).replace(/\s+\S*$/, "")}…` : s;
  };
  return { text, who: said("who pays"), costs: costsOf(parts.costs ? parts.costs.join(" ") : null), first: said("first step") };
}

/** Why a pitch cannot be kept as it is: it does not say what it costs, or costs more than the company can spend (never
 * said: nothing); null, it fits. */
export function overBy(p: Pitch, budget: Budget | null): string | null {
  const cap = budget ?? { start: 0, month: 0 };
  const { start, month } = p.costs;
  if (start === null || month === null) return "does not say what it costs";
  if (start > cap.start || month > cap.month) return `costs ${dollars(start)} to start and ${dollars(month)} a month, more than the company can spend`;
  return null;
}

/** Each kind of work in words, for a pitch: an officer by its post, anyone else by its kind of work. */
const WORDS: Record<string, string> = { ceo: "CEO", cfo: "CFO", coo: "COO", cto: "CTO", cmo: "CMO", chiefofstaff: "Chief of Staff", assistant: "personal assistant", qa: "QA", ai: "AI", factcheck: "fact-checking", fundamentals: "stocks and crypto analysis" };
const kindWords = (specialty: string): string => WORDS[specialty] ?? specialty;

/** What one orb is asked for its idea (PLAN 5.18, 5.20): what the company can spend and what that asks of an idea, who
 * is in the office, the ideas you approved and passed, and the four lines a pitch comes in. */
export function pitchPrompt(o: { company: string; founder: string; me: ReportOrb; office: readonly ReportOrb[]; budget: Budget | null; approved: readonly string[]; passed: readonly string[] }): string {
  const free = !o.budget || (o.budget.start === 0 && o.budget.month === 0);
  return [
    `You work at ${o.company}, an Orb startup its Founder ${o.founder} runs; your part in it: ${kindWords(o.me.specialty)}. The board's report today asks a few colleagues for one idea each to make the company money.`,
    `${budgetLine(o.budget, o)} ${free ? "The idea has to start free: free tools and free tiers only, and the office's own work; it earns before it buys anything." : "The idea has to fit inside that, and costing less is better."}`,
    `The office: ${o.office.map((w) => `${w.name} (${kindWords(w.specialty)})`).join(", ")}. Pitch work these orbs can do.`,
    o.approved.length ? `${o.founder} approved these already, and the office works toward them: ${o.approved.map((x) => `"${x}"`).join("; ")}.` : "",
    o.passed.length ? `${o.founder} passed these, so never pitch them again: ${o.passed.map((x) => `"${x}"`).join("; ")}.` : "",
    "Give the one idea you think is best, from what your work knows: something the office can start this week. Answer in these four lines, plain words, nothing before or after:",
    "Idea: what to do, in one or two sentences.",
    "Who pays: who pays for it, and about how much.",
    "Costs: $_ to start, $_ a month, before it earns anything.",
    "First step: what the office does first, this week.",
  ].filter(Boolean).join("\n");
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

    // ideas to make money, a few orbs a day, in turn: each told what the company can spend, who is in the office, and
    // what you approved and passed lately
    const asked = new Map<string, number>();
    for (const e of this.#events.ofType("report.asked")) asked.set(String(e.orb), e.at);
    const budget = this.#o.budget();
    const lately = this.list(30).flatMap((r) => r.ideas);
    const approved = lately.filter((x) => x.verdict === "approved").slice(0, 5).map((x) => x.text);
    const passed = lately.filter((x) => x.verdict === "passed").slice(0, 5).map((x) => x.text);
    const ideas: Omit<Idea, "id" | "verdict">[] = [];
    let left = 0;
    for (const o of pitchers(office, board.map((s) => s.orb), (id) => asked.get(id) ?? 0)) {
      this.#events.append("report.asked", {}, { orb: o.id });
      const prompt = pitchPrompt({ company, founder, me: o, office, budget, approved, passed });
      let kept: Pitch | null = null;
      try {
        const first = readPitch(await this.#o.ask(o.id, prompt));
        const why = first && overBy(first, budget);
        if (first && !why) kept = first;
        else if (first && why) {
          // asked again, once: an idea the company cannot pay for, or one that does not say, is no use to you
          const again = readPitch(await this.#o.ask(o.id, `${prompt}\n\nYour idea, "${first.text}", ${why}. Answer again in the same four lines, with an idea that fits what the company can spend.`));
          const still = again ? overBy(again, budget) : "is no idea";
          if (again && !still) kept = again;
          else {
            left++;
            this.#events.append("report.left_out", { why: still, text: again?.text ?? first.text }, { orb: o.id });
          }
        }
      } catch (e) {
        this.#events.append("report.ask_failed", { why: e instanceof Error ? e.message : String(e) }, { orb: o.id });
      }
      if (kept) ideas.push({ orb: o.id, name: o.name, text: kept.text, who: kept.who, start: kept.costs.start!, month: kept.costs.month!, first: kept.first });
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
      left,
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
