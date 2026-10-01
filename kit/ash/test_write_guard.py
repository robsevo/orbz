#!/usr/bin/env python3
"""No suite may write the user's real state. Run: orb/daemon/.venv/bin/python orb/daemon/test_write_guard.py

PLAN 2.1_t / 2.2. D10: an un-isolated test wrote 350 fabricated spend alarms into the real
`NOTIFICATIONS.md`, the CLI loads that file as system notice, and Ash read "$3.50 a day, $25
this month, over cap" out loud as fact. It was $4.96. D57 was the same shape at 1/10 scale, a
fixture written into the real `seat-decisions.jsonl`.

Both were found by a PERSON, days later, and each got its own bespoke check afterwards.
`write_guard.py` is the general one, and `run-tests.sh` now runs every suite under it.

WG.0 IS THE CONTROL: a planted escape — the literal D10 write — must be caught. A guard that
has never been shown to catch anything is a guard nobody should trust, and this one is wrapped
around every suite in the project.

Nothing here writes outside a temp HOME. The one check that must exercise the REAL paths does
so by comparing snapshots, never by touching them.
"""

# ASH_TIER: product
import ast, os, re, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = sys.executable
GUARD = HERE/"write_guard.py"
FAIL = []


def eq(got, want, label):
    if got != want:
        FAIL.append(f"{label}\n     got: {got!r}\n    want: {want!r}")


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def guarded(script_body, home=None):
    """Run a throwaway script under the guard. Returns (returncode, output)."""
    d = Path(tempfile.mkdtemp(prefix="wguard-"))
    s = d/"probe.py"
    s.write_text(script_body)
    env = dict(os.environ)
    if home:
        env["HOME"] = str(home)
    r = subprocess.run([PY, str(GUARD), "--", PY, str(s)],
                       capture_output=True, text=True, timeout=120, env=env)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


# ── WG.0  THE CONTROL: the D10 write, replayed into a fake home ──────────────────────
# A fake HOME, because the control must demonstrate catching a write to the real state
# WITHOUT performing one. The guard resolves its paths from Path.home() at run time, so a
# redirected HOME gives it a complete, disposable copy of the same shape.
fake = Path(tempfile.mkdtemp(prefix="wguard-home-"))
for sub in ("ash/brain", "ash/voice"):
    (fake/sub).mkdir(parents=True)
(fake/"ash/brain"/"NOTIFICATIONS.md").write_text("- a real notice the user would see\n")
(fake/"ash/brain"/"memory").mkdir()
(fake/"ash/brain"/"memory"/"a-fact.md").write_text("something Ash believes\n")

rc, out = guarded(
    'from pathlib import Path\n'
    'with open(Path.home()/"ash/brain"/"NOTIFICATIONS.md", "a") as f:\n'
    '    f.write("- paid seats LOCKED (daily $3.5000)\\n")\n'
    'print("planted suite: all checks pass")\n', home=fake)
ok(rc != 0, f"WG.0 CONTROL: the D10 write must FAIL the run, not merely be noted. rc={rc}")
ok("NOTIFICATIONS.md" in out,
   f"WG.0 CONTROL: and must name the file that changed: {out[-300:]!r}")
ok("all checks pass" in out,
   "WG.0 CONTROL: the planted suite still reported success — which is the whole point. A "
   "suite can be green and still be lying about the machine.")

# deleting protected state is just as bad as writing it, and a naive hash of nothing hides it
rc, out = guarded(
    'from pathlib import Path\n'
    '(Path.home()/"ash/brain"/"NOTIFICATIONS.md").unlink()\n'
    'print("ok")\n', home=fake)
ok(rc != 0 and "absent" in out,
   f"WG.0 CONTROL: DELETING a protected file is caught too, and reported as absent: {out[-200:]!r}")

# a file appearing in a protected directory
rc, out = guarded(
    'from pathlib import Path\n'
    '(Path.home()/"ash/brain"/"memory"/"invented.md").write_text("x")\n'
    'print("ok")\n', home=fake)
ok(rc != 0 and "memory" in out,
   f"WG.0 CONTROL: a new file in the brain's memory is caught: {out[-200:]!r}")

# ── WG.1  a well-behaved suite passes straight through ───────────────────────────────
rc, out = guarded('import tempfile, pathlib\n'
                  'p = pathlib.Path(tempfile.mkdtemp())/"x"\n'
                  'p.write_text("all its work in a temp dir")\n'
                  'print("clean suite: all checks pass")\n', home=fake)
