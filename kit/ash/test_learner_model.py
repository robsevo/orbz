#!/usr/bin/env python3
"""The learner layer, bounded by a gate. Run: orb/daemon/.venv/bin/python orb/daemon/test_learner_model.py

PLAN 25.1–25.3.

LM.0 IS THE CONTROL, and 25.2_t states both halves: a planted candidate in **each** forbidden
category is refused BY CLASS, disabling the allowlist turns all of them red — **and a
legitimate mastery observation still passes, or the layer is closed rather than bounded.**

LM.3 is the row that decides whether this layer earns its place at all (25.3): a stored
preference must measurably change the next lesson's pace or presentation **without changing a
single fact it asserts**. Its control is the one that matters — with the preference ignored,
the two lessons must come out identical, or the difference being measured is noise.
"""

# ASH_TIER: product
import sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import learner_model as M                                       # noqa: E402

FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


# ── LM.0  THE CONTROL: each forbidden category, refused BY CLASS ─────────────────────
PLANTED = [
    ("intelligence", "he is not very bright about pointers"),
    ("intelligence", "seems like a slow learner on recursion"),
    ("pathology", "the user has ADHD so keep each step brief"),
    ("pathology", "he is just lazy about the exercises"),
    ("health", "he was anxious during the lesson"),
    ("health", "probably needs therapy for the frustration"),
    ("demographic", "at his age this is normal"),
    ("demographic", "he mentioned he is married with children at home"),
]
for klass, text in PLANTED:
    good, why = M.check("concept", text, route="lesson")
    ok(not good, f"LM.0 {text!r} must be refused — it is a {klass} inference")
    ok(why.startswith(klass),
       f"LM.0 and refused AS {klass!r}, so the refusal says which line it crossed: {why[:70]}")

# ── LM.1  a legitimate observation still passes ──────────────────────────────────────
# Otherwise the layer is CLOSED rather than bounded, and the teaching half has nothing it is
# allowed to record.
KEEP = [
    ("misconception", "said union-by-rank alone flattens the tree"),
    ("concept", "path compression was demonstrated with arrows on the canvas"),
    ("pace", "needed three passes on the recursion step before it landed"),
    ("style", "the side-by-side panes worked better than one diagram"),
    ("mastery", "used path compression correctly in the next exercise unprompted"),
]
for kind, text in KEEP:
    good, why = M.check(kind, text, route="lesson")
    ok(good,
       f"LM.1 {kind!r}: {text!r} must PASS — a layer that refuses everything is closed, not "
       f"bounded, and the teaching half then records nothing. Refused: {why}")

ok(set(M.ALLOWED) == {"concept", "misconception", "pace", "style", "mastery"},
   f"LM.1 the allowlist holds exactly what 25.1 names: {sorted(M.ALLOWED)}")

# ── LM.2  observed, never inferred ───────────────────────────────────────────────────
# Someone being quiet in a chat is not someone struggling.
for route in ("general", "chat", "terminal", "", None):
    good, why = M.check("pace", "he went quiet for a while", route=route)
    ok(not good, f"LM.2 route {route!r} cannot produce a mastery observation")
    ok("not a lesson" in why, f"LM.2 and says why: {why[:60]!r}")
for route in sorted(M.LESSON_ROUTES):
    good, _ = M.check("pace", "needed a second pass", route=route)
    ok(good, f"LM.2 CONTROL: {route!r} IS a lesson route — otherwise nothing can ever be "
             f"captured and the layer is unreachable")

# an unknown KIND is refused even from a lesson: an allowlist, not a denylist
for kind in ("mood", "attitude", "effort", "potential", "anything"):
    good, why = M.check(kind, "something", route="lesson")
    ok(not good, f"LM.2 {kind!r} is not in the allowlist")
    ok("allowlist" in why,
       f"LM.2 and the refusal says why it is an allowlist — a denylist is only as good as "
       f"the last thing somebody thought of: {why[:70]!r}")

