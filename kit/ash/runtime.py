#!/usr/bin/env python3
"""runtime — protocol v1. One envelope, one journal, one authenticated source.

PLAN 6.1-6.5. Today's runtime is 32 overwriteable file slots. Two of them have an ack; the
rest are fire-and-forget. `t` is the version field on nine of them and it is WALL-CLOCK, so
an NTP step backwards stalls every high-water reader until the clock catches up. Nothing is
event-driven — the three `fs.watch` calls are hints with a poll beside them doing the real
work, and the code says so.

What that costs, measured rather than assumed:

  * `typed.json` — two sends inside one 250 ms tick and the first is GONE, no error on
    either side, and no way for the reader to know it happened.
  * `tutor-reply.json` — the panel button and the spoken "next" both write it; two answers
    inside 250 ms and one is swallowed.
  * `ashd-control.json` — ashd is both a reader and a writer, so a sleep and a typed wake at
    the same moment silently reverse each other.
  * and D56: a permission question is answered by whoever writes the file first, which
    includes an `ash` turn holding a Write tool. A turn can approve itself.

The last one is why `source` here is not a string the sender chooses. It is bound at
connect time, and a message cannot claim to be from somewhere it is not.

SQLite in WAL mode is the journal, not a hand-rolled append log plus snapshot: it gives
durability, crash-safe resume, dedup on a unique index, and queryable history for free, and
it is in the standard library.
"""
import json
import os
import sqlite3
import threading
import time
import uuid
from pathlib import Path
import statepaths  # noqa: E402 — PLAN 5.9: one root, and ASH_STATE_HOME moves it

SCHEMA_VERSION = 1
CFG = statepaths.config()
RUN = CFG/"run"
DB = RUN/"runtime.db"

# Every message is one of these. A type outside the set is refused at the door: an unknown
# type is not a message to ignore, it is a producer that has drifted.
TYPES = {
    "turn.start", "turn.state", "turn.end", "turn.abort",
    "command", "command.ack", "command.result",
    "task.state", "artifact", "health", "seat.decision",
    "approval.request", "approval.answer",
    # The teaching surface (PLAN 12.2). `tutor-state.json` has three writers — the lesson
    # process, ashd on a spoken "next", and the orb clearing it when a lesson ends — and its
    # only version field was wall-clock `t`. Journalling the change is what gives it a
    # monotonic `sequence`; the slot stays the transport until 6.15 retires it.
    "tutor.state",
    # A turn showed a learning signal and was written to the voice journal (PLAN 14.1). Not
    # `turn.state`: that field is one of TURN_STATES and a journal entry is not a state the
    # turn is in. Reusing it meant `validate` refused every event while the file write
    # succeeded, so the protocol half was silently inert.
    "memory.journalled",
}

# The turn states. NOT an order: `next_state` guards the TERMINAL rule and nothing else, and
# the listing below was read as a sequence it never enforced (`running -> listening` is
# permitted, and has to be — a follow-up re-opens the mic mid-turn, and a multi-step task
# goes running -> speaking -> running). Claiming an order that is not enforced is worse than
# claiming none: a reader trusts it. Raised by Codex's second verification pass.
TURN_STATES = ("queued", "listening", "transcribing", "planning", "awaiting_approval",
               "running", "speaking", "completed", "failed", "cancelled")
TERMINAL = {"completed", "failed", "cancelled"}


class ProtocolError(ValueError):
    """A message that must not be accepted. Raised rather than logged-and-dropped: a
    silently ignored message is exactly the failure this protocol replaces."""


def _now():
    return time.time()


def envelope(type_, source, payload=None, *, session_id="", turn_id="", task_id=""):
    """Build a message. `sequence` is assigned by the journal, not here — a producer cannot
    choose its own ordering."""
    if type_ not in TYPES:
        raise ProtocolError(f"unknown type {type_!r}")
    return {
        "schema_version": SCHEMA_VERSION,
        "event_id": uuid.uuid4().hex,
        "timestamp": _now(),
        "source": source,
        "type": type_,
        "session_id": session_id,
        "turn_id": turn_id,
        "task_id": task_id,
        "sequence": None,
        "payload": payload if payload is not None else {},
    }


