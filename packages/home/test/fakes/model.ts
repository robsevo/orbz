// A scripted, streaming OpenAI-compatible model for the agent loop's tests (Ash's
// context-survival harness, in TypeScript). Each agent request takes the next scripted turn; a
// summariser request ("Summarise …", not streamed) gets SUMMARY-OF-MIDDLE. Every request is kept.
import { createServer } from "node:http";
import type { TestContext } from "node:test";

export type Turn = {
  /** Streamed in these chunks (default: one chunk "ok"). */
  chunks?: string[];
  calls?: { name: string; args: Record<string, unknown>; id?: string }[];
  /** Wait this long between chunks. */
  gapMs?: number;
  /** After the chunks, keep the stream open until the client goes away. */
  hang?: boolean;
  /** After the chunks, finish only once this settles: a test sees the words while they stream,
   * however slow the machine, instead of racing a window a few hundred milliseconds wide. */
  hold?: Promise<unknown>;
  /** After the chunks, cut the connection. */
  drop?: boolean;
  status?: number;
  /** A refusal's body (Gemini's RESOURCE_EXHAUSTED, say) and its Retry-After, in seconds. */
  body?: unknown;
  retryAfter?: number;
};

export type FakeModel = {
  url: string;
  agent: Record<string, unknown>[][];
  summaries: number;
  script: Turn[];
  /** What GET /models lists (Gemini's OpenAI root lists "models/…" ids), and the keys it was asked with. */
  models: string[];
  keys: string[];
  /** GET /models refuses with this status (a bad key). */
  modelsStatus?: number;
  /** The requests not streamed (a summary; a lesson's plan or its judge, asked by the kit through
   * the home), and the words each is answered with, in turn (SUMMARY-OF-MIDDLE once none are left). */
  said: Record<string, unknown>[][];
  replies: string[];
};

export async function fakeModel(t: TestContext, script: Turn[] = []): Promise<FakeModel> {
  const fm: FakeModel = { url: "", agent: [], summaries: 0, script, models: [], keys: [], said: [], replies: [] };
  const sse = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`;
  let ids = 0;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += String(d)));
    req.on("end", async () => {
      fm.keys.push(String(req.headers.authorization ?? ""));
      if (req.method === "GET" && req.url?.endsWith("/models")) {
        res.writeHead(fm.modelsStatus ?? 200, { "content-type": "application/json" });
        res.end(JSON.stringify(fm.modelsStatus ? { error: { message: "API key not valid" } } : { object: "list", data: fm.models.map((id) => ({ id, object: "model" })) }));
        return;
      }
      const body = JSON.parse(raw || "{}") as { messages?: { content?: unknown }[]; stream?: boolean };
      const msgs = body.messages ?? [];
      if (!body.stream) {
        if (msgs.length === 1 && /^Summarise/.test(String(msgs[0]?.content ?? ""))) fm.summaries++;
        fm.said.push(msgs as Record<string, unknown>[]);
        const content = fm.replies.shift() ?? "SUMMARY-OF-MIDDLE";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 5 } }));
        return;
      }
      fm.agent.push(msgs as Record<string, unknown>[]);
      const turn = fm.script.shift() ?? {};
      if (turn.status && turn.status >= 400) {
        res.writeHead(turn.status, { "content-type": "application/json", ...(turn.retryAfter && { "retry-after": String(turn.retryAfter) }) });
        res.end(JSON.stringify(turn.body ?? { error: { message: "scripted failure" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const c of turn.chunks ?? (turn.calls ? [] : ["ok"])) {
        res.write(sse({ choices: [{ delta: { content: c } }] }));
        if (turn.gapMs) await new Promise((r) => setTimeout(r, turn.gapMs));
      }
      if (turn.drop) {
        await new Promise((r) => setTimeout(r, 50)); // let what was written reach the client first
        res.socket?.destroy();
        return;
      }
      if (turn.hold) await turn.hold;
      if (turn.hang) {
        await new Promise((r) => req.socket.once("close", r));
        return;
      }
      (turn.calls ?? []).forEach((c, index) => {
        res.write(sse({ choices: [{ delta: { tool_calls: [{ index, id: c.id ?? `call_${++ids}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } }] } }] }));
      });
      res.write(sse({ choices: [{ delta: {}, finish_reason: turn.calls?.length ? "tool_calls" : "stop" }] }));
      res.write(sse({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 10 } }));
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  fm.url = `http://127.0.0.1:${addr.port}/v1`;
  t.after(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));
  return fm;
}

/** All text of one request, for marker checks. */
export const text = (msgs: Record<string, unknown>[]): string =>
  msgs.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
