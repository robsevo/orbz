#!/usr/bin/env python3
"""Which skills are actually used. Run: orb/daemon/.venv/bin/python orb/daemon/test_skill_usage.py

PLAN 23.2. Nothing recorded this before — measured across the whole brain on 2026-09-20: no
`usage.json`, no counter, no last-used stamp. So there was no evidence for retiring any skill
while the gym added more each night.

SU.0 IS THE CONTROL, and the row names the mistake it guards against: with the bump removed,
a skill that was used must read as UNUSED. Otherwise the counter is being satisfied by
something other than the code under test — which is K.2's error exactly (it found the string
`getpid`, passed, and the file still tore).
"""

# ASH_TIER: product
import json, os, sys, tempfile, threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import skill_usage as U                                         # noqa: E402

FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


d = Path(tempfile.mkdtemp(prefix="su-"))
side = d/"skill-usage.json"

# ── SU.0  THE CONTROL: a used skill reads as used, an unused one as unused ───────────
ok(U.usage("weather", path=side) == {}, "SU.0 nothing is recorded before anything happens")
ok(U.unused(["weather", "finance"], path=side) == ["weather", "finance"],
   "SU.0 CONTROL: with no bumps, BOTH read as unused — if either read as used, something "
   "other than the code under test is writing this file")
U.bump("weather", path=side)
ok(U.usage("weather", path=side).get("use") == 1,
   f"SU.0 a bump is recorded: {U.usage('weather', path=side)}")
ok(U.unused(["weather", "finance"], path=side) == ["finance"],
   "SU.0 and the used one drops out of `unused` while the other stays")

# ── SU.1  a counter moves on a real load, NOT on a listing ───────────────────────────
U.bump("weather", "view", path=side)
e = U.usage("weather", path=side)
ok(e["use"] == 1 and e["view"] == 1,
   f"SU.1 a view is counted separately from a use — listing a skill is not loading it: {e}")
ok(e.get("last_use") and e.get("last_view"), f"SU.1 each carries its own stamp: {e}")
U.bump("weather", "patch", path=side)
ok(U.usage("weather", path=side)["patch"] == 1, "SU.1 and a patch is a third thing")
ok(U.usage("weather", path=side)["use"] == 1,
   "SU.1 CONTROL: a view and a patch do NOT inflate the use count — otherwise 'unused' means "
   "nothing and 23.3 has no evidence to retire on")

# ── SU.2  telemetry never breaks a turn ──────────────────────────────────────────────
# The same asymmetry as the learning ledger's telemetry half: the product does not stop
# because its odometer is stuck.
ro = d/"readonly"
ro.mkdir()
os.chmod(ro, 0o500)
try:
    got = U.bump("weather", path=ro/"usage.json")
    ok(got is None, f"SU.2 an unwritable sidecar reports failure rather than raising: {got!r}")
finally:
    os.chmod(ro, 0o700)

side.write_text("{not json at all")
ok(U.usage("weather", path=side) == {},
   "SU.2 a corrupt sidecar reads as empty, never as an exception into the turn")
ok(U.bump("weather", path=side) is not None,
   "SU.2 and a bump over a corrupt file still works — it is rewritten, not refused")
ok(U.usage("weather", path=side).get("use") == 1,
   "SU.2 starting the count again rather than losing the turn")

# ── SU.3  concurrent bumps lose nothing ──────────────────────────────────────────────
side2 = d/"concurrent.json"
errs = []


def hammer(n):
    try:
        for _ in range(25):
            U.bump("shared", path=side2)
    except Exception as e:
        errs.append(repr(e))


ts = [threading.Thread(target=hammer, args=(i,)) for i in range(8)]
for t in ts:
    t.start()
for t in ts:
    t.join()
ok(not errs, f"SU.3 eight concurrent writers raise nothing: {errs[:2]}")
ok(U.usage("shared", path=side2).get("use") == 200,
   f"SU.3 and not one bump is lost: {U.usage('shared', path=side2).get('use')} of 200")
ok(sorted(x.name for x in side2.parent.glob("*.tmp")) == [],
   "SU.3 no temp file is left behind")

# ── SU.4  telemetry stays OUT of the user's own SKILL.md ─────────────────────────────
# CODE ONLY. The module's own docstring explains why telemetry does not belong in SKILL.md,
# so a raw-text grep reports the correct file as broken — the trap CLAUDE.md records, caught
# here by the check I wrote three minutes earlier.
import ran_everything as _re_mod
ok("SKILL.md" not in _re_mod.code_only((HERE/"skill_usage.py").read_text()),
   "SU.4 the module never touches SKILL.md — a count written into a user-authored file is a "
   "diff in their file and a merge conflict waiting to happen")
ok(U.SIDECAR.name.endswith(".json") and "skill" in U.SIDECAR.name,
   f"SU.4 it is a sidecar keyed by name: {U.SIDECAR.name}")

# ── SU.5  a pinned skill is not 'unused' ─────────────────────────────────────────────
side3 = d/"pinned.json"
U.bump("rarely", path=side3, pin=True)
U.bump("never-mind", path=side3)
# reset `rarely` to zero uses but keep the pin, the way a pinned-and-idle skill looks
raw = json.loads(side3.read_text())
raw["rarely"]["use"] = 0
side3.write_text(json.dumps(raw))
ok(U.unused(["rarely", "never-mind"], path=side3) == [],
   f"SU.5 a PINNED skill with no uses is not listed for retirement — pinning is a decision, "
   f"not a gap in the data: {U.unused(['rarely', 'never-mind'], path=side3)}")
raw["rarely"]["pin"] = False
side3.write_text(json.dumps(raw))
ok(U.unused(["rarely"], path=side3) == ["rarely"],
   "SU.5 CONTROL: unpinned and unused, it IS listed — otherwise the pin check hides "
   "everything and 23.3 has nothing to act on")

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print("✓ skill usage: counts move, telemetry never breaks a turn (SU.0 control first)")
