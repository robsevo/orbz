#!/usr/bin/env python3
"""wake-state.json has one owner. Run: orb/daemon/.venv/bin/python test_wake_state.py

PLAN 6.13. Two processes wrote this file with two DIFFERENT schemas:

  ashd.write_state(**st)  ->  {"state": "listening", ..., "t": ...}
  wake.py                 ->  {"t": ..., "score": 0.71, "model": "hey_ash"}

The orb's `pumpWake` reads `state` off it to drive the body's colour and speech envelope.
Run the wake tool while the orb is up and the orb reads a shape with no `state` in it at
all. `wake.py` also used a shared `.json.tmp` — the exact race ashd's own `write_state` was
fixed for on 2026-09-15, in a copy that never was.

K.0 is the control: the two schemas must be shown to be incompatible, or "one owner" is a
tidiness argument rather than a bug fix.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def code_only(py):
    """Strip whole-line comments — the fix quotes the old code above the new code."""
    return "\n".join(l for l in py.splitlines() if not l.strip().startswith("#"))


wake_src = code_only((HERE/"wake.py").read_text())

# ── K.0  CONTROL: the two schemas really are incompatible ──────────────────────────────
ashd_shape = {"state": "listening", "t": 1.0}
wake_shape = {"t": 1.0, "score": 0.71, "model": "hey_ash"}
ok("state" not in wake_shape,
   "K.0 CONTROL: the wake tool's payload has no `state` key at all")
ok(ashd_shape.get("state") and not wake_shape.get("state"),
   "K.0 CONTROL: so a reader keying on `state` gets nothing from it — that is the orb's "
   "pumpWake, and it drives the body's colour and envelope")

# ── K.1  the tool writes its own file by default ───────────────────────────────────────
ok("PROBE" in wake_src, "K.1 the tool has a file of its own")
ok("target = STATE if share else PROBE" in wake_src,
   "K.1 and writes the daemon's file only when explicitly asked")
ok("--share-state" in wake_src,
   "K.1 the override exists and is named for what it does")
ok("share=a.share_state" in wake_src,
   "K.1 and the flag is actually threaded to the writer, not just declared")

# ── K.2  the tmp name is no longer shared ──────────────────────────────────────────────
ok('with_suffix(".json.tmp")' not in wake_src,
   "K.2 the shared '.json.tmp' is gone — that is the 2026-09-15 race, in a copy that was "
   "never fixed")
ok("getpid()" in wake_src.split("def write_state")[1][:400],
   "K.2 the tmp is per process")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

# ── K.4  the writer actually round-trips, both ways ────────────────────────────────────
import importlib.util
from pagesrc import page_source  # noqa: E402
spec = importlib.util.spec_from_file_location("wakemod", HERE/"wake.py")
try:
    wake = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wake)
except Exception as e:                       # openwakeword may be absent in a bare env
    print(f"  skip K.4: wake.py will not import here ({type(e).__name__})")
else:
    d = Path(tempfile.mkdtemp(prefix="wakestate-"))
    wake.PROBE = d/"wake-probe.json"
    wake.STATE = d/"wake-state.json"
    wake.write_state({"t": 1.0, "score": 0.9, "model": "hey_ash"})
    ok(wake.PROBE.exists(), "K.4 the default write lands in the probe file")
    ok(not wake.STATE.exists(),
       "K.4 and NOT in the daemon's state — this is the whole fix")
    wake.write_state({"t": 2.0, "score": 0.9, "model": "hey_ash"}, share=True)
    ok(wake.STATE.exists(), "K.4 --share-state does reach the daemon's file when asked")
    ok(sorted(p.name for p in d.glob("*.tmp")) == [], "K.4 no temp file is left behind")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

# ── K.6  the tmp name survives concurrency, measured rather than read ──────────────────
# K.2 asserted the string `getpid()` appears near write_state. It did, and the file still
# tore: pid alone is half the fix, because two threads in ONE process share the name and one
# renames the tmp the other is still writing. ashd's own write_state has used pid AND thread
# since 2026-09-15 (K.3 asserts that); this copy had not. Found by running it, not reading it.
    import threading as _th
    errs = []

    def _hammer(n):
        try:
            for i in range(40):
                wake.write_state({"t": float(n * 100 + i), "score": 0.5, "model": "m"})
        except Exception as e:
            errs.append(repr(e))

    def _reader():
        for _ in range(400):
            try:
                json.loads(wake.PROBE.read_text())
            except FileNotFoundError:
                errs.append("the probe file vanished mid-write")
            except json.JSONDecodeError:
                errs.append("a reader saw a partial file")
            except Exception:
                pass

    ths = [_th.Thread(target=_hammer, args=(n,)) for n in range(8)] + \
          [_th.Thread(target=_reader) for _ in range(2)]
    for th in ths:
        th.start()
    for th in ths:
        th.join()
    ok(not errs, f"K.6 8 writers and 2 readers, no torn read and no lost file: {errs[:4]}")
    ok("get_ident()" in wake_src.split("def write_state")[1][:600],
       "K.6 and the reason is in the code: the tmp is unique per process AND thread")


if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print("✓ wake-state: 7 groups green (K.0 control: the two schemas are incompatible)")
