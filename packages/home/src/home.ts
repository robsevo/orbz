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
import { ChatGPT, type ChatGPTOptions } from "./chatgpt/chatgpt.ts";
import { Brains, type BrainsOptions } from "./brain/brains.ts";
import { Learned } from "./brain/learned.ts";
import { About } from "./about.ts";
import { Xp } from "./gym/xp.ts";
import { Gym } from "./gym/night.ts";
import { Sessions } from "./sessions.ts";
import { Passkeys } from "./passkeys.ts";
import { Connectors, type ConnectorsOptions } from "./connectors/connectors.ts";
import { connectorTools } from "./connectors/tools.ts";
import { Mail, mailTools } from "./connectors/mail.ts";
import { Calendars, calendarTools } from "./connectors/calendars.ts";
import { Accounts, type AccountsOptions, type ProviderId } from "./connectors/accounts.ts";
import { dayTools } from "./day.ts";
import { Computers } from "./computer/browser.ts";
import { computerTools, type PageCheck } from "./computer/tools.ts";
import { Vault } from "./computer/vault.ts";
import { defaultStore, type SecretStore } from "./chatgpt/store.ts";
import type { Undo } from "./gym/card.ts";
import { type Level, levelOf, nextFor } from "./gym/levels.ts";
import { SPECIALTY_FAMILIES } from "./brain/constitution.ts";
import type { Case, CaseStep, StepFn } from "./gym/cases.ts";
import { earnedFor, promotedFor, type Promoted } from "./gym/steps.ts";
import { templatesFor } from "./gym/templates.ts";
import { cronFor, wordsOf } from "./schedule-rules.ts";
import { comesUpAt, Notices } from "./notices.ts";
import { parseTabConversation, Team } from "./team.ts";
import { Claims } from "./claims.ts";
import { Amendments } from "./amendments.ts";
import { teamTools } from "./team-tools.ts";
import { Spend } from "./brain/spend.ts";
import { type Card, Conversations } from "./agent/conversation.ts";
import { AgentRunner, type AgentOptions } from "./agent/loop.ts";
import { Background, runCommand, type ToolResult } from "./agent/tools.ts";
import { sandboxFor, type Wrap } from "./computer/sandbox.ts";
import { workspaceOf } from "./workspace.ts";
import { feedback } from "./agent/trace.ts";
import type { Decision, ToolDef } from "./agent/tools.ts";
import { Guard, Turns } from "./rules/guard.ts";
import { ModelMatcher, Rules, type Matcher } from "./rules/rules.ts";
import { planTool, Plans } from "./plans/plans.ts";
import { Board, boardTools, reviewerProblem } from "./plans/board.ts";
import { Lessons, lessonTools } from "./lessons.ts";
import { chat } from "./brain/openai.ts";
import { TOOLS } from "./agent/tools.ts";
import { Loops, type LoopsOptions } from "./loops.ts";
import { cronOf, Schedules } from "./schedule.ts";
import { Triggers } from "./triggers.ts";
import { version } from "./version.ts";

