// An orb's brand (owner, 10-14: "This is how theyre perceived as a whole around the office. not only friendships with
// single orbz, this claculates the whole ... bad relationships = worse brand, bad approved work = hit on your brand").
// A number from 0 to 100, everyone starting at 50, read by code off the log (rule 8: nothing a model says counts), in
// five parts, each with its own reach so no one part can make or break an orb alone:
//   people   how the whole office gets on with it: every colleague's friendship, an orb not met yet counting as 0, a
//            friction weighing half again what a friendship does (±25)
//   work     what you made of its work: a job you approved by how hard it was, a job corrected, an ask denied, an undo,
//            a habit promoted or rolled back, an exam cleared (±25)
//   ideas    its ideas on the board's report, approved or passed (±10)
//   helping  what it did for the others: lessons it taught that you kept, habits it passed on, reviews it gave (0 to 10)
//   record   promotions, a seat on the board, being let go or coming back, trying what is never allowed (±15)
// What it did lately counts most: work and ideas fade to half in a fortnight, the record in a month. Friendships are as
// they stand. What brand changes (social.ts, home.ts): who the others seek out and how a moment with it lands, the
// board's votes, and (a little, never over the work) who fits a team's row; an orb knows its own (its standing
// context); a notice and the board's report say when one changes band.
import type { Clock } from "../clock.ts";
import type { EventLog, HomeEvent } from "../events.ts";
import { wordOf } from "./rules.ts";

const DAY = 86_400_000;
export const BRAND_START = 50;
/** The fortnight half-life of work and ideas, the month of the record. */
export const WORK_HALF_MS = 14 * DAY;
export const RECORD_HALF_MS = 30 * DAY;
/** What one approved job is worth, by how hard it was in its own area (gym/difficulty.ts). */
export const JOB = { easy: 1, standard: 2, hard: 3, expert: 4 } as const;
export const POINTS = {
  /** A job you approved and then corrected (owner: "bad approved work = hit on your brand"). */
  corrected: -5,
  /** A job you corrected that you had not approved. */
  correctedFirst: -3,
  denied: -2, undone: -3, habitPromoted: 2, habitRolledBack: -3, examCleared: 2,
  ideaApproved: 4, ideaPassed: -1,
  lessonTaught: 3, habitShared: 3, review: 1,
  promoted: 4, seat: 4, chair: 6, letGo: -10, rehired: 2, never: -6, graduated: 3,
} as const;
export const REACH = { people: 25, work: 25, ideas: 10, helping: 10, record: 15 } as const;

/** The log's events a brand is read from. */
export const BRAND_TYPES = [
  "social.met", "social.moment", "run.started", "trace.feedback", "xp.earned", "card.resolved", "undo", "board.ticked",
  "habit.promoted", "habit.rolled_back", "exam.sat", "report.idea_approved", "report.idea_passed", "social.lesson",
  "social.lesson_kept", "orb.promoted", "orb.let_go", "orb.rehired", "tool.never", "school.graduated",
] as const;

export type BrandWord = "Office star" | "Well regarded" | "Steady" | "Mixed reviews" | "On thin ice";
export const brandWord = (n: number): BrandWord => (n >= 80 ? "Office star" : n >= 65 ? "Well regarded" : n >= 40 ? "Steady" : n >= 25 ? "Mixed reviews" : "On thin ice");

export type PartKey = keyof typeof REACH;
export type BrandPart = { key: PartKey; label: string; points: number; why: string };
export type Brand = { orb: string; score: number; word: BrandWord; parts: BrandPart[] };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const fade = (age: number, half: number): number => 0.5 ** (Math.max(0, age) / half);
const sum = (xs: number[]): number => xs.reduce((n, x) => n + x, 0);

