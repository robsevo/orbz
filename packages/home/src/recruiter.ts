// The recruiter (PLAN 5.8; owner, 10-03: "recruiter section should show us random new orbs who have
// applied to our company for positions we are looking for which we tick off in that section").
// You tick the positions you are hiring for; each day a few new orbs apply for each one, and the
// list turns over once a day (owner, 10-06: "we want the recuiter section to refresh with new
// combinations once a day"): at the day's turn whoever you left unanswered takes another job and
// today's apply, new people from new seeds. An applicant is a seed: the app's dice (spec.ts
// `applicant`) make his look, name, personality and voice from it, the same on every device, and
// the home keeps the seed, so a reload or another device sees the same people. Interview him if you
// like (owner: "add the interview part for fun"): a chat in which he answers as himself, with no
// tools; the brain is asked only while you interview. Hire brings him in as he applied, his
// interview his first chat; Pass sends him on. One you have begun to interview waits for your
// answer through the turn, a week at most. Orbs you let go apply again for their old kind of work,
// with their record (Home.recruiting).
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { SPECIALTY_FAMILIES, type Specialty } from "./brain/constitution.ts";
import type { Clock } from "./clock.ts";
import { tx } from "./db.ts";
import type { EventLog } from "./events.ts";

/** New applicants each day for each open position. */
export const PER_DAY = 2;
/** One you have begun to interview waits this long for your answer; the rest go at the day's turn. */
export const WAIT_DAYS = 7;
const DAY_MS = 86_400_000;

export type Applicant = { id: number; specialty: Specialty; seed: number; day: string; createdAt: number };
export type Said = { role: "you" | "orb"; text: string; at: number };

type Row = { id: number; specialty: string; seed: number; day: string; created_at: number };

