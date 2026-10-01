"""turnend — he answers when you have FINISHED, not after a fixed wait (PLAN 11.10).

Owner, 2026-09-30: "Is there any way we can improve our voice from what it is rn?", then "yea"
to answering sooner. The listen loop ends a turn after `endpoint` seconds of silence (1.4 s in
ashd-prefs). That is long on purpose: a breath or an "um" runs well past 0.8 s, and a shorter
wait cut people off. But it means every reply starts at least 1.4 s after the last word, and a
person answers in about a quarter of that.

Smart Turn v3.2 (pipecat-ai/smart-turn-v3, BSD-2, the 8 MB int8 CPU build) listens to the turn
so far and says whether it SOUNDS finished: the words, the falling pitch, no trailing "and…".
When a pause reaches EARLY_S the loop asks once. A score at or above THRESHOLD ends the turn
there. Anything else leaves the endpoint in charge: a low score, no model file, a model still
loading, an error, or the `smart_endpoint` pref set to false. So the worst this module can do is
nothing. The one thing it must never do is end a turn you were still in the middle of, which is
why THRESHOLD is set from the false-finish rate measured on real speech, not from accuracy.

Input, as the model's own inference.py builds it: 16 kHz mono, the LAST 8 s of the turn, zeros
padded at the FRONT so the speech sits at the end, normalised to zero mean and unit variance,
then Whisper's 80-bin log-mel (400-point FFT, hop 160, 800 frames). faster-whisper's extractor
is Whisper's, already in the venv for speech-to-text; `test_turnend` checks it against a
from-first-principles copy, so a change in faster-whisper can't drift the input unnoticed.
"""
import threading
import time
from pathlib import Path

import numpy as np

from common import log

HERE = Path(__file__).resolve().parent
MODEL = HERE / "models" / "smart-turn-v3.2-cpu.onnx"
SR = 16000
WINDOW_S = 8
# When to ask, and how sure it must be. Measured 2026-09-30 on the 538 real (not synthetic)
# English clips in one shard of pipecat-ai/smart-turn-data-v3.2-test (261 unfinished, 277
# finished), each with the pause's room tone appended as the loop would hear it:
#   asked after 0.24 s, th 0.95: cuts off 3.1% of unfinished, answers early on 80% of finished
#   asked after 0.40 s, th 0.97: cuts off 1.5% of unfinished, answers early on 72% of finished
# A cut-off here loses the rest of what you were saying (the mic closes when the turn starts),
# so the safer pair wins. Pipecat asks after 0.2 s; a pause that reaches 0.4 s mid-sentence is
# also rarer than one that reaches 0.24 s, which the balanced test set cannot show.
EARLY_S = 0.40
THRESHOLD = 0.97


