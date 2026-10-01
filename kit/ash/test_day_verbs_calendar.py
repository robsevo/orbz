#!/usr/bin/env python3
""""Put X on my calendar" is a calendar verb without asking a model (D320, Track C).

Run: orb/daemon/.venv/bin/python test_day_verbs_calendar.py

Watched 2026-09-22: "put ASH TEST delete me on my calendar tomorrow at 3pm" missed the verb table,
went to the model fallback, which took 31 s and gave up while the seats were slow, and the request
then fell through to a LINKED CODING TERMINAL. "What's on my calendar tomorrow" missed the agenda
the same way, and "add X to my calendar" booked an event titled "X to my calendar".

DV.0 is the control: the committed pre-fix table misses both everyday phrasings. DV.3 is the
counter-control: every NEAR_MISS, "put the kettle on" and "book me a flight" stay non-verbs.
"""
import importlib.util
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))

FAILS = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}" + ("" if cond else f"\n        {detail}"))
    if not cond:
        FAILS.append(label)


BOOK = "put ASH TEST delete me on my calendar tomorrow at 3pm"
AGENDA = "what's on my calendar tomorrow"

_pre = __import__("carried_git").show("91cfcef:orb/daemon/day_verbs.py")
if _pre.returncode == 0:
    d = Path(tempfile.mkdtemp(prefix="dayverbs-"))
    (d/"day_verbs_prefix.py").write_text(_pre.stdout)
    spec = importlib.util.spec_from_file_location("day_verbs_prefix", d/"day_verbs_prefix.py")
    old = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old)
    check("DV.0 CONTROL: the pre-fix table misses 'put … on my calendar'", old.match(BOOK) is None, old.match(BOOK))
    check("DV.0 CONTROL: …and 'what's on my calendar tomorrow'", old.match(AGENDA) is None, old.match(AGENDA))
else:
    check("DV.0 the pre-fix day_verbs.py is readable", False, _pre.stderr[-200:])

import day_verbs as dv  # noqa: E402

check("DV.1 'put X on my calendar <when>' books X, with the calendar phrase gone",
      dv.match(BOOK) == ("book", "ASH TEST delete me tomorrow at 3pm"), dv.match(BOOK))
check("DV.1 'add X to my calendar <when>' books X, not 'X to my calendar'",
      dv.match("add ASH TEST delete me to my calendar tomorrow at 3pm") == ("book", "ASH TEST delete me tomorrow at 3pm"))
check("DV.2 'what's on my calendar tomorrow' is the agenda for tomorrow", dv.match(AGENDA) == ("agenda", "tomorrow"), dv.match(AGENDA))
check("DV.2 'what is on my diary today' too", dv.match("what is on my diary today") == ("agenda", "today"))
for miss in list(dv.NEAR_MISSES) + ["put the kettle on", "book me a flight to berlin"]:
    check(f"DV.3 still not a verb: {miss!r}", dv.match(miss) is None, dv.match(miss))
check("DV.3 an ordinary to-do is still a to-do", dv.match("add a to-do: call the bank") == ("todo", "call the bank"))

print(f"\n{'FAIL' if FAILS else 'PASS'}  day_verbs_calendar  ({len(FAILS)} failing)")
sys.exit(1 if FAILS else 0)
