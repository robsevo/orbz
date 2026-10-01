#!/usr/bin/env python3
"""
ashd - Ash's voice loop.  "hey ash" -> listen -> understand -> answer -> speak.

  idle       the wake model runs on every 80 ms mic frame
  listening  after a wake: record until ~1.4 s of silence follows speech.
             After he answers, the mic stays open for a follow-up (ashd-prefs
             `follow_up`, default 8 s) so a conversation needs no "hey ash" per
             sentence; silence for that long drops back to idle.
  thinking   faster-whisper transcribes; control phrases (commands.json) are
             handled here and never cost a model turn; anything else is one
             headless `ash -p` turn on the ~/.sergio-voice profile
  speaking   voice.py streams the reply phrase by phrase into pw-play

A request that mentions the terminal, linking, the screen or narration is split
into steps by one quick router call (plan_request) and run together: terminal
work is typed into a term.py terminal while the voice loop stays free.

Saying "hey ash" while he is thinking or speaking cuts him off and listens
again. State goes to ~/.sergio-voice/wake-state.json, which the orb watches
(same file contract as pair.py), so orb and daemon start in any order.

The mic is `pw-record`. With no microphone connected it retries every 5 s, so
plugging one in later just works. CPU only by design: the RX 580 in this box
falls off the PCIe bus under sustained load.

  ashd.py                        run the loop on the default microphone
  ashd.py --wav a.wav b.wav      feed 16 kHz wavs instead of the mic (testing)
  ashd.py --play-to out.wav      write his replies to a wav instead of speakers
  ashd.py --stt small.en         a bigger whisper (slower, more accurate)
"""
import uuid
import argparse, fcntl, json, os, queue, random, re, shutil, signal, subprocess, sys, threading, time, wave
from datetime import datetime
from pathlib import Path
import numpy as np

HERE  = Path(__file__).parent
import statepaths  # noqa: E402 — PLAN 5.9: one root, and ASH_STATE_HOME moves it
CFG   = statepaths.config()
STATE = CFG/"wake-state.json"
PREFS = CFG/"ashd-prefs.json"
_PREFS_LOCK = PREFS.with_suffix(".lock")   # 11.4_t: one writer at a time through the RMW
CONTROL = CFG/"ashd-control.json"                   # {"asleep": bool} - the orb's double-click
SPEECH_LOCK = CFG/"speech.lock"                # one voice at a time, across every process that talks
SAY_DIR = CFG/"say-queue"                       # pair.py drops his terminal replies and narration here; ashd voices them
sys.path.insert(0, str(HERE))
import workboard
import troubleshoot
import speakable
# "Summarise this page", "what's on the page I'm looking at", "read this article".
PAGE_RE = re.compile(r"\b(this|the|that|my|current|open)\s+(web ?page|page|site|website|article|tab|doc|docs|"
                     r"documentation|post|guide|link)\b|\bwhat i'?m (looking at|reading|on)\b|"
                     r"\b(summari[sz]e|read) (this|it|that)\b", re.I)
# "Teach me that", "walk me through it", "tutorial mode", "I need clarification on that step".
LESSON_RE = re.compile(r"\b(teach me|walk me through|tutor(ial)? mode|tutor me|show me how|"
                       r"step by step|go through (it|this|that) with me|clarif(y|ication))\b", re.I)
SAY_VERBATIM = re.compile(r"^\s*(?:say|repeat after me)\s*[:\-\u2014]\s*(.+)$", re.I | re.S)
TASKLIST_RE = re.compile(r"\b(start|make|create|begin|new|set up|open)\b.{0,25}\b(task ?list|tasks list|to-?do list|list of tasks)\b", re.I)


PARENT = os.getppid() if os.environ.get("ASHD_EXIT_WITH_PARENT") else None


# A permission request younger than this is still worth asking after a restart: the hook
# that wrote it waits ASHD_ASK_TIMEOUT (75 s) for an answer file.
ASK_INFLIGHT_S = 70.0

def orphaned():
    """Started by the orb and the orb is gone (checked per frame AND while waiting for a mic)."""
    return PARENT is not None and os.getppid() != PARENT


import common                       # noqa: E402 — bind() and the shared log
from common import log  # one log for every module (D25)


# The desktop's condition, computed ONCE. `gui_env.probe` reads environment variables and
# stats one path, but `write_state` runs on every frame-ish and three threads, and a
# capability report that changes mid-session would be a lie anyway: these variables are
# inherited at exec and do not change under a running process (PLAN 7.4).
_GUI = None


def gui_condition():
    global _GUI
    if _GUI is None:
        try:
            import gui_env
            _GUI = gui_env.summary()
        except Exception as e:
            _GUI = {"degraded": ["unknown"], "ok": False,
                    "say": "", "error": f"{type(e).__name__}: {e}"}
    return _GUI


def write_state(**st):
    st["t"] = time.time()
    # 7.4 — the orb reads this file, so a degraded desktop is VISIBLE there and not only in
    # a log nobody opens. Hard rule 6: fail closed and say so, in both channels.
    #
    # WRAPPED, and not for tidiness. This function is how the orb learns anything at all
    # about the daemon; a state write that fails because an ANNOTATION could not be computed
    # would trade the whole channel for a nicety. The annotation is best-effort, the write
    # is not.
    try:
        g = gui_condition()
        if not g.get("ok"):
            st.setdefault("degraded", g.get("degraded"))
    except Exception:
        pass
    # A UNIQUE tmp per write: write_state is called from several threads (the main
    # loop, _say_loop, _speak's envelope updates), and a shared "*.json.tmp" name
    # made two concurrent writers race - one renamed the tmp the other was about to
    # rename, raising FileNotFoundError mid-turn (seen 2026-09-15). pid+thread id
    # keeps each writer's tmp its own; the final os.replace is atomic per file.
    tmp = STATE.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        # 2.2: stamp who wrote it, so write_guard can tell the live daemon from a suite.
        # Resolved HERE, not at module scope: test_verify H.2 lifts this function out and
        # runs it alone, where a module-level name does not exist, and a write that raised
        # NameError there was a write that did not happen. Fail-safe: no stamp, never no write.
        try:
            from writer_stamp import stamped as _stamp_it
        except Exception:
            _stamp_it = lambda d: d
        tmp.write_text(json.dumps(_stamp_it(st)))
        os.replace(tmp, STATE)
    except OSError:
        try: tmp.unlink(missing_ok=True)
        except OSError: pass


# ============================================================ his voice, for the orb
ENV_HZ = 30
PLAY_LATENCY = 0.08          # pw-play buffer: audio written now is heard about this much later


def envelope(audio, sr):
    """Loudness at ENV_HZ, 0..1, so the orb can move on his syllables. Fixed
    reference (measured on bm_lewis: voiced frames p50 0.06, p90 0.18 RMS) rather
    than per-phrase, so the pause between phrases stays still instead of being
    normalised up into motion."""
    n = sr // ENV_HZ
    k = len(audio) // n
    if k == 0: return []
    rms = np.sqrt((audio[:k*n].astype(np.float32).reshape(k, n)**2).mean(1))
    return [round(float(v), 2) for v in np.clip(rms/0.20, 0, 1)**0.7]


# ---- 11.6  the listening windows, named ------------------------------------------------
# These were four inline numbers. They are not arbitrary and they are not interchangeable,
# so they are named where they can be read together and tested:
#
#   WAKE_WINDOW_S      after "hey ash", you have this long to START talking. Short on
#                      purpose: a wake that mishears leaves the mic open, and a mic open
#                      for no reason is the thing a person notices and resents.
#   FOLLOWUP_WINDOW_S  after HE answers, the mic reopens for this long so a conversation
#                      needs no wake word per sentence. Longer, because you are thinking
#                      about what he just said. Overridable per user via ashd-prefs
#                      `follow_up`; the constant is the default, not a ceiling.
#   DIALOG_WINDOW_S    a FLOOR, not a window: mid-dialog he is often waiting for a task,
#                      and composing one takes longer than reacting to a sentence. Applied
#                      with max(), so a user who set a longer follow_up keeps theirs.
#   SELF_HEAR_DEAF_S   the first fraction of a follow-up is ignored, because the tail of
#                      his own voice is still in the room and the mic would take it as
#                      yours. Only on a follow-up: after a wake, nothing has been spoken.
WAKE_WINDOW_S = 5.0
FOLLOWUP_WINDOW_S = 8.0
DIALOG_WINDOW_S = 15.0
SELF_HEAR_DEAF_S = 0.4

# ============================================================ audio in
# Moved to `micaudio.py` (18.1). `FRAME` lives there now and is imported above, so the
# 80 ms frame size has one definition instead of three. Re-exported by NAME: the import
# line IS the list of what came out, and `chaincheck` calls `ashd.named_source()`.
from micaudio import FRAME, FRAME_S, named_source, mic_frames, wav_frames  # noqa: E402,F401




# ============================================================ commands
def norm(s):
    s = s.lower().replace("’", "'")
    s = re.sub(r"[^a-z' ]+", " ", s)
    s = re.sub(r"^\s*(hey|hi|okay|ok)?\s*(ash|asher|ashe)\b", " ", s)   # the wake phrase leaking into the text
    s = re.sub(r"\b(please|the|can you|could you|now)\b", " ", s)      # filler, dropped from phrase AND utterance
    return re.sub(r"\s+", " ", s).strip()


# D311: a whole utterance that only acknowledges. Never "yes", "no" or "sure": those answer.
ACKNOWLEDGEMENTS = frozenset({"alright", "all right", "ok", "okay", "thanks", "thank you",
                              "thanks ash", "got it", "cool", "great", "nice", "perfect",
                              "awesome", "nice one"})


def is_bare_acknowledgement(text, last_said=""):
    """True when `text` is only a thanks/ok AND Ash's last line asked nothing (see handle)."""
    return norm(text) in ACKNOWLEDGEMENTS and not str(last_said or "").rstrip().endswith("?")


# D304: what advances a lesson while one is running, and ONLY then (see `handle`).
LESSON_NEXT_WORDS = frozenset({"next", "next one", "go on"})


class Commands:
    """commands.json phrases. One-word phrases must be the WHOLE utterance, so
    'stop' matches "stop" but not "how do I stop a docker container"."""
    def __init__(self, path):
        raw = json.loads(Path(path).read_text())
        self.table = []
        for key, c in raw.items():
            if key.startswith("_"): continue
            for ph in c["phrases"]:
                self.table.append((norm(ph), key, c))
        self.table.sort(key=lambda r: -len(r[0]))

    def match(self, text):
        u = norm(text)
        if not u: return None
        for ph, key, c in self.table:
            if u == ph: return key, c
            if " " in ph and ph in u and len(u.split()) <= len(ph.split()) + 2:
                return key, c
        return None


# ============================================================ the terminal
# Moved to terminal.py (D25). Every name is re-imported so nothing that uses ashd.<name>
# notices; to PATCH one in a test, patch it on `terminal`, where its callers look it up.
import adapters  # noqa: E402
import redact  # noqa: E402
import terminal  # noqa: E402  — also bound as a module, for _script_suffix()
from terminal import (  # noqa: E402,F401
    ash_terminal_open,
    terminal_inbox_open,
    send_to_terminal,
    interrupt_terminal,
    open_ash_terminal,
    _is_term_py,
    term_pids,
    _is_pair_py,
    pair_pids,
    reap_orphan_pairs,
    term_running,
    wait_for_term,
    console_window_count,
    place_console_with_orb,
    kill_terms,
    reap_orphan_terms,
    settle_terminal,
    close_console_corpse,
    TERM_INBOX,
    TERM_INTERRUPT,
    SESSION_DIR,
    WORKSPACE,
)


# ============================================================ several things at once
# "open ash cli, link to it, build X, and open vscode while you're at it" is four
# requests in one breath. commands.json only matches a sentence that IS a command,
# so anything that mentions the terminal / linking / VS Code / narration is split
# into steps by one quick router call, and the steps run together.
# ── "is this work?" lives in `work` now (PLAN 18.1) ──────────────────────────────────────
# By NAME, as `asking` and `micaudio` do it: the import line is the list of what moved.
from work import QUESTION_RE, WORK_RE, is_work  # noqa: E402,F401


CUES = re.compile(r"\b(terminal|cli|command line|link|linked|connect|pair|vs ?code|visual|narrat\w*|"
                  r"show (me|us) what)\b", re.I)
PLANNER_SEATS = ("free-flash25", "free-flash")
PLANNER = """You split one spoken request to Ash into the steps the person ACTUALLY asked for. Ash is a voice
assistant who also runs as a coding agent in a terminal.

Possible steps:
  terminal     open Ash's command-line session (the CLI / terminal)
  link         link / connect / pair the voice orb to the terminal session
  visual       put the work on screen: his terminal on the left, the page on the right
  narrate      read his actions aloud as he works
  unlink, visual_off, narrate_off    only when they ask to stop one of those
  task         work for the terminal Ash: code, files, commands. "text" = a clear instruction keeping every detail.
  ask          something to answer out loud instead (a question, conversation). "text" = the question

Rules: include a step ONLY if the person asked for it. Never add narrate, unlink or any *_off step unless those
words were said. Most requests are 1-4 steps. The text is a speech transcript and may start with "hey ash";
ignore filler like "while you're doing that".

Examples:
"hey ash link up" -> {"steps": [{"do": "link"}], "task_name": ""}
"open the terminal and write a hello world in rust, and show me in vs code" ->
  {"steps": [{"do": "terminal"}, {"do": "task", "text": "Write a hello world program in Rust."}, {"do": "visual"}], "task_name": "the Rust hello world"}
"stop narrating and what time is it in Tokyo" ->
  {"steps": [{"do": "narrate_off"}, {"do": "ask", "text": "What time is it in Tokyo?"}], "task_name": ""}

Reply with JSON only: {"steps": [{"do": ...}, ...], "task_name": "<short noun phrase for the terminal task(s) only, or empty>"}"""


def plan_request(text, timeout=15):
    """Plan a spoken request. Free-only: planning happens on every task list, so it is
    exactly the traffic that must never quietly become spend (PLAN 4.1/4.4)."""
    import seatbroker
    body = {"temperature": 0, "max_tokens": 600,
            "messages": [{"role": "system", "content": PLANNER},
                         {"role": "user", "content": text}]}
    try:
        # rate_wait: a spoken request is waiting on this. A short pause can outlast a
        # per-minute limit; a long one is dead air, and the rules-only fallback (D280) exists.
        alias, served, out = seatbroker.call(PLANNER_SEATS, body, purpose="planner",
                                             timeout=timeout, free_only=True, rate_wait=8)
        plan = json.loads(out[out.index("{"):out.rindex("}") + 1])
        steps = [st for st in plan.get("steps", []) if isinstance(st, dict) and st.get("do")]
        if steps:
            return {"steps": steps, "task_name": str(plan.get("task_name") or "").strip()}
    except seatbroker.Denied as e:
        log(f"planner: {e}")
    except Exception as e:
        # `seat` used to be the loop variable here. Removing the loop left this line
        # referring to a name that no longer exists — a NameError that would only have
        # fired when the planner ALREADY failed, i.e. exactly when the log matters.
        log(f"planner: {type(e).__name__}: {e}")
    return None


# WHEN THE PLANNER IS DOWN, A COMMAND IS STILL A COMMAND (D280). "open the terminal and link
# up", typed while every free seat was timing out: the planner returned nothing, the line has no
# work verb so `is_work` let it through, and it went to `ask` — 105 s later he read his own
# reasoning preamble aloud ("I'm reviewing the system instructions…") and opened nothing.
# These rules run ONLY when the planner failed, never instead of it, and only for a line that
# is nothing BUT control phrases: anything left over might be a task, and a task the rules
# half-read is worse than one sent on to `is_work` whole.
CONTROL_STEPS = (
    ("unlink",      re.compile(r"\b(unlink|disconnect|unpair)\b", re.I)),
    ("narrate_off", re.compile(r"\b(stop|quit|no more|don'?t keep) narrat\w*", re.I)),
    ("terminal",    re.compile(r"\b(open|start|launch|bring up|pull up|fire up)\b(\s+(up|the|a|your|my))*"
                               r"\s+(terminal|cli|command line)\b", re.I)),
    ("link",        re.compile(r"\b(link|connect|pair)(\s+(it|them|us|up|together))*\b", re.I)),
    ("narrate",     re.compile(r"\bnarrat\w*(\s+(it|that|as you go))?", re.I)),
)
CONTROL_FILLER = re.compile(
    r"\b(hey|ok|okay|ash|please|and|then|also|the|it|up|can|could|would|will|you|go|ahead|to|"
    r"now|for|me|just|your|my|too|as|well)\b|[^\w\s]", re.I)


def control_plan(text):
    """The planner's steps for a pure control line, from rules. None if anything else is in it."""
    rest, found = text or "", set()
    for do, pat in CONTROL_STEPS:
        if pat.search(rest):
            found.add(do)
            rest = pat.sub(" ", rest)
    if not found or CONTROL_FILLER.sub(" ", rest).split():
        return None
    order = [do for do, _ in CONTROL_STEPS if do in found]
    order.sort(key=lambda d: d != "terminal")          # the terminal exists before it is linked
    return {"steps": [{"do": d} for d in order], "task_name": ""}