def validate(msg):
    """Raise ProtocolError unless `msg` is acceptable. Fail closed: a message that cannot be
    understood is refused, never partly applied."""
    if not isinstance(msg, dict):
        raise ProtocolError("not an object")
    v = msg.get("schema_version")
    if v != SCHEMA_VERSION:
        raise ProtocolError(f"schema_version {v!r}, this build speaks {SCHEMA_VERSION}")
    # PRESENCE, not truthiness. `timestamp = 0.0` is a valid epoch instant and `not 0.0` is
    # True, so the first version of this refused a legitimate message — and the message it
    # refused was the one testing that a clock step backwards cannot stall a reader, which
    # is the whole reason `sequence` exists.
    for f in ("event_id", "source", "type"):
        if not str(msg.get(f) or "").strip():
            raise ProtocolError(f"missing {f}")
    if not isinstance(msg.get("timestamp"), (int, float)):
        raise ProtocolError("missing or non-numeric timestamp")
    if msg["type"] not in TYPES:
        raise ProtocolError(f"unknown type {msg['type']!r}")
    if not isinstance(msg.get("payload", {}), dict):
        raise ProtocolError("payload is not an object")
    if msg["type"] == "turn.state":
        st = msg["payload"].get("state")
        if st not in TURN_STATES:
            raise ProtocolError(f"unknown turn state {st!r}")
    return msg


class _Serialized:
    """One lock around the connection: each statement runs, and its rows are fetched, while
    holding it (Orbs: Python 3.13 shares statements between threads; see kit/ash/CARRIED.md)."""

    def __init__(self, conn):
        self._conn = conn
        self._lock = threading.RLock()

    def execute(self, sql, params=()):
        with self._lock:
            cur = self._conn.execute(sql, params)
            return _Rows(cur.fetchall(), cur.lastrowid, cur.rowcount)

    def close(self):
        with self._lock:
            self._conn.close()


class _Rows(list):
    def __init__(self, rows, lastrowid, rowcount):
        super().__init__(rows)
        self.lastrowid, self.rowcount = lastrowid, rowcount

    def fetchone(self):
        return self[0] if self else None

    def fetchall(self):
        return list(self)


