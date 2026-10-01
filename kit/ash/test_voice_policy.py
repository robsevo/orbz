#!/usr/bin/env python3
"""Register comes from the blend, never a transpose. Run: orb/daemon/.venv/bin/python orb/daemon/test_voice_policy.py

PLAN 11.8. The rule is the row's own headline and it was true when this suite was written —
`~/ash/voice/voice.json` carries a five-way weighted blend at `pitch: 1.0`. It was true
because somebody kept remembering it, which is the part this row fixes.

**The rule lived in prose, in a `do_not_regress` field inside the config it governs**, and
prose does not bind (CLAUDE.md §9.5). The same note is the evidence: it states that movement
is "held LOW at 0.22", then later that "0.55 was chosen as a measured, conservative step",
while the live file has carried **0.85** since 2026-09-19. Right when written, wrong twice
since, and nothing noticed either time. A rule that depends on being re-read is not a rule.

It is `voice.settings()` now, applied at the one place the config is read.

The second thing this found is worse than a stale sentence. The read site was:

    v = {}
    try: v = json.loads((CFG/"voice.json").read_text())
    except Exception: pass
    self.voice = Voice(voice=v.get("voice", "bm_lewis"), … movement=float(v.get("movement", 1.0)) …)

so **an unreadable voice.json silently swapped the five-way blend at movement 0.85 for a
single unblended `bm_lewis` at movement 1.0** — a different person's voice, with no log line,
and the `models ready` line went on printing the fallback name it had guessed rather than
what was built. A voice that quietly becomes a different voice is not a fallback (§9.6: fail
closed, and say so).

THE CONTROLS. "It refused the transpose" is also what a function that refuses everything
reports, and "it said so" is what a test with a broken recorder reports either way:
  - VP.0 requires the recorder to capture a line at all.
  - VP.2 requires a NEUTRAL pitch to pass silently, so VP.1 is a refusal and not a reflex.
  - VP.6 requires a good config to produce no fallback line, so VP.5 is detection.
  - **VP.3 is the conservative control**: today's real, shipped config must come through the
    policy completely unchanged. The ad and every recording were made on those numbers, and
    a policy that "corrects" one of them by accident would re-voice Ash silently — the exact
    class of failure it exists to prevent.
"""

# ASH_TIER: product
# Imports voice.py for one pure function and reads ~/ash/voice/voice.json. Loads no
# model, synthesises nothing, writes nothing.
import ast
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import voice as V                                                      # noqa: E402

LIVE = Path.home()/"ash/voice"/"voice.json"
FAILS = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'' if ok else '  — ' + str(detail)}")
    if not ok:
        FAILS.append(name)


def run(cfg):
    """settings() plus everything it said. The log is half of what is under test."""
    said = []
    out = V.settings(cfg, log=said.append)
    return out, said


def src(path, text=None):
    """Source with whole-line comments stripped — the fix is described verbatim in the
    comment above itself, and an unstripped scan reports the corrected file as broken. `text`
    stands in for the file when the caller already has the source (the daemon, read with its
    one-call delegates inlined — PLAN 18.1)."""
    return "\n".join(l for l in (Path(path).read_text() if text is None else text).splitlines()
                     if not l.lstrip().startswith("#"))


print("voice_policy")

# --------------------------------------------------------- VP.0  the recorder works
_, said0 = run({"voice": "a+b", "pitch": 1.9})
check("VP.0 CONTROL: the log recorder captures a line, or every \"and it says so\" below "
      "proves nothing", len(said0) >= 1, said0)

# ------------------------------------------- VP.1/VP.2  the transpose, refused and allowed
out1, said1 = run({"voice": "am_eric:9+bm_george:12", "pitch": 1.2})
check("VP.1a a pitch transpose is refused", out1["pitch"] == V.PITCH_NEUTRAL, out1["pitch"])
check("VP.1b ...and it is loud about why, naming the blend as the way to raise register",
      any("REFUSING" in m and "blend" in m for m in said1), said1)
out1b, _ = run({"voice": "a+b", "pitch": 0.8})
check("VP.1c a transpose DOWN is refused too — the damage is resampling, not direction",
      out1b["pitch"] == V.PITCH_NEUTRAL, out1b["pitch"])

out2, said2 = run({"voice": "am_eric:9+bm_george:12", "pitch": 1.0})
check("VP.2 CONTROL: a neutral pitch passes without complaint, so VP.1 is a refusal and not "
      "a function that rejects whatever it is given",
      out2["pitch"] == 1.0 and not any("REFUSING" in m for m in said2), said2)

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

# ------------------------------------------- VP.5/VP.6  a bad config is loud, not silent
for bad, label in (("not a dict", "a string"), (None, "null"), ([1, 2], "a list")):
    out5, said5 = run(bad)
    check(f"VP.5a {label} falls back to a usable voice and SAYS SO",
          out5["voice"] == V.DEFAULT_VOICE and any("falling back" in m for m in said5),
          (out5["voice"], said5))

out5b, said5b = run({"voice": "a+b", "movement": "quite a lot"})
check("VP.5b a number that is not a number is reported, not crashed on",
      out5b["movement"] == 1.0 and any("movement" in m for m in said5b), said5b)
out5c, said5c = run({})
check("VP.5c an EMPTY config still says the voice is not a blend — this is the shape the "
      "silent fallback took, and it must not be quiet",
      out5c["voice"] == V.DEFAULT_VOICE and any("not a blend" in m for m in said5c), said5c)

out6, said6 = run({"voice": "am_eric:9+bm_george:12", "speed": 1.12, "movement": 0.85,
                   "energy": 0.3, "rasp": 0.4, "lang": "en-us", "g2p": "misaki"})
check("VP.6 CONTROL: a good config produces no fallback line at all, so VP.5 is detection "
      "and not a function that complains about everything", said6 == [], said6)
check("VP.6b ...and every value it was given survives",
      (out6["speed"], out6["movement"], out6["rasp"], out6["g2p"]) == (1.12, 0.85, 0.4, "misaki"),
      out6)

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

# a real parse, not a substring: the policy must be the only thing that decides these
tree = ast.parse(Path(HERE/"voice.py").read_text())
fn = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "settings"), None)
check("VP.8 `settings` is a module-level function in voice.py, so the read site and any "
      "future one share it", fn is not None)

print(f"\n{'FAIL' if FAILS else 'PASS'}  voice_policy  ({len(FAILS)} failing)")
sys.exit(1 if FAILS else 0)