# ── LM.3  a preference changes the lesson, and changes NO fact ───────────────────────
slow = M.plan_lesson("union-find", {"pace": "slow", "style": "arrows"})
fast = M.plan_lesson("union-find", {"pace": "fast", "style": "plain"})

ok(M.asserted_facts(slow) == M.asserted_facts(fast),
   f"LM.3 the two lessons agree on EVERY fact asserted, in order — a preference that changes "
   f"what is true is not a preference:\n      {M.asserted_facts(slow)}\n      "
   f"{M.asserted_facts(fast)}")
ok(M.asserted_facts(slow), "LM.3 and there are facts to agree on")
ok(M.presentation(slow) != M.presentation(fast),
   f"LM.3 while the PRESENTATION differs: {M.presentation(slow)[:1]} vs "
   f"{M.presentation(fast)[:1]}")
ok(slow["steps"][0]["dwell_s"] > fast["steps"][0]["dwell_s"],
   "LM.3 the slow one dwells longer")
ok(any(s.get("recap") for s in slow["steps"]) and
   not any(s.get("recap") for s in fast["steps"]),
   "LM.3 and recaps, which the fast one does not")
ok(slow["steps"][0].get("draw") != fast["steps"][0].get("draw"),
   "LM.3 the visual style differs too")

# ── LM.4  THE CONTROL for LM.3: ignore the preference and they must be IDENTICAL ─────
# Otherwise the difference LM.3 measures is noise, and this layer is decoration that should
# be dropped rather than kept for its own sake.
a = M.plan_lesson("union-find")
b = M.plan_lesson("union-find")
ok(a == b,
   "LM.4 CONTROL: two lessons with NO preference are identical — if they differ, LM.3 is "
   "measuring randomness and the layer cannot be shown to earn its place")
ok(M.presentation(a) == M.presentation(b), "LM.4 down to the presentation")
ok(M.presentation(a) != M.presentation(slow),
   "LM.4 and a preference does move it away from the default — otherwise the preference is "
   "read and discarded")

# The facts must match the NO-PREFERENCE lesson too, not merely each other. Comparing two
# preferenced plans is satisfied by a change that affects both equally — truncating the fact
# list whenever a preference is present went undetected until this line existed.
for name, plan in (("slow", slow), ("fast", fast)):
    ok(M.asserted_facts(plan) == M.asserted_facts(a),
       f"LM.4 the {name} lesson asserts exactly what the DEFAULT one does:\n"
       f"      {M.asserted_facts(plan)}\n      {M.asserted_facts(a)}")
ok(len(M.asserted_facts(slow)) == len(M.FACTS["union-find"]),
   f"LM.4 and all of them — a preference that drops a fact is a preference that changes what "
   f"is taught: {len(M.asserted_facts(slow))} of {len(M.FACTS['union-find'])}")

# ── LM.5  the store refuses what the gate refuses ────────────────────────────────────
import learning                                                 # noqa: E402
c = learning.Candidates(Path(tempfile.mkdtemp(prefix="lm-"))/"r.db")
cid = M.observe("misconception", "said rank alone flattens the tree",
                route="lesson", store=c)
ok(cid and c.get(cid)["type"] == "mastery",
   f"LM.5 a permitted observation reaches the store as a `mastery` candidate: {cid}")
ok(c.get(cid)["explicit"] == 0,
   "LM.5 marked inferred, so 21.5 refuses to bind it in-turn")
for text in ("he is a slow learner", "the user has ADHD"):
    try:
        M.observe("concept", text, route="lesson", store=c)
        FAIL.append(f"LM.5 {text!r} reached the store")
    except M.Refused:
        ok(True, "")

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print(f"✓ learner model: {len(PLANTED)} forbidden refused by class, {len(KEEP)} real "
      f"observations passed (LM.0/LM.4 controls both ways)")
