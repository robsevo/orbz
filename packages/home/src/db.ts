// The home's one database. SQLite in WAL mode with EXCLUSIVE locking: the first write takes a
// file lock that is held until the process exits, so a second home on the same data directory is
// refused by SQLite itself, on every OS, and a crashed home leaves no stale lock behind.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class HomeLockedError extends Error {
  constructor(dataDir: string) {
    super(`another Orbs home is already running on ${dataDir}`);
    this.name = "HomeLockedError";
  }
}

// Each entry moves the schema one version forward. Never edit a shipped entry; add a new one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE events (
    seq          INTEGER PRIMARY KEY AUTOINCREMENT,
    at           INTEGER NOT NULL,
    type         TEXT    NOT NULL,
    orb          TEXT,
    conversation TEXT,
    data         TEXT    NOT NULL DEFAULT '{}'
  );
  CREATE INDEX events_type ON events (type, seq);
  CREATE TRIGGER events_no_update BEFORE UPDATE ON events
    BEGIN SELECT RAISE(ABORT, 'the event log is append-only'); END;
  CREATE TRIGGER events_no_delete BEFORE DELETE ON events
    BEGIN SELECT RAISE(ABORT, 'the event log is append-only'); END;

  CREATE TABLE orbs (
    id         TEXT PRIMARY KEY,
    name       TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'idle',
    activity   TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    orb          TEXT    NOT NULL,
    conversation TEXT    NOT NULL,
    started_at   INTEGER NOT NULL,
    ended_at     INTEGER,
    outcome      TEXT
  );

  CREATE TABLE inbox (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    orb          TEXT    NOT NULL,
    conversation TEXT    NOT NULL,
    source       TEXT    NOT NULL,
    text         TEXT    NOT NULL,
    data         TEXT    NOT NULL DEFAULT '{}',
    fresh        INTEGER NOT NULL DEFAULT 0,
    state        TEXT    NOT NULL DEFAULT 'queued',
    run          INTEGER,
    queued_at    INTEGER NOT NULL
  );
  CREATE INDEX inbox_open ON inbox (orb, state, id);

  CREATE TABLE schedules (
    id          TEXT PRIMARY KEY,
    orb         TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    cron        TEXT    NOT NULL,
    timezone    TEXT    NOT NULL,
    instruction TEXT    NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    last_due    INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE triggers (
    id          TEXT PRIMARY KEY,
    orb         TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    kind        TEXT    NOT NULL,
    config      TEXT    NOT NULL DEFAULT '{}',
    instruction TEXT    NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    cursor      TEXT,
    started     INTEGER NOT NULL DEFAULT 0,
    polled_at   INTEGER,
    created_at  INTEGER NOT NULL
  );
  CREATE TABLE trigger_seen (
    trigger TEXT NOT NULL,
    event   TEXT NOT NULL,
    PRIMARY KEY (trigger, event)
  );

  CREATE TABLE loop_state (
    name     TEXT PRIMARY KEY,
    last_due INTEGER NOT NULL
  );
  `,
  // v2 (PLAN 1.5): what the orb and the person said, per conversation, and the cards it paused on.
  `
  CREATE TABLE messages (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation TEXT    NOT NULL,
    orb          TEXT    NOT NULL,
    run          INTEGER,
    role         TEXT    NOT NULL,
    content      TEXT    NOT NULL DEFAULT '',
    tool_calls   TEXT,
    tool_call_id TEXT,
    meta         TEXT    NOT NULL DEFAULT '{}',
    at           INTEGER NOT NULL
  );
  CREATE INDEX messages_conversation ON messages (conversation, id);

  CREATE TABLE cards (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation  TEXT    NOT NULL,
    orb           TEXT    NOT NULL,
    run           INTEGER NOT NULL,
    kind          TEXT    NOT NULL,
    tool          TEXT    NOT NULL,
    call_id       TEXT    NOT NULL,
    assistant_msg INTEGER NOT NULL,
    title         TEXT    NOT NULL,
    detail        TEXT    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'pending',
    answer        TEXT,
    created_at    INTEGER NOT NULL,
    resolved_at   INTEGER
  );
  CREATE INDEX cards_open ON cards (conversation, status);
  `,
];

/** Opens (and migrates) `<dataDir>/home.db`, taking the one-writer lock. */
export function openDb(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "home.db"), { timeout: 0 });
  try {
    // EXCLUSIVE must be set before WAL is entered, so WAL keeps no shared-memory file for others.
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("BEGIN IMMEDIATE"); // the write lock, held from here until close
    try {
      migrate(db);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (e) {
    db.close();
    if (e instanceof Error && /database is locked|SQLITE_BUSY/i.test(e.message)) throw new HomeLockedError(dataDir);
    throw e;
  }
  return db;
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec(MIGRATIONS[v]!);
    db.exec(`PRAGMA user_version = ${v + 1}`);
  }
}

const commitHooks = new WeakMap<DatabaseSync, (() => void)[]>();

/** Runs `fn` once the current transaction has committed (now, if there is none); never if it
 * rolls back. What the outside world is told must not run ahead of what is on disk. */
export function afterCommit(db: DatabaseSync, fn: () => void): void {
  if (!db.isTransaction) return fn();
  const q = commitHooks.get(db) ?? [];
  q.push(fn);
  commitHooks.set(db, q);
}

/** Runs `fn` in one transaction (the home is the only writer, so IMMEDIATE never waits). Called
 * inside another transaction, it joins that one. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  let out: T;
  try {
    out = fn();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    commitHooks.delete(db);
    throw e;
  }
  const hooks = commitHooks.get(db) ?? [];
  commitHooks.delete(db);
  for (const h of hooks) h();
  return out;
}

export function parseJson(text: unknown): Record<string, unknown> {
  if (typeof text !== "string") return {};
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
