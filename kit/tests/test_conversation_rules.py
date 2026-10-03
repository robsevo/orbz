#!/usr/bin/env python3
"""A real conversation's rules, by code (PLAN 4.7_t): orbs_kit/voicebox.py's decisions on what
Whisper wrote, with no model asked, so every rule is pinned and every case is one that happened.

  CR.1 what was said over him (_classify): his own words coming back never stop him; a stop word
       does; a burst too short for a sentence is an "mhm" whatever Whisper wrote for it ("Have a
       day." for a 0.34 s "mhm", the app's own test, 10-03); his name, past a burst, stops him
  CR.2 Whisper's doubt (_doubt): a long sentence heard badly, or a phantom; never a short line
       ("And three and three." scored low in the app, 10-03, and was said plainly)
  CR.3 a thought still going (_trails): a weak last word or "...", a question may end on a
       preposition, a number is a word
  CR.4 plain spoken English (plain): the spec's words swapped, a long sentence split, nothing that
       is not sure to be right"""
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT))
from orbs_kit import voicebox as vb  # noqa: E402

FAIL = []


def ok(cond, label):
    print(f"{'PASS' if cond else 'FAIL'}  {label}")
    if not cond:
        FAIL.append(label)


SAYING = "Hold on, I am checking your calendar for tomorrow now. Two and two make four."

# ── CR.1 what was said over him ──────────────────────────────────────────────────────────────────────
CASES = [
    # (what Whisper wrote, seconds voiced, what it is)
    ("Hold on, I am checking your calendar", 1.8, "echo"),     # his own "hold on", coming back
    ("Two and two make four.", 1.2, "echo"),
    ("Wait.", 0.3, "interrupt"),                               # a stop word: short or long
    ("Wait, what about the sun?", 1.4, "interrupt"),
    ("Have a day.", 0.34, "backchannel"),                      # Whisper's words for a short "mhm" (10-03)
    ("Hazel.", 0.4, "backchannel"),                            # its prompt's name, for a sound it could not place
    ("Hi. Hi.", 0.28, "backchannel"),
    ("Mm-hmm.", 0.5, "backchannel"),
    ("Yeah, right.", 0.8, "backchannel"),                      # short, and only "mhm" words
    ("Hazel, can you", 1.0, "interrupt"),                      # his name, past a burst
    ("Hazel?", 0.7, "interrupt"),                              # ...even alone
    ("Can you check the weather for Saturday instead?", 1.5, "interrupt"),
    ("Hermit.", 1.6, "interrupt"),                             # a long stretch of voice, whatever was written
    ("", 0.1, "nothing"),
]
for words, voiced, want in CASES:
    got = vb._classify(words, voiced, "Hazel", SAYING)
    ok(got == want, f"CR.1 {words!r} over {voiced} s is {want}: {got}")
ok(vb._classify("Hold on, I am checking your calendar", 1.8, "Hazel", "Something else entirely.") == "interrupt",
   "CR.1 CONTROL: the same 'hold on', over other words of his, is yours")

# ── CR.2 Whisper's doubt ─────────────────────────────────────────────────────────────────────────────
words = lambda text, p: [(w if i == 0 else f" {w}", p) for i, w in enumerate(text.split(" "))]  # noqa: E731  (Whisper's words carry their space)
words8 = "We are almost in the air, just in the lack of noise."
ok(vb._doubt(words(words8, 0.45)) == (words8, True), "CR.2 a long sentence heard at 0.45 is doubted")
ok(vb._doubt(words(words8, 0.9)) == (words8, False), "CR.2 the same, heard at 0.9, is not")
ok(vb._doubt(words("And three and three.", 0.4)) == ("And three and three.", False), "CR.2 a short line is never doubted on its score")
ok(vb._doubt(words("Thanks for watching!", 0.95)) == ("", True), "CR.2 a phantom is doubted, however sure Whisper was")
ok(vb._doubt([]) == ("", False), "CR.2 nothing heard is not a doubt (a cough: nothing is said)")

# ── CR.3 a thought still going ───────────────────────────────────────────────────────────────────────
TRAILS = {"I want to book a table for.": True, "I want to book a table for...": True, "Can you send the report to Sam and?": True,
          "Let me see. Um.": True, "What is it for?": False, "I think so.": False, "Turn the lights on.": False,
          "I'd love to.": False, "Hey Hazel, what is 2 and 2?": False, "": False}
for text, want in TRAILS.items():
    ok(vb._trails(text) is want, f"CR.3 {text!r} {'trails' if want else 'does not trail'}")

# ── CR.4 plain spoken English ────────────────────────────────────────────────────────────────────────
ok(vb.plain("Prior to commencing, ensure the reservoir is full.") == "Before starting, make sure the reservoir is full.", "CR.4 the spec's own examples")
ok(vb.plain("We utilize approximately 10 litres in order to start.") == "We use about 10 litres to start.", "CR.4 and its kin")
ok(vb.plain("However, the pump requires an additional check.") == "But the pump needs another check.", "CR.4 'However,' and 'an additional'")
long = ("I looked through your calendar for the whole of next week and found that Tuesday is busy with three meetings, "
        "and Wednesday is completely free apart from a dentist appointment in the morning at nine.")
ok(all(len(s.split()) <= vb.LONGEST_WORDS for s in vb.plain(long).split(". ")), "CR.4 a long sentence is split where it can be")
for kept in ("The additional cost is fine; it is therefore true.", "He demonstrated it and was well informed.", "Make the purchase."):
    ok(vb.plain(kept) == kept, f"CR.4 left as written (a word with two jobs): {kept!r}")

print("ALL PASS" if not FAIL else f"{len(FAIL)} FAILED")
sys.exit(1 if FAIL else 0)
