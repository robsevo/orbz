#!/usr/bin/env python3
"""The kit runs on its own Python, the environment uv builds from kit/uv.lock, never on whatever
`python3` is first on the PATH. Ash's lesson: the owner's live `python3` is an office venv without
the kit's packages, and suites run on it fail, or pass, for the wrong reasons."""
import os
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
FAIL = []

if sys.version_info < (3, 12):
    FAIL.append(f"the kit needs Python 3.12 or newer, got {sys.version.split()[0]}")

env = os.environ.get("UV_PROJECT_ENVIRONMENT")
venv = (KIT / env if env else KIT / ".venv").resolve()  # KIT / an absolute path is that path
if Path(sys.prefix).resolve() != venv:
    FAIL.append(f"running on {sys.prefix}, not the kit's environment {venv}; run the suite with `pnpm test:kit`")

for f in FAIL:
    print("FAIL ", f)
print("ALL PASS" if not FAIL else f"{len(FAIL)} FAILED")
sys.exit(1 if FAIL else 0)
