#!/usr/bin/env python3
"""learn_gate — what must never be learned, refused in code (PLAN 20.3).

A rule that lives only in the constitution competes with everything else in context and
loses (hard rule 5). So the five do-not-capture classes are a gate in front of the store,
not a paragraph in a prompt.

Every refusal is RECORDED with its class. A candidate silently dropped and one never
proposed look identical from outside, and the difference is whether the loop is working at
all — the same reason `voice_distill` distinguishes "nothing durable here" from "the
judgement failed" (D63).

The classes, each a mechanism rather than a taste:

  env        a missing binary, a fresh-install error, an unconfigured credential. The user
             can fix these; they are not durable rules.
  negative   "X is broken", "that doesn't work". These harden into refusals the agent cites
             against itself long after the problem was fixed. This project has paid for it
             twice: D10's watchdog fixtures read out as fact, and `bypassPermissions`, which
             CLAUDE.md records as having been "written down wrong once".
  transient  an error that resolved on retry. If the retry worked, the lesson is the retry.
  oneoff     a single request is not a class of work.
  deadend    an unverified sequence of failures written up as validated guidance that a
             future session will trust and repeat.

And the positive form, which is the point: when a tool failed because of SETUP STATE, the
durable thing is the FIX, never the constraint. `verdict()` says so in its reason, so a
refusal tells the writer what to capture instead of only what not to.

This gate is deliberately narrow. A wall that refuses everything is indistinguishable from a
loop that never learned, so every pattern here has to be a mechanism you can point at, and
the suite requires a legitimate durable lesson to pass through untouched.
"""
import re

# Each entry: (class, compiled pattern, what to capture instead).
# Patterns match the candidate's TEXT — name, description and body together — lowercased.
RULES = [
    ("env", re.compile(
        r"\b(command not found|no such file or directory|not installed|is not installed"
        r"|not on (the )?path|missing (binary|dependency|package)|fresh install"
        r"|unconfigured|no api key|api key (is )?(missing|not set)|permission denied)\b"),
     "the FIX that made it work, not the state it was in"),

    ("negative", re.compile(
        r"\b(is broken|are broken|is buggy|does ?n[o']t work|doesn t work|never works"
        r"|is unreliable|can ?n[o']t be used|is unusable|always fails|is useless)\b"),
     "what the tool DOES do, or the conditions it needs"),

    ("transient", re.compile(
        r"\b(worked on( the)? (second|third|next) (try|attempt)|after (a )?retry"
        r"|retrying fixed|succeeded on retry|flaky|intermittent(ly)?|transient)\b"),
     "the retry itself, if the retry is the lesson"),

    ("oneoff", re.compile(
        r"\b(this time|today i|for this (one |single )?(task|request|job)"
        r"|the user asked me to|in this session|just now)\b"),
     "the general rule, if one turn really demonstrated a class of work"),

    # The learner layer's hard boundary, and it is a boundary rather than a taste: that
    # layer holds what the teaching half observes, and "what he found hard" is one short step
    # from "what he is like". A store that records the second is a different product, and
    # nobody chose it. The track says gated in code, not asked for in a prompt — so it is
    # here, in front of the store, like the other five.
    ("sensitive", re.compile(
        r"\b(iq\b|intelligen(t|ce)|smart(er|est)?\b|stupid|slow learner|gifted"
        r"|adhd|add\b|autis(m|tic)|dyslexi[ac]|depress(ed|ion)|anxiet|anxious|bipolar"
        r"|ocd\b|diagnos(ed|is)|medicat(ed|ion)|therapy|therapist|disorder|disabilit"
        r"|mental health|personality type|neurotic|lazy|unmotivated)\b"),
     "what was demonstrated, and what came next — never what it says about the person"),

    ("deadend", re.compile(
        r"\b(then i tried|i tried .{0,40}(then|and then)|did ?n[o']t help"
        r"|that also failed|gave up|eventually gave up|none of (these|them) worked)\b"),
     "only what was VERIFIED to work"),
]


def text_of(candidate):
    """Name, description and body as one lowercased string. A rule hidden in the body is
    still the rule being learned."""
    if isinstance(candidate, str):
        return candidate.lower()
    parts = [str(candidate.get(k, "") or "") for k in ("name", "description", "body")]
    return " ".join(parts).lower()


def verdict(candidate):
    """(ok, klass, reason). `ok` False means refuse.

    Returns the FIRST class that matches, in the order above: the classes overlap by nature
    ("command not found, so the tool is broken" is both env and negative), and reporting one
    reason a person can act on beats reporting three.
    """
    t = text_of(candidate)
    if not t.strip():
        return False, "empty", "a candidate with no text is not a fact"
    for klass, rx, instead in RULES:
        m = rx.search(t)
        if m:
            return (False, klass,
                    f"{klass}: matched {m.group(0)!r} — capture {instead}")
    return True, "", ""


def classes():
    return [k for k, _, _ in RULES]
