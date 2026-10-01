#!/usr/bin/env python3
"""Chats, kept and named so they stay organised (PLAN F.40).

The owner, 2026-09-26: *"a list of chats … named systematically not something stupid like they
are now. something that helps you keep them organized"*. Each conversation is one file in
`chats/`, replaced whole on every write; the CURRENT chat is what the session log is recording
(`sessionlog` hands every entry here too), and **New chat** starts another.

**A name is a RULE, never a model.** `<Area> · <Topic>`: the area from what the first thing you
said was about (Mail, Calendar, Code, Lesson, Web, Tasks, Weather, Chat), the topic from those
words with the greeting and the politeness taken off — "hey ash can you check my email" is
**Mail · Check email**. The same first line always gets the same name, so a list of them reads
like a filing cabinet rather than a raffle.

Like the session log, NOTHING is written until the live daemon calls `enable()` (F.33: a suite
that drives speech once wrote the owner's real log).

    append(entry)          an entry for the current chat (the session log's shape: who/how/text/t)
    new_chat()             start a new current chat; returns its id
    listing(now)           [{id, title, area, created, updated, n, group}] newest first
    load(id) / delete(id)  one chat, by an id of the store's own shape only
    rename(id, title)      the owner's own name; marked `named`, never overwritten by the rule
    name(text)             (area, title) for a first line — pure
    mark(pred, **fields)   set fields on the newest matching entry (a question, its answer)
"""
import json
import os
import re
import threading
import time

import statepaths  # noqa: E402 — PLAN 5.9: one root, and ASH_STATE_HOME moves it

DIR = statepaths.config()/"chats"
MAX_ENTRIES = 600
ID_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{4}$")
_lock = threading.Lock()
_enabled = [False]
_cur = {"id": None, "title": "New chat", "area": "Chat", "created": 0.0, "entries": []}

AREAS = (                       # first match wins: the weather before the calendar ("tomorrow")
    ("Weather", r"\b(weather|rain|forecast|temperature|snow)\b"),
    ("Mail", r"\b(e-?mails?|mail|inbox|gmail|unread|newsletter|spam)\b"),
    ("Calendar", r"\b(calendar|meeting|appointment|schedule|remind(er)?|book|agenda|tomorrow|today'?s plan|what'?s on)\b"),
    ("Code", r"\b(code|coding|build|bug|fix|test|tests|repo|commit|function|script|compile|deploy|error|refactor|app|website for)\b"),
    ("Lesson", r"\b(teach|lesson|explain|learn|how does|what is a|quiz|practice)\b"),
    ("Web", r"\b(open|search|google|look up|browse|page|site|youtube|news)\b"),
    ("Tasks", r"\b(to-?do|task|tasks|list)\b"),
)
_FILLER = re.compile(r"^(?:(?:hey|hi|hello|ok(?:ay)?|yo|so|um+|uh+|ash|please|pls|now)[,!.?]?(?:\s+|$))+", re.I)
_ASK = re.compile(r"^(?:(?:can|could|would|will) you\s+|i (?:want|need|would like) (?:you )?to\s+|"
                  r"(?:let'?s|lets)\s+|help me\s+|(?:go )?ahead and\s+)+", re.I)
_TAIL = re.compile(r"(?:\s+(?:please|for me|thanks|thank you|now))+[\s?.!]*$", re.I)


def enable():
    _enabled[0] = True


def name(text):
    """(area, title) for the first thing said in a chat. Pure; the same line, the same name."""
    t = " ".join(str(text or "").split())
    area = next((a for a, rx in AREAS if re.search(rx, t, re.I)), "Chat")
    topic = _FILLER.sub("", t)
    topic = _ASK.sub("", topic)
    topic = _FILLER.sub("", topic)
    topic = _TAIL.sub("", topic).strip(" ?.!,")
    topic = re.sub(r"\bmy\s+", "", topic, flags=re.I)
    words = topic.split()
    if not words:
        return area, area
    topic = " ".join(words[:6]) + ("…" if len(words) > 6 else "")
    return area, f"{area} · {topic[:1].upper()}{topic[1:]}"


def _new_id(now):
    return time.strftime("%Y%m%d-%H%M%S", time.localtime(now)) + "-" + os.urandom(2).hex()


def _path(cid, d=None):
    if not ID_RE.match(str(cid or "")):
        raise ValueError("not a chat id")
    return (d or DIR)/f"{cid}.json"


