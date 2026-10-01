"""Where ashd lives, where its state lives, and how it logs — and nothing else.

Split out of ashd.py on 2026-09-18 (D25) so that terminal.py can use them without importing
the daemon. ashd.py runs as __main__, so a lazy `import ashd` from another module would have
loaded the whole daemon a second time.
"""
import threading
import time
from pathlib import Path
import statepaths  # noqa: E402 — PLAN 5.9: one root, and ASH_STATE_HOME moves it

HERE = Path(__file__).resolve().parent
CFG = statepaths.config()

# ── structured fields (PLAN 16.3) ──────────────────────────────────────────────────────
# Component, session and turn on every line, so one turn can be followed end to end through
# three processes writing two files. Before this, `ashd`, `pair` and a lesson all wrote
# lines that looked alike and belonged to different work.
#
# The SHAPE IS DELIBERATELY CONSERVATIVE: the clock stays first and the message stays last,
# with the fields between them. Several checks and `shoot.py` slice these logs looking for
# substrings — "models ready", "[speaking]", "turn.abort" — and a format that moved the
# message or the clock would break every one of them silently. Nothing here is anchored to
# the start of a line, so a substring search still finds what it found before.
#
# Component is per PROCESS and set once. Turn is THREAD-LOCAL, for the same reason
# `seatbroker.set_turn` is: one turn runs on its own thread, and a module global would be
# shared by two turns running at once (a lesson beside a coding turn).
# Session is per PROCESS, not per thread: a daemon has one session and its turns run on
# their own threads, so a thread-local session would be empty on every line that mattered.
COMPONENT = ""
SESSION = ""
_ctx = threading.local()


def bind(component=None, session=None):
    """Name this process. Called once, at start."""
    global COMPONENT, SESSION
    if component is not None:
        COMPONENT = str(component)
    if session is not None:
        SESSION = str(session)[:12]
    return COMPONENT


def bind_turn(turn=None, session=None):
    """Name this THREAD's turn. Called where the turn begins, beside `seatbroker.set_turn`."""
    global SESSION
    _ctx.turn = "" if turn is None else str(turn)[:24]
    if session is not None:
        SESSION = str(session)[:12]
    return _ctx.turn


def fields():
    """(component, session, turn) as they stand for this thread."""
    return (COMPONENT, SESSION, getattr(_ctx, "turn", ""))


def log(*a):
    comp, sess, turn = fields()
    # MILLISECONDS, because four of this project's SLO targets are sub-second (barge-in
    # 150 ms, wake 300 ms, stop 500 ms) and `%T` cannot see them. With a one-second clock
    # `baseline.py --slo` reported stop -> terminal interrupt as min 0, max 0, median 0 over
    # five samples: not a measurement, a floor — the true value is somewhere in [0, 1) and the
    # instrument cannot say where. PLAN 1.8 names that as the D10 class, a number that looks
    # measured and is not.
    #
    # The clock stays FIRST and stays ONE token (16.3's constraint): `shoot.py` and four
    # suites slice these logs, and every one of them splits on whitespace, so a wider first
    # field is safe where a reordered line would not be.
    head = [f"{time.strftime('%T')}.{int((time.time() % 1) * 1000):03d}"]
    if comp:
        head.append(f"[{comp}]")
    # Only when there IS one. An idle daemon writing `t=` on every line teaches the reader
    # to skip the field, and then it is not there when it matters.
    if turn:
        head.append(f"{sess}/{turn}" if sess else turn)
    print(*head, *a, flush=True)
