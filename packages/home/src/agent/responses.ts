// A streamed reply from OpenAI's Responses API (PLAN 1.10): the only way the ChatGPT plan answers
// (developers.openai.com/siwc/token-sharing-open-source/models-and-inference). `store: false` and
// `stream: true`, as the guide requires; the conversation stays in the home. A reply counts only
// once `response.completed` arrives: a stream that ends without it is an error, with what had
// arrived kept, like any cut-off reply.
//
// The plan's own refusals come back as `limited` so the loop can pass the turn to the next brain:
// the usage limit (429, or `response.failed`, `subscription_sharing_usage_limit_exceeded`), an
// account or policy that does not allow plan use (403), and a sign-in that has lapsed (401).
import type { Endpoint, Limited } from "../brain/openai.ts";
import type { ModelMessage } from "./conversation.ts";
import { emptyStreamed, transportCause, type Streamed, type ToolSpec } from "./stream.ts";

const LIMITS: Record<string, Limited> = {
  subscription_sharing_usage_limit_exceeded: "usage-limit",
  usage_limit_reached: "usage-limit",
  subscription_sharing_user_not_eligible: "not-eligible",
  chatpass_v2_scope_not_authorized: "not-eligible",
  chatpass_v2_invalid_authorization_context: "not-eligible",
  subscription_sharing_invalid_user: "signed-out",
};

/** What a brief reply asks of the model (PLAN 5.10): a chime-in thinks a little and says little.
 * OpenAI bills reasoning as output; the plan's preview turns some fields down with
 * `subscription_sharing_unsupported_capability` (naming the field), so one it refuses is dropped and
 * the request sent again, and never asked for again while the home runs. `prompt_cache_key` (owner, 10-07) is
 * asked for the same way: one key per orb's conversation, as Codex sends its conversation's, so the plan's
 * requests for it reach the cache that holds them. */
export const BRIEF_FIELDS: Record<string, unknown> = { reasoning: { effort: "low" }, text: { verbosity: "low" } };
const refused = new Set<string>();
/** Forgets what the plan refused (a test's fresh start). */
export const forgetRefused = (): void => refused.clear();
/** What the plan has refused since the home started (`pnpm cost --probe` says so). */
export const refusedFields = (): string[] => [...refused];

/** The chat-shaped history as Responses input: the leading system text becomes the instructions, a tool
 * call and its result become a function_call and its function_call_output, and system text after the
 * conversation began (the plan restated last, plans/recite.ts) stays where it is, as the developer's. */
export function toResponsesInput(messages: ModelMessage[]): { instructions: string; input: Record<string, unknown>[] } {
  const instructions: string[] = [];
  const input: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "system" && input.length) input.push({ type: "message", role: "developer", content: m.content });
    else if (m.role === "system") instructions.push(m.content);
    else if (m.role === "user") input.push({ type: "message", role: "user", content: m.content });
    else if (m.role === "assistant") {
      if (m.content) input.push({ type: "message", role: "assistant", content: m.content });
      for (const c of m.tool_calls ?? []) input.push({ type: "function_call", call_id: c.id, name: c.function.name, arguments: c.function.arguments });
    } else if (m.role === "tool") input.push({ type: "function_call_output", call_id: m.tool_call_id, output: m.content });
  }
  return { instructions: instructions.join("\n\n"), input };
}

export async function streamResponses(
  ep: Endpoint,
  body: { messages: ModelMessage[]; tools?: ToolSpec[]; brief?: boolean; cacheKey?: string },
  opts: { signal?: AbortSignal; onText?: (delta: string) => void } = {},
): Promise<Streamed> {
  const wanted: Record<string, unknown> = { ...(body.brief && BRIEF_FIELDS), ...(body.cacheKey && { prompt_cache_key: body.cacheKey }) };
  const asked = Object.fromEntries(Object.entries(wanted).filter(([k]) => !refused.has(k)));
  const first = await streamOnce(ep, body, asked, opts);
  const field = first.refusedField;
  if (field && field in asked) {
    refused.add(field);
    return streamResponses(ep, body, opts);
  }
  return first;
}