/** An orb's brand at `at`, from the log's events (BRAND_TYPES, oldest first); `seat`, its post on the board now. */
export function brandOf(o: { orb: string; name: string; office: readonly { id: string; name: string }[]; events: readonly HomeEvent[]; at: number; seat?: string | null }): Brand {
  const { orb, at } = o;
  const seen = o.events.filter((e) => e.at <= at);
  const mine = (e: HomeEvent): boolean => e.orb === orb;

  // people: each colleague's friendship as it stands (the last meeting's or moment's number), a friction weighing more
  const last = new Map<string, number>();
  for (const e of seen) {
    if (e.type !== "social.met" && e.type !== "social.moment") continue;
    const other = e.data.a === orb ? String(e.data.b) : e.data.b === orb ? String(e.data.a) : null;
    if (other) last.set(other, Number(e.data.score) || 0);
  }
  const others = o.office.filter((x) => x.id !== orb);
  const views = others.map((x) => last.get(x.id) ?? 0);
  const people = others.length ? clamp(Math.round((sum(views.map((v) => (v < 0 ? v * 1.5 : v))) / others.length) * 0.5), -REACH.people, REACH.people) : 0;
  const words = views.map(wordOf);
  const count = (w: string): number => words.filter((x) => x === w).length;
  const peopleWhy = !last.size
    ? "It has not met the others yet."
    : [count("good friends") && plural(count("good friends"), "good friend"), count("friendly") && `${count("friendly")} friendly`, count("some friction") && plural(count("some friction"), "friction"), count("don't get along") && `${count("don't get along")} who don't get along with it`].filter(Boolean).join(", ") || "Colleagues with everyone so far.";

  // work: what you made of it, lately counting most
  const runOrb = new Map(seen.filter((e) => e.type === "run.started").map((e) => [Number(e.data.run), e.orb]));
  const tierOf = new Map(seen.filter((e) => e.type === "xp.earned" && typeof e.data.tier === "string").map((e) => [Number(e.data.source), String(e.data.tier) as keyof typeof JOB]));
  let work = 0;
  const n = { approved: 0, corrected: 0, denied: 0, undone: 0 };
  const approved = new Set<number>();
  for (const e of seen) {
    const w = fade(at - e.at, WORK_HALF_MS);
    if (e.type === "trace.feedback" && runOrb.get(Number(e.data.run)) === orb) {
      const run = Number(e.data.run);
      if (e.data.verdict === "approve" && !approved.has(run)) {
        approved.add(run);
        work += (JOB[tierOf.get(e.seq) ?? "standard"] ?? JOB.standard) * w;
        n.approved++;
      } else if (e.data.verdict !== "approve") {
        work += (approved.has(run) ? POINTS.corrected : POINTS.correctedFirst) * w;
        approved.delete(run);
        n.corrected++;
      }
    } else if (!mine(e)) continue;
    else if (e.type === "card.resolved" && e.data.status === "denied") (work += POINTS.denied * w), n.denied++;
    else if (e.type === "undo") (work += POINTS.undone * w), n.undone++;
    else if (e.type === "habit.promoted" && !e.data.shared) work += POINTS.habitPromoted * w;
    else if (e.type === "habit.rolled_back") work += POINTS.habitRolledBack * w;
    else if (e.type === "exam.sat" && e.data.accepted === true && e.data.earned === true) work += POINTS.examCleared * w;
  }
  const workPts = clamp(Math.round(work), -REACH.work, REACH.work);
  const workWhy = n.approved + n.corrected + n.denied + n.undone === 0
    ? "No work you have judged yet."
    : [n.approved && `${plural(n.approved, "job")} approved`, n.corrected && `${n.corrected} corrected`, n.denied && `${plural(n.denied, "ask")} denied`, n.undone && `${n.undone} undone`].filter(Boolean).join(", ");

  // ideas on the board's report
  let ideas = 0;
  const idea = { yes: 0, no: 0 };
  for (const e of seen) {
    if (!mine(e)) continue;
    if (e.type === "report.idea_approved") (ideas += POINTS.ideaApproved * fade(at - e.at, WORK_HALF_MS)), idea.yes++;
    else if (e.type === "report.idea_passed") (ideas += POINTS.ideaPassed * fade(at - e.at, WORK_HALF_MS)), idea.no++;
  }
  const ideasPts = clamp(Math.round(ideas), -REACH.ideas, REACH.ideas);
  const ideasWhy = idea.yes + idea.no === 0 ? "No ideas on the board's report yet." : [idea.yes && `${plural(idea.yes, "idea")} you approved`, idea.no && `${idea.no} passed`].filter(Boolean).join(", ");

  // helping the others: a lesson it taught that you kept, a habit it passed on, a review it gave
  const taught = new Map(seen.filter((e) => e.type === "social.lesson").map((e) => [Number(e.data.lesson), String(e.data.from)]));
  const help = { lessons: 0, habits: 0, reviews: 0 };
  for (const e of seen) {
    if (e.type === "social.lesson_kept" && taught.get(Number(e.data.lesson)) === orb) help.lessons++;
    else if (e.type === "habit.promoted" && (e.data.shared as { from?: string } | undefined)?.from === orb) help.habits++;
    else if (e.type === "board.ticked" && e.data.reviewer === orb) help.reviews++;
  }
  const helping = clamp(help.lessons * POINTS.lessonTaught + help.habits * POINTS.habitShared + help.reviews * POINTS.review, 0, REACH.helping);
  const helpWhy = helping === 0 ? "Nothing passed on to the others yet." : [help.lessons && `${plural(help.lessons, "lesson")} taught`, help.habits && `${plural(help.habits, "habit")} passed on`, help.reviews && `${plural(help.reviews, "review")} given`].filter(Boolean).join(", ");

  // its record: promotions, the board, let go and back, the never-allowed
  let record = o.seat === "chair" ? POINTS.chair : o.seat ? POINTS.seat : 0;
  const rec = { promoted: 0, letGo: 0, never: 0, graduated: 0 };
  for (const e of seen) {
    if (!mine(e)) continue;
    const w = fade(at - e.at, RECORD_HALF_MS);
    if (e.type === "orb.promoted") (record += POINTS.promoted), rec.promoted++;
    else if (e.type === "orb.let_go") (record += POINTS.letGo * w), rec.letGo++;
    else if (e.type === "orb.rehired") record += POINTS.rehired * w;
    else if (e.type === "tool.never") (record += POINTS.never * w), rec.never++;
    else if (e.type === "school.graduated") (record += POINTS.graduated), rec.graduated++;
  }
  const recordPts = clamp(Math.round(record), -REACH.record, REACH.record);
  const recordWhy = [o.seat && (o.seat === "chair" ? "chairs the board" : "on the board"), rec.promoted && `promoted ${rec.promoted === 1 ? "once" : `${rec.promoted} times`}`, rec.graduated && plural(rec.graduated, "diploma"), rec.letGo && `let go ${rec.letGo === 1 ? "once" : `${rec.letGo} times`}`, rec.never && `tried the never-allowed ${rec.never === 1 ? "once" : `${rec.never} times`}`].filter(Boolean).join(", ") || "Nothing on its record yet.";

  const parts: BrandPart[] = [
    { key: "people", label: `How the office gets on with ${o.name}`, points: people, why: peopleWhy },
    { key: "work", label: "Work you judged", points: workPts, why: workWhy },
    { key: "ideas", label: "Ideas on the report", points: ideasPts, why: ideasWhy },
    { key: "helping", label: "Helping the others", points: helping, why: helpWhy },
    { key: "record", label: "Its record", points: recordPts, why: recordWhy },
  ];
  const score = clamp(BRAND_START + sum(parts.map((p) => p.points)), 0, 100);
  return { orb, score, word: brandWord(score), parts };
}

