#!/usr/bin/env python3
"""One place that knows where things live (PLAN 5.9, feeding 16.5).

Before this, the answer to *"where does that file go"* was spread across a dozen modules,
each computing `Path.home()/"ash/voice"/…` for itself. That is not a tidiness problem:
it is why `runtime.DB` could be rebound and the Journal still opened the real one (D104),
why `adapters._journal = None` rebuilt against the live journal instead of disabling it
(D155), and why an explicit `--file` fell through to the owner's real `MEMORY.md` (D166).
Three defects, one shape — **a path computed in two places can be redirected in one.**

Four roots, and the distinction between them is what a publish, a backup and a `rm` all
need:

    runtime   state this daemon owns and rewrites — sockets, the journal, wake state
    config    what the person set and expects to survive everything
    cache     recomputable; losing it costs time and nothing else
    logs      append-only, rotated, read by a human after something went wrong

`ASH_STATE_HOME` moves all four at once, which is what makes a suite able to run against a
temporary home without each module needing its own override.
"""
import os
from pathlib import Path


def _base():
    """Resolved at CALL time, never bound at import — D104's lesson, applied at the root.

    A module-level constant here would defeat every test that redirects the environment,
    and would do it silently: the test would pass while writing the person's real state.
    """
    override = os.environ.get("ORBS_KIT_STATE") or os.environ.get("ASH_STATE_HOME")
    return Path(override) if override else Path.home()/".orbs"/"kit"


def runtime():
    """Live state this daemon owns. Wiped safely only when nothing is running."""
    return _base()/"run"


def config():
    """What the person chose. The one root that must survive a reinstall."""
    return _base()


def cache():
    """Recomputable. The only root that is safe to delete without asking."""
    return _base()/"cache"


def logs():
    """Append-only and rotated. Read by a person after something went wrong, so a path
    that moves between versions costs an incident."""
    return _base()


def brain():
    """The CLI brain. Owner-only by hard rule 3 — named here so that nothing has to guess
    it, and so a reader can see that this module knows where it is and still does not
    write to it."""
    return Path(os.environ.get("ORBS_BRAIN") or os.environ.get("ASH_HOME") or Path.home()/".orbs"/"brain")


ROOTS = {"runtime": runtime, "config": config, "cache": cache, "logs": logs}


def describe():
    """Every root as it stands right now, for `doctor` and for a person asking."""
    out = {name: str(fn()) for name, fn in ROOTS.items()}
    out["brain"] = str(brain())
    out["overridden"] = bool(os.environ.get("ASH_STATE_HOME"))
    return out


def main():
    d = describe()
    width = max(len(k) for k in d)
    for k in ("config", "runtime", "cache", "logs", "brain"):
        print(f"  {k:<{width}}  {d[k]}")
    if d["overridden"]:
        print(f"\n  (ASH_STATE_HOME is set — every root above is redirected)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
