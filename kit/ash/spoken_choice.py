#!/usr/bin/env python3
"""
spoken_choice — WHAT is said at all (PLAN 18.3, second extraction).

Everything here removes or keeps, and none of it rephrases: the report cut to its lead-in,
nothing after the first line of code, a line clamped to one breath group, promoted reasoning
and claims receipts kept out of the ear, the in-house tool names and the template phrase
dropped, a repeat recognised as a repeat, an inline list reduced to the sentence before it.

It reads the sentence grammar from `spoken_shape` (an article agreed, an article collapsed,
the openers a repeat must look past) and never calls `speakable()`, so the import graph is
spoken_words <- spoken_shape <- spoken_choice <- speakable, with no cycle.
"""
import re

from spoken_shape import (  # noqa: F401
    _OPENERS, _RECOVERY_OPENERS, agree_articles, one_article)


_CODE_EDGE = re.compile(
    r"(?:"
    r"\btools?\s+default[_ ]?api\b|\bdefaultapi\b|\bfunctions?[.:]\w+|"      # serialised call
    r"\bfile[_ ]?path\b|\bnew[_ ]?string\b|\bold[_ ]?string\b|"                # its argument names
    # javascript — the SHAPE of a statement, not the keyword. "the broken import and
    # reload it" and "return the page to its previous state" are English sentences, and
    # cutting at the keyword silently ate the rest of the line (2026-09-18: the user heard
    # "I'm fixing the broken." and asked what).
    r"\b(?:export|import)\s+(?:default\s+)?[{*]|"
    # "export default function App()" — the commonest line in a React file, and none of the
    # shapes here caught it: the cut landed on `function App()` instead and left "export
    # default" in front of it, spoken as if it were English. test_code_never_spoken says so,
    # and had said so since it was written — it was defined after the suite's exit and never
    # ran (found 2026-09-18). "export the class list" is still English: the keyword has to be
    # followed straight away by a declaration.
    r"\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\b|"
    r"\b(?:export|import)\s+[\w$]+\s*,?\s*[{]|"
    r"\b(?:export|import)\s+[\w$]+\s+from\b|\bfrom\s+['\"][^'\"]+['\"]\s+import\b|"
    r"\b(?:const|let|var)\s+[\w$]+\s*[=:]|"
    r"\breturn\s+[({<\[]|"
    r"\bfunction\s+\w*\s*\(|=>|className=|</|/>|\{/\*|"
    r"\b[A-Z][A-Za-z_]{2,24}\(|"                                               # Write(, Bash(

    r"[{}<>]|\)\s*\{|;\s*$"
    r")", re.I | re.M)


SPOKEN_SENTENCES = 3       # a spoken turn that needs a fourth is an essay read aloud
SPOKEN_WORDS = 40       # long sentences get cut at two; short ones still fit three


# --------------------------------------------------------------------------- reports
# He sounds like a robot SOMETIMES, and the tell is which source the line came from.
# A narrated build pass is written to be heard. The final message of a coding turn is
# written to be READ — a report, with markdown, numbered findings and a paragraph of
# gate-appeasing boilerplate — and it was going to the speaker verbatim. Heard on
# 2026-09-19: "I've built the world clock wall project exactly as requested: 1. Created
# a New Folder: The project has been create under the world clock directory and
# verified. 2." He read the list numbers out loud. That is the whole "sometimes robot,
# sometimes not": prose answers were fine, report answers were machine noise.
_MD = [
    (re.compile(r"```.*?```", re.S), " "),          # fenced code
    (re.compile(r"`([^`]*)`"), r"\1"),              # inline code ticks
    (re.compile(r"\*\*([^*]*)\*\*"), r"\1"),       # bold
    (re.compile(r"(?<!\w)[*_]([^*_]+)[*_](?!\w)"), r"\1"),
    (re.compile(r"\[([^\]]*)\]\([^)]*\)"), r"\1"),  # links: keep the words
    (re.compile(r"^\s{0,3}#{1,6}\s*", re.M), ""),   # headings
    (re.compile(r"^\s*[-*\u2022]\s+", re.M), ""),  # bullets
]

