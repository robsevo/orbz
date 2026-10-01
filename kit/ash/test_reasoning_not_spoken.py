#!/usr/bin/env python3
"""A model's thinking summary is never read aloud as an answer (D314, owner's goal 2026-09-22).

Run: orb/daemon/.venv/bin/python test_reasoning_not_spoken.py

Heard live on 2026-09-22: "I'm reviewing the system instructions, context, constraints, and
reminders to ensure I understand everything perfectly before proceeding." A seat returned its
thinking summary as the reply, with no salvage marker, and he said it. The owner's goal is that
he never sounds like a robot; this is the line that sounded most like one.

RN.0 is the control: the committed pre-fix speakable.py lets that exact line through. RN.3 is the
counter-control: real answers and his own action narration must survive untouched, because a
filter that silences "I'm checking the folder…" would make him mute instead of robotic.
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


def load(src, name):
    d = Path(tempfile.mkdtemp(prefix="reasonspk-"))
    (d/f"{name}.py").write_text(src)
    spec = importlib.util.spec_from_file_location(name, d/f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


LEAKED = ("I'm reviewing the system instructions, context, constraints, and reminders to ensure "
          "I understand everything perfectly before proceeding.")
ALSO = "I'm focusing on the core request and will now formulate my response."

_pre = __import__("carried_git").show("f7a1726:orb/daemon/speakable.py")
_old = load(_pre.stdout, "speakable_prefix") if _pre.returncode == 0 else None
check("RN.0 CONTROL: the pre-fix filter lets the leaked line through to the voice",
      _old is not None and not _old.is_internal(LEAKED), _pre.stderr[-200:])

import speakable as sp  # noqa: E402

check("RN.1 the line heard live is recognised as reasoning, not an answer", sp.is_internal(LEAKED))
check("RN.1 ...and so is 'formulate my response'", sp.is_internal(ALSO))
_mixed = sp.strip_internal("The user asked for a chart. It's on the right now.")
check("RN.2 in a MIXED reply only the reasoning sentence is dropped", _mixed == "It's on the right now.", _mixed)

for real in ("It's fifty-one.", "I'm checking the folder where the script will live.",
             "Your request went to the server and came back fine.",
             "I'm searching for the test that covers the login page."):
    check(f"RN.3 real speech survives untouched: {real[:40]!r}",
          not sp.is_internal(real) and sp.strip_internal(real) == real, sp.strip_internal(real))

# ── RN.4  the ASK path applies it — where today's line was actually spoken ─────────────
# The say-loop's reply feed already consulted is_internal; the ask path, which speaks ashd's own
# model turn, did not, so the fix in speakable alone would not have stopped the line heard live.


def ask_path_filters(src):
    i = src.find('reply = (r.get("text") or "").strip()')
    j = src.find('if not reply or r.get("failed") or r.get("blocked"):', i)
    seg = src[i:j] if i >= 0 and j > i else ""
    return "speakable.is_internal(reply)" in seg and "speakable.strip_internal(reply)" in seg


_pre_ashd = __import__("carried_git").show("f7a1726:orb/daemon/ashd.py")
check("RN.4 CONTROL: the pre-fix ask path spoke the model's reply unfiltered",
      _pre_ashd.returncode == 0 and not ask_path_filters(_pre_ashd.stdout))
check("RN.4 the ask path drops reasoning BEFORE the empty-answer check, so the retry answers instead",
      ask_path_filters((HERE/"voiceturn.py").read_text()))   # `ask` since 18.1's ninth extraction

print(f"\n{'FAIL' if FAILS else 'PASS'}  reasoning_not_spoken  ({len(FAILS)} failing)")
sys.exit(1 if FAILS else 0)
