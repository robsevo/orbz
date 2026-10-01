#!/usr/bin/env python3
"""learner_model — what the lessons taught, bounded by a gate (PLAN 25.1-25.3).

The fifth layer, and the one only Ash can have: it is what the teaching half produces.
Concepts demonstrated, misconceptions actually hit, preferred pace and visual style, evidence
of mastery — **captured from the lesson routes where it is observed, never inferred from
ordinary conversation.** Someone being quiet in a chat is not someone struggling.

**The boundary is an allowlist, refused in code.** Hard rule 5: a boundary this consequential
cannot live in prose that competes with everything else in context. A mastery observation may
contain only the kinds listed in `ALLOWED`, and may never carry intelligence, personality
pathology, health or any sensitive trait — `learn_gate`'s `sensitive` class is the second
line, and this allowlist is the first: one says what is forbidden, the other says what is
permitted, and only the second is safe when somebody invents a new way to phrase it.

**25.3 is the row that decides whether this layer earns its place.** A stored teaching
preference must measurably change the next lesson's pace or presentation *without changing a
single fact it asserts*. If it cannot be shown to do that, the layer is decoration and should
be dropped rather than kept for its own sake — so `plan_lesson` exists to be measured, and
its facts are deliberately independent of the preference.
"""
import re

# What a mastery observation MAY be about. An allowlist, not a denylist: a denylist is only as
# good as the last thing somebody thought of.
ALLOWED = {
    "concept":        "a concept that was demonstrated on the canvas",
    "misconception":  "a specific wrong answer actually given, and what it was",
    "pace":           "how fast the steps went and whether they landed",
    "style":          "which presentation worked — arrows, colour, side-by-side",
    "mastery":        "evidence a concept was used correctly afterwards",
}

# Where a mastery observation may COME FROM. A lesson is observation; a chat is not.
LESSON_ROUTES = {"lesson", "canvas", "tutor", "practice"}

# The forbidden categories, by class, so a refusal can say WHICH line it crossed. The
# allowlist above already refuses anything not named; this exists so the refusal is
# informative rather than merely negative.
FORBIDDEN = [
    ("intelligence", re.compile(
        r"\b(iq\b|intelligen(t|ce)|smart(er|est)?|clever|stupid|dumb|slow learner"
        r"|gifted|talent(ed)?|bright|thick)\b", re.I)),
    ("pathology", re.compile(
        r"\b(adhd|add\b|autis(m|tic)|dyslexi[ac]|ocd\b|bipolar|narcissis|neurotic"
        r"|personality (type|disorder)|disorder|lazy|unmotivated|careless)\b", re.I)),
    ("health", re.compile(
        r"\b(depress(ed|ion)|anxiet|anxious|medicat(ed|ion)|therap(y|ist)|diagnos(ed|is)"
        r"|disabilit|illness|mental health|tired all the time|insomnia)\b", re.I)),
    ("demographic", re.compile(
        r"\b(his age|her age|years old|gender|ethnicit|religio|nationalit|immigrant"
        r"|married|divorced|children at home)\b", re.I)),
]


class Refused(ValueError):
    """A mastery observation the allowlist or a forbidden class turned away."""


def check(kind, text, *, route):
    """(ok, reason). Raises nothing — the caller decides what to do with a refusal."""
    if route not in LESSON_ROUTES:
        return False, (f"route {route!r} is not a lesson — this layer is captured where it is "
                       f"OBSERVED, never inferred from ordinary conversation. Someone being "
                       f"quiet in a chat is not someone struggling.")
    if kind not in ALLOWED:
        return False, (f"{kind!r} is not something the learner layer may hold. It may be one "
                       f"of {sorted(ALLOWED)} — an allowlist, because a denylist is only as "
                       f"good as the last thing somebody thought of.")
    body = str(text or "")
    if not body.strip():
        return False, "an empty observation is not an observation"
    for klass, rx in FORBIDDEN:
        m = rx.search(body)
        if m:
            return False, (f"{klass}: {m.group(0)!r}. The learner layer may never infer "
                           f"intelligence, personality pathology, health or any sensitive "
                           f"trait. Record what was DEMONSTRATED and what came next.")
    return True, ""


def observe(kind, text, *, route, store=None, **kw):
    """Record one observation through `store` (a `learning.Candidates`), or raise."""
    ok_, why = check(kind, text, route=route)
    if not ok_:
        raise Refused(why)
    if store is None:
        return None
    return store.observe(type_="mastery", name=f"{kind}-{abs(hash(text)) % 100000}",
                         body=text, source_events=kw.get("events", []),
                         source_class=kw.get("source_class", "ashd"),
                         explicit=False, confidence=kw.get("confidence"))


# ── 25.3: does a stored preference actually change a lesson? ─────────────────────────
FACTS = {
    "union-find": [
        "union-by-rank keeps the tree shallow",
        "path compression flattens the tree on find",
        "the two together give near-constant amortised time",
    ],
}


def plan_lesson(topic, prefs=None):
    """A lesson plan for `topic`, shaped by `prefs`. Returns {facts, steps, pace, style}.

    **The facts are independent of the preference, by construction.** 25.3's whole question
    is whether a preference changes the PRESENTATION without changing what is asserted — and
    a plan that let preferences reach the facts could not answer it.
    """
    facts = list(FACTS.get(topic, []))
    p = dict(prefs or {})
    pace = p.get("pace", "normal")
    style = p.get("style", "plain")

    steps = []
    for f in facts:
        if pace == "slow":
            steps.append({"say": f, "dwell_s": 8, "recap": True})
        elif pace == "fast":
            steps.append({"say": f, "dwell_s": 2, "recap": False})
        else:
            steps.append({"say": f, "dwell_s": 4, "recap": False})
        if style == "arrows":
            steps[-1]["draw"] = "arrows"
        elif style == "side-by-side":
            steps[-1]["draw"] = "two-panes"
    return {"facts": facts, "steps": steps, "pace": pace, "style": style}


def asserted_facts(plan):
    """Exactly what a plan claims, in order — the thing that must NOT vary."""
    return [s["say"] for s in plan["steps"]]


def presentation(plan):
    """Everything about a plan that is not a fact."""
    return [(s.get("dwell_s"), s.get("recap"), s.get("draw")) for s in plan["steps"]]
