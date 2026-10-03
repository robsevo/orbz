#!/usr/bin/env python3
"""A plan for the day, and an honest look back at the week (PLAN C4.1 / C4.2).

Built from FACTS, not from a model: what is fixed (the calendar), what is open (the to-do
list), and how much room is actually left between the two. A plan is arithmetic before it is
judgement, and the arithmetic is the part people get wrong — a day with five hours of
meetings and six hours of intentions is not a plan, it is a disappointment with a schedule.

So this says the number out loud. **"You have two hours between things and four hours of
list"** is more use than any ordering of the four.

WHAT IT REFUSES TO DO:

  * **It does not reschedule anything.** Nothing here writes. It proposes, out loud, and the
    person accepts or edits — C4.2's "nothing is silently rescheduled" is enforced by this
    module containing no write at all.
  * **It does not pretend the day fits.** When the list does not fit in the gaps it says so
    and offers the only honest options: drop something, or move it. **Drop is offered
    first**, because it is the one people never give themselves permission to take.

The week's look-back is the same shape: what was due and done, what slipped, and an explicit
invitation to let something go.
"""
import time

import eds
import whenparse

# A working day, local. Outside these hours nothing is proposed: a plan that fills your
# evening is one you stop asking for.
DAY_START_H = 9
DAY_END_H = 18
# Below this, a gap is not workable — it is the walk between two meetings.
MIN_GAP_MIN = 25
# What a to-do costs when nobody says. Deliberately generous: a plan that assumes everything
# takes fifteen minutes is the disappointment described above.
DEFAULT_TASK_MIN = 45


def _bounds(day_epoch):
    lt = time.localtime(day_epoch)
    start = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, DAY_START_H, 0, 0, 0, 0, -1))
    end = time.mktime((lt.tm_year, lt.tm_mon, lt.tm_mday, DAY_END_H, 0, 0, 0, 0, -1))
    return int(start), int(end)


def _same_day(a, b):
    return time.localtime(a)[:3] == time.localtime(b)[:3]


def gaps(day_epoch=None, events=None):
    """The workable stretches of a day. [(start, end, minutes)], in order.

    A gap shorter than `MIN_GAP_MIN` is dropped rather than offered: proposing that somebody
    do a real task in the eleven minutes between two calls is how a plan loses its credit.
    """
    day = day_epoch or time.time()
    start, end = _bounds(day)
    rows = events if events is not None else eds.events(2)
    busy = sorted(((r["start"], r.get("end") or r["start"] + 3600)
                   for r in rows if r.get("start") and _same_day(r["start"], day)),
                  key=lambda x: x[0])
    out, cursor = [], max(start, int(day))
    for s, e in busy:
        if s > cursor:
            out.append((cursor, min(s, end)))
        cursor = max(cursor, e)
    if cursor < end:
        out.append((cursor, end))
    return [(s, e, int((e - s) / 60)) for s, e in out
            if e > s and (e - s) / 60 >= MIN_GAP_MIN]


def _clock(epoch):
    return time.strftime("%-I:%M", time.localtime(epoch)).replace(":00", "") \
        + time.strftime("%p", time.localtime(epoch)).lower()


def plan(day_epoch=None, energy=None):
    """(say, proposal). Nothing is written; `proposal` is what the person may accept.

    `energy` is the person's own word for how much they have — "low", "normal", "high" — and
    it changes how MUCH is proposed, never what. Somebody who says they are flat is not
    asking for a reordering of the same seven things.
    """
    day = day_epoch or time.time()
    try:
        events = eds.events(2)
        todos = eds.todos()
    except eds.Unavailable as e:
        return e.spoken(), None

    today = [r for r in events if r.get("start") and _same_day(r["start"], day)]
    free = gaps(day, events)
    free_min = sum(g[2] for g in free)

    # Due soonest first, then undated. An overdue thing is not a preference.
    def key(t):
        return (0, t["due"]) if t.get("due") else (1, 0)

    ranked = sorted(todos, key=key)
    room = free_min
    if energy == "low":
        room = int(room * 0.5)
    elif energy == "high":
        room = int(room * 1.2)

    chosen, cost = [], 0
    for t in ranked:
        if cost + DEFAULT_TASK_MIN > room:
            continue
        chosen.append(t)
        cost += DEFAULT_TASK_MIN

    left_out = [t for t in ranked if t not in chosen]
    parts = []
    if today:
        parts.append(f"{len(today)} thing{'s' if len(today) != 1 else ''} booked")
    parts.append(f"{_hours(free_min)} free" if free_min else "no clear time")
    said = "You have " + " and ".join(parts) + "."

    if not ranked:
        return said + " Nothing on your list.", None
    if chosen:
        names = [t["summary"] for t in chosen[:3]]
        listed = ", ".join(names[:-1]) + f" and {names[-1]}" if len(names) > 1 else names[0]
        said += f" Enough for {listed}."
    if left_out:
        # THE HONEST PART. Not "you could fit these in" — the number, and permission.
        said += (f" That leaves {len(left_out)} that won't fit today. "
                 f"Worth dropping one, or moving it?")
    return said, {"day": int(day), "chosen": chosen, "left_out": left_out,
                  "free_minutes": free_min}


def _hours(minutes):
    if minutes >= 90:
        h = minutes / 60
        return f"{h:.0f} hours" if abs(h - round(h)) < 0.1 else f"{h:.1f} hours"
    return f"{minutes} minutes"


def week(now=None):
    """(say, report) — what was due this week, what is done, what slipped.

    **Drop is offered first.** People will move a thing forward five weeks running and never
    once consider letting it go; the review that does not say the word is complicit in that.
    """
    ref = now or time.time()
    try:
        todos = eds.todos()
    except eds.Unavailable as e:
        return e.spoken(), None
    week_ago = ref - 7 * 86400
    slipped = [t for t in todos if t.get("due") and t["due"] < ref]
    old = [t for t in slipped if t["due"] < week_ago]
    if not todos:
        return "Your list is empty — nothing slipped this week.", {"slipped": [], "old": []}
    if not slipped:
        return (f"Nothing overdue. {len(todos)} thing{'s' if len(todos) != 1 else ''} "
                f"still ahead of you."), {"slipped": [], "old": []}
    said = (f"{len(slipped)} thing{'s' if len(slipped) != 1 else ''} slipped past its date")
    if old:
        names = [t["summary"] for t in old[:2]]
        listed = " and ".join(names)
        said += (f", and {listed} {'have' if len(old) > 1 else 'has'} been waiting more than "
                 f"a week. Is that one to drop?")
    else:
        said += ". Worth dropping any of them?"
    return said, {"slipped": slipped, "old": old}
