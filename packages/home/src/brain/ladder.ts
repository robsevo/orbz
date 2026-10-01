// The brain ladder (PLAN 1.4): three tiers behind one call.
//
//   [1] habit      tested code, 0 tokens          the shelf's habit for this kind of task
//   [2] own brain  a small model + its playbook   only for kinds that have EARNED it (PLAN 3.4)
//   [3] big brain  the one key                    everything else
//
// A tier that does not answer hands the task down with its reason, and the answer carries the
// whole trail. When a habit or an earned own brain passed a task on, the answer also SAYS so in
// a sentence the orb can show ("My invoice habit passed this one on: …") — a quiet fall-through
// is how a person stops trusting habits without knowing why.
//
// Money is checked before every brain call. At the cap the call is not made and SpendCapError
// propagates: a cap is a stop, never a reason to try another paid brain.
import type { EventLog } from "../events.ts";
import type { HabitShelf } from "./habits.ts";
import { BrainCallError, type ChatMessage, chat, type Completion, type Endpoint } from "./openai.ts";
import type { Spend } from "./spend.ts";

export type Tier = "habit" | "own" | "big";

export type LadderTask = {
  /** The task's shape ("invoice", "inbox-digest"): what habits and earned own-brain kinds are keyed by. */
  kind: string;
  /** The structured input a habit takes. */
  input?: unknown;
  /** How to ask a brain: system prompt, trimmed history, the request. */
  messages: ChatMessage[];
  /** Turns a brain's reply into the answer, or throws if it is not one (missing keys, cut off). */
  parse?: (text: string) => unknown;
  maxTokens?: number;
  orb?: string;
  conversation?: string;
};

export type Fall = { tier: Tier; why: string };

export type LadderAnswer = {
  tier: Tier;
  output: unknown;
  /** A brain's raw reply (null for a habit). */
  text: string | null;
  /** Every tier that did not answer, in order, with its reason. */
  fell: Fall[];
  /** The sentence to show when a habit or an earned own brain passed the task on; else null. */
  said: string | null;
  costUsd: number;
  tokens: number;
};

export class NoBrainError extends Error {
  readonly fell: Fall[];
  constructor(fell: Fall[]) {
    super(`nothing could answer: ${fell.map((f) => `${f.tier}: ${f.why}`).join("; ") || "no tier is set up"}`);
    this.name = "NoBrainError";
    this.fell = fell;
  }
}

export type LadderOptions = {
  events: EventLog;
  spend: Spend;
  shelf: HabitShelf;
  own: Endpoint | null;
  big: Endpoint | null;
  /** Kinds whose exam pass rate cleared the bar (PLAN 3.4). None by default. */
  ownEarned?: (kind: string) => boolean;
  /** The own brain's playbook for a kind: instructions and approved examples (PLAN 3.4). */
  playbook?: (kind: string) => ChatMessage[];
};

export class Ladder {
  readonly #o: LadderOptions;

  constructor(opts: LadderOptions) {
    this.#o = opts;
  }

  async ask(task: LadderTask, signal?: AbortSignal): Promise<LadderAnswer> {
    const fell: Fall[] = [];
    let passedOn = false; // a habit or an earned own brain existed and did not answer

    const habit = this.#o.shelf.get(task.kind);
    if (habit) {
      const a = await habit.answer(task.input ?? null);
      if (a.answered) return this.#done(task, { tier: "habit", output: a.output, text: null, fell, said: null, costUsd: 0, tokens: 0 });
      fell.push({ tier: "habit", why: a.why });
      passedOn = true;
    } else {
      fell.push({ tier: "habit", why: `no habit for "${task.kind}" yet` });
    }

    const own = this.#o.own;
    if (own && this.#o.ownEarned?.(task.kind)) {
      const r = await this.#brain("own", own, [...(this.#o.playbook?.(task.kind) ?? []), ...task.messages], task, signal);
      if ("answer" in r) return this.#done(task, { ...r.answer, fell, said: passedOn ? sentence(task.kind, fell, "own") : null });
      fell.push({ tier: "own", why: r.why });
      passedOn = true;
    } else if (own) {
      fell.push({ tier: "own", why: `"${task.kind}" has not earned the own brain yet` });
    }

    const big = this.#o.big;
    if (big) {
      const r = await this.#brain("big", big, task.messages, task, signal);
      if ("answer" in r) return this.#done(task, { ...r.answer, fell, said: passedOn ? sentence(task.kind, fell, "big") : null });
      fell.push({ tier: "big", why: r.why });
    }
    this.#o.events.append("ladder.failed", { kind: task.kind, fell }, { orb: task.orb ?? null, conversation: task.conversation ?? null });
    throw new NoBrainError(fell);
  }

