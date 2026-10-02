// Schedules (PLAN 1.2). croner reads the cron pattern; the home decides when a schedule is due, by
// comparing its last due time with the wall clock, so a computer that slept through 03:00, 04:00
// and 05:00 runs the job once on waking (told what it missed) instead of skipping it, as Open Dot
// does. A schedule never overlaps itself: while one of its runs is waiting or working, newer due
// times fold into that one. Each schedule talks in its own conversation, from a fresh context.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Cron } from "croner";
import type { Clock } from "./clock.ts";
import { tx } from "./db.ts";
import type { EventLog } from "./events.ts";
import { type Inboxes, UnknownOrbError } from "./inbox.ts";

export type Schedule = {
  id: string;
  orb: string;
  name: string;
  cron: string;
  timezone: string;
  instruction: string;
  enabled: boolean;
  lastDue: number;
};

type Row = {
  id: string;
  orb: string;
  name: string;
  cron: string;
  timezone: string;
  instruction: string;
  enabled: number;
  last_due: number;
};

/** More missed due times than this are reported as "at least" this many. */
const COUNT_CAP = 10_000;

export const scheduleConversation = (id: string): string => `schedule:${id}`;

export class Schedules {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #inbox: Inboxes;
  readonly #clock: Clock;

  constructor(db: DatabaseSync, events: EventLog, inbox: Inboxes, clock: Clock) {
    this.#db = db;
    this.#events = events;
    this.#inbox = inbox;
    this.#clock = clock;
  }

  /** A new schedule is due from now on; it never runs for times before it existed. */
  add(s: { orb: string; name: string; cron: string; instruction: string; timezone?: string }): Schedule {
    if (!this.#inbox.orb(s.orb)) throw new UnknownOrbError(s.orb);
    const timezone = s.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    cronOf(s.cron, timezone); // throws on a pattern croner cannot read
    const id = randomUUID();
    const now = this.#clock.now();
    tx(this.#db, () => {
      this.#db
        .prepare(
          "INSERT INTO schedules (id, orb, name, cron, timezone, instruction, last_due, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(id, s.orb, s.name, s.cron, timezone, s.instruction, now, now);
      this.#events.append("schedule.added", { schedule: id, name: s.name, cron: s.cron, timezone }, { orb: s.orb });
    });
    return this.get(id)!;
  }

  get(id: string): Schedule | undefined {
    const r = this.#db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as Row | undefined;
    return r && toSchedule(r);
  }

  list(orb?: string): Schedule[] {
    const rows = (
      orb === undefined
        ? this.#db.prepare("SELECT * FROM schedules ORDER BY created_at").all()
        : this.#db.prepare("SELECT * FROM schedules WHERE orb = ? ORDER BY created_at").all(orb)
    ) as Row[];
    return rows.map(toSchedule);
  }

  /** Turning a schedule back on starts it from now, so it does not run for the time it was off. */
  setEnabled(id: string, enabled: boolean): void {
    const s = this.get(id);
    if (!s || s.enabled === enabled) return;
    tx(this.#db, () => {
      this.#db
        .prepare("UPDATE schedules SET enabled = ?, last_due = ? WHERE id = ?")
        .run(enabled ? 1 : 0, enabled ? this.#clock.now() : s.lastDue, id);
      this.#events.append(enabled ? "schedule.enabled" : "schedule.disabled", { schedule: id }, { orb: s.orb });
    });
  }

  /** A schedule that runs at a time of day runs at another (the calendar's edit, PLAN 2.12): its
   * minute and hour change, its days do not; it is due from now on at the new time. */
  setTime(id: string, hour: number, minute: number): Schedule {
    const s = this.get(id);
    if (!s) throw new Error(`no schedule ${id}`);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error("a time is 00:00 to 23:59");
    const f = s.cron.trim().split(/\s+/);
    if (f.length !== 5 || !/^\d+$/.test(f[0]!) || !/^\d+$/.test(f[1]!)) throw new Error(`"${s.cron}" does not run at one time of day: change it in its own words`);
    const cron = [String(minute), String(hour), ...f.slice(2)].join(" ");
    cronOf(cron, s.timezone);
    this.#db.prepare("UPDATE schedules SET cron = ?, last_due = ? WHERE id = ?").run(cron, this.#clock.now(), id);
    this.#events.append("schedule.changed", { schedule: id, from: s.cron, to: cron }, { orb: s.orb });
    return this.get(id)!;
  }

  remove(id: string): void {
    const s = this.get(id);
    if (!s) return;
    tx(this.#db, () => {
      this.#db.prepare("DELETE FROM schedules WHERE id = ?").run(id);
      this.#events.append("schedule.removed", { schedule: id }, { orb: s.orb });
    });
  }

  /** Queues every schedule whose due time has passed. Returns how many were queued. */
  due(): number {
    const now = this.#clock.now();
    let queued = 0;
    for (const s of this.list()) {
      if (!s.enabled) continue;
      const missedTimes = dueSince(s.cron, s.timezone, s.lastDue, now);
      if (!missedTimes) continue;
      const { due, count } = missedTimes;
      const conversation = scheduleConversation(s.id);
      const facts = { schedule: s.id, due, count, late_ms: now - due };
      tx(this.#db, () => {
        this.#db.prepare("UPDATE schedules SET last_due = ? WHERE id = ?").run(due, s.id);
        if (this.#inbox.open(conversation) > 0) {
          this.#events.append("schedule.folded", facts, { orb: s.orb, conversation });
          return;
        }
        const missed = count - 1;
        const note =
          missed === 0
            ? ""
            : `\n\n(The computer was off or asleep: ${count >= COUNT_CAP ? "at least " : ""}${missed} earlier run${missed === 1 ? " was" : "s were"} missed and folded into this one.)`;
        this.#inbox.enqueue(s.orb, conversation, "schedule", `[Schedule: ${s.name}] ${s.instruction}${note}`, {
          data: { schedule: s.id, due, missed },
          fresh: true,
        });
        this.#events.append("schedule.fired", facts, { orb: s.orb, conversation });
        queued++;
      });
    }
    return queued;
  }

  /** The wall-clock time of the next due schedule, or null if none is waiting. */
  nextDueAt(): number | null {
    let soonest: number | null = null;
    for (const s of this.list()) {
      if (!s.enabled) continue;
      const t = cronOf(s.cron, s.timezone).nextRun(new Date(s.lastDue))?.getTime();
      if (t !== undefined && (soonest === null || t < soonest)) soonest = t;
    }
    return soonest;
  }
}

export function cronOf(pattern: string, timezone: string): Cron {
  return new Cron(pattern, { paused: true, timezone });
}

/** The latest due time in (lastDue, now] and how many due times that range held, or null if none. */
export function dueSince(
  pattern: string,
  timezone: string,
  lastDue: number,
  now: number,
): { due: number; count: number } | null {
  const cron = cronOf(pattern, timezone);
  const first = cron.nextRun(new Date(lastDue));
  if (!first || first.getTime() > now) return null;
  let latest = first;
  let count = 1;
  while (count < COUNT_CAP) {
    const next = cron.nextRun(latest);
    if (!next || next.getTime() > now) break;
    latest = next;
    count++;
  }
  return { due: latest.getTime(), count };
}

function toSchedule(r: Row): Schedule {
  return {
    id: r.id,
    orb: r.orb,
    name: r.name,
    cron: r.cron,
    timezone: r.timezone,
    instruction: r.instruction,
    enabled: r.enabled === 1,
    lastDue: r.last_due,
  };
}
