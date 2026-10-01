#!/usr/bin/env python3
"""
speakable — turn written text into something a voice can say.

THE BIGGEST ROBOTIC TELL IS NOT THE MODEL. It is feeding a TTS engine text that
was written to be READ. An LLM writes `~/ash/brain/settings.json`, "8.2GB", "e.g.",
bullet lists and code fences. Read literally, any engine on earth sounds like a
machine, because no human would ever say those strings out loud.

So this runs first, every time. It is the difference between "slash home slash
ovrsv slash dot ash slash settings dot json" and "your settings file".
"""
import re

# ── how a token is said lives in `spoken_words` now (PLAN 18.3) ────────────────────────
# Re-exported by NAME rather than with a star import, so this line is the list of what the
# split actually moved and a reader can see it without opening the other file. A star import
# would also quietly re-export anything added there later, which is how a boundary stops
# being one.
from spoken_words import (  # noqa: F401
    ABBREV, CONTRACT, NOT_STRANDED, PROGRAMS, UNITS, _BAREDIR, _BAREFILE, _BULLET,
    _CODE_EXT, _CONFIG_NAMES, _EMPH, _FENCE, _FILE_EXT, _HEADING, _HYPHEN_PARTICLE,
    _HYPHEN_PREFIX, _INLINE, _ISO_DATE, _KEEP_DOTTED, _LETTER_RUN, _LOCALHOST,
    _MAIN_VERB_HAVE, _MDLINK, _MODIFIED_NOUNS, _MONTHS, _NOT_FOLDERS, _NPM_SCOPED, _NUMLIST,
    _ONES, _ORD, _PATH, _PROGRAMS_RX, _RELDIR, _RELPATH, _TENS, _URL, _fix_letter_a,
    _is_hyphenated_word, _ordinal, _say_dir, _say_file, _say_iso_date, _say_number,
    _say_package, _say_path, _two_digit_words, _year_words, _INTERJECTIONS, fold_interjections)

# ── the two remaining jobs moved out too (PLAN 18.3, 2026-09-22) ───────────────────────
# What is left here is the PIPELINE: `speakable()` itself, the phrase splitter, and the three
# composers that call it — a narration line, a completion line, a reply for the ear. How a
# sentence is SHAPED is `spoken_shape`; WHETHER a thing is said is `spoken_choice`. Both are
# re-exported by NAME for the same reason as the line above: the import IS the list of what
# moved, and `speakable.X` keeps resolving for every caller and every frozen answer.
from spoken_shape import (  # noqa: F401
    OPENER_EVERY, _ARTICLE, _COMMAND_HEAD, _CONJ, _CONSONANT_SOUND_EXCEPT, _DANGLING,
    _DANGLING_WORDS, _DETERMINER, _DOUBLE, _DOUBLE_ARTICLE, _FIRST_PERSON,
    _GERUND_HEAD, _HUMAN_OPENERS, _OPENERS, _RECAP_SHAPES, _RECOVERY,
    _RECOVERY_OPENERS, _SUBJECTED, _VERBS, _VOWEL_SOUND_EXCEPT, _gerund, _join_clauses,
    _object_phrase, _short, _starts_with_vowel_sound, agree_articles, as_recap_item,
    as_spoken_clause, narration_line, one_article, with_recap, with_subject)
from spoken_choice import (  # noqa: F401
    SPOKEN_SENTENCES, SPOKEN_WORDS, _CLAIMS_RE, _CLAIMS_RECEIPT, _CLAIMS_SENTENCE,
    _CODE_EDGE, _COMMAND_PHRASES, _DANGLING_LINK, _DIGIT_WORDS, _HEADING_TAIL,
    _INLINE_ITEM, _LIST_HEAD, _MACHINE, _MACHINE_TAIL, _MD, _META_RE, _OPENER_RE,
    _PARENTHETICAL, _PORT, _PREP_ARTICLE, _PREP_NOUNS, _PURE_MACHINERY, _RECEIPT_ROW,
    _ROW_SPLIT, _SALVAGE_MARK, _SALVAGE_RE, _SENTENCE_SPLIT, _SERVILE, _STAT_SENTENCE,
    _TEMPLATE_CLAUSE, _TICKS, _TOOL_WORDS, _TRAILING_FRAGMENT, _VERIFIED_RE,
    _sentences, body, clamp_spoken, cut_code, for_reading_aloud, from_report,
    is_internal, lead_in, norm_for_dedup, repeats, similar, strip_internal,
    strip_machinery)


