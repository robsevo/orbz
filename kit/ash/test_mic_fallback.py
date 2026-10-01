#!/usr/bin/env python3
"""A machine with a working microphone and no default source must not come up deaf.

Run: orb/daemon/.venv/bin/python test_mic_fallback.py

PLAN 11.5. On 2026-09-17 the orb came up deaf and the wake word never fired all session.
PipeWire's default target was unset while a perfectly good microphone was attached:
`pw-record` with no target — and with the node's numeric id — both died on *"no target node
available"*, while the same device passed BY NAME captured normally. **A failure to open the
default is not a missing mic; it is a missing default.**

MF.0 IS THE CONTROL: with the default working, no target is passed at all. A fallback that
always names a device would pass every check below while hiding the moment the default
stops working — and the default is what should be used when it exists, because it is what
the person chose.

Nothing here opens a real microphone: `micaudio`'s `subprocess` is patched in place.

**It imports the module now rather than exec'ing its source (18.1).** Until the extraction
this suite lifted `named_source` and `mic_frames` out of `ashd.py` with `ast` and ran them in
a hand-built namespace, because importing `ashd` loads audio models and starts threads. That
is the shape where a copy of the logic tests the copy: the namespace supplied `FRAME`, `log`
and `orphaned` by hand, so the exec'd copy could pass while the real module raised
`NameError` on a global the extraction had left behind — which is exactly D257. `micaudio`
imports `subprocess`, `time`, `wave` and `log`, so there is nothing left to hide from.
"""
import ast
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def eq(got, want, label):
    if got != want:
        FAIL.append(f"{label}\n     got: {got!r}\n    want: {want!r}")


# PLANTABLE WITHOUT TOUCHING A CLAIMED FILE. `ASH_MIC_SRC` overrides the module UNDER
# TEST, not merely the text this suite reads: both the behaviour and the AST come from
# whatever `micaudio.__file__` says, so there is no way for the structural half and the
# behavioural half to be looking at two different files. Splitting them is how a plant gets
# reported caught by one and missed by the other.
import importlib.util
import os

_OVERRIDE = os.environ.get("ASH_MIC_SRC")
try:
    if _OVERRIDE:
        _spec = importlib.util.spec_from_file_location("micaudio_under_test", _OVERRIDE)
        micaudio = importlib.util.module_from_spec(_spec)
        _spec.loader.exec_module(micaudio)
    else:
        import micaudio
except Exception as _e:                                   # pragma: no cover
    # REPORTED, NOT RAISED. `micaudio` reaching back for anything it was extracted from is a
    # circular import, and an unguarded `import` turns that into a traceback on line 40 —
    # red for the right reason and unreadable, which is how three red runs got written off
    # as flakes (D62). Measured by planting exactly that.
    print(f"✗ 1 failure(s):\n\n  - MF `micaudio` does not import "
          f"({type(_e).__name__}: {_e}) — every check in this file is blind rather than red\n")
    sys.exit(1)

SRC_PATH = Path(micaudio.__file__)
SRC = SRC_PATH.read_text()
TREE = ast.parse(SRC)


def lift(name):
    """The SOURCE of a top-level function, for the checks that are about how it is written.

    Nothing is exec'd from it any more — `run_mic` calls the imported module. This exists
    for MF.3 and MF.5, which are about structure and about a comment that has to stay.
    """
    fn = next((n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name == name), None)
    if fn is None:
        FAIL.append(f"MF `{name}` is no longer a top-level function in {SRC_PATH.name} — "
                    f"every check below is blind rather than red")
        return None
    return ast.get_source_segment(SRC, fn)


# ── the stand-in PipeWire ──────────────────────────────────────────────────────────────
class FakeProc:
    def __init__(self, chunks, err=b""):
        self._chunks = list(chunks)
        self.stdout = self
        self.stderr = _Bytes(err)
        self.killed = False

    def read(self, _n):
        return self._chunks.pop(0) if self._chunks else b""

    def kill(self):
        self.killed = True


class _Bytes:
    def __init__(self, b):
        self._b = b

    def read(self):
        return self._b


class Fake:
    """Records every command, and answers the way PipeWire did on 2026-09-17."""

    def __init__(self, sources="", opens=None):
        self.sources, self.cmds = sources, []
        self.opens = list(opens or [])

    def run(self, cmd, **kw):
        self.cmds.append(cmd)

        class R:
            stdout = self.sources
        return R()

    def Popen(self, cmd, **kw):
        self.cmds.append(cmd)
        return self.opens.pop(0) if self.opens else FakeProc([], b"no target node available")

    PIPE = -1


