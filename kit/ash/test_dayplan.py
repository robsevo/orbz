#!/usr/bin/env python3
"""A plan that does not pretend the day fits, and a review that offers to drop things.

Run: orb/daemon/.venv/bin/python test_dayplan.py

PLAN C4.1 / C4.2. A plan is arithmetic before it is judgement, and the arithmetic is the
part people get wrong: a day with five hours of meetings and six hours of intentions is not
a plan, it is a disappointment with a schedule.

DP.0 IS THE CONTROL, and it is C4.2's own words — **nothing is silently rescheduled.** This
module contains no write at all, asserted from its imports, so the guarantee is structural
rather than a promise. A planner that can move things is one you have to trust; one that
cannot is one you can check.

The calendar and to-do store are stubbed: what is under test is the arithmetic and the
wording, not EDS.
"""
import ast
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import dayplan
import eds

import eds_sandbox

# Anything this run creates that was not there when it started is removed at exit — even
# when a PLANTED defect reaches the writer this suite never calls, and even when the suite
# dies on an assertion (D156).
eds_sandbox.guard(__name__)

FAIL = []
# A Wednesday at 08:00 local, so the whole working day is ahead.
DAY = time.mktime((2026, 9, 16, 8, 0, 0, 0, 0, -1))


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def eq(got, want, label):
    if got != want:
        FAIL.append(f"{label}\n     got: {got!r}\n    want: {want!r}")


def at(h, m=0):
    return int(time.mktime((2026, 9, 16, h, m, 0, 0, 0, -1)))


EVENTS, TODOS = [], []
eds.events = lambda days=7, **kw: list(EVENTS)
eds.todos = lambda: list(TODOS)


def ev(summary, h, mins=60):
    return {"summary": summary, "start": at(h), "end": at(h) + mins * 60,
            "all_day": False, "uid": summary, "calendar": "Personal"}


def td(summary, due=None):
    return {"summary": summary, "due": due, "done": False, "uid": summary, "list": "Personal"}


# ── DP.0  CONTROL: it cannot write ─────────────────────────────────────────────────────
_src = (HERE/"dayplan.py").read_text()
_tree = ast.parse(_src)
_writes = [ast.unparse(n) for n in ast.walk(_tree)
           if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
           and n.func.attr in ("add_event", "add_todo", "remove", "create_object_sync")]
eq(_writes, [],
   f"DP.0 CONTROL: the planner CANNOT write — C4.2 says nothing is silently rescheduled, and "
   f"a module with no write in it makes that structural rather than a promise: {_writes}")
_reads = [n for n in ast.walk(_tree) if isinstance(n, ast.Call)
          and isinstance(n.func, ast.Attribute) and n.func.attr in ("events", "todos")]
ok(_reads,
   "DP.0 CONTROL: while it really does read — otherwise 'it writes nothing' is true of a "
   "module that does nothing at all")

# ── DP.1  the gaps are the real ones ───────────────────────────────────────────────────
EVENTS[:] = [ev("standup", 9, 30), ev("review", 14, 60)]
g = dayplan.gaps(DAY)
# 9:30->14:00 and 15:00->18:00. There is no gap BEFORE standup: it starts exactly at the
# day's 9 a.m. boundary, and inventing a zero-length stretch there would be the sort of
# empty slot a plan then tries to fill.
eq([(time.strftime("%H:%M", time.localtime(s)), time.strftime("%H:%M", time.localtime(e)))
    for s, e, _ in g],
   [("09:30", "14:00"), ("15:00", "18:00")],
   "DP.1 the day is cut around what is booked")
ok(all(m >= dayplan.MIN_GAP_MIN for _, _, m in g),
   f"DP.1 and nothing shorter than {dayplan.MIN_GAP_MIN} minutes is offered — proposing a "
   f"real task for the eleven minutes between two calls is how a plan loses its credit: {g}")

EVENTS[:] = [ev("a", 9, 60), ev("b", 10, 15), ev("c", 10, 120)]
g = dayplan.gaps(DAY)
ok(all(m >= dayplan.MIN_GAP_MIN for _, _, m in g), "DP.1 overlapping events do not invent gaps")
ok(all(s < e for s, e, _ in g), "DP.1 and every gap runs forwards")

# A DAY WITH A GENUINELY SMALL GAP. The two fixtures above produce only long stretches, so
# deleting the minimum-gap filter left the suite green — a filter with nothing narrow enough
# to filter is not being tested. Ten minutes between two meetings is the case that matters.
EVENTS[:] = [ev("first", 9, 60), ev("second", 10, 110), ev("third", 12, 360)]
g = dayplan.gaps(DAY)
eq(g, [],
   f"DP.1 a ten-minute window between two meetings is NOT offered — it is the walk between "
   f"them, and a plan that fills it is one nobody follows: {g}")