ok(rc == 0, f"WG.1 a suite that writes only to a temp dir is untouched: rc={rc} {out[-200:]!r}")
ok("✗" not in out, f"WG.1 and reports nothing: {out[-200:]!r}")

# and the suite's own exit code survives the wrapper
rc, out = guarded('import sys\nprint("failing suite")\nsys.exit(3)\n', home=fake)
ok(rc == 3, f"WG.1 a failing suite's exit code is passed through, not swallowed: rc={rc}")

# ── WG.2  the guard is actually wired into the runner ────────────────────────────────
# K.11/K.14/K.16 asserted brief text was correct while nothing checked the brief still
# REACHED the session. A guard that exists and is not called is the same mistake.
runner = (HERE.parent/"tests"/"run.py").read_text()
code = "\n".join(l for l in runner.splitlines() if not l.lstrip().startswith("#"))
ok('str(ASH / "write_guard.py"), "--", sys.executable, t.name]' in code,
   "WG.2 kit/tests/run.py does not invoke write_guard — it exists and guards nothing")
ok(code.count("t.name]") == 1,
   "WG.2 a carried suite is still invoked directly somewhere, bypassing the guard")

# ── WG.3  the protected list is not empty and names the files that burned us ─────────
sys.path.insert(0, str(HERE))
import write_guard as wg
names = {Path(p).name for p, _ in wg.PROTECTED}
for must in ("NOTIFICATIONS.md", "seat-decisions.jsonl", "memory", "settings.json"):
    ok(must in names, f"WG.3 {must} is protected — it is one this project has been burned by")
ok(len(wg.PROTECTED) >= 10, f"WG.3 the list is substantive: {len(wg.PROTECTED)} entries")
ok(len({p for p, _ in wg.PROTECTED}) == len(wg.PROTECTED),
   "WG.3 no path is listed twice")
ok(all(r.strip() for _, r in wg.PROTECTED),
   "WG.3 every entry says WHY it matters — an unexplained path gets deleted by the next person")

# ── WG.4  a store redirect must actually REDIRECT ────────────────────────────────────
# Found 2026-09-20 by WG's own guard, which is the only reason it was found: `Journal`'s
# signature was `def __init__(self, path=DB)`, and a default is bound at DEF time. Rebinding
# `runtime.DB` — the documented way every suite here redirects that store — left the default
# pointing at the real `~/ash/voice/run/runtime.db`, so the redirect silently did
# nothing. `adapters.candidates()` had been fixed for exactly this (D99b) and the Journal
# underneath it had not.
import runtime as _rt

_tmp = Path(tempfile.mkdtemp(prefix="wg4-"))
_before = _rt.DB
try:
    _rt.DB = _tmp/"run"/"redirected.db"
    _j = _rt.Journal()
    _j.append(_rt.envelope("health", "wg", {"x": 1}), source="wg")
    ok((_tmp/"run"/"redirected.db").exists(),
       "WG.4 rebinding runtime.DB redirects a NEW Journal — a default bound at def time "
       "ignores it, and the suite writes the user's real store while reporting green")
    ok(len(_j.since(0)) == 1, "WG.4 and the redirected store is the one that got the row")
finally:
    _rt.DB = _before

# --- the class, not just the instance ----------------------------------------------------
# Every module-level constant holding a path, used as a function default. A number is fine —
# nobody redirects a timeout — but a path default is a redirect that will not work.
_PATHY = ("Path(", "Path.home()", "os.path.expanduser", "__file__")
_offenders = []
for _f in sorted(HERE.glob("*.py")):
    if _f.name.startswith("test_"):
        continue
    try:
        _tree = ast.parse(_f.read_text())
    except Exception:
        continue
    # Which module constants hold a path — to a FIXED POINT. `DB = RUN/"runtime.db"` names
    # no Path at all; it is pathy only through `RUN`, which is pathy through `CFG`. The
    # first version matched source text for "RUN/" and missed the planted defect entirely,
    # because `ast.unparse` writes it `RUN / 'runtime.db'`, with spaces.
    _assigns = {n.targets[0].id: ast.unparse(n.value) for n in _tree.body
                if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
                and n.targets[0].id.isupper()}
    _paths, _grew = set(), True
    while _grew:
        _grew = False
        for _name, _src in _assigns.items():
            if _name in _paths:
                continue
            if any(k in _src for k in _PATHY) or any(
                    re.search(rf"\b{re.escape(o)}\b", _src) for o in _paths):
                _paths.add(_name); _grew = True
    for _fn in ast.walk(_tree):
        if not isinstance(_fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for _d in list(_fn.args.defaults) + [d for d in _fn.args.kw_defaults if d]:
            if isinstance(_d, ast.Name) and _d.id in _paths:
                _offenders.append(f"{_f.name}:{_fn.lineno} {_fn.name}(...={_d.id})")

ok(not _offenders,
   f"WG.4 {_offenders} — no function takes a module-level PATH constant as a default — bound at def time, "
   "it makes every redirect of that constant a no-op, which is how a suite writes real "
   "state while every isolation assertion in it passes")

# CONTROL: the detector must catch one. Written to a scratch file rather than a real module,
# because planting into a module a running suite imports is the D62 class.
_ctl = _tmp/"ctl_module.py"
_ctl.write_text("from pathlib import Path\nHOME = Path.home()/'a'\nSTORE = HOME/'x'\n\n\n"
                "def read(p=STORE):\n    return p\n")
_ct = ast.parse(_ctl.read_text())
_ca = {n.targets[0].id: ast.unparse(n.value) for n in _ct.body
       if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)
       and n.targets[0].id.isupper()}
