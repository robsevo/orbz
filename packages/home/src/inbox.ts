// An inbox per orb (PLAN 1.2; the idea is Open Dot's, the code is ours, and unlike Open Dot's the
// queue is durable). One run at a time per orb. When an orb comes free it takes the oldest
// waiting item plus every item right behind it bound for the same conversation, and runs them
// as one turn. Pause stops the run and keeps its work queued for resume; stop drops the queue.
// A run cut off by a crash or a shutdown goes back to the head of the queue, marked interrupted.
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "./clock.ts";
import { parseJson, tx } from "./db.ts";
import type { EventLog } from "./events.ts";

export type Source = "chat" | "schedule" | "trigger" | "system";
export type OrbStatus = "idle" | "working" | "waiting" | "paused";
export type Orb = { id: string; name: string; status: OrbStatus; activity: string | null; createdAt: number };

export type Item = {
  id: number;
  orb: string;
  conversation: string;
  source: Source;
  text: string;
  data: Record<string, unknown>;
  fresh: boolean;
  queuedAt: number;
};

export type RunContext = {
  run: number;
  orb: string;
  conversation: string;
  items: Item[];
  /** Start from a fresh context (schedules and triggers), not the conversation's history. */
  fresh: boolean;
  signal: AbortSignal;
  /** Sets the orb's live activity line ("Reading 12 emails"). */
  activity(text: string): void;
};

export type RunResult = { outcome?: "ok" | "waiting"; summary?: string };

/** Does the work of one run. The agent loop (PLAN 1.5) is the real one; tests use fakes. */
export interface Runner {
  run(ctx: RunContext): Promise<RunResult | void>;
}

type Halt = "paused" | "stopped" | "shutdown";
type Active = { run: number; abort: AbortController; done: Promise<void> };
type ItemRow = {
  id: number;
  orb: string;
  conversation: string;
  source: Source;
  text: string;
  data: string;
  fresh: number;
  queued_at: number;
};
type OrbRow = { id: string; name: string; status: OrbStatus; activity: string | null; created_at: number };

export class UnknownOrbError extends Error {
  constructor(orb: string) {
    super(`no orb called "${orb}"`);
    this.name = "UnknownOrbError";
  }
}

export class Inboxes {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #clock: Clock;
  readonly #runner: Runner;
  readonly #graceMs: number;
  readonly #active = new Map<string, Active>();
  #closed = false;

  /** `graceMs`: how long a stopped run may take to wind down before it is abandoned. */
  constructor(db: DatabaseSync, events: EventLog, clock: Clock, runner: Runner, graceMs = 5000) {
    this.#db = db;
    this.#events = events;
    this.#clock = clock;
    this.#runner = runner;
    this.#graceMs = graceMs;
  }

