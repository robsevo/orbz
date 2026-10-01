#!/usr/bin/env python3
"""The day's verbs cost nothing, and the ones that are not verbs still reach the model.

Run: orb/daemon/.venv/bin/python test_day_verbs.py

PLAN C1.6. "What's my day" has one right answer and it comes out of EDS. Asking a model what
the phrase means is paying for an answer the phrase already gives — every morning, forever.

DV.0 IS THE CONTROL, and it is the half that makes a verb table safe: **the near misses must
NOT match.** A table that matches everything is a silent behaviour change dressed up as a
cost saving — "how should I spend Thursday" is planning and needs a model, "book me a flight"
is a task for the CLI, and "cancel that" has no antecedent at all.
"""
import ast
import re
import pathlib
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import day_verbs as V
import whenparse as W

FAIL = []
WED = datetime(2026, 9, 16, 10, 0, tzinfo=ZoneInfo("US/Eastern"))


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def eq(got, want, label):
    if got != want:
        FAIL.append(f"{label}\n     got: {got!r}\n    want: {want!r}")


# `(None, "")` as the floor: every subscript below is on the RESULT of the check above it,
# so the defect that makes a verb stop matching kills the suite on the next line with the
# finding unprinted. Eleventh instance of that shape in this project.
def m(phrase):
    return V.match(phrase) or (None, "")


# ── DV.0  CONTROL: the near misses fall through ────────────────────────────────────────
for phrase in V.NEAR_MISSES:
    eq(V.match(phrase), None,
       f"DV.0 CONTROL: {phrase!r} is NOT a day verb — it reaches the model, which is what "
       f"the model is for. A table that matches everything is a behaviour change dressed "
       f"up as a cost saving")

for phrase in ("build me a page", "stop", "what is the weather", "remember this: I take my "
               "coffee black", "open chrome", "why do you think that", ""):
    eq(V.match(phrase), None,
       f"DV.0 and {phrase[:40]!r} is somebody else's verb or nobody's — this table must not "
       f"swallow the learning verbs, the control phrases, or ordinary work")

# ...and the control for the control: real verbs DO match, or the checks above pass by
# matching nothing at all.
ok(sum(1 for p in ("what's my day", "what's on my list", "cancel the dentist",
                   "book lunch tomorrow", "remind me to call the bank",
                   "am i free friday") if V.match(p)) == 6,
   "DV.0 CONTROL: all six real verbs match — otherwise 'nothing matches' would satisfy "
   "every check above")

# ── DV.1  reading verbs ────────────────────────────────────────────────────────────────
for phrase in ("what's my day", "what is my day", "what does my day look like",
               "what's my schedule", "what's next", "what's up next", "what have i got on",
               "agenda", "what's on"):
    got = V.match(phrase)
    ok(got and got[0] == "agenda", f"DV.1 {phrase!r} -> agenda, got {got}")

eq(V.match("what's on tomorrow"), ("agenda", "tomorrow"),
   "DV.1 and a named day comes through as the when — not as a title, which is what it "
   "became when the pattern captured the whole phrase: the caller got 'day' and \"'s\"")
eq(m("what's my day")[1], "",
   "DV.1 with no day named, the payload is empty rather than noise")

for phrase in ("what's on my list", "what's my todos", "what's my to-do list",
               "what do i have to do", "my to do list"):
    got = V.match(phrase)
    ok(got and got[0] == "todos", f"DV.1 {phrase!r} -> todos, got {got}")

# ── DV.2  writing verbs need something to call the thing ───────────────────────────────
for phrase in ("book", "book a", "cancel", "cancel the", "remind me to", "add a to-do"):
    eq(V.match(phrase), None,
       f"DV.2 {phrase!r} names no thing, so it is not an instruction — it is the start of "
       f"one. Accepting it creates an event named after the command that made it")

got = m("book lunch with Sam next Tuesday at 3")
eq(got[0], "book", "DV.2 book")
eq(V.split_title(got[1]), ("lunch with Sam", "next Tuesday at 3"),
   "DV.2 the title and the time come apart at the first time-word")
eq(W.resolve(V.split_title(got[1])[1], WED), int(datetime(2026, 9, 22, 15, 0,
                                                          tzinfo=ZoneInfo("US/Eastern")).timestamp()),
   "DV.2 and the time resolves in CODE, to one instant (C1.5)")

