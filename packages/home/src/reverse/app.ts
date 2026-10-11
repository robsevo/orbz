// A JavaScript or Electron app as a whole (PLAN 4.8): a folder, or an Electron `.asar` archive (read without unpacking
// it anywhere), its package, its entry and preload scripts and pages, every own file's facts (js.ts) joined: which
// channel each side handles and which it calls (and the ones only one side has), what each preload exposes, its windows
// and their risky settings, its native add-ons, the Node powers each file uses, the addresses it names, and the
// original sources its source maps give back. Dependencies are listed, not read.
//
// Logic ported from REA (https://github.com/morluto/rea), MIT License, Copyright (c) 2026 morluto: its ASAR admission
// (the pickle's extents checked before the header is decoded), its application graph and Electron boundaries.
// Rewritten for Orbz; see docs/third-party/rea.md.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, normalize, relative } from "node:path";
import { Bytes, bounded, Unreadable } from "./bytes.ts";
import { factsOf, sourcesOf, type IpcUse, type JsFacts } from "./js.ts";

/** The most an app is read: files listed, own script files read, their bytes in all, a header's bytes. */
export const LIMITS = { files: 60_000, scripts: 4_000, scriptBytes: 48 * 1024 * 1024, headerBytes: 16 * 1024 * 1024, fileBytes: 6 * 1024 * 1024 };

type Tree = { list: string[]; read: (path: string) => Buffer | null; size: (path: string) => number; unpacked: Set<string> };

/** An ASAR archive's files, read from its buffer (and its `.unpacked` folder beside it, for what was left out). */
export function asarTree(buf: Buffer, archivePath: string | null): Tree {
  const r = new Bytes(buf, true);
  // the header is a Chromium pickle: 4, then its size; inside, the size of the JSON, then the JSON
  if (r.u32(0, "the archive's size field") !== 4) throw new Unreadable("not an ASAR archive: its first field is not 4");
  const headerSize = r.u32(4);
  const payload = r.u32(8);
  const jsonSize = r.u32(12);
  if (headerSize < 8 || headerSize > buf.length - 8 || payload !== headerSize - 4 || jsonSize > payload - 4) throw new Unreadable("the ASAR header leaves its archive or its sizes disagree");
  if (headerSize > LIMITS.headerBytes) throw new Unreadable("the ASAR header is over 16 MB");
  let header: { files?: Record<string, unknown> };
  try {
    header = JSON.parse(buf.subarray(16, 16 + jsonSize).toString("utf8")) as typeof header;
  } catch {
    throw new Unreadable("the ASAR header is not JSON");
  }
  const base = 8 + headerSize;
  const files = new Map<string, { offset: number; size: number; unpacked: boolean }>();
  const walk = (node: { files?: Record<string, unknown> }, prefix: string, depth: number): void => {
    if (depth > 64) throw new Unreadable("the ASAR tree is deeper than any real app");
    for (const [name, v] of Object.entries(node.files ?? {})) {
      if (files.size >= LIMITS.files) return;
      const e = v as { files?: Record<string, unknown>; size?: number; offset?: string; unpacked?: boolean; link?: string };
      const path = prefix ? `${prefix}/${name}` : name;
      if (e.files) walk(e, path, depth + 1);
      else if (typeof e.size === "number") files.set(path, { offset: Number(e.offset ?? 0), size: e.size, unpacked: e.unpacked === true });
    }
  };
  walk(header, "", 0);
  const unpackedDir = archivePath ? `${archivePath}.unpacked` : null;
  return {
    list: [...files.keys()],
    size: (p) => files.get(p)?.size ?? 0,
    unpacked: new Set([...files].filter(([, f]) => f.unpacked).map(([p]) => p)),
    read: (p) => {
      const f = files.get(p);
      if (!f || f.size > LIMITS.fileBytes) return null;
      if (f.unpacked) {
        const at = unpackedDir ? join(unpackedDir, p) : null;
        return at && existsSync(at) ? readFileSync(at) : null;
      }
      const at = base + f.offset;
      return at + f.size <= buf.length ? buf.subarray(at, at + f.size) : null;
    },
  };
}

/** A folder's files (links are not followed out of it). */
export function folderTree(root: string): Tree {
  const list: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 40 || list.length >= LIMITS.files) return;
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const n of names) {
      if (list.length >= LIMITS.files) return;
      const p = join(dir, n);
      let st;
      try {
        st = statSync(p, { throwIfNoEntry: false });
      } catch {
        continue;
      }
      if (!st) continue;
      if (st.isDirectory()) {
        if (n === ".git") continue;
        walk(p, depth + 1);
      } else if (st.isFile()) list.push(relative(root, p));
    }
  };
  walk(root, 0);
  return {
    list,
    unpacked: new Set(),
    size: (p) => statSync(join(root, p), { throwIfNoEntry: false })?.size ?? 0,
    read: (p) => {
      const at = join(root, p);
      const st = statSync(at, { throwIfNoEntry: false });
      return st && st.size <= LIMITS.fileBytes ? readFileSync(at) : null;
    },
  };
}

