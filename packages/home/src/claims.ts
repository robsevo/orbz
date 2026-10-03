// Team claims and handoffs (PLAN 5.1), Ash's tools/ai_handoff.py rules in the home: orbs working on
// one plan in one session never hold the same row or the same file.
//
//   claim     rows and paths for one orb, refused when they meet another orb's live claim: a row he
//             holds, a path inside a folder he holds, or a folder holding one of his paths
//   pulse     every act of his renews his claim; one silent for STALE_MS is stale: shown, and
//             another orb or the person may take it over (recover). Never silently dropped: a
//             stalled orb still did work
//   holds     who holds a path: a write there by anyone else is refused, naming him
//   finish    hands his rows off: what changed (the files he touched since he claimed), which tests
//             ran for his rows (the board's own results), and the next row nobody holds
//
// Kept in the home's database, every change an event (claim.*), so the board and its holders
// replay to the same state.
import type { DatabaseSync } from "node:sqlite";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Clock } from "./clock.ts";
import { tx } from "./db.ts";
import type { EventLog } from "./events.ts";

export const STALE_MS = 90 * 60_000;

export class ClaimError extends Error {}

export type Claim = { id: number; session: number; plan: number; orb: string; rows: string[]; paths: string[]; started: number; pulse: number; finished: number | null; stale: boolean };
export type Handoff = { orb: string; plan: number; rows: string[]; changed: string[]; tests: { row: string; command: string | null; box: string }[]; next: string | null };

type Row = { id: number; session: number; plan: number; orb: string; rows: string; paths: string; started: number; pulse: number; finished: number | null; snapshot: string };

/** A workspace path as claims compare it: relative, forward slashes, no "./", no trailing "/". */
export function normal(p: string): string {
  const n = p.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/\/+$/, "").replace(/\/{2,}/g, "/");
  if (!n || n.startsWith("/") || n.split("/").includes("..")) throw new ClaimError(`${p} is not a path in the team's workspace`);
  return n;
}
/** Whether one claimed path covers the other (the same, or one a folder of the other). */
const meets = (a: string, b: string): boolean => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/** Every file under `root`, by its relative path, with its size and time: what "changed" is read from. */
function files(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string): void => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(d, n);
      try {
        const s = statSync(p);
        if (s.isDirectory()) walk(p);
        else out[relative(root, p).split(sep).join("/")] = `${s.size}:${Math.round(s.mtimeMs)}`;
      } catch {
        // gone since it was listed
      }
      if (Object.keys(out).length > 5000) return;
    }
  };
  walk(root);
  return out;
}

export class Claims {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #clock: Clock;
  readonly #workspace: (session: number) => string;

  constructor(db: DatabaseSync, events: EventLog, clock: Clock, workspace: (session: number) => string) {
    this.#db = db;
    this.#events = events;
    this.#clock = clock;
    this.#workspace = workspace;
  }

  #claim(r: Row): Claim {
    const pulse = r.pulse;
    return { id: r.id, session: r.session, plan: r.plan, orb: r.orb, rows: JSON.parse(r.rows) as string[], paths: JSON.parse(r.paths) as string[], started: r.started, pulse, finished: r.finished, stale: r.finished === null && this.#clock.now() - pulse > STALE_MS };
  }

