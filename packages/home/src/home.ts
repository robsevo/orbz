// The home (PLAN 1.2): the one always-on process. It owns the database (one writer), the event
// log, an inbox per orb, schedules, triggers and the loop runner, and it ticks: on every tick it
// notices whether the machine slept since the last one, queues what came due, starts due loops
// and asks the triggers what happened. It sleeps until the next due time, never longer than a
// heartbeat, so a machine that wakes is caught up within one heartbeat.
import { EventEmitter } from "node:events";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { type Clock, realClock } from "./clock.ts";
import { openDb } from "./db.ts";
import { EventLog } from "./events.ts";
import { Inboxes, type Runner } from "./inbox.ts";
import { Kit, type KitOptions } from "./kit.ts";
import { HabitShelf } from "./brain/habits.ts";
import { Ladder, type LadderOptions } from "./brain/ladder.ts";
import type { Preset } from "./brain/presets.ts";
import { Spend } from "./brain/spend.ts";
import { type Card, Conversations } from "./agent/conversation.ts";
import { AgentRunner, type AgentOptions } from "./agent/loop.ts";
import { Background } from "./agent/tools.ts";
import { feedback } from "./agent/trace.ts";
import type { Decision, ToolDef } from "./agent/tools.ts";
import { Guard, Turns } from "./rules/guard.ts";
import { ModelMatcher, Rules, type Matcher } from "./rules/rules.ts";
import { planTool, Plans } from "./plans/plans.ts";
import { Board, boardTools } from "./plans/board.ts";
import { TOOLS } from "./agent/tools.ts";
import { Loops, type LoopsOptions } from "./loops.ts";
import { Schedules } from "./schedule.ts";
import { Triggers } from "./triggers.ts";
import { version } from "./version.ts";

export type HomeOptions = {
  dataDir: string;
  /** What does the work of a run. Default: the agent loop (PLAN 1.5) on the preset's big brain. */
  runner?: Runner;
  /** Agent loop settings (tools, step limit, compaction) when the default runner is used. */
  agent?: Partial<Pick<AgentOptions, "tools" | "maxSteps" | "compactAtTokens" | "keepRecentTokens" | "onText">> & {
    /** Test hook: what the rules say for a call (the floor, the one-way switch and away still apply). */
    decide?: (def: ToolDef, args: Record<string, unknown>) => Decision | null;
    /** The plain-English rule matcher. Default: the preset's own brain (else its big brain). */
    matcher?: Matcher | null;
  };
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
  /** The brain ladder's endpoints (PLAN 1.4). Without one, only habits can answer. */
  brain?: { preset: Preset } & Pick<LadderOptions, "ownEarned" | "playbook">;
  /** Dollars a day the brains may cost, by what the providers report; null for no cap. */
  spendCapUsd?: number | null;
};

