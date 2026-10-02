#!/usr/bin/env python3
"""Habits in the kit (PLAN 1.4): a habit answers only when its three code checks agree, and its
model-written code runs walled off. HB.0 is the control: a familiar case IS answered, so every
refusal below is a refusal of something, not a habit that never answers."""
import sys
import tempfile
from pathlib import Path

from orbs_kit import habits

FAIL = []


def ok(cond, label, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {label}" + (f"  — {detail}" if detail and not cond else ""))
    if not cond:
        FAIL.append(label)


CODE = '''
def guard(inp):
    if inp["currency"] != "CAD":
        return "only CAD invoices"
    return None

def run(inp):
    return {"total": round(sum(l["qty"] * l["price"] for l in inp["lines"]), 2), "to": inp["client"]}
'''

APPROVED = [
    ({"client": f"Client {i}", "currency": "CAD",
      "lines": [{"qty": i + 1, "price": 10.5}, {"qty": 1, "price": 99.0}]},
     {"total": round((i + 1) * 10.5 + 99.0, 2), "to": f"Client {i}"})
    for i in range(12)
]

if habits.sandbox() is None:
    print("SKIP  no bubblewrap here: every habit falls through, which HB.7 checks instead")

with tempfile.TemporaryDirectory(prefix="orbs-habits-test-") as d:
    root = Path(d)
    h = root / "invoice"
    habits.save(h, CODE, APPROVED)

    def variant(name, code):
        v = root / name
        habits.save(v, code, APPROVED)
        return v

    familiar = {"client": "Client 99", "currency": "CAD", "lines": [{"qty": 3, "price": 10.5}]}
    if habits.sandbox() is not None:
        r = habits.answer(h, familiar)
        ok(r == {"answered": True, "output": {"total": 31.5, "to": "Client 99"}, "version": 1},
           "HB.0 CONTROL: a familiar case is answered, by the habit, correctly", r)

        r = habits.answer(h, {**familiar, "discount": 5})
        ok(not r["answered"] and r["why"].startswith("unfamiliar input") and "discount" in r["why"],
           "HB.1 an input with a key no approved case had falls through, before the habit runs", r)
        r = habits.answer(h, {**familiar, "client": "Clïent 7"})
        ok(not r["answered"] and "unfamiliar character" in r["why"], "HB.1b ...and so does a character never seen", r)

        r = habits.answer(variant("strict", CODE.replace('"CAD"', '"USD"')), familiar)
        ok(not r["answered"] and r["why"] == "its guard said no: only CAD invoices",
           "HB.2 the habit's own guard turns it away, and the reason is passed on", r)

        r = habits.answer(variant("negative", CODE.replace("return {\"total\": round(", "return {\"total\": -round(")), familiar)
        ok(not r["answered"] and "does not look like an approved one" in r["why"],
           "HB.3 an answer unlike every approved answer (a negative total) is not given", r)

        target = Path(__file__).resolve()          # a file that is really there, outside the sandbox
        ok(target.is_file() and target.is_relative_to(Path.home()),
           f"HB.4 CONTROL: {target} exists in the person's home, so a failed read is the wall")
        r = habits.answer(variant("snoop", CODE.replace(
            'def run(inp):', f'def run(inp):\n    open({str(target)!r}).read()')), familiar)
        ok(not r["answered"] and "FileNotFoundError" in r["why"],
           "HB.4 the habit cannot read the person's files: /home is empty in the sandbox", r)
        r = habits.answer(variant("net", CODE.replace(
            'def run(inp):', 'def run(inp):\n    import socket; socket.create_connection(("1.1.1.1", 53), timeout=2)')), familiar)
        ok(not r["answered"] and "raised" in r["why"], "HB.4b ...and has no network", r)

        r = habits.answer(variant("spin", CODE.replace('def run(inp):', 'def run(inp):\n    while True: pass')),
                          familiar, timeout=3)
        ok(not r["answered"] and ("past" in r["why"] or "sandbox failed" in r["why"]),
           "HB.5 a habit that never ends is stopped", r)

    r = habits.answer(root / "nothing-here", familiar)
    ok(not r["answered"] and "could not be read" in r["why"], "HB.6 a missing habit says so", r)

    saved = habits.sandbox
    habits.sandbox = lambda: None
    try:
        r = habits.answer(h, familiar)
        ok(not r["answered"] and "no habit sandbox" in r["why"],
           "HB.7 with no sandbox the habit does not run unwalled: it falls through and says why", r)
    finally:
        habits.sandbox = saved

# A step habit (PLAN 3.2): it stands in for a whole run, one call at a time.
STEPS = '''
def guard(inp):
    if not inp.get("data", {}).get("subject"):
        return "no subject to keep"
    return None

def step(inp, done):
    subject = inp["data"]["subject"]
    if len(done) == 0:
        return {"call": {"name": "read_file", "args": {"path": "bills.csv"}}}
    if len(done) == 1:
        return {"call": {"name": "remind", "args": {"kind": "bill", "title": subject, "due": "2026-10-06"}}}
    return {"output": "Kept " + subject + " for you."}
'''
RUNS = [{"text": f"New email: {s}", "data": {"trigger": "t1", "subject": s}} for s in ("Rent", "Gym", "Phone", "Water")]

with tempfile.TemporaryDirectory(prefix="orbs-steps-test-") as d:
    h = Path(d) / "bills"
    habits.save_steps(h, STEPS, RUNS)
    one = {"text": "New email: Power", "data": {"trigger": "t1", "subject": "Power"}}
    read = {"call": {"name": "read_file", "args": {"path": "bills.csv"}}, "result": "rent,1200\n", "isError": False}
    keep = {"call": {"name": "remind", "args": {"kind": "bill", "title": "Power", "due": "2026-10-06"}}, "result": "Kept (bill 3).", "isError": False}
    if habits.sandbox() is not None:
        r = [habits.step(h, one, []), habits.step(h, one, [read]), habits.step(h, one, [read, keep])]
        ok(r == [{"call": read["call"]}, {"call": keep["call"]}, {"output": "Kept Power for you."}],
           "HB.8 CONTROL: a step habit makes its calls, one at a time, then answers", r)
        r = habits.step(h, {**one, "data": {**one["data"], "cc": "x@y.z"}}, [])
        ok(r.get("refused", "").startswith("unfamiliar input"), "HB.9 an unfamiliar input is refused before the habit runs", r)
        r = habits.step(h, one, [], code=STEPS.replace("return {\"output\"", "return \"done\" or {\"output\""))
        r2 = habits.step(h, one, [read, keep], code=STEPS.replace('return {"output": "Kept " + subject + " for you."}', 'return "Kept it"'))
        ok(r == {"call": read["call"]} and r2 == {"refused": "it returned something that is not a step"},
           "HB.10 a tryout runs code not yet saved; what is not a call or an answer is refused", (r, r2))
        r = habits.step(Path(d) / "never-saved", one, [], code=STEPS, check_input=False)
        ok(r == {"call": read["call"]}, "HB.11 the gym's tryout needs no saved habit", r)
        target = Path(__file__).resolve()
        r = habits.step(h, one, [], code=STEPS.replace("def step(inp, done):", f"def step(inp, done):\n    open({str(target)!r}).read()"))
        ok("FileNotFoundError" in r.get("refused", ""), "HB.12 a step habit is walled off too: /home is empty", r)
    else:
        r = habits.step(h, one, [])
        ok("no habit sandbox" in r.get("refused", ""), "HB.8 with no sandbox a step habit does not run: it says why", r)

print("ALL PASS" if not FAIL else f"{len(FAIL)} FAILED")
sys.exit(1 if FAIL else 0)