# A sentence that exists to satisfy a gate, not to tell anyone anything.
_MACHINE = re.compile(
    r"\bclaims?\b.*\b(gate|check|valid)|"
    r"\b(valid|verif)\w*\s+(check|status|step)|"
    r"\bin this (turn|interaction)\b|"
    r"\bexact command\b|"
    r"\bfully executed\b|"
    r"\bto (ensure|satisfy)\b.*\b(match|check|record|verif)", re.I)

# Servile filler that reads fine and sounds like a form letter.
_SERVILE = re.compile(
    r"\s*\b(exactly |precisely )?as (requested|instructed|asked)\b|"
    r"\s*\bas per your (request|instructions)\b|"
    r"\s*\bper your request\b", re.I)

_LIST_HEAD = re.compile(r"(?m)^\s*\d+[.)]\s+|\s\d+[.)]\s+(?=[A-Z])")


def from_report(text: str) -> str:
    """Turn a written answer into a spoken one.

    Markdown out, list scaffolding out, gate boilerplate out. What is left is the
    sentence a person would actually say. Returns "" only if there was nothing to say,
    which the caller treats as 'stay quiet' rather than 'read the report'."""
    t = (text or "").strip()
    if not t:
        return ""
    # A HEADING OR A BULLET LIST ENDS WHAT IS SAID (2026-09-27, take 9). "The dashboard is live at
    # <url>" followed by "**Features Implemented**" and a list came out "...is live at the link
    # Features Implemented." — once the markdown is stripped the heading joins the sentence above
    # it. What sits under a heading, or in bullets, is for reading. Cut before it, on the raw text.
    head = re.search(r"(?m)^\s{0,3}(?:#{1,6}\s|\*\*[^*\n]+\*\*\s*:?\s*$|[-*\u2022]\s+|[^\n.!?]{1,40}:\s*$)", t)
    if head and len(t[:head.start()].split()) >= 3:
        t = t[:head.start()].strip()
    for rx, rep in _MD:
        t = rx.sub(rep, t)
    # A list is a thing to LOOK at. Keep the lead-in that introduces it and stop there.
    m = _LIST_HEAD.search(t)
    if m:
        lead = t[:m.start()].strip()
        t = lead if len(lead.split()) >= 3 else t[:m.start()].strip()
    t = _SERVILE.sub("", t)
    t = re.sub(r"\s*:\s*$", ".", t)                  # "...as follows:" -> a full stop
    t = re.sub(r"[ \t]+", " ", t).replace(" ,", ",")
    # Drop whole sentences written for the engine rather than the room.
    keep = [p for p in re.split(r"(?<=[.!?])\s+", t) if p.strip() and not _MACHINE.search(p)]
    t = " ".join(keep).strip() if keep else ""
    # an orphan "2." left by the cut — a number standing ALONE, never the end of "localhost:5173."
    t = re.sub(r"(?:^|\s)\d+[.)]\s*$", "", t).strip()
    if t and t[-1] not in ".!?":
        t += "."
    # speak() shapes EVERY line through here, the ask path's answers included — for_the_ear only
    # runs on the linked terminal's reply feed — so a/an is agreed here too (D315).
    return agree_articles(t)


def clamp_spoken(text, sentences=SPOKEN_SENTENCES, words=SPOKEN_WORDS):
    """Trim a spoken line to something a person would actually say in one breath group.

    Whole sentences only — a line cut mid-clause is worse than a long one, because the
    listener waits for an ending that never arrives. Returns (text, trimmed).

    The brief asks for one short sentence per build pass and nothing enforced it: on
    2026-09-17 a single pass was narrated with three sentences and 55 words, naming a CSS
    framework, a blur effect and a background gradient. The constitution's own rule for
    spoken turns is fewer complete sentences, not shorter grammar, which is exactly what
    trimming at a sentence boundary preserves."""
    t = (text or "").strip()
    if not t:
        return "", False
    parts = re.split(r"(?<=[.!?])\s+", t)
    kept, total = [], 0
    for part in parts:
        n = len(part.split())
        if kept and (len(kept) >= sentences or total + n > words):
            break
        kept.append(part)
        total += n
        if len(kept) >= sentences or total >= words:
            break
    out = " ".join(kept).strip()
    return (out or t), len(kept) < len(parts)


