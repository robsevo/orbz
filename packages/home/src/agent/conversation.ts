// What was said, per conversation (PLAN 1.5), and the cards a run paused on. The home keeps the
// whole history; the model is sent a view of it:
//
//   - only what came after the last /clear
//   - from the latest compaction summary on (the summary stands in for what it covers)
//   - notices (stopped, capped, a card was opened) are for the person, never sent
//     (save two kinds, to the others in a session: what was agreed, and what was done on the board)
//   - every tool result right after the call that asked for it, whatever order they were stored
//     in, and a call whose result never came (a stop, a crash) answered "not run"
//
// The standing context (who the orb is, the owner's constitution, the skills and memory
// indexes) is NOT stored here: standing.ts rebuilds it for every request, so compaction, /clear
// and a restart can neither lose it nor duplicate it.
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "../clock.ts";
import { parseJson, tx } from "../db.ts";
import type { EventLog } from "../events.ts";

export type Role = "user" | "assistant" | "tool" | "notice" | "summary" | "clear";
export type ToolCall = { id: string; name: string; arguments: string };

export type Message = {
  id: number;
  conversation: string;
  orb: string;
  run: number | null;
  role: Role;
  content: string;
  toolCalls: ToolCall[] | null;
  toolCallId: string | null;
  meta: Record<string, unknown>;
  at: number;
};

export type CardKind = "approval" | "question" | "connect" | "plan";
export type CardStatus = "pending" | "approved" | "denied" | "answered" | "expired" | "changed" | "saved";

export type Card = {
  id: number;
  conversation: string;
  orb: string;
  run: number;
  kind: CardKind;
  tool: string;
  callId: string;
  assistantMsg: number;
  title: string;
  detail: string;
  status: CardStatus;
  answer: string | null;
  createdAt: number;
  resolvedAt: number | null;
  /** Why it asks, and what its answer opens (the turn, the act, whether "always" may be offered). */
  meta: Record<string, unknown>;
};

/** The message shapes an OpenAI-compatible chat endpoint takes. */
export type ModelMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

type MessageRow = {
  id: number;
  conversation: string;
  orb: string;
  run: number | null;
  role: Role;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  meta: string;
  at: number;
};

type CardRow = {
  id: number;
  conversation: string;
  orb: string;
  run: number;
  kind: CardKind;
  tool: string;
  call_id: string;
  assistant_msg: number;
  title: string;
  detail: string;
  status: CardStatus;
  answer: string | null;
  created_at: number;
  resolved_at: number | null;
  meta: string;
};

export const NOT_RUN = "(not run: the turn ended before this call was made)";

export class Conversations {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #clock: Clock;

  constructor(db: DatabaseSync, events: EventLog, clock: Clock) {
    this.#db = db;
    this.#events = events;
    this.#clock = clock;
  }

  add(m: {
    conversation: string;
    orb: string;
    role: Role;
    content?: string;
    run?: number | null;
    toolCalls?: ToolCall[] | null;
    toolCallId?: string | null;
    meta?: Record<string, unknown>;
  }): Message {
    const at = this.#clock.now();
    const row = this.#db
      .prepare(
        "INSERT INTO messages (conversation, orb, run, role, content, tool_calls, tool_call_id, meta, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
      )
      .get(
        m.conversation,
        m.orb,
        m.run ?? null,
        m.role,
        m.content ?? "",
        m.toolCalls?.length ? JSON.stringify(m.toolCalls) : null,
        m.toolCallId ?? null,
        JSON.stringify(m.meta ?? {}),
        at,
      ) as { id: number };
    this.#events.append("message.added", { id: row.id, role: m.role, run: m.run ?? null }, { orb: m.orb, conversation: m.conversation });
    return this.get(row.id)!;
  }

  get(id: number): Message | undefined {
    const r = this.#db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
    return r && toMessage(r);
  }

  list(conversation: string, sinceId = 0): Message[] {
    return (
      this.#db.prepare("SELECT * FROM messages WHERE conversation = ? AND id > ? ORDER BY id").all(conversation, sinceId) as MessageRow[]
    ).map(toMessage);
  }

  /** True when an inbox item's message is already in the conversation (a re-run after a pause or
   * a crash must not say the person's words twice). */
  hasItem(conversation: string, item: number): boolean {
    return this.list(conversation).some((m) => m.meta.item === item);
  }

  /** What the model may see: after the last clear, from the latest summary on. */
  history(conversation: string): Message[] {
    const all = this.list(conversation);
    const lastClear = all.findLastIndex((m) => m.role === "clear");
    const live = all.slice(lastClear + 1);
    const summary = live.findLast((m) => m.role === "summary");
    if (!summary) return live.filter((m) => m.role !== "summary");
    const covers = Number(summary.meta.covers_to ?? 0);
    return [summary, ...live.filter((m) => m.id > covers && m.role !== "summary")];
  }

