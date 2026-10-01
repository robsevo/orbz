#!/usr/bin/env python3
"""Tests for the bake-off's own logic (PLAN 0.3_t). Plain script, no network, controls included."""
from __future__ import annotations

import json
import sys

from bakeoff import pick_defaults, playbook_answer, summarize
from fixtures import instance

FAILS = 0


def check(name, ok, detail=""):
    global FAILS
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))
    FAILS += not ok


def v(rate, tokens=1000, latency=10, available=1.0, **extra):
    return {"n": 5, "available": available, "rate": rate, "tokens": tokens, "latency": latency, **extra}


s = {"big": {"a": {"x": v(0.8), "y": v(1.0)}, "b": {"x": v(1.0), "y": v(1.0, tokens=5000)}, "c": {"x": v(1.0), "y": v(1.0, tokens=900)}}}
check("D.1 the best average rate wins; fewer tokens break the tie", pick_defaults(s)["big"]["seat"] == "c", pick_defaults(s))
s2 = {"big": {"fast": {"x": v(1.0, available=0.8)}, "slow": {"x": v(0.9)}}}
check("D.2 a seat that errored on any case is never the default (control)", pick_defaults(s2)["big"]["seat"] == "slow", pick_defaults(s2))
s3 = {"teacher": {"bold": {"x": v(1.0, odd_wrong=1)}, "careful": {"x": v(0.6, odd_wrong=0)}}}
check("D.3 a teacher whose habit answered an odd case wrongly is never the default (control)",
      pick_defaults(s3)["teacher"]["seat"] == "careful", pick_defaults(s3))
s4 = {"teacher": {"partial": {"inbox": v(1.0)}, "complete": {"inbox": v(1.0), "invoice": v(0.67), "calendar": v(1.0)}}}
check("D.10 a seat measured on only some tasks cannot win on its average (control: partial data flatters)",
      pick_defaults(s4)["teacher"]["seat"] == "complete", pick_defaults(s4))
check("D.4 no qualifying seat gives None, not a guess", pick_defaults({"own": {"z": {"x": v(None, available=0.0)}}})["own"] is None)

rows = [{"ok": True, "error": None, "tokens": 10, "latency": 1}, {"ok": False, "error": "503", "tokens": 0, "latency": 0},
        {"ok": False, "error": None, "tokens": 12, "latency": 1}]
sm = summarize(rows)
check("D.5 an error counts against availability, not as a wrong answer", abs(sm["available"] - 2 / 3) < 1e-9 and sm["rate"] == 0.5, sm)


class Scripted:
    model = "fake"

    def __init__(self, text, finish="stop"):
        self.text, self.finish = text, finish

    def chat(self, messages, purpose, max_tokens=8000):
        return {"text": self.text, "total": 10, "finish": self.finish, "latency_s": 0.1}


inp, exp = instance("calendar", 11, 501)
ex = [instance("calendar", 11, 601)]
out, note = playbook_answer(Scripted('{"clashes": []}'), "calendar", inp, ex)
check("D.6 a playbook reply missing keys is no answer", out is None and note == "missing keys", (out, note))
out, note = playbook_answer(Scripted(json.dumps(exp)), "calendar", inp, ex)
check("D.7 a complete playbook reply is accepted (control)", out == exp and note == "", note)

import argparse, tempfile
from pathlib import Path
import bakeoff
with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    a1, a2, a3 = td / "a1", td / "a2", td / "a3"
    for d, part in ((a1, {"big": {"x": {"inbox": v(1.0)}}}), (a2, {"own": {"y": {"inbox": v(0.9)}}}),
                    (a3, {"big": {"x": {"inbox": v(0.2)}}})):
        d.mkdir()
        (d / "results.json").write_text(json.dumps({"summary": part}))
    real_docs, real_here = bakeoff.DOCS, bakeoff.HERE
    bakeoff.DOCS, bakeoff.HERE = td / "docs", td
    (td / "docs").mkdir()
    try:
        ns = argparse.Namespace(k=5)
        import io, contextlib
        with contextlib.redirect_stdout(io.StringIO()):
            rc = bakeoff.merge([a1, a2], ns)
        picks = json.loads((td / "docs" / "bakeoff-defaults.json").read_text())
        check("D.8 a clean merge combines the jobs into one set of defaults", rc == 0 and picks["big"]["seat"] == "x" and picks["own"]["seat"] == "y", picks)
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                bakeoff.merge([a1, a3], ns)
            check("D.9 the same seat measured twice is refused, never silently picked (control)", False)
        except SystemExit:
            check("D.9 the same seat measured twice is refused, never silently picked (control)", True)
        with contextlib.redirect_stdout(io.StringIO()):
            rc = bakeoff.merge([a1, a3], argparse.Namespace(k=5, drop=["big/x"], partial=""))
        doc = (td / "docs" / "bakeoff-results.md").read_text()
        check("D.11 --drop leaves a stale entry out, and the report says so", rc == 0 and "big/x from a1" in doc, doc[-200:])
    finally:
        bakeoff.DOCS, bakeoff.HERE = real_docs, real_here

print(f"\n{'ALL PASS' if not FAILS else f'{FAILS} FAILED'}")
sys.exit(1 if FAILS else 0)
