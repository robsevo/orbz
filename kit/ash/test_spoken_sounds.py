#!/usr/bin/env python3
"""Sounds the voice made that no person makes. Run: orb/daemon/.venv/bin/python orb/daemon/test_spoken_sounds.py

The owner, testing live on 2026-09-24: "some words like 'ohh' sound robotic", and "there's also
that random breath sometimes which can be weird".

  SS.1  D364 — stretched interjections ("Ohh", "Ahh", "Oooh", "Hmmm", "Uhh", "Awww") are folded
        by `speakable` to the spelling the voice says as ONE sound; the capital is kept; words
        that only begin the same way ("Ohio", "Ahead", "Aha", "Hummus") are left alone
  SS.2  ...and every spelling it folds TO is one clean sound through the phonemiser `Voice`
        really uses (misaki + espeak fallback + the lexicon): no `❓`, no doubled vowel.
        CONTROL: the stretched spellings themselves are NOT — "Ahh" is a doubled `ɑɑ` — so the
        check can tell the two apart
  SS.3  D365 — the gap between phrases is room tone and nothing else: `Voice._space` with the
        breath off is sample-for-sample the room tone of that length, and never calls
        `_breath`. CONTROL: with BREATHE on, the same gap has the inhale in it
"""
# ASH_TIER: product
# Imports speakable and voice (no model is loaded: `_space` and `_room` are pure numpy), and
# builds a misaki G2P the way `Voice._synth` does. Writes nothing.
import re
import sys
import warnings
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
warnings.filterwarnings("ignore")

import speakable  # noqa: E402
import voice  # noqa: E402

FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


# ── SS.1  the fold ──────────────────────────────────────────────────────────────────────
FOLD = {
    "Ohh, nice.": "Oh, nice.", "Ohhh nice.": "Oh nice.", "OHHH no": "Oh no", "ohh ok": "oh ok",
    "Oooh, that's cool.": "Ooh, that's cool.", "Aah, got it.": "Ah, got it.",
    "Ahh, my bad.": "Ah, my bad.", "Uhh, sure.": "Uh, sure.", "Umm, maybe.": "Um, maybe.",
    "Hmmm, let me think.": "Hmm, let me think.", "Mmm, good.": "Mm, good.", "Awww.": "Aw.",
    "Whoaa.": "Whoa.",
}
for said, want in FOLD.items():
    got = speakable.speakable(said)
    ok(got == want, f"SS.1 {said!r} is said as {want!r}: {got!r}")
for keep in ("Ohio is ahead.", "Aha!", "Ahmed said hmm.", "Hummus, umami and ohms.", "Oh, right.",
             "Ah, my bad.", "Hmm, fair."):
    got = speakable.speakable(keep)
    ok(got == keep, f"SS.1 CONTROL: {keep!r} is not an interjection to fold, or is already one: {got!r}")

# ── SS.2  every target is one clean sound ─────────────────────────────────────────────
try:
    from misaki import en
    from misaki import espeak as _espeak
    import lexicon
    g = en.G2P(trf=False, british=False, fallback=_espeak.EspeakFallback(british=False))
    lexicon.install(g)
except Exception as e:                  # a voice that cannot be built is a failure here, loudly
    g = None
    ok(False, f"SS.2 the phonemiser Voice uses could not be built: {type(e).__name__}: {e}")


def one_sound(word):
    """(ok, phonemes): a single phonemised word, no unknown marker, no vowel said twice."""
    ps = str(g(word)[0]).strip(" ,.")
    doubled = re.search(r"([ɑæʌɔəɛɪiuʊoOAIWaeɜ])\1", ps.replace("ˈ", "").replace("ˌ", ""))
    return ("❓" not in ps and " " not in ps and not doubled), ps


if g is not None:
    targets = sorted({canon for _rx, canon in speakable._INTERJECTIONS})
    ok(len(targets) >= 9, f"SS.2 CONTROL: the fold table is there to check ({targets})")
    for t in targets:
        good, ps = one_sound(t)
        ok(good, f"SS.2 {t!r} — a spelling the fold produces — is one clean sound: {ps!r}")
    bad = [w for w in ("Ahh", "Oooh", "Uhh", "Awww") if one_sound(w)[0]]
    ok(not bad, f"SS.2 CONTROL: the stretched spellings ARE caught as doubled or unknown, so a "
                f"passing target means something: {bad}")

# ── SS.3  the gap has no breath in it ──────────────────────────────────────────────────
V = voice.Voice
v = V.__new__(V)                         # no model: _space and _room are pure numpy
calls = []
_real_breath = V._breath


def _spy(self, n, seed=0, ref=1.0):
    calls.append(n)
    return _real_breath(self, n, seed, ref)


V._breath = _spy
try:
    ok(V.BREATHE is False, "SS.3 the breath is OFF by default (D365)")
    n = int(voice.SR * 0.5)
    gap = v._space(0.5, seed=3, ref=1.0)
    ok(len(gap) == n and bool((gap == v._room(n)).all()) and not calls,
       f"SS.3 a half-second gap is room tone and nothing else — no inhale drawn ({len(calls)} drawn)")
    v.BREATHE = True
    loud = v._space(0.5, seed=3, ref=1.0)
    ok(calls and not bool((loud == v._room(n)).all()),
       "SS.3 CONTROL: with BREATHE on, the same gap has the inhale in it — so the check above can fail")
finally:
    V._breath = _real_breath

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print("✓ spoken sounds: stretched interjections folded to one clean sound, and no synthetic breath "
      "(SS.2/SS.3 controls)")
