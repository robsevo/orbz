#!/usr/bin/env python3
"""Speaking and listening for the app (PLAN 4.3_t, and 4.7_t: a real conversation): kit/orbs_kit/voicebox.py on the kit's own models
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


# ── PLAN 4.7_t, a real conversation ─────────────────────────────────────────────────────────────────
def b64(a):
    return base64.b64encode(vb._wav(a, 16000)).decode()


def k(text, voice):
    return vb._samples(clip(text, voice))


# VB.6 plain spoken English: the spec's own examples swapped, a long sentence split, two-job words left
said = vb.plain("Prior to commencing, ensure the reservoir is full. We will utilize approximately 10 litres in order to start. However, the pump requires an additional check.")
ok(said == "Before starting, make sure the reservoir is full. We will use about 10 litres to start. But the pump needs another check.", f"VB.6 the spec's plain words: {said!r}")
long = ("I looked through your calendar for the whole of next week and found that Tuesday is busy with three meetings, "
        "and Wednesday is completely free apart from a dentist appointment in the morning at nine.")
parts = [s for s in vb.plain(long).split(". ") if s]
ok(len(parts) >= 2 and all(len(s.split()) <= vb.LONGEST_WORDS for s in parts), f"VB.6 a {len(long.split())}-word sentence said in sentences of at most {vb.LONGEST_WORDS}: {[len(s.split()) for s in parts]}")
ok(vb.plain("The additional cost is fine; it is therefore true.") == "The additional cost is fine; it is therefore true.", "VB.6 CONTROL: a word with two jobs is left as written")
ok(any("Before starting" in p for p in vb.phrases("Prior to commencing, check the pump.", "ash")), "VB.6 what he says aloud is the plain version")

# VB.7 what he hears while he speaks, as rates over voices
SAYING = "Two and two make four, as they always have. Now let me check something else for you, which will take a little while."
kinds = {t: [vb.overlap(b64(k(t, v)), "Hazel", SAYING)["kind"] for v in VOICES] for t in ("Mhm.", "Yeah.", "Right.", "Uh-huh.", "Wait, what about Tuesday?", "Hold on, I need the other file.", "Can you check the weather for Saturday instead?", "Two and two make four, as they always have.")}
print(f"  overlap: { {t: ks for t, ks in kinds.items()} }")
back = [x == "backchannel" for t in ("Mhm.", "Yeah.", "Right.", "Uh-huh.") for x in kinds[t]]
stop = [x == "interrupt" for t in ("Wait, what about Tuesday?", "Hold on, I need the other file.", "Can you check the weather for Saturday instead?") for x in kinds[t]]
echo = kinds["Two and two make four, as they always have."]
ok(sum(back) / len(back) >= 0.85, f"VB.7 an 'mhm' over him keeps him going: {sum(back)}/{len(back)} (needs 85%)")
ok(sum(stop) >= len(stop) - 1, f"VB.7 a sentence over him stops him: {sum(stop)}/{len(stop)}")
ok("interrupt" not in echo, f"VB.7 his own words back through the microphone never stop him: {echo}")
HOLD = "Hold on, I am checking your calendar for tomorrow now."
held = [vb.overlap(b64(k(HOLD, v)), "Hazel", HOLD)["kind"] for v in VOICES]
ok("interrupt" not in held, f"VB.7 not even his own 'hold on': {held}")
ok(vb.overlap(b64(np.zeros(16000, np.float32)), "Hazel", SAYING)["kind"] == "nothing", "VB.7 CONTROL: silence is nothing")

# VB.8 patience: words that trail hold the turn open however finished they sound; a whole one ends it
pause = np.zeros(int(0.4 * 16000), np.float32)
# the rule, word by word: a weak last word or Whisper's "..." holds; a question may end on a
# preposition, never on "and" or "the"; a word that ends statements never holds
TRAILS = {"I want to book a table for.": True, "I want to book a table for...": True, "Can you send the report to Sam and?": True, "Let me see. Um.": True,
          "I was thinking about the": True, "What is it for?": False, "I think so.": False, "Turn the lights on.": False, "I'd love to.": False,
          "Hey Hazel, what is 2 and 2?": False}
ok(all(vb._trails(t) is want for t, want in TRAILS.items()), f"VB.8 what trails off: {[t for t, w in TRAILS.items() if vb._trails(t) is not w] or 'all as expected'}")
# and on Kokoro's voices: Whisper hears a fragment's trailing vowel as a word a third of the time
# ("a table for her", "put it in mind", 10-03), which real speech does not do, so this is a rate
frags = ("I want to book a table for", "I was thinking about the", "Can you send the report to Sam and")
trail = [vb.turn(b64(np.concatenate([k(f, v), pause])), "Hazel") for f in frags for v in VOICES]
whole = [vb.turn(b64(np.concatenate([k("Can you book me a table for two at seven tonight?", v), pause])), "Hazel") for v in VOICES]
print(f"  trailing: {[t['words'] for t in trail]}")
ok(all(t["hold"] == vb._trails(t["words"]) and not (t["hold"] and t["finished"]) for t in trail + whole), "VB.8 a turn whose words trail is held, never finished")
ok(sum(t["hold"] for t in trail) / len(trail) >= 0.5, f"VB.8 a thought still going holds the turn open: {sum(t['hold'] for t in trail)}/{len(trail)} fragments (needs half)")
ok(sum(t["finished"] for t in whole) >= 5 and all("table" in t["words"].lower() for t in whole), f"VB.8 a whole sentence ends the turn, its words in the same answer: {sum(t['finished'] for t in whole)}/6")

# VB.9 didn't catch that: speech Whisper turns into fluent nonsense (the same lines played backwards)
# is doubted; clear speech never is; its phantoms are not words
rev = [vb.hear(b64(k(t, v)[::-1].copy()), "Hazel")["unsure"] for v in VOICES for t in ("What is on my calendar today and tomorrow?", "Can you book me a table for two at seven tonight?")]
clear = [vb.hear(b64(k(t, v)), "Hazel")["unsure"] for v in VOICES for t in ("What is on my calendar today and tomorrow?", "Send the invoice to Sam before Friday.", "And three and three?", "What is two and two?")]
ok(sum(rev) >= len(rev) - 1, f"VB.9 garbled speech is doubted: {sum(rev)}/{len(rev)}")
ok(sum(clear) == 0, f"VB.9 clear speech is never doubted: {sum(clear)}/{len(clear)}")
ok(all(vb.PHANTOMS.match(t) for t in ("Thanks for watching!", "Thank you for watching.", "A conversation with Hazel.", "you")) and not vb.PHANTOMS.match("Thank you, Hazel."), "VB.9 Whisper's phantoms, and a real thank-you is not one")

print("ALL PASS" if not FAIL else f"{len(FAIL)} FAILED")
sys.exit(1 if FAIL else 0)
