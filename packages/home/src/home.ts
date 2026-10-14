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
import { AREAS_OF, type Level, LEVELS, levelOf, nextFor, tenureOf } from "./gym/levels.ts";
import { radarOf } from "./gym/specialty.ts";
import { orgTools, whoFits } from "./org.ts";
import { recital } from "./plans/recite.ts";
import { recentWork } from "./worklog.ts";
import { placeOnBoard } from "./agent/standing.ts";
import { companyLine, whyNot } from "./company.ts";
import { Boardroom, FORTNIGHT_MS } from "./boardroom.ts";
import { BoardReports } from "./report.ts";
import { weekOf } from "./gym/performance.ts";
import { ledger as xpLedger } from "./gym/xp.ts";
import { interviewSystem, Recruiter, RecruiterError } from "./recruiter.ts";
import { type Fetcher, Reading, type Sleep } from "./reading/reading.ts";
import { readingTools, withReading } from "./reading/tools.ts";
import { Social, type SocialOptions } from "./social/social.ts";
import { BRAND_START, Brands } from "./social/brand.ts";
import { Cultures, momentLift, momentPace } from "./social/culture.ts";
import { BrandWatch } from "./social/watch.ts";
import { School, SchoolError, type ReportCard, type SchoolOptions } from "./school/school.ts";
import type { Kind } from "./school/subjects.ts";
import { habitsOf, shareHabit } from "./gym/share.ts";
import { parse as parsePlan } from "./plans/format.ts";
import { SPECIALTY_FAMILIES, type Specialty } from "./brain/constitution.ts";
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
import { Projects } from "./projects.ts";
import { feedback } from "./agent/trace.ts";
import type { Decision, ToolDef } from "./agent/tools.ts";
import { Guard, Turns } from "./rules/guard.ts";
import { ModelMatcher, Rules, type Matcher } from "./rules/rules.ts";
import { planTool, Plans } from "./plans/plans.ts";
import { Board, boardTools, reviewerProblem } from "./plans/board.ts";
import { Lessons, lessonTools } from "./lessons.ts";
import { chat } from "./brain/openai.ts";
import { TOOLS } from "./agent/tools.ts";
import { reverseTools } from "./reverse/tools.ts";
import { SHEET_TOOL } from "./sheets/tools.ts";
import { Desk } from "./desk/desk.ts";
import { binanceSource, Market, offlineFetch, offlineSource, type MarketSource } from "./desk/market.ts";
import { Dex, offlineDex, publicDex, readTokenKey, type DexChain, type DexSource } from "./desk/dex.ts";
import { safetyOf, type Safety } from "./desk/safety.ts";
import { publicRouters, Swaps, type Routers } from "./desk/swaps.ts";
import { Orders } from "./desk/orders.ts";
import { sqliteBars } from "./desk/bars.ts";
import { deskTools } from "./desk/tools.ts";
import { researchTools } from "./desk/research-tools.ts";
import { Casebook } from "./desk/casebook.ts";
import { traceTools, type Sleuth } from "./desk/trace-tools.ts";
import { Trail } from "./desk/trail.ts";
import { News } from "./desk/news.ts";
import { newsTools } from "./desk/news-tools.ts";
import { Wallets } from "./desk/wallets.ts";
import { Loops, type LoopsOptions } from "./loops.ts";
import { cronOf, Schedules } from "./schedule.ts";
import { Triggers } from "./triggers.ts";
import { version } from "./version.ts";