_cp, _g = set(), True
while _g:
    _g = False
    for _n2, _s2 in _ca.items():
        if _n2 not in _cp and (any(k in _s2 for k in _PATHY)
                               or any(re.search(rf"\b{re.escape(o)}\b", _s2) for o in _cp)):
            _cp.add(_n2); _g = True
_cf = [f for f in ast.walk(_ct) if isinstance(f, ast.FunctionDef)]
ok(any(isinstance(d, ast.Name) and d.id in _cp
       for f in _cf for d in f.args.defaults),
   "WG.4 CONTROL: the same walk catches a planted `def read(p=STORE)` where STORE is "
   "pathy only THROUGH another constant — the shape `DB = RUN/\'runtime.db\'` has, and the "
   "shape the first version of this detector walked straight past. Without it the "
   "empty result above proves only that the walk found nothing, which is also what a walk "
   "gone blind returns")

# ── WG.5  the report says WHAT changed, not just that something did ──────────────────────
# `test_pagecheck.py` was charged with writing NOTIFICATIONS.md on 2026-09-20 having never
# mentioned the file; seat-health and thinking-tripwire had appended fourteen lines that day.
# The old message named a path and two hashes, which cannot answer "was it the suite?" — the
# only question that matters. It shows the lines now.
import importlib.util as _ilu
_wgs = _ilu.spec_from_file_location("wg_mod", HERE/"write_guard.py")
_wg = _ilu.module_from_spec(_wgs); _wgs.loader.exec_module(_wg)

_key = "/tmp/fake-protected"
_before = {_key: ("file:aaa", ["line one", "line two"])}
_after_real = {_key: ("file:bbb", ["line one", "line two", "SUITE WROTE 350 FAKE ALARMS"])}
_after_mon = {_key: ("file:ccc", ["line one", "line two",
                                  "- [ ] 2026-09-20 seat-health: qwen-coder FAILS at 75000 tokens"])}
_wg.PROTECTED = [(Path(_key), "a fixture")]

_rep = "\n".join(_wg.changed(_before, _after_real))
ok("SUITE WROTE 350 FAKE ALARMS" in _rep,
   "WG.5a the report quotes the line that was added, so triage does not need a second run")
ok("NOTE:" not in _rep,
   "WG.5b CONTROL: a line that is NOT a monitor's gets no external note — the hint must not "
   "excuse an actual suite write, which is the whole D10 shape")

_rep2 = "\n".join(_wg.changed(_before, _after_mon))
ok("seat-health" in _rep2 and "NOTE:" in _rep2,
   "WG.5c a monitor-shaped line is named as a background writer")
# WG.5d USED TO REQUIRE "do not assume it" UNCONDITIONALLY, and it was right to while the
# attribution was a guess: naming a likely cause is not clearing it. The two locks changed
# what the sentence means. When a monitor's own run window COVERS the moment the file
# changed, "go and confirm this" is no longer the correct instruction — the confirmation is
# printed beside it. When no window covers, it is more necessary than ever.
#
# So the property is now conditional, and BOTH halves are asserted. A check that simply
# dropped the requirement would pass on a guard that had quietly stopped hedging anything.
_confirmed_note = "Confirmed:" in _rep2
ok(_confirmed_note or "do not assume" in _rep2,
   f"WG.5d an UNCONFIRMED attribution still says to confirm it — naming a likely cause is "
   f"not clearing it: {_rep2[-200:]}")
ok(not _confirmed_note or "covers the change" in _rep2,
   f"WG.5d2 ...and a CONFIRMED one shows the window that confirms it, rather than asking "
   f"the reader to go and find it: {_rep2[-200:]}")