got = m("remind me to call the bank tomorrow")
eq(got[0], "todo", "DV.2 todo")
eq(V.split_title(got[1]), ("call the bank", "tomorrow"), "DV.2 split")

for phrase in ("add a to-do: call the bank", "add to-do call the bank",
               "note down call the bank", "put on my list call the bank"):
    got = V.match(phrase)
    ok(got and got[0] == "todo" and "call the bank" in got[1],
       f"DV.2 {phrase!r} -> todo, got {got}")

eq(V.match("cancel the dentist"), ("cancel", "dentist"), "DV.2 cancel keeps the thing named")

# ── DV.3  the split is wrong in the SAFE direction ─────────────────────────────────────
# A title with a date in it is visible and fixable. A title of "lunch" with the meeting at
# the wrong hour is neither.
eq(V.split_title("standup"), ("standup", ""), "DV.3 no time word, all title")
eq(V.split_title(""), ("", ""), "DV.3 nothing is nothing")
title, when = V.split_title("tomorrow at 9")
eq(title, "tomorrow at 9",
   "DV.3 a payload that is ONLY a time keeps it as the title rather than producing an "
   "event with no name — the caller can see that and fix it")
title, when = V.split_title("review with the team on friday at 2pm")
eq((title, when), ("review with the team", "friday at 2pm"), "DV.3 a longer one")

# ── DV.4  no model, no seat, no cost ───────────────────────────────────────────────────
_src = (HERE/"day_verbs.py").read_text()
_tree = ast.parse(_src)
_imports = set()
for n in ast.walk(_tree):
    if isinstance(n, ast.Import):
        _imports.update(a.name.split(".")[0] for a in n.names)
    elif isinstance(n, ast.ImportFrom) and n.module:
        _imports.add(n.module.split(".")[0])
eq(sorted(_imports), ["re"],
   f"DV.4 it imports `re` and nothing else — no seatbroker, no urllib, no subprocess. The "
   f"whole point of this row is that the morning agenda costs nothing: {sorted(_imports)}")

# and it decides WHICH verb, never WHEN — those are different jobs and one of them is
# whenparse's, in code, because it has a correct answer
# From the IMPORTS, not the text: the docstring explains that `whenparse` owns the time,
# so a substring check fires on the file that gets it right. Third time today.
ok("whenparse" not in _imports,
   "DV.4 and it does not resolve times itself — one owner for that, or the two drift and "
   "the calendar disagrees with what he said out loud")

# ── MVV  the `move` verb (PLAN C2.2) ───────────────────────────────────────────────────
# ORDERED BEFORE `book`, which is the same lesson `todo` already taught: a broad pattern that
# shadows a specific one is a table that is wrong only for the phrases people actually use.
for _phrase, _want in (("move the standup to four", "move"),
                       ("reschedule lunch to tomorrow", "move"),
                       ("push the dentist to next week", "move"),
                       ("shift my one-to-one to friday", "move")):
    _m = V.match(_phrase)
    eq(_m and _m[0], _want, f"MVV.0 {_phrase!r} is a move")

# The counter-control: `book` still wins its own phrasings. Without this, MVV.0 passes on a
# table where `move` has swallowed everything.
for _phrase in ("book lunch with Sam next Tuesday at 3", "schedule a review on friday"):
    _m = V.match(_phrase)
    eq(_m and _m[0], "book", f"MVV.1 CONTROL: {_phrase!r} is still a booking")

# "MOVE ME" IS AN ERRAND, not a reschedule — the same ruling that keeps "book me a flight"
# out of `book`, and the word that separates them is `me`.
eq(V.match("move me to the front"), None,
   "MVV.2 'move me' is not this verb — moving a person is an errand for the CLI")
eq(V.match("reschedule"), None,
   "MVV.2a and `move` with nothing to move is the start of an instruction, not one")


# ── DV.5  WHERE ────────────────────────────────────────────────────────────────────────
# `split_place` exists because C2.3 shipped a travel buffer that could not fire: the calendar
# carries a location and nothing captured one from speech (D218). The whole difficulty is
# that "at" introduces both a place and a time, sometimes in one sentence.
for phrase, want_place, want_rest in [
    ("lunch with Sam at the dentist tomorrow at 1", "the dentist",
     "lunch with Sam tomorrow at 1"),
    ("standup in Room 2 on Friday at 9", "Room 2", "standup on Friday at 9"),
    ("meeting at 3pm at the office", "the office", "meeting at 3pm"),
    ("dinner at the Ivy", "the Ivy", "dinner"),
]:
    eq(V.split_place(phrase), (want_rest, want_place), f"DV.5 {phrase!r} -> a place")

