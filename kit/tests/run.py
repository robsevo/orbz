#!/usr/bin/env python3
"""Runs every kit test script (`kit/tests/test_*.py`) in its own process, Ash's way: each script
asserts, prints, and exits non-zero on a failure. Red if any script fails or hangs, or if none is
found — an empty suite is not a pass.

    pnpm test:kit          # uv runs this on the kit's own Python
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
TIMEOUT_S = 600


def main() -> int:
    tests = sorted(HERE.glob("test_*.py"))
    if not tests:
        print("no kit tests found in kit/tests — an empty suite is not a pass")
        return 1
    env = {**os.environ, "PYTHONPATH": os.pathsep.join(filter(None, [str(KIT), os.environ.get("PYTHONPATH")]))}
    failed = []
    for t in tests:
        t0 = time.monotonic()
        try:
            r = subprocess.run([sys.executable, str(t)], cwd=KIT, env=env, capture_output=True, text=True,
                               timeout=TIMEOUT_S)
            code, out = r.returncode, (r.stdout + r.stderr).strip()
        except subprocess.TimeoutExpired as e:
            code, out = -1, f"hung: no exit after {TIMEOUT_S} s\n{e.stdout or ''}"
        print(f"{'PASS' if code == 0 else 'FAIL'}  {t.name}  ({time.monotonic() - t0:.1f} s)")
        if code != 0:
            failed.append(t.name)
            print("\n".join("    " + line for line in out.splitlines()[-40:]))
    print(f"\n{len(tests) - len(failed)} of {len(tests)} kit test files pass")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
