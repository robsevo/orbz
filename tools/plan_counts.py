#!/usr/bin/env python3
"""PLAN.md's counts, generated (CLAUDE.md rule 3: never type a number a script can compute), and the
house-format rules a script can check (rule 1): every feature has its `_t` row right under it, and
a feature's box never outranks its test's.

    pnpm plan                                   # the check, inside `pnpm check`
    python tools/plan_counts.py --write         # rewrite the count summary in PLAN.md
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

PLAN = Path(__file__).resolve().parent.parent / "PLAN.md"
MVP_PHASES = range(0, 4)  # PLAN: "The MVP is Phases 0–3"
RANK = {"[ ]": 0, "[~]": 1, "[x]": 2}

PHASE = re.compile(r"^### PHASE (\d+) ")
ROW = re.compile(r"^\| (\d+)\.(\d+)(_t)? \|.*\| (\[[ ~x]\]) \|\s*$")
SUMMARY_ROW = re.compile(r"^\| Phase (\d+) (\([^)]*\)) \| \d+ \| \d+ \|$", re.M)
TOTAL_ROW = re.compile(r"^\| \*\*Total\*\* \| \d+ \| \d+ \|$", re.M)
BOXES_LINE = re.compile(r"^\d+ boxes: .*The MVP is Phases 0–3 \(\d+ features\)\.$", re.M)


def read_rows(text: str) -> tuple[list[tuple[int, str, bool, str]], list[str]]:
    """(phase, row id, is test row, box) for every plan row, and the format problems found."""
    rows: list[tuple[int, str, bool, str]] = []
    problems: list[str] = []
    phase = None
    for n, line in enumerate(text.splitlines(), 1):
        m = PHASE.match(line)
        if m:
            phase = int(m.group(1))
            continue
        m = ROW.match(line)
        if not m:
            continue
        rid = f"{m.group(1)}.{m.group(2)}"
        # the house table has four cells (#, Feature, Description, Done): a fifth drops the box from
        # every rendered view, which shows the header's four columns only
        cells = len(re.split(r"(?<!\\)\|", line.strip())) - 2
        if cells != 4:
            problems.append(f"line {n}: row {rid}{m.group(3) or ''} has {cells} cells; the house table has 4 (#, Feature, Description, Done)")
        if phase is None or int(m.group(1)) != phase:
            problems.append(f"line {n}: row {rid} sits outside its phase table")
            continue
        rows.append((phase, rid, m.group(3) is not None, m.group(4)))
    for i, (_, rid, is_test, box) in enumerate(rows):
        if is_test:
            continue
        nxt = rows[i + 1] if i + 1 < len(rows) else None
        if not nxt or nxt[1] != rid or not nxt[2]:
            problems.append(f"feature {rid} has no {rid}_t row right under it")
        elif RANK[box] > RANK[nxt[3]]:
            problems.append(f"feature {rid} is {box} but its test {rid}_t is {nxt[3]}: a feature never outranks its test")
    return rows, problems


def render(text: str) -> tuple[str, list[str]]:
    """The plan with its count summary regenerated, and the problems found."""
    rows, problems = read_rows(text)
    feats: dict[int, int] = {}
    tests: dict[int, int] = {}
    for phase, _, is_test, _ in rows:
        (tests if is_test else feats)[phase] = (tests if is_test else feats).get(phase, 0) + 1

    def summary_row(m: re.Match[str]) -> str:
        p = int(m.group(1))
        if p not in feats:
            problems.append(f"the summary lists Phase {p}, which has no rows")
        return f"| Phase {p} {m.group(2)} | {feats.get(p, 0)} | {tests.get(p, 0)} |"

    out, n_rows = SUMMARY_ROW.subn(summary_row, text)
    if n_rows != len(feats):
        problems.append(f"the summary has {n_rows} phase rows but the plan has {len(feats)} phases")
    out, n_total = TOTAL_ROW.subn(f"| **Total** | {sum(feats.values())} | {sum(tests.values())} |", out)
    boxes = [box for *_, box in rows]
    mvp = sum(v for p, v in feats.items() if p in MVP_PHASES)
    line = (f"{len(boxes)} boxes: {boxes.count('[x]')} `[x]`, {boxes.count('[~]')} `[~]`, "
            f"{boxes.count('[ ]')} `[ ]`. The MVP is Phases 0–3 ({mvp} features).")
    out, n_line = BOXES_LINE.subn(line, out)
    if n_total != 1 or n_line != 1:
        problems.append("the count summary (its Total row and its boxes line) is missing from the plan")
    return out, problems


def main(argv: list[str], plan: Path = PLAN) -> int:
    # the plan is kept out of public clones: there is nothing to count without it
    if not plan.exists():
        print("plan: no PLAN.md in this checkout, nothing to count")
        return 0
    text = plan.read_text()
    out, problems = render(text)
    for p in problems:
        print("FAIL ", p)
    if "--write" in argv:
        if out != text:
            plan.write_text(out)
            print("PLAN.md: count summary regenerated")
        return 1 if problems else 0
    if out != text:
        print("FAIL  PLAN.md's counts are stale: run `python tools/plan_counts.py --write`")
        return 1
    if not problems:
        print("plan: counts match the rows; every feature has its test row and none outranks it")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
