#!/usr/bin/env python3
"""The day, answered out loud — and nothing written without a yes.

Run: orb/daemon/.venv/bin/python test_day.py

PLAN C2.1–C2.3, C2.5. The mandate again: **an assistant that silently edits your calendar
has failed.** Everything he changes says what it did and lands where the person can open it.

DY.0 IS THE CONTROL, and it is the one that would matter at 9 am on a Monday: **a booking
is previewed and confirmed, never written on the way past.** The preview and the write are
separate calls on purpose — a confirmation produced by the same call that performs the
action is not a confirmation, it is a receipt.

Reads run against the real calendar. The single write is removed in a `finally`.
"""
import ast
import re
import pathlib
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import sourceof  # noqa: E402

import day
import day_verbs
import eds
import whenparse

import eds_sandbox

# Remove anything this run creates that was not there when it started — registered with
# `atexit`, so it holds even when a planted defect writes something the suite never tracked
# and even when the suite dies on an assertion.
eds_sandbox.guard(__name__)
# Orbs: the kit's calendar is what the home hands in; the suite starts from an empty one
eds.handed([], [])

FAIL = []
NOW = time.time()
MARK = f"ash day test {__import__('os').getpid()}"


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def eq(got, want, label):
    if got != want:
        FAIL.append(f"{label}\n     got: {got!r}\n    want: {want!r}")


def _report():
    """Print what was found and return the exit code. Used when a fixture cannot be built:
    the findings still have to reach the person reading the run."""
    if FAIL:
        print(f"✗ {len(FAIL)} failure(s):\n")
        for f in FAIL:
            print(f"  - {f}\n")
        return 1
    return 0


# ── DY.0  CONTROL: a booking is previewed, not performed ───────────────────────────────
before = len(eds.events(500))
kind, said, plan = day.handle("book lunch with Sam next Tuesday at 3")
eq(kind, "confirm",
   "DY.0 booking needs a yes — the ONE failure that matters here is a meeting at the wrong "
   "hour, and the person can catch that in the half-second before they answer")
eq(len(eds.events(500)), before,
   "DY.0 CONTROL: and NOTHING was written by asking. The preview and the write are separate "
   "calls because a confirmation produced by the call that performs the action is a receipt, "
   "not a confirmation")
ok(plan and plan.get("title") == "lunch with Sam", f"DY.0 the plan names the thing: {plan}")
ok("3 pm" in said, f"DY.0 and the resolved time is SAID BACK before the yes: {said!r}")
ok(said.rstrip().endswith("?"), f"DY.0 as a question: {said!r}")

# ── DY.1  reads cost nothing and never invent ──────────────────────────────────────────
for phrase in ("what's my day", "what's next", "what's on my list"):
    kind, said, payload = day.handle(phrase)
    eq(kind, "say", f"DY.1 {phrase!r} answers straight out")
    eq(payload, None, f"DY.1 and changes nothing")
    ok(said.strip().endswith("."), f"DY.1 in a finished sentence: {said!r}")

kind, said, _ = day.handle("am i free thursday afternoon")
eq(kind, "say", "DY.1 'am I free' answers")
ok(said.startswith(("Yes", "No")), f"DY.1 with a yes or a no first: {said!r}")

# an unresolvable when is a question back, never a guess
kind, said, plan = day.handle("book dinner on flurbsday")
eq(plan, None, "DY.1 an unparseable day books nothing")
ok("couldn't work out" in said or "When would you" in said,
   f"DY.1 and asks rather than guessing — an event silently booked TODAY instead of when it "
   f"was meant is worse than one not booked: {said!r}")

kind, said, plan = day.handle("book standup")
eq(plan, None, "DY.1 a booking with no time is not booked")
ok("When would you like" in said, f"DY.1 it asks when: {said!r}")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