def cut_code(text: str) -> str:
    """Everything before the first thing that is code. Nothing after it is ever spoken.

    A reply that is nothing but code returns empty, and the caller says nothing at all —
    silence is the correct output for a tool call, not a reading of it."""
    t = (text or "").strip()
    m = _CODE_EDGE.search(t)
    if m:
        t = t[:m.start()]
    # Trailing fragment: if the cut left a dangling half-sentence, end at the last full stop.
    if m and t.strip() and t.strip()[-1] not in ".!?":
        cut = max(t.rfind("."), t.rfind("!"), t.rfind("?"))
        if cut > 20:
            t = t[:cut + 1]
    return t.strip()


# ---- engine machinery that must never reach the ear -----------------------
# The engine promotes a seat's raw reasoning when it wrote no reply, prefixed
# with this marker (loop.mjs REASONING_SALVAGE_MARK). It is internal — a person
# should never hear "no reply was written, the text below is this seat's own
# reasoning". Same for a <claims> block. See ash-fluidity-fixes.
_SALVAGE_MARK = "no reply was written"
_SALVAGE_RE = re.compile(r"\(\s*no reply was written:.*?\)", re.S | re.I)
_CLAIMS_RE  = re.compile(r"<claims>.*?</claims>", re.S | re.I)
_VERIFIED_RE = re.compile(r"^\s*(?:verified\b|✓\s|✗\s).*$", re.I | re.M)


# A MODEL'S THINKING SUMMARY RETURNED AS THE ANSWER (D314). With no salvage marker at all,
# a seat once handed back "I'm reviewing the system instructions, context, constraints, and
# reminders to ensure I understand everything perfectly before proceeding" and he read it aloud
# (2026-09-22) — the most robotic thing he said all day. The tell is VOCABULARY only a model
# thinking about its prompt uses: the system instructions/prompt, "the user" in the third person
# (Ash says "you"), formulating a/my/the response, "constraints and reminders". Deliberately not
# "I'm …ing": that is his real action narration ("I'm checking the folder…").
_META_RE = re.compile(
    r"\bsystem (?:instructions?|prompt)\b|\bthe user(?:'s)?\b|"
    r"\bformulat\w* (?:a|my|the) (?:final )?(?:response|answer|reply)\b|"
    r"\bconstraints,? and reminders\b|\bmy (?:final )?response\b", re.I)
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _sentences(text):
    return [s for s in _SENTENCE_SPLIT.split((text or "").strip()) if s.strip()]


def is_internal(text: str) -> bool:
    """A reply that is really promoted reasoning or a bare machinery receipt —
    not an answer a person should hear read aloud. Every sentence being the model
    talking about its own prompt counts too (D314)."""
    if _SALVAGE_MARK in (text or "").lower():
        return True
    sents = _sentences(text)
    return bool(sents) and all(_META_RE.search(s) for s in sents)


def strip_internal(text: str) -> str:
    """Remove the salvage marker, claims blocks, verify receipts and any sentence
    of the model talking about its own prompt from text that will be spoken.
    Leaves a real answer untouched."""
    t = _SALVAGE_RE.sub(" ", text or "")
    t = _CLAIMS_RE.sub(" ", t)
    t = _VERIFIED_RE.sub(" ", t)
    kept = [s for s in _sentences(t) if not _META_RE.search(s)]
    t = " ".join(kept) if kept else t
    return re.sub(r"\s+", " ", t).strip()


