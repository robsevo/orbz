#!/usr/bin/env python3
"""The day, answered out loud (PLAN C2.1–C2.3, C2.5).

`day_verbs` decides WHICH verb, `whenparse` decides WHEN, `eds` does it. This is the layer
that turns those three into something a person hears — and it is where the product test
lives: **an assistant that silently edits your calendar has failed it.** Every write here
says what it did, names the calendar it went into, and is visible in `gnome-calendar` a
second later.

Three rules the shape follows:

  * **Reading never asks, writing always confirms.** "What's my day" is free and changes
    nothing. Booking something says it back with the resolved time first — because the one
    failure that matters here is a meeting at the wrong hour, and the person can catch that
    in the half-second before they say yes.
  * **A clash is named, not avoided.** Booking over something existing is legitimate — it is
    also the thing you most want to be told about.
  * **It never invents a time.** An unresolvable phrase is a question back, never a guess:
    an event silently booked today instead of next Tuesday is worse than one not booked.

Returns `(say, did)` — the sentence to speak, and what changed (None for a read). Nothing
here speaks or asks on its own; `ashd` owns the voice and the approval channel.
"""
import json
import os
import threading
import time
from pathlib import Path

import day_verbs
import eds
import whenparse
import statepaths  # noqa: E402 — PLAN 5.9: one root, and ASH_STATE_HOME moves it

# How long a booked thing is when nobody says. An hour is what a calendar defaults to and
# what people mean by "lunch with Sam at 1".
DEFAULT_MINUTES = 60
# A clash is anything overlapping the new event. Reported, never refused.
CLASH_WINDOW_DAYS = 120
# Finding something BY NAME to cancel is a different question from finding a clash, and it
# wants a longer horizon: nobody books a clash four months out, but "cancel the dentist"
# when the dentist is in five months is an ordinary thing to say. Keeping one window for
# both meant a cancel that could not find an event the person could see in their calendar.
SEARCH_WINDOW_DAYS = 400

# ── travel and prep buffers (PLAN C2.3) ────────────────────────────────────────────────
# A clash is an overlap. A TIGHT GAP is not an overlap and is the same problem: a thing that
# ends at two and a thing that starts at two past two do not clash, and you will still be
# late for the second one. The calendar is happy and the person is not, which is exactly the
# class of thing worth saying out loud before they say yes.
#
# NAMED, NEVER REFUSED — the same ruling `clashes` already carries, and for the same reason.
# Back-to-back is a legitimate way to spend a day; being told "that's five minutes after your
# dentist" is the useful half. Refusing it would make him wrong about somebody's own calendar.
#
# TWO BUFFERS, BECAUSE THEY ARE DIFFERENT QUESTIONS. Prep is the time to finish one thing and
# be ready for the next, and it applies to everything. Travel is the time to get somewhere
# else, and it only applies when there IS somewhere else — so it needs a location, and an
# event without one gets the prep buffer alone rather than a guess.
PREP_BUFFER_MINUTES = 10
TRAVEL_BUFFER_MINUTES = 30


def _loc(row):
    return str(row.get("location") or "").strip().lower()


def _needed_gap(a, b):
    """Seconds of room these two want between them, and why — ("prep"|"travel", seconds).

    Travel only when both carry a location AND the locations differ. Neither guessing that a
    missing location means "somewhere else" nor assuming it means "same place" is safe, so
    the rule is the narrow one: travel time is claimed only when the calendar actually says
    the place changes.
    """
    la, lb = _loc(a), _loc(b)
    if la and lb and la != lb:
        return "travel", TRAVEL_BUFFER_MINUTES * 60
    return "prep", PREP_BUFFER_MINUTES * 60


def tight(start, end, rows=None, location=""):
    """[(row, kind, gap_seconds)] for events that do not overlap but leave too little room.

    `rows` is injectable so this is testable without a calendar — the buffer arithmetic is
    the part worth proving, and it has nothing to do with EDS being reachable.

    `location` is where the NEW thing is, and it is now filled from speech:
    `day_verbs.split_place` lifts "at the cafe" out of a booking phrase, so the travel branch
    is reachable from the spoken path. It was not, for two days (D218) — the buffer was built,
    proven through this parameter, and every real caller passed "". A seam somebody can see is
    why that was findable at all; it is still the reason this is a parameter and not a lookup.
    """
    new = {"start": start, "end": end, "location": location}
    out = []
    for r in (rows if rows is not None else events_in_window()):
        s, e = r.get("start"), r.get("end") or (r.get("start") or 0) + DEFAULT_MINUTES * 60
        if s is None:
            continue
        # ONE GUARD, AND IT ALSO COVERS OVERLAPS. There was an explicit
        # `if s < end and e > start: continue` above this, on the reasoning that an overlap
        # is a CLASH and `clashes` is what says so. It was unreachable: an overlapping event
        # has `e > start` by definition, so `start - e` is always negative and the line below
        # had already skipped it. A plant that deleted it changed no behaviour and turned no
        # check red — the same shape as D215, found the same way, an hour apart.
        #
        # Kept as one guard with the reasoning written down rather than two where only one
        # fires: a negative gap means the two things touch or overlap, and either way this is
        # not the function that has something to say about it.
        gap = (s - end) if s >= end else (start - e)
        if gap < 0:
            continue
        kind, needed = _needed_gap(r, new) if s >= end else _needed_gap(new, r)
        if gap < needed:
            out.append((r, kind, gap))
    return out