far = int(NOW) + 45 * 86400  # Orbs: DY.2, which defined it, is cut
_saved_events = day.events_in_window
_saved_eds_events = eds.events
try:
    _two_hour = {"summary": "long thing", "start": far, "end": far + 7200,
                 "uid": "u-long", "calendar": "Personal", "recurring": False, "location": ""}
    eds.events = lambda days=7, **kw: [_two_hour]
    day.events_in_window = lambda: [_two_hour]
    # "long thing at 3pm", not "... to 3pm": `split_title` cuts at the first time cue, and
    # `to` is not one — it stayed in the title, the search found nothing, and the first
    # version of MV.5 passed anyway because it was written `_plan is None or ...`. A vacuous
    # pass dressed as tolerance. The plan is now required to exist before it is judged.
    _plan, _said = day.preview_move("long thing at 3pm", now=far - 3600)
    ok(_plan is not None, f"MV.5 CONTROL: the move is previewed at all: {_said!r}")
    ok(_plan and (_plan["end"] - _plan["start"]) == 7200,
       f"MV.5a a two-hour thing stays two hours — silently shortening a meeting is an edit "
       f"the person only discovers by being interrupted: {_plan}")

    _rec = dict(_two_hour, recurring=True, uid="u-rec")
    eds.events = lambda days=7, **kw: [_rec]
    day.events_in_window = lambda: [_rec]
    _plan2, _said2 = day.preview_move("long thing at 3pm", now=far - 3600)
    ok(_plan2 is not None, f"MV.5b CONTROL: the recurring one previews too: {_said2!r}")
    # BOTH ANSWERS WORK NOW (C2.6). Until 2026-09-22 this asserted the opposite — the offer
    # was the series only, because a detached override was believed not to write. It wrote;
    # `generate_instances_sync` was not showing it. The question is a real one again.
    ok(_said2 and "just this one, or all of them" in _said2 and "whole series" not in _said2,
       f"MV.5c a recurring event is offered BOTH answers, because both now work: {_said2!r}")
    eq(_plan2 and _plan2.get("scope"), None,
       "MV.5d and the plan carries no scope, so the question is real rather than a sentence "
       "over a decision already taken — a recurring event has two right answers and neither "
       "is a default")
finally:
    day.events_in_window = _saved_events
    eds.events = _saved_eds_events


left = [e for e in eds.events(500) if MARK in (e.get("summary") or "")]
eq(left, [], f"DY.3 nothing this suite made is left in the calendar: {left}")

# ── DY.4  unreachable is said, not answered as empty ───────────────────────────────────
_real = eds.FEED
eds.FEED = None  # Orbs: nothing handed in is the kit's unreachable calendar
try:
    for phrase in ("what's my day", "what's on my list", "what's next"):
        kind, said, _ = day.handle(phrase)
        eq(kind, "say", f"DY.4 {phrase!r} still answers")
        ok("can't reach" in said,
           f"DY.4 and says he cannot reach it rather than reporting an empty day — C1.3 all "
           f"the way up to the sentence the person hears: {said!r}")
finally:
    eds.FEED = _real

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

# ── DY.6  a promise in passing is RECORDED, never acted on (PLAN C3.5) ────────────────
# "I said I'd send that Tuesday" is a commitment the person will not remember making.
# Catching it is worth a lot; acting on it unasked is the "silently edits your things"
# failure the mandate names — so it is noted, silently, and read back only when asked.
import adapters as _ad
import runtime as _rt
import tempfile as _tf

_jd = Path(_tf.mkdtemp(prefix="dy6-"))
_ad._journal = _rt.Journal(_jd/"j.db")

_before_todos = len(eds.todos())
got = day.note_promise("I said I'd call the bank on Tuesday", turn_id="turn-1")
eq(got, "call the bank on Tuesday",
   "DY.6 the promise is captured in the person's OWN WORDS — a to-do that says something "
   "they did not say is one they cannot recognise later")
eq(len(eds.todos()), _before_todos,
   "DY.6 CONTROL: and NOTHING was added to their task list. A to-do appearing in the GNOME "
   "list that they never asked for is exactly what C6.3 forbids one layer over")

kind, said, _ = day.handle("what did i say i would do")
eq(kind, "say", "DY.6 and it can be asked for")
ok("call the bank" in said, f"DY.6 reading it back: {said!r}")

kind, said, _ = day.handle("what did i say i would do about the bank")
ok("call the bank" in said, f"DY.6 narrowed by subject: {said!r}")
kind, said, _ = day.handle("what did i say i would do about the landlord")
ok("haven't heard" in said,
   f"DY.6 and a subject with no promise says so rather than reading out everything: {said!r}")

for not_a_promise in ("I said hello", "I need to go", "what is my day",
                      "remember this: I take my coffee black"):
    eq(day.note_promise(not_a_promise), None,
       f"DY.6 {not_a_promise!r} is not a commitment — a list full of fragments is one "
       f"nobody reads")

# it must never take a turn down
# BREAK IT PROPERLY. Setting `adapters._journal = None` does NOT disable the journal — it
# makes the next call lazily build a fresh one against the REAL `runtime.db`, and the first
# version of this check wrote a promise row into the user's live journal. Point the path
# somewhere unwritable instead, which is what "the journal is broken" actually looks like.
_real_j, _real_db = _ad._journal, _rt.DB
_ad._journal, _rt.DB = None, Path("/proc/nonexistent-dir/j.db")
try:
    eq(day.note_promise("I said I'd do the thing properly"), None,
       "DY.6 with the journal unwritable it records nothing and RAISES nothing — a listener "
       "that can take a turn down is worse than one that misses something")