def norm_for_dedup(text: str) -> str:
    """Collapse a reply to its bare words, so two summaries that differ only in
    wording ("I have completed Task 1" vs "I completed Task 1, fixing…") compare
    as the near-duplicates they are."""
    t = (text or "").lower()
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"`[^`]*`", " ", t)          # code spans carry the differing detail
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def similar(a: str, b: str) -> float:
    """0..1 similarity of two replies after normalisation. Seat-agnostic, like
    the engine's loop-guard: it catches a repeat whatever produced it."""
    import difflib
    na, nb = norm_for_dedup(a), norm_for_dedup(b)
    if not na or not nb:
        return 0.0
    # length-guard: a short line inside a long one is not the same reply
    if min(len(na), len(nb)) / max(len(na), len(nb)) < 0.5:
        return 0.0
    return difflib.SequenceMatcher(None, na, nb).ratio()


# Machine tails that mean nothing to a listener. Dropped before anything else.
_MACHINE_TAIL = re.compile(
    r"(?:\s*[,;—-]\s*|\s+)(?:as a (?:dedicated|single|separate)[^.]*|to (?:match|satisfy|feed)"
    r"[^.]*claims[^.]*|for the claims[^.]*|in (?:this|one|a single) turn|exact string|"
    r"verbatim|as a one-liner)\.?$", re.I)
_CLAIMS_SENTENCE = re.compile(r"[^.!?]*\bclaims (?:checker|gate|block|lookup)\b[^.!?]*[.!?]?", re.I)


# ------------------------------------------------------------------ house machinery
# Two things a listener should never hear, both from watching a take on 2026-09-18: the
# in-house tooling by name — "scaffolding the Moonrunner web project using ashnew",
# "running ashpagecheck", "the algo check" — and the fact that a page starts from a
# prepared template. The user put it exactly right: "he shouldn't say he's running it from
# a template — why is he saying secrets?" None of it is secret; all of it describes the
# workshop instead of the work. The brief has always asked for plain language about what is
# being done, and as usual the brief asking is not the same as it being true.
# The WHOLE phrase, up to the next punctuation — not just the word "template". Stripping
# the noun alone left "I'm creating the Moonrunner project using the verified Vite and
# React", which the user heard as a sentence that stops mid-thought: "he said using the —
# using the what?" (2026-09-18). If the phrase is about the workshop, the phrase goes.
_TEMPLATE_CLAUSE = re.compile(
    r"\s*\b(?:using|with|via|from|through|out of|off)\s+[^,.;:]*?"
    r"\b(?:template|boilerplate|scaffold(?:ing)?|ash\s?\w+)\b[^,.;:]*", re.I)
# Whatever else is cut, a line never ends on a preposition or an article left holding
# nothing — that is the same complaint in its most audible form.
_TRAILING_FRAGMENT = re.compile(
    r"[\s,]*\b(?:using|with|via|from|through|into|onto|to|for|on|in|at|of|and|or|the|a|an|"
    r"our|its|their|this|that)\b[\s,]*$", re.I)
_TOOL_WORDS = (
    (re.compile(r"\bash\s?page\s?check\b", re.I), "the page check"),
    (re.compile(r"\bpagecheck\b", re.I), "the page check"),
    # ...and what he already called it goes with it (2026-09-27): "Check if ashnew project creation
    # tool is available" came out "the project setup project creation tool".
    (re.compile(r"(?:\bthe\s+)?\bash\s?new\b(?:\s+(?:project\s+)?(?:creation\s+|setup\s+|scaffold(?:ing)?\s+)?"
                r"(?:tool|script|command|cli)\b)?", re.I), "the project setup tool"),
    (re.compile(r"\bash\s?show\b", re.I), "the viewer"),
    (re.compile(r"\bash\s?tutor\b", re.I), "the lesson panel"),
    (re.compile(r"\bash\s?blank\b", re.I), ""),
    (re.compile(r"\balgo[-\s]?(?:check|gate)\b", re.I), "a complexity check"),
    # A ONE-WORD replacement, on purpose: "set up" made the clause builder read "set" as
    # the verb and article the rest, giving "I'm setting the up Moonrunner web project".
    (re.compile(r"\bscaffolding\b", re.I), "creating"),
    (re.compile(r"\bscaffold(?:ed|s)?\b", re.I), "create"),
    (re.compile(r"\b(?:web|chart|project)?\s*templates?\b", re.I), ""),
    (re.compile(r"\bsha-?256\b", re.I), "checksum"),
)
# A line that is ONLY a receipt — a digest, a claims lookup, an exit code — holds nothing a
# listener can use. Silence is better than a sentence about a checksum.
_PURE_MACHINERY = re.compile(
    r"^\s*(?:get|read|compute|calculate|verify|check|confirm|gather|collect)\b[^.]*\b"
    r"(?:sha-?256|checksums?|digests?|exit code|claims?\b[^.]*verif|claims? (?:block|lookup|"
    r"check|verification)|for claims)\b", re.I)