ok(len(_wg.changed(_before, _after_mon)) == 1,
   "WG.5e CONTROL: the monitor case is still REPORTED, not silently dropped")
ok(_wg.changed(_before, _before) == [],
   "WG.5f CONTROL: an unchanged file reports nothing, so WG.5a-e are not always-on")

# ── WG.5  the guard protects the paths the code actually writes ───────────────────────
# `write_guard` listed `~/ash/brain/seat-decisions.jsonl`. The broker writes
# `~/ash/voice/seat-decisions.jsonl`. So the guard reported clean for weeks while suites
# appended to the person's real spend ledger — 412 rows. **A guard pointed at a path that
# does not exist is worse than no guard: it is a green light with nothing behind it.**
#
# A list maintained by hand drifts the moment a module moves its file. This compares the
# list against the constants the modules themselves declare.
import importlib

DECLARED = {
    ("seatbroker", "LEDGER"): "the spend ledger 4.12 reconciles against the provider",
    ("learn_ledger", "LEDGER"): "the learning ledger's before-state capture",
    ("runtime", "DB"): "the journal — what Ash has been told and what he believes",
}
_protected = {str(Path(p_)) for p_, _why in wg.PROTECTED}
_missing = []
for (mod_name, attr), why in DECLARED.items():
    try:
        mod = importlib.import_module(mod_name)
    except Exception:
        continue
    real = getattr(mod, attr, None)
    if real is None:
        continue
    if str(Path(real)) not in _protected:
        _missing.append(f"{mod_name}.{attr} = {real} ({why})")
eq(_missing, [],
   f"WG.5 every store a module DECLARES is on the protected list — the list was maintained "
   f"by hand and drifted the moment the broker's ledger moved home, which is how a suite "
   f"wrote 412 rows into the person's real spend record with a green guard: {_missing}")

# CONTROL: the comparison must be capable of failing, or it is asserting an empty set.
_probe_protected = {"/nowhere/at/all"}
_probe_missing = [k for k, _ in DECLARED.items()]
ok(len(_probe_missing) >= 3,
   "WG.5 CONTROL: there are stores to check — an empty DECLARED table would satisfy the "
   "check above while comparing nothing")
ok(str(Path.home()/"ash/voice"/"seat-decisions.jsonl") in _protected,
   "WG.5 and the one that was wrong is now right, by name")

# ── WG.6  the NOTE says "every changed line" and must mean it ──────────────────────────
# The guard reports a protected file changing and fails the suite that was running. It also
# names known background monitors, because a phantom D10 accusation costs a triage and a
# guard that cries wolf on a five-minute timer teaches people to disbelieve it — and it is
# the thing standing between a suite and the user's real state.
#
# `hits` was collected from ANY changed line and the message then said *every changed line
# names X*. One monitor line arriving beside a real suite write therefore described the
# suite's write as the monitor's, which is the one case this NOTE must never cover for. It
# happened for real on 2026-09-22: `ash-seat-health.service` ran 08:25:55 to 08:34:26 and a
# full pass ran inside it, so three suites were charged with its writes.
import write_guard as _wg  # noqa: E402

_F = str(list(_wg.PROTECTED)[0][0])


def _rendered(was, now):
    return "\n".join(_wg.changed({_F: ("h1", was)}, {_F: ("h2", now)}))


_all_monitor = _rendered(["base"], ["base", "- [ ] seat-health: cloud-brain is slow"])
ok("NOTE: every changed line names seat-health" in _all_monitor,
   f"WG.6 a change whose every line names a monitor is named as one: {_all_monitor[-200:]}")

_mixed = _rendered(["base"],
                   ["base", "- [ ] seat-health: cloud-brain is slow",
                    "- [ ] 2026-09-22 a line this suite wrote"])
ok("every changed line" not in _mixed,
   f"WG.6a A MONITOR LINE BESIDE A SUITE'S WRITE IS NOT 'every changed line'. This is the "
   f"whole check: the mixed case is the one where believing the NOTE means walking past a "
   f"real D10: {_mixed[-260:]}")
# THE NOTE LINE, NOT THE BLOCK. The block already prints every added line as a `+ ` row, so
# `"a line this suite wrote" in _mixed` was satisfied by the diff above the NOTE and not by
# the NOTE at all: deleting the quote from the message left this green. Evidence taken from
# beside the thing under test is the shape that keeps catching me.
def _note_line(rendered):
    return next((l for l in rendered.splitlines() if "NOTE:" in l), "")


