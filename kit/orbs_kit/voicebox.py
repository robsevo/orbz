"""Speaking and listening for the app (PLAN 4.3): Ash's own voice stack, carried, behind what a page
needs from the home. You talk to an orb through the app, on any device: the browser records and
plays; the voice and the ears are the home's.

  phrases(text, voice)   what he will say, in the phrases Ash speaks it in (speakable's shaping:
                         no markdown, paths or machinery read aloud; openers and pauses as Ash's)
  say(phrase, voice)     one phrase in his voice, as WAV (24 kHz, mono, 16-bit): a page plays the
                         first while the next is made, so he starts speaking at once
  hear(audio, name)      what you said, in any audio a browser records (webm/opus, ogg, wav):
                         Whisper base.en on the CPU, biased to his name ("A conversation with Hazel."),
                         as Ash's are to his
  woken(audio, name)     whether the last moments the page heard were "hey <name>" (or "<name>,")
  finished(audio)        whether you sound finished or only paused: Smart Turn v3.2, Ash's
                         threshold (0.97, set from the false-finish rate on real speech)

Voices: an orb's voice is one of Kokoro's (its id, af_heart) or Classic ("ash"): Ash's own blend
and delivery, carried in classic_voice.json (his ~/ash/voice/voice.json as the owner chose it on
2026-09-27). English voices read any text (misaki); a voice of another language speaks its preview
only until its language is read live (espeak-ng), and says so.
"""
from __future__ import annotations

import base64
import io
import json
import re
import sys
import threading
import wave
from pathlib import Path

import numpy as np

KIT = Path(__file__).resolve().parent.parent
ASH = KIT / "ash"
if str(ASH) not in sys.path:
    sys.path.insert(0, str(ASH))
MODELS = ASH / "models"
WHISPER = MODELS / "whisper-base.en"
CLASSIC = Path(__file__).resolve().parent / "classic_voice.json"

_lock = threading.Lock()
_speaking = threading.Lock()  # one synthesis at a time: Kokoro's session is not shared across threads
_hearing = threading.Lock()   # and one transcription at a time
_voices: dict[tuple[str, float], object] = {}
_ear = None
_turn = None


class VoiceError(ValueError):
    """A voice or a clip this kit cannot use, said plainly."""


def _voice(vid: str, speed: float):
    """Ash's Voice for an orb's voice id, at his personality's speed. Made once per (voice, speed)."""
    import voice as V
    key = (vid, round(float(speed), 2))
    with _lock:
        got = _voices.get(key)
        if got is not None:
            return got
        if vid != "ash" and not re.fullmatch(r"[ab][fm]_[a-z]+", vid):
            raise VoiceError(f"{vid} speaks only its preview here: its language is not read live yet")
        kw = V.settings(json.loads(CLASSIC.read_text()))
        if vid != "ash":
            # an English voice, with Classic's delivery (his energy and movement) but its own sound,
            # exactly as its preview was made (tools/voice_samples.py)
            kw.update(voice=vid, lang=None, g2p="misaki", short={})
        kw["speed"] = float(kw.get("speed", 1.0)) * float(speed)
        v = V.Voice(**kw, model=MODELS / "kokoro-v1.0.onnx", voices=MODELS / "voices-v1.0.bin")
        _voices[key] = v
        return v


def phrases(text: str, voice: str = "ash", speed: float = 1.0) -> list[str]:
    """The phrases he will say `text` in, in order (Ash's own grouping and openers)."""
    from speakable import phrases as split
    from speakable import speakable
    v = _voice(voice, speed)
    return [p for p in v._split_openers(v._group(split(v._drop_hey(speakable(text))))) if p.strip()]


