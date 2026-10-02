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
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "./clock.ts";
import type { EventLog } from "./events.ts";
import type { Inboxes } from "./inbox.ts";
import type { Conversations } from "./agent/conversation.ts";
import type { TeamTurn } from "./agent/standing.ts";

export type Tab = "brainstorm" | "floor";
export const TABS: readonly Tab[] = ["brainstorm", "floor"];
export type Session = { id: number; title: string; createdAt: number; brainstorm: string[]; floor: string[] };

export const tabConversation = (id: number, tab: Tab): string => `team:${id}:${tab}`;
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
  /** For each tab with a round under way: who is still to speak, in order. */
  readonly #rounds = new Map<string, string[]>();
  readonly #stop: () => void;

  constructor(o: { db: DatabaseSync; events: EventLog; clock: Clock; inbox: Inboxes; conversations: Conversations }) {
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
      if (!left || left[0] !== e.orb) return;
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

  /** The person says something in a tab: it is put there once, and each of its orbs takes a turn. */
  say(id: number, tab: Tab, text: string): { conversation: string; turns: string[] } {
    const s = this.get(id);
    if (!s) throw new Error(`no session ${id}`);
    const members = s[tab];
    if (!members.length) throw new Error(`no orb works this session's ${tab} yet: bring one in`);
    const conversation = tabConversation(id, tab);
    this.#conv.add({ conversation, orb: members[0]!, role: "user", content: text, meta: { from: "person", session: id, tab } });
    this.#rounds.set(conversation, [...members]);
    this.#next(conversation);
    return { conversation, turns: members };
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
    const team: TeamTurn = { session: s.id, title: s.title, tab: at.tab, with: names };
    this.#inbox.enqueue(left[0]!, conversation, "turn", "", { data: { team } });
  }
}
