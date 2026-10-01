"""The night's report card — what Ash practised while nobody was watching.

Two nightly loops write ~/ash/voice/practice-report.json:

    loops/cs-practice    a computer-science topic implemented from scratch and GRADED by
                         the harness re-running the night's own tests
    loops/skill-acquire  one skill created or deepened, accepted only if the house safety
                         gate passed

The orb reads it once, says it, and marks it spoken, so it is a report and not a nag. A
missing file, a stale day, or an already-spoken card all mean "say nothing" — the quiet
night has to be genuinely quiet or this becomes noise the user learns to talk over.

Spoken-turn rules apply (CONSTITUTION § language): no paths, no symbols, no slugs read as
letters, numbers written the way they are said. "union-find" becomes "union find".
"""

import json
import os
import time

CARD = os.path.join(os.environ.get("ORBS_KIT_STATE") or os.path.expanduser("~/.orbs/kit"), "practice-report.json")

# A card older than this is history, not news. Two days covers the case where the orb was
# not opened the morning after; beyond that the user does not want yesterweek's homework.
MAX_AGE_S = 48 * 3600


def _say_slug(slug):
    """A directory name is not a spoken word. 'union-find' -> 'union find'."""
    return (slug or "").replace("-", " ").replace("_", " ").strip()


def read(path=None):
    path = CARD if path is None else path
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def mark_spoken(path=None, expect_day=None):
    """Best-effort: a card that cannot be marked is not worth failing a boot over, but it
    must not be said twice, so a failure here is logged by the caller and the card left.

    `expect_day` guards the read-modify-write (PLAN 14.3). `line()` reads the card, ashd
    speaks it, and THEN this marks it — and a nightly loop can write a new card in that
    window. Without the guard the new card is marked spoken having never been said, and the
    next boot is silent about work that was actually done. With it, a card that changed
    underneath is left alone and simply gets spoken next time, which is the safe direction.

    A shared ".tmp" is its own race: two writers and one renames the file the other was
    about to (2026-09-15). Per process and thread.
    """
    import threading
    # THE SAME DEFAULT `read()` APPLIES, and its absence here is why the "said once"
    # guarantee never worked in production. `ashd` calls `mark_spoken(expect_day=...)` with
    # no path, so `path` stayed None: `read(None)` resolved it correctly and returned the
    # card, then `os.replace(tmp, None)` raised `TypeError: dst should be string, bytes or
    # os.PathLike, not NoneType` — caught by the caller, logged as "practice report
    # skipped", and the card was never marked. It would be spoken again the next boot.
    #
    # Seen the first time the orb was actually started after 2026-09-21's Phase 5 path fix.
    # Every test called `mark_spoken(p)` with an explicit path, so the suite exercised a
    # branch production never takes — "a test that does not call it the way production does"
    # (CLAUDE.md §12), and PC.6 below now calls it exactly as `ashd` does.
    path = CARD if path is None else path
    card = read(path)
    if not card:
        return False
    if expect_day is not None and card.get("day") != expect_day:
        return False                      # a different card than the one that was spoken
    card["spoken"] = True
    tmp = f"{path}.{os.getpid()}.{threading.get_ident()}.tmp"
    try:
        with open(tmp, "w") as f:
            json.dump(card, f)
        os.replace(tmp, path)
    # NOT just OSError. The failure that actually happened was a `TypeError` from
    # `os.replace(tmp, None)`, which this did not catch — so the cleanup below never ran and
    # every boot left a `None.<pid>.<tid>.tmp` file behind in the daemon directory. Two were
    # sitting there when this was found. A tidy-up that only handles the failure you
    # expected is not a tidy-up.
    except (OSError, TypeError, ValueError):
        try:
            os.unlink(tmp)
        except OSError:
            pass
        return False
    return True


def line(path=None, now=None):
    """The one thing to say, or "" for nothing to report.

    Returned as a single spoken sentence or two — never a list, never a heading.
    """
    path = CARD if path is None else path
    card = read(path)
    if not card or card.get("spoken"):
        return ""
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return ""
    if (now or time.time()) - mtime > MAX_AGE_S:
        return ""

    parts = []
    topic = _say_slug(card.get("topic"))
    if topic:
        if card.get("passed"):
            # The MEASUREMENT is deliberately not spoken. It is raw benchmark output —
            # "push: 136.3ns -> 145.6ns (O(1) verified across 1k-1M ops)" was a real card on
            # 2026-09-16 — and the spoken-turn rules rule out symbols, arrows and letter
            # abbreviations. The numbers are in the notification queue, which is read. Out
            # loud, the honest and speakable version of "it worked" is the test count.
            n = card.get("tests_total")
            count = f", {n} tests green" if isinstance(n, int) and n > 0 else \
                    ", and the tests came back green"
            parts.append(f"Last night I practised {topic}{count}.")
        else:
            parts.append(f"Last night I practised {topic} and could not get the tests "
                         f"green, so it comes round again tonight.")

    skill = card.get("skill") or {}
    slug = _say_slug(skill.get("slug"))
    if slug:
        verb = "went deeper on" if skill.get("mode") == "deepen" else "picked up a new skill,"
        parts.append(f"I also {verb} {slug}.")

    return " ".join(parts)


if __name__ == "__main__":   # test_practice_card.py drives this; also handy by hand
    import sys
    if "--mark" in sys.argv:
        print("marked" if mark_spoken() else "no card")
    else:
        out = line()
        print(out if out else "(nothing to report)")
