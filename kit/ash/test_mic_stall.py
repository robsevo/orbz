#!/usr/bin/env python3
"""No microphone is not a frozen daemon (2026-09-28). Run: orb/daemon/.venv/bin/python orb/daemon/test_mic_stall.py

With every input unplugged, `pw-record` kept running with its stream linked to nothing — 0 bytes a
second — and `mic_frames` waited on it forever. The loop that reads those frames is also the one
that fires reminders (`listen.py`, D325) and reads the sleep toggle, so with no mic no reminder
could fire, and mic-state.json still said "listening". Real subprocesses, a fake `pw-record` first
on PATH that runs and sends nothing.

  MS.1  a recorder that runs and sends nothing is reported down within STALL_S, with the reason
  MS.2  with keep_alive, the loop gets silent frames at the frame rate while the mic is down
  MS.3  without it (the default), a caller that only wants real audio gets none
  MS.4  ashd asks for keep_alive: its loop fires the reminders
  MS.0  CONTROL: the committed mic_frames, on the same recorder, reports nothing and yields nothing
"""
# ASH_TIER: product
import ast
import os
import subprocess
import sys
import tempfile
import threading
import time
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import micaudio  # noqa: E402

FAIL = []


def ok(cond, label):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}")
    if not cond:
        FAIL.append(label)


_bin = Path(tempfile.mkdtemp(prefix="ms-"))
(_bin/"pw-record").write_text("#!/bin/sh\nexec sleep 60\n")          # runs, and sends nothing
(_bin/"pw-record").chmod(0o755)
os.environ["PATH"] = f"{_bin}:{os.environ['PATH']}"


def drive(mod, seconds, **kw):
    """(frames with the time each arrived, what on_state was told) over `seconds`."""
    frames, told, t0 = [], [], time.monotonic()
    saved = (mod.named_source, mod.log)
    mod.named_source = lambda: None
    mod.log = lambda *a: None
    stop = lambda: time.monotonic() - t0 > seconds                   # noqa: E731

    def run():
        try:
            for f in mod.mic_frames(None, stop=stop, on_state=lambda k, why="": told.append((k, why)), **kw):
                frames.append((time.monotonic() - t0, len(f), f.count(0) == len(f)))
                if stop():
                    return
        except Exception as e:
            told.append(("RAISED", f"{type(e).__name__}: {e}"))
    th = threading.Thread(target=run, daemon=True)
    th.start()
    th.join(seconds + 8)
    mod.named_source, mod.log = saved
    return frames, told


frames1, told1 = drive(micaudio, 6.0)
ok(told1[:1] and told1[0][0] is False and "no sound from the microphone" in told1[0][1],
   f"MS.1 a silent recorder is reported down, with the reason: {told1[:1]}")
ok(frames1 == [], f"MS.3 without keep_alive a caller that wants real audio gets none: {len(frames1)} frames")

frames2, told2 = drive(micaudio, 6.0, keep_alive=True)
first = frames2[0][0] if frames2 else None
ok(frames2 and all(n == micaudio.FRAME * 2 and silent for _t, n, silent in frames2) and first < micaudio.STALL_S + 1.0,
   f"MS.2 with keep_alive, silent frames arrive once the stall is seen ({len(frames2)} frames, the first at "
   f"{first and round(first, 2)} s)")
if len(frames2) > 10:
    gaps = [b[0] - a[0] for a, b in zip(frames2, frames2[1:])]
    ok(max(gaps) < 0.5, f"MS.2 ...at about the frame rate, never a long gap: the longest {max(gaps):.2f} s")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

old = __import__("carried_git").show("b015e3f:orb/daemon/micaudio.py").stdout
if not old or "STALL_S" in old:
    ok(False, "MS.0 CONTROL: the committed micaudio.py is not the pre-fix one, so it cannot be run")
else:
    m = types.ModuleType("micaudio_head")
    m.__file__ = micaudio.__file__
    exec(compile(old, "micaudio_head", "exec"), m.__dict__)
    frames0, told0 = drive(m, 6.0)
    ok(frames0 == [] and told0 == [],
       f"MS.0 CONTROL: the committed reader, on the same silent recorder, says nothing and yields nothing "
       f"({len(frames0)} frames, told {told0}), so MS.1 and MS.2 can fail")

if FAIL:
    print(f"\nFAIL  mic stall  ({len(FAIL)} failing)")
    raise SystemExit(1)
print("\nPASS  mic stall  (0 failing)")
