#!/usr/bin/env python3
"""The memory index's budget is a number, and going over it is named, never trimmed.

Run: orb/daemon/.venv/bin/python test_memindex.py

PLAN 14.8. `MEMORY.md` says of itself *"one line per fact, keep the hook under ~90
characters… this index is injected into EVERY session"*, and nothing enforced any of it.
Hard rule 5 aimed at Ash's own memory: a rule that lives only in prose competes with
everything else in context and loses.

MI.0 IS THE CONTROL, and it is the row's own sentence: **over budget must NAME WHAT TO
CONSOLIDATE, never drop anything.** A store that quietly sheds entries is indistinguishable
from one that never learned them, and the person cannot tell which happened — so they stop
trusting the store instead of fixing it.

**Every case is a FIXTURE.** `MEMORY.md` is owner-owned (hard rule 3): this suite never
reads it, never writes it, and asserts that the module cannot either.
"""
import ast
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import memindex as M

FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def eq(got, want, label):
    if got != want:
        FAIL.append(f"{label}\n     got: {got!r}\n    want: {want!r}")


def index(n_entries=3, hook="a short hook", extra=""):
    lines = [f"- [Memory {i}](mem-{i}.md) — {hook}" for i in range(n_entries)]
    return "\n".join(lines) + ("\n" + extra if extra else "") + "\n"


# ── MI.0  CONTROL: it names, it never drops ────────────────────────────────────────────
fat = index(3, hook="x" * 200)
before = M.measure(fat)
findings = M.over_budget(fat)
ok(findings, "MI.0 an index with 200-character hooks is over budget")
eq(M.measure(fat), before,
   "MI.0 CONTROL: and measuring it CHANGED NOTHING — a store that quietly sheds entries is "
   "indistinguishable from one that never learned them, and the person cannot tell which "
   "happened, so they stop trusting the store instead of fixing it")
for what, why in findings:
    ok(what.strip() and why.strip(), f"MI.0 every finding names a thing and a reason: {what}")
ok(any("Memory 0" in w for w, _ in findings),
   f"MI.0 including WHICH entries — 'the index is too big' is not actionable: "
   f"{[w for w, _ in findings][:4]}")

# the module must have no way to write at all
src = (HERE/"memindex.py").read_text()
tree = ast.parse(src)
# `str.replace` IS NOT A FILE MOVE. Matching on the attribute NAME flagged
# `str(Path.home()).replace("/", "-")` — deriving a directory name, which writes nothing —
# as a write. CLAUDE.md §12 already records this exact one ("`str.replace` matched as a file
# move"), so the rule is not new; matching a name instead of reading structure is what keeps
# reproducing it. `os.replace(a, b)` and `Path.replace(target)` are the file operations, and
# both differ from the string method in a way the tree can see: `os.replace` is called on the
# `os` module, and a string `.replace` takes two arguments where the path method takes one.
def _is_file_write(n):
    if not (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)):
        return False
    attr = n.func.attr
    if attr in ("write_text", "write_bytes", "unlink", "rename", "mkdir", "touch", "rmdir"):
        return True
    if attr == "replace":
        # os.replace(src, dst) — a module call with two arguments.
        if isinstance(n.func.value, ast.Name) and n.func.value.id == "os":
            return True
        # Path.replace(target) takes ONE argument; str.replace(old, new) takes two.
        return len(n.args) == 1
    return False


writes = [ast.unparse(n) for n in ast.walk(tree) if _is_file_write(n)]
eq([w for w in writes if "read" not in w], [],
   f"MI.0 CONTROL: and it CANNOT write — `MEMORY.md` is owner-owned (hard rule 3), so this "
   f"row proposes and the owner applies: {writes}")

# ── MI.1  the numbers are the file's own rules ─────────────────────────────────────────
eq(M.MAX_HOOK_CHARS, 90,
   "MI.1 90 characters is not a new limit — it is what the index says about itself")
eq(M.MAX_ENTRIES, 100, "MI.1 and 100 is ASH_MEMORY_CAP's own value, honoured not nudged at")

small = index(3)
eq(M.over_budget(small), [], "MI.1 a small tidy index is within budget")
said, f = M.report(small)
ok("within budget" in said, f"MI.1 and says so plainly: {said!r}")

# ── MI.2  each rule fires on its own ───────────────────────────────────────────────────
long_hook = index(2, hook="y" * 120)
hits = [w for w, _ in M.over_budget(long_hook)]
eq(len(hits), 2, f"MI.2 both long hooks are named: {hits}")
ok(all("Memory" in h for h in hits), f"MI.2 by title: {hits}")

many = index(140)
hits = M.over_budget(many)
ok(any("entry count" in w for w, _ in hits), "MI.2 too many entries is its own finding")
ok(any("consolidate or retire" in why for _, why in hits),
   f"MI.2 phrased as the action to take: {[w for _, w in hits][:2]}")

loose = index(2) + "\nsome prose that is not an entry\nand another line\n"
hits = M.over_budget(loose)
ok(any("not entries" in w for w, _ in hits),
   f"MI.2 lines that are not entries are named — the index's own rule is one line per "
   f"memory: {[w for w, _ in hits]}")

huge = index(3, hook="z" * 5000)
hits = M.over_budget(huge)
eq(hits[0][0], "the whole index",
   "MI.2 and the WORST comes first — a list that opens with twelve long hooks buries the "
   "fact that the file is thousands of characters over")

# ── MI.3  it parses the real shape ─────────────────────────────────────────────────────
real_shape = ("- [Switch FTP access](switch-ftp-access.md) — sys-ftpd creds + IP for "
              "network access to the SD card\n")