  /** The live claims of a session (not finished), stale ones marked. */
  live(session: number): Claim[] {
    return (this.#db.prepare("SELECT * FROM claims WHERE session = ? AND finished IS NULL ORDER BY id").all(session) as Row[]).map((r) => this.#claim(r));
  }

  /** Claims rows and paths for an orb, or says who holds what it wants. */
  claim(o: { session: number; plan: number; orb: string; rows: string[]; paths: string[] }): Claim {
    const rows = [...new Set(o.rows.map((r) => r.trim()).filter(Boolean))];
    const paths = [...new Set(o.paths.map(normal))];
    if (!rows.length) throw new ClaimError("a claim names the rows it is for");
    for (const c of this.live(o.session)) {
      if (c.orb === o.orb) continue;
      const row = rows.find((r) => c.plan === o.plan && c.rows.includes(r));
      if (row) throw new ClaimError(`row ${row} is ${c.orb}'s${c.stale ? " (stale: it can be recovered)" : ""}`);
      for (const p of paths) {
        const held = c.paths.find((h) => meets(p, h));
        if (held) throw new ClaimError(`${p} meets ${held}, which ${c.orb} holds${c.stale ? " (stale: it can be recovered)" : ""}`);
      }
    }
    const now = this.#clock.now();
    let id = 0;
    tx(this.#db, () => {
      // one live claim per orb per session: a new one adds to it
      const mine = this.live(o.session).find((c) => c.orb === o.orb && c.plan === o.plan);
      if (mine) {
        const allRows = [...new Set([...mine.rows, ...rows])];
        const allPaths = [...new Set([...mine.paths, ...paths])];
        this.#db.prepare("UPDATE claims SET rows = ?, paths = ?, pulse = ? WHERE id = ?").run(JSON.stringify(allRows), JSON.stringify(allPaths), now, mine.id);
        id = mine.id;
      } else {
        const r = this.#db
          .prepare("INSERT INTO claims (session, plan, orb, rows, paths, started, pulse, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(o.session, o.plan, o.orb, JSON.stringify(rows), JSON.stringify(paths), now, now, JSON.stringify(files(this.#workspace(o.session))));
        id = Number(r.lastInsertRowid);
      }
      this.#events.append("claim.made", { session: o.session, plan: o.plan, orb: o.orb, rows, paths, id }, { orb: o.orb });
    });
    return this.#claim(this.#db.prepare("SELECT * FROM claims WHERE id = ?").get(id) as Row);
  }

  /** Who holds `path` in a session (a live claim of a path that meets it), or null. */
  holder(session: number, path: string): Claim | null {
    let p: string;
    try {
      p = normal(path);
    } catch {
      return null;
    }
    return this.live(session).find((c) => c.paths.some((h) => meets(p, h))) ?? null;
  }

  /** His act renews his claim: not stale for another STALE_MS. */
  pulse(session: number, orb: string): void {
    this.#db.prepare("UPDATE claims SET pulse = ? WHERE session = ? AND orb = ? AND finished IS NULL").run(this.#clock.now(), session, orb);
  }

  /** A stale claim taken over: by another orb (it becomes his) or by the person (it is let go). */
  recover(session: number, id: number, by: string): Claim | null {
    const c = this.live(session).find((x) => x.id === id);
    if (!c) throw new ClaimError(`no live claim ${id}`);
    if (!c.stale) throw new ClaimError(`${c.orb}'s claim is not stale: it can be taken over after ${Math.round(STALE_MS / 60_000)} minutes without a sign of ${c.orb}`);
    const now = this.#clock.now();
    tx(this.#db, () => {
      if (by === "you") this.#db.prepare("UPDATE claims SET finished = ? WHERE id = ?").run(now, id);
      else this.#db.prepare("UPDATE claims SET orb = ?, pulse = ? WHERE id = ?").run(by, now, id);
      this.#events.append("claim.recovered", { session, id, from: c.orb, by }, { orb: by === "you" ? c.orb : by });
    });
    return by === "you" ? null : this.#claim(this.#db.prepare("SELECT * FROM claims WHERE id = ?").get(id) as Row);
  }

  /** Hands his rows off: what changed since he claimed, the tests the board ran for his rows, and
   * the next row of the plan that nobody holds and is not done. */
  finish(session: number, orb: string, board: { row: string; test: boolean; box: string; command: string | null }[]): Handoff {
    const r = this.#db.prepare("SELECT * FROM claims WHERE session = ? AND orb = ? AND finished IS NULL ORDER BY id DESC").get(session, orb) as Row | undefined;
    if (!r) throw new ClaimError(`${orb} holds nothing to hand off`);
    const c = this.#claim(r);
    const before = JSON.parse(r.snapshot) as Record<string, string>;
    const after = files(this.#workspace(session));
    const changed = Object.keys(after).filter((p) => before[p] !== after[p]).sort();
    const tests = c.rows.map((row) => {
      const f = board.find((b) => b.row === row && !b.test);
      return { row, command: f?.command ?? null, box: f?.box ?? "[ ]" };
    });
    const held = new Set(this.live(session).filter((x) => x.id !== c.id).flatMap((x) => x.rows));
    const next = board.find((b) => !b.test && b.box !== "[x]" && !held.has(b.row) && !c.rows.includes(b.row))?.row ?? null;
    const handoff: Handoff = { orb, plan: c.plan, rows: c.rows, changed, tests, next };
    tx(this.#db, () => {
      this.#db.prepare("UPDATE claims SET finished = ? WHERE id = ?").run(this.#clock.now(), c.id);
      this.#events.append("claim.handed_off", { session, id: c.id, ...handoff }, { orb });
    });
    return handoff;
  }
}

/** Who holds what in a session as its events tell it (claim.made, claim.handed_off,
 * claim.recovered): the table must be exactly what the log replays to (PLAN 5.1_t). */
export function replayClaims(events: EventLog, session: number): { id: number; orb: string; plan: number; rows: string[]; paths: string[] }[] {
  const live = new Map<number, { id: number; orb: string; plan: number; rows: string[]; paths: string[] }>();
  const all = ["claim.made", "claim.handed_off", "claim.recovered"].flatMap((t) => events.ofType(t)).filter((e) => Number(e.data.session) === session).sort((a, b) => a.seq - b.seq);
  for (const e of all) {
    const id = Number(e.data.id);
    if (e.type === "claim.made") {
      const c = live.get(id) ?? { id, orb: String(e.data.orb), plan: Number(e.data.plan), rows: [], paths: [] };
      c.rows = [...new Set([...c.rows, ...(e.data.rows as string[])])];
      c.paths = [...new Set([...c.paths, ...(e.data.paths as string[])])];
      live.set(id, c);
    } else if (e.type === "claim.handed_off" || e.data.by === "you") live.delete(id);
    else {
      const c = live.get(id);
      if (c) c.orb = String(e.data.by);
    }
  }
  return [...live.values()].sort((a, b) => a.id - b.id);
}
