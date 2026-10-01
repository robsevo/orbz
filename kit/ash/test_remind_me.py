#!/usr/bin/env python3
""""Remind me in two minutes to X" sets a reminder (D323, Track C3.4).

Run: orb/daemon/.venv/bin/python test_remind_me.py

Watched 2026-09-22: that sentence matched no verb, went to a full model turn with tools ("Let me
look."), and after 148 s and a retry he said "Sorry, I couldn't get an answer just then" —
nothing was set. Two gaps: the `todo` verb read only "remind me to X <when>", not the time-first
order; and whenparse knew "in 2 minutes" but not "in TWO minutes", which is what speech-to-text
writes. RM.0 is the control: the committed pre-fix table and parser miss both.
"""
import importlib.util
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))

FAILS = []


def check(label, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}" + ("" if cond else f"\n        {detail}"))
    if not cond:
        FAILS.append(label)


def load_old(name):
    r = __import__("carried_git").show(f"edd72cc:orb/daemon/{name}.py")
    if r.returncode:
        return None
    d = Path(tempfile.mkdtemp(prefix="remindme-"))
    (d/f"{name}.py").write_text(r.stdout)
    sys.path.insert(0, str(d))
    spec = importlib.util.spec_from_file_location(f"{name}_prefix", d/f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sys.path.remove(str(d))
    return mod


SAID = "remind me in two minutes to ASH TEST delete me"
_old_dv, _old_wp = load_old("day_verbs"), load_old("whenparse")
check("RM.0 CONTROL: the pre-fix table does not recognise the time-first order",
      _old_dv is not None and _old_dv.match(SAID) is None)
check("RM.0 CONTROL: the pre-fix parser cannot read 'in two minutes'",
      _old_wp is not None and _old_wp.resolve("in two minutes") is None)

import day_verbs as dv  # noqa: E402
import whenparse  # noqa: E402

check("RM.1 the time-first order is a to-do with the time kept", dv.match(SAID) == ("todo", "ASH TEST delete me in two minutes"), dv.match(SAID))
check("RM.1 'remind me tomorrow at 9 to call the bank' too", dv.match("remind me tomorrow at 9 to call the bank") == ("todo", "call the bank tomorrow at 9"))
check("RM.1 the time-last order is unchanged", dv.match("remind me to call the bank at 5pm") == ("todo", "call the bank at 5pm"))
ref = time.time()
two = whenparse.resolve("in two minutes")
check("RM.2 'in two minutes' is two minutes from now", two is not None and 100 < two - ref < 140, two and two - ref)
check("RM.2 'in half an hour' is thirty", (whenparse.resolve("in half an hour") or 0) - ref > 1700)
check("RM.2 digits still work", whenparse.resolve("in 2 minutes") is not None)
check("RM.3 a question that starts 'remind me' is still not a to-do", dv.match("remind me why we did that") is None)

print(f"\n{'FAIL' if FAILS else 'PASS'}  remind_me  ({len(FAILS)} failing)")
sys.exit(1 if FAILS else 0)
