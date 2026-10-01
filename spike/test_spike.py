#!/usr/bin/env python3
"""Tests for the spike harness itself (PLAN 0.2_t). Plain script, no network, no model calls.

The spike's numbers are only worth something if the harness cannot flatter them, so every check
here has a control: a liar habit must be rejected, a habit that answers odd inputs must fail G4,
a paid seat must be refused.
"""
from __future__ import annotations

import json
import sys

import brain as brain_mod
from fixtures import calendar_oracle, inbox_oracle, instance
import fingerprint as fpm
from harness import Result, gate, ladder, make_habit, same
from run_spike import metrics
from sandbox import run_habit

FAILS = 0


def check(name, ok, detail=""):
    global FAILS
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))
    FAILS += not ok


# ── fixtures
a1, b1 = instance("inbox", 7, 3), instance("inbox", 7, 3)
check("F.1 same seed + n gives the same instance", json.dumps(a1) == json.dumps(b1))
check("F.2 different n gives a different instance", json.dumps(instance("inbox", 7, 4)) != json.dumps(a1))

mini_inbox = {"today": "2026-10-05", "user": "u", "emails": [
    {"id": "m1", "from_name": "Bell", "from_addr": "ebill@bell.example", "subject": "Your invoice is ready",
     "date": "2026-10-04T09:00", "body": "Amount due: $1,234.50. Due date: Oct 20, 2026."},
    {"id": "m2", "from_name": "Maya", "from_addr": "maya@x.example", "subject": "Q", "date": "2026-10-03T10:00", "body": "Can you call?"},
    {"id": "m3", "from_name": "News", "from_addr": "news@x.example", "subject": "Issue", "date": "2026-10-02T10:00", "body": "Read? Unsubscribe here"},
    {"id": "m4", "from_name": "GitHub", "from_addr": "notifications@github.example", "subject": "x", "date": "2026-10-01T10:00", "body": "Any questions?"},
]}
o = inbox_oracle(mini_inbox)
check("F.3 a $ bill with a due date is a bill, parsed", o["bills"] == [{"id": "m1", "vendor": "Bell", "amount": 1234.5, "currency": "USD", "due": "2026-10-20"}], o["bills"])
check("F.4 'unsubscribe' beats a question mark", o["newsletters"] == ["m3"] and o["needs_reply"] == ["m2"], o)
check("F.5 notifications@ with a question is fyi, not needs_reply", o["fyi"] == ["m4"], o)

cal = {"events": [{"id": "e1", "title": "a", "start": "2026-10-05T10:00:00-04:00", "end": "2026-10-05T11:00:00-04:00"},
                  {"id": "e2", "title": "b", "start": "2026-10-05T11:00:00-04:00", "end": "2026-10-05T16:30:00-04:00"}],
       "new_event": {"title": "k", "start": "2026-10-05T10:30:00-04:00", "end": "2026-10-05T11:30:00-04:00"}}
co = calendar_oracle(cal)
check("F.6 clashes: overlaps both, touching is not overlap", co["clashes"] == ["e1", "e2"], co)
# The day is booked until 16:30 and a 60-minute slot from 16:30 would end past 17:00, so all three
# alternatives fall on the next working day.
check("F.7 alternatives: first free 60-min slots forward, then next day 09:00",
      co["alternatives"] == [{"start": "2026-10-06T09:00:00-04:00", "end": "2026-10-06T10:00:00-04:00"},
                             {"start": "2026-10-06T09:30:00-04:00", "end": "2026-10-06T10:30:00-04:00"},
                             {"start": "2026-10-06T10:00:00-04:00", "end": "2026-10-06T11:00:00-04:00"}], co["alternatives"])
check("F.8 odd invoice has no oracle (a habit must not answer it)", instance("invoice", 7, 1, odd=True)[1] is None)

