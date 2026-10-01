"""Habits in the kit (PLAN 1.4): the first rung of the ladder, for habits written in Python.

A habit lives in a directory of its own: `habit.py` (the teacher's code: `guard(input)` returns
None or a reason, `run(input)` returns the answer) and `habit.json` (its version and the two
familiarity fingerprints learned by code from the approved cases, see fingerprint.py). It
answers only when three checks made by code all agree — the Phase 0 spike's ladder:

  1. the input looks like the approved inputs     (in_fp, before the habit runs at all)
  2. the habit's own guard accepts it             (inside the sandbox)
  3. the answer looks like the approved answers   (out_fp)

Anything else hands the case back, with the reason, to the next rung. The habit's code is
model-written, so it runs in a sandbox: bubblewrap, no network, a read-only root, an empty /home,
a private /tmp, CPU and memory limits, a timeout. With no sandbox on this machine a habit does not
run at all; it falls through and says why (PLAN 3.2 brings the other OSes' sandboxes).
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from orbs_kit import fingerprint as fpm

TIMEOUT_S = 15

RUNNER = r'''
import json, resource, sys, traceback
resource.setrlimit(resource.RLIMIT_AS, (1 << 30, 1 << 30))
resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
sys.path.insert(0, "/tmp/habit")
req = json.load(sys.stdin)
try:
    import habit
except Exception:
    print(json.dumps({"load_error": traceback.format_exc(limit=3)})); sys.exit(0)
r = {}
try:
    g = habit.guard(req["input"])
    r["guard"] = None if g is None else str(g)
except Exception as e:
    r["guard"] = f"guard raised {type(e).__name__}: {e}"
if r["guard"] is None:
    try:
        r["output"] = habit.run(req["input"])
    except Exception as e:
        r["error"] = f"{type(e).__name__}: {e}"
print(json.dumps(r))
'''


def fp_to_json(fp: dict) -> dict:
    """Fingerprints hold sets; on disk they are sorted lists."""
    def conv(x):
        if isinstance(x, set):
            return sorted(x)
        if isinstance(x, dict):
            return {k: conv(v) for k, v in x.items()}
        return x
    return conv(fp)


def fp_from_json(fp: dict) -> dict:
    sets = {"types", "keys", "required", "shapes", "symbols"}
    paths = {p: {k: (set(v) if k in sets else v) for k, v in st.items()} for p, st in fp["paths"].items()}
    return {"paths": paths, "times": fp["times"], "outputs": fp["outputs"]}


def save(directory: Path, code: str, approved: list[tuple[dict, object]], version: int = 1) -> None:
    """Writes a habit learned from approved (input, answer) pairs. The compiler (PLAN 3.2) calls this
    only after the harness has re-run the habit on every approved case."""
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "habit.py").write_text(code)
    meta = {
        "version": version,
        "in_fp": fp_to_json(fpm.learn([i for i, _ in approved])),
        "out_fp": fp_to_json(fpm.learn([o for _, o in approved], outputs=True)),
    }
    (directory / "habit.json").write_text(json.dumps(meta, indent=1, sort_keys=True) + "\n")


def sandbox() -> list[str] | None:
    """The command prefix that runs the kit's own Python inside bubblewrap, or None if this machine
    cannot. The kit's Python lives under /home on most installs, which the sandbox empties, so its
    install directory is bound back, read-only."""
    bwrap = shutil.which("bwrap")
    if not bwrap or sys.platform != "linux":
        return None
    base = Path(sys.base_prefix).resolve()
    python = Path(sys.executable).resolve()
    if not python.is_relative_to(base):
        python = base / "bin" / "python3"
    return [bwrap, "--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc",
            "--tmpfs", "/tmp", "--tmpfs", "/home", "--tmpfs", "/root", "--tmpfs", "/run",
            "--ro-bind", str(base), str(base),
            "--unshare-all", "--die-with-parent", "--new-session", str(python), "-I", "-S"]


def answer(directory: Path, value: dict, timeout: float = TIMEOUT_S) -> dict:
    """{"answered": True, "output": ..., "version": n} or {"answered": False, "why": "..."}."""
    directory = Path(directory)
    try:
        meta = json.loads((directory / "habit.json").read_text())
        code = (directory / "habit.py").read_text()
    except (OSError, ValueError) as e:
        return {"answered": False, "why": f"the habit could not be read: {type(e).__name__}"}
    why = fpm.check(value, fp_from_json(meta["in_fp"]))
    if why:
        return {"answered": False, "why": f"unfamiliar input: {why}"}
    prefix = sandbox()
    if prefix is None:
        return {"answered": False, "why": "no habit sandbox on this machine yet (bubblewrap on Linux; PLAN 3.2)"}
    with tempfile.TemporaryDirectory(prefix="orbs-habit-") as d:
        hd = Path(d)
        (hd / "habit.py").write_text(code)
        (hd / "runner.py").write_text(RUNNER)
        # the habit's own directory is bound after the /tmp tmpfs, before the namespaces close
        cut = prefix.index("--unshare-all")
        cmd = prefix[:cut] + ["--ro-bind", str(hd), "/tmp/habit", "--chdir", "/tmp/habit"] \
            + prefix[cut:] + ["/tmp/habit/runner.py"]
        try:
            p = subprocess.run(cmd, input=json.dumps({"input": value}), capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return {"answered": False, "why": f"the habit ran past {timeout:g} s"}
    if p.returncode != 0 or not p.stdout.strip():
        return {"answered": False, "why": f"the sandbox failed (exit {p.returncode}): {p.stderr.strip()[-200:]}"}
    try:
        r = json.loads(p.stdout.strip().splitlines()[-1])
    except ValueError:
        return {"answered": False, "why": "the habit printed something that is not its answer"}
    if "load_error" in r:
        return {"answered": False, "why": "the habit's code does not load"}
    if r.get("guard") is not None:
        return {"answered": False, "why": f"its guard said no: {r['guard']}"}
    if "error" in r:
        return {"answered": False, "why": f"it raised {r['error']}"}
    why = fpm.check(r.get("output"), fp_from_json(meta["out_fp"]))
    if why:
        return {"answered": False, "why": f"the answer does not look like an approved one: {why}"}
    return {"answered": True, "output": r["output"], "version": meta.get("version", 1)}