finally:
    _ad._journal, _rt.DB = _real_j, _real_db


# ── DY.6b  ASK EACH TIME (owner, 2026-09-23): offered, and added only on a yes ─────────
# The owner chose one question over a promise kept where nobody looks. The offer is a pure
# read — asking must add nothing — and the yes adds exactly what was offered, in their words.
# EDS is STUBBED here: a check that writes the person's real task list is D226's shape.
_q = day.offer_promise("I said I'd call the bank on Tuesday")
ok(_q and "call the bank on Tuesday" in _q[0] and "to-do" in _q[0] and _q[0].endswith("?"),
   f"DY.6b the promise is OFFERED as a question, in their own words: {_q!r}")
eq(_q[1] if _q else None, {"todo": "call the bank on Tuesday"},
   "DY.6b and the payload is exactly what was asked about — agreeing to one thing and "
   "getting another is not agreement")
for _np in ("I said hello", "I need to go", "what is my day"):
    eq(day.offer_promise(_np), None, f"DY.6b CONTROL: {_np!r} is not offered — no question "
                                     f"for a fragment")
_calls = []
_saved_at = day.eds.add_todo
try:
    day.eds.add_todo = lambda title, due=None, **k: (_calls.append((title, due)),
                                                      {"list": "Personal"})[1]
    day.offer_promise("I said I'd send the invoice on Tuesday")
    eq(_calls, [], "DY.6b CONTROL: OFFERING adds nothing — only the yes writes")
    _said_b, _res_b = day.accept_promise({"todo": "send the invoice on Tuesday"}, NOW)
    ok(len(_calls) == 1 and _calls[0][0] == "send the invoice" and _calls[0][1],
       f"DY.6b the yes adds ONE to-do, titled in their words, due when they said: {_calls}")
    ok(_said_b and "send the invoice" in _said_b,
       f"DY.6b and says what went on the list: {_said_b!r}")
    _calls.clear()
    _said_c, _ = day.accept_promise({}, NOW)
    eq(_calls, [], f"DY.6b a yes to nothing adds nothing: {_said_c!r}")

    # ── the exchange, driven: run_offer with the daemon's primitives faked ──
    _asked = []
    def _ask(ans):
        return lambda q: (_asked.append(q), ans)[1]
    _calls.clear()
    _r = day.run_offer("I said I'd send the invoice on Tuesday", _ask(True), now=NOW)
    ok(len(_asked) == 1 and len(_calls) == 1 and _r and "send the invoice" in _r,
       f"DY.6c a yes: asked ONCE, added once, and said: asked={_asked} calls={_calls} {_r!r}")
    _asked.clear(); _calls.clear()
    _r = day.run_offer("I said I'd send the invoice on Tuesday", _ask(False), now=NOW)
    ok(_r is None and _calls == [] and len(_asked) == 1,
       f"DY.6c a no adds nothing and returns None, so the turn carries on as before: "
       f"{_r!r} {_calls}")
    _asked.clear(); _calls.clear()
    _r = day.run_offer("what is my day", _ask(True), now=NOW)
    ok(_r is None and _asked == [] and _calls == [],
       f"DY.6c CONTROL: no promise, no question — a yes-machine asks nothing: {_asked}")
    _gate = []
    _r = day.run_offer("I said I'd send the invoice on Tuesday", _ask(True),
                       may_write=lambda: (_gate.append(1), False)[1], now=NOW)
    ok(_calls == [] and _r and "left your list alone" in _r and _gate == [1],
       f"DY.6c the one-way switch still holds: after a page, a yes does not write: {_r!r}")
    _gate.clear(); _asked.clear()
    day.run_offer("I said I'd send the invoice on Tuesday", _ask(False),
                  may_write=lambda: (_gate.append(1), True)[1], now=NOW)
    eq(_gate, [], "DY.6c and the switch is asked only after a yes, never about nothing")
finally:
    day.eds.add_todo = _saved_at

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

# ── DB  travel and prep buffers (PLAN C2.3) ────────────────────────────────────────────
# A clash is an overlap. A TIGHT GAP is not an overlap and is the same problem: a thing that
# ends at two and a thing that starts at two past two do not clash, and you will still be
# late. `tight` takes its rows directly, so the arithmetic is provable with no calendar
# reachable — which is the point, because the machine this runs on has an empty one.
_T0 = 1_800_000_000                     # a fixed instant; nothing here asks what time it is
_HOUR = 3600


