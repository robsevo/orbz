#!/usr/bin/env python3
"""
wake - listen for "hey ash" and tell the orb.

Same contract as pair.py: the listener writes a small state file into
~/ash/voice and the orb watches it, so either side can start, crash or
restart without wedging the other.

Audio comes from `pw-record` (16 kHz mono s16 on stdout), so there is no
sounddevice/pyaudio dependency. openWakeWord wants 80 ms frames (1280 samples).
CPU only; one frame costs well under a millisecond with a 32-unit DNN.

  wake.py                        listen, write wake-state.json on each detection
  wake.py --scores               also print the live score (tuning the threshold)
  wake.py --threshold 0.6        stricter (fewer false wakes, more misses)
  wake.py --model path.onnx      a different model (default: the trained hey_ash)
  wake.py --no-vad               skip the silero VAD gate
  wake.py --wav clip.wav ...     feed 16 kHz wav files instead of the mic (testing)
"""
import argparse, json, os, subprocess, sys, time
import threading
from pathlib import Path
import numpy as np
from openwakeword.model import Model

HERE  = Path(__file__).parent
import statepaths  # noqa: E402 — PLAN 5.9: one root, and ASH_STATE_HOME moves it
STATE = statepaths.config()/"wake-state.json"
sys.path.insert(0, str(HERE))
# The 80 ms frame size, from the one place that defines it (18.1). It was typed here
# and in `ashd.py` and in `test_mic_fallback.py` — three copies that agreed, so nothing
# was wrong, so nothing ever said anything.
from micaudio import FRAME  # noqa: E402


# ONE OWNER FOR wake-state.json (PLAN 6.13), and it is ashd, not this.
#
# This wrote the SAME file the daemon does, with a DIFFERENT schema: ashd writes
# {"state": ..., "t": ...} and the orb's pumpWake reads `state` off it to drive the body's
# colour and envelope; this wrote {"t", "score", "model"} — no `state` at all. Run this tool
# while the orb is up and the orb reads a shape it does not understand.
#
# It is also a shared ".json.tmp", which is the race ashd's own write_state was fixed for on
# 2026-09-15 and this copy never was.
#
# wake.py is a diagnostic — `--wav` clip scoring, threshold tuning. It has no business
# writing the daemon's state, so it writes its own file. `--share-state` is there for the
# rare case of driving a live orb from a clip, and says what it is doing.
PROBE = statepaths.config()/"wake-probe.json"


# What the orb actually reads off wake-state.json. `index.html:995` does
# `const s = w.state || 'wake'` and `clawd.html:63` does `voice = w.state || voice`, so a
# payload with no `state` is not rejected — the orb quietly substitutes a default, and
# clawd keeps whatever voice it had. `--share-state` has been relying on that: it wrote
# {"t","score","model"} and worked by the accident of one `||`. Write the field.
SHARED_SCHEMA = ("state", "t")


def write_state(st: dict, share=False):
    target = STATE if share else PROBE
    if share:
        # Driving the live orb means speaking its language, not the probe's. The probe's own
        # fields ride along — they are extra, and the orb ignores what it does not read.
        st = {"state": st.get("state", "wake"), **st}
    # pid AND thread, exactly as ashd.write_state does it. pid alone is only half the fix:
    # two threads in ONE process share the name, so one renames the tmp the other is still
    # writing and a reader parses a half-written file. Measured here, not assumed — 8 writers
    # and 2 readers tore the file every run until the thread id went in (test_wake.py WK.3).
    tmp = target.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        # 2.2: stamp who wrote it, so write_guard can tell the live daemon from a suite.
        # Resolved HERE, not at module scope: test_verify H.2 lifts this function out and
        # runs it alone, where a module-level name does not exist, and a write that raised
        # NameError there was a write that did not happen. Fail-safe: no stamp, never no write.
        try:
            from writer_stamp import stamped as _stamp_it
        except Exception:
            _stamp_it = lambda d: d
        tmp.write_text(json.dumps(_stamp_it(st)))
        os.replace(tmp, target)                # atomic: the orb never reads half a file
    except OSError:
        try: tmp.unlink(missing_ok=True)
        except OSError: pass


def wav_frames(paths):
    """Each file padded with 1 s of silence either side, so the model's 16-frame
    window sees the phrase whole and its state resets between clips."""
    import wave
    pad = bytes(16000*2)
    for p in paths:
        with wave.open(p) as w:
            assert w.getframerate() == 16000 and w.getnchannels() == 1 and w.getsampwidth() == 2, p
            data = pad + w.readframes(w.getnframes()) + pad
        for i in range(0, len(data) - FRAME*2 + 1, FRAME*2):
            yield data[i:i+FRAME*2]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(HERE/"wakeword"/"model_out"/"hey_ash.onnx"))
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--cooldown", type=float, default=2.0, help="seconds to ignore after a wake")
    ap.add_argument("--target", default=None, help="PipeWire source (default: system default)")
    ap.add_argument("--scores", action="store_true")
    ap.add_argument("--share-state", action="store_true",
                    help="also write the daemon's wake-state.json (drives a live orb from a clip)")
    ap.add_argument("--no-vad", action="store_true")
    ap.add_argument("--wav", nargs="+", help="16 kHz mono wavs to feed instead of the mic")
    a = ap.parse_args()

    model = Model(wakeword_models=[a.model], inference_framework="onnx",
                  vad_threshold=0 if a.no_vad else 0.5)
    name = next(iter(model.models))

    if a.wav:
        mic = None
        stream = wav_frames(a.wav)
    else:
        cmd = ["pw-record", "--raw", "--rate", "16000", "--channels", "1", "--format", "s16"]
        if a.target: cmd += ["--target", a.target]
        mic = subprocess.Popen(cmd + ["-"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stream = iter(lambda: mic.stdout.read(FRAME*2), b"")

    print(f"wake: listening for {name} (threshold {a.threshold}"
          f"{', vad' if not a.no_vad else ''})", flush=True)
    last, clock = -1e9, 0.0        # cooldown runs on AUDIO time, so --wav (faster than real time) measures true
    try:
        for buf in stream:
            if len(buf) < FRAME*2:
                break
            score = float(model.predict(np.frombuffer(buf, dtype=np.int16))[name])
            if a.scores and score > 0.05:
                print(f"  {score:.3f}", flush=True)
            clock += FRAME/16000
            if score >= a.threshold and clock - last >= a.cooldown:
                last = clock
                write_state({"t": time.time(), "score": round(score, 3), "model": name},
                            share=a.share_state)
                print(f"wake: {name} {score:.3f} at {time.strftime('%T')}", flush=True)
        if mic is None:
            return 0
        err = mic.stderr.read().decode(errors="replace").strip()
        print(f"wake: microphone stream ended{': ' + err if err else ''}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        if mic: mic.terminate()


if __name__ == "__main__":
    sys.exit(main())
