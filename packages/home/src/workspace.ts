// An orb's workspace, as the app shows it (PLAN 2.8, his computer): the files he is making, read
// through the door. Read only, and only inside it: the tools' own guard (tools.ts inWorkspace)
// refuses "..", an absolute path, and a link that leads out. The one way in is a file you give
// him from a chat (PLAN 2.4), kept in `from-you/` under a plain name, never over another.
import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inWorkspace } from "./agent/tools.ts";

export const workspaceOf = (dataDir: string, orb: string): string => join(dataDir, "orbs", orb, "workspace");

/** A file read for the app shows at most this much (a dataset's first rows, a page, a report). */
export const READ_CAP = 256 * 1024;
/** A folder lists at most this many entries. */
export const LIST_CAP = 500;

export class OutsideError extends Error {
  constructor(path: string) {
    super(`${path} is outside the workspace`);
  }
}
export class MissingError extends Error {
  constructor(path: string) {
    super(`no ${path} in the workspace`);
  }
}

export type Entry = { path: string; dir: boolean; size: number; mtime: number };
export type WorkFile = { path: string; size: number; mtime: number; text: string | null; truncated: boolean };

const join2 = (dir: string, name: string): string => (dir ? `${dir.replace(/\/+$/, "")}/${name}` : name);

/** One folder of his workspace (its top when `dir` is empty): folders first, then by name. `root` is
 * another workspace he works in (a session's, PLAN 5.1) instead of his own. */
export function listWorkspace(dataDir: string, orb: string, dir = "", root = workspaceOf(dataDir, orb)): Entry[] {
  const at = inWorkspace(root, dir || ".");
  if (!at) throw new OutsideError(dir);
  let names: string[];
  try {
    if (!statSync(at).isDirectory()) throw new MissingError(dir);
    names = readdirSync(at);
  } catch (e) {
    if (e instanceof MissingError) throw e;
    if (!dir) return []; // nothing made yet
    throw new MissingError(dir);
  }
  const out: Entry[] = [];
  for (const name of names) {
    const rel = join2(dir, name);
    const p = inWorkspace(root, rel);
    if (!p) continue; // a link that leads out of it is not shown
    try {
      const s = lstatSync(p).isSymbolicLink() ? statSync(p) : lstatSync(p);
      out.push({ path: rel, dir: s.isDirectory(), size: s.isDirectory() ? 0 : s.size, mtime: s.mtimeMs });
    } catch {
      /* gone since it was listed */
    }
    if (out.length >= LIST_CAP) break;
  }
  return out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.path.localeCompare(b.path));
}

/** One file's text, up to READ_CAP; a file that is not text (a NUL in its start) comes back without it. */
export function readWorkspace(dataDir: string, orb: string, path: string, root = workspaceOf(dataDir, orb)): WorkFile {
  if (!path) throw new MissingError("(no path)");
  const p = inWorkspace(root, path);
  if (!p) throw new OutsideError(path);
  let s;
  try {
    s = statSync(p);
  } catch {
    throw new MissingError(path);
  }
  if (!s.isFile()) throw new MissingError(path);
  const n = Math.min(s.size, READ_CAP);
  const buf = Buffer.alloc(n);
  const fd = openSync(p, "r");
  try {
    readSync(fd, buf, 0, n, 0);
  } finally {
    closeSync(fd);
  }
  const binary = buf.subarray(0, 8192).includes(0);
  return { path, size: s.size, mtime: s.mtimeMs, text: binary ? null : buf.toString("utf8"), truncated: s.size > READ_CAP };
}

/** A file you give him, from a chat (PLAN 2.4's composer: attach): at most this big. */
export const UPLOAD_CAP = 10 * 1024 * 1024;
/** Where what you give him goes, in his workspace. */
export const FROM_YOU = "from-you";

/** A file's name as he keeps it: its own last part, plain characters, never hidden or empty. */
export function safeName(name: string): string {
  const last = name.split(/[/\\]/).pop() ?? "";
  const plain = last.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[^\p{L}\p{N} ._()-]/gu, "_").replace(/^[. ]+/, "").trim().slice(0, 100);
  return plain || "file";
}

/** Keeps a file you gave him in `from-you/`, never over another (a second report.csv is "report (2).csv"). */
export function saveUpload(dataDir: string, orb: string, name: string, bytes: Uint8Array): string {
  if (bytes.length > UPLOAD_CAP) throw new Error(`a file up to ${UPLOAD_CAP / 1024 / 1024} MB`);
  const root = workspaceOf(dataDir, orb);
  const dir = inWorkspace(root, FROM_YOU);
  if (!dir) throw new OutsideError(FROM_YOU);
  mkdirSync(dir, { recursive: true });
  const file = safeName(name);
  const dot = file.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [file.slice(0, dot), file.slice(dot)] : [file, ""];
  for (let n = 1; n < 1000; n++) {
    const rel = `${FROM_YOU}/${n === 1 ? file : `${stem} (${n})${ext}`}`;
    const at = inWorkspace(root, rel);
    if (!at) throw new OutsideError(rel);
    try {
      writeFileSync(at, bytes, { flag: "wx" }); // never over one that is there
      return rel;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new Error(`too many files named ${file}`);
}
