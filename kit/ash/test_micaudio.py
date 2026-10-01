#!/usr/bin/env python3
"""The first extraction out of `ashd.py` (PLAN 18.1 and 18.5_t).

Run: orb/daemon/.venv/bin/python orb/daemon/test_micaudio.py

`micaudio.py` took the audio-in job out of a 2,761-line daemon. The behaviour baseline covers
none of these four functions — it says so itself, and D257 is the standing record of what
happens when *"no drift"* gets read as *"the split is clean"* instead of *"the things I froze
still answer the same"*. So the proof for this extraction is here, in three parts:

**MA.0–MA.2 — the seam is actually used.** `mic_frames` stopped reading `ashd.orphaned` and
took a `stop` parameter. That is the right direction — an audio module reaching back into the
daemon's `PARENT` would make the extraction a circle — and it has a cost: a caller that
forgets `stop` gets a microphone that outlives the orb, and nothing raises.

**MA.3–MA.5 — `wav_frames` and `_wav_chunks` behave.** These had no test at all before the
move; `test_mic_fallback` covers the mic path only. They are how the whole daemon is driven
without a microphone, so every `--wav` run in this project has rested on them untested.

**MA.6–MA.8 — one definition, no circle, the re-export still resolves.** `FRAME = 1280` was
typed in three files. Three copies of one number agree until the day they do not, and on
that day there is no test that can say which is right.

**The source-only checks run BEFORE the module is imported, deliberately.** MA.7's defect —
`micaudio` importing something it was extracted from — is a circular import, so the module
does not load and a traceback lands on line 37. The suite would be red for the right reason
and unreadable, which is how three red runs got written off as flakes (D62). Measured by
planting it: the import-first version died with MA.7 unprinted.

Nothing here opens a microphone or writes outside a temp dir.
"""
# ASH_TIER: product
import ast
import pathlib
import re
import sys
import tempfile
import wave

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def eq(got, want, label):
    if got != want:
        FAIL.append(f"{label}\n     got: {got!r}\n    want: {want!r}")


def verdict():
    if FAIL:
        print(f"✗ {len(FAIL)} failure(s):\n")
        for f in FAIL:
            print(f"  - {f}\n")
        sys.exit(1)


SRC_PATH = HERE/"micaudio.py"
TREE = ast.parse(SRC_PATH.read_text())


def _calls_to(tree, name):
    return [n for n in ast.walk(tree) if isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name) and n.func.id == name]


# ══ source only, before the import ═════════════════════════════════════════════════════

# ── MA.7  the extraction is not a circle ───────────────────────────────────────────────
_imported = set()
for n in ast.walk(TREE):
    if isinstance(n, ast.Import):
        _imported.update(a.name.split(".")[0] for a in n.names)
    elif isinstance(n, ast.ImportFrom) and n.module:
        _imported.add(n.module.split(".")[0])
eq(sorted(_imported & {"ashd", "pair", "speakable", "workboard", "wake", "terminal"}), [],
   f"MA.7 `micaudio` imports nothing it was extracted from. A module that reaches back for "
   f"one name is not a seam, it is the same file in two places — and it is a circular "
   f"import, so the failure arrives as a traceback on somebody else's line: {sorted(_imported)}")
ok("numpy" not in _imported,
   f"MA.7a and it carries none of the daemon's weight — importing it costs no model, no "
   f"thread and no numpy, which is what let this suite stop exec'ing a copy of the source "
   f"and test the real module: {sorted(_imported)}")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

# ── MA.6  one definition of FRAME ──────────────────────────────────────────────────────
_retyped = []
for f in sorted(HERE.glob("*.py")):
    if f.name == SRC_PATH.name:
        continue
    try:
        tr = ast.parse(f.read_text())
    except SyntaxError:
        continue
    for n in ast.walk(tr):
        if isinstance(n, ast.Assign) and isinstance(n.value, ast.Constant) \
                and isinstance(n.value.value, (int, float)):
            for t in n.targets:
                if isinstance(t, ast.Name) and t.id in ("FRAME", "FRAME_S"):
                    _retyped.append(f"{f.name}:{n.lineno} {t.id} = {n.value.value}")
eq(_retyped, [],
   f"MA.6 `FRAME` has ONE definition. It was typed in `ashd.py`, `wake.py` and "
   f"`test_mic_fallback.py` — three copies that agreed, so nothing was wrong, so nothing "
   f"ever said anything. That is the 910 → 960 seam that kept three checks red for a day: "
   f"{_retyped}")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

