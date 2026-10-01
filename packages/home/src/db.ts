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

/** Runs `fn` in one transaction (the home is the only writer, so IMMEDIATE never waits). Called
 * inside another transaction, it joins that one. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
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
