#!/usr/bin/env python3
"""One place knows where things live, and it can actually be redirected.

Run: orb/daemon/.venv/bin/python test_statepaths.py

PLAN 5.9 / 5.1. Three defects in this project share one shape: a path computed in two
places can be redirected in one. `runtime.DB` was rebindable in name only (D104);
`adapters._journal = None` rebuilt against the live journal instead of disabling it (D155);
an explicit `--file` fell through to the owner's real `MEMORY.md` (D166). Every one wrote
real state while a test believed it had been pointed elsewhere.

SP.0 IS THE CONTROL, and it is the reason this module exists: **setting `ASH_STATE_HOME`
must move every root, and it must do so for a module that imported `statepaths` BEFORE the
variable was set.** A constant bound at import would pass a check that sets the variable
first and fail the only case that matters — a suite that redirects after importing.
"""
import ast
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import statepaths as S

FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def eq(got, want, label):
    if got != want:
        FAIL.append(f"{label}\n     got: {got!r}\n    want: {want!r}")


# ── SP.0  CONTROL: redirect AFTER import, and every root moves ─────────────────────────
# `statepaths` is imported at the top of this file, before the variable below is set. That
# ordering is the point.
before = S.describe()
ok(str(Path.home()) in before["config"],
   f"SP.0 by default the roots are under the person's home: {before['config']}")
eq(before["overridden"], False, "SP.0 and nothing is overridden")

os.environ["ASH_STATE_HOME"] = "/tmp/ash-sp-test"
try:
    after = S.describe()
    for name in ("config", "runtime", "cache", "logs"):
        ok(after[name].startswith("/tmp/ash-sp-test"),
           f"SP.0 CONTROL: `{name}` moved to the override AFTER import — a constant bound "
           f"at import would pass a check that sets the variable first and fail the only "
           f"case that matters: {after[name]}")
    eq(after["overridden"], True, "SP.0 and it says so")
    ok(after["config"] != before["config"], "SP.0 the roots really changed")
finally:
    os.environ.pop("ASH_STATE_HOME", None)

eq(S.describe()["config"], before["config"],
   "SP.0 and removing the override puts them back — the resolution is live, not latched")

# ── SP.1  the roots are distinct, and distinct for a reason ────────────────────────────
roots = {k: str(v()) for k, v in S.ROOTS.items()}
eq(len(set(roots.values())), 3,
   f"SP.1 runtime and cache are their own places; config and logs share the top level, "
   f"which is where they are today: {roots}")
ok(roots["cache"].endswith("/cache"),
   "SP.1 cache is separable — it is the only root that is safe to delete without asking, "
   "and that is only true if it is not mixed in with the others")
ok(roots["runtime"].endswith("/run"),
   "SP.1 and runtime is its own, so 'wipe live state' cannot take the person's settings")

for name, fn in S.ROOTS.items():
    ok(isinstance(fn(), Path), f"SP.1 {name} is a Path, not a string to be joined by hand")

# ── SP.2  the brain is named, and not written to ───────────────────────────────────────
ok(S.brain().name == "brain" and S.brain().parent.name == ".orbs",
   f"SP.2 the brain root is known: {S.brain()}")
os.environ["ASH_HOME"] = "/tmp/brain-elsewhere"
try:
    eq(str(S.brain()), "/tmp/brain-elsewhere",
       "SP.2 and follows ASH_HOME, because two installs share this machine and the "
       "wrong one has been edited before")
finally:
    os.environ.pop("ASH_HOME", None)

src = (HERE/"statepaths.py").read_text()
tree = ast.parse(src)
writes = [ast.unparse(n) for n in ast.walk(tree) if isinstance(n, ast.Call)
          and isinstance(n.func, ast.Attribute)
          and n.func.attr in ("mkdir", "write_text", "write_bytes", "unlink", "replace")]
eq(writes, [],
   f"SP.2 CONTROL: this module creates NOTHING. It answers where things go; a module that "
   f"also makes directories cannot be asked a hypothetical question, and every caller that "
   f"only wanted to know would leave a trail: {writes}")

# ── SP.3  no constant is bound at import ───────────────────────────────────────────────
# D104's lesson at the root. A module-level `BASE = Path.home()/...` would defeat every
# redirect silently — the test passes while writing the person's real state.
bound = []
for n in tree.body:
    if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name):
        v = ast.unparse(n.value)
        if "Path.home()" in v or "environ" in v:
            bound.append(n.targets[0].id)
eq(bound, [],
   f"SP.3 no root is computed at import time — it would be redirectable in name only, "
   f"which is D104, D155 and D166's shared shape: {bound}")

# ── SP.4  it runs, and says which are overridden ───────────────────────────────────────
p = subprocess.run([sys.executable, str(HERE/"statepaths.py")],
                   capture_output=True, text=True, timeout=30)
eq(p.returncode, 0, f"SP.4 it runs: {p.stderr[-200:]}")
for name in ("config", "runtime", "cache", "logs", "brain"):
    ok(name in p.stdout, f"SP.4 and prints {name}")
