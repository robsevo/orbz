"""Serves the old versions of files that Ash's suites read from Ash's git history.

Written for Orbs (not carried). Several carried suites prove their own checks can fail by
running the committed PRE-FIX code: `git show <rev>:orb/daemon/<file>`. The kit has no Ash
history, so `tools/adoption/carry.py` carries those exact blobs into `fixtures/git/<rev>/<path>`
and this returns them in the shape `subprocess.run` did. A version that was not carried fails
the way a missing commit would, so the control goes red instead of passing on nothing.
"""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "fixtures" / "git"


def show(spec):
    rev, _, path = spec.partition(":")
    f = ROOT / rev / path
    if f.is_file():
        return subprocess.CompletedProcess(["git", "show", spec], 0, f.read_text(), "")
    return subprocess.CompletedProcess(["git", "show", spec], 128, "",
                                       f"fatal: {spec} was not carried into kit/ash/fixtures/git")
