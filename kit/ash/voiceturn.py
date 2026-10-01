#!/usr/bin/env python3
"""One spoken turn, asked and answered (PLAN 18.1, ninth extraction, out of `ashd.py`).

`Ashd.ask` was the daemon's largest method after `_handle`: 158 lines that build the voice
prompt, try the one-request quick answer (D316), pick the turn's driver (4.13-4.19), run the
engine, and retry on another seat when the model goes quiet or ends with nothing to say
(D314, D335). It stays on `Ashd` as a one-call delegate, so `_handle`'s `self.ask(` and every
caller are unchanged; the body is the method's, AST-identical modulo `self` -> `owner`.

It reads no module global of the daemon's. Everything it touches on the daemon is an
attribute of `owner` — the generation, the seats, the stall table, the ledger, `speak` —
so a suite can hand it a stand-in daemon and RUN it, which no suite could do while it lived
inside a class whose import starts an audio stack (`test_voiceturn`). Before the move it was
only ever read as text (`test_first_byte` FB.5/FB.6, `test_quick_answer` Q.4,
`test_release_fixes` RF.3c).
"""
import collections
import re
import shutil
import threading
import time
from datetime import datetime
from pathlib import Path

import speakable
from briefs import PLAIN_BRIEF, SEE_BRIEF
from common import log

# ── THE PRESENT NEEDS LOOKING UP (D363, owner 2026-09-24: "tbh hes a bit dumb") ─────────────
# The quick answer is one request with NOTHING to look anything up with, and its rule asks the
# model to say TOOLS when it is not sure. It was sure, and wrong: asked for the Canadiens' best
# five players "right now" it named Gallagher and Laine, who no longer play there, and then
# stood by them. A model does not know what it does not know about this season, so a question
# about the PRESENT — or one that asks outright to be looked up — skips the quick way in code
# rather than by asking the model to notice (hard rule 5: prose does not bind).
ABOUT_NOW = re.compile(
    r"\b(right now|currently|at the moment|as of now|so far this"
    r"|this (season|year|week|weekend|month)|latest|most recent|newest|news|headlines?"
    r"|scores?|standings|roster|line-?up|who won|who'?s winning|still (play|plays|playing|with|at"
    r"|open|alive|work|works|working)|price of|stock price|weather|forecast"
    r"|look (it|that|this|them) up|search|google|research|check online|find out)\b", re.I)


# How long after a question about the present its follow-ups still count as one (D363).
NOW_FOLLOWUP_S = 180
# How long the quick answer may be silent before he says "one sec" anyway (it usually takes 2-4 s)
QUICK_FILLER_S = 5.0


# THE SOFT ONES ASK ONLY WHEN THEY ASK (2026-09-24 sweep). "I'm not tired anymore", "I recently
# got a dog" and "what are you up to these days" each sent small talk to a 10-35 s engine turn.
# These words mean "today's world" in a question about someone else — "does he play for them
# anymore" — and nothing at all in a sentence about the speaker, or one put to Ash himself.
SOFT_NOW = re.compile(r"\b(these days|nowadays|anymore|recently|lately)\b", re.I)
_ASKS = re.compile(r"^\s*(?:(?:hey|hi|ok|okay)\s+)?(?:ash\W+)?(?:so\s+|and\s+)?(what|why|how|when|where|who|"
                   r"which|did|do|does|is|are|was|were|has|have|any|can|could)\b", re.I)
_TO_HIM = re.compile(r"\b(you|your|you're|youre)\b", re.I)
# In the window after one, a follow-up is still about the present — but not the chat that ends
# a thread. "cool thanks", "haha nice", "tell me a joke" were engine turns for three minutes.
CHAT_RE = re.compile(r"^\W*(?:ok(?:ay)?|cool|nice|haha\w*|lol|thanks?|thank you|awesome|great|sweet|"
                     r"perfect|got it|alright|no worries|good night|tell me a joke|how (?:are you|was your day)|"
                     r"how's it going|what's up)\b", re.I)


# a line that is only a hello or small talk, with the wake words allowed in front
GREETING_RE = re.compile(
    r"^\W*(?:(?:hey|hi|hello|yo|ok|okay)\W+)?(?:ash\W*)?"
    r"(?:hey|hi|hello|yo|sup|what'?s\s+up|whats\s+up|good\s+(?:morning|afternoon|evening)|morning|"
    r"how\s+(?:are|r)\s+(?:you|u)(?:\s+doing)?|how'?s\s+it\s+going|how\s+was\s+your\s+(?:day|night|morning))"
    r"(?:\W+(?:ash|there|buddy|man|dude|friend|today|this\s+morning))*\W*$", re.I)


def asks_about_now(text):
    """Does answering this need the world as it is today, or a lookup it asks for (D363)?"""
    text = text or ""
    if ABOUT_NOW.search(text):
        return True
    return bool(SOFT_NOW.search(text) and (_ASKS.match(text) or text.rstrip().endswith("?"))
                and not _TO_HIM.search(text))


