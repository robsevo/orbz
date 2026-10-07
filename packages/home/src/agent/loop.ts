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
import { workspaceOf } from "../workspace.ts";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "../clock.ts";
import type { EventLog } from "../events.ts";
import type { RunContext, RunResult, Runner } from "../inbox.ts";
import { BrainCallError, chat, type Endpoint, type Limited } from "../brain/openai.ts";
import { type BrainChain, explain, type LinkId, restFor } from "../brain/chain.ts";
import type { Specialty } from "../brain/constitution.ts";
import type { SearchKey } from "./web.ts";
import { isLight, isPass, type TeamTurn } from "./standing.ts";
import { MANAGE_USAGE } from "../chatgpt/chatgpt.ts";
import type { Spend } from "../brain/spend.ts";
import type { Card, Conversations, Message, ToolCall } from "./conversation.ts";
import { standingContext } from "./standing.ts";
import { streamChat } from "./stream.ts";
import { type Background, runTool, type ToolContext, type ToolDef, type ToolResult, TOOLS, toolSpecs } from "./tools.ts";
import type { CallSite, Guard } from "../rules/guard.ts";
import type { Case, CaseStep, StepFn } from "../gym/cases.ts";
import { taskOf } from "../gym/finder.ts";
import type { Earned, Promoted } from "../gym/steps.ts";
import type { Wrap } from "../computer/sandbox.ts";

export type AgentOptions = {
  conversations: Conversations;
  events: EventLog;
  spend: Spend;
  clock: Clock;
  dataDir: string;
  background: Background;
  /** The brain the loop talks to, asked again at every step: the ChatGPT plan when it can serve,
   * else the preset's big brain. `light`: a helper's turn in a session (PLAN 5.10), on the plan's
   * lightest model. */
  endpoint: (o?: { light?: boolean }) => Endpoint | null;
  /** A plan brain could not serve (PLAN 1.10): it pauses or forgets itself (at a usage limit, only
   * the model that met it rests), so the next `endpoint()` is the next model or brain. */
  planLimited?: (why: Limited, model?: string) => Promise<void>;
  /** Resolves once the brains are known (the ChatGPT sign-in read from the keychain). */
  ready?: () => Promise<void>;
  /** The brain order (PLAN 1.11): a brain that cannot answer rests and the next answers; after
   * three passes with none answering, the one error. `endpoint()` is its first brain now. */
  chain?: BrainChain;
  /** How long the chain waits between passes (1 s, then 2 s). */
  passWaitMs?: number;
  orbName: (orb: string) => string;
  /** What the orb does, and what the person approved for him to remember: his constitution (PLAN 3.9). */
  orbSpecialty?: (orb: string) => Specialty;
  learned?: (orb: string) => string[];
  /** What an orb kept at school (PLAN 5.7): its notebook, newest first. */
  notebook?: (orb: string) => { subject: string; text: string }[];
  /** How it gets on with the office (PLAN 5.9): its friends and frictions, in a few lines, or null. */
  colleagues?: (orb: string) => string | null;
  /** The person's web-search key, when a search needs it (PLAN 3.10). */
  searchKey?: () => Promise<SearchKey | null>;
  /** Keeps a bill or a reminder for the person (the notification centre, PLAN 2.11). */
  remind?: (orb: string, conversation: string, r: Parameters<NonNullable<ToolContext["remind"]>>[0]) => { id: number; comesUpAt: number; keeper?: string };
  /** The bills and reminders kept, and moving one (the calendar, PLAN 2.12). */
  reminders?: ToolContext["reminders"];
  moveReminder?: ToolContext["moveReminder"];
  /** Lessons (PLAN 3.5): the gate, and keeping one for the orb (only once approved). */
  lessonGate?: ToolContext["lessonGate"];
  learn?: (orb: string, line: string) => string[];
  /** His habits (PLAN 3.2): the one the gym promoted for a schedule's or a trigger's task, and its next step. */
  habits?: {
    find: (orb: string, task: string) => Promoted | null;
    step: (h: Promoted, input: Case["input"], done: CaseStep[]) => ReturnType<StepFn>;
  };
  /** Tools that come and go (PLAN 4.2: the person's connectors, as their servers are up). */
  extraTools?: () => ToolDef[];
  /** His sandbox (PLAN 4.6): what his commands run inside (`workspace` the one he works in), or
   * null where none can start. */
  sandbox?: (orb: string, workspace: string) => Wrap | null;
  /** Where he works in a conversation (PLAN 5.1): a session's tabs share the team's workspace. */
  workspaceFor?: (orb: string, conversation: string) => string;
  /** In a session (PLAN 5.1): who else holds a path in the team's claims (by name), and the sign of
   * life each act of his gives, which keeps his own claim from going stale. */
  heldBy?: (orb: string, conversation: string, path: string) => string | null;
  pulse?: (orb: string, conversation: string) => void;
  /** A command's output as it comes, for his terminal on the person's screen (never stored). */
  onTerminal?: (e: { orb: string; conversation: string; run: number; call: string; chunk: string }) => void;
  /** His plan templates (PLAN 3.2). */
  templates?: (orb: string) => { title: string; body: string }[];
  /** Sets him a job on a schedule (PLAN 2.4). */
  schedule?: (orb: string, s: Parameters<NonNullable<ToolContext["schedule"]>>[0]) => ReturnType<NonNullable<ToolContext["schedule"]>>;
  /** His own brain (PLAN 3.4): the playbook it earned for a schedule's or a trigger's task, and the brain. */
  own?: { find: (orb: string, task: string) => (Earned & { ep: Endpoint }) | null };
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
  dealt: (plan: number, mine: string[], others: string) =>
    `The person approved the plan (plan ${plan}), and its rows were dealt evenly across the team${others ? ` (${others}: they are building theirs now)` : ""}. ${mine.length ? `Yours are ${mine.join(", ")}: build only those, start_row(plan=${plan}, row, test_command), build it, then check_row, and hand_off when they are done.` : "None are yours: say so in a line, and let the others work."}`,
} as const;

