#!/usr/bin/env python3
"""Reminders that survive a restart, and fire exactly once (PLAN C3.4).

**No new timer.** A reminder held in a daemon's memory dies with the daemon, and one held in
a fresh `threading.Timer` dies twice as fast — the person who set it has no way to know, and
finds out by missing the thing. The plan's word for that is *"worse than none"*.

So the two halves live where they already are:

  * the WHAT is EDS — the to-do and its due date, which the person can open in their task
    list and change, and which is still there after a reboot (C3.2);
  * the WHETHER-IT-FIRED is the runtime journal — append-only, WAL, crash-safe, and already
    the record for everything else (6.3).

Nothing here schedules anything. `due()` asks "what is owed right now", and the daemon's
existing idle tick calls it — the same place the turn review drains from. A loop that is
already running is a better clock than a new thread nobody supervises.

FIRING EXACTLY ONCE is keyed on `(uid, due)`, not on `uid`. A to-do whose due date the
person MOVES is a new obligation and must fire again; one that merely got re-read must not.
"""
import json
import time

import eds

# A reminder that came due while the machine was off is still worth saying — but not one
# from last month. An hour is long enough to survive a restart or a lunch break, short
# enough that a reboot does not produce a recital of everything you missed.
GRACE_S = 3600
KIND = "task.state"          # the protocol type a fired reminder is recorded under


def _journal():
    import adapters
    return adapters.journal()


def fired_keys(j=None, limit=5000):
    """Every (uid, due) already announced, from the journal. Durable across a restart."""
    j = j or _journal()
    out = set()
    try:
        for row in j.since(0, limit=limit):
            if row.get("type") != KIND:
                continue
            p = row.get("payload") or {}
            if p.get("state") == "reminded" and p.get("uid"):
                out.add((p["uid"], p.get("due")))
    except Exception:
        return out
    return out


def mark_fired(uid, due, summary="", j=None):
    """Record that this reminder was said. Never raises — a reminder that was spoken and
    then failed to record would be said again, which is the annoying failure rather than the
    dangerous one, but it is still a failure."""
    import runtime
    j = j or _journal()
    try:
        j.append(runtime.envelope(KIND, "ashd",
                                  {"state": "reminded", "uid": uid, "due": due,
                                   "summary": summary[:120]}, task_id=str(uid)),
                 source="ashd")
        return True
    except Exception:
        return False


def due(now=None, grace=GRACE_S, j=None):
    """To-dos owed right now and not yet announced. [] when there is nothing, or when the
    calendar cannot be reached — a reminder is not worth taking a turn down for."""
    now = time.time() if now is None else now
    try:
        todos = eds.todos()
    except eds.Unavailable:
        # Deliberately quiet: `day.handle` is where "I can't reach your calendar" gets said,
        # because that is a question the person asked. An idle tick has nobody to tell.
        return []
    already = fired_keys(j)
    owed = []
    for t in todos:
        d = t.get("due")
        if not d or d > now:
            continue
        if (now - d) > grace:
            # Too old. A reboot after a long weekend must not produce a recital of
            # everything that came due while the machine was off.
            continue
        if (t["uid"], d) in already:
            continue
        owed.append(t)
    owed.sort(key=lambda t: t["due"])
    return owed


def announce(t):
    """One sentence. 11.7: prose, nothing ending on a bare ordinal."""
    return f"Reminder — {t['summary']}."


def fire(now=None, say=None, j=None):
    """Say what is owed and record it. Returns what was announced.

    The record is written AFTER the saying, so a crash mid-sentence repeats a reminder
    rather than losing it. Between annoying and silent, this project picks annoying.
    """
    out = []
    for t in due(now, j=j):
        line = announce(t)
        if say is not None:
            try:
                say(line)
            except Exception:
                # Could not say it: do NOT mark it fired, or it is lost for good.
                continue
        mark_fired(t["uid"], t["due"], t.get("summary", ""), j=j)
        out.append(line)
    return out
