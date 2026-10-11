// PLAN 4.8_t, reverse engineering (owner, 10-10: "add reverse engineering capabilities to orbz as a persona ... verif
// logic and make it our own"), on real files only:
//   - Programs already on this machine read back as the reference tools read them: ELF (Node itself, ls) as readelf
//     says, PE (Python's Windows launchers, Go's MinGW test program) as objdump says, Mach-O (Go's own test files) as
//     Go's own tests say. A suite skips what this machine lacks.
//   - A damaged copy (cut short, or a byte changed) is refused with why, never another error, never a hang.
//   - Contracts: WETH's and USDC's runtime bytecode on Base (public, fetched once into test/fixtures/contracts):
//     WETH's eleven functions by name and its compiler; USDC a proxy whose admin can replace it.
//   - An Electron app as a folder and the same app as an .asar: the same facts (IPC by side, what a preload exposes,
//     risky settings, native code, the Node powers used, addresses, source maps); the token reader tells strings,
//     templates, regular expressions and comments apart.
//   - A HAR: endpoints folded, GraphQL named, credentials by name and never by value.
//   - The tools read only inside the workspace, off the home's thread, with a deadline; who starts with them.
//   - REA's notice is kept.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readApp } from "../src/reverse/app.ts";
import { kindOf, readElf, readFat, readMachO, readPe, type Program } from "../src/reverse/binary.ts";
import { Unreadable } from "../src/reverse/bytes.ts";
import { bytecodeOf, readEvm } from "../src/reverse/evm.ts";
import { readHar, templateOf } from "../src/reverse/har.ts";
import { factsOf, tokenize } from "../src/reverse/js.ts";
import { answer, readOffThread } from "../src/reverse/read.ts";
import { reverseTools } from "../src/reverse/tools.ts";
import { startingGroups } from "../src/agent/groups.ts";
import { runTool } from "../src/agent/tools.ts";
import { tempDir } from "./helpers.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const has = (cmd: string): boolean => {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
/** Python's setuptools, in the kit's own Python: its Windows launchers are real PE files, on every machine with the kit. */
const SETUPTOOLS = (() => {
  const lib = join(HERE, "../../../kit/.venv/lib");
  const py = existsSync(lib) ? readdirSync(lib).find((d) => existsSync(join(lib, d, "site-packages/setuptools"))) : undefined;
  return py ? join(lib, py, "site-packages/setuptools") : "/nonexistent";
})();
const GO = "/usr/lib/go/src/debug";
const run = (cmd: string, args: string[]): string => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// ── ELF, as readelf reads it ──────────────────────────────────────────────────────────────────────
const elfs = [process.execPath, "/usr/bin/ls"].filter((p) => existsSync(p) && kindOf(readFileSync(p).subarray(0, 64)) === "elf");
test("an ELF reads as readelf reads it: its machine, libraries, imports, exports, sections and hardening", { skip: !has("readelf") || !elfs.length ? "no readelf or no ELF here" : false }, () => {
  for (const path of elfs) {
    const p = readElf(readFileSync(path));
    const header = run("readelf", ["-h", "-W", path]);
    assert.equal(p.bits, /Class:\s+ELF64/.test(header) ? 64 : 32, path);
    if (/X86-64/.test(header)) assert.equal(p.machine, "x86-64");
    if (/AArch64/.test(header)) assert.equal(p.machine, "AArch64");
    const dynamic = run("readelf", ["-d", "-W", path]);
    assert.deepEqual(p.libraries, [...dynamic.matchAll(/\(NEEDED\)\s+Shared library: \[([^\]]+)\]/g)].map((m) => m[1]), `${path}: the libraries, in order`);
    // the dynamic symbols: undefined ones are what it imports, defined global ones what it exports (readelf adds @version)
    const rows = run("readelf", ["--dyn-syms", "-W", path]).split("\n").map((l) => l.trim().split(/\s+/)).filter((c) => /^\d+:$/.test(c[0] ?? "") && c[0] !== "0:" && c[7]);
    const bare = (n: string) => n.replace(/@.*$/, "");
    assert.deepEqual(new Set(p.imports), new Set(rows.filter((c) => c[6] === "UND").map((c) => bare(c[7]!))), `${path}: the imports`);
    assert.deepEqual(new Set(p.exports), new Set(rows.filter((c) => c[6] !== "UND" && (c[4] === "GLOBAL" || c[4] === "WEAK" || c[4] === "UNIQUE") && (c[3] === "FUNC" || c[3] === "OBJECT")).map((c) => bare(c[7]!))), `${path}: the exports`);
    const sections = [...run("readelf", ["-S", "-W", path]).matchAll(/^\s*\[\s*(\d+)\]\s+(\S+)/gm)].filter((m) => m[1] !== "0").map((m) => m[2]);
    assert.deepEqual(p.sections.map((s) => s.name), sections, `${path}: the sections, in order`);
    const segments = run("readelf", ["-l", "-W", path]);
    const stack = /GNU_STACK(?:\s+\S+){5}\s+(\S+)/.exec(segments)?.[1];
    if (stack) assert.equal(p.hardening["NX (stack not executable)"], !stack.includes("E"), `${path}: NX`);
    const relro = /GNU_RELRO/.test(segments);
    const now = /BIND_NOW|Flags: NOW/.test(dynamic);
    assert.equal(p.hardening.RELRO, relro ? (now ? "full" : "partial") : "none", `${path}: RELRO`);
  }
});