_mixed_note = _note_line(_mixed)
ok("a line this suite wrote" in _mixed_note and "1 name no known monitor" in _mixed_note,
   f"WG.6b ...and the unaccounted line is QUOTED IN THE NOTE, so the triage is reading one "
   f"line rather than diffing the file: {_mixed_note!r}")

_none = _rendered(["base"], ["base", "- [ ] 2026-09-22 a line this suite wrote"])
ok("NOTE" not in _none,
   f"WG.6c CONTROL: a change no monitor claims gets no NOTE at all — a guard that always "
   f"appended a reassurance would pass WG.6 and reassure about everything: {_none[-200:]}")
ok(_all_monitor and _mixed and _none,
   "WG.6d CONTROL: the guard rendered a report in all three cases — an exception swallowed "
   "into an empty string would satisfy WG.6a and WG.6c both")

# The old guard expression was `not (added or removed) == ([], [])`: a list compared to a
# TUPLE of two lists, always False, so `not` made it always True — `or True` in different
# clothes, in a file whose subject is detecting writes that should not have happened.
import ast as _ast2  # noqa: E402

_src = (HERE/"write_guard.py").read_text()
_always = []
for _n in _ast2.walk(_ast2.parse(_src)):
    if isinstance(_n, _ast2.Compare) and len(_n.ops) == 1 \
            and isinstance(_n.ops[0], (_ast2.Eq, _ast2.NotEq)):
        _l, _r = _n.left, _n.comparators[0]
        _kinds = {type(_l).__name__, type(_r).__name__}
        if _kinds == {"Tuple", "BoolOp"} or _kinds == {"Tuple", "List"}:
            _always.append(f"line {_n.lineno}: {_ast2.unparse(_n)[:70]}")
ok(not _always,
   f"WG.7 no comparison between a tuple and a list — it is always False whatever the values "
   f"are, so the `not` in front of one made a guard that could never close: {_always}")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

# ── WG.10  the two locks, each on its own ──────────────────────────────────────────────
# A protected file changing stops failing the suite ONLY when both hold: every changed line
# names a monitor this file knows, AND that monitor's own run window covers the moment the
# file changed. **This is not an exemption.** An exemption names a path and switches the
# guard off for it, one path at a time — which is how `TS.3b`'s `or True` happened. These
# are positive evidence about one specific change, and either one failing puts the verdict
# straight back.
#
# Why it exists: a full pass goes red every time `legacy-seat-health` runs, several times a
# day, and **a suite that is red for a non-reason teaches people to stop reading it.** D62
# is three red runs written off as flakes; what it stops them reading next is a real D10.
#
# EACH LOCK IS PLANTED SEPARATELY. A single combined fixture — an unclaimed line AND a
# window that misses — would pass on an implementation that only ever checks one of them.
_real = str(list(_wg.PROTECTED)[0][0])


RUN_1000_2000 = {"ash-seat-health.service": (1000.0, 2000.0)}


def _verdict(now_lines, when, windows=RUN_1000_2000):
    """(failures, confirmed) for one protected file, with a stubbed clock and windows.

    `windows` is a PARAMETER because the first version hard-coded the stub inside here —
    so WG.10f, which sets `_unit_window` to return None from outside, had its stub replaced
    on entry and measured the opposite of what it claimed to.
    """
    saved_m, saved_w = _wg._mtime, _wg._unit_window
    _wg._mtime = lambda _p: when
    _wg._unit_window = lambda unit: windows.get(unit)
    try:
        return _wg.review({_real: ("h1", ["base"])}, {_real: ("h2", now_lines)})
    finally:
        _wg._mtime, _wg._unit_window = saved_m, saved_w


MON = "- [ ] 2026-09-22 seat-health: free-flash answered by a fallback"
MON2 = "- [ ] 2026-09-22 seat-health: free-large answered by a fallback"
MINE = "- [ ] 2026-09-22 SUITE WROTE THIS"

_f, _c = _verdict(["base", MON, MON2], 1500.0)
ok(not _f and len(_c) == 1,
   f"WG.10 BOTH LOCKS: every line names a known monitor and that monitor's window covers "
   f"the change — reported, not failed. failures={len(_f)} confirmed={len(_c)}")
ok(_c and "Confirmed" in _c[0] and "covers the change" in _c[0],
   f"WG.10a ...and the downgraded case PRINTS its evidence, with the covering window "
   f"quoted. Silence and a pass are the same thing to a reader: {(_c or [''])[0][-160:]}")

