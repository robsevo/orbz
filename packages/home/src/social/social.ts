// Office life and friendships (PLAN 5.9): the home decides, so every device sees the same office. In the
// office's day, every 20 to 40 minutes, two free orbs meet (rules.ts: anyone with anyone): coffee and a
// talk, ideas about their kinds of work, a game, or a lesson. Each meeting moves their friendship by how
// their traits get on (the app's DNA, sent here by the app) and how it went. What it changes:
//   - an orb knows its friends and frictions (`colleaguesLine`, its standing context);
//   - who fits a team's row weighs how each gets on with the orbs already on it (`affinity`, org.ts);
//   - learning off each other stays the floor's (1.6, 3.5): a lesson one friend has and the other lacks
//     waits for your yes (`keepLesson`), and only then is it the other's.
// Written by code: no brain is asked. Events: social.met, social.friends, social.fell_out, social.lesson,
// social.lesson_kept, social.lesson_dropped.
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "../clock.ts";
import { tx } from "../db.ts";
import type { EventLog } from "../events.ts";
import {
  clampScore, compat, deltaOf, inOfficeDay, type Kind, type Moment, NEUTRAL, nextOpening, pickKind, pickMoment, pickPair, type Place, placeOf, readTraits, type Traits, winnerOf, type Word, wordOf,
} from "./rules.ts";

const MIN = 60_000;
/** The gap between two meetings: 20 to 40 minutes. */
export const GAP_MIN_MS = 20 * MIN;
export const GAP_MAX_MS = 40 * MIN;
/** How long a meeting lasts on the floor. */
export const MEETING_MS = 10 * MIN;
/** With fewer than two free, looked at again after this. */
const RETRY_MS = 5 * MIN;
/** A moment (owner, 10-07: "more micro interactions ... but not too many"): one every 6 to 12 minutes in the office's
 * day, a few seconds each, the floor's walk to it included. */
export const MOMENT_GAP_MIN_MS = 6 * MIN;
export const MOMENT_GAP_MAX_MS = 12 * MIN;
export const MOMENT_MS = 30_000;
/** What a point of friendship weighs, in XP, when who fits a team's row is ranked (org.ts). */
export const FRIEND_XP = 2;

export type Meeting = { id: number; at: number; until: number; a: string; b: string; kind: Kind; place: Place; winner: string | null; delta: number; score: number };
export type Friendship = { a: string; b: string; score: number; word: Word; meetings: number; lastAt: number | null };
/** A moment between two orbs, as the log keeps it: `a` started it. */
export type MomentEvent = Moment & { a: string; b: string; names: [string, string]; score: number; word: Word; at: number; until: number };
export type SharedLesson = { id: number; at: number; from: string; to: string; line: string; state: "waiting" | "kept" | "dropped" };

type MeetingRow = { id: number; at: number; until: number; a: string; b: string; kind: Kind; place: Place; winner: string | null; delta: number; score: number };
const pairOf = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);

export class SocialError extends Error {}

export type SocialOptions = {
  /** The office: the orbs in it now (not those let go). */
  office: () => { id: string; name: string }[];
  /** Whether an orb is free: no work queued or under way, no card waiting for the person. */
  free: (orb: string) => boolean;
  /** Its approved lessons (brain/learned.ts), and adding one (only on the person's yes). */
  learned: { list: (orb: string) => string[]; add: (orb: string, line: string) => string[] };
  /** What an orb last finished, in a sentence (worklog.ts): what it brings to an exchange of ideas. */
  workOf?: (orb: string) => string | null;
  /** The dice (tests pin them). */
  dice?: () => number;
  /** An orb's brand, 0 to 100 (PLAN 5.44, brand.ts): the others seek it out and warm to it the more they think of it. */
  regard?: (orb: string) => number;
  /** The office's culture (PLAN 5.45, culture.ts): how often run-ins come against the usual gap, and how much warmer they land. */
  pace?: () => number;
  lift?: () => number;
  /** Whether orbs meet on their own (the real home: yes; a test home: only when it says so). */
  on?: boolean;
};