parsed = M.parse(real_shape)
eq(len(parsed), 1, "MI.3 the live index's line shape parses")
eq(parsed[0][0], "Switch FTP access", "MI.3 title")
eq(parsed[0][1], "switch-ftp-access.md", "MI.3 file")
ok(parsed[0][2].startswith("sys-ftpd"), f"MI.3 hook: {parsed[0][2]!r}")

eq(M.parse("# A heading\n\nsome prose\n"), [],
   "MI.3 CONTROL: and prose is not mistaken for an entry — otherwise every heading would "
   "count towards the cap")

# ── MI.4  reading a missing index is not an error ──────────────────────────────────────
D = Path(tempfile.mkdtemp(prefix="mi-"))
eq(M.read_index(D/"not-there.md"), None,
   "MI.4 a missing index reads as nothing rather than raising")
(D/"one.md").write_text(index(2))
ok(M.read_index(D/"one.md"), "MI.4 and a real one reads")

eq(M.over_budget(""), [], "MI.4 an empty index is not over budget")
eq(M.over_budget(None), [], "MI.4 nor is nothing at all")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

# ── MI.6  WARN ONLY (owner, 2026-09-23): named, worst first, nothing refused ──────────
w = M.warning(huge)
ok(w and w.startswith("the memory index is over budget"), f"MI.6 over budget warns: {w!r}")
_i_whole, _i_hook = (w.find("the whole index"), w.find("Memory 0")) if w else (-1, -1)
# `find` is -1 when absent, and -1 sorts FIRST: "whole < hook" alone passed a planted warning
# that listed the three smallest findings and left the whole index out entirely.
ok(0 <= _i_whole < _i_hook,
   f"MI.6 worst first — the whole index named, and before any one hook: {w!r}")
ok(w and "Nothing was dropped" in w,
   "MI.6 and says nothing was dropped — 'over budget' alone reads like something was thrown "
   "away")
eq(M.warning(small), None, "MI.6 CONTROL: a tidy index gets no warning at all, so MI.6 is not "
                           "a sentence printed unconditionally")
_many = M.warning(index(6, hook="q" * 120), top=3)
ok(_many and "and 3 more" in _many, f"MI.6 past the top three it counts the rest: {_many!r}")
eq(M.over_budget(huge), M.over_budget(huge), "MI.6 warning() is a pure read of the text")

# brain_index() is the index voice_distill APPENDS to — the same root, resolved at call time
import importlib.util as _ilu
import os as _os
_saved_env = {k: _os.environ.get(k) for k in ("ASH_BRAIN_HOME", "HOME")}
try:
    _root = Path(tempfile.mkdtemp(prefix="mi6-"))
    _os.environ["ASH_BRAIN_HOME"] = str(_root/"brain")

    # ── MI.7  D349: the default is ASH'S index, not Claude Code's ─────────────────────
    _os.environ["HOME"] = str(_root/"home")
    _cc = _root/"home"/".claude"/"projects"/("-" + str(_root/"home").strip("/").replace("/", "-"))/"memory"
    _cc.mkdir(parents=True)
    (_cc/"MEMORY.md").write_text("- [CLAUDE CODE'S](x.md) — a different assistant\n")
    (_root/"brain"/"memory").mkdir(parents=True)
    (_root/"brain"/"memory"/"MEMORY.md").write_text("- [ASH'S](y.md) — his own\n")
    _got = M.read_index() or ""
    ok("ASH'S" in _got and "CLAUDE" not in _got,
       f"MI.7 with no path it reads Ash's own index, even with a Claude Code one present: {_got!r}")
    # CONTROL: the pre-fix default, planted into a COPY, reads the other assistant's memory —
    # so MI.7 is measuring the default and not a machine that happens to lack a Claude index.
    _OLD = """    _cc_project = "-" + str(Path.home()).strip("/").replace("/", "-")
    for candidate in (Path.home()/".claude"/"projects"/_cc_project/"memory"/"MEMORY.md",
                      Path.home()/"ash/brain"/"memory"/"MEMORY.md"):
        try:
            return candidate.read_text(errors="replace")
        except OSError:
            continue
    return None
"""
    _msrc = (HERE/"memindex.py").read_text()
    _new = "    p = Path(path) if path is not None else brain_index()\n"
    if _new not in _msrc:
        FAIL.append("MI.7 CONTROL: the default's line moved, so the pre-fix copy cannot be planted")
    else:
        _planted = _msrc.replace(_new, "    if path is not None:\n        p = Path(path)\n"
                                       "        try:\n            return p.read_text(errors='replace')\n"
                                       "        except OSError:\n            return None\n" + _OLD
                                       + "    p = None\n", 1)
        _pd = Path(tempfile.mkdtemp(prefix="mi7-")); (_pd/"memindex.py").write_text(_planted)
        _ps = _ilu.spec_from_file_location("mi7_old", _pd/"memindex.py")
        _pm = _ilu.module_from_spec(_ps); _ps.loader.exec_module(_pm)
        _old = _pm.read_index() or ""
        ok("CLAUDE" in _old,
           f"MI.7 CONTROL: the pre-fix default reads Claude Code's index here — the D349 "
           f"condition is really in the fixture: {_old!r}")
finally:
    for _k, _v in _saved_env.items():
        if _v is None:
            _os.environ.pop(_k, None)
        else:
            _os.environ[_k] = _v

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print("✓ memory index: 8 groups green (MI.0 control: it names what to consolidate and "
      "changes nothing; MI.6 warns, never refuses)")
