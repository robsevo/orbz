#!/usr/bin/env python3
"""What he heard, and how. Run: orb/daemon/.venv/bin/python test_stt.py

PLAN 11.1 "STT" / 18.1. `stt.load` and `stt.transcribe` are the transcriber the daemon loads
and the one call that turns an utterance into a line. Their ARGUMENTS are the substance —
`initial_prompt="Hey Ash."`, `language="en"`, `beam_size=1`, `vad_filter=True`, and a CPU
int8 model — and before the move they were keywords in the middle of `_handle` and
`_load_models`, read by `test_voice_fixtures` VF.4 off `ashd.py`'s text.

This runs both functions against a stand-in model (VF.4 runs them against the real one, on
real speech), and holds the daemon to calling them from the two places it always did:

  ST.1  `transcribe` asks the model with exactly the daemon's arguments, and joins the
        segments into one stripped line — the decode happens inside the call
  ST.2  `load` builds the model the daemon always built, from the name it is given
  ST.3  the daemon: `_load_models` loads through `stt.load(self.a.stt)`, the spoken path of
        `_handle` transcribes through `stt.transcribe(self.stt, audio)`, and the `heard` log
        line that `slo.py` parses is still written right after it, redacted (E.4's form)

ST.0 is the control: a transcribe that forgot the prompt, or joined without stripping, is
caught by the same checks that pass the real one.
"""
# ASH_TIER: product
# No model is loaded: `faster_whisper` is a stand-in in sys.modules. Reads ashd.py with `ast`.
import ast
import sys
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import stt  # noqa: E402

FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def eq(got, want, label):
    if got != want:
        FAIL.append(f"{label}\n     got: {got!r}\n    want: {want!r}")


# What the daemon has always passed — the policy this module holds, spelled out once here so
# a change to it is a change someone has to make in two places on purpose.
WANT_CALL = {"beam_size": 1, "language": "en", "vad_filter": True, "initial_prompt": "Hey Ash."}
WANT_LOAD = {"device": "cpu", "compute_type": "int8", "cpu_threads": 4}


class Model:
    """A transcriber that records how it was asked, and yields its segments LAZILY — the way
    faster-whisper does, so a caller that forgot to consume them would get nothing."""

    def __init__(self, texts):
        self.texts, self.calls, self.decoded = texts, [], 0

    def transcribe(self, audio, **kw):
        self.calls.append((audio, kw))

        def gen():
            for t in self.texts:
                self.decoded += 1
                yield types.SimpleNamespace(text=t)
        return gen(), {"language": "en"}


def run(fn, texts, audio="AUDIO"):
    m = Model(texts)
    return fn(m, audio), m


ok(Path(stt.__file__).resolve().parent == HERE,
   f"ST.0 CONTROL: `stt` is this tree's module ({stt.__file__})")

# ── ST.1  the call ─────────────────────────────────────────────────────────────────────
text, m = run(stt.transcribe, [" Hey Ash,", " what time is it? "])
eq(text, "Hey Ash,  what time is it?",
   "ST.1 the segments are joined in order with a space and the line is stripped — the exact "
   "join the daemon used, double space and all, because the text is what the turn acts on")
eq(m.calls[0][1] if m.calls else None, WANT_CALL,
   "ST.1 the model is asked with the daemon's own arguments — his name as the prompt, English "
   "without detection, greedy decoding, and the VAD filter on")
eq(m.calls[0][0] if m.calls else None, "AUDIO", "ST.1 on the audio it was given")
eq(m.decoded, 2, "ST.1 and the decode happens INSIDE the call, so `_handle`'s timing covers it")
eq(run(stt.transcribe, [])[0], "", "ST.1 no segments is an empty line, not an error")
eq(run(stt.transcribe, ["   "])[0], "", "ST.1 and whitespace alone is empty too")


# ── ST.0  CONTROL: the checks above catch the two ways this goes wrong ────────────────
def _no_prompt(model, audio):
    segs, _ = model.transcribe(audio, beam_size=1, language="en", vad_filter=True)
    return " ".join(s.text for s in segs).strip()


def _no_strip(model, audio):
    segs, _ = model.transcribe(audio, **WANT_CALL)
    return " ".join(s.text for s in segs)


ok(run(_no_prompt, ["x"])[1].calls[0][1] != WANT_CALL
   and run(_no_strip, [" Hey Ash,", " what time is it? "])[0] != "Hey Ash,  what time is it?",
   "ST.0 CONTROL: a transcribe without the prompt, and one without the strip, are both told "
   "apart from the real one by the ST.1 checks")

# ── ST.2  the load ─────────────────────────────────────────────────────────────────────
_built = []
_fw = types.ModuleType("faster_whisper")
_fw.WhisperModel = lambda name, **kw: _built.append((name, kw)) or ("model", name)
_was = sys.modules.get("faster_whisper")
try:
    sys.modules["faster_whisper"] = _fw
    got = stt.load("base.en")
finally:
    if _was is None:
        sys.modules.pop("faster_whisper", None)
    else:
        sys.modules["faster_whisper"] = _was
eq(_built, [("base.en", WANT_LOAD)],
   "ST.2 the model is faster-whisper by the NAME it is given, on the CPU, int8, four threads — "
   "the GPU here drops off the bus under load, and the voice must not depend on it")
eq(got, ("model", "base.en"), "ST.2 and what was built is what is returned")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
import re  # noqa: E402
_G = len({m.group(1) for m in re.finditer(r"\b(ST\.[0-9]+)\b", Path(__file__).read_text())})
print(f"✓ stt: {_G} groups green (ST.0 control: a transcribe without the prompt, or without "
      f"the strip, is told apart)")
