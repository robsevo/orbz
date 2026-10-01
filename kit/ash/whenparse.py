#!/usr/bin/env python3
""""next Tuesday at 3" -> an exact instant. In code, never in a model (PLAN C1.5).

This is a parsing problem with a CORRECT ANSWER, and a model that is 98% right about the
hour books 2% of meetings at the wrong time. The plan's target for this row is 100%, and
that is only reachable by computing it.

Everything here is pure: it takes a phrase and a reference instant, and returns a resolved
instant. No clock is read except through `now`, so every case is reproducible and DST is
testable rather than hoped for.

WHAT IT REFUSES TO GUESS. An unparseable phrase returns None. It does not fall back to
"today", because an event silently booked today instead of next Tuesday is worse than one
that was not booked at all and said so.

TIMEZONE. Resolution happens in the LOCAL zone — the one the person lives in — and the
answer is a UTC instant. Doing the arithmetic in UTC is what puts an 09:00 meeting at 10:00
the week the clocks go back.
"""
import re
from datetime import datetime, time as _time, timedelta
from zoneinfo import ZoneInfo

ZONE = ZoneInfo(__import__("os").environ.get("ORBS_TZ") or "US/Eastern")

WEEKDAYS = {"monday": 0, "mon": 0, "tuesday": 1, "tue": 1, "tues": 1, "wednesday": 2,
            "wed": 2, "thursday": 3, "thu": 3, "thurs": 3, "friday": 4, "fri": 4,
            "saturday": 5, "sat": 5, "sunday": 6, "sun": 6}

MONTHS = {m: i + 1 for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"])}
MONTHS.update({m[:3]: i + 1 for i, m in enumerate(MONTHS)})

# Words that name a time of day when no clock time is given. Deliberately few: a guess
# dressed up as a default is still a guess, and these are the ones with one obvious meaning.
DAYPARTS = {"morning": _time(9, 0), "afternoon": _time(14, 0), "evening": _time(18, 0),
            "night": _time(20, 0), "noon": _time(12, 0), "midday": _time(12, 0),
            "midnight": _time(0, 0)}

_TIME = re.compile(
    r"\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b", re.I)
# SPOKEN NUMBERS (D323). Speech-to-text writes small numbers as WORDS — "remind me in two
# minutes" — and this only knew digits, so the most ordinary reminder resolved to nothing.
_NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
              "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15,
              "twenty": 20, "thirty": 30, "forty": 40, "forty-five": 45, "forty five": 45}
_IN_N = re.compile(r"\bin\s+(\d+|a|an|" + "|".join(sorted(map(re.escape, _NUM_WORDS), key=len, reverse=True))
                   + r")\s+(minute|hour|day|week|month)s?\b", re.I)
_HALF_HOUR = re.compile(r"\bin\s+half\s+an?\s+hour\b", re.I)
_ON_THE = re.compile(r"\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b", re.I)
_MONTH_DAY = re.compile(
    r"\b(" + "|".join(sorted(MONTHS, key=len, reverse=True)) + r")\s+(\d{1,2})(?:st|nd|rd|th)?\b",
    re.I)


def _local(now=None):
    if now is None:
        return datetime.now(ZONE)
    if isinstance(now, (int, float)):
        return datetime.fromtimestamp(now, ZONE)
    return now.astimezone(ZONE) if now.tzinfo else now.replace(tzinfo=ZONE)


def _at(day, t):
    """Attach a wall-clock time to a date IN THE LOCAL ZONE.

    Built with `replace` on an aware datetime so the zone recomputes its offset for that
    date. Adding a timedelta to an aware datetime does NOT do this — that is the bug that
    moves a 9 am meeting to 10 am across a DST boundary.
    """
    return day.replace(hour=t.hour, minute=t.minute, second=0, microsecond=0)


