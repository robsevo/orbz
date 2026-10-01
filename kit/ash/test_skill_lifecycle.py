#!/usr/bin/env python3
"""active → stale → archived, never deletion. Run: orb/daemon/.venv/bin/python orb/daemon/test_skill_lifecycle.py

PLAN 23.3, 23.4.

SL.0 IS THE CONTROL, and the row states it exactly: a **pinned** skill and a **user-authored**
skill must each survive a pass that archives an eligible neighbour, and removing the pin check
must turn both red. A pass that spares everything is indistinguishable from a pass that never
ran, so the neighbour has to actually go.
"""

# ASH_TIER: product
import json, sys, tempfile, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import skill_lifecycle as L, skill_usage as U                   # noqa: E402

FAIL = []
NOW = 1_800_000_000.0


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def library(**entries):
    d = Path(tempfile.mkdtemp(prefix="sl-"))
    side = d/"usage.json"
    side.write_text(json.dumps(entries, indent=2))
    return side


def act(plan_rows):
    return {n: a for n, a, _ in plan_rows}


OBSERVED = {"_first_seen": NOW - 30 * 86400}

# ── SL.0  THE CONTROL: a pin and a user-authored skill survive a real pass ───────────
side = library(
    doomed={"use": 1, "last_use": NOW - 90 * 86400, "owner": "agent"},
    pinned={"use": 1, "last_use": NOW - 90 * 86400, "pin": True, "owner": "agent"},
    theirs={"use": 1, "last_use": NOW - 90 * 86400, "owner": "user"},
)
got = act(L.plan(["doomed", "pinned", "theirs"], usage_path=side, state=OBSERVED, now=NOW))
ok(got["doomed"] == "stale",
   f"SL.0 CONTROL: the eligible neighbour DOES go stale — a pass that spares everything is "
   f"indistinguishable from one that never ran. Got {got}")
ok(got["pinned"] == "keep",
   f"SL.0 a pinned skill survives the same pass. The gym is a no-user-present writer, and "
   f"that is exactly who a pin is for. Got {got}")

# ── SL.1  provenance is DECLARED, never inferred ─────────────────────────────────────
# A skill with a hundred patches proves the agent MAINTAINS it, not that the agent WROTE it,
# and the wrong guess archives something a person hand-wrote.
ok(L.owner_of({"owner": "agent"}) == L.AGENT, "SL.1 a declared agent owner is honoured")
ok(L.owner_of({"owner": "user"}) == L.USER, "SL.1 and a declared user owner")
ok(L.owner_of({}) == L.USER,
   "SL.1 an UNDECLARED owner is the user's — the wrong guess in that direction leaves an "
   "agent-made skill alone; in the other it archives something a person hand-wrote")
ok(L.owner_of({"patch": 100, "use": 500}) == L.USER,
   "SL.1 CONTROL: a heavily PATCHED skill is still the user's without a declaration. Patch "
   "count proves maintenance, not authorship — that is the inference this forbids.")

# ── SL.2  zero uses is absence of evidence ───────────────────────────────────────────
side = library(
    fresh={"added": NOW - 1 * 86400},
    aged={"added": NOW - 30 * 86400},
)
got = act(L.plan(["fresh", "aged"], usage_path=side, state=OBSERVED, now=NOW))
ok(got["fresh"] == "keep",
   f"SL.2 a never-used skill inside its grace floor is left alone: {got}")
ok(got["aged"] == "stale",
   f"SL.2 CONTROL: one PAST the floor does go stale — otherwise the grace floor is infinite "
   f"and nothing is ever reviewed: {got}")

# ── SL.3  a first run defers a full interval ─────────────────────────────────────────
side = library(anything={"use": 1, "last_use": NOW - 900 * 86400})
first = L.plan(["anything"], usage_path=side, state={}, now=NOW)
ok(act(first)["anything"] == "defer",
   f"SL.3 a library this code has never observed is acted on not at all: {first}")
ok("observed" in first[0][2], f"SL.3 and says why: {first[0][2][:60]!r}")

part = L.plan(["anything"], usage_path=side,
              state={"_first_seen": NOW - 2 * 86400}, now=NOW)
ok(act(part)["anything"] == "defer",
   "SL.3 and keeps deferring until a FULL interval has been watched")
ok("left" in part[0][2], f"SL.3 saying how much is left: {part[0][2][:60]!r}")

done = L.plan(["anything"], usage_path=side, state=OBSERVED, now=NOW)
ok(act(done)["anything"] == "stale",
   "SL.3 CONTROL: once observed, it does act — otherwise 'defer' is permanent and the whole "
   "lifecycle never starts")

# ── SL.4  nothing is deleted, and an archived skill is left alone ────────────────────
side = library(gone={"use": 1, "last_use": NOW - 900 * 86400, "state": "archived"})
rows = L.plan(["gone"], usage_path=side, state=OBSERVED, now=NOW)
ok(act(rows)["gone"] == "keep", f"SL.4 an archived skill is not acted on again: {rows}")
ok("never deleted" in rows[0][2] or "ever deleted" in rows[0][2],
   f"SL.4 and says so: {rows[0][2]!r}")