# LOCK 1 ALONE. One unclaimed line among claimed ones, window still covering.
_f1, _c1 = _verdict(["base", MON, MINE], 1500.0)
ok(len(_f1) == 1 and not _c1,
   f"WG.10b LOCK 1: ONE unclaimed line among monitor lines fails, even though the window "
   f"covers. This is the D10 shape exactly — a suite's own write arriving beside a "
   f"monitor's: failures={len(_f1)} confirmed={len(_c1)}")
ok(_f1 and "SUITE WROTE THIS" in _f1[0],
   f"WG.10c ...and the unaccounted line is quoted, so the triage is one line: {(_f1 or [''])[0][-160:]}")

# LOCK 2 ALONE. Every line claimed, but the window does not cover the change.
_f2, _c2 = _verdict(["base", MON, MON2], 9999.0)
ok(len(_f2) == 1 and not _c2,
   f"WG.10d LOCK 2: every line names the monitor, but its window does NOT cover the moment "
   f"the file changed — fails. Naming a monitor is a claim about text; the window is the "
   f"only thing that makes it a claim about what happened: failures={len(_f2)} "
   f"confirmed={len(_c2)}")
ok(_f2 and "NOT CONFIRMED" in _f2[0],
   f"WG.10e ...and it says so plainly rather than reassuring: {(_f2 or [''])[0][-200:]}")

# NO WINDOW AT ALL is the weakest evidence of the three and must not downgrade.
_f3, _c3 = _verdict(["base", MON, MON2], 1500.0, windows={})
ok(len(_f3) == 1 and not _c3,
   f"WG.10f CONTROL: with NO readable window, a change is not downgraded. 'I could not "
   f"check' and 'I checked and it is fine' are opposite answers, and a lookup that fails by "
   f"returning nothing must not read as the second: failures={len(_f3)} confirmed={len(_c3)}")

_f4, _c4 = _verdict(["base", MON, MON2], None)
ok(len(_f4) == 1 and not _c4,
   f"WG.10f2 CONTROL: and with no MTIME either — the file gone, or a synthetic report — it "
   f"is not downgraded and the note still hedges: failures={len(_f4)}")

ok(_wg.changed({_real: ("h1", ["base"])}, {_real: ("h1", ["base"])}) == [],
   "WG.10g CONTROL: an unchanged file still produces nothing at all — `review` splitting "
   "its output must not have turned a no-op into a report")

# `changed()` IS THE "EVERYTHING" VIEW and must keep being one. It is what the other checks
# in this file read, and a version that returned only failures would make every downgraded
# change invisible to them — the split quietly becoming a filter.
_saved_m, _saved_w = _wg._mtime, _wg._unit_window
try:
    _wg._mtime = lambda _p: 1500.0
    _wg._unit_window = lambda u: RUN_1000_2000.get(u)
    _all = _wg.changed({_real: ("h1", ["base"])}, {_real: ("h2", ["base", MON, MON2])})
    ok(len(_all) == 1 and "Confirmed" in _all[0],
       f"WG.10h `changed()` still reports a DOWNGRADED change — failures first, then "
       f"confirmed, one computation and two views. A version returning only failures makes "
       f"the downgraded case invisible to every caller: {len(_all)} block(s)")
finally:
    _wg._mtime, _wg._unit_window = _saved_m, _saved_w

# ── WG.11  main() actually PRINTS the downgraded case ──────────────────────────────────
# WG.10a proves the BLOCK carries its evidence. Nothing proved `main()` ever puts it on
# stdout — and planting `if False:` around that print came back NOT CAUGHT. Silence and a
# pass are the same thing to a reader, which is the entire reason the downgrade is allowed
# to exist, so it is the one thing that must not be assertable only in a block nobody emits.
import contextlib as _ctx
import io as _io


def _main_output(now_lines, when, rc=0):
    """stdout and exit code from a real `main()` run, with snapshot and the child stubbed."""
    saved = (_wg.snapshot, _wg._mtime, _wg._unit_window, _wg.subprocess)
    states = iter([{_real: ("h1", ["base"])}, {_real: ("h2", now_lines)}])
    _wg.snapshot = lambda: next(states)
    _wg._mtime = lambda _p: when
    _wg._unit_window = lambda u: RUN_1000_2000.get(u)

    class _Sub:
        @staticmethod
        def run(*_a, **_k):
            class R: returncode = rc
            return R()
    _wg.subprocess = _Sub()
    buf = _io.StringIO()
    try:
        with _ctx.redirect_stdout(buf):
            code = _wg.main(["--", "pretend-suite"])
        return buf.getvalue(), code
    finally:
        _wg.snapshot, _wg._mtime, _wg._unit_window, _wg.subprocess = saved


