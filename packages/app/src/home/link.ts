// The app's link to the home (PLAN 2.4). The home serves the app at /app/ and prints a one-time
// pairing link (`pnpm start`); the link's code buys a session cookie, and from then on the office,
// what it calls you, and every orb made or let go are the home's. A page opened anywhere else (the
// dev server, the render checks' scratch server) has no home behind it, and the app works on its
// own there, as a preview: the same screens, kept in the browser.
import { PERSONALITIES, sane, SPECIALTIES, type Character } from "../orb/spec.ts";
import type { Person } from "../onboarding/story.ts";

export type HomeOrb = { id: string; name: string; specialty: string; look: Record<string, unknown> };

export type Message = {
  id: number; conversation: string; orb: string; run: number | null;
  role: "user" | "assistant" | "tool" | "notice" | "summary" | "clear";
  content: string; toolCalls: { id: string; name: string; arguments: string }[] | null; toolCallId?: string | null; meta: Record<string, unknown>; at: number;
};
export type Card = { id: number; kind: "approval" | "question" | "connect" | "plan"; tool: string; title: string; detail: string; status: string; meta: Record<string, unknown> };
export type Choice = "approve" | "deny" | "always" | "answer";
export type Tab = "brainstorm" | "floor";
/** His computer (PLAN 2.8): a folder's entries and a file's text in his workspace, as the home reads them. */
export type Entry = { path: string; dir: boolean; size: number; mtime: number };
export type WorkFile = { path: string; size: number; mtime: number; text: string | null; truncated: boolean };
/** The lab (PLAN 2.13): every brainstorm and every plan shown, as the home keeps them. */
/** The reading library (PLAN 3.12): a source the office follows, and a page read from one. */
export type ReadingSource = {
  id: number; orb: string; url: string; host: string; prefix: string; title: string; why: string; everyDays: number;
  addedAt: number; lastReadAt: number | null; nextAt: number; failures: number; lastError: string | null; pages: number;
};
export type ReadingHit = { url: string; title: string; snippet: string; readAt: number; changedAt: number; source: number; host: string; orb: string };
export type ReadingState = { sources: ReadingSource[]; now: { source: number; url: string } | null; hits: ReadingHit[] };
export type LabSession = { id: number; title: string; createdAt: number; members: string[]; agreed: string[]; lastWords: string | null; plans: number[] };
export type LabPlan = {
  id: number; title: string; orb: string; conversation: string; session: number | null; status: string; createdAt: number;
  rows: { id: string; feature: string; description: string; test: boolean; box: "[ ]" | "[~]" | "[x]" }[]; done: number; total: number;
};
/** The calendar (PLAN 2.12): what is on a day, as the home works it out. */
export type CalendarEntry =
  | { kind: "bill" | "reminder"; id: number; orb: string; title: string; day: string; time: string | null; amount: string | null; conversation: string | null }
  | { kind: "schedule"; id: string; orb: string; title: string; day: string; time: string; cron: string; enabled: boolean }
  | { kind: "event"; id: string; calendar: string; title: string; day: string; time: string | null; until: string | null; location: string | null };
/** The notification centre (PLAN 2.11): what needs you or happened, as the home keeps it. */
export type Notice = {
  id: number; kind: "bill" | "reminder" | "approval" | "done" | "promotion" | "performance" | "reading" | "friends" | "learning" | "report"; orb: string; conversation: string | null; card: number | null; reminder: number | null;
  title: string; detail: string; due: string | null; at: number;
  /** A lesson a friend offered (PLAN 5.9), kept or not from its notice. */
  lesson?: number | null;
};
/** Office life (PLAN 5.9): a meeting the home decided, a friendship, and one orb's colleagues. */
export type Meeting = {
  id: number; at: number; until: number; a: string; b: string; kind: "coffee" | "ideas" | "game" | "lesson";
  place: "coffee" | "cooler" | "bistro1" | "bistro2" | "pingpong" | "arcade" | "desk"; winner: string | null; delta: number; score: number;
};
export type FriendWord = "good friends" | "friendly" | "colleagues" | "some friction" | "don't get along";
export type Friend = { orb: string; name: string; score: number; word: FriendWord; meetings: number; last: Meeting | null };
export type SocialState = {
  /** The home's clock when it answered: meetings are timed by it, not by this device's. */
  now: number;
  friendships: { a: string; b: string; score: number; word: FriendWord; meetings: number; lastAt: number | null }[];
  meetings: Meeting[]; current: Meeting[];
  lessons: { id: number; at: number; from: string; to: string; line: string; state: string }[];
  /** The moments under way: two orbs run into each other, a line each (the home's social/rules.ts pickMoment). */
  moments?: MomentState[];
};
export type MomentState = {
  kind: "bump" | "highfive" | "cookie" | "joke" | "mug" | "sticky" | "trip" | "dance"; place: "aisle" | "kitchen" | "desk"; tone: "warm" | "flat";
  lines: [string, string]; gestures: [string, string]; delta: number; a: string; b: string; names: [string, string]; score: number; at: number; until: number;
};
/** The morning card (PLAN 3.5): yesterday's work, orb by orb, and the night after it. */
export type Undo = { kind: "lesson"; orb: string; line: string; index: number } | { kind: "habit"; orb: string; habit: string; version: number };
export type MorningCard = { day: string; orbs: { orb: string; habits: number; own: number; big: number; costUsd: number; tokens: number; learned: string[]; promoted: string[]; undo: Undo[] }[] };
/** Where an orb stands (PLAN 3.8), and what the next level needs. */
/** A lesson on his canvas (PLAN 4.4): its steps (each its words, its drawing, its question) and the
 * step it is on, 1-based. */
export type LessonStep = { text: string; do: unknown[][]; question: string; hint: string };
export type LessonState = { id: number; topic: string; title: string; kind: string; steps: LessonStep[]; step: number };

/** A session's board (PLAN 5.1, 5.2): its plans row by row with their reviews and proposed changes,
 * who holds what, and what happened (written by code from the board's events). */
export type BoardRowState = { plan: number; row: string; test: boolean; box: string; command: string | null; review: string | null };
export type Change = { id: number; plan: number; proposer: string; row: string; feature: string; description: string; test: string; agreedBy: string | null };
export type ClaimState = { id: number; plan: number; orb: string; name: string; rows: string[]; paths: string[]; stale: boolean };
export type SessionBoard = { plans: { id: number; title: string; status: string; rows: BoardRowState[]; changes: Change[] }[]; claims: ClaimState[]; chatter: { seq: number; at: number; text: string }[] };

/** The org chart (PLAN 5.6): the office with levels and how long each has been about, who leads each
 * kind of work, and who was let go (to rehire). */
