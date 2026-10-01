// One call to an OpenAI-compatible chat endpoint (PLAN 1.4): the own brain (llama-server, Ollama,
// a cheap seat) and the big brain (one key) speak the same protocol. Stateless on purpose: the
// home keeps the conversation and sends a trimmed history (ladder.ts), so any provider works and
// none holds the person's history.
//
// Cost is taken from what the provider reports — Ash's router (litellm) in the
// `x-litellm-response-cost` header, OpenRouter in `usage.cost` — and only when it reports nothing
// is it estimated from the endpoint's price table, marked as an estimate. A call whose cost
// cannot be known at all says so (`unknown`), so the spend cap is never silently blind.

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type Endpoint = {
  /** What the logs call it: "big", "own", "teacher", or a seat name. */
  name: string;
  /** The API root, ending in /v1. */
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Extra request fields (Ash's router: `disable_fallbacks`; OpenRouter: `usage`). */
  extra?: Record<string, unknown>;
  /** Dollars per million tokens, used only when the provider reports no cost. */
  price?: { inputPerM: number; outputPerM: number };
  timeoutMs?: number;
  /** Retries on a busy or failing server (default 2: after 1 s, then 2 s). */
  retries?: number;
};

export type CostSource = "reported" | "price-table" | "unknown";

export type Completion = {
  text: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number | null;
  costSource: CostSource;
  /** The model the provider says answered (a router may name the deployment). */
  served: string;
  finish: string | null;
};

export class BrainCallError extends Error {
  readonly status: number | null;
  constructor(endpoint: string, message: string, status: number | null = null) {
    super(`${endpoint}: ${message}`);
    this.name = "BrainCallError";
    this.status = status;
  }
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/** One chat completion, retried briefly on a busy or failing server (twice, 1 s then 2 s). */
export async function chat(
  ep: Endpoint,
  messages: ChatMessage[],
  opts: { maxTokens?: number; signal?: AbortSignal; retries?: number } = {},
): Promise<Completion> {
  const body = JSON.stringify({ model: ep.model, messages, max_tokens: opts.maxTokens ?? 4000, ...ep.extra });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ep.apiKey) headers.authorization = `Bearer ${ep.apiKey}`;
  const retries = opts.retries ?? ep.retries ?? 2;
  let last = "";
  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(ep.timeoutMs ?? 120_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await fetch(`${ep.baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers, body, signal });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      last = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
      if (attempt >= retries) throw new BrainCallError(ep.name, `unreachable: ${last}`);
      await wait(1000 * 2 ** attempt, opts.signal);
      continue;
    }
    if (!res.ok) {
      last = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
      if (!RETRYABLE.has(res.status) || attempt >= retries) throw new BrainCallError(ep.name, last, res.status);
      await wait(1000 * 2 ** attempt, opts.signal);
      continue;
    }
    let json: ChatResponse;
    try {
      json = (await res.json()) as ChatResponse;
    } catch {
      throw new BrainCallError(ep.name, "the reply is not JSON");
    }
    const choice = json.choices?.[0];
    if (!choice) throw new BrainCallError(ep.name, "the reply has no choices");
    const promptTokens = Number(json.usage?.prompt_tokens ?? 0);
    const completionTokens = Number(json.usage?.completion_tokens ?? 0);
    const { costUsd, costSource } = costOf(ep, res.headers, json, promptTokens, completionTokens);
    return {
      text: typeof choice.message?.content === "string" ? choice.message.content : "",
      promptTokens,
      completionTokens,
      costUsd,
      costSource,
      served: String(json.model ?? ep.model),
      finish: choice.finish_reason ?? null,
    };
  }
}

type ChatResponse = {
  model?: string;
  choices?: { message?: { content?: unknown }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
};

function costOf(
  ep: Endpoint,
  headers: Headers,
  json: ChatResponse,
  promptTokens: number,
  completionTokens: number,
): { costUsd: number | null; costSource: CostSource } {
  const header = headers.get("x-litellm-response-cost");
  if (header !== null && header.trim() !== "" && Number.isFinite(Number(header))) {
    return { costUsd: Number(header), costSource: "reported" };
  }
  if (typeof json.usage?.cost === "number" && Number.isFinite(json.usage.cost)) {
    return { costUsd: json.usage.cost, costSource: "reported" };
  }
  if (ep.price) {
    const usd = (promptTokens * ep.price.inputPerM + completionTokens * ep.price.outputPerM) / 1_000_000;
    return { costUsd: usd, costSource: "price-table" };
  }
  return { costUsd: null, costSource: "unknown" };
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((ok, fail) => {
    const t = setTimeout(ok, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        fail(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
      },
      { once: true },
    );
  });
}
