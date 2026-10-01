#!/usr/bin/env python3
"""Tests for copyscan (PLAN 0.4_t). Plain script: PASS/FAIL per check, exit 1 on any failure.

The "their" code here is SYNTHETIC — written for this test. Putting Open Dot's real code in
our repo to test the scanner would itself be the thing the scanner exists to stop.
"""
from __future__ import annotations

import io
import subprocess
import sys
import tempfile
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import copyscan  # noqa: E402

FAILS = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global FAILS
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail and not ok else ""))
    if not ok:
        FAILS += 1


THEIRS = '''\
import { emitEvent } from "./events";
import type { Task, Worker } from "./types";

// A synthetic scheduler, written only to test copyscan.
export function pickWorker(workers: Worker[], task: Task): Worker | null {
  const ready = workers.filter((w) => w.status === "idle" && w.skills.includes(task.kind));
  if (!ready.length) return null;
  ready.sort((a, b) => a.load - b.load || a.joinedAt - b.joinedAt);
  const chosen = ready[0];
  chosen.load += task.weight;
  emitEvent({ type: "assigned", workerId: chosen.id, taskId: task.id, at: Date.now() });
  return chosen;
}

export function releaseWorker(worker: Worker, task: Task): void {
  worker.load = Math.max(0, worker.load - task.weight);
  if (worker.load === 0) worker.status = "idle";
  emitEvent({ type: "released", workerId: worker.id, taskId: task.id, at: Date.now() });
}
'''

OURS_CLEAN = '''\
// Our own code: a different algorithm for a similar job.
export const choose = (pool, job) => {
  let best = undefined;
  for (const p of pool) {
    if (p.busy || !p.can(job)) continue;
    if (!best || p.queue.length < best.queue.length) best = p;
  }
  return best ?? null;
};
'''

# 13 lines of THEIRS pasted verbatim.
PASTED = "\n".join(THEIRS.splitlines()[4:17]) + "\n"

# The same lines with every identifier renamed: a copy wearing a disguise.
RENAMED = (
    PASTED.replace("pickWorker", "chooseOrb").replace("workers", "orbs").replace("Worker", "Orb")
    .replace("task", "job").replace("Task", "Job").replace("ready", "free").replace("chosen", "pick")
    .replace("emitEvent", "publish").replace("releaseWorker", "freeOrb").replace("worker", "orb")
    .replace("load", "busyness").replace("weight", "cost").replace("skills", "talents")
)

# A table of string pairs. Theirs and ours share no entry, only the shape `"k": "v",` that every
# such table has; with strings normalized, the shapes are identical token for token.
THEIR_TABLE = "export const TYPES = {\n" + "".join(f'  ".x{i}": "type/{i}",\n' for i in range(40)) + "};\n"
OUR_TABLE = "LEXICON = {\n" + "".join(f'    "word{i}": "sound {i}",\n' for i in range(40)) + "}\n"

# A tiny idiom anyone would write; must NOT be called a copy.
IDIOM = 'export function now(): number {\n  return Date.now();\n}\n'


def tree(root: Path, files: dict[str, str]) -> Path:
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    return root


def scan(ours: Path, theirs: Path) -> tuple[int, str]:
    buf = io.StringIO()
    with redirect_stdout(buf), redirect_stderr(buf):
        rc = copyscan.main(["--ours", str(ours), "--theirs", str(theirs)])
    return rc, buf.getvalue()


with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    theirs = tree(td / "theirs", {"src/scheduler.ts": THEIRS})

    # C.0 — the control: a verbatim paste must be caught, with file and lines named.
    rc, out = scan(tree(td / "o0", {"packages/home/pick.ts": OURS_CLEAN + PASTED}), theirs)
    check("C.0 verbatim paste is caught (exit 1)", rc == 1, out)
    check("C.0 finding names our file and their file", "packages/home/pick.ts" in out and "src/scheduler.ts" in out, out)

    # C.1 — renamed copy is still a copy.
    rc, out = scan(tree(td / "o1", {"packages/home/orbs.ts": RENAMED}), theirs)
    check("C.1 renamed copy is caught in normalized mode", rc == 1 and "normalized" in out, out)

    # C.2 — clean code passes.
    rc, out = scan(tree(td / "o2", {"packages/home/choose.ts": OURS_CLEAN}), theirs)
    check("C.2 clean tree passes (exit 0)", rc == 0, out)

    # C.3 — a common idiom shared by both is not a copy.
    theirs3 = tree(td / "theirs3", {"src/time.ts": THEIRS + IDIOM})
    rc, out = scan(tree(td / "o3", {"packages/home/time.ts": OURS_CLEAN + IDIOM}), theirs3)
    check("C.3 a short shared idiom is not flagged", rc == 0, out)

    # C.4 — their code inside OUR comment is stripped (we describe, we don't ship it).
    commented = "/*\n" + PASTED + "*/\n" + OURS_CLEAN
    rc, out = scan(tree(td / "o4", {"packages/home/notes.ts": commented}), theirs)
    check("C.4 code quoted in a comment is not shipped code", rc == 0, out)

    # C.7 — a table of string pairs is data: the same shape as theirs, none of their content.
    theirs7 = tree(td / "theirs7", {"src/types.ts": THEIR_TABLE})
    rc, out = scan(tree(td / "o7", {"kit/ash/lexicon.py": OUR_TABLE}), theirs7)
    check("C.7 a table of different string pairs is not a copy", rc == 0, out)
    # ...but their table, pasted, still is (exact mode is not loosened)
    rc, out = scan(tree(td / "o7b", {"packages/home/types.ts": THEIR_TABLE}), theirs7)
    check("C.7b CONTROL: their table pasted verbatim is still caught", rc == 1 and "exact" in out, out)

    # C.7c — the same with bare keys (`KEY: "value"`): a key in front of a literal is the table's,
    # not a name the code uses (found 2026-10-01: our voice names against their key map)
    their_keys = "const KEY_MAP = {\n" + "".join(f'  K{i}: "v{i}", W{i}: "w{i}",\n' for i in range(40)) + "};\n"
    our_keys = "const NAMES = {\n" + "".join(f'  n{i}: "x{i}", m{i}: "y{i}",\n' for i in range(40)) + "};\n"
    theirs7c = tree(td / "theirs7c", {"src/keys.ts": their_keys})
    rc, out = scan(tree(td / "o7c", {"packages/app/names.ts": our_keys}), theirs7c)
    check("C.7c a table with bare keys and different values is not a copy", rc == 0, out)
    rc, out = scan(tree(td / "o7d", {"packages/app/keys.ts": their_keys}), theirs7c)
    check("C.7d CONTROL: their bare-key table pasted verbatim is still caught", rc == 1 and "exact" in out, out)

    # C.5 — a scan that cannot run must not read as a pass.
    rc, out = scan(td / "o2", td / "does-not-exist")
    check("C.5 missing Open Dot tree exits 2, never 0", rc == 2, out)

# C.6 — the real check: our repo against the cached Open Dot checkout, when present.
if (copyscan.CACHE / ".git").exists():
    rc, out = scan(copyscan.REPO, copyscan.CACHE)
    check("C.6 ~/orbs is clean against Open Dot", rc == 0, out)
else:
    print("SKIP  C.6 no Open Dot checkout (run copyscan.py --fetch)")

print(f"\n{'ALL PASS' if not FAILS else f'{FAILS} FAILED'}")
sys.exit(1 if FAILS else 0)
