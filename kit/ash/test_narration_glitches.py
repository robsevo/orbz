#!/usr/bin/env python3
"""What he says while he works reads like a person said it (2026-09-27, take 7).
Run: orb/daemon/.venv/bin/python orb/daemon/test_narration_glitches.py

Two lines heard that afternoon, both made by the shaping in spoken_choice.strip_machinery rather
than by the model:

    "I'm running a production build to the check for TypeScript and Vite errors."
        `_PREP_ARTICLE` gives a singular noun after a preposition its article, and "check" is on
        its noun list — but after "to" it is nearly always the verb.
    "I'm checking if the project setup project creation tool is available in PATH ..."
        "ashnew" became "the project setup", and the words he had already put after it stayed.

  NG.1  "to check / to test / to build / to list" keep their verb
  NG.2  "to file / in browser / to folder" still get their article (the rule still does its job)
  NG.3  "ashnew project creation tool" is said once, as "the project setup tool", never "the the"
  NG.4  a heading or a bullet list ends what is said: "live at the link Features Implemented" (take 9)
  NG.5  a port at the end of a sentence is not taken for an orphan list number
  NG.6  the engine's "(no reply was written: …" header is machinery, never said (take 10)
  NG.0  CONTROL: the committed spoken_choice.py makes both glitches from the same lines
"""
import subprocess
import sys
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import spoken_choice as sc  # noqa: E402

FAIL = []


def ok(cond, label):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}")
    if not cond:
        FAIL.append(label)


VERB_LINES = {
    "Run production build to check for TypeScript and Vite errors": "to check for",
    "Run the suite to test the new parser": "to test the",
    "Use vite to build the page": "to build the",
    "Run ls to list the files": "to list the",
}
for line, keep in VERB_LINES.items():
    got = sc.strip_machinery(line)
    ok(keep in got and "to the " + keep.split()[1] not in got, f"NG.1 {line!r} -> {got!r}")

for line, want in {"Save the result to file": "to the file", "Open the page in browser": "in the browser",
                   "Go to folder": "to the folder"}.items():
    got = sc.strip_machinery(line)
    ok(want in got, f"NG.2 the article still lands on a real noun: {line!r} -> {got!r}")

for line in ("Check if ashnew project creation tool is available in PATH",
             "Check if the ashnew tool is available",
             "Check that ashnew setup script exists"):
    got = sc.strip_machinery(line)
    ok(got.count("project setup") == 1 and "the the" not in got and "project setup project" not in got
       and "ashnew" not in got.lower(), f"NG.3 {line!r} -> {got!r}")

REPORTS = {
    "The system monitor dashboard is live at http://localhost:5173\n\n**Features Implemented**\n- Live CPU chart\n": "Features",
    "The dashboard is live at http://localhost:5173\n\n## What I built\n- Live CPU chart\n": "What I built",
    "I built the snake game. It speeds up as you eat.\n- arrow keys to move\n- space to pause": "arrow keys",
}
for rep, leak in REPORTS.items():
    got = sc.from_report(rep)
    ok(leak not in got and len(got.split()) >= 4, f"NG.4 the heading and the list under it are not said: {got!r}")
H6 = "(no reply was written: the text below is this seat's own reasoning, promoted so the work isn't lost."
got6 = (sc.strip_machinery(H6), sc.strip_machinery(H6 + ") I checked the grid and the pads play."))
ok(got6 == ("", "I checked the grid and the pads play."),
   f"NG.6 the engine's header on promoted reasoning is never said, and what follows it is: {got6}")
got5 = sc.from_report("The page is live at http://localhost:5173.\nFeatures:\n- one\n")
ok("5173" in got5, f"NG.5 the port stays in the sentence: {got5!r}")

old_src = __import__("carried_git").show("7c9ddd1:orb/daemon/spoken_choice.py").stdout
if not old_src:
    ok(False, "NG.0 CONTROL: could not read spoken_choice.py at HEAD")
else:
    old = types.ModuleType("spoken_choice_head")
    old.__file__ = str(HERE/"spoken_choice.py")
    exec(compile(old_src, "spoken_choice_head", "exec"), old.__dict__)
    a = old.strip_machinery("Run production build to check for TypeScript and Vite errors")
    b = old.strip_machinery("Check if ashnew project creation tool is available in PATH")
    ok("to the check" in a and "project setup project creation tool" in b,
       f"NG.0 CONTROL: the committed rules make both glitches, so NG.1 and NG.3 can fail: {a!r} / {b!r}")
    c = old.from_report("The system monitor dashboard is live at http://localhost:5173\n\n**Features Implemented**\n- Live CPU chart\n")
    ok("Features" in c, f"NG.0 CONTROL: the committed from_report says the heading, so NG.4 can fail: {c!r}")
    h = old.strip_machinery(H6)
    ok("no reply was written" in h, f"NG.0 CONTROL: the committed strip_machinery says the header, so NG.6 can fail: {h!r}")

if FAIL:
    print(f"\nFAIL  narration glitches  ({len(FAIL)} failing)")
    raise SystemExit(1)
print("\nPASS  narration glitches  (0 failing)")