# ── sandbox
r = run_habit("import os\ndef guard(i): return None\ndef run(i): return {'h': os.listdir('/home')}\n", [{}])
check("S.1 the user's home is invisible to a habit", r["results"][0]["output"]["h"] == [], r)
r = run_habit("import socket\ndef guard(i): return None\ndef run(i):\n    socket.create_connection(('1.1.1.1',53),timeout=2)\n    return {}\n", [{}])
check("S.2 no network", "unreachable" in r["results"][0].get("error", "").lower(), r)
r = run_habit("def guard(i): return None\ndef run(i):\n    while True: pass\n", [{}], timeout=6)
check("S.3 an endless habit is killed", "timed out" in r.get("crash", ""), r)

# ── the promotion gate (calendar: a correct habit written by hand as the control)
CAL_HABIT = '''
import datetime as dt
def guard(inp):
    for e in inp.get("events", []):
        if "start" not in e or not str(e["start"]).endswith("-04:00"): return "unfamiliar event"
    ne = inp.get("new_event", {})
    if not str(ne.get("start", "")).endswith("-04:00"): return "unfamiliar time format"
    if dt.datetime.fromisoformat(ne["start"]).weekday() >= 5: return "weekend"
    return None
def run(inp):
    p = dt.datetime.fromisoformat
    iso = lambda t: t.strftime("%Y-%m-%dT%H:%M:00-04:00")
    ns, ne = p(inp["new_event"]["start"]), p(inp["new_event"]["end"])
    evs = sorted(inp["events"], key=lambda e: (e["start"], e["id"]))
    clashes = [e["id"] for e in evs if p(e["start"]) < ne and ns < p(e["end"])]
    alts = []
    if clashes:
        dur, t = ne - ns, ns
        while len(alts) < 3:
            if t.weekday() >= 5 or t + dur > t.replace(hour=17, minute=0):
                t = (t + dt.timedelta(days=1)).replace(hour=9, minute=0); continue
            if t < t.replace(hour=9, minute=0):
                t = t.replace(hour=9, minute=0); continue
            end = t + dur
            if all(not (p(e["start"]) < end and t < p(e["end"])) for e in evs):
                alts.append({"start": iso(t), "end": iso(end)})
            t += dt.timedelta(minutes=30)
    return {"clashes": clashes, "alternatives": alts}
'''
traces = [instance("calendar", 7, n) for n in range(1, 9)]
check("G.1 a correct habit passes the gate (control)", gate("calendar", CAL_HABIT, traces) == [])
LIAR = "def guard(i): return None\ndef run(i): return {'clashes': [], 'alternatives': []}\n"
check("G.2 a liar habit is rejected", len(gate("calendar", LIAR, traces)) > 0)
COWARD = CAL_HABIT.replace('return None\ndef run', 'return "always defer"\ndef run', 1)
check("G.3 a guard that refuses approved cases is rejected", len(gate("calendar", COWARD, traces)) > 0)
check("G.4 code that does not load is rejected", len(gate("calendar", "def guard(:\n", traces)) > 0)
odd_hits = [run_habit(CAL_HABIT, [instance("calendar", 7, j, odd=True)[0]])["results"][0]["guard"] for j in range(1, 7)]
check("G.5 the control habit's guard trips on every odd calendar", all(g is not None for g in odd_hits), odd_hits)


# ── the ladder (fake brain)
class FakeBrain:
    def __init__(self, reply):
        self.reply, self.calls = reply, []

    def chat(self, messages, purpose, max_tokens=8000):
        self.calls.append(purpose)
        return {"text": self.reply, "total": 1000 if "big" in purpose else 100}


inp, exp = instance("calendar", 7, 1)
fb = FakeBrain(json.dumps({**exp, "message": "hi"}))
r = ladder(fb, "calendar", inp, None)
check("L.1 no habit → the big brain answers", r.route == "big" and fb.calls == ["day:calendar:big"], (r.route, fb.calls))
fb = FakeBrain(json.dumps({"message": "hi"}))
HAB = make_habit(CAL_HABIT, traces)
r = ladder(fb, "calendar", inp, HAB)
check("L.2 a habit answers, then one small call for the fuzzy field", r.route == "habit" and fb.calls == ["day:calendar:fuzzy"] and same("calendar", r.output, exp), (r.route, fb.calls))
odd_inp, _ = instance("calendar", 7, 2, odd=True)
fb = FakeBrain(json.dumps({"clashes": [], "alternatives": [], "message": "x"}))
r = ladder(fb, "calendar", odd_inp, HAB)
check("L.3 a tripped guard falls back to the big brain", r.route == "fallback" and "day:calendar:big" in fb.calls, (r.route, r.reason))
r = ladder(FakeBrain("{}"), "calendar", inp, dict(HAB, code="def guard(i): return None\ndef run(i): raise ValueError('boom')\n"))
check("L.4 a habit that raises falls back, never answers", r.route == "fallback" and "boom" in r.reason, r.reason)

