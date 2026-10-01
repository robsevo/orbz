// The agent loop (PLAN 1.5): one orb's run, on Ash's engine shape, laid out like Open Dot's
// runtime. It is the inbox's Runner for chats, schedules and triggers.
//
//   each item in the batch, in order:
//     a card's answer      the call it paused on runs (or is refused), then the calls after it
//     "/clear"             a fresh start: the model will not see what came before
//     anything else        it becomes the person's message (once, even if the run is re-run);
//                          an open card it interrupts EXPIRES, and its calls are answered "not done"
//   then, step by step:  model (streamed) → its tool calls, each: precheck → decision → run or CARD
//
// A card is a pause that survives anything: the call it waits on, and the calls after it, are
// rows in the database, so after a restart the answer resumes at the same step. The run ends
// "waiting"; the answer arrives as an inbox item, so it is ordered like everything else.
//
// A stop keeps what the model had written and says it was stopped; an error keeps it too and
// names the transport's cause (Ash's stop-turn lessons). Every step is a `trace.step` event,
// complete enough to replay the run (trace.ts).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "../clock.ts";
import type { EventLog } from "../events.ts";
import type { RunContext, RunResult, Runner } from "../inbox.ts";
import { chat, type Endpoint } from "../brain/openai.ts";
import type { Spend } from "../brain/spend.ts";
import type { Card, Conversations, Message, ToolCall } from "./conversation.ts";
import { standingContext } from "./standing.ts";
import { streamChat } from "./stream.ts";
import { type Background, runTool, type ToolContext, type ToolDef, type ToolResult, TOOLS, toolSpecs } from "./tools.ts";
import type { CallSite, Guard } from "../rules/guard.ts";

export type AgentOptions = {
  conversations: Conversations;
  events: EventLog;
  spend: Spend;
  clock: Clock;
  dataDir: string;
  background: Background;
  /** The brain the loop talks to (the preset's big brain). */
  endpoint: () => Endpoint | null;
  orbName: (orb: string) => string;
  tools?: ToolDef[];
  /** What decides each call (PLAN 1.6): the floor, the person's rules, the one-way switch, away. */
  guard: Guard;
  /** Checks text for key material before it goes into a trace; null when it could not check. */
  redact?: (text: string) => Promise<string | null>;
  maxSteps?: number;
  /** Compact when the request would be bigger than this (estimated tokens). */
  compactAtTokens?: number;
  /** How much of the newest conversation compaction keeps as it is. */
  keepRecentTokens?: number;
  /** Streamed text, for whoever is watching (not stored until the reply is complete). */
  onText?: (e: { orb: string; conversation: string; run: number; delta: string }) => void;
};

export const DENIED = "The person said no to this. Don't do it; tell them briefly what you will do instead, if anything.";
export const EXPIRED = "Not done: the person sent a new message instead of answering.";

/** What the model is told when the person answers a plan card. */
export const PLAN_ANSWERS = {
  approved: (_x: string, plan?: number) =>
    `The person approved the plan (plan ${plan}). Build it row by row: start_row(plan=${plan}, row, test_command) for each feature, build it, then check_row — only the home's run of that test can tick it.`,
  changed: (x: string, _plan?: number) => `The person said: go with it, but ${x}. Add rows for that (each with its _t test row) and show the plan again with propose_plan.`,
  saved: (_x?: string, _plan?: number) => "The person saved the plan without running it. Don't build it now; say it is saved.",
  denied: (_x?: string, _plan?: number) => "The person declined the plan. Don't build it; ask what they want instead.",
} as const;

const est = (text: string): number => Math.ceil(text.length / 4) + 4;

export class AgentRunner implements Runner {
  readonly #o: Required<Omit<AgentOptions, "redact" | "onText">> & Pick<AgentOptions, "redact" | "onText">;
  readonly #tools: Map<string, ToolDef>;

  constructor(opts: AgentOptions) {
    this.#o = { tools: TOOLS, maxSteps: 50, compactAtTokens: 100_000, keepRecentTokens: 20_000, ...opts };
    this.#tools = new Map(this.#o.tools.map((t) => [t.name, t]));
  }

