#!/usr/bin/env python3
"""The spoken verbs of the day — calendar and to-dos, matched without a model (PLAN C1.6).

The same ruling as `learn_verbs`: a deterministic verb extends the command table the way app
launching already does — **no model turn, no cost, no seat**. Asking a model what
*"what's my day"* means is paying for an answer the phrase already gives, and paying for it
every single morning.

The verbs:

    agenda      "what's my day", "what's on today", "what's next"
    free        "am I free Thursday afternoon"
    book        "book lunch with Sam next Tuesday at 3"
    cancel      "cancel the dentist"
    todo        "add a to-do: call the bank", "remind me to call the bank tomorrow"
    todos       "what's on my list"

**What is a verb and what is a question.** *"What's my day"* is deterministic — there is one
right answer and it comes out of EDS. *"How should I spend Thursday"* is not, and falls
through to the model, which is what it is for. The table is narrow on purpose: one that
matched everything would be a silent behaviour change dressed up as a cost saving.

**The TIME is not parsed here.** A verb hands its phrase to `whenparse`, which resolves it in
code (C1.5) — because "next Tuesday at 3" has a correct answer and a model gets it wrong
across DST. This module decides WHICH verb; `whenparse` decides WHEN.
"""
import re

# (verb, pattern, takes_payload). The payload is whatever the phrase carries — a title, a
# day, or both — and is handed on rather than interpreted here.
VERBS = [
    # --- reading, which costs nothing and changes nothing ---------------------------------
    # The only payload `agenda` can carry is WHICH DAY, captured explicitly. Letting it
    # capture the rest of the phrase gave titles like "day" and "'s" — noise that a caller
    # would have handed to `whenparse` and got nothing back from, which looks like a
    # parsing failure rather than a verb with nothing to say.
    ("agenda", re.compile(
        r"^\s*(?:what(?:'s| is| does)?\s+(?:my\s+)?(?:day|schedule|diary)(?: look like)?"
        r"|what(?:'s| is)?\s+on"
        r"|what(?:'s| is)?\s+(?:up\s+)?next"
        r"|what have i got on"
        r"|agenda)\s*(today|tomorrow|this week|this weekend)?\s*[?.!]*\s*$", re.I), True),

    ("plan", re.compile(
        r"^\s*(?:plan my day|what should i do(?: today)?|how should i spend (?:my )?(?:day|today)"
        r"|make me a plan|plan today)\s*(.*)$", re.I), True),

    ("review", re.compile(
        r"^\s*(?:how was my week|weekly review|review my week"
        r"|what slipped(?: this week)?|what did i miss)\s*[?.!]*\s*$", re.I), False),

    ("promises", re.compile(
        r"^\s*(?:what did i say i(?:'d| would)(?: do)?"
        r"|what have i promised"
        r"|what did i commit to)\s*(?:about\s+(.+?))?\s*[?.!]*\s*$", re.I), True),

    ("todos", re.compile(
        r"^\s*(?:what(?:'s| is)?\s+on\s+my\s+(?:list|to.?do list)"
        r"|what(?:'s| is)?\s+(?:my\s+)?to.?dos?(?:\s+list)?"
        r"|my\s+to.?do list"
        r"|what do i (?:have|need) to do)\s*[?.!]*\s*$", re.I), False),

    # `free`'s payload is a WHEN-phrase, not a title — "Thursday afternoon" is the question,
    # not the name of something. The caller hands it straight to `whenparse`.
    ("free", re.compile(
        r"^\s*(?:am i free|do i have (?:anything|time)|have i got (?:anything|time))"
        r"\s*(?:on\s+)?(.*)$", re.I), True),

    # --- writing, which is the half a person must be able to check afterwards -------------
    # ORDER MATTERS, and this is why `todo` comes first: `book`'s pattern accepts "add",
    # so "add a to-do: call the bank" matched `book` and produced an EVENT called "to-do".
    # The narrower verb is tried first — a table where a broad pattern shadows a specific
    # one is a table that is wrong only for the phrases people actually use.
    ("todo", re.compile(
        r"^\s*(?:remind me to|add a to.?do|add to.?do|put on my list|note down)\s*:?\s*(.+)$",
        re.I), True),
    # `book` requires something to call it: "book" alone is not an instruction, it is the
    # start of one, and guessing the title from context is how an event called "Meeting"
    # ends up in somebody's calendar.
    # "BOOK ME" IS NOT THIS VERB. "book me a flight to Berlin" is an errand for the CLI;
    # "book lunch with Sam" is a meeting. The word that separates them is `me`, and rather
    # than guessing which nouns are calendar-ish, the table simply declines the ambiguous
    # form and lets the model decide — which is what the model is for. Narrow beats clever
    # here: a wrong guess puts a flight in somebody's calendar, or a lunch nowhere at all.
    # BEFORE `book`, and the ordering is the same lesson `todo` already taught: a broad
    # pattern that shadows a specific one is a table that is wrong only for the phrases people
    # actually use. "Move the standup to four" must not reach a verb that creates things.
    #
    # "MOVE ME" IS NOT THIS VERB either, for the same reason "book me a flight" is not `book`:
    # moving a person is an errand, moving a meeting is a reschedule, and the word that
    # separates them is `me`.
    ("move", re.compile(
        r"^\s*(?:move|reschedule|shift|push)\s+(?!me\b)"
        r"(?:the\s+|my\s+)?(.+)$", re.I), True),

    ("book", re.compile(
        r"^\s*(?:book|schedule|put in|add)\s+(?!me\b)"
        r"(?:a\s+|an\s+|the\s+)?(?:meeting\s+)?(.+)$", re.I), True),

    ("cancel", re.compile(
        r"^\s*(?:cancel|call off|drop)\s+(?:the\s+|my\s+)?(.+)$", re.I), True),

]

