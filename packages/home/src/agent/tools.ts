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
import { FLOOR_WORDS } from "../rules/floor.ts";
import { cronFor, type Rule, wordsOf } from "../schedule-rules.ts";
import { type ChildProcess, spawn } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { CardKind } from "./conversation.ts";
import type { FloorHit } from "../rules/floor.ts";
import { transportCause } from "./stream.ts";
import { type SearchKey, webFetch, webSearch } from "./web.ts";

export type Decision = "allow" | "ask" | "never";
export type ToolResult = { content: string; isError?: boolean; stoppedByUser?: boolean };
export type ToolContext = {
  orb: string; conversation: string; workspace: string; signal?: AbortSignal; background: Background;
  /** The person's web-search key (Tavily), read from the keychain when a search needs it (PLAN 3.10). */
  searchKey?: () => Promise<SearchKey | null>;
  /** Puts a line in the conversation for everyone in it (a session's "✓ Agreed", PLAN 2.9). */
  note?: (text: string, meta: Record<string, unknown>) => void;
  /** Keeps a bill or a reminder for the person, for the notification centre (PLAN 2.11). */
  remind?: (r: { kind: "bill" | "reminder"; title: string; due: string; amount?: string | null; aheadDays?: number }) => { id: number; comesUpAt: number };
  /** The bills and reminders kept, and moving one (only once the person approves: the floor). */
  reminders?: () => { id: number; kind: string; title: string; due: string; amount: string | null }[];
  moveReminder?: (id: number, due: string) => { id: number; due: string };
  /** A lesson (PLAN 3.5): whether it may be learned at all (Ash's learn_gate, through the kit), and
   * keeping it (only once the person says yes: the floor). */
  lessonGate?: (text: string) => Promise<{ ok: boolean; reason: string }>;
  learn?: (line: string) => string[];
  /** His plan templates (PLAN 3.2): plans you approved the same way, each passed by the gate. */
  templates?: () => { title: string; body: string }[];
  /** Sets him a job that comes back on a schedule (PLAN 2.4's rules; asked for first). */
  schedule?: (s: { name: string; instruction: string; rule: Rule }) => { id: string; words: string; next: number | null };
};
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
  /** The outward act it performs, in the one-way switch's words (shell, open, calendar, send). */
  act?: "shell" | "open" | "calendar" | "send";
  /** For a shell act whose command is not in its arguments (a row's committed test): the command. */
  commandOf?: (args: Args) => string;
  /** What it reads that came from outside (a page, a feed, mail): the turn is marked by it. */
  untrusted?: "page" | "feed" | "document" | "mail" | "calendar";
  /** The floor's categories it touches, declared by a tool that does them directly. */
  floor?: (args: Args) => FloorHit[];
  /** For a pause tool that is checked before the person sees it (a plan): send it back with why,
   * or show it — `opened` is told the card's id and returns more of the card's meta. */
  gate?: (args: Args, ctx: ToolContext) => Promise<{ sendBack: string } | { detail: string; meta: Record<string, unknown>; opened?: (card: number) => Record<string, unknown> }>;
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
    return { content: `${def.name} failed: ${transportCause(e)}`, isError: true }; // the cause's own words (ENOTFOUND…)
  }
}

const s = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
/** A schedule_job call's rule (schedule-rules.ts checks its values). */
function ruleFromArgs(a: Args): Rule {
  return a.kind === "every"
    ? { kind: "every", n: Number(a.every), unit: a.unit === "hours" ? "hours" : "minutes" }
    : { kind: "daily", time: s(a.time), ...(Array.isArray(a.days) && { days: (a.days as unknown[]).map(Number) }) };
}

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

