#!/usr/bin/env python3
""""next Tuesday at 3" resolves to one instant, and it is the right one.

Run: orb/daemon/.venv/bin/python test_whenparse.py

PLAN C1.5 / C1.6_t. The target for this row is **100%**, not 95%, and that is only
reachable because it is computed rather than asked: a model that is 98% right about the hour
books 2% of meetings at the wrong time, and the person finds out by missing one.

WP.0 IS THE CONTROL, and it is the one that matters: **DST**. Every case here is resolved
against a FIXED reference instant, so a check that passes in October still passes in March.

A HONEST NOTE ABOUT WHAT IT CAN AND CANNOT CATCH, because three attempts to plant "the DST
bug" here all failed and that is worth writing down rather than quietly dropping:

  * `_at` sets the hour with `.replace()` on a zone-aware datetime whose DATE is already
    correct, so the offset is computed from the final wall time. Day-level arithmetic
    errors — `ref + timedelta(weeks=1)` versus `fromtimestamp(now + 7*86400)` — cannot move
    the resulting TIME, because the hour is overwritten afterwards either way. That is a
    structural immunity, not a gap in the checks, and it is why those plants do not fire.
  * What IS load-bearing, and proven: the zone itself. Pointing `ZONE` at UTC turns 55
    checks red. And the two 9 am answers below really do carry different UTC offsets while
    sharing a wall hour, which is asserted rather than assumed.

So: the DST behaviour is measured, the zone handling has a control, and the specific
"forgot to re-resolve the offset" defect is unreachable in this design.
"""
import sys
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))

import whenparse as W

FAIL = []
EASTERN = ZoneInfo("US/Eastern")


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def eq(got, want, label):
    if got != want:
        FAIL.append(f"{label}\n     got: {got!r}\n    want: {want!r}")


def at(y, mo, d, h=0, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=EASTERN)


def shows(epoch):
    return "(none)" if epoch is None else \
        datetime.fromtimestamp(epoch, EASTERN).strftime("%a %Y-%m-%d %H:%M %Z")


def case(phrase, now, want, why=""):
    got = W.resolve(phrase, now)
    if got is None and want is None:
        return
    if want is None:
        FAIL.append(f"WP {phrase!r} should not resolve, got {shows(got)}")
        return
    if got is None:
        FAIL.append(f"WP {phrase!r} did not resolve; wanted {shows(want.timestamp())}"
                    + (f" — {why}" if why else ""))
        return
    if int(got) != int(want.timestamp()):
        FAIL.append(f"WP {phrase!r} at {shows(now.timestamp())}\n"
                    f"     got: {shows(got)}\n    want: {shows(want.timestamp())}"
                    + (f"\n     {why}" if why else ""))


# A Wednesday, mid-morning, in ordinary time.
WED = at(2026, 9, 16, 10, 0)

# ── WP.0  CONTROL: DST, in both directions ─────────────────────────────────────────────
# US/Eastern springs forward 2026-03-08 and falls back 2026-11-01.
SPRING_BEFORE = at(2026, 3, 6, 10, 0)       # Friday before the clocks go forward
case("Monday at 9am", SPRING_BEFORE, at(2026, 3, 9, 9, 0),
     "the Monday AFTER the clocks go forward: 9 am is still 9 am on the wall")
FALL_BEFORE = at(2026, 10, 30, 10, 0)       # Friday before the clocks go back
case("Monday at 9am", FALL_BEFORE, at(2026, 11, 2, 9, 0),
     "the Monday AFTER the clocks go back: still 9 am on the wall, a different UTC offset")

# ...and the control for the control: the two answers must have DIFFERENT utc offsets, or
# this suite would pass on an implementation that ignores zones entirely.
_spring = datetime.fromtimestamp(W.resolve("Monday at 9am", SPRING_BEFORE), EASTERN)
_fall = datetime.fromtimestamp(W.resolve("Monday at 9am", FALL_BEFORE), EASTERN)
ok(_spring.utcoffset() != _fall.utcoffset(),
   f"WP.0 CONTROL: the two Mondays really do sit on opposite sides of a DST change "
   f"({_spring.utcoffset()} vs {_fall.utcoffset()}) — if they did not, every check above "
   f"would pass on an implementation that does no zone arithmetic at all")
eq(_spring.hour, 9, "WP.0 nine in the morning, in March")
eq(_fall.hour, 9, "WP.0 and nine in the morning, in November")

