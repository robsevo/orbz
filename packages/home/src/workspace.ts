// An orb's workspace, as the app shows it (PLAN 2.8, his computer): the files he is making, read
// through the door. Read only, and only inside it: the tools' own guard (tools.ts inWorkspace)
// refuses "..", an absolute path, and a link that leads out.
import { closeSync, lstatSync, openSync, readdirSync, readSync, statSync } from "node:fs";
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

/** One folder of his workspace (its top when `dir` is empty): folders first, then by name. */
export function listWorkspace(dataDir: string, orb: string, dir = ""): Entry[] {
  const root = workspaceOf(dataDir, orb);
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
export function readWorkspace(dataDir: string, orb: string, path: string): WorkFile {
  if (!path) throw new MissingError("(no path)");
  const p = inWorkspace(workspaceOf(dataDir, orb), path);
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
