// Sessions (PLAN 2.9; owner, 2026-10-01: "basically like the video we sent, are seen as sessions,
// who have a brainstorming tab with a chat next to it ... same for the floor tab, and you choose
// which orbs to bring into each session and each tab ... and thats how they work").
//
// A session is a piece of work: a title, and two tabs, each a conversation of its own:
//   brainstorm   team:<id>:brainstorm   ideas and the debate; a decision is recorded "✓ Agreed"
//   floor        team:<id>:floor        the agreed work, done
// You choose which orbs work each tab. What you say goes into the tab once; then each of its
// orbs takes a turn, in order, each seeing what the others said before him (as theirs, by name:
// conversation.ts `toModel`). A turn waits while an orb waits on your OK, and the next one starts
// when his has ended. A turn is an inbox item of its own ("turn"): one at a time per orb, stopped
// and paused like any other work.
//
// The team (PLAN 5.1, 5.4): a tab has a LEAD, who speaks first (the Chief if he works it, else its
// most senior orb, the first of them on a tie). "@Hazel" in what you say gives the turn to the orbs
// named, and only them. An orb can ask another of the tab (`ask`): a turn of its own for him, the
// request in the tab for everyone to see, and how many hands deep it is (team-tools.ts caps it).
//
// What a round costs (PLAN 5.10; owner, 10-06, after five orbs spent a ChatGPT plan's limit in a
// quarter of an hour: "keep answers short and cheap so everyone can chime in"): the lead (or each
// orb you named) takes a whole turn, on the main brain with its tools; everyone else then CHIMES IN,
// a line or two on the light brain with no tools, or passes. An orb asked by another works on the
// light brain too. When a plan made in a session is approved, its rows are DEALT evenly across the
// Floor (`deal`, by who fits each), so no one orb takes all the work (owner, 10-06: "lets give
// everyone equal work to do, it seemed like only ash was given work").
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "./clock.ts";
import { tx } from "./db.ts";
import type { EventLog } from "./events.ts";
import type { Inboxes } from "./inbox.ts";
import type { Conversations } from "./agent/conversation.ts";
import type { TeamTurn, TurnRole } from "./agent/standing.ts";
import { LEVELS, type Level } from "./gym/levels.ts";

export type Tab = "brainstorm" | "floor";
export const TABS: readonly Tab[] = ["brainstorm", "floor"];
export type Session = { id: number; title: string; createdAt: number; brainstorm: string[]; floor: string[] };

export const tabConversation = (id: number, tab: Tab): string => `team:${id}:${tab}`;
/** How many orbs of a tab may work on asks at once (PLAN 5.10). */
export const MAX_ASKED = 2;
export function parseTabConversation(conv: string): { id: number; tab: Tab } | null {
  const m = /^team:(\d+):(brainstorm|floor)$/.exec(conv);
  return m ? { id: Number(m[1]), tab: m[2] as Tab } : null;
}

export class Team {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #clock: Clock;
  readonly #inbox: Inboxes;
  readonly #conv: Conversations;
  /** For each tab with a round under way: who is still to speak, in order, and how. */
  readonly #rounds = new Map<string, { orb: string; role: TurnRole }[]>();
  readonly #stop: () => void;

  readonly #level: (orb: string) => Level;