ok("delete" not in [a for _, a, _ in L.plan(["gone"], usage_path=side, state=OBSERVED, now=NOW)],
   "SL.4 `delete` is not an action this module can produce at all")

# ── SL.5  the gym evolves only what it owns (23.4) ───────────────────────────────────
# A user-authored skill that is wrong is REPORTED with a recommendation, never patched —
# hard rule 3 in a new place. Silence is worse than the edit, because the lesson is then lost
# as well as unapplied, so the reason is always returned.
side = library(
    mine={"owner": "agent", "use": 5},
    theirs={"owner": "user", "use": 5},
    undeclared={"use": 5},
    pinned={"owner": "agent", "use": 5, "pin": True},
    archived={"owner": "agent", "use": 5, "state": "archived"},
)
allowed, why = L.may_evolve("mine", usage_path=side)
ok(allowed, f"SL.5 the gym may patch an agent-owned skill: {why}")

for name, needle in (("theirs", "do not patch what a person wrote"),
                     ("undeclared", "not agent-owned"),
                     ("pinned", "pin blocks the autonomous actor"),
                     ("archived", "restore it")):
    allowed, why = L.may_evolve(name, usage_path=side)
    ok(not allowed, f"SL.5 the gym may NOT patch {name!r}")
    ok(needle in why,
       f"SL.5 and the refusal carries a recommendation rather than silence — silence loses "
       f"the lesson as well as the edit. Got {why!r}")

# ── SL.6  the same question, asked by a caller that is not Python (23.4 wiring) ─────────
# skill-evolve.mjs is the brain's JavaScript; it asks `skill_lifecycle.py may-evolve NAME` rather
# than keeping a second copy of the rule. The command must give the same answers, and say why.
import subprocess as _sp6, sys as _sys6
def _cli(name):
    r = _sp6.run([_sys6.executable, str(Path(L.__file__)), "may-evolve", name, "--usage", str(side)],
                 capture_output=True, text=True, timeout=30)
    try:
        return r.returncode, json.loads(r.stdout)
    except ValueError:
        return r.returncode, {"raw": r.stdout + r.stderr}
_rc, _o = _cli("mine")
ok(_rc == 0 and _o.get("allowed") is True, f"SL.6 the command lets the gym patch an agent-owned skill: {_rc} {_o}")
for name in ("theirs", "undeclared", "pinned", "archived"):
    _rc, _o = _cli(name)
    ok(_rc == 3 and _o.get("allowed") is False and _o.get("reason") == L.may_evolve(name, usage_path=side)[1],
       f"SL.6 ...and refuses {name!r} with exit 3 and the module's own reason: {_rc} {_o}")

# ── SL.7  ownership is DECLARED, by a person, through one door ───────────────────────────
# Measured 2026-09-23: no skill-usage.json exists, so every real skill is undeclared and
# may_evolve refuses them all — wiring skill-evolve to ask would stop the gym's LEARN path. This
# is how a person says which skills are the gym's. It must flip the answer, count no use, and
# refuse an owner that is neither.
_d7 = Path(tempfile.mkdtemp(prefix="sl7-"))/"skill-usage.json"
def _cli7(*args):
    r = _sp6.run([_sys6.executable, str(Path(L.__file__)), *args, "--usage", str(_d7)],
                 capture_output=True, text=True, timeout=30)
    try:
        return r.returncode, json.loads(r.stdout)
    except ValueError:
        return r.returncode, {"raw": (r.stdout + r.stderr)[-200:]}
ok(L.may_evolve("newskill", usage_path=_d7)[0] is False, "SL.7 an undeclared skill is refused (the user's)")
_rc, _o = _cli7("declare", "newskill", "--owner", "agent")
ok(_rc == 0 and _o.get("declared") is True, f"SL.7 a person declares it the gym's: {_rc} {_o}")
ok(L.may_evolve("newskill", usage_path=_d7)[0] is True, "SL.7 ...and now the gym may patch it")
ok(U.usage("newskill", path=_d7).get("use", 0) == 0, "SL.7 ...and declaring counted no use")
_rc, _o = _cli7("declare", "newskill", "--owner", "user")
ok(_rc == 0 and L.may_evolve("newskill", usage_path=_d7)[0] is False,
   "SL.7 declared back to the user, it is refused again")
ok(U.declare("x", "someone", path=_d7) is None and "x" not in U.usage(path=_d7),
   "SL.7 CONTROL: an owner that is neither agent nor user is refused and writes nothing")
_rc, _o = _cli7("declare", "y", "--owner", "admin")
ok(_rc != 0, f"SL.7 ...and the command refuses it too ({_rc})")

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print("✓ skill lifecycle: pins and user-authored skills survive a real pass (SL.0 control)")