async function streamOnce(
  ep: Endpoint,
  body: { messages: ModelMessage[]; tools?: ToolSpec[] },
  asked: Record<string, unknown>,
  opts: { signal?: AbortSignal; onText?: (delta: string) => void },
): Promise<Streamed & { refusedField?: string }> {
  const out = emptyStreamed();
  const calls = new Map<string, { callId: string; name: string; arguments: string }>();
  let completed = false;
  const timeout = AbortSignal.timeout(ep.timeoutMs ?? 300_000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const fail = (message: string, code: string | null, limited: Limited | null = code ? (LIMITS[code] ?? null) : null): Streamed => {
    out.error = `${ep.name}: ${message}`;
    out.errorCode = code;
    out.limited = limited;
    return done();
  };

  let bearer: string | undefined;
  try {
    bearer = ep.token ? await ep.token() : ep.apiKey;
  } catch (e) {
    return fail(`sign in again (${(e as Error).message})`, null, "signed-out");
  }
  const { instructions, input } = toResponsesInput(body.messages);
  try {
    if (opts.signal?.aborted) throw opts.signal.reason;
    const res = await fetch(`${ep.baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", ...(bearer && { authorization: `Bearer ${bearer}` }) },
      signal,
      body: JSON.stringify({
        model: ep.model,
        ...(instructions && { instructions }),
        input,
        ...(body.tools?.length && { tools: body.tools.map((t) => ({ type: "function", name: t.function.name, description: t.function.description, parameters: t.function.parameters })) }),
        store: false,
        stream: true,
        ...asked,
        ...ep.extra,
      }),
    });
    if (!res.ok || !res.body) {
      const j = (await res.json().catch(() => ({}))) as { error?: { code?: unknown; message?: unknown; param?: unknown } };
      const code = typeof j.error?.code === "string" ? j.error.code : null;
      const param = typeof j.error?.param === "string" ? j.error.param.split(".")[0]! : null;
      if (res.status === 400 && param && param in asked) return { ...fail(`HTTP 400 ${code ?? ""}: ${param} refused`, code), refusedField: param };
      const said = typeof j.error?.message === "string" ? `: ${j.error.message.slice(0, 200)}` : "";
      return fail(`HTTP ${res.status}${code ? ` ${code}` : ""}${said}`, code, code ? (LIMITS[code] ?? null) : res.status === 401 ? "signed-out" : null);
    }
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        let e: ResponseEvent;
        try {
          e = JSON.parse(line.slice(5).trim()) as ResponseEvent;
        } catch {
          continue;
        }
        if (e.type === "response.output_text.delta" && typeof e.delta === "string") {
          out.text += e.delta;
          opts.onText?.(e.delta);
        } else if ((e.type === "response.output_item.added" || e.type === "response.output_item.done") && e.item?.type === "function_call") {
          const it = e.item;
          const c = calls.get(it.id ?? it.call_id ?? "") ?? { callId: "", name: "", arguments: "" };
          if (it.call_id) c.callId = it.call_id;
          if (it.name) c.name = it.name;
          if (e.type === "response.output_item.done" && typeof it.arguments === "string") c.arguments = it.arguments; // the whole, as sent
          calls.set(it.id ?? it.call_id ?? "", c);
        } else if (e.type === "response.function_call_arguments.delta" && typeof e.delta === "string") {
          const c = calls.get(e.item_id ?? "");
          if (c) c.arguments += e.delta;
        } else if (e.type === "response.completed") {
          completed = true;
          out.promptTokens = Number(e.response?.usage?.input_tokens ?? 0);
          out.completionTokens = Number(e.response?.usage?.output_tokens ?? 0);
          out.cachedTokens = Number(e.response?.usage?.input_tokens_details?.cached_tokens ?? 0);
        } else if (e.type === "response.failed") {
          const { code, said } = errorOf(e.response?.error);
          return fail(`the reply failed${code ? ` (${code})` : ""}${said}`, code);
        } else if (e.type === "response.incomplete") {
          return fail(`the reply was cut off (${String(e.response?.incomplete_details?.reason ?? "incomplete")})`, null);
        } else if (e.type === "error") {
          // the code and words come at the top of the event, or inside an `error` of it (10-06: a
          // usage limit read only at the top came back codeless, so the plan was never paused)
          const { code, said } = errorOf({ code: e.code ?? e.error?.code, type: e.error?.type, message: e.message ?? e.error?.message });
          return fail(`the stream reported an error${code ? ` (${code})` : ""}${said}`, code);
        }
      }
    }
    if (!completed) return fail("the reply ended before it completed", null);
  } catch (e) {
    if (opts.signal?.aborted) out.stopped = true;
    else out.error = `${ep.name}: ${transportCause(e)}`;
  }
  return done();

  function done(): Streamed {
    out.toolCalls = [...calls.values()].filter((c) => c.name).map((c, i) => ({ id: c.callId || `call_${i}`, name: c.name, arguments: c.arguments || "{}" }));
    if (completed && !out.error) out.finish = out.toolCalls.length ? "tool_calls" : "stop";
    if (ep.price) {
      out.costUsd = (out.promptTokens * ep.price.inputPerM + out.completionTokens * ep.price.outputPerM) / 1_000_000;
      out.costSource = "price-table";
    }
    return out;
  }
}

/** A reported error's code (its `code`, else its `type`) and its words, cut short. */
function errorOf(err: { code?: unknown; type?: unknown; message?: unknown } | undefined): { code: string | null; said: string } {
  const code = typeof err?.code === "string" ? err.code : typeof err?.type === "string" ? err.type : null;
  return { code, said: typeof err?.message === "string" && err.message ? `: ${err.message.slice(0, 200)}` : "" };
}

type ResponseEvent = {
  type?: string;
  delta?: unknown;
  item_id?: string;
  code?: unknown;
  message?: unknown;
  error?: { code?: unknown; type?: unknown; message?: unknown };
  item?: { type?: string; id?: string; call_id?: string; name?: string; arguments?: unknown };
  response?: {
    usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
    error?: { code?: unknown; type?: unknown; message?: unknown };
    incomplete_details?: { reason?: unknown };
  };
};