  /** One brain tier: check the cap, call, record the spend, parse. A cap stops everything. */
  async #brain(
    tier: "own" | "big",
    ep: Endpoint,
    messages: ChatMessage[],
    task: LadderTask,
    signal?: AbortSignal,
  ): Promise<{ answer: Omit<LadderAnswer, "fell" | "said"> } | { why: string }> {
    this.#o.spend.check(); // throws SpendCapError: never caught here
    let c: Completion;
    try {
      c = await chat(ep, messages, { maxTokens: task.maxTokens, signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      return { why: e instanceof BrainCallError ? e.message : `${ep.name}: ${e instanceof Error ? e.message : String(e)}` };
    }
    this.#o.spend.record({
      tier,
      model: ep.model,
      costUsd: c.costUsd,
      costSource: c.costSource,
      promptTokens: c.promptTokens,
      completionTokens: c.completionTokens,
      orb: task.orb,
      conversation: task.conversation,
    });
    const tokens = c.promptTokens + c.completionTokens;
    let output: unknown = c.text;
    if (task.parse) {
      try {
        output = task.parse(c.text);
      } catch (e) {
        const cut = c.finish === "length" ? " (it was cut off at its length limit)" : "";
        return { why: `${ep.name}'s reply is not an answer${cut}: ${e instanceof Error ? e.message : String(e)}` };
      }
    } else if (!c.text.trim()) {
      return { why: `${ep.name} replied with nothing` };
    }
    return { answer: { tier, output, text: c.text, costUsd: c.costUsd ?? 0, tokens } };
  }

  #done(task: LadderTask, a: LadderAnswer): LadderAnswer {
    this.#o.events.append(
      "ladder.answered",
      { kind: task.kind, tier: a.tier, fell: a.fell, said: a.said, cost_usd: a.costUsd, tokens: a.tokens },
      { orb: task.orb ?? null, conversation: task.conversation ?? null },
    );
    return a;
  }
}

function sentence(kind: string, fell: Fall[], answered: "own" | "big"): string {
  const first = fell.find((f) => f.tier !== "big" && !f.why.startsWith("no habit") && !f.why.includes("has not earned"));
  const who = answered === "own" ? "my own brain" : "the big brain";
  if (!first) return `This went to ${who}.`;
  const what = first.tier === "habit" ? `My "${kind}" habit` : "My own brain";
  return `${what} passed this one on (${first.why}), so ${who} answered.`;
}

/** Fits a conversation to a token budget: system messages stay, then the newest turns that fit;
 * the last message always stays. Dropped turns are named in a note, not silently gone. */
export function trimHistory(messages: ChatMessage[], budgetTokens: number): { messages: ChatMessage[]; dropped: number } {
  const est = (m: ChatMessage): number => Math.ceil(m.content.length / 4) + 4;
  const system = messages.filter((m) => m.role === "system");
  const turns = messages.filter((m) => m.role !== "system");
  let used = system.reduce((n, m) => n + est(m), 0);
  const kept: ChatMessage[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const m = turns[i]!;
    if (kept.length > 0 && used + est(m) > budgetTokens) break;
    kept.unshift(m);
    used += est(m);
  }
  const dropped = turns.length - kept.length;
  const note: ChatMessage[] = dropped
    ? [{ role: "system", content: `(${dropped} earlier message${dropped === 1 ? " is" : "s are"} not shown, to fit the context.)` }]
    : [];
  return { messages: [...system, ...note, ...kept], dropped };
}