def events_in_window():
    return eds.events(CLASH_WINDOW_DAYS)


def _gap_words(seconds):
    m = int(round(seconds / 60))
    if m <= 0:
        return "back to back with"
    return f"{m} minute{'s' if m != 1 else ''} after" if m < 60 else "an hour after"


def _clock(epoch):
    return time.strftime("%-I:%M", time.localtime(epoch)).replace(":00", "") \
        + time.strftime(" %p", time.localtime(epoch)).lower()


def _spoken_list(rows, limit=3):
    """Events as prose. 11.7: lists become prose, and no line ends on a bare ordinal."""
    if not rows:
        return ""
    bits = [f"{r['summary']} at {_clock(r['start'])}" if r.get("start") and not r.get("all_day")
            else f"{r['summary']}" for r in rows[:limit]]
    more = len(rows) - len(bits)
    if len(bits) == 1:
        out = bits[0]
    else:
        out = ", ".join(bits[:-1]) + f" and {bits[-1]}"
    return out + (f", and {more} more" if more > 0 else "")


def _same_day(a, b):
    return time.localtime(a)[:3] == time.localtime(b)[:3]


# SAID THE WAY A PERSON SAYS IT (D322). "1 thing Wednesday: …" was heard on 2026-09-22 — a digit
# where a word belongs and no "on" before the day, while "Nothing on Wednesday." already had one.
_NUM_WORDS = ("No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten")


def _things(n):
    word = _NUM_WORDS[n] if 0 <= n < len(_NUM_WORDS) else str(n)
    return f"{word} thing{'' if n == 1 else 's'}"


def agenda(when_phrase="", now=None, with_list=True):
    """What is on. The one a person asks every morning, and it costs nothing.

    WITH THE LIST (2026-09-27, take 7): "what's my day?" said "Nothing on today." a minute after
    "remind me in 20 minutes to stand up and stretch" had put exactly that on today's list. A day
    is its calendar AND what is due on it. `brief()` says the list itself, so it asks without."""
    target = whenparse.resolve(when_phrase, now) if when_phrase else None
    day = target or (now if isinstance(now, (int, float)) else time.time())
    rows = eds.events(9)
    todays = [r for r in rows if r.get("start") and _same_day(r["start"], day)]
    label = "today"
    if target and not _same_day(day, time.time()):
        label = time.strftime("%A", time.localtime(day))
    when = label if label == "today" else f"on {label}"
    due = []
    if with_list:
        try:
            due = sorted((t for t in eds.todos() if t.get("due") and _same_day(t["due"], day)),
                         key=lambda t: t["due"])
        except eds.Unavailable:
            due = []
    # said like the events are: a timed one "at 5:59 pm", a date-only one by its name
    on_list = _spoken_list([{"summary": t["summary"], "start": t["due"],
                             "all_day": time.localtime(t["due"])[3:5] == (0, 0)} for t in due])
    if not todays:
        if due:
            return f"Nothing on the calendar {when}, but your list has {on_list}.", None
        return f"Nothing on {label}.", None
    said = f"{_things(len(todays))} {when}: {_spoken_list(todays)}."
    if due:
        said += f" And on your list: {on_list}."
    return said, None


def next_up(now=None):
    ref = now if isinstance(now, (int, float)) else time.time()
    rows = [r for r in eds.events(30) if r.get("start") and r["start"] > ref]
    if not rows:
        return "Nothing coming up.", None
    r = rows[0]
    when = whenparse.describe(r["start"], now)
    return f"{r['summary']}, {when}.", None


def free(when_phrase, now=None):
    """Am I free X. A question, so it answers with what is in the way rather than yes/no —
    "you have the dentist at 2" is the useful half of "no"."""
    target = whenparse.resolve(when_phrase, now)
    if target is None:
        return f"I couldn't work out when you mean by {when_phrase!r}.", None
    rows = [r for r in eds.events(60)
            if r.get("start") and _same_day(r["start"], target)]
    clash = [r for r in rows
             if r["start"] <= target < (r.get("end") or r["start"] + 3600)]
    if clash:
        return f"No — {_spoken_list(clash)}.", None
    if rows:
        return f"Yes, though you have {_spoken_list(rows)} that day.", None
    return f"Yes, nothing on {whenparse.describe(target, now)[:-len(' at ' + _clock(target))] or 'then'}.", None


