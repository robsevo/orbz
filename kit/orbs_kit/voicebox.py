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

A real conversation (PLAN 4.7, from Tavus's turn-taking and Andrej Karpathy's plain English):

  turn(audio, name)      at your first pause: whether you finished, and your words so far, in one
                         ask; words ending on "and", "um", "the"... (or Whisper's "...") hold the
                         turn open however finished they sound, and the page waits longer
  overlap(audio, name, saying)   what you said while he spoke: "echo" (his own words, back through
                         the microphone), "backchannel" (an "mhm": he goes on), "interrupt" (he
                         stops and listens) or "nothing"
  plain(text)            what he says aloud in plain spoken English (ASD-STE100 at about 80%): the
                         spec's hard words swapped for its plain ones, a sentence over 25 words split
                         where it can be; the chat keeps what he wrote
  hear's "unsure"        Whisper's own doubt (a sentence of 6+ words whose words it heard at under
                         0.6 on average), or one of its phantoms ("thanks for watching", its own
                         prompt): "didn't catch that", and nothing reaches his brain

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
    """The phrases he will say `text` in, in order (Ash's own grouping and openers), in plain spoken
    English (PLAN 4.7)."""
    from speakable import phrases as split
    from speakable import speakable
    v = _voice(voice, speed)
    return [p for p in v._split_openers(v._group(split(v._drop_hey(plain(speakable(text)))))) if p.strip()]


# ── plain spoken English (PLAN 4.7): ASD-STE100 at about 80%, for the ear ───────────────────────────
# The spec's own examples first (utilize → use, commence → start, prior to → before, approximately →
# about, in order to → to, ensure → make sure, replenish → fill), then its kin. Longer phrases are
# tried before the words in them. A swap must be right every time, so a word with two jobs is left
# alone: a noun and a verb ("purchase"), a past tense that is not its participle ("demonstrated" is
# never "has showed"), an adjective that is not the verb ("well informed"), or a word whose plain twin
# needs other words to change ("the additional cost" is not "the more cost"; "it is therefore true").
PLAIN = [
    ("at this point in time", "now"), ("due to the fact that", "because"), ("in the event that", "if"),
    ("a large number of", "many"), ("with regard to", "about"), ("in order to", "to"), ("prior to", "before"),
    ("an additional", "another"), ("in addition to", "besides"), ("in addition", "also"),
    ("utilizes", "uses"), ("utilized", "used"), ("utilizing", "using"), ("utilize", "use"),
    ("utilises", "uses"), ("utilised", "used"), ("utilising", "using"), ("utilise", "use"),
    ("commences", "starts"), ("commenced", "started"), ("commencing", "starting"), ("commence", "start"),
    ("initiates", "starts"), ("initiated", "started"), ("initiating", "starting"), ("initiate", "start"),
    ("ensures", "makes sure"), ("ensured", "made sure"), ("ensuring", "making sure"), ("ensure", "make sure"),
    ("replenishes", "fills"), ("replenished", "filled"), ("replenishing", "filling"), ("replenish", "fill"),
    ("terminates", "ends"), ("terminated", "ended"), ("terminating", "ending"), ("terminate", "end"),
    ("facilitates", "helps"), ("facilitated", "helped"), ("facilitating", "helping"), ("facilitate", "help"),
    ("demonstrates", "shows"), ("demonstrating", "showing"), ("demonstrate", "show"),
    ("modifies", "changes"), ("modified", "changed"), ("modifying", "changing"), ("modify", "change"),
    ("obtains", "gets"), ("obtaining", "getting"), ("obtain", "get"),
    ("requires", "needs"), ("required", "needed"), ("requiring", "needing"), ("require", "need"),
    ("assists", "helps"), ("assisted", "helped"), ("assisting", "helping"), ("assist", "help"),
    ("informs", "tells"), ("informing", "telling"), ("inform", "tell"),
    ("approximately", "about"), ("subsequently", "then"), ("assistance", "help"),
    ("numerous", "many"), ("regarding", "about"), ("individuals", "people"),
]
_PLAIN = [(re.compile(rf"(?<![\w-]){re.escape(a)}(?![\w-])", re.I), b) for a, b in PLAIN]
# where a sentence over the limit may be split for the ear, best near its middle
_SPLITS = [(re.compile(p), w) for p, w in ((r";\s+", ""), (r"\s+[—–]\s+", ""), (r",\s+and\s+", "And "), (r",\s+but\s+", "But "), (r",\s+so\s+", "So "), (r",\s+because\s+", "That's because "))]
LONGEST_WORDS = 25


def _swap(m: re.Match, to: str) -> str:
    said = m.group(0)
    return to[0].upper() + to[1:] if said[0].isupper() else to


def _split_long(sentence: str) -> list[str]:
    """A sentence over LONGEST_WORDS words, cut at its split nearest the middle, again while it can be."""
    if len(sentence.split()) <= LONGEST_WORDS:
        return [sentence]
    mid = len(sentence) / 2
    cuts = [(abs(m.start() - mid), m, w) for r, w in _SPLITS for m in r.finditer(sentence)]
    if not cuts:
        return [sentence]
    _, m, w = min(cuts, key=lambda c: c[0])
    left, right = sentence[:m.start()].rstrip(" ,;") + ".", sentence[m.end():]
    right = (w + right) if w else right[:1].upper() + right[1:]
    return _split_long(left) + _split_long(right)


def plain(text: str) -> str:
    """`text` as he will say it: the spec's plain words, no sentence over LONGEST_WORDS where a split
    can be found, and "However," as "But"."""
    for r, to in _PLAIN:
        text = r.sub(lambda m, to=to: _swap(m, to), text)
    text = re.sub(r"(^|(?<=[.!?]\s))However,\s+", r"\1But ", text, flags=re.M)
    out = []
    for line in text.split("\n"):
        parts = re.split(r"(?<=[.!?])\s+", line)
        out.append(" ".join(s for p in parts for s in _split_long(p)))
    return "\n".join(out)


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


# Whisper's phantoms: what it writes over silence, noise or a sound it cannot place (measured 10-03:
# its own prompt came back for a Kokoro "uh-huh"), never what someone said
PHANTOMS = re.compile(r"^(thanks? (you )?for watching|please subscribe|subtitles? by|transcri(bed|ption) by|a conversation with \w+|you)\W*$", re.I)
# below this average word probability, a sentence of SURE_WORDS+ words was not heard (10-03, 6 Kokoro
# voices: clear sentences of 6+ words 0.82 and up, reversed speech, which Whisper turns into fluent
# nonsense of 8 to 15 words, 0.27 to 0.67). A short line scores anywhere ("And three and three." 0.6
# in the app, 10-03), so it is never doubted on its score
SURE = 0.6
SURE_WORDS = 6


def _doubt(words: list[tuple[str, float]]) -> tuple[str, bool]:
    """Whisper's words (each with its probability) as one line, and whether to doubt it: a phantom,
    or a sentence of SURE_WORDS+ words heard at under SURE on average."""
    text = "".join(w for w, _ in words).strip()
    if not text:
        return "", False
    if PHANTOMS.match(text):
        return "", True
    return text, len(words) >= SURE_WORDS and sum(p for _, p in words) / len(words) < SURE


def _listen(audio: np.ndarray, name: str) -> tuple[str, bool]:
    """What was said, and whether Whisper was unsure of it (a phantom, or a sentence it heard badly)."""
    model = _model()
    with _hearing:
        segs, _ = model.transcribe(audio, beam_size=1, language="en", vad_filter=True, word_timestamps=True, initial_prompt=f"A conversation with {name}.")
        words = [(w.word, w.probability) for s in segs for w in (s.words or [])]
    return _doubt(words)


def hear(audio_b64: str, name: str = "Ash") -> dict:
    """What was said: {"text": one line, "seconds": how long the clip was, "unsure": Whisper's doubt}.
    Unsure, the text is what it wrote, for the record; the page says "didn't catch that" instead."""
    a = _samples(audio_b64)
    text, unsure = _listen(a, name) if len(a) else ("", False)
    return {"text": text, "seconds": round(len(a) / 16000, 3), "unsure": unsure}


# a turn that ends on one of these is a thought still going ("a table for..."), however finished it
# sounds: Smart Turn scores Kokoro's half sentences as finished (10-02), and a real voice trails too.
# Only words that rarely end a statement: "so", "to", "on", "about" do ("I think so", "I'd love to")
WEAK_ENDS = {"and", "but", "or", "because", "cause", "um", "uh", "er", "erm", "uhm", "the", "a", "an", "my", "your", "our", "their", "for", "of", "with", "from", "into", "if"}
# ...of which these can end a question ("what is it for?"); the rest never end one, whatever
# Whisper's punctuation says ("Can you send it to Sam and?" is a "can you" still going, 10-03)
QUESTION_ENDS = {"for", "of", "with", "from", "into", "if"}


def _trails(text: str) -> bool:
    """Whether the words so far stop mid-thought: Whisper's "..." or a weak last word (a question may
    end on a preposition, never on "and", "um" or "the")."""
    t = text.strip()
    if not t:
        return False
    if t.endswith(("...", "…", "-", "—")):
        return True
    last = re.findall(r"[a-z0-9']+", t.lower())  # a number is a word: "what is 2 and 2?" ends on "2"
    if not last or last[-1] not in WEAK_ENDS:
        return False
    return not (t.endswith("?") and last[-1] in QUESTION_ENDS)


def turn(audio_b64: str, name: str = "Ash") -> dict:
    """At your first pause, in one ask: whether you finished and what you said so far.
    {"finished", "p" (Smart Turn), "hold" (the words trail: wait longer), "words", "unsure"}.
    Finished needs Smart Turn's 0.97 AND words that do not trail AND words at all."""
    a = _samples(audio_b64)
    t = _smart_turn()
    with _hearing:
        p = t.score(a)
    words, unsure = _listen(a, name) if len(a) else ("", False)
    hold = _trails(words)
    return {"finished": p >= t.threshold and not hold and bool(words), "p": round(p, 4), "hold": hold, "words": words, "unsure": unsure}


# what he hears while he speaks (PLAN 4.7, Tavus's Sparrow-2: an "mhm" is not a bid for the floor)
BACKCHANNEL = {"mhm", "mm", "hmm", "hm", "mmhmm", "uh", "huh", "uhhuh", "yeah", "yep", "yes", "right", "okay", "ok", "sure", "got", "it", "i", "see", "ah", "oh", "nice", "cool", "great", "true", "exactly"}
STOPS = {"stop", "wait", "hold", "hang", "no", "sorry", "pause", "actually"}
BURST_S = 0.6  # too short to hold a sentence: an "mhm", whatever Whisper wrote ("Have a day." for a 0.34 s "mhm" in the app, 10-03)
SHORT_S = 0.9  # a burst this short with no real words in it is an "mhm", however Whisper spelled it


def _voiced_s(a: np.ndarray) -> float:
    """Seconds of it someone was speaking: 20 ms frames above the page's own voiced level."""
    n = len(a) // 320
    if not n:
        return 0.0
    frames = a[: n * 320].reshape(n, 320)
    return float((np.sqrt((frames * frames).mean(axis=1)) > 0.012).sum() * 0.02)


def overlap(audio_b64: str, name: str, saying: str) -> dict:
    """What you said while he was speaking `saying`: {"kind", "words", "voiced"}, kind one of
    "echo" (his own words, back through the microphone: 3+ words, most of them in what he says),
    "interrupt" (a stop word; past a burst, his name, 3+ words that are not an "mhm", or any long
    stretch of speech), "backchannel" (a burst too short for a sentence, or a short "mhm", "yeah",
    "right", however Whisper spelled it: he goes on), "nothing" (no voice to speak of)."""
    a = _samples(audio_b64)
    voiced = _voiced_s(a)
    words, _ = _listen(a, name) if len(a) else ("", False)
    return {"kind": _classify(words, voiced, name, saying), "words": words, "voiced": round(voiced, 2)}


def _classify(words: str, voiced: float, name: str, saying: str) -> str:
    """overlap's rule, by code, on what Whisper wrote and how long the voice lasted."""
    heard = re.findall(r"[a-z0-9']+", words.lower().replace("-", ""))
    mine = set(re.findall(r"[a-z0-9']+", saying.lower()))
    content = [w for w in heard if w not in BACKCHANNEL]
    short = voiced <= SHORT_S
    if voiced < 0.15:
        kind = "nothing"
    elif len(heard) >= 3 and sum(w in mine for w in heard) / len(heard) >= 0.6:
        kind = "echo"  # first: his own "hold on, I'm checking", coming back, must not stop him
    elif set(heard) & STOPS:
        kind = "interrupt"  # "wait", "hold on": short or long, he stops
    elif voiced <= BURST_S:
        kind = "backchannel"  # even his name: Whisper, primed with it, writes it for a sound it cannot place
    elif name.strip().lower() in heard:
        kind = "interrupt"
    elif short and len(content) < 3:
        # a short burst: Whisper writes words for an "mhm" ("Hi. Hi.", "Hello. Boy.", 10-03), so its
        # spelling is not evidence; a question that goes on is asked again, longer, and stops him then
        kind = "backchannel"
    else:
        kind = "interrupt"
    return kind


def woken(audio_b64: str, name: str) -> dict:
    """Whether the last ~2.5 s are someone calling him: "hey <name>", "hi <name>", "<name>," at the
    start. Whisper hears it; the name, not the model, decides: {"woken": bool, "heard": text}."""
    a = _samples(audio_b64)[-int(2.5 * 16000):]
    heard = _transcribe(a, name) if len(a) else ""
    n = re.escape(name.strip().lower())
    said = re.sub(r"[^a-z' ]+", " ", heard.lower())
    return {"woken": bool(re.search(rf"\b(hey|hi|hello|okay|ok|yo)\s+{n}\b|^\s*{n}\b", said)), "heard": heard}


def _smart_turn():
    """Ash's TurnEnd (Smart Turn v3.2), loaded once."""
    global _turn
    import turnend
    with _lock:
        if _turn is None:
            t = turnend.TurnEnd()
            t._load()  # here, not on a thread: the call waits for its answer
            if not t.ready:
                raise VoiceError("Smart Turn is not here (fetch the kit's models)")
            _turn = t
        return _turn


def finished(audio_b64: str) -> dict:
    """Whether the turn so far sounds finished: {"finished": bool, "p": Smart Turn's score}."""
    t = _smart_turn()
    with _hearing:
        p = t.score(_samples(audio_b64))
    return {"finished": p >= t.threshold, "p": round(p, 4)}
