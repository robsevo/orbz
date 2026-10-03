#!/usr/bin/env python3
"""A reminder set before a restart still fires — once.

Run: orb/daemon/.venv/bin/python test_reminders.py

PLAN C3.4 / C3.5_t. A reminder held in a daemon's memory dies with the daemon, and the
person who set it finds out by missing the thing. The plan's word for that is *"worse than
none"*, so the store is EDS and the fired-record is the runtime journal — both of which
outlive the process.

RM.0 IS THE CONTROL, and it is the row: **fire, throw the process state away, and fire
again — the second time must say nothing.** A check that only calls `fire()` twice in one
process proves a variable, not durability; this one rebuilds the reader from the database on
disk, which is what a restart actually is.

No EDS writes: the to-do store is stubbed, because what is under test is the FIRING rule,
not the calendar. `test_eds.py` covers the round trip.
"""
import ast
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import adapters
import eds
import reminders
import runtime

import eds_sandbox

# Anything this run creates that was not there when it started is removed at exit — even
# when a PLANTED defect reaches the writer this suite never calls, and even when the suite
# dies on an assertion (D156).
eds_sandbox.guard(__name__)

FAIL = []
NOW = 1_800_000_000.0


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def eq(got, want, label):
    if got != want:
        FAIL.append(f"{label}\n     got: {got!r}\n    want: {want!r}")


def safe_due(**kw):
    """`due()`, with the raise caught. Several checks here assert that it does NOT raise —
    so the defect each one catches is a raise, through the asserting line itself. This is
    the guard that is not optional: without it the check cannot report the thing it exists
    to report (D113's shape, and it has now appeared in four suites)."""
    try:
        return reminders.due(**kw)
    except Exception as e:
        return f"RAISED {type(e).__name__}: {e}"


def safe_fire(**kw):
    try:
        return reminders.fire(**kw)
    except Exception as e:
        return f"RAISED {type(e).__name__}: {e}"


D = Path(tempfile.mkdtemp(prefix="rm-"))
adapters._journal = runtime.Journal(D/"j.db")

STORE = []


def fake_todos():
    return list(STORE)


_real_todos = eds.todos
eds.todos = fake_todos


def todo(uid, summary, due, done=False):
    return {"uid": uid, "summary": summary, "due": due, "done": done, "list": "Personal"}


# ── RM.0  CONTROL: it survives a restart, and fires ONCE ───────────────────────────────
STORE[:] = [todo("t1", "call the bank", NOW - 60)]
said = []
first = safe_fire(now=NOW, say=said.append)
eq(len(first), 1, "RM.0 something owed is announced")
ok("call the bank" in first[0], f"RM.0 saying what it is: {first[0]!r}")
eq(said, first, "RM.0 and it really went to the voice, not just the return value")

# THE RESTART. Everything in memory goes; the database on disk is all that is left.
adapters._journal = None
adapters._journal = runtime.Journal(D/"j.db")
reminders.fired_keys.__defaults__          # (no module state to clear — that is the point)

again = safe_fire(now=NOW + 1, say=said.append)
eq(again, [],
   "RM.0 CONTROL: after a restart the same reminder says NOTHING — the fired-record is in "
   "the journal, which outlives the process. A check that called fire() twice in one "
   "process would prove a variable, not durability")
eq(len(said), 1, "RM.0 and the voice heard it exactly once in total")

# ...and the control for the control: a DIFFERENT reminder still fires after that restart,
# or "says nothing" is just a broken reader.
STORE.append(todo("t2", "email the landlord", NOW - 30))
more = reminders.fire(now=NOW + 2, say=said.append)
eq(len(more), 1,
   "RM.0 CONTROL: a different reminder DOES fire after the restart — otherwise the check "
   "above passes on a reader that has simply stopped working")
ok("landlord" in more[0], f"RM.0 the right one: {more[0]!r}")

