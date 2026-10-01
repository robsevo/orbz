#!/usr/bin/env python3
"""skill_usage — which skills are actually used (PLAN 23.2).

Measured 2026-09-20 across the whole brain: **nothing records which skill a turn ever
loaded.** No `usage.json`, no counter, no last-used stamp anywhere. So there is no evidence
for retiring any of them, and the gym adds more each night — a store that only grows, with
nothing to say which entries earn their place.

A sidecar keyed by skill name, **never frontmatter**: telemetry does not belong in a
user-authored `SKILL.md`, because then every count is a diff in a file the user owns and a
merge conflict waiting to happen.

**Best-effort by design: a counter that cannot be written never breaks the turn.** The same
asymmetry as the learning ledger's telemetry half (20.6) — the product does not stop because
its odometer is stuck. Atomic under a cross-process lock, the idiom already behind
`term.lock` and `preview.json`.
"""
import fcntl
import json
import os
import threading
import time
from pathlib import Path

HOME = Path(os.environ.get("ORBS_BRAIN") or os.environ.get("ASH_BRAIN_HOME") or Path.home()/".orbs"/"brain")
SIDECAR = HOME/"skill-usage.json"

KINDS = ("use", "view", "patch")


def _read(path):
    try:
        d = json.loads(Path(path).read_text())
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}                        # corrupt is empty, never an exception into the turn


def bump(name, kind="use", *, path=None, pin=None, state=None):
    """Record one event for `name`. Returns the entry, or None if it could not be written.

    Never raises. A skill that was loaded and not counted is a lost measurement; a turn that
    died because the odometer was full is a lost turn.
    """
    if kind not in KINDS:
        kind = "use"
    p = Path(path or SIDECAR)
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        lock = p.with_suffix(".lock")
        with open(lock, "w") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            try:
                d = _read(p)
                e = d.get(name) or {}
                e[kind] = int(e.get(kind, 0)) + 1
                e[f"last_{kind}"] = time.time()
                if pin is not None:
                    e["pin"] = bool(pin)
                if state is not None:
                    e["state"] = str(state)
                d[name] = e
                tmp = p.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
                tmp.write_text(json.dumps(d, indent=2, sort_keys=True) + "\n")
                os.replace(tmp, p)
                return e
            finally:
                fcntl.flock(lk, fcntl.LOCK_UN)
    except Exception:
        return None


OWNERS = ("agent", "user")


def declare(name, owner, *, path=None):
    """Record who OWNS `name` — "agent" (the gym made it, the gym may patch it) or "user". Returns
    the entry, or None if it could not be written or `owner` is not one of the two.

    Ownership is DECLARED, never inferred (skill_lifecycle.owner_of): an undeclared skill is the
    user's. This is the one way to declare it, and it is a person's act — the gym cannot call it
    on its own behalf and then patch what it just claimed (PLAN 23.4). It counts no use.
    """
    if owner not in OWNERS:
        return None
    p = Path(path or SIDECAR)
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p.with_suffix(".lock"), "w") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            try:
                d = _read(p)
                e = d.get(name) or {}
                e["owner"] = owner
                e["owner_declared"] = time.time()
                d[name] = e
                tmp = p.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
                tmp.write_text(json.dumps(d, indent=2, sort_keys=True) + "\n")
                os.replace(tmp, p)
                return e
            finally:
                fcntl.flock(lk, fcntl.LOCK_UN)
    except Exception:
        return None


def usage(name=None, *, path=None):
    d = _read(path or SIDECAR)
    return d.get(name, {}) if name else d


def unused(names, *, path=None, since=None):
    """Of `names`, those with no recorded use (optionally none since `since`).

    This is the evidence 23.3 needs to retire anything, and it did not exist.
    """
    d = _read(path or SIDECAR)
    out = []
    for n in names:
        e = d.get(n) or {}
        if e.get("pin"):
            continue                     # pinned is a decision, not a gap in the data
        used = int(e.get("use", 0))
        last = e.get("last_use", 0)
        if used == 0 or (since is not None and last < since):
            out.append(n)
    return out
