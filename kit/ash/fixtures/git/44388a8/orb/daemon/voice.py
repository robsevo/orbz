#!/usr/bin/env python3
"""
voice — Ash's delivery engine.

The model is not what makes TTS sound robotic. Kokoro is picked over models a
hundred times its size in blind tests; what gives a synthetic voice away is
DELIVERY, and almost all of it is fixable outside the model:

  1. One call per paragraph gives the whole paragraph ONE flat contour.
     Humans re-pitch every phrase. -> synthesise phrase at a time.
  2. Every phrase at identical speed is the deadest tell there is.
     Humans speed up on asides and slow down on the point. -> vary per phrase.
  3. Digital silence between phrases. Real rooms are never silent, and the
     absolute zero between words reads as a machine. -> room tone.
  4. Equal gaps everywhere. A comma, a full stop and a question are three
     different lengths of pause. -> punctuation-aware timing.
  5. Hard cuts between chunks click. -> crossfade the joins.
  6. Final phrases that stop dead. Humans trail and slow into a close.
"""
import re, numpy as np
from pathlib import Path
from fractions import Fraction
# imported here, not inside _resample: the first import costs ~0.66 s, and paying
# it at ashd start-up is free while paying it on the first phrase is dead air.
from scipy.signal import resample_poly

SR = 24000
HERE = Path(__file__).parent

try:
    from kokoro_onnx import Kokoro
except ImportError:
    Kokoro = None


# Replies to thanks are the one place a flat deadpan reads as cold rather than dry.
# These get a lighter, quicker, slightly lifted delivery - a "no problem", not a receipt.
WARM = re.compile(r"\b(you're welcome|you are welcome|no problem|no worries|any ?time|"
                  r"happy to help|glad to help|my pleasure|of course)\b", re.I)

_HANDOFF_RE = re.compile(r"^(hope you (?:like|enjoy)|feel free to|let me know if|"
                         r"enjoy\b|have a look|take a look|go ahead and|it'?s all yours|"
                         r"that'?s everything|anything else)", re.I)


# ---------------------------------------------------------------- the voice policy (11.8)
#
# REGISTER COMES FROM THE BLEND, NEVER FROM A TRANSPOSE. `pitch` resamples the whole voice,
# which moves pitch and duration together: it stretches the phrase and slurs the consonant
# releases, and it is the single clearest robotic tell this project has produced. The way to
# raise Ash's register is to re-weight the blend — `am_eric:9+bm_george:12+…` — which changes
# who is speaking rather than replaying one person faster.
#
# That rule held for months as PROSE, in voice.json's own `do_not_regress` field. Prose does
# not bind (CLAUDE.md §9.5), and this file is the proof: the same note says movement is "held
# LOW at 0.22" while the live config has carried 0.85 since 2026-09-19. The note was right
# when written and has been wrong twice since, and nothing noticed either time. So the rule
# is a function now, applied where the config is READ, which is the one place every caller
# goes through.
PITCH_NEUTRAL = 1.0
DEFAULT_VOICE = "bm_george"      # one voice, no blend — a fallback, never a choice


def settings(cfg, log=print):
    """voice.json -> the kwargs `Voice` should actually be built with.

    Returns sane values for junk input and SAYS SO rather than substituting in silence: the
    read site used to be `try: … except Exception: pass`, so an unreadable voice.json swapped
    a five-way blend at movement 0.85 for a single unblended `bm_lewis` at movement 1.0, with
    no log line. A voice that quietly becomes a different voice is not a fallback, it is a
    bug wearing one.
    """
    if not isinstance(cfg, dict):
        log(f"voice config is {type(cfg).__name__}, not an object — "
            f"falling back to the unblended {DEFAULT_VOICE}")
        cfg = {}

    def num(key, default):
        try:
            return float(cfg[key])
        except (KeyError, TypeError, ValueError):
            if key in cfg:
                log(f"voice {key}={cfg[key]!r} is not a number — using {default}")
            return default

    name = cfg.get("voice") or DEFAULT_VOICE
    if not isinstance(name, str) or not name.strip():
        log(f"voice name {name!r} is unusable — using {DEFAULT_VOICE}")
        name = DEFAULT_VOICE
    if "+" not in name:
        # Not fatal: a single voice is a legitimate thing to audition, and refusing one
        # would make the auditioning tool unable to do its job. It is worth a line, because
        # arriving here by accident is how the blend gets lost.
        log(f"voice {name!r} is a single voice, not a blend — register is set by the blend, "
            f"so this is a fallback or an audition, not a chosen voice")

    pitch = num("pitch", PITCH_NEUTRAL)
    if pitch != PITCH_NEUTRAL:
        log(f"REFUSING pitch={pitch}: a whole-voice transpose resamples, which stretches the "
            f"phrase and slurs consonant releases. Raise the register by re-weighting the "
            f"blend instead. Using pitch={PITCH_NEUTRAL}.")
        pitch = PITCH_NEUTRAL

    return {"voice": name, "speed": num("speed", 1.0), "pitch": pitch,
            "energy": num("energy", 0.0), "movement": num("movement", 1.0),
            "lang": cfg.get("lang"), "rasp": num("rasp", 0.0),
            "g2p": cfg.get("g2p", "espeak")}


