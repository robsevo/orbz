#!/usr/bin/env python3
"""Lessons (PLAN 4.4_t): kit/orbs_kit/lessons.py over Ash's carried lesson.py, teachcanvas.py and
learner_model.py, with the home's brain stood in (seatbroker.ASK_HOME, which the kit's server sets
while a lesson tool runs).

  LS.1 a union-find request is Ash's scripted lesson: five steps, each with a question and a hint
  LS.2 a drawable topic is planned once by the home's brain into canvas steps; with no brain to ask
       it says it cannot draw it, never an empty lesson
  LS.3 the judge is told the step AND what is on the canvas: a different drawing is a different telling
  LS.4 an unjudged answer is never praised: when the brain fails (both tries), or its reply is cut
       off, the answer is "could not judge" and the hint is said
  LS.5 a judge reply {"correct": "false"} is not correct (Ash read bool("false") as true); a reply that
       opens with praise is said without the opener
  LS.6 a lesson notes only an allowlisted kind about the person; a judgement of them is refused
  LS.7 "tell me": a scripted step's answer is read off the canvas, not asked of a model
  CONTROLS, on planted copies (the carried files are never touched): Ash's describe() without the
  caption tells the judge the same before and after a step that only asks (LS.3 can fail), and
  Ash's bool() reads the judge's "false" as correct and praises it (LS.5 can fail)
"""
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT))
from orbs_kit import lessons  # noqa: E402
import seatbroker  # noqa: E402  (kit/ash is on the path through orbs_kit.lessons)

FAIL = []


def ok(cond, label, got=None):
    print(f"{'PASS' if cond else 'FAIL'}  {label}" + ("" if cond or got is None else f"  ({got!r})"))
    if not cond:
        FAIL.append(label)


asked = []


def brain(*replies):
    """The home's brain, answering each ask in turn with the next reply (an Exception is raised)."""
    queue = list(replies)

    def ask(messages, max_tokens, timeout):
        asked.append(messages)
        r = queue.pop(0) if queue else RuntimeError("asked once too often")
        if isinstance(r, Exception):
            raise r
        return "stand-in", r
    return ask


PLAN = {"title": "Binary search", "family": "cells", "steps": [
    {"text": "A sorted row of numbers. We look for 24.", "do": [["cells", [3, 8, 12, 19, 24, 31, 40]]]},
    {"text": "Look at the middle.", "do": [["marks", [[0, "lo"], [3, "mid"], [6, "hi"]]], ["compare", 3, 4]]},
    {"text": "24 is bigger, so the left half goes.", "do": [["span", 4, 6]]},
    {"text": "24 is found.", "do": [["found", 4]]},
]}

# ── LS.1 the scripted lesson ───────────────────────────────────────────────────────────────────
seatbroker.ASK_HOME = None
p = lessons.plan("teach me union find")
ok(p["kind"] == "scripted" and len(p["steps"]) == 5, "LS.1 union-find is Ash's scripted lesson, five steps", p["kind"])
ok(all(s["question"] and s["hint"] and s["do"] for s in p["steps"]), "LS.1 each step draws, asks and hints")

# ── LS.2 a drawn lesson: planned once by the home's brain; none to ask, it says so ──────────────
asked.clear()
seatbroker.ASK_HOME = brain(json.dumps(PLAN))
p = lessons.plan("teach me how binary search works")
ok(p["kind"] == "canvas" and [s["text"] for s in p["steps"]] == [s["text"] for s in PLAN["steps"]], "LS.2 a drawable topic becomes canvas steps", p)
ok(len(asked) == 1, "LS.2 ...planned once", len(asked))
seatbroker.ASK_HOME = None
p = lessons.plan("teach me how binary search works")
ok(p["kind"] == "page" and p["steps"] == [] and p["why"], "LS.2 no brain to ask: no canvas lesson, and it says why (no page is picked here: lessons.py)", p)

# ── LS.3 what the judge is told changes with the canvas ─────────────────────────────────────────
step = lessons.plan("teach me union find")["steps"][3]  # FindSet(3)
before = {"n": 8, "groups": [{"root": 1, "members": [0, 1, 2, 3], "rank": 2, "size": 4}], "parent": {"0": 1, "2": 3, "3": 1}, "caption": step["text"], "cells": []}
after = dict(before, parent={"0": 1, "2": 1, "3": 1})
told = []
seatbroker.ASK_HOME = brain(json.dumps({"correct": True, "response": "3 points at 1 now."}), json.dumps({"correct": True, "response": "3 points at 1 now."}))
told.append(lessons.judge("union find", step, "it points at the root", before)["told"])
told.append(lessons.judge("union find", step, "it points at the root", after)["told"])
ok("On the canvas now:" in told[0] and step["text"] in told[0], "LS.3 the judge is told the step and the canvas", told[0])
ok(told[0] != told[1], "LS.3 a different drawing is a different telling")

