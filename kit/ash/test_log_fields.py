#!/usr/bin/env python3
"""Component, session and turn on every line (PLAN 16.3).

Run: orb/daemon/.venv/bin/python test_log_fields.py

Three processes write two log files and their lines used to look alike, so following one
turn end to end meant guessing from timestamps. `common.log` now carries who wrote it, which
session, and which turn.

LF.0 IS THE CONTROL, and it guards the thing most likely to break silently: **the existing
greps must still match.** `shoot.py` and several suites slice these logs for substrings —
"models ready", "[speaking]", "turn.abort". A format that moved the clock or the message
would break every one of them at once, and each would look like a separate defect.
"""
import ast
import subprocess
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common

FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def eq(got, want, label):
    if got != want:
        FAIL.append(f"{label}\n     got: {got!r}\n    want: {want!r}")


def captured(fn):
    """One log line, as it is actually printed."""
    import contextlib
    import io
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fn()
    return buf.getvalue().rstrip("\n")


# ── LF.0  CONTROL: the old greps still find what they found ────────────────────────────
common.bind(component="ashd", session="sess-abc")
common.bind_turn("turn-7")
line = captured(lambda: common.log("[speaking] models ready, turn.abort"))
for needle in ("models ready", "[speaking]", "turn.abort"):
    ok(needle in line,
       f"LF.0 CONTROL: {needle!r} is still findable — `shoot.py` and four suites slice these "
       f"logs for substrings, and a format that moved the message would break all of them "
       f"at once, each looking like a separate defect: {line!r}")
ok(line.split()[0].count(":") == 2,
   f"LF.0 the clock is still FIRST, in HH:MM:SS — the one thing a human scanning a log "
   f"aligns on: {line!r}")
ok(line.endswith("turn.abort"),
   f"LF.0 and the message is still LAST, so nothing is appended after it: {line!r}")

# ── LF.1  the fields are there, and only when they mean something ──────────────────────
ok("[ashd]" in line, f"LF.1 the component: {line!r}")
ok("sess-abc/turn-7" in line, f"LF.1 the session and turn, joined: {line!r}")

common.bind_turn(None)
idle = captured(lambda: common.log("idle"))
ok("[ashd]" in idle, "LF.1 the component is on every line, turn or no turn")
ok("turn-" not in idle,
   f"LF.1 but no turn field when there is no turn — an idle daemon printing an empty field "
   f"on every line teaches the reader to skip it, and then it is not there when it "
   f"matters: {idle!r}")

common.COMPONENT, common.SESSION = "", ""
bare = captured(lambda: common.log("unbound"))
eq(bare.split()[1:], ["unbound"],
   f"LF.1 an unbound process logs exactly as it did before — the fields are added, never "
   f"required, so a module that never calls bind() is not broken by this: {bare!r}")

# ── LF.2  the turn is THREAD-LOCAL, the session is not ─────────────────────────────────
# One turn runs on its own thread. A module-global turn would be shared by two turns at
# once — a lesson beside a coding turn — and every line would name whichever bound last.
common.bind(component="ashd", session="sess-abc")
common.bind_turn("turn-1")
seen = {}


def worker():
    common.bind_turn("turn-2")
    seen["worker"] = captured(lambda: common.log("in the worker"))


t = threading.Thread(target=worker)
t.start()
t.join()
seen["main"] = captured(lambda: common.log("on the main thread"))

ok("turn-2" in seen["worker"], f"LF.2 the worker names its own turn: {seen['worker']!r}")
ok("turn-1" in seen["main"],
   f"LF.2 CONTROL: and the main thread STILL names turn-1 — the worker's bind did not "
   f"reach it, which is the whole reason this is thread-local: {seen['main']!r}")
ok("sess-abc" in seen["worker"] and "sess-abc" in seen["main"],
   "LF.2 while the session, which is per PROCESS, appears on both — a thread-local session "
   "would be empty on every line written from a turn thread, i.e. every line that matters")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

# ── LF.4  every module that logs goes through the one log ──────────────────────────────
# `lesson.py` prints its own `[lesson]` prefix to stderr and is already component-tagged;
# everything else must use the shared one, or its lines carry no fields at all.
_own = []
for f in sorted(HERE.glob("*.py")):
    if f.name.startswith("test_") or f.name in ("common.py", "lesson.py"):
        continue
    try:
        tree = ast.parse(f.read_text())
    except Exception:
        continue
    for n in tree.body:
        if isinstance(n, ast.FunctionDef) and n.name == "log":
            _own.append(f"{f.name}:{n.lineno}")
eq(_own, [],
   f"LF.4 no module defines its own `log` — D25 split it out so there would be one, and a "
   f"second one writes lines with no component, session or turn: {_own}")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print("✓ log fields: 5 groups green (LF.0 control: the existing substring greps still match)")