export class Social {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #clock: Clock;
  readonly #o: Required<SocialOptions>;
  #retryAt = 0;
  #momentRetryAt = 0;

  constructor(db: DatabaseSync, events: EventLog, clock: Clock, o: SocialOptions) {
    this.#db = db;
    this.#events = events;
    this.#clock = clock;
    this.#o = { ...o, dice: o.dice ?? Math.random, on: o.on ?? false, workOf: o.workOf ?? (() => null), regard: o.regard ?? (() => 50), pace: o.pace ?? (() => 1), lift: o.lift ?? (() => 0) };
  }

  // ── traits, from the app ──────────────────────────────────────────────────────────────────

  /** An orb's traits as the app's DNA has them now; kept without an event (the app sends them often). */
  setTraits(orb: string, raw: unknown): Traits {
    const t = readTraits(raw);
    if (!t) throw new SocialError("traits are the seven (Pace, Care, Curiosity, Humour, Focus, Calm, Nerve), each a number from 0 to 40");
    this.#db.prepare("INSERT INTO orb_traits (orb, traits, at) VALUES (?, ?, ?) ON CONFLICT (orb) DO UPDATE SET traits = excluded.traits, at = excluded.at").run(orb, JSON.stringify(t), this.#clock.now());
    return t;
  }

  traitsOf(orb: string): Traits {
    const r = this.#db.prepare("SELECT traits FROM orb_traits WHERE orb = ?").get(orb) as { traits: string } | undefined;
    return (r && readTraits(JSON.parse(r.traits))) || NEUTRAL;
  }

  // ── friendships ───────────────────────────────────────────────────────────────────────────

