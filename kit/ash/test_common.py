#!/usr/bin/env python3
"""common.py is where ashd lives, where its state lives, and how it logs. Run: orb/daemon/.venv/bin/python orb/daemon/test_common.py

Fifteen lines, and every one of them is a contract somebody else depends on (PLAN 2.8 listed
it as referenced by no suite).

Unlike the other 2.8 suites this one found NO defect: the D25 split is intact and the logging
flushes. It is a REGRESSION guard, and worth having because both contracts fail silently:

  1. D25 — `common` exists so `terminal.py` can have CFG/HERE/log WITHOUT importing `ashd`.
     `ashd.py` runs as `__main__`, so a lazy `import ashd` from another module loads the whole
     daemon A SECOND TIME — a second audio stack, a second set of locks. Adding one import to
     `common.py` would bring that back, and nothing would say so until two daemons were live.
  2. `log()` passes `flush=True`. Without it, stdout to a pipe is block-buffered and the last
     lines are LOST when the process dies — which is the failure that makes a crash look like
     it happened earlier than it did, and it costs a debugging session every time.

C.0 and C.2b are the controls: a planted `import ashd` must be caught, and a planted
`flush=False` must lose the line. Both are built from the live source at test time, so a
rewrite breaks the control instead of quietly passing it.
"""

# ASH_TIER: product
# Imports run in child interpreters against COPIES in a temp dir; the real common.py is only
# ever read.
import os, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
MOD = HERE/"common.py"
PY = sys.executable
FAILS = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'' if ok else '  — ' + str(detail)}")
    if not ok:
        FAILS.append(name)


def local_modules_after_import(src=None):
    """Import `common` in a FRESH interpreter and report which sibling daemon modules it
    dragged in. A fresh process is the only honest way to ask: this suite has already
    imported half the tree."""
    d = Path(tempfile.mkdtemp(prefix="common-"))
    target = HERE
    if src is not None:                       # a planted copy needs the real siblings beside it
        target = d
        (d/"common.py").write_text(src)
        (d/"ashd.py").write_text("LOADED_A_SECOND_DAEMON = True\n")
    probe = (
        "import sys; sys.path.insert(0, %r)\n"
        "base = set(sys.modules)\n"
        "import common\n"
        "import pathlib\n"
        "new = set(sys.modules) - base - {'common'}\n"
        "here = pathlib.Path(%r)\n"
        "local = sorted(m for m in new if (here/(m.split('.')[0] + '.py')).exists())\n"
        "print('LOCAL:' + ','.join(local))\n"
    ) % (str(target), str(target))
    r = subprocess.run([PY, "-c", probe], capture_output=True, text=True, timeout=120)
    line = next((l for l in r.stdout.splitlines() if l.startswith("LOCAL:")), None)
    if line is None:
        return None, (r.stdout + r.stderr)[-300:]
    return [m for m in line[len("LOCAL:"):].split(",") if m], ""


print("common")

# ---- C.0  the control --------------------------------------------------------------------
planted = MOD.read_text().replace("import time\n", "import time\nimport ashd  # planted\n", 1)
if "import ashd" not in planted:
    check("C.0 control builds from the live source", False,
          "could not plant an import — the module's import block has changed, so C.1 proves nothing")
else:
    got, err = local_modules_after_import(planted)
    check("C.0 CONTROL: a planted `import ashd` is caught", got is not None and "ashd" in got,
          f"got={got!r} {err} — expected the detector to SEE the second daemon. If this "
          f"reports none, C.1 is measuring nothing.")

# ---- C.1  the D25 split holds ------------------------------------------------------------
got, err = local_modules_after_import()
# ONE sibling is allowed, and only because it cannot do what D25 is about. `statepaths` (PLAN
# 5.9) is where every module now asks for its root; it imports `os` and `pathlib` and nothing
# else, so it can never load a second daemon. The allowance is PROVEN, not trusted: C.1a2
# parses statepaths and fails the day it imports anything of this tree's.
LEAF_SIBLINGS = {"statepaths"}
check("C.1a importing common pulls in no sibling daemon module but the proven leaf",
      got is not None and set(got) <= LEAF_SIBLINGS, f"pulled in {got!r} {err}")