export type OrgOrb = { id: string; name: string; specialty: string; level: string; createdAt: number; born: number; hired: number; left: number | null; now: number };
export type OrgState = { chief: string | null; leads: Record<string, string>; heads?: Record<string, string | null>; founder?: string | null; company?: string | null; orbs: OrgOrb[]; away: (OrgOrb & { xp: number; diplomas: string[]; atSchool: boolean })[] };
/** School (PLAN 5.7): an orb's report card, the term now or the last. */
export type SchoolAnswer = { n: number; ask: string; answer: string; ok: boolean | null; why?: string; up?: boolean | null };
export type SchoolSubject = {
  id: number; kind: string; name: string; how: string; syllabus: string[] | null; lessons: number; notes: { text: string; at: number }[];
  started: number | null; now: number | null; sittings: { id: number; at: number; score: number | null; state: "graded" | "waiting" | "void"; kept: boolean | null; starting: boolean }[];
  graduatedAt: number | null; rate: { sitting: number; answers: SchoolAnswer[] } | null; trouble: string | null;
};
export type ReportCardState = { orb: string; atSchool: boolean; passMark: number | null; since: number | null; subjects: SchoolSubject[]; diplomas: { kind: string; name: string; at: number; score: number }[] };
/** A career page (PLAN 5.6). */
/** The company's board (PLAN 5.16): who sits by which post, its last election, its proposals and their votes. */
export type BoardPost = "chair" | "vice" | "secretary" | "treasurer" | "director";
/** The board's daily report (PLAN 5.18): each idea an orb's, the rest by code (the home's report.ts). */
export type Report = {
  id: number; at: number; day: string;
  chair: { orb: string; name: string } | null;
  /** each idea an orb's; since 10-08 (PLAN 5.20) who pays, what it costs (inside the budget) and the first step */
  ideas: { id: string; orb: string; name: string; text: string; verdict: "approved" | "passed" | null; who?: string | null; start?: number; month?: number; first?: string | null }[];
  /** pitches left out: they cost more than the company can spend, or did not say what they cost */
  left?: number;
  world: { title: string; url: string; host: string; orb: string; name: string }[];
  office: { text: string; orb: string | null }[];
  people: { well: { orb: string; name: string; why: string }[]; fit: { orb: string; name: string; why: string }[] };
  hiring: { positions: string[]; applicants: number[]; returning: { id: string; name: string; specialty: string }[] };
  money: { treasurer: string | null; yesterdayUsd: number; weekUsd: number; bills: { title: string; due: string; amount: string | null }[] };
};
/** The numbers behind the home page, as charts (PLAN 2.19; the home's stats.ts): by day, oldest first, and by what. */
export type TokenCount = { calls: number; input: number; cached: number; output: number };
export type StatsState = {
  days: string[];
  brain: { total: TokenCount; byDay: TokenCount[]; byModel: (TokenCount & { model: string })[]; byKind: (TokenCount & { kind: string })[]; byOrb: (TokenCount & { orb: string | null; name: string })[] };
  xp: { total: { earned: number; lost: number }; byDay: { earned: number; lost: number }[]; byOrb: { orb: string; name: string; earned: number; lost: number }[]; byTier?: { tier: "easy" | "standard" | "hard" | "expert"; jobs: number; earned: number }[] };
};
export type BoardState = {
  size: number;
  seats: { orb: string; name: string; post: BoardPost }[];
  election: { at: number; size: number; votes: { voter: string; for: string }[]; ranking: string[] } | null;
  proposals: { id: number; at: number; text: string; by: string; carried: boolean | null; votes: { orb: string; name: string; post: BoardPost; vote: "yes" | "no" | "abstain"; why: string }[] }[];
};

/** The home page's look at the office (owner, 10-07: "a nice home page the app can default to ... with a nice dashboard
 * and stats"), read by the home's code (home/src/dashboard.ts). */
export type DashboardState = {
  now: number;
  name: string | null;
  company?: string | null;
  orbs: number;
  working: string[];
  waiting: string[];
  notices: number;
  xp: { today: number; week: number; top: { orb: string; name: string; xp: number }[] };
  brain: { today: { tokens: number; requests: number }; week: { tokens: number; requests: number } };
  lately: { at: number; orb: string; name: string; summary: string; conversation: string | null }[];
  sessions: { id: number; title: string; orbs: number; at: number }[];
  meetings: { at: number; a: string; b: string; kind: string; place: string; idea: string | null }[];
  coming: CalendarEntry[];
  hiring: { positions: number; applicants: number };
  report: { at: number; ideas: number; open: number; first: { name: string; text: string } | null; chair: string | null } | null;
};

export type CareerState = Standing & {
  radar: Record<string, { xp: number; passRate: number | null; runs: number }>;
  niches: { word: string; runs: number; ratio: number }[];
  habits: { task: string; version: number; shared: { from: string } | null }[];
  reviews: { given: number; received: number };
  performance: { suggest: string; why: string } | null;
  /** Its growth with the others (owner, 10-07): its latest work, its meetings and the ideas traded in them,
   * its friends, the lessons passed between them. Older homes leave these out. */
  work?: { at: number; summary: string; conversation: string | null }[];
  meetings?: { at: number; with: string; kind: string; place: string; word: string; delta: number; won: boolean | null; brought: string | null; heard: string | null }[];
  friends?: { name: string; word: string; score: number; meetings: number }[];
  lessons?: { at: number; from: string; to: string; line: string; state: string }[];
  /** The office by XP, the most first (owner, 10-07: each wants "to be the best orb"). */
  ranking?: { orb: string; name: string; xp: number }[];
};

/** The recruiter (PLAN 5.8): the positions you are hiring for, who applied (a seed each, made whole
 * by the app's dice: spec.ts `applicant`), and the orbs you let go who apply again, with their record. */
export type RecruiterState = {
  positions: string[];
  applicants: { id: number; specialty: string; seed: number; day: string; startsAs: string }[];
  returning: { id: string; name: string; specialty: string; level: string; xp: number; diplomas: string[]; born: number; hired: number; left: number | null; now: number }[];
};
export type InterviewLine = { role: "you" | "orb"; text: string; at: number };

export type Standing = {
  level: string;
  xp: number;
  next: { from: string; to: string; ready: boolean; missing: string[]; evidence: { xp: { has: number; needs: number }; tasks: { has: string[]; needs: number } } } | null;
  /** When he was made, when he joined this time (his latest hire or rehire), when he left if he is
   * away, and the home's now: his age and his days in the company (owner, 10-02). */
  born: number;
  hired: number;
  left: number | null;
  now: number;
};
/** Your projects folder, as the home has it: where, on or off, the last copy, or why it could not. */
export type ProjectsState = { dir: string; on: boolean; last: { at: number; files: number } | null; why: string | null };
/** The brain order (PLAN 1.11), as the home has it: each brain's state, and ChatGPT's own. */
export type BrainState = { id: "chatgpt" | "gemini" | "key" | "local"; label: string; state: "ready" | "resting" | "absent"; why: string | null; until: number | null; setup: string };
export type Brains = { order: BrainState[]; gemini: { model: string } | null; local: { baseUrl: string; model: string } | null; search: boolean };
export type ChatGPT = { connected: boolean; account: { email: string | null; name: string | null } | null; model: string | null; models: { slug: string; name: string }[]; paused: { until: number } | null; signingIn: boolean; manageUsage: string };
/** What a schedule is asked for (the home's schedule-rules.ts checks it): daily at a time, or every N. */
export type ScheduleRule = { kind: "daily"; time: string; days?: number[] } | { kind: "every"; n: number; unit: "minutes" | "hours" };
/** A device signed in to the app, and a passkey (PLAN 2.7). */
export type Device = { id: number; name: string; via: "pair" | "passkey"; createdAt: number; seenAt: number; current: boolean };
export type Passkey = { id: number; name: string; createdAt: number; usedAt: number | null };
/** Your connections (PLAN 4.2): a calendar by its address, a mail account, a connector (its secrets never come back). */
/** The day (PLAN 4.5): the brief and what clashes, in Ash's words; or why it cannot be said now. */
export type YourDay = { brief: string; clashes: { kind: "overlap" | "prep" | "travel"; said: string; at: number }[]; owedSaid: string | null } | { why: string };
export type CalendarFeed = { name: string; label: string; read: number | null; why: string | null; account: string | null };
/** Your Google and Microsoft accounts: which this home can connect to, and the ones connected. */
export type Accounts = {
  providers: { id: "google" | "microsoft"; title: string; what: string; ready: boolean; why: string | null }[];
  accounts: Record<string, { provider: "google" | "microsoft"; email: string }>;
};
export type MailAccount = { host: string; port?: number; tls?: boolean; user: string; address?: string; oauth?: string };
export type ConnectorSpec = { command: string; args?: string[]; env?: Record<string, string | { secret: string }> } | { url: string; headers?: Record<string, string | { secret: string }> };
export type Connector = { name: string; state: "ready" | "failed" | "starting"; why: string | null; tools: string[]; spec: ConnectorSpec };
/** A session (PLAN 2.9): a piece of work, with the orbs (by id) that work each tab, in turn order. */
export type Session = { id: number; title: string; createdAt: number; brainstorm: string[]; floor: string[] };
/** A password saved for the orbs' browsers (PLAN 4.1): never the password itself. */
export type VaultEntry = { site: string; username: string; added: number };
/** What your hands do on his computer once you have it (PLAN 4.6), in his screen's pixels. */
export type Hands = { kind: "click"; x: number; y: number } | { kind: "type"; text: string } | { kind: "key"; key: string } | { kind: "scroll"; dy: number } | { kind: "go"; url: string } | { kind: "back" | "forward" | "reload" };
/** A piece of a command's output, live (PLAN 4.6): his, or yours in his terminal (`call` "you-…"). */
export type TerminalChunk = { orb: string; conversation: string | null; run: number; call: string; chunk: string };
/** His browser (PLAN 4.1): open or not, in your hands or not, and the last still of his screen. */
export type ComputerState = { awake: boolean; takenOver: boolean; screen: { url: string; title: string; at: number; shot: number; cursor: { x: number; y: number } | null; width: number; height: number } | null };
export const tabOf = (id: number, tab: Tab): string => `team:${id}:${tab}`;

