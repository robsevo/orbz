// Ash's kit, supervised (PLAN 1.3). The kit is a Python process (kit/orbs_kit/server.py) that the
// home starts, talks MCP to over stdio, and keeps alive. The supervision is Ash's `supervise.js`
// (orb/shell): restart with backoff 1 → 2 → 4 → 8 → 15 s, and on the sixth death inside a minute
// stop restarting and say so loudly — a supervisor that spins forever hides the crash it is
// restarting. Every exit is named (a code, or the signal that killed it), and a call that was in
// flight when the kit died fails with that reason: never silently, never retried behind the
// caller's back.
//
// The kit gets the home's environment minus anything that points at Ash (ASH_*): an Orbs home
// started from an Ash session must not hand the kit Ash's live state. Its state and brain are
// named explicitly (ORBS_KIT_STATE, ORBS_BRAIN).
import { type ChildProcess, spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CreateMessageRequestSchema, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Clock } from "./clock.ts";
import type { EventLog } from "./events.ts";

/** Restarts already made inside a minute before the next death gives up (the 6th death). */
export const CRASH_LOOP_RESTARTS = 5;
const WINDOW_MS = 60_000;
const STDERR_TAIL = 20;

export const KIT_DIR = resolve(fileURLToPath(new URL("../../../kit", import.meta.url)));

/** A call that was in flight when the kit died. */
export class KitDiedError extends Error {
  constructor(tool: string, why: string) {
    super(`the kit died during "${tool}": ${why}`);
    this.name = "KitDiedError";
  }
}

/** A call made while the kit is not running (it gave up, or the home is closing). */
export class KitDownError extends Error {
  constructor(why: string) {
    super(`the kit is not running: ${why}`);
    this.name = "KitDownError";
  }
}

export type KitOptions = {
  events: EventLog;
  clock: Clock;
  dataDir: string;
  /** What to run. Default: the kit's own Python (found, and installed if missing, by `uv`)
   * with `-m orbs_kit.server`. */
  command?: string;
  args?: string[];
  cwd?: string;
  /** Extra environment for the kit (after ASH_* is removed). */
  env?: Record<string, string>;
  /** How long a call may take (default 60 s). */
  callTimeoutMs?: number;
  /** Node's spawn; handed in so a test can deliver both endings of one process (supervise.js). */
  spawn?: typeof spawn;
  /** A model call one of the kit's tools asks of the home while it runs (MCP sampling: a lesson's
   * plan and its judge, PLAN 4.4), answered by the home's brain order; without it such a request
   * is refused. */
  sample?: (r: { system: string | null; messages: { role: "user" | "assistant"; content: string }[]; maxTokens: number }) => Promise<{ model: string; text: string }>;
};

type Generation = {
  n: number;
  child: ChildProcess;
  client: Client;
  ready: Promise<void>;
  died: string | null;
  onDeath: Promise<string>;
  stderr: string[];
};

export class Kit {
  readonly #o: Required<Omit<KitOptions, "env" | "command" | "sample">> & { env: Record<string, string>; command: string | null; sample?: KitOptions["sample"] };
  #gen: Generation | null = null;
  #restarts: number[] = [];
  /** `starting` until the MCP handshake is answered; `up` only after it. */
  #state: "stopped" | "starting" | "up" | "restarting" | "gave-up" | "closed" = "stopped";
  #waiting: { resolve: (g: Generation) => void; reject: (e: Error) => void }[] = [];
  #cancelRestart: (() => void) | null = null;
  #starting: Promise<void> | null = null;
  #n = 0;

