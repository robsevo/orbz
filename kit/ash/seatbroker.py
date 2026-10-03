"""A lesson's model calls (PLAN 4.4), Orbs' own, in place of Ash's seat broker and his router.

Ash's carried lesson.py asks `seatbroker.call(seats, body, ...)` and gets back the seat it asked, the
seat that served, and the text. In Orbs there is one seat: the home's brain order (ChatGPT, then
your Gemini key, then a preset's key, then the local coder). The kit's server sets `ASK_HOME` for
the length of a lesson tool's call (the home answers over MCP sampling), so a lesson's plan and its
judge are asked of whichever brain the home is serving, and a lesson spends nothing the brain order
would not. Ash's seat names are kept only as the name of what was asked.
"""
from __future__ import annotations

import threading

RATE_WAIT = 8


class Denied(Exception):
    """No brain could be asked: said plainly, never a silent empty answer."""


_turn = threading.local()

# (messages, max_tokens, timeout_s) -> (served, text); set by orbs_kit.server while a lesson tool runs
ASK_HOME = None


def set_turn(turn_id=None):
    _turn.id = turn_id


def current_turn():
    return getattr(_turn, "id", None)


def call(seats, body, *, purpose="", timeout=30, approve=None, free_only=True, rate_wait=RATE_WAIT, **_):
    """The home's brain order answers `body` (its messages and max_tokens): (asked, served, text)."""
    ask = ASK_HOME
    if ask is None:
        raise Denied("no brain to ask: a lesson asks the home's brain order, and none is connected")
    asked = seats[0] if seats else "home"
    served, text = ask(list(body.get("messages") or []), int(body.get("max_tokens") or 1024), float(timeout))
    return asked, served or "home", text or ""