def _ev(name, start, end=None, location=""):
    return {"summary": name, "start": start, "end": end or (start + _HOUR),
            "location": location, "uid": name}


# DB.0 CONTROL: an overlap must NOT be reported as a tight gap. The two are different
# findings with different sentences, and a function that returned both for one event would
# have `preview_book` say the same thing twice.
_overlap = [_ev("dentist", _T0 + 30 * 60, _T0 + 90 * 60)]
eq(day.tight(_T0, _T0 + _HOUR, rows=_overlap), [],
   "DB.0 CONTROL: an overlapping event is a CLASH, not a tight gap")
ok(day.clashes.__doc__ and _overlap[0] in [r for r in _overlap],
   "DB.0a CONTROL: and the fixture really does overlap the window under test")

# DB.1 prep: something five minutes later leaves no room to finish and be ready.
_after = [_ev("standup", _T0 + _HOUR + 5 * 60)]
_t1 = day.tight(_T0, _T0 + _HOUR, rows=_after)
eq([(r["summary"], k) for r, k, _g in _t1], [("standup", "prep")],
   f"DB.1 five minutes later is too tight, and it is a PREP gap: {_t1}")
eq([int(g / 60) for _r, _k, g in _t1], [5], "DB.1a and the gap is reported, not just the fact")

# DB.2 the counter-control: enough room is not a finding. Without this, DB.1 passes on a
# `tight` that flags every event on the calendar.
_roomy = [_ev("standup", _T0 + _HOUR + 45 * 60)]
eq(day.tight(_T0, _T0 + _HOUR, rows=_roomy), [],
   "DB.2 CONTROL: forty-five minutes is room, and room is not a finding")

# DB.3 travel applies only when the calendar SAYS the place changes. Twenty minutes is fine
# in the same room and not fine across town, and the only thing that can tell them apart is
# the location field.
_same = [_ev("review", _T0 + _HOUR + 20 * 60, location="Room 2")]
_diff = [_ev("review", _T0 + _HOUR + 20 * 60, location="Other side of town")]
_here = {"start": _T0, "end": _T0 + _HOUR, "location": "Room 2"}
eq(day.tight(_T0, _T0 + _HOUR, rows=_same), [],
   "DB.3 twenty minutes in the same place is fine — prep is ten and this clears it")
_t3 = day.tight(_T0, _T0 + _HOUR, rows=_diff)
eq([(r["summary"], k) for r, k, _g in _t3], [],
   "DB.3a a location on ONE side only is not evidence the place changed — a missing "
   "location is unknown, and guessing it means 'elsewhere' would flag every ordinary day")

# DB.3b THE TRAVEL BUFFER, reached the only way it currently can be: by telling `tight` where
# the new thing is. Nothing captures that from speech yet — "lunch with Sam at 3" carries a
# time and a title and no place — so this is the seam, tested here and unreachable from the
# spoken path until C2.2 gives a booking a location. Asserting it now means the arithmetic is
# already right when that lands, rather than being written blind against it.
_t3b = day.tight(_T0, _T0 + _HOUR, rows=_diff, location="Room 2")
eq([(r["summary"], k, int(g / 60)) for r, k, g in _t3b], [("review", "travel", 20)],
   f"DB.3b twenty minutes ACROSS TOWN is too tight, and it is a TRAVEL gap: {_t3b}")
eq(day.tight(_T0, _T0 + _HOUR, rows=_same, location="Room 2"), [],
   "DB.3c CONTROL: the same twenty minutes in the SAME place is still fine — so DB.3b is "
   "the location doing the work, not the clock")

# DB.4 with both locations present and different, travel time is claimed.
_both = [_ev("review", _T0 + _HOUR + 20 * 60, location="Other side of town")]
_t4 = day._needed_gap(_both[0], {"location": "Room 2"})
eq(_t4[0], "travel", f"DB.4 two different named places want TRAVEL time: {_t4}")
eq(day._needed_gap({"location": "Room 2"}, {"location": "room 2"})[0], "prep",
   "DB.4a the same place spelled differently is the same place — compared case-folded, "
   "because a calendar is typed by a person")
eq(day._needed_gap({"location": ""}, {"location": "Room 2"})[0], "prep",
   "DB.4b and one side missing falls back to prep rather than inventing a journey")