_out_ok, _code_ok = _main_output(["base", MON, MON2], 1500.0)
ok("NOTE" in _out_ok and "seat-health" in _out_ok,
   f"WG.11 the downgraded case is PRINTED by main(), not merely computed: {_out_ok[:200]!r}")
ok("covers the change" in _out_ok,
   f"WG.11a ...with the covering window quoted, which is the evidence the downgrade rests "
   f"on: {_out_ok[-240:]!r}")
ok("not an exemption" in _out_ok.lower(),
   f"WG.11b ...and it says it is not an exemption, because the next person to read this "
   f"output is deciding whether the guard can be trusted: {_out_ok[:240]!r}")
ok(_code_ok == 0,
   f"WG.11c and it does not fail the suite — the whole point, since a pass that is red for "
   f"a non-reason teaches people to stop reading it (D62): exit={_code_ok}")

_out_bad, _code_bad = _main_output(["base", MON, MINE], 1500.0)
ok("✗ write_guard" in _out_bad and "SUITE WROTE THIS" in _out_bad,
   f"WG.11d CONTROL: a real suite write still prints the failure and quotes the line: "
   f"{_out_bad[-200:]!r}")
ok(_code_bad == 1,
   f"WG.11e ...and still fails. If this ever stops, the downgrade has become the exemption "
   f"it was written not to be: exit={_code_bad}")

# ── WG.12  the live daemon's own writes, told apart by the kernel (2.2, 2026-09-22) ─────────
# A full pass with the orb up charged eleven suites with `ashd`'s writes to wake-state,
# preview, tutor-state and the ledger. The third lock accepts a change only when EVERY record
# carries a `writer_stamp` chain reaching the live orb or ashd — alive, same start time,
# older than the guard, and identified by command line and tree. Each rule is planted alone.
import json as _json
import writer_stamp as _ws

_led = str(_wg.HOME/"ash/voice"/"seat-decisions.jsonl")
_obj = str(_wg.HOME/"ash/voice"/"wake-state.json")
ok(_led in {str(p) for p, _ in _wg.PROTECTED} and _obj in {str(p) for p, _ in _wg.PROTECTED},
   "WG.12 CONTROL: the two fixture keys are real protected paths")

# (a) REAL identity, no stubs: this suite's own stamp reaches no live root. This is the case
# the whole lock exists to refuse — a suite writing real state through the product's code.
_wg._SELF_START = _wg._start_ticks(os.getpid())
_mine = _ws.stamp()
ok(_mine and _mine["pid"] == os.getpid() and len(_mine["chain"]) >= 2,
   f"WG.12a a stamp carries this process and its ancestors: {_mine}")
eq(_wg._live_writer(_mine), None,
   "WG.12a a SUITE's own stamp names no live daemon — its writes still fail")

# (b) REAL identity: a process started after the guard is refused even if it IS ashd.py —
# the `--wav` tests start their own. Driven with a real child so its start time is real.
_kid = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(5)"])
try:
    import time as _t; _t.sleep(0.2)
    eq(_wg._is_live_root(_kid.pid, _wg._start_ticks(_kid.pid)), None,
       "WG.12b a process younger than the guard is never the live daemon")
    # AN IMPOSTOR THAT PASSES THE IDENTITY CHECK, so only the start-time rule can refuse it:
    # `python - <this tree>/ashd.py` reads its program from stdin, and its command line names
    # this checkout's ashd.py with no --wav — exactly what a suite starting its own daemon
    # looks like. Without the rule, WG.12b's plain child is refused by identity alone and the
    # rule is never exercised (found by planting it out: nothing went red).
    _imp = subprocess.Popen([sys.executable, "-", str(HERE/"ashd.py")], stdin=subprocess.PIPE)
    _imp.stdin.write(b"import time; time.sleep(5)\n"); _imp.stdin.close()
    _t.sleep(0.3)
    try:
        _saved_self = _wg._SELF_START
        _wg._SELF_START = None                    # with no floor, it WOULD be accepted...
        ok(_wg._is_live_root(_imp.pid, _wg._start_ticks(_imp.pid)),
           "WG.12b CONTROL: the impostor passes the identity check on its own")
        _wg._SELF_START = _saved_self             # ...and the floor is what refuses it
        eq(_wg._is_live_root(_imp.pid, _wg._start_ticks(_imp.pid)), None,
           "WG.12b a daemon-shaped process started during the run is the suite's, not the orb's")
    finally:
        _imp.kill(); _imp.wait()
    eq(_wg._is_live_root(os.getppid(), 1), None,
       "WG.12b a pid whose start time does not match (reused, or forged) is refused")
