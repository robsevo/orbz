#!/usr/bin/env python3
"""learn_ledger — what changed, who changed it, and how to put it back (PLAN 20.6).

Append-only JSONL beside `seat-decisions.jsonl`, the pattern this house already runs. Each
entry names the actor (`review`/`gym`/`agent`/`user`), the action, the evidence, and the
before/after `{path, sha256}` of every file it touched. Contents are **content-addressed**,
so a hundred entries touching one unchanged file cost one blob rather than a hundred copies.

**The asymmetry is deliberate, and it is the whole design.**

  `record()` is TELEMETRY. A ledger that cannot be written must never block the mutation —
  the product does not stop because its logbook is full.

  `capture()` is the SAFETY NET, and it FAILS CLOSED. If the before-state cannot be written,
  nothing changes. An undo you cannot take is worse than a change you did not make.

Those two rules point in opposite directions on purpose. A ledger that failed closed on both
would stop the product the first time a disk filled; one that failed open on both would lose
the undo exactly when it was needed.
"""
import hashlib
import json
import os
import threading
import time
import uuid
from pathlib import Path
import statepaths  # noqa: E402 — PLAN 5.9: one root, and ASH_STATE_HOME moves it

HOME = Path(os.environ.get("ORBS_BRAIN") or os.environ.get("ASH_BRAIN_HOME") or Path.home()/".orbs"/"brain")
LEDGER = statepaths.config()/"learning-ledger.jsonl"
BLOBS = statepaths.config()/"learning-blobs"

ACTORS = ("review", "gym", "agent", "user")


class CaptureFailed(RuntimeError):
    """The before-state could not be written, so the mutation must not happen. Raised, not
    returned: a caller that ignores a return value is how a safety net becomes decorative."""


def sha(data):
    if isinstance(data, str):
        data = data.encode()
    return hashlib.sha256(data).hexdigest()


class Ledger:
    def __init__(self, path=None, blobs=None):
        self.path = Path(path or LEDGER)
        self.blobs = Path(blobs or BLOBS)
        self._lock = threading.Lock()

    # -- the blob store ------------------------------------------------------------------
    def put_blob(self, data):
        """Store bytes by their hash. Writing the same content twice costs nothing."""
        if isinstance(data, str):
            data = data.encode()
        h = sha(data)
        self.blobs.mkdir(parents=True, exist_ok=True)
        dst = self.blobs/h
        if dst.exists():
            return h                     # already have it — this is the whole point
        tmp = dst.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, dst)
        return h

    def get_blob(self, h):
        try:
            return (self.blobs/h).read_bytes()
        except OSError:
            return None

    # -- capture: FAILS CLOSED ------------------------------------------------------------
    def capture(self, paths):
        """The before-state of every path, blobbed. Raises if any part cannot be stored.

        A missing file is a legitimate before-state — it is how a CREATE is undone — and is
        recorded as `None` rather than skipped. Skipping it would make rollback leave the
        new file in place, which is not a rollback.
        """
        before = []
        for p in paths:
            p = Path(p)
            try:
                if p.exists():
                    data = p.read_bytes()
                    before.append({"path": str(p), "sha256": self.put_blob(data)})
                else:
                    before.append({"path": str(p), "sha256": None})
            except OSError as e:
                raise CaptureFailed(
                    f"cannot capture {p}: {type(e).__name__}: {e}. Nothing was changed — an "
                    f"undo you cannot take is worse than a change you did not make.") from e
        return before

    # -- record: TELEMETRY, never fatal ---------------------------------------------------
    def record(self, *, actor, action, before, after=None, evidence="", candidate=None):
        """Append one entry. Returns its id, or None if it could not be written.

        NEVER raises. The mutation has already happened by the time this is called, and
        failing here would leave the product broken over a logbook.
        """
        entry = {
            "id": uuid.uuid4().hex[:16], "t": time.time(),
            "actor": actor if actor in ACTORS else f"unknown:{actor}",
            "action": action, "evidence": evidence, "candidate": candidate,
            "before": before or [], "after": after or [],
        }
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.path, "a") as f:
                f.write(json.dumps(entry) + "\n")
            return entry["id"]
        except OSError:
            return None

    def entries(self):
        try:
            return [json.loads(l) for l in self.path.read_text().splitlines() if l.strip()]
        except (OSError, ValueError):
            return []

    def entry(self, eid):
        return next((e for e in self.entries() if e["id"] == eid), None)

    # -- the mutation, both halves in the right order -------------------------------------
    def mutate(self, paths, *, actor, action, evidence="", candidate=None):
        """Context manager: capture (fail closed), let the caller change things, record.

        Using this is what keeps the asymmetry right. Calling `record` without `capture`
        gives a history with no undo, and both are easy to get wrong by hand.
        """
        return _Mutation(self, list(paths), actor, action, evidence, candidate)

    # -- rollback -------------------------------------------------------------------------
    def rollback(self, eid):
        """Restore exactly the files one entry touched. Returns the paths restored.

        Exactly those: a rollback that also reverts a neighbouring change is a second bug,
        and the person reaching for undo is already having a bad day.
        """
        e = self.entry(eid)
        if e is None:
            raise CaptureFailed(f"no ledger entry {eid!r} — nothing to roll back to")

        # RESOLVE EVERYTHING FIRST, WRITE NOTHING YET. The first version discovered a missing
        # blob halfway through and raised — having already restored the files before it,
        # which is precisely the half-restored state this was supposed to refuse. LL.4
        # asserted the raise and never checked that nothing had changed, so it passed for the
        # wrong reason. Found by Codex's third verification, 2026-09-20.
        plan = []
        for item in e["before"]:
            h = item["sha256"]
            if h is None:
                plan.append((Path(item["path"]), None))
                continue
            data = self.get_blob(h)
            if data is None:
                raise CaptureFailed(
                    f"blob {h[:12]} for {item['path']} is missing; refusing a PARTIAL "
                    f"rollback. Nothing has been changed — half a restore is a state nobody "
                    f"has ever tested.")
            plan.append((Path(item["path"]), data))

        restored = []
        for path, data in plan:
            if data is None:
                # It did not exist before. Undoing a create means removing it again.
                try:
                    path.unlink()
                    restored.append(path)
                except FileNotFoundError:
                    pass
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
            tmp.write_bytes(data)
            os.replace(tmp, path)
            restored.append(path)
        return restored


class _Mutation:
    def __init__(self, ledger, paths, actor, action, evidence, candidate):
        self.l, self.paths = ledger, paths
        self.actor, self.action = actor, action
        self.evidence, self.candidate = evidence, candidate
        self.before, self.id = None, None

    def __enter__(self):
        self.before = self.l.capture(self.paths)     # fail closed: raises, nothing changes
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is not None:
            return False                             # the caller's failure is theirs to see
        after = []
        for p in self.paths:
            p = Path(p)
            try:
                after.append({"path": str(p),
                              "sha256": self.l.put_blob(p.read_bytes()) if p.exists() else None})
            except OSError:
                after.append({"path": str(p), "sha256": None})
        self.id = self.l.record(actor=self.actor, action=self.action, before=self.before,
                                after=after, evidence=self.evidence, candidate=self.candidate)
        return False