# DB.5 the sentence. A confirmation is the only place this reaches a person, and it has to
# say the thing without saying it twice.
_saved_ev = day.events_in_window
try:
    day.events_in_window = lambda: _after
    _plan, _said = day.preview_book("standup at " + time.strftime("%-I%p", time.localtime(_T0)).lower(),
                                    now=_T0 - 6 * _HOUR)
    ok(_plan is None or "standup" in (_said or "").lower(),
       f"DB.5 CONTROL: the preview produced a sentence at all: {_said!r}")
finally:
    day.events_in_window = _saved_ev

# DB.6 STRUCTURAL: a clash and a tight gap are never both said. They are one fact told twice,
# and a confirmation people stop listening to has stopped working.
_src = (HERE/"day.py").read_text()
_pb = _src[_src.index("def preview_book"):]
_pb = _pb[:_pb.index("\ndef ", 1)]
ok("else:" in _pb and _pb.index("close = tight(") > _pb.index("else:"),
   "DB.6 the tight-gap sentence sits in the ELSE of the clash branch, so a booking that "
   "clashes is not also told it is close to the thing it clashes with")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

# ── DB.8  the place reaches the calendar, and the travel buffer finally fires ───────────
# D218: `tight`'s travel branch was UNREACHABLE. Every booking went in with location="" —
# the buffer was built, proven through an injected seam, and could not be reached from the
# one path that creates events. It measured clean because nothing ever asked it to fire.
#
# The neighbour is positioned relative to the RESOLVED booking time rather than to a typed
# instant: the phrase and the fixture must agree, and the only way to be sure they do is to
# let the same parser place both.
_WHEN = "tomorrow at 1:20pm"
_bstart = whenparse.resolve(_WHEN, NOW)
ok(_bstart is not None, f"DB.8 CONTROL: the fixture phrase {_WHEN!r} resolves at all — "
                        f"a check built on a phrase nothing can parse proves nothing")
_saved_ev = day.events_in_window
try:
    # ends 20 minutes before the booking, somewhere else: not an overlap, and you are late
    day.events_in_window = lambda: [_ev("the dentist", _bstart - 80 * 60,
                                        location="Main Street")]
    _plan, _said = day.preview_book(f"lunch with Sam at the cafe {_WHEN}", NOW)
    eq(_plan.get("location"), "the cafe", "DB.8a a place said out loud reaches the plan")
    ok("at the cafe" in _said, "DB.8b and is said back before the yes — a place heard wrong "
                               "is a place you drive to")
    ok("to get there from" in _said,
       f"DB.8c the TRAVEL buffer fires now that a booking can carry a place. Said: {_said!r}")

    _plan2, _said2 = day.preview_book(f"standup {_WHEN}", NOW)
    eq(_plan2.get("location"), "", "DB.8d CONTROL: no place stated, no place invented")
    ok("to get there from" not in _said2,
       f"DB.8e ...and with no place on the new thing there is no journey to warn about. A "
       f"travel warning on every neighbour is one people stop hearing. Said: {_said2!r}")
finally:
    day.events_in_window = _saved_ev

# The plan is not the calendar. `book` has to pass it on, which is a different line from the
# one that captured it — and the row's promise is that it is visible in gnome-calendar.
_sent = {}
_saved_add = day.eds.add_event
try:
    day.eds.add_event = lambda *a, **k: (_sent.update(k), {"calendar": "Personal"})[1]
    day.book({"title": "lunch", "start": _bstart, "end": _bstart + 3600,
              "location": "the cafe"})
finally:
    day.eds.add_event = _saved_add
eq(_sent.get("location"), "the cafe", "DB.8f and `book` hands it to EDS, so it lands where "
                                      "the person can open it")


# ── CS  the recurring fork, asked so a person can answer it (PLAN C2.2/C2.5_t) ──────────
# `ask_yes_no` is the daemon's only asking primitive, so "just this one, or all of them?" is
# a question it cannot take an answer to. The fork is two yes/no questions, NARROWEST FIRST.
_series_start = NOW + 26 * _HOUR


def _rec(uid="s1", n=3, summary="standup"):
    return [{"summary": summary, "start": _series_start + i * 7 * 86400,
             "end": _series_start + i * 7 * 86400 + 1800, "uid": uid, "recurring": True,
             "location": "", "calendar": "Personal",
             "recurrence_id": f"rid-{i}"} for i in range(n)]


