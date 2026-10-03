// Connectors (PLAN 4.2, "no middleman"): the person's own MCP servers, run by the home itself, their
// tools the orbs' tools. Ash's engine's client (`engine/src/mcp.mjs`) in its rules, on the official
// SDK for the protocol:
//   - it FAILS OPEN: a server that cannot start, cannot shake hands or is too slow is reported once
//     and left out; the home and every other server go on;
//   - every exchange has a deadline, and one that passes says which server it was;
//   - a server's tools are named `mcp__<server>__<tool>`.
// Orbs' own, on top: a connector's secrets (an API token in its environment or a header) are kept
// in the keychain (chatgpt/store.ts), never in `connectors.json`, the log or a trace; each of its
// tools asks by default, what reads as paying, messaging or deleting always asks (rules/floor.ts),
// and what comes back is untrusted (the one-way switch, rules/guard.ts).
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { EventLog } from "../events.ts";
import type { SecretStore } from "../chatgpt/store.ts";
import { version } from "../version.ts";

export const HANDSHAKE_MS = 15_000;
export const CALL_MS = 120_000;

/** A value kept in the keychain, by its name, in place of the secret itself. */
export type Secret = { secret: string };
export type Spec =
  | { command: string; args?: string[]; env?: Record<string, string | Secret> }
  | { url: string; headers?: Record<string, string | Secret> };
export type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown> };
export type ConnectorState = { name: string; state: "ready" | "failed" | "starting"; why: string | null; tools: string[]; spec: Spec };

const NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export class ConnectorError extends Error {}

const isSecret = (v: unknown): v is Secret => typeof v === "object" && v !== null && typeof (v as Secret).secret === "string";
const deadline = <T>(p: Promise<T>, ms: number, what: string): Promise<T> =>
  Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new ConnectorError(`${what} gave no answer in ${Math.round(ms / 1000)} s`)), ms).unref())]);

type Live = { client: Client; tools: McpTool[] };
export type ConnectorsOptions = { dataDir: string; events: EventLog; store: () => Promise<SecretStore>; handshakeMs?: number; callMs?: number };

export class Connectors {
  readonly #o: ConnectorsOptions;
  readonly #live = new Map<string, Live>();
  readonly #failed = new Map<string, string>();
  readonly #starting = new Set<string>();
  #closed = false;

  constructor(o: ConnectorsOptions) {
    this.#o = o;
  }

  get #file(): string {
    return join(this.#o.dataDir, "connectors.json");
  }

