// The notification centre (PLAN 2.11; owner, 10-01: an accountant that "helps and notifies you
// when bills are due", and a "notification centre for things like that"). One place for what
// needs you or happened, from every orb, kept on the home, so putting one away on one device puts
// it away on all:
//   - a bill or a reminder an orb keeps for you (the `remind` tool), once, when it comes up: a
//     bill three days ahead unless he says otherwise, a reminder on its day (or at its time);
//   - an approval waiting for you (a card), gone once it is answered;
//   - work finished: a run that ended with a reply (only the newest per conversation stays);
//   - the reading library's night (PLAN 3.12): pages that changed on a followed site, or a site
//     that has read nothing three times running, once a source a day.
// Quiet: a count on the side menu, never a sound. A phone hears only what you choose (with 2.7).
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "./clock.ts";
import { tx } from "./db.ts";
import type { EventLog, HomeEvent } from "./events.ts";

export type NoticeKind = "bill" | "reminder" | "approval" | "done" | "promotion" | "performance" | "reading";
export type Notice = {
  id: number; kind: NoticeKind; orb: string; conversation: string | null; card: number | null; reminder: number | null;
  title: string; detail: string; due: string | null; at: number;
};
export type ReminderKind = "bill" | "reminder";
export type Reminder = {
  id: number; orb: string; kind: ReminderKind; title: string; due: string; amount: string | null; aheadDays: number;
  conversation: string | null; createdAt: number; doneAt: number | null;
};

/** How far ahead each kind comes up, unless the orb says otherwise. */
export const AHEAD_DAYS: Record<ReminderKind, number> = { bill: 3, reminder: 0 };
const DAY = 86_400_000;

/** A due date, as a person writes one: a day (2026-10-05) or a day and a time (2026-10-05T09:30). */
const DUE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

/** When it comes up, in the home's local time: the start of its day (or its time), less the days ahead. */
export function comesUpAt(due: string, aheadDays: number): number {
  const m = DUE.exec(due);
  if (!m) throw new Error(`a due date is a day (2026-10-05) or a day and a time (2026-10-05T09:30), not "${due}"`);
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)];
  const at = new Date(y, mo - 1, d - aheadDays, h, mi);
  const check = new Date(y, mo - 1, d, h, mi);
  if (check.getFullYear() !== y || check.getMonth() !== mo - 1 || check.getDate() !== d || h > 23 || mi > 59) throw new Error(`there is no ${due}`);
  return at.getTime();
}

type NoticeRow = { id: number; kind: NoticeKind; orb: string; conversation: string | null; card: number | null; reminder: number | null; title: string; detail: string; due: string | null; at: number };
type ReminderRow = { id: number; orb: string; kind: ReminderKind; title: string; due: string; amount: string | null; ahead_days: number; conversation: string | null; created_at: number; done_at: number | null };
const toReminder = (r: ReminderRow): Reminder => ({ id: r.id, orb: r.orb, kind: r.kind, title: r.title, due: r.due, amount: r.amount, aheadDays: r.ahead_days, conversation: r.conversation, createdAt: r.created_at, doneAt: r.done_at });

export class Notices {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #clock: Clock;
  readonly #nameOf: (orb: string) => string;
  readonly #lastReply: (conversation: string) => string | null;
  readonly #pendingCards: () => { id: number; orb: string; conversation: string; title: string }[];