/** How often the home looks for a brand that changed band. */
export const CHECK_MS = 5 * 60_000;

export type BrandOptions = {
  /** The office: the orbs in it now. */
  office: () => { id: string; name: string }[];
  /** Its post on the board now, or null. */
  seat: (orb: string) => string | null;
};

/** The office's brands, read off the log; a band change is kept as `brand.changed` (a notice, the board's report). */
export class Brands {
  readonly #events: EventLog;
  readonly #clock: Clock;
  readonly #o: BrandOptions;
  #cache: { head: number; events: HomeEvent[] } | null = null;
  #checkedAt = -Infinity;

  constructor(events: EventLog, clock: Clock, o: BrandOptions) {
    this.#events = events;
    this.#clock = clock;
    this.#o = o;
  }

  #read(): HomeEvent[] {
    const head = this.#events.head();
    if (this.#cache?.head !== head) this.#cache = { head, events: BRAND_TYPES.flatMap((t) => this.#events.ofType(t)).sort((a, b) => a.seq - b.seq) };
    return this.#cache.events;
  }

  /** An orb's brand now (or at `at`); a stranger to the office is read as one of it. */
  of(orb: string, at = this.#clock.now()): Brand {
    const office = this.#o.office();
    const name = office.find((x) => x.id === orb)?.name ?? orb;
    return brandOf({ orb, name, office, events: this.#read(), at, seat: this.#o.seat(orb) });
  }

  /** Its score at the end of each of the last `days` days, today's now last: the card's line. */
  history(orb: string, days = 14): number[] {
    const now = this.#clock.now();
    const d = new Date(now);
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return Array.from({ length: days }, (_, i) => (i === days - 1 ? now : midnight - (days - 2 - i) * DAY - 1)).map((t) => this.of(orb, t).score);
  }

  /** Every orb in the office, the best brand first. */
  all(): { orb: string; name: string; score: number; word: BrandWord }[] {
    return this.#o.office().map((x) => {
      const b = this.of(x.id);
      return { orb: x.id, name: x.name, score: b.score, word: b.word };
    }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  }

  /** For its standing context: where it stands with the office as a whole, and what moves it; none for an orb alone or
   * one nothing has moved yet. Words, never its numbers: the standing context is the cached prefix of every request, and
   * a number that moved with every run-in would make it new each time (PLAN 1.15). */
  line(orb: string): string | null {
    if (this.#o.office().length < 2) return null;
    const b = this.of(orb);
    if (b.parts.every((p) => p.points === 0)) return null;
    const best = [...b.parts].sort((x, y) => y.points - x.points)[0]!;
    const worst = [...b.parts].sort((x, y) => x.points - y.points)[0]!;
    return [
      `Your brand around the office (how the whole office sees you, kept by the home): ${b.word.toLowerCase()}.`,
      best.points > 0 ? `- It stands on: ${best.label.toLowerCase()}.` : "",
      worst.points < 0 ? `- It is held back by: ${worst.label.toLowerCase()}.` : "",
      "- Work the person approves, ideas they take, helping the others and getting on with them raise it; work they correct or deny, and friction, lower it.",
    ].filter(Boolean).join("\n");
  }

  /** The tick's: every few minutes, an orb whose brand changed band is kept as `brand.changed`. */
  due(): number {
    const now = this.#clock.now();
    if (now - this.#checkedAt < CHECK_MS) return 0;
    this.#checkedAt = now;
    const was = new Map<string, string>();
    for (const e of this.#events.ofType("brand.changed")) if (e.orb) was.set(e.orb, String(e.data.to));
    let n = 0;
    for (const x of this.#o.office()) {
      const b = this.of(x.id, now);
      const from = was.get(x.id) ?? brandWord(BRAND_START);
      if (b.word === from) continue;
      this.#events.append("brand.changed", { from, to: b.word, score: b.score, name: x.name, up: rankOf(b.word) > rankOf(from) }, { orb: x.id });
      n++;
    }
    return n;
  }
}

const BANDS: BrandWord[] = ["On thin ice", "Mixed reviews", "Steady", "Well regarded", "Office star"];
export const rankOf = (w: string): number => BANDS.indexOf(w as BrandWord);
