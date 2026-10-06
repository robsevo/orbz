// The home's one database. SQLite in WAL mode with EXCLUSIVE locking: the first write takes a
// file lock that is held until the process exits, so a second home on the same data directory is
// refused by SQLite itself, on every OS, and a crashed home leaves no stale lock behind.
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class HomeLockedError extends Error {
  constructor(dataDir: string) {
    super(`another Orbz home is already running on ${dataDir}`);
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
  // v3 (PLAN 1.6): the owner's rules; each turn's one-way state (what untrusted content it read,
  // what the person opened again), kept here so a restart cannot wash a turn clean; why a card asks.
  `
  CREATE TABLE rules (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    orb        TEXT,
    text       TEXT    NOT NULL,
    decision   TEXT    NOT NULL,
    action     TEXT,
    source     TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    removed_at INTEGER
  );
  CREATE TABLE turns (
    id         TEXT PRIMARY KEY,
    taints     TEXT    NOT NULL DEFAULT '[]',
    approved   TEXT    NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL
  );
  ALTER TABLE cards ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';
  `,
  // v4 (PLAN 1.7): every plan that reached the person, kept from the moment it was shown, its
  // text never edited afterwards; only its status moves (submitted → approved / changed / saved /
  // declined).
  `
  CREATE TABLE plans (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    orb          TEXT    NOT NULL,
    conversation TEXT    NOT NULL,
    card         INTEGER,
    status       TEXT    NOT NULL,
    title        TEXT    NOT NULL,
    body         TEXT    NOT NULL,
    shown        TEXT    NOT NULL,
    objections   TEXT    NOT NULL DEFAULT '[]',
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE TRIGGER plans_body_frozen BEFORE UPDATE OF body, shown ON plans
    BEGIN SELECT RAISE(ABORT, 'a shown plan is history: its text is never edited'); END;
  `,
  // v5 (PLAN 1.8): an approved plan's board — every row's live box, the command that tests it,
  // and the evidence the home saw when it ran it.
  `
  CREATE TABLE board (
    plan       INTEGER NOT NULL,
    row        TEXT    NOT NULL,
    test       INTEGER NOT NULL,
    box        TEXT    NOT NULL,
    visual     INTEGER NOT NULL DEFAULT 0,
    command    TEXT,
    evidence   TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (plan, row)
  );
  `,
  // v6 (PLAN 3.9): what each orb does, which decides the part of the owner's constitution he loads
  `
  ALTER TABLE orbs ADD COLUMN specialty TEXT NOT NULL DEFAULT 'general';
  `,
  // v7 (PLAN 2.4): what each orb looks like (the app's character: shape, eyes, hat, colour...),
  // when he was let go (archived, never deleted: decision 12), and what the orbs know about the
  // person ("about you", shared by every orb)
  `
  ALTER TABLE orbs ADD COLUMN look TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE orbs ADD COLUMN let_go_at INTEGER;
  CREATE TABLE about (
    key        TEXT PRIMARY KEY,
    value      TEXT    NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // v8 (PLAN 2.9): sessions, a piece of work with a Brainstorm and a Floor, and which orbs work
  // each, in the order they take their turns
  `
  CREATE TABLE work_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    archived_at INTEGER
  );
  CREATE TABLE work_members (
    session INTEGER NOT NULL,
    tab     TEXT    NOT NULL,
    orb     TEXT    NOT NULL,
    turn    INTEGER NOT NULL,
    PRIMARY KEY (session, tab, orb)
  );
  `,
  // v9 (PLAN 2.11): the notification centre: the bills and reminders an orb keeps for you, and the
  // notices out (each once: its key), put away on one device for all
  `
  CREATE TABLE reminders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    orb          TEXT    NOT NULL,
    kind         TEXT    NOT NULL CHECK (kind IN ('bill', 'reminder')),
    title        TEXT    NOT NULL,
    due          TEXT    NOT NULL,
    amount       TEXT,
    ahead_days   INTEGER NOT NULL,
    conversation TEXT,
    created_at   INTEGER NOT NULL,
    done_at      INTEGER
  );
  CREATE TABLE notices (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    key          TEXT    NOT NULL UNIQUE,
    kind         TEXT    NOT NULL,
    orb          TEXT    NOT NULL,
    conversation TEXT,
    card         INTEGER,
    reminder     INTEGER,
    title        TEXT    NOT NULL,
    detail       TEXT    NOT NULL DEFAULT '',
    due          TEXT,
    at           INTEGER NOT NULL,
    put_away_at  INTEGER
  );
  `,
  // v10: the devices signed in to the app (PLAN 2.7), each revocable, and the owner's passkeys
  `
  CREATE TABLE devices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash  TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL,
    via         TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    seen_at     INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    revoked_at  INTEGER
  );
  CREATE TABLE passkeys (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    credential  TEXT    NOT NULL UNIQUE,
    public_key  TEXT    NOT NULL,
    sign_count  INTEGER NOT NULL DEFAULT 0,
    name        TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    used_at     INTEGER
  );
  `,
  // v11 (PLAN 4.1): the page a visual row builds, which pagecheck must pass before it is ticked
  `
  ALTER TABLE board ADD COLUMN page TEXT;
  `,
  // v12 (PLAN 5.1, 5.4): a team's claims on a plan's rows and files, the changes agreed to a plan,
  // and a row's review
  `
  CREATE TABLE claims (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    session   INTEGER NOT NULL,
    plan      INTEGER NOT NULL,
    orb       TEXT    NOT NULL,
    rows      TEXT    NOT NULL,
    paths     TEXT    NOT NULL,
    started   INTEGER NOT NULL,
    pulse     INTEGER NOT NULL,
    finished  INTEGER,
    snapshot  TEXT    NOT NULL
  );
  CREATE INDEX claims_live ON claims (session, finished);
  CREATE TABLE amendments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session     INTEGER NOT NULL,
    plan        INTEGER NOT NULL,
    proposer    TEXT    NOT NULL,
    row         TEXT    NOT NULL,
    feature     TEXT    NOT NULL,
    description TEXT    NOT NULL,
    test        TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    agreed_by   TEXT,
    agreed_at   INTEGER
  );
  ALTER TABLE board ADD COLUMN review TEXT;
  `,
  // v13 (PLAN 5.8): the recruiter: the positions you are hiring for, who applied (a seed the app's
  // dice make a whole orb of), and what was said in an interview
  `
  CREATE TABLE positions (
    specialty TEXT PRIMARY KEY,
    opened_at INTEGER NOT NULL
  );
  CREATE TABLE applicants (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    specialty  TEXT    NOT NULL,
    seed       INTEGER NOT NULL,
    day        TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    state      TEXT    NOT NULL CHECK (state IN ('waiting', 'hired', 'passed', 'gone')),
    orb        TEXT,
    settled_at INTEGER
  );
  CREATE INDEX applicants_by_day ON applicants (specialty, day);
  CREATE TABLE interviews (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    applicant INTEGER NOT NULL,
    role      TEXT    NOT NULL CHECK (role IN ('you', 'orb')),
    text      TEXT    NOT NULL,
    at        INTEGER NOT NULL
  );
  `,
  // v14 (PLAN 5.7): school: an orb's terms, each subject (its syllabus and its exam, kept from every
  // lesson), the lessons, the notebook (only notes that raised the exam) and every sitting
  `
  CREATE TABLE school_terms (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    orb        TEXT    NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at   INTEGER,
    pass_mark  REAL    NOT NULL
  );
  CREATE UNIQUE INDEX school_one_open_term ON school_terms (orb) WHERE ended_at IS NULL;
  CREATE TABLE school_subjects (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    term         INTEGER NOT NULL,
    kind         TEXT    NOT NULL CHECK (kind IN ('maths', 'cpp', 'speech', 'talking', 'ai', 'custom')),
    name         TEXT    NOT NULL,
    seed         INTEGER NOT NULL,
    syllabus     TEXT,
    exam         TEXT,
    kept_score   REAL,
    graduated_at INTEGER,
    trouble      TEXT
  );
  CREATE TABLE school_lessons (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    subject INTEGER NOT NULL,
    topic   TEXT    NOT NULL,
    text    TEXT    NOT NULL,
    at      INTEGER NOT NULL
  );
  CREATE TABLE school_notes (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    subject INTEGER NOT NULL,
    text    TEXT    NOT NULL,
    at      INTEGER NOT NULL
  );
  CREATE TABLE school_sittings (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    subject   INTEGER NOT NULL,
    at        INTEGER NOT NULL,
    score     REAL,
    state     TEXT    NOT NULL CHECK (state IN ('graded', 'waiting', 'void')),
    answers   TEXT    NOT NULL,
    candidate TEXT,
    kept      INTEGER,
    starting  INTEGER NOT NULL DEFAULT 0
  );
  `,
  // v15 (PLAN 3.12): the reading library: the sources an orb follows (each one's reach: a site and a
  // folder of it), the pages read from them (the words, their validators for a conditional ask, when
  // each was read and last changed), the words indexed for search (FTS5, kept in step by triggers),
  // and each site's robots.txt as last fetched (RFC 9309: kept a day).
  `
  CREATE TABLE reading_sources (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    orb          TEXT    NOT NULL,
    url          TEXT    NOT NULL UNIQUE,
    host         TEXT    NOT NULL,
    prefix       TEXT    NOT NULL,
    title        TEXT    NOT NULL DEFAULT '',
    why          TEXT    NOT NULL DEFAULT '',
    every_days   INTEGER NOT NULL DEFAULT 1,
    added_at     INTEGER NOT NULL,
    last_read_at INTEGER,
    next_at      INTEGER NOT NULL,
    failures     INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT
  );
  CREATE TABLE reading_pages (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    source        INTEGER NOT NULL,
    url           TEXT    NOT NULL UNIQUE,
    title         TEXT    NOT NULL DEFAULT '',
    text          TEXT    NOT NULL DEFAULT '',
    hash          TEXT    NOT NULL DEFAULT '',
    etag          TEXT,
    last_modified TEXT,
    depth         INTEGER NOT NULL DEFAULT 0,
    fetched_at    INTEGER NOT NULL,
    changed_at    INTEGER NOT NULL
  );
  CREATE INDEX reading_pages_source ON reading_pages (source);
  CREATE VIRTUAL TABLE reading_text USING fts5(title, text, content = 'reading_pages', content_rowid = 'id', tokenize = 'porter unicode61');
  CREATE TRIGGER reading_pages_ai AFTER INSERT ON reading_pages BEGIN
    INSERT INTO reading_text (rowid, title, text) VALUES (new.id, new.title, new.text);
  END;
  CREATE TRIGGER reading_pages_ad AFTER DELETE ON reading_pages BEGIN
    INSERT INTO reading_text (reading_text, rowid, title, text) VALUES ('delete', old.id, old.title, old.text);
  END;
  CREATE TRIGGER reading_pages_au AFTER UPDATE OF title, text ON reading_pages BEGIN
    INSERT INTO reading_text (reading_text, rowid, title, text) VALUES ('delete', old.id, old.title, old.text);
    INSERT INTO reading_text (rowid, title, text) VALUES (new.id, new.title, new.text);
  END;
  CREATE TABLE reading_robots (
    origin     TEXT    PRIMARY KEY,
    fetched_at INTEGER NOT NULL,
    status     TEXT    NOT NULL CHECK (status IN ('ok', 'unavailable', 'unreachable')),
    body       TEXT    NOT NULL DEFAULT ''
  );
  `,
  // v16 (PLAN 5.9): office life: each orb's traits as the app's DNA has them, every friendship (a pair,
  // in order, its number from -100 to 100), every meeting, and the lessons friends offer each other,
  // which wait for the person's yes.
  `
  CREATE TABLE orb_traits (
    orb    TEXT    PRIMARY KEY,
    traits TEXT    NOT NULL,
    at     INTEGER NOT NULL
  );
  CREATE TABLE friendships (
    a        TEXT    NOT NULL,
    b        TEXT    NOT NULL,
    score    INTEGER NOT NULL DEFAULT 0,
    meetings INTEGER NOT NULL DEFAULT 0,
    last_at  INTEGER,
    PRIMARY KEY (a, b),
    CHECK (a < b)
  );
  CREATE TABLE meetings (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    at     INTEGER NOT NULL,
    until  INTEGER NOT NULL,
    a      TEXT    NOT NULL,
    b      TEXT    NOT NULL,
    kind   TEXT    NOT NULL CHECK (kind IN ('coffee', 'ideas', 'game', 'lesson')),
    place  TEXT    NOT NULL,
    winner TEXT,
    delta  INTEGER NOT NULL,
    score  INTEGER NOT NULL
  );
  CREATE INDEX meetings_pair ON meetings (a, b);
  CREATE TABLE shared_lessons (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    at         INTEGER NOT NULL,
    from_orb   TEXT    NOT NULL,
    to_orb     TEXT    NOT NULL,
    line       TEXT    NOT NULL,
    state      TEXT    NOT NULL CHECK (state IN ('waiting', 'kept', 'dropped')),
    settled_at INTEGER
  );
  ALTER TABLE notices ADD COLUMN lesson INTEGER;
  `,
];

/** The home's data is the person's: the folder is theirs alone (0700) and so is the database
 * (0600), whatever the umask, and a home made before this had its looser modes tightened when it
 * opens. A folder that was already there with other things in it, and is not a home, keeps its
 * mode (it is the person's own folder); the database in it is still theirs alone. */
function makePrivate(dataDir: string): string {
  const fresh = !existsSync(dataDir);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, "home.db");
  if (process.platform === "win32") return file;
  if (fresh || existsSync(file) || readdirSync(dataDir).length === 0) chmodSync(dataDir, 0o700);
  // made owner-only before SQLite opens it: SQLite gives its WAL file the database's mode
  closeSync(openSync(file, "a", 0o600));
  for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) chmodSync(f, 0o600);
  return file;
}

/** Opens (and migrates) `<dataDir>/home.db`, taking the one-writer lock. */
export function openDb(dataDir: string): DatabaseSync {
  const db = new DatabaseSync(makePrivate(dataDir), { timeout: 0 });
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