def _write(chat, d=None):
    if not chat.get("id"):
        return
    p = _path(chat["id"], d)
    tmp = p.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(json.dumps(chat))
        os.replace(tmp, p)
    except OSError:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def new_chat(now=None, d=None):
    """A new current chat. The file appears with its first entry, so an empty New chat leaves
    nothing behind."""
    ts = time.time() if now is None else now
    with _lock:
        _cur.update(id=_new_id(ts), title="New chat", area="Chat", created=ts, entries=[], named=False)
        return _cur["id"]


def append(entry, now=None, d=None):
    """An entry (already redacted by the session log) for the current chat. Never raises."""
    if d is None and not _enabled[0]:
        return
    try:
        with _lock:
            if not _cur.get("id"):
                _cur.update(id=_new_id(entry.get("t") or time.time()), created=entry.get("t") or time.time(),
                            entries=[], title="New chat", area="Chat", named=False)
            # named by the first thing said — or by the next, when the first was only a greeting
            # ("hey ash" names nothing, so the chat is still just its area)
            if entry.get("who") == "you" and _cur["title"] in ("New chat", _cur["area"]) and not _cur.get("named"):
                _cur["area"], _cur["title"] = name(entry.get("text"))
            _cur["entries"].append(dict(entry))
            del _cur["entries"][:-MAX_ENTRIES]
            _cur["updated"] = entry.get("t") or time.time()
            _write(dict(_cur), d)
    except Exception:
        pass


def clean_title(title):
    """A name the owner typed: one line, no control characters, at most 60 characters; '' if empty."""
    t = re.sub(r"[\x00-\x1f\x7f]", " ", str(title or ""))
    return " ".join(t.split())[:60]


def rename(cid, title, d=None):
    """The owner's own name for a chat (owner, 2026-09-27: "option to rename chat"). It is marked
    `named`, so the rule that names a chat from its first line never overwrites it."""
    t = clean_title(title)
    if not t:
        raise ValueError("an empty name")
    with _lock:
        if _cur.get("id") == cid:
            _cur.update(title=t, named=True)
            if d is not None or _enabled[0]:
                _write(dict(_cur), d)
            return t
    p = _path(cid, d)
    c = json.loads(p.read_text())
    c.update(title=t, named=True)
    _write(c, d)
    return t


def mark(pred, **fields):
    """Set fields on the newest entry of the current chat that `pred` accepts (a question's id,
    its answer). Returns True when one was found."""
    with _lock:
        for e in reversed(_cur["entries"]):
            if pred(e):
                e.update(fields)
                if _enabled[0]:
                    _write(dict(_cur))
                return True
    return False


def _group(ts, now):
    day = lambda x: time.strftime("%Y-%m-%d", time.localtime(x))
    if day(ts) == day(now):
        return "Today"
    if day(ts) == day(now - 86400):
        return "Yesterday"
    if now - ts < 7 * 86400:
        return "This week"
    return "Earlier"


def listing(now=None, d=None):
    ts_now = time.time() if now is None else now
    out = []
    try:
        names = sorted(os.listdir(d or DIR), reverse=True)
    except OSError:
        names = []
    for n in names:
        cid = n[:-5] if n.endswith(".json") else ""
        if not ID_RE.match(cid):
            continue
        try:
            c = json.loads(((d or DIR)/n).read_text())
        except (OSError, ValueError):
            continue
        up = float(c.get("updated") or c.get("created") or 0)
        out.append({"id": cid, "title": str(c.get("title") or "New chat")[:80], "area": c.get("area") or "Chat",
                    "named": bool(c.get("named")),
                    "created": c.get("created"), "updated": up, "n": len(c.get("entries") or []),
                    "group": _group(up, ts_now)})
    out.sort(key=lambda c: c["updated"], reverse=True)
    return out


def load(cid, d=None):
    if _cur.get("id") == cid:
        with _lock:
            return json.loads(json.dumps(_cur))
    return json.loads(_path(cid, d).read_text())


def delete(cid, d=None):
    p = _path(cid, d)
    if _cur.get("id") == cid:
        new_chat(d=d)
    try:
        p.unlink()
        return True
    except FileNotFoundError:
        return False


def current():
    with _lock:
        return json.loads(json.dumps(_cur))