# A WEEK THAT ACTUALLY STRADDLES THE CHANGE. The first version of this used 1 November as
# its reference — which is AFTER that morning's 2 am fall-back, so both ends were EST and
# nothing was being crossed. The control could not fire, which is the "fixture that cannot
# fail" class landing on the single most important check in this file. 28 October is EDT
# and a week later is EST.
case("in a week", at(2026, 10, 28, 9, 0), at(2026, 11, 4, 9, 0),
     "a week later is the same wall-clock hour, not an hour adrift — epoch arithmetic "
     "(`now + 7*86400`) gives 8 am here, which is how a standing meeting drifts")
_a = datetime.fromtimestamp(W.resolve("in a week", at(2026, 10, 28, 9, 0)), EASTERN)
ok(_a.utcoffset() != at(2026, 10, 28, 9, 0).utcoffset(),
   f"WP.0 CONTROL: the two ends really are on opposite sides of the change "
   f"({at(2026, 10, 28, 9, 0).utcoffset()} -> {_a.utcoffset()}) — without that, adding "
   f"604800 seconds gives the right answer and this check proves nothing")
case("in 2 weeks at 2pm", at(2026, 10, 28, 9, 0), at(2026, 11, 11, 14, 0),
     "and two weeks, same story")
case("in 3 days", at(2026, 10, 31, 9, 0), at(2026, 11, 3, 9, 0),
     "days across the change too — `+3*86400` lands at 8 am")

# ── WP.1  weekdays ─────────────────────────────────────────────────────────────────────
case("Tuesday", WED, at(2026, 9, 22, 9, 0), "a bare weekday is the NEXT one")
case("next Tuesday at 3", WED, at(2026, 9, 22, 15, 0))
case("Thursday at 2pm", WED, at(2026, 9, 17, 14, 0), "tomorrow, this week")
case("friday morning", WED, at(2026, 9, 18, 9, 0))
case("sat at 11am", WED, at(2026, 9, 19, 11, 0))
case("this Friday at noon", WED, at(2026, 9, 18, 12, 0))
# said ON the day it names
case("Wednesday at 4pm", WED, at(2026, 9, 23, 16, 0),
     "a bare weekday NEVER means today — 'Wednesday' said on Wednesday is next week")
case("next Wednesday", WED, at(2026, 9, 23, 9, 0))

# ── WP.2  today, tomorrow, tonight ─────────────────────────────────────────────────────
case("tomorrow at 9", WED, at(2026, 9, 17, 9, 0))
case("tomorrow at 9am", WED, at(2026, 9, 17, 9, 0))
case("tomorrow morning", WED, at(2026, 9, 17, 9, 0))
case("tomorrow afternoon", WED, at(2026, 9, 17, 14, 0))
case("tonight", WED, at(2026, 9, 16, 18, 0), "tonight is the evening, not 9 am")
case("today at 3", WED, at(2026, 9, 16, 15, 0))
case("this evening", WED, at(2026, 9, 16, 18, 0))

# TOMORROW SAID AT 11 PM — the plan names this one explicitly.
LATE = at(2026, 9, 16, 23, 0)
case("tomorrow at 9am", LATE, at(2026, 9, 17, 9, 0),
     "said at 11 pm, tomorrow is still the 17th — not 'in nine hours', which would be right "
     "by accident here and wrong at 1 am")
case("tomorrow morning", LATE, at(2026, 9, 17, 9, 0))

# ── WP.3  relative ─────────────────────────────────────────────────────────────────────
case("in 20 minutes", WED, WED + timedelta(minutes=20))
case("in an hour", WED, WED + timedelta(hours=1))
case("in 2 hours", WED, WED + timedelta(hours=2))
case("in 3 days", WED, at(2026, 9, 19, 9, 0), "a day out defaults to the morning")
case("in a week", WED, at(2026, 9, 23, 9, 0))
case("in 2 weeks at 2pm", WED, at(2026, 9, 30, 14, 0))

# ── WP.4  month ends, which is where naive arithmetic breaks ───────────────────────────
JAN31 = at(2026, 1, 31, 10, 0)
case("in a month", JAN31, at(2026, 2, 28, 9, 0),
     "a month from 31 January is 28 February — rolling over into March puts a reminder in "
     "the wrong month entirely")
case("in a month", at(2026, 3, 31, 10, 0), at(2026, 4, 30, 9, 0))
case("in 2 months", at(2026, 12, 31, 10, 0), at(2027, 2, 28, 9, 0),
     "and it crosses the year")
case("in a month", at(2028, 1, 31, 10, 0), at(2028, 2, 29, 9, 0), "a leap February")

# ── WP.5  calendar dates ───────────────────────────────────────────────────────────────
case("March 3", WED, at(2027, 3, 3, 9, 0), "March has passed this year, so next year")
case("December 1 at 10am", WED, at(2026, 12, 1, 10, 0))
case("dec 25", WED, at(2026, 12, 25, 9, 0))
case("the 17th", WED, at(2026, 9, 17, 9, 0), "tomorrow, this month")
case("the 3rd", WED, at(2026, 10, 3, 9, 0), "already gone this month, so next")

