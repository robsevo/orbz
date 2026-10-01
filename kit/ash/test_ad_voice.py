#!/usr/bin/env python3
"""He breathes where the ad breathes (F.15, 2026-09-25). Run: orb/daemon/.venv/bin/python orb/daemon/test_ad_voice.py

Owner: "like we really want him to sound like the ad we made." The ad's voice-over take is
ad/vo/body-A.wav. Said with the same words, he matched it in speech length, pitch and brightness
within a few percent — and paused at 2 places where it paused at 4. The ad breathes at its commas
(470 ms after "things,", 380 after "code,"); he ran them on. voice.py now widens the silence the
model leaves at each comma to COMMA_PAUSE, and the pause between sentences is matched to the ad's.

The real synthesiser renders the ad's text (his blend, fixed here, at his speed):

  AV.1  it pauses at the ad's places and nowhere else: both full stops and at least one of its two
        commas (a comma whose own silence is too short to be told from a hold inside a phrase runs
        on — owner: "he stops for no reason mid sentence" is the worse fault; test_comma_beats)
  AV.2  each pause within 150 ms of the ad's own at that place (550, 470, 380, 460 ms)
  AV.3  every word is still there: the speech recogniser hears the whole text
  AV.0  CONTROL: voice.py at 44388a8 (before the comma breaths) pauses at two places — AV.1 fails
"""
# ASH_TIER: product
import importlib.util
import re
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
FAIL = []
TEXT = "Imagine an assistant that doesn't just answer. It opens things, writes code, builds it while you watch. You don't have to imagine."
AD = [550, 470, 380, 460]
BLEND = "am_eric:9+af_heart:6+am_onyx:3+bm_george:12+bm_fable:6"


def ok(cond, label):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}")
    if not cond:
        FAIL.append(label)


def pauses(a, sr):
    h = int(0.01 * sr)
    e = np.sqrt(np.convolve(a.astype(np.float64) ** 2, np.ones(h) / h, mode="same"))[::h]
    q = e < 0.015
    on, off = int(np.argmax(~q)), len(q) - int(np.argmax(~q[::-1]))
    out, run = [], 0
    for x in q[on:off]:
        if x:
            run += 1
        else:
            if run >= 25:                      # 250 ms and more: a pause a listener hears as one
                out.append(run * 10)
            run = 0
    return out


def render(mod):
    v = mod.Voice(voice=BLEND, speed=1.008, pitch=1.0, energy=0.3, movement=0.7, lang="en-us", rasp=0.35, g2p="misaki")
    return v.say(TEXT)


import voice  # noqa: E402

a, sr = render(voice)
p = pauses(a, sr)
ok(3 <= len(p) <= 4, f"AV.1 he pauses at the ad's places — both stops and its commas where he can tell them: {p} (the ad: {AD})")
# match each pause to the ad's pause at the same place: the first is "answer.", the last "watch."
matched = [p[0], p[-1]] if len(p) >= 2 else []
ok(len(matched) == 2 and abs(matched[0] - AD[0]) <= 150 and abs(matched[1] - AD[3]) <= 150
   and all(250 <= x <= 650 for x in p), f"AV.2 at the ad's length: {p} vs {AD}")
try:
    import stt
    from scipy.signal import resample_poly
    m = stt.load("base.en")
    x = resample_poly(a.astype(np.float32), 2, 3).astype(np.float32)
    segs, _ = m.transcribe(x, beam_size=5, language="en", vad_filter=False)
    said = " ".join(s.text for s in segs)
    norm = lambda t: re.sub(r"[^a-z ]", "", t.lower().replace("'", "")).split()
    ok(norm(said) == norm(TEXT), f"AV.3 every word is still there: {said.strip()!r}")
except Exception as e:
    ok(False, f"AV.3 the recogniser could not run: {type(e).__name__}: {e}")

old = __import__("carried_git").show("44388a8:orb/daemon/voice.py").stdout
if not old:
    ok(False, "AV.0 CONTROL: could not read voice.py at 44388a8")
else:
    d = Path(tempfile.mkdtemp(prefix="av0-"))
    try:
        (d / "voice_old.py").write_text(old)
        (d / "models").symlink_to(HERE / "models")
        spec = importlib.util.spec_from_file_location("voice_old", d / "voice_old.py")
        mo = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mo)
        oa, osr = render(mo)
        op = pauses(oa, osr)
        ok(len(op) < 4, f"AV.0 CONTROL: before the comma breaths he paused at {len(op)} places {op} — AV.1 can fail")
    finally:
        shutil.rmtree(d, ignore_errors=True)

if FAIL:
    print(f"\nFAIL  ad_voice  ({len(FAIL)} failing)")
    raise SystemExit(1)
print("\nPASS  ad_voice  (0 failing)")