const SCRIPT = /\.(c|m)?js$/i;
const BUILTINS = new Set(["assert", "async_hooks", "buffer", "child_process", "cluster", "crypto", "dgram", "dns", "events", "fs", "fs/promises", "http", "http2", "https", "inspector", "module", "net", "os", "path", "perf_hooks", "process", "querystring", "readline", "stream", "string_decoder", "timers", "tls", "tty", "url", "util", "v8", "vm", "worker_threads", "zlib"]);
/** The Node powers worth naming: what a file can do to your machine. */
const POWERS: Record<string, string> = { child_process: "runs programs", fs: "reads and writes files", "fs/promises": "reads and writes files", net: "opens network connections", http: "makes or serves HTTP", https: "makes or serves HTTPS", dgram: "sends UDP", vm: "runs code from strings", worker_threads: "starts threads", os: "reads the machine's details", crypto: "does cryptography" };

export type AppFacts = {
  what: string;
  pkg: { name: string | null; version: string | null; main: string | null; description: string | null; electron: string | null; dependencies: string[] };
  counts: { files: number; scripts: number; read: number; ownScripts: number; native: number; pages: number; maps: number };
  entry: string | null;
  preloads: string[];
  pages: { file: string; scripts: string[]; webviews: number }[];
  channels: { channel: string; handled: string[]; called: string[]; sent: string[]; ops: string[] }[];
  dynamicChannels: { file: string; side: string; op: string; expr: string }[];
  exposed: { file: string; name: string; keys: string[] }[];
  windows: { file: string; prefs: Record<string, string>; preload: string | null }[];
  risky: { file: string; what: string }[];
  native: { file: string; what: string }[];
  powers: { power: string; files: string[] }[];
  graph: { file: string; imports: string[] }[];
  hosts: string[];
  sources: { from: string; files: number; withText: number; sample: string[] }[];
  limits: string[];
};