# ── familiarity fingerprints (layers 1 and 3), with controls both ways
cal_tr = [instance("calendar", 7, n) for n in range(1, 13)]
in_fp = fpm.learn([i for i, _ in cal_tr])
check("P.1 an approved input is familiar", all(fpm.check(i, in_fp) is None for i, _ in cal_tr))
fresh = [instance("calendar", 7, n)[0] for n in range(50, 60)]
check("P.2 fresh normal calendars stay familiar (no over-tripping)", sum(fpm.check(i, in_fp) is None for i in fresh) >= 8,
      [fpm.check(i, in_fp) for i in fresh])
odd_reasons = [fpm.check(instance("calendar", 7, j, odd=True)[0], in_fp) for j in range(1, 10)]
check("P.3 every odd calendar is unfamiliar (all-day key, Z times, weekend)", all(r is not None for r in odd_reasons), odd_reasons)
ib_tr = [instance("inbox", 7, n) for n in range(1, 13)]
ib_fp = fpm.learn([i for i, _ in ib_tr])
ib_fresh = [instance("inbox", 7, n)[0] for n in range(50, 60)]
check("P.4 new email wording with no new symbols stays familiar (control)", sum(fpm.check(i, ib_fp) is None for i in ib_fresh) >= 6,
      [fpm.check(i, ib_fp) for i in ib_fresh])
euro = json.loads(json.dumps(ib_tr[0][0])); euro["emails"][0]["body"] += " Total €12."
check("P.5 an unseen currency symbol is unfamiliar", "unfamiliar character" in (fpm.check(euro, ib_fp) or ""))
inv_tr = [instance("invoice", 7, n) for n in range(1, 13)]
out_fp = fpm.learn([e for _, e in inv_tr], outputs=True)
check("P.6 an approved invoice passes the answer check", all(fpm.check(e, out_fp) is None for _, e in inv_tr))
empty = dict(inv_tr[0][1], items=[], subtotal=0.0, total=0.0)
check("P.7 an invoice with no items fails the answer check (control)", fpm.check(empty, out_fp) is not None)
few_fp = fpm.learn([e for _, e in inv_tr[:3]], outputs=True)
check("P.8 'never empty' from only 3 answers is not evidence (no over-trip)", fpm.check(empty, few_fp) is None, fpm.check(empty, few_fp))
late = json.loads(json.dumps(fresh[0]))
late["events"].append({"id": "e999", "title": "Standup", "start": late["events"][0]["start"][:11] + "16:00:00-04:00",
                       "end": late["events"][0]["start"][:11] + "17:00:00-04:00"})
check("P.9 a 17:00 end on a weekday is familiar (the hour rule is gone)", fpm.check(late, in_fp) is None, fpm.check(late, in_fp))
num_fp = fpm.learn([{"total": 1.5}, {"total": 2.25}], outputs=True)
check("P.10 a whole-number 0 is the same kind as 1.5 (no type nitpick)", fpm.check({"total": 0}, num_fp) is None, fpm.check({"total": 0}, num_fp))
check("P.11 a string where numbers were is still unfamiliar (control)", fpm.check({"total": "12"}, num_fp) is not None)
odd_cal_routes = [ladder(FakeBrain(json.dumps({"clashes": [], "alternatives": [], "message": "x"})), "calendar",
                         instance("calendar", 7, j, odd=True)[0], make_habit(CAL_HABIT.replace('return "weekend"', 'return None')
                         .replace('return "unfamiliar event"', 'return None').replace('return "unfamiliar time format"', 'return None'), cal_tr)).route
                  for j in range(1, 7)]
