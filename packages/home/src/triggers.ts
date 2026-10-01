// Triggers (PLAN 1.2): an orb runs an instruction when something happens (a new email, a file
// lands, a calendar change). Open Dot listens to a live subscription, so whatever happens while
// the Mac sleeps is lost. Here every source can be asked "what happened after this cursor?", the
// cursor is saved with the work it produced, and the home asks again right after waking, so
// nothing is skipped and nothing runs twice. Each trigger has its own conversation; every run
// starts from a fresh context.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "./clock.ts";
import { parseJson, tx } from "./db.ts";
import type { EventLog } from "./events.ts";
import { type Inboxes, UnknownOrbError } from "./inbox.ts";

export type TriggerEvent = {
  /** Unique within its source; a repeat is ignored. */
  id: string;
  /** When it happened (wall-clock ms). */
  at: number;
  /** One line for the orb ("New email from Dana: Invoice #42"). */
  summary: string;
  data?: Record<string, unknown>;
};

export interface TriggerSource {
  /**
   * What happened after `cursor`, oldest first, and the cursor to continue from. `cursor` is null
   * on a trigger's first poll: return no history then, only a cursor for "now".
   */
  poll(config: Record<string, unknown>, cursor: string | null): Promise<{ events: TriggerEvent[]; cursor: string | null }>;
  /** How often to ask while awake. The home also asks right after waking. */
  everyMs: number;
}

export type Trigger = {
  id: string;
  orb: string;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  instruction: string;
  enabled: boolean;
  cursor: string | null;
  started: boolean;
  polledAt: number | null;
};

type Row = {
  id: string;
  orb: string;
  name: string;
  kind: string;
  config: string;
  instruction: string;
  enabled: number;
  cursor: string | null;
  started: number;
  polled_at: number | null;
};

/** How much of an event's data the orb is shown. */
const DATA_CHARS = 6000;

export const triggerConversation = (id: string): string => `trigger:${id}`;

export class Triggers {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #inbox: Inboxes;
  readonly #clock: Clock;
  readonly #sources = new Map<string, TriggerSource>();
  readonly #polling = new Set<string>();

  constructor(db: DatabaseSync, events: EventLog, inbox: Inboxes, clock: Clock) {
    this.#db = db;
    this.#events = events;
    this.#inbox = inbox;
    this.#clock = clock;
  }

  /** Makes a kind of trigger available ("imap", "folder", …). */
  register(kind: string, source: TriggerSource): void {
    this.#sources.set(kind, source);
  }

  add(t: { orb: string; name: string; kind: string; instruction: string; config?: Record<string, unknown> }): Trigger {
    if (!this.#inbox.orb(t.orb)) throw new UnknownOrbError(t.orb);
    if (!this.#sources.has(t.kind)) throw new Error(`no trigger source "${t.kind}"`);
    const id = randomUUID();
    tx(this.#db, () => {
      this.#db
        .prepare("INSERT INTO triggers (id, orb, name, kind, config, instruction, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(id, t.orb, t.name, t.kind, JSON.stringify(t.config ?? {}), t.instruction, this.#clock.now());
      this.#events.append("trigger.added", { trigger: id, name: t.name, kind: t.kind }, { orb: t.orb });
    });
    return this.get(id)!;
  }

  get(id: string): Trigger | undefined {
    const r = this.#db.prepare("SELECT * FROM triggers WHERE id = ?").get(id) as Row | undefined;
    return r && toTrigger(r);
  }

  list(orb?: string): Trigger[] {
    const rows = (
      orb === undefined
        ? this.#db.prepare("SELECT * FROM triggers ORDER BY created_at").all()
        : this.#db.prepare("SELECT * FROM triggers WHERE orb = ? ORDER BY created_at").all(orb)
    ) as Row[];
    return rows.map(toTrigger);
  }

  setEnabled(id: string, enabled: boolean): void {
    const t = this.get(id);
    if (!t || t.enabled === enabled) return;
    tx(this.#db, () => {
      this.#db.prepare("UPDATE triggers SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
      this.#events.append(enabled ? "trigger.enabled" : "trigger.disabled", { trigger: id }, { orb: t.orb });
    });
  }

  remove(id: string): void {
    const t = this.get(id);
    if (!t) return;
    tx(this.#db, () => {
      this.#db.prepare("DELETE FROM triggers WHERE id = ?").run(id);
      this.#db.prepare("DELETE FROM trigger_seen WHERE trigger = ?").run(id);
      this.#events.append("trigger.removed", { trigger: id }, { orb: t.orb });
    });
  }