def speakable(text: str, max_chars: int = 700) -> str:
    t = cut_code(text)
    t = fold_interjections(t)            # D364: "Ahh" is a doubled vowel the voice stutters on

    t = _FENCE.sub(" (I've put the code on screen) ", t)
    t = _MDLINK.sub(r"\1", t)
    t = _URL.sub(" the link ", t)
    # A sentence that ended on a URL now ends on a phrase pointing at nothing: "serving
    # correctly at the link" (heard 2026-09-18). Only when there is a real sentence in
    # front of it — "the page is at the link" still needs its ending.
    def _drop_link(m):
        return "" if len(m.group(1).split()) >= 7 else m.group(0)
    t = re.sub(r"((?:\S+\s+){5,})\b(?:at|on|from|via)\s+the link\b(?=[.,;]|\s*$)",
               lambda m: m.group(1).rstrip() if len(m.group(1).split()) >= 6 else m.group(0), t)
    t = _LOCALHOST.sub(lambda mm: "localhost port " + " ".join(mm.group(1)), t)
    t = _INLINE.sub(r"\1", t)
    t = _HEADING.sub("", t)
    t = _EMPH.sub(r"\2", t)
    t = _NUMLIST.sub(r"\n", t)
    t = _BULLET.sub("\n", t)

    # Protect framework names (Next.js, Node.js) from the filename rules by parking
    # them behind a sentinel, restored after. Simplest reliable guard.
    _kept = []
    def _park(mm):
        _kept.append(mm.group(0)); return f"\x00{len(_kept)-1}\x00"
    t = _KEEP_DOTTED.sub(_park, t)

    t = _PATH.sub(_say_path, t)          # absolute (~/… , /…) first, so it consumes the whole path
    t = _RELPATH.sub(_say_path, t)       # then a relative path WITH a file (components/App.tsx)
    t = _RELDIR.sub(_say_path, t)        # then a multi-segment relative dir (programs/x/landing-page)
    t = _BAREFILE.sub(_say_file, t)      # then a bare filename with an extension (Hero.tsx)
    t = _BAREDIR.sub(_say_dir, t)        # then a bare hyphenated folder name (landing-page)

    t = re.sub(r"\x00(\d+)\x00", lambda mm: _kept[int(mm.group(1))], t)   # restore framework names

    # Program names before acronyms: "VS Code" is produced here and must not be
    # taken apart again by a later rule.
    t = _PROGRAMS_RX.sub(lambda m: PROGRAMS[m.group(1).lower()], t)

    for k, v in ABBREV.items():
        t = re.sub(r"(?<![\w])" + re.escape(k) + r"(?![\w])", v, t)
    t = _fix_letter_a(t)
    for k, v in UNITS.items():
        # \b after a symbol like % never matches - it needs a word char on one
        # side. Use an explicit "not a letter" guard instead.
        tail = r"\b" if k[-1].isalnum() else r"(?![\w])"
        t = re.sub(r"(\d)\s*" + re.escape(k) + tail, r"\1 " + v, t)

    t = _ISO_DATE.sub(_say_iso_date, t)
    # Money to two places first: "$3.5000" is four decimal places of a dollar figure, and
    # the thousands rule below then read the tail as a number — "three point five thousand
    # zero zero zero", heard on camera 2026-09-18.
    t = re.sub(r"(\$\d+\.\d{2})\d+", r"\1", t)
    # ...and never apply the thousands rule to digits AFTER a decimal point, whatever they
    # belong to: the part after the point is not a quantity of thousands.
    t = re.sub(r"(?<![.\d])\b\d+\b", _say_number, t)

    for pat, rep in CONTRACT:
        # the table is lowercase and the match is case-insensitive, so a plain
        # replacement turns "You are ready" into "you're ready" and flattens every
        # sentence-initial capital. Carry the original's capitalisation across.
        t = re.sub(pat, lambda m, rep=rep: rep.capitalize() if m.group(0)[:1].isupper() else rep,
                   t, flags=re.I)

    # A scoped npm package read literally is "at vitejs slash plugin dash react".
    t = _NPM_SCOPED.sub(_say_package, t)

    # symbols nobody pronounces. "&&" is one word aloud, not two: the generic "&"
    # rule turned `npm ci && npm run build` into "and and".
    t = t.replace("&&", " and ").replace("||", " or ")
    t = re.sub(r"\s\+\s", " and ", t)
    t = t.replace("&", " and ").replace("→", " to ").replace("—", ", ").replace("–", ", ")
    t = re.sub(r"[#*_~<>|^]", " ", t)
    t = re.sub(r"\s*\n+\s*", ". ", t)          # line breaks are sentence breaks aloud
    t = re.sub(r"\.\s*\.", ".", t)
    # An adjective stranded in front of an article: the package/file rules emit
    # "the X", so "fix missing @vitejs/plugin-react" lands as "missing the X
    # package". A person says "the missing X package".
    t = re.sub(r"\b(missing|broken|stale|unused|outdated|failing|duplicate|new|old)\s+the\s+",
               r"the \1 ", t, flags=re.I)
    # a path rewritten to "the route file" right before the word "file" doubles it
    t = re.sub(r"\b(file|component|directory|module|script)\s+\1\b", r"\1", t, flags=re.I)
    t = re.sub(r"\s{2,}", " ", t).strip()

    # a spoken answer that runs long stops being an answer
    if len(t) > max_chars:
        cut = t[:max_chars]
        end = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
        t = cut[:end + 1] if end > max_chars * 0.5 else cut.rsplit(" ", 1)[0] + "."
    return t


