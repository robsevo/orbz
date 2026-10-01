"""Run model-written habit code where it cannot hurt anything (bubblewrap).

The habit runs with: no network (--unshare-all), a read-only root, an EMPTY /home and /root
(tmpfs, so it cannot read the user's files), a private /tmp, its own session, a CPU-time and
memory limit, and a wall-clock timeout. Inputs go in on stdin as one batch; results come back as
JSON on stdout. Code that tries to do anything else simply fails, and a failure is a failed test.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

RUNNER = r'''
import json, resource, sys, traceback
resource.setrlimit(resource.RLIMIT_AS, (1 << 30, 1 << 30))
resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
sys.path.insert(0, "/tmp/habit")
req = json.load(sys.stdin)
out = []
try:
    import habit
except Exception:
    print(json.dumps({"load_error": traceback.format_exc(limit=3)})); sys.exit(0)
for inp in req["inputs"]:
    r = {}
    try:
        g = habit.guard(inp)
        r["guard"] = None if g is None else str(g)
    except Exception as e:
        r["guard"] = f"guard raised {type(e).__name__}: {e}"
    if r["guard"] is None or req.get("force_run"):
        try:
            r["output"] = habit.run(inp)
        except Exception as e:
            r["error"] = f"{type(e).__name__}: {e}"
    out.append(r)
print(json.dumps({"results": out}))
'''


def available() -> bool:
    return shutil.which("bwrap") is not None


def run_habit(code: str, inputs: list[dict], timeout: int = 30, force_run: bool = False) -> dict:
    """Returns {"results": [{guard, output|error}...]} or {"load_error": ...} / {"crash": ...}."""
    if not available():
        raise RuntimeError("bubblewrap (bwrap) is required to run habit code safely")
    with tempfile.TemporaryDirectory(prefix="orbs-habit-") as d:
        hd = Path(d)
        (hd / "habit.py").write_text(code)
        (hd / "runner.py").write_text(RUNNER)
        cmd = [
            "bwrap", "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc",
            "--tmpfs", "/tmp", "--tmpfs", "/home", "--tmpfs", "/root", "--tmpfs", "/run",
            "--ro-bind", str(hd), "/tmp/habit", "--unshare-all", "--die-with-parent", "--new-session",
            "--chdir", "/tmp/habit", "/usr/bin/python3", "-I", "/tmp/habit/runner.py",
        ]
        try:
            p = subprocess.run(cmd, input=json.dumps({"inputs": inputs, "force_run": force_run}),
                               capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return {"crash": f"timed out after {timeout}s"}
        if p.returncode != 0 or not p.stdout.strip():
            return {"crash": f"exit {p.returncode}: {p.stderr[-500:]}"}
        try:
            return json.loads(p.stdout.strip().splitlines()[-1])
        except json.JSONDecodeError:
            return {"crash": f"unparseable output: {p.stdout[-300:]}"}
