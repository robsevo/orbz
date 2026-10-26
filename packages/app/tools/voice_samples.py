"""Every voice's sample for the creator (owner, 2026-10-02: "when user presses on a voice when
creating their orb, we preview it"). Each voice says one short line in its own language, rendered
on the kit's Kokoro and kept in packages/app/public/voices/<id>.mp3 only once Whisper, listening
back, hears that line in it. What each was heard to say is written to voice_samples.json beside
this file, so a clip's check can be read later.

The English voices are phonemised by misaki (as the kit speaks); the others by espeak-ng, which
gave the phonemes Kokoro's other languages were trained on. Classic is Ash's own blend and
delivery, read from his voice.json (never written). Every clip is rendered at speed 1: the app
plays it at the personality's pace.

Run it on the kit's Python, with the model files (350 MB, never copied):
  cd kit && uv run --project . --locked python ../packages/app/tools/voice_samples.py \
      --models ../../orbs/kit/ash/models [--only af_heart,ff_siwis]
Mandarin needs Kokoro's own phonemes: add `--with "misaki[zh]==0.9.4"` to `uv run` (a one-off
overlay; the kit's lock is untouched). espeak-ng's Mandarin was heard as gibberish (0.35), and
misaki's Japanese reader wants a 500 MB dictionary, so the Japanese line's phonemes are written out
(PHONEMES), and Whisper heard all five Japanese voices say it. English is one plain sentence: Ash's
voice drops a greeting opener ("Hi there!") by design.
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "4")  # four cores, not every one: the machine stays usable
APP = Path(__file__).resolve().parent.parent
ROOT = APP.parent.parent
sys.path.insert(0, str(ROOT / "kit" / "ash"))

import numpy as np  # noqa: E402

# One line a voice says, by its language (the voice id's first letter, as spec.ts reads it), and
# how Whisper and espeak-ng name that language. English is phonemised by misaki, so has no espeak.
# SAY is what the phonemiser is given when it is not the line itself: espeak reads Japanese kana
# only (kanji come out as "Japanese letter"), and reads the particle は as "ha", not "wa".
SAY = {"j": "こんにちわ！ これが わたしの こえです。"}
# Phonemes written out by hand, in the set Kokoro's Japanese voices were trained on (misaki's), where
# neither espeak nor an installed reader gets the line right; Whisper still has to hear it.
PHONEMES = {"j": "koɲɲiʨiβa! koɾeɡa βataɕino koe desɨ."}
LINES: dict[str, tuple[str, str, str | None]] = {
    # one plain sentence: Ash's voice drops a greeting opener ("Hi there!") by design (voice._drop_hey)
    "a": ("This is how I sound when I talk to you.", "en", None),
    "b": ("This is how I sound when I talk to you.", "en", None),
    "e": ("¡Hola! Así suena mi voz.", "es", "es"),
    "f": ("Bonjour ! Voici ma voix.", "fr", "fr-fr"),
    "h": ("नमस्ते! यह मेरी आवाज़ है।", "hi", "hi"),
    "i": ("Ciao! Questa è la mia voce.", "it", "it"),
    "j": ("こんにちは！これが私の声です。", "ja", "ja"),
    "p": ("Olá! Esta é a minha voz.", "pt", "pt-br"),
    "z": ("你好！这是我的声音。", "zh", "cmn"),
}
# More takes, so a voice says something else on each press (owner, 10-04: "make the voices say something
# else each time when pressing them to preview"): take 1 is LINES' (<id>.mp3), these are takes 2 on
# (<id>-2.mp3, ...). Japanese and Mandarin keep their one line: Japanese's phonemes are written by hand,
# and Mandarin needs misaki's overlay. Short and plain, no greeting opener (Classic drops it).
MORE: dict[str, list[str]] = {
    "a": ["Leave it with me. I'll have it done by lunch.", "Your day is sorted, and I'll remind you before anything is due.",
          "I finished the report. Do you want to take a look?", "That bill is paid, and your calendar is up to date.",
          "Good idea. Let's make it happen."],
    "e": ["Déjalo conmigo. Lo tengo listo hoy.", "Tu día ya está organizado."],
    "f": ["Laisse-moi faire. Ce sera prêt ce soir.", "Ta journée est organisée."],
    "h": ["मुझ पर छोड़ दो। आज ही हो जाएगा।", "आपका दिन तैयार है।"],
    "i": ["Lascia fare a me. Sarà pronto stasera.", "La tua giornata è organizzata."],
    "p": ["Deixa comigo. Fica pronto hoje.", "O seu dia está organizado."],
}
MORE["b"] = MORE["a"]
KOKORO_LANG = {"e": "es", "f": "fr-fr", "h": "hi", "i": "it", "j": "ja", "p": "pt-br", "z": "cmn"}
# How alike the line and what Whisper heard must be (letters only, for the scripts without spaces
# characters): a clip under it is not kept.
HEARD = 0.6


def voice_ids() -> list[str]:
    """Every voice the creator offers, from spec.ts itself (never a list typed twice)."""
    spec = (APP / "src" / "orb" / "spec.ts").read_text(encoding="utf-8")
    kokoro = re.search(r"const KOKORO = \[(.*?)\] as const", spec, re.S)
    if not kokoro:
        sys.exit("spec.ts has no KOKORO list: has it moved?")
    return ["ash", *re.findall(r'"([a-z]{2}_[a-z]+)"', kokoro.group(1))]


def plain(s: str) -> str:
    """Letters and digits only, lower case, accents kept apart: what two transcripts are compared on."""
    s = unicodedata.normalize("NFKC", s).lower()
    return "".join(ch for ch in s if ch.isalnum() or ch == " ").strip()


def alike(line: str, heard: str) -> float:
    a, b = plain(line), plain(heard)
    if " " not in a:  # Japanese, Mandarin: by character
        a, b = a.replace(" ", ""), b.replace(" ", "")
    return difflib.SequenceMatcher(None, a, b).ratio()


def phonemes(code: str, text: str, espeak: str) -> str:
    """The line's phonemes: misaki's for Mandarin and Japanese when it has them (Kokoro's own
    phonemes for those voices), espeak-ng's otherwise."""
    if code in PHONEMES and os.environ.get("ORBS_VOICE_ESPEAK") != "1":
        return PHONEMES[code]
    if code in ("z", "j"):
        try:
            # only with `--with "misaki[zh]"` (or [ja]): not part of the kit; each imported alone
            if code == "z":
                from misaki import zh

                return zh.ZHG2P()(LINES[code][0])[0]
            from misaki import ja

            return ja.JAG2P()(LINES[code][0])[0]
        except ImportError:
            pass
    return espeak_phonemes(SAY.get(code, text), espeak)


