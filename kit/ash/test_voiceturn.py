#!/usr/bin/env python3
"""One spoken turn, RUN. Run: orb/daemon/.venv/bin/python orb/daemon/test_voiceturn.py

PLAN 18.1, ninth extraction. `Ashd.ask` builds the voice prompt, tries the quick answer,
picks the driver, runs the engine and retries on another seat — and until it moved into
`voiceturn.py` no suite had ever run it. `test_first_byte` FB.5/FB.6, `test_quick_answer`
Q.4 and `test_release_fixes` RF.3c read its TEXT, because importing `ashd` starts an audio
stack. A text check passes a method that raises `NameError` on its first spoken reply, and
that is exactly the failure a move produces: a name the old module had and the new one lacks.

`voiceturn` imports without the daemon, so this hands `ask` a stand-in daemon — a recorded
engine, seat table, ledger and speaker — and runs every path a person can hear:

  VT.1  a bare question is answered the quick way and no engine turn runs; a question with a
        page behind it skips the quick way; a stopped turn returns nothing
  VT.2  a route with no driver is SAID, and no engine turn runs (4.13-4.19)
  VT.3  a downgrade is spoken before the turn, once a day, and leaves the orb "thinking"
  VT.4  the engine command: stream-json, the healthy driver, `--continue` only within ten
        minutes of the last turn; the turn is remembered only once it has completed (22.3)
  VT.5  a stall retries on a seat that is neither the voice seat, the driver nor recently
        stalled, and every run leaves a ledger row (D319, D335)
  VT.6  an empty answer gets one retry on another seat, recorded as `retry="empty"`; two
        empties are the apology, never silence
  VT.7  a reply that is only the seat's reasoning is not spoken (D314)
  VT.8  a question about the present — and its follow-ups — goes to the engine, never to the
        quick way's memory; a timeless one still gets the quick way (D363)
  VT.9  the engine is told the spoken conversation it was not part of, and its answer joins
        it (D363)

  VT.0  CONTROL: the same checks, run against planted COPIES of voiceturn.py — the empty
        retry's ledger row dropped (D335's shape), the stall retry allowed back onto the
        seat that stalled, and `import speakable` deleted — must each go red. A suite that
        cannot see a missing import is the text check again.
"""
# ASH_TIER: product
# Loads voiceturn.py (and planted copies of it in a temp dir); the engine, the seats and the
# speaker are stand-ins. Writes only the temp dir.
import importlib.util
import shutil
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def load(path, name="voiceturn"):
    spec = importlib.util.spec_from_file_location(f"{name}_{abs(hash(str(path)))}", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.log = lambda *a, **k: None       # its log lines are the turn's, not the suite's
    return mod


class Daemon:
    """The attributes `voiceturn.ask` reads, and a record of what it did with them."""

    def __init__(self, *, quick="", route=None, runs=(), stalled=(), seat="bedrock-brain",
                 free=("cloud-brain", "free-flash25", "cf-brain"), last_turn=0.0):
        self.gen = 1
        self.last_turn = last_turn
        self.last_user_text = None
        self._quick = quick
        self._route = route or {"driver": "bedrock-brain", "say": "", "tier": "easy",
                                "source": "voice", "reason": "everyday"}
        self._runs = list(runs)           # what each engine run returns: (text, stalled)
        self._stalled = set(stalled)
        self._seat, self._free = seat, list(free)
        self.quick_asked, self.moments, self.said, self.cmds = [], 0, [], []
        self.ledger, self.noted, self.lessons = [], [], []

    def capture_lesson(self, text):
        self.lessons.append(text)

    def _quick_answer(self, prompt, text, gen):
        self.quick_asked.append(text)
        return self._quick

    def _one_moment(self, gen):
        self.moments += 1

    def turn_driver(self, text):
        return dict(self._route)

    def _healthy_driver(self, driver):
        return driver

    def speak(self, text, gen, then="idle"):
        self.said.append((text, then))

    def voice_seat(self):
        return self._seat

    def _free_stall_seats(self):
        return list(self._free)

    def _recently_stalled(self, seat):
        return seat in self._stalled

    def _note_stall(self, seat):
        self.noted.append(seat)

    def _run_turn(self, cmd, gen):
        self.cmds.append(list(cmd))
        text, stalled = self._runs.pop(0) if self._runs else ("", False)
        return {"text": text, "model": f"m{len(self.cmds)}"}, stalled, ""

    def _record_turn(self, seat, stalled, started, model=None, retry=""):
        self.ledger.append((seat, stalled, retry))


def models(cmds):
    """The seat each engine run was sent to — the LAST `--model`, which a retry appends."""
    out = []
    for c in cmds:
        idx = [i for i, a in enumerate(c) if a == "--model"]
        out.append(c[idx[-1] + 1] if idx else None)
    return out


def check(vt):
    """Every VT check against module `vt`; the failures, labelled. Nothing here may raise past
    the label: a copy that cannot run must report which check it broke, not end the suite."""
    bad = []

    def want(cond, label):
        if not cond:
            bad.append(label)

    def run(label, d, text, context=""):
        try:
            return vt.ask(d, text, d.gen, context)
        except Exception as e:
            bad.append(f"{label}: ask raised {type(e).__name__}: {e}")
            return None

    # VT.1 the quick way
    d = Daemon(quick="Seventeen.")
    r = run("VT.1a", d, "what is twelve plus five")
    want(r == "Seventeen." and d.cmds == [] and d.quick_asked == ["what is twelve plus five"],
         f"VT.1a a bare question is answered the quick way and no engine turn runs: {r!r} {d.cmds}")
    want(d.lessons == ["what is twelve plus five"], f"VT.1a ...and the lesson capture still sees it: {d.lessons}")
    d = Daemon(quick="Seventeen.", runs=[("The page says forty.", False)])
    r = run("VT.1b", d, "what does this say", context="[page: example]\n")
    want(r == "The page says forty." and d.quick_asked == [] and len(d.cmds) == 1,
         f"VT.1b a question with a page behind it goes to the engine, not the quick way: {r!r}")
    d = Daemon(quick="")
    d._quick_answer = lambda p, t, g: setattr(d, "gen", 2) or ""
    r = run("VT.1c", d, "what time is it")
    want(r == "" and d.cmds == [] and d.moments == 0,
         f"VT.1c a turn stopped while the quick way was asking returns nothing and runs nothing: {r!r}")
    d = Daemon(quick="", runs=[("Half past nine.", False)])
    r = run("VT.1d", d, "what time is it")
    want(r == "Half past nine." and d.moments == 1,
         f"VT.1d when the quick way has no answer, he says 'one moment' before the engine: {r!r} {d.moments}")

    # VT.2 no driver
    d = Daemon(route={"driver": "", "say": "That one waits for the free seat to wake up.",
                      "tier": "easy", "source": "voice", "reason": "asleep"})
    r = run("VT.2", d, "refactor the parser")
    want(r == "That one waits for the free seat to wake up." and d.cmds == [],
         f"VT.2 a route with no driver is said, and no engine turn runs: {r!r} {d.cmds}")

    # VT.3 a downgrade, once a day
    route = {"driver": "free-flash25", "say": "The good seat is busy, so a lighter one is answering.",
             "tier": "easy", "source": "voice", "reason": "downgrade"}
    d = Daemon(route=route, runs=[("Done.", False), ("Done again.", False)])
    run("VT.3", d, "rename the file", context="x")
    run("VT.3", d, "rename it back", context="x")
    want(d.said == [(route["say"], "thinking")],
         f"VT.3 a downgrade is spoken before the turn, once today, leaving the orb thinking: {d.said}")

    # VT.4 the command
    d = Daemon(runs=[("Fine.", False)], last_turn=0.0)
    run("VT.4", d, "how are you", context="x")
    c = d.cmds[0] if d.cmds else []
    want("-p" in c and c[c.index("-p") + 1].endswith("how are you") if "-p" in c else False,
         f"VT.4a the prompt ends with what was said: {c[:3]}")
    want(c[3:5] == ["--output-format", "stream-json"] and models(d.cmds) == ["bedrock-brain"]
         and "--continue" not in c,
         f"VT.4a stream-json, the healthy driver, and no --continue after a long gap: {c[3:]}")
    want(d.last_user_text == "how are you" and d.last_turn > time.time() - 5,
         f"VT.4b a completed turn is remembered: {d.last_user_text!r}")
    d = Daemon(runs=[("Sure.", False)], last_turn=time.time() - 60)
    run("VT.4c", d, "and tomorrow", context="x")
    want(d.cmds and "--continue" in d.cmds[0], "VT.4c a follow-up within ten minutes continues the conversation")
    d = Daemon(runs=[("late", False)])
    d._run_turn = (lambda cmd, gen, _r=d._run_turn: (setattr(d, "gen", 2), _r(cmd, gen))[1])
    r = run("VT.4d", d, "tell me a joke", context="x")
    want(r == "" and d.last_user_text is None,
         f"VT.4d a turn stopped while running is not spoken and not remembered (22.3): {r!r} {d.last_user_text!r}")

    # VT.5 the stall retry
    d = Daemon(runs=[("", True), ("", True), ("Twelve.", False)], stalled={"cloud-brain"},
               free=("bedrock-brain", "cloud-brain", "free-flash25", "cf-brain"))
    r = run("VT.5", d, "what is three times four", context="x")
    want(r == "Twelve." and models(d.cmds) == ["bedrock-brain", "free-flash25", "cf-brain"],
         f"VT.5a a stall retries on seats that are neither the voice seat, the driver nor recently "
         f"stalled, in order, until one answers: {r!r} {models(d.cmds)}")
    want([(s, st) for s, st, _ in d.ledger] == [("bedrock-brain", True), ("free-flash25", True),
                                               ("cf-brain", False)]
         and [x for *_, x in d.ledger] == ["", "stall", "stall"],
         f"VT.5b every run leaves its ledger row, the retries marked as stall retries: {d.ledger}")
    want(d.noted == ["bedrock-brain", "free-flash25"], f"VT.5c each stalled seat is noted: {d.noted}")

    # VT.6 the empty-answer retry
    d = Daemon(runs=[("", False), ("Paris.", False)], seat="bedrock-brain",
               free=("bedrock-brain", "cloud-brain"))
    r = run("VT.6", d, "capital of France", context="x")
    want(r == "Paris." and models(d.cmds) == ["bedrock-brain", "cloud-brain"],
         f"VT.6a an empty answer gets one retry on a seat other than the voice seat: {r!r} {models(d.cmds)}")
    want([x for *_, x in d.ledger] == ["", "empty"],
         f"VT.6b the empty retry leaves its own ledger row (D335): {d.ledger}")
    d = Daemon(runs=[("", False), ("", False)], free=("cloud-brain",))
    r = run("VT.6c", d, "capital of France", context="x")
    want(r == "Sorry, I couldn't get an answer just then." and len(d.cmds) == 2,
         f"VT.6c two empties are the apology, never silence: {r!r}")

    # VT.7 reasoning is not an answer
    d = Daemon(runs=[("I'm reviewing the system instructions, context, constraints and the user request.", False),
                     ("It's sunny.", False)], free=("cloud-brain",))
    r = run("VT.7", d, "is it sunny", context="x")
    want(r == "It's sunny." and len(d.cmds) == 2,
         f"VT.7 a reply that is only the seat's reasoning is not spoken; another seat answers: {r!r}")
    # VT.8 the present needs looking up (D363)
    d = Daemon(quick="Gallagher and Laine.", runs=[("Suzuki, Caufield, Slafkovsky, Hutson and Demidov.", False),
                                                   ("Those five are the top of it.", False)])
    r = run("VT.8a", d, "who are the canadiens best five players right now")
    want(r == "Suzuki, Caufield, Slafkovsky, Hutson and Demidov." and d.quick_asked == [] and len(d.cmds) == 1,
         f"VT.8a a question about the present skips the quick way (memory) for the engine: {r!r} {d.quick_asked}")
    r = run("VT.8b", d, "thats 3, i said 5 lol")
    want(d.quick_asked == [] and len(d.cmds) == 2,
         f"VT.8b ...and so does its follow-up, which never says 'now' again: {d.quick_asked} {len(d.cmds)}")
    d = Daemon(quick="Seventeen.")
    r = run("VT.8c", d, "what is twelve plus five")
    want(r == "Seventeen." and d.cmds == [],
         f"VT.8c CONTROL: a timeless question still gets the quick way: {r!r}")

    # VT.9 one conversation, not two (D363)
    import collections as _c
    d = Daemon(runs=[("Right — Suzuki and Caufield lead it.", False)])
    d._quick_hist = _c.deque([("tell me about the canadiens", "They're a storied old team.")], maxlen=4)
    d._quick_t = time.time()
    run("VT.9a", d, "nope, research it")
    p_ = d.cmds[0][d.cmds[0].index("-p") + 1] if d.cmds and "-p" in d.cmds[0] else ""
    want("They said: tell me about the canadiens" in p_ and "You said: They're a storied old team." in p_
         and p_.find("They said:") < p_.rfind("nope, research it"),
         f"VT.9a the engine turn is told the spoken conversation it was not part of, before the "
         f"question: {p_[-260:]!r}")
    want(list(d._quick_hist)[-1:] == [("nope, research it", "Right — Suzuki and Caufield lead it.")],
         f"VT.9b ...and its answer joins that conversation, so the next quick answer knows it: "
         f"{list(d._quick_hist)}")
    return bad


# ── VT.1-VT.7  the real module ─────────────────────────────────────────────────────────
import voiceturn  # noqa: E402
voiceturn.log = lambda *a, **k: None

ok(Path(voiceturn.__file__).resolve().parent == HERE,
   f"VT CONTROL: the voiceturn under test is this tree's ({voiceturn.__file__})")
FAIL.extend(check(voiceturn))

# ── VT.0  CONTROL: planted copies go red ───────────────────────────────────────────────
SRC = (HERE/"voiceturn.py").read_text()
PLANTS = {
    "the empty retry's ledger row dropped (D335)": (
        '                owner._record_turn(seat, _st2, _t_seat, model=r2.get("model"), retry="empty")\n',
        "", "VT.6b"),
    "the stall retry allowed back onto a seat that stalled": (
        "if s not in (primary, driver) and not owner._recently_stalled(s)]",
        "if s not in (primary,)]", "VT.5a"),
    "`import speakable` deleted": ("import speakable\n", "", "VT.1b"),
    "the present answered from memory (D363)": (
        "        if not now_q:\n            done = threading.Event()",
        "        if True:\n            done = threading.Event()", "VT.8a"),
    "the engine not told the conversation (D363)": (
        "    if earlier and prompt.endswith(", "    if False and prompt.endswith(", "VT.9a"),
    "engine answers not remembered (D363)": (
        "    _remember(owner, text, reply)\n    return reply\n", "    return reply\n", "VT.9b"),
}
_tmp = Path(tempfile.mkdtemp(prefix="vt0-"))
try:
    for i, (what, (old, new, expect)) in enumerate(PLANTS.items()):
        if old not in SRC:
            ok(False, f"VT.0 CONTROL: the code the '{what}' plant replaces has moved — update the plant")
            continue
        p = _tmp/f"plant{i}"/"voiceturn.py"
        p.parent.mkdir()
        p.write_text(SRC.replace(old, new, 1))
        try:
            got = check(load(p))
        except Exception as e:
            got = [f"load: {type(e).__name__}: {e}"]
        ok(any(g.startswith(expect) for g in got),
           f"VT.0 CONTROL: the plant '{what}' is caught by {expect} — a check that passes it "
           f"proves nothing: {got[:3]}")
finally:
    shutil.rmtree(_tmp, ignore_errors=True)

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print(f"✓ voice turn: ask() RUN on 9 groups against a stand-in daemon "
      f"(VT.0 control: {len(PLANTS)} planted copies each caught)")