EVENTS[:] = [ev("first", 9, 60), ev("second", 11, 420)]
g = dayplan.gaps(DAY)
eq(len(g), 1, "DP.1 CONTROL: while a real hour between the same two IS offered")
eq(g[0][2], 60, f"DP.1 and measured correctly: {g}")

EVENTS[:] = [{"summary": "all day", "start": at(0), "end": at(23), "all_day": True,
              "uid": "x", "calendar": "Personal"}]
eq(dayplan.gaps(DAY), [], "DP.1 a day that is entirely booked has no room, and says so")

# ── DP.2  it does not pretend the day fits ─────────────────────────────────────────────
EVENTS[:] = [ev("standup", 9, 30)]
TODOS[:] = [td(f"task {i}") for i in range(12)]
said, proposal = dayplan.plan(DAY)
ok(proposal and proposal["left_out"],
   "DP.2 twelve tasks do not fit in one day, and the plan knows it")
ok("won't fit" in said,
   f"DP.2 and SAYS the number rather than listing twelve things hopefully: {said!r}")
ok("dropping" in said,
   f"DP.2 offering to DROP one — the option people never give themselves permission to "
   f"take: {said!r}")
ok("drop" in said and "fit" in said and said.index("drop") > said.index("fit"),
   f"DP.2 after the honest number, not instead of it — guarded, because the defect this "
   f"catches is the one that removes the word, and `.index` on a missing substring kills "
   f"the suite with the findings above unprinted: {said!r}")

TODOS[:] = [td("one thing")]
said, proposal = dayplan.plan(DAY)
ok(proposal and not proposal["left_out"], "DP.2 one task fits")
ok("won't fit" not in said,
   f"DP.2 and a day that fits is not lectured about dropping things: {said!r}")

TODOS[:] = []
said, proposal = dayplan.plan(DAY)
ok("Nothing on your list" in said, f"DP.2 an empty list is said plainly: {said!r}")
eq(proposal, None, "DP.2 with nothing to propose")

# ── DP.3  energy changes HOW MUCH, never what ──────────────────────────────────────────
EVENTS[:] = []
TODOS[:] = [td(f"task {i}") for i in range(8)]
_, normal = dayplan.plan(DAY)
_, low = dayplan.plan(DAY, energy="low")
_, high = dayplan.plan(DAY, energy="high")
ok(len(low["chosen"]) < len(normal["chosen"]) <= len(high["chosen"]),
   f"DP.3 flat means LESS, not a reordering: low={len(low['chosen'])} "
   f"normal={len(normal['chosen'])} high={len(high['chosen'])}")
eq([t["summary"] for t in low["chosen"]],
   [t["summary"] for t in normal["chosen"]][:len(low["chosen"])],
   "DP.3 and it is the same list, shorter — somebody who says they are flat is not asking "
   "for a different seven things")

# overdue first, always
TODOS[:] = [td("someday"), td("overdue", DAY - 86400), td("later", DAY + 86400)]
_, p = dayplan.plan(DAY)
eq(p["chosen"][0]["summary"], "overdue",
   "DP.3 an overdue thing leads — that is not a preference")

# ── DP.4  the week's look-back offers to let go ────────────────────────────────────────
TODOS[:] = []
said, rep = dayplan.week(DAY)
ok("empty" in said, f"DP.4 an empty list: {said!r}")

TODOS[:] = [td("ahead", DAY + 86400)]
said, rep = dayplan.week(DAY)
ok("Nothing overdue" in said, f"DP.4 nothing slipped: {said!r}")
eq(rep["slipped"], [], "DP.4 and the report agrees")

# SLIPPED BUT NOT OLD — the other branch, which had no fixture at all, so a plant that
# removed its offer to drop went unnoticed.
TODOS[:] = [td("slipped", DAY - 2 * 86400)]
said, rep = dayplan.week(DAY)
eq(len(rep["slipped"]), 1, "DP.4 one thing slipped")
eq(rep["old"], [], "DP.4 and none has been waiting a week")
ok("dropping" in said,
   f"DP.4 the offer to drop is made HERE TOO — a review that only mentions it for ancient "
   f"items lets a week-old thing roll forward untouched: {said!r}")

TODOS[:] = [td("slipped", DAY - 2 * 86400), td("ancient", DAY - 30 * 86400)]
said, rep = dayplan.week(DAY)
eq(len(rep["slipped"]), 2, "DP.4 both are past their date")
eq([t["summary"] for t in rep["old"]], ["ancient"],
   "DP.4 and one has been waiting more than a week")
