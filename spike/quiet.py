"""Orbs' test runs share Ash's free Gemini pools (one router, one set of keys). On 2026-10-01 six spike
runs pushed gemini-3.8-flash to 1,641 requests with 332 per-day refusals while Ash's nightly gym was
due on the same pools. So a heavy run refuses to START inside Ash's gym window unless forced."""
from __future__ import annotations

import datetime as dt

GYM_START, GYM_END = dt.time(2, 30), dt.time(7, 0)   # Ash's loops: 02:40 practice … 06:41 distill


def in_ash_gym_window(now: dt.datetime | None = None) -> bool:
    t = (now or dt.datetime.now()).time()
    return GYM_START <= t < GYM_END


def guard(force: bool, now: dt.datetime | None = None) -> None:
    if in_ash_gym_window(now) and not force:
        raise SystemExit("refusing to start: Ash's nightly gym (02:30-07:00) uses the same free Gemini pools. "
                         "Run after 07:00, or pass --force if Ash is off tonight.")