// ── PE, as objdump reads it ───────────────────────────────────────────────────────────────────────
const pes = [join(SETUPTOOLS, "cli-64.exe"), join(SETUPTOOLS, "cli-32.exe"), join(SETUPTOOLS, "gui-arm64.exe"), join(GO, "pe/testdata/gcc-amd64-mingw-exec")].filter(existsSync);
test("a PE reads as objdump reads it: its machine, libraries, imports by library, subsystem and hardening", { skip: !has("objdump") || !pes.length ? "no objdump or no PE here" : false }, () => {
  let checked = 0;
  for (const path of pes) {
    const p = readPe(readFileSync(path));
    let dump: string;
    try {
      dump = run("objdump", ["-p", path]);
    } catch {
      continue; // this objdump does not read that machine (an ARM64 PE): read without error is all it can say
    }
    checked++;
    const libs = [...dump.matchAll(/DLL Name: (\S+)/g)].map((m) => m[1]!);
    assert.deepEqual(p.libraries, libs, `${path}: the libraries, in order`);
    // each library's names: objdump's table rows under its "DLL Name", up to the next blank line
    const theirs = new Set<string>();
    for (const block of dump.split(/\n\s*DLL Name: /).slice(1)) {
      const dll = block.split("\n")[0]!.trim();
      for (const line of block.split("\n").slice(2)) {
        if (!line.trim()) break;
        const m = /^\s*[0-9a-f]+\s+(?:<none>|\d+)\s+[0-9a-f]+\s+(\S+)/i.exec(line);
        if (m) theirs.add(`${dll}!${m[1]}`);
      }
    }
    assert.deepEqual(new Set(p.imports.filter((i) => !i.includes("!#"))), theirs, `${path}: the imports by name`);
    const dll = parseInt(/DllCharacteristics\s+([0-9a-f]+)/i.exec(dump)![1]!, 16);
    assert.deepEqual([p.hardening["ASLR (dynamic base)"], p.hardening["DEP (NX compatible)"], p.hardening["high-entropy ASLR"], p.hardening["Control Flow Guard"]], [Boolean(dll & 0x40), Boolean(dll & 0x100), Boolean(dll & 0x20), Boolean(dll & 0x4000)], `${path}: hardening`);
    const sub = parseInt(/Subsystem\s+([0-9a-f]+)/i.exec(dump)![1]!, 16);
    assert.match(p.kind, sub === 3 ? /Windows console/ : sub === 2 ? /Windows GUI/ : /./, `${path}: the subsystem`);
  }
  assert.ok(checked >= 1, "at least one PE checked against objdump");
  const machines: [string, string][] = [["cli-64.exe", "x86-64"], ["cli-32.exe", "x86"], ["gui-arm64.exe", "ARM64"], ["gcc-amd64-mingw-exec", "x86-64"]];
  for (const [file, machine] of machines) {
    const path = pes.find((p) => p.endsWith(file));
    if (path) assert.equal(readPe(readFileSync(path)).machine, machine, file);
  }
});