/** What the app needs from wherever its office lives. */
// ── the desk (PLAN 5.22-5.27), as the home's door gives it ─────────────────────────────────────────
export type DeskCandle = { t: number; o: number; h: number; l: number; c: number; v: number };
export type DeskTicker = { symbol: string; price: number; changePct: number; high: number; low: number; volume: number; at: number; stale: boolean };
export type DeskSeries = { kind: string; field?: string; period?: number; k?: number; fast?: number; slow?: number; signal?: number; value?: number };
export type DeskCondition = { left: DeskSeries; op: string; right: DeskSeries };
export type DeskRules = { all: DeskCondition[] } | { any: DeskCondition[] };
export type DeskSpec = { name: string; symbol: string; timeframe: string; entry: DeskRules; exit?: DeskRules; stopLossPct?: number; takeProfitPct?: number; trailingStopPct?: number; sizePct: number; feeBps?: number; slippageBps?: number };
export type DeskMetrics = { returnPct: number; holdPct: number; maxDrawdownPct: number; trades: number; winRate: number | null; profitFactor: number | null; avgTradePct: number | null; exposurePct: number; feesPaid: number };
export type DeskTrade = { entryT: number; entryPx: number; exitT: number; exitPx: number; qty: number; pnl: number; pnlPct: number; fees: number; why: string };
export type DeskStrategy = { id: number; name: string; by: string | null; spec: DeskSpec; words: string; backtest: DeskMetrics | null; createdAt: number };
export type DeskBook = { id: number; orb: string; strategy: number | null; symbol: string | null; cashStart: number; cash: number; qty: number; entryPx: number; entryT: number; fees: number; state: "live" | "stopped"; startedAt: number; stoppedAt: number | null; holdings: { symbol: string; qty: number; cost: number; since: number }[]; equity: number };
export type DeskQuote = { amountIn: string; amountOut: string; out: string; priceImpactPct: number | null; feeUsd: number | null; route: string[]; router: string | null };
export type DeskSwap = { id: number; orb: string | null; chain: string; sell: string; buy: string; amount: string; usd: number; why: string; quote: DeskQuote | null; state: "asked" | "approved" | "built" | "sent" | "confirmed" | "failed" | "denied" | "expired"; tx: string | null; error: string | null; createdAt: number; settledAt: number | null };
export type DeskWallet = { id: number; chain: "evm" | "solana" | "bitcoin"; address: string; label: string; wallet: string | null; addedAt: number };
export type DeskHolding = { chain: string; symbol: string; amount: string; usd: number | null };
export type DeskChain = { id: string; name: string; kind: "evm" | "solana"; chainId?: number; explorer: string; tokens: { symbol: string; decimals: number }[] };
export type DeskSettings = { perTradeUsd: number; perDayUsd: number; slippageBps: number; off: boolean };
export type DeskEvent = { seq: number; at: number; orb: string | null } & Record<string, unknown>;
export type DeskState = {
  now: number; market: { source: string; ok: boolean; lastOk: number | null; error: string | null; restingUntil: number | null }; prices: DeskTicker[];
  strategies: DeskStrategy[]; books: DeskBook[]; notes: { id: number; orb: string; symbol: string; title: string; text: string; at: number }[]; settings: DeskSettings;
  fills: DeskEvent[]; trades: DeskEvent[]; wallets: DeskWallet[]; swaps: DeskSwap[]; chains: DeskChain[];
};
export type DeskBuilt = { kind: "evm"; chainId: number; approve: { to: string; data: string } | null; tx: { to: string; data: string; value: string; gas: string | null } } | { kind: "solana"; transaction: string };