class Voice:
    def __init__(self, voice="bm_george", speed=1.0,
                 model=None, voices=None, energy=0.0, pitch=1.0, movement=1.0, lang=None, rasp=0.0,
                 g2p="espeak"):
        self.voice = voice
        # LANG: which phonemizer pronounces the text. It was inferred from the FIRST
        # voice in the blend, so re-ordering a blend silently changed pronunciation -
        # and dropping a leading bm_ voice flipped the whole delivery to en-us. A blend
        # can legitimately want a British voice in the mix and American pronunciation,
        # so this is now sayable outright instead of being a side effect of string order.
        self._lang = lang
        # RASP: 0 is the voice as synthesised. Kokoro has no rough voice to blend in without
        # moving the register again, so a little grit is added after synthesis instead.
        self.rasp = rasp
        # G2P: how text becomes phonemes. kokoro-onnx defaults to espeak, but Kokoro was
        # TRAINED on misaki's phonemes, which also carry connected speech ("going to" ->
        # "g'OIN te", "we're" -> "wIr"). espeak's citation-form phonemes are part of why
        # he pronounced every word as if reading it off a card.
        self.g2p = g2p
        # PITCH: a whole-voice transpose on top of the per-phrase movement, so a
        # voice can be taken deeper without changing who it is. 1.0 is the voice as
        # trained; 0.94 is noticeably deeper; below ~0.88 it starts to sound processed.
        self.pitch = pitch
        # MOVEMENT: how much of the per-phrase pitch contour to apply. Moving pitch
        # means resampling, and resampling by r<1 STRETCHES the phrase - measured at
        # +3.7% and +6.1% on the last two phrases of a three-phrase line. That stretch
        # drags out consonant releases, which the user heard as a slur ("start" ->
        # "starht", "a bit drunk"), worst at the end of an utterance where the
        # close-down multiplier lands. 0 disables it: no phrase is resampled at all.
        self.movement = movement
        self.base_speed = speed
        # ENERGY: 0 is the delivery as tuned. Above 0 he sounds more engaged -
        # pitch sits a little higher, phrase-to-phrase intonation moves further,
        # and the silences between phrases tighten. Kept small: 0.3 reads as
        # "interested", past ~0.8 it tips into a presenter voice.
        self.energy = energy
        self._k = None
        self._model  = model  or HERE/"models/kokoro-v1.0.onnx"
        self._voices = voices or HERE/"models/voices-v1.0.bin"

    @property
    def k(self):
        if self._k is None:
            if Kokoro is None:
                raise RuntimeError("kokoro-onnx not installed")
            self._k = Kokoro(str(self._model), str(self._voices))
        return self._k

    @property
    def lang(self):
        return self._lang or ("en-gb" if self.voice.startswith("b") else "en-us")

    @property
    def style(self):
        """The voice vector. `a+b` blends two voices evenly, which is how a voice
        can be British in shape but carry another's weight - neither one alone."""
        if "+" not in self.voice:
            return self.voice
        # "a+b" is an even blend; "a:3+b:1" weights it. An even blend of a male and
        # a female voice lands halfway between two registers, which is nobody -
        # weights are how the blend stays in one voice's register while borrowing
        # the other's timbre. Weights are normalised, so 3:1 and 75:25 are the same.
        pairs = []
        for part in self.voice.split("+"):
            name, _, w = part.partition(":")
            pairs.append((name, float(w) if w else 1.0))
        total = sum(w for _, w in pairs) or 1.0
        return sum(self.k.get_voice_style(n) * (w/total) for n, w in pairs)

    # ---- prosody ----------------------------------------------------------
    def _phrase_speed(self, ph, i, n):
        """Humans do not deliver every clause at one rate. Asides and
        parentheticals get hurried; the sentence that carries the point gets
        room. This is the single biggest naturalness win after phrasing."""
        s = self.base_speed
        low = ph.lower()

        if ph.startswith(("(", "—", "-")) or low.startswith(("by the way", "incidentally", "though", "also")):
            s *= 1.07                      # aside: hurry it
        # These four all describe the SAME closing beat, and a short final question
        # ("Is that okay?") satisfies three at once. Multiplied together they drag
        # the last phrase ~15% under the phrase before it, which is heard as the
        # final word being stretched. Only the strongest reason applies.
        # These were tuned when the voice ran much slower overall. At this rate they
        # read as a drawl rather than as phrasing, so each is roughly halved: enough
        # to shape the line, not enough to hear as a held vowel.
        slow = []
        if ph.endswith("?"):        slow.append(0.985)  # questions sit slightly back
        # Trailing into the close needs a phrase long enough to trail ACROSS. On a
        # short closer ("Is that okay?") the slowdown lands on one or two words, and
        # Kokoro answers a slow rate by holding the final vowel - the stretched
        # "okayyy". A short last phrase is already a short beat; leave it alone.
        if i == n - 1 and n > 1 and len(ph) >= 26:
            slow.append(0.975)
        if len(ph) < 26 and i != n - 1:  slow.append(0.985)  # short mid phrases land unhurried
        if re.search(r"\b\d", ph):      slow.append(0.975)  # numbers need air to be heard
        if slow:
            s *= min(slow)
        if n == 1 and len(ph.split()) <= self.SHORT_WORDS:
            s *= (self.TINY_PUSH if len(ph.split()) <= self.TINY_WORDS else self.SHORT_PUSH)
        if WARM.search(ph):
            s = self.base_speed * 1.06     # brisk and light, and none of the slow-downs above
        # a touch of drift so no two runs are metronomically identical
        s *= 1.0 + (hash((ph, i)) % 100 - 50) / 2200.0
        return max(0.72, min(1.30, s))

    # A SHORT LINE IS NOT A SLOW LINE.
    # Kokoro holds the final vowel of an isolated word however fast it is asked to speak:
    # measured, "Hey." came out 0.45 s of speech for one syllable — 2.2 syllables a second
    # against the commercial's 6.5 — and the user heard exactly that ("he dragged the hey
    # there so bad it sounded like a robot"). The rate is pushed for very short utterances,
    # and the held tail is cut off the end of the sound itself, because no rate stops the
    # model from sustaining that last vowel.
    SHORT_WORDS = 4          # an utterance this short gets hurried
    SHORT_PUSH = 1.22        # ... by this much, and harder still when it is one or two words
    TINY_WORDS = 2
    TINY_PUSH = 1.38
    TAIL_FLOOR = 0.22        # trailing audio under this share of the peak is a held vowel
    TINY_TAIL_FLOOR = 0.34   # ... and a one-word line is nearly all held vowel
    TAIL_KEEP = 0.06         # ... but never cut a line shorter than this

    def _tighten_tail(self, a, sr, floor=None):
        """Cut the vowel a short line is left hanging on, and fade where it is cut."""
        floor = self.TAIL_FLOOR if floor is None else floor
        if len(a) < int(0.12 * sr):
            return a
        hop = max(1, int(0.01 * sr))
        env = np.array([np.abs(a[i:i + hop]).max() for i in range(0, len(a) - hop, hop)])
        if not len(env):
            return a
        peak = float(env.max())
        if peak <= 1e-6:
            return a
        loud = np.nonzero(env > peak * floor)[0]
        if not len(loud):
            return a
        end = min(len(a), int((loud[-1] + 2) * hop))
        if end < int(self.TAIL_KEEP * sr) or end >= len(a) - hop:
            return a
        out = a[:end].copy()
        fade = min(int(0.02 * sr), len(out) // 4)
        if fade:
            out[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=out.dtype)
        return out

    def _pitch_shift(self, ph, i, n):
        """Per-phrase pitch movement.

        A flat voice is the clearest robotic tell there is, and Kokoro exposes
        no pitch control. But resampling shifts pitch AND duration together, so
        synthesising at speed/r and then resampling by r moves the pitch while
        leaving the length alone. That buys real intonation on any voice.

        Sizes are small on purpose: speech moves a couple of semitones across a
        phrase, and more than that sounds seasick rather than expressive."""
        r = 1.0
        if ph.endswith("?"):        r *= 1.035     # questions rise
        elif ph.endswith("!"):      r *= 1.028
        elif ph.endswith("."):      r *= 0.982     # statements fall away
        if i == 0 and n > 1:        r *= 1.012     # open slightly up
        if i == n-1 and n > 1:      r *= 0.972     # close down: this is finished
        # declination: pitch drifts down across a long utterance, as in speech
        if n > 2:                   r *= 1.0 - 0.016*(i/(n-1))
        r *= 1.0 + (hash((ph, i, 7)) % 100 - 50) / 5200.0
        e = self.energy
        r = 1.0 + (r - 1.0)*(1.0 + 1.4*e)          # wider movement between phrases
        r *= 1.0 + 0.045*e                         # and a slightly brighter register
        r = max(0.93, min(1.09, r))
        r = 1.0 + (r - 1.0) * self.movement        # how much of that contour to keep
        if WARM.search(ph):
            r = max(r, 1.0) * 1.04                 # a cheerful lift, never a fall
        r *= self.pitch                            # the whole voice, transposed
        return max(0.80, min(1.15, r))

    # Kokoro answers a slow rate by HOLDING vowels, not by pacing the phrase, so a
    # low synthesis speed is heard as a stretched final word ("okayyy") however the
    # duration is restored afterwards. The rate handed to the model therefore has a
    # floor; the pitch movement it costs is far less audible than the stretch.
    SYNTH_FLOOR = 0.92

    def _synth_speed(self, ph, i, n, r):
        """The rate handed to Kokoro.

        The scheme is synthesise at speed/r then resample by r, so pitch moves and
        the duration lands where it should. But when r > 1 that asks Kokoro to slow
        DOWN, and a TTS duration model spends extra time on vowels, not consonants.
        The resample afterwards compresses everything uniformly, so the vowels stay
        proportionally long - measured at +12% median and +18% at p90 against raw
        Kokoro on the same line. That is the drawl.

        So the rate is never allowed below the phrase's own intended speed. Rising
        pitch then costs a little duration instead of a stretched vowel, which is
        the better trade: the phrase comes out slightly brisker, and nothing drawls.
        Falling pitch (r < 1) asks for a faster rate, which compresses vowels and
        was never the problem - that branch is unchanged."""
        s = self._phrase_speed(ph, i, n)
        return max(self.SYNTH_FLOOR, s, s / r)

    @staticmethod
    def _resample(a, r):
        """Polyphase resample by r, with a real anti-aliasing filter.

        This was linear interpolation, then Catmull-Rom cubic. Both are
        INTERPOLATING kernels: they reconstruct between samples but never filter
        before decimating, so every ratio away from 1.0 folds the top octave back
        down as alias. Measured on clean tones, cubic leaves spurious energy at
        -43.8 dBc at 3 kHz and -23.5 dBc at 6 kHz. Differencing two otherwise
        identical renders of the same line puts that artefact ABOVE the speech
        itself over 3 kHz: +1.1 dB at 3-6 k, +3.4 dB at 6-9 k, +3.0 dB at 9-12 k.
        Consonants, sibilants and breath live up there, which is why the result
        read as metallic however good the voice underneath was.

        resample_poly low-passes before it decimates, which drops those same
        tones to -70.8 and -75.8 dBc - 27 dB and 52 dB cleaner. It costs a little
        more than the 4-point kernel and nothing at all next to synthesis.

        The phrase length is unchanged, so pitch, pace and the voice itself are
        exactly as they were; this only stops the resampler inventing a top end.
        """
        if abs(r-1.0) < 1e-3 or len(a) < 16:
            return a
        # r is the pitch ratio, and the output is len(a)/r samples long, so the
        # rate change handed to resample_poly is 1/r. A denominator cap of 400
        # keeps the filter short; the ratio error it costs is under 1 part in 300k.
        f = Fraction(float(r)).limit_denominator(400)
        out = resample_poly(a.astype(np.float64), f.denominator, f.numerator)
        return np.clip(out, -1.0, 1.0).astype(np.float32)

    def _gap(self, ph, nxt):
        """A comma, a full stop and a question mark are three different
        silences. Using one gap for all of them is what makes TTS sound like a
        list being read."""
        # Silent pauses in speech are trimodal — brief (<200 ms), medium (200-1000 ms) and
        # long (>1000 ms) — and 200-250 ms is where listeners rate clarity highest, while a
        # conversational turn changes hands in under 300 ms. Read-speech studies like their
        # pauses much longer (0.6-1.2 s between sentences); that is a lecture, not a person
        # talking to you, so these sit at the fast end of the medium band.
        if self.OPENER_PIECE.fullmatch(ph.strip()):
            return self.COMMA_BEAT                 # "Hey," then a beat, then the rest (F.14)
        if ph.endswith("?"):  g = 0.40
        elif ph.endswith("!"): g = 0.34
        elif ph.endswith("."): g = 0.34
        elif ph.endswith(","): g = 0.18
        elif ph.endswith((":", ";")): g = 0.26
        else: g = 0.20
        if nxt and nxt[:1].isupper() and ph.endswith("."):
            g += 0.06                      # new sentence, new thought
        if nxt and len(nxt) > 120:
            g += 0.10                      # a longer run needs a deeper breath before it
        # A hand-off is a change of register - the work is over and he is turning
        # back to the person. Run straight on from the last sentence at 0.26s it
        # sounded like one breathless string (user, 2026-09-15: "there was 0 wait or
        # breath, it sounded robotic and weird"). A real beat before it is the whole
        # difference between a report ending and someone handing something over.
        if len(ph.split()) <= self.OPENER_WORDS and ph.rstrip()[-1:] in ".!?":
            g = max(g, self.OPENER_BEAT)       # "Hey." lands, then he goes on
        if nxt and _HANDOFF_RE.match(nxt.strip()):
            g = max(g, 0.62)
            return g                       # not scaled by energy: the pause IS the delivery
        return g * (1.0 - 0.2*self.energy)         # engaged speech leaves less air between thoughts

    # BREATH. Real speech is punctuated by the speaker taking air, and its absence is one of
    # the things that reads as machine even when the words and the pace are right (user,
    # 2026-09-19: "hey should be like its own breath ... can we add breath and pauses into
    # his speaking like a real person"). A short opener gets a beat of its own, and the
    # longer gaps are filled with a soft inhale instead of bare room tone.
    OPENER_WORDS = 2         # "Hey." "Right." "Done." — a beat, not the start of a run-on
    OPENER_BEAT = 0.46
    # OFF (D365, owner 2026-09-24: "there's also that random breath sometimes which can be
    # weird"). The inhale is band-passed noise, and it lands after every short opener and in
    # the longer gaps — so it comes and goes with the phrasing, which is exactly "random".
    # Built noise does not pass for a person taking air. The PAUSE is kept (room tone of the
    # same length); only the noise inside it is gone. True puts it back.
    BREATHE = False
    BREATH_MIN_GAP = 0.30    # shorter than this and there is no room to breathe
    BREATH_REL = 0.055       # of whatever the speech around it peaks at: about -25 dB,
                             # which is where a breath sits on a recording of a person

    def _breath(self, n, seed=0, ref=1.0):
        """A soft inhale: noise through a rough band-pass, rising then stopping.

        Built rather than sampled, so there is no recording of anyone else in his voice
        and nothing to ship alongside it."""
        if n <= 0:
            return np.zeros(0, dtype=np.float32)
        rng = np.random.default_rng(9200 + seed)
        x = rng.normal(0, 1, n).astype(np.float32)
        lo = np.exp(-2 * np.pi * 1700 / SR)      # keep the hiss under the consonant range
        hi = np.exp(-2 * np.pi * 320 / SR)       # and off the chest
        y = np.empty_like(x); acc = 0.0
        for i in range(n):
            acc = (1 - lo) * x[i] + lo * acc; y[i] = acc
        z = np.empty_like(y); acc = 0.0
        for i in range(n):
            acc = (1 - hi) * y[i] + hi * acc; z[i] = y[i] - acc
        t = np.linspace(0, 1, n, dtype=np.float32)
        # .clip(0): sin(pi * 1.0) in float32 lands at -8.7e-08, and a NEGATIVE base raised to
        # a fractional power is NaN — so the last sample of every breath he took was NaN, and
        # numpy printed this line into his log after every single utterance (2026-09-19).
        env = np.clip(np.sin(np.pi * t ** 0.75), 0.0, None) ** 1.6   # air in: slow rise, quick stop
        z *= env
        m = float(np.abs(z).max()) or 1.0
        return (z / m * self.BREATH_REL * max(ref, 1e-6)).astype(np.float32)

    def _space(self, seconds, seed=0, ref=1.0):
        """The silence between two phrases — with a breath in it when there is room."""
        n = int(SR * max(0.0, seconds))
        if n <= 0:
            return np.zeros(0, dtype=np.float32)
        out = self._room(n)
        if self.BREATHE and seconds >= self.BREATH_MIN_GAP:
            b = self._breath(min(n, int(SR * min(0.26, seconds * 0.55))), seed, ref)
            if len(b):
                out = out.copy()
                out[-len(b):] += b               # taken just before he speaks, as people do
        return out

    def _room(self, n):
        """Room tone. Absolute digital zero between phrases is uncanny - real
        space always has a noise floor, and its absence is heard even when the
        listener cannot say why."""
        if n <= 0:
            return np.zeros(0, dtype=np.float32)
        rng = np.random.default_rng(1234)
        noise = rng.normal(0, 1, n).astype(np.float32)
        # brown-ish: integrate then high-pass, so it sits under speech not over it
        noise = np.cumsum(noise); noise -= np.linspace(noise[0], noise[-1], n)
        noise /= (np.abs(noise).max() + 1e-9)
        return noise * 0.0016

    @staticmethod
    def _join(a, b, ms=12):
        """Crossfade the seam. Butt-joining two synthesis chunks leaves a click
        at the boundary, and clicks are the most machine-like artefact there is."""
        if len(a) == 0: return b
        if len(b) == 0: return a
        n = min(int(SR*ms/1000), len(a)//2, len(b)//2)
        if n < 8: return np.concatenate([a, b])
        w = np.linspace(0, 1, n, dtype=np.float32)
        head = a[:-n]
        mix  = a[-n:]*(1-w) + b[:n]*w
        return np.concatenate([head, mix, b[n:]])

    # ---- fluidity -------------------------------------------------------
    # Sentences used to be synthesised one call each. Every call gets its own melody,
    # rate and loudness from a model that cannot see the next sentence, so the join is
    # audible: "...you appreciate a bit of wit." then a 312 ms gap and a second sentence
    # at a different rate (1.117 vs 1.080) in a tone that did not follow on. The user
    # heard exactly that seam. Short replies are now ONE call, so the model shapes the
    # whole thing; only past ~300 characters is it split, so a long answer still starts
    # speaking without waiting for all of it. Cost measured: first sound 1.53 -> 2.26 s
    # on a two-sentence reply.
    FLUID_CHARS = 300

    def _group(self, parts):
        out, cur = [], ""
        for p in parts:
            if cur and len(cur) + 1 + len(p) > self.FLUID_CHARS:
                out.append(cur); cur = p
            else:
                cur = (cur + " " + p).strip()
        if cur: out.append(cur)
        return out

    # A reply synthesised in one piece keeps its flow, but the model's own stop at a full
    # stop is short and blurs into the last word, so it reads as no pause at all
    # (measured: swapping ". " for "... " or ". -" changes nothing). The pause is added
    # here instead: find the quiet spot the model left at each sentence end and widen it
    # with room tone. Only the N longest quiet runs are used, N = sentence breaks in the
    # text, because the model always stops longer at a full stop than at a comma.
    SENTENCE_PAUSE_S = 0.22

    # A question's tone is a RISE at the end. Kokoro does not make one: measured on every voice
    # in the blend, with misaki and espeak and with "?", "??", "?!", "...?" and tag questions,
    # a question ends 7-9 semitones BELOW its middle, exactly like a statement - the model marks
    # questions with a higher middle, then falls. Resampling cannot turn that round without
    # squashing the last word into a chipmunk, so the ending is reshaped with WORLD instead,
    # which moves pitch while keeping timing and the vocal tract (formants) where they were.
    # Only the tail is resynthesised and crossfaded in; the rest of the sentence is untouched.
    # 1.12 was too high, and it COMPOUNDED: a question in a multi-sentence reply was also
    # resampled by QUESTION_LIFT first, so the ending landed 1.035 x 1.12 = 16% up, well past
    # the 2-4 semitones a real question rises. The uniform lift is now off - the rise alone is
    # what makes a question sound like one - and the rise itself is about one semitone.
    # OFF (1.0), and it should stay off. Kokoro ends a question 7-9 semitones BELOW its own
    # middle, like a statement, so a real rise means moving pitch a long way. Both ways of
    # doing that cost more than they buy: resampling takes the formants up with it (chipmunk),
    # and WORLD resynthesis measures 8.3 dB away from the original with the pitch UNCHANGED -
    # that distortion is what the user heard as robotic, and harvest instead of dio does not
    # help it (8.22 vs 8.35 dB). What does carry a question is what Kokoro already does: it
    # renders one with a higher, brighter middle. That is left alone, and only the small
    # loudness lift below is applied on top.
    QUESTION_RISE = 1.0
    RISE_S = 0.5

    def _question_tone(self, seg):
        x = seg.astype(np.float64)
        if self.QUESTION_RISE <= 1.001 or len(x) < int(0.8*SR):
            return seg.astype(np.float32)          # no reshaping, so no vocoder in the path at all
        try:
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")        # pyworld imports pkg_resources, deprecated
                import pyworld as pw
        except ImportError:
            return seg.astype(np.float32)
        env = np.sqrt(np.convolve(x**2, np.ones(240)/240, mode="same"))
        voiced = np.nonzero(env > 0.02)[0]
        if len(voiced) == 0:
            return seg.astype(np.float32)
        vend = int(voiced[-1]) + 1
        lead = int(0.25*SR)                               # analysed but kept original: reference + crossfade
        r0 = max(0, vend - int(self.RISE_S*SR) - lead)
        region = np.ascontiguousarray(x[r0:])
        fp = 5.0
        f0, t = pw.dio(region, SR, frame_period=fp, f0_floor=60, f0_ceil=400)
        f0 = pw.stonemask(region, f0, t, SR)
        sp = pw.cheaptrick(region, f0, t, SR)
        ap = pw.d4c(region, f0, t, SR)
        lead_f = int(lead / SR * 1000 / fp)
        ref = f0[:lead_f][f0[:lead_f] > 0]
        if len(ref) < 3:
            return seg.astype(np.float32)
        ref = float(np.median(ref))
        vend_f = min(len(f0), int((vend - r0) / SR * 1000 / fp))
        rise_f = max(1, vend_f - lead_f)
        new = f0.copy()
        for k in range(lead_f, vend_f):
            prog = (k - lead_f) / rise_f
            target = ref * (1.0 + (self.QUESTION_RISE - 1.0) * prog)
            w = min(1.0, (k - lead_f) / 16.0)             # ease in over 80 ms: no pitch jump
            if new[k] > 0:
                new[k] = new[k] * (1 - w) + target * w
        y = pw.synthesize(new, sp, ap, SR, frame_period=fp)
        y = np.resize(y, len(region)) if len(y) != len(region) else y
        fade = int(0.08*SR)
        cross = int(lead*0.5)
        out = region.copy()
        ramp = np.linspace(0, 1, fade)
        out[cross:cross+fade] = region[cross:cross+fade]*(1-ramp) + y[cross:cross+fade]*ramp
        out[cross+fade:] = y[cross+fade:]
        res = np.concatenate([x[:r0], out])
        return np.clip(res, -1, 1).astype(np.float32)

    def _sentence_pitch(self, segs, sentences):
        """Move the pitch BETWEEN sentences, on already-synthesised audio.

        Synthesising a whole reply in one call keeps its flow — that is what FLUID_CHARS
        buys, and going back to a call per sentence is what put an audible seam in it. The
        cost was that every sentence then starts on the same note, because _group collapses
        the reply to a single phrase and _pitch_shift has no i or n left to shape: measured
        at 0.00 semitones of sentence-to-sentence movement at EVERY value of `movement`,
        including 1.0. The knob was inert, and a voice that starts every sentence on the
        same note is the flat delivery voice.py calls the clearest robotic tell there is.

        So the contour is applied here instead, to the segments this function has already
        cut at the model's own sentence gaps. One synthesis call, no new seam, and
        `movement` becomes a live control again.

        The contour is normalised so its LOWEST sentence sits at exactly 1.0. Resampling
        below 1.0 stretches, and a stretched phrase is the drawl this codebase has fought
        twice; normalising upward means every segment is compressed or left alone, so the
        movement cannot bring it back. The duration that costs is handed back as room tone
        by the caller."""
        if self.movement <= 0 or len(segs) < 2:
            return segs
        rs = [self._pitch_shift(sen, i, len(sentences)) for i, sen in enumerate(sentences)]
        floor = min(rs)
        if floor <= 0:
            return segs
        return [self._resample(seg, r / floor).astype(np.float32) if abs(r / floor - 1) > 1e-4
                else seg for seg, r in zip(segs, rs)]

    # "HEY, …" IS A BEAT (owner, 2026-09-25: "when he says hey, have him pause like a person would,
    # the comma is there for a reason"). Only sentence ends were cut and given a pause, so the comma
    # after an opener got the model's own few milliseconds and "Hey, not much" ran together. An
    # opener word at the start of a sentence, followed by a comma, is now its own cut too — the
    # comma's tone is kept (it is not turned into a full stop), and the beat is a little shorter
    # than the one after "Hey."
    # ONLY THE OPENERS THAT SOUND RIGHT ON THEIR OWN (measured 2026-09-25). A lone word is said as
    # a whole stressed utterance — "Hey," swooped 12 semitones over 600 ms, the owner's "hAY" —
    # while inside a sentence it is level (about 2 semitones). With its stress marks dropped it is
    # level again: hey, hi and okay came out at 3.7-4.3 semitones and were heard back as themselves.
    # "well", "so", "yeah", "right" still swooped flat, and "hey there" was heard as "pay there",
    # so those keep running on as they always did.
    OPENER_COMMA = re.compile(r"(?:^|(?<=[.!?]\s))\s*(?:hey|hi),(?=\s+\S)", re.I)
    # the piece on its own, once split off ("Hey," / "Hey there,") — the pattern above needs text after it
    OPENER_PIECE = re.compile(r"(?:hey|hi),", re.I)
    COMMA_BEAT = 0.32
    # The ways to say it, each heard back as the word by the speech recogniser in at least one
    # voice (2026-09-25): lighter stress, or none, with or without the comma. WHICH is level
    # depends on the voice — the same "hˌA," was 2.6 semitones in his blend and 10.9 in bm_george
    # — so the choice is measured per voice, once, and cached (see _opener).
    OPENER_FORMS = {"hey": ("hˌA,", "hA.", "hˈA", "hA,"), "hi": ("hˌI,", "hI.", "hˈI", "hI,")}
    OPENER_SPEEDS = (1.15, 1.0, 0.85)
    OPENER_MS = (200, 460)     # a natural length for the word; outside it, a form is not a candidate
    _opener_cache = {}

    @staticmethod
    def _contour_st(a):
        """How far the pitch swoops across a word, in semitones (10th to 90th percentile of an
        autocorrelation track) — the measure that separates "hAY" from a level "hey"."""
        n, h = int(SR*0.04), int(SR*0.01)
        lo_lag, hi_lag = int(SR/300), int(SR/70)
        f = []
        for i in range(0, max(len(a) - n, 0), h):
            seg = a[i:i+n].astype(np.float64)
            if np.sqrt((seg**2).mean()) < 0.02:
                continue
            seg = seg - seg.mean()
            ac = np.correlate(seg, seg, "full")[len(seg)-1:]
            if ac[0] <= 0:
                continue
            lag = lo_lag + int(np.argmax(ac[lo_lag:hi_lag]))
            if ac[lag]/ac[0] >= 0.3:
                f.append(SR/lag)
        if len(f) < 4:
            return 99.0
        return float(12*np.log2(np.percentile(f, 90)/np.percentile(f, 10)))

    # WHERE "HEY" ENDS inside "Hey, not much," (2026-09-25). The model does not pause after it and
    # gives no word timings, so the words after it are said on their own and their loudness
    # pattern is slid along the whole phrase; the best match inside the time a spoken "Hey" takes
    # (200-450 ms) is where the next word starts, and the cut goes in the quietest frame beside it.
    # Checked against the speech recogniser on ten greetings: each cut heard as exactly "Hey"/"Hi"
    # and the rest as the words that follow, at the pitch "Hey" has in a sentence (~197 Hz, where
    # said alone it was ~160 and swooped).
    OPENER_CUT = (20, 45)          # frames of 10 ms after the voice starts: 200-450 ms
    # A LITTLE ENTHUSIASM (owner, 2026-09-25: "a little more enthusiasm on the hey"). The model
    # barely changes "Hey" for "Hey!" (measured: +4 Hz), so it is shaped the way a person pleased to
    # see you says it: higher. Said slower by `lift`, then resampled up by it, so the pitch rises
    # by OPENER_LIFT_ST and the length is kept. Measured: "Hey" 198 -> 224 Hz, 330-380 ms, and the
    # recogniser starts hearing it as "Hey!". 3.5 was "more" (~250 Hz); both are on the audition page.
    OPENER_LIFT_ST = 0.0        # OFF (owner, 2026-09-25: "still sounding robotic on the pitch"): a transpose is the robot tell
    OPENER_STRETCH = 1.0       # extra length on top; 1.08 made "Hey" half as long again (353 ms)

    def _opener_in_context(self, ph, nxt):
        """ "Hey," as said at the start of "Hey, <the next clause>", cut off from it. None if the
        cut cannot be found with confidence."""
        head = re.split(r"(?<=[,.!?])\s", (nxt or "").strip())[0]
        if not head:
            return None
        h = int(0.01*SR)
        env = lambda x: np.sqrt(np.convolve(x.astype(np.float64)**2, np.ones(h)/h, mode="same"))[::h]
        lift = 2 ** (self.OPENER_LIFT_ST / 12)
        slow = lift * self.OPENER_STRETCH                    # said this much slower, then resampled
        sp = self.base_speed / slow
        full = self._synth(f"{ph.strip()} {head}", sp)[0].astype(np.float32)
        alone = self._synth(head, sp)[0].astype(np.float32)
        ef, er = env(full), env(alone)
        r0 = int(np.argmax(er >= 0.004))
        probe = er[r0:r0 + 20]
        f0 = int(np.argmax(ef >= 0.004))
        if len(probe) < 10 or not probe.any():
            return None
        probe = probe / np.linalg.norm(probe)
        best, bk = -1.0, None
        lo, hi = int(self.OPENER_CUT[0] * slow), int(self.OPENER_CUT[1] * slow)   # said slower, so later
        for k in range(f0 + lo, min(f0 + hi, len(ef) - len(probe))):
            w = ef[k:k + len(probe)]
            n = np.linalg.norm(w)
            if n > 0:
                sc = float(np.dot(w / n, probe))
                if sc > best:
                    best, bk = sc, k
        if bk is None or best < 0.85:
            return None
        # WHERE TO CUT (owner, 2026-09-25: "hey is cut off too fast, like youre missing a bit of the
        # y"). Snapping to the quietest frame near the match cut some "Hey"s mid-glide: before "not"
        # the voice runs straight on, and the frame there was still at full loudness. Now: a real
        # silence at the boundary is cut at its END (the glide has finished); voice running straight
        # on is cut where it DROPS below half of the word's level, 20-80 ms on — never early. What
        # comes after the cut is thrown away (the rest is said on its own), so late costs nothing.
        # Recogniser check: 12/12 greetings heard back as exactly "Hey"/"Hi".
        gap = [i for i in range(max(bk - 4, f0 + 1), min(bk + 4, len(ef))) if ef[i] < 0.02]
        if gap:
            j = gap[-1]
        else:
            level = float(np.median(ef[f0:bk])) if bk > f0 else float(ef[bk])
            j = next((i for i in range(bk + 2, min(bk + 9, len(ef))) if ef[i] <= 0.5*level), bk + 4)
        a = full[:j*h].copy()
        if abs(lift - 1.0) > 1e-3:
            a = self._resample(a, lift)                          # up by `lift`: higher, and shorter by it
        f = min(len(a), int(0.045*SR))
        a[-f:] *= np.linspace(1, 0, f, dtype=np.float32)      # "Hey" dies away instead of stopping
        return a

    # CALM BUT ENTHUSIASTIC (owner, 2026-09-25: "hey still sounding robotic on the pitch — calm but
    # enthusiastic"). The 2-semitone lift was a transpose, which is the robot tell this house already
    # knew; it is off. The warmth now comes from the model itself: "Hey" is taken from a fixed phrase a
    # person says warmly, where it rises a little and settles — "Hey, glad you're here." measured
    # 190 -> 209 -> 199 Hz, where cut from "Hey, not much" it only rose (176 -> 205). What follows the
    # cut is thrown away and the real sentence is said on its own, so the phrase never has to match —
    # and because it is fixed, the "Hey" is made once per voice and cached.
    OPENER_CONTEXT = {"hey": ("Hey,", "glad you're here."), "hi": ("Hi,", "glad you're here.")}
    _context_cache = {}

    def _opener(self, ph, nxt=None):
        """ "Hey," on its own, said the way it is said INSIDE a sentence. Alone, the model says a
        word as a whole stressed utterance: "Hey," swooped 12 semitones over 600 ms — the owner's
        "hAY" — where inside a sentence it is level (about 2). So each form in OPENER_FORMS is said
        at each of OPENER_SPEEDS, and the most level one of a natural length is kept, per voice and
        per word; after the first time it is a lookup."""
        word = re.sub(r"[^a-z]", "", ph.lower())
        ctx = self.OPENER_CONTEXT.get(word)
        ckey = (str(self.voice), round(self.base_speed, 3), self.lang, word, ctx)
        got = Voice._context_cache.get(ckey)
        if got is None:
            try:
                got = self._opener_in_context(*ctx) if ctx else self._opener_in_context(ph, nxt)
            except Exception:
                got = None
            if got is not None and ctx:
                Voice._context_cache[ckey] = got
        if got is not None:
            return got.copy(), SR
        # the fallback: said alone, in the most level of the forms below, measured per voice
        word = re.sub(r"[^a-z]", "", ph.lower())
        key = (str(self.voice), round(self.base_speed, 3), self.lang, word)
        got = Voice._opener_cache.get(key)
        if got is None:
            best = None
            for form in self.OPENER_FORMS.get(word, ()):
                for k in self.OPENER_SPEEDS:
                    try:
                        a = self.k.create(form, voice=self.style, speed=self.base_speed*k, lang=self.lang,
                                          is_phonemes=True)[0].astype(np.float32)
                    except Exception:
                        continue
                    w = int(0.01*SR)
                    e = np.sqrt(np.convolve(a.astype(np.float64)**2, np.ones(w)/w, mode="same"))
                    idx = np.nonzero(e >= 0.015)[0]
                    ms = (idx[-1] - idx[0])*1000/SR if len(idx) else 0
                    if not (self.OPENER_MS[0] <= ms <= self.OPENER_MS[1]):
                        continue
                    score = self._contour_st(a[idx[0]:idx[-1]])
                    if best is None or score < best[0]:
                        best = (score, a)
            if best is None:                        # nothing natural came out: say it as written
                best = (0.0, self._synth(ph.strip(), self.base_speed)[0].astype(np.float32))
            # its own silence trimmed off, so the beat after it is COMMA_BEAT and nothing else
            a = best[1]
            w = int(0.01*SR)
            e = np.sqrt(np.convolve(a.astype(np.float64)**2, np.ones(w)/w, mode="same"))
            idx = np.nonzero(e >= 0.006)[0]
            if len(idx):
                a = a[max(0, idx[0] - int(0.02*SR)):min(len(a), idx[-1] + int(0.04*SR))].copy()
                f = min(len(a), int(0.02*SR))
                a[-f:] *= np.linspace(1, 0, f, dtype=np.float32)
            got = Voice._opener_cache[key] = a
        return got.copy(), SR

    def _split_openers(self, parts):
        """"Hey, not much" -> "Hey," + "not much": the opener is synthesised on its own, so the
        beat after it is placed BETWEEN two pieces and cannot land anywhere else. (The first try
        looked for it in the audio: the model leaves 10-60 ms there, sometimes too little to find,
        and the beat went in after "Hey, not" — heard by the owner, 2026-09-25.)"""
        out = []
        for ph in parts:
            pos = 0
            for m in self.OPENER_COMMA.finditer(ph):
                pre = ph[pos:m.start()].strip()
                if pre:
                    out.append(pre)
                out.append(ph[m.start():m.end()].strip())
                pos = m.end()
            rest = ph[pos:].strip()
            if rest:
                out.append(rest)
        return out

    def _sentence_pauses(self, a, text):
        n = len(re.findall(r"[.!?](?=\s+\S)", text))
        if n == 0 or len(a) < SR:
            # one sentence: nothing to split, but a lone question still needs to sound like one
            return self._question_tone(a) if text.rstrip().endswith("?") else a
        w = int(0.01*SR)
        e = np.sqrt(np.convolve(a.astype(np.float32)**2, np.ones(w)/w, mode="same"))
        quiet = e < 0.015
        runs, start = [], None
        edge = int(0.15*SR)                       # never at the very start or end
        for i in range(edge, len(a) - edge, w):
            if quiet[i] and start is None: start = i
            elif not quiet[i] and start is not None:
                if i - start >= int(0.06*SR): runs.append((i - start, start, i))
                start = None
        cuts = sorted(sorted(runs, reverse=True)[:n], key=lambda r: r[1])
        if not cuts:
            return a
        segs, prev, fade = [], 0, int(0.004*SR)
        for _, st, en in cuts:
            k = st + int(np.argmin(e[st:en]))     # the quietest point inside that gap
            segs.append(a[prev:k].astype(np.float32).copy()); prev = k
        segs.append(a[prev:].astype(np.float32).copy())
        # Every sentence is its own segment now, so a question put back to the user can be
        # delivered with some life in it ("What are you up to this morning?" sounded like a
        # form field). Only when every break was found, or segments and sentences would not
        # line up. r > 1 compresses rather than stretches, so this cannot bring the slur back.
        sentences = re.split(r"(?<=[.!?])\s+", text.strip())
        if len(sentences) == len(segs):
            for i, sen in enumerate(sentences):
                if sen.rstrip().endswith("?"):
                    segs[i] = self._question_tone(self._resample(segs[i], self.QUESTION_LIFT)) * self.QUESTION_GAIN
            segs = self._sentence_pitch(segs, sentences)
        out = []
        for i, seg in enumerate(segs):
            if i > 0 and len(seg) > fade: seg[:fade] *= np.linspace(0, 1, fade, dtype=np.float32)
            if i < len(segs) - 1:
                if len(seg) > fade: seg[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
                # An opener — "Hey." "Right." "Done." — is its own breath. phrases() carries
                # a one or two word sentence into the next phrase on purpose (alone it comes
                # out stiff), so the beat after it has to be made here or it never happens.
                short = len(sentences[i].split()) <= self.OPENER_WORDS if i < len(sentences) else False
                out += [seg, self._space(self.OPENER_BEAT if short else self.SENTENCE_PAUSE_S,
                                         seed=i + 3, ref=float(np.abs(seg).max()))]
            else:
                out.append(seg)
        joined = np.concatenate(out)
        lost = len(a) - len(joined) + int(SR*self.SENTENCE_PAUSE_S)*(len(segs)-1)
        if lost > 0:                      # compression above is paid back as room, not silence
            joined = np.concatenate([joined, self._room(lost)])
        return joined

    QUESTION_LIFT = 1.0       # off: the end-of-sentence rise carries the question now
    QUESTION_GAIN = 1.08      # a touch more present

    RASP_NOISE = 0.15

    def _rasp(self, a):
        """A little rasp. Two parts, both scaled by self.rasp:
        - breath noise band-limited to 700-3200 Hz, riding the voice's own loudness so it
          only exists while he is speaking and never hisses in the gaps. Kept below the
          4 kHz+ band on purpose: v and z already read as too hissy on this blend.
        - a gentle tanh saturation, which adds the low-order harmonics heard as grain."""
        if self.rasp <= 0 or len(a) < 256:
            return a
        from scipy.signal import butter, sosfilt
        x = a.astype(np.float32)
        env = np.sqrt(np.convolve(x**2, np.ones(240)/240, mode="same"))      # 10 ms loudness
        rng = np.random.default_rng(len(x))
        noise = sosfilt(butter(2, [700, 3200], btype="band", fs=SR, output="sos"),
                        rng.standard_normal(len(x))).astype(np.float32)
        noise /= (np.abs(noise).max() + 1e-9)
        # rasp is irregular, not steady hiss: flutter the noise at 25-60 Hz
        t = np.arange(len(x)) / SR
        flutter = 0.55 + 0.45*np.sin(2*np.pi*(38 + 14*np.sin(2*np.pi*0.7*t))*t)
        # 0.55 read as white noise at rasp 0.4 - the grain people want is mostly the
        # saturation below, so the noise is only a trace now.
        y = x + noise * env * flutter * (self.RASP_NOISE * self.rasp)
        k = 1.0 + 1.4*self.rasp
        return (np.tanh(k*y) / np.tanh(k)).astype(np.float32)

    _MISAKI = {}

    def _synth(self, text, speed):
        """One Kokoro call, through whichever phonemizer is configured."""
        if self.g2p == "misaki":
            key = "gb" if self.lang == "en-gb" else "us"
            g = Voice._MISAKI.get(key)
            if g is None:
                from misaki import en
                # A FALLBACK, because the failure without one is silence. misaki answers
                # `❓` for any word it has never seen and Kokoro then says nothing at all:
                # "dev" is not in its dictionary, so every "the dev server" this project has
                # ever spoken was "the — server", and an invented brand name ate the end of
                # the sentence ("I'm creating a new web project for", 2026-09-18). espeak
                # knows how to pronounce anything spelled in English. The gold entries in
                # lexicon.py still win, so the words we DO have an opinion about are
                # unaffected.
                fallback = None
                try:
                    from misaki import espeak as _espeak
                    fallback = _espeak.EspeakFallback(british=(key == "gb"))
                except Exception as e:
                    print(f"[voice] no espeak fallback ({type(e).__name__}); unknown words "
                          f"will be silent")
                g = Voice._MISAKI[key] = en.G2P(trf=False, british=(key == "gb"),
                                                fallback=fallback)
                # Teach it the words it does not know BEFORE the first synthesis. misaki
                # returns `❓` for an unknown word and Kokoro then guesses, which is how
                # "vite", "nginx", "redis" and six others were being said wrong even
                # though speakable.py had entries for them (2026-09-17).
                try:
                    import lexicon
                    lexicon.install(g)
                except Exception as e:
                    print(f"[voice] technical lexicon not loaded: {e}")
            # A word misaki does not know phonemises to `❓` and is then SILENT, which is how
            # an invented brand name ate the end of a sentence (2026-09-18). Split it into
            # the real words it is made of first.
            try:
                import lexicon as _lx
                text = _lx.repair(text, g)
            except Exception:
                pass
            phonemes, _ = g(text)
            if phonemes and phonemes.strip():
                return self.k.create(phonemes, voice=self.style, speed=speed, lang=self.lang, is_phonemes=True)
        return self.k.create(text, voice=self.style, speed=speed, lang=self.lang)

    # ---- synthesis --------------------------------------------------------
    def say(self, text, phrases=None):
        from speakable import speakable, phrases as split
        text = speakable(text)
        parts = self._split_openers(phrases or self._group(split(text)))
        if not parts:
            return np.zeros(0, dtype=np.float32), SR

        out = np.zeros(0, dtype=np.float32)
        n = len(parts)
        for i, ph in enumerate(parts):
            if self.OPENER_PIECE.fullmatch(ph.strip()):
                audio, sr = self._opener(ph, parts[i+1] if i < n - 1 else None)
                audio = self._rasp(audio)
                out = self._join(out, audio)
                if i < n - 1:
                    out = np.concatenate([out, self._space(self._gap(ph, parts[i+1]), seed=i,
                                                           ref=float(np.abs(audio).max()))])
                continue
            r = self._pitch_shift(ph, i, n)
            # synthesise slower by r, then resample by r: pitch moves, length does not
            audio, sr = self._synth(ph, self._synth_speed(ph, i, n, r))
            audio = self._resample(audio.astype(np.float32), r)
            audio = self._sentence_pauses(audio, ph)
            audio = self._rasp(audio)
            if len(ph.split()) <= self.SHORT_WORDS:      # no held vowel on a short line
                audio = self._tighten_tail(
                    audio, sr, self.TINY_TAIL_FLOOR if len(ph.split()) <= self.TINY_WORDS else None)
            out = self._join(out, audio)
            if i < n - 1:
                g = self._gap(ph, parts[i+1])
                out = np.concatenate([out, self._space(g, seed=i, ref=float(np.abs(audio).max()))])
        # a short tail so he does not stop dead on the last sample
        out = np.concatenate([out, self._room(int(SR*0.16))])
        return self._normalise(out), SR

    def stream(self, text):
        """Yield phrase by phrase so playback can start on the first one.
        Waiting for a whole paragraph before making a sound is most of what
        makes an assistant feel slow, regardless of the real synthesis time.

        say() normalises the whole utterance once. This used to normalise EVERY
        PHRASE to the same peak, which is not the same thing: peak is set by one
        transient, so a phrase carrying a hard plosive was scaled down against a
        smooth one and the delivery jumped in level between phrases for reasons
        that had nothing to do with emphasis. One gain is set from the first
        phrase and held for the rest, with a limiter to catch a later peak."""
        from speakable import speakable, phrases as split
        parts = self._split_openers(self._group(split(speakable(text))))
        n = len(parts)
        gain = None
        for i, ph in enumerate(parts):
            if self.OPENER_PIECE.fullmatch(ph.strip()):
                audio, sr = self._opener(ph, parts[i+1] if i < n - 1 else None)
            else:
                r = self._pitch_shift(ph, i, n)
                audio, sr = self._synth(ph, self._synth_speed(ph, i, n, r))
                audio = self._resample(audio.astype(np.float32), r)
                audio = self._sentence_pauses(audio, ph)
            audio = self._rasp(audio)
            if len(ph.split()) <= self.SHORT_WORDS and not self.OPENER_PIECE.fullmatch(ph.strip()):   # the live path, same rule
                audio = self._tighten_tail(
                    audio, sr, self.TINY_TAIL_FLOOR if len(ph.split()) <= self.TINY_WORDS else None)
            if i < n - 1:
                audio = np.concatenate([audio, self._space(self._gap(ph, parts[i+1]), seed=i,
                                           ref=float(np.abs(audio).max()))])
            peak = float(np.abs(audio).max()) if len(audio) else 0.0
            if gain is None:
                # a little below say()'s 0.82, so later phrases have room to be louder
                gain = (0.78/peak) if peak > 1e-6 else 1.0
            g = gain
            if peak*g > 0.96:            # catch a louder phrase instead of clipping it
                g = 0.96/peak
            yield np.clip(audio*g, -1.0, 1.0).astype(np.float32), sr

    @staticmethod
    def _normalise(a, peak=0.82):
        m = float(np.abs(a).max()) if len(a) else 0.0
        return a * (peak/m) if m > 1e-6 else a
