#!/usr/bin/env python3
"""The kit runner's rate gate for stochastic suites (kit/tests/run.py `rate`), with its
controls: a suite that always fails must fail, and the gate must stop as soon as it knows."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from run import rate  # noqa: E402

FAIL = []


def check(label, got, want):
    ok = got == want
    print(f"{'PASS' if ok else 'FAIL'}  {label}: {got}")
    if not ok:
        FAIL.append(label)


def script(*codes):
    it = iter(codes)
    return lambda: (next(it), "out")


check("RR.0 CONTROL: a suite that always fails fails, after two runs", rate(script(1, 1, 1))[:3], (1, 0, 2))
check("RR.1 a suite that always passes passes, after two runs", rate(script(0, 0, 0))[:3], (0, 2, 2))
check("RR.2 one miss in three still passes", rate(script(1, 0, 0))[:3], (0, 2, 3))
check("RR.3 two misses in three fails", rate(script(0, 1, 1))[:3], (1, 1, 3))
check("RR.4 the failure's output is kept for the report", rate(script(1, 1))[3], "out")
print("ALL PASS" if not FAIL else f"{len(FAIL)} FAILED")
sys.exit(1 if FAIL else 0)
