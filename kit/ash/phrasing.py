#!/usr/bin/env python3
"""phrasing — stop the tutor saying the same thing every time.

The judge is a language model, and asked to confirm a correct answer it reaches for one
opener and keeps reaching for it. On the 2026-09-17 lesson it opened with "Spot on." on
every single correct answer, which is the fastest way to make a tutor sound like a
template being read out. A prompt rule does not fix that — the model drifts back to the
phrase it likes — so the opener is removed here, in code, after the model has spoken.

What replaces it is usually nothing. A good tutor does not stop to congratulate you at
every step; they say the thing that was right and carry on. So about half the time the
response simply starts with its own substance, and the rest of the time it gets a short
acknowledgement drawn from a pool that will not repeat until the pool runs out.
"""
import random
import re
from collections import deque

# "Right." is deliberately not in here. The voice renders it as a homophone of "write",
# which is why it was cut from the narration openers too.
ACKS = ("That's it.",
        "Yes, exactly that.",
        "You've got it.",
        "That's the one.",
        "Correct.",
        "That's the part that matters.")

SILENT_SHARE = 0.45        # how often the response just gets on with it

_OPENER = re.compile(
    r"^\s*(?:"
    r"spot on|exactly(?:\s+right)?|precisely|perfect(?:ly)?|correct|that'?s (?:right|correct|it)|"
    r"that is (?:right|correct)|you'?(?:ve| have) got it|you got it|nailed it|bang on|"
    r"well done|nice(?:\s+one)?|good(?:\s+(?:one|job|answer))?|great|excellent|brilliant|"
    r"bingo|indeed|absolutely|yes|yep|yeah|right"
    r")\b[\s,!.:;—–-]*",
    re.I)

_recent = deque(maxlen=len(ACKS) - 1)


def strip_opener(text):
    """Drop a leading run of canned praise, however many of them the model stacked up.

    "Spot on. Exactly right — the root is 3." is one sentence of content behind two
    pieces of throat-clearing, so this loops rather than stripping once."""
    out = (text or "").strip()
    while True:
        cut = _OPENER.sub("", out, count=1)
        if cut == out:
            break
        out = cut.strip()
    return out[:1].upper() + out[1:] if out else ""


def pick_ack(rng=random):
    """An acknowledgement that is not one of the last few used."""
    fresh = [a for a in ACKS if a not in _recent] or list(ACKS)
    choice = rng.choice(fresh)
    _recent.append(choice)
    return choice


def acknowledge(text, correct=True, rng=random):
    """The tutor's reply to an answer, with the repetition taken out.

    A wrong answer never gets an acknowledgement — it is a hint, and prefixing a hint
    with praise is how a tutor teaches someone that the praise means nothing."""
    body = strip_opener(text)
    if not correct:
        return body or (text or "").strip()
    if not body:
        return pick_ack(rng)                  # the model said nothing but the praise
    if rng.random() < SILENT_SHARE:
        return body
    return f"{pick_ack(rng)} {body}"


def reset():
    """Forget what has been used — a new lesson starts with the whole pool available."""
    _recent.clear()
