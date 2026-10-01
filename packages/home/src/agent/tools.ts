// The orb's tools (PLAN 1.5). Each carries what the loop, the cards and the rules (1.6) need
// besides the code that runs it — Open Dot's idea of tool metadata, in our own words:
//
//   label        present tense, for the live activity line ("Running a command")
//   describe     the action in plain words, for an approval card and for rule matching
//   decision     what happens when no rule says otherwise: allow, ask, or never
//   precheck     a refusal decided before anyone is asked (a path outside the workspace)
//   pause        a tool that is itself a question to the person
//
// A stop reaches the tool (Ash's abort-tools lesson: a stop checked only between calls waited
// 80 s for a `sleep 90`). A tool not yet started does not start; a running command's whole
// process tree is killed; a fetch is aborted. Background commands are the exception on purpose:
// the person asked for them to outlive the turn.
import { type ChildProcess, spawn } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { CardKind } from "./conversation.ts";

export type Decision = "allow" | "ask" | "never";
export type ToolResult = { content: string; isError?: boolean; stoppedByUser?: boolean };
export type ToolContext = { orb: string; conversation: string; workspace: string; signal?: AbortSignal; background: Background };
type Args = Record<string, unknown>;

export type ToolDef = {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  describe: (args: Args) => string;
  decision: Decision;
  precheck?: (args: Args, ctx: ToolContext) => string | null;
  pause?: CardKind;
  run?: (args: Args, ctx: ToolContext) => Promise<ToolResult>;
};

export const STOPPED: ToolResult = { content: "Stopped by the user before it ran.", isError: true, stoppedByUser: true };
const OUTPUT_CAP = 30_000;

/** Runs a tool with the stop guard and nothing escaping as an exception. */
export async function runTool(def: ToolDef, args: Args, ctx: ToolContext): Promise<ToolResult> {
  if (ctx.signal?.aborted) return STOPPED;
  if (!def.run) return { content: `${def.name} is not something that runs`, isError: true };
  try {
    return await def.run(args, ctx);
  } catch (e) {
    if (ctx.signal?.aborted) return { content: "Stopped by the user.", isError: true, stoppedByUser: true };
    return { content: `${def.name} failed: ${e instanceof Error ? e.message : String(e)}`, isError: true };
  }
}

const s = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const obj = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

/** The real path `p` names inside the orb's workspace, or null if it lands outside. Symlinks are
 * followed first, dangling ones too: a link to a path outside that does not exist yet would
 * otherwise let a write create it there. */
export function inWorkspace(workspace: string, p: string): string | null {
  mkdirSync(workspace, { recursive: true });
  const root = realpathSync(workspace);
  let target = resolve(root, p);
  for (let hops = 0; hops < 40; hops++) {
    // the deepest part of the path that exists (as a file, a folder or a link)
    let existing = target;
    const rest: string[] = [];
    for (;;) {
      try {
        lstatSync(existing);
        break;
      } catch {
        const up = dirname(existing);
        if (up === existing) return null;
        rest.unshift(basename(existing));
        existing = up;
      }
    }
    if (lstatSync(existing).isSymbolicLink()) {
      let real: string;
      try {
        real = realpathSync(existing);
      } catch {
        real = resolve(dirname(existing), readlinkSync(existing)); // dangling: where it points
      }
      target = join(real, ...rest);
      if (real === existing) break;
      continue;
    }
    target = join(realpathSync(existing), ...rest);
    break;
  }
  return target === root || target.startsWith(root + sep) ? target : null;
}

function clip(text: string): string {
  if (text.length <= OUTPUT_CAP) return text;
  const head = text.slice(0, OUTPUT_CAP / 2);
  const tail = text.slice(-OUTPUT_CAP / 2);
  return `${head}\n… [${text.length - OUTPUT_CAP} characters left out of the middle] …\n${tail}`;
}

function shellArgv(command: string): [string, string[]] {
  return process.platform === "win32" ? ["cmd.exe", ["/d", "/s", "/c", command]] : ["bash", ["-c", command]];
}

/** Kills a command and everything it started: its own process group on POSIX, /T on Windows. */
function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