export type HomeOptions = {
  dataDir: string;
  /** Your projects folder (projects.ts): where, and whether it starts on; off unless asked, so a test never
   * writes outside its own data (the real home, main.ts, turns it on). */
  projects?: { dir?: string; on?: boolean };
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
  /** The reading library's network and its waits (PLAN 3.12): tests stand in for both. */
  reading?: { fetch?: Fetcher; sleep?: Sleep };
  /** Office life (PLAN 5.9): on for the real home (main.ts), off in a test home unless it says so (so
   * no other test's orbs wander off to meet); `dice` pinned by its own tests. */
  social?: { on?: boolean } & Pick<SocialOptions, "dice">;
  /** The board's daily report (PLAN 5.18): sent by the tick for the real home (main.ts), never in a test home unless
   * it says so (its ideas ask the brain, which would take the replies another test scripted); made on asking in both. */
  reports?: { on?: boolean };
  /** The desk (PLAN 5.22-5.27): its market (public market data), the DEX routers and the chains' RPCs. `on`
   * steps live strategies and follows sent swaps by the tick: the real home (main.ts); a test home is off and has no
   * network unless it hands in stand-ins (`source`, `routers`, `fetch`, `dex`: any token's data, PLAN 5.28). */
  desk?: { on?: boolean; source?: MarketSource; routers?: Routers; fetch?: typeof fetch; dex?: DexSource };
  /** How long a stopped run may take to wind down (default 5 s). */
  graceMs?: number;
  /** School (PLAN 5.7): tonight's share of the brain (tests set less). */
  school?: Pick<SchoolOptions, "asksANight">;
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
  /** Your projects folder (projects.ts): every session's and every orb's files, copied where you can open them. */
  readonly projects: Projects;
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
  /** Who keeps a reminder an orb makes (owner, 10-04: "hand off the planning notif to the persons
   * assistant orb, which should always be the case, even in the code"; "they plan everything"): the
   * office's assistant (the first hired, still here), unless the orb is one itself; a bill an accountant
   * keeps stays with the accountant, who holds the bills; with no assistant in the office, the orb. */
  plannerFor(orb: string, kind: "bill" | "reminder"): { id: string; name: string } {
    const me = this.inbox.orb(orb);
    // a bill is the CFO's to keep, with every money record (owner, 10-07: "the role of the CFO is to keep all info there for you")
    const cfo = kind === "bill" ? this.inbox.orbs().find((o) => o.specialty === "cfo") : undefined;
    if (cfo && me) return { id: cfo.id, name: cfo.name };
    if (!me || me.specialty === "assistant" || (kind === "bill" && me.specialty === "accountant")) return { id: orb, name: me?.name ?? orb };
    const assistant = this.inbox.orbs().find((o) => o.specialty === "assistant");
    return assistant ? { id: assistant.id, name: assistant.name } : { id: orb, name: me.name };
  }

  /** The recruiter (PLAN 5.8): the positions you are hiring for, and who applied. */
  readonly recruiter: Recruiter;
  /** The reading library (PLAN 3.12): the sources the office follows, read politely each night. */
  readonly reading: Reading;
  /** Office life (PLAN 5.9): who meets, what they do, and the friendships it makes. */
  readonly social: Social;
  /** Each orb's brand (PLAN 5.44): how the office as a whole sees it, from its friendships, its work and its record. */
  readonly brand: Brands;
  /** The office's culture (PLAN 5.45): everyone's brand, how the office gets on, the floor's mood; its flavour and traditions. */
  readonly culture: Cultures;
  /** The CEO's brand watch (PLAN 5.46): every orb's brand and skills, and who the CEO recommends you promote. */
  readonly watch: BrandWatch;
  /** The company's board (PLAN 5.16): its odd seats, its officers by their posts, everyone's election, proposals voted on. */
  readonly boardroom: Boardroom;
  /** The board's daily report (PLAN 5.18). */
  readonly reports: BoardReports;
  readonly #reportsOn: boolean;
  /** The desk (PLAN 5.22-5.27): the market, the strategies and paper books, your wallets, real swaps. */
  readonly market: Market;
  /** Any token on a DEX (PLAN 5.28): a search, a token's pairs, its candles and last trades, what is trending. */
  readonly dex: Dex;
  readonly #deskFetch: typeof fetch | undefined;
  readonly desk: Desk;
  /** The desk's cases (PLAN 5.42): coins looked into, the money as a graph, findings with their evidence. */
  readonly cases: Casebook;
  /** The news that could move a coin (PLAN 5.43): the crypto press's feeds, tagged by code. */
  readonly news: News;
  readonly wallets: Wallets;
  readonly swaps: Swaps;
  /** An orb's orders on its account, paper or real money alike to it (PLAN 5.34). */
  readonly orders: Orders;
  readonly #deskOn: boolean;
  /** School (PLAN 5.7): an orb you let go, learning the subjects you picked, night by night. */
  readonly school: School;
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
    this.reading = new Reading(db, this.events, this.clock, opts.reading ?? {});
    // the desk: off (and offline) in a test home unless it hands in its stand-ins
    this.#deskOn = opts.desk?.on ?? false;
    const now = (): number => this.clock.now();
    const deskFetch = opts.desk?.fetch ?? (this.#deskOn ? undefined : offlineFetch);
    this.#deskFetch = deskFetch;
    // a pool's bars kept in the database (PLAN 5.35: across a restart, only what is new asked); the public APIs' asks
    // spaced 2.2 s apart (a stand-in's are not)
    this.dex = new Dex(opts.desk?.dex ?? (this.#deskOn ? publicDex({ fetch: deskFetch }) : offlineDex()), now, { bars: sqliteBars(db), spacingMs: opts.desk?.dex ? 0 : 2_200 });
    this.market = new Market(opts.desk?.source ?? (this.#deskOn ? binanceSource() : offlineSource()), now, this.dex);
    this.desk = new Desk(db, this.events, this.market, now);
    // a wallet's every coin (PLAN 5.31): on Solana all it holds; on the EVM chains also the coins swapped through Orbz
    this.wallets = new Wallets(db, this.events, this.market, now, {
      fetch: deskFetch, dex: this.dex,
      seen: (chain) => this.swaps.list(200).filter((x) => x.chain === chain).flatMap((x) => [x.sell, x.buy]).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a)),
    });
    this.swaps = new Swaps(db, this.events, this.market, this.desk, opts.desk?.routers ?? publicRouters({ fetch: deskFetch }), now, { fetch: deskFetch, dex: this.dex });
    // an orb's orders, one way whatever its account (PLAN 5.34): a real one filled, or not, when its swap is done
    this.orders = new Orders(db, this.events, this.desk, this.swaps, this.market, now);
    this.swaps.onSettled = (s) => this.orders.settled(s);
    this.cases = new Casebook(db, this.events, now);
    this.news = new News({ fetch: deskFetch, now });
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
    // every project's files, copied to your folder once a run has finished (a moment after, so a burst of
    // runs copies once)
    this.projects = new Projects({
      dataDir: this.dataDir,
      now: () => this.clock.now(),
      ...(opts.projects?.dir && { defaultDir: opts.projects.dir }),
      defaultOn: opts.projects?.on ?? false,
      sources: () => [
        ...this.team.list().map((t) => ({ name: t.title || `Session ${t.id}`, dir: this.sessionWorkspace(t.id) })),
        ...this.inbox.orbs({ all: true }).map((o) => ({ name: `${o.name}'s work`, dir: workspaceOf(this.dataDir, o.id) })),
      ],
    });
    let copying: ReturnType<typeof setTimeout> | null = null;
    this.events.listen((e) => {
      if (e.type !== "run.finished" || copying) return;
      copying = setTimeout(() => {
        copying = null;
        this.projects.sync();
      }, 1500);
      copying.unref?.();
    });
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
      ...TOOLS.map((t) => withReading(t, this.reading)), planTool(this.plans, (workspace) => [workspace]), ...boardTools(this.board, post, pageCheck, {
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
      // reverse engineering (PLAN 4.8): read what it is handed, statically, on a thread with a ceiling
      ...reverseTools(),
      // spreadsheets (PLAN 4.9): a real workbook, formatted for whoever it is for
      SHEET_TOOL,
      // the desk (PLAN 5.25): prices, strategies on paper, notes, your wallets read, a real swap only asked
      ...deskTools({ desk: this.desk, wallets: this.wallets, orders: this.orders, dex: this.dex, safety: (c, a) => this.tokenSafety(c, a), now: () => this.clock.now(), nameOf: (orb) => this.inbox.orb(orb)?.name ?? orb }),
      ...researchTools({ desk: this.desk, nameOf: (orb) => this.inbox.orb(orb)?.name ?? orb }),
      // the desk's investigations (PLAN 5.42): a case's coins read from their chain, the money followed
      ...traceTools({ book: this.cases, sleuth: this.sleuth(), nameOf: (orb) => this.inbox.orb(orb)?.name ?? orb }),
      // the news that could move a coin (PLAN 5.43), each story with how its coins moved since
      ...newsTools({ news: this.news, bars: (sym) => this.market.candles(sym, "15m", 192) }),
      // the reading library (PLAN 3.12): the sites the office follows, beside web search
      ...readingTools(this.reading, (orb) => this.inbox.orb(orb)?.name ?? orb),
      // how the org works (PLAN 5.4): who fits a row, and a Senior passing a habit on (your yes first)
      ...orgTools({
        events: this.events, dataDir: this.dataDir,
        office: () => this.inbox.orbs().map((o) => ({ id: o.id, name: o.name, specialty: o.specialty, level: levelOf(this.events, o.id), createdAt: o.createdAt })),
        tabOf: (conversation) => {
          const t = parseTabConversation(conversation);
          return t ? (this.team.get(t.id)?.[t.tab] ?? null) : null;
        },
        rowText: (plan, row) => {
          const p = this.plans.get(plan);
          return p ? (parsePlan(p.body).rows.find((r) => r.id === row && !r.test)?.text ?? null) : null;
        },
        habits: (orb) => habitsOf(this.events, this.dataDir, orb),
        share: (from, to, task) => shareHabit(this.events, this.dataDir, { from, to, task, why: "mentoring" }),
        diplomas: (orb) => this.school.diplomas(orb), // school (PLAN 5.7): who is more qualified for a row
        affinity: (orb, others) => this.#affinity(orb, others), // friendships (PLAN 5.9) and brand (5.44): who works well together
      }),
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
          // a helper's turn in a session (PLAN 5.10) on the brain's light model: the plan's Luna, Gemini's flash-lite
          endpoint: (o) => (o?.light ? this.lightBrain() : this.brains.chain.current()?.ep ?? null),
          chain: this.brains.chain,
          planLimited: (why, model) => this.chatgpt.limited(why, model),
          ready: () => brainsReady,
          orbName: (orb) => this.inbox.orb(orb)?.name ?? orb,
          orbSpecialty: (orb) => this.inbox.orb(orb)?.specialty ?? "general",
          learned: (orb) => this.learned.list(orb),
          notebook: (orb) => this.school.notebook(orb), // what it kept at school (PLAN 5.7) goes to work with it
          colleagues: (orb) => [this.social.colleaguesLine(orb), this.brand.line(orb), this.culture.line(), this.watch.line(orb)].filter(Boolean).join("\n\n"), // its friends and frictions (PLAN 5.9), its brand (5.44), the office's culture (5.45), and the CEO's watch (5.46)
          ambition: (orb) => placeOnBoard(orb, this.ranking()), // to top the office (owner, 10-07)
          company: (orb) => {
            const me = this.inbox.orb(orb);
            const you = this.about.get();
            return me ? companyLine({ me, founder: you.name, company: you.company, budget: you.budget, office: this.inbox.orbs(), decisions: this.boardroom.decisions(), ideas: this.reports.approved() }) : null;
          },
          searchKey: () => this.brains.searchKey(),
          remind: (orb, conversation, r) => {
            const keeper = this.plannerFor(orb, r.kind);
            const kept = this.notices.remind({ ...r, orb: keeper.id, conversation });
            return { id: kept.id, comesUpAt: comesUpAt(kept.due, kept.aheadDays), ...(keeper.id !== orb && { keeper: keeper.name }) };
          },
          reminders: () => this.notices.reminders(),
          // its plan's open rows, restated last (plans/recite.ts; Ash's recitation)
          recite: (orb, conversation) => recital({ orb, conversation, plans: this.plans, board: this.board, claims: this.claims }),
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
    this.recruiter = new Recruiter(db, this.events, this.clock);
    // office life (PLAN 5.9): an orb is free with no work queued or under way and no card waiting for you
    this.social = new Social(db, this.events, this.clock, {
      office: () => this.inbox.orbs().map((o) => ({ id: o.id, name: o.name })),
      free: (orb) => !db.prepare("SELECT 1 FROM inbox WHERE orb = ? AND state IN ('queued', 'running') LIMIT 1").get(orb) && !this.conversations.pendingCards().some((c) => c.orb === orb),
      learned: { list: (orb) => this.learned.list(orb), add: (orb, line) => this.learned.add(orb, line) },
      // what it brings to an exchange of ideas: its latest finished work this week, in its own words
      workOf: (orb) => recentWork(this.events, orb, { since: this.clock.now() - 7 * 86_400_000, limit: 1 })[0]?.summary ?? null,
      on: opts.social?.on ?? false,
      ...(opts.social?.dice && { dice: opts.social.dice }),
      // its brand (PLAN 5.44): the others seek out, and warm to, an orb the office thinks well of
      regard: (orb) => this.brand.of(orb).score,
      // and its culture (PLAN 5.45): a warm office's run-ins come oftener and land warmer
      pace: () => momentPace(this.culture.now().score),
      lift: () => momentLift(this.culture.now().score),
    });
    this.school = new School(db, this.events, this.clock, {
      // the teacher is the preset's teacher, else the big brain; the orb at school is the shared big brain
      // (no local model yet); every ask checks the spend cap and is recorded with the orb
      ask: async (who, orb, messages, maxTokens) => {
        this.spend.check();
        const big = this.brains.chain.current()?.ep ?? null;
        const ep = who === "teacher" ? (opts.brain?.preset.teacher ?? big) : big;
        if (!ep) throw new SchoolError("no brain is set up for school");
        const r = await chat(ep, messages, { maxTokens });
        this.spend.record({ tier: who === "teacher" ? "teacher" : "big", model: ep.model, costUsd: r.costUsd, costSource: r.costSource, promptTokens: r.promptTokens, completionTokens: r.completionTokens, orb });
        return r.text;
      },
      kit: kit && ((tool, args) => kit.call(tool, args)),
      who: (orb) => {
        const o = this.inbox.orb(orb);
        return o ? { name: o.name, work: o.specialty } : null;
      },
      ...opts.school,
    });
    this.team = new Team({ db, events: this.events, clock: this.clock, inbox: this.inbox, conversations: this.conversations, level: (orb) => levelOf(this.events, orb) });
    this.xp = new Xp(this.events, { planOrb: (plan) => this.plans.get(plan)?.orb ?? null });
    this.boardroom = new Boardroom(this.events, this.clock, {
      office: () => {
        const now = this.clock.now();
        return this.inbox.orbs().map((o) => ({ id: o.id, name: o.name, specialty: o.specialty, xp: this.xp.of(o.id, now).total, rank: LEVELS.indexOf(levelOf(this.events, o.id)), createdAt: o.createdAt }));
      },
      recent: (id) => {
        const since = this.clock.now() - FORTNIGHT_MS;
        return xpLedger(this.events).filter((e) => e.orb === id && e.at >= since).reduce((n, e) => n + e.amount, 0);
      },
      // how the voter gets on with it, and (PLAN 5.44) how the whole office sees it
      gets: (voter, other) => (this.social.of(voter).find((c) => c.orb === other)?.score ?? 0) + Math.round((this.brand.of(other).score - BRAND_START) / 2),
      // a vote on the cheapest brain (owner, 10-07: "Each thinks, cheap brain"), its cost recorded as the board's
      ask: async (member, prompt) => {
        const ep = this.lightBrain();
        if (!ep) return null;
        this.spend.check();
        const r = await chat(ep, [{ role: "user", content: prompt }], { maxTokens: 120 });
        this.spend.record({ tier: "big", model: ep.model, costUsd: r.costUsd, costSource: r.costSource, promptTokens: r.promptTokens, completionTokens: r.completionTokens, orb: member.orb, turn: "board" });
        return r.text;
      },
      company: () => this.about.get().company,
    });
    this.brand = new Brands(this.events, this.clock, {
      office: () => this.inbox.orbs().map((o) => ({ id: o.id, name: o.name })),
      seat: (orb) => this.boardroom.seats().find((x) => x.orb === orb)?.post ?? null,
    });
    this.culture = new Cultures(this.events, this.clock, {
      office: () => this.inbox.orbs().map((o) => ({ id: o.id, name: o.name })),
      brand: (orb, at) => this.brand.of(orb, at),
      score: (a, b) => this.social.score(a, b),
      traits: (orb) => this.social.traitsOf(orb),
    });
    this.watch = new BrandWatch(this.events, this.clock, {
      ceo: () => {
        const c = this.inbox.orbs().find((o) => o.specialty === "ceo");
        return c ? { orb: c.id, name: c.name } : null;
      },
      office: () => this.inbox.orbs().map((o) => ({ id: o.id, name: o.name })),
      brand: (orb, at) => this.brand.of(orb, at),
      skills: (orb) => ({
        areas: Object.fromEntries(Object.entries(radarOf(this.events, orb)).map(([k, v]) => [k, v.xp])),
        own: AREAS_OF[(this.inbox.orb(orb)?.specialty ?? "general") as keyof typeof AREAS_OF] ?? [],
      }),
      next: (orb) => {
        const p = nextFor(this.events, orb, { specialty: this.inbox.orb(orb)?.specialty ?? "general", now: this.clock.now() });
        return { level: levelOf(this.events, orb), to: p?.to ?? null, ready: p?.ready ?? false };
      },
    });
    this.#reportsOn = opts.reports?.on ?? false;
    this.reports = new BoardReports(this.events, this.clock, {
      office: () => this.inbox.orbs().map((o) => ({ id: o.id, name: o.name, specialty: o.specialty, createdAt: o.createdAt })),
      board: () => this.boardroom.seats(),
      company: () => this.about.get().company,
      founder: () => this.about.get().name,
      budget: () => this.about.get().budget,
      // an idea on the cheapest brain, as a vote is, its cost recorded as the report's (four short lines, PLAN 5.20)
      ask: async (orb, prompt) => {
        const ep = this.lightBrain();
        if (!ep) return null;
        this.spend.check();
        const r = await chat(ep, [{ role: "user", content: prompt }], { maxTokens: 320 });
        this.spend.record({ tier: "big", model: ep.model, costUsd: r.costUsd, costSource: r.costSource, promptTokens: r.promptTokens, completionTokens: r.completionTokens, orb, turn: "report" });
        return r.text;
      },
      news: (since) => this.events.ofType("reading.read").filter((e) => e.at > since && e.orb).reverse()
        .flatMap((e) => ((e.data.changedPages as { title: string; url: string }[] | undefined) ?? []).map((p) => ({ title: p.title, url: p.url, host: String(e.data.host), orb: String(e.orb) }))),
      week: (o) => weekOf(this.events, o.id, { specialty: o.specialty as Specialty, hired: o.createdAt, now: this.clock.now() }),
      spent: (from, to) => this.events.ofType("brain.spend").filter((e) => e.at >= from && e.at < to).reduce((n, e) => n + (typeof e.data.cost_usd === "number" ? e.data.cost_usd : 0), 0),
      bills: (until) => this.notices.reminders().filter((r) => r.kind === "bill" && r.doneAt === null && r.due.slice(0, 10) <= until).map((r) => ({ title: r.title, due: r.due, amount: r.amount })),
      hiring: () => this.recruiting(),
    });
    this.gym = new Gym({
      events: this.events, clock: this.clock, dataDir: this.dataDir, spend: this.spend, kit: kit && ((tool, args) => kit.call(tool, args)),
      teacher: () => opts.brain?.preset.teacher ?? this.brains.chain.current()?.ep ?? null, // the preset's teacher, else the big brain
      own: () => opts.brain?.preset.own ?? null,
      tools, // the exam offers the own brain the very tools the loop does
      orbs: () => this.inbox.orbs().filter((o) => o.letGoAt === null).map((o) => ({ id: o.id, specialty: o.specialty })),
      everyone: () => this.inbox.orbs({ all: true }).map((o) => ({ id: o.id, specialty: o.specialty, hired: tenureOf(this.events, o).hired, away: o.letGoAt !== null })),
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
      if (status === "approved") {
        this.board.open(plan, this.plans.get(plan)!.body); // the plan becomes the board
        this.#deal(card, plan);
      }
    }
    this.inbox.enqueue(card.orb, card.conversation, "system", `(plan ${status})`, { data: { resume: card.id } });
    return done;
  }

  /** A plan approved in a session: its open rows dealt evenly across the team (PLAN 5.10), each to
   * who fits it best among those under their share, and what the lead holds said on its card. */
  #deal(card: Card, plan: number): void {
    const at = parseTabConversation(card.conversation);
    if (!at) return;
    const body = this.plans.get(plan)!.body;
    const texts = new Map(parsePlan(body).rows.filter((r) => !r.test).map((r) => [r.id, r.text]));
    const rows = this.board.rows(plan).filter((r) => !r.test && r.box !== "[x]").map((r) => ({ row: r.row, text: texts.get(r.row) ?? r.row }));
    const office = this.inbox.orbs().map((o) => ({ id: o.id, name: o.name, specialty: o.specialty, level: levelOf(this.events, o.id), createdAt: o.createdAt }));
    const dealt = this.team.deal(at.id, {
      tab: at.tab, plan, lead: card.orb, rows,
      rank: (text, members) => whoFits(this.events, text, office.filter((m) => members.includes(m.id)), (o) => this.school.diplomas(o), (o, others) => this.#affinity(o, others)).map((r) => r.orb),
      claim: (orb, mine) => this.claims.claim({ session: at.id, plan, orb, rows: mine, paths: [] }),
    });
    if (Object.keys(dealt).length) this.conversations.annotateCard(card.id, { dealt });
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

  /** What a token can do to whoever holds it (PLAN 5.28, desk/safety.ts): read from its chain and its top pair. */
  /** What an investigation reads with (PLAN 5.42): Solana's chain for each step on its own budget (its calls spaced on
   * the public RPC, not a stand-in's), the desk's labels, a coin's price and name now. */
  sleuth(): Sleuth {
    return {
      trail: () => new Trail({ fetch: this.#deskFetch, spacingMs: this.#deskFetch && this.#deskFetch !== offlineFetch ? 0 : 300, budget: 150 }),
      labels: () => {
        const ls = this.cases.labels();
        return { names: new Map(ls.map((l) => [l.address, l.label])), exits: new Set(ls.filter((l) => l.exit).map((l) => l.address)) };
      },
      priceOf: async (key) => {
        const t = readTokenKey(key);
        if (!t) return { price: null, label: null };
        const p = (await this.dex.token(t.chain, t.address))[0];
        return { price: p?.priceUsd ?? null, label: p?.base.symbol ?? null };
      },
    };
  }

  async tokenSafety(chain: DexChain, address: string): Promise<Safety> {
    const top = (await this.dex.token(chain, address).catch(() => []))[0] ?? null;
    return safetyOf(chain, address, top, { now: this.clock.now(), fetch: this.#deskFetch });
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

  /** The brain's light model (PLAN 5.10): the plan's Luna, Gemini's flash-lite; the brain itself where it has none. */
  lightBrain(): ReturnType<Brains["light"]> | null {
    const cur = this.brains.chain.current();
    if (!cur) return null;
    if (cur.ep.plan === "chatgpt") {
      const light = this.chatgpt.endpoint({ light: true });
      return light ? { ...light, chain: cur.ep.chain } : cur.ep;
    }
    return this.brains.light(cur.ep);
  }

  /** How an orb would get on with a team (PLAN 5.9), and (PLAN 5.44) a little for how the whole office sees it: a point
   * of friendship for every five of brand above or below the start, so it tips a close call and never the work. */
  #affinity(orb: string, others: string[]): { score: number; why: string | null } {
    const a = this.social.affinity(orb, others);
    if (!others.some((o) => o !== orb)) return a;
    const b = this.brand.of(orb);
    const said = b.score >= 65 || b.score < 40 ? `${b.word.toLowerCase()} around the office` : null;
    return { score: a.score + Math.round((b.score - BRAND_START) / 5), why: [a.why, said].filter(Boolean).join("; ") || null };
  }

  /** The office by XP (owner, 10-07: every orb wants "to be the best orb ... get xp and please the user"):
   * each orb in it, the most XP first, a tie to whoever came first. */
  ranking(): { orb: string; name: string; xp: number }[] {
    const xp = this.xp.totals();
    return this.inbox.orbs().map((o) => ({ orb: o.id, name: o.name, xp: xp[o.id] ?? 0 })).sort((a, b) => b.xp - a.xp);
  }

  /** The recruiter's room (PLAN 5.8): the positions you are hiring for, who applied for them (each a
   * seed, today's made if they are not yet), the level each would start at (the Senior when no orb of
   * that kind is in the office), and the orbs you let go who apply again for their old kind of work,
   * with their record: the most qualified first (level, then XP). */
  recruiting(): {
    positions: string[];
    applicants: { id: number; specialty: string; seed: number; day: string; startsAs: Level }[];
    returning: { id: string; name: string; specialty: string; level: Level; xp: number; diplomas: string[]; born: number; hired: number; left: number | null; now: number }[];
  } {
    const now = this.clock.now();
    const positions = this.recruiter.positions();
    const office = this.inbox.orbs();
    const startsAs = (s: string): Level => (office.some((o) => o.specialty === s) ? "Junior" : "Senior");
    const returning = this.inbox
      .orbs({ all: true })
      .filter((o) => o.letGoAt !== null && positions.includes(o.specialty))
      .map((o) => ({ id: o.id, name: o.name, specialty: o.specialty, level: levelOf(this.events, o.id), xp: this.xp.of(o.id, now).total, diplomas: this.school.diplomas(o.id).map((d) => d.name), ...tenureOf(this.events, o), now }))
      .sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || b.diplomas.length - a.diplomas.length || b.xp - a.xp);
    return { positions, applicants: this.recruiter.applicants().map((a) => ({ ...a, startsAs: startsAs(a.specialty) })), returning };
  }

  /** An interview (PLAN 5.8; owner: "add the interview part for fun"): your words to an applicant, his
   * answer as himself (who the app's dice made him: name, kind of work, manner), from the brain, with
   * no tools; both kept for his first chat if you hire him. The brain is asked only here. */
  async interview(applicant: number, who: { name: string; title: string; focus: string; tone: string }, text: string): Promise<string> {
    this.recruiter.waiting(applicant);
    const said = text.trim();
    if (!said) throw new RecruiterError("say something first");
    if (said.length > 2000) throw new RecruiterError("an interview question is a line or two");
    this.spend.check();
    const ep = this.brains.chain.current()?.ep ?? null;
    if (!ep) throw new RecruiterError("no brain is set up to answer for an applicant");
    const before = this.recruiter.interview(applicant).map((m) => ({ role: m.role === "you" ? ("user" as const) : ("assistant" as const), content: m.text }));
    const res = await chat(ep, [{ role: "system", content: interviewSystem(who) }, ...before, { role: "user", content: said }], { maxTokens: 300 });
    this.spend.record({ tier: "big", model: ep.model, costUsd: res.costUsd, costSource: res.costSource, promptTokens: res.promptTokens, completionTokens: res.completionTokens });
    const answer = res.text.trim() || "…";
    this.recruiter.say(applicant, "you", said);
    this.recruiter.say(applicant, "orb", answer);
    return answer;
  }

  /** Hires an applicant as he applied (the app's dice made him from his seed): into the office, his
   * interview his first chat with you. */
  hireApplicant(applicant: number, orb: { id: string; name: string; look: Record<string, unknown> }): ReturnType<Inboxes["addOrb"]> {
    const a = this.recruiter.waiting(applicant);
    const why = whyNot(a.specialty, this.inbox.orbs().map((o) => o.specialty)); // the founding three first; money with a CFO
    if (why) throw new Error(why);
    const made = this.inbox.addOrb(orb.id, orb.name, a.specialty, orb.look);
    this.recruiter.hired(applicant, made.id);
    for (const m of this.recruiter.interview(applicant)) {
      this.conversations.add({ conversation: `chat:${made.id}`, orb: made.id, role: m.role === "you" ? "user" : "assistant", content: m.text, meta: { interview: true } });
    }
    return made;
  }

  /** Sends an orb you let go to school (PLAN 5.7; owner, 10-03: "school happens when we fire"): the
   * subjects you picked and the mark that makes a diploma; the term starts now (syllabus, exam,
   * the starting exam), its classes at night. */
  sendToSchool(orb: string, subjects: { kind: Kind; name?: string }[], passMark: number): ReportCard {
    const o = this.inbox.orb(orb);
    if (!o) throw new SchoolError(`no orb "${orb}"`);
    if (o.letGoAt === null) throw new SchoolError(`only an orb you let go goes to school: ${o.name} is in the office`);
    this.school.enrol(orb, subjects, passMark);
    void this.school.start(orb);
    return this.school.report(orb);
  }

  /** Brings back an orb you let go (PLAN 5.5): its term at school, if any, ends there (PLAN 5.7),
   * its report card kept. */
  rehire(orb: string): ReturnType<Inboxes["rehire"]> {
    const back = this.inbox.rehire(orb);
    this.school.end(orb, "rehired");
    return back;
  }

  /** Lets an orb go (PLAN 5.5), his habits handed to another orb first if you say so: copied, so they
   * answer under the new owner's rules, while his own stay with him, archived. */
  letGo(orb: string, handTo?: string): { orb: ReturnType<Inboxes["letGo"]>; handed: string[] } {
    const handed: string[] = [];
    const who = this.inbox.orb(orb);
    if (who && who.letGoAt !== null) return { orb: who, handed }; // gone already: his habits were handed on then, or kept
    if (handTo) {
      const to = this.inbox.orb(handTo);
      if (!to || to.letGoAt !== null || handTo === orb) throw new Error(`${handTo} cannot take those habits: hand them to someone else in the office`);
      for (const h of habitsOf(this.events, this.dataDir, orb)) handed.push(shareHabit(this.events, this.dataDir, { from: orb, to: handTo, task: h.task, why: "hand-off" }).task);
    }
    return { orb: this.inbox.letGo(orb), handed };
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
      this.events.append("sandbox.unavailable", { why: process.platform === "linux" ? "bubblewrap is missing or cannot start here" : "the sandbox is bubblewrap's, on Linux" });
    }
    return wrap;
  }

  /** A command the person types into his terminal while they have his computer (PLAN 4.6): run in
   * his sandbox, its output live on their screen as his is, and the result back. */
  async terminal(orb: string, command: string, signal?: AbortSignal): Promise<ToolResult> {
    if (!this.inbox.orb(orb)) throw new Error(`no orb "${orb}"`);
    if (!this.computers.takenOver(orb)) throw new Error("take the computer over first");
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
    await this.reading.close(); // a read under way ends at once, before the database closes
    await this.gym.close();
    await this.school.close();
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
    void this.school.due(); // and school's classes (PLAN 5.7)
    this.recruiter.due(); // the Recruiter's list turns over at midnight (PLAN 5.8)
    void this.reading.due(); // the reading library's next read, one at a time (PLAN 3.12)
    this.social.due(); // two free orbs meet, in the office's day (PLAN 5.9)
    this.social.momentDue(); // and now and then run into each other (owner, 10-07: "micro interactions")
    this.brand.due(); // a brand that changed band is said (PLAN 5.44)
    this.culture.due(); // and the office's culture (PLAN 5.45)
    this.watch.due(); // the CEO recommends whom to promote, by brand and skills (PLAN 5.46)
    this.boardroom.due(); // the board's election: when there is none, when its size changes, once a week (PLAN 5.16)
    if (this.#reportsOn) void this.reports.due()?.catch(() => undefined); // the board's report, from 08:00 each day (PLAN 5.18)
    if (this.#deskOn) {
      void this.desk.due().catch(() => undefined); // live strategies stepped at each bar's close (PLAN 5.24)
      void this.orders.due().catch(() => undefined); // and a run of real money's orders placed (PLAN 5.34)
      void this.swaps.due().catch(() => undefined); // swaps sent followed on their chain, the unanswered expired (PLAN 5.27)
    }
    await this.triggers.poll({ all: woke });
  }

  #arm(): void {
    if (!this.#started || this.#closed) return;
    this.#cancelTimer?.();
    const now = this.clock.now();
    let delay = this.#heartbeatMs;
    for (const at of [this.schedules.nextDueAt(), this.notices.nextDueAt(), this.loops.nextDueAt(), this.triggers.nextPollAt(), this.gym.nextAt(), this.school.nextAt(), this.recruiter.nextAt(), this.reading.nextAt(), this.social.nextAt(), this.social.nextMomentAt(), this.boardroom.nextAt(), this.#reportsOn ? this.reports.nextAt() : null, this.#deskOn ? this.desk.nextAt() : null, this.#deskOn ? this.swaps.nextAt() : null]) {
      if (at !== null) delay = Math.min(delay, at - now);
    }
    this.#cancelTimer = this.clock.timer(Math.max(MIN_DELAY_MS, delay), () => void this.tick());
  }
}
