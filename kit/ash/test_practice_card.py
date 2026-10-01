#!/usr/bin/env python3
"""The nightly report card, asserted. Run: orb/daemon/.venv/bin/python orb/daemon/test_practice_card.py

The card is the only thing the orb does with the night's practice, and the ways it can go
wrong are all silent: it says nothing when it should speak, or it repeats last week's
homework every time the orb opens. Both are covered here, plus the spoken-turn rule that a
directory slug is not a word ("union-find" is read as two words, not one hyphenated one).
"""
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
import time

import practice_card as pc

FAIL = []


def has(got, want, label):
    if want not in got:
        FAIL.append(f"{label}\n     got: {got!r}\n   wants: {want!r} in it")


def hasnt(got, unwanted, label):
    if unwanted in got:
        FAIL.append(f"{label}\n     got: {got!r}\n  unwanted: {unwanted!r}")


def eq(got, want, label):
    if got != want:
        FAIL.append(f"{label}\n     got: {got!r}\n    want: {want!r}")


def write_card(d, card, age_s=0):
    p = os.path.join(d, "practice-report.json")
    with open(p, "w") as f:
        json.dump(card, f)
    if age_s:
        old = time.time() - age_s
        os.utime(p, (old, old))
    return p


PASSED = {"day": "2026-09-16", "topic": "union-find", "passed": True, "tests_total": 14,
          "measurement": "push: 136.3ns -> 145.6ns (O(1) across 1k-1M ops)",
          "skill": {"slug": "compilers", "mode": "create", "covers": "parsing and bytecode"},
          "spoken": False}

with tempfile.TemporaryDirectory(prefix="practice-") as d:
    # 1. A graded pass is reported, with the number in it and no slug read as a slug.
    p = write_card(d, PASSED)
    out = pc.line(p)
    has(out, "union find", "pass: slug is spoken as words")
    hasnt(out, "union-find", "pass: no hyphen survives into speech")
    has(out, "14 tests green", "pass: speaks the test count")
    hasnt(out, "136.3ns", "pass: raw benchmark output is never spoken")
    hasnt(out, "->", "pass: no arrows reach the voice")
    has(out, "compilers", "pass: names the acquired skill")

    # 2. Said once. The whole point of mark_spoken.
    pc.mark_spoken(p)
    eq(pc.line(p), "", "spoken card is silent the second time")

    # 3. A failed night is reported honestly, not hidden and not called green.
    p = write_card(d, dict(PASSED, passed=False, measurement="", tests_total=None, spoken=False))
    out = pc.line(p)
    has(out, "could not get the tests green", "fail: says so plainly")
    has(out, "tonight", "fail: says it retries")
    hasnt(out, "came back green", "fail: never reads as a pass")

    # 4. Stale card: the orb was not opened for days — that is history, not news.
    p = write_card(d, dict(PASSED, spoken=False), age_s=72 * 3600)
    eq(pc.line(p), "", "a card older than two days says nothing")

    # 5. Deepening an existing skill reads differently from acquiring one.
    p = write_card(d, dict(PASSED, spoken=False,
                           skill={"slug": "graph-engineering", "mode": "deepen",
                                  "covers": "max flow"}))
    has(pc.line(p), "went deeper on graph engineering", "deepen: correct verb and words")

    # 6. Skill-only night (cs-practice skipped, e.g. curriculum exhausted and nothing failed).
    p = write_card(d, {"day": "2026-09-16", "spoken": False,
                       "skill": {"slug": "caching", "mode": "create", "covers": "x"}})
    out = pc.line(p)
    has(out, "caching", "skill-only: still reports the skill")
    hasnt(out, "practised", "skill-only: does not invent a practice topic")

    # 7. Nothing at all: no file, empty file, garbage file — all silent, none raise.
    eq(pc.line(os.path.join(d, "nope.json")), "", "missing card is silent")
    junk = os.path.join(d, "junk.json")
    open(junk, "w").write("{not json")
    eq(pc.line(junk), "", "unparseable card is silent")

    # 8. No spoken-turn violations anywhere in the output: no paths, no markdown, no braces.
    p = write_card(d, dict(PASSED, spoken=False))
    out = pc.line(p)
    for bad in ("/", "*", "`", "#", "{", "_", "loops", "->", "(", ")", "ns"):
        hasnt(out, bad, f"spoken output contains no {bad!r}")


    # 9. The read-modify-write window (PLAN 14.3). line() reads the card, ashd speaks it,
    # and mark_spoken() writes it back. A nightly loop can write a NEW card in between —
    # and without a guard that card is marked spoken having never been said, so the next
    # boot is silent about work that was actually done.
    p = write_card(d, dict(PASSED, spoken=False))
    day = json.load(open(p))["day"]
    write_card(d, {"day": "2026-09-30", "topic": "a later night", "spoken": False})
    eq(pc.mark_spoken(p), True,
       "P.9 CONTROL: with no guard, a card swapped underneath is still marked")
    eq(json.load(open(p))["spoken"], True,
       "P.9 CONTROL: and that later card is now spoken having never been said")

    p = write_card(d, dict(PASSED, spoken=False))
    write_card(d, {"day": "2026-09-30", "topic": "a later night", "spoken": False})
    eq(pc.mark_spoken(p, expect_day=day), False,
       "P.10 with the guard, a card that changed underneath is left alone")
    eq(json.load(open(p))["spoken"], False,
       "P.10 so it is still unspoken and gets said next time — the safe direction")

    p = write_card(d, dict(PASSED, spoken=False))
    eq(pc.mark_spoken(p, expect_day=json.load(open(p))["day"]), True,
       "P.10 and a matching card is still marked normally")

    # 10. A shared ".tmp" is its own race: two writers, one renames what the other was
    # about to (2026-09-15). Nothing may be left behind either.
    import glob as _g
    eq(_g.glob(os.path.join(d, "*.tmp")), [], "P.11 no temp file is left behind")
    _src = open(os.path.join(os.path.dirname(os.path.abspath(pc.__file__)),
                             "practice_card.py")).read()
    eq("getpid()" in _src and "get_ident()" in _src, True,
       "P.11 the tmp name is per process and thread, not a shared '.tmp'")

