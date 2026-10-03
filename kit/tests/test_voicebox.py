#!/usr/bin/env python3
"""Speaking and listening for the app (PLAN 4.3_t): kit/orbs_kit/voicebox.py on the kit's own models
(Kokoro, Whisper base.en, Smart Turn v3.2).

Rates, not single runs (Ash's evals' way): "hey <name>" and the things that are not it are spoken
by several of Kokoro's voices, and what is measured is how often he wakes, and how often he wakes
when he should not. The clips are made here, by Kokoro; none of anyone's real voice is kept in the
repo."""
import base64
import io
import sys
import wave
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT))
from orbs_kit import voicebox as vb  # noqa: E402

FAIL = []


def ok(cond, label):
    print(f"{'PASS' if cond else 'FAIL'}  {label}")
    if not cond:
        FAIL.append(label)


def clip(text, voice):
    return vb.say(text, voice)["wav"]


if not (vb.WHISPER / "model.bin").exists():
    print("FAIL  VB.0 the kit's models are here (fetch them: python -m orbs_kit.models)")
    sys.exit(1)

# ── VB.1 what he says is said for the ear: no markdown, paths or machinery read aloud ──────────
ph = vb.phrases("**Done.** I wrote `report.md` to ~/work/report.md, see https://example.com/x for the rest.", "ash")
joined = " ".join(ph)
ok(len(ph) >= 1 and not any(m in joined for m in ("**", "`", "https://", "~/")), f"VB.1 phrases for the ear: {ph}")

# ── VB.2 a phrase in his voice: Classic and an English voice; another language says so ───────────
for v in ("ash", "bm_george"):
    raw = base64.b64decode(vb.say("Here is what I found.", v)["wav"])
    with wave.open(io.BytesIO(raw)) as w:
        secs = w.getnframes() / w.getframerate()
        ok((w.getframerate(), w.getnchannels(), w.getsampwidth()) == (24000, 1, 2) and secs > 0.5, f"VB.2 {v}: a {secs:.2f} s WAV, 24 kHz mono 16-bit")
try:
    vb.say("Bonjour.", "ff_siwis")
    ok(False, "VB.2 a voice of another language is not read live yet, and says so")
except vb.VoiceError as e:
    ok("only its preview" in str(e), f"VB.2 a voice of another language says so: {e}")
try:
    vb.say("   ", "ash")
    ok(False, "VB.2 nothing to say is refused")
except vb.VoiceError:
    ok(True, "VB.2 nothing to say is refused")

# ── VB.3 what you said, heard (a browser's recording, round trip through the decoder) ────────────
heard = vb.hear(clip("Hey Hazel, what is on my calendar today?", "af_heart"), "Hazel")["text"].lower()
ok("calendar" in heard and "today" in heard, f"VB.3 heard: {heard!r}")
for bad in ("", base64.b64encode(b"not audio at all").decode()):
    try:
        vb.hear(bad, "Hazel")
        ok(False, "VB.3 an empty or unreadable recording is refused plainly")
    except vb.VoiceError as e:
        ok(True, f"VB.3 refused plainly: {e}")

# ── VB.4 wake and no-wake, as rates over voices ───────────────────────────────────────────────────
VOICES = ["af_heart", "af_bella", "am_michael", "bf_emma", "bm_george", "am_eric"]
CALLS = ["Hey Hazel.", "Hey Hazel, are you there?", "Hazel, quick question."]
NOT_CALLS = ["Hey there, how are you?", "I love hazelnut coffee.", "Say hello to everyone.", "Hey, how is your day going?", "We planted basil and roses."]
woke = [vb.woken(clip(t, v), "Hazel")["woken"] for t in CALLS for v in VOICES]
false = [vb.woken(clip(t, v), "Hazel")["woken"] for t in NOT_CALLS for v in VOICES]
rate, frate = sum(woke) / len(woke), sum(false) / len(false)
print(f"  wake rate {rate:.0%} ({sum(woke)}/{len(woke)}), false wakes {frate:.0%} ({sum(false)}/{len(false)})")
ok(rate >= 0.9, f"VB.4 he wakes to his name: {rate:.0%} of {len(woke)} calls (needs 90%)")
ok(frate <= 0.05, f"VB.4 he does not wake to what is not his name: {frate:.0%} of {len(false)} (at most 5%)")
ok(not vb.woken(clip("Hey Hazel.", "af_heart"), "Juniper")["woken"], "VB.4 CONTROL: another orb's name does not wake him")

# ── VB.5 finished: a whole sentence, then a pause, clears Ash's threshold, so the turn ends early ──
# (Whether a sentence cut off is heard as unfinished cannot be measured on Kokoro's voices: Smart Turn
# scores Kokoro's half sentences as finished too, 0.96 to 0.99 on 10-02. Ash measured it on a real
# recording, 0.98 whole and 0.38 half, which is not carried: none goes in this repo. A turn Smart Turn
# calls unfinished ends at the endpoint, 1.4 s of quiet.)
import numpy as np  # noqa: E402


def with_pause(wav_b64):
    a = vb._samples(wav_b64)
    return base64.b64encode(vb._wav(np.concatenate([a, np.zeros(int(0.4 * 16000), np.float32)]), 16000)).decode()


whole = [vb.finished(with_pause(clip("Can you book me a table for two at seven tonight?", v))) for v in VOICES]
print(f"  Smart Turn on a whole sentence: {[round(w['p'], 2) for w in whole]}")
ok(sum(w["finished"] for w in whole) >= 5, f"VB.5 a whole sentence sounds finished (0.97) in at least 5 of 6 voices: {sum(w['finished'] for w in whole)}")
ok(all(0.0 <= w["p"] <= 1.0 for w in whole), "VB.5 its score is a probability")

print("ALL PASS" if not FAIL else f"{len(FAIL)} FAILED")
sys.exit(1 if FAIL else 0)
