// The own brain's playbook (PLAN 3.4): compact instructions plus worked examples from a task's
// approved runs, written by code (no model writes it, so nothing a model says becomes one). Its
// version is its hash: a new playbook is one whose text changed. A task type answers on the own
// brain only once that brain, with this playbook, has cleared the exam (exam.ts) on the task's
// approved runs; at run time the guard and the floor apply to its calls as to any brain's.
import { createHash } from "node:crypto";
import { BrainCallError, type Endpoint } from "../brain/openai.ts";
import type { ModelMessage } from "../agent/conversation.ts";
import { type Streamed, streamChat } from "../agent/stream.ts";
import type { toolSpecs } from "../agent/tools.ts";
import type { Case, StepFn } from "./cases.ts";
import type { Candidate } from "./finder.ts";

/** How many approved runs it shows as worked examples, the newest (the rest are the exam's: an
 * exam it has the answers to proves nothing). */
export const EXAMPLES = 2;

export type Playbook = { kind: string; task: string; version: string; system: string };

/** The playbook for a candidate, from its approved runs, newest examples first. */
export function playbookOf(c: Candidate, cases: Case[]): Playbook {
  const tools = c.shape.split(" ")[0]!.split(">");
  const examples = cases.slice(-EXAMPLES).reverse().map((k, i) => [
    `Example ${i + 1}`,
    `Asked: ${k.input.text}`,
    ...k.steps.map((s) => `Called ${s.call.name} ${JSON.stringify(s.call.args)} → ${clip(s.result)}`),
    `Answered: ${k.output}`,
  ].join("\n"));
  const system = [
    "This is a task you have done before, and the person approved how, each time.",
    `It starts from ${c.trigger}, and it is done with ${tools.join(", then ")}.`,
    "Do it the way the approved runs did: the same tools, in the same order, with what the input and the results tell you. Then say what you did, in a sentence.",
    "If this one is not like them, say so instead of guessing.",
    "",
    ...examples.flatMap((e) => [e, ""]),
  ].join("\n").trim();
  return { kind: c.key, task: c.task, version: createHash("sha256").update(system).digest("hex").slice(0, 12), system };
}

const clip = (s: string): string => (s.length > 300 ? `${s.slice(0, 300)}…` : s).replace(/\n/g, "\\n");

/** The own brain as a step function, for the exam: the playbook, the input, and the calls so far
 * with their results; its next call, or its answer. A refusal of the request is thrown, so a rate
 * limit is told apart from a wrong answer. */
export function brainStep(ep: Endpoint, pb: Playbook, tools: ReturnType<typeof toolSpecs>, o: { signal?: AbortSignal; spent?: (r: Pick<Streamed, "costUsd" | "costSource" | "promptTokens" | "completionTokens">) => void } = {}): (c: Case) => StepFn {
  return () => async (input, done) => {
    const messages: ModelMessage[] = [{ role: "system", content: pb.system }, { role: "user", content: input.text }];
    done.forEach((d, i) => {
      messages.push({ role: "assistant", content: "", tool_calls: [{ id: `c${i}`, type: "function", function: { name: d.call.name, arguments: JSON.stringify(d.call.args) } }] });
      messages.push({ role: "tool", tool_call_id: `c${i}`, content: d.result });
    });
    const r = await streamChat(ep, { messages, tools }, { ...(o.signal && { signal: o.signal }) });
    o.spent?.(r);
    if (r.error) throw new BrainCallError(ep.name, r.error, r.status);
    const call = r.toolCalls[0];
    if (!call) return { output: r.text };
    try {
      return { call: { name: call.name, args: JSON.parse(call.arguments || "{}") as Record<string, unknown> } };
    } catch {
      return { refused: `its arguments for ${call.name} were not JSON` };
    }
  };
}