ok("ASH_STATE_HOME" not in p.stdout, "SP.4 quiet when nothing is overridden")

p = subprocess.run([sys.executable, str(HERE/"statepaths.py")],
                   capture_output=True, text=True, timeout=30,
                   env=dict(os.environ, ASH_STATE_HOME="/tmp/ash-sp-2"))
ok("ASH_STATE_HOME is set" in p.stdout,
   f"SP.4 and says so when they are — a redirected daemon that looks identical to a normal "
   f"one is how a test's state ends up somewhere nobody looks: {p.stdout!r}")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

# ── SP.6  the modules USE it (5.9's open half, closed 2026-09-22) ─────────────────────────
# A root nobody reads is a document. 28 modules each built `Path.home()/"ash/voice"` for
# themselves, so `ASH_STATE_HOME` moved statepaths and left every one of them writing the
# person's real home. Two checks, and the second is the one that matters:
#   SP.6a static: no daemon module builds the voice home by hand. The exempt set is named, each
#         with its reason, because both of them are ABOUT the real machine.
#   SP.6b behavioural: every module that names the voice home, imported in a child process
#         with ASH_STATE_HOME pointed at a temp dir, has every module-level voice-home path
#         INSIDE that dir — a check of where writes would land, not of how the source reads.
import ast as _ast6
import subprocess as _sp6
import tempfile as _tf6
import shutil
import json
HERE6 = Path(__file__).resolve().parent
EXEMPT6 = {"statepaths.py": "it is the root",
           "baseline.py": "it measures the REAL machine's logs and ledger, by design",
           "write_guard.py": "it protects the REAL files; redirecting it would guard a fixture",
           "chaincheck.py": "it checks the RUNNING system — the live services and their files",
           "chaincheck_live.py": "the same, with a real build on the live desktop"}


def _hand_built(src):
    hits = []
    for n in _ast6.walk(_ast6.parse(src)):
        if isinstance(n, _ast6.BinOp) and isinstance(n.op, _ast6.Div) \
                and isinstance(n.right, _ast6.Constant) and n.right.value == "ash/voice":
            # ANY left side. The first version required `home()` there and walked past
            # `HOME/"ash/voice"` in three modules — found by SP.6b, which imports them.
            hits.append(n.lineno)
    return hits


_hand = {f.name: _hand_built(f.read_text()) for f in sorted(HERE6.glob("*.py"))
         if not f.name.startswith("test_") and f.name not in EXEMPT6}
_hand = {k: v for k, v in _hand.items() if v}
eq(_hand, {}, "SP.6a no daemon module builds ~/ash/voice by hand — they ask statepaths")
ok(_hand_built('from pathlib import Path\nCFG = Path.home()/"ash/voice"\n') == [2],
   "SP.6a CONTROL: the shipped shape is caught")
ok(_hand_built('HOME = Path.home()\nCFG = HOME/"ash/voice"\n') == [2],
   "SP.6a CONTROL: and the HOME-variable shape SP.6b found in three modules")

_users = [f.stem for f in sorted(HERE6.glob("*.py")) if not f.name.startswith("test_")
          and f.name not in EXEMPT6 and ("statepaths." in f.read_text()
                                         or '"ash/voice"' in f.read_text())]
_probe = r"""
import importlib, json, sys, os
from pathlib import Path
home = Path(os.environ["ASH_STATE_HOME"]).resolve()
real = (Path.home()/"ash/voice").resolve()
out = {}
for name in sys.argv[1:]:
    try:
        m = importlib.import_module(name)
    except Exception as e:
        out[name] = f"IMPORT {type(e).__name__}: {e}"; continue
    bad = []
    for k, v in vars(m).items():
        vals = v if isinstance(v, (list, tuple)) else [v]
        for x in vals:
            if isinstance(x, Path) and str(x.resolve()).startswith(str(real)):
                bad.append(f"{k}={x}")
    if bad:
        out[name] = bad
print(json.dumps(out))
"""
_home6 = Path(_tf6.mkdtemp(prefix="statepaths-sp6-"))
try:
    _r = _sp6.run([sys.executable, "-c", _probe, *_users], cwd=HERE6, capture_output=True,
                  text=True, timeout=180,
                  env=dict(os.environ, ASH_STATE_HOME=str(_home6), PYTHONPATH=str(HERE6)))
    try:
        _leaks = json.loads(_r.stdout.strip().splitlines()[-1]) if _r.stdout.strip() else {"probe": _r.stderr[-300:]}
    except ValueError:
        _leaks = {"probe": (_r.stdout + _r.stderr)[-300:]}
    ok(len(_users) >= 5, f"SP.6b CONTROL: the probe covers the swept modules, not a handful: {len(_users)}")
    eq(_leaks, {}, "SP.6b with ASH_STATE_HOME set, no module-level path still points at the real "
                   "~/ash/voice — where writes would land, measured by importing them")
finally:
    shutil.rmtree(_home6, ignore_errors=True)

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print("✓ state paths: 7 groups green (SP.0 control: a redirect after import moves every root)")