def clashes(start, end):
    """Everything overlapping [start, end). Named, never used to refuse."""
    out = []
    for r in events_in_window():
        s, e = r.get("start"), r.get("end") or (r.get("start") or 0) + 3600
        if s is None:
            continue
        if s < end and e > start:
            out.append(r)
    return out


# ── the panel (PLAN C2.4) ───────────────────────────────────────────────────────────────
# The orb's renderers never read a file and never spawn a process, so the daemon puts the
# day where the shell can pick it up. Same contract as `wake-state.json` and `pair-state`:
# one writer, atomic replace, and the shell polls.
PANEL_STATE = statepaths.config()/"day-state.json"
# How far ahead "next" may look. Today's rows come out of the same read, so one window
# serves both — a second EDS call to answer a question the first one already contains is a
# child process spawned for nothing.
PANEL_WINDOW_DAYS = 14
PANEL_ROWS = 5


def panel_state(now=None):
    """What the day panel shows. A plain dict; nothing here writes or speaks.

    **`unavailable` is the point of the shape.** "Nothing on today" and "I cannot reach your
    calendar" are opposite answers, and a panel showing an empty list for both is the silent
    success C1.3 exists to forbid — worse on a screen than out loud, because a panel is
    glanced at rather than listened to and an empty day looks like good news.
    """
    ref = now if isinstance(now, (int, float)) else time.time()
    # FROM MIDNIGHT, not from now. The header says TODAY, so it has to count today — with
    # the reader starting at `now` it said "2 TODAY" on a day that had three things on it,
    # and the faded styling for a finished row was unreachable. D218's shape, and found the
    # same way D218 was: by looking at the live thing, not by any check.
    _mid = time.localtime(ref)
    since = int(time.mktime((_mid.tm_year, _mid.tm_mon, _mid.tm_mday, 0, 0, 0, 0, 0, -1)))
    try:
        rows = eds.events(PANEL_WINDOW_DAYS, since=since)
    except eds.Unavailable as e:
        return {"unavailable": True, "say": str(e), "today": [], "next": None}
    rows = [r for r in rows if r.get("start")]
    rows.sort(key=lambda r: r["start"])

    def slim(r):
        end = r.get("end") or r["start"] + DEFAULT_MINUTES * 60
        return {"summary": r.get("summary") or "", "start": r["start"], "end": end,
                "location": r.get("location") or "", "now": r["start"] <= ref < end}

    today = [slim(r) for r in rows if _same_day(r["start"], ref)]
    later = [slim(r) for r in rows if r["start"] > ref]
    return {"unavailable": False, "today": today[:PANEL_ROWS],
            "next": later[0] if later else None}


def write_panel_state(now=None):
    """Put `panel_state` where the shell can read it. Returns the state it wrote.

    A unique tmp per writer, for the reason recorded at `ashd.write_state`: a shared
    `*.json.tmp` let two concurrent writers rename each other's file out from under them.
    Pid alone is half a fix — two threads in one process share it (D65).
    """
    st = panel_state(now)
    st["t"] = time.time()
    tmp = PANEL_STATE.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        PANEL_STATE.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(json.dumps(st))
        os.replace(tmp, PANEL_STATE)
    except OSError:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
    return st


def preview_book(payload, now=None):
    """What booking this WOULD do, as a sentence to confirm. No write happens here.

    Separate from the write on purpose: `ashd` speaks this, waits for a yes through the
    trusted channel (3.10), and only then calls `book`. A confirmation that is generated by
    the same call that performs the action is not a confirmation.
    """
    # WHERE FIRST, then what and when. It has to come out before the title/time split, not
    # after: "at" introduces both a place and a time, so "lunch at the cafe tomorrow at 1"
    # would otherwise leave "the cafe" inside the phrase handed to `whenparse`. It resolved
    # correctly there by luck — `whenparse` ignores what it does not recognise — and the
    # place was simply thrown away, which is why the travel buffer could never fire (D218).
    rest, place = day_verbs.split_place(payload)
    title, when_phrase = day_verbs.split_title(rest)
    if not title:
        return None, "I need something to call it."
    if not when_phrase:
        return None, f"When would you like {title}?"
    start = whenparse.resolve(when_phrase, now)
    if start is None:
        return None, f"I couldn't work out when you mean by {when_phrase!r}."
    end = start + DEFAULT_MINUTES * 60
    plan = {"title": title, "start": start, "end": end, "location": place}
    said = f"{title}, {whenparse.describe(start, now)}"
    if place:
        # SAID BACK, like the time. A place heard wrong is a place you drive to, and this
        # sentence is the half-second in which that is catchable.
        said += f", at {place}"
    over = clashes(start, end)
    if over:
        # NAMED, not refused. Double-booking is legitimate and it is also the thing you most
        # want to hear about before you say yes.
        said += f". That clashes with {_spoken_list(over)}"
    else:
        # ONLY WHEN THERE IS NO CLASH. "That clashes with the dentist, and it is also five
        # minutes after the dentist" is one fact said twice, and a confirmation people stop
        # listening to is a confirmation that has stopped working.
        close = tight(start, end, location=place)
        if close:
            row, kind, gap = close[0]
            word = "to get there from" if kind == "travel" else "after"
            said += (f". That's {_gap_words(gap).replace(' after', '')} "
                     f"{word} {row.get('summary') or 'something else'}")
    return plan, said + ". Shall I put it in?"


