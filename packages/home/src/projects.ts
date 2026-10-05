// Your projects folder (owner, 10-04: "all projects should also go into a file, add that in settings, that
// we can add that"): every project's files where you can open them yourself. Each session's work goes under
// its title, each orb's own (its private chats) under "<name>'s work". The home copies there after every
// run that finishes and when you say so; it adds and updates, never deletes, and never reads anything back
// from there (the orbs still work in their own workspaces, which nothing outside can reach).
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

export type ProjectsState = { dir: string; on: boolean; last: { at: number; files: number } | null; why: string | null };
type Saved = { dir: string; on: boolean };
export const DEFAULT_DIR = (): string => join(homedir(), "Orbz Projects");

export class ProjectsRefused extends Error {}

/** A folder's name from a title: what a file system takes, nothing it would refuse or hide. */
export function folderName(title: string): string {
  const n = title.replace(/[/\\:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return n.slice(0, 80) || "Untitled";
}

export class Projects {
  readonly #dataDir: string;
  readonly #sources: () => { name: string; dir: string }[];
  readonly #now: () => number;
  #saved: Saved;
  #last: { at: number; files: number } | null = null;
  #why: string | null = null;

  constructor(o: { dataDir: string; sources: () => { name: string; dir: string }[]; now: () => number; defaultDir?: string; defaultOn?: boolean }) {
    this.#dataDir = o.dataDir;
    this.#sources = o.sources;
    this.#now = o.now;
    const f = join(o.dataDir, "projects.json");
    let saved: Saved = { dir: o.defaultDir ?? DEFAULT_DIR(), on: o.defaultOn ?? false };
    try {
      if (existsSync(f)) saved = { ...saved, ...(JSON.parse(readFileSync(f, "utf8")) as Partial<Saved>) };
    } catch {
      // a broken file: the defaults, and the next change writes it whole
    }
    this.#saved = saved;
  }

  state(): ProjectsState {
    return { dir: this.#saved.dir, on: this.#saved.on, last: this.#last, why: this.#why };
  }

  /** A new folder, or copying on or off. A folder must be a whole path, and not inside the home's own data. */
  set(p: { dir?: string; on?: boolean }): ProjectsState {
    const dir = p.dir === undefined ? this.#saved.dir : p.dir.trim().replace(/^~(?=$|\/)/, homedir());
    if (!dir || !isAbsolute(dir)) throw new ProjectsRefused("The folder needs its whole path, from the top (like /home/you/Orbz Projects).");
    const inside = relative(resolve(this.#dataDir), resolve(dir));
    if (inside === "" || (!inside.startsWith("..") && !isAbsolute(inside))) throw new ProjectsRefused("That is inside the home's own data: choose a folder of your own.");
    this.#saved = { dir: resolve(dir), on: p.on ?? this.#saved.on };
    writeFileSync(join(this.#dataDir, "projects.json"), `${JSON.stringify(this.#saved, null, 2)}\n`, { mode: 0o600 });
    if (this.#saved.on) this.sync();
    return this.state();
  }

  /** Copies what is new or changed into the folder; returns how many files it copied. */
  sync(): number {
    if (!this.#saved.on) return 0;
    let files = 0;
    try {
      mkdirSync(this.#saved.dir, { recursive: true });
      for (const s of this.#sources()) if (existsSync(s.dir)) files += copyNew(s.dir, join(this.#saved.dir, folderName(s.name)));
      this.#why = null;
      this.#last = { at: this.#now(), files };
    } catch (e) {
      this.#why = `Could not copy to ${this.#saved.dir}: ${e instanceof Error ? e.message : String(e)}`;
    }
    return files;
  }
}

/** Every file under `from` that `to` lacks, or holds at another size or time, copied across (links skipped). */
function copyNew(from: string, to: string): number {
  let n = 0;
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const a = join(from, e.name);
    const b = join(to, e.name);
    const st = lstatSync(a);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) n += copyNew(a, b);
    else if (st.isFile()) {
      const there = existsSync(b) ? statSync(b) : null;
      if (there && there.size === st.size && Math.abs(there.mtimeMs - st.mtimeMs) < 1) continue;
      mkdirSync(to, { recursive: true });
      copyFileSync(a, b);
      utimesSync(b, st.atime, st.mtime);
      n++;
    }
  }
  return n;
}