def still_about_now(text, now_until, now=None):
    """Inside the D363 follow-up window: is this line still part of that question? Chat is not."""
    now = time.time() if now is None else now
    return now < now_until and not CHAT_RE.match(text or "")


def _earlier(owner):
    """The spoken conversation so far, for an engine turn (D363).

    The quick answers and the engine turns were two conversations that never met: the quick
    way keeps its last four exchanges, and the engine's session knew none of them. So after
    three quick answers about the Canadiens, "Nope, both don't play with the Canadiens anymore,
    research" reached the engine alone and came back as "Fair enough, we're dropping the
    Canadiens search entirely" (2026-09-24). Most recent last; nothing older than the quick
    way's own ten minutes."""
    hist = getattr(owner, "_quick_hist", None) or ()
    if not hist or time.time() - getattr(owner, "_quick_t", 0) > 600:
        return ""
    said = "\n".join(f"They said: {q}\nYou said: {a}" for q, a in hist)
    return (f"[The spoken conversation so far, most recent last. What they say next carries it "
            f"on — do not start over or change the subject:\n{said}]\n\n")


def _remember(owner, text, reply):
    """An engine answer joins the conversation the quick way keeps, so the next quick answer
    knows what the engine found (D363) — the other half of `_earlier`."""
    hist = getattr(owner, "_quick_hist", None)
    if hist is None or time.time() - getattr(owner, "_quick_t", 0) > 600:
        hist = owner._quick_hist = collections.deque(maxlen=4)
    hist.append((text, reply))
    owner._quick_t = time.time()


