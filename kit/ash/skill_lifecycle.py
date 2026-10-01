#!/usr/bin/env python3
"""skill_lifecycle — active → stale → archived, and never deletion (PLAN 23.3, 23.4).

Three rules, copied whole because each was learned the hard way somewhere else:

**Zero uses is absence of evidence, not proof of disposability.** A skill nobody has loaded
may be one nobody needed yet, or one that was added last night. So a never-used skill gets a
GRACE FLOOR before anything happens to it — and a library this code has never observed
before gets a full interval to be observed, rather than a first run that archives half of it.

**Provenance is declared, never inferred.** No heuristic may decide something "looks
agent-made": a skill with a hundred patches proves the agent *maintains* it, not that the
agent *wrote* it, and the wrong guess archives something a person hand-wrote. Ownership comes
from a declared marker or it is unknown, and unknown is treated as the user's.

**A pin blocks the autonomous actor too.** The gym is a no-user-present writer, and that is
exactly who a pin is for. A pin that only stops a human is a pin that stops nobody.

And the rule under all three: **nothing is ever deleted.** `archived` is a state, the file
stays, and `restore` puts it back.
"""
import json
import os
import sys
import threading
import time
from pathlib import Path

import skill_usage

GRACE_S = 14 * 24 * 3600        # a never-used skill is left alone this long
STALE_S = 60 * 24 * 3600        # unused this long and it goes stale
OBSERVE_S = 7 * 24 * 3600       # a library we have not watched for this long acts on nothing

AGENT = "agent"                 # the only owner the gym may touch
USER = "user"


def owner_of(entry):
    """Declared ownership, or the user's. NEVER inferred.

    An unknown owner is the user's: the wrong guess in that direction leaves an agent-made
    skill alone, and in the other direction it archives something a person hand-wrote.
    """
    declared = (entry or {}).get("owner")
    return AGENT if declared == AGENT else USER


def first_seen(state):
    return (state or {}).get("_first_seen") or 0


def plan(names, *, usage_path=None, state=None, now=None):
    """What a pass would do, and why. Returns a list of (name, action, reason).

    Actions: `keep`, `stale`, `archive`, `defer`. Nothing here writes anything — the caller
    applies it, so a pass can always be shown before it is run.
    """
    now = now or time.time()
    state = dict(state or {})
    seen = first_seen(state)
    if not seen:
        # A library this code has never observed. Defer a FULL interval rather than acting on
        # a snapshot of something it has not watched.
        return [(n, "defer", "first run — nothing is acted on until the library has been "
                             "observed for a full interval") for n in names]
    if now - seen < OBSERVE_S:
        left = int((OBSERVE_S - (now - seen)) / 3600)
        return [(n, "defer", f"still observing; {left}h of the first interval left")
                for n in names]

    u = skill_usage.usage(path=usage_path)
    out = []
    for n in names:
        e = u.get(n) or {}
        if e.get("pin"):
            out.append((n, "keep", "pinned — and a pin blocks the gym too, which is exactly "
                                   "who it is for"))
            continue
        if e.get("state") == "archived":
            out.append((n, "keep", "already archived; nothing is ever deleted"))
            continue
        uses = int(e.get("use", 0))
        last = e.get("last_use") or 0
        added = e.get("added") or seen
        if uses == 0:
            if now - added < GRACE_S:
                out.append((n, "keep", "never used, but inside its grace floor — zero uses is "
                                       "absence of evidence, not proof of disposability"))
            else:
                out.append((n, "stale", "never used, past the grace floor"))
            continue
        if now - last >= STALE_S:
            out.append((n, "stale", f"last used {int((now - last) / 86400)} days ago"))
        else:
            out.append((n, "keep", "in use"))
    return out


def may_evolve(name, *, usage_path=None):
    """(allowed, reason) — may the gym PATCH this skill? (23.4)

    A user-authored skill that is wrong is reported with a recommendation, never patched:
    hard rule 3 in a new place, and the distinction the ownership marker exists to carry.
    Silence there is worse than the edit, because the lesson is then lost as well as
    unapplied — so the reason is always returned.
    """
    e = skill_usage.usage(name, path=usage_path)
    if owner_of(e) != AGENT:
        return False, (f"{name} is not agent-owned. Report the finding with a "
                       f"recommendation; do not patch what a person wrote.")
    if e.get("pin"):
        return False, f"{name} is pinned, and a pin blocks the autonomous actor too."
    if e.get("state") == "archived":
        return False, f"{name} is archived; restore it before evolving it."
    return True, ""


def main(argv=None):
    """`skill_lifecycle.py may-evolve NAME` — the gym's question, for a caller that is not Python —
    and `declare NAME --owner agent|user`, the person's answer to "whose skill is this".

    `skill-evolve.mjs` is the brain's JavaScript and cannot import this module, and a second copy
    of the rule in JavaScript would drift from this one (23.4). So it asks here: JSON on stdout,
    exit 0 when the skill may be patched and 3 when it may not, with the reason either way.
    """
    import argparse
    ap = argparse.ArgumentParser(prog="skill_lifecycle")
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("may-evolve", help="may the gym PATCH this skill? (allowed, reason) as JSON")
    m.add_argument("name")
    m.add_argument("--usage", default=None, help="the usage sidecar (tests); else skill_usage's own")
    d = sub.add_parser("declare", help="a PERSON declares who owns a skill: agent (the gym may patch "
                                       "it) or user (it is reported, never patched)")
    d.add_argument("name")
    d.add_argument("--owner", required=True, choices=skill_usage.OWNERS)
    d.add_argument("--usage", default=None, help="the usage sidecar (tests); else skill_usage's own")
    a = ap.parse_args(argv)
    usage_path = Path(a.usage) if a.usage else None
    if a.cmd == "declare":
        e = skill_usage.declare(a.name, a.owner, path=usage_path)
        print(json.dumps({"declared": e is not None, "name": a.name, "owner": a.owner}))
        return 0 if e is not None else 1
    allowed, why = may_evolve(a.name, usage_path=usage_path)
    print(json.dumps({"allowed": bool(allowed), "reason": why}))
    return 0 if allowed else 3


if __name__ == "__main__":
    sys.exit(main())