  addOrb(id: string, name: string): Orb {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) throw new Error(`orb id "${id}": use 1-40 of a-z, 0-9 and -`);
    if (this.orb(id)) throw new Error(`orb "${id}" already exists`);
    const at = this.#clock.now();
    tx(this.#db, () => {
      this.#db.prepare("INSERT INTO orbs (id, name, created_at) VALUES (?, ?, ?)").run(id, name, at);
      this.#events.append("orb.added", { name }, { orb: id });
    });
    return this.orb(id)!;
  }

  orb(id: string): Orb | undefined {
    const r = this.#db.prepare("SELECT * FROM orbs WHERE id = ?").get(id) as OrbRow | undefined;
    return r && toOrb(r);
  }

  orbs(): Orb[] {
    return (this.#db.prepare("SELECT * FROM orbs ORDER BY created_at, id").all() as OrbRow[]).map(toOrb);
  }

  /** Queues work for an orb. It starts as soon as the orb is free (after the current call stack). */
  enqueue(
    orb: string,
    conversation: string,
    source: Source,
    text: string,
    opts: { data?: Record<string, unknown>; fresh?: boolean } = {},
  ): Item {
    if (!this.orb(orb)) throw new UnknownOrbError(orb);
    const at = this.#clock.now();
    const data = opts.data ?? {};
    const fresh = opts.fresh ? 1 : 0;
    const id = tx(this.#db, () => {
      const r = this.#db
        .prepare(
          "INSERT INTO inbox (orb, conversation, source, text, data, fresh, queued_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .get(orb, conversation, source, text, JSON.stringify(data), fresh, at) as { id: number };
      this.#events.append("inbox.queued", { item: r.id, source }, { orb, conversation });
      return r.id;
    });
    queueMicrotask(() => this.#pump(orb));
    return { id, orb, conversation, source, text, data, fresh: fresh === 1, queuedAt: at };
  }

  /** A message from the owner in a chat. */
  send(orb: string, conversation: string, text: string): Item {
    return this.enqueue(orb, conversation, "chat", text);
  }

  /** Items in a conversation that are waiting or running (a schedule never overlaps itself). */
  open(conversation: string): number {
    const r = this.#db
      .prepare("SELECT count(*) AS n FROM inbox WHERE conversation = ? AND state IN ('queued', 'running')")
      .get(conversation) as { n: number };
    return r.n;
  }

  queued(orb: string): Item[] {
    const rows = this.#db
      .prepare("SELECT * FROM inbox WHERE orb = ? AND state = 'queued' ORDER BY id")
      .all(orb) as ItemRow[];
    return rows.map(toItem);
  }

  pause(orb: string): void {
    const o = this.orb(orb);
    if (!o) throw new UnknownOrbError(orb);
    if (o.status === "paused") return;
    tx(this.#db, () => {
      this.#db.prepare("UPDATE orbs SET status = 'paused' WHERE id = ?").run(orb);
      this.#events.append("orb.paused", {}, { orb });
    });
    this.#active.get(orb)?.abort.abort("paused" satisfies Halt);
  }

  resume(orb: string): void {
    const o = this.orb(orb);
    if (!o) throw new UnknownOrbError(orb);
    if (o.status !== "paused") return;
    tx(this.#db, () => {
      this.#db.prepare("UPDATE orbs SET status = 'idle' WHERE id = ?").run(orb);
      this.#events.append("orb.resumed", {}, { orb });
    });
    this.#pump(orb);
  }

  /** Stops the current run and drops everything still waiting. The orb is not paused. */
  stop(orb: string): void {
    if (!this.orb(orb)) throw new UnknownOrbError(orb);
    tx(this.#db, () => {
      const r = this.#db.prepare("UPDATE inbox SET state = 'dropped' WHERE orb = ? AND state = 'queued'").run(orb);
      this.#events.append("orb.stopped", { dropped: Number(r.changes) }, { orb });
    });
    this.#active.get(orb)?.abort.abort("stopped" satisfies Halt);
  }

  /** At boot: runs a crash cut off go back to the head of their queue, marked interrupted. */
  recover(): number {
    const cut = this.#db.prepare("SELECT id, orb, conversation FROM runs WHERE ended_at IS NULL").all() as {
      id: number;
      orb: string;
      conversation: string;
    }[];
    tx(this.#db, () => {
      for (const r of cut) this.#end(r.orb, r.conversation, r.id, "interrupted", { reason: "the home stopped mid-run" });
      this.#db.prepare("UPDATE orbs SET status = 'idle', activity = NULL WHERE status = 'working'").run();
    });
    return cut.length;
  }

  /** Starts every orb that has work waiting. */
  pumpAll(): void {
    for (const o of this.orbs()) this.#pump(o.id);
  }

  /** Resolves when no run is active and nothing runnable is waiting. */
  async idle(): Promise<void> {
    for (;;) {
      const running = [...this.#active.values()].map((a) => a.done);
      if (running.length === 0) {
        await new Promise((r) => setImmediate(r));
        if (this.#active.size === 0) return;
        continue;
      }
      await Promise.all(running);
    }
  }

  /** Stops every run for a shutdown; their work is queued again for the next start. */
  async close(): Promise<void> {
    this.#closed = true;
    const running = [...this.#active.values()];
    for (const a of running) a.abort.abort("shutdown" satisfies Halt);
    await Promise.all(running.map((a) => a.done));
  }

  #pump(orb: string): void {
    if (this.#closed || this.#active.has(orb)) return;
    const o = this.orb(orb);
    if (!o || o.status === "paused") return;
    const waiting = this.queued(orb);
    const head = waiting[0];
    if (!head) return;
    const batch: Item[] = [];
    for (const it of waiting) {
      if (it.conversation !== head.conversation) break;
      batch.push(it);
    }
    this.#start(orb, head.conversation, batch);
  }

  #start(orb: string, conversation: string, items: Item[]): void {
    const ids = items.map((i) => i.id);
    const fresh = items.some((i) => i.fresh);
    const started = this.#clock.now();
    const run = tx(this.#db, () => {
      const r = this.#db
        .prepare("INSERT INTO runs (orb, conversation, started_at) VALUES (?, ?, ?) RETURNING id")
        .get(orb, conversation, started) as { id: number };
      const mark = this.#db.prepare("UPDATE inbox SET state = 'running', run = ? WHERE id = ?");
      for (const id of ids) mark.run(r.id, id);
      this.#db.prepare("UPDATE orbs SET status = 'working', activity = NULL WHERE id = ?").run(orb);
      this.#events.append("run.started", { run: r.id, items: ids, fresh }, { orb, conversation });
      return r.id;
    });

    const abort = new AbortController();
    const ctx: RunContext = {
      run,
      orb,
      conversation,
      items,
      fresh,
      signal: abort.signal,
      activity: (text) => {
        if (this.#active.get(orb)?.run !== run || abort.signal.aborted) return;
        this.#db.prepare("UPDATE orbs SET activity = ? WHERE id = ?").run(text, orb);
        this.#events.append("orb.activity", { run, text }, { orb, conversation });
      },
    };

    // Active before the runner is called: a runner may report activity before its first await.
    const active: Active = { run, abort, done: Promise.resolve() };
    this.#active.set(orb, active);
    active.done = (async () => {
      let result: Settled<RunResult | void>;
      try {
        result = await this.#settle(this.#runner.run(ctx), abort.signal);
      } catch (e) {
        result = { error: e };
      }
      const halt = abort.signal.aborted ? (abort.signal.reason as Halt) : null;
      const extra: Record<string, unknown> = { ms: this.#clock.now() - started };
      if ("abandoned" in result) extra.abandoned = true;
      if ("error" in result && !halt) extra.error = errorText(result.error);
      if ("value" in result && result.value?.summary) extra.summary = result.value.summary;
      const outcome = halt ?? ("error" in result ? "error" : "value" in result ? (result.value?.outcome ?? "ok") : "error");
      tx(this.#db, () => this.#end(orb, conversation, run, outcome, extra));
    })().finally(() => {
      this.#active.delete(orb);
      this.#pump(orb);
    });
  }

  /** Records how a run ended and where its items go next. Call inside a transaction. */
  #end(orb: string, conversation: string, run: number, outcome: string, extra: Record<string, unknown>): void {
    const db = this.#db;
    if (outcome === "paused" || outcome === "shutdown" || outcome === "interrupted") {
      db.prepare(
        "UPDATE inbox SET state = 'queued', run = NULL, data = json_set(data, '$.interrupted', ?) WHERE run = ?",
      ).run(outcome, run);
    } else {
      db.prepare("UPDATE inbox SET state = ? WHERE run = ?").run(outcome === "stopped" ? "dropped" : "done", run);
    }
    db.prepare("UPDATE runs SET ended_at = ?, outcome = ? WHERE id = ?").run(this.#clock.now(), outcome, run);
    const status: OrbStatus = outcome === "waiting" ? "waiting" : "idle";
    db.prepare(
      "UPDATE orbs SET status = CASE WHEN status = 'paused' THEN 'paused' ELSE ? END, activity = NULL WHERE id = ?",
    ).run(status, orb);
    this.#events.append(outcome === "interrupted" ? "run.interrupted" : "run.finished", { run, outcome, ...extra }, {
      orb,
      conversation,
    });
  }

  /** Waits for the runner, but once the run is stopped, no longer than the grace period. */
  #settle<T>(p: Promise<T>, signal: AbortSignal): Promise<Settled<T>> {
    return new Promise((resolve) => {
      let cancel = (): void => {};
      const onAbort = (): void => {
        cancel = this.#clock.timer(this.#graceMs, () => resolve({ abandoned: true }));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
      p.then(
        (value) => {
          cancel();
          resolve({ value });
        },
        (error: unknown) => {
          cancel();
          resolve({ error });
        },
      );
    });
  }
}

type Settled<T> = { value: T } | { error: unknown } | { abandoned: true };

function toOrb(r: OrbRow): Orb {
  return { id: r.id, name: r.name, status: r.status, activity: r.activity, createdAt: r.created_at };
}

function toItem(r: ItemRow): Item {
  return {
    id: r.id,
    orb: r.orb,
    conversation: r.conversation,
    source: r.source,
    text: r.text,
    data: parseJson(r.data),
    fresh: r.fresh === 1,
    queuedAt: r.queued_at,
  };
}

function errorText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 500);
}