/** The day as the home's clock reads it where it runs: "2026-10-03". */
export function dayOf(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** An applicant's seed, by code: the same day and position give the same people. */
export function seedOf(day: string, specialty: string, n: number): number {
  return Number.parseInt(createHash("sha256").update(`${day}|${specialty}|${n}`).digest("hex").slice(0, 8), 16) % 1_000_000;
}

export class RecruiterError extends Error {}

export class Recruiter {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #clock: Clock;
  #turned: string | null = null; // the day the tick last turned the list over

  constructor(db: DatabaseSync, events: EventLog, clock: Clock) {
    this.#db = db;
    this.#events = events;
    this.#clock = clock;
  }

  /** The positions you are hiring for, in the order you opened them. */
  positions(): Specialty[] {
    return (this.#db.prepare("SELECT specialty FROM positions ORDER BY opened_at, specialty").all() as { specialty: string }[]).map((r) => r.specialty as Specialty);
  }

  /** Ticks a position, or unticks it (its applicants wait on, out of sight, until it opens again the same day or the day turns). */
  setPosition(specialty: string, open: boolean): Specialty[] {
    return this.setPositions([specialty], open);
  }

  /** Ticks or unticks several at once (owner, 10-07: "an all filter so if were looking for all positions, we
   * can see everything instead of clicking"): every name is checked first, so one that is not a kind of
   * work changes none. */
  setPositions(specialties: string[], open: boolean): Specialty[] {
    for (const s of specialties) if (!(s in SPECIALTY_FAMILIES)) throw new RecruiterError(`"${s}" is not a kind of work`);
    tx(this.#db, () => {
      const was = new Set<string>(this.positions());
      for (const specialty of new Set(specialties)) {
        if (open && !was.has(specialty)) {
          this.#db.prepare("INSERT INTO positions (specialty, opened_at) VALUES (?, ?)").run(specialty, this.#clock.now());
          this.#events.append("position.opened", { specialty });
        } else if (!open && was.has(specialty)) {
          this.#db.prepare("DELETE FROM positions WHERE specialty = ?").run(specialty);
          this.#events.append("position.closed", { specialty });
        }
      }
    });
    return this.positions();
  }

  /** Who is applying now, for the open positions: the list turned over if the day has turned. */
  applicants(): Applicant[] {
    this.#turn();
    const open = new Set<string>(this.positions());
    return (this.#db.prepare("SELECT id, specialty, seed, day, created_at FROM applicants WHERE state = 'waiting' ORDER BY created_at, id").all() as Row[])
      .filter((r) => open.has(r.specialty))
      .map((r) => ({ id: r.id, specialty: r.specialty as Specialty, seed: r.seed, day: r.day, createdAt: r.created_at }));
  }

  /** When the list next turns over: midnight where the home runs. */
  nextAt(): number {
    const d = new Date(this.#clock.now());
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  }

  /** The tick's: the day's turn as it comes, so an open Recruiter shows the new applicants without
   * anyone asking (the room reloads on their events). */
  due(): void {
    if (this.#turned === dayOf(this.#clock.now())) return;
    this.#turn();
  }

  /** The day's turn (once a day, whoever looks first or the tick): anyone left unanswered from an
   * earlier day takes another job (one you have begun to interview, after a week), and today's
   * applicants for each open position apply, if they have not yet. */
  #turn(): void {
    const now = this.#clock.now();
    const day = dayOf(now);
    tx(this.#db, () => {
      const stale = this.#db
        .prepare("SELECT id FROM applicants WHERE state = 'waiting' AND (created_at <= ? OR (day < ? AND id NOT IN (SELECT applicant FROM interviews)))")
        .all(now - WAIT_DAYS * DAY_MS, day) as { id: number }[];
      for (const { id } of stale) {
        this.#db.prepare("UPDATE applicants SET state = 'gone', settled_at = ? WHERE id = ?").run(now, id);
        this.#events.append("applicant.gone", { applicant: id });
      }
      for (const specialty of this.positions()) {
        const today = (this.#db.prepare("SELECT count(*) AS n FROM applicants WHERE specialty = ? AND day = ?").get(specialty, day) as { n: number }).n;
        if (today > 0) continue; // today's came already
        for (let n = 0; n < PER_DAY; n++) {
          const r = this.#db.prepare("INSERT INTO applicants (specialty, seed, day, created_at, state) VALUES (?, ?, ?, ?, 'waiting') RETURNING id").get(specialty, seedOf(day, specialty, n), day, now) as { id: number };
          this.#events.append("applicant.applied", { applicant: r.id, specialty });
        }
      }
    });
    this.#turned = day;
  }

  /** One applicant still waiting. */
  waiting(id: number): Applicant {
    const r = this.#db.prepare("SELECT id, specialty, seed, day, created_at FROM applicants WHERE id = ? AND state = 'waiting'").get(id) as Row | undefined;
    if (!r) throw new RecruiterError("no one by that number is waiting");
    return { id: r.id, specialty: r.specialty as Specialty, seed: r.seed, day: r.day, createdAt: r.created_at };
  }

  /** Pass: he goes on his way. */
  pass(id: number): void {
    this.waiting(id);
    this.#db.prepare("UPDATE applicants SET state = 'passed', settled_at = ? WHERE id = ?").run(this.#clock.now(), id);
    this.#events.append("applicant.passed", { applicant: id });
  }

  /** Hired: he joined as `orb`. */
  hired(id: number, orb: string): void {
    this.waiting(id);
    this.#db.prepare("UPDATE applicants SET state = 'hired', orb = ?, settled_at = ? WHERE id = ?").run(orb, this.#clock.now(), id);
    this.#events.append("applicant.hired", { applicant: id }, { orb });
  }

  /** What was said in his interview, in order. */
  interview(id: number): Said[] {
    return (this.#db.prepare("SELECT role, text, at FROM interviews WHERE applicant = ? ORDER BY id").all(id) as Said[]).map((r) => ({ role: r.role, text: r.text, at: r.at }));
  }

  /** A line of his interview kept. */
  say(id: number, role: Said["role"], text: string): void {
    this.#db.prepare("INSERT INTO interviews (applicant, role, text, at) VALUES (?, ?, ?, ?)").run(id, role, text, this.#clock.now());
  }
}

/** Who he is in his interview: himself, as the app's dice made him; no tools, only talk. */
export function interviewSystem(who: { name: string; title: string; focus: string; tone: string }): string {
  return [
    `You are ${who.name}, an orb (an AI character) applying for a job as a ${who.title} (${who.focus}) in the person's office of orbs. This is your interview, and the person is interviewing you.`,
    `Answer as yourself, in your own manner (${who.tone}), in two or three sentences: warmly, honestly, with a little of who you are.`,
    "You have no tools and no computer yet: you can only talk. Do not offer to do work before you are hired, and never claim to have done something.",
  ].join(" ");
}
