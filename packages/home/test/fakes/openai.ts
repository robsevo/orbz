// A fake OpenAI-compatible server for the ladder's tests: each request takes the next scripted
// reply (or the last one, repeated), and every request is kept so a test can count them.
import { createServer, type IncomingMessage } from "node:http";
import type { TestContext } from "node:test";

export type Scripted = {
  status?: number;
  text?: string;
  /** Sent as Ash's router does, in a header. */
  litellmCost?: number;
  /** Sent as OpenRouter does, in usage.cost. */
  usageCost?: number;
  promptTokens?: number;
  completionTokens?: number;
  finish?: string;
  delayMs?: number;
  /** A raw body instead of a chat completion. */
  raw?: string;
};

export type FakeBrain = { baseUrl: string; requests: { body: Record<string, unknown>; auth: string | undefined }[]; script: Scripted[] };

export async function fakeBrain(t: TestContext, script: Scripted[]): Promise<FakeBrain> {
  const fb: FakeBrain = { baseUrl: "", requests: [], script };
  const server = createServer(async (req: IncomingMessage, res) => {
    let raw = "";
    for await (const c of req) raw += String(c);
    const body = JSON.parse(raw || "{}") as Record<string, unknown>;
    fb.requests.push({ body, auth: req.headers.authorization });
    const s = fb.script[Math.min(fb.requests.length - 1, fb.script.length - 1)] ?? {};
    if (s.delayMs) await new Promise((r) => setTimeout(r, s.delayMs));
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (s.litellmCost !== undefined) headers["x-litellm-response-cost"] = String(s.litellmCost);
    res.writeHead(s.status ?? 200, headers);
    if (s.raw !== undefined) {
      res.end(s.raw);
      return;
    }
    if ((s.status ?? 200) >= 400) {
      res.end(JSON.stringify({ error: { message: s.text ?? "scripted failure" } }));
      return;
    }
    res.end(
      JSON.stringify({
        model: String(body.model),
        choices: [{ message: { role: "assistant", content: s.text ?? "ok" }, finish_reason: s.finish ?? "stop" }],
        usage: {
          prompt_tokens: s.promptTokens ?? 100,
          completion_tokens: s.completionTokens ?? 20,
          ...(s.usageCost !== undefined && { cost: s.usageCost }),
        },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  fb.baseUrl = `http://127.0.0.1:${addr.port}/v1`;
  t.after(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));
  return fb;
}

/** A port nothing listens on (bound, then released). */
export async function deadUrl(): Promise<string> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const addr = s.address();
  await new Promise<void>((r) => s.close(() => r()));
  if (!addr || typeof addr === "string") throw new Error("no port");
  return `http://127.0.0.1:${addr.port}/v1`;
}
