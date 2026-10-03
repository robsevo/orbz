#!/usr/bin/env python3
"""A lesson about his own code is taught from his own code. Run: orb/daemon/.venv/bin/python orb/daemon/test_lesson_route.py

D12, 2026-09-18: "open your own speech code on screen and walk me through the rule that stops
you rambling — put the file up with ashshow" went looking for a WEB page. The model's pick came
back cut off, Wikipedia had nothing, and the lesson ran with no page and nothing to point at.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import lesson  # noqa: E402

FAILS = []
lesson.log = lambda *a, **k: None


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'' if ok else '  — ' + str(detail)}")
    if not ok:
        FAILS.append(name)


D12 = ("open your own speech code on screen and walk me through the rule that stops you "
       "rambling — put the file up with ashshow")

print("lesson routing")
# the network must not be touched on the way to his own file
touched = []
real_reach, real_ask = lesson.reachable, lesson.ask
lesson.reachable = lambda *a, **k: touched.append("reachable") or False
lesson.ask = lambda *a, **k: touched.append("ask") or (_ for _ in ()).throw(RuntimeError("offline"))
try:
    url = lesson.choose_url(D12)
finally:
    lesson.reachable, lesson.ask = real_reach, real_ask
check("R.1 the D12 request is taught from a file on this machine",
      bool(url) and url.startswith("file://") and "speakable.py" in url, url)
check("R.2 ...without asking the web or a model for a page", not touched, touched)
page = Path(url[len("file://"):]) if url else None
check("R.3 the page he points at is the real source, line by line",
      bool(page) and page.is_file() and "clamp_spoken" in page.read_text(), page)

for t, want in (("show me your own voice code", "voice.py"),
                ("walk me through phrasing.py", "phrasing.py")):
    got = lesson.local_source(t)
    check(f"R.4 {t!r} -> {want}", got is not None and got.name == want, got)

for t in ("teach me how binary search works", "teach me how photosynthesis works",
          "what is your speech like today"):
    check(f"R.5 {t!r} still goes to the web", lesson.local_source(t) is None, lesson.local_source(t))

# ── the one routing decision (PLAN 12.1) ────────────────────────────────────────────────
# `route` answers "where does this lesson go?" without running one. Everything below stubs
# the two expensive edges — `draw_plan` asks a model, `choose_url` reaches the network — and
# asserts the ORDER, which is the whole content of the function.

STALE = "https://example.com/a-page-they-had-open"
NAMED = "walk me through phrasing.py"

_real = {n: getattr(lesson, n) for n in ("draw_plan", "choose_url", "reachable", "ask")}
picked = []


def stub(draw=None):
    """Point the two edges at recorders. Looked up by NAME on the module, which is the thing
    `route` must do at call time — a default argument would bind the real `draw_plan` when
    the function was defined and ignore every stub here (D104's shape)."""
    lesson.draw_plan = lambda topic: draw
    lesson.choose_url = lambda topic, page_url=None: picked.append(page_url or "picker") or STALE
    lesson.reachable = lambda *a, **k: picked.append("reachable") or False
    lesson.ask = lambda *a, **k: picked.append("ask") or (_ for _ in ()).throw(RuntimeError("offline"))


PLAN_FIXTURE = {"title": "a drawable plan", "steps": [{"do": [1, 2]}]}

try:
    # R.6  a file the request NAMES beats a page that was merely attached
    stub()
    picked.clear()
    r = lesson.route(NAMED, page_url=STALE)
    check("R.6 a request naming a local file beats an attached page",
          r.kind == "local" and getattr(r.payload, "name", "") == "phrasing.py", r)
    check("R.6b ...and the page picker is never asked", not picked, picked)

    # R.6c  THE CONTROL. The pre-fix decision is still reachable: `choose_url` answers
    # "which page", and there `page_url` legitimately wins. That is exactly what `run` used
    # to ask first, so this shows the defect was real and that `route` is what fixes it —
    # without planting anything into a module another agent may be holding.
    lesson.choose_url = _real["choose_url"]
    check("R.6c CONTROL: the old question — choose_url — still answers with the stale page",
          lesson.choose_url(NAMED, STALE) == STALE,
          "if this ever stops returning the attached page, R.6 is comparing two identical "
          "answers and proves nothing")

    # R.7  a named file also beats his canvas: naming a file is an instruction, a drawable
    # plan for the same words is a guess.
    stub(draw=PLAN_FIXTURE)
    r = lesson.route(NAMED)
    check("R.7 a named local file beats a drawable plan",
          r.kind == "local" and getattr(r.payload, "name", "") == "phrasing.py", r)
    check("R.7b CONTROL: the same plan DOES win when no file is named",
          lesson.route("teach me merge sort").kind == "canvas",
          "if the canvas never wins here, R.7 is satisfied by a route that cannot draw")

    # R.8  a scripted demonstration is not vetoed by an attached page. Two takes of this
    # lesson were sent to "teach from this page" and tried to teach union-find off a coffee
    # landing page (2026-09-17).
    stub(draw=PLAN_FIXTURE)
    r8 = lesson.route("teach me union find", page_url=STALE)
    check("R.8 a scripted topic beats both an attached page and the canvas",
          r8.kind == "scripted" and r8.payload == "ufds", r8)

    # R.9  a description of one of his parts sits BEHIND the canvas, where a named file does
    # not — it is an inference, not an instruction.
    stub(draw=PLAN_FIXTURE)
    check("R.9 a described part yields to the canvas", lesson.route(D12).kind == "canvas",
          lesson.route(D12))
    stub(draw=None)
    r9 = lesson.route(D12)
    check("R.9b ...and is taken when nothing is drawable",
          r9.kind == "local" and getattr(r9.payload, "name", "") == "speakable.py", r9)

    # R.10  every route carries a reason. `why` is the log line and what says WHICH rule
    # fired, rather than leaving it to be inferred from the outcome.
    stub(draw=None)
    reasons = [lesson.route(t, page_url=STALE).why
               for t in (NAMED, "teach me union find", D12, "teach me photosynthesis")]
    check("R.10 every route says which rule fired",
          all(isinstance(w, str) and len(w) > 10 for w in reasons), reasons)
finally:
    for n, v in _real.items():
        setattr(lesson, n, v)

# R.11  STRUCTURAL: the union-find pattern has ONE definition. It was a literal in `run()`
# and an entry in VISUALGO, and two copies of one pattern is one pattern and one stale copy.
_src = (HERE/"lesson.py").read_text()
_run = _src[_src.index("def run(topic, page_url=None):"):]
check("R.11 no union-find regex literal survives inside run()",
      "union.?find" not in _run[:1500],
      "the pattern is back in two places; widen one and the routes disagree")
check("R.11b ...and the shared definition is the one VISUALGO uses",
      "_UFDS = " in _src and "(_UFDS, \"ufds\")" in _src,
      "VISUALGO must reference the shared pattern, not its own copy")

# ── R.12  a dead router sends the lesson to a page, not to a traceback ──────────────────
# `draw_plan` caught only ValueError, so a RuntimeError from `ask` — no seat answered, or it
# timed out — came out of `draw_plan`, and now out of `route`, and out of `run`. The lesson
# died where the page route was sitting there ready. Raised by the other agent measuring 12.1.
_saved_ask, _saved_choose = lesson.ask, lesson.choose_url
_logged = []
_saved_log = lesson.log
try:
    lesson.log = lambda m: _logged.append(str(m))
    lesson.ask = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no seat answered"))
    # WRAPPED, and that is not optional. A check whose claim is "this does not raise" is
    # killed by the raise it is testing for: planting the ValueError-only handler back made
    # this suite die before R.12 printed a single line, so the run was red and unreadable —
    # which is how three earlier red runs in this project got written off as flakes (D62).
    # The failure must be REPORTED by the check, not delivered as a traceback.
    try:
        _drawn, _raised = lesson.draw_plan("teach me merge sort"), None
    except Exception as e:                                   # noqa: BLE001 — the finding
        _drawn, _raised = "raised", f"{type(e).__name__}: {e}"
    check("R.12 a router failure makes draw_plan fall back rather than raise",
          _drawn is None, _raised or f"returned {_drawn!r} instead of None")
    check("R.12b ...and says so, with the failure's type — never a silent swallow",
          any("RuntimeError" in m and "falling back" in m for m in _logged), _logged[-3:])

    lesson.choose_url = lambda topic, page_url=None: "https://example.com/fallback"
    r12 = lesson.route("teach me merge sort")
    check("R.12c ...so the route reaches the page instead of dying in the router",
          r12.kind == "page", r12)

    # CONTROL: unusable JSON is a DIFFERENT failure and must still use its retry, not this
    # path — otherwise R.12 is satisfied by a draw_plan that gave up on everything.
    _logged.clear()
    lesson.ask = lambda *a, **k: "not json at all"
    check("R.12d CONTROL: unusable JSON still retries and is reported as unusable",
          lesson.draw_plan("teach me merge sort") is None
          and sum(1 for m in _logged if "unusable" in m) == 2,
          [m for m in _logged if "unusable" in m])
finally:
    lesson.ask, lesson.choose_url, lesson.log = _saved_ask, _saved_choose, _saved_log

print()
if FAILS:
    print(f"  {len(FAILS)} failure(s): " + ", ".join(FAILS)); sys.exit(1)
print("  lesson routing: all checks pass")