# ── WP.6  a clock with no day ──────────────────────────────────────────────────────────
case("at 3", WED, at(2026, 9, 16, 15, 0), "later today")
case("at 9", WED, at(2026, 9, 16, 21, 0),
     "9 with no meridiem, said at 10 am, is TONIGHT — the next 9 to come round. Reading it "
     "as 9 am both times is wrong once a day, every day")
case("at 9", at(2026, 9, 16, 22, 0), at(2026, 9, 17, 9, 0),
     "and the same words at 10 pm are tomorrow morning, for the same reason")
case("Monday at 9", WED, at(2026, 9, 21, 9, 0),
     "but with a DAY named there is no 'next' to choose from, so a bare hour reads at face "
     "value — which is what someone naming a weekday means")
case("at 9am", WED, at(2026, 9, 17, 9, 0), "9 am has gone; the next one is tomorrow")
case("at 8:30am", WED, at(2026, 9, 17, 8, 30))
case("at 3", at(2026, 9, 16, 16, 0), at(2026, 9, 17, 15, 0),
     "said at 4 pm, 'at 3' is tomorrow — never three hours ago")

# "at 3" MEANS THE AFTERNOON.
for phrase, hour in (("at 1", 13), ("at 2", 14), ("at 3", 15), ("at 4", 16),
                     ("at 5", 17), ("at 6", 18)):
    got = W.resolve(phrase, at(2026, 9, 16, 8, 0))
    eq(datetime.fromtimestamp(got, EASTERN).hour, hour,
       f"WP.6 {phrase!r} is the afternoon — said out loud by someone planning a day, "
       f"3 am is never what they meant")
for phrase, hour in (("at 7", 7), ("at 8", 8), ("at 10", 10), ("at 11", 11)):
    got = W.resolve(phrase, at(2026, 9, 16, 5, 0))
    eq(datetime.fromtimestamp(got, EASTERN).hour, hour,
       f"WP.6 but {phrase!r} is taken at face value — the afternoon rule covers 1 to 6, "
       f"where it is unambiguous, and stops there")

# ── WP.7  it refuses to guess ──────────────────────────────────────────────────────────
for junk in ("", "   ", "something entirely different", "the meeting", "later",
             "at 99", "at 25:00", "soon", None):
    eq(W.resolve(junk, WED), None,
       f"WP.7 {junk!r} resolves to nothing — an event silently booked TODAY instead of when "
       f"it was meant is worse than one that was not booked and said so")

# a number that is not a time must not become one
case("in 3 days", WED, at(2026, 9, 19, 9, 0), "'3 days' is not 3 o'clock")
case("March 3", WED, at(2027, 3, 3, 9, 0), "'March 3' is not 3 o'clock either")

# ── WP.8  the spoken confirmation ──────────────────────────────────────────────────────
eq(W.describe(W.resolve("today at 3", WED), WED), "today at 3 pm", "WP.8 today")
eq(W.describe(W.resolve("tomorrow at 9am", WED), WED), "tomorrow at 9 am", "WP.8 tomorrow")
eq(W.describe(W.resolve("Friday at 2pm", WED), WED), "Friday at 2 pm", "WP.8 this week")
ok("3 March" in W.describe(W.resolve("March 3", WED), WED),
   f"WP.8 further out, the date is said: {W.describe(W.resolve('March 3', WED), WED)!r}")
eq(W.describe(None), "(no time)", "WP.8 and nothing is not a time")

# ── WP.9  purity ───────────────────────────────────────────────────────────────────────
a1 = W.resolve("next Tuesday at 3", WED)
a2 = W.resolve("next Tuesday at 3", WED)
eq(a1, a2, "WP.9 the same phrase and the same reference give the same instant, always")
ok(W.resolve("next Tuesday at 3", WED) != W.resolve("next Tuesday at 3", WED + timedelta(days=7)),
   "WP.9 CONTROL: and a different reference gives a different one — otherwise `now` is "
   "being ignored and every check above is measuring a constant")

_src = (__import__("pathlib").Path(__file__).resolve().parent/"whenparse.py").read_text()
for banned in ("seatbroker", "urlopen", "requests", "subprocess"):
    ok(banned not in _src,
       f"WP.9 it asks nothing and spends nothing ({banned!r} absent) — this is the row "
       f"where a model call would be both slower and wrong")

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print("✓ whenparse: 10 groups green (WP.0 control: the same 9 am on both sides of a DST change)")