  workspace(orb: string): string {
    return join(this.#o.dataDir, "orbs", orb, "workspace");
  }

  async run(ctx: RunContext): Promise<RunResult> {
    const { conversations: conv, events } = this.#o;
    const tctx: ToolContext = {
      orb: ctx.orb,
      conversation: ctx.conversation,
      workspace: this.workspace(ctx.orb),
      signal: ctx.signal,
      background: this.#o.background,
    };
    mkdirSync(tctx.workspace, { recursive: true });
    const step = this.#stepper(ctx);
    step("input", { items: await Promise.all(ctx.items.map(async (i) => ({ id: i.id, source: i.source, text: await this.#safe(i.text), data: i.data }))) });

    let freshened = false;
    for (const item of ctx.items) {
      const cardId = item.data.resume;
      if (typeof cardId === "number") {
        const r = await this.#resume(cardId, ctx, tctx, step);
        if (r !== "done") return this.#ended(r, ctx);
        continue;
      }
      // A re-run (after a pause or a crash) is not a new message: it expires nothing, says nothing twice.
      if (conv.hasItem(ctx.conversation, item.id)) continue;
      const open = conv.openCard(ctx.conversation);
      if (open) this.#expire(open, ctx);
      if (item.text.trim() === "/clear") {
        conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "clear", run: ctx.run, meta: { item: item.id } });
        conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "notice", run: ctx.run, content: "Cleared. Starting fresh from here." });
        continue;
      }
      if (ctx.fresh && !freshened && conv.history(ctx.conversation).length > 0) {
        // a schedule or trigger firing starts from a fresh context, in its own conversation
        conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "clear", run: ctx.run, meta: { fresh: true } });
      }
      freshened = true;
      conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "user", run: ctx.run, content: item.text, meta: { item: item.id, source: item.source } });
    }
    // Something to answer: the person's message, tool results, or calls a stop left unanswered.
    // A card still waiting (the home died after it opened) keeps waiting: nothing is asked again.
    if (conv.openCard(ctx.conversation)) return { outcome: "waiting", summary: "a card is still waiting" };
    // A reply a pause or a shutdown cut off is not an answer when its run comes round again.
    const rerun = ctx.items.some((i) => i.data.interrupted);
    const tail = conv.history(ctx.conversation).filter((m) => m.role !== "notice").at(-1);
    const answered = tail?.role === "assistant" && !tail.toolCalls?.length && !(rerun && tail.meta.stopped);
    if (!tail || tail.role === "summary" || answered) {
      return { outcome: "ok", summary: "nothing to answer" };
    }