# "listing files in moonrunner project" is understandable and it is not English. A bare
# singular noun after a preposition wants its article, and the nouns these lines reach for
# are a short, closed list — so the rule is a list rather than a parser, which cannot
# mangle a phrase it does not recognise.
_PREP_NOUNS = (r"project|page|file|server|folder|directory|component|config|configuration|"
               r"repo|repository|log|terminal|browser|editor|branch|script|module|library|"
               r"template|suite|test|panel|window|tab|chart|plot|site|app|build|helper|"
               r"endpoint|handler|hook|gate|check|loop|list|array|import|export")
# "TO" BEFORE A VERB IS NOT A PREPOSITION (2026-09-27): "Run production build to check for
# TypeScript errors" was said "to the check for" — `check` is on the noun list, and after "to" it
# is nearly always the verb. So after "to", the words that are usually verbs there take no article.
_PREP_ARTICLE = re.compile(
    r"\b(in|on|from|into|inside|under|within|across|by|for|with|"
    r"to(?!\s+(?:test|build|check|log|list|import|export|plot|chart|loop|hook|gate|branch)\b))\s+"
    r"(?!the\b|a\b|an\b|my\b|your\b|our\b|its\b|their\b|his\b|her\b|this\b|that\b|"
    r"these\b|those\b|some\b|any\b|each\b|every\b|no\b|one\b|two\b|three\b|both\b)"
    r"((?:[\w.-]+\s+){0,2}(?:" + _PREP_NOUNS + r"))\b", re.I)


# A command is not something a person says out loud. "So I'm running N P M run build to
# verify Tailwind v4 C S S generation and TypeScript compilation" was spoken on 2026-09-18:
# it names the command, spells two abbreviations letter by letter, and carries a version
# number. What a person says is what the command is FOR.
_COMMAND_PHRASES = (
    # The phrase first: "starting the dev server with npm run dev" must not become
    # "starting the dev server with the dev server". How a thing was run is not news.
    (re.compile(r"\s*\b(?:with|using|via|through)\s+(?:npm|npx|yarn|pnpm|bun|curl|tsc|node|"
                r"vite|python3?)\b[^,.;]*", re.I), ""),
    (re.compile(r"\bnpm run build\b", re.I), "the production build"),
    (re.compile(r"\bnpm run dev\b", re.I), "the dev server"),
    (re.compile(r"\bnpm (?:ci|install)\b", re.I), "the install"),
    (re.compile(r"\bnpm ls\b", re.I), "the dependency tree"),
    (re.compile(r"\bnpm run \w[\w:-]*", re.I), "the build script"),
    (re.compile(r"\bcurl(?:ing)?\s+(?=\w)", re.I), "checking "),
    (re.compile(r"\btsc\b", re.I), "the typechecker"),
    (re.compile(r"\bTailwind\s+v?\d[\w.]*\s+CSS\b", re.I), "Tailwind"),
    (re.compile(r"\bCSS generation\b", re.I), "the styles"),
    (re.compile(r"(?<=\w)\s+v\d+(?:\.\d+)*\b", re.I), ""),
)
# A port is read digit by digit. Said as a quantity it comes out "port 3 thousand 456",
# which is not how anyone says a port number (heard 2026-09-18).
_DIGIT_WORDS = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine")
_PORT = re.compile(r"\bport\s+(\d{2,5})\b", re.I)
# A URL becomes "the link", and a sentence that ended on the URL then ends on a phrase that
# points at nothing: "serving correctly at the link".
_DANGLING_LINK = re.compile(r"\s*\b(?:at|on|from|via)\s+the link\b\s*(?=[.,;]|$)", re.I)