const est = (text: string): number => Math.ceil(text.length / 4) + 4;

/** How many steps an orb asked by another may take (PLAN 5.10): a report, not a project. */
export const ASKED_STEPS = 15;

/** The session turn a run is for, if any (team.ts). */
const teamOf = (ctx: RunContext): TeamTurn | undefined => ctx.items.map((i) => i.data.team as TeamTurn | undefined).find(Boolean);

export class AgentRunner implements Runner {
  readonly #o: Required<Omit<AgentOptions, "redact" | "onText" | "planLimited" | "ready" | "chain" | "orbSpecialty" | "learned" | "notebook" | "colleagues" | "searchKey" | "remind" | "reminders" | "moveReminder" | "lessonGate" | "learn" | "habits" | "own" | "templates" | "schedule" | "extraTools" | "sandbox" | "onTerminal" | "workspaceFor" | "heldBy" | "pulse">> & Pick<AgentOptions, "redact" | "onText" | "planLimited" | "ready" | "chain" | "orbSpecialty" | "learned" | "notebook" | "colleagues" | "searchKey" | "remind" | "reminders" | "moveReminder" | "lessonGate" | "learn" | "habits" | "own" | "templates" | "schedule" | "extraTools" | "sandbox" | "onTerminal" | "workspaceFor" | "heldBy" | "pulse">;
  readonly #tools: Map<string, ToolDef>;

  constructor(opts: AgentOptions) {
    this.#o = { tools: TOOLS, maxSteps: 50, compactAtTokens: 100_000, keepRecentTokens: 20_000, passWaitMs: 1000, ...opts };
    this.#tools = new Map(this.#o.tools.map((t) => [t.name, t]));
  }

  /** Its own tools and, as they are up now, the person's connectors' (PLAN 4.2). */
  #all(): ToolDef[] {
    return [...this.#o.tools, ...(this.#o.extraTools?.() ?? [])];
  }

