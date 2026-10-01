#!/usr/bin/env python3
"""Runs every kit test script in its own process, Ash's way: each script asserts, prints, and
exits non-zero on a failure. Red if any script fails or hangs, or if none is found — an empty
suite is not a pass.

Two kinds:
  kit/tests/test_*.py   the kit's own tests
  kit/ash/test_*.py     Ash's suites, carried with their modules (tools/adoption/carry.py). Each
                        runs in kit/ash, wrapped in the carried write_guard.py (it fails a suite
                        that changed protected state), with HOME pointed at an empty directory
                        of its own, so no default path can reach the real ~/ash or ~/.orbs.

    pnpm test:kit          # uv runs this on the kit's own Python
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
ASH = KIT / "ash"
TIMEOUT_S = 600

# Suites whose subject is not deterministic (Kokoro's synthesis is not, run to run), gated on a
# RATE, as Ash's evals are (`run.mjs` k-repeat): a pass needs PASSES_NEEDED of up to RUNS. A
# broken suite still fails every run. Every entry says what was measured; nothing goes here to
# quiet a suite that is red at its source (test_comma_beats was dropped for that, not listed).
STOCHASTIC = {
    "test_ad_voice.py": "AV.1 measures where synthesized speech pauses; on 2026-10-01 it passed 12 of 12 "
                        "runs in isolation (6 in Ash, 6 in the kit) and missed once inside a full gate run",
}
RUNS, PASSES_NEEDED = 3, 2
# Variables that would point a carried module at real state whatever HOME says, and the zone
# (the carried suites are written against whenparse's default zone).
ASH_ENV = ("ASH_STATE_HOME", "ASH_HOME", "ASH_BRAIN_HOME", "ORBS_KIT_STATE", "ORBS_BRAIN", "ORBS_TZ")


def run_one(cmd: list[str], cwd: Path, env: dict[str, str]) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=TIMEOUT_S)
        return r.returncode, (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired as e:
        out = e.stdout.decode(errors="replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
        return -1, f"hung: no exit after {TIMEOUT_S} s\n{out}"


def rate(run, runs: int = RUNS, need: int = PASSES_NEEDED) -> tuple[int, int, int, str]:
    """Runs a stochastic suite until its verdict is certain: (exit code, passes, runs made, the
    last failure's output). Passes once `need` runs pass; fails once that can no longer happen."""
    passes = fails = 0
    last = ""
    while passes < need and fails <= runs - need:
        code, out = run()
        if code == 0:
            passes += 1
        else:
            fails += 1
            last = out
    return (0 if passes >= need else 1), passes, passes + fails, last


def main() -> int:
    own = sorted(HERE.glob("test_*.py"))
    carried = sorted(ASH.glob("test_*.py"))
    if not own and not carried:
        print("no kit tests found — an empty suite is not a pass")
        return 1
    if carried:
        sys.path.insert(0, str(KIT))
        from orbs_kit.models import missing
        absent = missing()
        if absent:
            print(f"FAIL  the kit's model files are missing or wrong: {', '.join(absent)}\n"
                  f"      fetch them: uv run --project kit --locked python -m orbs_kit.models  (from kit/)")
            return 1
    base = {k: v for k, v in os.environ.items() if k not in ASH_ENV}
    base["PYTHONDONTWRITEBYTECODE"] = "1"
    failed = []

    jobs: list[tuple[Path, list[str], Path, dict[str, str], Path | None]] = []
    for t in own:
        env = {**base, "PYTHONPATH": os.pathsep.join(filter(None, [str(KIT), os.environ.get("PYTHONPATH")]))}
        jobs.append((t, [sys.executable, str(t)], KIT, env, None))
    for t in carried:
        home = Path(tempfile.mkdtemp(prefix="orbs-kit-home-"))
        env = {**base, "HOME": str(home), "USERPROFILE": str(home)}
        cmd = [sys.executable, str(ASH / "write_guard.py"), "--", sys.executable, t.name]
        jobs.append((t, cmd, ASH, env, home))

    for t, cmd, cwd, env, home in jobs:
        t0 = time.monotonic()
        label = f"{t.parent.name}/{t.name}"
        note = ""
        if t.name in STOCHASTIC and home is not None:
            code, passes, ran, out = rate(lambda: run_one(cmd, cwd, env))
            note = f", {passes} of {ran} runs passed (needs {PASSES_NEEDED})"
        else:
            code, out = run_one(cmd, cwd, env)
        if home is not None:
            shutil.rmtree(home, ignore_errors=True)
        print(f"{'PASS' if code == 0 else 'FAIL'}  {label}  ({time.monotonic() - t0:.1f} s{note})")
        if code != 0:
            failed.append(label)
            print("\n".join("    " + line for line in out.splitlines()[-40:]))
    total = len(jobs)
    print(f"\n{total - len(failed)} of {total} kit test files pass")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