check("L.5 even with a guard that lets everything through, odd calendars fall back", all(r == "fallback" for r in odd_cal_routes), odd_cal_routes)

# ── the big brain's reply is checked, never trusted (the 09-30 inbox lesson)
from harness import big_brain_answer
class Scripted:
    def __init__(self, text, finish="stop"):
        self.text, self.finish = text, finish
    def chat(self, messages, purpose, max_tokens=8000):
        return {"text": self.text, "total": 10, "finish": self.finish}
cut = '```json\n{"needs_reply": [{"id": "m06", "from_name": "Maya", "body": "Hi"}, {"id": "m'
out, _, note = big_brain_answer(Scripted(cut, "length"), "inbox", instance("inbox", 7, 1)[0])
check("R.1 a reply cut off mid-object is no answer, not an inner object", out is None and note == "truncated", (out, note))
out, _, note = big_brain_answer(Scripted('{"id": "m01", "body": "x"}'), "inbox", instance("inbox", 7, 1)[0])
check("R.2 a reply without the expected keys is no answer", out is None and note.startswith("missing keys"), (out, note))
good_inbox = instance("inbox", 7, 1)[1]
out, _, note = big_brain_answer(Scripted(json.dumps({**good_inbox, "headline": "h"})), "inbox", instance("inbox", 7, 1)[0])
check("R.3 a complete reply is accepted (control)", out is not None and note == "", note)

class Down:
    model = "down"
    def chat(self, *a, **k):
        raise brain_mod.BrainError("503 high demand")
chain = brain_mod.FreeChain([Down(), Scripted("ok")])
check("R.4 the free chain hands over when a seat keeps failing", chain.chat([], "x")["text"] == "ok")
try:
    brain_mod.FreeChain([Down(), Down()]).chat([], "x")
    check("R.5 an all-down chain raises (never answers empty)", False)
except brain_mod.BrainError:
    check("R.5 an all-down chain raises (never answers empty)", True)

# ── outages: a skipped day is not a wrong day; a dead fuzzy seat does not void a habit
fb_down = Down()
r = ladder(fb_down, "calendar", inp, HAB)
check("O.1 a habit's answer survives a dead fuzzy seat", r.route == "habit" and same("calendar", r.output, exp), (r.route, r.reason))

# ── absorb before re-teaching
import argparse, tempfile
from pathlib import Path
from fixtures import calendar_oracle
from run_spike import can_absorb, run_task
case = instance("calendar", 7, 5)
check("A.1 a habit that gets an approved case right can absorb it", can_absorb("calendar", HAB, case))
check("A.2 a lying habit cannot absorb a case (control)", not can_absorb("calendar", dict(HAB, code=LIAR), case))
check("A.3 no habit, nothing to absorb", not can_absorb("calendar", None, case))


class OracleBrain:
    model = "oracle"
    def chat(self, messages, purpose, max_tokens=8000):
        if "fuzzy" in purpose:
            return {"text": '{"message": "ok"}', "total": 50, "finish": "stop", "latency_s": 0}
        body = messages[-1]["content"]
        inp = json.loads(body[body.rindex("```json") + 7: body.rindex("```")])
        return {"text": json.dumps({**calendar_oracle(inp), "message": "x"}), "total": 1000, "finish": "stop", "latency_s": 0}


class CountingTeacher:
    model = "teacher"
    def __init__(self, code):
        self.code, self.calls = code, 0
    def chat(self, messages, purpose, max_tokens=8000):
        self.calls += 1
        return {"text": "```python\n" + self.code + "\n```", "total": 500, "finish": "stop", "latency_s": 0}


import run_spike as rs


def planted(task, seed, n, odd=False):
    """Seed 7's calendars, but from day 4 one event is titled "Wrap-up": a title shape never seen
    before (familiarity trips) that the habit handles fine (titles never change the answer)."""
    i, e = instance(task, seed, n, odd)
    if n >= 4 and not odd and i["events"]:
        i = json.loads(json.dumps(i))
        i["events"][0]["title"] = "Wrap-up"
    return i, e