def book(plan, calendar=None):
    res = eds.add_event(plan["title"], plan["start"], plan["end"], calendar=calendar,
                        location=plan.get("location") or None)
    return (f"Done — {plan['title']}, {whenparse.describe(plan['start'])}, "
            f"in {res['calendar']}."), res


def preview_move(payload, now=None):
    """Which event, to when, and — if it recurs — WHICH occurrences. Never a guess.

    Returns (plan, sentence). A plan with `scope=None` means the question in the sentence has
    to be answered before `move` will do anything: a recurring event has two different right
    answers and picking one silently rewrites a series the person cannot see happening.

    Same refusal to guess as `preview_cancel`, and for a sharper reason. Cancelling the wrong
    meeting removes something; moving the wrong series moves fifty things, and the person
    finds out weeks later when they are in the wrong place.
    """
    title, when_phrase = day_verbs.split_title(payload)
    if not title:
        return None, "Move what?"
    if not when_phrase:
        return None, f"When should I move {title} to?"
    start = whenparse.resolve(when_phrase, now)
    if start is None:
        return None, f"I couldn't work out when you mean by {when_phrase!r}."
    want = title.strip().lower()
    rows = [r for r in eds.events(SEARCH_WINDOW_DAYS)
            if want in (r.get("summary") or "").lower()]
    if not rows:
        return None, f"I can't find anything called {title}."
    # GROUPED BY UID, for the reason `preview_cancel` records: since C2.1 expanded
    # recurrences a weekly standup is one row per occurrence, so counting rows asked *"There
    # are 3: standup at 3pm, standup at 3pm and standup at 3pm. Which one?"* — three ways of
    # saying the same event, and a question with no answerable difference between the options.
    by_uid = {}
    for _r in rows:
        by_uid.setdefault(_r.get("uid"), []).append(_r)
    if len(by_uid) > 1:
        return None, (f"There are {len(by_uid)}: "
                      f"{_spoken_list([v[0] for v in by_uid.values()])}. Which one?")
    rows = sorted(rows, key=lambda x: x.get("start") or 0)
    r = rows[0]
    # THE LENGTH TRAVELS WITH IT. Moving a two-hour thing to three o'clock does not make it
    # an hour long, and silently shortening somebody's meeting is the kind of edit they only
    # discover by being interrupted.
    length = (r.get("end") or (r["start"] + DEFAULT_MINUTES * 60)) - r["start"]
    end = start + length
    plan = {"row": r, "start": start, "end": end, "scope": None}
    said = (f"{r['summary']}, {whenparse.describe(r['start'], now)} "
            f"to {whenparse.describe(start, now)}")

    # What it would land on. The same two sentences `preview_book` uses, for the same reason:
    # the clash is the thing you most want to hear before you say yes, and it is worth as
    # much when moving as when creating.
    over = [c for c in clashes(start, end) if c.get("uid") != r.get("uid")]
    if over:
        said += f". That clashes with {_spoken_list(over)}"
    else:
        close = [t for t in tight(start, end, location=r.get("location") or "")
                 if t[0].get("uid") != r.get("uid")]
        if close:
            row, kind, gap = close[0]
            word = "to get there from" if kind == "travel" else "after"
            said += (f". That's {_gap_words(gap).replace(' after', '')} "
                     f"{word} {row.get('summary') or 'something else'}")

    if r.get("recurring"):
        # ASKED, NOT GUESSED. `op_move_event` refuses a missing scope, so this is not a
        # politeness — there is no code path that moves a series without an answer.
        #
        # BOTH ANSWERS WORK NOW (C2.6, 2026-09-22), so both are offered. Until today this
        # asked for the series only and said the limitation out loud, because a detached
        # override was believed not to write — it did write, and `generate_instances_sync`
        # was not showing it. `scope` stays None so the question is a real one: a recurring
        # event has two different right answers and neither is a default, and picking one
        # silently rewrites a series the person cannot see happening.
        #
        # "Just this one" needs the occurrence's recurrence id, which is why the row is
        # carried through rather than the uid alone.
        plan["scope"] = None
        plan["recurrence_id"] = r.get("recurrence_id", "")
        return plan, said + (". That one repeats — just this one, or all of them?")
    # A one-off has one answer, and asking a question with one answer is noise. `ALL` and
    # `THIS` do the same thing here; that was measured for `remove` and holds for `modify`.
    plan["scope"] = "all"
    return plan, said + ". Shall I move it?"