  /** The history in the model's shapes, every tool result straight after its call. */
  /** The history as the model reads it. In a session (several orbs in one conversation), what
   * another orb said reaches `me` as said by him, by name, and never as `me`'s own words; his
   * calls and their results are his, and stay out. */
  toModel(history: Message[], o: { me?: string; nameOf?: (orb: string) => string } = {}): ModelMessage[] {
    const results = new Map<string, Message>();
    for (const m of history) if (m.role === "tool" && m.toolCallId) results.set(m.toolCallId, m);
    const out: ModelMessage[] = [];
    for (const m of history) {
      if (o.me && m.orb !== o.me && (m.role === "assistant" || m.role === "tool")) {
        if (m.role === "assistant" && m.content.trim()) out.push({ role: "user", content: `[${o.nameOf?.(m.orb) ?? m.orb}]: ${m.content}` });
        continue;
      }
      if (m.role === "user") out.push({ role: "user", content: m.content });
      // what another orb in a session agreed reaches everyone in it (his call stayed his)
      else if (m.role === "notice" && o.me && m.orb !== o.me && typeof m.meta.agreed === "string") out.push({ role: "user", content: `[Agreed]: ${m.meta.agreed}` });
      // what another orb did on the plan's board (took rows, handed off, proposed a change, asked for
      // a review) reaches everyone in the session, so no one works blind to it (PLAN 5.1)
      else if (m.role === "notice" && o.me && m.orb !== o.me && m.meta.board === true) out.push({ role: "user", content: `[Board]: ${m.content}` });
      else if (m.role === "summary") out.push({ role: "system", content: `Summary of the earlier conversation:\n${m.content}` });
      else if (m.role === "assistant") {
        if (!m.toolCalls?.length) {
          if (m.content) out.push({ role: "assistant", content: m.content });
          continue;
        }
        out.push({
          role: "assistant",
          content: m.content,
          tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
        });
        for (const c of m.toolCalls) out.push({ role: "tool", tool_call_id: c.id, content: results.get(c.id)?.content ?? NOT_RUN });
      }
      // tool messages were placed with their calls; other notices and clears are for the person
    }
    return out;
  }

  /** Opens a card and, in the same transaction, the notice that shows it in the chat: a crash can
   * leave neither or both, never a card nobody sees. */
  addCard(c: Omit<Card, "id" | "status" | "answer" | "createdAt" | "resolvedAt" | "meta"> & { meta?: Record<string, unknown>; notice?: string }): Card {
    const at = this.#clock.now();
    const id = tx(this.#db, () => {
      const r = this.#db
        .prepare(
          "INSERT INTO cards (conversation, orb, run, kind, tool, call_id, assistant_msg, title, detail, created_at, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .get(c.conversation, c.orb, c.run, c.kind, c.tool, c.callId, c.assistantMsg, c.title, c.detail, at, JSON.stringify(c.meta ?? {})) as { id: number };
      this.add({ conversation: c.conversation, orb: c.orb, role: "notice", run: c.run, content: c.notice ?? c.title, meta: { card: r.id } });
      this.#events.append("card.opened", { card: r.id, kind: c.kind, tool: c.tool, title: c.title }, { orb: c.orb, conversation: c.conversation });
      return r.id;
    });
    return this.card(id)!;
  }

  card(id: number): Card | undefined {
    const r = this.#db.prepare("SELECT * FROM cards WHERE id = ?").get(id) as CardRow | undefined;
    return r && toCard(r);
  }

  /** Every card still waiting for the person, oldest first (the notification centre's approvals). */
  pendingCards(): Card[] {
    return (this.#db.prepare("SELECT * FROM cards WHERE status = 'pending' ORDER BY id").all() as CardRow[]).map(toCard);
  }

  openCard(conversation: string): Card | undefined {
    const r = this.#db
      .prepare("SELECT * FROM cards WHERE conversation = ? AND status = 'pending' ORDER BY id DESC LIMIT 1")
      .get(conversation) as CardRow | undefined;
    return r && toCard(r);
  }

  /** Adds to a card's meta (what opening it produced, e.g. the archived plan's id). */
  annotateCard(id: number, more: Record<string, unknown>): void {
    const c = this.card(id);
    if (c) this.#db.prepare("UPDATE cards SET meta = ? WHERE id = ?").run(JSON.stringify({ ...c.meta, ...more }), id);
  }

  /** Settles a pending card. Returns undefined if it was not pending (answered twice, or expired). */
  resolveCard(id: number, status: Exclude<CardStatus, "pending">, answer: string | null = null): Card | undefined {
    const c = this.card(id);
    if (!c || c.status !== "pending") return undefined;
    tx(this.#db, () => {
      this.#db.prepare("UPDATE cards SET status = ?, answer = ?, resolved_at = ? WHERE id = ?").run(status, answer, this.#clock.now(), id);
      this.#events.append("card.resolved", { card: id, status }, { orb: c.orb, conversation: c.conversation });
    });
    return this.card(id);
  }
}

function toMessage(r: MessageRow): Message {
  return {
    id: r.id,
    conversation: r.conversation,
    orb: r.orb,
    run: r.run,
    role: r.role,
    content: r.content,
    toolCalls: r.tool_calls ? (JSON.parse(r.tool_calls) as ToolCall[]) : null,
    toolCallId: r.tool_call_id,
    meta: parseJson(r.meta),
    at: r.at,
  };
}

function toCard(r: CardRow): Card {
  return {
    id: r.id,
    conversation: r.conversation,
    orb: r.orb,
    run: r.run,
    kind: r.kind,
    tool: r.tool,
    callId: r.call_id,
    assistantMsg: r.assistant_msg,
    title: r.title,
    detail: r.detail,
    status: r.status,
    answer: r.answer,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
    meta: parseJson(r.meta),
  };
}