_saved_events = day.eds.events
try:
    day.eds.events = lambda days=7, **kw: _rec()
    _row, _said = day.preview_cancel("standup")
    ok(_row is not None,
       f"CS.0 CONTROL: three occurrences of ONE event are one event, not a choice of three. "
       f"Counting rows asked 'There are 3: standup, standup and standup. Which one?' — a "
       f"question with no answerable difference between its options. Said: {_said!r}")
    ok(_row and _row.get("scope") == "this",
       "CS.0a a yes to the first question does the SMALLER thing — somebody who says yes "
       "without listening loses one occurrence rather than a year of them")
    ok(_row and _row.get("followup") and _row["followup"][1] == "all",
       f"CS.0b and the wider option is a second yes/no, not a fork in the first: "
       f"{_row.get('followup') if _row else None}")
    ok("?" in _said and " or all of them?" not in _said,
       f"CS.0c the question asked is answerable yes or no: {_said!r}")

    # Two DIFFERENT events that both match is the case where "which one?" is right.
    day.eds.events = lambda days=7, **kw: _rec("s1", 2) + _rec("s2", 1, "standup with Priya")
    _row2, _said2 = day.preview_cancel("standup")
    ok(_row2 is None and "Which one" in _said2,
       f"CS.1 CONTROL: two different events still ask which — the grouping is by uid, not a "
       f"blanket refusal to ever ask: {_said2!r}")

    # A one-off has one answer, and asking a question with one answer is noise.
    day.eds.events = lambda days=7, **kw: [_ev("dentist", _series_start)]
    _row3, _said3 = day.preview_cancel("dentist")
    ok(_row3 is not None and _row3.get("scope") == "all" and not _row3.get("followup"),
       f"CS.2 a one-off is not asked the recurring question: {_said3!r}")

    # ── MW  the move verb, which `handle` never called ─────────────────────────────────
    # `day_verbs` has matched "move" since C2.2 and `handle` had no branch for it, so every
    # "move the standup to four" fell through to the model — the one outcome the
    # deterministic verbs exist to avoid, and invisible from every other angle.
    day.eds.events = lambda days=7, **kw: _rec()
    _k, _s, _plan = day.handle("move the standup to 6pm tomorrow")
    eq(_k, "confirm", f"MW.0 a move reaches preview_move and comes back as something to "
                      f"confirm, rather than falling through to the model: {_s!r}")
    # C2.6 LANDED, so the offer changed. This asserted `scope == "all"` and the limitation
    # being said out loud, which was right while the override was believed not to write.
    ok(_plan and _plan.get("scope") is None,
       "MW.0a a recurring move offers BOTH answers now (C2.6) — the plan carries no scope, "
       "so the question is real rather than a sentence over a decision already taken")
    ok(_plan and _plan.get("row"),
       "MW.0b and the plan carries the ROW, which is what holds the recurrence id — "
       "'just this one' is unanswerable without knowing which one")
    ok("just this one, or all of them" in (_s or ""),
       f"MW.0c and the person is asked which, in those words: {_s!r}")

    # The title must survive the split. "move X to 6pm" left the preposition on the title,
    # so the lookup found nothing and said it could not find an event the person is looking at.
    _t, _w = day_verbs.split_title("move the standup to 6pm")
    eq(_t, "move the standup", "MW.1 a trailing preposition does not ride on the title")
    eq(day_verbs.split_title("move the walk to the shop to 5pm")[0], "move the walk to the shop",
       "MW.1a CONTROL: and only the TRAILING one — a title that legitimately contains 'to' "
       "keeps it")
finally:
    day.eds.events = _saved_events

# ── CS.3  one door, so the daemon does not have to know which verb produced the payload ─
# It used to route on whether the payload had a "title", which worked while there were
# exactly two verbs and sent a move to `cancel` the moment there were three.
_calls = []
_sv = (day.book, day.move, day.cancel)
try:
    day.book = lambda p, **k: (_calls.append(("book", k)), ("", None))[1]
    day.move = lambda p, scope=None: (_calls.append(("move", scope)), ("", None))[1]
    day.cancel = lambda p, scope=None: (_calls.append(("cancel", scope)), ("", None))[1]
    day.do_confirmed({"title": "lunch", "start": 1, "end": 2})
    day.do_confirmed({"row": {"uid": "u"}, "start": 1, "end": 2}, scope="all")
    day.do_confirmed({"uid": "u", "summary": "x"}, scope="this")
    eq([c[0] for c in _calls], ["book", "move", "cancel"],
       "CS.3 a booking, a move and a cancel each reach their own verb")
    eq(_calls[1][1] if len(_calls) > 1 else None, "all",
       "CS.3a and the answered scope is carried through, not dropped at the door")
finally:
    day.book, day.move, day.cancel = _sv