def ask(owner, text, gen, context=""):
    """The reply to one spoken turn, as text for the say-loop — or "" when the turn was stopped."""
    owner.capture_lesson(text)
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
    # THE QUICK ANSWER FIRST (D316). A spoken question went through a whole engine turn —
    # a big prompt, every tool, an agent loop — and "what is twelve plus five" came back
    # after 77 s of silence with an apology (measured 2026-09-22: the model globbed the
    # folder and grepped for `def greet` before saying "Seventeen", and the everyday seat
    # was answering 503s). The same question as ONE plain request answers in two to four
    # seconds. So a question with no page or screen behind it is asked that way first; if
    # the model says it needs to look something up, or nothing answers, the engine turn
    # below runs as before — and he says so rather than going quiet.
    if not context:
        # D363: about the present, it goes straight to the engine, which can look it up — and
        # so do the follow-ups for a few minutes after, because "that's three, I said five" is
        # still a question about this season's roster even though it never says so.
        # Only a line that IS about the present re-arms the window (2026-09-24 sweep): re-arming
        # on every follow-up kept it open for as long as they kept talking about anything.
        asked_now = asks_about_now(text)
        now_q = asked_now or still_about_now(text, getattr(owner, "_now_until", 0))
        if asked_now:
            owner._now_until = time.time() + NOW_FOLLOWUP_S
        if now_q:
            log("about the present (or asked to look it up): the engine takes it, not memory")
        # THE FILLER WHEN THE QUICK WAY IS SLOW (2026-09-24 sweep). It tries two seats in turn at
        # ten seconds each, so a slow pair was up to twenty seconds of silence BEFORE "one sec".
        # Past QUICK_FILLER_S he says it anyway, once — and not again when the engine takes over.
        moment = threading.Event()
        quick = ""
        if not now_q:
            done = threading.Event()

            def _late():
                if not done.is_set() and gen == owner.gen:
                    moment.set()
                    owner._one_moment(gen)
            timer = threading.Timer(QUICK_FILLER_S, _late)
            timer.daemon = True
            timer.start()
            try:
                quick = owner._quick_answer(prompt, text, gen)
                # A GREETING NEVER NEEDS TOOLS (2026-09-25: "Hey ash whats up!?" came back "TOOLS",
                # so a hello waited 16 s behind "One sec, let me check." for an engine turn). Asked
                # once more, told what it is.
                if not quick and gen == owner.gen and GREETING_RE.match(text or ""):
                    quick = owner._quick_answer(
                        prompt + "\n\n[This is a greeting or small talk. Answer it in kind, warmly, in a "
                                 "sentence or two. It needs nothing looked up, and you can answer it.]", text, gen)
            finally:
                done.set()
                timer.cancel()
        if quick:
            return quick
        if gen != owner.gen: return ""
        if not moment.is_set():
            owner._one_moment(gen)
    # D363: the engine hears the conversation it was not part of, just before the question.
    earlier = _earlier(owner)
    if earlier and prompt.endswith(f"{context}{text}"):
        prompt = prompt[:len(prompt) - len(context) - len(text)] + earlier + context + text
    ash = shutil.which("ash") or str(Path.home()/".local/bin/ash")
    # stream-json, not json: events arrive as the turn runs, which is what lets a
    # STALL be told apart from a turn that is simply working.
    cmd = [ash, "-p", prompt, "--output-format", "stream-json"]
    # WHICH DRIVER (4.13-4.19). Without this the tiers were a library nothing called.
    _route = owner.turn_driver(text)
    if not _route["driver"]:
        # "It waits for the reset." An easy task is not worth money because the free
        # seat is asleep, and the person is told rather than left with silence.
        return _route["say"]
    driver = owner._healthy_driver(_route["driver"])
    cmd += ["--model", driver]
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
        _said = getattr(owner, "_route_said_on", None)
        if _said is None:
            _said = owner._route_said_on = {}
        if _said.get(_route["say"]) != _today:
            _said[_route["say"]] = _today
            owner.speak(_route["say"], gen, then="thinking")
    log(f"route: {_route['driver']} ({_route['tier']}, {_route['source']}) — "
        f"{_route['reason']}")
    if time.time() - owner.last_turn < 600:
        cmd.append("--continue")            # a follow-up within 10 minutes keeps the conversation
    t = time.time()
    r, stalled, err = owner._run_turn(cmd, gen)
    owner._record_turn(driver, stalled, t, model=r.get("model"))
    if stalled:
        owner._note_stall(driver)
    if stalled and gen == owner.gen:
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
        primary = owner.voice_seat()
        for seat in [s for s in owner._free_stall_seats()
                     if s not in (primary, driver) and not owner._recently_stalled(s)]:
            if not (stalled and gen == owner.gen):
                break
            log(f"no response from the model in time, retrying on {seat}")
            _t_seat = time.time()
            r, stalled, err = owner._run_turn(cmd + ["--model", seat], gen)
            owner._record_turn(seat, stalled, _t_seat, model=r.get("model"), retry="stall")
            if stalled:
                owner._note_stall(seat)
    if gen != owner.gen: return ""
    owner.last_turn = time.time()
    # What "learn what we just did" refers to (PLAN 22.3). Set HERE, at the end of a
    # completed model turn, and deliberately not in `_handle`: set on the way in, the
    # learning verb would capture the words "learn what we just did" — itself — which
    # is the kind of thing nobody notices until the memory store is full of them.
    # Control phrases never reach this method, so they cannot overwrite it either.
    owner.last_user_text = text
    reply = (r.get("text") or "").strip()
    log(f"ash: {reply[:160]!r} ({time.time()-t:.1f}s, {r.get('model')})")
    # A SEAT'S THINKING SUMMARY IS NOT AN ANSWER (D314). This path spoke the reply straight
    # through, so "I'm reviewing the system instructions, context, constraints…" was read
    # aloud on 2026-09-22. All-reasoning becomes EMPTY — which the retry just below turns into
    # a real answer from another seat — and a mixed reply loses only its reasoning sentences.
    if reply:
        if speakable.is_internal(reply):
            log("that reply was the seat's own reasoning, not an answer — not speaking it")
            reply = ""
        else:
            reply = speakable.strip_internal(reply)
    if not reply or r.get("failed") or r.get("blocked"):
        tail = (err or "").strip().splitlines()[-1:] or [r.get("reason") or r.get("failed") or "no output"]
        log(f"ash turn problem: {tail[0][:300]}")
        # An EMPTY answer used to go straight to the apology, because the stall retry only
        # covers a model that sends nothing at all. A turn that runs, produces events and then
        # ends with no text is the same thing to the person listening: 142 seconds of silence
        # followed by "Sorry, I couldn't get an answer just then", on camera (2026-09-17).
        # One retry on a different seat costs a few seconds and usually answers.
        if not reply and not r.get("blocked") and gen == owner.gen:
            # ...and never onto a seat that has just stalled (2026-09-24 sweep): the stall retry
            # above already filters them, and this one picked the same wall straight back up
            for seat in [s2 for s2 in owner._free_stall_seats()
                         if s2 != owner.voice_seat() and not owner._recently_stalled(s2)][:1]:
                log(f"empty answer after {time.time()-t:.0f}s, retrying on {seat}")
                _t_seat = time.time()
                r2, _st2, err2 = owner._run_turn(cmd + ["--model", seat], gen)
                # D335: this retry used to leave no ledger row at all, so the log named a
                # seat the ledger had never heard of and 19.8 could not reconcile the two.
                owner._record_turn(seat, _st2, _t_seat, model=r2.get("model"), retry="empty")
                if gen != owner.gen: return ""
                again = (r2.get("text") or "").strip()
                log(f"ash retry: {again[:120]!r} ({r2.get('model')})")
                if again:
                    _remember(owner, text, again)
                    return again
        return reply or "Sorry, I couldn't get an answer just then."
    _remember(owner, text, reply)
    return reply
