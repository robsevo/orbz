// The event log: everything that happens in the home, append-only, one writer, a sequence that
// only goes up. SQLite triggers refuse UPDATE and DELETE, and AUTOINCREMENT never reuses a number.
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Clock } from "./clock.ts";
import { afterCommit, parseJson } from "./db.ts";

export type HomeEvent = {
  seq: number;
  at: number;
  type: string;
  orb: string | null;
  conversation: string | null;
  data: Record<string, unknown>;
};

export type Where = { orb?: string | null; conversation?: string | null };

type Row = { seq: number; at: number; type: string; orb: string | null; conversation: string | null; data: string };

export class EventLog {
  readonly #clock: Clock;
  readonly #db: DatabaseSync;
  readonly #insert: StatementSync;
  readonly #since: StatementSync;
  readonly #ofType: StatementSync;
  #listeners = new Set<(e: HomeEvent) => void>();

  constructor(db: DatabaseSync, clock: Clock) {
    this.#clock = clock;
    this.#db = db;
    this.#insert = db.prepare(
      "INSERT INTO events (at, type, orb, conversation, data) VALUES (?, ?, ?, ?, ?) RETURNING seq",
    );
    this.#since = db.prepare("SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?");
    this.#ofType = db.prepare("SELECT * FROM events WHERE type = ? AND seq > ? ORDER BY seq");
  }

  append(type: string, data: Record<string, unknown> = {}, where: Where = {}): number {
    const at = this.#clock.now();
    const json = JSON.stringify(data);
    const row = this.#insert.get(at, type, where.orb ?? null, where.conversation ?? null, json) as { seq: number };
    const e: HomeEvent = { seq: row.seq, at, type, orb: where.orb ?? null, conversation: where.conversation ?? null, data };
    // Listeners hear it once it is on disk: inside a transaction, only after the commit.
    afterCommit(this.#db, () => {
      for (const fn of this.#listeners) {
        try {
          fn(e);
        } catch {
          // a listener (the API's event stream) must never break the writer
        }
      }
    });
    return row.seq;
  }

  since(seq = 0, limit = 1000): HomeEvent[] {
    return (this.#since.all(seq, limit) as Row[]).map(toEvent);
  }

  ofType(type: string, sinceSeq = 0): HomeEvent[] {
    return (this.#ofType.all(type, sinceSeq) as Row[]).map(toEvent);
  }

  /** Called after every append, in order. Returns an unsubscribe function. */
  listen(fn: (e: HomeEvent) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }
}

function toEvent(r: Row): HomeEvent {
  return { seq: r.seq, at: r.at, type: r.type, orb: r.orb, conversation: r.conversation, data: parseJson(r.data) };
}
