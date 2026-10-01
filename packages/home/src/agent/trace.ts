// Traces (PLAN 1.5): every run's steps, as `trace.step` events — what came in, each model reply
// (text and tool calls), each tool's result, each card and its answer, what went out — and the
// owner's verdict on it (`trace.feedback`). The gym's habit compiler (PLAN 3.1-3.2) learns from
// approved traces, so a trace must be complete enough to replay: `script()` turns one back into
// the model replies and tool results that produced it.
import type { EventLog, HomeEvent } from "../events.ts";

export type TraceStep = { step: number; kind: string; data: Record<string, unknown> };

export type Script = {
  /** The items the run started from. */
  inputs: { id: number; source: string; text: string; data: Record<string, unknown> }[];
  /** The model's replies, in order. */
  replies: { text: string; toolCalls: { id: string; name: string; arguments: string }[] }[];
  /** Each tool call's result, by call id. */
  results: Map<string, { content: string; isError: boolean }>;
  /** The final reply, if the run produced one. */
  output: string | null;
};

export function trace(events: EventLog, run: number): TraceStep[] {
  return events
    .ofType("trace.step")
    .filter((e) => e.data.run === run && typeof e.data.step === "number")
    .map((e: HomeEvent) => {
      const { run: _r, step, kind, ...data } = e.data;
      return { step: step as number, kind: String(kind), data };
    })
    .sort((a, b) => a.step - b.step);
}

/** The model replies and tool results a run (or several runs of one job: a card's answer resumes
 * in a second run) was made of. */
export function script(events: EventLog, runs: number[]): Script {
  const out: Script = { inputs: [], replies: [], results: new Map(), output: null };
  for (const run of runs) {
    for (const s of trace(events, run)) {
      if (s.kind === "input" && Array.isArray(s.data.items)) out.inputs.push(...(s.data.items as Script["inputs"]));
      else if (s.kind === "model" && !s.data.stopped && !s.data.error) {
        out.replies.push({ text: String(s.data.text ?? ""), toolCalls: (s.data.tool_calls as Script["replies"][number]["toolCalls"]) ?? [] });
      } else if (s.kind === "tool") {
        out.results.set(String(s.data.call_id), { content: String(s.data.result ?? ""), isError: s.data.is_error === true });
      } else if (s.kind === "output") out.output = String(s.data.text ?? "");
    }
  }
  return out;
}

/** The owner's verdict on a run: approved as it is, or corrected (with what was wrong). */
export function feedback(events: EventLog, run: number, verdict: "approve" | "correct", note = ""): void {
  events.append("trace.feedback", { run, verdict, note });
}
