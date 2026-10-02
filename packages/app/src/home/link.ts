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
  | { kind: "schedule"; id: string; orb: string; title: string; day: string; time: string; cron: string; enabled: boolean };
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
  next: { from: string; to: string; ready: boolean; missing: string[]; evidence: { xp: { has: number; needs: number }; tasks: { has: string[]; needs: number } } } | null;
};
/** A session (PLAN 2.9): a piece of work, with the orbs (by id) that work each tab, in turn order. */
export type Session = { id: number; title: string; createdAt: number; brainstorm: string[]; floor: string[] };
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
  /** His computer: a folder of his workspace (its top when empty), and a file in it. */
  files(c: Character, dir?: string): Promise<Entry[]>;
  file(c: Character, path: string): Promise<WorkFile>;
  /** What happens as it happens: every event, and a reply's words as they stream. Returns a stop. */
  watch(on: { event?: (e: { type: string; orb: string | null; conversation: string | null }) => void; text?: (d: { orb: string; conversation: string; delta: string; run: number }) => void; /** the stream is open: from here on nothing is missed */ open?: () => void }): () => void;
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
export function doorOffice(base: Character): Office {
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
    async files(c, dir = "") {
      return (await call<{ entries: Entry[] }>(`../orbs/${encodeURIComponent(idOf(c.name))}/workspace?path=${encodeURIComponent(dir)}`)).entries;
    },
    async file(c, path) {
      return (await call<{ file: WorkFile }>(`../orbs/${encodeURIComponent(idOf(c.name))}/workspace/file?path=${encodeURIComponent(path)}`)).file;
    },
    watch(on) {
      // the live stream, with the session cookie (an EventSource sends it, same-origin)
      const es = new EventSource("../stream?since=" + Number.MAX_SAFE_INTEGER);
      es.addEventListener("event", (m) => on.event?.(JSON.parse((m as MessageEvent).data as string)));
      es.addEventListener("text", (m) => on.text?.(JSON.parse((m as MessageEvent).data as string)));
      es.addEventListener("open", () => on.open?.());
      return () => es.close();
    },
  };
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
  if (res.status === 401) return { trouble: "this browser is not paired with your home yet: open the link the home printed when it started (pnpm start)" };
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
  return { office: doorOffice(base) };
}
