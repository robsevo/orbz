#!/usr/bin/env python3
"""This session's conversation, for the orb's session log widget (PLAN F.33).

The owner, 2026-09-26: *"add session log widget"* — Ash's conversation: what you said (or typed)
and what he answered, newest at the bottom, with which seat served it.

Written at the two places a turn is already logged, and nowhere else: `router.handle` (what was
heard or typed) and `speech.play` (what he says). A ring of the last `KEEP` entries in
`session-log.json`, replaced whole on every write (a unique tmp per writer, then a rename, as
`day.write_panel_state` does), so the reader never sees half a file. A new daemon process is a new
session and starts a fresh log.

**What you said is REDACTED before it is written**, with the same `redact.redact` the log lines
use (13.4): say an API key out loud to test the mic and it must not land here in the clear either.

    enable()                     the live daemon turns it on (ashd.main, under its lock); until then
                                 said/replied write NOTHING — a suite that drives speech must not
                                 put its lines in the owner's real log (it did, 2026-09-26)
    said(text, typed=False)      a heard or typed line
    replied(text)                a line he spoke; names the seat that served the turn, if any
    state()                      what the widget shows
"""
import json
import os
import threading
import time

import redact
import statepaths  # noqa: E402 — PLAN 5.9: one root, and ASH_STATE_HOME moves it

PATH = statepaths.config()/"session-log.json"
LEDGER = statepaths.config()/"seat-decisions.jsonl"
KEEP = 60
SESSION = f"{os.getpid()}-{int(time.time())}"
_lock = threading.Lock()
_entries = []
_last_said = [0.0]
_enabled = [False]


def enable():
    _enabled[0] = True


def _served_since(t0, ledger=None):
    """The deployment that answered a MODEL call since `t0`, from the broker's ledger — the voice
    (TTS) rows are not the answer's seat. None when nothing served one (a verb answered it)."""
    p = ledger or LEDGER
    try:
        with open(p, "rb") as f:
            f.seek(0, 2)
            n = min(f.tell(), 64 * 1024)
            f.seek(-n, 2)
            lines = f.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return None
    for line in reversed(lines):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if not isinstance(r, dict) or float(r.get("t") or 0) < t0:
            break
        if r.get("outcome") == "ok" and r.get("served") and r.get("purpose") != "voice":
            return str(r["served"])[:60]
    return None


def _write(path=None):
    p = path or PATH
    st = {"session": SESSION, "t": time.time(), "entries": list(_entries)}
    tmp = p.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(json.dumps(st))
        os.replace(tmp, p)
    except OSError:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def _add(entry, path=None):
    if path is None and not _enabled[0]:
        return                    # not the live daemon: nothing reaches the real file
    with _lock:
        _entries.append(entry)
        del _entries[:-KEEP]
        _write(path)
    if path is None:
        try:
            import chatstore            # F.40: the session's turns are the CURRENT chat
            chatstore.append(entry)
        except Exception:
            pass


def said(text, typed=False, *, now=None, path=None):
    """A line the person said (or typed). Never raises: the log is a view, not the turn."""
    try:
        t = str(text or "").strip()
        if not t:
            return
        ts = time.time() if now is None else now
        _last_said[0] = ts
        _add({"who": "you", "how": "typed" if typed else "said", "text": redact.redact(t)[:600], "t": ts}, path)
    except Exception:
        pass


def replied(text, *, full=None, now=None, path=None, ledger=None):
    """A line he spoke, and the seat that served the turn it answers. `full` is the answer as
    written, before it was shaped for the ear (F.39): the chat shows that one, markdown and all."""
    try:
        t = " ".join(str(text or "").split())
        if not t:
            return
        ts = time.time() if now is None else now
        seat = _served_since(_last_said[0] or ts - 120, ledger) if _last_said[0] else None
        e = {"who": "ash", "text": redact.redact(t)[:1200], "t": ts, "seat": seat}
        if full and str(full).strip() and str(full).strip() != t:
            e["full"] = redact.redact(str(full).strip())[:20000]
        _add(e, path)
    except Exception:
        pass


def state():
    with _lock:
        return {"session": SESSION, "entries": list(_entries)}