def phrases(text: str):
    """Split into phrases for delivery. Speaking a long block in one call gives
    it one flat contour; sentence-at-a-time lets each land with its own shape,
    and lets playback start before the rest is even synthesised."""
    parts = re.split(r"(?<=[.!?])\s+", text)
    out = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        # break very long sentences at clause boundaries so he takes a breath
        while len(p) > 180:
            cut = p.rfind(", ", 0, 180)
            if cut < 60:
                cut = p.rfind(" ", 0, 180)
            out.append(p[:cut + 1].strip())
            p = p[cut + 1:].strip()
        out.append(p)
    # A one- or two-word phrase ("Evening.", "Right.", "Done.") synthesised on its
    # own gives the model no sentence to shape it into, so it comes out as an
    # isolated word with a stiff, robotic onset. Carry it into the next phrase so
    # it is spoken as the opening of that sentence; the full stop still gives it
    # its pause. A short phrase with nothing after it is the whole reply, and stays.
    merged = []
    carry = ""
    for i, p in enumerate(out):
        p = (carry + " " + p).strip() if carry else p
        carry = ""
        if len(p.split()) <= 2 and i < len(out) - 1:
            carry = p
            continue
        merged.append(p)
    if carry:
        merged.append(carry)
    return merged


def narration(desc, last_spoken="", n=0, last_opener=""):
    """Compose one spoken progress line. Returns (line, opener_used)."""
    t = _CLAIMS_SENTENCE.sub(" ", desc or "")
    t = _MACHINE_TAIL.sub("", t.strip())
    if _PURE_MACHINERY.match(t):
        return "", last_opener
    # one_article runs AFTER speakable(), because speakable() is what creates the second
    # one: `App.tsx` becomes "the app component", article included, inside a sentence that
    # already had "the current".
    clause = one_article(with_subject(as_spoken_clause(speakable(strip_machinery(t), max_chars=160))))
    if not clause:
        return "", last_opener
    if n and _RECOVERY.search(desc or ""):
        opener = next((o for o in _RECOVERY_OPENERS if o != last_opener), _RECOVERY_OPENERS[0])
    elif not n:
        opener = ""
    elif n % OPENER_EVERY:
        opener = ""                       # most lines just start with what he is doing
    else:
        choices = [o for o in _HUMAN_OPENERS if o != last_opener] or list(_HUMAN_OPENERS)
        opener = choices[(n // OPENER_EVERY) % len(choices)]
    if opener:
        # "Right, " + "I'm checking..." must not become "i'm checking" - the pronoun
        # stays capitalised whatever runs in front of it (heard 2026-09-15).
        head = clause[0].lower() + clause[1:]
        if re.match(r"i(?:'|\s|$)", clause, re.I):
            head = "I" + clause[1:]
        line = opener + head
    else:
        line = clause[0].upper() + clause[1:]
    return line.rstrip(".") + ".", opener


# ---------------------------------------------------------------- completions
# He said what he was doing but never that a thing was DONE, so a finished task
# just trailed off - "it kind of is like... ok?" (user, 2026-09-15). A completed
# todo gets its own short line, clearly a completion, and a different shape each
# time so three in a build do not sound stamped out.
# Humbly excited, not hyped (user, 2026-09-15): glad it worked, never selling it.
# The shape does the work with the voice's own prosody - voice.py lifts a phrase
# ending in "!" and settles the LAST phrase of a line downward - so each line is
# one short lift followed by a calm, warm close. Exactly one "!", and no
# superlatives: "amazing" and "perfect" are a salesman, "came together nicely" is
# someone quietly pleased with their work.
# REVISED 2026-09-16. Every one of the fourteen shapes carried the literal phrase
# "task completed", so a build of eight items said those two words eight times, and
# hearing the same stamp after each one is exactly what "he sounds robotic" meant
# (user, 2026-09-16). A person says the thing is done in whatever words the thing
# suggests; they do not read out a status field. Three shapes keep the explicit
# wording for the times it genuinely helps to hear a task named as finished, and
# the rest just say it. The register is unchanged: one lift, a calm close, exactly
# one "!", no superlatives.
_COMPLETION_SHAPES = (
    "There we go! Finished {g}, and it came together nicely.",
    "That's done! Just finished {g}.",
    "Oh, nice! Just finished {g}, pretty happy with that one.",
    "That one's done! Finished {g}.",
    "That's one down! Finished {g}.",
    "Task completed! Finished {g}, and it's looking good.",
    "Good, that's in! Finished {g}.",
    "Okay, that worked out! Just wrapped up {g}.",
    "That's sorted! Just wrapped up {g}, and it went smoothly.",
    "That's in! Finished {g}.",
    "Lovely! Finished {g}, and I like how it turned out.",
    "Nice, that's sorted! Wrapped up {g}.",
    "Task completed! Finished {g}, glad that one's in place.",
    "Alright, that's done! Finished {g}, and it went in cleanly.",
)
_COMPLETION_SHAPES_MANY = (
    "There we go! Finished {g}, and it all came together nicely.",
    "Those are done! Finished {g}.",
    "Those are done! Wrapped up {g}.",
    "Nice! Wrapped up {g}, and I'm pretty happy with how those turned out.",
    "Good, those are in! Finished {g}.",
    "Tasks completed! Just wrapped up {g}, and it's all looking good.",
)

def completion_line(contents, n=0):
    """Todo item text(s) that just completed -> one spoken line."""
    clauses = [as_spoken_clause(speakable(c, max_chars=90)) for c in contents if (c or "").strip()]
    clauses = [c for c in clauses if c]
    if not clauses:
        return "Task completed!"
    shapes = _COMPLETION_SHAPES if len(clauses) == 1 else _COMPLETION_SHAPES_MANY
    return shapes[n % len(shapes)].format(g=_join_clauses(clauses[:3]))


def for_the_ear(text: str) -> str:
    """A written reply, rewritten to be heard: speakable() plus the internal
    machinery a listener should never be told about. A reply that is ONLY
    machinery comes back empty, and the caller keeps the original rather than
    saying nothing."""
    t = lead_in(" ".join((text or "").split()))        # before anything else can mistake it
    t = _CLAIMS_SENTENCE.sub(" ", t)
    t = _MACHINE_TAIL.sub("", t.strip())
    return agree_articles(one_article(speakable(for_reading_aloud(strip_machinery(t)))))


if __name__ == "__main__":
    demo = (
        "I have found **3** issues in `~/ash/brain/settings.json`.\n"
        "- The first is that the API returns 8.2GB of data\n"
        "- e.g. it is not cached, so CPU usage hits 95%\n"
        "See https://example.com/docs for details. I will fix it in 250ms."
    )
    print("BEFORE:\n" + demo)
    print("\nAFTER:\n" + speakable(demo))
    print("\nPHRASES:")
    for p in phrases(speakable(demo)):
        print("  •", p)
