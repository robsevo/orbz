#!/usr/bin/env python3
"""A learned belief, counted as used when the engine actually reads it (PLAN 22.1).

The learning panel shows how often a belief was used and when it last helped. Until this, only a
person pressing HELPED ever moved that count: beliefs reach him as files projected into the brain
(memory, profile, skills, learner), and nothing reported when one was read. `belief-use.sh` is a
PostToolUse hook on `Read|Skill`; it hands this the hook's JSON only when the call touched a
belief folder or loaded a skill, and this finds the belief and calls `Candidates.used()`.

What counts as a use, and what deliberately does not:
  * a `Read` of a projected belief's file (matched on the RESOLVED path, so a read through the
    voice house's link into the brain is the same file);
  * a `Skill` load of a projected skill, by name.
  * NOT a belief that is merely present in every session's context — counting those each session
    would make every number the same and so say nothing.
The same belief read again in the same session within USE_WINDOW is one use, not several: a turn
that re-reads a file three times used it once.

Never raises, prints nothing: the shell wrapper discards output and always exits 0.
"""
import json
import os
import sys
import time
from pathlib import Path

USE_WINDOW = 300.0          # seconds: one session re-reading the same belief is one use
LIVE = ("active", "corrected")


def _real(p):
    try:
        return os.path.realpath(p)
    except Exception:
        return ""


def matches(store, event):
    """[candidate id] this tool call used. Pure over (store, event), so a test can drive it."""
    name, inp = event.get("tool_name"), event.get("tool_input") or {}
    q = "SELECT id, type, name, projected_path FROM candidates WHERE status IN (?, ?)"
    rows = store.db.execute(q, LIVE).fetchall()
    if name == "Read":
        fp = str(inp.get("file_path") or "")
        if not fp:
            return []
        if not os.path.isabs(fp):
            fp = os.path.join(str(event.get("cwd") or os.getcwd()), fp)
        want = _real(fp)
        return [cid for cid, _t, _n, pp in rows if pp and _real(pp) == want]
    if name == "Skill":
        want = str(inp.get("name") or "").strip().lower()
        return [cid for cid, t, n, _pp in rows if t == "procedure" and want and (n or "").lower() == want]
    return []


def fresh(state_path, session, cid, now):
    """True if this (session, belief) was not already counted inside USE_WINDOW; records it."""
    try:
        seen = json.loads(Path(state_path).read_text())
    except Exception:
        seen = {}
    seen = {k: t for k, t in seen.items() if now - t < USE_WINDOW}
    key = f"{session}|{cid}"
    if key in seen:
        return False
    seen[key] = now
    try:
        tmp = Path(str(state_path) + ".tmp")
        tmp.write_text(json.dumps(seen))
        os.replace(tmp, state_path)
    except OSError:
        pass
    return True


def main(stdin=sys.stdin, store=None, state_path=None, now=None):
    try:
        event = json.loads(stdin.read() or "{}")
    except Exception:
        return 0
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        if store is None:
            import learning
            store = learning.Candidates()
        if state_path is None:
            import statepaths
            state_path = statepaths.runtime()/"belief-use.json"
            Path(state_path).parent.mkdir(parents=True, exist_ok=True)
        now = now if now is not None else time.time()
        session = str(event.get("session_id") or "")
        for cid in matches(store, event):
            if fresh(state_path, session, cid, now):
                store.used(cid)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
