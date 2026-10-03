"""Your calendar and your list, as the home hands them to the kit (PLAN 4.5): Orbs' own, in
place of Ash's eds.py, which read and wrote GNOME's Evolution Data Server.

In Orbs your calendars are the ICS feeds the home keeps (packages/home/src/connectors/
calendars.ts) and your list is the bills and reminders the orbs keep for you (notices.ts). The
home hands both in before it asks the day a question (`handed`), so the carried `day`,
`dayplan` and `reminders` read them through the same names they always used.

Ash's two rules hold: nothing handed in is "I can't reach your calendar", never an empty day
(an empty calendar and an unreachable one are opposite answers, and only one is safe to act
on); and a calendar that could not be read comes as a row saying so, which callers skip. Orbs
reads your calendars and never writes them: every write is refused, saying so.
"""
import time

# What the home handed in: {"events": [...], "todos": [...], "now": epoch}, or None (nothing).
FEED = None


class Unavailable(RuntimeError):
    """The calendar could not be reached, or cannot be changed from here. Carries what to say."""

    def __init__(self, detail, kind="unavailable"):
        super().__init__(detail)
        self.kind = kind
        self.detail = detail

    def spoken(self):
        if self.kind == "read_only":
            return "I can't change your calendar from here: I only read it."
        if self.kind in ("no_such_calendar", "no_such_list"):
            return "I couldn't find that calendar."
        return "I can't reach your calendar right now."


def handed(events, todos=None, failed=(), now=None):
    """The home's hand-off: event rows {summary, start, end, all_day, location, uid, calendar,
    recurring, recurrence_id}, to-do rows {summary, due, uid, list}, and the calendars that
    could not be read ({calendar, error})."""
    global FEED
    FEED = {
        "events": sorted((_event(e) for e in events), key=lambda e: e["start"]) + [
            {"calendar": str(f.get("calendar", "")), "error": str(f.get("error", ""))[:120]} for f in failed],
        "todos": [_todo(t) for t in (todos or [])],
        "now": float(now) if now is not None else None,
    }


def _event(e):
    return {
        "summary": str(e.get("summary") or ""), "start": int(e["start"]), "end": int(e.get("end") or e["start"]),
        "all_day": bool(e.get("all_day")), "location": str(e.get("location") or ""), "uid": str(e.get("uid") or ""),
        "calendar": str(e.get("calendar") or ""), "recurring": bool(e.get("recurring")),
        "recurrence_id": str(e.get("recurrence_id") or ""),
    }


def _todo(t):
    due = t.get("due")
    return {"summary": str(t.get("summary") or ""), "due": int(due) if due is not None else None, "done": False,
            "uid": str(t.get("uid") or ""), "list": str(t.get("list") or "")}


def _feed():
    if FEED is None:
        raise Unavailable("the home handed in no calendar", "unreachable")
    return FEED


def events(days=7, since=None):
    """Everything from `since` (default now) to `days` days from now, soonest first, as Ash's
    eds gave it; a calendar that could not be read is a row with its error and no start."""
    f = _feed()
    now = f["now"] if f["now"] is not None else time.time()
    start = int(since) if since else int(now)
    end = int(now) + int(days) * 86400
    return [e for e in f["events"] if "start" not in e or (e["end"] > start and e["start"] < end)]


def todos():
    return list(_feed()["todos"])


def _read_only(*_a, **_k):
    raise Unavailable("Orbs reads your calendars and does not change them", "read_only")


add_event = move_event = remove = add_todo = _read_only