def move(plan, scope=None):
    """Carry out a previewed move. `scope` overrides the plan's, which is how the answer to
    the recurring question gets in."""
    use = (scope or plan.get("scope") or "").lower()
    if use not in ("all", "this"):
        return "I need to know whether that's just the one or all of them.", None
    r = plan["row"]
    res = eds.move_event(r["uid"], plan["start"], plan["end"],
                         calendar=r.get("calendar"), scope=use,
                         recurrence_id=r.get("recurrence_id"),
                         recurrence_start=r.get("start"))
    which = "just that one" if use == "this" else "all of them"
    return (f"Moved — {r['summary']}, {whenparse.describe(plan['start'])}"
            + (f", {which}." if r.get("recurring") else ".")), res


def preview_cancel(title, now=None):
    """Which event `title` means, or a question. Never a guess: cancelling the wrong meeting
    is not something the person can see and undo."""
    want = (title or "").strip().lower()
    if not want:
        return None, "Cancel what?"
    rows = [r for r in eds.events(SEARCH_WINDOW_DAYS)
            if want in (r.get("summary") or "").lower()]
    if not rows:
        return None, f"I can't find anything called {title}."
    # GROUPED BY UID, because since C2.1 expanded recurrences a weekly standup arrives as one
    # row per occurrence. Counting rows made "cancel the standup" answer *"There are 4:
    # standup, standup and standup. Which one?"* — the same name three times, and a question
    # the person cannot answer because every option sounds identical. Four rows here are one
    # event, and the real question is a different one.
    by_uid = {}
    for r in rows:
        by_uid.setdefault(r.get("uid"), []).append(r)
    if len(by_uid) > 1:
        firsts = [v[0] for v in by_uid.values()]
        return None, f"There are {len(firsts)}: {_spoken_list(firsts)}. Which one?"
    occ = sorted(rows, key=lambda r: r.get("start") or 0)
    r = dict(occ[0])
    if r.get("recurring"):
        # ASKED, NOT GUESSED — and now both answers actually work. `cancel` refuses a missing
        # scope, so this is not politeness. It is the same fork `move` presents, with one
        # difference worth knowing: `move` can only offer the series, because moving a single
        # occurrence needs a detached override that does not write correctly (D220). Cancel
        # can do both, because removing one occurrence is an EXDATE and the API adds it
        # itself given the recurrence id (D230).
        # ASKED AS A YES/NO, and that is a constraint rather than a preference: `ask_yes_no`
        # is the only asking primitive the daemon has, so *"just this one, or all of them?"*
        # is a question it cannot take an answer to. Two yes/no questions, **narrowest
        # first** — a yes to the first does the smaller thing, and somebody who says yes
        # without listening loses one occurrence rather than a year of them.
        r["scope"] = "this"
        r["followup"] = ["All of them?", "all"]
        return r, (f"{r['summary']}, {whenparse.describe(r['start'])} — that one repeats, "
                   f"{len(occ)} times in the window. Cancel just that one?")
    r["scope"] = "all"
    return r, f"{r['summary']}, {whenparse.describe(r['start'])}. Cancel it?"


def cancel(row, scope=None):
    """Carry out a previewed cancel. `scope` overrides the row's, which is how the answer to
    the recurring question gets in."""
    use = (scope or row.get("scope") or ("all" if not row.get("recurring") else "")).lower()
    if row.get("recurring") and use not in ("all", "this"):
        return "I need to know whether that's just the one or all of them.", None
    if use == "this":
        eds.remove(row["uid"], kind="event", calendar=row.get("calendar"),
                   scope="this", recurrence_id=row.get("recurrence_id"))
        return (f"Cancelled — {row['summary']}, "
                f"{whenparse.describe(row['start'])}, just that one."), row
    eds.remove(row["uid"], kind="event", calendar=row.get("calendar"))
    return (f"Cancelled — {row['summary']}"
            + (", all of them." if row.get("recurring") else ".")), row


def todos():
    rows = eds.todos()
    if not rows:
        return "Nothing on your list.", None
    names = [r["summary"] for r in rows[:4]]
    more = len(rows) - len(names)
    out = ", ".join(names[:-1]) + f" and {names[-1]}" if len(names) > 1 else names[0]
    return f"{_things(len(rows))}: {out}" \
           + (f", and {more} more" if more > 0 else "") + ".", None