def espeak_phonemes(text: str, lang: str) -> str:
    """espeak-ng's IPA, clause by clause, its punctuation put back (as Kokoro was trained)."""
    out = []
    for piece, mark in re.findall(r"([^!?.,;:¡¿。！？、]+)([!?.,;:¡¿。！？、]*)", text):
        if not piece.strip():
            continue
        ipa = subprocess.run(["espeak-ng", "-q", "--ipa", "-v", lang, piece.strip()], capture_output=True, text=True, check=True).stdout
        out.append(" ".join(ipa.replace("-", "").split()) + {"！": "!", "？": "?", "。": ".", "、": ","}.get(mark[:1], mark[:1]))
    return " ".join(out)


def takes_of(vid: str) -> list[str]:
    """Every line a voice says, take 1 first."""
    code = "a" if vid == "ash" else vid[0]
    return [LINES[code][0], *MORE.get(code, [])]


def render(vid: str, models: Path, ash_cfg: dict, line: str | None = None) -> tuple[np.ndarray, int, str, str]:
    """A voice's line as audio (take 1's unless `line` is given): (samples, rate, the line, Whisper's
    name for its language)."""
    import voice as V

    paths = {"model": models / "kokoro-v1.0.onnx", "voices": models / "voices-v1.0.bin"}
    if vid == "ash":
        kw = V.settings(ash_cfg)
        kw["speed"] = 1.0
        _, lang, _ = LINES["a"]
        line = line or LINES["a"][0]
        audio, sr = V.Voice(**kw, **paths).say(line)
        return audio, sr, line, lang
    first, lang, espeak = LINES[vid[0]]
    line = line or first
    if espeak is None:
        # an English voice, with Classic's delivery (his energy and movement) but its own sound
        kw = V.settings(ash_cfg)
        kw.update(voice=vid, speed=1.0, lang=None, g2p="misaki", short={})
        audio, sr = V.Voice(**kw, **paths).say(line)
        return audio, sr, line, lang
    v = V.Voice(voice=vid, lang=KOKORO_LANG[vid[0]], **paths)
    audio, sr = v.k.create(phonemes(vid[0], line, espeak), voice=v.style, speed=1.0, lang=KOKORO_LANG[vid[0]], is_phonemes=True)
    audio = np.asarray(audio, dtype=np.float32)
    peak = float(np.abs(audio).max()) or 1.0
    audio = np.concatenate([audio * (0.89 / peak), np.zeros(int(sr * 0.16), dtype=np.float32)])  # -1 dB, a short tail
    return audio, sr, line, lang


