// A JavaScript file's facts, statically (PLAN 4.8): what it imports, and for an Electron app the seams between its
// processes: the IPC channels each side handles and calls, what a preload exposes to the page (contextBridge), each
// window's web preferences (and the risky ones), the native add-ons it loads, the addresses it names, its source map.
// Read off a token stream of our own (strings, templates, regular expressions and comments told apart), never run.
//
// Logic ported from REA (https://github.com/morluto/rea), MIT License, Copyright (c) 2026 morluto: the facts of its
// Electron static analysis (IPC by side and operation, channel literal or dynamic, contextBridge keys, BrowserWindow
// webPreferences and preload, native .node bindings, source maps). REA walks a Babel syntax tree; this reads tokens.
// Rewritten for Orbz; see docs/third-party/rea.md.

export type Tok = { t: "id" | "str" | "num" | "punc" | "tpl" | "re"; v: string; at: number };

const ID_START = /[\p{L}$_]/u;
const ID_PART = /[\p{L}\p{N}$_‌‍]/u;
const PUNCS = [">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=", "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "**", "<<", ">>"];
// after one of these a "/" begins a regular expression, not a division
const BEFORE_REGEX = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"]);

/** The file's tokens and its comments (a source map's address is in a comment). At most `max` tokens. */
export function tokenize(src: string, max = 2_000_000): { toks: Tok[]; comments: string[] } {
  const toks: Tok[] = [];
  const comments: string[] = [];
  const braces: number[] = []; // a template's ${ depth, to know which } closes it
  let i = src.startsWith("#!") ? src.indexOf("\n") + 1 || src.length : 0;
  const last = (): Tok | undefined => toks[toks.length - 1];
  const regexAllowed = (): boolean => {
    const p = last();
    if (!p) return true;
    if (p.t === "num" || p.t === "str" || p.t === "tpl" || p.t === "re") return false;
    if (p.t === "id") return BEFORE_REGEX.has(p.v);
    return !(p.v === ")" || p.v === "]" || p.v === "}");
  };
  const readTemplate = (from: number): number => {
    // from just after ` or }: to the closing ` (return its index + 1), or to "${" (pushes a brace depth)
    let j = from;
    while (j < src.length) {
      const c = src[j]!;
      if (c === "\\") j += 2;
      else if (c === "`") return j + 1;
      else if (c === "$" && src[j + 1] === "{") {
        braces.push(0);
        return -(j + 2); // negative: an expression starts here
      } else j++;
    }
    return src.length;
  };
  while (i < src.length && toks.length < max) {
    const c = src[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === " " || c === "﻿" || c === " " || c === " ") {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const end = src.indexOf("\n", i);
      comments.push(src.slice(i + 2, end < 0 ? src.length : end));
      i = end < 0 ? src.length : end;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      comments.push(src.slice(i + 2, end < 0 ? src.length : end));
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let v = "";
      while (j < src.length && src[j] !== c && src[j] !== "\n") {
        if (src[j] === "\\") {
          const n = src[j + 1];
          v += n === "n" ? "\n" : n === "t" ? "\t" : n ?? "";
          j += 2;
        } else v += src[j++];
      }
      toks.push({ t: "str", v, at: i });
      i = j + 1;
      continue;
    }
    if (c === "`") {
      const end = readTemplate(i + 1);
      toks.push({ t: "tpl", v: src.slice(i + 1, Math.abs(end) - (end < 0 ? 2 : 1)), at: i });
      i = Math.abs(end);
      continue;
    }
    if (c === "}" && braces.length && braces[braces.length - 1] === 0) {
      // the end of a template's ${...}: the template goes on
      braces.pop();
      const end = readTemplate(i + 1);
      toks.push({ t: "tpl", v: "", at: i });
      i = Math.abs(end);
      continue;
    }
    if (c === "/" && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === "\\") j += 2;
        else if (src[j] === "[") (inClass = true), j++;
        else if (src[j] === "]") (inClass = false), j++;
        else if (src[j] === "/" && !inClass) break;
        else j++;
      }
      j++;
      while (j < src.length && /[a-z]/i.test(src[j]!)) j++;
      toks.push({ t: "re", v: src.slice(i, j), at: i });
      i = j;
      continue;
    }
    if (ID_START.test(c) || c === "\\") {
      let j = i + 1;
      while (j < src.length && ID_PART.test(src[j]!)) j++;
      toks.push({ t: "id", v: src.slice(i, j), at: i });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < src.length && /[0-9a-zA-Z._]/.test(src[j]!)) j++;
      toks.push({ t: "num", v: src.slice(i, j), at: i });
      i = j;
      continue;
    }
    const p = PUNCS.find((x) => src.startsWith(x, i)) ?? c;
    if (p === "{" && braces.length) braces[braces.length - 1]!++;
    if (p === "}" && braces.length) braces[braces.length - 1]!--;
    toks.push({ t: "punc", v: p, at: i });
    i += p.length;
  }
  return { toks, comments };
}