# Written asides and stat labels do not survive being read aloud. Heard 2026-09-18, in an
# otherwise good answer: "...the last ten completed Septembers (twenty sixteen, twenty
# twenty-five) shows the trend is virtually flat. The Metrics 10-Year Linear Trend: -0.16 mm
# per year (essentially zero)." A listener cannot see the brackets, and a label with a colon
# is a table row, not a sentence.
# The claims block is a receipt for the gate that checks his work, and it is not addressed
# to the listener. Heard 2026-09-18, spoken aloud as a final answer: "Corrected Claims -
# File Hash: Updated to match the actual checksum hash of the app component. - Build..."
_CLAIMS_RECEIPT = re.compile(
    r"(?:^|(?<=[.!?\n]))\s*(?:corrected\s+)?claims?\b[^.\n]*[.\n]?"
    r"|(?:^|(?<=[.!?\n]))\s*[-*\u2022]?\s*(?:file\s+hash|sha-?256|checksum|digest)\b[^.\n]*[.\n]?",
    re.I)
_PARENTHETICAL = re.compile(r"\s*\([^()]{0,120}\)")
_STAT_SENTENCE = re.compile(r"(?:^|(?<=[.!?]))\s*[A-Z][^.!?:]{0,60}:\s*[-+]?[\d.]+[^.!?]{0,40}[.!?]")


# A receipt is written in ROWS, so it is cut in rows. Cutting by sentence split "App.tsx"
# down the middle and left "tsx. - Build: exit 0." to be read out (measured 2026-09-18).
_ROW_SPLIT = re.compile(r"\n+|\s+[-\u2022*]\s+")
_RECEIPT_ROW = re.compile(
    r"^(?:corrected\s+)?claims?\b"                       # a header row: "Corrected Claims"
    r"|^(?:file\s+hash|sha-?256|checksum|digest|build|exit\s+code|tests?|lint|typecheck)"
    r"\s*[:=]", re.I)                                     # a value row: "Build: exit 0"


_TICKS = re.compile(r"[`\u2018\u2019\u201c\u201d]+")


def for_reading_aloud(text: str) -> str:
    """Drop what only works on the page: receipt rows, bracketed asides, label-value rows."""
    text = _TICKS.sub("", text or "")
    kept = []
    for row in (r.strip() for r in _ROW_SPLIT.split(text or "") if r and r.strip()):
        if not _RECEIPT_ROW.match(row):
            kept.append(row)
            continue
        # The receipt usually runs into the sentence that matters — "…- Build: exit 0. The
        # world clock wall is up." Drop the receipt, keep the sentence; dropping the whole
        # row threw the answer away with it.
        rest = re.split(r"(?<=[.!?])\s+", row, maxsplit=1)
        if len(rest) == 2 and len(rest[1].split()) >= 4:
            kept.append(rest[1])
    t = " ".join(kept) if kept else ""
    t = _PARENTHETICAL.sub("", t)
    if len(re.findall(r"[.!?]", t)) > 1:
        t = _STAT_SENTENCE.sub(" ", t)
    return re.sub(r"\s{2,}", " ", t).strip()