export type HomeOptions = {
  dataDir: string;
  /** What does the work of a run. Default: the agent loop (PLAN 1.5) on the preset's big brain. */
  runner?: Runner;
  /** Agent loop settings (tools, step limit, compaction) when the default runner is used. */
  agent?: Partial<Pick<AgentOptions, "tools" | "maxSteps" | "compactAtTokens" | "keepRecentTokens" | "onText" | "passWaitMs" | "lessonGate" | "habits" | "own">> & {
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
  /** Continue with ChatGPT (PLAN 1.10): the OS keychain and OpenAI's own servers by default; tests
   * give a stand-in store and their own issuer. Once signed in, the plan answers before the preset. */
  chatgpt?: Partial<Omit<ChatGPTOptions, "dataDir" | "events" | "clock">>;
  /** The brains after ChatGPT (PLAN 1.11): where the Gemini key is kept, and Gemini's root (a test's fake). */
  brains?: Pick<BrainsOptions, "store" | "geminiBase" | "tavilyBase">;
  /** The person's connectors (PLAN 4.2): a test gives its own keychain and deadlines. */
  connectors?: Partial<Pick<ConnectorsOptions, "handshakeMs" | "callMs">> & { store?: SecretStore };
  /** Your Google and Microsoft accounts (PLAN 4.2): the apps registered with them, and stand-ins for tests. */
  accounts?: Pick<AccountsOptions, "clients" | "endpoints" | "signInMs">;
  /** His computer (PLAN 4.1): the Chromium his browser runs on, how long an unused one stays open,
   * and where the vault's key is kept (a test's own; by default the keychain). */
  computer?: { executable?: string | null; idleMs?: number; store?: SecretStore };
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
  /** Continue with ChatGPT (PLAN 1.10): the person's plan as the big brain, once they sign in. */
  readonly chatgpt: ChatGPT;
  /** The brain order (PLAN 1.11): ChatGPT, one Gemini key, the preset's key, the local coder. */
  readonly brains: Brains;
  /** What each orb has learned, each line approved by the person (PLAN 3.9). */
  readonly learned: Learned;
  /** What happens as it happens, for whoever is watching (the terminal, the web app): every event
   * once committed ("event"), and a reply's text as it streams ("text"). Never stored. */
  readonly live = new EventEmitter();
  /** That no sandbox can start here is said once (PLAN 4.6). */
  #saidUnsandboxed = false;
  #yours = 0;
  /** The person's rules (PLAN 1.6). */
  readonly rules: Rules;
  /** What every orb knows about the person (PLAN 2.4): the name the office calls you. */
  readonly about: About;
  /** The devices signed in to the app, and the owner's passkeys (PLAN 2.7). */
  readonly sessions: Sessions;
  readonly passkeys: Passkeys;
  /** The person's own MCP servers, their tools the orbs' (PLAN 4.2). */
  readonly connectors: Connectors;
  /** Your mail accounts (PLAN 4.2): what arrives fires "mail" triggers; replies are drafted, never sent. */
  readonly mail: Mail;
  /** Your own calendars, by their ICS addresses, read only (PLAN 4.2). */
  readonly calendars: Calendars;
  /** Your Google and Microsoft accounts, each connected by its own sign-in (PLAN 4.2). */
  readonly accounts: Accounts;
  /** Each orb's computer (PLAN 4.1): his own browser, by visible text; the person can take it over. */
  readonly computers: Computers;
  /** The passwords you save for your orbs' browsers (PLAN 4.1), typed only on their own sites. */
  readonly vault: Vault;
  /** Sessions (PLAN 2.9): a Brainstorm and a Floor, the orbs chosen for each taking their turns. */
  readonly team: Team;
  /** XP from graded evidence only (PLAN 3.6): the ledger, in the event log. */
  readonly xp: Xp;
  /** The gym's night (PLAN 3.2): habits (with the kit, proved in its sandbox), the own brain's
   * exams, plan templates, promotions proposed. */
  readonly gym: Gym;
  /** The notification centre (PLAN 2.11): bills and reminders kept for you, approvals waiting, work finished. */
  readonly notices: Notices;
  /** Every plan shown to the person (PLAN 1.7). */
  readonly plans: Plans;
  /** Approved plans' rows, ticked only with proof (PLAN 1.8). */
  readonly board: Board;
  /** A team's claims on a plan's rows and files, and the changes agreed to a plan (PLAN 5.1). */
  readonly claims: Claims;
  readonly amendments: Amendments;
  /** Lessons on an orb's own canvas (PLAN 4.4). */
  readonly lessons: Lessons;
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
    this.chatgpt = new ChatGPT({ dataDir: this.dataDir, events: this.events, clock: this.clock, ...opts.chatgpt });
    const chatgptReady = this.chatgpt.load().then(() => {}, () => {}); // a home never signed in does not touch the keychain
    this.learned = new Learned(this.dataDir, this.events);
    this.brains = new Brains({ dataDir: this.dataDir, presetKey: big, chatgpt: () => this.chatgpt.endpoint(), clock: () => this.clock.now(), ...opts.brains });
    const brainsReady = Promise.all([chatgptReady, this.brains.load().catch(() => {})]).then(() => {}); // nor one with no Gemini key
    this.kit = opts.kit
      ? new Kit({ ...(opts.kit === true ? {} : opts.kit), events: this.events, clock: this.clock, dataDir: this.dataDir, sample: (r) => this.#sample(r) })
      : null;
    this.rules = new Rules(db, this.events, this.clock);
    this.about = new About(db, this.events, this.clock);
    this.sessions = new Sessions(db, this.clock);
    this.passkeys = new Passkeys(db, this.clock, this.sessions, this.dataDir);
    const keychain = opts.connectors?.store ?? opts.brains?.store;
    this.connectors = new Connectors({
      dataDir: this.dataDir, events: this.events,
      ...(opts.connectors?.handshakeMs && { handshakeMs: opts.connectors.handshakeMs }),
      ...(opts.connectors?.callMs && { callMs: opts.connectors.callMs }),
      store: keychain ? () => Promise.resolve(keychain) : () => defaultStore(this.dataDir),
    });
    const secrets = keychain ? () => Promise.resolve(keychain) : () => defaultStore(this.dataDir);
    this.accounts = new Accounts({ dataDir: this.dataDir, events: this.events, store: secrets, now: () => this.clock.now(), ...opts.accounts });
    this.mail = new Mail({ dataDir: this.dataDir, events: this.events, store: secrets, token: (a) => this.accounts.token(a, "mail") });
    this.calendars = new Calendars({ dataDir: this.dataDir, events: this.events, store: secrets, now: () => this.clock.now(), accountEvents: (a, from, to) => this.accounts.events(a, from, to) });
    const vaultStore = opts.computer?.store;
    this.vault = new Vault({ dataDir: this.dataDir, events: this.events, store: vaultStore ? () => Promise.resolve(vaultStore) : secrets, now: () => this.clock.now() });
    this.computers = new Computers({
      dataDir: this.dataDir, events: this.events, now: () => this.clock.now(),
      ...(opts.computer && "executable" in opts.computer && { executable: opts.computer.executable }),
      ...(opts.computer?.idleMs && { idleMs: opts.computer.idleMs }),
    });
    const matcherEp = opts.brain?.preset.own ?? big;
    const matcher: Matcher | null = opts.agent?.matcher !== undefined ? opts.agent.matcher : matcherEp ? new ModelMatcher(matcherEp, this.spend) : null;
    this.guard = new Guard({
      db, clock: this.clock, rules: this.rules, turns: new Turns(db, this.clock), kit: this.kit, dataDir: this.dataDir,
      matcher: () => matcher,
      ...(opts.agent?.decide && { ruleOverride: opts.agent.decide }),
      // the one thing rank widens (PLAN 3.8, rules/rank.ts): a Senior's read-only command
      rankOf: (orb) => {
        const o = this.inbox.orb(orb);
        return o ? { level: levelOf(this.events, orb), family: SPECIALTY_FAMILIES[o.specialty] } : null;
      },
    });
    const kit = this.kit;
    this.plans = new Plans(db, this.events, this.clock);
    this.board = new Board(db, this.events, this.clock);
    this.claims = new Claims(db, this.events, this.clock, (session) => this.sessionWorkspace(session));
    this.amendments = new Amendments(db, this.events, this.clock);
    this.lessons = new Lessons(this.events, () => (this.kit ? (tool, args, o) => this.kit!.call(tool, args, o) : null));
    const post = (ctx: { orb: string; conversation: string }, text: string): void => {
      this.conversations.add({ conversation: ctx.conversation, orb: ctx.orb, role: "notice", content: text, meta: { board: true } });
    };
    const { decide: _d, matcher: _m, onText: userOnText, ...agentOpts } = opts.agent ?? {};
    this.live.setMaxListeners(0);
    this.events.listen((e) => this.live.emit("event", e));
    // Ash's pagecheck, through the kit (PLAN 4.1): what a built page really renders; without the kit, nothing can look
    const pageCheck: PageCheck | null = kit
      ? async (target) => {
          try {
            const r = (await kit.call("page_check", target)) as { verdict?: string; report?: string };
            const verdict = r.verdict === "pass" || r.verdict === "fail" || r.verdict === "inconclusive" ? r.verdict : "fail";
            return { verdict, report: String(r.report ?? "") };
          } catch (e) {
            return { verdict: "inconclusive", report: `the kit could not run pagecheck: ${e instanceof Error ? e.message : String(e)}` };
          }
        }
      : null;
    const tools = agentOpts.tools ?? [
      ...TOOLS, planTool(this.plans, (workspace) => [workspace]), ...boardTools(this.board, post, pageCheck, {
        levelOf: (orb) => levelOf(this.events, orb),
        // who may review a junior's row (PLAN 5.4; owner 10-02: the first of a kind is the Senior)
        reviewer: (who, author) =>
          reviewerProblem(who, author, this.inbox.orbs().map((o) => ({ id: o.id, name: o.name, specialty: o.specialty, level: levelOf(this.events, o.id) }))),
      }),
      ...teamTools({
        claims: this.claims, amendments: this.amendments, board: this.board, team: () => this.team,
        nameOf: (orb) => this.inbox.orb(orb)?.name ?? orb,
        idOf: (name) => this.inbox.orbs().find((o) => o.name.toLowerCase() === name.trim().toLowerCase())?.id ?? null,
      }),
      ...computerTools(this.computers, this.vault, pageCheck),
      ...lessonTools(this.lessons),
    ];
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
          sandbox: (orb, workspace) => this.sandbox(orb, workspace),
          workspaceFor: (orb, conversation) => this.workspaceFor(orb, conversation),
          heldBy: (orb, conversation, path) => {
            const t = parseTabConversation(conversation);
            const c = t ? this.claims.holder(t.id, path) : null;
            return c && c.orb !== orb ? (this.inbox.orb(c.orb)?.name ?? c.orb) : null;
          },
          pulse: (orb, conversation) => {
            const t = parseTabConversation(conversation);
            if (t) this.claims.pulse(t.id, orb);
          },
          onTerminal: (e) => this.live.emit("terminal", e), // his terminal, live, on the person's screen
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
          endpoint: () => this.brains.chain.current()?.ep ?? null,
          chain: this.brains.chain,
          planLimited: (why) => this.chatgpt.limited(why),
          ready: () => brainsReady,
          orbName: (orb) => this.inbox.orb(orb)?.name ?? orb,
          orbSpecialty: (orb) => this.inbox.orb(orb)?.specialty ?? "general",
          learned: (orb) => this.learned.list(orb),
          searchKey: () => this.brains.searchKey(),
          remind: (orb, conversation, r) => {
            const kept = this.notices.remind({ ...r, orb, conversation });
            return { id: kept.id, comesUpAt: comesUpAt(kept.due, kept.aheadDays) };
          },
          reminders: () => this.notices.reminders(),
          moveReminder: (id, due) => this.notices.move(id, due),
          learn: (orb, line) => this.learned.add(orb, line),
          templates: (orb) => templatesFor(this.events, orb),
          extraTools: () => [
            ...connectorTools(this.connectors),
            ...(Object.keys(this.mail.accounts()).length ? mailTools(this.mail) : []),
            ...(this.calendars.list().length ? calendarTools(this.calendars, () => this.clock.now()) : []),
            ...(this.kit ? dayTools(this, () => this.clock.now()) : []),
          ],
          schedule: (orb, x) => {
            const made = this.schedules.add({ orb, name: x.name, instruction: x.instruction, cron: cronFor(x.rule) });
            return { id: made.id, words: wordsOf(made.cron), next: cronOf(made.cron, made.timezone).nextRun(new Date(this.clock.now()))?.getTime() ?? null };
          },
          // his own brain (PLAN 3.4): the preset's, for the task types it earned at night
          ...(opts.agent?.own ? { own: opts.agent.own } : opts.brain?.preset.own && {
            own: {
              find: (orb: string, task: string) => {
                const ep = opts.brain!.preset.own!;
                const e = earnedFor(this.events, orb, task, ep.model);
                return e && { ...e, ep };
              },
            },
          }),
          ...(opts.agent?.habits ? { habits: opts.agent.habits } : kit && {
            // his habits (PLAN 3.2), each step in the kit's sandbox; the kit down, the brain answers
            habits: {
              find: (orb: string, task: string) => promotedFor(this.events, this.dataDir, orb, task),
              step: async (h: Promoted, input: Case["input"], done: CaseStep[]) => {
                try {
                  return (await kit.call("habit_step", { habit_dir: h.dir, input, done })) as Awaited<ReturnType<StepFn>>;
                } catch (e) {
                  return { refused: `the kit could not run it: ${e instanceof Error ? e.message : String(e)}` };
                }
              },
            },
          }),
          ...(opts.agent?.lessonGate ? { lessonGate: opts.agent.lessonGate } : kit && {
            // Ash's learn_gate, through the kit; with the kit down the card still asks the person
            lessonGate: async (text: string) => {
              try {
                const v = (await kit.call("learn_verdict", { text })) as { ok?: boolean; reason?: string };
                return { ok: v.ok !== false, reason: String(v.reason ?? "") };
              } catch {
                return { ok: true, reason: "" };
              }
            },
          }),
        });
    this.inbox = new Inboxes(db, this.events, this.clock, opts.runner ?? this.agent!, opts.graceMs);
    this.team = new Team({ db, events: this.events, clock: this.clock, inbox: this.inbox, conversations: this.conversations, level: (orb) => levelOf(this.events, orb) });
    this.xp = new Xp(this.events, { planOrb: (plan) => this.plans.get(plan)?.orb ?? null });
    this.gym = new Gym({
      events: this.events, clock: this.clock, dataDir: this.dataDir, spend: this.spend, kit: kit && ((tool, args) => kit.call(tool, args)),
      teacher: () => opts.brain?.preset.teacher ?? this.brains.chain.current()?.ep ?? null, // the preset's teacher, else the big brain
      own: () => opts.brain?.preset.own ?? null,
      tools, // the exam offers the own brain the very tools the loop does
      orbs: () => this.inbox.orbs().filter((o) => o.letGoAt === null).map((o) => ({ id: o.id, specialty: o.specialty })),
      plans: () => this.plans.list(),
    });
    this.notices = new Notices(db, this.events, this.clock, {
      nameOf: (orb) => this.inbox.orb(orb)?.name ?? orb,
      lastReply: (c) => this.conversations.list(c).findLast((m) => m.role === "assistant" && m.content.trim())?.content ?? null,
      pendingCards: () => this.conversations.pendingCards(),
    });
    this.schedules = new Schedules(db, this.events, this.inbox, this.clock);
    this.triggers = new Triggers(db, this.events, this.inbox, this.clock);
    this.triggers.register("mail", this.mail.source());
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
      // closed while it was starting: the log is closed too, and there is nothing to report
      if (!this.#closed) this.events.append("kit.start_failed", { error: e instanceof Error ? e.message : String(e) });
    });
    void this.connectors.startAll().catch(() => {}); // each fails open, on its own (PLAN 4.2)
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

  /** One tap on the morning card (PLAN 3.5): a habit taken back (the version before it answers
   * again, untouched), or a lesson. Either way the XP it gave is taken back, exactly; an undo is
   * not a rollback, so it costs nothing more. */
  undo(u: Undo): void {
    if (u.kind === "habit") {
      const promoted = this.events.ofType("habit.promoted").findLast((e) => e.orb === u.orb && e.data.kind === u.habit && Number(e.data.version) === u.version);
      if (!promoted) throw new Error(`no habit ${u.habit} v${u.version} for ${u.orb}`);
      if (this.events.ofType("habit.undone").some((e) => e.orb === u.orb && e.data.kind === u.habit && Number(e.data.version) === u.version)) return;
      this.events.append("habit.undone", { kind: u.habit, version: u.version }, { orb: u.orb });
      this.events.append("undo", { source: promoted.seq, what: `the habit ${u.habit} v${u.version}` }, { orb: u.orb });
      return;
    }
    const lines = this.learned.list(u.orb);
    if (lines[u.index] !== u.line) throw new Error("that lesson is no longer where the card saw it");
    const kept = this.events.ofType("orb.learned").findLast((e) => e.orb === u.orb && e.data.line === u.line);
    this.learned.remove(u.orb, u.index);
    if (kept) this.events.append("undo", { source: kept.seq, what: `the lesson "${u.line}"` }, { orb: u.orb });
  }

  /** You promote an orb to its next level (PLAN 3.8): only on the evidence, and only you. */
  promote(orb: string, to: string): Level {
    const who = this.inbox.orb(orb);
    if (!who) throw new Error(`no orb "${orb}"`);
    const p = nextFor(this.events, orb, { specialty: who.specialty, now: this.clock.now() });
    if (!p || p.to !== to) throw new Error(`${to} is not ${who.name}'s next level`);
    if (!p.ready) throw new Error(`not yet: ${p.missing.join("; ")}`);
    this.events.append("orb.promoted", { from: p.from, to: p.to, evidence: p.evidence }, { orb });
    return p.to;
  }

  /** Not yet: the proposal is put away until the evidence is proposed again. */
  declinePromotion(orb: string, to: string): void {
    this.events.append("promotion.declined", { to }, { orb });
  }

  /** The owner's verdict on a run, for the gym (PLAN 3.x). */
  feedback(run: number, verdict: "approve" | "correct", note = ""): void {
    feedback(this.events, run, verdict, note);
  }

  /** Connects a Google or Microsoft account (PLAN 4.2): the address its sign-in opens at, and, once it
   * comes back, its mail and its calendar kept under the same name. */
  async connectAccount(provider: ProviderId): Promise<{ url: string; done: Promise<string> }> {
    const taken = new Set([...Object.keys(this.accounts.list()), ...Object.keys(this.mail.accounts()), ...this.calendars.list().map((c) => c.name)]);
    let name: string = provider;
    for (let i = 2; taken.has(name); i++) name = `${provider}-${i}`;
    const { url, done } = await this.accounts.connect(provider, name);
    const linked = done.then(async ({ name: n, account }) => {
      const p = this.accounts.provider(account.provider);
      try {
        const { host, port, tls } = p.endpoints.imap;
        await this.mail.addConnected(n, { host, port, ...(tls !== undefined && { tls }), user: account.email, address: account.email, oauth: n });
        await this.calendars.addAccount(n, `${p.title} (${account.email})`, n);
      } catch (e) {
        this.events.append("account.link_failed", { name: n, why: e instanceof Error ? e.message : String(e) });
        throw e;
      }
      this.events.append("account.ready", { name: n, provider: account.provider });
      return n;
    });
    linked.catch(() => {}); // a caller that never awaits it must not crash the home
    return { url, done: linked };
  }

  /** Disconnects an account: its sign-in, its mail and its calendar, all at once. */
  async disconnectAccount(name: string): Promise<void> {
    if (this.mail.accounts()[name]?.oauth === name) await this.mail.remove(name);
    if (this.calendars.list().some((c) => c.name === name && c.account === name)) await this.calendars.remove(name);
    await this.accounts.remove(name);
  }

  /** A model call the kit asks while one of its tools runs (a lesson's plan and its judge, PLAN
   * 4.4): the brain order's current brain answers it, spent like any other call. */
  async #sample(r: { system: string | null; messages: { role: "user" | "assistant"; content: string }[]; maxTokens: number }): Promise<{ model: string; text: string }> {
    const ep = this.brains.chain.current()?.ep ?? null;
    if (!ep) throw new Error("no brain is set up to answer it");
    const res = await chat(ep, [...(r.system ? [{ role: "system" as const, content: r.system }] : []), ...r.messages], { maxTokens: Math.min(8000, r.maxTokens) });
    this.spend.record({ tier: "big", model: ep.model, costUsd: res.costUsd, costSource: res.costSource, promptTokens: res.promptTokens, completionTokens: res.completionTokens });
    return { model: ep.model, text: res.text };
  }

  /** A session's shared workspace (PLAN 5.1): the team's files, which claims divide among them. */
  sessionWorkspace(session: number): string {
    return join(this.dataDir, "sessions", String(session), "workspace");
  }

  /** Where an orb works in a conversation: a session's tabs share the team's workspace. */
  workspaceFor(orb: string, conversation: string): string {
    const t = parseTabConversation(conversation);
    return t ? this.sessionWorkspace(t.id) : workspaceOf(this.dataDir, orb);
  }

  /** His sandbox (PLAN 4.6): his workspace and a home of his own, nothing else of anyone's. Null
   * where none can start; the home says so once. */
  sandbox(orb: string, workspace = workspaceOf(this.dataDir, orb)): Wrap | null {
    const wrap = sandboxFor({ workspace, home: join(this.dataDir, "orbs", orb, "shell-home"), dataDir: this.dataDir });
    if (!wrap && !this.#saidUnsandboxed) {
      this.#saidUnsandboxed = true;
      this.events.append("sandbox.unavailable", { why: process.platform === "linux" ? "bubblewrap is missing or cannot start here" : "his sandbox is bubblewrap's, on Linux" });
    }
    return wrap;
  }

  /** A command the person types into his terminal while they have his computer (PLAN 4.6): run in
   * his sandbox, its output live on their screen as his is, and the result back. */
  async terminal(orb: string, command: string, signal?: AbortSignal): Promise<ToolResult> {
    if (!this.inbox.orb(orb)) throw new Error(`no orb "${orb}"`);
    if (!this.computers.takenOver(orb)) throw new Error("take his computer over first");
    const call = `you-${++this.#yours}`;
    const r = await runCommand(command, workspaceOf(this.dataDir, orb), 120_000, signal, {
      wrap: this.sandbox(orb),
      onOutput: (chunk) => this.live.emit("terminal", { orb, conversation: null, run: 0, call, chunk }),
    });
    this.events.append("computer.you_ran", { orb, command: command.slice(0, 200), failed: r.isError === true }, { orb });
    return r;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#cancelTimer?.();
    await this.#ticking;
    await this.gym.close();
    await this.inbox.close();
    await this.loops.close();
    await this.kit?.close();
    this.chatgpt.close();
    this.team.close();
    this.#background.close();
    await this.connectors.close();
    await this.computers.close();
    this.accounts.close();
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
    this.notices.due();
    this.loops.startDue();
    void this.gym.due(); // the night goes on beside the ticks; close() waits for it
    await this.triggers.poll({ all: woke });
  }

  #arm(): void {
    if (!this.#started || this.#closed) return;
    this.#cancelTimer?.();
    const now = this.clock.now();
    let delay = this.#heartbeatMs;
    for (const at of [this.schedules.nextDueAt(), this.notices.nextDueAt(), this.loops.nextDueAt(), this.triggers.nextPollAt(), this.gym.nextAt()]) {
      if (at !== null) delay = Math.min(delay, at - now);
    }
    this.#cancelTimer = this.clock.timer(Math.max(MIN_DELAY_MS, delay), () => void this.tick());
  }
}