export type IpcUse = { side: "main" | "renderer"; op: string; channel: string | null; dynamic: string | null };
export type JsFacts = {
  imports: { spec: string; how: "import" | "require" | "dynamic" | "export-from" }[];
  ipc: IpcUse[];
  exposed: { name: string; keys: string[] }[];
  windows: { prefs: Record<string, string>; preload: string | null }[];
  native: string[];
  risky: string[];
  hosts: string[];
  sourceMap: string | null;
  tokens: number;
  minified: boolean;
};

const MAIN_IPC = new Set(["handle", "handleOnce", "on", "once", "removeHandler", "removeAllListeners"]);
const RENDERER_IPC = new Set(["invoke", "send", "sendSync", "sendToHost", "postMessage", "on", "once"]);

/** The facts of one JavaScript file. */
export function factsOf(src: string): JsFacts {
  const { toks, comments } = tokenize(src);
  const f: JsFacts = { imports: [], ipc: [], exposed: [], windows: [], native: [], risky: [], hosts: [], sourceMap: null, tokens: toks.length, minified: false };
  const at = (k: number): Tok | undefined => toks[k];
  const is = (k: number, v: string): boolean => toks[k]?.v === v && toks[k]?.t !== "str" && toks[k]?.t !== "tpl";
  const str = (k: number): string | null => (toks[k]?.t === "str" ? toks[k]!.v : toks[k]?.t === "tpl" && !src.slice(toks[k]!.at, toks[k]!.at + 400).includes("${") ? toks[k]!.v : null);
  /** The source text of the tokens from k to the end of the expression (a call's first argument), cut. */
  const exprAt = (k: number): string => {
    let depth = 0;
    let j = k;
    for (; j < toks.length && j < k + 40; j++) {
      const v = toks[j]!.v;
      if (toks[j]!.t === "punc" && (v === "(" || v === "[" || v === "{")) depth++;
      else if (toks[j]!.t === "punc" && (v === ")" || v === "]" || v === "}")) {
        if (depth === 0) break;
        depth--;
      } else if (toks[j]!.t === "punc" && v === "," && depth === 0) break;
    }
    return src.slice(toks[k]?.at ?? 0, toks[j]?.at ?? src.length).trim().slice(0, 80);
  };
  /** The keys of an object literal opening at token k ("{"), at its own depth; values skipped. */
  const keysAt = (k: number): { key: string; value: string; valueAt: number }[] => {
    const out: { key: string; value: string; valueAt: number }[] = [];
    if (!is(k, "{")) return out;
    let depth = 0;
    for (let j = k; j < toks.length && j < k + 20_000; j++) {
      const v = toks[j]!;
      if (v.t === "punc" && (v.v === "{" || v.v === "(" || v.v === "[")) depth++;
      else if (v.t === "punc" && (v.v === "}" || v.v === ")" || v.v === "]")) {
        depth--;
        if (depth === 0) break;
      } else if (depth === 1 && (v.t === "id" || v.t === "str") && (is(j - 1, "{") || is(j - 1, ","))) {
        if (is(j + 1, ":")) out.push({ key: v.v, value: exprAt(j + 2), valueAt: j + 2 });
        else if (is(j + 1, ",") || is(j + 1, "}") || is(j + 1, "(")) out.push({ key: v.v, value: v.v, valueAt: j });
      }
    }
    return out;
  };
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]!;
    // imports: require("x"), import "x", import ... from "x", import("x"), export ... from "x"
    if (tk.t === "id" && tk.v === "require" && is(k + 1, "(") && str(k + 2) !== null && is(k + 3, ")") && !is(k - 1, ".")) f.imports.push({ spec: str(k + 2)!, how: "require" });
    if (tk.t === "id" && tk.v === "import") {
      if (is(k + 1, "(") && str(k + 2) !== null) f.imports.push({ spec: str(k + 2)!, how: "dynamic" });
      else if (str(k + 1) !== null && !is(k - 1, ".")) f.imports.push({ spec: str(k + 1)!, how: "import" });
      else if (!is(k - 1, ".") && !is(k + 1, ".")) {
        for (let j = k + 1; j < k + 400 && j < toks.length; j++) {
          if (toks[j]!.t === "id" && toks[j]!.v === "from" && str(j + 1) !== null) {
            f.imports.push({ spec: str(j + 1)!, how: "import" });
            break;
          }
          if (is(j, ";") || (toks[j]!.t === "id" && (toks[j]!.v === "import" || toks[j]!.v === "export"))) break;
        }
      }
    }
    if (tk.t === "id" && tk.v === "export" && (is(k + 1, "*") || is(k + 1, "{"))) {
      for (let j = k + 1; j < k + 400 && j < toks.length; j++) {
        if (toks[j]!.t === "id" && toks[j]!.v === "from" && str(j + 1) !== null) {
          f.imports.push({ spec: str(j + 1)!, how: "export-from" });
          break;
        }
        if (is(j, ";")) break;
      }
    }
    // Electron IPC: ipcMain.handle("channel", …) on the main side, ipcRenderer.invoke("channel") on a page's
    if (tk.t === "id" && (tk.v === "ipcMain" || tk.v === "ipcRenderer") && is(k + 1, ".") && at(k + 2)?.t === "id" && is(k + 3, "(")) {
      const op = at(k + 2)!.v;
      const side = tk.v === "ipcMain" ? "main" : "renderer";
      if ((side === "main" ? MAIN_IPC : RENDERER_IPC).has(op)) {
        const channel = str(k + 4);
        f.ipc.push({ side, op, channel, dynamic: channel === null ? exprAt(k + 4) : null });
      }
    }
    // the main side sending to a page: webContents.send("channel")
    if (tk.t === "id" && tk.v === "webContents" && is(k + 1, ".") && at(k + 2)?.v === "send" && is(k + 3, "(")) {
      const channel = str(k + 4);
      f.ipc.push({ side: "main", op: "send", channel, dynamic: channel === null ? exprAt(k + 4) : null });
    }
    // contextBridge.exposeInMainWorld("api", { … }): what a page can reach
    if (tk.t === "id" && tk.v === "contextBridge" && is(k + 1, ".") && at(k + 2)?.v === "exposeInMainWorld" && is(k + 3, "(")) {
      const name = str(k + 4) ?? exprAt(k + 4);
      f.exposed.push({ name, keys: is(k + 6, "{") ? keysAt(k + 6).map((x) => x.key) : [] });
    }
    // new BrowserWindow({ … webPreferences: { … } })
    if (tk.t === "id" && tk.v === "BrowserWindow" && (is(k - 1, "new") || (is(k - 1, ".") && is(k - 3, "new")))) {
      const opts = is(k + 1, "(") && is(k + 2, "{") ? keysAt(k + 2) : [];
      const wp = opts.find((x) => x.key === "webPreferences");
      const prefs: Record<string, string> = {};
      let preload: string | null = null;
      if (wp && is(wp.valueAt, "{")) {
        for (const p of keysAt(wp.valueAt)) {
          prefs[p.key] = p.value === "!0" ? "true" : p.value === "!1" ? "false" : p.value; // a minifier's true and false
          if (p.key === "preload") {
            // the last string in its value: path.join(__dirname, "preload.js") names preload.js (a comma inside the call
            // is not the value's end)
            let depth = 0;
            for (let j = p.valueAt; j < p.valueAt + 40 && j < toks.length; j++) {
              if (is(j, "(") || is(j, "[") || is(j, "{")) depth++;
              else if (is(j, ")") || is(j, "]") || is(j, "}")) {
                if (--depth < 0) break;
              } else if (is(j, ",") && depth === 0) break;
              else if (toks[j]!.t === "str") preload = toks[j]!.v;
            }
          }
        }
      }
      f.windows.push({ prefs, preload });
      if (prefs.nodeIntegration === "true") f.risky.push("a window runs Node in its page (nodeIntegration: true)");
      if (prefs.contextIsolation === "false") f.risky.push("a window's page shares its preload's world (contextIsolation: false)");
      if (prefs.sandbox === "false") f.risky.push("a window's page is not sandboxed (sandbox: false)");
      if (prefs.webSecurity === "false") f.risky.push("a window turns off the same-origin policy (webSecurity: false)");
      if (prefs.allowRunningInsecureContent === "true") f.risky.push("a window allows insecure content on https pages");
      if (prefs.nodeIntegrationInSubFrames === "true") f.risky.push("frames inside a page run Node (nodeIntegrationInSubFrames)");
    }
    // native code: a .node add-on, bindings("x"), node-gyp-build, process.dlopen
    if (tk.t === "str" && /\.node$/i.test(tk.v) && (is(k - 2, "require") || is(k - 2, "import") || is(k - 1, "from"))) f.native.push(tk.v);
    if (tk.t === "id" && tk.v === "dlopen" && is(k - 1, ".") && at(k - 2)?.v === "process") f.native.push("process.dlopen(…)");
    if (tk.t === "str" && (tk.v === "bindings" || tk.v === "node-gyp-build") && is(k - 2, "require") && is(k + 1, ")") && is(k + 2, "(")) f.native.push(`${tk.v}(${exprAt(k + 3)})`);
    // other doors worth a look
    if (tk.t === "id" && tk.v === "openExternal" && is(k - 1, ".") && at(k - 2)?.v === "shell") f.risky.push(`shell.openExternal(${exprAt(k + 2)}): opens an address in your browser`);
    if (tk.t === "id" && tk.v === "setAsDefaultProtocolClient" && is(k + 1, "(")) f.risky.push(`registers the ${str(k + 2) ?? exprAt(k + 2)}:// address for itself`);
    if (tk.t === "id" && (tk.v === "exec" || tk.v === "execSync" || tk.v === "spawn" || tk.v === "execFile") && is(k + 1, "(") && is(k - 1, ".") && /child_process|cp|childProcess/.test(at(k - 2)?.v ?? "")) f.risky.push(`runs a program (${tk.v}(${exprAt(k + 2)}))`);
    if (tk.t === "id" && tk.v === "eval" && is(k + 1, "(") && !is(k - 1, ".")) f.risky.push("eval(…): code made from a string");
    // the addresses it names
    if ((tk.t === "str" || tk.t === "tpl") && /^(https?|wss?):\/\/[^\s/$.?#][^\s]*$/i.test(tk.v)) {
      try {
        const h = new URL(tk.v).hostname;
        if (h && !f.hosts.includes(h)) f.hosts.push(h);
      } catch {
        /* not an address after all */
      }
    }
  }
  const map = comments.reverse().find((c) => /^[#@]\s*sourceMappingURL=/.test(c.trim()));
  f.sourceMap = map ? map.trim().replace(/^[#@]\s*sourceMappingURL=/, "").trim() : null;
  // a minified file: long lines and short names
  const lines = src.split("\n");
  f.minified = src.length > 2000 && src.length / Math.max(1, lines.length) > 500;
  f.risky = [...new Set(f.risky)];
  return f;
}

/** A source map's sources (the files it was built from) and whether it carries their text. */
export function sourcesOf(map: string): { sources: string[]; withText: number; version: number | null } {
  try {
    const m = JSON.parse(map) as { version?: number; sources?: unknown[]; sourcesContent?: unknown[]; sections?: { map?: { sources?: unknown[]; sourcesContent?: unknown[] } }[] };
    const parts = m.sections ? m.sections.map((s) => s.map ?? {}) : [m];
    const sources = parts.flatMap((p) => (p.sources ?? []).map(String));
    const withText = parts.reduce((n, p) => n + (p.sourcesContent ?? []).filter((x) => typeof x === "string" && x.length > 0).length, 0);
    return { sources, withText, version: typeof m.version === "number" ? m.version : null };
  } catch {
    return { sources: [], withText: 0, version: null };
  }
}