  constructor(o: { db: DatabaseSync; events: EventLog; clock: Clock; inbox: Inboxes; conversations: Conversations; level?: (orb: string) => Level }) {
    this.#level = o.level ?? (() => "Junior");
    this.#db = o.db;
    this.#events = o.events;
    this.#clock = o.clock;
    this.#inbox = o.inbox;
    this.#conv = o.conversations;
    // when an orb's turn has ended (not merely paused on a card), the next one's begins
    this.#stop = this.#events.listen((e) => {
      if (e.type !== "run.finished" || !e.conversation || !e.orb) return;
      if (e.data.outcome === "waiting") return;
      const left = this.#rounds.get(e.conversation);
      if (!left || left[0]?.orb !== e.orb) return;
      left.shift();
      this.#next(e.conversation);
    });
  }

  close(): void {
    this.#stop();
  }

  create(title: string, members: Partial<Record<Tab, string[]>> = {}): Session {
    const t = title.replace(/\s+/g, " ").trim();
    if (!t) throw new Error("a session needs a title");
    for (const tab of TABS) this.#check(members[tab] ?? []); // all of it, before anything is kept
    const at = this.#clock.now();
    const id = Number(this.#db.prepare("INSERT INTO work_sessions (title, created_at) VALUES (?, ?)").run(t.slice(0, 80), at).lastInsertRowid);
    for (const tab of TABS) this.setMembers(id, tab, members[tab] ?? []);
    this.#events.append("session.created", { session: id, title: t });
    return this.get(id)!;
  }

  get(id: number): Session | undefined {
    const r = this.#db.prepare("SELECT * FROM work_sessions WHERE id = ? AND archived_at IS NULL").get(id) as { id: number; title: string; created_at: number } | undefined;
    if (!r) return undefined;
    const members = (tab: Tab): string[] => (this.#db.prepare("SELECT orb FROM work_members WHERE session = ? AND tab = ? ORDER BY turn").all(id, tab) as { orb: string }[]).map((m) => m.orb);
    return { id: r.id, title: r.title, createdAt: r.created_at, brainstorm: members("brainstorm"), floor: members("floor") };
  }

  list(): Session[] {
    return (this.#db.prepare("SELECT id FROM work_sessions WHERE archived_at IS NULL ORDER BY id DESC").all() as { id: number }[]).map((r) => this.get(r.id)!);
  }

  /** Who works a tab, in the order they take their turns: orbs in the office only. */
  setMembers(id: number, tab: Tab, orbs: string[]): Session {
    if (!TABS.includes(tab)) throw new Error(`a session's tabs are brainstorm and floor, not ${tab}`);
    const seen = this.#check(orbs);
    this.#db.prepare("DELETE FROM work_members WHERE session = ? AND tab = ?").run(id, tab);
    seen.forEach((o, turn) => this.#db.prepare("INSERT INTO work_members (session, tab, orb, turn) VALUES (?, ?, ?, ?)").run(id, tab, o, turn));
    this.#events.append("session.members", { session: id, tab, orbs: seen });
    return this.get(id)!;
  }

  #check(orbs: string[]): string[] {
    const seen = [...new Set(orbs)];
    for (const o of seen) {
      const orb = this.#inbox.orb(o);
      if (!orb || orb.letGoAt !== null) throw new Error(`${o} is not in the office`);
    }
    return seen;
  }

  /** Who leads a tab (PLAN 5.4): the Chief if he works it, else its most senior orb (the first of
   * them, in turn order, on a tie). */
  lead(id: number, tab: Tab): string | null {
    const members = this.get(id)?.[tab] ?? [];
    let best: string | null = null;
    for (const m of members) if (best === null || LEVELS.indexOf(this.#level(m)) > LEVELS.indexOf(this.#level(best))) best = m;
    return best;
  }

  /** The person says something in a tab: it is put there once, and its orbs take their turns, the
   * lead first; "@Name" gives the turn to the orbs named, and only to them. */
  say(id: number, tab: Tab, text: string): { conversation: string; turns: string[] } {
    const s = this.get(id);
    if (!s) throw new Error(`no session ${id}`);
    const members = s[tab];
    if (!members.length) throw new Error(`no orb works this session's ${tab} yet: bring one in`);
    const conversation = tabConversation(id, tab);
    const named = members.filter((m) => {
      const name = (this.#inbox.orb(m)?.name ?? m).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(^|\\s)@${name}\\b`, "i").test(text);
    });
    const lead = this.lead(id, tab);
    const order = named.length ? named : [...members];
    const turns = lead && order.includes(lead) ? [lead, ...order.filter((m) => m !== lead)] : order;
    this.#conv.add({ conversation, orb: turns[0]!, role: "user", content: text, meta: { from: "person", session: id, tab, ...(named.length && { to: named }) } });
    // the orbs you named each take a whole turn; otherwise the first does, and the rest chime in
    this.#rounds.set(conversation, turns.map((orb, i) => ({ orb, role: named.length || i === 0 ? "lead" : "chime" })));
    this.#next(conversation);
    return { conversation, turns };
  }

  /** An approved plan's rows, dealt evenly across those who work the session's Floor (or, with no
   * one on it, the tab it was made in), each to the one who fits it best among those still under
   * their share (`dealRows`): claimed for them, and each but `lead` sent to build its own. */
  deal(id: number, o: { tab: Tab; plan: number; lead: string; rows: { row: string; text: string }[]; rank: (text: string, members: string[]) => string[]; claim: (orb: string, rows: string[]) => void }): Record<string, string[]> {
    const s = this.get(id);
    if (!s) return {};
    const members = s.floor.length ? s.floor : s[o.tab];
    if (members.length < 2 || !o.rows.length) return {};
    const dealt = dealRows(o.rows, members, o.rank);
    const name = (orb: string): string => this.#inbox.orb(orb)?.name ?? orb;
    const floor = tabConversation(id, s.floor.length ? "floor" : o.tab);
    for (const [orb, rows] of Object.entries(dealt)) if (rows.length) o.claim(orb, rows);
    const said = members.filter((m) => dealt[m]?.length).map((m) => `${name(m)} ${dealt[m]!.join(", ")}`).join("; ");
    this.#conv.add({ conversation: floor, orb: o.lead, role: "notice", content: `Plan ${o.plan}'s rows, dealt evenly: ${said}.`, meta: { board: true, dealt, plan: o.plan } });
    this.#events.append("session.dealt", { session: id, plan: o.plan, dealt }, { orb: o.lead });
    const tab = s.floor.length ? "floor" : o.tab;
    const team: TeamTurn = { session: s.id, title: s.title, tab, with: s[tab].map(name), role: "work" };
    for (const orb of members) {
      if (orb === o.lead || !dealt[orb]?.length) continue;
      this.#conv.add({ conversation: floor, orb, role: "user", content: `[${name(o.lead)} asks ${name(orb)}]: Your rows of plan ${o.plan}: ${dealt[orb]!.join(", ")}. Build them, check each, then hand off.`, meta: { from: o.lead, asked: orb, depth: 1, session: id, tab, dealt: true } });
      this.#inbox.enqueue(orb, floor, "turn", "", { data: { team, depth: 1 } });
    }
    return dealt;
  }

  /** Deletes a session (owner, 10-06: "give the user ability to delete sessions"): what is still
   * waiting or running in its tabs is stopped, its cards put away, its chats removed, and it is gone
   * from the list and the Lab. The plans it showed stay in the Lab's plans, as they were shown. */
  async remove(id: number): Promise<void> {
    const s = this.get(id);
    if (!s) throw new Error(`no session ${id}`);
    for (const tab of TABS) this.#rounds.delete(tabConversation(id, tab));
    await Promise.all(TABS.map((tab) => this.#inbox.drop(tabConversation(id, tab))));
    tx(this.#db, () => {
      for (const tab of TABS) {
        const conversation = tabConversation(id, tab);
        this.#db.prepare("UPDATE cards SET status = 'expired', resolved_at = ? WHERE conversation = ? AND status = 'pending'").run(this.#clock.now(), conversation);
        this.#db.prepare("DELETE FROM messages WHERE conversation = ?").run(conversation);
      }
      this.#db.prepare("UPDATE work_sessions SET archived_at = ? WHERE id = ?").run(this.#clock.now(), id);
      this.#events.append("session.deleted", { session: id, title: s.title });
    });
  }

  /** One orb asks another of the tab (PLAN 5.1): the request is in the tab, from him, for all to
   * see, and the asked orb gets a turn of his own, `depth` hands deep. */
  ask(id: number, tab: Tab, from: string, to: string, request: string, depth: number): void {
    const s = this.get(id);
    if (!s || !s[tab].includes(to)) throw new Error(`${to} does not work this tab`);
    const conversation = tabConversation(id, tab);
    const name = (o: string): string => this.#inbox.orb(o)?.name ?? o;
    // at most MAX_ASKED at work on asks at once (PLAN 5.10, Ash's lesson of 09-19: helpers sent out
    // together on one model blew its per-minute limit; on 10-06 four at once read 29 pages in four minutes)
    const busy = new Set(this.#inbox.openIn(conversation).filter((i) => (i.data.team as TeamTurn | undefined)?.role === "asked").map((i) => i.orb));
    busy.delete(to);
    if (busy.size >= MAX_ASKED) throw new Error(`Not asked: ${[...busy].map(name).join(" and ")} ${busy.size > 1 ? "are" : "is"} already working on asks here. Wait for a report, or do it yourself.`);
    this.#conv.add({ conversation, orb: to, role: "user", content: `[${name(from)} asks ${name(to)}]: ${request}`, meta: { from, asked: to, depth, session: id, tab } });
    this.#events.append("session.asked", { session: id, tab, from, to, depth }, { orb: from });
    const team: TeamTurn = { session: s.id, title: s.title, tab, with: s[tab].map(name), role: "asked" };
    this.#inbox.enqueue(to, conversation, "turn", "", { data: { team, depth } });
  }

  #next(conversation: string): void {
    const left = this.#rounds.get(conversation);
    const at = parseTabConversation(conversation);
    if (!left?.length || !at) {
      this.#rounds.delete(conversation);
      return;
    }
    const s = this.get(at.id);
    if (!s) return;
    const names = s[at.tab].map((o) => this.#inbox.orb(o)?.name ?? o);
    const team: TeamTurn = { session: s.id, title: s.title, tab: at.tab, with: names, role: left[0]!.role };
    this.#inbox.enqueue(left[0]!.orb, conversation, "turn", "", { data: { team } });
  }
}

/** Rows dealt evenly (owner, 10-06): in the plan's order, each to the first orb `rank` puts best for
 * it among those still under their share, a share being the rows over the orbs, rounded up; so no
 * one gets more than one row above anyone else, and the best fit wins wherever it can. */
export function dealRows(rows: { row: string; text: string }[], members: string[], rank: (text: string, members: string[]) => string[]): Record<string, string[]> {
  const share = Math.ceil(rows.length / members.length);
  const floor = Math.floor(rows.length / members.length);
  const out: Record<string, string[]> = Object.fromEntries(members.map((m) => [m, []]));
  // how many may still take one more than the floor share (rows % members of them)
  let over = rows.length - floor * members.length;
  for (const r of rows) {
    const ranked = [...rank(r.text, members).filter((m) => members.includes(m)), ...members];
    const to = ranked.find((m) => out[m]!.length < floor || (out[m]!.length < share && over > 0))!;
    if (out[to]!.length === floor && share > floor) over--;
    out[to]!.push(r.row);
  }
  return out;
}
