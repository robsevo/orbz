// The app's link to the home (PLAN 2.4). The home serves the app at /app/ and prints a one-time
// pairing link (`pnpm start`); the link's code buys a session cookie, and from then on the office,
// what it calls you, and every orb made or let go are the home's. A page opened anywhere else (the
// dev server, the render checks' scratch server) has no home behind it, and the app works on its
// own there, as a preview: the same screens, kept in the browser.
import { sane, type Character } from "../orb/spec.ts";
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
  id: number; kind: "bill" | "reminder" | "approval" | "done" | "promotion"; orb: string; conversation: string | null; card: number | null; reminder: number | null;
  title: string; detail: string; due: string | null; at: number;
};
/** The morning card (PLAN 3.5): yesterday's work, orb by orb, and the night after it. */
export type Undo = { kind: "lesson"; orb: string; line: string; index: number } | { kind: "habit"; orb: string; habit: string; version: number };
export type MorningCard = { day: string; orbs: { orb: string; habits: number; own: number; big: number; costUsd: number; tokens: number; learned: string[]; promoted: string[]; undo: Undo[] }[] };
/** Where an orb stands (PLAN 3.8), and what the next level needs. */
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
export interface Office {
  readonly kind: "home" | "preview";
  orbs(): Promise<Character[] | null>;
  add(c: Character): Promise<void>;
  letGo(c: Character): Promise<void>;
  me(): Promise<Person | null>;
  setName(p: Person): Promise<void>;
  /** A conversation's messages since `since`, and the card waiting in it, if one is. */
  messages(conversation: string, since?: number): Promise<{ messages: Message[]; card: Card | null }>;
  /** A private chat with one orb (PLAN 2.10). */
  say(c: Character, text: string): Promise<void>;
  /** Sessions (PLAN 2.9). */
  sessions(): Promise<Session[]>;
  newSession(title: string, members: Partial<Record<Tab, string[]>>): Promise<Session>;
  bring(session: number, tab: Tab, orbs: string[]): Promise<Session>;
  sayIn(session: number, tab: Tab, text: string): Promise<void>;
  answer(card: number, choice: Choice, text?: string): Promise<void>;
  /** The notification centre: what is out; putting one away, or all, for every device. */
  notices(): Promise<Notice[]>;
  /** The brains (PLAN 1.11): the order and ChatGPT's sign-in; one Gemini key, a web-search key and
   * a local coder, each set or taken away (a key goes to the home's keychain, never back). */
  brains(): Promise<Brains>;
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
  files(c: Character, dir?: string): Promise<Entry[]>;
  file(c: Character, path: string): Promise<WorkFile>;
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
    async add(c) {
      await call("../orbs", { method: "POST", body: JSON.stringify(toHome(c)) });
    },
    async letGo(c) {
      await call(`../orbs/${encodeURIComponent(idOf(c.name))}`, { method: "DELETE" });
    },
    async me() {
      const { me } = await call<{ me: { name: string | null; since: number | null } }>("../me");
      return me.name ? { name: me.name, since: me.since ?? Date.now() } : null;
    },
    async setName(p) {
      await call("../me", { method: "PUT", body: JSON.stringify({ name: p.name }) });
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
    async say(c, text) {
      await call(`../orbs/${encodeURIComponent(idOf(c.name))}/messages`, { method: "POST", body: JSON.stringify({ conversation: chatOf(c), text }) });
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
    async files(c, dir = "") {
      return (await call<{ entries: Entry[] }>(`../orbs/${encodeURIComponent(idOf(c.name))}/workspace?path=${encodeURIComponent(dir)}`)).entries;
    },
    async file(c, path) {
      return (await call<{ file: WorkFile }>(`../orbs/${encodeURIComponent(idOf(c.name))}/workspace/file?path=${encodeURIComponent(path)}`)).file;
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
      history.replaceState(null, "", "#/office");
      return { trouble: (e as Error).message };
    } finally {
      if (location.hash.includes("pair=")) history.replaceState(null, "", "#/office"); // the code is spent: off the address
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