/** Reads an app: a folder or an .asar archive, at `root`. */
export function readApp(root: string): AppFacts {
  const st = statSync(root);
  const tree = st.isDirectory() ? folderTree(root) : asarTree(readFileSync(root), root);
  const limits: string[] = [];
  if (tree.list.length >= LIMITS.files) limits.push(`only the first ${LIMITS.files.toLocaleString("en-US")} files were listed`);
  const own = (p: string) => !p.split("/").includes("node_modules");
  const text = (p: string): string | null => tree.read(p)?.toString("utf8") ?? null;

  // the package: its name, main, Electron, dependencies
  const pkgPath = tree.list.includes("package.json") ? "package.json" : tree.list.filter((p) => basename(p) === "package.json" && own(p)).sort((a, b) => a.length - b.length)[0];
  let pkg: AppFacts["pkg"] = { name: null, version: null, main: null, description: null, electron: null, dependencies: [] };
  if (pkgPath) {
    try {
      const j = JSON.parse(text(pkgPath) ?? "{}") as { name?: string; version?: string; main?: string; description?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      pkg = {
        name: j.name ?? null, version: j.version ?? null, main: j.main ?? null, description: j.description?.slice(0, 200) ?? null,
        electron: j.devDependencies?.electron ?? j.dependencies?.electron ?? null, dependencies: Object.keys(j.dependencies ?? {}).slice(0, 80),
      };
    } catch {
      limits.push(`${pkgPath} is not JSON`);
    }
  }
  const base = pkgPath ? dirname(pkgPath) : ".";
  const resolveIn = (from: string, spec: string): string | null => {
    const raw = normalize(join(dirname(from), spec)).replace(/^\.\//, "");
    for (const cand of [raw, `${raw}.js`, `${raw}.cjs`, `${raw}.mjs`, `${raw}/index.js`]) if (tree.list.includes(cand)) return cand;
    return null;
  };
  const entry = pkg.main ? resolveIn(join(base, "package.json"), `./${pkg.main}`) ?? normalize(join(base, pkg.main)) : tree.list.find((p) => /^(main|index|app)\.(c|m)?js$/.test(p)) ?? null;

  // every own script, read within the limits
  const scripts = tree.list.filter((p) => SCRIPT.test(p));
  const ownScripts = scripts.filter(own);
  const facts = new Map<string, JsFacts>();
  let bytes = 0;
  for (const p of ownScripts) {
    if (facts.size >= LIMITS.scripts) {
      limits.push(`only ${LIMITS.scripts.toLocaleString("en-US")} of its ${ownScripts.length.toLocaleString("en-US")} own scripts were read`);
      break;
    }
    const size = tree.size(p);
    if (bytes + size > LIMITS.scriptBytes) {
      limits.push(`its scripts past ${LIMITS.scriptBytes / 1024 / 1024} MB were not read`);
      break;
    }
    const src = text(p);
    if (src === null) continue;
    bytes += size;
    facts.set(p, factsOf(src));
  }
  if (tree.unpacked.size) limits.push(`${tree.unpacked.size} files were left out of the archive (${tree.list.filter((p) => tree.unpacked.has(p) && !tree.read(p)).length} of them not found beside it)`);

  // IPC joined across files: a channel, who handles it, who calls it
  const byChannel = new Map<string, AppFacts["channels"][number]>();
  const dynamicChannels: AppFacts["dynamicChannels"] = [];
  const add = (file: string, u: IpcUse): void => {
    if (u.channel === null) return void dynamicChannels.push({ file, side: u.side, op: u.op, expr: u.dynamic ?? "?" });
    const c = byChannel.get(u.channel) ?? byChannel.set(u.channel, { channel: u.channel, handled: [], called: [], sent: [], ops: [] }).get(u.channel)!;
    const list = u.side === "main" ? (u.op === "send" ? c.sent : c.handled) : c.called;
    if (!list.includes(file)) list.push(file);
    if (!c.ops.includes(`${u.side}.${u.op}`)) c.ops.push(`${u.side}.${u.op}`);
  };
  for (const [file, f] of facts) for (const u of f.ipc) add(file, u);

  // the pages: each HTML file's scripts and webviews
  const pages = tree.list.filter((p) => /\.html?$/i.test(p) && own(p)).slice(0, 200).map((file) => {
    const html = text(file) ?? "";
    return { file, scripts: [...html.matchAll(/<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]!).slice(0, 20), webviews: (html.match(/<webview\b/gi) ?? []).length };
  });
  // the powers each file uses, and the import graph between own files
  const powers = new Map<string, Set<string>>();
  const graph: AppFacts["graph"] = [];
  for (const [file, f] of facts) {
    const local: string[] = [];
    for (const imp of f.imports) {
      const spec = imp.spec.replace(/^node:/, "");
      if (BUILTINS.has(spec) && POWERS[spec]) (powers.get(POWERS[spec]!) ?? powers.set(POWERS[spec]!, new Set()).get(POWERS[spec]!)!).add(file);
      if (spec.startsWith(".")) {
        const to = resolveIn(file, spec);
        if (to && !local.includes(to)) local.push(to);
      }
    }
    if (local.length) graph.push({ file, imports: local });
  }
  // source maps: inline, or a .map file beside the script
  const sources: AppFacts["sources"] = [];
  for (const [file, f] of facts) {
    if (!f.sourceMap || sources.length >= 40) continue;
    let json: string | null = null;
    const m = /^data:application\/json(?:;charset=[^;,]+)?;base64,(.+)$/.exec(f.sourceMap);
    if (m) json = Buffer.from(m[1]!, "base64").toString("utf8");
    else if (!/^[a-z]+:/i.test(f.sourceMap)) json = text(normalize(join(dirname(file), f.sourceMap)));
    if (!json) continue;
    const s = sourcesOf(json);
    if (s.sources.length) sources.push({ from: file, files: s.sources.length, withText: s.withText, sample: s.sources.slice(0, 8) });
  }
  const all = (pick: (f: JsFacts) => string[]): { file: string; what: string }[] => [...facts].flatMap(([file, f]) => pick(f).map((what) => ({ file, what })));
  const preloads = [...new Set([...facts].flatMap(([file, f]) => f.windows.flatMap((w) => (w.preload ? [resolveIn(file, w.preload.startsWith(".") ? w.preload : `./${w.preload}`) ?? w.preload] : []))))];
  const nativeFiles = tree.list.filter((p) => /\.node$/i.test(p));
  const electron = Boolean(pkg.electron) || [...facts.values()].some((f) => f.imports.some((i) => i.spec === "electron")) || /\.asar$/i.test(root);
  if ([...facts.values()].some((f) => f.minified)) limits.push("some scripts are minified: their names say little, but strings, channels and settings survive");
  return {
    what: electron ? "an Electron app" : pkg.name ? "a Node app" : "JavaScript files",
    pkg,
    counts: { files: tree.list.length, scripts: scripts.length, read: facts.size, ownScripts: ownScripts.length, native: nativeFiles.length, pages: pages.length, maps: tree.list.filter((p) => p.endsWith(".map")).length },
    entry,
    preloads,
    pages,
    channels: [...byChannel.values()].sort((a, b) => a.channel.localeCompare(b.channel)),
    dynamicChannels: dynamicChannels.slice(0, 40),
    exposed: [...facts].flatMap(([file, f]) => f.exposed.map((x) => ({ file, ...x }))),
    windows: [...facts].flatMap(([file, f]) => f.windows.map((w) => ({ file, ...w }))),
    risky: all((f) => f.risky),
    native: [...nativeFiles.map((file) => ({ file, what: "a native add-on (compiled code: inspect_binary reads it)" })), ...all((f) => f.native)],
    powers: [...powers].map(([power, files]) => ({ power, files: [...files].slice(0, 12) })),
    graph: graph.slice(0, 200),
    hosts: [...new Set([...facts.values()].flatMap((f) => f.hosts))].slice(0, 60),
    sources,
    limits,
  };
}

export const isScript = (p: string): boolean => SCRIPT.test(p) || extname(p) === ".ts";