ok("drop" in said,
   f"DP.4 the review says the word — a review that never offers to let something go is "
   f"complicit in moving it forward five weeks running: {said!r}")
ok("ancient" in said, f"DP.4 naming the one that has waited longest: {said!r}")

# ── DP.5  an unreachable calendar is said, not planned around ──────────────────────────
def boom(*a, **k):
    raise eds.Unavailable("gone", "unavailable")


_e, _t = eds.events, eds.todos
eds.events = boom
try:
    said, p = dayplan.plan(DAY)
    eq(p, None, "DP.5 no plan is proposed when the calendar cannot be read")
    ok("can't reach" in said,
       f"DP.5 and he says so rather than planning a day he cannot see: {said!r}")
finally:
    eds.events = _e
eds.todos = boom
try:
    said, rep = dayplan.week(DAY)
    eq(rep, None, "DP.5 same for the week")
    ok("can't reach" in said, f"DP.5 said: {said!r}")
finally:
    eds.todos = _t

# ── DP.6 / DP.7  said the way a person would (2026-09-27, take 7) ─────────────────────
# At 5:42 pm "plan my day" said "You have no clear time. That leaves 4 that won't fit today.";
# "how was my week?" said "1 thing slipped past its date. Worth dropping any of them?".
import subprocess as _sp, types as _ty
_old_src = __import__("carried_git").show("2d6023c:orb/daemon/dayplan.py").stdout
old_dayplan = None
if _old_src:
    old_dayplan = _ty.ModuleType("dayplan_head")
    old_dayplan.__file__ = str(HERE/"dayplan.py")
    exec(compile(_old_src, "dayplan_head", "exec"), old_dayplan.__dict__)

EVENING = time.mktime((2026, 9, 16, 17, 42, 0, 0, 0, -1))
EVENTS[:] = []
TODOS[:] = [td("send Sam the invoice", DAY + 6 * 86400), td("call the landlord"), td("stand up and stretch", EVENING + 17 * 60), td("tidy the desk")]
said, prop = dayplan.plan(EVENING)
ok("tomorrow" in said and "no clear time" not in said and prop and prop["chosen"],
   f"DP.6 at 5:42 pm the plan is for TOMORROW, with room in it: {said!r}")
ok(prop and time.localtime(prop["day"])[:3] == (2026, 9, 17),
   f"DP.6 ...and the day it planned really is the 17th: {time.localtime(prop['day'])[:3] if prop else None}")
TODOS[:] = [td(f"task {i}") for i in range(14)]
said, prop = dayplan.plan(DAY)
ok("more on your list that won't fit" in said and not any(ch.isdigit() for ch in said.split("That leaves")[-1][:12]),
   f"DP.6 the left-over count has its noun, in words: {said!r}")
if old_dayplan is None:
    ok(False, "DP.6 CONTROL: could not read dayplan.py at HEAD")
else:
    TODOS[:] = [td("call the landlord"), td("tidy the desk")]
    osaid, _ = old_dayplan.plan(EVENING)
    ok("no clear time" in osaid and "tomorrow" not in osaid,
       f"DP.6 CONTROL: the committed planner says the evening has no clear time, so DP.6 can fail: {osaid!r}")

WEEK_NOW = DAY
EVENTS[:] = [ev("dentist", 9), ev("standup with Priya", 11)]
for e in EVENTS:
    e["start"] -= 2 * 86400
    e["end"] -= 2 * 86400
TODOS[:] = [td("call the landlord", DAY - 2 * 86400)]
said, rep = dayplan.week(WEEK_NOW)
ok("dentist" in said and "on the calendar" in said, f"DP.7 the week says what it held: {said!r}")
ok("One to-do slipped past its date: call the landlord." in said and "Worth dropping it?" in said
   and "any of them" not in said, f"DP.7 one thing is 'it', and it is named: {said!r}")
TODOS[:] = [td("call the landlord", DAY - 2 * 86400), td("renew the passport", DAY - 3 * 86400)]
said, rep = dayplan.week(WEEK_NOW)
ok("Two to-dos slipped past their dates" in said and "any of them" in said, f"DP.7 two are 'their dates', 'any of them': {said!r}")
if old_dayplan is not None:
    TODOS[:] = [td("call the landlord", DAY - 2 * 86400)]
    osaid, _ = old_dayplan.week(WEEK_NOW)
    ok("any of them" in osaid and "dentist" not in osaid,
       f"DP.7 CONTROL: the committed review says 'any of them' of one thing and nothing of the week: {osaid!r}")
EVENTS[:] = []
TODOS[:] = []

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print("✓ day plan: 8 groups green (DP.0 control: the planner cannot write, structurally)")