/** Runs a command in `cwd`; a stop kills its whole tree. */
export function runCommand(command: string, cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<ToolResult> {
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
    decision: "ask", // the person's rules can allow it; the floor still reads every command
    act: "shell",
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
    name: "web_search",
    label: "Searching the web",
    description:
      "Search the web. Returns SNIPPETS: a title, an address and a one-line preview per result. A snippet is not the source and is not enough to explain, compare or analyse anything: read the pages worth reading with web_fetch. One query answers one narrow question; for anything broader, search several angles.",
    parameters: obj(
      {
        query: { type: "string", description: "The search." },
        allowed_domains: { type: "array", items: { type: "string" }, description: "Only results from these sites." },
        blocked_domains: { type: "array", items: { type: "string" }, description: "Never results from these sites." },
      },
      ["query"],
    ),
    describe: (a) => `search the web for "${s(a.query)}"`,
    decision: "allow",
    untrusted: "page",
    async run(a, ctx) {
      if (ctx.signal?.aborted) return STOPPED;
      return webSearch(a, (await ctx.searchKey?.()) ?? null, ctx.signal);
    },
  },
  {
    name: "web_fetch",
    label: "Reading the web",
    description:
      "Read a web page (or a PDF, or JSON) and get its text. This is how a source is actually read. `prompt` says what you are looking for: it picks which parts of a long page are kept. Only http and https; private and local addresses are refused.",
    parameters: obj({ url: { type: "string" }, prompt: { type: "string", description: "What you want from the page." } }, ["url"]),
    describe: (a) => `read ${s(a.url)}`,
    decision: "allow",
    untrusted: "page",
    precheck: (a) => (/^https?:\/\//i.test(s(a.url)) ? null : "Only http and https addresses can be read."),
    async run(a, ctx) {
      if (ctx.signal?.aborted) return STOPPED;
      return webFetch(a, ctx.signal);
    },
  },
  {
    name: "agree",
    label: "Agreeing",
    description: "In a session: record a decision the orbs and the person have agreed on, in one short line. It shows to everyone as ✓ Agreed. Use it once per decision, when it is settled.",
    parameters: obj({ decision: { type: "string", description: "What was agreed, in one line." } }, ["decision"]),
    describe: (a) => `agree: ${s(a.decision)}`,
    decision: "allow",
    async run(a, ctx) {
      const d = s(a.decision).replace(/\s+/g, " ").trim().slice(0, 240);
      if (!d) return { content: "agree needs the decision, in a line.", isError: true };
      ctx.note?.(`✓ Agreed: ${d}`, { agreed: d });
      return { content: `Recorded for everyone: ✓ Agreed: ${d}` };
    },
  },
  {
    name: "remind",
    label: "Keeping a reminder",
    description:
      "Keep a bill or a reminder for the person: it comes up in their notification centre ahead of time (a bill 3 days before it is due unless you say otherwise; a reminder on its day, or at its time). Use it for a bill you found, a payment to make, a renewal, a deadline, anything they asked you to remember.",
    parameters: obj(
      {
        kind: { type: "string", enum: ["bill", "reminder"] },
        title: { type: "string", description: "What it is, in a few words (Rent, Car insurance renewal, Call the dentist)." },
        due: { type: "string", description: "The day it is due, YYYY-MM-DD, or a day and a time, YYYY-MM-DDTHH:MM, in the person's own time." },
        amount: { type: "string", description: "For a bill: how much, as the bill says it ($1,200, 49.99 EUR)." },
        ahead_days: { type: "number", description: "How many days ahead it should come up (0 to 60)." },
      },
      ["kind", "title", "due"],
    ),
    describe: (a) => `keep a ${s(a.kind) === "bill" ? "bill" : "reminder"}: ${s(a.title)}, due ${s(a.due)}`,
    decision: "allow", // it only tells the person, and they can put it away
    async run(a, ctx) {
      if (!ctx.remind) return { content: "Reminders are not kept here.", isError: true };
      try {
        const kind = s(a.kind) === "bill" ? "bill" : "reminder";
        const r = ctx.remind({ kind, title: s(a.title), due: s(a.due), amount: typeof a.amount === "string" ? a.amount : null, ...(typeof a.ahead_days === "number" && { aheadDays: a.ahead_days }) });
        return { content: `Kept (${kind} ${r.id}). It comes up ${new Date(r.comesUpAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.` };
      } catch (e) {
        return { content: e instanceof Error ? e.message : String(e), isError: true };
      }
    },
  },
  {
    name: "plan_templates",
    label: "Looking at my plan templates",
    description:
      "Your plan templates: plans the person approved three times the same way, each passed by the plan gate. When a job is one of these, start its plan from the template (then propose_plan it as usual: it is checked again).",
    parameters: obj({}, []),
    describe: () => "look at its plan templates",
    decision: "allow",
    async run(_a, ctx) {
      const t = ctx.templates?.() ?? [];
      if (!t.length) return { content: "No plan templates yet: a plan becomes one when the person has approved three of that shape." };
      return { content: t.map((x) => `## Template: ${x.title}\n\n${x.body.trim()}`).join("\n\n---\n\n") };
    },
  },
  {
    name: "propose_lesson",
    label: "Asking to learn something",
    description:
      "Propose a lesson you learned from the person: a short rule for how they like things done (\"Charts start at zero\", \"Invoices go out on the 1st\"). It reaches them as a card; you learn it only if they say yes. Never a complaint about a tool, a one-off, or an error that went away.",
    parameters: obj({ line: { type: "string", description: "The lesson, in one line, as a rule." }, why: { type: "string", description: "What the person said or did that taught it." } }, ["line"]),
    describe: (a) => `remember: "${s(a.line)}"${a.why ? ` (${s(a.why)})` : ""}`,
    decision: "ask",
    floor: () => [{ category: "lessons", why: FLOOR_WORDS.lessons }],
    async gate(a, ctx) {
      // what must never be learned is turned away before the person is asked (Ash's learn_gate)
      const v = ctx.lessonGate ? await ctx.lessonGate(s(a.line)) : { ok: true, reason: "" };
      return v.ok ? { detail: s(a.line), meta: { lesson: s(a.line) } } : { sendBack: `Not a lesson to keep: ${v.reason}` };
    },
    async run(a, ctx) {
      if (!ctx.learn) return { content: "Lessons are not kept here.", isError: true };
      try {
        const lines = ctx.learn(s(a.line));
        ctx.note?.(`Memory updated: ${lines.at(-1)}`, { memory: lines.at(-1) }); // the chip on the conversation (PLAN 2.4)
        return { content: `Learned. You now keep ${lines.length} ${lines.length === 1 ? "lesson" : "lessons"} from them.` };
      } catch (e) {
        return { content: e instanceof Error ? e.message : String(e), isError: true };
      }
    },
  },
  {
    name: "schedule_job",
    label: "Setting a schedule",
    description:
      "Set yourself a job that comes back on its own: daily at a time (on chosen days, 1 Monday to 7 Sunday), or every 15, 20 or 30 minutes, or every 1, 2, 3, 4, 6, 8 or 12 hours. Each run starts fresh, in its own conversation, from your instruction, so write it whole. The person approves it first.",
    parameters: obj(
      {
        name: { type: "string", description: "What the job is, in a few words (Inbox sweep, Weekly invoices)." },
        instruction: { type: "string", description: "What to do each time, complete on its own." },
        kind: { type: "string", enum: ["daily", "every"] },
        time: { type: "string", description: "For daily: the time, HH:MM, in the person's own time." },
        days: { type: "array", items: { type: "number" }, description: "For daily: which days, 1 Monday to 7 Sunday (none: every day)." },
        every: { type: "number", description: "For every: how many minutes or hours." },
        unit: { type: "string", enum: ["minutes", "hours"] },
      },
      ["name", "instruction", "kind"],
    ),
    describe: (a) => {
      let when = "";
      try {
        when = wordsOf(cronFor(ruleFromArgs(a))).toLowerCase();
      } catch {
        when = "on a schedule";
      }
      return `set a schedule: "${s(a.name)}", ${when}`;
    },
    decision: "ask", // work that comes back on its own, unwatched: the person says yes to it first
    precheck: (a) => {
      try {
        cronFor(ruleFromArgs(a));
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    async run(a, ctx) {
      if (!ctx.schedule) return { content: "Schedules are not kept here.", isError: true };
      const made = ctx.schedule({ name: s(a.name).slice(0, 80), instruction: s(a.instruction).slice(0, 2000), rule: ruleFromArgs(a) });
      const next = made.next ? new Date(made.next).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "not yet known";
      return { content: `Scheduled (${made.id}): ${made.words}. The first run is ${next}.` };
    },
  },
  {
    name: "list_reminders",
    label: "Looking at the calendar",
    description: "List the bills and reminders kept for the person (yours and the other orbs'), with their ids and when each is due.",
    parameters: obj({}, []),
    describe: () => "look at the bills and reminders kept",
    decision: "allow",
    async run(_a, ctx) {
      const all = ctx.reminders?.() ?? [];
      return { content: all.length ? all.map((r) => `${r.id}: ${r.kind} "${r.title}", due ${r.due}${r.amount ? `, ${r.amount}` : ""}`).join("\n") : "(none kept)" };
    },
  },
  {
    name: "move_reminder",
    label: "Moving something on the calendar",
    description: "Propose moving a bill or a reminder to another day (or time). The person sees it as a card and nothing moves until they approve: moving what is on their calendar is never silent.",
    parameters: obj(
      {
        id: { type: "number", description: "Its id (list_reminders)." },
        title: { type: "string", description: "What it is, as the card should say it." },
        due: { type: "string", description: "The new day, YYYY-MM-DD, or day and time, YYYY-MM-DDTHH:MM." },
        why: { type: "string", description: "Why, in one line." },
      },
      ["id", "title", "due"],
    ),
    describe: (a) => `move ${s(a.title)} to ${s(a.due)}${a.why ? ` (${s(a.why)})` : ""}`,
    decision: "ask",
    floor: () => [{ category: "calendar", why: FLOOR_WORDS.calendar }],
    async run(a, ctx) {
      if (!ctx.moveReminder) return { content: "The calendar is not kept here.", isError: true };
      try {
        const r = ctx.moveReminder(Number(a.id), s(a.due));
        return { content: `Moved ${s(a.title)} to ${r.due}.` };
      } catch (e) {
        return { content: e instanceof Error ? e.message : String(e), isError: true };
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