  constructor(
    db: DatabaseSync, events: EventLog, clock: Clock,
    o: { nameOf: (orb: string) => string; lastReply: (conversation: string) => string | null; pendingCards: () => { id: number; orb: string; conversation: string; title: string }[] },
  ) {
    this.#db = db;
    this.#events = events;
    this.#clock = clock;
    this.#nameOf = o.nameOf;
    this.#lastReply = o.lastReply;
    this.#pendingCards = o.pendingCards;
    events.listen((e) => this.#heard(e));
    this.#sync();
  }

  /** An orb keeps a bill or a reminder for the person (the `remind` tool). */
  remind(r: { orb: string; kind: ReminderKind; title: string; due: string; amount?: string | null; aheadDays?: number; conversation?: string | null }): Reminder {
    const title = r.title.trim();
    if (!title) throw new Error("a reminder needs a title: what is it?");
    if (title.length > 200) throw new Error("a reminder's title is a line, not a page");
    const ahead = r.aheadDays ?? AHEAD_DAYS[r.kind];
    if (!Number.isInteger(ahead) || ahead < 0 || ahead > 60) throw new Error("ahead is a number of days, 0 to 60");
    comesUpAt(r.due, ahead); // a date there is
    const row = this.#db
      .prepare("INSERT INTO reminders (orb, kind, title, due, amount, ahead_days, conversation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *")
      .get(r.orb, r.kind, title, r.due, r.amount?.trim() || null, ahead, r.conversation ?? null, this.#clock.now()) as ReminderRow;
    this.#events.append("reminder.added", { reminder: row.id, kind: r.kind, due: r.due }, { orb: r.orb, conversation: r.conversation ?? null });
    this.due(); // one that is already up says so now
    return toReminder(row);
  }

  /** A reminder moved to another day (the person's own change, or an orb's once approved): it
   * comes up again from the new day, and the notice it had is put away. */
  move(id: number, due: string): Reminder {
    const r = this.reminder(id);
    if (!r || r.doneAt !== null) throw new Error(`no reminder ${id}`);
    comesUpAt(due, r.aheadDays); // a date there is
    this.#db.prepare("UPDATE reminders SET due = ? WHERE id = ?").run(due, id);
    this.#forget(id);
    this.#events.append("reminder.moved", { reminder: id, from: r.due, to: due }, { orb: r.orb, conversation: r.conversation });
    this.due();
    return this.reminder(id)!;
  }

  /** Paid, or done: it leaves the calendar, and its notice is put away. */
  done(id: number): void {
    const r = this.reminder(id);
    if (!r || r.doneAt !== null) throw new Error(`no reminder ${id}`);
    this.#db.prepare("UPDATE reminders SET done_at = ? WHERE id = ?").run(this.#clock.now(), id);
    this.#forget(id);
    this.#events.append("reminder.done", { reminder: id }, { orb: r.orb, conversation: r.conversation });
  }

  reminder(id: number): Reminder | undefined {
    const r = this.#db.prepare("SELECT * FROM reminders WHERE id = ?").get(id) as ReminderRow | undefined;
    return r && toReminder(r);
  }

  /** Its notice is put away and forgotten, so it can come up again (moved) or never (done). */
  #forget(id: number): void {
    const n = this.#db.prepare("SELECT id, put_away_at FROM notices WHERE key = ?").get(`reminder:${id}`) as { id: number; put_away_at: number | null } | undefined;
    if (!n) return;
    this.#db.prepare("DELETE FROM notices WHERE id = ?").run(n.id);
    if (n.put_away_at === null) this.#events.append("notice.put_away", { notices: [n.id] });
  }

  reminders(): Reminder[] {
    return (this.#db.prepare("SELECT * FROM reminders WHERE done_at IS NULL ORDER BY due, id").all() as ReminderRow[]).map(toReminder);
  }

  /** Every reminder that has come up and has not said so yet says so: once each. Called on every tick. */
  due(): void {
    const now = this.#clock.now();
    for (const r of this.reminders()) {
      if (comesUpAt(r.due, r.aheadDays) > now) continue;
      const days = Math.round((comesUpAt(r.due, 0) - startOfDay(now)) / DAY);
      const when = days > 1 ? `in ${days} days` : days === 1 ? "tomorrow" : days === 0 ? "today" : `${-days} ${-days === 1 ? "day" : "days"} ago`;
      const title = r.kind === "bill" ? `${r.title} is due ${when}` : r.title;
      this.#add(`reminder:${r.id}`, { kind: r.kind, orb: r.orb, conversation: r.conversation, reminder: r.id, title, detail: r.amount ?? "", due: r.due });
    }
  }

  /** When the next reminder comes up, for the home's timer; null when none is waiting. */
  nextDueAt(): number | null {
    const waiting = this.#db
      .prepare("SELECT r.due, r.ahead_days FROM reminders r WHERE r.done_at IS NULL AND NOT EXISTS (SELECT 1 FROM notices n WHERE n.key = 'reminder:' || r.id)")
      .all() as { due: string; ahead_days: number }[];
    const ats = waiting.map((r) => comesUpAt(r.due, r.ahead_days));
    return ats.length ? Math.min(...ats) : null;
  }

  /** What is out, newest first. */
  list(): Notice[] {
    return this.#db.prepare("SELECT id, kind, orb, conversation, card, reminder, title, detail, due, at FROM notices WHERE put_away_at IS NULL ORDER BY at DESC, id DESC").all() as NoticeRow[];
  }

  /** Put away (on every device: the event tells the others). */
  putAway(id: number): void {
    const n = this.#db.prepare("UPDATE notices SET put_away_at = ? WHERE id = ? AND put_away_at IS NULL").run(this.#clock.now(), id);
    if (!n.changes) throw new Error(`no notice ${id} out`);
    this.#events.append("notice.put_away", { notices: [id] });
  }

  putAwayAll(): number {
    const ids = this.list().map((n) => n.id);
    if (!ids.length) return 0;
    tx(this.#db, () => {
      for (const id of ids) this.#db.prepare("UPDATE notices SET put_away_at = ? WHERE id = ?").run(this.#clock.now(), id);
    });
    this.#events.append("notice.put_away", { notices: ids });
    return ids.length;
  }

  #add(key: string, n: Omit<Notice, "id" | "at" | "card" | "reminder"> & { card?: number | null; reminder?: number | null }): void {
    const r = this.#db
      .prepare("INSERT OR IGNORE INTO notices (key, kind, orb, conversation, card, reminder, title, detail, due, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .get(key, n.kind, n.orb, n.conversation, n.card ?? null, n.reminder ?? null, n.title, n.detail, n.due, this.#clock.now()) as { id: number } | undefined;
    if (r) this.#events.append("notice.added", { notice: r.id, kind: n.kind }, { orb: n.orb, conversation: n.conversation });
  }

  /** Put away, quietly, what no longer needs anyone (an answered card, an older "done"). */
  #settle(where: string, ...args: (string | number)[]): void {
    const ids = (this.#db.prepare(`SELECT id FROM notices WHERE put_away_at IS NULL AND ${where}`).all(...args) as { id: number }[]).map((r) => r.id);
    if (!ids.length) return;
    for (const id of ids) this.#db.prepare("UPDATE notices SET put_away_at = ? WHERE id = ?").run(this.#clock.now(), id);
    this.#events.append("notice.put_away", { notices: ids });
  }

  #heard(e: HomeEvent): void {
    if (e.type === "card.opened" && e.orb && e.conversation) {
      this.#add(`card:${String(e.data.card)}`, { kind: "approval", orb: e.orb, conversation: e.conversation, card: Number(e.data.card), title: String(e.data.title ?? "Waiting for your OK"), detail: "", due: null });
    } else if (e.type === "card.resolved") {
      this.#settle("card = ?", Number(e.data.card));
    } else if (e.type === "promotion.proposed" && e.orb) {
      // a promotion waits for you, with its evidence (PLAN 3.8); only you promote
      const x = e.data.evidence as { xp: { has: number }; tasks: { has: string[] } };
      this.#add(`promotion:${e.orb}:${String(e.data.to)}`, {
        kind: "promotion", orb: e.orb, conversation: null, title: `${this.#nameOf(e.orb)} is ready for ${String(e.data.to)}`,
        detail: `${x.xp.has} XP; ${x.tasks.has.length} ${x.tasks.has.length === 1 ? "task" : "tasks"} learned in the specialty; no regression lately`, due: null,
      });
    } else if (e.type === "performance.card" && e.orb) {
      // his week (PLAN 5.5): a suggestion and its evidence, for you; it never acts
      const SAY: Record<string, string> = { promote: "ready for a promotion", keep: "keep going", retrain: "some practice", "let go": "give work, or let go" };
      this.#settle("kind = 'performance' AND orb = ?", e.orb);
      this.#add(`performance:${e.seq}`, { kind: "performance", orb: e.orb, conversation: null, title: `${this.#nameOf(e.orb)}'s week: ${SAY[String(e.data.suggest)] ?? String(e.data.suggest)}`, detail: String(e.data.why ?? ""), due: null });
    } else if (e.type === "reading.read" && e.orb && !e.data.first) {
      // the reading library (PLAN 3.12): a read of a followed site that changed something says so,
      // once a source a day; a read with nothing new says nothing
      const pages = (e.data.changedPages as { title: string }[] | undefined) ?? [];
      const moved = Number(e.data.changed ?? 0) + Number(e.data.added ?? 0) + Number(e.data.gone ?? 0);
      const key = `reading:${String(e.data.source)}:${new Date(e.at).toDateString()}`;
      if (moved > 0) {
        const parts = [e.data.changed ? `${String(e.data.changed)} changed` : "", e.data.added ? `${String(e.data.added)} new` : "", e.data.gone ? `${String(e.data.gone)} gone` : ""].filter(Boolean);
        this.#add(key, { kind: "reading", orb: e.orb, conversation: null, title: `${this.#nameOf(e.orb)}'s reading: ${parts.join(", ")} on ${String(e.data.host)}`, detail: pages.map((p) => p.title).join(" · ").slice(0, 300), due: null });
      } else if (Number(e.data.failures ?? 0) === 3) {
        this.#add(key, { kind: "reading", orb: e.orb, conversation: null, title: `${this.#nameOf(e.orb)}'s reading: ${String(e.data.host)} has read nothing three times`, detail: String(e.data.stopped ?? "it answered nothing that could be kept"), due: null });
      }
    } else if ((e.type === "orb.promoted" || e.type === "promotion.declined") && e.orb) {
      this.#settle("kind = 'promotion' AND orb = ?", e.orb);
    } else if (e.type === "run.finished" && e.data.outcome === "ok" && e.orb && e.conversation) {
      const reply = this.#lastReply(e.conversation);
      if (!reply) return; // a run that said nothing finished nothing to read
      this.#settle("kind = 'done' AND conversation = ?", e.conversation);
      const line = reply.split("\n").find((l) => l.trim()) ?? reply;
      this.#add(`run:${String(e.data.run)}`, { kind: "done", orb: e.orb, conversation: e.conversation, title: `${this.#nameOf(e.orb)} finished`, detail: line.length > 140 ? `${line.slice(0, 139)}…` : line, due: null });
    }
  }

  /** On opening: every card still waiting has its notice, and none is out for one that is not. */
  #sync(): void {
    const pending = this.#pendingCards();
    for (const c of pending) this.#add(`card:${c.id}`, { kind: "approval", orb: c.orb, conversation: c.conversation, card: c.id, title: c.title, detail: "", due: null });
    const open = new Set(pending.map((c) => c.id));
    const stale = (this.#db.prepare("SELECT id, card FROM notices WHERE put_away_at IS NULL AND kind = 'approval'").all() as { id: number; card: number }[]).filter((n) => !open.has(n.card));
    for (const n of stale) this.#db.prepare("UPDATE notices SET put_away_at = ? WHERE id = ?").run(this.#clock.now(), n.id);
  }
}

const startOfDay = (t: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
