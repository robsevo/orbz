#!/usr/bin/env python3
"""When he may speak first, and when he may not (PLAN C7).

Everything that speaks without being asked goes through `may_speak()`. That is the whole
design: one gate, asked by every proactive path, so "never during a coding turn" is a
property of the system rather than a rule each new feature has to remember.

**This row exists because the previous one broke it.** C3.4's reminders fire on the idle
tick, and the idle tick happens while a linked terminal is working — so a reminder could
land in the middle of a build, over the narration, while the person is reading the screen.
D7 already measured what that costs: 4.4% of spoken lines were word-for-word repeats and the
user said "stop" five times in two minutes.

The gates, in the order they are asked:

  * **asleep** — the mic is drained and he is meant to be quiet;
  * **a turn in flight** — he is already talking or thinking about something the person
    asked for, and that wins;
  * **a lesson** — interrupting teaching is worse than being late;
  * **a linked terminal that is working** — the coding turn IS the thing on screen;
  * **quiet hours** — held on disk, so they survive a restart (C7.2);
  * **earned** — a class the person has rejected twice stops offering (C7.4).

Nothing here speaks. It answers yes or no and says why, so the caller can log the why.
"""
import json
import os
import time
from pathlib import Path
import statepaths  # noqa: E402 — PLAN 5.9: one root, and ASH_STATE_HOME moves it

CFG = statepaths.config()
STATE = CFG/"proactive.json"

# Classes of unprompted speech. Each is earned and revoked separately: somebody who wants
# reminders and not suggestions should get exactly that.
CLASSES = ("reminder", "brief", "suggestion", "followup")

# Two rejections and a class stops offering. Not one — a single "not now" is a moment, not a
# preference — and not five, because by the fifth the person has stopped listening anyway.
REVOKE_AFTER = 2
# The daily brief is ONE thing, once (C7.3). Scattered pings is the failure this prevents.
BRIEF_GAP_S = 20 * 3600


def _read():
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def _write(d):
    # pid+thread-unique tmp and an atomic replace, per rule 7 and D65.
    tmp = STATE.with_suffix(f".{os.getpid()}.tmp")
    try:
        STATE.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(json.dumps(d))
        os.replace(tmp, STATE)
        return True
    except OSError:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        return False


def quiet_hours(start=None, end=None):
    """Set or read quiet hours as local 24h integers. Held on DISK so a restart keeps them —
    a person who asked for quiet at 10pm should not be woken by a daemon that restarted."""
    d = _read()
    if start is None and end is None:
        q = d.get("quiet") or {}
        return q.get("start"), q.get("end")
    d["quiet"] = {"start": int(start), "end": int(end)}
    _write(d)
    return int(start), int(end)


def in_quiet_hours(now=None, d=None):
    d = d if d is not None else _read()
    q = d.get("quiet") or {}
    s, e = q.get("start"), q.get("end")
    if s is None or e is None:
        return False
    h = time.localtime(now or time.time()).tm_hour
    # A window that wraps midnight is the normal case, and the one a naive `s <= h < e`
    # gets exactly backwards.
    return (s <= h < e) if s < e else (h >= s or h < e)


def record(kind, accepted, d=None):
    """Remember whether a suggestion of this class was taken (C7.4/C7.5)."""
    d = d if d is not None else _read()
    stats = d.setdefault("classes", {}).setdefault(kind, {"offered": 0, "accepted": 0,
                                                          "rejected_run": 0})
    stats["offered"] += 1
    if accepted:
        stats["accepted"] += 1
        stats["rejected_run"] = 0
    else:
        stats["rejected_run"] += 1
    _write(d)
    return stats


def earned(kind, d=None):
    """Whether this class may still speak. Revoked by rejections, restored by an accept."""
    d = d if d is not None else _read()
    stats = (d.get("classes") or {}).get(kind) or {}
    return stats.get("rejected_run", 0) < REVOKE_AFTER


def mark_brief(now=None, d=None):
    d = d if d is not None else _read()
    d["last_brief"] = float(now or time.time())
    _write(d)


def brief_due(now=None, d=None):
    d = d if d is not None else _read()
    last = d.get("last_brief") or 0
    return (float(now or time.time()) - last) >= BRIEF_GAP_S


def may_speak(kind, *, state="idle", asleep=False, lesson_running=False,
              terminal_working=False, now=None, d=None):
    """(ok, why). The one gate every unprompted path asks.

    `why` is returned even when the answer is yes, so a log line can say which gate let it
    through — a proactive feature that cannot be explained is one that gets switched off
    wholesale rather than tuned.
    """
    if kind not in CLASSES:
        return False, f"unknown class {kind!r}"
    d = d if d is not None else _read()
    if asleep:
        return False, "he is asleep"
    if lesson_running:
        return False, "a lesson is running — interrupting teaching is worse than being late"
    if terminal_working:
        return False, "the terminal is working, and that is the thing on screen"
    # `listening` IS NOT FREE (D354). In ashd it is always an open capture — a wake, or the
    # follow-up window after an answer — and speaking into it abandons what the person is
    # saying. Only `idle` is quiet.
    if state == "listening":
        return False, "he is listening — the person may be talking"
    if state != "idle":
        return False, f"a turn is in flight ({state})"
    if in_quiet_hours(now, d):
        return False, "quiet hours"
    if not earned(kind, d):
        return False, f"{kind} was turned down {REVOKE_AFTER} times running"
    if kind == "brief" and not brief_due(now, d):
        return False, "today's brief has already been given"
    return True, "clear"