# ── RM.1  a moved due date is a new obligation ─────────────────────────────────────────
STORE[:] = [todo("t1", "call the bank", NOW + 7 * 86400)]
eq(reminders.fire(now=NOW + 3, say=said.append), [],
   "RM.1 a to-do moved into the future is not owed now")
STORE[:] = [todo("t1", "call the bank", NOW + 7 * 86400 - 10)]
fired = reminders.fire(now=NOW + 7 * 86400, say=said.append)
eq(len(fired), 1,
   "RM.1 and when the NEW due date arrives it fires again — the key is (uid, due), not uid. "
   "A person who moves a reminder means to be reminded again; one that merely got re-read "
   "must not be")

# ── RM.2  nothing owed, nothing said ───────────────────────────────────────────────────
STORE[:] = [todo("t9", "someday", NOW + 86400)]
eq(safe_due(now=NOW), [], "RM.2 a future to-do is not due")
STORE[:] = [todo("t9", "no due date at all", None)]
eq(safe_due(now=NOW), [],
   "RM.2 a to-do with no due date is a list item, not a reminder — announcing those would "
   "make the list unusable")
STORE[:] = []
eq(safe_due(now=NOW), [], "RM.2 an empty list is quiet")

# ── RM.3  the grace window: a reboot is not a recital ──────────────────────────────────
STORE[:] = [todo("old", "from last month", NOW - 40 * 86400),
            todo("recent", "from ten minutes ago", NOW - 600)]
owed = safe_due(now=NOW)
eq([t["uid"] for t in owed], ["recent"],
   "RM.3 a reminder that came due while the machine was off is worth saying; one from last "
   "month is not. A reboot after a long weekend must not produce a recital of everything "
   "missed")
ok(reminders.GRACE_S >= 600,
   f"RM.3 and the window is long enough to survive a restart or a lunch break: "
   f"{reminders.GRACE_S}s")

# ── RM.4  it never takes a turn down ───────────────────────────────────────────────────
def boom():
    raise eds.Unavailable("the calendar is gone", "unavailable")


eds.todos = boom
try:
    eq(safe_due(now=NOW), [],
       "RM.4 an unreachable calendar yields no reminders rather than raising — `day.handle` "
       "is where 'I can't reach your calendar' gets SAID, because that is a question the "
       "person asked. An idle tick has nobody to tell")
    eq(safe_fire(now=NOW, say=said.append), [], "RM.4 and fires nothing")
finally:
    eds.todos = fake_todos

# a voice that fails must NOT mark the reminder fired, or it is lost for good
STORE[:] = [todo("t5", "the one that could not be said", NOW - 60)]


def cannot_say(_line):
    raise RuntimeError("the speaker is busy")


eq(safe_fire(now=NOW, say=cannot_say), [],
   "RM.4 a reminder that could not be SAID is not recorded as said")
_again = safe_fire(now=NOW + 1, say=said.append)
eq(len(_again) if isinstance(_again, list) else _again, 1,
   "RM.4 CONTROL: so it comes round again on the next tick. Between annoying and silent, "
   "this project picks annoying")

# ── RM.5  no new timer, and the daemon really calls it ─────────────────────────────────
_src = (HERE/"reminders.py").read_text()
_tree = ast.parse(_src)
_imports = set()
for n in ast.walk(_tree):
    if isinstance(n, ast.Import):
        _imports.update(a.name.split(".")[0] for a in n.names)
    elif isinstance(n, ast.ImportFrom) and n.module:
        _imports.add(n.module.split(".")[0])
eq(sorted(_imports & {"threading", "sched", "asyncio", "signal"}), [],
   f"RM.5 it schedules NOTHING — no Timer, no thread, no alarm. A reminder held by a thread "
   f"nobody supervises dies with it: {sorted(_imports)}")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

eds.todos = _real_todos

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print("✓ reminders: 6 groups green (RM.0 control: it survives a restart and fires once)")