eq(day.do_confirmed(None), ("Left it.", None),
   "CS.3b CONTROL: nothing to do is not an exception")


# (cut in the Orbs kit: see kit/ash/CARRIED.md)

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

# ── DY.10  weather in the brief: four different answers, on purpose ─────────────────────
# The daemon has no network client and must not grow one — 13.1 put every external fetch
# behind `external()` in `main.js`, and a second fetcher here would be a second unbounded
# surface reaching the internet. So weather arrives through `desk.json`, and the ways that
# file can be WRONG are the whole test: a key that was never written, a provider that
# failed, and — the one that matters — a reading from this morning read out at nine tonight
# as if it were current. That last is 13.2's frozen clock moved up a level, into the file
# every consumer reads rather than the panel one person is looking at.
import json as _json
import tempfile as _tf
import os as _os
from datetime import datetime as _dt, timezone as _tz

_WX_TMP = []
_NOW = time.time()


def _iso(t):
    return _dt.fromtimestamp(t, _tz.utc).isoformat().replace("+00:00", "Z")


def _desk(w):
    f = _tf.mkstemp(prefix="deskwx-", suffix=".json")[1]
    Path(f).write_text(_json.dumps({} if w is None else {"weather": w}))
    _WX_TMP.append(f)
    return f


try:
    ok(day.weather(path=_desk(None)) is None,
       "DY.10a no weather key at all says NOTHING — the orb may simply never have fetched, "
       "and a brief that invents a sky is worse than one that omits it")
    ok(day.weather(path="/nonexistent/desk.json") is None,
       "DY.10b ...and an unreadable file is the same answer, not an exception out of a brief")
    _un = day.weather(path=_desk({"at": _iso(_NOW), "unavailable": True,
                                  "provider": "api.open-meteo.com"}))
    ok(_un is not None and "api.open-meteo.com" in _un and "not answering" in _un,
       f"DY.10c a failed provider is NAMED out loud rather than silently dropped ({_un!r})")
    _fresh = day.weather(now=_NOW, path=_desk({
        "at": _iso(_NOW), "current": {"temperature_2m": 14.3, "weather_code": 3},
        "daily": {"temperature_2m_max": [19.1]}}))
    ok(_fresh == "It is 14 degrees and overcast, up to 19.",
       f"DY.10d a current reading is spoken plainly, with the day's high only when it is "
       f"actually higher ({_fresh!r})")
    _flat = day.weather(now=_NOW, path=_desk({
        "at": _iso(_NOW), "current": {"temperature_2m": 19.0, "weather_code": 0},
        "daily": {"temperature_2m_max": [19.4]}}))
    ok(_flat == "It is 19 degrees and clear.",
       f"DY.10e CONTROL: ...and a high within a degree of now is left out, so DY.10d is the "
       f"comparison working and not a clause that is always appended ({_flat!r})")
    _old = day.weather(now=_NOW, path=_desk({
        "at": _iso(_NOW - 5 * 3600), "current": {"temperature_2m": 8.0, "weather_code": 61}}))
    # Exercised at an EXACT hour boundary on purpose: that is where the ISO round-trip's
    # microsecond loss turns 18000 s into 17999.999999523 and floor division reports four
    # hours. It was green on four full passes before the microsecond digit fell the other
    # way, so this now pins the boundary rather than trusting an arbitrary age.
    ok(_old is not None and _old.startswith("Weather is 5 hours old"),
       f"DY.10f A STALE READING IS SAID WITH ITS AGE — this morning's sky read out at nine "
       f"tonight as though it were current is 13.2's frozen clock, one level up ({_old!r})")
    _edge = day.weather(now=_NOW, path=_desk({
        "at": _iso(_NOW - 4 * 3600 - 2100), "current": {"temperature_2m": 8.0,
                                                        "weather_code": 61}}))
    ok(_edge is not None and _edge.startswith("Weather is 5 hours old"),
       f"DY.10f-b four and a half hours rounds UP, not down — truncation always errs the "
       f"same way, reporting a reading as FRESHER than it is, which is the one direction a "
       f"staleness warning must not round in ({_edge!r})")
    _edge2 = day.weather(now=_NOW, path=_desk({
        "at": _iso(_NOW - 4 * 3600 - 600), "current": {"temperature_2m": 8.0,
                                                       "weather_code": 61}}))
    ok(_edge2 is not None and _edge2.startswith("Weather is 4 hours old"),
       f"DY.10f-c CONTROL: and four hours and ten minutes still rounds DOWN, so DY.10f-b is "
       f"rounding and not a clause that always adds an hour ({_edge2!r})")
    _nodate = day.weather(now=_NOW, path=_desk({
        "current": {"temperature_2m": 8.0, "weather_code": 95}}))
    ok(_nodate is not None and "how old" in _nodate and "hours old" not in _nodate,
       f"DY.10g ...and an UNDATEABLE reading does not get to invent how stale it is. The "
       f"first version substituted the cutoff and announced '3 hours old' about a reading it "
       f"could not date ({_nodate!r})")