class Journal:
    """Append-only, crash-safe, deduplicating. `sequence` is a monotonic integer assigned
    here — NOT wall-clock, because the thing being replaced used wall-clock and an NTP step
    backwards stalled every reader."""

    def __init__(self, path=None):
        # RESOLVED AT CALL TIME. `path=DB` bound the module global at def time, so a test
        # that rebinds `runtime.DB` — the documented way to redirect this store — got the
        # real `~/ash/voice/run/runtime.db` anyway, silently. That is D99b's mechanism
        # in the one place left holding it: `adapters.candidates()` was fixed for exactly
        # this and the Journal underneath it was not.
        path = Path(DB if path is None else path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = _Serialized(sqlite3.connect(str(path), isolation_level=None, check_same_thread=False))
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS events (
                sequence   INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id   TEXT NOT NULL UNIQUE,
                timestamp  REAL NOT NULL,
                source     TEXT NOT NULL,
                type       TEXT NOT NULL,
                session_id TEXT, turn_id TEXT, task_id TEXT,
                payload    TEXT NOT NULL
            )""")
        self.db.execute("CREATE INDEX IF NOT EXISTS ix_turn ON events(turn_id, sequence)")

    def append(self, msg, *, source):
        """Journal a message and return it with its sequence. A duplicate event_id is
        accepted and returns the ORIGINAL — at-least-once delivery must execute once.

        `source` is REQUIRED and overrides whatever the message claims. It was optional, and
        omitting it persisted the claim verbatim — so the binding only happened when a caller
        remembered to ask for it, which is not a binding at all (reproduced by Codex's
        verification, 2026-09-20: `source="forged"` was accepted and stored). Required means
        every call site has to state, in writing, who it is vouching for.

        What that vouching is worth depends on the caller. `transport.Server` pins it at
        handshake from a real connection, so it is authenticated. `adapters` reads a legacy
        slot file that anyone able to write the file can produce, so it vouches only for
        WHICH SLOT the message came out of — recorded honestly as `orb:slot`, not as `orb`.
        D56 is what conflating those two costs.
        """
        msg = dict(msg)
        msg["source"] = source
        validate(msg)
        try:
            cur = self.db.execute(
                "INSERT INTO events(event_id,timestamp,source,type,session_id,turn_id,task_id,payload)"
                " VALUES(?,?,?,?,?,?,?,?)",
                (msg["event_id"], msg["timestamp"], msg["source"], msg["type"],
                 msg.get("session_id", ""), msg.get("turn_id", ""), msg.get("task_id", ""),
                 json.dumps(msg.get("payload", {}))))
            msg["sequence"] = cur.lastrowid
            return msg
        except sqlite3.IntegrityError:
            return self.by_event_id(msg["event_id"])

    def by_event_id(self, event_id):
        r = self.db.execute("SELECT * FROM events WHERE event_id=?", (event_id,)).fetchone()
        return self._row(r) if r else None

    def since(self, sequence=0, limit=1000):
        """Resume. A consumer keeps its last sequence and asks for what came after; it never
        has to reason about time."""
        rows = self.db.execute(
            "SELECT * FROM events WHERE sequence>? ORDER BY sequence LIMIT ?",
            (sequence, limit)).fetchall()
        return [self._row(r) for r in rows]

    # ── keeping it bounded (PLAN C6.5) ─────────────────────────────────────────────────
    # Nothing pruned this. It is 309 rows and 110 KB today, and it is append-only by design,
    # so "small" is a fact about how long the machine has been running rather than a property
    # of the store.
    #
    # PRUNING FIGHTS `since()`, and that is the whole difficulty. A consumer resumes by
    # asking for everything after its last sequence; delete under it and the events it never
    # saw are gone with no gap it can detect — a silent loss, which is the failure this
    # protocol replaced. Two guards, both deliberately conservative:
    #
    #   * TIME, not count, decides what may go. A consumer that is thirty days behind has
    #     already lost, and a restart is what brings one back — so age is the honest proxy
    #     for "nobody is still waiting for this".
    #   * A FLOOR of recent events is kept whatever their age. On a machine that has been off
    #     for two months every row is older than the window, and a store pruned to nothing
    #     would take the resume point with it.
    #
    # It is never automatic from here. `ashd` calls it once at startup, which is a natural
    # boundary — anything resuming across a daemon restart already re-reads from its own
    # watermark — and `baseline` reports the size so growth stays visible rather than being
    # discovered as a full disk.
    RETAIN_SECONDS = 30 * 86400
    RETAIN_MIN = 1000

    def prune(self, older_than=None, keep_min=None, now=None):
        """Drop events past the retention window, keeping a floor of recent ones.

        Returns (removed, kept). Never raises: a journal that cannot be pruned is a disk
        problem, not a reason to stop the daemon that was only tidying up.
        """
        older_than = self.RETAIN_SECONDS if older_than is None else older_than
        keep_min = self.RETAIN_MIN if keep_min is None else keep_min
        cutoff = (now if now is not None else time.time()) - older_than
        # No explicit lock, because `append` takes none either: this class leans on SQLite's
        # own locking with WAL, and adding a mutex on one method only would be a second,
        # weaker answer to a question already answered — and would not cover the other
        # process holding the same file open, which is the case that matters.
        try:
            # The floor first: the sequence of the keep_min-th newest event. Anything at or
            # above it stays whatever its timestamp says.
            row = self.db.execute(
                "SELECT sequence FROM events ORDER BY sequence DESC LIMIT 1 OFFSET ?",
                (keep_min - 1,)).fetchone()
            floor = row[0] if row else 0
            cur = self.db.execute(
                "DELETE FROM events WHERE timestamp < ? AND sequence < ?",
                (cutoff, floor))
            removed = cur.rowcount or 0
            kept = self.db.execute("SELECT COUNT(*) FROM events").fetchone()[0]
            return removed, kept
        except Exception:                                    # noqa: BLE001
            try:
                kept = self.db.execute("SELECT COUNT(*) FROM events").fetchone()[0]
            except Exception:
                kept = -1
            return 0, kept

    def turn(self, turn_id):
        rows = self.db.execute(
            "SELECT * FROM events WHERE turn_id=? ORDER BY sequence", (turn_id,)).fetchall()
        return [self._row(r) for r in rows]

    def last_sequence(self):
        r = self.db.execute("SELECT MAX(sequence) FROM events").fetchone()
        return r[0] or 0

    @staticmethod
    def _row(r):
        return {"sequence": r[0], "event_id": r[1], "timestamp": r[2], "source": r[3],
                "type": r[4], "session_id": r[5], "turn_id": r[6], "task_id": r[7],
                "payload": json.loads(r[8]), "schema_version": SCHEMA_VERSION}

    def close(self):
        self.db.close()


def next_state(current, wanted):
    """Guard a turn transition. Returns the new state or raises.

    A terminal turn stays terminal: the bug this prevents is a late event from a cancelled
    turn still speaking, which is the four-part stop's whole problem (D1).

    That is the ONLY rule here. It does not enforce an order between live states, because
    there is no single valid order — a follow-up re-opens the mic mid-turn, and a multi-step
    task runs, speaks, and runs again. Anything that needs ordering must state its own."""
    if current in TERMINAL:
        raise ProtocolError(f"turn is already {current}; {wanted!r} arrives too late")
    if wanted not in TURN_STATES:
        raise ProtocolError(f"unknown state {wanted!r}")
    return wanted