/** The daily spend cap when none is set: small on purpose; the person raises it in settings. */
export const DEFAULT_SPEND_CAP_USD = 1;

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
  readonly spend: Spend;
  readonly shelf: HabitShelf;
  /** The brain ladder, when a preset is set. */
  readonly ladder: Ladder | null;
  /** What was said in every conversation, and the cards runs paused on. */
  readonly conversations: Conversations;
  /** The agent loop, when it is the runner. */
  readonly agent: AgentRunner | null;
  /** What happens as it happens, for whoever is watching (the terminal, the web app): every event
   * once committed ("event"), and a reply's text as it streams ("text"). Never stored. */
  readonly live = new EventEmitter();
  /** The person's rules (PLAN 1.6). */
  readonly rules: Rules;
  /** Every plan shown to the person (PLAN 1.7). */
  readonly plans: Plans;
  /** Approved plans' rows, ticked only with proof (PLAN 1.8). */
  readonly board: Board;
  readonly guard: Guard;
  readonly #background = new Background();
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
    this.spend = new Spend(this.events, this.clock, opts.spendCapUsd === undefined ? DEFAULT_SPEND_CAP_USD : opts.spendCapUsd);
    this.conversations = new Conversations(db, this.events, this.clock);
    const big = opts.brain?.preset.big ?? null;
    this.kit = opts.kit
      ? new Kit({ ...(opts.kit === true ? {} : opts.kit), events: this.events, clock: this.clock, dataDir: this.dataDir })
      : null;
    this.rules = new Rules(db, this.events, this.clock);
    const matcherEp = opts.brain?.preset.own ?? big;
    const matcher: Matcher | null = opts.agent?.matcher !== undefined ? opts.agent.matcher : matcherEp ? new ModelMatcher(matcherEp, this.spend) : null;
    this.guard = new Guard({
      db, clock: this.clock, rules: this.rules, turns: new Turns(db, this.clock), kit: this.kit, dataDir: this.dataDir,
      matcher: () => matcher,
      ...(opts.agent?.decide && { ruleOverride: opts.agent.decide }),
    });
    const kit = this.kit;
    this.plans = new Plans(db, this.events, this.clock);
    this.board = new Board(db, this.events, this.clock);
    const post = (ctx: { orb: string; conversation: string }, text: string): void => {
      this.conversations.add({ conversation: ctx.conversation, orb: ctx.orb, role: "notice", content: text, meta: { board: true } });
    };
    const { decide: _d, matcher: _m, onText: userOnText, ...agentOpts } = opts.agent ?? {};
    this.live.setMaxListeners(0);
    this.events.listen((e) => this.live.emit("event", e));
    const tools = agentOpts.tools ?? [...TOOLS, planTool(this.plans, (workspace) => [workspace]), ...boardTools(this.board, post)];
    this.agent = opts.runner
      ? null
      : new AgentRunner({
          ...agentOpts,
          onText: (e) => {
            this.live.emit("text", e);
            userOnText?.(e);
          },
          tools,
          guard: this.guard,
          ...(kit && {
            redact: async (text: string) => {
              try {
                const r = await kit.call("redact_text", { text });
                return typeof r === "string" ? r : null;
              } catch {
                return null;
              }
            },
          }),
          conversations: this.conversations,
          events: this.events,
          spend: this.spend,
          clock: this.clock,
          dataDir: this.dataDir,
          background: this.#background,
          endpoint: () => big,
          orbName: (orb) => this.inbox.orb(orb)?.name ?? orb,
        });
    this.inbox = new Inboxes(db, this.events, this.clock, opts.runner ?? this.agent!, opts.graceMs);
    this.schedules = new Schedules(db, this.events, this.inbox, this.clock);
    this.triggers = new Triggers(db, this.events, this.inbox, this.clock);
    this.loops = new Loops(db, this.events, this.clock, {
      budgetCapped: () => this.spend.capped(),
      ...opts.loops,
      dir: join(this.dataDir, "loops"),
      protect: opts.protect ?? defaultProtect(this.dataDir),
    });
    this.shelf = new HabitShelf(this.dataDir, this.kit);
    this.ladder = opts.brain
      ? new Ladder({
          events: this.events,
          spend: this.spend,
          shelf: this.shelf,
          own: opts.brain.preset.own,
          big: opts.brain.preset.big,
          ...(opts.brain.ownEarned && { ownEarned: opts.brain.ownEarned }),
          ...(opts.brain.playbook && { playbook: opts.brain.playbook }),
        })
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

  /** The person's answer to a card. The run it paused resumes through the inbox, in order. A card
   * that is no longer pending (answered already, or expired by a newer message) is refused. */
  answerCard(id: number, choice: "approve" | "deny" | "answer" | "always" | "change" | "save", answer?: string): Card {
    const card = this.conversations.card(id);
    if (!card) throw new Error(`no card ${id}`);
    if (card.status !== "pending") throw new Error(`card ${id} is ${card.status}, not waiting for an answer`);
    if (card.kind === "plan") return this.#answerPlan(card, choice, answer);
    if (choice === "change" || choice === "save") throw new Error(`card ${id} is not a plan`);
    if ((card.kind === "question") !== (choice === "answer")) {
      throw new Error(card.kind === "question" ? `card ${id} is a question: answer it` : `card ${id} needs approve, deny or always`);
    }
    if (choice === "always") {
      // "Always allow" writes an exact rule; it is not offered where the floor or the switch asked,
      // because the next call would ask again whatever the rule said.
      if (card.meta.mayAlways !== true) throw new Error(`card ${id} cannot be always-allowed: ${(card.meta.why as string[] | undefined)?.join("; ") || "it is not an approval"}`);
      this.rules.add({ orb: card.orb, text: `Always allow: ${String(card.meta.described)}`, decision: "allow", action: String(card.meta.described), source: "card" });
    }
    const status = choice === "approve" || choice === "always" ? "approved" : choice === "deny" ? "denied" : "answered";
    const done = this.conversations.resolveCard(id, status, choice === "answer" ? (answer ?? "") : null)!;
    this.inbox.enqueue(card.orb, card.conversation, "system", `(card ${id} ${status})`, { data: { resume: id } });
    return done;
  }

  /** A plan card: Approve, Change ("go with it, but X"), Save (don't run), or Decline. The archived
   * plan's status follows; its text never changes. */
  #answerPlan(card: Card, choice: string, answer?: string): Card {
    const to = { approve: "approved", change: "changed", save: "saved", deny: "denied" } as const;
    if (!(choice in to)) throw new Error(`card ${card.id} is a plan: approve, change, save or deny`);
    if (choice === "change" && !answer?.trim()) throw new Error(`a change says what to change: "go with it, but …"`);
    const status = to[choice as keyof typeof to];
    const done = this.conversations.resolveCard(card.id, status, choice === "change" ? answer!.trim() : null)!;
    const plan = Number(card.meta.plan);
    if (Number.isInteger(plan) && plan > 0) {
      this.plans.mark(plan, status === "denied" ? "declined" : status);
      if (status === "approved") this.board.open(plan, this.plans.get(plan)!.body); // the plan becomes the board
    }
    this.inbox.enqueue(card.orb, card.conversation, "system", `(plan ${status})`, { data: { resume: card.id } });
    return done;
  }

  /** The owner's verdict on a run, for the gym (PLAN 3.x). */
  feedback(run: number, verdict: "approve" | "correct", note = ""): void {
    feedback(this.events, run, verdict, note);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#cancelTimer?.();
    await this.#ticking;
    await this.inbox.close();
    await this.loops.close();
    await this.kit?.close();
    this.#background.close();
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