def strip_machinery(text: str) -> str:
    """Say what is being done, never which in-house command does it."""
    # the engine's own header on a seat's promoted reasoning is machinery, never a line (take 10:
    # "(no reply was written: the text below is this seat's own reasoning, promoted so the work
    # isn't lost." was narrated, and the phrase filter made it "Running the tests now.")
    t = re.sub(r"\(?\s*no reply was written:[^.)]*(?:[.)]\s*\)?|$)", "", text or "", flags=re.I)
    t = _TEMPLATE_CLAUSE.sub("", t)
    for rx, word in _COMMAND_PHRASES:
        t = rx.sub(word, t)
    t = _PORT.sub(lambda m: "port " + " ".join(_DIGIT_WORDS[int(d)] for d in m.group(1)), t)
    t = _DANGLING_LINK.sub("", t)
    t = one_article(t)
    for _ in range(3):                       # "… using the" -> "… using" -> "…"
        cut = _TRAILING_FRAGMENT.sub("", t)
        if cut == t:
            break
        t = cut
    for rx, word in _TOOL_WORDS:
        t = rx.sub(word, t)
    t = _PREP_ARTICLE.sub(lambda m: f"{m.group(1)} the {m.group(2)}", t)
    t = re.sub(r"\s{2,}", " ", t)
    t = re.sub(r"\s+([,.;])", r"\1", t)
    return t.strip(" ,;")


# Comparing two spoken lines as strings does not work, and _OPENERS above is the reason:
# the opener is ROTATED on purpose so consecutive lines do not sound alike, which means
# the same sentence three times reads as three different strings. On 2026-09-17 that put
# "Then I'm creating the project from our verified web template", "Okay, I'm creating the
# project from our verified web template" and "I'm creating the project from our verified
# web template" on camera eight seconds apart. Strip the opener before comparing.
_OPENER_RE = re.compile(
    r"^(?:" + "|".join(re.escape(o.strip().rstrip(",")) for o in _OPENERS + _RECOVERY_OPENERS
                       if o.strip()) + r")[,\s]+", re.I)


def body(text):
    """A spoken line reduced to what it actually says, for comparing against the last one."""
    t = _OPENER_RE.sub("", (text or "").strip()).strip()
    t = re.sub(r"[^\w\s]", "", t).lower()
    return re.sub(r"\s+", " ", t).strip()


def repeats(text, recent, ratio=0.92):
    """True when this line says what one of `recent` already said."""
    import difflib
    b = body(text)
    if not b:
        return False
    for old in recent:
        o = body(old)
        if not o:
            continue
        if b == o or difflib.SequenceMatcher(None, b, o).ratio() >= ratio:
            return True
    return False


# D13, 2026-09-18 — the last thing he said on camera that night: "I've run the environment
# contract test suite and the full hooks contract suite. What They Prove 1. Environment
# Integ". A reply that enumerates was read out as a list and then cut off mid-word by the
# length clamp. _NUMLIST only sees markers at the START of a line, and replies arrive here
# flattened to one, so an inline list was never recognised at all. Worse, "1." reads as a
# full stop and the colon before it made the lead-in look like a label: value receipt, so
# for_reading_aloud threw away the ONE sentence worth saying and kept the list. A spoken
# answer says its lead-in and stops; the list is on screen for anyone who wants it.
#
# A list only counts when it is really one: numbered from 1, with a 2 after it, each marker
# free-standing and followed by a capital. "Tailwind v4. It…", "port 5173." and "version 2.
# Then…" are not lists.
_INLINE_ITEM = re.compile(r"(?<![\w.])(\d{1,2})[.)]\s+(?=[A-Z\"'\u2018\u201c])")
_HEADING_TAIL = re.compile(r"(?<=[.!?])\s*(?:[A-Z][\w'\u2019-]*\s*){1,5}$")


def lead_in(text: str) -> str:
    """The sentence before an inline numbered list; the text unchanged if there is no list."""
    t = text or ""
    marks = list(_INLINE_ITEM.finditer(t))
    nums = [int(m.group(1)) for m in marks]
    if len(marks) < 2 or nums[0] != 1 or 2 not in nums:
        return t
    head = _HEADING_TAIL.sub("", t[:marks[0].start()].rstrip()).rstrip(" :;,-\u2014")
    if len(head.split()) >= 3:
        return head if head[-1:] in ".!?" else head + "."
    # nothing worth saying ahead of the list: say its first item, without the number
    first = t[marks[0].end():marks[1].start()].strip()
    return first