# ── follow-up detection (PLAN C3.5) ────────────────────────────────────────────────────
# "I said I'd send that Tuesday" is a promise the person made and will not remember making.
# Catching it is worth a lot and getting it wrong costs little — a to-do they did not want is
# one line to delete, which is why this is allowed to be a suggestion rather than a certainty.
#
# It is NOT allowed to be automatic. C6.3's rule, and 20.x's whole shape: a captured promise
# is PROPOSED, never written silently, because a to-do nobody asked for that appears in the
# GNOME task list is exactly the "silently edits your things" failure the mandate names.
FOLLOW_UP = re.compile(
    r"\b(?:i|we)\s+(?:said|promised|told\s+\w+)\s+(?:i|we)('d| would| will| was going to)\s+(.+)$"
    r"|\bi\s+(?:need|have|ought)\s+to\s+(.+)$"
    r"|\bremind\s+me\s+(?:about|of)\s+(.+)$", re.I)


def follow_up(text):
    """A promise this utterance contains, or None.

    Returns the thing promised, in the person's own words — not a tidied version. A to-do
    that says something they did not say is one they cannot recognise later.
    """
    s = str(text or "").strip()
    if not s:
        return None
    m = FOLLOW_UP.search(s)
    if not m:
        return None
    body = next((g for g in reversed(m.groups()) if g and g.strip() and not g.startswith("'")), "")
    body = body.strip(" .,!?")
    # Two words is the floor. "I need to go" is not a commitment worth keeping, and a list
    # full of fragments is one nobody reads.
    return body if len(body.split()) >= 2 else None


# Phrases that LOOK like a verb and are not. Each earned its place: a reminiscence is not an
# instruction, and a question about how to do something is not a request to do it.
NEAR_MISSES = (
    "what do you think about my day",        # an opinion, not the agenda
    "how should i spend thursday",           # planning, which is C4 and needs a model
    "book me a flight to berlin",            # not a calendar event — a task for the CLI
    "move me to the front",                  # an errand, not a reschedule — the word is `me`
    "cancel that",                           # no antecedent; see `learn_verbs.forget`
    "remind me why we did that",             # a question, not a to-do
)


# Which verbs carry a WHEN-phrase rather than a title. The caller needs to know, because
# handing "Thursday afternoon" to `split_title` returns it as a title and loses the question.
WHEN_ONLY = {"agenda", "free"}


# Words that are never the name of anything: articles, and the nouns the verbs themselves
# use. "add a to-do" leaves "to-do", which is the command talking about itself.
FILLER = {"a", "an", "the", "my", "some", "to", "do", "todo", "to-do", "item", "thing",
          "meeting", "event", "reminder", "note", "one", "that", "this", "it"}


def _names_something(payload):
    """Does this payload actually name a thing, or is it just the verb's own words?"""
    words = [w for w in re.split(r"[^\w'-]+", str(payload or "").lower()) if w]
    return any(w not in FILLER for w in words)


def match(text):
    """(verb, payload) for a day verb, or None.

    For a verb in `WHEN_ONLY` the payload IS the when-phrase. For the others it is title and
    time together, which `split_title` separates. Either way nothing here interprets a time:
    that is `whenparse`'s job, in code, because it has a correct answer (C1.5).
    """
    s = str(text or "").strip()
    if not s:
        return None
    for verb, pat, takes in VERBS:
        m = pat.match(s)
        if not m:
            continue
        payload = ""
        if takes:
            # The last non-empty group is the payload; the earlier ones are the verb's own
            # alternatives.
            groups = [g for g in (m.groups() or ()) if g and g.strip()]
            payload = groups[-1].strip() if groups else ""
            # `book`, `cancel` and `todo` are meaningless with nothing to call the thing.
            # EMPTY IS NOT THE ONLY WAY to have nothing: "cancel the" carries the payload
            # "the", and "add a to-do" falls through to `book` carrying "to-do" — both
            # non-empty, both naming nothing. A verb that accepts them creates an event
            # named after the command that made it.
            if verb in ("book", "cancel", "todo") and not _names_something(payload):
                return None
        return verb, payload
    return None


