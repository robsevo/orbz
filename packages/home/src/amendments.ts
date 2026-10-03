// ✓ AGREED changes to a plan (PLAN 5.1): an orb proposes a change to an approved plan's board (a
// new feature row with its test row); it is agreed, and the board changes, only when a second party
// agrees: another orb of the session, or you. One orb alone never changes a plan the person
// approved. The plan's archived text is never edited (1.7): the board carries the amendment, and
// the agreement is a "✓ Agreed" line in the session for everyone.
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "./clock.ts";
import { tx } from "./db.ts";
import type { EventLog } from "./events.ts";

export class AmendmentError extends Error {}

export type Amendment = { id: number; session: number; plan: number; proposer: string; row: string; feature: string; description: string; test: string; agreedBy: string | null; agreedAt: number | null };
type Row = { id: number; session: number; plan: number; proposer: string; row: string; feature: string; description: string; test: string; agreed_by: string | null; agreed_at: number | null };

const ROW = /^\d+\.\d+$/;

export class Amendments {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #clock: Clock;

  constructor(db: DatabaseSync, events: EventLog, clock: Clock) {
    this.#db = db;
    this.#events = events;
    this.#clock = clock;
  }

  #of(r: Row): Amendment {
    return { id: r.id, session: r.session, plan: r.plan, proposer: r.proposer, row: r.row, feature: r.feature, description: r.description, test: r.test, agreedBy: r.agreed_by, agreedAt: r.agreed_at };
  }

  get(id: number): Amendment | null {
    const r = this.#db.prepare("SELECT * FROM amendments WHERE id = ?").get(id) as Row | undefined;
    return r ? this.#of(r) : null;
  }

  list(plan: number): Amendment[] {
    return (this.#db.prepare("SELECT * FROM amendments WHERE plan = ? ORDER BY id").all(plan) as Row[]).map((r) => this.#of(r));
  }

  /** A new feature row and its test, proposed for an approved plan's board: not agreed yet. */
  propose(o: { session: number; plan: number; proposer: string; row: string; feature: string; description: string; test: string; rows: string[] }): Amendment {
    const row = o.row.trim();
    if (!ROW.test(row)) throw new AmendmentError(`a row is numbered like 2.3, not "${o.row}"`);
    if (o.rows.includes(row)) throw new AmendmentError(`row ${row} is on the board already: a change adds a new row`);
    if (!o.feature.trim() || !o.description.trim()) throw new AmendmentError("a new row names its feature and what it does");
    if (!o.test.trim()) throw new AmendmentError(`row ${row} needs its test row: what will show it works`);
    const id = Number(
      this.#db
        .prepare("INSERT INTO amendments (session, plan, proposer, row, feature, description, test, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(o.session, o.plan, o.proposer, row, o.feature.trim().slice(0, 80), o.description.trim().slice(0, 600), o.test.trim().slice(0, 600), this.#clock.now()).lastInsertRowid,
    );
    this.#events.append("amendment.proposed", { session: o.session, plan: o.plan, id, row, proposer: o.proposer }, { orb: o.proposer });
    return this.get(id)!;
  }

  /** A second party agrees: another orb (never the one who proposed it) or you ("you"). Returns the
   * agreed amendment; `apply` puts its rows on the board in the same transaction. */
  agree(id: number, by: string, apply: (a: Amendment) => void): Amendment {
    const a = this.get(id);
    if (!a) throw new AmendmentError(`no change ${id} was proposed`);
    if (a.agreedBy) throw new AmendmentError(`change ${id} was agreed already, by ${a.agreedBy}`);
    if (by === a.proposer) throw new AmendmentError("a change needs a second: another orb of the session, or the person");
    tx(this.#db, () => {
      this.#db.prepare("UPDATE amendments SET agreed_by = ?, agreed_at = ? WHERE id = ?").run(by, this.#clock.now(), id);
      apply({ ...a, agreedBy: by });
      this.#events.append("amendment.agreed", { session: a.session, plan: a.plan, id, row: a.row, proposer: a.proposer, by }, by === "you" ? {} : { orb: by });
    });
    return this.get(id)!;
  }
}
