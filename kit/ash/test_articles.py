#!/usr/bin/env python3
"""He says "an organized", not "a organized": a/an by sound at the last step (D315).

Run: orb/daemon/.venv/bin/python test_articles.py

Heard 2026-09-22 in a lesson: "A binary search tree is a organized network of numbers…". The
owner has named bad English as a real complaint, and a wrong article is the smallest version of
it. `for_the_ear` now ends with `agree_articles`. AR.0 is the control: the committed pre-fix
for_the_ear lets "a organized" through. AR.2 is the counter-control: sound, not spelling, decides —
"a user", "a one-off", "an hour", "an honest" — and names, letters and acronyms are left alone.
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


_pre = __import__("carried_git").show("caf23fd:orb/daemon/speakable.py")
if _pre.returncode == 0:
    d = Path(tempfile.mkdtemp(prefix="articles-"))
    (d/"speakable_prefix.py").write_text(_pre.stdout)
    spec = importlib.util.spec_from_file_location("speakable_prefix", d/"speakable_prefix.py")
    old = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(old)
    check("AR.0 CONTROL: the pre-fix pipeline says 'a organized'",
          "a organized" in old.for_the_ear("A binary search tree is a organized network."))
else:
    check("AR.0 the pre-fix speakable.py is readable", False, _pre.stderr[-200:])

import speakable as sp  # noqa: E402

heard = sp.for_the_ear("A binary search tree is a organized network.")
check("AR.1 the line heard live now reads 'an organized' through the whole pipeline", "an organized" in heard, heard)
_direct = sp.from_report("A binary search tree is a organized network.")
check("AR.1 ...and through speak()'s own step, from_report, which the ask path and lessons use",
      "an organized" in _direct, _direct)
for bad, good in (("It takes a hour.", "an hour"), ("He wrote an function.", "a function"),
                  ("a elephant", "an elephant")):
    check(f"AR.1 {bad!r} -> {good!r}", good in sp.agree_articles(bad), sp.agree_articles(bad))
for keep in ("A user opened the page.", "A one-off fix.", "It is an honest answer.", "It takes an hour.",
             "A unique idea.", "an Apple laptop", "a U R L", "Anna has an idea."):
    check(f"AR.2 left as it is: {keep!r}", sp.agree_articles(keep) == keep, sp.agree_articles(keep))

print(f"\n{'FAIL' if FAILS else 'PASS'}  articles  ({len(FAILS)} failing)")
sys.exit(1 if FAILS else 0)
