// A streamed chat completion with tools (PLAN 1.5). Streaming is what lets a stopped turn keep
// what the model had already written (Ash's stop-turn lesson: a stop that throws the partial
// reply away loses work the person watched arrive), and what lets an error say how far it got.
//
// The result always carries the partial text. A stop comes back as `stopped: true`; a transport
// failure as `error` with the cause's code (ECONNRESET, ECONNREFUSED…) when there is one.
import type { ModelMessage, ToolCall } from "./conversation.ts";
import type { CostSource, Endpoint } from "../brain/openai.ts";

export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type Streamed = {
  text: string;
  toolCalls: ToolCall[];
  finish: string | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
  costSource: CostSource;
  /** The person stopped it; `text` is what had arrived by then. */
  stopped: boolean;
  /** The request failed; `text` is what had arrived by then. */
  error: string | null;
};

export async function streamChat(
  ep: Endpoint,
  body: { messages: ModelMessage[]; tools?: ToolSpec[]; maxTokens?: number },
  opts: { signal?: AbortSignal; onText?: (delta: string) => void } = {},
): Promise<Streamed> {
  const out: Streamed = {
    text: "",
    toolCalls: [],
    finish: null,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: null,
    costSource: "unknown",
    stopped: false,
    error: null,
  };
  const calls: { id: string; name: string; arguments: string }[] = [];
  let reportedCost: number | null = null;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ep.apiKey) headers.authorization = `Bearer ${ep.apiKey}`;
  const timeout = AbortSignal.timeout(ep.timeoutMs ?? 300_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  try {
    if (opts.signal?.aborted) throw opts.signal.reason;
    const res = await fetch(`${ep.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({
        model: ep.model,
        messages: body.messages,
        ...(body.tools?.length && { tools: body.tools }),
        max_tokens: body.maxTokens ?? 8000,
        stream: true,
        stream_options: { include_usage: true },
        ...ep.extra,
      }),
    });
    if (!res.ok || !res.body) {
      out.error = `${ep.name}: HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      return finish();
    }
    const header = res.headers.get("x-litellm-response-cost");
    if (header && Number.isFinite(Number(header)) && Number(header) > 0) reportedCost = Number(header);
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let j: StreamChunk;
        try {
          j = JSON.parse(data) as StreamChunk;
        } catch {
          continue;
        }
        if (j.usage) {
          out.promptTokens = Number(j.usage.prompt_tokens ?? out.promptTokens);
          out.completionTokens = Number(j.usage.completion_tokens ?? out.completionTokens);
          if (typeof j.usage.cost === "number") reportedCost = j.usage.cost;
        }
        const choice = j.choices?.[0];
        if (!choice) continue;
        const d = choice.delta ?? {};
        if (typeof d.content === "string" && d.content) {
          out.text += d.content;
          opts.onText?.(d.content);
        }
        for (const tc of d.tool_calls ?? []) {
          const i = tc.index ?? 0;
          const c = (calls[i] ??= { id: "", name: "", arguments: "" });
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.name += tc.function.name;
          if (tc.function?.arguments) c.arguments += tc.function.arguments;
        }
        if (choice.finish_reason) out.finish = choice.finish_reason;
      }
    }
  } catch (e) {
    if (opts.signal?.aborted) out.stopped = true;
    else out.error = `${ep.name}: ${transportCause(e)}`;
  }
  return finish();

  function finish(): Streamed {
    out.toolCalls = calls
      .filter((c) => c.name)
      .map((c, i) => ({ id: c.id || `call_${i}`, name: c.name, arguments: c.arguments || "{}" }));
    if (reportedCost !== null) {
      out.costUsd = reportedCost;
      out.costSource = "reported";
    } else if (ep.price) {
      out.costUsd = (out.promptTokens * ep.price.inputPerM + out.completionTokens * ep.price.outputPerM) / 1_000_000;
      out.costSource = "price-table";
    }
    return out;
  }
}

type StreamChunk = {
  choices?: {
    delta?: { content?: unknown; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
};

/** The transport's own words: an errno code when there is one, else the message. */
export function transportCause(e: unknown): string {
  if (e instanceof Error) {
    const cause = e.cause as { code?: string; message?: string } | undefined;
    if (cause?.code) return `${cause.code}${cause.message ? ` (${cause.message})` : ""}`;
    if (e.name === "TimeoutError") return "timed out";
    return e.message;
  }
  return String(e);
}