/** Commands the orb started in the background. They outlive a turn, not the home. */
export class Background {
  readonly #jobs = new Map<string, { child: ChildProcess; output: string; done: string | null; command: string }>();
  #n = 0;

  start(command: string, cwd: string): string {
    const [bin, argv] = shellArgv(command);
    const child = spawn(bin, argv, { cwd, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    const id = `bg${++this.#n}`;
    const job = { child, output: "", done: null as string | null, command };
    const take = (d: Buffer): void => {
      job.output = (job.output + d.toString()).slice(-OUTPUT_CAP);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    child.on("close", (code, signal) => (job.done = signal ? `killed by ${signal}` : `exited ${code}`));
    child.on("error", (e) => (job.done = `could not start: ${e.message}`));
    this.#jobs.set(id, job);
    return id;
  }

  read(id: string): string | null {
    const j = this.#jobs.get(id);
    if (!j) return null;
    const out = j.output;
    j.output = "";
    return `${out || "(no new output)"}${j.done ? `\n[${j.done}]` : "\n[still running]"}`;
  }

  stop(id: string): boolean {
    const j = this.#jobs.get(id);
    if (!j) return false;
    if (j.done === null) killTree(j.child);
    return true;
  }

  close(): void {
    for (const j of this.#jobs.values()) if (j.done === null) killTree(j.child);
  }
}

function runCommand(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<ToolResult> {
  return new Promise((resolveResult) => {
    const [bin, argv] = shellArgv(command);
    let child: ChildProcess;
    try {
      child = spawn(bin, argv, { cwd, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolveResult({ content: `The command could not start: ${e instanceof Error ? e.message : String(e)}`, isError: true });
      return;
    }
    let output = "";
    let settled = false;
    const take = (d: Buffer): void => {
      output += d.toString();
      if (output.length > OUTPUT_CAP * 4) output = output.slice(0, OUTPUT_CAP) + output.slice(-OUTPUT_CAP);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    const finish = (r: ToolResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolveResult(r);
    };
    const timer = setTimeout(() => {
      killTree(child);
      finish({ content: `The command ran past ${timeoutMs / 1000} s and was stopped.${output ? ` Its output so far:\n${clip(output)}` : ""}`, isError: true });
    }, timeoutMs);
    function onAbort(): void {
      killTree(child);
      finish({ content: "Stopped by the user.", isError: true, stoppedByUser: true });
    }
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => finish({ content: `The command failed: ${e.message}`, isError: true }));
    // 'close', not 'exit': the pipes have drained, so the last line is there
    child.on("close", (code, sig) => {
      const body = clip(output.trimEnd()) || "(no output)";
      finish({ content: sig ? `${body}\n[killed by ${sig}]` : code ? `${body}\n[exit ${code}]` : body, isError: code !== 0 });
    });
  });
}

export const TOOLS: ToolDef[] = [
  {
    name: "shell",
    label: "Running a command",
    description:
      "Run a shell command in your workspace and get its output. Set background to start something that keeps running (a server); read it with shell_output, stop it with stop_shell.",
    parameters: obj(
      {
        command: { type: "string", description: "The command to run." },
        timeout_s: { type: "number", description: "Give up after this many seconds (default 120, at most 600)." },
        background: { type: "boolean", description: "Start it in the background and return at once." },
      },
      ["command"],
    ),
    describe: (a) => `run \`${s(a.command)}\` in its workspace${a.background ? " (in the background)" : ""}`,
    decision: "ask", // until the rules (1.6) can allow it
    async run(a, ctx) {
      mkdirSync(ctx.workspace, { recursive: true });
      if (a.background) {
        const id = ctx.background.start(s(a.command), ctx.workspace);
        return { content: `[${id}] started in the background. Read it with shell_output(id="${id}"), stop it with stop_shell(id="${id}").` };
      }
      const t = Math.min(Math.max(Number(a.timeout_s) || 120, 1), 600) * 1000;
      return runCommand(s(a.command), ctx.workspace, t, ctx.signal);
    },
  },
  {
    name: "shell_output",
    label: "Checking a command",
    description: "Read what a background command has printed since the last read.",
    parameters: obj({ id: { type: "string" } }, ["id"]),
    describe: (a) => `read the output of background command ${s(a.id)}`,
    decision: "allow",
    async run(a, ctx) {
      const out = ctx.background.read(s(a.id));
      return out === null ? { content: `No background command ${s(a.id)}.`, isError: true } : { content: out };
    },
  },
  {
    name: "stop_shell",
    label: "Stopping a command",
    description: "Stop a background command.",
    parameters: obj({ id: { type: "string" } }, ["id"]),
    describe: (a) => `stop background command ${s(a.id)}`,
    decision: "allow",
    async run(a, ctx) {
      return ctx.background.stop(s(a.id)) ? { content: `Stopped ${s(a.id)}.` } : { content: `No background command ${s(a.id)}.`, isError: true };
    },
  },
  {
    name: "read_file",
    label: "Reading a file",
    description: "Read a text file in your workspace.",
    parameters: obj({ path: { type: "string", description: "Relative to your workspace." } }, ["path"]),
    describe: (a) => `read ${s(a.path)} in its workspace`,
    decision: "allow",
    precheck: (a, ctx) => (inWorkspace(ctx.workspace, s(a.path)) ? null : `${s(a.path)} is outside the workspace.`),
    async run(a, ctx) {
      const p = inWorkspace(ctx.workspace, s(a.path))!;
      return { content: clip(readFileSync(p, "utf8")) };
    },
  },
  {
    name: "write_file",
    label: "Writing a file",
    description: "Write a text file in your workspace (replacing it if it exists).",
    parameters: obj({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]),
    describe: (a) => `write ${s(a.path)} in its workspace`,
    decision: "allow",
    precheck: (a, ctx) => (inWorkspace(ctx.workspace, s(a.path)) ? null : `${s(a.path)} is outside the workspace.`),
    async run(a, ctx) {
      const p = inWorkspace(ctx.workspace, s(a.path))!;
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, s(a.content));
      return { content: `Wrote ${s(a.content).length} characters to ${s(a.path)}.` };
    },
  },
  {
    name: "list_files",
    label: "Looking around",
    description: "List a folder in your workspace.",
    parameters: obj({ path: { type: "string", description: "Relative to your workspace; empty for its top." } }, []),
    describe: (a) => `list ${s(a.path) || "its workspace"}`,
    decision: "allow",
    precheck: (a, ctx) => (inWorkspace(ctx.workspace, s(a.path) || ".") ? null : `${s(a.path)} is outside the workspace.`),
    async run(a, ctx) {
      mkdirSync(ctx.workspace, { recursive: true });
      const p = inWorkspace(ctx.workspace, s(a.path) || ".")!;
      const names = readdirSync(p).map((n) => (statSync(resolve(p, n)).isDirectory() ? `${n}/` : n));
      return { content: names.length ? names.sort().join("\n") : "(empty)" };
    },
  },
  {
    name: "web_fetch",
    label: "Reading the web",
    description: "Fetch a web page or file over http(s) and get its text.",
    parameters: obj({ url: { type: "string" } }, ["url"]),
    describe: (a) => `fetch ${s(a.url)}`,
    decision: "allow",
    precheck: (a) => (/^https?:\/\//i.test(s(a.url)) ? null : "Only http and https addresses can be fetched."),
    async run(a, ctx) {
      if (ctx.signal?.aborted) return STOPPED;
      const signal = ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
      try {
        const res = await fetch(s(a.url), { signal, redirect: "follow" });
        const text = await res.text();
        const readable = /html/i.test(res.headers.get("content-type") ?? "")
          ? text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
          : text;
        return { content: clip(`HTTP ${res.status}\n${readable}`), isError: !res.ok };
      } catch (e) {
        if (ctx.signal?.aborted) return { content: "Stopped by the user.", isError: true, stoppedByUser: true };
        throw e;
      }
    },
  },
  {
    name: "ask_owner",
    label: "Asking you",
    description: "Ask the person a question and wait for the answer. Use it only when you cannot decide without them.",
    parameters: obj({ question: { type: "string" } }, ["question"]),
    describe: (a) => `ask: ${s(a.question)}`,
    decision: "allow",
    pause: "question",
  },
];

export const toolSpecs = (tools: ToolDef[]): { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }[] =>
  tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));

