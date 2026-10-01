#!/usr/bin/env python3
"""What he heard (PLAN 11.1 "STT", 18.1 — out of `ashd.py`).

Two things, and only these two: which transcriber the daemon loads, and how one utterance is
turned into one line of text. Both were inline in `ashd.py` — the constructor in
`_load_models`, the call in `_handle` — so the ARGUMENTS were the part nothing named and
nothing could test: `initial_prompt="Hey Ash."` biases the decoder towards his name, `language="en"`
skips detection on a short clip, `beam_size=1` is the latency choice, and `vad_filter=True`
drops the silence the endpointing leaves at either end. A change to any of them changes what
he hears, and each was one keyword in the middle of a 300-line method.

**What stays in the daemon:** when to transcribe (the run loop and the endpointing VAD, where
the four-part stop and the capture clock live), the timing, and the `heard …` log line — which
`slo.py` parses and `test_redact` E.4 holds to its redacted form, so it is written where it
always was, byte for byte.

`faster_whisper` is imported inside `load`, as it was inside `_load_models`: importing this
module costs nothing, and `test_stt` runs both functions against a stand-in model.
`test_voice_fixtures` VF.4 runs them against the real one, on real speech.
"""


def load(name):
    """The transcriber: faster-whisper `name` on the CPU, int8, four threads."""
    from faster_whisper import WhisperModel
    return WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=4)


def transcribe(model, audio):
    """What was said in `audio` (16 kHz float32 samples), as one stripped line.

    `model.transcribe` returns a lazy generator; the decoding happens in the join, so a caller
    timing this call times the whole transcription, as `_handle` always has."""
    segs, _ = model.transcribe(audio, beam_size=1, language="en", vad_filter=True,
                               initial_prompt="Hey Ash.")
    return " ".join(s.text for s in segs).strip()