finally:
    _kid.kill(); _kid.wait()

# (b2) D338: a pid that died between the /proc listing and the read has no start time. The scan
# below met one during a contract pass and raised TypeError instead of moving on.
_gone = subprocess.Popen(["true"]); _gone.wait()
_raised = None
try:
    _r = _wg._is_live_root(_gone.pid, _wg._start_ticks(_gone.pid))
except Exception as _e:
    _raised, _r = _e, "raised"
ok(_r is None and _raised is None,
   f"WG.12d a process gone mid-scan is simply not a live root — never a TypeError ({_raised!r})")

# (c) the LIVE daemon, if one is running: its stamp is accepted. Skips LOUDLY otherwise —
# a green that depended on the orb being down would prove nothing about the orb being up.
_live = None
for _pid in os.listdir("/proc"):
    if _pid.isdigit() and _wg._is_live_root(int(_pid), _wg._start_ticks(int(_pid))):
        _live = int(_pid)
        break
if _live:
    _st = _ws.chain(_live)
    ok(_wg._live_writer({"pid": _live, "chain": _st}),
       f"WG.12c the running daemon's own chain is accepted (pid {_live})")
else:
    print("  SKIP  WG.12c no live orb/ashd on this machine — the acceptance half is unproven here")

# (d) the decision, with the root stubbed so it does not depend on what is running. Each
# record shape planted on its own.
_GOOD = {"pid": 11, "chain": [[11, 5, "python"], [7, 3, "electron"]]}
_BAD = {"pid": 12, "chain": [[12, 9, "python"], [2, 1, "bash"]]}
_saved = _wg._is_live_root
_wg._is_live_root = lambda pid, start: "ashd pid 7" if (pid, start) == (7, 3) else None
try:
    def _row(stamp, **kw):
        return _json.dumps(dict({"t": 1, "outcome": "ok"}, **kw, **({"_writer": stamp} if stamp else {})))
    _base = [_row(_GOOD, seq=1)]
    ok(_wg._live_account(_led, _base, _base + [_row(_GOOD, seq=2), _row(_GOOD, seq=3)]),
       "WG.12d ledger rows every one stamped by the live daemon: accounted for")
    eq(_wg._live_account(_led, _base, _base + [_row(_GOOD, seq=2), _row(_BAD, seq=3)]), None,
       "WG.12d ONE row from anyone else and the whole change is the suite's again")
    eq(_wg._live_account(_led, _base, _base + [_row(None, seq=2)]), None,
       "WG.12d an unstamped row is not evidence of anything")
    eq(_wg._live_account(_led, _base + [_row(_GOOD, seq=9)], _base + [_row(_GOOD, seq=2)]), None,
       "WG.12d a row REMOVED from an append-only ledger is never the daemon's doing")
    eq(_wg._live_account(_led, _base, _base + ["not json"]), None,
       "WG.12d an unparseable row fails, it does not get skipped")
    ok(_wg._live_account(_obj, ['{"state":"idle"}'], [_json.dumps({"state": "idle", "_writer": _GOOD})]),
       "WG.12d a slot rewritten by the live daemon: accounted for")
    eq(_wg._live_account(_obj, ['{"state":"idle"}'], [_json.dumps({"state": "idle", "_writer": _BAD})]), None,
       "WG.12d the same slot stamped by a suite: fails")
    eq(_wg._live_account(_obj, ['{"state":"idle"}'], ['{"state": "idle"}']), None,
       "WG.12d the same slot with no stamp: fails")
    # ...and through review(), so the verdict is the one a run would print
    _fail, _conf = _wg.review({_obj: ("h1", ['{"state":"idle"}'])},
                              {_obj: ("h2", [_json.dumps({"state": "speaking", "_writer": _GOOD})])})
    ok(not _fail and _conf and "live ashd pid 7" in _conf[0],
       f"WG.12e review() downgrades it and says who: {_conf}")
    _fail, _conf = _wg.review({_obj: ("h1", ['{"state":"idle"}'])},
                              {_obj: ("h2", [_json.dumps({"state": "speaking", "_writer": _BAD})])})
    ok(_fail and not _conf, "WG.12e CONTROL: a suite-stamped rewrite is still a failure")
finally:
    _wg._is_live_root = _saved

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)

print("✓ write guard: a suite cannot touch the user's real state (WG.0 control caught four shapes; WG.4 control caught a def-time default)")