# DERIVED, NOT RETYPED. `FRAME = 1280` was typed here, in `ashd.py` and in `wake.py`:
# three copies of one number that agreed, so nothing was wrong, so nothing ever said
# anything. A suite that retypes the constant goes green on a code change it should catch.
FRAME = micaudio.FRAME
NO_TARGET = b"pw-record: error: no target node available\n"
FRAMES = [b"\0" * (FRAME * 2)] * 3


def run_mic(fake, limit=3, target=None):
    """Drive the REAL `micaudio.mic_frames` for `limit` frames against the stand-in.

    Patches the module's own globals and puts them back. `stop` is a parameter now, so the
    fake clock ends the retry loop through the same seam `ashd.main` uses for `orphaned`
    rather than through a name injected into a namespace.
    """
    saved = (micaudio.subprocess, micaudio.time, micaudio.log)
    micaudio.subprocess, micaudio.time, micaudio.log = fake, _FakeTime(), _log
    try:
        got, gen = [], micaudio.mic_frames(target, stop=lambda: _stop["now"])
        for _ in range(limit):
            try:
                got.append(next(gen))
            except StopIteration:
                break
            except RuntimeError as e:          # the clock cap — report it, do not hang
                FAIL.append(f"MF the retry loop never ended ({e}); every check below is "
                            f"reading a truncated run")
                break
        gen.close()
        return got
    finally:
        # A teardown that can raise is worse than no teardown — it masks the result of the
        # check that was about to print.
        micaudio.subprocess, micaudio.time, micaudio.log = saved


LOG = []
_stop = {"now": False, "sleeps": 0, "after": 1}


def _log(*a):
    LOG.append(" ".join(str(x) for x in a))


class _FakeTime:
    """Sleeps instantly, and stops the retry loop after `_stop["after"]` sleeps.

    The first version stopped on the FIRST sleep, so the loop never went round twice and
    MF.4's "it warns exactly once" could not fail — a fixture that cannot reach the second
    iteration cannot test what happens on it.

    **And it raises at a cap.** Every one of these checks ends the retry loop by making
    `stop` true. Plant the defect that ignores `stop` and the loop never ends: the suite
    HANGS, the runner kills it on its own timeout minutes later, and nothing this file was
    about ever prints. "A check that dies is not a check that reported" — one that hangs is
    the same thing with a longer wait and a worse diagnosis, because it reads as an
    infrastructure problem rather than a red check. Found by planting exactly that (18.1).
    """
    CAP = 400

    def sleep(self, _s):
        _stop["sleeps"] += 1
        if _stop["sleeps"] > self.CAP:
            raise RuntimeError(f"retry loop did not stop after {self.CAP} sleeps")
        if _stop["sleeps"] >= _stop["after"]:
            _stop["now"] = True

    def time(self):
        return 0.0


# ── MF.0  CONTROL: a working default is used as-is ─────────────────────────────────────
LOG.clear(); _stop.update(now=False, sleeps=0, after=1)
fake = Fake(sources="1\talsa_input.real\tmodule\ts16le\tRUNNING\n",
            opens=[FakeProc(FRAMES)])
frames = run_mic(fake)
eq(len(frames), 3, "MF.0 frames arrive from the default source")
rec = [c for c in fake.cmds if c and c[0] == "pw-record"]
ok(rec, "MF.0 pw-record was started")
eq(any("--target" in c for c in rec), False,
   f"MF.0 CONTROL: with the default WORKING, no `--target` is passed — the default is what "
   f"the person chose, and a fallback that always names a device hides the moment the "
   f"default stops working: {rec}")
eq([c for c in fake.cmds if c and c[0] == "pactl"], [],
   "MF.0 and nothing goes looking for a named source when it is not needed")

# ── MF.1  no default, but a real mic: fall back BY NAME ────────────────────────────────
LOG.clear(); _stop.update(now=False, sleeps=0, after=1)
fake = Fake(sources="1\talsa_output.speakers.monitor\tmodule\ts16le\tIDLE\n"
                    "2\talsa_input.usb_mic\tmodule\ts16le\tIDLE\n",
            opens=[FakeProc([], NO_TARGET), FakeProc(FRAMES)])
frames = run_mic(fake)
eq(len(frames), 3,
   "MF.1 the machine is NOT deaf — 'no target node available' with a real microphone "
   "attached is a missing default, not a missing mic")