// ── Mach-O, as Go's own tests say ─────────────────────────────────────────────────────────────────
const goMacho = (name: string): Buffer => Buffer.from(readFileSync(join(GO, `macho/testdata/${name}.base64`), "utf8"), "base64");
test("a Mach-O reads as Go's own tests say: its machine, kind, libraries, PIE, entry and rpath; a universal one's slices", { skip: existsSync(join(GO, "macho/testdata")) ? false : "no Go test files here" }, () => {
  const gcc = readMachO(goMacho("gcc-amd64-darwin-exec"));
  assert.deepEqual([gcc.bits, gcc.machine, gcc.kind], [64, "x86-64", "executable"]);
  assert.deepEqual(gcc.libraries, ["/usr/lib/libgcc_s.1.dylib", "/usr/lib/libSystem.B.dylib"]);
  assert.equal(gcc.hardening.PIE, false, "flags 0x85: no PIE");
  assert.match(gcc.entry ?? "", /^0x[0-9a-f]+ \(its starting thread state\)$/, "its entry from LC_UNIXTHREAD");
  assert.deepEqual([...gcc.imports].sort(), ["_exit", "_puts"]);
  const clang = readMachO(goMacho("clang-amd64-darwin-exec-with-rpath"));
  assert.equal(clang.hardening.PIE, true, "flags 0x200085: PIE");
  assert.match(clang.entry ?? "", /from the start of its text/, "LC_MAIN");
  assert.ok(clang.notes.includes("it looks for libraries in /my/rpath"));
  const fat = readFat(goMacho("fat-gcc-386-amd64-darwin-exec"));
  assert.deepEqual(fat.slices.map((s) => [s.machine, s.program?.kind]), [["x86", "executable"], ["x86-64", "executable"]]);
  assert.equal(kindOf(goMacho("fat-gcc-386-amd64-darwin-exec")), "macho-fat", "told from a Java class by its count of slices");
});