  /** The servers as kept: secrets by their names only. */
  specs(): Record<string, Spec> {
    if (!existsSync(this.#file)) return {};
    try {
      const v = JSON.parse(readFileSync(this.#file, "utf8")) as { servers?: Record<string, Spec> };
      return v.servers ?? {};
    } catch {
      return {}; // a broken file is no reason for the home not to start (fails open)
    }
  }

  #save(servers: Record<string, Spec>): void {
    const tmp = `${this.#file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ servers }, null, 1)}\n`, { mode: 0o600 });
    renameSync(tmp, this.#file);
  }

  /** Adds a server. `secrets` are kept in the keychain; the spec names them ({secret: "token"}). */
  async add(name: string, spec: Spec, secrets: Record<string, string> = {}): Promise<ConnectorState> {
    if (!NAME.test(name)) throw new ConnectorError("a connector's name is lowercase letters, digits, - and _ (up to 32)");
    if ("command" in spec ? !spec.command.trim() : !/^https?:\/\//.test(spec.url)) throw new ConnectorError("a connector is a command to run, or an http(s) address");
    const store = await this.#o.store();
    const used = Object.values("command" in spec ? spec.env ?? {} : spec.headers ?? {}).filter(isSecret).map((s) => s.secret);
    for (const ref of used) if (!(ref in secrets) && (await store.get(`connector:${name}:${ref}`)) === null) throw new ConnectorError(`its secret "${ref}" was not given`);
    for (const [ref, value] of Object.entries(secrets)) await store.set(`connector:${name}:${ref}`, value);
    this.#save({ ...this.specs(), [name]: spec });
    this.#o.events.append("connector.added", { name, kind: "command" in spec ? "command" : "url" }); // never the secrets
    await this.stop(name);
    await this.start(name);
    return this.states().find((s) => s.name === name)!;
  }

  async remove(name: string): Promise<void> {
    const specs = this.specs();
    const spec = specs[name];
    if (!spec) throw new ConnectorError(`no connector "${name}"`);
    await this.stop(name);
    const store = await this.#o.store();
    for (const v of Object.values("command" in spec ? spec.env ?? {} : spec.headers ?? {})) if (isSecret(v)) await store.delete(`connector:${name}:${v.secret}`);
    delete specs[name];
    this.#save(specs);
    this.#failed.delete(name);
    this.#o.events.append("connector.removed", { name });
  }

  /** Starts every server kept, each on its own: one that fails is reported and left out. */
  async startAll(): Promise<void> {
    await Promise.all(Object.keys(this.specs()).map((n) => this.start(n)));
  }

  async start(name: string): Promise<void> {
    const spec = this.specs()[name];
    if (!spec || this.#closed || this.#live.has(name) || this.#starting.has(name)) return;
    this.#starting.add(name);
    this.#failed.delete(name);
    const client = new Client({ name: "orbs", version });
    try {
      const store = await this.#o.store();
      const resolve = async (vals: Record<string, string | Secret> | undefined): Promise<Record<string, string>> => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(vals ?? {})) out[k] = isSecret(v) ? ((await store.get(`connector:${name}:${v.secret}`)) ?? "") : v;
        return out;
      };
      const transport =
        "command" in spec
          ? new StdioClientTransport({ command: spec.command, args: spec.args ?? [], env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...(await resolve(spec.env)) }, stderr: "ignore" })
          : new StreamableHTTPClientTransport(new URL(spec.url), { requestInit: { headers: await resolve(spec.headers) } });
      await deadline(client.connect(transport), this.#o.handshakeMs ?? HANDSHAKE_MS, `the ${name} connector`);
      const listed = await deadline(client.listTools(), this.#o.handshakeMs ?? HANDSHAKE_MS, `the ${name} connector`);
      if (this.#closed) return void (await client.close().catch(() => {})); // the home closed while it started
      this.#live.set(name, { client, tools: listed.tools as McpTool[] });
      this.#o.events.append("connector.ready", { name, tools: listed.tools.length });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      this.#failed.set(name, why);
      this.#o.events.append("connector.failed", { name, why: why.slice(0, 300) });
      await client.close().catch(() => {});
    } finally {
      this.#starting.delete(name);
    }
  }

  async stop(name: string): Promise<void> {
    const live = this.#live.get(name);
    this.#live.delete(name);
    await live?.client.close().catch(() => {});
  }

  states(): ConnectorState[] {
    return Object.entries(this.specs()).map(([name, spec]) => {
      const live = this.#live.get(name);
      const why = this.#failed.get(name) ?? null;
      return { name, spec, state: live ? "ready" : this.#starting.has(name) ? "starting" : "failed", why: live ? null : why ?? "not started", tools: live?.tools.map((t) => t.name) ?? [] };
    });
  }

  /** Every tool of every server that is up now. */
  tools(): { server: string; tool: McpTool }[] {
    return [...this.#live].flatMap(([server, l]) => l.tools.map((tool) => ({ server, tool })));
  }

  /** Calls a server's tool, with its deadline and the person's stop; what comes back, as text. */
  async call(server: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ content: string; isError: boolean }> {
    const live = this.#live.get(server);
    if (!live) return { content: `The ${server} connector is not up: ${this.#failed.get(server) ?? "not started"}.`, isError: true };
    try {
      const r = await deadline(live.client.callTool({ name: tool, arguments: args }, undefined, { ...(signal && { signal }), timeout: this.#o.callMs ?? CALL_MS }), (this.#o.callMs ?? CALL_MS) + 1000, `the ${server} connector`);
      const parts = (r.content as { type: string; text?: string }[] | undefined) ?? [];
      const text = parts.map((p) => (p.type === "text" ? p.text ?? "" : `[${p.type}]`)).join("\n");
      return { content: text || "(it gave back nothing)", isError: r.isError === true };
    } catch (e) {
      return { content: `The ${server} connector failed: ${e instanceof Error ? e.message : String(e)}`, isError: true };
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    await Promise.all([...this.#live.keys()].map((n) => this.stop(n)));
  }
}
