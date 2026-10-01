#!/usr/bin/env python3
"""A learned belief is counted as used when the engine reads it (PLAN 22.1). Run: orb/daemon/.venv/bin/python orb/daemon/test_belief_use.py

  BU.1  a Read of a projected belief's file counts — absolute, relative to the call's cwd, or
        through the voice house's link into the brain; another file, or a belief that is not
        live (archived, rejected), does not
  BU.2  a Skill load counts a projected SKILL by name (any case); a fact of the same name does not
  BU.3  one session re-reading a belief inside the window is one use; later, or another session, is another
  BU.4  the hook entry: bad input and a broken store never raise; a real read moves uses and last_used
  BU.5  the shell fast path: a Read that is not of a belief never starts python; a belief Read and
        a Skill load do; it prints nothing and always exits 0
  BU.6  install/apply-belief-use.sh on a temporary home: the dry run changes nothing; --apply
        registers Read|Skill once in both settings files; a second run says already; bad JSON is refused
  BU.0  CONTROLS: a match on unresolved paths, and a window that never dedupes, planted into
        copies, are caught
"""
# ASH_TIER: product
# Temp stores and a temp HOME only; never the real brain, ledger or settings.
import io
import json
import os
import subprocess
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
TD = Path(tempfile.mkdtemp(prefix="beliefuse-"))

import belief_use  # noqa: E402
import learning  # noqa: E402

FAIL = []


def ok(cond, label):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}")
    if not cond:
        FAIL.append(label)


def world():
    """A brain with a memory folder, a voice house linking to it, and a store with beliefs."""
    d = Path(tempfile.mkdtemp(prefix="beliefuse-w-", dir=TD))
    brain, voice = d/"ash/brain", d/"ash/voice"
    (brain/"memory").mkdir(parents=True); (brain/"skills").mkdir(parents=True); voice.mkdir()
    os.symlink(brain/"memory", voice/"memory")
    st = learning.Candidates(path=d/"c.db")
    def belief(type_, name, body, status="active"):
        cid = st.observe(type_=type_, name=name, body=body, source_events=[], source_class="ashd")
        for step in ("candidate", "reviewed", "approved", "active"):
            st.transition(cid, step, actor="human" if step != "candidate" else "model")
        sub = "skills" if type_ == "procedure" else "memory"
        p = brain/sub/f"{name}.md"; p.write_text(body)
        st.db.execute("UPDATE candidates SET projected_path=? WHERE id=?", (str(p), cid))
        if status != "active":
            st.transition(cid, status, actor="human")
        return cid, p
    return d, brain, voice, st, belief


def ev(tool, inp, cwd="/", session="s1"):
    return {"hook_event_name": "PostToolUse", "tool_name": tool, "tool_input": inp, "cwd": str(cwd), "session_id": session}


def run(mod):
    bad = []
    d, brain, voice, st, belief = world()
    f1, p1 = belief("fact", "deploy-host", "tvspot deploys to the Hetzner box.")
    f2, p2 = belief("fact", "old-host", "tvspot deploys to the droplet.", status="archived")
    k1, pk = belief("procedure", "deploy", "step one\nstep two")
    fk, _ = belief("fact", "deploy2", "a fact whose name is almost deploy")
    other = d/"notes.md"; other.write_text("x")
    if mod.matches(st, ev("Read", {"file_path": str(p1)})) != [f1]:
        bad.append("BU.1 an absolute Read of a belief's file counts it")
    if mod.matches(st, ev("Read", {"file_path": "memory/deploy-host.md"}, cwd=brain)) != [f1]:
        bad.append("BU.1 a relative Read, resolved against the call's cwd, counts it")
    if mod.matches(st, ev("Read", {"file_path": str(voice/"memory"/"deploy-host.md")})) != [f1]:
        bad.append("BU.1 a Read through the voice house's link into the brain is the same file")
    if mod.matches(st, ev("Read", {"file_path": str(other)})) or mod.matches(st, ev("Read", {"file_path": str(p2)})):
        bad.append("BU.1 another file, or a belief put away, is not a use")
    if mod.matches(st, ev("Skill", {"name": "DEPLOY"})) != [k1]:
        bad.append(f"BU.2 a Skill load counts the projected skill by name, any case: {mod.matches(st, ev('Skill', {'name': 'DEPLOY'}))}")
    if fk in mod.matches(st, ev("Skill", {"name": "deploy2"})):
        bad.append("BU.2 a FACT with a skill's name is not a skill load")
    s = d/"seen.json"
    a, b = mod.fresh(s, "s1", f1, 1000.0), mod.fresh(s, "s1", f1, 1100.0)
    c, e = mod.fresh(s, "s1", f1, 1000.0 + mod.USE_WINDOW + 1), mod.fresh(s, "s2", f1, 1100.0)
    if not (a and not b and c and e):
        bad.append(f"BU.3 one session inside the window is one use; later or another session is another: {(a, b, c, e)}")
    return bad


print("── BU.1-BU.3  what counts as a use")
b = run(belief_use)
for x in b:
    ok(False, x)
ok(not b, "BU.1-BU.3 reads of a belief (however addressed) and skill loads count; nothing else; re-reads dedupe")

print("── BU.4  the hook entry")
d, brain, voice, st, belief = world()
f1, p1 = belief("fact", "tea", "Drinks tea, not coffee.")
ok(belief_use.main(io.StringIO("{not json"), store=st, state_path=d/"s.json") == 0, "BU.4 bad input returns 0 and raises nothing")
broken = types.SimpleNamespace(db=None)
ok(belief_use.main(io.StringIO(json.dumps(ev("Read", {"file_path": str(p1)}))), store=broken, state_path=d/"s.json") == 0,
   "BU.4 a broken store raises nothing either")
belief_use.main(io.StringIO(json.dumps(ev("Read", {"file_path": str(p1)}))), store=st, state_path=d/"s.json", now=5000.0)
belief_use.main(io.StringIO(json.dumps(ev("Read", {"file_path": str(p1)}))), store=st, state_path=d/"s.json", now=5010.0)
row = st.get(f1)
ok(row["uses"] == 1 and (row.get("last_used") or 0) > 0 and row["helped"] == 0,
   f"BU.4 a real read moves uses and last_used once, and 'helped' stays the person's to say: uses={row['uses']}")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

print("── BU.0  CONTROLS")
SRC = (HERE/"belief_use.py").read_text()
for what, old, new in [("a match on unresolved paths", "want = _real(fp)", "want = fp"),
                       ("a window that never dedupes", "    if key in seen:\n        return False\n", "")]:
    if old not in SRC:
        ok(False, f"BU.0 CONTROL: the code the '{what}' plant replaces has moved")
        continue
    m = types.ModuleType("belief_use_planted")
    exec(compile(SRC.replace(old, new, 1), "belief_use_planted", "exec"), m.__dict__)
    ok(bool(run(m)), f"BU.0 CONTROL: '{what}', planted into a copy, is caught")

import shutil  # noqa: E402
shutil.rmtree(TD, ignore_errors=True)
if FAIL:
    print(f"\nFAIL  belief_use  ({len(FAIL)} failing)")
    raise SystemExit(1)
print("\nPASS  belief_use  (0 failing)")