# He announces the finish, then re-checks it and announces it again - four times in
# 48 seconds on 2026-09-15 ("I have finished…", curl 200, "I've completed…", curl
# 200, "The landing page is built…"), each one spoken aloud. The wordings differ
# enough to slip past near-duplicate dedup, so they are caught by what they ARE: a
# completion. The first one is his; the rest are noise.
_DONE_RE = re.compile(r"\b(i(?:'ve| have)? (?:finished|completed|built|done)|"
                      r"(?:is|are) (?:finished|complete|completed|done|built|ready|live|running)|"
                      r"finished (?:building|the)|hope you like|feel free to (?:navigate|explore)|"
                      r"let me know if you need anything)\b", re.I)
DONE_QUIET = 240.0        # after a finish, later finishes are silent for this long


def is_completion(text):
    return bool(_DONE_RE.search(text or ""))


# ============================================================ is the good seat alive?
# On 2026-09-15 the first turn of a build 429'd - "generate_content_free_tier_requests,
# limit: 20, model: gemini-3.6-flash" on every one of the ten keys - and the run fell
# down the fallback spine to pro-coder, a LITE model. Nobody was told. The user watched
# a lite model install the same package five times, write Tailwind v3 directives into a
# v4 project, and announce a dead server as running, with the status line quietly
# reading pro-coder instead of bedrock-brain.
#
# The seat is the single biggest lever on quality (see the seat notes in memory), so
# when the strong one is out of quota the user should hear it BEFORE a build, not work
# it out from the result. The probe is one token with fallbacks disabled: if the strong
# seat is dead it fails immediately and costs nothing, and if it is alive it costs one
# of that model's requests, which is why the answer is cached for an hour.
SEAT_PROBE_TTL = 3600.0
SEAT_DOWN_TTL = 600.0       # a seat judged down is re-probed in ten minutes, not in an hour
_seat_probe = {"t": 0.0, "ok": True}


def strong_seat_alive(model=None, timeout=12, tries=3):
    """True when the configured seat itself answers (no fallback). Cached.

    A 429 is not "out of quota", it is "this key is busy this minute". The seat is ten Google
    projects at 8 requests a minute each, and one probe hits one of them: measured 4 of 8
    back-to-back probes returning 429 while every real request was being served. Believing a
    single one of those made him announce "the strong models are out of quota for today" out loud
    during a recording (2026-09-17), which was simply untrue. So the probe retries, only a seat
    that fails EVERY try counts as down, and a down verdict is remembered for minutes rather than
    an hour so it can come back on its own."""
    now = time.time()
    ttl = SEAT_PROBE_TTL if _seat_probe.get("ok", True) else SEAT_DOWN_TTL
    if now - _seat_probe["t"] < ttl:
        return _seat_probe["ok"]
    import seatbroker
    seat = model or _configured_seat()
    # A HEALTH PROBE IS A REAL REQUEST. It is one token, but on a paid alias it is one token
    # of spend, every SEAT_PROBE_TTL, forever, with nobody asked (PLAN 4.4). Today the
    # configured seat is `bedrock-brain`, which classifies free — but the seat is a setting,
    # and the day it points at a paid alias the probe must go quiet, not quietly bill.
    if seatbroker.classify(seat) != "free":
        log(f"seat probe skipped: {seat} is not a free seat, and a probe is not worth spending on")
        _seat_probe.update(t=now, ok=True)      # unknown, not down: never block the work
        return True
    # THROUGH THE BROKER (4.1: it is the sole route for model traffic). This used to build
    # its own /chat/completions request, which spent nothing it should not — the classify
    # above sees to that — but left no SeatDecision row, so a probe was model traffic that
    # the ledger 4.12 reconciles against a bill could not see at all. Raised by Codex's
    # verification, 2026-09-20.
    #
    # The retry policy stays HERE, not in the broker: it is about what a probe MEANS. A 429
    # is "this key is busy this minute", not "out of quota", and believing one made him
    # announce the strong models were gone for the day, out loud, during a recording.
    body = {"max_tokens": 1, "temperature": 0,
            "messages": [{"role": "user", "content": "hi"}]}
    ok, why = False, ""
    for attempt in range(max(1, tries)):
        if attempt:
            time.sleep(2.0)                 # a per-minute limit clears on its own
        try:
            seatbroker.call([seat], body, purpose="seat health", free_only=True,
                            timeout=timeout, rate_wait=0)   # a probe never waits; the loop above retries
            ok = True
        except Exception as e:
            ok = False
            why = f"{type(e).__name__}: {str(e)[:120]}"
        if ok:
            break
    if not ok:
        log(f"seat probe {seat}: down after {tries} tries ({why})")
    _seat_probe.update(t=time.time(), ok=ok)
    return ok


def _configured_seat():
    for home in (os.environ.get("SERGE_HOME"), statepaths.config(), Path.home()/".sergio"):
        if not home: continue
        try:
            m = json.loads((Path(home)/"settings.json").read_text()).get("model")
            if m: return m
        except Exception:
            continue
    return "bedrock-brain"


def _seatbroker():
    """Imported at call time. The daemon must start on a machine whose router is down, and
    an import at module scope makes a broken seat table a daemon that will not boot."""
    import seatbroker
    return seatbroker


# ── where a new task goes lives in `taskshape` now (PLAN 18.1) ─────────────────────────
# By NAME, as `work`, `asking` and `micaudio` do it.
from taskshape import with_folder  # noqa: E402,F401


# ============================================================ how he narrates
# The briefs live in briefs.py and reach the session through the UserPromptSubmit hook
# `~/.sergio/ash-brief.sh`, NOT by being appended to the text that gets typed. Appending
# them put the entire brief on screen in front of the user mid-take (2026-09-18).
from briefs import (NARRATION_BRIEF, PLAIN_BRIEF, SEE_BRIEF, SERVED_RE, BUILD_BRIEF, CHART_RE, CHART_BRIEF,
                    for_task)                       # noqa: F401  (re-exported for callers)


def with_narration_brief(task, narrating):
    """The task, unchanged. The brief that used to be concatenated here is delivered by the
    hook instead — see briefs.py. Kept as the single call site so nothing else in ashd has
    to know where the brief went."""
    return task.rstrip()


# A task name lifted from the planner is a bare noun phrase ("coffee roastery
# landing page"), and dropping it into a sentence unchanged is what produced
# "He'll start on coffee roastery landing page" (2026-09-15). Give it an article
# unless it already has one, or is a proper name / plural that doesn't want one.
_HAS_ARTICLE = re.compile(r"^(the|a|an|your|our|my|his|her|their|this|that|these|those)\b", re.I)


def with_article(name):
    name = (name or "").strip()
    if not name or name == "that" or _HAS_ARTICLE.match(name):
        return name or "that"
    return ("an " if name[:1].lower() in "aeiou" else "the ") + name


def spoken_list(parts):
    return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]


# ============================================================ permission questions
# Moved to `asking.py` (18.1, second extraction). Re-exported by NAME, so the import line
# is the list of what came out — `test_seatbroker` lifts `yes_or_no` and its grammar, and
# `behaviour_baseline` freezes all three.
from asking import short_command, describe_request, yes_or_no  # noqa: E402,F401