def run_planted(absorb: bool):
    t = CountingTeacher(CAL_HABIT)
    real_inst, real_absorb = rs.instance, rs.can_absorb
    rs.instance = planted
    if not absorb:
        rs.can_absorb = lambda *a, **k: False
    try:
        with tempfile.TemporaryDirectory() as td:
            out = run_task("calendar", OracleBrain(), t, argparse.Namespace(seed=7, days=6, heldout=1, odd=1, min_traces=3), Path(td))
    finally:
        rs.instance, rs.can_absorb = real_inst, real_absorb
    return out, t.calls


rr, calls = run_planted(absorb=True)
d4, d5 = rr["days"][3], rr["days"][4]
check("A.4 day 4: the new title shape trips familiarity and falls back", d4["route"] == "fallback" and "Aa-a" in d4["reason"], d4)
check("A.5 night 4 absorbs it with no teacher call", any(n.get("absorbed") and n["after_day"] == 4 for n in rr["nights"]) and calls == 1,
      (rr["nights"], calls))
check("A.6 day 5: the habit now answers the same new shape", d5["route"] == "habit" and d5["correct"], d5)
rc, calls_c = run_planted(absorb=False)
# Without absorbing, night 4 falls through to a recompile: the teacher is paid again (and its habit then
# learns the shape too). Absorbing gets the same day-5 answer for one teacher call fewer.
check("A.7 without absorbing, the same widening costs a second teacher call (control)",
      calls_c == calls + 1 and rc["days"][4]["route"] == "habit", (calls_c, calls, rc["days"][4]["route"]))

# ── metrics (controls: G4 must fail when a planted odd case is answered wrongly)
days = [{"day": d, "route": "big" if d <= 3 else "habit", "correct": True, "tokens": 3000 if d <= 3 else 200,
         "habit_steps": 0 if d <= 3 else 2, "steps": 3, "reason": ""} for d in range(1, 21)]
good = {"days": days, "nights": [{"after_day": 3, "promoted": True, "attempts": 1, "tokens": 9000, "failures": 0}],
        "heldout": [{"route": "habit", "correct": True}] * 10, "odd": [{"route": "fallback", "wrong": False, "reason": "x"}] * 5}
m = metrics("calendar", good)
check("M.1 a good run passes G1–G4", all(m[g] for g in ("G1", "G2", "G3", "G4")), m)
bad = dict(good, odd=good["odd"] + [{"route": "habit", "wrong": True, "reason": ""}])
check("M.2 one wrong odd answer fails G4 (control)", metrics("calendar", bad)["G4"] is False)
never = dict(good, heldout=[{"route": "fallback", "correct": False}] * 10)
check("M.3 a habit that never answers fails G2 (control)", metrics("calendar", never)["G2"] is False)
skipped = dict(good, days=good["days"] + [{"day": 21, "skipped": True, "reason": "503"}])
check("O.2 a skipped day stays out of the metrics", metrics("calendar", skipped) == metrics("calendar", good))

# ── spend safety
try:
    brain_mod.Brain("opus-paid")
    check("B.1 a paid seat is refused", False, "no error")
except brain_mod.BrainError:
    check("B.1 a paid seat is refused", True)
check("B.2 JSON is found with braces inside strings",
      brain_mod.extract_json('note {"a": "x}y", "b": {"c": 1}} tail') == {"a": "x}y", "b": {"c": 1}})

import datetime as _dt
from quiet import in_ash_gym_window, guard as _qguard
check("Q.1 04:44 (Ash's exam) is inside his gym window", in_ash_gym_window(_dt.datetime(2026, 10, 1, 4, 44)))
check("Q.2 14:00 is outside it (control)", not in_ash_gym_window(_dt.datetime(2026, 10, 1, 14, 0)))
try:
    _qguard(False, _dt.datetime(2026, 10, 1, 3, 0)); check("Q.3 a heavy run refuses to start at 03:00", False)
except SystemExit:
    check("Q.3 a heavy run refuses to start at 03:00", True)
_qguard(True, _dt.datetime(2026, 10, 1, 3, 0)); check("Q.4 --force overrides it (owner's call)", True)

print(f"\n{'ALL PASS' if not FAILS else f'{FAILS} FAILED'}")
sys.exit(1 if FAILS else 0)
