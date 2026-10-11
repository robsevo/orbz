// The reverse engineer's tools (PLAN 4.8; owner, 10-10: "add reverse engineering capabilities to orbz as a persona"):
// read what you handed its computer, statically, inside its workspace; nothing it reads is run. Each file is outside
// text (a binary's strings, an app's code, a capture's answers can say anything), so a turn that read one is fenced.
//
//   inspect_binary    a program or library (ELF, PE, Mach-O, universal), or any file: what it is, its anatomy, its strings
//   inspect_app       a JavaScript or Electron app (a folder or an app.asar): its processes' seams, settings, sources
//   inspect_contract  a smart contract's EVM bytecode: its functions, proxy, risky opcodes, compiler
//   inspect_capture   a saved network capture (.har): hosts, endpoints, shapes, credentials by name
import type { ToolDef, ToolResult } from "../agent/tools.ts";
import { inWorkspace } from "../agent/tools.ts";
import { GROUPS } from "../agent/groups.ts";
import { readOffThread, type Ask } from "./read.ts";

const obj = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({ type: "object", properties, required, additionalProperties: false });
const s = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const STOPPED: ToolResult = { content: "Stopped by the user.", isError: true, stoppedByUser: true };
const outside = (path: string): string => `${path} is outside the workspace: copy it into the workspace first (the person can hand it over in a chat).`;

export function reverseTools(o: { timeoutMs?: number } = {}): ToolDef[] {
  const run = async (ask: Ask, signal?: AbortSignal): Promise<ToolResult> => {
    if (signal?.aborted) return STOPPED;
    const a = await readOffThread(ask, { signal, timeoutMs: o.timeoutMs });
    return { content: a.text, ...(a.isError && { isError: true }) };
  };
  const pathParam = { type: "string", description: "Relative to your workspace." };
  return [
    {
      name: "inspect_binary",
      group: GROUPS.reverse,
      label: "Reading a binary",
      description:
        "Read a compiled program or library in your workspace without running it: an ELF (Linux), a PE (.exe, .dll), a Mach-O (macOS, iOS) or a universal one. It says its machine, entry, sections, the libraries it loads, what it imports and exports, its hardening (NX, PIE, RELRO, canaries; ASLR, DEP, CFG, signing) and its strings, the interesting ones first. Any other file is said for what it is (an APK, an IPA or a JAR listed, a WebAssembly module's imports and exports, a Java class). `match` lists the strings containing it (a word or a regular expression).",
      parameters: obj({ path: pathParam, match: { type: "string", description: "Optional: list the strings containing this." } }, ["path"]),
      describe: (a) => `read the binary ${s(a.path)}${a.match ? ` (strings matching ${s(a.match)})` : ""}`,
      decision: "allow",
      untrusted: "document",
      precheck: (a, ctx) => (inWorkspace(ctx.workspace, s(a.path)) ? null : outside(s(a.path))),
      run: (a, ctx) => run({ kind: "binary", path: inWorkspace(ctx.workspace, s(a.path))!, match: s(a.match) || null }, ctx.signal),
    },
    {
      name: "inspect_app",
      group: GROUPS.reverse,
      label: "Reading an app",
      description:
        "Read a JavaScript or Electron app in your workspace without running it: a folder, or an Electron app.asar (read in place). It says its package and entry, its preloads and pages, every IPC channel with where it is handled and where it is called (and the ones only one side has), what each preload exposes to the page, each window's web preferences and the risky ones, its native add-ons, what its scripts can do to the machine (run programs, files, network), the addresses it names, and the original sources its source maps give back. Its dependencies are listed, not read.",
      parameters: obj({ path: { type: "string", description: "A folder or an .asar file, relative to your workspace." } }, ["path"]),
      describe: (a) => `read the app ${s(a.path)}`,
      decision: "allow",
      untrusted: "document",
      precheck: (a, ctx) => (inWorkspace(ctx.workspace, s(a.path)) ? null : outside(s(a.path))),
      run: (a, ctx) => run({ kind: "app", path: inWorkspace(ctx.workspace, s(a.path))! }, ctx.signal),
    },
    {
      name: "inspect_contract",
      group: GROUPS.reverse,
      label: "Reading a contract",
      description:
        "Read a smart contract's EVM bytecode without running it, from a file of hex in your workspace or the hex itself (creation code is read down to its runtime): the functions its dispatcher answers, named when well known, whether it is a proxy and of what kind, the opcodes worth a look (DELEGATECALL, SELFDESTRUCT, tx.origin) and the compiler its metadata names. A token's functions that can stop holders selling or change its fees are pointed out.",
      parameters: obj({ path: { type: "string", description: "A file of hex, relative to your workspace." }, bytecode: { type: "string", description: "Or the hex itself (0x…)." } }, []),
      describe: (a) => (a.path ? `read the contract in ${s(a.path)}` : "read a contract's bytecode"),
      decision: "allow",
      untrusted: "document",
      precheck: (a, ctx) => (!a.path && !a.bytecode ? "Give a path or the bytecode." : a.path && !inWorkspace(ctx.workspace, s(a.path)) ? outside(s(a.path)) : null),
      run: (a, ctx) => run({ kind: "contract", path: a.path ? inWorkspace(ctx.workspace, s(a.path))! : null, hex: a.path ? null : s(a.bytecode) }, ctx.signal),
    },
    {
      name: "inspect_capture",
      group: GROUPS.reverse,
      label: "Reading a network capture",
      description:
        "Read a saved network capture (a .har from a browser's developer tools) in your workspace: the hosts an app talks to, its endpoints with their ids folded (/users/:id), methods, statuses and kinds of content, the shape of what each sends and answers (keys, never values), GraphQL operations, websockets, and which requests carry credentials (by name only, never their values).",
      parameters: obj({ path: pathParam }, ["path"]),
      describe: (a) => `read the capture ${s(a.path)}`,
      decision: "allow",
      untrusted: "document",
      precheck: (a, ctx) => (inWorkspace(ctx.workspace, s(a.path)) ? null : outside(s(a.path))),
      run: (a, ctx) => run({ kind: "capture", path: inWorkspace(ctx.workspace, s(a.path))! }, ctx.signal),
    },
  ];
}