def add_todo(payload, now=None):
    title, when_phrase = day_verbs.split_title(payload)
    if not title:
        return None, "What should I put on the list?"
    due = whenparse.resolve(when_phrase, now) if when_phrase else None
    res = eds.add_todo(title, due=due)
    when = f", {whenparse.describe(due, now)}" if due else ""
    return f"On your list — {title}{when}.", res


# ── weather, for the brief (PLAN C2.5) ─────────────────────────────────────────────────
# THE DAEMON HAS NO NETWORK CLIENT AND MUST NOT GROW ONE. 13.1 put every external fetch
# behind `external()` in `main.js` — one allowlist, one timeout, one failure shape — and a
# second fetcher on this side would be a second unbounded surface reaching the internet,
# which is the thing that row exists to prevent. The orb writes `desk.json` every second;
# this reads it like any other file.
DESK = statepaths.config()/"desk.json"
# Three hours. A reading older than that is not today's weather, and saying it as if it were
# is the frozen-clock failure 13.2 names — one level up from the panel, in the file every
# consumer reads. Said with its age instead of thrown away, because "I last heard at six"
# is useful and silence is not.
WEATHER_STALE_S = 3 * 3600
_WMO_JS = Path(__file__).resolve().parent/"weather.2.js"


def _wmo(path=None):
    """`{code: words}`, PARSED from the panel's own table rather than retyped.

    There is one WMO table in this house and the panel owns it. A second copy here would
    disagree with the screen inside a month, and the person would hear one word and read
    another off the widget — the exact split CLAUDE.md §12's "derive, never retype" is
    about. Returns {} if the panel moves, and the caller says nothing rather than guessing.
    """
    import re
    try:
        src = (path or _WMO_JS).read_text()
    except OSError:
        return {}
    m = re.search(r"const WMO\s*=\s*\{(.*?)\};", src, re.S)
    if not m:
        return {}
    return {int(c): w for c, w in re.findall(r"(\d+)\s*:\s*\['([^']*)'", m.group(1))}