try:
    import micaudio    # noqa: E402
except Exception as e:                                    # pragma: no cover
    FAIL.append(f"MA `micaudio` does not import: {type(e).__name__}: {e} — everything "
                f"below is blind rather than red")
    verdict()

# ══ behaviour ══════════════════════════════════════════════════════════════════════════


class _Bytes:
    def __init__(self, b): self._b = b
    def read(self): return self._b


class _Proc:
    def __init__(self, chunks, err=b""):
        self._c = list(chunks); self.stdout = self; self.stderr = _Bytes(err)
    def read(self, _n): return self._c.pop(0) if self._c else b""
    def kill(self): pass


class _Fake:
    def __init__(self, sources="", opens=()):
        self.sources, self.cmds, self.opens = sources, [], list(opens)

    def run(self, cmd, **kw):
        self.cmds.append(cmd)

        class R:
            stdout = self.sources
        return R()

    def Popen(self, cmd, **kw):
        self.cmds.append(cmd)
        return self.opens.pop(0) if self.opens else _Proc([], b"no target node available")
    PIPE = -1


class _Capped(RuntimeError):
    """The retry loop ran past the cap. Its own type, so `_drive` can tell it from a real
    fault in the code under test and report it as a finding rather than letting it end the
    suite — a check that dies is not a check that reported."""


class _Clock:
    """Instant sleeps, with a cap, so a loop that never stops is a red check rather than a
    hung suite. The first version of this file let the cap escape `_drive`: planting the
    defect that ignores `stop` killed the run on MA.1 with MA.1a — the check written for
    exactly that defect — never printed."""
    def __init__(self, cap=500): self.n, self.cap = 0, cap

    def sleep(self, _s):
        self.n += 1
        if self.n > self.cap:
            raise _Capped(f"the loop did not stop after {self.cap} sleeps")

    def time(self): return 0.0


def _drive(fake, clock, stop, limit=3, target=None):
    saved = (micaudio.subprocess, micaudio.time, micaudio.log)
    micaudio.subprocess, micaudio.time, micaudio.log = fake, clock, lambda *a: None
    try:
        got, gen = [], micaudio.mic_frames(target, stop=stop)
        for _ in range(limit):
            try:
                got.append(next(gen))
            except StopIteration:
                break
            except _Capped:
                break
        gen.close()
        return got
    finally:
        # A teardown that can raise is worse than no teardown — it masks the result of the
        # check that was about to print.
        micaudio.subprocess, micaudio.time, micaudio.log = saved


def _dead_mic(n):
    return _Fake(sources="", opens=[_Proc([], b"no such device\n") for _ in range(n)])


def _stop_after(k):
    box = {"n": 0}

    def s():
        box["n"] += 1
        return box["n"] > k
    return s


# ── MA.1  and `stop` is what actually ends the loop ─────────────────────────────────────
# NOT "the parameter exists". A parameter accepted and ignored passes MA.0a and every
# structural check ever written about it. Drive the real function with a stop that fires.
_clock = _Clock(cap=200)
_frames = _drive(_dead_mic(8), _clock, _stop_after(2), limit=1)
eq(_frames, [], "MA.1 a machine with no microphone yields nothing rather than blocking")
ok(_clock.n <= _clock.cap,
   f"MA.1a and `stop` ENDED it — a `stop` accepted and ignored satisfies MA.0a and every "
   f"structural check ever written about it, and this is the only thing that does not: "
   f"{_clock.n} sleeps against a cap of {_clock.cap}")

# ── MA.2  no `stop` means retry forever, said out loud ─────────────────────────────────
_clock2 = _Clock(cap=200)
_drive(_dead_mic(600), _clock2, None, limit=1)
ok(_clock2.n > _clock2.cap,
   f"MA.2 CONTROL: with NO `stop` it keeps retrying rather than quietly giving up — which "
   f"is why MA.0a matters. Were the default 'stop immediately', a caller that forgot would "
   f"get a daemon that goes deaf on the first failed open and says nothing: {_clock2.n} "
   f"sleeps")