  #tool(name: string): ToolDef | undefined {
    return this.#tools.get(name) ?? this.#o.extraTools?.().find((t) => t.name === name);
  }

  /** A tool by its name: the home's own, then the person's connectors'. */
  toolNamed(name: string): ToolDef | undefined {
    return this.#tool(name);
  }

  workspace(orb: string): string {
    return workspaceOf(this.#o.dataDir, orb);
  }

  async run(ctx: RunContext): Promise<RunResult> {
    const { conversations: conv, events } = this.#o;
    const workspace = this.#o.workspaceFor?.(ctx.orb, ctx.conversation) ?? this.workspace(ctx.orb);
    const tctx: ToolContext = {
      orb: ctx.orb,
      conversation: ctx.conversation,
      workspace,
      signal: ctx.signal,
      background: this.#o.background,
      ...(this.#o.searchKey && { searchKey: this.#o.searchKey }),
      ...(this.#o.remind && { remind: (r) => this.#o.remind!(ctx.orb, ctx.conversation, r) }),
      ...(this.#o.reminders && { reminders: this.#o.reminders }),
      ...(this.#o.moveReminder && { moveReminder: this.#o.moveReminder }),
      ...(this.#o.lessonGate && { lessonGate: this.#o.lessonGate }),
      ...(this.#o.learn && { learn: (line: string) => this.#o.learn!(ctx.orb, line) }),
      ...(this.#o.templates && { templates: () => this.#o.templates!(ctx.orb) }),
      ...(this.#o.schedule && { schedule: (x) => this.#o.schedule!(ctx.orb, x) }),
      ...(this.#o.sandbox && { sandbox: this.#o.sandbox(ctx.orb, workspace) }),
      ...(this.#o.heldBy && { heldBy: (p: string) => this.#o.heldBy!(ctx.orb, ctx.conversation, p) }),
      // an ask's turn says how many hands deep it is (PLAN 5.1); the run's items carry it
      depth: Math.max(0, ...ctx.items.map((i) => Number(i.data.depth) || 0)),
      note: (text, meta) => conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "notice", run: ctx.run, content: text, meta }),
    };
    mkdirSync(tctx.workspace, { recursive: true });
    const step = this.#stepper(ctx);
    const seen = await Promise.all(ctx.items.map(async (i) => ({ id: i.id, source: i.source, text: await this.#safe(i.text), data: i.data })));
    step("input", { items: seen });

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
      if (item.source === "turn") continue; // his turn in a session: what to answer is already there
      if (ctx.fresh && !freshened && conv.history(ctx.conversation).length > 0) {
        // a schedule or trigger firing starts from a fresh context, in its own conversation
        conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "clear", run: ctx.run, meta: { fresh: true } });
      }
      freshened = true;
      // a trigger's event is from outside (triggers.ts says where it starts): fenced as data, and its turn marked
      const outside = item.source === "trigger" && typeof item.data.outside === "number" ? item.data.outside : null;
      const content = outside === null ? item.text : item.text.slice(0, outside) + (await this.#o.guard.fence(`${ctx.conversation}:${randomUUID()}`, item.text.slice(outside)));
      const asked = conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "user", run: ctx.run, content, meta: { item: item.id, source: item.source } });
      if (outside !== null) this.#o.guard.mark(`${ctx.conversation}#${asked.id}`, "trigger", String(item.data.trigger ?? ""));
    }
    // Something to answer: the person's message, tool results, or calls a stop left unanswered.
    // A card still waiting (the home died after it opened) keeps waiting: nothing is asked again.
    if (conv.openCard(ctx.conversation)) return { outcome: "waiting", summary: "a card is still waiting" };
    // A reply a pause or a shutdown cut off is not an answer when its run comes round again.
    const rerun = ctx.items.some((i) => i.data.interrupted);
    const tail = conv.history(ctx.conversation).filter((m) => m.role !== "notice").at(-1);
    // answered when the last word is HIS (in a session, another orb's last word is his to answer)
    const answered = tail?.role === "assistant" && tail.orb === ctx.orb && !tail.toolCalls?.length && !(rerun && tail.meta.stopped);
    if (!tail || tail.role === "summary" || answered) {
      return { outcome: "ok", summary: "nothing to answer" };
    }

    // The turn is the person's request this run works on; attended unless only a schedule or trigger woke it.
    const at = this.#site(ctx);
    const byHabit = await this.#habit(ctx, tctx, step, at, seen);
    if (byHabit) return byHabit;
    let own = this.#ownFor(ctx, seen); // a task its own brain earned: the own brain, with its playbook
    await this.#o.ready?.();
    let passes = 0;
    // a session's turn (PLAN 5.10): a chime-in has no tools and a short view; an asked orb a few steps
    const team = teamOf(ctx);
    const role = team?.role;
    const light = isLight(team);
    const steps = role === "asked" ? Math.min(ASKED_STEPS, this.#o.maxSteps) : this.#o.maxSteps;
    const tools = role === "chime" ? [] : this.#all();
    const runNow = this.#o.clock.now(); // once a run: the standing context stays the same from step to step
    for (let n = 0; n < steps; n++) {
      if (ctx.signal.aborted) return this.#ended("stopped", ctx);
      let ep = own?.ep ?? this.#o.endpoint({ light }); // every step: a plan at its limit since the last one has stepped aside
      if (!ep) {
        const chain = this.#o.chain;
        const states = chain?.states() ?? [];
        if (!chain || states.every((s) => s.state === "absent")) {
          conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "notice", run: ctx.run, content: "No brain is set up yet, so I can't answer. Choose one in settings." });
          return { outcome: "ok", summary: "no brain" };
        }
        // some are set up, none can answer now: look again (the ones that were down), three passes in all
        if (++passes < 3) {
          chain.retryDown();
          await abortable(this.#o.passWaitMs * passes, ctx.signal);
          n--;
          continue;
        }
        const msg = explain(chain.states(), 3);
        conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "notice", run: ctx.run, content: msg, meta: { error: true, brains: chain.states() } });
        step("no-brain", { brains: chain.states().map((s) => ({ id: s.id, state: s.state, why: s.why })) });
        return { outcome: "ok", summary: "no brain answered" };
      }
      const standing = standingContext({
        orbName: this.#o.orbName(ctx.orb), brainDir: join(this.#o.dataDir, "brain"), workspace: tctx.workspace,
        specialty: this.#o.orbSpecialty?.(ctx.orb), learned: this.#o.learned?.(ctx.orb), notebook: this.#o.notebook?.(ctx.orb), colleagues: this.#o.colleagues?.(ctx.orb) ?? null, ...(team && { team }),
        aloud: ctx.items.some((i) => i.data.said === true), // you spoke (PLAN 4.7): his answer is heard, not read
        now: runNow,
      });
      await this.#compact(ctx, ep, est(standing));
      if (!own) ep = this.#o.endpoint({ light }) ?? ep; // compaction may have met the plan's limit and moved on
      this.#o.spend.check(); // SpendCapError: the inbox stops the run cleanly ("capped")
      const messages = [{ role: "system" as const, content: own ? `${standing}\n\n${own.system}` : standing }, ...conv.toModel(conv.history(ctx.conversation), { me: ctx.orb, nameOf: this.#o.orbName, talk: role === "chime", brief: role === "asked" })];
      ctx.activity("Thinking");
      const r = await streamChat(
        ep,
        { messages, tools: toolSpecs(tools), brief: role === "chime" },
        { signal: ctx.signal, onText: (delta) => this.#o.onText?.({ orb: ctx.orb, conversation: ctx.conversation, run: ctx.run, delta }) },
      );
      if (r.promptTokens || r.completionTokens || r.costUsd) {
        this.#o.spend.record({
          tier: own ? "own" : "big", model: ep.model, costUsd: r.costUsd, costSource: r.costSource,
          promptTokens: r.promptTokens, completionTokens: r.completionTokens, cachedTokens: r.cachedTokens, orb: ctx.orb, conversation: ctx.conversation,
          ...(role && { turn: role }),
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
      if (r.limited && ep.plan) {
        // the plan cannot serve this: say so (Manage usage first), then the same step on the next model or brain
        const next = await this.#limited(ctx, r.limited, ep);
        if (next) {
          n--;
          continue;
        }
        return { outcome: "ok", summary: `plan ${r.limited}` };
      }
      if (r.error && ep.chain && !r.text && !r.toolCalls.length && this.#o.chain) {
        // it failed before a word arrived: it steps aside, saying so, and the same step goes to the next
        this.#stepAside(ctx, ep.chain, { status: r.status, message: r.error, retryAfterS: r.retryAfterS });
        step("fallback", { from: ep.chain, status: r.status });
        n--;
        continue;
      }
      if (r.error && own && !r.text && !r.toolCalls.length) {
        // his own brain could not answer: the big brain takes the run on from here, saying so
        this.#ownFell(ctx, own, r.error, step);
        own = null;
        n--;
        continue;
      }
      if (r.error) {
        if (r.text) conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "assistant", run: ctx.run, content: r.text, meta: { error: r.error } });
        conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "notice", run: ctx.run, content: `I couldn't finish: ${r.error}`, meta: { error: true } });
        throw new Error(r.error);
      }
      // `plan` marks a reply the ChatGPT plan served to completion: the only replies that carry its badge
      const meta = { ...(ep.plan && { plan: ep.plan }), ...(own && { own: own.kind, ownTask: own.task }) };
      if (role === "chime" && r.toolCalls.length) r.toolCalls = []; // a chime-in has no tools: a call it made up is not run
      if (role === "chime" && (isPass(r.text) || !r.text.trim())) {
        // nothing new to add: nothing is posted but a quiet line saying so (owner, 10-06)
        conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "notice", run: ctx.run, content: `${this.#o.orbName(ctx.orb)} passed.`, meta: { passed: true } });
        step("output", { text: r.text, passed: true });
        return { outcome: "ok", summary: "passed" };
      }
      const msg = conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "assistant", run: ctx.run, content: r.text, toolCalls: r.toolCalls, ...(Object.keys(meta).length && { meta }) });
      if (!r.toolCalls.length) {
        step("output", { text: r.text });
        if (own) this.#o.events.append("ladder.answered", { kind: own.kind, tier: "own", run: ctx.run }, { orb: ctx.orb, conversation: ctx.conversation });
        return { outcome: "ok", summary: r.text.slice(0, 200) };
      }
      const calls = await this.#calls(msg, 0, ctx, tctx, step, at);
      if (calls !== "done") return this.#ended(calls, ctx);
    }
    conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "notice", run: ctx.run, content: `I stopped after ${steps} steps. Say "go on" and I'll continue.` });
    return { outcome: "ok", summary: "step limit" };
  }

  /** A promoted habit answers its task in the brain's place (PLAN 3.2): one step at a time, each
   * call through the guard and the floor as the brain's are, a card waiting for the person just the
   * same. When it refuses (its guard, an input it was never proved on, an error), or a call comes
   * back off the path it learned (an error, a no), the brain takes the run on from where it is, and
   * the refusal is kept for tonight's recompile (3.3). Null: the brain's turn. */
  async #habit(ctx: RunContext, tctx: ToolContext, step: Stepper, at: CallSite, seen: { source: string; text: string; data: Record<string, unknown> }[]): Promise<RunResult | null> {
    const habits = this.#o.habits;
    if (!habits) return null;
    const conv = this.#o.conversations;
    for (let n = 0; n < this.#o.maxSteps; n++) {
      if (ctx.signal.aborted) return this.#ended("stopped", ctx);
      const s = this.#habitState(ctx, seen);
      if (!s) return null;
      if ("fell" in s) return this.#fell(ctx, s.h, s.fell, step);
      ctx.activity("From habit");
      const next = await habits.step(s.h, s.input, s.done);
      if ("refused" in next) return this.#fell(ctx, s.h, next.refused, step);
      const meta = { habit: { key: s.h.key, task: s.h.task, version: s.h.version, dir: s.h.dir, input: s.input } };
      if ("output" in next) {
        conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "assistant", run: ctx.run, content: next.output, meta });
        step("model", { text: await this.#safe(next.output), tool_calls: [], habit: s.h.key });
        step("output", { text: next.output, habit: s.h.key });
        this.#o.events.append("ladder.answered", { kind: s.h.key, tier: "habit", run: ctx.run }, { orb: ctx.orb, conversation: ctx.conversation });
        return { outcome: "ok", summary: next.output.slice(0, 200) };
      }
      const call: ToolCall = { id: `habit-${ctx.run}-${s.done.length}`, name: next.call.name, arguments: JSON.stringify(next.call.args) };
      step("model", { text: "", tool_calls: [{ ...call, arguments: await this.#safe(call.arguments) }], habit: s.h.key });
      const msg = conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "assistant", run: ctx.run, content: "", toolCalls: [call], meta });
      const r = await this.#calls(msg, 0, ctx, tctx, step, at);
      if (r !== "done") return this.#ended(r, ctx);
    }
    return null;
  }

  /** Where a habit is in this turn, read from the conversation (so a card's answer, or a restart,
   * goes on where it was): its calls so far with their results, or why it hands the run on. */
  #habitState(ctx: RunContext, seen: { source: string; text: string; data: Record<string, unknown> }[]): { h: Promoted; input: Case["input"]; done: CaseStep[] } | { h: Promoted; fell: string } | null {
    const history = this.#o.conversations.history(ctx.conversation);
    const asked = history.findLastIndex((m) => m.role === "user");
    if (asked < 0) return null;
    const turn = history.slice(asked + 1);
    if (turn.some((m) => m.role === "notice" && m.meta.habitFell)) return null;
    const said = turn.filter((m) => m.role === "assistant");
    if (!said.length) {
      if (!ctx.fresh) return null; // only what a schedule or a trigger asked: a chat is the brain's
      const asks = seen.filter((i) => i.source !== "system");
      if (asks.length !== 1) return null;
      const h = this.#o.habits!.find(ctx.orb, taskOf(ctx.orb, asks).task);
      return h && { h, input: { text: asks[0]!.text, data: asks[0]!.data ?? {} }, done: [] };
    }
    // a turn it began goes on, unless the brain has taken it over
    if (!said.every((m) => m.orb === ctx.orb && m.meta.habit)) return null;
    const { input, ...h } = said[0]!.meta.habit as Promoted & { input: Case["input"] };
    const results = new Map(turn.filter((m) => m.role === "tool" && m.toolCallId).map((m) => [m.toolCallId!, m]));
    const done: CaseStep[] = [];
    for (const m of said) {
      for (const c of m.toolCalls ?? []) {
        const r = results.get(c.id);
        if (!r) return null;
        if (r.meta.error || r.meta.stopped || r.content === DENIED || r.content === EXPIRED) return { h, fell: `${c.name} came back otherwise than on the path it learned` };
        done.push({ call: { name: c.name, args: parseArgs(c) ?? {} }, result: r.content ?? "", isError: false });
      }
    }
    return { h, input, done };
  }

  /** His own brain for this turn (PLAN 3.4): a turn it began goes on with it, unless the big brain
   * has taken over; a new one is its own only if a schedule or a trigger asked a task it earned. */
  #ownFor(ctx: RunContext, seen: { source: string; text: string; data: Record<string, unknown> }[]): (Earned & { ep: Endpoint }) | null {
    const own = this.#o.own;
    if (!own) return null;
    const history = this.#o.conversations.history(ctx.conversation);
    const asked = history.findLastIndex((m) => m.role === "user");
    if (asked < 0) return null;
    const turn = history.slice(asked + 1);
    if (turn.some((m) => m.role === "notice" && m.meta.ownFell)) return null;
    const said = turn.filter((m) => m.role === "assistant" && !m.meta.habit);
    if (said.length) {
      const task = said[0]!.meta.ownTask;
      if (typeof task !== "string" || !said.every((m) => m.orb === ctx.orb && m.meta.ownTask === task)) return null;
      return own.find(ctx.orb, task);
    }
    if (!ctx.fresh) return null;
    const asks = seen.filter((i) => i.source !== "system");
    return asks.length === 1 ? own.find(ctx.orb, taskOf(ctx.orb, asks).task) : null;
  }

  #ownFell(ctx: RunContext, own: Earned, why: string, step: Stepper): void {
    step("fallback", { from: "own", why });
    this.#o.events.append("own.fell", { kind: own.kind, version: own.version, run: ctx.run, why }, { orb: ctx.orb, conversation: ctx.conversation });
    this.#o.conversations.add({
      conversation: ctx.conversation, orb: ctx.orb, role: "notice", run: ctx.run,
      content: `My own brain couldn't answer this one (${why}), so the big brain is taking it.`, meta: { ownFell: own.kind },
    });
  }

  #fell(ctx: RunContext, h: Promoted, why: string, step: Stepper): null {
    step("habit", { habit: h.key, version: h.version, fell: why });
    this.#o.events.append("habit.fell", { kind: h.key, task: h.task, version: h.version, run: ctx.run, why }, { orb: ctx.orb, conversation: ctx.conversation });
    this.#o.conversations.add({
      conversation: ctx.conversation, orb: ctx.orb, role: "notice", run: ctx.run,
      content: `My habit for this passed it on (${why}), so I'm thinking it through.`, meta: { habitFell: h.key },
    });
    return null;
  }

  /** Runs an assistant message's tool calls from `from` on. A call that needs the person opens a card. */
  async #calls(msg: Message, from: number, ctx: RunContext, tctx: ToolContext, step: Stepper, at: CallSite): Promise<"done" | "waiting" | "stopped"> {
    const calls = msg.toolCalls ?? [];
    for (let i = from; i < calls.length; i++) {
      if (ctx.signal.aborted) return "stopped";
      const call = calls[i]!;
      const def = this.#tool(call.name);
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
          this.#o.events.append("tool.never", { run: ctx.run, tool: call.name }, { orb: ctx.orb, conversation: ctx.conversation }); // the XP ledger hears it (PLAN 3.6)
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
          result = await this.#o.guard.result(def, args, at.turn, await runTool(def, args, this.#forCall(tctx, ctx, call.id)));
        }
      }
      this.#result(msg, call, result, ctx);
      this.#o.pulse?.(ctx.orb, ctx.conversation);
      step("tool", { call_id: call.id, name: call.name, args: await this.#safe(JSON.stringify(args)), result: await this.#safe(result.content), is_error: result.isError === true });
      if (result.stoppedByUser) return "stopped";
    }
    return "done";
  }

  /** The tool context for one call: what it prints goes to his terminal on the person's screen. */
  #forCall(tctx: ToolContext, ctx: RunContext, call: string): ToolContext {
    const on = this.#o.onTerminal;
    return on ? { ...tctx, onOutput: (chunk: string) => on({ orb: ctx.orb, conversation: ctx.conversation, run: ctx.run, call, chunk }) } : tctx;
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
    if (card.kind === "plan" && card.status === "approved" && card.meta.dealt && typeof card.meta.dealt === "object") {
      // in a session the rows were dealt evenly (PLAN 5.10): the lead builds only its own
      const dealt = card.meta.dealt as Record<string, string[]>;
      const others = Object.entries(dealt).filter(([o, r]) => o !== ctx.orb && r.length).map(([o, r]) => `${this.#o.orbName(o)} ${r.join(", ")}`).join("; ");
      result = { content: PLAN_ANSWERS.dealt(Number(card.meta.plan), dealt[ctx.orb] ?? [], others) };
    } else if (card.kind === "plan") result = { content: PLAN_ANSWERS[card.status as Exclude<keyof typeof PLAN_ANSWERS, "dealt">]?.(card.answer ?? "", Number(card.meta.plan)) ?? DENIED };
    else if (card.status === "answered") result = { content: `The person answered: ${card.answer ?? ""}` };
    else if (card.status === "denied") result = { content: DENIED };
    else {
      const def = this.#tool(card.tool);
      if (!def) result = { content: `There is no tool called ${card.tool}.`, isError: true };
      else {
        this.#o.guard.approved(at.turn, def); // a fresh yes, for this act, this turn
        ctx.activity(def.label);
        result = await this.#o.guard.result(def, args, at.turn, await runTool(def, args, this.#forCall(tctx, ctx, call.id)));
      }
    }
    this.#result(msg, call, result, ctx);
    this.#o.pulse?.(ctx.orb, ctx.conversation);
    step("tool", { call_id: call.id, name: call.name, args: await this.#safe(JSON.stringify(args)), result: await this.#safe(result.content), is_error: result.isError === true });
    if (result.stoppedByUser) return "stopped";
    return this.#calls(msg, i + 1, ctx, tctx, step, at);
  }

  /** The person's request this run works on, and whether anyone is watching. */
  #site(ctx: RunContext): CallSite {
    const request = this.#o.conversations.history(ctx.conversation).findLast((m) => m.role === "user");
    // a session's turn is the person's own words in a tab (team.ts), as much as a chat message is
    const attended = ctx.items.some((i) => i.source === "chat" || i.source === "turn" || typeof i.data.resume === "number");
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
  /** A plan brain could not serve: the person is told why, first, with what to do about it; then the
   * plan steps aside. Returns the brain that answers instead, or null when there is none. */
  async #limited(ctx: RunContext, why: Limited, from?: Endpoint): Promise<Endpoint | null> {
    const conv = this.#o.conversations;
    const say = (content: string, meta: Record<string, unknown>): void => {
      conv.add({ conversation: ctx.conversation, orb: ctx.orb, role: "notice", run: ctx.run, content, meta });
    };
    if (why === "usage-limit" && from) {
      // ChatGPT's limits are each model's (10-06: the flagship ran out while the smaller ones still
      // answered): the model that met its limit rests, and a lighter one of the plan answers first
      await this.#o.planLimited?.(why, from.model);
      const next = this.#o.endpoint({ light: isLight(teamOf(ctx)) });
      if (next?.plan && next.model !== from.model) {
        say(`Usage limit reached for ${from.model} on your ChatGPT plan. Answering with ${next.model} until it resets.`, { limit: why, model: from.model, fallback: next.model, action: { label: "Manage usage", url: MANAGE_USAGE } });
        return next;
      }
    }
    if (why === "usage-limit") {
      say("Usage limit reached. Review your plan or this app's limit in ChatGPT settings.", { limit: why, action: { label: "Manage usage", url: MANAGE_USAGE } });
    } else if (why === "not-eligible") {
      say("ChatGPT plan use isn't available for this account, workspace or policy.", { limit: why });
    } else {
      say("The ChatGPT sign-in has lapsed. Sign in again to use your plan (/chatgpt).", { limit: why });
    }
    if (why !== "usage-limit" || !from) await this.#o.planLimited?.(why);
    const next = this.#o.endpoint({ light: isLight(teamOf(ctx)) });
    if (next && !next.plan) {
      const label = next.chain && this.#o.chain ? this.#o.chain.labelOf(next.chain) : next.name === "big" ? "my other brain" : next.name;
      say(`Answering with ${label} until then.`, { fallback: next.chain ?? next.name });
      return next;
    }
    say("No other brain is set up, so this waits for your ChatGPT plan.", { fallback: null });
    return null;
  }

  /** A brain in the order could not answer: it rests (until its limit resets, or a minute when it
   * was down), and the person is told who answers instead. */
  #stepAside(ctx: RunContext, id: LinkId, o: { status: number | null; message: string; retryAfterS: number | null }): void {
    const chain = this.#o.chain!;
    const r = restFor(o, chain.now());
    chain.rest(id, r);
    const next = chain.after(id);
    const until = r.kind === "limit" ? ` until about ${new Date(r.until).toTimeString().slice(0, 5)}` : "";
    const label = chain.labelOf(id);
    const content = `${label[0]!.toUpperCase()}${label.slice(1)}: ${r.why}${next ? `; answering with ${next.label}${until}` : ""}.`;
    this.#o.conversations.add({ conversation: ctx.conversation, orb: ctx.orb, role: "notice", run: ctx.run, content, meta: { brain: id, rest: r.kind, fallback: next?.id ?? null } });
  }

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
    if (ep.plan === "chatgpt") ep = this.#o.endpoint({ light: true }) ?? ep; // a summary is the plan's light model's work (PLAN 5.10)
    const ask = [{ role: "user" as const, content: `Summarise this conversation so far, keeping every decision, fact, file and open task:\n\n${text}` }];
    let r: Awaited<ReturnType<typeof chat>>;
    try {
      r = await chat(ep, ask, { maxTokens: 1500, signal: ctx.signal });
    } catch (e) {
      if (!(e instanceof BrainCallError)) throw e;
      let next: Endpoint | null = null;
      if (e.limited && ep.plan) next = await this.#limited(ctx, e.limited, ep);
      else if (ep.chain && this.#o.chain) {
        this.#stepAside(ctx, ep.chain, { status: e.status, message: e.message, retryAfterS: null });
        next = this.#o.endpoint({ light: true });
      }
      if (!next) throw e;
      ep = next;
      r = await chat(ep, ask, { maxTokens: 1500, signal: ctx.signal });
    }
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

/** Waits `ms`, or less if the run is stopped meanwhile. */
function abortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });
}
