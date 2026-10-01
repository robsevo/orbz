// The home (PLAN 1.2): the one always-on process. It owns the database (one writer), the event
// log, an inbox per orb, schedules, triggers and the loop runner, and it ticks: on every tick it
// notices whether the machine slept since the last one, queues what came due, starts due loops
// and asks the triggers what happened. It sleeps until the next due time, never longer than a
// heartbeat, so a machine that wakes is caught up within one heartbeat.
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { type Clock, realClock } from "./clock.ts";
import { openDb } from "./db.ts";
import { EventLog } from "./events.ts";
import { Inboxes, type Runner } from "./inbox.ts";
import { Kit, type KitOptions } from "./kit.ts";
import { Loops, type LoopsOptions } from "./loops.ts";
import { Schedules } from "./schedule.ts";
import { Triggers } from "./triggers.ts";
import { version } from "./version.ts";

export type HomeOptions = {
  dataDir: string;
  runner: Runner;
  clock?: Clock;
  /** The longest the home sleeps between ticks (default 30 s). */
  heartbeatMs?: number;
  /** How long a stopped run may take to wind down (default 5 s). */
  graceMs?: number;
  /** Files no loop may change. Default: the owner's brain and rules, and Orbs' own source. */
  protect?: string[];
  loops?: Omit<LoopsOptions, "dir" | "protect">;
  /** Run Ash's kit beside the home (PLAN 1.3). Off unless asked for: most tests don't need it. */
  kit?: boolean | Omit<KitOptions, "events" | "clock" | "dataDir">;
};

/** A gap between the wall clock and the monotonic clock bigger than this means the machine slept. */
const WAKE_GAP_MS = 5000;
const MIN_DELAY_MS = 250;

const REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

/** What no loop may change on a real install: the owner's constitution, skills and rules, and the
 * code of the home and the kit (the floor lives there). */
export function defaultProtect(dataDir: string): string[] {
  const d = resolve(dataDir);
  return [
    join(d, "brain", "**"),
    join(d, "rules", "**"),
    join(REPO, "packages", "*", "src", "**"),
    join(REPO, "packages", "*", "package.json"),
    join(REPO, "kit", "**", "*.py"),
    join(REPO, "kit", "pyproject.toml"),
    join(REPO, "kit", "uv.lock"),
    join(REPO, "package.json"),
    join(REPO, "pnpm-lock.yaml"),
  ];
}

export class Home {
  readonly dataDir: string;
  readonly clock: Clock;
  readonly events: EventLog;
  readonly inbox: Inboxes;
  readonly schedules: Schedules;
  readonly triggers: Triggers;
  readonly loops: Loops;
  /** Ash's kit, when the home runs one. */
  readonly kit: Kit | null;
  readonly #db: DatabaseSync;
  readonly #heartbeatMs: number;
  #last: { wall: number; mono: number } | null = null;
  #ticking: Promise<void> | null = null;
  #again = false;
  #cancelTimer: (() => void) | null = null;
  #started = false;
  #closed = false;

  private constructor(db: DatabaseSync, opts: HomeOptions) {
    this.#db = db;
    this.dataDir = resolve(opts.dataDir);
    this.clock = opts.clock ?? realClock;
    this.#heartbeatMs = opts.heartbeatMs ?? 30_000;
    this.events = new EventLog(db, this.clock);
    this.inbox = new Inboxes(db, this.events, this.clock, opts.runner, opts.graceMs);
    this.schedules = new Schedules(db, this.events, this.inbox, this.clock);
    this.triggers = new Triggers(db, this.events, this.inbox, this.clock);
    this.loops = new Loops(db, this.events, this.clock, {
      ...opts.loops,
      dir: join(this.dataDir, "loops"),
      protect: opts.protect ?? defaultProtect(this.dataDir),
    });
    this.kit = opts.kit
      ? new Kit({ ...(opts.kit === true ? {} : opts.kit), events: this.events, clock: this.clock, dataDir: this.dataDir })
      : null;
  }

  /** Opens the home on a data directory. Throws HomeLockedError if another home holds it. */
  static open(opts: HomeOptions): Home {
    const home = new Home(openDb(opts.dataDir), opts);
    const recovered = home.inbox.recover();
    home.events.append("home.started", { version, pid: process.pid, recovered });
    return home;
  }

  /** Starts ticking, starts every orb that has work waiting, and starts the kit. A kit that
   * fails to start is in the event log (`kit.died`, then a restart or `kit.gave_up`); the home
   * keeps running without it. */
  start(): void {
    if (this.#started || this.#closed) return;
    this.#started = true;
    this.inbox.pumpAll();
    void this.tick();
    this.kit?.start().catch((e: unknown) => {
      this.events.append("kit.start_failed", { error: e instanceof Error ? e.message : String(e) });
    });
  }

  /** One tick now (also what the timer calls). Ticks never overlap; a tick asked for during one
   * runs right after it. */
  tick(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (this.#ticking) {
      this.#again = true;
      return this.#ticking;
    }
    this.#ticking = (async () => {
      do {
        this.#again = false;
        await this.#tickOnce();
      } while (this.#again && !this.#closed);
    })().finally(() => {
      this.#ticking = null;
      this.#arm();
    });
    return this.#ticking;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#cancelTimer?.();
    await this.#ticking;
    await this.inbox.close();
    await this.loops.close();
    await this.kit?.close();
    this.events.append("home.stopped", {});
    this.#db.close();
  }

  async #tickOnce(): Promise<void> {
    const wall = this.clock.now();
    const mono = this.clock.mono();
    const slept = this.#last ? wall - this.#last.wall - (mono - this.#last.mono) : 0;
    this.#last = { wall, mono };
    const woke = slept > WAKE_GAP_MS;
    if (woke) this.events.append("home.woke", { slept_ms: Math.round(slept) });
    this.schedules.due();
    this.loops.startDue();
    await this.triggers.poll({ all: woke });
  }

  #arm(): void {
    if (!this.#started || this.#closed) return;
    this.#cancelTimer?.();
    const now = this.clock.now();
    let delay = this.#heartbeatMs;
    for (const at of [this.schedules.nextDueAt(), this.loops.nextDueAt(), this.triggers.nextPollAt()]) {
      if (at !== null) delay = Math.min(delay, at - now);
    }
    this.#cancelTimer = this.clock.timer(Math.max(MIN_DELAY_MS, delay), () => void this.tick());
  }
}