# THE CONTROL, and it is the half that matters. A time read as a place is a meeting at the
# wrong hour; a place read as a title is visible in the confirmation and harmless. So the
# refusals are asserted at least as hard as the captures — a `split_place` that returned a
# place for everything would pass the four above and be a serious regression.
for phrase in ["lunch at 1", "call in 20 minutes", "review in the morning",
               "book a table in an hour", "sync at noon", "standup at 9:30am",
               "catch up in a couple of days", "drinks at half past six",
               "review this afternoon", "planning in July"]:
    eq(V.split_place(phrase)[1], "",
       f"DV.5a CONTROL: {phrase!r} states a TIME, not a place — and an ambiguous tail is "
       f"never a place, because the two mistakes are not equal")

# One definition of where a phrase's time starts. Two would drift, and the symptom would be
# a location with a day name stuck on the end of it, shown to the person in gnome-calendar.
import inspect  # noqa: E402
_src = inspect.getsource(V)
eq(_src.count("(on|at|next|this|coming|tomorrow|today|tonight|in)"), 1,
   "DV.5b the time-cue pattern is defined once and shared by split_title and split_place")


# ── DV.20  "add" books an EVENT, never a feature (2026-09-27, the LinkedIn take) ─────────────
# "add a dark mode toggle to the page in ~/ash-projects/late-night-ramen" was taken by `book` and
# answered "When would you like dark mode toggle to the page?" — on camera, instead of the work.
for _t in ("add a dark mode toggle to the page in ~/ash-projects/late-night-ramen",
           "add a call to the API in App.tsx", "add a login button to the site",
           "add a section about our story to the page"):
    ok(V.match(_t) is None, f"DV.20 {_t!r} is a coding request: it falls through to him, not the calendar")
for _t, _want in (("add lunch with Sam next Tuesday at 1", "book"), ("add dentist thursday at 3", "book"),
                  ("add a call with Sam tomorrow at 2", "book"), ("add a to-do: call the bank", "todo"),
                  ("book a dentist appointment thursday at 3", "book"), ("schedule a review on friday", "book")):
    _g = V.match(_t)
    ok(bool(_g) and _g[0] == _want, f"DV.20 CONTROL: {_t!r} is still a {_want}: {_g}")
# ...but a NAMED calendar is a booking whatever the event is called (2026-09-28: "add ASH TEST delete
# me to my calendar" and "add the project review to my calendar" were taken for code)
for _t in ("add the project review to my calendar tomorrow at 10", "add ASH TEST delete me to my calendar tomorrow at 3pm",
           "put the app launch on my calendar friday at 2"):
    _g = V.match(_t)
    ok(bool(_g) and _g[0] == "book", f"DV.20 {_t!r} names the calendar, so it is booked: {_g}")
ok(W.resolve("dark mode toggle to the page in ~/ash-projects/late-night-ramen") is not None,
   "DV.20 why a time alone cannot decide it: whenparse finds one in 'late-night'")
_src = (HERE/"day_verbs.py").read_text()
_gate = '            if verb == "book" and _ADDING.match(s) and _CODE.search(payload) and not on_calendar:\n                return None'
if _gate not in _src:
    ok(False, "DV.20 CONTROL: the gate moved, so the pre-fix matcher cannot be planted")
else:
    import types  # noqa: E402
    _pre = types.ModuleType("day_verbs_prefix")
    _pre.__file__ = str(HERE/"day_verbs.py")
    exec(compile(_src.replace(_gate, "            pass", 1), "day_verbs_prefix", "exec"), _pre.__dict__)
    _b = _pre.match("add a dark mode toggle to the page in ~/ash-projects/late-night-ramen")
    ok(bool(_b) and _b[0] == "book", f"DV.20 CONTROL: without the gate the coding request IS booked, so DV.20 can fail: {_b}")

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
# The group count is DERIVED. It was typed, and it was wrong within an hour of
# adding a group — the same class as every other handwritten count in this tree.
_GROUPS = len({m.group(1) for m in re.finditer(r"\b([A-Z]+\.[0-9]+)[a-z]?\b",
                                               pathlib.Path(__file__).read_text())})
print(f"✓ day verbs: {_GROUPS} checks green (DV.0 control: the near misses fall through to the model)")