export interface Office {
  readonly kind: "home" | "preview";
  orbs(): Promise<Character[] | null>;
  /** The orbs you let go (PLAN 5.5), as they look: the floor seats those at school in its classroom (owner, 10-08). */
  away(): Promise<Character[]>;
  add(c: Character): Promise<void>;
  letGo(c: Character, handTo?: string): Promise<void>;
  /** Brings back an orb you let go (PLAN 5.5), with everything he had and what he learned away. */
  rehire(id: string): Promise<void>;
  org(): Promise<OrgState>;
  /** The recruiter (PLAN 5.8): who applied; a position ticked or unticked; an interview (the brain
   * answers as the applicant, with no tools); hire (as applied, the interview the first chat) or pass. */
  recruiting(): Promise<RecruiterState>;
  setPosition(specialty: string, open: boolean): Promise<string[]>;
  /** Several at once: All, or all of a department (owner, 10-07). */
  setPositions(specialties: string[], open: boolean): Promise<string[]>;
  interviewOf(applicant: number): Promise<InterviewLine[]>;
  interview(applicant: number, c: Character, text: string): Promise<string>;
  hireApplicant(applicant: number, c: Character): Promise<void>;
  passApplicant(applicant: number): Promise<void>;
  /** School (PLAN 5.7): an orb's report card; sending an orb you let go; the syllabus you change; your thumb on an answer. */
  reportCard(orb: string): Promise<ReportCardState>;
  sendToSchool(orb: string, subjects: { kind: string; name?: string }[], passMark: number): Promise<void>;
  setSyllabus(subject: number, topics: string[]): Promise<void>;
  thumb(sitting: number, n: number, up: boolean): Promise<void>;
  career(c: Character): Promise<CareerState>;
  dashboard(): Promise<DashboardState>;
  /** The numbers behind the home page, as charts (PLAN 2.19): the last 7, 14 or 30 days. */
  stats(days: number): Promise<StatsState>;
  /** The desk (PLAN 5.22-5.27): its state, a market's bars, a backtest, strategies kept, archived and run on
   * paper by an orb, a book stopped, its settings; your wallets (public addresses) and what they hold; a quote; a swap
   * of yours, your answer to an orb's, its transaction built for your wallet, and what your wallet did with it. */
  desk(): Promise<DeskState>;
  candles(symbol: string, tf: string, n?: number): Promise<DeskCandle[]>;
  backtest(spec: DeskSpec): Promise<{ metrics: DeskMetrics; trades: DeskTrade[]; equity: { t: number; equity: number }[] }>;
  saveStrategy(spec: DeskSpec): Promise<DeskStrategy>;
  archiveStrategy(id: number): Promise<void>;
  runStrategy(id: number, orb: string): Promise<DeskBook>;
  stopBook(id: number): Promise<DeskBook>;
  setDeskSettings(s: Partial<DeskSettings>): Promise<DeskSettings>;
  addWallet(address: string, o?: { label?: string; wallet?: string | null }): Promise<DeskWallet>;
  removeWallet(id: number): Promise<void>;
  holdings(id: number): Promise<{ holdings: DeskHolding[]; errors: string[]; at: number }>;
  quote(o: { chain: string; sell: string; buy: string; amount: string }): Promise<DeskQuote & { usd: number | null }>;
  swap(o: { chain: string; sell: string; buy: string; amount: string }): Promise<DeskSwap>;
  answerSwap(id: number, yes: boolean): Promise<DeskSwap>;
  buildSwap(id: number, from: string): Promise<{ swap: DeskSwap; built: DeskBuilt }>;
  sentSwap(id: number, tx: string): Promise<DeskSwap>;
  unsentSwap(id: number, why: string): Promise<DeskSwap>;
  /** The little things found in the office, kept by the home (every device sees them). */
  keepsakes(): Promise<string[]>;
  keep(id: string): Promise<string[]>;
  /** The board (PLAN 5.16), a proposal put to it, an election now. */
  board(): Promise<BoardState>;
  /** The board's reports, newest first; one made now; your verdict on an idea (approved gives its orb XP). */
  reports(): Promise<Report[]>;
  makeReport(): Promise<void>;
  judgeIdea(id: string, verdict: "approve" | "pass"): Promise<void>;
  propose(text: string): Promise<void>;
  elect(): Promise<void>;
  me(): Promise<Person | null>;
  setName(p: Person): Promise<void>;
  /** A conversation's messages since `since`, and the card waiting in it, if one is. */
  messages(conversation: string, since?: number): Promise<{ messages: Message[]; card: Card | null }>;
  /** A private chat with one orb (PLAN 2.10); `said`, you spoke it (PLAN 4.7: he answers for the ear). */
  say(c: Character, text: string, o?: { said?: boolean }): Promise<void>;
  /** Sessions (PLAN 2.9). */
  sessions(): Promise<Session[]>;
  newSession(title: string, members: Partial<Record<Tab, string[]>>): Promise<Session>;
  bring(session: number, tab: Tab, orbs: string[]): Promise<Session>;
  sayIn(session: number, tab: Tab, text: string): Promise<void>;
  /** Deletes a session: its work stops and its chats are gone (owner, 10-06). */
  deleteSession(session: number): Promise<void>;
  answer(card: number, choice: Choice, text?: string): Promise<void>;
  /** The notification centre: what is out; putting one away, or all, for every device. */
  notices(): Promise<Notice[]>;
  /** The brains (PLAN 1.11): the order and ChatGPT's sign-in; one Gemini key, a web-search key and
   * a local coder, each set or taken away (a key goes to the home's keychain, never back). */
  brains(): Promise<Brains>;
  /** Your projects folder (the home's projects.ts): where every project's files are copied. */
  projects(): Promise<ProjectsState>;
  setProjects(p: { dir?: string; on?: boolean }): Promise<ProjectsState>;
  syncProjects(): Promise<ProjectsState>;
  chatgpt(): Promise<ChatGPT>;
  chatgptSignIn(): Promise<string>;
  chatgptSignOut(): Promise<void>;
  chatgptModel(slug: string): Promise<void>;
  setKey(which: "gemini" | "search", key: string | null): Promise<Brains>;
  setLocal(local: { baseUrl: string; model: string } | null): Promise<Brains>;
  /** The devices signed in (PLAN 2.7): sign one out, pair a phone (a link good for five minutes,
   * shown as a QR code), and the owner's passkeys. */
  devices(): Promise<Device[]>;
  signOut(id: number): Promise<void>;
  pairPhone(): Promise<string>;
  /** The app opened in this machine's own browser, paired, at `to` (a place in it, as /desk/trade): from the machine
   * the home runs on only. A link to open by hand when no browser could be. */
  openInBrowser(to: string): Promise<{ opened: boolean; link: string | null }>;
  passkeys(): Promise<Passkey[]>;
  /** Makes a passkey here and keeps it on the home (named from this browser unless named). */
  addPasskey(name?: string): Promise<void>;
  removePasskey(id: number): Promise<void>;
  /** The gym (PLAN 3.5, 3.8): the morning card and its one-tap undo; an orb's level, and your yes. */
  morning(): Promise<MorningCard | null>;
  undo(u: Undo): Promise<MorningCard | null>;
  standing(c: Character): Promise<Standing>;
  promote(c: Character, to: string): Promise<void>;
  notYet(c: Character, to: string): Promise<void>;
  putAway(id: number): Promise<void>;
  putAwayAll(): Promise<void>;
  /** The lab: what has `q` in it (everything when empty); a brainstorm reopened as a new session. */
  labOf(q?: string): Promise<{ sessions: LabSession[]; plans: LabPlan[] }>;
  /** The reading library (PLAN 3.12): what is followed, what is read now, and the pages read for a word. */
  readingOf(q?: string): Promise<ReadingState>;
  /** Stops following a source; its pages leave the library. */
  stopFollowing(source: number): Promise<void>;
  /** Office life (PLAN 5.9): the friendships, the meetings (those under way for the floor), the lessons waiting. */
  socialOf(): Promise<SocialState>;
  /** One orb's colleagues, best friends first, each with its last moment with it. */
  friendsOf(orb: string): Promise<Friend[]>;
  /** An orb's traits as its DNA has them, for the home's meetings (the home cannot read DNA itself). */
  setTraits(orb: string, traits: Record<string, number>): Promise<void>;
  /** A lesson a friend offered: kept (the orb learns it) or not. */
  keepLesson(id: number): Promise<void>;
  dropLesson(id: number): Promise<void>;
  reopen(session: number): Promise<Session>;
  /** The calendar: the days from `from` to `to`; your own changes (an orb's go through a card). */
  calendar(from: string, to: string): Promise<CalendarEntry[]>;
  moveReminder(id: number, due: string): Promise<void>;
  doneReminder(id: number): Promise<void>;
  setSchedule(id: string, change: { time?: string; enabled?: boolean }): Promise<void>;
  /** The schedule editor (PLAN 2.4): a rule in plain words with its next runs, then kept or removed. */
  schedulePreview(rule: ScheduleRule): Promise<{ cron: string; words: string; next: number[] }>;
  addSchedule(s: { orb: string; name: string; instruction: string; rule: ScheduleRule }): Promise<void>;
  removeSchedule(id: string): Promise<void>;
  /** Your day (PLAN 4.5): the morning brief and what clashes, from your calendars and the orbs' list. */
  day(): Promise<YourDay>;
  /** Your connections (PLAN 4.2): calendars by their addresses, mail accounts, connectors. */
  accounts(): Promise<Accounts>;
  /** Starts a Google or Microsoft sign-in: the address to open (it comes back to the home's machine). */
  connectAccount(provider: "google" | "microsoft"): Promise<string>;
  disconnectAccount(name: string): Promise<void>;
  calendars(): Promise<CalendarFeed[]>;
  addCalendar(name: string, label: string, address: string): Promise<void>;
  removeCalendar(name: string): Promise<void>;
  mail(): Promise<Record<string, MailAccount>>;
  addMail(name: string, account: MailAccount, password: string): Promise<void>;
  removeMail(name: string): Promise<void>;
  connectors(): Promise<Connector[]>;
  addConnector(name: string, spec: ConnectorSpec, secrets: Record<string, string>): Promise<void>;
  connector(name: string, act: "restart" | "remove"): Promise<void>;
  /** Gives him a file (PLAN 2.4, attach): kept in his workspace's from-you/; the path it is at. */
  give(c: Character, file: File): Promise<string>;
  /** His computer: a folder of his workspace (its top when empty), and a file in it. */
  files(c: Character, dir?: string, session?: number): Promise<Entry[]>;
  file(c: Character, path: string, session?: number): Promise<WorkFile>;
  /** A session's board (PLAN 5.1): read it; let a stale claim go; your review of a junior's row; your
   * second to a proposed change. */
  sessionBoard(session: number): Promise<SessionBoard>;
  recoverClaim(session: number, claim: number): Promise<void>;
  reviewRow(plan: number, row: string, approve: boolean, note: string): Promise<void>;
  agreeChange(id: number): Promise<void>;
  /** His browser (PLAN 4.1): where it is, the still of his screen, and your hand on it. */
  computer(c: Character): Promise<ComputerState>;
  computerAct(c: Character, act: "wake" | "sleep" | "reset" | "take-over" | "hand-back"): Promise<ComputerState>;
  /** The still `shot` (each still has its own number, so a new one is never an old one cached). */
  screenUrl(c: Character, shot: number): string;
  /** His screen live (PLAN 4.6): an address an <img> shows frame by frame. */
  liveUrl(c: Character): string;
  /** Your hands on his page, once you have taken it over. */
  hands(c: Character, h: Hands): Promise<ComputerState>;
  /** A command you type into his terminal, once you have his computer: run in his sandbox. */
  terminal(c: Character, command: string): Promise<{ output: string; failed: boolean }>;
  /** His voice (PLAN 4.3): the phrases a reply is said in, and one phrase as WAV, at `speed`. */
  phrasesFor(c: Character, text: string, speed: number): Promise<string[]>;
  spoken(c: Character, phrase: string, speed: number): Promise<ArrayBuffer>;
  /** His ears: what you said in a recording (and whether Whisper was unsure of it); whether it was
   * him being called; whether you finished. */
  hear(c: Character, audio: Blob): Promise<{ text: string; unsure: boolean }>;
  woken(c: Character, audio: Blob): Promise<{ woken: boolean; heard: string }>;
  finished(c: Character, audio: Blob): Promise<{ finished: boolean; p: number }>;
  /** A real conversation (PLAN 4.7): your first pause in one ask (finished? your words so far);
   * what you said while he was saying `saying` (his echo, an "mhm", or you taking the floor). */
  turn(c: Character, audio: Blob): Promise<{ finished: boolean; p: number; hold: boolean; words: string; unsure: boolean }>;
  overlap(c: Character, audio: Blob, saying: string): Promise<{ kind: string; words: string }>;
  /** Ends his run now (the conversation's Stop). */
  stop(c: Character): Promise<void>;
  /** His lesson (PLAN 4.4): the one he is giving now, or null; the canvas's address; your answer
   * (judged with what the canvas shows), "tell me", next and stop. */
  lesson(c: Character): Promise<LessonState | null>;
  lessonCanvasUrl(): string;
  lessonAnswer(c: Character, answer: string, facts: Record<string, unknown>): Promise<{ correct: boolean | null; say: string }>;
  lessonExplain(c: Character, facts: Record<string, unknown>): Promise<string>;
  lessonNext(c: Character): Promise<LessonState | null>;
  lessonStop(c: Character): Promise<void>;
  /** The passwords you save for your orbs' browsers (PLAN 4.1): listed, never shown back. */
  vault(): Promise<VaultEntry[]>;
  savePassword(site: string, username: string, password: string): Promise<VaultEntry[]>;
  removePassword(site: string, username: string): Promise<VaultEntry[]>;
  /** What happens as it happens: every event, and a reply's words as they stream. Returns a stop. */
  watch(on: { event?: (e: { type: string; orb: string | null; conversation: string | null; at?: number; data?: Record<string, unknown> }) => void; text?: (d: { orb: string; conversation: string; delta: string; run: number }) => void; /** his terminal, live (PLAN 4.6) */ terminal?: (d: TerminalChunk) => void; /** the stream is open: from here on nothing is missed */ open?: () => void }): () => void;
}