# ============================================================ the daemon
class Ashd:
    # How often the day panel is rebuilt when nothing has happened. Five minutes: an agenda
    # moves on the order of hours, and each read spawns a system-python child. The panel does
    # not wait for this after a booking — `_refresh_day_panel` runs then.
    DAY_PANEL_SECONDS = 300

    # The learning panel repaints every half minute and IMMEDIATELY after an action. It is
    # interactive: a card that stays put after somebody presses KEEP reads as a broken
    # button, and a person who presses it twice has approved twice.
    LEARN_PANEL_SECONDS = 30

    def __init__(self, a):
        self.a = a
        self.prefs = {"volume": 0.8, "speed": 1.0}
        try: self.prefs.update(json.loads(PREFS.read_text()))
        except Exception: pass
        self.commands = Commands(HERE/"commands.json")
        self.state = "idle"
        self.gen = 0                            # bumps on every cancel; stale workers check it
        # A LOGICAL TURN, which is not the same thing as a generation. `gen` bumps on a
        # CANCEL and on nothing else, so two ordinary turns in a row share one. Paid approval
        # was keyed on `gen` and its own docstring claimed "a new turn bumps the generation,
        # so it cannot carry" — it does not, and one approval silently covered the next
        # unrelated turn. Reproduced 2026-09-20 (Codex verification): approve a lesson, then
        # ask for a chart, and the chart runs on the paid seat without being asked about.
        # PLAN 4.5 is explicit that approval is turn-bound and never carries.
        self.running = True          # cleared only by a caller that wants a loop to stop
        self.turn_seq = 0
        self.stopped_at = 0.0                   # when he was last told to stop; older speech is dropped
        self.lock = threading.Lock()
        self.proc = None                        # the running `ash -p` or pw-play, for barge-in
        self.pair = None
        self._clear_orphan_lesson()
        self._prune_journal()
        # narrate ON by default: the user wants to be kept afloat of what he's doing
        # in real time (2026-09-15). pair.py's Narrator paces it (~once a minute) and
        # dedupes, so "on" is a steady trickle, not the old wall of every-tool chatter.
        self.pair_flags = {"narrate": True, "visual": True, "replies": True}   # replies: his terminal answers, spoken
        self.hearing = False                    # the user is mid-sentence: nothing else may start talking
        self.asking = False                     # a permission question is out loud right now
        self.turn_active = False                # ashd's own `ash -p` turn is running
        self.dialog = None                      # a multi-step conversation in progress (the task list)
        self.board = None                       # the running on-screen task list
        self.last_turn = 0.0
        self.last_user_text = ""
        self.out_wav = []                       # --play-to accumulator
        self.reply_slot = None                  # set while a permission question waits for yes/no
        self._last_reply = ("", 0.0)            # last spoken reply text + time, for dedup
        self.listen_for, self.deaf_for = 5.0, 0.0   # set on each entry to listening; see set_state
        self.following = False                  # True while the mic is open for a follow-up
        self.askdir = CFG/"ask"
        self.askdir.mkdir(exist_ok=True)
        # 16.1 — rotate the logs D22 never reached (pair.log, ashd-manual.log, orb.raw.log
        # and the rest). At START, because that is the one moment nothing holds a handle,
        # and by ROTATION not truncation: D43 was `: > "$LOG"` destroying a dozen sessions
        # in an evening. Never fatal — a daemon that will not boot because a log could not
        # be moved is a worse outcome than a large log.
        try:
            import logrotate
            for f, size in logrotate.rotate():
                log(f"rotated {f.name} ({size:,} bytes)")
        except Exception as e:
            log(f"log rotation skipped: {type(e).__name__}: {e}")
        self.models_ready = threading.Event()
        threading.Thread(target=self._load_models, daemon=True).start()
        threading.Thread(target=self._say_loop, daemon=True).start()
        threading.Thread(target=self._ask_loop, daemon=True).start()
        threading.Thread(target=self._typed_loop, daemon=True).start()
        threading.Thread(target=self._day_panel_loop, daemon=True).start()
        threading.Thread(target=self._learn_panel_loop, daemon=True).start()

        from openwakeword.model import Model
        from openwakeword.vad import VAD
        self.wake = Model(wakeword_models=[a.model], inference_framework="onnx", vad_threshold=0.5)
        self.wake_name = next(iter(self.wake.models))
        self.vad = VAD()

    def _load_models(self):
        t = time.time()
        from faster_whisper import WhisperModel
        self.stt = WhisperModel(self.a.stt, device="cpu", compute_type="int8", cpu_threads=4)
        from voice import Voice, settings
        v = {}
        try:
            v = json.loads((CFG/"voice.json").read_text())
        except Exception as e:
            # `except Exception: pass` here swapped a five-way blend at movement 0.85 for a
            # single unblended voice at movement 1.0 and said nothing (11.8). The fallback
            # is fine; arriving at it in silence is not.
            log(f"voice.json unreadable ({e}) — falling back to the default voice")
        self.voice = Voice(**settings(v, log))
        self.voice_base_speed = self.voice.base_speed
        self.voice_base_pitch = self.voice.pitch
        # voice.json is the voice. ashd-prefs.json is a live nudge on top of it, and for
        # ENERGY it was silently the whole story: prefs carried a stale 0.12 from before
        # the blend was retuned, and _speak() applied it over voice.json's 0.30 on every
        # line. The commercial, built straight from voice.json, was the only thing anyone
        # heard at 0.30 — which is why it sounded like a person and he did not
        # (user, 2026-09-19: "less robotic, LIKE THE COMMERCIAL").
        self.voice_base_energy = self.voice.energy
        self.voice.k                            # load kokoro now, not on the first reply
        self.voice._synth("Ready.", 1.0)        # and the phonemizer: misaki takes ~5 s to load
        log(f"models ready: whisper {self.a.stt}, voice {self.voice.voice} ({time.time()-t:.1f}s)")
        self.models_ready.set()
        self.report_practice()
        self.morning_brief()


    def morning_brief(self):
        """Say the day's brief once, on the first open of the day (PLAN C2.5).

        `day.brief()` and `proactive.brief_due()` have both existed since C2/C7 and NOTHING
        JOINED THEM — the brief was written, the gate that decides when it may speak was
        written, and no caller ever asked. A feature nothing calls is a function, not a
        feature, which is the same shape 22.3's two verbs were in.

        Every unprompted path asks `may_speak` (C7.3), so this does too rather than keeping
        its own rules: quiet hours, asleep, a lesson running and a working terminal all
        decline it here for free, and the answer is logged either way so a brief that did
        not happen can be explained. `mark_brief` only moves on a brief that was actually
        SAID — marking it before speaking is how a day goes silent about itself.

        Wrapped whole, like the practice report beside it: nothing about a brief is worth
        costing a boot.
        """
        try:
            import proactive
            ok, why = proactive.may_speak(
                "brief", state=self.state, asleep=getattr(self, "asleep", False),
                lesson_running=bool(getattr(self, "lesson", None)))
            if not ok:
                log(f"brief: not now ({why})")
                return
            import day
            said, _ = day.brief()
            if not said:
                return
            proactive.mark_brief()
            log(f"brief: {said[:120]!r} ({why})")
            self.speak(said, self.gen, then="idle")
        except Exception as e:
            log(f"brief skipped: {type(e).__name__}: {e}")

    def report_practice(self):
        """Say what the nightly practice loops did, once, on the first open after a night.

        The loops (loops/cs-practice, loops/skill-acquire) leave a report card; the skills
        they write are shared with the CLI through a symlink, so this is the only part of
        the night the orb has to do anything about. Nothing to report is the normal case and
        makes no sound. Wrapped whole: a malformed card must never cost a boot."""
        try:
            import practice_card
            # Read the card ONCE and carry its day into the mark, so a nightly loop that
            # writes a new card between the read and the mark cannot have that new card
            # marked spoken without ever being said (PLAN 14.3).
            card = practice_card.read() or {}
            text = practice_card.line()
            if not text:
                return
            practice_card.mark_spoken(expect_day=card.get("day"))
            log(f"practice report: {text[:120]!r}")
            self.speak(text, self.gen, then="idle")
        except Exception as e:
            log(f"practice report skipped: {type(e).__name__}: {e}")

    # ---- state -------------------------------------------------------------
    def set_state(self, s, **extra):
        if s == "listening":
            # A wake gives 5 s to start talking. A follow-up after his answer waits
            # longer (you are thinking about what he said), and ignores the first
            # 0.4 s so the tail of his own voice in the room is not taken as yours.
            fu = bool(extra.get("follow_up"))
            self.listen_for = float(self.prefs.get("follow_up", FOLLOWUP_WINDOW_S)) if fu \
                else WAKE_WINDOW_S
            if fu and self.dialog:
                self.listen_for = max(self.listen_for, DIALOG_WINDOW_S)
            self.deaf_for = SELF_HEAR_DEAF_S if fu else 0.0
            self.following = fu
        self.state = s
        write_state(state=s, **extra)
        # 6.6 SHADOW. Off unless `runtime-controller` is on, decides nothing, and records
        # where the live daemon and the protocol disagree — a `set_state` after the turn it
        # belongs to has ended is D1's class, and `runtime.next_state` is what names it.
        adapters.shadow_state(s)
        log(f"[{s}]" + "".join(f" {k}={v!r}" for k, v in extra.items()))

    def _prune_journal(self):
        """Keep the event journal bounded (PLAN C6.5). Once, at startup.

        A DAEMON RESTART IS THE RIGHT MOMENT and the only one taken. Pruning fights
        `Journal.since()`: a consumer resumes from its last sequence, so deleting under it
        loses events with no gap it can detect. A restart is precisely when nothing is
        mid-resume — everything that survives it re-reads from its own watermark — so this is
        the one boundary where dropping old rows cannot cut the ground from under a live
        reader. Doing it on a timer instead would.

        Never fatal, and never loud unless it did something: a journal that cannot be tidied
        is a disk problem, and a daemon that refuses to start over housekeeping is worse than
        a large file.
        """
        try:
            import adapters
            removed, kept = adapters.journal().prune()
            if removed:
                log(f"journal pruned: {removed} event(s) past retention, {kept} kept")
        except Exception as e:                            # noqa: BLE001
            log(f"journal not pruned (ignored): {type(e).__name__}: {e}")

    def _clear_orphan_lesson(self):
        """A lesson this daemon did not start is one the last daemon left behind.

        tutor-state.json outlives a restart, and a lesson process can outlive a crashed daemon.
        Either way the panel came back "waiting for your answer" with nothing able to hear one —
        stuck on every ashorb start (user, 2026-09-19). A fresh daemon has no lesson of its own,
        so it ends any that is still running and closes the panel."""
        import tutor as _tutor
        st = _tutor.read() or {}
        if (st.get("mode") or "off") == "off":
            return
        for e in os.listdir("/proc"):
            if not e.isdigit():
                continue
            try:
                parts = (Path("/proc")/e/"cmdline").read_bytes().split(b"\0")
            except OSError:
                continue
            if (parts and Path(parts[0].decode(errors="replace")).name.startswith("python")
                    and any(x.endswith(terminal._script_suffix("lesson.py")) for x in parts[1:])):
                try: os.killpg(os.getpgid(int(e)), 9)
                except (ProcessLookupError, PermissionError):
                    try: os.kill(int(e), 9)
                    except ProcessLookupError: pass
        _tutor.write(mode="off", text="", question="", hint="", waiting="", target=None)
        log(f"cleared a lesson the last session left open ({st.get('title') or 'untitled'})")

    def stop_everything(self):
        """STOP means stop - his voice, his turn, and the work he handed to the terminal.

        This used to be `set_state("idle")` and nothing else: the orb went quiet-looking
        while the linked terminal carried on, and every line it had already queued was
        still spoken afterwards. Four things have to happen, and missing any one of them
        is what "he doesn't listen when I say stop" looks like:
          - the generation bumps, which cuts the utterance mid-word and kills pw-play;
          - everything already queued for the voice is dropped (the say-queue is on disk,
            so a gen bump alone does not touch it);
          - the terminal gets an ESC, or it keeps working and keeps queueing more;
          - `stopped_at` blocks the line the say-loop is holding in memory right now.
        """
        self.stopped_at = time.time()
        # 8.5 — WHICH TURN was stopped. `stopped_at` is a timestamp, and a timestamp cannot
        # tell a line queued by the cancelled turn from one queued by the turn that started
        # a moment later; the turn id can. Recorded before `cancel()`, which is what ends it.
        self.stopped_turn = getattr(self, "turn_seq", 0)
        log(f"stop: cancelling turn-{self.stopped_turn}")
        self.cancel()
        dropped = 0
        for f in SAY_DIR.glob("*.json"):
            f.unlink(missing_ok=True)
            dropped += 1
        self.dialog = None
        # AND THE LESSON (PLAN 12.4). Stop reached the voice, the queue, the CLI turn and the
        # terminal — and walked straight past the lesson, which is its own process and kept
        # driving the panel. The docstring above says missing any one of these is what "he
        # doesn't listen when I say stop" looks like; this was a fifth one nobody had
        # counted. Bounded by the turn, so a lesson started AFTER the stop survives it.
        ended = self.stop_lesson(upto=self.stopped_turn)
        told = interrupt_terminal()
        log(f"stop: dropped {dropped} queued line(s), terminal "
            + ("interrupted" if told else "not linked")
            + (f", lesson turn-{self.lesson_turn} ended" if ended else ""))
        return self.set_state("idle")

    def stop_lesson(self, upto=None):
        """End the running lesson if it belongs to turn `upto` or earlier. Returns whether
        one was ended.

        `upto=None` means unconditionally — what a new lesson does to the old one. The
        bounded form is what STOP uses: killing by "is a lesson running" would end a lesson
        the very next turn had just started, which is the D76 mistake in a different place.

        The tutor panel is closed by `_lesson_watch`, which runs on the reaping thread for
        every exit including this one. It is NOT closed here: two closers for one surface is
        how the panel ends up cleared out from under a lesson that replaced this one.
        """
        proc = getattr(self, "lesson", None)
        if not proc or proc.poll() is not None:
            return False
        if upto is not None and getattr(self, "lesson_turn", 0) > upto:
            return False
        try:
            os.killpg(proc.pid, 9)          # the whole group: the lesson's own children too
        except (ProcessLookupError, PermissionError):
            return False
        self.lesson = None                  # so `_lesson_watch` does not speak its closing line
        return True

    def cancel(self):
        dropped = adapters.shadow_cancel("cancelled")
        if dropped and not dropped.get("already"):
            # The number ashd itself cannot report today: a stop that throws four queued
            # lines away and one that throws none away look identical from outside.
            log(f"[shadow] cancel dropped {dropped['tasks']} task(s), "
                f"{dropped['speech']} line(s) of speech")
        with self.lock:
            self.gen += 1
            p, self.proc = self.proc, None
        if p and p.poll() is None:
            try: os.killpg(p.pid, 9)            # the whole group: ash's hooks and tools die with it
            except ProcessLookupError: pass

    # ---- main loop ---------------------------------------------------------
    def run(self, frames):
        # 7.4 — say it ONCE, at the top, naming the root rather than listing four
        # consequences of one cause. A degraded desktop is not a crash: everything that does
        # not need a window still works, and he says which part does not.
        _g = gui_condition()
        if not _g.get("ok"):
            log(f"degraded desktop: {', '.join(_g.get('degraded') or [])}")
            if _g.get("say"):
                # AFTER the voice loads, on its own thread. This called speak() straight away,
                # and the voice loads in a background thread, so every degraded start raised
                # `'Ashd' object has no attribute 'voice_base_speed'`, the except below logged
                # it, and the announcement 7.4 promises had never once been heard (found
                # 2026-09-22 by running it with no desktop, not by the suite, which saw the
                # call and not whether it could succeed). The say-loop and the lesson path
                # already wait on models_ready for exactly this reason. A thread, because the
                # mic loop below must start now — waiting here would make him deaf for as
                # long as whisper and the voice take to load.
                def _announce(gen=self.gen, line=_g["say"]):
                    self.models_ready.wait()
                    try:
                        self.speak(line, gen, then="idle")
                    except Exception as e:
                        log(f"could not announce the degraded desktop: {type(e).__name__}: {e}")
                threading.Thread(target=_announce, daemon=True, name="degraded-announce").start()
        self.set_state("idle")
        clock, last_wake = 0.0, -1e9
        rec, heard_speech, silence, waited, deaf = [], False, 0.0, 0.0, 0.0
        was_listening = False
        self.asleep, ctl_mtime, ctl_check = False, 0.0, 0.0
        for buf in frames:
            if orphaned():
                log("ashd: the orb is gone, exiting"); break
            clock += FRAME_S
            if clock - ctl_check >= 0.25:              # a stat every quarter second, not every frame
                ctl_check = clock
                try:
                    # Through the adapter (PLAN 6.9). Same mtime keying, same transitions —
                    # what is added is a journal entry naming WHO changed it, because this
                    # slot has two writers and one of them is this process.
                    want, ctl_mtime = adapters.sleep_state(ctl_mtime)
                    if want is not None:
                        if want != self.asleep:
                            self.asleep = want
                            log("asleep: not listening until the orb is double-clicked" if want else "awake")
                            if want:
                                self.stop_everything()   # a turn in progress, its speech, and the terminal's
                except (OSError, ValueError):
                    pass
            if self.asleep:
                # The frame is DRAINED — read, then discarded before the wake model sees it.
                # Scoring audio he is not allowed to act on is work he should not be doing
                # on sound he should not be holding, so the discard is here rather than
                # after `predict`.
                #
                # WHAT THIS IS NOT: the capture process is **still running**. `pw-record`
                # keeps handing frames over and the kernel keeps the device open; asleep
                # means nothing looks at them and nothing writes them down, not that the
                # microphone is off. Anybody deciding whether "asleep" is privacy needs
                # that distinction, and "drained" reads as "off" to anybody who has not
                # read this loop (PLAN 13.5).
                continue
            x = np.frombuffer(buf, dtype=np.int16)
            score = float(self.wake.predict(x)[self.wake_name])
            # his own voice comes back through the mic while speaking: demand more
            thr = self.a.threshold + (0.2 if self.state == "speaking" else 0.0)
            woke = score >= thr and clock - last_wake >= 2.0

            if woke and self.state != "listening":
                last_wake = clock
                if self.state != "idle":
                    log(f"barge-in ({score:.2f})")
                    self.cancel()
                self.set_state("listening", score=round(score, 3))

            listening = self.state == "listening"
            if not listening: self.hearing = False
            if listening and not was_listening:     # a wake, or "wake up" re-opening the mic
                rec, heard_speech, silence, waited = [], False, 0.0, 0.0
                deaf = self.deaf_for
            was_listening = listening
            if not listening:
                continue
            if woke and last_wake == clock:
                continue                            # the wake frame itself is not speech
            if deaf > 0:
                deaf -= FRAME_S
                continue

            rec.append(buf)
            p = self.vad.predict(x, frame_size=480)
            if p >= 0.5:
                heard_speech, silence = True, 0.0
                self.hearing = True
            else:
                silence += FRAME_S
                if not heard_speech: waited += FRAME_S
            dur = len(rec)*FRAME_S
            # a mid-sentence pause (a breath, an "um") runs well past 0.8 s, which used to cut
            # people off; the silence that ends a turn is ashd-prefs `endpoint`, re-read live
            if heard_speech and (silence >= float(self.prefs.get("endpoint", self.a.endpoint)) or dur >= 30):
                audio = np.frombuffer(b"".join(rec), dtype=np.int16).astype(np.float32)/32768
                self.set_state("thinking")
                threading.Thread(target=self.handle, args=(audio, self.gen), daemon=True).start()
            elif not heard_speech and waited >= self.listen_for:
                slot = self.reply_slot
                if slot:                            # a permission question got no answer
                    self.set_state("thinking")
                    slot["event"].set()
                else:
                    log("nothing said, back to waiting for the wake word")
                    self.set_state("idle")
                # REMINDERS (PLAN C3.4). On the loop that is already running — no new
                # timer, because a reminder held by a thread nobody supervises dies with it
                # and the person finds out by missing the thing. Checked at most once a
                # minute: the store is EDS, and "is anything owed" does not get a truer
                # answer by being asked forty times a second.
                _rnow = time.time()
                if _rnow - getattr(self, "_reminder_check", 0) >= 60:
                    self._reminder_check = _rnow
                    try:
                        # THE GATE FIRST (PLAN C7.1). The idle tick also runs while a linked
                        # terminal is mid-build, so without this a reminder lands over the
                        # narration while the person is reading the screen. D7 measured what
                        # unprompted speech costs when it arrives at the wrong moment.
                        import proactive as _pro
                        import reminders as _rem
                        _busy = bool(self.pair and self.pair.poll() is None)
                        _teaching = bool(getattr(self, "lesson", None)
                                         and self.lesson.poll() is None)
                        _okay, _why = _pro.may_speak(
                            "reminder", state=self.state,
                            asleep=getattr(self, "asleep", False),
                            lesson_running=_teaching, terminal_working=_busy)
                        if not _okay:
                            log(f"reminder held back: {_why}")
                        else:
                            for _line in _rem.fire(say=lambda s: self.speak(s, self.gen)):
                                log(f"reminder: {_line}")
                    except Exception as _e:
                        log(f"reminders skipped: {type(_e).__name__}: {_e}")

                # ...and while nothing is happening, run a queued review if it is due. The
                # user speaking wins: this only runs on the idle path, and a new turn sets
                # `last_activity`, which pushes the settle window out again.
                if adapters.review_due(getattr(self, "last_activity", 0)):
                    made, why = adapters.run_due_review()
                    if made:
                        log(f"review proposed {len(made)} candidate(s) for review")
                    elif why not in ("not due", "nothing queued", "no unreviewed turns"):
                        log(f"review: {why}")
        if self.a.play_to and self.out_wav:
            pcm = (np.clip(np.concatenate(self.out_wav), -1, 1)*32767).astype(np.int16)
            with wave.open(self.a.play_to, "wb") as w:
                w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(pcm.tobytes())
            log(f"replies written to {self.a.play_to} ({len(pcm)/24000:.1f}s)")

    # ---- one utterance -----------------------------------------------------
    def handle(self, audio, gen, typed=None, typed_source=None):
        # ONE LOGICAL TURN — and an utterance that ANSWERS an open question is not one. The
        # spoken yes to "shall I use a paid model?" arrives here as audio like anything else,
        # and `_handle` routes it to `reply_slot` and returns; counting it as a new turn made
        # the rest of the SAME turn ask again. It failed safe (over-asking, never silently
        # spending) but it is not what 4.5 says. Raised by Codex's second verification pass.
        with self.lock:
            if not self.reply_slot:
                self.turn_seq += 1          # spoken or typed; an answer is neither
            turn = self.turn_seq
        # Bind the turn for everything this thread reaches — the planner, a lesson, vision.
        # They call the broker without knowing a turn exists, and the ledger needs to say
        # which one every decision belonged to (4.9).
        try:
            import seatbroker as _sb
            _sb.set_turn(getattr(self, "session_id", "") or str(os.getpid()), f"turn-{turn}")
        except Exception:
            pass
        # 16.3 — the same identity on every LOG line this thread writes from here on, so a
        # turn can be followed end to end through three processes and two files. Bound
        # beside the seat's copy rather than in a second place: two owners of one identity
        # is how they drift.
        common.bind_turn(f"turn-{turn}",
                         session=getattr(self, "session_id", "") or str(os.getpid()))
        # THE ONE-WAY SWITCH OPENS CLEAN (PLAN 3.8). Both legs available: this turn may read
        # untrusted content, and it may act — until it does the first, which closes the
        # second. Bound here rather than in `_handle` for the same reason the turn counter
        # is: this is where a turn begins, once, whatever branch it takes.
        try:
            import oneway
            oneway.begin(f"turn-{turn}")
        except Exception:
            pass
        adapters.shadow_start(f"turn-{turn}")
        try:
            self._handle(audio, gen, typed, typed_source)
        except Exception as e:
            log(f"turn failed: {type(e).__name__}: {e}")
            if gen == self.gen: self.set_state("idle")
        finally:
            # TURN END (PLAN 21.1). Here rather than at the end of `_handle`, which returns
            # from a dozen branches — this fires for all of them, including a turn that
            # raised, because a failed turn is still a turn worth reviewing.
            #
            # It QUEUES; it does not run. A review on a local seat takes the GPU the next
            # prompt needs, and on this machine the RX 580 drops off the PCIe bus under
            # sustained load (21.3), so it waits for an idle window.
            self.last_activity = time.time()
            adapters.queue_review(session_id=getattr(self, "session_id", ""),
                                  turn_id=f"turn-{getattr(self, 'turn_seq', 0)}")

    def _handle(self, audio, gen, typed=None, typed_source=None):
        self.models_ready.wait()
        # Typed input joins here, AFTER transcription and before everything else, so a
        # typed line gets the identical path a spoken one does - control phrases, the
        # task dialog, permission slots, journalling. The only difference is where the
        # words came from; the answer still comes back as speech.
        if typed is not None:
            text = typed.strip()
            log(f"typed {redact.redact(text)!r}")
        else:
            t = time.time()
            segs, _ = self.stt.transcribe(audio, beam_size=1, language="en", vad_filter=True,
                                          initial_prompt="Hey Ash.")
            text = " ".join(s.text for s in segs).strip()
            # 13.4 — everything heard is logged verbatim, and these logs are kept for days.
            # Say an API key out loud to test the microphone and it lands on disk in three
            # files. The TURN still gets the real text; only the log line is masked.
            log(f"heard {redact.redact(text)!r} ({time.time()-t:.1f}s)")
        slot = self.reply_slot
        if slot:
            slot["text"] = text
            # WHO ANSWERED (PLAN 3.10). The microphone is a person at the desk; a typed line
            # is whatever wrote the channel it came from. `ask_yes_no` refuses an untrusted
            # source for an approval — without this field it cannot tell them apart, which
            # is D56: a turn answering its own permission question.
            slot["source"] = adapters.VOICE if typed is None else (typed_source or adapters.TYPED_SLOT)
            slot["event"].set()
            return
        if gen != self.gen: return
        # THE TURN, IN THE JOURNAL (PLAN 20.1). Placed after the reply-slot interception on
        # purpose: an utterance that answers an open question belongs to the turn that asked
        # it, not to a new one — the same distinction `turn_seq` makes for approval (D76).
        # Off unless `turn-journal` is on, and never fatal.
        try:
            adapters.turn_started(text, source="ashd", typed=typed is not None,
                                  turn_id=f"turn-{getattr(self, 'turn_seq', 0)}")
        except Exception:
            pass
        if len(norm(text)) < 2:
            return self.set_state("idle")

        # THE LEARNING VERBS (PLAN 22.3 / 21.5), before the command table and before any
        # model turn: they are deterministic, so asking a model what "remember this" means is
        # paying for an answer the phrase already gives. Only `remember` binds in-turn; every
        # other verb is a question this layer does not answer yet, and falls through.
        # A PROMISE IN PASSING (PLAN C3.5). Recorded, never acted on: it does not interrupt,
        # it does not create a to-do, and it is read back only when asked. A task appearing
        # in somebody's list that they did not ask for is the failure the mandate names.
        try:
            import day as _dayc
            _p = _dayc.note_promise(text, turn_id=f"turn-{getattr(self, 'turn_seq', 0)}")
            if _p:
                log(f"noted a promise: {_p[:60]!r}")
        except Exception:
            pass

        # THE DAY'S VERBS (PLAN C2), before the command table and before any model turn.
        # "What's my day" has one right answer and it comes out of EDS; asking a model what
        # the phrase means is paying, every morning, for an answer the phrase already gives.
        try:
            import day as _day
            _kind, _said, _what = _day.handle(text)
        except Exception as e:
            log(f"day verbs unavailable: {type(e).__name__}: {e}")
            _kind, _said, _what = None, "", None
        if _kind == "say":
            return self.speak(_said, gen, then=self.after_reply())
        if _kind == "confirm":
            # THE CALENDAR LEG OF THE ONE-WAY SWITCH (3.8), which was declared and unwired
            # until there was something to gate. A turn that has just read a web page may
            # not write the calendar on the strength of it.
            if not self.reopen_act_leg("calendar", gen):
                return self.speak("I've read something from outside this turn, so I'm not "
                                  "touching your calendar. Ask me again and I will.",
                                  gen, then=self.after_reply())
            _scope = (_what or {}).get("scope")
            _yes = self.ask_yes_no(_said, gen, label="calendar", default=False)
            if not _yes:
                # A SECOND YES/NO, when the verb offers a wider option. The recurring fork is
                # "just this one" or "all of them", which `ask_yes_no` cannot take an answer
                # to in one question — so `day` phrases it as two, narrowest first, and the
                # daemon only supplies the microphone. A "no" with no follow-up is a no.
                _f = (_what or {}).get("followup")
                if _f and self.ask_yes_no(_f[0], gen, label="calendar", default=False):
                    _yes, _scope = True, _f[1]
            if not _yes:
                return self.speak("Left it.", gen, then=self.after_reply())
            try:
                done, _res = _day.do_confirmed(_what, scope=_scope)
            except Exception as e:
                log(f"calendar write failed: {type(e).__name__}: {e}")
                return self.speak("I couldn't write that to your calendar.", gen,
                                  then=self.after_reply())
            # THE PANEL CATCHES UP NOW, not in five minutes. "Did the person see the thing
            # happen" is the product test, and a panel still showing the old day while he
            # says "done" is the failure it names. Only after a write that succeeded.
            self._refresh_day_panel()
            return self.speak(done, gen, then=self.after_reply())

        try:
            import learn_verbs
            _v = learn_verbs.match(text)
        except Exception:
            _v = None
        # THE REST OF THE LEARNING VERBS (PLAN C6.4). `recall`, `why`, `wrong` and `forget`
        # have existed in `learn_verbs` since 22.3 and reached nothing — a person could ask
        # what he thought he knew about them and get a model turn about the question rather
        # than an answer from the store. All four are deterministic and all four are free.
        if _v and _v[0] in ("recall", "why", "wrong", "forget"):
            try:
                import prefs_model as _pm
                _verb, _arg = _v[0], (_v[1] or "")
                if _verb == "recall":
                    # 22.2: DRAW IT AS WELL AS SAY IT. "What do you think you know about me"
                    # answered only in speech is a list read aloud, and a list read aloud
                    # stops being heard after about three items. The timeline goes in the
                    # reading column and the sentence is the short form of it.
                    #
                    # The drawing is best-effort: if it cannot be shown, the spoken answer is
                    # still the answer. Placement is polish and must never be fatal (rule 2).
                    _say = _pm.recall()[0]
                    try:
                        import journey as _jr
                        _drawn = _jr.show()
                        if _drawn["nodes"]:
                            _say = _drawn["said"] + " It's on screen."
                    except Exception as _e:
                        log(f"journey: {type(_e).__name__}: {_e}")
                elif _verb == "why":
                    _say = _pm.why(_arg)[0]
                elif _verb == "forget":
                    # NEVER GUESSES. With nothing named it asks, because forgetting the
                    # wrong thing is unrecoverable from the person's side.
                    _say = _pm.forget(_arg)[0]
                else:
                    _say = _pm.correct(_arg, "")[0] if _arg else \
                        "What should it be instead?"
            except Exception as e:
                log(f"preference verb failed: {type(e).__name__}: {e}")
                _say = "I couldn't get at what I know about you."
            return self.speak(_say, gen, then=self.after_reply())

        # THE LAST TWO VERBS (PLAN 22.3). `learn` and `skill` were the only ones of the
        # seven still falling through to a model turn — the exact cost C1.6's ruling and
        # this row's own "no model turn, no cost, no seat" forbid. Neither GUESSES, for the
        # same reason `forget` does not: the person cannot see what was captured.
        if _v and _v[0] == "learn":
            bound, detail = adapters.remember_explicit(
                f"what we just did: {self.last_user_text}" if self.last_user_text else "",
                ask=lambda q: self.ask_yes_no(q, gen, label="learn"),
                events=[f"turn-{getattr(self, 'turn_seq', 0)}"])
            if bound:
                return self.speak("Noted, I'll go over it tonight.", gen,
                                  then=self.after_reply())
            if detail == "learning is off (turn-journal)":
                return self.speak("I'm not keeping memories right now.", gen,
                                  then=self.after_reply())
            # Nothing to learn FROM is a different answer to "I refused it", and saying the
            # wrong one teaches the person the feature is broken when it simply had no input.
            if not self.last_user_text:
                return self.speak("There's nothing from this session for me to go over yet.",
                                  gen, then=self.after_reply())
            log(f"learn refused: {detail}")
            return self.speak("I won't keep that one.", gen, then=self.after_reply())

        if _v and _v[0] == "skill":
            # A skill needs a NAME and its provenance, and neither can be inferred from
            # "turn that into a skill". `skill_draft` refuses a draft with no provenance for
            # the same reason, so asking is the honest answer rather than inventing a slug.
            return self.speak(
                "I can draft that as a skill proposal — what should it be called? "
                "Say `ashlearn skill` in the terminal with a name and I'll write it up "
                "for you to review; nothing is installed until you accept it.",
                gen, then=self.after_reply())

        if _v and _v[0] == "remember" and _v[1]:
            bound, detail = adapters.remember_explicit(
                _v[1], ask=lambda q: self.ask_yes_no(q, gen, label="remember"),
                events=[f"turn-{getattr(self, 'turn_seq', 0)}"])
            if bound:
                return self.speak("Remembered.", gen, then=self.after_reply())
            if detail == "learning is off (turn-journal)":
                return self.speak("I'm not keeping memories right now.", gen,
                                  then=self.after_reply())
            log(f"remember refused: {detail}")
            return self.speak("I won't keep that one.", gen, then=self.after_reply())

        cmd = self.commands.match(text)
        # Step controls only exist while a lesson is running. Outside one they must
        # not consume the utterance at all - swallowing it to answer "no lesson is
        # running" makes him look deaf to a perfectly ordinary sentence.
        import tutor as _tutor
        _in_lesson = (_tutor.read() or {}).get("mode", "off") != "off"
        if cmd and cmd[1]["action"] in ("tutor.next", "tutor.stuck") and not _in_lesson:
            cmd = None
        # BARE "NEXT" ADVANCES A LESSON — ONLY WHILE ONE IS RUNNING (D304, owner 2026-09-22).
        # commands.json dropped bare "next" because a one-word phrase matches a whole utterance
        # and ate ordinary answers. But with a lesson on screen, "next" fell through to wherever
        # ordinary speech goes — a linked terminal — and the coding Ash took it as "carry on" and
        # resumed a task that had been stopped (watched 2026-09-22). Inside a lesson these words
        # mean the lesson; outside one they are still ordinary words, so the old problem stays fixed.
        if not cmd and _in_lesson and norm(text) in LESSON_NEXT_WORDS:
            _entry = next((c for _ph, k, c in self.commands.table if k == "tutor_next"), None)
            if _entry:
                cmd = ("tutor_next", _entry)
        if self.dialog and time.time() - self.dialog["t"] > 180:
            self.dialog = None                      # a question from minutes ago is not still open
        if self.dialog:
            if cmd and cmd[1]["action"] in ("turn.abort", "orb.sleep", "tasks.cancel"):
                self.dialog = None
                return self.command(*cmd, gen=gen)
            return self.dialog_step(text, gen)
        if not cmd and TASKLIST_RE.search(text):
            return self.tasklist_start(text, gen)
        if cmd:
            return self.command(*cmd, gen=gen)

        # "say: <words>" — say exactly those words. No model, no terminal, no routing.
        # There was no such rule: "say: I'm Ash." came out verbatim only because the model chose
        # to obey it, and "say: I'm Ash. Let's build something." never reached the model at all —
        # is_work saw "build" and sent it to the terminal, so the third reveal take for the ad was
        # "Sent that to the terminal and linking up" (2026-09-19). What a line of the advert
        # sounds like must not depend on a model's reading of an instruction.
        m = SAY_VERBATIM.match(text)
        if m and m.group(1).strip():
            line = m.group(1).strip()
            log(f"say verbatim: {line[:80]!r}")
            return self.speak(line, gen, then=self.after_reply(line))

        # Open / close: an action, not a question - no model, no thinking. If they also want to
        # know something about the site ("go to CNN and tell me the top story"), it opens AND the
        # model answers about that page.
        if not CUES.search(text):
            import launch
            closing = launch.resolve_close(text)
            acts = [closing] if closing else launch.resolve_all(text)
            act = acts[0] if acts else None
            for a_ in acts:                      # "open A, then B, then C" is three launches
                launch.run(a_)
                log(f"launch: {json.dumps(a_)}")
            if act:
                if act["kind"] == "url" and launch.INFO.search(launch.norm(text)):
                    self.set_state("thinking", heard=text)
                    ctx = (f"[You have just opened {act['url']} in their browser for them. Answer their question "
                           f"about it by reading that page with WebFetch; do not say you cannot open things.]\n\n")
                    reply = self.ask(text, gen, context=ctx)
                    if gen != self.gen: return
                    return self.speak(reply, gen, then=self.after_reply(reply))
                verb = "Closing" if act["kind"] == "close" else "Opening"
                where = "" if act["kind"] != "url" or act.get("browser") == launch.DEFAULT_BROWSER \
                        else f" in {act['browser'].replace('-browser', '').title()}"
                return self.speak(f"{verb} {act['label']}{where}.", gen, then="idle")

        if LESSON_RE.search(text):
            return self.lesson_start(text, gen)

        if CUES.search(text):
            self.set_state("thinking", heard=text)
            plan = plan_request(text)
            if plan is None and (plan := control_plan(text)):
                log("planner gave nothing; the line is pure control, so the rules planned it")
            log(f"plan: {json.dumps(plan)}")
            if gen != self.gen: return
            if plan and any(st["do"] != "ask" for st in plan["steps"]):
                return self.run_plan(plan, gen)

        # Linked to a terminal Ash he can type into: what you say goes THERE, as if typed,
        # and his answer comes back through pair.py's reply feed in his voice. Linking is
        # two-way now - you can type in the terminal too, and still hear him.
        # AN ACKNOWLEDGEMENT IS NOT A TASK (D311). After "It's fifty-one." the follow-up window
        # heard "Alright." and typed it into the bypassPermissions terminal, and the coding Ash
        # went searching the home directory for something to do (watched 2026-09-22). Only a
        # bare thanks/ok, and only when his last line asked nothing — after "shall I carry on?",
        # "okay" IS the answer and goes through. Kept short inside the branch: K.8 requires the
        # weak-seat check to sit within the branch's first lines.
        if self.pair and self.pair.poll() is None and terminal_inbox_open():
            _recent = getattr(self, "_recent_said", None) or []
            if is_bare_acknowledgement(text, _recent[-1][0] if _recent else ""):
                log(f"acknowledgement, not a task — not typed into the terminal: {text!r}")
                return self.set_state("idle")
            self.warn_if_weak_seat(gen)
            # a build request typed straight through gets the same brief a task list gets
            if not self.reopen_act_leg("shell", gen):
                return self.speak(
                    "I've just read something from outside, so I'm not typing into the "
                    "terminal on this turn. Ask me again and I will.", gen,
                    then=self.after_reply())
            send_to_terminal(with_narration_brief(text, self.pair_flags["narrate"]),
                             turn_id=f"turn-{getattr(self, 'turn_seq', 0)}")
            log("-> terminal")
            if self.pair_flags["replies"]:
                return self.set_state("thinking", heard=text, via="terminal")
            return self.speak("Sent to the terminal.", gen, then=self.after_reply())

        # Nothing to hand it to. A WORK request must not be answered with talk: open a
        # terminal, link it, and give it the task ON SCREEN (2026-09-17, see WORK_RE).
        if is_work(text):
            return self.run_plan({"steps": [{"do": "terminal"}, {"do": "link"},
                                            {"do": "task", "text": text}], "task_name": ""}, gen)

        self.set_state("thinking", heard=text)
        reply = self.ask(text, gen, context=self.page_context(text) + self.screen_context(text))
        if gen != self.gen: return
        self.journal(text, reply)
        self.speak(reply, gen, then=self.after_reply(reply))

    # ---- web pages and lessons -------------------------------------------------
    # page.py finds the page (Chrome is Wayland-native here, so it is Chrome's most recent
    # visit rather than the tab in front). He names the page before anything else, so a
    # wrong guess is caught in the first second instead of after a full summary.
    last_page = None                      # (page dict, time) - "teach me that" reaches back to it

    # HE CAN LOOK NOW. Asked what was on the desk he used to answer from the window list,
    # which came out as "there are some glass widgets on your screen" (user, 2026-09-19:
    # "GIVE HIM VISION MAN"). When the question is about the screen he takes one look
    # through the desktop portal and answers from what is actually there.
    SCREEN_RE = re.compile(
        r"\b(on (my|the|this) (screen|desk|display|monitor)|what.{0,14}(screen|desk)\b|"
        r"widgets?|panels?|what (are|is) (you )?showing|look at (my|the|this) screen|"
        r"can you see|do you see)\b", re.I)

    def screen_context(self, text):
        if not self.SCREEN_RE.search(text or ""):
            return ""
        try:
            import see
            t0 = time.time()
            shot = see.capture(CFG/"cache"/"see.jpg")
            if not shot:
                log("screen: the portal would not give a capture")
                return ""
            # The approve callback is threaded through so a vision turn can ask, once, if
            # every free vision seat is out — rather than failing silently or spending
            # silently. free_only stays True: the ask is what lifts it, for this turn only.
            seat, desc = see.describe(shot, approve=self.approve_paid_seat, free_only=False)
            if not seat:
                log(f"screen: captured, but no vision seat answered ({desc})")
                return ""
            log(f"screen: looked with {seat} in {time.time()-t0:.1f}s — {desc[:70]}")
            # 3.8 — a screenshot is a page someone else wrote, described by a model. Whatever
            # is on that screen is now in this turn's context, so the act leg closes: this
            # turn may answer about what it saw and may not type it into the terminal.
            try:
                import oneway
                oneway.read_untrusted("screenshot", f"described by {seat}")
                desc = oneway.quote(desc)
            except Exception:
                pass
            return (f"[You have just LOOKED at their screen. This is what is on it: {desc}\n"
                    f"Answer from this, naming what is there and reading the real values off it. "
                    f"Never say you cannot see.]\n\n")
        except Exception as e:
            log(f"screen look failed: {type(e).__name__}: {e}")
            return ""

    def page_context(self, text):
        page = None
        import launch
        if launch.OPEN_VERB.search(text) or launch.GO_VERB.search(text):
            return ""                     # "open it in Chrome. The site." is not about the page already open
        if PAGE_RE.search(text):
            try:
                import page as _page
                page = _page.current_page() or None
            except Exception as e:
                log(f"page lookup failed: {type(e).__name__}: {e}")
            if page:
                self.last_page = (page, time.time())
                log(f"page: {page.get('title')!r} {page.get('url')} ({page.get('how')})")
        elif self.last_page and time.time() - self.last_page[1] < 1800:
            return ""                     # --continue already carries the page from that turn
        if not page:
            return ""
        # HOW SURE, IN THE PROMPT. This said "The web page they mean is the one open in
        # their browser" whatever `page.py` had actually found — including the weakest
        # route, which is the last thing in their history whether or not a window is open on
        # it, and may be from another day. A guess stated as a fact is how he ends up
        # confidently summarising the wrong page (PLAN 9.3).
        title, url = page.get("title"), page.get("url")
        tail = ("Read it with WebFetch before answering. Begin your reply by naming the page "
                "in a few words, so they know which one you read. If you only get a sign-in "
                "or error page, say so plainly instead of guessing at the content.")
        if page.get("trust") == "guess":
            return (f"[You cannot see their browser right now. The most recent page in their "
                    f"history is \"{title}\" at {url} — that is a GUESS at what they mean, not "
                    f"something you can see. {tail} If what you read does not fit what they "
                    f"asked, say which page you read and ask which one they meant, rather "
                    f"than answering about the wrong page.]\n\n")
        where = ("the one he has on screen" if page.get("trust") == "certain"
                 else "the one open in their browser")
        return (f"[The web page they mean is {where}: \"{title}\" at {url}. {tail}]\n\n")

    def _lesson_watch(self, proc):
        """Reap the lesson process and speak its closing words. Without this a finished lesson
        left a zombie, and anything it said at the end went to lesson.log and nowhere else."""
        proc.wait()
        # THE PANEL IS CLOSED ON EVERY EXIT — stopped, crashed or finished (PLAN 12.4). This
        # used to sit after the early return below, so a lesson that was stopped or replaced
        # left the teaching panel on screen showing a step nothing was driving any more. The
        # SPEAKING is what is conditional: a lesson the user stopped has nothing to say, and
        # one that was replaced would be talking over its successor.
        try:
            import tutor as _tutor
            st = _tutor.read()
            if st and st.get("mode") not in (None, "off"):
                _tutor.write(mode="off", text="", question="", hint="", waiting="", target=None)
        except Exception:
            pass
        if getattr(self, "lesson", None) is not proc:
            log(f"lesson ended (exit {proc.returncode}) after being stopped or replaced")
            return                                  # replaced or stopped on purpose: nothing to say
        text = ""
        try:
            # The lesson's OWN log, not whatever `lesson.log` points at now — a second
            # lesson starting in the meantime would otherwise hand this one the wrong file,
            # or an empty one.
            own = getattr(self, "lesson_log", None) or (CFG/"lesson.log")
            for line in reversed(Path(own).read_text(errors="replace").splitlines()):
                try: ev = json.loads(line)
                except ValueError: continue
                if ev.get("type") == "result":
                    text = (ev.get("text") or "").strip(); break
        except OSError:
            pass
        log(f"lesson ended (exit {proc.returncode}): {text[:120]!r}")
        if text:
            self.models_ready.wait()
            self.speak(text, self.gen, then="idle")

    def lesson_start(self, text, gen):
        """A lesson blocks at every step until they answer, so it cannot be a voice turn (150 s
        cap). It runs as its own ash process; the panel and the spoken verbs (next step, I'm
        stuck, stop teaching) are how they talk to it, exactly as a lesson started from the CLI."""
        page = None
        if PAGE_RE.search(text):
            try:
                import page as _page
                page = _page.current_page() or None
            except Exception:
                page = None
        body = ""
        try:
            raw = (Path.home()/".sergio"/"commands"/"tutor.md").read_text()
            body = raw.split("---", 2)[2] if raw.startswith("---") else raw
        except OSError:
            pass
        topic = text
        if page:
            topic += (f" (the procedure is on the web page \"{page.get('title')}\" at {page.get('url')} - "
                      f"read it with WebFetch first and build the lesson from what it actually says)")
        prompt = (body.replace("$ARGUMENTS", topic) if "$ARGUMENTS" in body else f"Teach: {topic}\n\n{body}")
        prompt = ("[This lesson was started by voice through the orb and runs HEADLESS: nobody sees or "
                  "hears your plain text replies, and the moment you reply without a tool call the lesson "
                  "process ends. So EVERY question - including the opening one the skill asks before step 1 - "
                  "goes through `ashtutor step <n> --text ... --question ...` followed by `ashtutor wait`, "
                  "and you keep going from what `wait` returns. Put the opening question on step 1 with text "
                  "like 'Before we begin'. Only reply in plain text when the lesson is completely finished, "
                  "and then run `ashtutor off` first; that last reply is spoken aloud. Keep every instruction "
                  "and question short enough to read on the panel, and never put the answer inside a step.]\n\n"
                  + prompt)
        self.stop_lesson()          # unconditional: a new lesson replaces any old one
        # The lesson is PLANNED by the model and RUN by lesson.py (2026-09-17). The old path above
        # still builds `prompt` for the CLI's /tutor command, but a voice lesson no longer asks a
        # headless model to drive twenty blocking tool calls: across three runs of the same
        # request that pointed at bare desktop, guessed page text, and stalled out before step 1.
        # ONE LOG PER LESSON (PLAN 12.5). This was `open(CFG/"lesson.log", "w")` — truncate.
        # Two overlapping lessons and the second wipes the first's closing "result" line
        # before `_lesson_watch` reads it, so the finished lesson says nothing at all. The
        # per-lesson file is what the watcher reads; `lesson.log` stays as a symlink to the
        # newest so anything tailing it by name still works.
        lesson_log = CFG/f"lesson-{int(time.time())}-{os.getpid()}.log"
        logf = open(lesson_log, "w")
        try:
            link = CFG/"lesson.log"
            if link.is_symlink() or link.exists():
                link.unlink()
            link.symlink_to(lesson_log.name)
        except OSError:
            pass
        self.lesson_log = lesson_log
        # Keep the last few and no more; a lesson a week ago is not evidence anyone wants.
        for old_log in sorted(CFG.glob("lesson-*.log"))[:-5]:
            try: old_log.unlink()
            except OSError: pass
        argv = [sys.executable, str(Path(__file__).resolve().parent/"lesson.py"), text]
        if page and page.get("url"):
            argv += ["--page-url", page["url"]]
        # WHICH TURN THIS LESSON BELONGS TO (PLAN 12.4). A lesson is a separate process that
        # outlives the turn that asked for it, so without this there is nothing to tie it to
        # — a stop could only ask "is a lesson running", never "is THIS turn's lesson
        # running", and a stop would then kill a lesson started a second later by the turn
        # that followed it. Same distinction `stopped_turn` already makes for speech (8.5).
        self.lesson_turn = getattr(self, "turn_seq", 0)
        env = dict(self.agent_env(), ASHD_TURN_ID=f"turn-{self.lesson_turn}")
        self.lesson = subprocess.Popen(argv,
                                       cwd=Path.home(), env=env, stdin=subprocess.DEVNULL,
                                       stdout=logf, stderr=subprocess.STDOUT, start_new_session=True)
        log(f"lesson started (pid {self.lesson.pid}, turn-{self.lesson_turn}) on {text!r}"
            + (f", page {page.get('url')}" if page else ""))
        threading.Thread(target=self._lesson_watch, args=(self.lesson,), daemon=True).start()
        what = f" on {page.get('title')}" if page else ""
        return self.speak(f"Alright, let's work through it together{what}. The steps will come up on screen.",
                          gen, then="idle")

    # ---- learning capture ---------------------------------------------------
    # Same doctrine as skill-learn.sh and curiosity-capture.sh: detection is free
    # and instant, judgement is a separate gated pass. A voice turn that carried a
    # durable signal gets journalled; voice-distill.py decides later whether any of
    # it is worth a memory. Nothing here calls a model or blocks the reply.
    SIGNALS = (
        (re.compile(r"\b(no|nope|wrong|that's not|thats not|not what i|actually|"
                    r"i said|stop doing|don't|dont|quit)\b", re.I), "correction"),
        (re.compile(r"\b(remember|from now on|always|never|i prefer|i want you to|"
                    r"my name is|i like|i hate|make sure you)\b", re.I), "preference"),
        (re.compile(r"\b(we use|we run|our|i use|is called|lives in|lives at|"
                    r"the password|it's at|its at)\b", re.I), "fact"),
    )

    def journal(self, text, reply):
        """Append a turn that showed a learning signal. Most turns show none and are
        skipped, which is what keeps the distiller cheap enough to run at all."""
        try:
            kinds = [k for rx, k in self.SIGNALS if rx.search(text)]
            if not kinds or len(text.split()) < 3:
                return
            # THROUGH THE ADAPTER, not a path built here (PLAN 14.1). `~/.sergio` is
            # owner-only, which makes it the last place to assemble a path at a call site: a
            # path built inline cannot be redirected, so nothing could exercise this without
            # writing the person's real memory directory — and the only reason that never
            # went wrong is that nothing exercised it. `adapters.voice_journal` owns the
            # path, records the turn on the protocol, and reports by returning None.
            if adapters.voice_journal(text, reply, kinds,
                                      session_id=getattr(self, "session_id", ""),
                                      turn_id=f"turn-{getattr(self, 'turn_seq', 0)}"):
                log(f"journalled ({'+'.join(kinds)})")
            else:
                log(f"journal write failed (ignored): {'+'.join(kinds)}")
        except Exception as e:
            log(f"journal failed (ignored): {e}")

    def capture_lesson(self, text):
        """Feed what was just said to the skill-learning CAPTURE hook.

        WHY THIS IS A CALL AND NOT A settings.json HOOK. skill-learn.sh is wired as a
        UserPromptSubmit hook in both brains, and UserPromptSubmit DOES NOT FIRE under
        `-p`. Measured 2026-09-16: a headless correction run against ~/.sergio, which has
        carried that hook for weeks, left the journal at 2 entries. Every voice turn is
        `ash -p`, so the orb has never once contributed a lesson - the only orb-shaped
        entries in the journal came from the interactive terminal pair.py types into.
        ashd already has the text, so it makes the call the hook would have made.

        Free and silent: no model call, ~3 ms, and it only writes when the text looks
        like a correction or an uncovered domain. skill-evolve (05:13) does the thinking.
        Never allowed to affect the turn - a capture failure is a log line, nothing more."""
        hook = Path.home()/".sergio"/"skill-learn.sh"
        if not hook.exists() or not (text or "").strip():
            return
        payload = json.dumps({"prompt": text, "cwd": str(Path.home()),
                              "session_id": f"orb-{int(time.time())}"})
        try:
            subprocess.run([str(hook)], input=payload, text=True, timeout=10,
                           capture_output=True, env=dict(os.environ, SERGE_HOME=str(CFG)))
        except Exception as e:
            log(f"lesson capture skipped: {type(e).__name__}: {e}")

    def ask(self, text, gen, context=""):
        self.capture_lesson(text)
        now = datetime.now()
        prompt = (f"[Voice turn through the orb, {now:%A %B %-d %Y, %-I:%M %p}. This was spoken aloud and "
                  f"your reply will be read out by text-to-speech, so write for the ear: complete, natural "
                  f"sentences, no markdown, lists, code, file paths or letter abbreviations, and numbers "
                  f"written the way they are said. Keep it short by saying fewer things, never by dropping "
                  f"words - a fragment sounds broken, not quick. "
                  f"FIRST decide what this is. "
                  f"A QUESTION IS NOT A JOB. Asked whether you mind being recorded, how your day is, "
                  f"or what you think of something, you answer it — out loud, and that is the whole "
                  f"turn. Do not write a file, do not 'confirm' anything on disk, do not go and do a "
                  f"task nobody asked for: asked if he had objections to being on the internet, you "
                  f"wrote linkedin_confirmation.md into his home directory and narrated it "
                  f"(2026-09-17, on camera). Touch the filesystem only when the thing they asked for "
                  f"IS a file. "
                  f"If they want something done or answered, be Jarvis: quick, assured, one to three "
                  f"sentences, the answer first, and stop. "
                  f"If the answer is something they could LOOK at - a chart, an image, a page, a "
                  f"file you made - put it on screen with `ashshow <path-or-url>` and then say one "
                  f"sentence about it. Do not read out numbers that are legible in the picture; say "
                  f"the thing the picture cannot, like what it means. A deliverable they cannot see "
                  f"was not delivered. "
                  f"If they are just talking - how you are, how their day went, a random thought, a joke, an "
                  f"opinion - that is not a request to process, it is a conversation, and you are good company "
                  f"in it. Be playful and genuinely curious. Have actual opinions and a bit of personality, "
                  f"tease lightly, riff on what they said, and react to the specific thing they told you "
                  f"rather than a generic version of it. Match their energy. It is fine, often good, to ask "
                  f"them something back, the way a friend keeps a chat going. Never describe yourself like a "
                  f"machine - no systems, operational status, efficiency or processing - you are a friend "
                  f"with a dry sense of humour, not a server reporting uptime. Still two or three sentences, "
                  f"because it is spoken. "
                  # the same rules the terminal agent gets, from the same place: how to say it,
                  # in contractions, for someone who started coding last week — and that he
                  # can look at the screen now instead of guessing at it
                  + PLAIN_BRIEF + SEE_BRIEF +
                  f" Either way: address them plainly, with no chief, boss or other nicknames. When they "
                  f"thank you, answer like a friend - 'No problem', 'Anytime', 'Happy to help' - never a "
                  f"stiff 'You are welcome'.]\n\n{context}{text}")
        ash = shutil.which("ash") or str(Path.home()/".local/bin/ash")
        # stream-json, not json: events arrive as the turn runs, which is what lets a
        # STALL be told apart from a turn that is simply working.
        cmd = [ash, "-p", prompt, "--output-format", "stream-json"]
        # WHICH DRIVER (4.13-4.19). Without this the tiers were a library nothing called.
        _route = self.turn_driver(text)
        if not _route["driver"]:
            # "It waits for the reset." An easy task is not worth money because the free
            # seat is asleep, and the person is told rather than left with silence.
            return _route["say"]
        cmd += ["--model", _route["driver"]]
        if _route["say"]:
            # A DOWNGRADE IS NEVER SILENT (4.18). Said BEFORE the turn, not after: a person
            # who learns afterwards that a weaker model answered has already believed it.
            # `then="thinking"`: the turn has not finished, and the default leaves the orb
            # idle while a model is still working — the state the orb draws is the one the
            # person believes.
            #
            # ONCE A DAY, THEN ONLY LOGGED (owner's goal 2026-09-22: never sound like a robot).
            # Since D306 a routing sentence could be said on every login-related task; the same
            # sentence ten times in an afternoon is the machinery talking, not him. The first time
            # today it is spoken; after that it is written to the log and he just gets on with it.
            log(f"route said: {_route['say']}")
            _today = time.strftime("%Y-%m-%d")
            _said = getattr(self, "_route_said_on", None)
            if _said is None:
                _said = self._route_said_on = {}
            if _said.get(_route["say"]) != _today:
                _said[_route["say"]] = _today
                self.speak(_route["say"], gen, then="thinking")
        log(f"route: {_route['driver']} ({_route['tier']}, {_route['source']}) — "
            f"{_route['reason']}")
        if time.time() - self.last_turn < 600:
            cmd.append("--continue")            # a follow-up within 10 minutes keeps the conversation
        t = time.time()
        r, stalled, err = self._run_turn(cmd, gen)
        if stalled and gen == self.gen:
            # 2026-09-14: "what's 2 plus 2" sat 53 s on a Gemini stream that never sent a
            # byte, then failed; the router's fallback answered in 2 s. The router's own
            # stream timeouts were tested against a silent upstream and do not fire, so
            # the deadline lives here: nothing from the model for STALL_S -> another seat.
            # Retry on seats that are actually DIFFERENT from the one that went quiet. This
            # used to retry on "bedrock-brain" — which is also the voice brain's default seat,
            # so a stalled upstream was retried against itself and the user heard "Sorry, I
            # couldn't get an answer just then" after thirty seconds (2026-09-17, twice in three
            # recording takes). Every Gemini seat shares a provider, so the last resort is a
            # different provider altogether.
            primary = self.voice_seat()
            for seat in [s for s in self._free_stall_seats() if s != primary]:
                if not (stalled and gen == self.gen):
                    break
                log(f"no response from the model for {self.STALL_S:.0f} s, retrying on {seat}")
                r, stalled, err = self._run_turn(cmd + ["--model", seat], gen)
        if gen != self.gen: return ""
        self.last_turn = time.time()
        # What "learn what we just did" refers to (PLAN 22.3). Set HERE, at the end of a
        # completed model turn, and deliberately not in `_handle`: set on the way in, the
        # learning verb would capture the words "learn what we just did" — itself — which
        # is the kind of thing nobody notices until the memory store is full of them.
        # Control phrases never reach this method, so they cannot overwrite it either.
        self.last_user_text = text
        reply = (r.get("text") or "").strip()
        log(f"ash: {reply[:160]!r} ({time.time()-t:.1f}s, {r.get('model')})")
        if not reply or r.get("failed") or r.get("blocked"):
            tail = (err or "").strip().splitlines()[-1:] or [r.get("reason") or r.get("failed") or "no output"]
            log(f"ash turn problem: {tail[0][:300]}")
            # An EMPTY answer used to go straight to the apology, because the stall retry only
            # covers a model that sends nothing at all. A turn that runs, produces events and then
            # ends with no text is the same thing to the person listening: 142 seconds of silence
            # followed by "Sorry, I couldn't get an answer just then", on camera (2026-09-17).
            # One retry on a different seat costs a few seconds and usually answers.
            if not reply and not r.get("blocked") and gen == self.gen:
                for seat in [s2 for s2 in self._free_stall_seats() if s2 != self.voice_seat()][:1]:
                    log(f"empty answer after {time.time()-t:.0f}s, retrying on {seat}")
                    r2, _st2, err2 = self._run_turn(cmd + ["--model", seat], gen)
                    if gen != self.gen: return ""
                    again = (r2.get("text") or "").strip()
                    log(f"ash retry: {again[:120]!r} ({r2.get('model')})")
                    if again:
                        return again
            return reply or "Sorry, I couldn't get an answer just then."
        return reply

    STALL_S = 15.0              # silence from the model (not a tool, not a question to you) that counts as stuck
    # Ordered: a different Gemini model first (its own quota and load), then a different
    # provider, because a Google-side stall takes every Gemini seat with it.
    # MEASURED, NOT ASSUMED: `fast-coder` is `mistral/codestral-latest` and classifies as
    # PAID. A stall is a timeout, and 4.6 says a timeout means no — so retrying a stalled
    # free turn onto a paid seat, unasked, was the daemon spending money on exactly the
    # event the policy names. §6: a rate-limited free seat waits; being briefly busy is not
    # a reason to spend money.
    #
    # The list is filtered by CLASSIFICATION rather than trusted as typed, because the name
    # is never the evidence (§6) — `fast-coder` reads free and is not, and the next seat
    # somebody adds here will be judged the same way rather than by how it sounds.
    #
    # AND THE ORDER MUST ESCAPE THE STALL (D291's finding, applied here). `cloud-brain` is
    # gemini-3.8-flash, and that is one of the five models in `bedrock-brain`'s stripe — so
    # "a different Gemini model" was the same models that had just stalled. Gemini quota and
    # load are per MODEL, so the two lite seats after it are the real way out: free, and
    # sharing none of the primary's models. Lite answers less well; after 15 s of silence an
    # answer that is a little worse beats a second silence. TR.10h judges this list against
    # the router, not the names.
    STALL_SEATS = ("cloud-brain", "free-flash25", "free-flash")

    def _free_stall_seats(self):
        """The stall seats that are actually free, and a log line for any that are not."""
        try:
            sb = _seatbroker()
        except Exception:
            return []
        out = []
        for s in self.STALL_SEATS:
            try:
                if sb.classify(s) == "free":
                    out.append(s)
                else:
                    log(f"stall retry: skipping {s} — it classifies paid, and a timeout "
                        f"means no (4.6)")
            except Exception:
                log(f"stall retry: skipping {s} — cannot classify it, so it is not free")
        return out

    # ── which driver owns this turn (PLAN 4.13-4.19) ───────────────────────────────────
    # `turnroute` was a library nothing imported: `route()` and `may_spend()` were tested,
    # green, and governed no real turn. A routing policy that no turn passes through is a
    # document, and the ledger would have shown every turn on the configured seat while the
    # suite said the tiers worked.
    #
    # THE CLASSIFIER IS NOT ON THE CONVERSATIONAL PATH. `route()` asks the cheap seat
    # whenever its local rules say easy — which for a voice assistant is every "what's the
    # weather" — and that is a model round trip added to the spoken latency budget, in front
    # of an answer that was never going to need a premium driver. `is_work` already tells a
    # request to DO something from a conversation, so only work is classified. A chat goes
    # straight to the free driver with no call at all.
    def turn_driver(self, text, source=None):
        """`{driver, say, ...}` for this turn, or a driver of "" meaning do not run it."""
        import turnroute
        src = source or turnroute.INTERACTIVE
        work = is_work(text or "")
        try:
            decision = turnroute.route(
                text or "", source=src,
                seat_call=_seatbroker().call if work else None,
                hard_available=not self._hard_unavailable(),
                hard_unavailable_because=self._hard_unavailable(),
                # 4.18: it was the literal True, so the daily-quota branch could never fire
                # from a real turn. The ledger already records a spent day as `quota-day`.
                easy_available=not _seatbroker().easy_quota_gone(turnroute.EASY))
        except Exception as e:
            # A ROUTER THAT CANNOT DECIDE MUST NOT BE A DAEMON THAT CANNOT ANSWER. The free
            # driver is the default for a reason; falling back to it is the safe direction
            # and the only one that cannot spend money by accident.
            log(f"turnroute: {type(e).__name__}: {e}; free driver")
            return {"driver": turnroute.EASY, "say": "", "tier": "easy",
                    "reason": f"router error: {type(e).__name__}", "source": "fallback",
                    "rules": [], "review_required": False, "standing_approval": False}
        try:
            _seatbroker().record({"t": time.time(), "purpose": "turn-route",
                                  "requested": decision["driver"] or "(deferred)",
                                  "tier": decision["tier"], "why": decision["reason"],
                                  "decided_by": decision["source"],
                                  "turn_source": src,
                                  "standing_approval": decision["standing_approval"],
                                  "classified": bool(work)})
        except Exception:
            pass
        return decision

    @staticmethod
    def _hard_unavailable():
        """The reason the premium driver is unusable, or "". Fetch, then delegate.

        The DECISION lives in `turnroute.hard_unavailable_reason` so a check can drive it
        with a fixture table; this half only has to read the router and hand over whatever
        it got, including the exception.
        """
        import turnroute
        try:
            deps = _seatbroker()._deployments() or {}
        except Exception as e:
            return turnroute.hard_unavailable_reason(None, error=e)
        return turnroute.hard_unavailable_reason(deps)

    @staticmethod
    def voice_seat():
        """The seat a voice turn uses when no --model is passed: the voice brain's setting."""
        try:
            return json.loads((CFG/"settings.json").read_text()).get("model") or ""
        except Exception:
            return ""
    PAGE_S = 30.0               # longest a single page fetch or web search may hold a spoken turn

    def _run_turn(self, cmd, gen):
        """Run one ash turn. Returns (result, stalled, stderr).

        Progress is any event on stdout: a token, a tool starting, a tool result.
        Between `tool` and its `tool_result` a slow command is legitimately silent,
        and while _ask_loop is waiting on the user nothing is expected either - the
        stall clock only runs when the model itself owes an answer."""
        env = self.agent_env()
        import tempfile
        fo, fe = tempfile.TemporaryFile("w+"), tempfile.TemporaryFile("w+")
        with self.lock:
            if gen != self.gen: return {}, False, ""
            self.proc = subprocess.Popen(cmd, cwd=Path.home(), env=env, stdout=fo, stderr=fe,
                                         text=True, start_new_session=True)
            p = self.proc
        started = time.time()
        deadline = started + 150
        last_progress, offset, buf, in_tool, stalled = started, 0, "", False, False
        tool_name, tool_t, slow_page = None, 0.0, False
        result = {}
        self.turn_active = True
        while p.poll() is None and gen == self.gen:
            chunk = os.pread(fo.fileno(), 65536, offset)
            if chunk:
                offset += len(chunk); last_progress = time.time()
                buf += chunk.decode("utf-8", "replace")
                *lines, buf = buf.split("\n")
                for line in lines:
                    try: ev = json.loads(line)
                    except Exception: continue
                    if ev.get("type") == "tool": in_tool, tool_name, tool_t = True, ev.get("name"), time.time()
                    elif ev.get("type") in ("tool_result", "token"): in_tool = False
            # A web fetch is a tool, so the stall clock never saw it - and a dashboard behind a login
            # held a turn for 78 s (2026-09-14). Commands can be legitimately long; a page is not.
            if in_tool and tool_name in ("WebFetch", "WebSearch") and time.time() - tool_t > self.PAGE_S:
                slow_page = True
                try: os.killpg(p.pid, 9)
                except ProcessLookupError: pass
                break
            if self.asking or in_tool:
                last_progress = time.time()            # waiting on you or on a command is not a stall
                deadline += 0.1
            if time.time() - last_progress > self.STALL_S:
                stalled = True
            if stalled or time.time() > deadline:
                try: os.killpg(p.pid, 9)
                except ProcessLookupError: pass
                if not stalled: fe.write("\ntimed out after 150 s")
                break
            time.sleep(0.1)
        p.wait()
        self.turn_active = False
        fo.seek(0); fe.seek(0)
        out, err = fo.read(), fe.read()
        for line in reversed(out.strip().splitlines()):
            try: ev = json.loads(line)
            except Exception: continue
            if ev.get("type") == "result":
                result = ev; break
        if slow_page:
            result = {"text": "That page was taking too long to load, so I stopped waiting on it."}
            log(f"{tool_name} ran past {self.PAGE_S:.0f} s, stopped")
        return result, stalled, err

    # ---- task lists --------------------------------------------------------------
    # "start a task list (with N tasks)" -> how many -> one by one or all at once ->
    # each task -> run. In a linked terminal the CLI keeps the list (its todo tool,
    # agents via its Task tool); otherwise workboard.WorkBoard runs them and the orb
    # shows the list.
    def dialog_say(self, text, gen):
        self.dialog["t"] = time.time()
        self.speak(text, gen, then="listening")

    # ---- troubleshoot mode -------------------------------------------------------
    # "troubleshoot mode" -> what's broken? -> the method is typed into the linked
    # terminal (troubleshoot.py), where the work happens. The mode is a way of
    # WORKING, not a different brain: measure first, suspect our own code, a table
    # with a test row per fault, no box checked until its test runs.
    def warn_if_weak_seat(self, gen):
        """Tell them once when the strong seat is out, instead of letting them work
        it out from a bad build. Never blocks the work - the probe is cached and a
        failure to probe is not a failure to run."""
        try:
            if strong_seat_alive():
                return
        except Exception:
            return
        if time.time() - getattr(self, "_weak_said", 0) < SEAT_PROBE_TTL:
            return
        self._weak_said = time.time()
        self.speak("Heads up — my main model isn't answering right now, so I'm on a weaker one. "
                   "I'll still do it, but watch me more closely than usual.", gen)

    def troubleshoot_start(self, gen, say=None):
        if not ash_terminal_open():
            log("troubleshoot: no interactive ash running, opening one")
            opened = time.time()
            if not open_ash_terminal():
                return self.speak("I couldn't get a terminal open just then — there may be a dead "
                                  "console window in the way. Close it and ask me again.", gen)
            self.pair_action("pair.start", since=opened)
            self.dialog = {"kind": "troubleshoot", "step": "problem", "misses": 0, "t": time.time()}
            return self.dialog_say("Opening my terminal and linking it up. What's broken?", gen)
        # A link already up is LEFT ALONE: pair_action("pair.start") restarts pair.py,
        # which would drop the link and reset what the narrator has already said.
        if not (self.pair is not None and self.pair.poll() is None):
            self.pair_action("pair.start")
        self.dialog = {"kind": "troubleshoot", "step": "problem", "misses": 0, "t": time.time()}
        return self.dialog_say(say or "Troubleshoot mode. What's broken?", gen)

    def _troubleshoot_send(self, problem, gen):
        self.dialog = None
        try:
            send_to_terminal(troubleshoot.instruction(problem))
        except OSError as e:
            log(f"troubleshoot: could not reach the terminal: {e}")
            return self.speak("I can't reach the terminal — is Ash still open in it?", gen,
                              then=self.after_reply())
        log(f"troubleshoot: sent — {problem[:80]}")
        return self.speak(random.choice(["On it. I'll reproduce it before I touch anything.",
                                         "Right — let me reproduce that first, then I'll write it up.",
                                         "Got it. Measuring before I guess."]),
                          gen, then=self.after_reply())

    def tasklist_start(self, text, gen):
        self.dialog = {"kind": "tasklist", "step": "count", "n": None, "mode": None, "tasks": [],
                       "misses": 0, "t": time.time()}
        log("task list: started")
        n = workboard.parse_count(text)
        if n: return self._tl_count(n, gen)
        self.dialog_say(random.choice(["No problem! How many tasks would you like?",
                                       "Sure thing! How many tasks are we doing?",
                                       "Love it. How many tasks would you like?"]), gen)

    def _tl_count(self, n, gen):
        d = self.dialog
        if n > workboard.MAX_TASKS:
            n, pre = workboard.MAX_TASKS, f"I can juggle up to {workboard.MAX_TASKS} at once, so let's do {workboard.MAX_TASKS}. "
        else:
            pre = f"{n} task{'s' if n != 1 else ''}, got it. "
        d.update(n=n, misses=0)
        if n == 1:
            d.update(mode="sequential", step="collect")
            return self.dialog_say(pre + "What's the task?", gen)
        d["step"] = "mode"
        self.dialog_say(pre + "Would you like them done one by one, or all at once with agents?", gen)

    def _tl_miss(self, question, gen):
        d = self.dialog
        d["misses"] += 1
        if d["misses"] > 2:
            self.dialog = None
            return self.speak("Let's pick this up later. Just say start a task list when you're ready.",
                              gen, then=self.after_reply())
        self.dialog_say(question, gen)

    def dialog_step(self, text, gen):
        d = self.dialog
        if d["kind"] == "troubleshoot":
            # Anything they say here is the description of the fault - it is not
            # parsed, it is handed over whole, because the detail in their own words
            # is the evidence he starts from.
            if len(text.split()) < 2:
                d["misses"] += 1
                if d["misses"] > 2:
                    self.dialog = None
                    return self.speak("Let's pick it up when you can show me. Say troubleshoot mode "
                                      "again when you're ready.", gen, then=self.after_reply())
                return self.dialog_say("What's going wrong?", gen)
            return self._troubleshoot_send(text, gen)
        if d["step"] == "count":
            n = workboard.parse_count(text)
            return self._tl_count(n, gen) if n else self._tl_miss("Sorry, how many tasks was that?", gen)
        if d["step"] == "mode":
            m = workboard.parse_mode(text)
            if not m: return self._tl_miss("One by one, or all at once with agents?", gen)
            d.update(mode=m, step="collect", misses=0)
            return self.dialog_say(("One by one it is. " if m == "sequential"
                                    else "All at once, I'll spin up agents. ") + "What's task one?", gen)
        if d["step"] == "collect":
            # They guessed the count high and have run out — take what they have
            # instead of forcing them to pad the list (2026-09-14).
            if workboard.is_no_more(text):
                if d["tasks"]:
                    self.dialog = None
                    return self.tasklist_run(d, gen)
                return self._tl_miss("We haven't got a task yet. What's the first one?", gen)
            d["tasks"].append(workboard.clean_task(text))
            k = len(d["tasks"])
            log(f"task list: task {k}/{d['n']}: {d['tasks'][-1]!r}")
            if k < d["n"]:
                ask = "And the last one?" if k + 1 == d["n"] else random.choice(
                    [f"Got it. Task {k+1}?", f"Nice. What's task {k+1}?", f"Okay! Task {k+1}?"])
                return self.dialog_say(ask, gen)
            self.dialog = None
            return self.tasklist_run(d, gen)

    def tasklist_run(self, d, gen):
        items = [with_folder(t) for t in d["tasks"]]
        mode, n = d["mode"] or "sequential", len(items)
        how = "one by one" if mode == "sequential" else "all at once"
        if self.pair and self.pair.poll() is None and terminal_inbox_open():
            send_to_terminal(workboard.cli_instruction(items, mode))
            log(f"task list -> terminal ({n}, {mode})")
            return self.speak(f"Sent to the terminal. He'll put the {n} tasks on his list and work through them {how}.",
                              gen, then=self.after_reply())
        if self.board and not self.board.finished:
            return self.speak("There's already a task list running. Say cancel the task list if you want a fresh one.",
                              gen, then=self.after_reply())
        between = self._between_tasks if mode == "sequential" and n > 1 else None
        self.board = workboard.WorkBoard(items, mode, self.agent_env(), on_done=self._board_done,
                                     log=log, on_between=between).start()
        log(f"task list -> board ({n}, {mode})")
        tail = " I'll check in with you between each." if between else ""
        self.speak(f"On it! Your task list is up on screen, and I'm doing them {how}.{tail}", gen, then=self.after_reply())

    def _between_tasks(self, done_idx, total):
        """Board gate: task `done_idx` just finished; ask before task `done_idx+1`.
        Runs in the board's worker thread and blocks it until the user answers —
        the same yes/no slot the permission prompt uses."""
        # Let the just-finished task's own state settle, then ask.
        while self.hearing or self.state == "speaking":
            time.sleep(0.2)
        return self.ask_yes_no(f"Task {done_idx} is done. Want me to carry on with task {done_idx + 1}?",
                               self.gen, reprompt="Was that a yes or a no on the next task?",
                               label="next-task", default=False)

    def _board_done(self, board):
        if board.cancelled: return
        n = len(board.tasks)
        ok = sum(t["status"] == "done" for t in board.tasks)
        msg = (("It's done!" if n == 1 else "Both tasks are done!" if n == 2 else f"All {n} tasks are done!") if ok == n else
               f"{ok} of {n} tasks are done. The rest didn't finish, and they're marked on the list.")
        while self.hearing or self.asking or self.state == "speaking":
            time.sleep(0.2)
        self.speak(msg, self.gen, then=self.after_reply())

    def agent_env(self):
        """Environment for any headless ash ashd starts (its own turns, task agents):
        the voice profile, plus the hook that turns permission prompts into spoken questions."""
        ash = shutil.which("ash") or str(Path.home()/".local/bin/ash")
        engine = Path(ash).resolve().parent/"engine"/"src"/"permissions.mjs"
        return dict(os.environ, ASH_HOME=str(CFG), ASHD_ASK_DIR=str(self.askdir),
                    ASHD_PERMISSIONS_MODULE=str(engine), ASHD_ASK_TIMEOUT="75")

    def _write_prefs(self):
        """Merge and write ashd-prefs.json atomically.

        The whole dict was written over whatever was there. Two sources touch this file —
        spoken tts.* commands and a hand edit between turns — so a "louder" would silently
        revert an edit made a minute earlier, and a truncating write left a window where a
        reader saw nothing at all."""
        import fcntl as _fcntl
        import threading as _th
        # THE READ AND THE WRITE ARE ONE OPERATION (PLAN 11.4_t). Merging on read fixed the
        # case where a hand edit landed BETWEEN turns, which is what N.1 covers. It does
        # nothing for an edit that lands between this read and this write — the window is
        # small and the loser is silent, which is the definition of the bug worth locking
        # for. `tutor.write` took exactly this lock for exactly this reason in 6.10 and the
        # prefs path, with the same three writers and the same read-modify-write, never did.
        #
        # Same flock idiom as term.lock, speech.lock and tutor-state.lock. It costs nothing
        # uncontended, and a lock that cannot be opened is not fatal: losing a volume setting
        # must not take the turn down, which is N.4's rule and applies here too.
        lk = None
        try:
            PREFS.parent.mkdir(parents=True, exist_ok=True)
            lk = open(_PREFS_LOCK, "w")
            _fcntl.flock(lk, _fcntl.LOCK_EX)
        except OSError:
            lk = None
        try:
            try:
                on_disk = json.loads(PREFS.read_text())
                if not isinstance(on_disk, dict):
                    on_disk = {}
            except (OSError, ValueError):
                on_disk = {}
            on_disk.update(self.prefs)
            self.prefs = on_disk
            tmp = PREFS.with_suffix(f".{os.getpid()}.{_th.get_ident()}.tmp")
            try:
                tmp.write_text(json.dumps(on_disk, indent=2))
                os.replace(tmp, PREFS)
                return True
            except OSError as e:
                log(f"prefs not saved: {e}")
                try: tmp.unlink(missing_ok=True)
                except OSError: pass
                return False
        finally:
            if lk:
                try:
                    _fcntl.flock(lk, _fcntl.LOCK_UN)
                finally:
                    lk.close()

    def approve_paid_seat(self, alias, purpose):
        """The `approve` callback seatbroker calls when a paid seat is the only way forward.

        PLAN 4.5: asked ONCE for the logical turn, bound to the generation that asked. It
        rides the same spoken yes/no the permission questions use — `ask_yes_no` speaks,
        opens the mic, and returns False on silence after 20 s — so there is no second
        approval mechanism to keep honest.

        4.6: the approval is remembered against `self.turn_seq` — the LOGICAL TURN, not
        `self.gen`. `gen` bumps on a cancel and on nothing else, so two ordinary turns in a
        row share one, and keying on it meant an approval given for a lesson silently
        covered the next unrelated request. A restart loses the approval entirely, which is
        the safe direction.
        """
        gen = self.gen
        turn = getattr(self, "turn_seq", 0)
        cached = getattr(self, "_paid_ok", None)
        if cached and cached[0] == turn:
            log(f"paid seat {alias} for {purpose}: reusing this turn's approval")
            return (cached[1], cached[2])
        ok = self.ask_yes_no(
            f"My free models can't do {purpose} right now. Shall I use a paid one?",
            gen, label="paid seat", default=False, trusted_only=True)
        # The id belongs to the ANSWER, not to the call that happened to ask. One spoken yes
        # can cover several broker calls in a turn, and minting a fresh id inside each of
        # them gave the ledger unrelated ids for one decision — nothing to join on, which is
        # the whole point of 4.9. Raised by Codex's second pass.
        approval_id = uuid.uuid4().hex[:12]
        self._paid_ok = (turn, ok, approval_id)
        log(f"paid seat {alias} for {purpose}: {'approved' if ok else 'refused'} "
            f"(turn {turn}, approval {approval_id})")
        if not ok:
            self.speak("Alright, staying on the free ones.", gen, then="thinking")
        return (ok, approval_id)

    def _learn_panel_loop(self):
        """Keep the learning panel fresh, and carry out what it asks (PLAN 22.1).

        Faster than the day panel because this one is INTERACTIVE: somebody presses KEEP and
        expects the card to go. A five-minute tick there is fine for an agenda that moves in
        hours; here it would read as a button that does nothing.

        The action file is a slot with one writer (the orb) and one reader (this), consumed
        by RENAMING it away before acting — so a crash between reading and applying cannot
        replay the decision, and two ticks cannot both act on one press.
        """
        import learnpanel
        last = 0.0
        act = CFG/"learn-action.json"
        while getattr(self, "running", True):
            try:
                if act.exists():
                    # TAKEN, then read. The claim is the rename (6.5's pattern, copied from
                    # `pair.py` before it was retired): whoever renames it owns it.
                    mine = act.with_suffix(f".taken.{os.getpid()}")
                    try:
                        os.replace(act, mine)
                    except OSError:
                        mine = None
                    if mine is not None:
                        try:
                            req = json.loads(mine.read_text())
                            ok, say = learnpanel.apply_action(
                                str(req.get("id") or ""), str(req.get("action") or ""),
                                source=str(req.get("source") or ""))
                            log(f"learn panel: {req.get('action')} {req.get('id')} -> {ok} {say}")
                        except Exception as e:
                            log(f"learn action failed: {type(e).__name__}: {e}")
                        finally:
                            try:
                                mine.unlink(missing_ok=True)
                            except OSError:
                                pass
                        last = 0.0                 # repaint now, not on the next tick
                if time.time() - last >= self.LEARN_PANEL_SECONDS:
                    learnpanel.write_panel_state()
                    last = time.time()
            except Exception as e:
                log(f"learn panel: {type(e).__name__}: {e}")
            time.sleep(1)

    def _day_panel_loop(self):
        """Keep `day-state.json` fresh for the orb's day panel (PLAN C2.4).

        Slow on purpose. Reading EDS spawns a system-python child, and an agenda changes on
        the order of hours — polling it every few seconds would buy nothing and cost a
        process each time. Writes happen here on a timer and at the moment the day CHANGES,
        which is `_refresh_day_panel`, called from the booking and cancelling paths: a panel
        that takes five minutes to show what you just booked has failed the product test,
        and one that re-reads constantly to guarantee it has not is paying for the same
        answer all day.

        `self.running` rather than `while True`: a loop with no exit cannot be stopped by a
        test, and the one thing that made `_typed_loop` unstoppable was that there was
        nothing to ask (D223). Nothing clears the flag in production.
        """
        import day
        while getattr(self, "running", True):
            try:
                day.write_panel_state()
            except Exception as e:
                # NEVER FATAL, and never silent. A calendar that cannot be read is an
                # ordinary state this panel is built to show; a thread that dies on it
                # leaves the panel frozen on yesterday with nothing saying so.
                log(f"day panel: {type(e).__name__}: {e}")
            # ONE EXIT, and the wait breaks out to it rather than returning past it. The
            # first version returned from here, which left the `while` condition above unable
            # to be the thing that ever ended this loop — a guard behind a guard, found by
            # planting `while True:` and watching nothing go red (D217's class, third time).
            for _ in range(self.DAY_PANEL_SECONDS):
                if not getattr(self, "running", True):
                    break
                time.sleep(1)

    def _refresh_day_panel(self):
        """Push the day panel forward now, because something just changed it."""
        try:
            import day
            day.write_panel_state()
        except Exception as e:
            log(f"day panel refresh: {type(e).__name__}: {e}")

    def _typed_loop(self):
        """The text box in the orb writes typed.json; this runs it as a turn.

        For when you do not feel like talking. It cancels whatever he is doing the
        same way a spoken barge-in would, so typing while he is mid-sentence stops
        him rather than queueing behind him."""
        f = CFG/"typed.json"
        # The box overwrites one slot rather than appending, so whatever is sitting
        # there now was typed on a previous run and already answered. Start from its
        # stamp, or a restart replays that line out loud as if it had just been typed.
        last = 0.0
        try:
            if f.exists(): last = float(json.loads(f.read_text()).get("t", 0.0))
        except Exception as e:
            log(f"stale typed input ignored: {e}")
        # A LOOP WITH NO WAY OUT. This was `while True:`, so the only thing that ever
        # stopped it was the process ending — which is fine for a daemon and not fine for
        # anything that borrows it. `test_adapters` lifts this loop out and runs it against a
        # fake slot; with no exit the thread outlived the block that started it and went on
        # polling through every later fixture, which is how a suite fails somewhere nobody
        # was looking (raised by Codex's audit).
        #
        # `self.running` is set once in `__init__` and nothing in production ever clears it,
        # so the behaviour here is unchanged. Four other `while True:` loops in this file
        # have the same gap; they are left alone deliberately rather than swept, because a
        # shutdown path nobody has designed is not something to add to five places at once.
        while getattr(self, "running", True):
            try:
                # Through the adapter (PLAN 6.15): identical reading semantics, proven
                # against this loop's original comparison on nine cases, plus a journal
                # entry whose `source` is BOUND to the orb rather than claimed. The slot is
                # still the transport; the journal is the record until every producer moves.
                text, last, src = adapters.typed_input_src(last)
                if text:
                    # Typing wakes him regardless of sleep (user, 2026-09-14):
                    # if he was asleep his mic was drained, so wake so the
                    # answer's follow-up is heard and the next wake word works.
                    if getattr(self, "asleep", False):
                        self.asleep = False
                        adapters.set_sleep(False, source="ashd")
                        log("awake (typed input)")
                    if self.state != "idle":
                        self.cancel()
                    self.set_state("thinking")
                    threading.Thread(target=self.handle,
                                     args=(None, self.gen),
                                     kwargs={"typed": text, "typed_source": src},
                                     daemon=True).start()
            except Exception as e:
                log(f"typed input ignored: {e}")
            time.sleep(0.25)

    def _ask_loop(self):
        """Permission questions from EVERY headless ash ashd started - its own turn or
        a background task agent - asked out loud one at a time, answered by file."""
        # 4.8 — a question IN FLIGHT across a restart used to be deleted here along with the
        # stale ones, so the hook that wrote it waited out its 75-second timeout and the
        # engine recorded a denial nobody was asked about. Only answers and genuinely old
        # requests are cleared; a fresh ask-*.json is picked up and asked.
        now = time.time()
        for f in self.askdir.glob("*.json"):
            fresh = f.name.startswith("ask-") and (now - f.stat().st_mtime) < ASK_INFLIGHT_S
            if fresh:
                log(f"permission: resuming {f.name} from before the restart")
                continue
            f.unlink(missing_ok=True)
        # `asked` is in-memory, so a restart re-asks anything it has not answered yet. That is
        # the right way round: re-asking is noise, silently dropping is a denial nobody heard.
        asked = set()
        while True:
            time.sleep(0.15)
            for f in sorted(self.askdir.glob("ask-*.json")):
                try: req = json.loads(f.read_text())
                except Exception: continue
                if req.get("id") in asked: continue
                asked.add(req.get("id"))
                while self.hearing: time.sleep(0.1)
                self.asking = True
                try: ok = self.ask_permission(req, self.gen)
                finally: self.asking = False
                tmp = self.askdir/f"answer-{req['id']}.json.tmp"
                tmp.write_text(json.dumps({"answer": "yes" if ok else "no"}))
                os.replace(tmp, self.askdir/f"answer-{req['id']}.json")
                if not self.turn_active and self.state == "thinking":
                    self.set_state("idle")              # a background agent's question: nothing else is waiting

    # A linked coding session emits MANY text messages per task — progress
    # reports, claims-gate restatements, promoted reasoning. Spoken verbatim they
    # bury the answer and fall behind the terminal (measured 2026-09-14: six
    # near-identical "completed Task 1" replies, all spoken). So a reply is only
    # spoken if it is NEW: not a near-duplicate of the last one, and not internal
    # machinery. Seat-agnostic, the same principle as the engine's loop-guard.
    REPLY_DEDUP_WINDOW = 150.0      # seconds a prior reply suppresses a near-duplicate
    REPLY_DEDUP_RATIO  = 0.82       # >= this normalised similarity counts as the same reply

    def _reply_is_new(self, text):
        """False for promoted reasoning, and for a reply that repeats the last
        one. The window is generous because a coding turn restates the same
        summary over minutes, not seconds."""
        if speakable.is_internal(text):
            return False
        prev, when = self._last_reply
        if prev and time.time() - when < self.REPLY_DEDUP_WINDOW \
                and speakable.similar(text, prev) >= self.REPLY_DEDUP_RATIO:
            return False
        return True

    def _say_loop(self):
        """Voice for the linked terminal. pair.py writes {kind, text, t} files:
        "reply" is his finished answer (spoken while replies are on, unless it
        repeats the last one), "narrate" is a tool description (dropped if stale
        or if he is already talking)."""
        SAY_DIR.mkdir(exist_ok=True)
        for f in SAY_DIR.glob("*.json"): f.unlink(missing_ok=True)      # nothing from before this daemon
        while True:
            time.sleep(0.2)
            files = sorted(SAY_DIR.glob("*.json"))
            # Burst collapse: when several replies are queued at once, only the
            # newest matters — the earlier ones are superseded progress, and
            # speaking them just puts him further behind. Drop all but the last.
            reply_files = [f for f in files if f.name.split("-", 1)[-1].startswith("reply")]
            superseded = set(reply_files[:-1])
            for f in files:
                if f in superseded:
                    f.unlink(missing_ok=True)
                    continue
                try: item = json.loads(f.read_text())
                except Exception: item = None
                f.unlink(missing_ok=True)
                if not item or not (item.get("text") or "").strip(): continue
                if item.get("t", 0) <= getattr(self, "stopped_at", 0.0):
                    log(f"say dropped (stopped): {str(item.get('text'))[:60]!r}")
                    continue                                  # queued before a stop: never said
                if getattr(self, "asleep", False): continue    # asleep means quiet, too
                kind = item.get("kind")
                # Narration is PACED by pair.py (~once a minute), so a queued line is
                # legitimately a few seconds old by the time it's picked up - the old
                # 4 s staleness drop threw almost all of them away. 90 s keeps it fresh
                # without discarding paced progress. Talking-over-himself is handled by
                # the speech lock below (it waits), not by dropping the line here.
                # "alert" is the screen waiting for a keypress (voice-permission.sh).
                # It is not narration and not a reply: no flag gates it and it is
                # never dropped as stale, because the build is stopped until it is
                # answered and a dropped alert is a session sitting there silently
                # (user, 2026-09-15: "at least have him let us know").
                if kind == "narrate" and (not self.pair_flags["narrate"]
                                          or time.time() - item.get("t", 0) > 90): continue
                if kind == "reply" and not self.pair_flags["replies"]: continue
                # one finish per finish
                if kind == "reply" and is_completion(item.get("text")):
                    last = getattr(self, "_said_done_at", 0.0)
                    if time.time() - last < DONE_QUIET:
                        log(f"say: dropped a repeat completion ({int(time.time()-last)}s after the first)")
                        continue
                    self._said_done_at = time.time()
                text = item["text"]
                if kind == "narrate":
                    text = speakable.narration_line(text)
                    if not text:
                        continue
                if kind == "reply":
                    if not self._reply_is_new(text):
                        log(f"say skipped (repeat/internal): {text[:80]!r}")
                        continue
                    text = speakable.strip_internal(text) or text
                    # ...and then say it the way a person would. speakable() has
                    # existed since the Phase 7 work and was never actually called
                    # on this path, so replies went to the voice with backticks,
                    # paths, `&&` and claims-gate jargon intact (2026-09-15).
                    spoken = speakable.for_the_ear(text)
                    if not spoken:
                        log(f"say skipped (internal only): {text[:80]!r}")
                        continue          # the whole reply was machinery: say nothing
                    text = spoken
                while self.hearing:                 # never over the user mid-sentence
                    time.sleep(0.1)
                prev = self.state
                then = self.after_reply(text) if kind == "reply" else (prev if prev in ("idle", "thinking") else "idle")
                # The voice loads in a background thread (misaki made that ~7 s). A reply that
                # arrived first used to hit a half-built Voice, raise, and leave the orb stuck on
                # SPEAKING with nothing coming out. Wait for it, like a spoken turn already does.
                self.models_ready.wait()
                log(f"say ({kind}): {text[:100]!r}")
                if kind == "reply":
                    self._last_reply = (item["text"], time.time())
                try: self.speak(text, self.gen, then=then)
                except Exception as e:
                    log(f"say failed: {type(e).__name__}: {e}")
                    self.set_state("idle")              # never leave him showing SPEAKING in silence

    # He sometimes ends the conversation himself ("I'll see you around"). Holding the mic
    # open after a goodbye is what makes him feel like he won't let you leave.
    FAREWELL = re.compile(r"\b((bye|goodbye)( for now)?|good night|see you( around| later| soon| then)?|see ya|"
                          r"catch you later|talk (to you )?(later|soon)|take care|have a good (one|night|day))"
                          r"\W*$", re.I)

    def after_reply(self, reply=""):
        """Where an answer leaves him: still listening, unless follow_up is 0 or he said goodbye."""
        if reply and self.FAREWELL.search(reply.strip()):
            return "idle"
        return "listening" if float(self.prefs.get("follow_up", 8.0)) > 0 else "idle"

    def speak(self, text, gen, then="idle"):
        """Never over himself: the whole utterance holds SPEECH_LOCK (an flock, so a
        second daemon, pair.py narration or a test waits its turn too), and pw-play
        only exits once its audio has actually finished (measured: 2.0 s -> 2.04 s)."""
        if not text: return self.set_state("idle" if then == "listening" else then)
        # Never say the same thing twice. The opener is rotated on purpose (speakable
        # _OPENERS) so consecutive lines do not sound alike, which is exactly why a plain
        # string comparison never caught anything: on 2026-09-17 the same sentence went out
        # three times in eight seconds with "Then", "Okay," and nothing in front of it.
        # speakable.repeats strips the opener before comparing.
        import collections as _c
        from speakable import clamp_spoken as _clamp, repeats as _repeats, from_report as _report
        # A written answer is not a spoken one. The final text of a coding turn arrives as
        # a report — markdown, numbered findings, a paragraph written for the claims gate —
        # and it used to go to the speaker word for word, list numbers and all. That, not
        # the synthesiser, is why he sounded like a robot on some turns and human on others.
        said = _report(text)
        if not said:
            log(f"nothing a person would say in that reply, staying quiet: {text[:70]}")
            return self.set_state("idle" if then == "listening" else then)
        text = said
        # One short sentence per build pass is what the brief asks for and nothing enforced
        # it — a single pass went out as three sentences and 55 words. Whole sentences only:
        # a line cut mid-clause leaves the listener waiting for an ending.
        text, _trimmed = _clamp(text)
        if _trimmed:
            log(f"trimmed a long spoken line to {len(text.split())} words")
        recent = getattr(self, "_recent_said", None)
        if recent is None:
            recent = self._recent_said = _c.deque(maxlen=8)
        now_t = time.time()
        while recent and now_t - recent[0][1] > 120:
            recent.popleft()
        if _repeats(text, [t for t, _ in recent]):
            log(f"already said that, not repeating: {text[:70]}")
            return self.set_state("idle" if then == "listening" else then)
        recent.append((text, now_t))
        # ...and what he actually said back, after shaping and trimming, because the reply a
        # later session should read is the one that was spoken, not the report it came from.
        try:
            adapters.turn_reply(text, source="ashd",
                                turn_id=f"turn-{getattr(self, 'turn_seq', 0)}")
        except Exception:
            pass
        with open(SPEECH_LOCK, "w") as lk:
            fcntl.flock(lk, fcntl.LOCK_EX)
            try:
                if gen != self.gen: return
                self._speak(text, gen)
            finally:
                fcntl.flock(lk, fcntl.LOCK_UN)
        if gen == self.gen:
            self.set_state(then, **({"follow_up": True} if then == "listening" else {}))

    def _speak(self, text, gen):
        try: self.prefs.update(json.loads(PREFS.read_text()))   # pace/volume edits apply without a restart
        except Exception: pass
        self.set_state("speaking", reply=text[:500])
        self.voice.base_speed = self.voice_base_speed*self.prefs["speed"]
        self.voice.energy = float(self.prefs.get("energy", self.voice_base_energy))
        self.voice.pitch = float(self.prefs.get("pitch", self.voice_base_pitch))   # live depth knob
        if self.a.play_to:
            for audio, sr in self.voice.stream(text):
                if gen != self.gen: return
                self.out_wav.append(audio*self.prefs["volume"])
        else:
            with self.lock:
                if gen != self.gen: return
                self.proc = subprocess.Popen(
                    ["pw-play", "--raw", "--rate", "24000", "--channels", "1", "--format", "f32",
                     "--volume", f"{self.prefs['volume']:.2f}", "-"],
                    stdin=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
                p = self.proc
            try:
                heard_until = 0.0                # when the audio already queued in pw-play finishes
                for audio, sr in self.voice.stream(text):
                    if gen != self.gen: break
                    # phrases synthesise faster than real time, so each one queues behind the last
                    start = max(time.time() + PLAY_LATENCY, heard_until)
                    heard_until = start + len(audio)/sr
                    write_state(state="speaking", reply=text[:500],
                                env=envelope(audio, sr), env_hz=ENV_HZ, env_t0=round(start, 3))
                    p.stdin.write(audio.astype(np.float32).tobytes())
                p.stdin.close()
                p.wait()
            except (BrokenPipeError, ValueError):
                pass                             # cut off by a barge-in

    # ---- yes/no by voice ---------------------------------------------------
    def ask_yes_no(self, question, gen, reprompt="Sorry, was that a yes or a no?",
                   label="confirm", default=False, trusted_only=False):
        """Speak a question, open the mic, and return True/False for the spoken
        yes or no (one reprompt on an unclear answer). The same slot the permission
        prompt uses, so nothing else starts talking while it waits.

        `trusted_only` is PLAN 3.10: for a paid or destructive approval, an answer is taken
        only from a channel that can be attributed to the person — the microphone, the
        terminal keyboard, or an explicit act in the orb's control surface. A typed line
        cannot: `typed.json` is an ordinary file, so an ash turn holding a Write tool can
        answer the question that turn provoked (D56). The refusal is spoken, because a
        silently-ignored answer looks exactly like a daemon that has stopped listening.
        """
        self.speak(question, gen, then="thinking")
        # A refusal must not become a way to keep the daemon asking forever, so the whole
        # exchange is bounded by attempts, not by "until someone trusted answers".
        for attempt in range(3):
            if gen != self.gen: return default
            slot = self.reply_slot = {"event": threading.Event(), "text": None, "source": ""}
            self.set_state("listening", question=label)
            slot["event"].wait(20)
            self.reply_slot = None
            src = slot.get("source") or ""
            if trusted_only and slot["text"] is not None and not adapters.may_approve(src):
                log(f"{label} answer REFUSED from {src!r}: not a trusted approval channel (3.10)")
                if attempt < 2:
                    self.speak("I can't take a typed answer for that one. Say it out loud.",
                               gen, then="thinking")
                    continue
                break
            verdict = yes_or_no(slot["text"] or "")
            log(f"{label} answer: {slot['text']!r} from {src!r} -> {verdict}")
            if verdict is not None:
                return verdict
            if attempt == 0:
                self.speak(reprompt, gen, then="thinking")
            elif attempt >= 1:
                break
        self.set_state("thinking")
        return default

    def reopen_act_leg(self, action, gen):
        """The one-way switch's second half (PLAN 3.8): ask, once, to act after reading.

        Returns True when the leg is open — either it was never closed, or the person just
        said yes. The ask goes through `trusted_only=True`, so the page that caused the
        taint cannot supply the approval that lifts it (3.10). That pairing is the whole
        design: either half alone is decorative.
        """
        try:
            import oneway
        except Exception:
            return True                     # the switch is not a reason to stop working
        ok, why = oneway.check(action)
        if ok:
            return True
        log(f"one-way switch: {action} refused — {why}")
        said = oneway.ACTIONS.get(action, action)
        if self.ask_yes_no(f"I've read something from outside this machine on this turn. "
                           f"Shall I still {said}?", gen, label="one-way switch",
                           default=False, trusted_only=True):
            oneway.approve(action)
            log(f"one-way switch: {action} approved for this turn")
            return True
        return False

    # ---- permission questions ----------------------------------------------
    def ask_permission(self, req, gen):
        """Speak the question, listen for yes/no (one retry), return True for yes."""
        log(f"permission: {req.get('tool')} {json.dumps(req.get('input'))[:160]} ({req.get('reason')})")
        # 3.10 — a destructive approval takes an answer only from a channel that can be
        # attributed to the person. This is the question D56 traced: the turn being asked
        # about can write `typed.json`, so without this it can answer itself.
        ok = self.ask_yes_no(describe_request(req), gen, label=req.get("tool") or "permission",
                             trusted_only=True)
        if not ok and gen == self.gen:          # a yes needs no reply: the answer itself is coming
            self.speak("Alright, I won't.", gen, then="thinking")
        return ok

    # ---- control phrases ---------------------------------------------------
    def command(self, key, c, gen):
        action, say = c["action"], c.get("say")
        log(f"command {key} -> {action}")
        if action == "turn.abort":
            return self.stop_everything()
        if action == "tasks.cancel":
            self.dialog = None
            if self.board and not self.board.finished:
                self.board.cancel()
                return self.speak(say, gen)
            return self.speak("There's no task list running.", gen)
        if action == "turn.bye":
            return self.speak(random.choice(["Bye!", "See you later.", "Catch you later.", "Bye for now."]),
                              gen, then="idle")             # and the mic closes: a goodbye is the end
        if action == "orb.sleep":
            return self.speak(say, gen) if say else self.set_state("idle")
        if action == "orb.wake":
            return self.set_state("listening")
        if action.startswith("tutor."):
            # A lesson is a conversation with the panel; these are the spoken
            # equivalents of its buttons, so they must not cost a model turn.
            import tutor as _tutor
            if action == "tutor.off":
                # The panel goes off IMMEDIATELY, because this is a person saying "stop
                # teaching" and waiting for the reaping thread to catch up is a visible
                # pause on the thing they just asked to stop. `_lesson_watch` writes it off
                # again a moment later; both write the same value, so the duplicate is
                # harmless where a wrong order would not be.
                _tutor.write(mode="off", text="", question="", hint="", waiting="", target=None)
                # THROUGH `stop_lesson`, not a third killpg of its own (PLAN 12.4). This one
                # killed the process and left `self.lesson` set, so `_lesson_watch` still saw
                # itself as the current lesson, read the log, and SPOKE THE CLOSING LINE of a
                # lesson the user had just stopped. Saying the ending after "stop teaching"
                # is the same complaint as saying anything after "stop".
                self.stop_lesson()
                return self.speak(say, gen)
            st = _tutor.read()
            if not st or st.get("mode") in (None, "off"):
                return self.speak("No lesson is running.", gen)
            # THROUGH THE ADAPTER (PLAN 6.15, D294). This was a plain `write_text`, which
            # truncates before it writes, so a lesson polling the slot every 250 ms could catch
            # it empty or half-written — the torn read `write_slot` exists to prevent — and it
            # was one of the three writers keeping 6.15 open.
            adapters.write_slot("tutor-reply.json",
                {"t": time.time(), "kind": action.split(".", 1)[1],
                 "text": "", "step": st.get("step"), "id": st.get("id")})
            return self.set_state("idle")
        if action.startswith("tts."):
            k, f = {"tts.louder": ("volume", 1.25), "tts.quieter": ("volume", 0.8),
                    "tts.faster": ("speed", 1.1), "tts.slower": ("speed", 1/1.1)}[action]
            lo, hi = (0.2, 1.0) if k == "volume" else (0.7, 1.4)
            self.prefs[k] = round(min(hi, max(lo, self.prefs[k]*f)), 3)
            # Atomic (PLAN 11.3). A plain write_text truncates first, so a reader catching
            # that instant gets an empty or half-written file — and `self.prefs` is re-read
            # from disk on every turn (`:1656`), so a torn read is a turn that loses the
            # user's volume. `_write_prefs` also merges what is on disk, so a hand edit or
            # another writer is not clobbered by a spoken "louder".
            self._write_prefs()
            return self.speak({"tts.louder": "Louder.", "tts.quieter": "Quieter.",
                               "tts.faster": "Faster.", "tts.slower": "Slower."}[action], gen)
        if action == "troubleshoot.start":
            return self.troubleshoot_start(gen, say)
        if action in ("pair.start", "pair.visual.on") and not ash_terminal_open():
            log("pair: no interactive ash running, opening one")
            opened = time.time()
            if not open_ash_terminal():
                return self.speak("I couldn't get a terminal open just then — there may be a dead "
                                  "console window in the way. Close it and ask me again.", gen)
            self.pair_action(action, since=opened)  # follow the NEW session, not yesterday's
            return self.speak("Opening my terminal, and linking it up." if action == "pair.start"
                              else "Opening my terminal, over on the left of the screen.", gen)
        if action.startswith("pair."):
            return self.speak(self.pair_action(action) or say, gen)
        if action == "voice.show":
            # He chose once (voice_pick.py -> voice.json) and that choice stands; this only reports it.
            try: v = json.loads((CFG/"voice.json").read_text())["voice"]
            except Exception: return self.speak("I haven't chosen a voice yet.", gen)
            name = v.split("_", 1)[-1].capitalize()
            return self.speak(f"I've already chosen my voice. This is {name}, and I'm keeping it.", gen)
        return self.speak(say, gen) if say else self.set_state("idle")

    def run_plan(self, plan, gen):
        """Carry out a split request. Terminal work goes to the terminal (typed in by
        term.py, so he works on it there while the voice loop stays free); links and
        VS Code are one pair.py restart; questions are answered out loud after."""
        steps = plan["steps"]
        kinds = {st["do"] for st in steps}
        tasks = [with_folder(st["text"]) for st in steps if st["do"] == "task" and st.get("text")]
        asks  = [st["text"] for st in steps if st["do"] == "ask" and st.get("text")]
        name  = plan.get("task_name") or "that"
        said, opened = [], None

        narrating = self.pair_flags.get("narrate", True)
        briefed = [with_narration_brief(t, narrating) for t in tasks]

        if tasks and terminal_inbox_open():
            for t in briefed: send_to_terminal(t)
            said.append(f"taking {with_article(name)} to my terminal")
        elif tasks or ("terminal" in kinds and not ash_terminal_open()) \
                or (kinds & {"link", "visual", "narrate"} and not ash_terminal_open()):
            opened = time.time()
            open_ash_terminal(briefed)
            said.append("opening my terminal")
        elif "terminal" in kinds:
            said.append("my terminal is already open")

        if "unlink" in kinds:
            self.pair_action("pair.stop")
            said.append("unlinked")
        else:
            if "visual_off" in kinds:  self.pair_flags["visual"] = False
            if "narrate_off" in kinds: self.pair_flags["narrate"] = False
            if "visual" in kinds:      self.pair_flags["visual"] = True
            if "narrate" in kinds:     self.pair_flags["narrate"] = True
            if kinds & {"link", "visual", "narrate", "visual_off", "narrate_off"} or (opened and self.pair):
                self.pair_action("pair.start", since=opened)
                if kinds & {"link", "visual", "narrate"}: said.append("linking it up")
                if "visual" in kinds:  said.append("putting the terminal on the left and the page on the right")
                if "narrate" in kinds: said.append("narrating as he goes")
        reply = (spoken_list(said)[0].upper() + spoken_list(said)[1:] + ".") if said else ""
        if tasks and opened:
            reply += f" I'll start on {with_article(name)} the moment it is up."
        for q in asks:
            if gen != self.gen: return
            self.set_state("thinking", heard=q)
            reply += " " + self.ask(q, gen)
        if gen != self.gen: return
        self.speak(reply.strip(), gen, then=self.after_reply(reply))

    def pair_action(self, action, since=None):
        """pair.py runs as a child; narrate/visual are its flags, so changing one restarts it.
        Asking for the visual links up on its own - "show me what you're doing" should just work."""
        running = self.pair is not None and self.pair.poll() is None
        if action == "pair.stop":
            if running: self.pair.terminate(); self.pair.wait(5)
            self.pair = None
            self.pair_flags["visual"] = False
            return None
        if action.startswith("pair.narrate."): self.pair_flags["narrate"] = action.endswith(".on")
        if action.startswith("pair.visual."):  self.pair_flags["visual"]  = action.endswith(".on")
        if action.startswith("pair.replies."): self.pair_flags["replies"] = action.endswith(".on")
        if not running and action in ("pair.narrate.off", "pair.visual.off", "pair.replies.on", "pair.replies.off"):
            return None
        if not running and action == "pair.narrate.on":
            return "Link me to the terminal first."
        if running:
            self.pair.terminate(); self.pair.wait(5)
        argv = [sys.executable, str(HERE/"pair.py"), "--quiet", "--home", str(Path.home()/".sergio")]
        if since: argv += ["--since", str(since)]
        if self.pair_flags["narrate"]: argv.append("--narrate")   # paced+deduped, NOT the old raw --speak
        if self.pair_flags["visual"]:  argv.append("--visual")
        if self.pair_flags["replies"]: argv.append("--replies")
        # pair.py prints what it decides - armed the preview, opened the page, gave up
        # waiting for a server. Sent to /dev/null, "why didn't Chrome open?" had no
        # answer at all (2026-09-15), so it goes to a log next to the orb's.
        try:
            plog = open(CFG/"pair.log", "a", buffering=1)
            # THE DATE, not just the time (D303). pair.log keeps days of headers and was stamped
            # %H:%M:%S alone, so a header from four days ago read as this afternoon's, and a
            # live investigation chased "stray pair.py processes" that had exited days before.
            plog.write(f"\n===== pair {time.strftime('%Y-%m-%d %H:%M:%S')} {' '.join(argv[2:])}\n")
        except OSError:
            plog = subprocess.DEVNULL
        # Its OWN session (7.2). `terminate()` still sends SIGTERM to pair.py alone, so
        # nothing about unpairing changes — what this removes is the hazard that a killpg
        # aimed at the pair would land on ashd's own group, which is LC.0's whole point.
        self.pair = subprocess.Popen(argv, stdout=plog, stderr=subprocess.STDOUT,
                                     start_new_session=True)
        return None


def main():
    # 16.3 — name this process once. Every line it writes from here carries it, including
    # the ones from threads that never touch a turn.
    common.bind(component="ashd")
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(HERE/"wakeword"/"model_out"/"hey_ash.onnx"))
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--endpoint", type=float, default=1.4, help="seconds of silence that end an utterance (ashd-prefs `endpoint` wins)")
    ap.add_argument("--stt", default="base.en")
    ap.add_argument("--target", default=None, help="PipeWire source (default: system default)")
    ap.add_argument("--wav", nargs="+")
    ap.add_argument("--wav-replies", nargs="+", default=(), help="with --wav: answers to his yes/no questions")
    ap.add_argument("--wav-followups", nargs="+", default=(), help="with --wav: what you say in each follow-up window")
    ap.add_argument("--play-to", default=None)
    a = ap.parse_args()

    global STATE, PREFS
    if a.wav:                                   # tests must not drive the live orb or change his real pace
        STATE = CFG/"wake-state.test.json"
        PREFS = CFG/"ashd-prefs.test.json"
    if not a.wav:                               # one live daemon at a time (the orb may start one)
        lockf = open(CFG/"ashd.lock", "w")
        try:
            fcntl.flock(lockf, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log("ashd: already running"); return 0
        # Holding the lock means every other daemon is gone, so any pair.py still alive is
        # an orphan of one of them — and orphans multiply, replaying every editor animation
        # and opening another preview window each.
        reap_orphan_pairs()
        # SIGTERM does not run `finally`, so a daemon killed rather than interrupted left
        # its own pair.py behind — which is how four of them accumulated on 2026-09-17.
        # Turning the signal into KeyboardInterrupt puts the existing cleanup back in play.
        def _term(_sig, _frm):
            raise KeyboardInterrupt
        signal.signal(signal.SIGTERM, _term)

    d = Ashd(a)
    log(f"ashd: wake model {d.wake_name}, stt {a.stt}")
    try:
        d.run(wav_frames(a.wav, d, a.wav_replies, a.wav_followups) if a.wav
              # `stop=orphaned` is not optional here: the orb starts this process and
              # a mic that never opens must not outlive it. `micaudio` cannot ask the
              # question itself — PARENT is the daemon's state, and reaching back for
              # it would make the extraction a circle (18.1).
              else mic_frames(a.target, stop=orphaned))
    except KeyboardInterrupt:
        pass
    finally:
        d.cancel()
        if d.pair and d.pair.poll() is None: d.pair.terminate()
        write_state(state="idle")
    if a.wav:
        os._exit(0)          # test mode: skip interpreter teardown, where onnxruntime aborts with daemon threads alive
    return 0


if __name__ == "__main__":
    sys.exit(main())
