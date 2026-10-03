#!/usr/bin/env python3
"""Nothing speaks first during a coding turn, a lesson, or quiet hours.

Run: orb/daemon/.venv/bin/python test_proactive.py

PLAN C7. **This row exists because the previous one broke it.** C3.4's reminders fire on the
idle tick, and the idle tick runs while a linked terminal is mid-build — so a reminder could
land over the narration while the person is reading the screen. D7 measured what unprompted
speech costs at the wrong moment: 4.4% of spoken lines were word-for-word repeats and the
user said "stop" five times in two minutes.

PR.0 IS THE CONTROL: **every gate must actually close.** A `may_speak` that returns True for
everything passes any check that only asks it about a quiet moment, so each gate is tested
from a state where it is the ONLY thing standing in the way.

State lives in a temp file; nothing here touches the real one.
"""
import ast
import json
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import proactive as P

FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def eq(got, want, label):
    if got != want:
        FAIL.append(f"{label}\n     got: {got!r}\n    want: {want!r}")


D = Path(tempfile.mkdtemp(prefix="pr-"))
P.STATE = D/"proactive.json"

# A Wednesday at 14:00 local — the middle of a working afternoon.
NOON = time.mktime((2026, 9, 16, 14, 0, 0, 0, 0, -1))

# ── PR.0  CONTROL: each gate closes, and it is the only one closing ────────────────────
okay, why = P.may_speak("reminder", now=NOON)
eq(okay, True, f"PR.0 a clear moment lets it through: {why!r}")

for kwargs, word in (({"asleep": True}, "asleep"),
                     ({"lesson_running": True}, "lesson"),
                     ({"terminal_working": True}, "terminal"),
                     ({"state": "thinking"}, "in flight"),
                     ({"state": "speaking"}, "in flight")):
    okay, why = P.may_speak("reminder", now=NOON, **kwargs)
    eq(okay, False,
       f"PR.0 CONTROL: {word} closes it, from a state where it is the ONLY thing in the "
       f"way — a gate tested only from a quiet moment is one that never had to close")
    ok(word in why, f"PR.0 and says which gate: {why!r}")

eq(P.may_speak("nonsense", now=NOON)[0], False,
   "PR.0 an unknown class is refused rather than waved through — a typo must not create a "
   "channel nobody reviews")

# ── PR.1  the coding turn is the thing on screen (C7.1) ────────────────────────────────
okay, why = P.may_speak("reminder", now=NOON, terminal_working=True, state="idle")
eq(okay, False,
   "PR.1 the daemon being IDLE is not the same as nothing happening — the idle tick runs "
   "while a linked terminal is mid-build, which is exactly when C3.4's reminders would have "
   "spoken over the narration")
ok("on screen" in why, f"PR.1 and says why that matters: {why!r}")

okay, _ = P.may_speak("reminder", now=NOON, lesson_running=True, state="idle")
eq(okay, False, "PR.1 same for a lesson — interrupting teaching is worse than being late")

# ── PR.2  quiet hours survive a restart (C7.2) ─────────────────────────────────────────
P.quiet_hours(22, 7)
eq(P.quiet_hours(), (22, 7), "PR.2 they are set")
ok(P.STATE.exists(), "PR.2 and held ON DISK, not in the process")

# Rebuild the reader from the file, which is what a restart is. Guarded: the defect the
# check above catches is the one that never writes the file, so reading it here kills the
# suite with that finding unprinted.
def _saved():
    try:
        return json.loads(P.STATE.read_text())
    except Exception as e:
        return {"__error__": f"{type(e).__name__}: {e}"}


saved = _saved()
eq((saved.get("quiet", {}).get("start"), saved.get("quiet", {}).get("end")), (22, 7),
   "PR.2 CONTROL: the file itself carries them — a person who asked for quiet at 10pm "
   "should not be woken by a daemon that restarted")

night = time.mktime((2026, 9, 16, 23, 0, 0, 0, 0, -1))
early = time.mktime((2026, 9, 16, 3, 0, 0, 0, 0, -1))
eq(P.may_speak("reminder", now=night)[0], False, "PR.2 23:00 is inside 22->7")
eq(P.may_speak("reminder", now=early)[0], False,
   "PR.2 and so is 03:00 — a window that WRAPS MIDNIGHT is the normal case, and the one a "
   "naive `start <= hour < end` gets exactly backwards")
eq(P.may_speak("reminder", now=NOON)[0], True, "PR.2 while the afternoon is clear")

P.quiet_hours(13, 15)
eq(P.may_speak("reminder", now=NOON)[0], False, "PR.2 a same-day window works too")
P.quiet_hours(22, 7)

# ── PR.3  earned and revoked (C7.4) ────────────────────────────────────────────────────
eq(P.earned("suggestion"), True, "PR.3 a class starts earned")
P.record("suggestion", accepted=False)
eq(P.earned("suggestion"), True,
   "PR.3 one rejection is a MOMENT, not a preference — revoking on the first 'not now' is "
   "how a useful channel gets switched off by a bad afternoon")
P.record("suggestion", accepted=False)
eq(P.earned("suggestion"), False, "PR.3 two in a row stops it offering")
eq(P.may_speak("suggestion", now=NOON)[0], False, "PR.3 and the gate closes")
ok("turned down" in P.may_speak("suggestion", now=NOON)[1],
   "PR.3 saying why, so it can be explained rather than switched off wholesale")

eq(P.may_speak("reminder", now=NOON)[0], True,
   "PR.3 CONTROL: while OTHER classes are unaffected — somebody who wants reminders and not "
   "suggestions gets exactly that")

P.record("suggestion", accepted=True)
eq(P.earned("suggestion"), True, "PR.3 an accept restores it")

stats = (_saved().get("classes") or {}).get("suggestion") or {}
eq((stats.get("offered"), stats.get("accepted")), (3, 1),
   f"PR.3 and the counts are kept for C7.5 to report: {stats}")

# ── PR.4  one brief, once (C7.3) ───────────────────────────────────────────────────────
eq(P.brief_due(now=NOON), True, "PR.4 the first brief of the day is due")
eq(P.may_speak("brief", now=NOON)[0], True, "PR.4 and allowed")
P.mark_brief(now=NOON)
eq(P.may_speak("brief", now=NOON + 3600)[0], False,
   "PR.4 CONTROL: a second one an hour later is refused — ONE daily brief, not scattered "
   "pings, which is the failure C7.3 names")
ok("already been given" in P.may_speak("brief", now=NOON + 3600)[1], "PR.4 saying so")
eq(P.may_speak("brief", now=NOON + 25 * 3600)[0], True, "PR.4 tomorrow's is due again")
eq(P.may_speak("reminder", now=NOON + 3600)[0], True,
   "PR.4 and the brief's own limit does not silence anything else")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print("✓ proactive: 6 groups green (PR.0 control: every gate closes, from a state where it "
      "is the only one closing)")