/** A private chat's conversation with an orb. */
export const chatOf = (c: Pick<Character, "name">): string => `chat:${idOf(c.name)}`;

/** Why the app is not on a home: none there (a preview), or there but not paired, or refused. */
export type Link = { office: Office } | { trouble: string };

/** An orb's id from his name: what the home files him under ("Zoë B" is zoe-b). */
export const idOf = (name: string): string =>
  name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "orb";

/** A character as the home keeps him: the name and specialty it reads, and the rest, his look. */
export function toHome(c: Character): HomeOrb {
  const { name, specialty, ...look } = c;
  return { id: idOf(name), name, specialty, look };
}

export function fromHome(o: HomeOrb, fallback: Character): Character {
  return sane({ ...(o.look as Partial<Character>), name: o.name, specialty: o.specialty as Character["specialty"] }, fallback);
}

// A preview's office (no home behind the page) is kept in the browser.
const KEPT = "orbs.office";
export function keptOffice(base: Character): Character[] {
  try {
    const v: unknown = JSON.parse(globalThis.localStorage?.getItem(KEPT) ?? "[]");
    return Array.isArray(v) ? v.filter((c): c is Character => Boolean(c) && typeof (c as Character).name === "string" && Boolean((c as Character).name)).map((c) => sane(c, base)) : [];
  } catch {
    return [];
  }
}
export function keepOffice(office: Character[]): void {
  try {
    globalThis.localStorage?.setItem(KEPT, JSON.stringify(office));
  } catch {
    // a private window: kept for as long as the page is open
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    // the app's own header: a change through a session needs it (the home refuses one without it)
    headers: { "x-orbs": "1", ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { status: res.status });
  return body;
}

/** The office on the home, through its door. */
/** One live stream for the whole page, however many rooms and orbs listen: a browser keeps about
 * six connections to a host, and a stream each would leave none for the page's own requests. It
 * opens with its first listener and closes with its last; one that joins an open stream is told
 * at once. */
type Watcher = Parameters<Office["watch"]>[0];
function sharedStream(): (on: Watcher) => () => void {
  const watchers = new Set<Watcher>();
  let es: EventSource | null = null;
  let open = false;
  return (on) => {
    watchers.add(on);
    if (!es) {
      const s = new EventSource("../stream?since=" + Number.MAX_SAFE_INTEGER);
      s.addEventListener("event", (m) => {
        const e = JSON.parse((m as MessageEvent).data as string);
        for (const w of [...watchers]) w.event?.(e);
      });
      s.addEventListener("text", (m) => {
        const d = JSON.parse((m as MessageEvent).data as string);
        for (const w of [...watchers]) w.text?.(d);
      });
      s.addEventListener("terminal", (m) => {
        const d = JSON.parse((m as MessageEvent).data as string) as TerminalChunk;
        for (const w of [...watchers]) w.terminal?.(d);
      });
      s.addEventListener("open", () => {
        open = true;
        for (const w of [...watchers]) w.open?.();
      });
      s.addEventListener("error", () => (open = false)); // it reconnects by itself; "open" comes again
      es = s;
    } else if (open) queueMicrotask(() => watchers.has(on) && on.open?.());
    return () => {
      watchers.delete(on);
      if (!watchers.size && es) {
        es.close();
        es = null;
        open = false;
      }
    };
  };
}

export function doorOffice(base: Character): Office {
  const watch = sharedStream();
  return {
    kind: "home",
    async orbs() {
      const { orbs } = await call<{ orbs: HomeOrb[] }>("../orbs");
      return orbs.map((o) => fromHome(o, base));
    },
    async away() {
      const { orbs } = await call<{ orbs: (HomeOrb & { letGoAt?: number | null })[] }>("../orbs?all=1");
      return orbs.filter((o) => o.letGoAt != null).map((o) => fromHome(o, base));
    },
    async add(c) {
      await call("../orbs", { method: "POST", body: JSON.stringify(toHome(c)) });
    },
    async letGo(c, handTo) {
      await call(`../orbs/${encodeURIComponent(idOf(c.name))}${handTo ? `?handTo=${encodeURIComponent(handTo)}` : ""}`, { method: "DELETE" });
    },
    async rehire(id) {
      await call(`../orbs/${encodeURIComponent(id)}/rehire`, { method: "POST" });
    },
    async org() {
      return call<OrgState>("../org");
    },
    async recruiting() {
      return call<RecruiterState>("../recruiter");
    },
    async setPosition(specialty, open) {
      return (await call<{ positions: string[] }>(`../recruiter/positions/${encodeURIComponent(specialty)}`, { method: "PUT", body: JSON.stringify({ open }) })).positions;
    },
    async setPositions(specialties, open) {
      return (await call<{ positions: string[] }>("../recruiter/positions", { method: "PUT", body: JSON.stringify({ specialties, open }) })).positions;
    },
    async interviewOf(applicant) {
      return (await call<{ said: InterviewLine[] }>(`../applicants/${applicant}/interview`)).said;
    },
    async interview(applicant, c, text) {
      const who = { name: c.name, title: SPECIALTIES[c.specialty].title, focus: SPECIALTIES[c.specialty].focus, tone: PERSONALITIES[c.personality].tone };
      return (await call<{ answer: string }>(`../applicants/${applicant}/interview`, { method: "POST", body: JSON.stringify({ text, ...who }) })).answer;
    },
    async hireApplicant(applicant, c) {
      const { id, name, look } = toHome(c);
      await call(`../applicants/${applicant}/hire`, { method: "POST", body: JSON.stringify({ id, name, look }) });
    },
    async passApplicant(applicant) {
      await call(`../applicants/${applicant}/pass`, { method: "POST" });
    },
    async reportCard(orb) {
      return call<ReportCardState>(`../orbs/${encodeURIComponent(orb)}/school`);
    },
    async sendToSchool(orb, subjects, passMark) {
      await call(`../orbs/${encodeURIComponent(orb)}/school`, { method: "POST", body: JSON.stringify({ subjects, passMark }) });
    },
    async setSyllabus(subject, topics) {
      await call(`../school/subjects/${subject}/syllabus`, { method: "PUT", body: JSON.stringify({ topics }) });
    },
    async thumb(sitting, n, up) {
      await call(`../school/sittings/${sitting}/answers/${n}`, { method: "POST", body: JSON.stringify({ up }) });
    },
    async career(c) {
      return call<CareerState>(`../orbs/${encodeURIComponent(idOf(c.name))}/career`);
    },
    async stats(days) {
      return call<StatsState>(`../stats?days=${days}`);
    },
    async desk() {
      return call<DeskState>("../desk");
    },
    async candles(symbol, tf, n = 200) {
      return (await call<{ candles: DeskCandle[] }>(`../desk/candles?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&n=${n}`)).candles;
    },
    async backtest(spec) {
      return (await call<{ backtest: { metrics: DeskMetrics; trades: DeskTrade[]; equity: { t: number; equity: number }[] } }>("../desk/backtest", { method: "POST", body: JSON.stringify({ strategy: spec }) })).backtest;
    },
    async saveStrategy(spec) {
      return (await call<{ strategy: DeskStrategy }>("../desk/strategies", { method: "POST", body: JSON.stringify({ strategy: spec }) })).strategy;
    },
    async archiveStrategy(id) {
      await call(`../desk/strategies/${id}`, { method: "DELETE" });
    },
    async runStrategy(id, orb) {
      return (await call<{ book: DeskBook }>("../desk/runs", { method: "POST", body: JSON.stringify({ strategy: id, orb }) })).book;
    },
    async stopBook(id) {
      return (await call<{ book: DeskBook }>(`../desk/books/${id}/stop`, { method: "POST" })).book;
    },
    async setDeskSettings(next) {
      return (await call<{ settings: DeskSettings }>("../desk/settings", { method: "PUT", body: JSON.stringify(next) })).settings;
    },
    async addWallet(address, o = {}) {
      return (await call<{ wallet: DeskWallet }>("../desk/wallets", { method: "POST", body: JSON.stringify({ address, ...o }) })).wallet;
    },
    async removeWallet(id) {
      await call(`../desk/wallets/${id}`, { method: "DELETE" });
    },
    async holdings(id) {
      return call<{ holdings: DeskHolding[]; errors: string[]; at: number }>(`../desk/wallets/${id}/holdings`);
    },
    async quote(o) {
      const q = new URLSearchParams(o);
      return (await call<{ quote: DeskQuote & { usd: number | null } }>(`../desk/quote?${q}`)).quote;
    },
    async swap(o) {
      return (await call<{ swap: DeskSwap }>("../desk/swaps", { method: "POST", body: JSON.stringify(o) })).swap;
    },
    async answerSwap(id, yes) {
      return (await call<{ swap: DeskSwap }>(`../desk/swaps/${id}/answer`, { method: "POST", body: JSON.stringify({ yes }) })).swap;
    },
    async buildSwap(id, from) {
      return call<{ swap: DeskSwap; built: DeskBuilt }>(`../desk/swaps/${id}/build`, { method: "POST", body: JSON.stringify({ from }) });
    },
    async sentSwap(id, tx) {
      return (await call<{ swap: DeskSwap }>(`../desk/swaps/${id}/sent`, { method: "POST", body: JSON.stringify({ tx }) })).swap;
    },
    async unsentSwap(id, why) {
      return (await call<{ swap: DeskSwap }>(`../desk/swaps/${id}/unsent`, { method: "POST", body: JSON.stringify({ why }) })).swap;
    },
    async keepsakes() {
      return (await call<{ keepsakes: string[] }>("../me/keepsakes")).keepsakes;
    },
    async keep(id) {
      return (await call<{ keepsakes: string[] }>("../me/keepsakes", { method: "PUT", body: JSON.stringify({ id }) })).keepsakes;
    },
    async dashboard() {
      return call<DashboardState>("../dashboard");
    },
    async board() {
      return call<BoardState>("../board");
    },
    async reports() {
      return (await call<{ reports: Report[] }>("../reports")).reports;
    },
    async makeReport() {
      await call("../reports", { method: "POST" });
    },
    async judgeIdea(id, verdict) {
      await call(`../reports/ideas/${encodeURIComponent(id)}/${verdict}`, { method: "POST" });
    },
    async propose(text) {
      await call("../board/proposals", { method: "POST", body: JSON.stringify({ text }) });
    },
    async elect() {
      await call("../board/election", { method: "POST" });
    },
    async me() {
      const { me } = await call<{ me: { name: string | null; since: number | null; company?: string | null; budget?: Person["budget"] } }>("../me");
      return me.name ? { name: me.name, since: me.since ?? Date.now(), company: me.company ?? null, budget: me.budget ?? null } : null;
    },
    async setName(p) {
      await call("../me", { method: "PUT", body: JSON.stringify({ name: p.name, ...(p.company && { company: p.company }), ...(p.budget && { budget: p.budget }) }) });
    },
    async messages(conversation, since = 0) {
      const r = await call<{ messages: Message[]; card: Card | null }>(`../conversations/${encodeURIComponent(conversation)}/messages?since=${since}`);
      return { messages: r.messages, card: r.card };
    },
    async sessions() {
      return (await call<{ sessions: Session[] }>("../sessions")).sessions;
    },
    async newSession(title, members) {
      return (await call<{ session: Session }>("../sessions", { method: "POST", body: JSON.stringify({ title, ...members }) })).session;
    },
    async bring(session, tab, orbs) {
      return (await call<{ session: Session }>(`../sessions/${session}/${tab}`, { method: "PUT", body: JSON.stringify({ orbs }) })).session;
    },
    async sayIn(session, tab, text) {
      await call(`../sessions/${session}/${tab}/messages`, { method: "POST", body: JSON.stringify({ text }) });
    },
    async deleteSession(session) {
      await call(`../sessions/${session}`, { method: "DELETE" });
    },
    async say(c, text, o) {
      await call(`../orbs/${encodeURIComponent(idOf(c.name))}/messages`, { method: "POST", body: JSON.stringify({ conversation: chatOf(c), text, ...(o?.said && { said: true }) }) });
    },
    async answer(card, choice, text) {
      await call(`../cards/${card}`, { method: "POST", body: JSON.stringify({ choice, ...(text !== undefined && { answer: text }) }) });
    },
    async notices() {
      return (await call<{ notices: Notice[] }>("../notices")).notices;
    },
    async brains() {
      return (await call<{ brains: Brains }>("../brains")).brains;
    },
    async projects() {
      return (await call<{ projects: ProjectsState }>("../projects")).projects;
    },
    async setProjects(p) {
      return (await call<{ projects: ProjectsState }>("../projects", { method: "POST", body: JSON.stringify(p) })).projects;
    },
    async syncProjects() {
      return (await call<{ projects: ProjectsState }>("../projects/sync", { method: "POST" })).projects;
    },
    async chatgpt() {
      return (await call<{ chatgpt: ChatGPT }>("../chatgpt")).chatgpt;
    },
    async chatgptSignIn() {
      return (await call<{ url: string }>("../chatgpt/sign-in", { method: "POST" })).url;
    },
    async chatgptSignOut() {
      await call("../chatgpt/sign-out", { method: "POST" });
    },
    async chatgptModel(slug) {
      await call("../chatgpt/model", { method: "POST", body: JSON.stringify({ slug }) });
    },
    async setKey(which, key) {
      return (await call<{ brains: Brains }>(`../brains/${which}`, key === null ? { method: "DELETE" } : { method: "POST", body: JSON.stringify({ key }) })).brains;
    },
    async setLocal(local) {
      return (await call<{ brains: Brains }>("../brains/local", local === null ? { method: "DELETE" } : { method: "POST", body: JSON.stringify(local) })).brains;
    },
    async devices() {
      return (await call<{ devices: Device[] }>("../devices")).devices;
    },
    async day() {
      return call<YourDay>("../day");
    },
    async accounts() {
      return call<Accounts>("../accounts");
    },
    async connectAccount(provider) {
      return (await call<{ url: string }>("../accounts/connect", { method: "POST", body: JSON.stringify({ provider }) })).url;
    },
    async disconnectAccount(name) {
      await call(`../accounts/${encodeURIComponent(name)}/remove`, { method: "POST" });
    },
    async calendars() {
      return (await call<{ calendars: CalendarFeed[] }>("../calendars")).calendars;
    },
    async addCalendar(name, label, address) {
      await call("../calendars", { method: "POST", body: JSON.stringify({ name, label, address }) });
    },
    async removeCalendar(name) {
      await call(`../calendars/${encodeURIComponent(name)}/remove`, { method: "POST" });
    },
    async mail() {
      return (await call<{ accounts: Record<string, MailAccount> }>("../mail")).accounts;
    },
    async addMail(name, account, password) {
      await call("../mail", { method: "POST", body: JSON.stringify({ name, account, password }) });
    },
    async removeMail(name) {
      await call(`../mail/${encodeURIComponent(name)}/remove`, { method: "POST" });
    },
    async connectors() {
      return (await call<{ connectors: Connector[] }>("../connectors")).connectors;
    },
    async addConnector(name, spec, secrets) {
      await call("../connectors", { method: "POST", body: JSON.stringify({ name, spec, secrets }) });
    },
    async connector(name, act) {
      await call(`../connectors/${encodeURIComponent(name)}/${act}`, { method: "POST" });
    },
    async signOut(id) {
      await call(`../devices/${id}/revoke`, { method: "POST" });
    },
    async pairPhone() {
      return (await call<{ link: string }>("../devices/pair", { method: "POST" })).link;
    },
    async openInBrowser(to) {
      return await call<{ opened: boolean; link: string | null }>("../devices/open-browser", { method: "POST", body: JSON.stringify({ to }) });
    },
    async passkeys() {
      return (await call<{ passkeys: Passkey[] }>("../passkeys")).passkeys;
    },
    async addPasskey(name) {
      const options = await call<CreateOptions>("../passkeys/new/options", { method: "POST" });
      const made = (await navigator.credentials.create({ publicKey: creating(options) })) as PublicKeyCredential | null;
      if (!made) throw new Error("no passkey was made");
      const r = made.response as AuthenticatorAttestationResponse;
      const credential = { id: made.id, rawId: b64u(made.rawId), type: made.type, response: { clientDataJSON: b64u(r.clientDataJSON), attestationObject: b64u(r.attestationObject) } };
      await call("../passkeys", { method: "POST", body: JSON.stringify({ credential, ...(name && { name }) }) });
    },
    async removePasskey(id) {
      await call(`../passkeys/${id}/remove`, { method: "POST" });
    },
    async morning() {
      return (await call<{ card: MorningCard | null }>("../card")).card;
    },
    async undo(u) {
      return (await call<{ card: MorningCard | null }>("../card/undo", { method: "POST", body: JSON.stringify(u) })).card;
    },
    async standing(c) {
      return call<Standing>(`../orbs/${encodeURIComponent(idOf(c.name))}/level`);
    },
    async promote(c, to) {
      await call(`../orbs/${encodeURIComponent(idOf(c.name))}/promote`, { method: "POST", body: JSON.stringify({ to }) });
    },
    async notYet(c, to) {
      await call(`../orbs/${encodeURIComponent(idOf(c.name))}/decline-promotion`, { method: "POST", body: JSON.stringify({ to }) });
    },
    async putAway(id) {
      await call(`../notices/${id}/put-away`, { method: "POST" });
    },
    async putAwayAll() {
      await call("../notices/put-away", { method: "POST" });
    },
    async labOf(q = "") {
      return call<{ sessions: LabSession[]; plans: LabPlan[] }>(`../lab?q=${encodeURIComponent(q)}`);
    },
    async readingOf(q = "") {
      return call<ReadingState>(`../reading?q=${encodeURIComponent(q)}`);
    },
    async stopFollowing(source) {
      await call(`../reading/sources/${source}`, { method: "DELETE" });
    },
    async socialOf() {
      return call<SocialState>("../social");
    },
    async friendsOf(orb) {
      return (await call<{ friends: Friend[] }>(`../orbs/${encodeURIComponent(orb)}/friends`)).friends;
    },
    async setTraits(orb, traits) {
      await call(`../orbs/${encodeURIComponent(orb)}/traits`, { method: "PUT", body: JSON.stringify({ traits }) });
    },
    async keepLesson(id) {
      await call(`../social/lessons/${id}/keep`, { method: "POST" });
    },
    async dropLesson(id) {
      await call(`../social/lessons/${id}/drop`, { method: "POST" });
    },
    async reopen(session) {
      return (await call<{ session: Session }>(`../lab/sessions/${session}/reopen`, { method: "POST" })).session;
    },
    async calendar(from, to) {
      return (await call<{ entries: CalendarEntry[] }>(`../calendar?from=${from}&to=${to}`)).entries;
    },
    async moveReminder(id, due) {
      await call(`../reminders/${id}`, { method: "POST", body: JSON.stringify({ due }) });
    },
    async doneReminder(id) {
      await call(`../reminders/${id}/done`, { method: "POST" });
    },
    async setSchedule(id, change) {
      await call(`../schedules/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(change) });
    },
    async schedulePreview(rule) {
      return call<{ cron: string; words: string; next: number[] }>("../schedules/preview", { method: "POST", body: JSON.stringify({ rule }) });
    },
    async addSchedule(x) {
      await call("../schedules", { method: "POST", body: JSON.stringify(x) });
    },
    async removeSchedule(id) {
      await call(`../schedules/${encodeURIComponent(id)}/remove`, { method: "POST" });
    },
    async give(c, file) {
      const path = `../orbs/${encodeURIComponent(idOf(c.name))}/workspace/files?name=${encodeURIComponent(file.name)}`;
      return (await call<{ path: string }>(path, { method: "POST", body: file, headers: { "content-type": "application/octet-stream" } })).path;
    },
    async files(c, dir = "", session) {
      return (await call<{ entries: Entry[] }>(`../orbs/${encodeURIComponent(idOf(c.name))}/workspace?path=${encodeURIComponent(dir)}${session === undefined ? "" : `&session=${session}`}`)).entries;
    },
    async file(c, path, session) {
      return (await call<{ file: WorkFile }>(`../orbs/${encodeURIComponent(idOf(c.name))}/workspace/file?path=${encodeURIComponent(path)}${session === undefined ? "" : `&session=${session}`}`)).file;
    },
    async sessionBoard(session) {
      return call<SessionBoard>(`../sessions/${session}/board`);
    },
    async recoverClaim(session, claim) {
      await call(`../sessions/${session}/claims/${claim}/recover`, { method: "POST" });
    },
    async reviewRow(plan, row, approve, note) {
      await call(`../plans/${plan}/rows/${encodeURIComponent(row)}/review`, { method: "POST", body: JSON.stringify({ approve, note }) });
    },
    async agreeChange(id) {
      await call(`../amendments/${id}/agree`, { method: "POST" });
    },
    async computer(c) {
      return call<ComputerState>(`../orbs/${encodeURIComponent(idOf(c.name))}/computer`);
    },
    async computerAct(c, act) {
      return call<ComputerState>(`../orbs/${encodeURIComponent(idOf(c.name))}/computer/${act}`, { method: "POST" });
    },
    screenUrl(c, shot) {
      return `../orbs/${encodeURIComponent(idOf(c.name))}/screen.jpg?shot=${shot}`;
    },
    liveUrl(c) {
      return `../orbs/${encodeURIComponent(idOf(c.name))}/computer/live`;
    },
    async hands(c, h) {
      return call<ComputerState>(`../orbs/${encodeURIComponent(idOf(c.name))}/computer/hands`, { method: "POST", body: JSON.stringify(h) });
    },
    async terminal(c, command) {
      return call<{ output: string; failed: boolean }>(`../orbs/${encodeURIComponent(idOf(c.name))}/terminal`, { method: "POST", body: JSON.stringify({ command }) });
    },
    async phrasesFor(c, text, speed) {
      return (await call<{ phrases: string[] }>(`../orbs/${encodeURIComponent(idOf(c.name))}/voice/phrases`, { method: "POST", body: JSON.stringify({ text, voice: c.voice, speed }) })).phrases;
    },
    async spoken(c, phrase, speed) {
      const res = await fetch(`../orbs/${encodeURIComponent(idOf(c.name))}/voice/say`, {
        method: "POST", credentials: "same-origin", headers: { "x-orbs": "1", "content-type": "application/json" }, body: JSON.stringify({ phrase, voice: c.voice, speed }),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      return res.arrayBuffer();
    },
    async hear(c, audio) {
      const h = await call<{ text: string; unsure?: boolean }>(`../orbs/${encodeURIComponent(idOf(c.name))}/voice/hear`, { method: "POST", body: audio, headers: { "content-type": audio.type || "application/octet-stream" } });
      return { text: h.text, unsure: h.unsure === true };
    },
    async turn(c, audio) {
      return call<{ finished: boolean; p: number; hold: boolean; words: string; unsure: boolean }>(`../orbs/${encodeURIComponent(idOf(c.name))}/voice/turn`, { method: "POST", body: audio, headers: { "content-type": audio.type || "application/octet-stream" } });
    },
    async overlap(c, audio, saying) {
      return call<{ kind: string; words: string }>(`../orbs/${encodeURIComponent(idOf(c.name))}/voice/overlap?saying=${encodeURIComponent(saying.slice(0, 2000))}`, { method: "POST", body: audio, headers: { "content-type": audio.type || "application/octet-stream" } });
    },
    async woken(c, audio) {
      return call<{ woken: boolean; heard: string }>(`../orbs/${encodeURIComponent(idOf(c.name))}/voice/woken`, { method: "POST", body: audio, headers: { "content-type": audio.type || "application/octet-stream" } });
    },
    async finished(c, audio) {
      return call<{ finished: boolean; p: number }>(`../orbs/${encodeURIComponent(idOf(c.name))}/voice/finished`, { method: "POST", body: audio, headers: { "content-type": audio.type || "application/octet-stream" } });
    },
    async stop(c) {
      await call(`../orbs/${encodeURIComponent(idOf(c.name))}/stop`, { method: "POST" });
    },
    async lesson(c) {
      return (await call<{ lesson: LessonState | null }>(`../orbs/${encodeURIComponent(idOf(c.name))}/lesson`)).lesson;
    },
    lessonCanvasUrl() {
      return "../lesson/canvas.html";
    },
    async lessonAnswer(c, answer, facts) {
      return call<{ correct: boolean | null; say: string }>(`../orbs/${encodeURIComponent(idOf(c.name))}/lesson/answer`, { method: "POST", body: JSON.stringify({ answer, facts }) });
    },
    async lessonExplain(c, facts) {
      return (await call<{ say: string }>(`../orbs/${encodeURIComponent(idOf(c.name))}/lesson/explain`, { method: "POST", body: JSON.stringify({ facts }) })).say;
    },
    async lessonNext(c) {
      return (await call<{ lesson: LessonState | null }>(`../orbs/${encodeURIComponent(idOf(c.name))}/lesson/next`, { method: "POST" })).lesson;
    },
    async lessonStop(c) {
      await call(`../orbs/${encodeURIComponent(idOf(c.name))}/lesson/stop`, { method: "POST" });
    },
    async vault() {
      return (await call<{ entries: VaultEntry[] }>("../vault")).entries;
    },
    async savePassword(site, username, password) {
      return (await call<{ entries: VaultEntry[] }>("../vault", { method: "POST", body: JSON.stringify({ site, username, password }) })).entries;
    },
    async removePassword(site, username) {
      return (await call<{ entries: VaultEntry[] }>("../vault/remove", { method: "POST", body: JSON.stringify({ site, username }) })).entries;
    },
    watch(on) {
      // the live stream, with the session cookie (an EventSource sends it, same-origin), shared
      return watch(on);
    },
  };
}

// WebAuthn's options travel as JSON, its buffers as base64url (the home's side: packages/home/src/passkeys.ts)
type CreateOptions = { challenge: string; rp: { id: string; name: string }; user: { id: string; name: string; displayName: string }; pubKeyCredParams: { type: "public-key"; alg: number }[]; timeout: number; attestation: AttestationConveyancePreference; authenticatorSelection: AuthenticatorSelectionCriteria; excludeCredentials: { type: "public-key"; id: string }[] };
type GetOptions = { challenge: string; rpId: string; timeout: number; userVerification: UserVerificationRequirement };
const b64u = (b: ArrayBuffer | null): string | null => {
  if (!b) return null;
  let s = "";
  for (const x of new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (s: string): ArrayBuffer => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)).buffer;
const creating = (o: CreateOptions): PublicKeyCredentialCreationOptions => ({
  ...o, challenge: unb64u(o.challenge), user: { ...o.user, id: unb64u(o.user.id) }, excludeCredentials: o.excludeCredentials.map((c) => ({ ...c, id: unb64u(c.id) })),
});

/** Whether this browser can sign in with a passkey at all. */
export const passkeysHere = (): boolean => typeof globalThis.PublicKeyCredential === "function" && Boolean(globalThis.navigator?.credentials);

/** Signs this browser in with the owner's passkey (PLAN 2.7): no pairing link needed. */
export async function signInWithPasskey(): Promise<void> {
  const o = await call<GetOptions>("../passkeys/sign-in/options", { method: "POST" });
  const got = (await navigator.credentials.get({ publicKey: { ...o, challenge: unb64u(o.challenge), allowCredentials: [] } })) as PublicKeyCredential | null;
  if (!got) throw new Error("no passkey was chosen");
  const r = got.response as AuthenticatorAssertionResponse;
  const credential = { id: got.id, rawId: b64u(got.rawId), type: got.type, response: { clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData), signature: b64u(r.signature), userHandle: b64u(r.userHandle) } };
  await call("../passkeys/sign-in", { method: "POST", body: JSON.stringify({ credential }) });
}

/** Finds the home behind this page, pairing first when the address carries a link's code. */
export async function connect(base: Character): Promise<Link | null> {
  const pair = /(?:^#|[#&])pair=([\w-]+)/.exec(location.hash)?.[1];
  if (pair) {
    try {
      await call("../session", { method: "POST", body: JSON.stringify({ code: pair }) });
    } catch (e) {
      history.replaceState(null, "", "#/home");
      return { trouble: (e as Error).message };
    } finally {
      // the code is spent: off the address, which is the home page's (what the app opens on, owner 10-07), or the place
      // the link was made for (`to`, a place in the app: the desk's Trade tab for a wallet, owner 10-11)
      const to = /[#&]to=([^&]+)/.exec(location.hash)?.[1];
      const place = to ? decodeURIComponent(to) : "";
      const there = /^\/[a-z0-9/_-]{1,60}$/i.test(place);
      if (location.hash.includes("pair=")) history.replaceState(null, "", there ? `#${place}` : "#/home");
      // the app read its room before the code was spent: told, as Back and Forward tell it
      if (there) globalThis.dispatchEvent?.(new PopStateEvent("popstate", { state: null }));
    }
  }
  let res: Response;
  try {
    res = await fetch("../status", { credentials: "same-origin" });
  } catch {
    return null; // no home behind this page: a preview
  }
  if (res.status === 401) return { trouble: "this browser is not signed in to your home yet: open a pairing link (the home prints one when it starts, and a signed-in device can make one for a phone), or sign in with your passkey" };
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
  return { office: doorOffice(base) };
}
