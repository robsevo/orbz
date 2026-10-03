#!/usr/bin/env python3
"""The kit's calendar (PLAN 4.5): kit/ash/eds.py, Orbs' own, in place of Ash's EDS. What the home
hands in is what the carried day reads; nothing handed in is "I can't reach your calendar", never
an empty day; a calendar that could not be read comes as a row saying so; nothing can be written."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ash"))
import day  # noqa: E402
import eds  # noqa: E402

FAIL = []


def ok(cond, label):
    print(f"{'PASS' if cond else 'FAIL'}  {label}")
    if not cond:
        FAIL.append(label)


now = time.mktime((2026, 10, 5, 8, 0, 0, 0, 0, -1))
h = lambda d, hr: int(time.mktime((2026, 10, d, hr, 0, 0, 0, 0, -1)))

eds.FEED = None
try:
    eds.events()
    ok(False, "ED.0 CONTROL: nothing handed in raises")
except eds.Unavailable as e:
    ok(e.kind == "unreachable" and "can't reach" in e.spoken(), "ED.0 CONTROL: nothing handed in is an unreachable calendar, never an empty one")
kind, said, _ = day.handle("what's my day", now=now)
ok(kind == "say" and "can't reach" in said, f"ED.0 and the day says so: {said!r}")

eds.handed([{"summary": "late", "start": h(5, 15), "end": h(5, 16)}, {"summary": "early", "start": h(5, 9), "end": h(5, 10)},
            {"summary": "next month", "start": h(30, 9), "end": h(30, 10)}, {"summary": "done", "start": h(5, 6), "end": h(5, 7)}],
           [{"summary": "pay the rent", "due": h(5, 17)}], failed=[{"calendar": "Family", "error": "HTTP 500"}], now=now)
got = eds.events(7)
ok([e.get("summary") for e in got] == ["early", "late", None], f"ED.1 from now for a week, soonest first, the unread calendar as a row with no start: {got}")
ok(any(e.get("calendar") == "Family" and e.get("error") for e in got), "ED.1 the row says which calendar and why")
ok([e["summary"] for e in eds.events(7, since=h(5, 0)) if "start" in e] == ["done", "early", "late"], "ED.2 `since` moves the start only (the whole of today)")
ok(eds.todos() == [{"summary": "pay the rent", "due": h(5, 17), "done": False, "uid": "", "list": ""}], "ED.3 the list as Ash's to-do rows")
for write in ("add_event", "move_event", "remove", "add_todo"):
    try:
        getattr(eds, write)("x", 1, 2)
        ok(False, f"ED.4 {write} refused")
    except eds.Unavailable as e:
        ok(e.kind == "read_only", f"ED.4 {write} is refused: Orbs reads your calendars and never writes them")
said, _ = day.agenda(now=now)
ok("early" in said or "Early" in said, f"ED.5 the carried day reads what was handed in: {said!r}")
eds.FEED = None
print("ALL PASS" if not FAIL else f"{len(FAIL)} FAILED")
sys.exit(1 if FAIL else 0)