# ── LS.4 an unjudged answer is never praised ────────────────────────────────────────────────────
seatbroker.ASK_HOME = brain(RuntimeError("down"), RuntimeError("down"))
j = lessons.judge("union find", step, "it points at the root", after)
ok(j["correct"] is None and step["hint"] in j["say"] and "right" not in j["say"].lower(), "LS.4 the brain down twice: could not judge, the hint said", j)
seatbroker.ASK_HOME = brain('{"correct": true, "response": "Spot on, 3 now po', '{"correct": true, "respon')
j = lessons.judge("union find", step, "it points at the root", after)
ok(j["correct"] is None, "LS.4 a reply cut off twice is not a pass", j)

# ── LS.5 "false" is not correct; praise is stripped ─────────────────────────────────────────────
seatbroker.ASK_HOME = brain(json.dumps({"correct": "false", "response": "Spot on! Not quite: look at 3's arrow."}))
j = lessons.judge("union find", step, "it stays", after)
ok(j["correct"] is False, "LS.5 a judge's \"false\" is not correct", j)
seatbroker.ASK_HOME = brain(json.dumps({"correct": True, "response": "Spot on. 3 points at 1, the root."}))
j = lessons.judge("union find", step, "at the root", after)
ok(j["correct"] is True and not j["say"].lower().startswith("spot on"), "LS.5 an opener of praise is stripped", j)

# ── LS.6 what a lesson may note about the person ────────────────────────────────────────────────
ok(lessons.observe("concept", "path compression: answered correctly")["ok"], "LS.6 a concept learned may be noted")
r = lessons.observe("concept", "seems slow and not very bright")
ok(not r["ok"] and r["reason"], "LS.6 a judgement of the person is refused", r)
ok(not lessons.observe("health", "tired today")["ok"], "LS.6 a kind outside the allowlist is refused")

# ── LS.7 tell me ────────────────────────────────────────────────────────────────────────────────
asked.clear()
seatbroker.ASK_HOME = brain()
said = lessons.explain(3, after)
ok("3 now points straight at 1" in said and not asked, "LS.7 a scripted step's answer read off the canvas, no model asked", said)

# ── CONTROLS: the same checks on planted copies of the carried files fail ───────────────────────
ASH = KIT / "ash"
planted = Path(tempfile.mkdtemp(prefix="lessons-control-"))


def copy_of(name, old, new):
    text = (ASH / f"{name}.py").read_text()
    assert old in text, f"the control's anchor is gone from {name}.py: {old[:50]!r}"
    path = planted / f"{name}_planted.py"
    path.write_text(text.replace(old, new, 1))
    spec = importlib.util.spec_from_file_location(f"{name}_planted", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# Ash's describe(): no caption, so the IsSameSet step (it changes nothing drawn) tells the judge nothing new
ash_tc = copy_of("teachcanvas", '    return "; ".join([out, *said])', "    return out")
same_before = dict(after, caption=step["text"])
same_after = dict(after, caption="IsSameSet(0, 2) asks whether two items belong to the same group.")
import teachcanvas  # noqa: E402
ok(teachcanvas.describe(same_before) != teachcanvas.describe(same_after), "LS.3b a step that only asks still changes what the judge is told (its caption)")
ok(ash_tc.describe(same_before) == ash_tc.describe(same_after), "LS.3c CONTROL: without the caption it would not (LS.3b can fail)")

# Ash's bool(): the judge's "false" read as correct, and praised
ash_lesson = copy_of("lesson", 'correct = out.get("correct") is True', 'correct = bool(out.get("correct"))')
seatbroker.ASK_HOME = brain(json.dumps({"correct": "false", "response": "Spot on! Not quite: look at 3's arrow."}))
c, said = ash_lesson.judge("union find", {"text": step["text"], "question": step["question"]}, "it stays")
ok(c is True, "LS.5c CONTROL: Ash's line praises the same \"false\" (LS.5 can fail)", (c, said))

seatbroker.ASK_HOME = None
print("ALL PASS" if not FAIL else f"{len(FAIL)} FAILED")
sys.exit(1 if FAIL else 0)