import ast as _ast1
_sp_imports = {a.name.split(".")[0] for n in _ast1.walk(_ast1.parse((HERE/"statepaths.py").read_text()))
               if isinstance(n, (_ast1.Import, _ast1.ImportFrom))
               for a in (n.names if isinstance(n, _ast1.Import) else [_ast1.alias(n.module or "")])}
_sp_local = sorted(m for m in _sp_imports if (HERE/f"{m}.py").exists())
check("C.1a2 ...and statepaths really is a leaf: it imports nothing from this tree",
      _sp_local == [], f"statepaths imports {_sp_local}")
check("C.1b ...and `ashd` in particular is not loaded", got is not None and "ashd" not in got,
      "terminal.py would be starting a second daemon (D25)")

# ---- C.2  log() flushes, so the last lines survive ---------------------------------------
# os._exit skips atexit and the stdio flush, which is what a killed process does. stdout is a
# pipe here, so it is block-buffered: without flush=True the line never lands.
def last_line_survives(src=None):
    d = Path(tempfile.mkdtemp(prefix="commonlog-"))
    target = HERE
    if src is not None:
        target = d
        (d/"common.py").write_text(src)
    probe = ("import sys, os; sys.path.insert(0, %r)\n"
             "import common\n"
             "common.log('the-last-thing-he-said')\n"
             "os._exit(0)\n") % str(target)
    r = subprocess.run([PY, "-c", probe], capture_output=True, text=True, timeout=120)
    return "the-last-thing-he-said" in r.stdout, r.stdout


ok, out = last_line_survives()
check("C.2a the last log line survives a process that dies without flushing", ok,
      f"stdout={out!r} — a crash would lose its own last words")

unflushed = MOD.read_text().replace("flush=True", "flush=False", 1)
if "flush=False" not in unflushed:
    check("C.2b control builds from the live source", False,
          "no flush=True to remove — C.2a proves nothing")
else:
    ok_bad, out_bad = last_line_survives(unflushed)
    check("C.2b CONTROL: without flush=True the line IS lost", not ok_bad,
          f"stdout={out_bad!r} — the unflushed version kept the line, so C.2a is not "
          f"measuring the flush")

# ---- C.2c  the shape of a log line -------------------------------------------------------
r = subprocess.run([PY, "-c", "import sys; sys.path.insert(0, %r)\nimport common\n"
                    "common.log('alpha', 'beta')\n" % str(HERE)],
                   capture_output=True, text=True, timeout=120)
line = r.stdout.strip()
parts = line.split(" ", 1)
stamp = parts[0] if parts else ""
# MILLISECONDS (PLAN 1.8). Four SLO targets are sub-second — barge-in 150 ms, wake 300 ms,
# stop 500 ms — and `%T` cannot see them: `baseline.py --slo` reported stop -> terminal
# interrupt as min 0, max 0, median 0 over five samples, which is a floor and not a
# measurement. The clock stays FIRST and stays ONE token, because every consumer splits on
# whitespace (16.3's constraint); a wider first field is safe, a reordered line would not be.
import re as _re
check("C.2c a log line is HH:MM:SS.mmm then the message",
      _re.fullmatch(r"\d{2}:\d{2}:\d{2}\.\d{3}", stamp) is not None
      and len(parts) > 1 and parts[1] == "alpha beta",
      f"line={line!r}")
check("C.2d CONTROL: the stamp is still a SINGLE whitespace-delimited token",
      " " not in stamp,
      "every consumer splits on whitespace; a clock with a space in it breaks all of them")
check("C.2e CONTROL: the resolution is finer than a second, or the SLO targets stay unmeasurable",
      "." in stamp and int(stamp.split(".")[1]) >= 0,
      f"stamp={stamp!r} — a one-second clock reports sub-second intervals as 0.0, which "
      f"PLAN 1.8 names as the D10 class")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

# ---- C.4  the two paths, derived not retyped ---------------------------------------------
sys.path.insert(0, str(HERE))
import common as c
check("C.4a HERE is the daemon directory this file lives in", c.HERE == HERE, f"{c.HERE}")
check("C.4b CFG is ~/.orbs/kit", c.CFG == Path.home()/".orbs"/"kit", f"{c.CFG}")

print(f"\n{'FAIL' if FAILS else 'PASS'}  common  ({len(FAILS)} failing)")
sys.exit(1 if FAILS else 0)