rec = [c for c in fake.cmds if c and c[0] == "pw-record"]
eq(len(rec), 2, f"MF.1 it tried twice: once bare, once named: {rec}")
# Guarded: the defect this catches is the one that never makes a second attempt, so
# `rec[1]` is exactly the subscript that kills the suite with the finding unprinted.
_second = rec[1] if len(rec) > 1 else []
ok("--target" in _second and "alsa_input.usb_mic" in _second,
   f"MF.1 and the second names the device: {_second}")
ok(any("no default source" in l for l in LOG), f"MF.1 saying what it did: {LOG}")

# ── MF.2  a monitor is never chosen ────────────────────────────────────────────────────
# A `.monitor` source is the SPEAKERS. Capturing it means he hears himself — every reply
# would come back through the wake model as if the room had said it.
LOG.clear(); _stop.update(now=False, sleeps=0, after=1)
fake = Fake(sources="1\talsa_output.speakers.monitor\tmodule\ts16le\tIDLE\n"
                    "2\talsa_output.hdmi.monitor\tmodule\ts16le\tIDLE\n",
            opens=[FakeProc([], NO_TARGET), FakeProc(FRAMES)])
run_mic(fake, limit=1)
named = [c for c in fake.cmds if c and c[0] == "pw-record" and "--target" in c]
eq(named, [],
   f"MF.2 CONTROL: with ONLY monitors available, none is chosen — a `.monitor` source is "
   f"the speakers, and capturing it means every reply comes back through the wake model as "
   f"if the room had said it: {named}")

# ── MF.3  the fallback costs no penalty ────────────────────────────────────────────────
# The 2026-09-17 session was silent for its whole length. A fallback that waits out the
# 5-second retry before trying the name is a fallback nobody notices working.
seg = lift("mic_frames")
# Read the STRUCTURE, and guard the reads. Two faults in the first version: it matched the
# comment text verbatim, so rewording the comment would have failed it and deleting the
# `continue` while keeping the comment would not; and `.index()` on a `continue` a defect
# has just removed is the subscript that kills the suite on the line meant to report it.
_mic_fn = next((n for n in TREE.body
                if isinstance(n, ast.FunctionDef) and n.name == "mic_frames"), None)
_continues = [n for n in ast.walk(_mic_fn) if isinstance(n, ast.Continue)] if _mic_fn else []
_sleeps = [n for n in ast.walk(_mic_fn) if isinstance(n, ast.Call)
           and isinstance(n.func, ast.Attribute) and n.func.attr == "sleep"] if _mic_fn else []
ok(_continues,
   "MF.3 the named retry re-enters the loop rather than falling through to the sleep — the "
   "2026-09-17 session was silent for its whole length, and a fallback that waits out five "
   "seconds first is one nobody notices working")
ok(_continues and _sleeps and _continues[0].lineno < _sleeps[0].lineno,
   f"MF.3 and it is AHEAD of the sleep, which is what makes that true "
   f"(continue@{[n.lineno for n in _continues]}, sleep@{[n.lineno for n in _sleeps]})")

# ── MF.4  a genuinely missing mic retries rather than dying ────────────────────────────
# THREE PASSES, so "it warns once" is a claim about a loop that actually went round.
LOG.clear(); _stop.update(now=False, sleeps=0, after=40)
fake = Fake(sources="", opens=[FakeProc([], b"pw-record: error: no such device\n")
                               for _ in range(4)])
frames = run_mic(fake, limit=1)
eq(frames, [], "MF.4 nothing is yielded when there is no microphone at all")
ok(any("unavailable" in l and "retrying" in l for l in LOG),
   f"MF.4 and it says so, once, rather than failing silently or spinning the log: {LOG}")
eq(len([l for l in LOG if "unavailable" in l]), 1,
   f"MF.4 exactly once — a retry loop that logs every 5 s is a log nobody reads: {LOG}")

# ── MF.5  the rule is written where the decision is ────────────────────────────────────
named_src = lift("named_source") or ""
ok("missing default" in named_src,
   "MF.5 `named_source` says what the failure actually means — 'no target node available' "
   "reads as 'no microphone' to anybody who has not been bitten by it")
ok("2026-09-17" in named_src,
   "MF.5 and when it was measured, so the next person can find the session")

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print("✓ mic fallback: 6 groups green (MF.0 control: a working default is used as-is)")
