#!/usr/bin/env python3
"""What must never be learned. Run: orb/daemon/.venv/bin/python orb/daemon/test_learn_gate.py

PLAN 20.3. Five classes, refused in code before a candidate is stored — not a paragraph in a
prompt, because a rule that lives only in the constitution competes with everything else in
context and loses (hard rule 5).

**THE CONTROL IS THE ROW**, and 20.3_t says so: one planted candidate per class, each refused
for the RIGHT class, and disabling the gate must turn all five red. A legitimate durable
lesson must still pass, or the gate is a wall rather than a filter — and a wall is
indistinguishable from a loop that never learned anything.

The two classes this project has already paid for are `negative`: D10's watchdog fixtures
were read out as fact, and `bypassPermissions` is recorded in CLAUDE.md as having been
"written down wrong once". A false belief about a tool outlives the problem it came from.
"""

# ASH_TIER: product
import json, os, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import learn_gate as g                                          # noqa: E402

FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


# ── LG.0  one planted candidate per class, refused for the RIGHT class ───────────────
PLANTED = [
    ("env", {"name": "npm-missing", "description": "npm is not installed on this machine",
             "body": "Running ashnew failed until it was installed."}),
    ("env", {"name": "no-key", "description": "the api key is missing",
             "body": "Every call 401'd."}),
    ("negative", {"name": "browser-broken", "description": "the browser tool is broken",
                  "body": "pagepoint returned nothing, so it does not work."}),
    ("negative", {"name": "cant-use-it", "description": "winplace is unreliable",
                  "body": "It always fails on this box."}),
    ("transient", {"name": "retry-worked", "description": "it worked on the second try",
                   "body": "The first call timed out."}),
    ("transient", {"name": "flaky-seat", "description": "that seat is flaky",
                   "body": "Sometimes a 429."}),
    ("oneoff", {"name": "todays-chart", "description": "the user asked me to build a chart",
                "body": "So I built one."}),
    ("oneoff", {"name": "this-session", "description": "in this session we renamed the tree",
                "body": "It went fine."}),
    # The learner layer's hard boundary. "What he found hard" is one short step from "what
    # he is like", and a store that records the second is a different product nobody chose.
    ("sensitive", {"name": "learner-note", "description": "he seems like a slow learner",
                   "body": "Took three passes on recursion."}),
    ("sensitive", {"name": "why-short-lessons", "description": "the user has ADHD",
                   "body": "So keep each step brief."}),
    ("deadend", {"name": "a-workflow", "description": "how to fix the router",
                 "body": "I tried restarting, then I tried the cache, none of them worked."}),
    ("deadend", {"name": "gave-up", "description": "the approach for wake tuning",
                 "body": "Lowered the threshold, that also failed, eventually gave up."}),
]
for want, cand in PLANTED:
    allowed, klass, why = g.verdict(cand)
    ok(not allowed, f"LG.0 {cand['name']!r} must be refused — it is a {want} candidate")
    ok(klass == want,
       f"LG.0 {cand['name']!r} refused as {klass!r}, expected {want!r}. Refusing for the "
       f"wrong reason tells the writer to fix the wrong thing: {why}")
    ok(why and "capture" in why,
       f"LG.0 the refusal says what to capture INSTEAD, not only what not to: {why!r}")

ok(len({w for w, _ in PLANTED}) == len(g.classes()),
   f"LG.0 every class the gate defines has a planted candidate: gate has {g.classes()}, "
   f"planted {sorted({w for w, _ in PLANTED})}")

# ── LG.1  a legitimate durable lesson passes untouched ───────────────────────────────
# A gate that refuses everything is a wall, and a wall looks exactly like a loop that never
# learned. These are the shapes this store is FOR.
KEEP = [
    {"name": "user-likes-short-answers", "type": "feedback",
     "description": "Keep spoken replies to one or two sentences",
     "body": "He asked twice for shorter answers. Why: long spoken lines are unlistenable."},
    {"name": "prefers-terminal-left", "type": "user",
     "description": "The terminal goes on the left, the page on the right",
     "body": "Stated when the layout was first set up, and again on 2026-09-15."},
    {"name": "chart-template-needs-no-install", "type": "project",
     "description": "ashnew chart renders with no install step",
     "body": "The template ships its own venv. Why: a build that installs is a build that waits."},
    {"name": "wake-threshold-half", "type": "reference",
     "description": "The wake threshold that works on this mic is 0.5",
     "body": "Measured across a --wav stream test, not from training recall."},
    # The learner layer's legitimate shape: what was DEMONSTRATED and what came next. If the
    # sensitive class turned these away it would be a wall, and the teaching half would have
    # nothing it is allowed to record.
    {"name": "union-find-needs-arrows", "type": "project",
     "description": "The union-find lesson needs the arrows spelled out",
     "body": "He asked what the arrows meant; describe() now says it. Why: union-by-rank "
             "hides path compression."},
    {"name": "asked-for-path-compression", "type": "project",
     "description": "He asked for path compression to be shown separately",
     "body": "Shown as its own step since 2026-09-17."},
]
for cand in KEEP:
    allowed, klass, why = g.verdict(cand)
    ok(allowed,
       f"LG.1 {cand['name']!r} is a durable lesson and must PASS — refused as {klass!r}: "
       f"{why}. A gate that turns these away is a wall, not a filter.")

# ── LG.2  the rule is matched wherever it hides ──────────────────────────────────────
# A candidate whose name and description are clean and whose BODY carries the claim is still
# the claim being learned.
buried = {"name": "router-notes", "description": "notes on the router",
          "body": "Short version: the failover is broken and does not work."}
allowed, klass, _ = g.verdict(buried)
ok(not allowed and klass == "negative",
   f"LG.2 a claim buried in the body is caught: {klass!r}")

ok(not g.verdict({"name": "", "description": "", "body": ""})[0],
   "LG.2 an empty candidate is refused rather than stored")
ok(not g.verdict("the browser tool is broken")[0],
   "LG.2 a bare string candidate is handled too")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print(f"✓ learn gate: {len(PLANTED)} planted candidates refused by class, "
      f"{len(KEEP)} real lessons passed (LG.0 is the control)")