# The first time-ish word in a phrase — where a title stops, and where a place stops. ONE
# definition, used by both `split_title` and `split_place`: two copies of this would drift,
# and the symptom would be a place that keeps a day name on the end of it.
_CUE = re.compile(
    r"\b(on|at|next|this|coming|tomorrow|today|tonight|in)\b"
    r"|\b(mon|tues?|wed(nes)?|thur?s?|fri|sat(ur)?|sun)(day)?\b"
    r"|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b"
    r"|\b\d{1,2}(:\d{2})?\s*(am|pm)\b", re.I)


# ── WHERE ───────────────────────────────────────────────────────────────────────────────
# Time-ish things that can follow "at" or "in". This is a REFUSAL list, not a place list:
# anything matching it is not taken as a place, and anything else is. That direction matters
# because the two mistakes are not equal — see `split_place`.
_TIMEISH = re.compile(r"""^(?:the\s+|a\s+|an\s+)?(?:
      \d                                              # 3, 3:30, 20 minutes, 1pm
    | noon | midnight | midday
    | morning | afternoon | evening | night | lunchtime
    | half\b | quarter\b | few\b | couple\b
    | (?:hour|week|day|month|year|bit|while|moment|minute|min)\b
    | tomorrow | today | tonight | yesterday
    | (?:next|this|coming|last)\b
    | (?:mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?|sun)(?:day)?\b
    | (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b
)""", re.I | re.X)

# Only "at" and "in". NOT "on" — "on Friday" is a day and "on the roof" is rare enough that
# taking it would cost far more than it gains.
_PLACE_PREP = re.compile(r"\b(?:at|in)\s+(?=\S)", re.I)


def split_place(payload):
    """(rest, place) — the words that say WHERE, lifted out of the phrase.

    C2.3 built travel buffers and then could not fire them: the calendar carries a location,
    and **nothing captured one from speech**, so every booking went in with `location=""` and
    the travel branch was unreachable code that measured clean (D218). This is that seam.

    THE HARD PART IS "at". *"at 3"* is a time and *"at the dentist"* is a place, and the same
    word introduces both — often in one sentence: *"lunch at the cafe at 1"*. So the test is
    what FOLLOWS it, and the list above is deliberately a list of times rather than a list of
    places: places are unbounded and a new one must not need a code change, whereas the ways
    of saying a time are few and already enumerated by `whenparse`.

    **The two mistakes are not symmetric, and the bias is chosen.** A place left in the title
    reads back as *"lunch at the cafe, tomorrow at one"* — visible in the confirmation, in the
    calendar, and harmless. A time taken as a place is a meeting at the wrong hour, which is
    the failure `split_title` is already written to avoid. So an ambiguous tail is NOT a place.

    The place ends at the next time cue, because "the cafe tomorrow at 1" is a place followed
    by a time and a location of "the cafe tomorrow at 1" would be shown to the person in
    `gnome-calendar`.
    """
    s = str(payload or "").strip()
    if not s:
        return "", ""
    for m in _PLACE_PREP.finditer(s):
        tail = s[m.end():]
        if _TIMEISH.match(tail):
            continue
        cut = _CUE.search(tail)
        place = (tail[:cut.start()] if cut else tail).strip(" ,-.")
        if not place:
            continue
        rest = (s[:m.start()] + " " + (tail[cut.start():] if cut else "")).strip(" ,-")
        return re.sub(r"\s{2,}", " ", rest), place
    return s, ""


def split_title(payload):
    """(title, when_phrase) — the words that name the thing, and the words that time it.

    Split on the FIRST time-ish word, so "lunch with Sam next Tuesday at 3" gives
    ("lunch with Sam", "next Tuesday at 3"). Getting this wrong in the safe direction means
    a title with a date in it, which the person can see and fix; getting it wrong the other
    way means a title of "lunch" and a meeting at the wrong hour.
    """
    s = str(payload or "").strip()
    if not s:
        return "", ""
    m = _CUE.search(s)
    if not m or m.start() == 0:
        return s, ""
    title, when = s[:m.start()].strip(" ,-"), s[m.start():].strip()
    # "on friday at 2pm" -> "friday at 2pm". `whenparse` copes with the preposition either
    # way; dropping it keeps the phrase readable where it is echoed back or logged.
    when = re.sub(r"^on\s+", "", when, flags=re.I)
    # A PREPOSITION LEFT ON THE END OF THE TITLE. "move the standup to 6pm" splits on "6pm",
    # which leaves the title as "the standup to" — and `preview_move` looks the title up by
    # substring, so it finds nothing and says it cannot find an event the person is looking
    # at. Only "to", "by", "til" and friends need this: "at", "on" and "in" are cue words
    # themselves and are taken with the phrase.
    title = re.sub(r"\s+(?:to|by|until|till|til|for)$", "", title, flags=re.I)
    return title, when