def _clock(text):
    """(hour, minute, meridiem_known) for an explicit clock time, or None.

    `meridiem_known` is False for a bare number — "at 9" — and the CALLER resolves it
    against the reference, because which 9 a person means depends entirely on when they
    said it.
    """
    for m in _TIME.finditer(text):
        hour, minute, ampm = int(m.group(1)), int(m.group(2) or 0), (m.group(3) or "").lower()
        if not ampm and m.group(2) is None:
            # A bare number is a time only when the phrase said "at". "in 3 days" and
            # "March 3" are not 3 o'clock, and reading them as one is how a to-do lands at
            # three in the morning.
            if not re.search(r"\bat\s+" + re.escape(m.group(1)) + r"\b", text, re.I):
                continue
        if hour > 23 or minute > 59:
            continue
        if ampm.startswith("p"):
            return (hour + 12 if hour < 12 else hour), minute, True
        if ampm.startswith("a"):
            return (0 if hour == 12 else hour), minute, True
        return hour, minute, (hour == 0 or hour > 12)
    return None


def _pick_meridiem(hour, minute, ref, has_day):
    """Which 9 did they mean?

    Two rules, and both are about what a person planning a day actually says out loud:

      * **1 to 6 is the afternoon.** Nobody says "at 3" meaning 3 am. This holds whether or
        not a day was named, because "Tuesday at 3" is not 3 in the morning either.
      * **7 to 12 is whichever comes next.** "At 9" said at 10 am is tonight; the same words
        at 10 pm are tomorrow morning. Taking it as 9 am both times is wrong once a day.

    With a DAY named ("Monday at 9") there is no "next" to choose from, so a bare hour is
    read at face value — which is what someone naming a weekday means.
    """
    if 1 <= hour <= 6:
        return _time(hour + 12, minute)
    if has_day or hour == 0 or hour > 12:
        return _time(hour, minute)
    am = _time(hour if hour != 12 else 12, minute)
    pm = _time((hour + 12) if hour != 12 else 0, minute)
    today_am, today_pm = _at(ref, am), _at(ref, pm)
    # The soonest of the two that has not already gone.
    future = sorted(c for c in (today_am, today_pm) if c > ref)
    if future:
        return _time(future[0].hour, future[0].minute)
    return am


def resolve(text, now=None, default_time=_time(9, 0)):
    """The instant `text` names, as epoch seconds, or None.

    `now` may be epoch seconds or a datetime; None means the real clock.
    """
    if not text or not str(text).strip():
        return None
    s = str(text).strip().lower()
    ref = _local(now)
    parsed = _clock(s)

    # "in 20 minutes" / "in an hour" — relative to NOW, so the clock time is ignored.
    if _HALF_HOUR.search(s):
        return int((ref + timedelta(minutes=30)).timestamp())
    m = _IN_N.search(s)
    if m:
        g = m.group(1).lower()
        n = 1 if g in ("a", "an") else _NUM_WORDS.get(g) or int(g)
        unit = m.group(2).lower()
        clock = _time(parsed[0], parsed[1]) if parsed else None
        if unit == "minute":
            return int((ref + timedelta(minutes=n)).timestamp())
        if unit == "hour":
            return int((ref + timedelta(hours=n)).timestamp())
        if unit == "day":
            day = ref + timedelta(days=n)
        elif unit == "week":
            day = ref + timedelta(weeks=n)
        else:
            day = _add_months(ref, n)
        return int(_at(day, clock or default_time).timestamp())

    part = next((p for p in DAYPARTS if re.search(rf"\b{p}\b", s)), None)
    day = None
    if re.search(r"\btomorrow\b", s):
        day = ref + timedelta(days=1)
    elif re.search(r"\btoday\b|\btonight\b", s):
        day = ref
    elif re.search(r"\byesterday\b", s):
        day = ref - timedelta(days=1)
    else:
        day = _weekday(s, ref) or _calendar_date(s, ref)

    # The meridiem is decided ONCE the day is known: a bare hour with a weekday attached
    # reads at face value, and one on its own picks whichever comes round next.
    if parsed:
        h, mi, known = parsed
        when = _time(h, mi) if known else _pick_meridiem(h, mi, ref, day is not None)
    else:
        when = DAYPARTS[part] if part else None

    if day is None:
        # A time with no day is the NEXT time that clock comes round — "at 3" said at 4pm
        # means tomorrow, not three hours ago.
        if when is None:
            return None
        candidate = _at(ref, when)
        if candidate <= ref:
            candidate = _at(ref + timedelta(days=1), when)
        return int(candidate.timestamp())

    if when is None:
        # "tonight" with no hour is the evening, not 9 am.
        when = DAYPARTS["evening"] if "tonight" in s else default_time
    return int(_at(day, when).timestamp())