  constructor(opts: KitOptions) {
    this.#o = {
      command: null,
      args: ["-m", "orbs_kit.server"],
      cwd: KIT_DIR,
      env: {},
      callTimeoutMs: 60_000,
      spawn,
      ...opts,
    };
  }

  get state(): string {
    return this.#state;
  }

  get pid(): number | undefined {
    return this.#gen?.died === null ? this.#gen.child.pid : undefined;
  }

  /** Starts the kit and waits until it has answered the MCP handshake. The first start lets
   * `uv` install the kit's Python and its locked packages if they are missing. */
  start(): Promise<void> {
    // Two callers starting at once (the home, and something that needs the kit now) share one
    // start: a second spawn would replace the first kit in the middle of its handshake.
    this.#starting ??= this.#start().finally(() => (this.#starting = null));
    return this.#starting;
  }

  async #start(): Promise<void> {
    if (this.#state === "closed") throw new KitDownError("the home is closing");
    if (this.#gen && this.#gen.died === null) return this.#gen.ready;
    this.#state = "starting";
    this.#o.command ??= await kitPython();
    // The home may have closed while uv was preparing; a kit spawned now would outlive it.
    if ((this.#state as string) === "closed") throw new KitDownError("the home closed while the kit was starting");
    this.#restarts = [];
    const g = this.#spawn();
    await g.ready;
  }

  /** Calls one of the kit's tools and returns its structured result (or its text). A tool that asks
   * the home's brain while it runs (a lesson) can be given longer than the usual deadline. */
  async call(tool: string, args: Record<string, unknown> = {}, o: { timeoutMs?: number } = {}): Promise<unknown> {
    const g = await this.#live();
    let res: Awaited<ReturnType<Client["callTool"]>>;
    try {
      res = await Promise.race([
        g.client.callTool({ name: tool, arguments: args }, undefined, { timeout: o.timeoutMs ?? this.#o.callTimeoutMs }),
        g.onDeath.then((why): never => {
          throw new KitDiedError(tool, why);
        }),
      ]);
    } catch (e) {
      const err = g.died !== null && !(e instanceof KitDiedError) ? new KitDiedError(tool, g.died) : e;
      this.#o.events.append("kit.call_failed", { tool, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    if (res.isError) {
      const text = textOf(res.content);
      this.#o.events.append("kit.call_failed", { tool, error: text.slice(0, 300) });
      throw new Error(`kit tool "${tool}" failed: ${text}`);
    }
    return res.structuredContent !== undefined ? unwrap(res.structuredContent) : textOf(res.content);
  }

  async close(): Promise<void> {
    if (this.#state === "closed") return;
    this.#state = "closed";
    this.#cancelRestart?.();
    for (const w of this.#waiting.splice(0)) w.reject(new KitDownError("the home is closing"));
    const g = this.#gen;
    if (g && g.died === null) {
      const gone = g.onDeath;
      g.child.stdin?.end();
      g.child.kill("SIGTERM");
      const t = setTimeout(() => g.child.kill("SIGKILL"), 3000);
      await gone;
      clearTimeout(t);
    }
  }

  /** The running kit, waiting through a restart; a kit that gave up fails at once. */
  #live(): Promise<Generation> {
    const g = this.#gen;
    if (this.#state === "closed") return Promise.reject(new KitDownError("the home is closing"));
    if (this.#state === "gave-up") return Promise.reject(new KitDownError(`it gave up: ${g?.died ?? "unknown"}`));
    if (this.#state === "stopped") return Promise.reject(new KitDownError("it was never started"));
    if (g && g.died === null) return g.ready.then(() => g);
    return new Promise((res, rej) => this.#waiting.push({ resolve: res, reject: rej }));
  }

  #spawn(): Generation {
    const n = ++this.#n;
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("ASH_")) env[k] = v;
    Object.assign(env, {
      ORBS_KIT_STATE: join(this.#o.dataDir, "kit"),
      ORBS_BRAIN: join(this.#o.dataDir, "brain"),
      ORBS_TZ: Intl.DateTimeFormat().resolvedOptions().timeZone,
      PYTHONUNBUFFERED: "1",
      ...this.#o.env,
    });

    let markDead!: (why: string) => void;
    const onDeath = new Promise<string>((r) => (markDead = r));
    const child = this.#o.spawn(this.#o.command!, this.#o.args, { cwd: this.#o.cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const transport = new ChildTransport(child);
    const client = new Client({ name: "orbs-home", version: "0.0.0" }, { capabilities: { sampling: {} } });
    // a tool's model call (PLAN 4.4): the home's brain answers it, or it is refused plainly
    client.setRequestHandler(CreateMessageRequestSchema, async (req) => {
      if (!this.#o.sample) throw new Error("the home answers no model calls for the kit here");
      const words = (c: unknown): string =>
        (Array.isArray(c) ? c : [c]).map((b) => (b && typeof b === "object" && (b as { type?: unknown }).type === "text" ? String((b as { text?: unknown }).text ?? "") : "")).join("");
      const p = req.params;
      const r = await this.#o.sample({ system: p.systemPrompt ?? null, messages: p.messages.map((m) => ({ role: m.role, content: words(m.content) })), maxTokens: p.maxTokens });
      return { role: "assistant" as const, content: { type: "text" as const, text: r.text }, model: r.model };
    });
    const g: Generation = { n, child, client, ready: Promise.resolve(), died: null, onDeath, stderr: [] };
    this.#gen = g;

    let partial = "";
    child.stderr?.on("data", (b: Buffer) => {
      const lines = (partial + b.toString()).split("\n");
      partial = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) g.stderr.push(l);
      g.stderr.splice(0, Math.max(0, g.stderr.length - STDERR_TAIL));
    });

    // One ending, reached two ways (supervise.js's lesson): `exit` when it ran and stopped,
    // `error` when it never ran (a missing interpreter arrives asynchronously). Counted once.
    const ended = (why: string): void => {
      if (g.died !== null) return;
      if (partial.trim()) g.stderr.push(partial);
      g.died = why;
      markDead(why);
      transport.onclose?.();
      this.#died(g, why);
    };
    child.once("exit", (code, signal) => ended(signal ? `killed by ${signal}` : `exited ${code}`));
    child.once("error", (e: NodeJS.ErrnoException) => ended(`could not start: ${e.code ?? ""} ${e.message}`.trim()));

    g.ready = (async () => {
      try {
        await Promise.race([
          client.connect(transport, { timeout: this.#o.callTimeoutMs }),
          onDeath.then((why): never => {
            throw new KitDiedError("start", why);
          }),
        ]);
      } catch (e) {
        if (g.died === null) child.kill("SIGKILL");
        throw e instanceof KitDiedError ? e : new KitDiedError("start", g.died ?? String(e));
      }
      if (this.#gen === g && this.#state === "starting") this.#state = "up";
      this.#o.events.append("kit.started", { pid: child.pid, generation: n });
      for (const w of this.#waiting.splice(0)) w.resolve(g);
    })();
    g.ready.catch(() => {}); // a failed start is reported through #died; callers see it via #live
    return g;
  }

  #died(g: Generation, why: string): void {
    const tail = g.stderr.slice(-5);
    this.#o.events.append("kit.died", { why, pid: g.child.pid, generation: g.n, stderr: tail });
    if (this.#state === "closed" || this.#gen !== g) return;
    const now = this.#o.clock.now();
    this.#restarts = this.#restarts.filter((t) => now - t < WINDOW_MS);
    if (this.#restarts.length >= CRASH_LOOP_RESTARTS) {
      this.#state = "gave-up";
      const text =
        `The kit died ${this.#restarts.length + 1} times in a minute after ${this.#restarts.length} restarts; ` +
        `not restarting. Last: ${why}`;
      this.#o.events.append("kit.gave_up", { why, deaths: this.#restarts.length + 1, stderr: tail });
      this.#o.events.append("notify", { level: "alarm", text });
      for (const w of this.#waiting.splice(0)) w.reject(new KitDownError(`it gave up: ${why}`));
      return;
    }
    this.#restarts.push(now);
    const wait = Math.min(15_000, 1000 * 2 ** (this.#restarts.length - 1));
    this.#state = "restarting";
    this.#o.events.append("kit.restarting", { in_ms: wait, restarts: this.#restarts.length });
    this.#cancelRestart = this.#o.clock.timer(wait, () => {
      this.#cancelRestart = null;
      if (this.#state !== "restarting") return;
      this.#state = "starting";
      this.#spawn();
    });
  }
}

/** The kit's interpreter. `uv run` syncs the environment from kit/uv.lock first (downloading
 * Python itself if this machine has none), then names the interpreter; the home supervises that
 * interpreter directly, so the pid it watches is the kit's own and not a launcher's. */
export async function kitPython(uv = process.env.ORBS_UV ?? "uv"): Promise<string> {
  const args = ["run", "--project", KIT_DIR, "--locked", "--quiet", "python", "-c", "import sys; print(sys.executable)"];
  const out = await new Promise<string>((ok, fail) => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("ASH_")) env[k] = v;
    const c = spawn(uv, args, { cwd: KIT_DIR, env, stdio: ["ignore", "pipe", "pipe"] });
    let so = "";
    let se = "";
    c.stdout.on("data", (b: Buffer) => (so += b.toString()));
    c.stderr.on("data", (b: Buffer) => (se += b.toString()));
    c.once("error", (e) => fail(new KitDownError(`uv could not run (${e.message}); the kit needs uv`)));
    c.once("exit", (code) => (code === 0 ? ok(so) : fail(new KitDownError(`uv could not prepare the kit: ${se.trim().slice(-400)}`))));
  });
  const py = out.trim().split("\n").at(-1) ?? "";
  if (!py) throw new KitDownError("uv named no interpreter for the kit");
  return py;
}

/** MCP over a child process's stdin/stdout, with the exit left to the supervisor. */
class ChildTransport implements Transport {
  readonly #child: ChildProcess;
  readonly #buf = new ReadBuffer();
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T) => void;

  constructor(child: ChildProcess) {
    this.#child = child;
  }

  async start(): Promise<void> {
    this.#child.stdout?.on("data", (chunk: Buffer) => {
      this.#buf.append(chunk);
      for (;;) {
        let msg: JSONRPCMessage | null;
        try {
          msg = this.#buf.readMessage();
        } catch (e) {
          this.onerror?.(e instanceof Error ? e : new Error(String(e)));
          continue;
        }
        if (!msg) break;
        this.onmessage?.(msg);
      }
    });
    this.#child.stdin?.on("error", (e) => this.onerror?.(e));
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const stdin = this.#child.stdin;
    if (!stdin || stdin.destroyed) throw new Error("the kit's stdin is closed");
    await new Promise<void>((ok, fail) => stdin.write(serializeMessage(message), (e) => (e ? fail(e) : ok())));
  }

  async close(): Promise<void> {
    this.#child.stdin?.end();
  }
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((c: unknown) => (c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : ""))
    .join("\n");
}

/** The SDK wraps a non-object return as `{ result: … }`. */
function unwrap(s: unknown): unknown {
  if (s && typeof s === "object" && !Array.isArray(s)) {
    const keys = Object.keys(s);
    if (keys.length === 1 && keys[0] === "result") return (s as { result: unknown }).result;
  }
  return s;
}