# --- PC.6  called the way ASHD calls it, which no check here ever did -----------------
# Every check above passes an explicit path — `pc.mark_spoken(p)`. Production does not:
# `ashd.py` calls `practice_card.mark_spoken(expect_day=card.get("day"))` with no path at
# all. `read()` applied the CARD default and `mark_spoken` did not, so `os.replace(tmp,
# None)` raised TypeError on every boot, the caller logged "practice report skipped", and
# the card was never marked — the "said once" guarantee this suite exists to protect has
# never held in production. Found by starting the orb, not by reading anything.
#
# So this one drives the DEFAULT path, by pointing the module's own CARD at a fixture. A
# suite that only exercises the argument production never passes is testing a branch
# nobody runs (CLAUDE.md §12).
_d = Path(tempfile.mkdtemp(prefix="pc-default-"))
_real_card = pc.CARD
try:
    pc.CARD = _d/"practice.json"
    _day = "2026-09-21"
    pc.CARD.write_text(json.dumps({"day": _day, "solved": 3, "spoken": False}))

    eq(pc.mark_spoken(expect_day=_day), True,
       "PC.6 mark_spoken() with NO path — exactly ashd's call — marks the card")
    eq(json.loads(pc.CARD.read_text()).get("spoken"), True,
       "PC.6 ...and the card on disk really says spoken, so the guarantee holds")
    eq(list(Path.cwd().glob("None.*.tmp")) + list(_d.glob("None.*.tmp")), [],
       "PC.6 ...and no `None.<pid>.<tid>.tmp` is left behind — the old failure leaked one "
       "into the daemon directory on every boot, because its cleanup caught only OSError "
       "and the error was a TypeError")

    # CONTROL: the guard still works on the default path, not just the explicit one.
    pc.CARD.write_text(json.dumps({"day": "2026-09-22", "solved": 1, "spoken": False}))
    eq(pc.mark_spoken(expect_day=_day), False,
       "PC.6c CONTROL: a card that changed underneath is still left alone on the default "
       "path, so PC.6 is the default resolving and not the guard being skipped")
finally:
    pc.CARD = _real_card
    shutil.rmtree(_d, ignore_errors=True)

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print("✓ practice card: 9 groups green (PC.6 calls it the way ashd does)")