  /** A source that pushes (a live subscription) hands its event over here; a repeat is ignored. */
  fire(id: string, event: TriggerEvent): boolean {
    const t = this.get(id);
    if (!t || !t.enabled) return false;
    return tx(this.#db, () => this.#deliver(t, event));
  }

  /** Asks every enabled trigger that is due (or all of them, after waking) what happened. */
  async poll(opts: { all?: boolean } = {}): Promise<number> {
    const now = this.#clock.now();
    const due = this.list().filter((t) => {
      const src = this.#sources.get(t.kind);
      if (!t.enabled || !src || this.#polling.has(t.id)) return false;
      return opts.all || t.polledAt === null || now - t.polledAt >= src.everyMs;
    });
    const counts = await Promise.all(
      due.map(async (t) => {
        this.#polling.add(t.id);
        try {
          return await this.#pollOne(t);
        } finally {
          this.#polling.delete(t.id);
        }
      }),
    );
    return counts.reduce((a, b) => a + b, 0);
  }

  /** The wall-clock time the next trigger is due to be asked, or null if none is. */
  nextPollAt(): number | null {
    let soonest: number | null = null;
    for (const t of this.list()) {
      const src = this.#sources.get(t.kind);
      if (!t.enabled || !src) continue;
      const at = t.polledAt === null ? this.#clock.now() : t.polledAt + src.everyMs;
      if (soonest === null || at < soonest) soonest = at;
    }
    return soonest;
  }

  async #pollOne(t: Trigger): Promise<number> {
    const src = this.#sources.get(t.kind)!;
    let got: Awaited<ReturnType<TriggerSource["poll"]>>;
    try {
      got = await src.poll(t.config, t.started ? t.cursor : null);
    } catch (e) {
      // The cursor stays where it was, so the next poll asks for the same events again.
      const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      tx(this.#db, () => {
        this.#db.prepare("UPDATE triggers SET polled_at = ? WHERE id = ?").run(this.#clock.now(), t.id);
        this.#events.append("trigger.error", { trigger: t.id, error }, { orb: t.orb });
      });
      return 0;
    }
    const current = this.get(t.id);
    if (!current || !current.enabled) return 0; // removed or switched off while asking
    return tx(this.#db, () => {
      let n = 0;
      if (t.started) for (const e of [...got.events].sort((a, b) => a.at - b.at)) if (this.#deliver(t, e)) n++;
      this.#db
        .prepare("UPDATE triggers SET cursor = ?, started = 1, polled_at = ? WHERE id = ?")
        .run(got.cursor, this.#clock.now(), t.id);
      return n;
    });
  }

  /** Queues one event for the trigger's orb unless it was seen before. Call inside a transaction. */
  #deliver(t: Trigger, e: TriggerEvent): boolean {
    const seen = this.#db.prepare("INSERT OR IGNORE INTO trigger_seen (trigger, event) VALUES (?, ?)").run(t.id, e.id);
    if (Number(seen.changes) === 0) return false;
    const conversation = triggerConversation(t.id);
    const data = e.data ? `\n\nWhat happened (event data):\n${JSON.stringify(e.data, null, 1).slice(0, DATA_CHARS)}` : "";
    const late = this.#clock.now() - e.at;
    this.#inbox.enqueue(t.orb, conversation, "trigger", `[Trigger: ${t.name}] ${t.instruction}\n\n${e.summary}${data}`, {
      data: { trigger: t.id, event: e.id, at: e.at },
      fresh: true,
    });
    this.#events.append("trigger.fired", { trigger: t.id, event: e.id, at: e.at, late_ms: late }, { orb: t.orb, conversation });
    return true;
  }
}

function toTrigger(r: Row): Trigger {
  return {
    id: r.id,
    orb: r.orb,
    name: r.name,
    kind: r.kind,
    config: parseJson(r.config),
    instruction: r.instruction,
    enabled: r.enabled === 1,
    cursor: r.cursor,
    started: r.started === 1,
    polledAt: r.polled_at,
  };
}