// ── damaged copies ────────────────────────────────────────────────────────────────────────────────
test("a damaged copy is refused with why: cut short or a byte changed, never another error, never a hang", { skip: !elfs.length && !pes.length ? "no programs here" : false }, () => {
  const samples: [string, Buffer, (b: Uint8Array) => unknown][] = [];
  const ls = elfs.find((p) => p.endsWith("/ls"));
  if (ls) samples.push(["ls", readFileSync(ls), readElf]);
  if (pes[0]) samples.push([pes[0], readFileSync(pes[0]), readPe]);
  if (existsSync(join(GO, "macho/testdata"))) {
    samples.push(["gcc-amd64-darwin-exec", goMacho("gcc-amd64-darwin-exec"), readMachO]);
    samples.push(["fat", goMacho("fat-gcc-386-amd64-darwin-exec"), readFat]);
  }
  let seed = 12345;
  const rand = (n: number): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
  let refused = 0;
  for (const [name, whole, read] of samples) {
    const tries: Buffer[] = [];
    for (let k = 1; k <= 40; k++) tries.push(whole.subarray(0, Math.floor((whole.length * k) / 41)));
    for (let k = 0; k < 300; k++) {
      const copy = Buffer.from(whole);
      copy[rand(Math.min(4096, copy.length))] = rand(256);
      tries.push(copy);
    }
    for (const b of tries) {
      const t0 = performance.now();
      try {
        read(b);
      } catch (e) {
        assert.ok(e instanceof Unreadable, `${name}: only a refusal, never ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
        refused++;
      }
      assert.ok(performance.now() - t0 < 2_000, `${name}: each read in under 2 s`);
    }
  }
  assert.ok(refused > 0, "some copies were refused (control: the damage is real)");
  if (ls) assert.throws(() => readElf(readFileSync(ls).subarray(0, 200)), /points outside the file/, "its sections are past where it was cut");
});

// ── contracts ─────────────────────────────────────────────────────────────────────────────────────
const contract = (name: string): Uint8Array => bytecodeOf(readFileSync(join(HERE, `fixtures/contracts/${name}.hex`), "utf8"));
test("contracts: WETH's functions by name and its compiler; USDC a proxy its admin can replace", () => {
  const weth = readEvm(contract("weth-base"));
  assert.deepEqual(weth.functions.map((f) => f.name).sort(), ["allowance(address,address)", "approve(address,uint256)", "balanceOf(address)", "decimals()", "deposit()", "name()", "symbol()", "totalSupply()", "transfer(address,uint256)", "transferFrom(address,address,uint256)", "withdraw(uint256)"]);
  assert.equal(weth.compiler, "solc 0.5.17");
  assert.equal(weth.proxy, null);
  assert.equal(weth.opcodes.ORIGIN, 0, "its metadata's bytes are not read as instructions (they held a stray 0x32)");
  const usdc = readEvm(contract("usdc-base"));
  assert.match(usdc.proxy ?? "", /upgradeable proxy/);
  assert.deepEqual(usdc.functions.filter((f) => f.watch).map((f) => f.name), ["upgradeTo(address)", "upgradeToAndCall(address,bytes)"]);
  assert.equal(usdc.compiler, "solc 0.6.12");
  assert.throws(() => bytecodeOf("0x60zz"), /hex/);
  assert.throws(() => bytecodeOf("0x608"), /odd/);
});

// ── an Electron app, as a folder and as an asar ───────────────────────────────────────────────────
const APP: Record<string, string> = {
  "package.json": JSON.stringify({ name: "notes-app", version: "1.2.3", main: "main.js", description: "Notes, kept", devDependencies: { electron: "33.0.0" }, dependencies: { "better-sqlite3": "11.0.0" } }),
  "main.js": [
    'const { app, BrowserWindow, ipcMain, shell } = require("electron");',
    'const path = require("node:path");',
    'const fs = require("fs");',
    'const { execFile } = require("child_process");',
    "function create() {",
    '  const win = new BrowserWindow({ width: 800, webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false } });',
    '  win.loadFile("index.html");',
    '  win.webContents.send("ready", 1);',
    "}",
    'ipcMain.handle("notes:list", async () => fs.readdirSync("."));',
    'ipcMain.handle("notes:save", async (e, n) => fs.writeFileSync(n.path, n.text));',
    "ipcMain.on(`log`, (e, m) => console.log(m));",
    'const chan = "dyn" + 1;',
    "ipcMain.handle(chan, () => 1);",
    'shell.openExternal("https://notes.example.com/help");',
    'fetch("https://api.notes.example.com/v1/sync");',
    "// require(\"not-a-real-import\") in a comment is no import",
    "//# sourceMappingURL=main.js.map",
  ].join("\n"),
  "main.js.map": JSON.stringify({ version: 3, sources: ["../src/main.ts"], sourcesContent: ["export {};"], mappings: "" }),
  "preload.js": [
    'const { contextBridge, ipcRenderer } = require("electron");',
    "const quoted = /\"notes:fake\"[\\/]/g; // a regular expression holding quotes opens no string",
    "const t = `a template ${1 + { a: 1 }.a} with \"notes:also-fake\" inside`;",
    "const half = 4 / 2 / 1; // two divisions, no regular expression",
    'contextBridge.exposeInMainWorld("notes", { list: () => ipcRenderer.invoke("notes:list"), save: (n) => ipcRenderer.invoke("notes:save", n), ping() { return ipcRenderer.invoke("notes:ping"); } });',
  ].join("\n"),
  "index.html": '<html><body><script src="renderer.js"></script></body></html>',
  "renderer.js": "window.notes.list().then(console.log);",
  "native/addon.node": "not really compiled code, only named like it",
  "node_modules/better-sqlite3/package.json": JSON.stringify({ name: "better-sqlite3", version: "11.0.0" }),
  "node_modules/better-sqlite3/lib/index.js": 'require("./never-read-it-is-a-dependency");',
};
/** The same files as an Electron archive: a Chromium pickle holding the JSON header, then the files' bytes. */
function packAsar(files: Record<string, string>): Buffer {
  const header: { files: Record<string, unknown> } = { files: {} };
  const bodies: Buffer[] = [];
  let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const parts = path.split("/");
    let dir = header;
    for (const p of parts.slice(0, -1)) dir = ((dir.files[p] as { files: Record<string, unknown> } | undefined) ?? (dir.files[p] = { files: {} })) as { files: Record<string, unknown> };
    const body = Buffer.from(text);
    dir.files[parts.at(-1)!] = { size: body.length, offset: String(offset) };
    bodies.push(body);
    offset += body.length;
  }
  const json = Buffer.from(JSON.stringify(header));
  const pad = (4 - (json.length % 4)) % 4;
  const payload = 4 + json.length + pad;
  const head = Buffer.alloc(16);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(payload + 4, 4);
  head.writeUInt32LE(payload, 8);
  head.writeUInt32LE(json.length, 12);
  return Buffer.concat([head, json, Buffer.alloc(pad), ...bodies]);
}

test("an Electron app, as a folder and as an asar, says the same: its seams, settings, native code, powers and sources", (t) => {
  const dir = tempDir(t);
  const folder = join(dir, "notes");
  for (const [p, text] of Object.entries(APP)) {
    mkdirSync(dirname(join(folder, p)), { recursive: true });
    writeFileSync(join(folder, p), text);
  }
  writeFileSync(join(dir, "app.asar"), packAsar(APP));
  const a = readApp(folder);
  const b = readApp(join(dir, "app.asar"));
  for (const x of [a, b]) {
    assert.equal(x.what, "an Electron app");
    assert.deepEqual([x.pkg.name, x.pkg.version, x.pkg.electron, x.pkg.dependencies], ["notes-app", "1.2.3", "33.0.0", ["better-sqlite3"]]);
    assert.equal(x.entry, "main.js");
    assert.deepEqual(x.preloads, ["preload.js"]);
    assert.deepEqual(x.channels.map((c) => [c.channel, c.handled, c.called, c.sent]), [
      ["log", ["main.js"], [], []],
      ["notes:list", ["main.js"], ["preload.js"], []],
      ["notes:ping", [], ["preload.js"], []],
      ["notes:save", ["main.js"], ["preload.js"], []],
      ["ready", [], [], ["main.js"]],
    ], "every channel, by side; nothing from inside a string, a template or a regular expression");
    assert.deepEqual(x.dynamicChannels.map((d) => [d.file, d.side, d.op, d.expr]), [["main.js", "main", "handle", "chan"]]);
    assert.deepEqual(x.exposed, [{ file: "preload.js", name: "notes", keys: ["list", "save", "ping"] }]);
    assert.deepEqual(x.windows[0]!.prefs, { preload: 'path.join(__dirname, "preload.js")', contextIsolation: "true", nodeIntegration: "false", sandbox: "false" });
    assert.ok(x.risky.some((r) => /not sandboxed/.test(r.what)), "sandbox: false is pointed out");
    assert.ok(x.risky.some((r) => /openExternal/.test(r.what)));
    assert.ok(!x.risky.some((r) => /nodeIntegration: true/.test(r.what)), "control: nodeIntegration false is not a risk");
    assert.deepEqual(x.native.map((n) => n.file), ["native/addon.node"]);
    assert.deepEqual(x.powers.map((p) => [p.power, p.files]).sort(), [["reads and writes files", ["main.js"]], ["runs programs", ["main.js"]]]);
    assert.deepEqual(x.hosts.sort(), ["api.notes.example.com", "notes.example.com"]);
    assert.deepEqual(x.sources.map((s) => [s.from, s.files, s.withText, s.sample]), [["main.js", 1, 1, ["../src/main.ts"]]]);
    assert.equal(x.counts.ownScripts, 3, "its own scripts, not its dependencies'");
  }
  // a header that leaves its archive is refused
  const bad = packAsar(APP);
  bad.writeUInt32LE(bad.length * 2, 4);
  writeFileSync(join(dir, "bad.asar"), bad);
  assert.throws(() => readApp(join(dir, "bad.asar")), Unreadable);
});

test("the token reader tells strings, templates, regular expressions and comments apart", () => {
  const f = factsOf([
    'import x, { y } from "./x.js";',
    'import "./side-effect.js";',
    "export * from './again.js';",
    "const meta = import.meta.url; // not an import",
    'const later = await import("./later.js");',
    "const r = a / b / c, q = /require\\(\"no\"\\)/; // division, then a regular expression",
    "const s = 'it\\'s require(\"no\")';",
    'const tpl = `x ${ `inner ${ "no" }` } require("no")`;',
    "/* require('no') */ const real = require('fs');",
  ].join("\n"));
  assert.deepEqual(f.imports.map((i) => [i.spec, i.how]), [["./x.js", "import"], ["./side-effect.js", "import"], ["./again.js", "export-from"], ["./later.js", "dynamic"], ["fs", "require"]]);
  const { toks } = tokenize("a = b / c / d; e = /x/g.test(f) ? 1 : 2;");
  assert.deepEqual(toks.filter((t) => t.t === "re").map((t) => t.v), ["/x/g"]);
});

// ── a network capture ─────────────────────────────────────────────────────────────────────────────
test("a capture: endpoints with ids folded, GraphQL by name, credentials by name and never their values", (t) => {
  const entry = (method: string, url: string, o: { status?: number; body?: unknown; answer?: unknown; headers?: [string, string][]; cookies?: string[] } = {}) => ({
    startedDateTime: "2026-10-10T12:00:00.000Z",
    request: { method, url, headers: (o.headers ?? []).map(([name, value]) => ({ name, value })), cookies: (o.cookies ?? []).map((name) => ({ name, value: "cookie-value-for-test" })), ...(o.body !== undefined && { postData: { mimeType: "application/json", text: JSON.stringify(o.body) } }) },
    response: { status: o.status ?? 200, content: { mimeType: "application/json; charset=utf-8", size: 120, text: JSON.stringify(o.answer ?? {}) } },
  });
  const har = "\uFEFF" + JSON.stringify({
    log: {
      version: "1.2",
      entries: [
        entry("GET", "https://api.example.com/users/42", { answer: { id: 42, name: "A", roles: ["r"] }, headers: [["Authorization", "Bearer value-for-test-only"]] }),
        entry("GET", "https://api.example.com/users/43", { answer: { id: 43, name: "B", roles: [] } }),
        entry("POST", "https://api.example.com/graphql", { body: { operationName: "GetFeed", query: "query GetFeed { feed { id } }" }, cookies: ["session"] }),
        entry("GET", "https://cdn.example.com/a.js?token=value-for-test-only", { status: 304 }),
      ],
    },
  });
  const h = readHar(har);
  assert.equal(h.entries, 4);
  assert.deepEqual(h.endpoints.map((e) => `${e.method} ${e.host}${e.path} ×${e.count}`), ["GET api.example.com/users/:id ×2", "POST api.example.com/graphql ×1", "GET cdn.example.com/a.js ×1"]);
  assert.deepEqual(h.endpoints[0]!.answers, ["id", "name", "roles"]);
  assert.deepEqual(h.graphql, ["GetFeed"]);
  assert.deepEqual(h.credentials.sort(), ["?token= → cdn.example.com", "authorization → api.example.com"]);
  assert.deepEqual(h.cookies, ["session"]);
  assert.equal(templateOf("/v1/orders/3f2c9a1e-1b2c-4d5e-8f90-1234567890ab/items/7"), "/v1/orders/:id/items/:id");
  const path = join(tempDir(t), "capture.har");
  writeFileSync(path, har);
  const text = answer({ kind: "capture", path }).text;
  assert.ok(!text.includes("value-for-test-only") && !text.includes("cookie-value-for-test"), "no credential's value ever leaves the file");
});

// ── the tools ─────────────────────────────────────────────────────────────────────────────────────
test("the tools read only inside the workspace, off the home's thread, with a deadline; who starts with them", { skip: pes.length ? false : "no PE here" }, async (t) => {
  const ws = tempDir(t);
  copyFileSync(pes[0]!, join(ws, "tool.exe"));
  const tools = Object.fromEntries(reverseTools().map((x) => [x.name, x]));
  const ctx = { orb: "rex", conversation: "chat:rex", workspace: ws, background: new Map() } as unknown as Parameters<typeof runTool>[2];
  assert.match(tools.inspect_binary!.precheck!({ path: "../../etc/passwd" }, ctx)!, /outside the workspace/);
  assert.equal(tools.inspect_binary!.untrusted, "document", "what it reads is outside text: the turn is fenced");
  const r = await runTool(tools.inspect_binary!, { path: "tool.exe" }, ctx);
  assert.match(r.content, /^tool\.exe: PE, /);
  assert.equal(r.content, answer({ kind: "binary", path: join(ws, "tool.exe"), match: null }).text, "off the thread, the same answer");
  const late = await readOffThread({ kind: "binary", path: join(ws, "tool.exe"), match: null }, { timeoutMs: 1 });
  assert.match(late.text, /took longer than/);
  assert.ok(startingGroups({ family: "build", specialty: "reverse", session: false }).has("reverse"));
  assert.ok(startingGroups({ family: "build", specialty: "security", session: false }).has("reverse"));
  assert.ok(!startingGroups({ family: "build", specialty: "frontend", session: false }).has("reverse"), "control: a frontend builder loads them only by asking");
});

test("REA's notice is kept: its licence in docs, and each file whose logic came from it says so", () => {
  const doc = readFileSync(join(HERE, "../../../docs/third-party/rea.md"), "utf8");
  assert.match(doc, /MIT License/);
  assert.match(doc, /Copyright \(c\) 2026 morluto/);
  for (const f of ["bytes.ts", "binary.ts", "js.ts", "evm.ts", "har.ts", "app.ts"])
    assert.match(readFileSync(join(HERE, `../src/reverse/${f}`), "utf8"), /Logic ported from REA \(https:\/\/github\.com\/morluto\/rea\), MIT License, Copyright \(c\) 2026 morluto/, f);
});