_EARS: dict[str, object] = {}


def hear(audio: np.ndarray, sr: int, lang: str) -> str:
    """What Whisper hears in a clip (English on small.en; the rest on large-v3-turbo, told the
    language). Handed the samples at 16 kHz, as the kit's own speech-to-text does: Whisper's file
    reader wants a newer PyAV than the kit's."""
    from faster_whisper import WhisperModel
    from math import gcd
    from scipy.signal import resample_poly

    name = "small.en" if lang == "en" else "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
    if name not in _EARS:
        _EARS[name] = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=4)
    g = gcd(16000, sr)
    pcm = resample_poly(np.asarray(audio, dtype=np.float32), 16000 // g, sr // g).astype(np.float32)
    segments, _ = _EARS[name].transcribe(pcm, language=lang, beam_size=5, vad_filter=False)  # type: ignore[attr-defined]
    return " ".join(s.text.strip() for s in segments).strip()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", type=Path, default=ROOT / "kit" / "ash" / "models")
    ap.add_argument("--ash-voice", type=Path, default=Path.home() / "ash" / "voice" / "voice.json")
    ap.add_argument("--only", default="", help="comma-separated voice ids")
    ap.add_argument("--more", action="store_true", help="only the takes after the first (the first is kept as it is)")
    a = ap.parse_args()
    if not (a.models / "kokoro-v1.0.onnx").exists():
        sys.exit(f"no Kokoro model in {a.models} (see README.md: the voice models)")
    ash_cfg = json.loads(a.ash_voice.read_text()) if a.ash_voice.exists() else {}
    if not ash_cfg:
        sys.exit(f"Classic is Ash's own blend, read from {a.ash_voice}: it is not there")
    out = APP / "public" / "voices"
    out.mkdir(parents=True, exist_ok=True)
    report_path = Path(__file__).with_name("voice_samples.json")
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    want = [v for v in voice_ids() if not a.only or v in a.only.split(",")]
    refused = []
    jobs = [(vid, n, line) for vid in want for n, line in enumerate(takes_of(vid), 1) if n > 1 or not a.more]
    with tempfile.TemporaryDirectory() as tmp:
        for i, (vid, n, want_line) in enumerate(jobs):
            name = vid if n == 1 else f"{vid}-{n}"  # the file; the report's key is the same with # for -
            key = vid if n == 1 else f"{vid}#{n}"
            audio, sr, line, lang = render(vid, a.models, ash_cfg, want_line)
            wav = Path(tmp) / f"{name}.wav"
            import wave

            with wave.open(str(wav), "wb") as w:
                w.setnchannels(1)
                w.setsampwidth(2)
                w.setframerate(sr)
                w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
            heard = hear(audio, sr, lang)
            score = alike(line, heard)
            if i == 0:
                # the control: the same clip against another language's line must NOT pass, or the check proves nothing
                other = LINES["f" if lang == "en" else "a"][0]  # (any take: it is another language's line)
                if alike(other, heard) >= HEARD:
                    sys.exit(f"the check cannot fail: {vid}'s clip scored {alike(other, heard):.2f} against {other!r}")
            seconds = round(len(audio) / sr, 2)
            print(f"{name:16} {score:.2f}  {seconds:4.1f}s  heard: {heard}")
            if score < HEARD:
                refused.append(name)
                (out / f"{name}.mp3").unlink(missing_ok=True)
                report[key] = {"line": line, "heard": heard, "alike": round(score, 2), "kept": False}
                continue
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "40k", str(out / f"{name}.mp3")], check=True)
            report[key] = {"line": line, "heard": heard, "alike": round(score, 2), "seconds": seconds, "kept": True}
    report_path.write_text(json.dumps(dict(sorted(report.items())), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    # the app's list of each voice's takes, in order, from the files that were kept (a take Whisper did
    # not hear right is left out, and the voice's next press goes on to the one after)
    takes: dict[str, list[str]] = {}
    for vid in voice_ids():
        files = [f"{vid}.mp3" if n == 1 else f"{vid}-{n}.mp3" for n in range(1, len(takes_of(vid)) + 1)]
        takes[vid] = [f for f in files if (out / f).exists()]
    (APP / "src" / "orb" / "takes.json").write_text(json.dumps(takes, indent=0) + "\n", encoding="utf-8")
    kept = len(jobs) - len(refused)
    print(f"\n{kept} of {len(jobs)} kept in {out.relative_to(ROOT)}" + (f"; not heard right, so not kept: {', '.join(refused)}" if refused else ""))
    sys.exit(1 if refused else 0)


if __name__ == "__main__":
    main()