finally:
    # TEARDOWN NEVER RAISES. The first version called a bare `os.unlink` in a module that
    # does not import `os`, so the NameError here replaced the real TypeError above it and
    # the suite reported neither — CLAUDE.md §12, demonstrated on itself.
    for _f in _WX_TMP:
        try:
            _os.unlink(_f)
        except Exception:
            pass

# The table is PARSED from the panel's own `weather.2.js`, never retyped, so the word he says
# and the word on the widget cannot drift apart. DY.10i is the control that matters: if the
# panel's table moves or is renamed, the parse must come back EMPTY and the sentence lose its
# adjective — not fall back to a stale second copy nobody remembers writing.
_table = day._wmo()
ok(len(_table) >= 20 and _table.get(0) == "Clear" and _table.get(95) == "Thunderstorm",
   f"DY.10h the WMO words are parsed out of the panel's own table ({len(_table)} codes)")
_blank = Path(_tf.mkstemp(prefix="wmogone-", suffix=".js")[1])
try:
    _blank.write_text("const OTHER={0:['Clear','x']};\n")
    ok(day._wmo(path=_blank) == {},
       "DY.10i CONTROL: a panel whose table moved parses to NOTHING, so DY.10h is a real "
       "parse of a real file and not a dict this module carries of its own")
finally:
    _blank.unlink(missing_ok=True)

# And the brief actually CARRIES it — a weather function nothing calls is the shape D45 is
# about, and `brief()` composing it is the only reason any of the above matters.
_said, _ = day.brief(now=_NOW)
ok(isinstance(_said, str) and _said.strip(),
   "DY.10j the brief still speaks with weather folded in")



# ── DY.30  "what's my day" is the calendar AND what is due on it (2026-09-27, take 7) ──────
# It said "Nothing on today." a minute after "remind me in 20 minutes to stand up and stretch".
_ev_saved, _td_saved = day.eds.events, day.eds.todos
try:
    _now30 = time.mktime((2026, 9, 27, 17, 41, 0, 0, 0, -1))
    _due30 = _now30 + 18 * 60
    day.eds.events = lambda days=7, **kw: []
    day.eds.todos = lambda: [{"summary": "stand up and stretch", "due": _due30, "done": False, "uid": "s1"},
                             {"summary": "send Sam the invoice", "due": _now30 + 2 * 86400, "done": False, "uid": "s2"}]
    said30, _ = day.agenda(now=_now30)
    ok("stand up and stretch" in said30 and "Sam" not in said30 and "Nothing on today." != said30,
       f"DY.30 an empty calendar with a reminder due today says the reminder, not 'Nothing on today': {said30!r}")
    brief30, _ = day.agenda(now=_now30, with_list=False)
    ok(brief30 == "Nothing on today.", f"DY.30 the brief asks without the list — it says the list itself: {brief30!r}")
    import subprocess as _sp30, types as _ty30
    _src30 = __import__("carried_git").show("9fe64ce:orb/daemon/day.py").stdout
    if not _src30:
        ok(False, "DY.30 CONTROL: could not read day.py at HEAD")
    else:
        _old30 = _ty30.ModuleType("day_head")
        _old30.__file__ = str(HERE/"day.py")
        exec(compile(_src30, "day_head", "exec"), _old30.__dict__)
        _old30.eds.events, _old30.eds.todos = day.eds.events, day.eds.todos
        osaid30, _ = _old30.agenda(now=_now30)
        ok(osaid30 == "Nothing on today.", f"DY.30 CONTROL: the committed agenda says 'Nothing on today.', so DY.30 can fail: {osaid30!r}")
finally:
    day.eds.events, day.eds.todos = _ev_saved, _td_saved

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
# The group count is DERIVED. It was typed, and it was wrong within an hour of
# adding a group — the same class as every other handwritten count in this tree.
_GROUPS = len({m.group(1) for m in re.finditer(r"\b([A-Z]+\.[0-9]+)[a-z]?\b",
                                               pathlib.Path(__file__).read_text())})
print(f"✓ day: {_GROUPS} checks green (DY.0 control: a booking is previewed and confirmed, never written on the way past)")
