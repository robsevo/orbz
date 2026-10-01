// The terminal's side of the home's door (packages/home/src/api.ts): the port and token from
// `<data>/home.json`, plain fetches, and the live stream (server-sent events) that carries every
// event as it is committed and a reply's text as it streams.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type HomeEvent = { seq: number; at: number; type: string; orb: string | null; conversation: string | null; data: Record<string, unknown> };
export type TextDelta = { orb: string; conversation: string; run: number; delta: string };
export type Message = {
  id: number;
  conversation: string;
  orb: string;
  run: number | null;
  role: "user" | "assistant" | "tool" | "notice" | "summary" | "clear";
  content: string;
  toolCalls: { id: string; name: string; arguments: string }[] | null;
  toolCallId: string | null;
  meta: Record<string, unknown>;
  at: number;
};
export type Card = {
  id: number;
  orb: string;
  conversation: string;
  kind: "approval" | "question" | "connect" | "plan";
  tool: string;
  title: string;
  detail: string;
  status: string;
  meta: Record<string, unknown>;
};
export type Orb = { id: string; name: string; status: string; activity: string | null; queued: number };
export type Status = { version: string; pid: number; dataDir: string; seq: number; kit: { state: string } | null; orbs: Orb[] };

export class NoHomeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoHomeError";
  }
}

export class HomeClient {
  readonly base: string;
  readonly #auth: string;

  constructor(port: number, token: string) {
    this.base = `http://127.0.0.1:${port}`;
    this.#auth = `Bearer ${token}`;
  }

  /** The home running on this data directory, from the door file it wrote. */
  static find(dataDir: string): HomeClient {
    let door: { port?: unknown; token?: unknown };
    try {
      door = JSON.parse(readFileSync(join(dataDir, "home.json"), "utf8")) as typeof door;
    } catch {
      throw new NoHomeError(`no home is running on ${dataDir} (no home.json): start one with \`pnpm start --data ${dataDir}\``);
    }
    if (typeof door.port !== "number" || typeof door.token !== "string") throw new NoHomeError(`${join(dataDir, "home.json")} is not a home's door file`);
    return new HomeClient(door.port, door.token);
  }

  async get<T>(path: string): Promise<T> {
    return this.#call<T>("GET", path);
  }

  async post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.#call<T>("POST", path, body);
  }

  async #call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: { authorization: this.#auth, ...(body !== undefined && { "content-type": "application/json" }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      const why = (e as { cause?: { code?: string } }).cause?.code ?? (e as Error).message;
      throw new NoHomeError(`the home at ${this.base} is not answering (${why})`);
    }
    const out = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(out.error ?? `${method} ${path}: HTTP ${res.status}`);
    return out;
  }

  /** Every event after `since`, then each one as it happens, and reply text as it streams.
   * Resolves when the stream ends (the home went away, or `signal` fired). */
  async stream(since: number, on: { event(e: HomeEvent): void; text(t: TextDelta): void }, signal: AbortSignal): Promise<void> {
    const res = await fetch(`${this.base}/stream?since=${since}`, { headers: { authorization: this.#auth }, signal });
    if (!res.ok || !res.body) throw new Error(`the home refused the stream: HTTP ${res.status}`);
    const decoder = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buf += decoder.decode(chunk, { stream: true });
        let cut: number;
        while ((cut = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          let kind = "message";
          let data = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) kind = line.slice(7);
            else if (line.startsWith("data: ")) data += line.slice(6);
          }
          if (!data) continue; // a keep-alive comment
          const v: unknown = JSON.parse(data);
          if (kind === "event") on.event(v as HomeEvent);
          else if (kind === "text") on.text(v as TextDelta);
        }
      }
    } catch (e) {
      if (!signal.aborted) throw e;
    }
  }
}