def _weekday(s, ref):
    """"next Tuesday", "this Friday", "Monday" — the date, without a time."""
    m = re.search(r"\b(next|this|coming)?\s*(" + "|".join(WEEKDAYS) + r")\b", s)
    if not m:
        return None
    which, name = (m.group(1) or "").strip(), m.group(2)
    target = WEEKDAYS[name]
    ahead = (target - ref.weekday()) % 7
    if which == "next":
        # "next Tuesday" said ON a Tuesday means the one after this one, and said on a
        # Monday means tomorrow-but-one. Seven days on from the soonest match is the
        # reading people actually mean when they say "next".
        ahead = ahead + 7 if ahead == 0 else ahead
        if ref.weekday() > target:
            pass                      # already next week's
    elif ahead == 0:
        ahead = 7                     # a bare weekday name never means today
    return ref + timedelta(days=ahead)


def _calendar_date(s, ref):
    """"March 3", "the 17th"."""
    m = _MONTH_DAY.search(s)
    if m:
        month, dom = MONTHS[m.group(1).lower()], int(m.group(2))
        year = ref.year
        try:
            cand = ref.replace(year=year, month=month, day=dom)
        except ValueError:
            return None
        if cand.date() < ref.date():
            try:
                cand = cand.replace(year=year + 1)
            except ValueError:
                return None
        return cand
    m = _ON_THE.search(s)
    if m:
        dom = int(m.group(1))
        if not 1 <= dom <= 31:
            return None
        try:
            cand = ref.replace(day=dom)
        except ValueError:
            return None
        if cand.date() < ref.date():
            cand = _add_months(ref.replace(day=1), 1)
            try:
                cand = cand.replace(day=dom)
            except ValueError:
                return None
        return cand
    return None


def _add_months(d, n):
    """Month arithmetic that survives the 31st. "In a month" from 31 January is 28
    February, not 3 March — rolling over is how a reminder lands in the wrong month."""
    month = d.month - 1 + n
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, _days_in(year, month))
    return d.replace(year=year, month=month, day=day)


def _days_in(year, month):
    if month == 12:
        return 31
    return (datetime(year, month + 1, 1) - timedelta(days=1)).day


def describe(epoch, now=None):
    """How a person would say it back, for a spoken confirmation."""
    if epoch is None:
        return "(no time)"
    d = _local(epoch)
    ref = _local(now)
    when = d.strftime("%-I:%M %p").replace(":00", "").lower()
    if d.date() == ref.date():
        return f"today at {when}"
    if d.date() == (ref + timedelta(days=1)).date():
        return f"tomorrow at {when}"
    if (d.date() - ref.date()).days < 7:
        return f"{d.strftime('%A')} at {when}"
    return f"{d.strftime('%A %-d %B')} at {when}"


if __name__ == "__main__":
    import sys
    import time as _t
    for phrase in sys.argv[1:]:
        got = resolve(phrase)
        print(f"  {phrase!r:38} -> "
              + (_t.strftime('%a %d %b %Y %H:%M %Z', _t.localtime(got)) if got else "(could not tell)")
              + (f"   [{describe(got)}]" if got else ""))
