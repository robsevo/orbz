#!/usr/bin/env python3
"""Controls for the home's tests (PLAN 1.2_t; CLAUDE.md rule 4): each mutant plants one real
defect in a scratch copy of packages/home, and the named suite must go red. The repo itself is
never touched.

    pnpm check:controls      # runs this after tools/check_controls.py
"""
from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HOME_PKG = REPO / "packages" / "home"

# (the defect, the file, the exact text it replaces, the replacement, the suites that must go red)
MUTANTS = [
  ("schedules skip missed times (Open Dot)", "src/schedule.ts",
   "      if (!missedTimes) continue;",
   "      if (!missedTimes || missedTimes.count > 1) { if (missedTimes) this.#db.prepare('UPDATE schedules SET last_due = ? WHERE id = ?').run(missedTimes.due, s.id); continue; }",
   ["home.test.ts"]),
  ("triggers drop what happened during sleep", "src/triggers.ts",
   "      if (t.started) for (const e of [...got.events].sort((a, b) => a.at - b.at)) if (this.#deliver(t, e)) n++;",
   "      if (t.started) for (const e of [...got.events].sort((a, b) => a.at - b.at)) if (this.#clock.now() - e.at < 10 * 60_000 && this.#deliver(t, e)) n++;",
   ["home.test.ts"]),
  ("tripwire hashed after the sensor (Ash before 09-10)", "src/loops.ts",
   "        plan = await untilAborted(Promise.resolve(def.sense(abort.signal)), abort.signal);",
   "        plan = await untilAborted(Promise.resolve(def.sense(abort.signal)), abort.signal); before = hashFiles(globs);",
   ["loops.test.ts"]),
  ("two runs at once for one orb", "src/inbox.ts",
   "    if (this.#closed || this.#active.has(orb)) return;",
   "    if (this.#closed) return; if (this.#active.has(orb) && this.queued(orb).length === 0) return;",
   ["inbox.test.ts"]),
  ("no batching: one item per run", "src/inbox.ts",
   "      batch.push(it);\n",
   "      batch.push(it);\n      break;\n",
   ["inbox.test.ts"]),
  ("a crash drops the cut-off work", "src/inbox.ts",
   'if (outcome === "paused" || outcome === "shutdown" || outcome === "interrupted") {',
   'if (outcome === "paused" || outcome === "shutdown") {',
   ["inbox.test.ts"]),
  ("the event log allows UPDATE", "src/db.ts",
   "  CREATE TRIGGER events_no_update BEFORE UPDATE ON events\n    BEGIN SELECT RAISE(ABORT, 'the event log is append-only'); END;\n",
   "",
   ["events.test.ts"]),
]

# A mutant whose anchor needs a second, linked edit to typecheck at runtime.
LINKED = {"tripwire hashed after the sensor (Ash before 09-10)": ("    const before = hashFiles(globs);", "    let before = hashFiles(globs);")}


def main() -> int:
    fails = 0
    with tempfile.TemporaryDirectory(prefix="orbs-mutants-") as tmp:
        for name, rel, old, new, suites in MUTANTS:
            work = Path(tmp) / "home"
            if work.exists():
                shutil.rmtree(work)
            shutil.copytree(HOME_PKG, work, symlinks=True, ignore=shutil.ignore_patterns("node_modules"))
            (work / "node_modules").symlink_to(HOME_PKG / "node_modules", target_is_directory=True)
            f = work / rel
            text = f.read_text()
            if old not in text:
                print(f"FAIL  {name}: its anchor is gone from {rel}; update the mutant")
                fails += 1
                continue
            if name in LINKED:
                a, b = LINKED[name]
                text = text.replace(a, b, 1)
            f.write_text(text.replace(old, new, 1))
            r = subprocess.run(["node", "--test", *[str(work / "test" / s) for s in suites]],
                               cwd=work, capture_output=True, text=True, timeout=300)
            caught = r.returncode != 0
            print(f"{'PASS' if caught else 'FAIL'}  M: {', '.join(suites)} catches: {name}")
            fails += not caught
    print("ALL PASS" if not fails else f"{fails} FAILED")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
