// A streamed chat completion with tools (PLAN 1.5). Streaming is what lets a stopped turn keep
// what the model had already written (Ash's stop-turn lesson: a stop that throws the partial
// reply away loses work the person watched arrive), and what lets an error say how far it got.
//
// The result always carries the partial text. A stop comes back as `stopped: true`; a transport
// failure as `error` with the cause's code (ECONNRESET, ECONNREFUSED…) when there is one.
import type { ModelMessage, ToolCall } from "./conversation.ts";
import type { CostSource, Endpoint, Limited } from "../brain/openai.ts";
import { streamResponses } from "./responses.ts";

export type ToolSpec = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type Streamed = {
  text: string;
  toolCalls: ToolCall[];
  finish: string | null;
  promptTokens: number;
  completionTokens: number;
  /** Of the prompt, how much the provider read from its cache (0 when it does not say). */
  cachedTokens: number;
  /** What a reasoning model thought, apart from its reply (`reasoning_content` or `reasoning`): kept
   * for the one case it matters, a reply written there and nowhere else (loop.ts). */
  reasoning: string;
  costUsd: number | null;
  costSource: CostSource;
  /** The person stopped it; `text` is what had arrived by then. */
  stopped: boolean;
  /** The request failed; `text` is what had arrived by then. */
  error: string | null;
  /** The server's error code, when it sent one. */
  errorCode: string | null;
  /** A plan brain that cannot serve now, and why: the loop asks the next brain (PLAN 1.10). */
  limited: Limited | null;
  /** The HTTP status of a refused request (null: it never got an answer), and how long the
   * server asked us to wait (Retry-After, seconds): how long the brain rests (PLAN 1.11). */
  status: number | null;
  retryAfterS: number | null;
};

export const emptyStreamed = (): Streamed => ({
  text: "", toolCalls: [], finish: null, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoning: "", costUsd: null, costSource: "unknown",
  stopped: false, error: null, errorCode: null, limited: null, status: null, retryAfterS: null,
});

export async function streamChat(
  ep: Endpoint,
  body: { messages: ModelMessage[]; tools?: ToolSpec[]; maxTokens?: number; brief?: boolean },
  opts: { signal?: AbortSignal; onText?: (delta: string) => void } = {},
): Promise<Streamed> {
  if (ep.api === "responses") return streamResponses(ep, body, opts);
  const out = emptyStreamed();
  const calls: { id: string; name: string; arguments: string; sig?: string }[] = [];
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
        messages: wireMessages(body.messages, isGemini(ep)),
        ...(body.tools?.length && { tools: body.tools }),
        max_tokens: body.maxTokens ?? 8000,
        stream: true,
        stream_options: { include_usage: true },
        ...ep.extra,
      }),
    });
    if (!res.ok || !res.body) {
      out.error = `${ep.name}: HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      out.status = res.status;
      const wait = Number(res.headers.get("retry-after"));
      if (Number.isFinite(wait) && wait > 0) out.retryAfterS = wait;
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
          out.cachedTokens = Number(j.usage.prompt_tokens_details?.cached_tokens ?? out.cachedTokens);
          if (typeof j.usage.cost === "number") reportedCost = j.usage.cost;
        }
        const choice = j.choices?.[0];
        if (!choice) continue;
        const d = choice.delta ?? {};
        if (typeof d.content === "string" && d.content) {
          out.text += d.content;
          opts.onText?.(d.content);
        }
        const thought = d.reasoning_content ?? d.reasoning;
        if (typeof thought === "string") out.reasoning += thought;
        for (const tc of d.tool_calls ?? []) {
          const i = tc.index ?? 0;
          const c = (calls[i] ??= { id: "", name: "", arguments: "" });
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.name += tc.function.name;
          if (tc.function?.arguments) c.arguments += tc.function.arguments;
          const sig = tc.extra_content?.google?.thought_signature;
          if (typeof sig === "string" && sig) c.sig = sig;
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
      .map((c, i) => ({ id: c.id || `call_${i}`, name: c.name, arguments: c.arguments || "{}", ...(c.sig && { sig: c.sig }) }));
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
    delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string }; extra_content?: { google?: { thought_signature?: unknown } } }[] };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number; prompt_tokens_details?: { cached_tokens?: number } };
};

/** Gemini's OpenAI-compatible root (PLAN 1.11). */
export const isGemini = (ep: Endpoint): boolean => ep.name === "gemini" || ep.baseUrl.includes("generativelanguage.googleapis.com");

/** Google's documented stand-in for a call Gemini did not make itself (one ChatGPT made before the
 * turn passed over): it skips the check rather than failing the request. */
export const FOREIGN_SIGNATURE = "skip_thought_signature_validator";

/** The messages as they go on the wire. Gemini 3 refuses a tool call sent back without the thought
 * signature it came with (10-06: "Function call is missing a thought_signature", so every turn of
 * Gemini's with a tool failed on its second step): its own goes back as it came, any other call
 * carries Google's stand-in. Every other brain gets the calls without it. */
export function wireMessages(messages: ModelMessage[], gemini: boolean): unknown[] {
  return messages.map((m) => {
    if (m.role !== "assistant" || !m.tool_calls?.length) return m;
    return {
      ...m,
      tool_calls: m.tool_calls.map(({ sig, ...c }) => (gemini ? { ...c, extra_content: { google: { thought_signature: sig ?? FOREIGN_SIGNATURE } } } : c)),
    };
  });
}

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
