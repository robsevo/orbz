"""A lesson on an orb's own canvas (PLAN 4.4): Ash's carried lesson.py plans it once, and the home
runs its steps on the canvas in the app's Computer tab (teach/canvas.html, carried).

  plan(topic)               Ash's route(): his scripted union-find lesson, or a plan drawn for the
                            canvas by the model (draw_plan, asked of the home's brain order through
                            seatbroker.py, Orbs' own), or why it cannot be drawn here (a page or a
                            file is taught in the orb's own browser and the Computer tab, not this)
  judge(topic, step, answer, facts)
                            Ash's judge, told what is ON the canvas now (teachcanvas.describe) as
                            well as the step: (True|False|None, what to say). None is "could not
                            judge", and is never praise: the hint is said instead
  explain(step, facts)      a scripted step's own answer, worked out from the drawing (Ash's
                            ufds_answer), for "tell me"
  observe(kind, text)       what a lesson may note about the person: only an allowlisted kind,
                            never a judgement of them (Ash's learner_model)
"""
from __future__ import annotations

import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
ASH = KIT / "ash"
if str(ASH) not in sys.path:
    sys.path.insert(0, str(ASH))

import lesson  # noqa: E402
import lesson_demos  # noqa: E402
import learner_model  # noqa: E402
import teachcanvas  # noqa: E402

CANVAS = teachcanvas.CANVAS


def _no_page(topic, page_url=None):
    """A lesson never picks a page here: Orbs teaches a page in the orb's own browser (PLAN 4.1),
    and Ash's choose_url would fetch the web from the kit itself, past the home's guard."""
    return None


lesson.choose_url = _no_page  # route() looks it up by name, so this is the one it asks


def _steps(raw):
    return [{"text": str(s.get("text") or ""), "do": [list(op) for op in (s.get("do") or [])],
             "question": str(s.get("question") or ""), "hint": str(s.get("hint") or "")} for s in raw]


def plan(topic: str) -> dict:
    """The lesson for `topic`: {"kind": "scripted"|"canvas"|"page"|"local", "title", "steps", "why"}.
    Only a scripted or a drawn lesson has steps here."""
    r = lesson.route(topic, page_url=None)
    if r.kind == "scripted":
        return {"kind": "scripted", "title": "Union-find", "steps": _steps(lesson_demos.UFDS_STEPS), "why": r.why}
    if r.kind == "canvas":
        drawn = r.payload or {}
        return {"kind": "canvas", "title": str(drawn.get("title") or topic), "steps": _steps(drawn.get("steps") or []), "why": r.why}
    return {"kind": r.kind, "title": topic, "steps": [], "why": r.why}


def judge(topic: str, step: dict, answer: str, facts: dict | None) -> dict:
    """Ash's judge on one answer, told the step AND what the canvas shows: {"correct", "say"}."""
    shown = teachcanvas.describe(facts or {})
    told = {"text": f"{step.get('text', '')}\nOn the canvas now: {shown}", "question": step.get("question") or "(their own question)"}
    correct, response = lesson.judge(topic, told, answer)
    if correct is None:
        hint = str(step.get("hint") or "").strip()
        return {"correct": None, "say": f"I couldn't check that one. {hint}".strip(), "told": told["text"]}
    return {"correct": bool(correct), "say": response, "told": told["text"]}


def explain(index: int, facts: dict | None) -> str:
    """A scripted step's answer, read off the drawing (no model): for "tell me"."""
    steps = lesson_demos.UFDS_STEPS
    if not 0 <= index < len(steps):
        raise ValueError(f"no step {index + 1}")
    return lesson_demos.ufds_answer(dict(steps[index], n=index + 1), facts or {})


def observe(kind: str, text: str) -> dict:
    """Whether a lesson may note this about the person: {"ok", "reason"} (Ash's learner_model)."""
    ok, reason = learner_model.check(kind, text, route="lesson")
    return {"ok": bool(ok), "reason": str(reason or "")}