    // The turn is the person's request this run works on; attended unless only a schedule or trigger woke it.
    const at = this.#site(ctx);
    const ep = this.#o.endpoint();
    if (!ep) {
      conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "notice", run: ctx.run, content: "No brain is set up yet, so I can't answer. Choose one in settings." });
      return { outcome: "ok", summary: "no brain" };
    }

    for (let n = 0; n < this.#o.maxSteps; n++) {
      if (ctx.signal.aborted) return this.#ended("stopped", ctx);
      const standing = standingContext({ orbName: this.#o.orbName(ctx.orb), brainDir: join(this.#o.dataDir, "brain"), workspace: tctx.workspace });
      await this.#compact(ctx, ep, est(standing));
      this.#o.spend.check(); // SpendCapError: the inbox stops the run cleanly ("capped")
      const messages = [{ role: "system" as const, content: standing }, ...conv.toModel(conv.history(ctx.conversation))];
      ctx.activity("Thinking");
      const r = await streamChat(
        ep,
        { messages, tools: toolSpecs(this.#o.tools) },
        { signal: ctx.signal, onText: (delta) => this.#o.onText?.({ orb: ctx.orb, conversation: ctx.conversation, run: ctx.run, delta }) },
      );
      if (r.promptTokens || r.completionTokens || r.costUsd) {
        this.#o.spend.record({
          tier: "big", model: ep.model, costUsd: r.costUsd, costSource: r.costSource,
          promptTokens: r.promptTokens, completionTokens: r.completionTokens, orb: ctx.orb, conversation: ctx.conversation,
        });
      }
      step("model", {
        text: await this.#safe(r.text),
        tool_calls: await Promise.all(r.toolCalls.map(async (c) => ({ ...c, arguments: await this.#safe(c.arguments) }))),
        finish: r.finish, stopped: r.stopped, error: r.error, tokens: r.promptTokens + r.completionTokens, cost_usd: r.costUsd,
      });

      if (r.stopped) {
        if (r.text) conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "assistant", run: ctx.run, content: r.text, meta: { stopped: true } });
        return this.#ended("stopped", ctx);
      }
      if (r.error) {
        if (r.text) conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "assistant", run: ctx.run, content: r.text, meta: { error: r.error } });
        conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "notice", run: ctx.run, content: `I couldn't finish: ${r.error}`, meta: { error: true } });
        throw new Error(r.error);
      }
      const msg = conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "assistant", run: ctx.run, content: r.text, toolCalls: r.toolCalls });
      if (!r.toolCalls.length) {
        step("output", { text: r.text });
        return { outcome: "ok", summary: r.text.slice(0, 200) };
      }
      const calls = await this.#calls(msg, 0, ctx, tctx, step, at);
      if (calls !== "done") return this.#ended(calls, ctx);
    }
    conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "notice", run: ctx.run, content: `I stopped after ${this.#o.maxSteps} steps. Say "go on" and I'll continue.` });
    return { outcome: "ok", summary: "step limit" };
  }

  /** Runs an assistant message's tool calls from `from` on. A call that needs the person opens a card. */
  async #calls(msg: Message, from: number, ctx: RunContext, tctx: ToolContext, step: Stepper, at: CallSite): Promise<"done" | "waiting" | "stopped"> {
    const calls = msg.toolCalls ?? [];
    for (let i = from; i < calls.length; i++) {
      if (ctx.signal.aborted) return "stopped";
      const call = calls[i]!;
      const def = this.#tools.get(call.name);
      const args = parseArgs(call);
      let result: ToolResult;
      if (!def) result = { content: `There is no tool called ${call.name}.`, isError: true };
      else if (args === null) result = { content: "The arguments were not a JSON object.", isError: true };
      else {
        const refused = def.precheck?.(args, tctx) ?? null;
        const v = refused ? null : await this.#o.guard.verdict(def, args, at);
        const g = !refused && v!.decision !== "never" && def.gate ? await def.gate(args, tctx) : null;
        if (refused) result = { content: `Refused: ${refused}`, isError: true };
        else if (g && "sendBack" in g) result = { content: g.sendBack, isError: true }; // checked before anyone sees it
        else if (v!.decision === "never") {
          result = { content: `Not allowed: ${v!.described}${v!.why.length ? ` (${v!.why.join("; ")})` : ""}.`, isError: true };
        } else if (def.pause || v!.decision === "ask") {
          const title =
            def.pause === "question" ? "A question for you"
              : def.pause === "plan" ? `${this.#o.orbName(ctx.orb)} has a plan for you: ${v!.described.replace(/^show a plan: /, "")}`
                : `${this.#o.orbName(ctx.orb)} wants to ${v!.described}`;
          const shown = g && "detail" in g ? g : null;
          const card = this.#o.conversations.addCard({
            conversation: ctx.conversation, orb: ctx.orb, run: ctx.run, kind: def.pause ?? "approval",
            tool: def.name, callId: call.id, assistantMsg: msg.id, title,
            detail: shown ? shown.detail : def.pause === "question" ? String(args.question ?? "") : JSON.stringify(args),
            notice: v!.why.length && !def.pause ? `${title} (${v!.why.join("; ")})` : title,
            meta: { turn: at.turn, why: v!.why, floor: v!.floor, mayAlways: v!.mayAlways && !def.pause, act: def.act ?? null, described: v!.described, ...shown?.meta },
          });
          if (shown?.opened) this.#o.conversations.annotateCard(card.id, shown.opened(card.id));
          step("card", { card: card.id, kind: card.kind, tool: def.name, call_id: call.id, args: await this.#safe(JSON.stringify(args)), why: v!.why });
          return "waiting";
        } else {
          ctx.activity(def.label);
          result = await this.#o.guard.result(def, args, at.turn, await runTool(def, args, tctx));
        }
      }
      this.#result(msg, call, result, ctx);
      step("tool", { call_id: call.id, name: call.name, args: await this.#safe(JSON.stringify(args)), result: await this.#safe(result.content), is_error: result.isError === true });
      if (result.stoppedByUser) return "stopped";
    }
    return "done";
  }

  async #resume(cardId: number, ctx: RunContext, tctx: ToolContext, step: Stepper): Promise<"done" | "waiting" | "stopped"> {
    const conv = this.#o.conversations;
    const card = conv.card(cardId);
    if (!card || card.status === "pending" || card.status === "expired") return "done";
    const msg = conv.get(card.assistantMsg);
    const calls = msg?.toolCalls ?? [];
    const i = calls.findIndex((c) => c.id === card.callId);
    if (!msg || i < 0) return "done";
    if (conv.list(ctx.conversation).some((m) => m.role === "tool" && m.toolCallId === card.callId)) return "done"; // already applied
    // the person answered: they are here, and the request is the one the card was opened for
    const at: CallSite = { orb: ctx.orb, turn: String(card.meta.turn ?? this.#site(ctx).turn), mode: "attended", signal: ctx.signal };
    step("answer", { card: card.id, status: card.status, answer: card.answer === null ? null : await this.#safe(card.answer) });
    const call = calls[i]!;
    const args = parseArgs(call) ?? {};
    let result: ToolResult;
    if (card.kind === "plan") result = { content: PLAN_ANSWERS[card.status as keyof typeof PLAN_ANSWERS]?.(card.answer ?? "", Number(card.meta.plan)) ?? DENIED };
    else if (card.status === "answered") result = { content: `The person answered: ${card.answer ?? ""}` };
    else if (card.status === "denied") result = { content: DENIED };
    else {
      const def = this.#tools.get(card.tool);
      if (!def) result = { content: `There is no tool called ${card.tool}.`, isError: true };
      else {
        this.#o.guard.approved(at.turn, def); // a fresh yes, for this act, this turn
        ctx.activity(def.label);
        result = await this.#o.guard.result(def, args, at.turn, await runTool(def, args, tctx));
      }
    }
    this.#result(msg, call, result, ctx);
    step("tool", { call_id: call.id, name: call.name, args: await this.#safe(JSON.stringify(args)), result: await this.#safe(result.content), is_error: result.isError === true });
    if (result.stoppedByUser) return "stopped";
    return this.#calls(msg, i + 1, ctx, tctx, step, at);
  }

  /** The person's request this run works on, and whether anyone is watching. */
  #site(ctx: RunContext): CallSite {
    const request = this.#o.conversations.history(ctx.conversation).findLast((m) => m.role === "user");
    const attended = ctx.items.some((i) => i.source === "chat" || typeof i.data.resume === "number");
    return { orb: ctx.orb, turn: `${ctx.conversation}#${request?.id ?? 0}`, mode: attended ? "attended" : "away", signal: ctx.signal };
  }

  /** Text for a trace: checked for key material by the kit, or withheld when it could not be. */
  async #safe(text: string): Promise<string> {
    if (!this.#o.redact) return text;
    return (await this.#o.redact(text)) ?? "(not traced: it could not be checked for secrets)";
  }

  /** A new message instead of an answer: the card expires and its calls are answered "not done". */
  #expire(card: Card, ctx: RunContext): void {
    const conv = this.#o.conversations;
    conv.resolveCard(card.id, "expired");
    const msg = conv.get(card.assistantMsg);
    const answered = new Set(conv.list(ctx.conversation).filter((m) => m.role === "tool").map((m) => m.toolCallId));
    for (const call of msg?.toolCalls ?? []) {
      if (!answered.has(call.id)) this.#result(msg!, call, { content: EXPIRED }, ctx);
    }
    this.#o.events.append("trace.step", { run: ctx.run, kind: "expired", card: card.id }, { orb: ctx.orb, conversation: ctx.conversation });
  }

  #result(msg: Message, call: ToolCall, r: ToolResult, ctx: RunContext): void {
    this.#o.conversations.add({
      conversation: ctx.conversation, orb: ctx.orb, role: "tool", run: ctx.run, content: r.content,
      toolCallId: call.id, meta: { tool: call.name, for: msg.id, ...(r.isError && { error: true }), ...(r.stoppedByUser && { stopped: true }) },
    });
  }

  #ended(how: "waiting" | "stopped", ctx: RunContext): RunResult {
    if (how === "stopped") {
      const why = ctx.signal.reason;
      const content =
        why === "paused" ? "Paused. I'll pick this up when you resume me."
          : why === "shutdown" ? "Interrupted: the home was shutting down. I'll pick this up when it starts again."
            : "Stopped by the user.";
      this.#o.conversations.add({ conversation: ctx.conversation, orb: ctx.orb, role: "notice", run: ctx.run, content, meta: { stopped: why ?? "user" } });
      return { outcome: "ok", summary: "stopped" };
    }
    return { outcome: "waiting", summary: "waiting for an answer" };
  }

  /** Compaction: when the request would be too big, the older part of the conversation becomes a
   * summary. The newest turns stay as they are; a cut never falls inside a tool exchange. */
  async #compact(ctx: RunContext, ep: Endpoint, standingTokens: number): Promise<void> {
    const conv = this.#o.conversations;
    const hist = conv.history(ctx.conversation);
    // the whole request: the standing context is sent every time, so it counts every time
    const size = standingTokens + hist.reduce((n, m) => n + est(m.content) + (m.toolCalls ? est(JSON.stringify(m.toolCalls)) : 0), 0);
    if (size < this.#o.compactAtTokens) return;
    let keep = 0;
    let k = hist.length;
    while (k > 0 && keep + est(hist[k - 1]!.content) <= this.#o.keepRecentTokens) keep += est(hist[--k]!.content);
    while (k < hist.length && hist[k]!.role !== "user") k++; // start the kept part at a person's message
    if (k <= 1 || k >= hist.length) return;
    const middle = hist.slice(0, k);
    const text = middle
      .map((m) => `${m.role}: ${m.content}${m.toolCalls ? ` [called ${m.toolCalls.map((c) => c.name).join(", ")}]` : ""}`)
      .join("\n");
    this.#o.spend.check();
    ctx.activity("Tidying the conversation");
    const r = await chat(ep, [{ role: "user", content: `Summarise this conversation so far, keeping every decision, fact, file and open task:\n\n${text}` }], { maxTokens: 1500, signal: ctx.signal });
    this.#o.spend.record({ tier: "big", model: ep.model, costUsd: r.costUsd, costSource: r.costSource, promptTokens: r.promptTokens, completionTokens: r.completionTokens, orb: ctx.orb, conversation: ctx.conversation });
    conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "summary", run: ctx.run, content: r.text, meta: { covers_to: middle.at(-1)!.id } });
    this.#o.events.append("conversation.compacted", { run: ctx.run, covered: middle.length, kept: hist.length - k }, { orb: ctx.orb, conversation: ctx.conversation });
  }

  #stepper(ctx: RunContext): Stepper {
    let n = 0;
    return (kind, data) => {
      this.#o.events.append("trace.step", { run: ctx.run, step: n++, kind, ...data }, { orb: ctx.orb, conversation: ctx.conversation });
    };
  }
}

type Stepper = (kind: string, data: Record<string, unknown>) => void;

function parseArgs(call: ToolCall): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(call.arguments || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