class TurnEnd:
    """One per daemon. `finished` is called on every silent frame of a listening window."""

    def __init__(self, model=None, threshold=THRESHOLD, early_s=EARLY_S):
        self.model = Path(MODEL if model is None else model)  # at call time (WG.4)
        self.threshold, self.early_s = float(threshold), float(early_s)
        self._sess = self._fx = self._hann = None
        self._state = "cold"            # cold → loading → ready | off
        self._lock = threading.Lock()
        self._asked = False             # this pause has had its one question
        self.last = None                # (score, seconds it took) of the last question, for the log

    # ── loading ──────────────────────────────────────────────────────────────────────────
    def warm(self):
        """Load the model on a thread of its own, once. Until it is ready, nothing changes."""
        with self._lock:
            if self._state != "cold":
                return
            self._state = "loading"
        threading.Thread(target=self._load, daemon=True, name="turnend-load").start()

    def _load(self):
        try:
            if not self.model.exists():
                raise FileNotFoundError(f"{self.model} is missing (fetch it with the install notes in PLAN 11.10)")
            import onnxruntime as ort
            from faster_whisper.feature_extractor import FeatureExtractor
            so = ort.SessionOptions()
            so.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            so.inter_op_num_threads = 1
            # Two threads: it runs while you are pausing, next to the wake model and the VAD,
            # and whisper starts the moment it says yes.
            so.intra_op_num_threads = 2
            # No spinning after a run: it idles at once, measured 97 ms of CPU a question
            # against 131 ms spinning.
            so.add_session_config_entry("session.intra_op.allow_spinning", "0")
            so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            self._sess = ort.InferenceSession(str(self.model), sess_options=so,
                                              providers=["CPUExecutionProvider"])
            self._fx = FeatureExtractor(feature_size=80, sampling_rate=SR, chunk_length=WINDOW_S)
            self._hann = np.hanning(self._fx.n_fft + 1)[:-1].astype(np.float32)
            self.score(np.zeros(SR, dtype=np.float32))          # the first run is the slow one
            self._state = "ready"
            log("turn end: Smart Turn ready")
        except Exception as e:
            self._state = "off"
            log(f"turn end: off, the {self.early_s:.2f} s early answer is unavailable "
                f"({type(e).__name__}: {e}); every turn waits for the endpoint")

    @property
    def ready(self):
        return self._state == "ready"

    # ── the model ────────────────────────────────────────────────────────────────────────
    @staticmethod
    def window(audio):
        """The last WINDOW_S seconds, zero-padded at the FRONT, as the model was trained."""
        a = np.asarray(audio, dtype=np.float32).reshape(-1)
        n = WINDOW_S * SR
        if len(a) >= n:
            return a[-n:]
        return np.concatenate([np.zeros(n - len(a), dtype=np.float32), a])

    def features(self, audio):
        """Whisper's log-mel, (80, 800), exactly as faster-whisper's extractor computes it,
        except the mel projection is `einsum` rather than `@`. `@` goes to OpenBLAS, which
        spread this small product over every core and left them spinning: 940 ms of CPU for a
        92 ms question, against 97 ms for 52 ms this way (measured 2026-09-30)."""
        fx = self._fx
        a = self.window(audio)
        a = (a - a.mean()) / np.sqrt(a.var() + 1e-7)        # Whisper's do_normalize
        st = fx.stft(a, fx.n_fft, fx.hop_length, window=self._hann, return_complex=True)
        power = np.abs(st.astype(np.complex64)[..., :-1]) ** 2
        mel = np.einsum("mf,ft->mt", fx.mel_filters, power, optimize=False)
        log_spec = np.log10(np.clip(mel, 1e-10, None))
        log_spec = np.maximum(log_spec, log_spec.max() - 8.0)
        return ((log_spec + 4.0) / 4.0).astype(np.float32)

    def score(self, audio):
        """P(the turn is finished) for float audio at 16 kHz."""
        t = time.perf_counter()
        f = self.features(audio)[None]
        out = self._sess.run(None, {"input_features": f})
        p = float(np.asarray(out[0]).reshape(-1)[0])
        self.last = (p, time.perf_counter() - t)
        return p

    # ── the loop's question ──────────────────────────────────────────────────────────────
    def finished(self, rec, silence, enabled=True):
        """True when this pause has lasted EARLY_S and the turn so far sounds finished.

        `rec` is the listening window's frames (int16 bytes), `silence` the seconds since
        the last voiced frame. The model is asked ONCE per pause, on the frame where the
        pause first reaches EARLY_S; a new word resets that. A pause it called unfinished
        is left to the endpoint rather than asked again: more silence is not new evidence
        about what you said, and asking again is a second chance to cut you off.
        """
        if silence < self.early_s - 1e-6:          # 1e-6: silence is a sum of 80 ms frames
            self._asked = False
            return False
        if self._asked or not enabled:
            return False
        if self._state == "cold":
            self.warm()
        if not self.ready:
            return False
        self._asked = True
        try:
            audio = np.frombuffer(b"".join(rec), dtype=np.int16).astype(np.float32) / 32768
            p = self.score(audio)
        except Exception as e:
            log(f"turn end: scoring failed ({type(e).__name__}: {e}); waiting for the endpoint")
            return False
        done = p >= self.threshold
        log(f"turn end: {p:.2f} after {silence:.2f} s of quiet ({self.last[1]*1000:.0f} ms) — "
            + ("finished, answering now" if done else "not finished, waiting for the endpoint"))
        return done