def _wav(audio: np.ndarray, sr: int) -> bytes:
    pcm = (np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def say(phrase: str, voice: str = "ash", speed: float = 1.0) -> dict:
    """One phrase in his voice: {"wav": base64 WAV, "seconds": its length}."""
    if not phrase.strip():
        raise VoiceError("there is nothing to say")
    v = _voice(voice, speed)
    with _speaking:
        audio, sr = v.say(phrase, phrases=[phrase])
    return {"wav": base64.b64encode(_wav(audio, sr)).decode(), "seconds": round(len(audio) / sr, 3)}


def _decode(raw: bytes) -> np.ndarray:
    """Any audio a browser records (webm/opus, ogg, wav) as 16 kHz mono float32, through PyAV's
    ffmpeg: faster-whisper's own decode_audio passes PyAV an option PyAV 19 no longer takes."""
    import av
    pcm: list[np.ndarray] = []
    with av.open(io.BytesIO(raw), mode="r") as container:
        stream = next(s for s in container.streams if s.type == "audio")
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        for frame in container.decode(stream):
            pcm += [f.to_ndarray().reshape(-1) for f in resampler.resample(frame)]
        pcm += [f.to_ndarray().reshape(-1) for f in resampler.resample(None)]  # what it still holds
    return (np.concatenate(pcm) if pcm else np.zeros(0, dtype=np.int16)).astype(np.float32) / 32768.0


def _samples(audio_b64: str) -> np.ndarray:
    """A browser's recording as 16 kHz float32 samples."""
    raw = base64.b64decode(audio_b64)
    if not raw:
        raise VoiceError("the recording is empty")
    try:
        return _decode(raw)
    except Exception as e:  # a codec it cannot read, a cut-off file, no audio in it at all
        raise VoiceError(f"the recording could not be read ({type(e).__name__})") from e


def _model():
    global _ear
    with _lock:
        if _ear is None:
            if not (WHISPER / "model.bin").exists():
                raise VoiceError("the ears are not here yet: fetch the kit's models (python -m orbs_kit.models)")
            import stt
            _ear = stt.load(str(WHISPER))
        return _ear


def _transcribe(audio: np.ndarray, name: str) -> str:
    model = _model()
    with _hearing:
        # the name as context, never as words already said: a prompt that ended "Hey Hazel." made Whisper
        # drop the "Hazel" a call began with (4 voices in 6, measured 10-02)
        segs, _ = model.transcribe(audio, beam_size=1, language="en", vad_filter=True, initial_prompt=f"A conversation with {name}.")
        return " ".join(s.text for s in segs).strip()  # the decoding happens here, in the join


def hear(audio_b64: str, name: str = "Ash") -> dict:
    """What was said: {"text": one line, "seconds": how long the clip was}."""
    a = _samples(audio_b64)
    return {"text": _transcribe(a, name) if len(a) else "", "seconds": round(len(a) / 16000, 3)}


def woken(audio_b64: str, name: str) -> dict:
    """Whether the last ~2.5 s are someone calling him: "hey <name>", "hi <name>", "<name>," at the
    start. Whisper hears it; the name, not the model, decides: {"woken": bool, "heard": text}."""
    a = _samples(audio_b64)[-int(2.5 * 16000):]
    heard = _transcribe(a, name) if len(a) else ""
    n = re.escape(name.strip().lower())
    said = re.sub(r"[^a-z' ]+", " ", heard.lower())
    return {"woken": bool(re.search(rf"\b(hey|hi|hello|okay|ok|yo)\s+{n}\b|^\s*{n}\b", said)), "heard": heard}


def finished(audio_b64: str) -> dict:
    """Whether the turn so far sounds finished: {"finished": bool, "p": Smart Turn's score}."""
    global _turn
    import turnend
    with _lock:
        if _turn is None:
            t = turnend.TurnEnd()
            t._load()  # here, not on a thread: the call waits for its answer
            if not t.ready:
                raise VoiceError("Smart Turn is not here (fetch the kit's models)")
            _turn = t
    with _hearing:
        p = _turn.score(_samples(audio_b64))
    return {"finished": p >= _turn.threshold, "p": round(p, 4)}
