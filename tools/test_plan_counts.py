#!/usr/bin/env python3
"""Tests for tools/plan_counts.py, with planted defects it must catch (CLAUDE.md rule 4)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from plan_counts import render  # noqa: E402

GOOD = """\
### PHASE 0 — Prove it → M0

| # | Feature | Description | Done |
|---|---------|-------------|------|
| 0.1 | Name | x | [x] |
| 0.1_t | Tests: name | x | [x] |
| 0.2 | Spike | x | [~] |
| 0.2_t | Tests: spike | x | [~] |

### PHASE 4 — Later → M4

| # | Feature | Description | Done |
|---|---------|-------------|------|
| 4.1 | Voice | x | [ ] |
| 4.1_t | Tests: voice | x | [ ] |

| Phase | Features | Test rows |
|---|---|---|
| Phase 0 (prove it) | 2 | 2 |
| Phase 4 (later) | 1 | 1 |
| **Total** | 3 | 3 |

6 boxes: 2 `[x]`, 2 `[~]`, 2 `[ ]`. The MVP is Phases 0–3 (2 features).
"""

FAIL = []


def check(name: str, ok: bool) -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}")
    if not ok:
        FAIL.append(name)


out, problems = render(GOOD)
check("P.0 a correct plan is left as it is, with no problems", out == GOOD and problems == [])

out, problems = render(GOOD.replace("| Phase 0 (prove it) | 2 | 2 |", "| Phase 0 (prove it) | 5 | 2 |"))
check("P.1 a typed feature count is corrected", out == GOOD)

out, problems = render(GOOD.replace("6 boxes: 2 `[x]`, 2 `[~]`", "6 boxes: 3 `[x]`, 1 `[~]`"))
check("P.2 a typed box count is corrected", out == GOOD)

out, problems = render(GOOD.replace("| 0.2_t | Tests: spike | x | [~] |\n", ""))
check("P.3 a feature without its _t row is a problem", any("0.2 has no 0.2_t" in p for p in problems))

out, problems = render(GOOD.replace("| 0.2 | Spike | x | [~] |", "| 0.2 | Spike | x | [x] |"))
check("P.4 a feature ticked above its test is a problem", any("never outranks" in p for p in problems))

out, problems = render(GOOD.replace("| 0.2 | Spike | x | [~] |", "| 0.2 | Spike | x | [ ] |"))
check("P.5 control: a feature BELOW its test is fine", not any("outranks" in p for p in problems))

out, problems = render(GOOD.replace("6 boxes:", "boxes:"))
check("P.6 a missing boxes line is a problem, not a silent pass", any("missing" in p for p in problems))

print("ALL PASS" if not FAIL else f"{len(FAIL)} FAILED")
sys.exit(1 if FAIL else 0)
