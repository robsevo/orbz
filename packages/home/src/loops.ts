// Ash's loop runner (`~/ash/brain/loops/run-loop.sh`), carried into the home (PLAN 1.2). The
// nightly gym runs on it. One run of a loop:
//
//   kill switches → single-flight lock → daily caps → budget flag
//     → tripwire: hash the protected files     ← taken BEFORE the sensor (the 2026-09-10 lesson)
//     → sense()   is there work? the prompt, or "skip" for a quiet night
//     → run()     one bounded run (timeout)
//     → tripwire  any protected file changed → EVERY loop is switched off, loudly
//     → journal   one `loop.run` event per attempt
//     → commit()  the actuator saves its state (offsets, ledgers), checked by the tripwire too
//
// The 2026-09-10 lesson: Ash took its first hash after the sensor, and the sensor runs arbitrary
// code. A loop that rewrote CONSTITUTION.md inside its sensor and then reported "nothing to do"
// finished cleanly and disabled nothing. Here the hash comes first and every exit path checks it.
//
// Switches, all removable by hand after a review: ORBS_LOOPS_DISABLE=1, `<dir>/DISABLED` (every
// loop; the tripwire writes this one), `<dir>/<name>.DISABLED` (one loop).
import { createHash } from "node:crypto";
import { existsSync, globSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "./clock.ts";
import { tx } from "./db.ts";
import type { EventLog } from "./events.ts";
import { cronOf, dueSince } from "./schedule.ts";

export type LoopPlan = { prompt: string } | "skip";
export type LoopOutcome = "ok" | "error" | "timeout" | "capped" | "router-down";
export type LoopResult = { outcome?: LoopOutcome; costUsd?: number; turns?: number; summary?: string };

export type LoopDef = {
  name: string;
  /** The sensor: is there work tonight? Returns the prompt, or "skip" ($0, nothing journaled as a run). */
  sense(signal: AbortSignal): Promise<LoopPlan> | LoopPlan;
  /** One bounded run. */
  run(prompt: string, signal: AbortSignal): Promise<LoopResult>;
  /** The actuator: saves the loop's state. Not called when the run was capped or the router was down. */
  commit?(result: LoopResult & { outcome: LoopOutcome }): Promise<void> | void;
  /** When the home starts it on its own (cron, in `timezone`). Without one it only runs on request. */
  cron?: string;
  timezone?: string;
  /** Real runs per UTC day (default 24). `run(name, { now: true })` may go past it. */
  maxRunsPerDay?: number;
  /** Wall-clock limit for one attempt, sensor included (default 15 minutes). */
  timeoutMs?: number;
  /** More files to protect. A loop can add to the protected set, never take from it. */
  protect?: string[];
};

export type LoopEntry = {
  loop: string;
  day: string;
  ran: boolean;
  note?: string;
  outcome?: LoopOutcome;
  ms?: number;
  costUsd?: number;
  turns?: number;
  summary?: string;
};

export type LoopsOptions = {
  /** Where the DISABLED switches live (`<data>/loops`). */
  dir: string;
  /** Files no loop may ever change, whatever its definition says (globs or paths). */
  protect: string[];
  /** Real runs per UTC day across every loop; never bypassed (default 100). */
  globalMaxPerDay?: number;
  /** True while the spend cap is hit (PLAN 1.4); loops stand down. */
  budgetCapped?: () => boolean;
  env?: Record<string, string | undefined>;
};

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SKIP_DIRS = new Set(["node_modules", ".venv", "__pycache__", ".git"]);

export class Loops {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #clock: Clock;
  readonly #opts: Required<Omit<LoopsOptions, "env">> & { env: Record<string, string | undefined> };
  readonly #defs = new Map<string, LoopDef>();
  readonly #running = new Map<string, { done: Promise<LoopEntry>; abort: AbortController }>();

  constructor(db: DatabaseSync, events: EventLog, clock: Clock, opts: LoopsOptions) {
    this.#db = db;
    this.#events = events;
    this.#clock = clock;
    this.#opts = {
      globalMaxPerDay: 100,
      budgetCapped: () => false,
      env: process.env,
      ...opts,
    };
    mkdirSync(opts.dir, { recursive: true });
  }

  define(def: LoopDef): void {
    if (!NAME.test(def.name)) throw new Error(`loop name "${def.name}": use 1-40 of a-z, 0-9 and -`);
    if (this.#defs.has(def.name)) throw new Error(`loop "${def.name}" is already defined`);
    if (def.cron) cronOf(def.cron, def.timezone ?? localZone()); // throws on a pattern croner cannot read
    this.#defs.set(def.name, def);
    if (def.cron) {
      // A loop is due from the moment it is first defined, never for times before it existed.
      this.#db.prepare("INSERT OR IGNORE INTO loop_state (name, last_due) VALUES (?, ?)").run(def.name, this.#clock.now());
    }
  }

  names(): string[] {
    return [...this.#defs.keys()];
  }

  /** Why loops are off (all of them, or this one), or null if they may run. */
  disabledReason(name?: string): string | null {
    if (this.#opts.env.ORBS_LOOPS_DISABLE === "1") return "ORBS_LOOPS_DISABLE=1";
    const all = join(this.#opts.dir, "DISABLED");
    if (existsSync(all)) return firstLine(all) || "every loop is switched off (loops/DISABLED)";
    if (name !== undefined) {
      const one = join(this.#opts.dir, `${name}.DISABLED`);
      if (existsSync(one)) return firstLine(one) || `loop "${name}" is switched off`;
    }
    return null;
  }

  /** Starts every loop whose cron time has passed (once, however many times it was missed). */
  startDue(): string[] {
    const now = this.#clock.now();
    const started: string[] = [];
    for (const def of this.#defs.values()) {
      if (!def.cron) continue;
      const row = this.#db.prepare("SELECT last_due FROM loop_state WHERE name = ?").get(def.name) as
        | { last_due: number }
        | undefined;
      const hit = dueSince(def.cron, def.timezone ?? localZone(), row?.last_due ?? now, now);
      if (!hit) continue;
      tx(this.#db, () => {
        this.#db.prepare("UPDATE loop_state SET last_due = ? WHERE name = ?").run(hit.due, def.name);
      });
      void this.run(def.name);
      started.push(def.name);
    }
    return started;
  }

  /** The wall-clock time the next loop is due, or null. */
  nextDueAt(): number | null {
    let soonest: number | null = null;
    for (const def of this.#defs.values()) {
      if (!def.cron) continue;
      const row = this.#db.prepare("SELECT last_due FROM loop_state WHERE name = ?").get(def.name) as
        | { last_due: number }
        | undefined;
      const t = cronOf(def.cron, def.timezone ?? localZone()).nextRun(new Date(row?.last_due ?? this.#clock.now()))?.getTime();
      if (t !== undefined && (soonest === null || t < soonest)) soonest = t;
    }
    return soonest;
  }

  /** One attempt at a loop, journaled. `now` lets a manual kick go past the loop's own daily cap. */
  async run(name: string, opts: { now?: boolean } = {}): Promise<LoopEntry> {
    const def = this.#defs.get(name);
    if (!def) throw new Error(`no loop called "${name}"`);
    const day = utcDay(this.#clock.now());
    const journal = (e: Omit<LoopEntry, "loop" | "day">): LoopEntry => {
      const entry: LoopEntry = { loop: name, day, ...e };
      this.#events.append("loop.run", entry);
      return entry;
    };

    const off = this.disabledReason(name);
    if (off) return journal({ ran: false, note: `switched off: ${off}` });
    if (this.#running.has(name)) return journal({ ran: false, note: "already running" });

    const abort = new AbortController();
    const done = this.#attempt(def, journal, opts.now === true, day, abort);
    this.#running.set(name, { done, abort });
    try {
      return await done;
    } finally {
      this.#running.delete(name);
    }
  }

  /** Resolves when no loop is running. */
  async idle(): Promise<void> {
    while (this.#running.size) await Promise.allSettled([...this.#running.values()].map((r) => r.done));
  }

  /** Stops every running loop (journaled as an error: "shutdown") and waits for them. */
  async close(): Promise<void> {
    for (const r of this.#running.values()) r.abort.abort("shutdown");
    await this.idle();
  }

  async #attempt(
    def: LoopDef,
    journal: (e: Omit<LoopEntry, "loop" | "day">) => LoopEntry,
    manual: boolean,
    day: string,
    abort: AbortController,
  ): Promise<LoopEntry> {
    const max = def.maxRunsPerDay ?? 24;
    const { mine, all } = this.#runsOn(day, def.name);
    if (!manual && mine >= max) return journal({ ran: false, note: `per-loop daily cap reached (${mine}/${max})` });
    if (all >= this.#opts.globalMaxPerDay) {
      return journal({ ran: false, note: `global daily cap reached (${all}/${this.#opts.globalMaxPerDay})` });
    }
    if (this.#opts.budgetCapped()) return journal({ ran: false, note: "the spend cap is hit; standing down" });

    const globs = [...this.#opts.protect, ...(def.protect ?? [])];
    const before = hashFiles(globs);
    const tripped = (e: Omit<LoopEntry, "loop" | "day">): LoopEntry | null => {
      if (hashFiles(globs) === before) return null;
      const why = `TRIPWIRE: loop "${def.name}" changed a protected file (the rules, the brain or Orbs' own source)`;
      writeFileSync(join(this.#opts.dir, "DISABLED"), `${why}; every loop is off until someone reviews it and removes this file\n`);
      this.#events.append("notify", { level: "alarm", text: `${why}. Every loop is switched off.`, loop: def.name });
      return journal({ ...e, note: `${why}; every loop switched off` });
    };

    const timeoutMs = def.timeoutMs ?? 15 * 60_000;
    const cancel = this.#clock.timer(timeoutMs, () => abort.abort("timeout"));
    const t0 = this.#clock.mono();
    try {
      let plan: LoopPlan;
      try {
        plan = await untilAborted(Promise.resolve(def.sense(abort.signal)), abort.signal);
      } catch (e) {
        return tripped({ ran: false }) ?? journal({ ran: false, note: `sense failed: ${errorText(e, abort.signal)}` });
      }
      if (plan === "skip") return tripped({ ran: false }) ?? journal({ ran: false, note: "nothing to do" });
      if (!plan.prompt.trim()) return tripped({ ran: false }) ?? journal({ ran: false, note: "sense wrote no prompt" });

      let result: LoopResult;
      let outcome: LoopOutcome;
      try {
        result = await untilAborted(def.run(plan.prompt, abort.signal), abort.signal);
        outcome = result.outcome ?? "ok";
      } catch (e) {
        outcome = abort.signal.reason === "timeout" ? "timeout" : "error";
        result = { summary: errorText(e, abort.signal) };
      }
      const ms = Math.round(this.#clock.mono() - t0);
      const facts = {
        ran: true,
        outcome,
        ms,
        ...(result.costUsd !== undefined && { costUsd: result.costUsd }),
        ...(result.turns !== undefined && { turns: result.turns }),
        ...(result.summary && { summary: result.summary.slice(0, 200) }),
      };
      const trip = tripped(facts);
      if (trip) return trip;
      const entry = journal(facts);

      if (def.commit && outcome !== "capped" && outcome !== "router-down") {
        try {
          await def.commit({ ...result, outcome });
        } catch (e) {
          journal({ ran: false, note: `commit failed, state not saved: ${errorText(e, abort.signal)}` });
        }
        tripped({ ran: false, note: "after commit" });
      }
      return entry;
    } finally {
      cancel();
    }
  }

  #runsOn(day: string, name: string): { mine: number; all: number } {
    let mine = 0;
    let all = 0;
    for (const e of this.#events.ofType("loop.run")) {
      if (e.data.day !== day || e.data.ran !== true) continue;
      all++;
      if (e.data.loop === name) mine++;
    }
    return { mine, all };
  }
}

/** One hash over every protected file: its path and its bytes, so an edit, a new file, a deleted
 * file or a file moved between paths all change it. */
export function hashFiles(globs: string[]): string {
  const files = new Set<string>();
  for (const g of globs) {
    if (!/[*?[{]/.test(g)) {
      files.add(resolve(g));
      continue;
    }
    const matches = globSync(g, { exclude: (p) => String(p).split(/[\\/]/).some((part) => SKIP_DIRS.has(part)) });
    for (const m of matches) files.add(resolve(m));
  }
  const h = createHash("sha256");
  for (const f of [...files].sort()) {
    h.update(f);
    h.update("\0");
    try {
      if (statSync(f).isFile()) h.update(readFileSync(f));
      else h.update("<dir>");
    } catch {
      h.update("<missing>");
    }
    h.update("\0");
  }
  return h.digest("hex");
}

/** Settles with `p`, or rejects as soon as `signal` aborts (a loop that ignores its signal is let go). */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error(String(signal.reason)));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(new Error(String(signal.reason)));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function errorText(e: unknown, signal: AbortSignal): string {
  if (signal.aborted && signal.reason === "timeout") return "timed out";
  return (e instanceof Error ? e.message : String(e)).slice(0, 300);
}

function firstLine(file: string): string {
  try {
    return readFileSync(file, "utf8").split("\n")[0]!.trim();
  } catch {
    return "";
  }
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