def weather(now=None, path=None):
    """One short clause about today's weather, or None when there is genuinely none.

    Never raises and never guesses. The four answers are different on purpose: no orb has
    ever written the key (None — say nothing), the provider failed (say so, and which), the
    reading is old (say it with its age), or it is current (say it).
    """
    now = now if isinstance(now, (int, float)) else time.time()
    try:
        desk = json.loads(DESK.read_text() if path is None else Path(path).read_text())
        w = desk.get("weather")
    except (OSError, ValueError, AttributeError):
        return None
    if not isinstance(w, dict):
        return None
    if w.get("unavailable"):
        who = w.get("provider") or "the weather provider"
        return f"I could not get the weather — {who} is not answering."
    cur, daily = w.get("current") or {}, w.get("daily") or {}
    temp = cur.get("temperature_2m")
    if temp is None:
        return None
    words = _wmo().get(cur.get("weather_code"), "")
    said = f"{round(temp)} degrees"
    if words:
        said += f" and {words.lower()}"
    highs = daily.get("temperature_2m_max") or []
    if highs and highs[0] is not None and round(highs[0]) - round(temp) >= 2:
        said += f", up to {round(highs[0])}"
    # AGE IS PART OF THE SENTENCE, not a reason to drop it. `at` is written by the orb on
    # every snapshot; a missing one is treated as old rather than as fresh, because the
    # failure that matters is reading a stale number as current.
    try:
        from datetime import datetime
        age = now - datetime.fromisoformat(
            str(w.get("at", "")).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        # UNKNOWN AGE IS NOT AN AGE. The first version substituted `WEATHER_STALE_S + 1`
        # here and then said "Weather is 3 hours old" — a specific number it did not have,
        # about a reading it could not date. An unreadable stamp is still not trusted as
        # current; it just does not get to invent how stale it is.
        return f"I do not know how old this reading is — it was {said}."
    if age > WEATHER_STALE_S:
        # ROUND, DO NOT TRUNCATE, and this is not a cosmetic choice. `int(age // 3600)` on a
        # five-hour-old reading returned **4**: the timestamp round-trips through ISO text
        # with microsecond precision, so `age` comes back as 17999.999999523 rather than
        # 18000, and floor division drops the whole hour. It depended on the microsecond
        # digit, so it was right about half the time — green on four full passes before it
        # showed up. Worse, truncation always errs the SAME way: it reports a reading as
        # FRESHER than it is, which is the one direction a staleness warning must never
        # round in.
        hrs = max(1, round(age / 3600))
        return f"Weather is {hrs} hour{'s' if hrs != 1 else ''} old — it was {said}."
    return f"It is {said}."


def brief(now=None):
    """The morning brief (C2.5): what is on, and what is still open. One paragraph, said
    once — not three notifications."""
    said_agenda, _ = agenda(now=now, with_list=False)
    said_todos, _ = todos()
    sky = weather(now=now)
    if said_agenda.startswith("Nothing on") and said_todos.startswith("Nothing on"):
        clear = "Your day is clear and your list is empty."
        return (f"{clear} {sky}" if sky else clear), None
    parts = [said_agenda, said_todos] + ([sky] if sky else [])
    return " ".join(parts), None


# ── promises (PLAN C3.5) ───────────────────────────────────────────────────────────────
# A promise the person made in passing — "I said I'd send that Tuesday" — is worth catching.
# It is RECORDED, and read back when asked. It is never turned into a to-do on its own: a task
# appearing in somebody's GNOME list that they did not ask for is precisely the "silently
# edits your things" failure the mandate names, and C6.3 says the same thing about
# preferences. Since 2026-09-23 it is also OFFERED, each time (`offer_promise`): the owner
# chose one question over a promise kept where nobody looks.
PROMISE_KIND = "artifact"


def note_promise(text, turn_id=""):
    """Record a promise if this utterance contains one. Returns it, or None. Never raises —
    a listener that can take a turn down is worse than one that misses something."""
    try:
        import runtime

        import adapters
        body = day_verbs.follow_up(text)
        if not body:
            return None
        j = adapters.journal()
        j.append(runtime.envelope(PROMISE_KIND, "ashd",
                                  {"kind": "promise", "text": body[:200],
                                   "said": str(text)[:300]}, turn_id=turn_id),
                 source="ashd")
        return body
    except Exception:
        return None


def offer_promise(text):
    """(question, payload) when this utterance holds a promise, else None (C3.5).

    THE OWNER'S DECISION, 2026-09-23: ASK EACH TIME. A caught promise is still recorded by
    `note_promise`; now it is also OFFERED — "want me to add that as a to-do?" — and nothing
    reaches the task list without a yes. That keeps the mandate's rule (nothing of theirs is
    edited silently) and ends the silent-only version, where a promise was kept somewhere the
    person would only find by asking. The question carries their OWN words, so they can tell
    what they are agreeing to. A no is not the end of the turn: "I need to rename the auth
    module" may be a job for Ash rather than a note to self, so the daemon carries on with it.
    """
    body = day_verbs.follow_up(text)
    if not body:
        return None
    return f"Want me to add that as a to-do — {body}?", {"todo": body}


def accept_promise(payload, now=None):
    """The yes: add exactly what was offered, through the one to-do writer. Returns (said, res)."""
    body = (payload or {}).get("todo")
    if not body:
        return "Left it.", None
    said, res = add_todo(body, now)
    # `add_todo` returns (None, question) when it finds no title; say the question, not None.
    return (said or res or "I couldn't tell what to put on the list."), (res if said else None)


def run_offer(text, ask, may_write=lambda: True, now=None):
    """The whole C3.5 exchange, with the daemon's own primitives passed in. Returns what to
    say when a to-do was added (or refused), or None to carry on with the turn as if nothing
    had been asked.

    `ask(question) -> bool` is `ask_yes_no`; `may_write() -> bool` is the one-way switch's
    calendar leg (3.8), asked only AFTER the yes — a turn that read a page may not write the
    task list on its strength, and asking that before the person has even said they want the
    to-do is a question about nothing. A NO CARRIES ON: the turn then goes exactly where it
    went before this question existed, so the offer can only ever add one question.
    """
    offer = offer_promise(text)
    if not offer:
        return None
    if not ask(offer[0]):
        return None
    if not may_write():
        return "I've read something from outside this turn, so I've left your list alone."
    said, _res = accept_promise(offer[1], now)
    return said


def promises(about="", limit=200):
    """What the person said they would do, newest first."""
    try:
        import adapters
        rows = adapters.journal().since(0, limit=limit)
    except Exception:
        return []
    want = (about or "").strip().lower()
    out = []
    for r in reversed(rows):
        if r.get("type") != PROMISE_KIND:
            continue
        p = r.get("payload") or {}
        if p.get("kind") != "promise":
            continue
        if want and want not in (p.get("text") or "").lower():
            continue
        out.append(p)
    return out


def say_promises(about=""):
    rows = promises(about)
    if not rows:
        return (f"I haven't heard you promise anything about {about}." if about
                else "Nothing I've heard you promise."), None
    names = [r["text"] for r in rows[:3]]
    out = ", ".join(names[:-1]) + f" and {names[-1]}" if len(names) > 1 else names[0]
    more = len(rows) - len(names)
    return (f"You said you'd {out}" + (f", and {more} more" if more > 0 else "") + ".",
            None)


def do_confirmed(payload, scope=None):
    """Carry out whatever `handle` returned as a "confirm". One door, so the daemon does not
    have to know which verb produced the payload.

    It used to decide by asking whether the payload had a "title", which worked while there
    were exactly two verbs and silently sent a move to `cancel` the moment there were three.
    """
    if not payload:
        return "Left it.", None
    if "title" in payload:
        return book(payload)
    if "row" in payload:                       # a move plan carries the event under "row"
        return move(payload, scope=scope)
    return cancel(payload, scope=scope)


def _from_intent(text, now=None):
    """`handle`'s fallback: ask the intent layer, and rebuild the phrase its verb expects.

    Returns the same (kind, say, payload) triple, so there is one shape and one confirm path
    — a second route into a calendar write is how two of them end up disagreeing about
    whether the user was asked.
    """
    try:
        import intent as _intent
        hit = _intent.classify(text, session_id="", turn_id="")
    except Exception:
        return None, "", None
    if not hit or hit.get("source") != "model":
        return None, "", None
    kind = hit["intent"]
    title, when, where = hit.get("title", ""), hit.get("when", ""), hit.get("where", "")
    if kind == "schedule" and title and when:
        # Rebuilt as a PHRASE rather than passed as fields, so the booking path parses it the
        # same way it parses everything else. One parser, not two that drift — and the place
        # goes back in the form `split_place` reads.
        phrase = f"{title}{' at ' + where if where else ''} {when}"
        plan, said = preview_book(phrase, now)
        return ("confirm" if plan else "say"), said, plan
    if kind == "move" and title and when:
        plan, said = preview_move(f"{title} {when}", now)
        return ("confirm" if plan else "say"), said, plan
    if kind == "cancel" and title:
        row, said = preview_cancel(title, now)
        return ("confirm" if row else "say"), said, row
    # `remind`, `capture`, `plan`, `find`, `review` and `summarize` are classified but not
    # routed from here yet. Saying so is the point: a branch that silently did nothing would
    # read as handled, and the model turn this returns to is a better answer than a guess.
    return None, "", None


def handle(text, now=None):
    """One utterance -> (kind, say, payload).

    `kind` is "say" for something to speak, "confirm" for something that needs a yes before
    it happens, or None when this is not a day verb at all and the model should have it.
    """
    m = day_verbs.match(text)
    if not m:
        # THE TYPED INTENT LAYER (C1.4), and only for sentences that look like the day. The
        # table is the front door and answers almost everything; this is the fallback for
        # phrasings it does not carry — "shift the thing with Priya back an hour".
        #
        # It can only produce a PREVIEW, never a write: everything below still returns
        # "confirm", and `ashd` still asks before anything reaches the calendar. So the worst
        # a wrong classification can do is ask a question, which is the right blast radius
        # for a model deciding what somebody meant.
        return _from_intent(text, now)
    verb, payload = m
    try:
        if verb == "agenda":
            if not payload and _wants_next(text):
                said, _ = next_up(now)
            else:
                said, _ = agenda(payload, now)
            return "say", said, None
        if verb == "todos":
            said, _ = todos()
            return "say", said, None
        if verb == "plan":
            # `payload` is the person's own word for how much they have. It changes how MUCH
            # is proposed, never what: somebody flat is not asking for a different list.
            import dayplan
            energy = next((w for w in ("low", "high") if w in (payload or "").lower()), None)
            said, _proposal = dayplan.plan(energy=energy)
            return "say", said, None
        if verb == "review":
            import dayplan
            said, _rep = dayplan.week()
            return "say", said, None
        if verb == "promises":
            said, _ = say_promises(payload)
            return "say", said, None
        if verb == "free":
            said, _ = free(payload, now)
            return "say", said, None
        if verb == "book":
            plan, said = preview_book(payload, now)
            return ("confirm" if plan else "say"), said, plan
        if verb == "move":
            # WIRED. `day_verbs` has matched "move" since C2.2 and `handle` had no branch for
            # it, so every "move the standup to four" fell through to the model — which is
            # the one outcome the deterministic verbs exist to avoid, and it looked like a
            # finished feature from every other angle.
            plan, said = preview_move(payload, now)
            return ("confirm" if plan else "say"), said, plan
        if verb == "cancel":
            row, said = preview_cancel(payload, now)
            return ("confirm" if row else "say"), said, row
        if verb == "todo":
            # A TO-DO DOES NOT ASK. It is reversible, it is low-stakes, and capture has to
            # be frictionless or nobody uses it (C3.3). It is not silent either: the reply
            # says what went on the list and when, which is the mandate's actual
            # requirement — anything he changes lands somewhere the person can open.
            said, res = add_todo(payload, now)
            return "say", said, res
    except eds.Unavailable as e:
        # C1.3 all the way up: he says he cannot reach it, rather than reporting an empty day.
        return "say", e.spoken(), None
    return None, "", None


def _wants_next(text):
    return "next" in (text or "").lower()
