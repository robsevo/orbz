#!/usr/bin/env python3
"""PLAN 1.1_t controls: `pnpm check` must be green as the repo stands and go red on each planted
defect, and the kit suite must refuse the wrong Python. A check that cannot fail proves nothing
(CLAUDE.md rule 4).

    pnpm check:controls

Every plant is a NEW file, removed afterwards. No existing file is touched, and the run refuses to
start if a plant's path already exists.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
KIT_VENV = (REPO / "kit" / ".venv").resolve()

# (what, the new file, its text, a marker the red output must contain: red for the planted reason,
# not because something else broke)
PLANTS = [
    ("a type error", "packages/home/src/planted_control.ts",
     'export const planted: number = "not a number";\n', "planted_control.ts"),
    ("a failing TypeScript test", "packages/home/test/planted_control.test.ts",
     'import assert from "node:assert/strict";\nimport { test } from "node:test";\n\n'
     'test("planted control: must fail", () => {\n  assert.equal(1, 2);\n});\n', "planted control: must fail"),
    ("a failing kit test", "kit/tests/test_planted_control.py",
     'raise SystemExit("planted control: must fail")\n', "FAIL  tests/test_planted_control.py"),
    ("a file in kit/ash that carry.py did not carry", "kit/ash/planted_control.py",
     "x = 1\n", "kit/ash/planted_control.py is not carried"),
]


def check() -> subprocess.CompletedProcess[str]:
    return subprocess.run([shutil.which("pnpm") or "pnpm", "check"], cwd=REPO, capture_output=True, text=True)


def tail(r: subprocess.CompletedProcess[str], n: int = 25) -> str:
    return "\n".join("    " + line for line in (r.stdout + r.stderr).strip().splitlines()[-n:])


def other_python() -> str | None:
    """A Python on the PATH that is not the kit's own environment."""
    path = os.pathsep.join(p for p in os.environ.get("PATH", "").split(os.pathsep)
                           if p and not Path(p).resolve().is_relative_to(KIT_VENV))
    return shutil.which("python3", path=path) or shutil.which("python", path=path)


def main() -> int:
    taken = [rel for _, rel, _, _ in PLANTS if (REPO / rel).exists()]
    if taken:
        print(f"refusing to run: {', '.join(taken)} already exist(s)")
        return 2
    fails = 0

    base = check()
    print(f"{'PASS' if base.returncode == 0 else 'FAIL'}  K.0 `pnpm check` is green with nothing planted")
    if base.returncode != 0:
        print(tail(base))
        print("\nthe baseline is red, so the plants below would prove nothing")
        return 1

    for i, (what, rel, text, marker) in enumerate(PLANTS, 1):
        path = REPO / rel
        path.write_text(text)
        try:
            r = check()
        finally:
            path.unlink()
        ok = r.returncode != 0 and marker in r.stdout + r.stderr
        print(f"{'PASS' if ok else 'FAIL'}  K.{i} `pnpm check` goes red on {what} ({rel})")
        if not ok:
            print(tail(r))
        fails += not ok

    py = other_python()
    k = len(PLANTS) + 1
    if py is None:
        print(f"SKIP  K.{k} no other Python on the PATH to run the kit suite with")
    else:
        r = subprocess.run([py, "kit/tests/test_kit.py"], cwd=REPO, capture_output=True, text=True)
        ok = r.returncode != 0 and "not the kit's environment" in r.stdout
        print(f"{'PASS' if ok else 'FAIL'}  K.{k} the kit suite refuses a Python outside the kit ({py})")
        if not ok:
            print(tail(r))
        fails += not ok

    print(f"\n{'ALL PASS' if not fails else f'{fails} FAILED'}")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