  score(x: string, y: string): number {
    const [a, b] = pairOf(x, y);
    return (this.#db.prepare("SELECT score FROM friendships WHERE a = ? AND b = ?").get(a, b) as { score: number } | undefined)?.score ?? 0;
  }

  /** Every friendship in the office, the strongest (either way) first. */
  friendships(): Friendship[] {
    const office = new Set(this.#o.office().map((o) => o.id));
    return (this.#db.prepare("SELECT a, b, score, meetings, last_at AS lastAt FROM friendships ORDER BY abs(score) DESC, a, b").all() as Omit<Friendship, "word">[])
      .filter((f) => office.has(f.a) && office.has(f.b))
      .map((f) => ({ ...f, word: wordOf(f.score) }));
  }

  /** One orb's colleagues, best friends first: each with its number, its word and the last time they met. */
  of(orb: string): { orb: string; name: string; score: number; word: Word; meetings: number; last: Meeting | null }[] {
    return this.#o.office().filter((o) => o.id !== orb).map((o) => {
      const [a, b] = pairOf(orb, o.id);
      const f = this.#db.prepare("SELECT score, meetings FROM friendships WHERE a = ? AND b = ?").get(a, b) as { score: number; meetings: number } | undefined;
      const last = this.#db.prepare("SELECT * FROM meetings WHERE a = ? AND b = ? ORDER BY id DESC LIMIT 1").get(a, b) as MeetingRow | undefined;
      return { orb: o.id, name: o.name, score: f?.score ?? 0, word: wordOf(f?.score ?? 0), meetings: f?.meetings ?? 0, last: last ? { ...last } : null };
    }).sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
  }

  /** For its standing context: who it gets on with and who it rubs, in a few words; null when no one is either yet. */
  colleaguesLine(orb: string): string | null {
    const known = this.of(orb).filter((c) => Math.abs(c.score) >= 20);
    if (!known.length) return null;
    const good = known.filter((c) => c.score > 0).map((c) => `${c.name} (${c.word})`);
    const bad = known.filter((c) => c.score < 0).map((c) => `${c.name} (${c.word})`);
    return [
      "How you get on with the office (from your time together, kept by the home):",
      good.length ? `- You get on well with ${good.join(", ")}: work together easily, and say so when one of them helps.` : "",
      bad.length ? `- There is friction with ${bad.join(", ")}: stay kind and say things plainly, check what they meant before you disagree, and let the work decide.` : "",
    ].filter(Boolean).join("\n");
  }

  /** How an orb would get on with a team already working a row: its mean friendship with them. */
  affinity(orb: string, team: string[]): { score: number; why: string | null } {
    const others = team.filter((t) => t !== orb);
    if (!others.length) return { score: 0, why: null };
    const scores = others.map((o) => ({ o, s: this.score(orb, o) }));
    const score = Math.round(scores.reduce((n, x) => n + x.s, 0) / scores.length);
    const name = (id: string): string => this.#o.office().find((x) => x.id === id)?.name ?? id;
    const best = scores.filter((x) => x.s >= 20).map((x) => name(x.o));
    const worst = scores.filter((x) => x.s <= -20).map((x) => name(x.o));
    const why = [best.length ? `works well with ${best.join(" and ")}` : "", worst.length ? `some friction with ${worst.join(" and ")}` : ""].filter(Boolean).join("; ");
    return { score, why: why || null };
  }

  // ── moments (owner, 10-07: "more micro interactions ... that affect friendships that affect their mood in office, but
  // not too many") ──────────────────────────────────────────────────────────────────────────────

  /** The moments lately, newest first: who, what, how it went (the floor plays the ones under way). */
  moments(limit = 10): MomentEvent[] {
    return this.#events.ofType("social.moment").slice(-limit).reverse().map((e) => ({ ...(e.data as Omit<MomentEvent, "at">), at: e.at }));
  }

  /** When the next moment is due: 6 to 12 minutes after the last, in the office's day; none while office life is off. */
  nextMomentAt(): number | null {
    if (!this.#o.on) return null;
    const last = this.#events.ofType("social.moment").at(-1);
    // a warm culture's run-ins come oftener, a tense one's rarer (PLAN 5.45)
    const gap = (last ? MOMENT_GAP_MIN_MS + ((last.seq * 2654435761) % 1000) / 1000 * (MOMENT_GAP_MAX_MS - MOMENT_GAP_MIN_MS) : MOMENT_GAP_MIN_MS) * this.#o.pace();
    let at = Math.max(last ? last.at + Math.round(gap) : 0, this.#momentRetryAt);
    if (!inOfficeDay(Math.max(at, this.#clock.now()))) at = nextOpening(Math.max(at, this.#clock.now()));
    return at;
  }

  /** The tick's: a moment, if one is due and two orbs are free (and neither is in a meeting under way). */
  momentDue(): MomentEvent | null {
    if (!this.#o.on) return null;
    const now = this.#clock.now();
    if (now < this.nextMomentAt()! || !inOfficeDay(now)) return null;
    const m = this.moment();
    if (!m) this.#momentRetryAt = now + RETRY_MS;
    return m;
  }

  /** Two free orbs run into each other now: a line each, a gesture each, a point or two on their friendship. */
  moment(): MomentEvent | null {
    const r = this.#o.dice;
    const now = this.#clock.now();
    const office = this.#o.office();
    const meeting = new Set(this.current().flatMap((m) => [m.a, m.b]));
    const free = office.map((o) => o.id).filter((id) => this.#o.free(id) && !meeting.has(id));
    const last = this.#events.ofType("social.moment").at(-1);
    const pair = pickPair(free, (o) => this.traitsOf(o), (x, y) => this.score(x, y), last ? [String(last.data.a), String(last.data.b)] : null, r, this.#o.regard);
    if (!pair) return null;
    const [x, y] = pair;
    const m = pickMoment(this.traitsOf(x), this.traitsOf(y), r, this.#o.regard(x), this.#o.lift());
    const before = this.score(x, y);
    const after = clampScore(before + m.delta);
    const [a, b] = pairOf(x, y);
    const nameOf = (id: string): string => office.find((o) => o.id === id)?.name ?? id;
    const ev: MomentEvent = { a: x, b: y, ...m, score: after, word: wordOf(after), names: [nameOf(x), nameOf(y)], at: now, until: now + MOMENT_MS };
    tx(this.#db, () => {
      this.#db
        .prepare("INSERT INTO friendships (a, b, score, meetings, last_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT (a, b) DO UPDATE SET score = excluded.score, last_at = excluded.last_at")
        .run(a, b, after, now);
      const { at: _, ...data } = ev;
      this.#events.append("social.moment", data);
      if (before < 50 && after >= 50) this.#events.append("social.friends", { a: x, b: y, names: ev.names });
      if (before > -50 && after <= -50) this.#events.append("social.fell_out", { a: x, b: y, names: ev.names });
    });
    return ev;
  }

  // ── meetings ──────────────────────────────────────────────────────────────────────────────

  /** The meetings under way now (the floor plays them). */
  current(): Meeting[] {
    return (this.#db.prepare("SELECT * FROM meetings WHERE until > ? ORDER BY id").all(this.#clock.now()) as MeetingRow[]).map((m) => ({ ...m }));
  }

  recent(limit = 20): Meeting[] {
    return (this.#db.prepare("SELECT * FROM meetings ORDER BY id DESC LIMIT ?").all(limit) as MeetingRow[]).map((m) => ({ ...m }));
  }

  lessons(state: SharedLesson["state"] = "waiting"): SharedLesson[] {
    return (this.#db.prepare("SELECT id, at, from_orb AS \"from\", to_orb AS \"to\", line, state FROM shared_lessons WHERE state = ? ORDER BY id").all(state) as SharedLesson[]).map((l) => ({ ...l }));
  }

  /** When the next meeting is due: 20 to 40 minutes after the last one began, in the office's day (none
   * while office life is off). */
  nextAt(): number | null {
    if (!this.#o.on) return null;
    const last = this.#db.prepare("SELECT id, at FROM meetings ORDER BY id DESC LIMIT 1").get() as { id: number; at: number } | undefined;
    // the gap is the last meeting's own (from its number), so a restart keeps the office's rhythm
    const gap = last ? GAP_MIN_MS + ((last.id * 2654435761) % 1000) / 1000 * (GAP_MAX_MS - GAP_MIN_MS) : 0;
    let at = Math.max(last ? last.at + Math.round(gap) : 0, this.#retryAt);
    if (!inOfficeDay(Math.max(at, this.#clock.now()))) at = nextOpening(Math.max(at, this.#clock.now()));
    return at;
  }

  /** The tick's: a meeting, if one is due and two orbs are free. */
  due(): Meeting | null {
    if (!this.#o.on) return null;
    const now = this.#clock.now();
    if (now < this.nextAt()! || !inOfficeDay(now)) return null;
    const m = this.meet();
    if (!m) this.#retryAt = now + RETRY_MS;
    return m;
  }

  /** Two free orbs meet now (null when fewer than two are free). */
  meet(): Meeting | null {
    const r = this.#o.dice;
    const office = this.#o.office();
    const free = office.map((o) => o.id).filter((id) => this.#o.free(id));
    const lastRow = this.#db.prepare("SELECT a, b FROM meetings ORDER BY id DESC LIMIT 1").get() as { a: string; b: string } | undefined;
    const pair = pickPair(free, (o) => this.traitsOf(o), (x, y) => this.score(x, y), lastRow ? [lastRow.a, lastRow.b] : null, r, this.#o.regard);
    if (!pair) return null;
    const [x, y] = pair;
    const tx_ = this.traitsOf(x), ty = this.traitsOf(y);
    const before = this.score(x, y);
    // a lesson one has that the other lacks (and was not offered before), if they are friends
    const offered = new Set((this.#db.prepare("SELECT to_orb || char(0) || line AS k FROM shared_lessons").all() as { k: string }[]).map((r) => r.k));
    const teachable = (from: string, to: string): string | null => {
      const theirs = new Set(this.#o.learned.list(to));
      return this.#o.learned.list(from).find((l) => !theirs.has(l) && !offered.has(`${to}\0${l}`)) ?? null;
    };
    const lessonXY = teachable(x, y), lessonYX = teachable(y, x);
    const kind = pickKind(tx_, ty, { lesson: Boolean(lessonXY || lessonYX), score: before }, r);
    const place = placeOf(kind, r);
    const winner = kind === "game" ? winnerOf(x, y, tx_, ty, r) : null;
    const loser = winner ? (winner === x ? ty : tx_) : undefined;
    const delta = deltaOf(kind, compat(tx_, ty), loser ? { loser } : {}, r);
    const after = clampScore(before + delta);
    const now = this.#clock.now();
    const [a, b] = pairOf(x, y);
    const nameOf = (id: string): string => office.find((o) => o.id === id)?.name ?? id;
    const meeting = tx(this.#db, () => {
      this.#db
        .prepare("INSERT INTO friendships (a, b, score, meetings, last_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT (a, b) DO UPDATE SET score = excluded.score, meetings = meetings + 1, last_at = excluded.last_at")
        .run(a, b, after, now);
      const m = this.#db
        .prepare("INSERT INTO meetings (at, until, a, b, kind, place, winner, delta, score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *")
        .get(now, now + MEETING_MS, x, y, kind, place, winner, delta, after) as MeetingRow;
      // ideas: what each brought, its own latest work (owner, 10-07: "what are those ideas?"), by code
      const ideas = kind === "ideas" ? [x, y].map((o) => ({ orb: o, text: this.#o.workOf(o) })).filter((i) => i.text) : [];
      this.#events.append("social.met", { meeting: m.id, a: x, b: y, kind, place, winner, delta, score: after, word: wordOf(after), until: m.until, ...(ideas.length && { ideas }) });
      if (before < 50 && after >= 50) this.#events.append("social.friends", { a: x, b: y, names: [nameOf(x), nameOf(y)] });
      if (before > -50 && after <= -50) this.#events.append("social.fell_out", { a: x, b: y, names: [nameOf(x), nameOf(y)] });
      if (kind === "lesson") {
        const [from, to, line] = lessonXY ? [x, y, lessonXY] : [y, x, lessonYX!];
        const l = this.#db.prepare("INSERT INTO shared_lessons (at, from_orb, to_orb, line, state) VALUES (?, ?, ?, ?, 'waiting') RETURNING id").get(now, from, to, line) as { id: number };
        // learning a lesson is the floor's (1.6, 3.5): it waits for the person's yes
        this.#events.append("social.lesson", { lesson: l.id, from, to, line, names: [nameOf(from), nameOf(to)] });
      }
      return { ...m };
    });
    this.#retryAt = 0;
    return meeting;
  }

  /** Your yes: the lesson is the other orb's now. */
  keepLesson(id: number): string[] {
    const l = this.#db.prepare("SELECT to_orb, line, state FROM shared_lessons WHERE id = ?").get(id) as { to_orb: string; line: string; state: string } | undefined;
    if (!l || l.state !== "waiting") throw new SocialError("no lesson by that number is waiting");
    const kept = this.#o.learned.add(l.to_orb, l.line);
    this.#db.prepare("UPDATE shared_lessons SET state = 'kept', settled_at = ? WHERE id = ?").run(this.#clock.now(), id);
    this.#events.append("social.lesson_kept", { lesson: id }, { orb: l.to_orb });
    return kept;
  }

  /** Your no: it is not learned. */
  dropLesson(id: number): void {
    const l = this.#db.prepare("SELECT to_orb, state FROM shared_lessons WHERE id = ?").get(id) as { to_orb: string; state: string } | undefined;
    if (!l || l.state !== "waiting") throw new SocialError("no lesson by that number is waiting");
    this.#db.prepare("UPDATE shared_lessons SET state = 'dropped', settled_at = ? WHERE id = ?").run(this.#clock.now(), id);
    this.#events.append("social.lesson_dropped", { lesson: id }, { orb: l.to_orb });
  }
}