_td = pathlib.Path(tempfile.mkdtemp(prefix="micaudio-"))
try:
    # ── MA.3  `_wav_chunks`: fixed-size frames, padded ─────────────────────────────────
    _clip = _td/"tone.wav"
    # 0.5 s of something that is NOT silence, so the padding checks have a value they can
    # tell apart from the padding they are checking for.
    TONE = bytes([0x11, 0x22])
    _body = TONE * 4000
    with wave.open(str(_clip), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(_body)

    _chunks = micaudio._wav_chunks(str(_clip))
    SILENT = bytes(micaudio.FRAME*2)
    _sizes = {len(c) for c in _chunks}
    eq(_sizes, {micaudio.FRAME*2},
       f"MA.3 every chunk is exactly one frame. The wake model reads fixed-size buffers; a "
       f"short final frame is a deaf tail nobody notices, because the clip still mostly "
       f"works: {sorted(_sizes)}")
    _padded = 16000*2 + len(_body) + 16000*2
    eq(len(_chunks), (_padded - micaudio.FRAME*2)//(micaudio.FRAME*2) + 1,
       "MA.3a and it yields as many as fit — derived from the padding, not typed")
    eq(_chunks[0], SILENT,
       "MA.3b the clip opens on a second of silence. Without it the wake model is asked to "
       "score a word that begins in the first sample of its window")
    # WHERE THE AUDIO STARTS, measured. Everything below that index is padding, and a check
    # that reads fewer frames than this cannot tell a played clip from silence — which is
    # the fault MA.5a had in its first version.
    _first_audio = next((i for i, c in enumerate(_chunks) if c != SILENT), None)
    ok(_first_audio is not None,
       "MA.3c CONTROL: the clip's own audio survived the padding — a chunker that replaced "
       "the recording with silence would pass MA.3 and MA.3b both")
    _past_pad = (_first_audio + 1) if _first_audio is not None else len(_chunks)

    # ── MA.4  `wav_frames` ends when the daemon goes idle ──────────────────────────────
    class _D:
        def __init__(self, state="idle"):
            self.state, self.board, self.reply_slot, self.following = state, None, None, False

    _saved_time = micaudio.time
    micaudio.time = _Clock(cap=200000)
    try:
        _out = list(micaudio.wav_frames([str(_clip)], _D()))
        ok(len(_out) > len(_chunks),
           f"MA.4 the clip plays and silence follows it — a `--wav` run needs the turn to "
           f"happen after the audio stops: {len(_out)} frames for a {len(_chunks)}-frame clip")
        eq(_out[:len(_chunks)], _chunks, "MA.4a the clip itself goes through unchanged")
        eq({len(f) for f in _out}, {micaudio.FRAME*2},
           "MA.4b and the silence is the same frame size as the audio")

        # ── MA.5  a reply is played INTO the question's window ─────────────────────────
        class _Asking(_D):
            def __init__(self):
                super().__init__("listening")
                self.reply_slot = "ask-1"

        _gen = micaudio.wav_frames([], _Asking(), replies=[str(_clip)])
        _heard = [next(_gen) for _ in range(_past_pad)]
        eq(_heard, _chunks[:_past_pad],
           "MA.5 with a question open and the mic listening, the next reply wav is played "
           "into the window — this is what makes a permission round trip testable end to "
           "end, and it had no test before 18.1")
        _gen.close()

        _gen2 = micaudio.wav_frames([], _D("listening"), replies=[str(_clip)])
        _silent = [next(_gen2) for _ in range(_past_pad)]
        eq(_silent, [SILENT]*_past_pad,
           f"MA.5a CONTROL: with NO question open the same wav is NOT played — a reply that "
           f"goes in regardless would pass MA.5 while answering a question nobody asked. "
           f"Read PAST the padding ({_past_pad} frames): the first version took three, the "
           f"clip opens on a second of silence, and three frames of a played clip are "
           f"byte-identical to three frames of nothing")
        _gen2.close()
    finally:
        micaudio.time = _saved_time
finally:
    import shutil
    shutil.rmtree(_td, ignore_errors=True)

# ── MA.6a  the one definition is still the right number ────────────────────────────────
ok(micaudio.FRAME == 1280 and abs(micaudio.FRAME_S - 0.08) < 1e-9,
   f"MA.6a CONTROL: a sweep that found no copies because the original moved too would pass "
   f"MA.6: {micaudio.FRAME}, {micaudio.FRAME_S}")

verdict()
_G = len(set(re.findall(r"\bMA\.[0-9]+", pathlib.Path(__file__).read_text())))
print(f"✓ micaudio: {_G} groups green (MA.1a control: a `stop` accepted and ignored passes "
      f"every structural check and only this one)")
