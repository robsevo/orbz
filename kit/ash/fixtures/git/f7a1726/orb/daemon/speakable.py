#!/usr/bin/env python3
"""
speakable — turn written text into something a voice can say.

THE BIGGEST ROBOTIC TELL IS NOT THE MODEL. It is feeding a TTS engine text that
was written to be READ. An LLM writes `~/.sergio/settings.json`, "8.2GB", "e.g.",
bullet lists and code fences. Read literally, any engine on earth sounds like a
machine, because no human would ever say those strings out loud.

So this runs first, every time. It is the difference between "slash home slash
ovrsv slash dot sergio slash settings dot json" and "your settings file".
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
    _say_package, _say_path, _two_digit_words, _year_words)

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
    t = re.sub(r"\s*\b\d+[.)]\s*$", "", t).strip()   # an orphan "2." left by the cut
    if t and t[-1] not in ".!?":
        t += "."
    return t


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


def speakable(text: str, max_chars: int = 700) -> str:
    t = cut_code(text)

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


# ---- engine machinery that must never reach the ear -----------------------
# The engine promotes a seat's raw reasoning when it wrote no reply, prefixed
# with this marker (loop.mjs REASONING_SALVAGE_MARK). It is internal — a person
# should never hear "no reply was written, the text below is this seat's own
# reasoning". Same for a <claims> block. See ash-fluidity-fixes.
_SALVAGE_MARK = "no reply was written"
_SALVAGE_RE = re.compile(r"\(\s*no reply was written:.*?\)", re.S | re.I)
_CLAIMS_RE  = re.compile(r"<claims>.*?</claims>", re.S | re.I)
_VERIFIED_RE = re.compile(r"^\s*(?:verified\b|✓\s|✗\s).*$", re.I | re.M)


def is_internal(text: str) -> bool:
    """A reply that is really promoted reasoning or a bare machinery receipt —
    not an answer a person should hear read aloud."""
    return _SALVAGE_MARK in (text or "").lower()


def strip_internal(text: str) -> str:
    """Remove the salvage marker, claims blocks and verify receipts from text
    that will be spoken. Leaves a real answer untouched."""
    t = _SALVAGE_RE.sub(" ", text or "")
    t = _CLAIMS_RE.sub(" ", t)
    t = _VERIFIED_RE.sub(" ", t)
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


if __name__ == "__main__":
    demo = (
        "I have found **3** issues in `~/.sergio/settings.json`.\n"
        "- The first is that the API returns 8.2GB of data\n"
        "- e.g. it is not cached, so CPU usage hits 95%\n"
        "See https://example.com/docs for details. I will fix it in 250ms."
    )
    print("BEFORE:\n" + demo)
    print("\nAFTER:\n" + speakable(demo))
    print("\nPHRASES:")
    for p in phrases(speakable(demo)):
        print("  •", p)


# ---- narration: a to-do fragment turned into something a person would say ----
# The lines the user hears mid-build are tool `description` fields. Even a good
# model writes them as log entries — "Install Tailwind Vite plugin.", "Start the
# Vite development server in background." — bare imperatives, no subject, no
# articles, identical shape every time. Read aloud every 40 seconds that is the
# robot voice (user, 2026-09-15: "he sounds like a robot"). This turns each one
# into a spoken clause and varies how it opens, so four in a row sound like a
# person working, not a queue being drained.
#
# It is a fallback, not the main event: `ashd.NARRATION_BRIEF` asks the linked
# session to write these as speech in the first place. This catches what it misses.

_DOUBLE = {"run", "set", "stop", "plan", "drop", "map", "swap", "trim", "wrap", "fit",
           "split", "commit", "submit", "reset", "put", "get", "cut", "hit", "let",
           "shut", "quit", "scan", "ship", "skip", "strip", "tag", "log", "plug",
           "dig", "trip", "flip", "clip", "chat", "chop", "spot", "pin", "bin"}

_VERBS = {
    # A verb missing from this set is left as a bare imperative in the middle of a spoken
    # sentence — "I'm fixing the broken import and reload it" (2026-09-18).
    "reload", "restore", "serve", "plot", "chart", "measure", "compare", "summarise",
    "summarize", "diagnose", "trace", "profile", "benchmark", "teach", "explain", "show",
    "create", "make", "build", "add", "install", "reinstall", "remove", "delete",
    "update", "upgrade", "bump", "fix", "patch", "write", "edit", "rewrite",
    "refactor", "rename", "move", "copy", "run", "start", "stop", "restart",
    "launch", "open", "close", "check", "verify", "test", "confirm", "inspect",
    "review", "read", "scan", "search", "find", "set", "configure", "wire", "hook",
    "scaffold", "initialize", "init", "generate", "implement", "replace", "extract",
    "split", "merge", "clean", "clear", "reset", "apply", "mount", "deploy", "push",
    "pull", "commit", "load", "save", "import", "export", "enable", "disable",
    "switch", "convert", "migrate", "adjust", "tweak", "tune", "style", "polish",
    "finish", "complete", "handle", "validate", "parse", "render", "wrap", "expose",
    "connect", "link", "format", "lint", "compile", "bundle", "optimize", "document",
    "define", "list", "print", "send", "fetch", "query", "seed", "insert", "append",
    "trim", "strip", "normalize", "sort", "filter", "wait", "swap", "drop", "map",
    # Added 2026-09-16 after the live log read task labels out as bare imperatives:
    # "Finished Record project lessons in memory - task completed." The head word is
    # only gerundized when it is in this set, so every verb missing from it lands in
    # the spoken line unchanged, which is the single most robotic thing he says.
    # These are the verbs an agent's own to-do list actually uses.
    "record", "refine", "address", "investigate", "measure", "diagnose", "reproduce",
    "audit", "assess", "analyze", "analyse", "evaluate", "compare", "benchmark",
    "profile", "trace", "debug", "resolve", "correct", "repair", "restore", "revert",
    "rollback", "retry", "recover", "harden", "secure", "sanitize", "escape", "guard",
    "gate", "cap", "limit", "throttle", "cache", "index", "batch", "stream", "buffer",
    "flush", "sync", "mirror", "backup", "archive", "prune", "purge", "compact",
    "expand", "extend", "shrink", "resize", "reorder", "regroup", "restructure",
    "reorganize", "simplify", "clarify", "rephrase", "reword", "annotate", "comment",
    "describe", "explain", "summarize", "summarise", "note", "log", "report",
    "surface", "expose", "hide", "collapse", "toggle", "select", "highlight",
    "focus", "scroll", "navigate", "route", "redirect", "forward", "proxy",
    "serve", "host", "publish", "release", "ship", "roll", "stage", "promote",
    "provision", "teardown", "spin", "boot", "shutdown", "kill", "pause", "resume",
    "schedule", "queue", "dispatch", "trigger", "emit", "subscribe", "publish",
    "poll", "watch", "monitor", "alert", "notify", "warn", "raise", "throw",
    "catch", "assert", "mock", "stub", "fake", "cover", "instrument", "measure",
    "tidy", "organize", "group", "rank", "score", "weigh", "tag", "label", "name",
    "title", "caption", "translate", "localize", "adapt", "tailor", "customize",
    "theme", "skin", "animate", "transition", "fade", "center", "centre", "align",
    "space", "pad", "size", "scale", "crop", "compress", "minify", "inline",
    "embed", "attach", "detach", "bind", "unbind", "mount", "unmount", "register",
    "deregister", "initialise", "finalize", "teardown", "reset", "seed", "populate",
    "fill", "empty", "count", "sum", "aggregate", "join", "match", "match",
}

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
    (re.compile(r"\bash\s?new\b", re.I), "the project setup"),
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
_PREP_ARTICLE = re.compile(
    r"\b(in|on|from|into|inside|under|within|across|by|for|with|to)\s+"
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


_DOUBLE_ARTICLE = re.compile(r"\b(the|a|an)\s+((?:[\w-]+\s+){0,2}?)\b(the)\s+", re.I)


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


def one_article(text: str) -> str:
    """"the current the app component" -> "the current app component".

    The filename rule speaks a bare `App.tsx` as "the app component", article included, so a
    sentence that already had one ends up with two (heard 2026-09-18). Whichever article
    came first is the one that survives.
    """
    prev = None
    while prev != text:
        prev = text
        text = _DOUBLE_ARTICLE.sub(lambda m: f"{m.group(1)} {m.group(2)}", text)
    return re.sub(r"\s{2,}", " ", text)


def strip_machinery(text: str) -> str:
    """Say what is being done, never which in-house command does it."""
    t = _TEMPLATE_CLAUSE.sub("", text or "")
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


_SUBJECTED = re.compile(r"^(?:i\b|i'|we\b|let me\b|that\b|there\b|it\b|the\b|this\b|"
                        r"your\b|my\b|they\b|he\b|she\b|everything\b|both\b)", re.I)
_GERUND_HEAD = re.compile(r"^(?:re)?[a-z]+ing\b", re.I)


def with_subject(clause: str) -> str:
    """Give a spoken clause the person doing it.

    `as_spoken_clause` turns an imperative into a gerund — "scaffold the project" becomes
    "scaffolding the project" — and a gerund on its own is a caption, not a sentence. Read
    aloud it is precisely the robot voice the narration brief exists to prevent
    ("Scaffolding the Moonrunner web project.", heard 2026-09-18, with the brief missing
    from that session entirely). The model writes first person when the brief reaches it;
    this holds the line when it does not.
    """
    c = (clause or "").strip()
    if not c or _SUBJECTED.match(c):
        return c
    if _GERUND_HEAD.match(c):
        return "I'm " + c[0].lower() + c[1:]
    return c


def _gerund(verb):
    v = verb.lower()
    if v.endswith("ie"):  return v[:-2] + "ying"
    if v in _DOUBLE:      return v + v[-1] + "ing"
    if v.endswith("e") and not v.endswith(("ee", "oe", "ye")):
        return v[:-1] + "ing"
    return v + "ing"


_DETERMINER = re.compile(r"^(the|a|an|its|his|her|their|our|my|this|that|these|those|all|both|"
                         r"some|any|each|every|no|one|two|three|several|more|new|another)\b", re.I)


_COMMAND_HEAD = re.compile(r"(?:N P M|N P X|P N P M|git|yarn|bun|pip|python3?|node|docker|cargo|make|"
                           r"curl|go|deno|uv|brew|pacman|systemctl|ash)\b(?:\s+\S+)", re.I)


def _object_phrase(rest):
    """Give a bare singular object the article a person would say: "Install Tailwind
    plugin" -> "the Tailwind plugin". Plurals and proper-noun lists take none."""
    rest = rest.strip()
    if not rest or _DETERMINER.match(rest):
        return rest
    # A pronoun is already the thing: "then check it" is not "then check the it". Heard
    # once the template phrase started being cut, which left more sentences ending on one.
    if re.match(r"^(?:it|them|they|him|her|us|me|everything|anything|both)\b", rest, re.I):
        return rest
    words = rest.split()
    head = words[0]
    # "fixing the missing @vitejs/plugin-react" already carries its own article
    # once the package rule has run ("the vitejs plugin react package") - a second
    # one gives "the missing the ... package".
    if any(_DETERMINER.match(w) for w in words[1:3]):
        return rest
    tail_word = re.split(r"\s+(?:and|then|to|for|in|on|with|from|into)\b", rest)[0].split()
    last = tail_word[-1].rstrip(".,") if tail_word else ""
    plural = last.endswith("s") and not last.endswith(("ss", "us", "is"))
    # A phrase whose head noun is itself a proper name ("Vite and Tailwind") takes
    # no article; one that ends in a common noun ("Tailwind Vite plugin") does.
    proper = last[:1].isupper() and head[:1].isupper()
    if plural or proper or head.startswith("@") or "/" in head:
        return rest
    # A command is not a thing with an article: "running N P M run dev", never
    # "running the N P M run dev" (heard 2026-09-15).
    if _COMMAND_HEAD.match(rest):
        return rest
    return "the " + rest


def as_spoken_clause(text):
    """An imperative to-do line -> the clause a person would speak."""
    t = (text or "").strip().rstrip(".")
    if not t:
        return ""
    # conjoined steps each get their own verb: "Create X and initialize Y"
    parts = re.split(r"(\s+and\s+then\s+|\s*,\s*then\s+|\s+and\s+|\s*,\s+)", t)
    out = []
    for seg in parts:
        if not seg or re.fullmatch(r"\s*(and\s+then|,\s*then|and|,)\s*", seg):
            out.append(seg if seg.strip() else seg)
            continue
        words = seg.strip().split()
        if not words:
            out.append(seg); continue
        head = words[0].lower().strip(",")
        base = head[3:] if head.startswith("re-") else head
        if base in _VERBS or head in _VERBS:
            g = ("re" + _gerund(base)) if head.startswith("re-") else _gerund(head)
            out.append(" ".join([g, _object_phrase(" ".join(words[1:]))]).strip())
        else:
            out.append(seg.strip())
    t = " ".join(x.strip() for x in out if x and x.strip())
    t = re.sub(r"\s+(and|,)\s+", lambda m: " and " if m.group(1) == "and" else ", ", t)
    t = re.sub(r"\bin background\b", "in the background", t, flags=re.I)
    return re.sub(r"\s{2,}", " ", t).strip()


# Openers, so four lines in a row are not four lines of the same shape. Never the
# same one twice running, and a plain clause is one of the options.
# "Right, " is out: spoken aloud it is a homophone of Write, and after a session of hearing
# "Right, I'm checking the dependencies" the user heard the TOOL NAME and asked why he keeps
# saying "write" before a sentence (2026-09-17). Nothing else in the rotation collides with a
# tool name, which is the bar for anything added here.
# WAS A ROTATION, WHICH IS A TIC. Every line after the first took the next opener in turn,
# so a build narrated itself "Okay, I'm... Next, I'm... Then I'm... So I'm..." — five
# consecutive sentences each starting with a filler, which is nothing like a person and
# everything like a machine reading a list (user, 2026-09-19, all day). Most lines now get
# none at all, and the ones that do get a word someone would actually say.
_OPENERS = ("", "Now ", "Okay, ", "Next, ", "Then ", "So ", "Alright, ")
_HUMAN_OPENERS = ("Okay, ", "Alright, ")    # never "Right," — heard as the tool Write, 2026-09-17
OPENER_EVERY = 4        # at most one line in four begins with anything at all
# A recovery opener claims HIS LAST ACTION failed, so it may only fire on evidence of a
# second attempt — not on a word describing the thing being worked on. The old list held
# "fix", "broken", "missing", "error" and "failed", which are all things a task can simply
# BE about: on 2026-09-17 the user asked him to look at a broken page and every line came
# out "That didn't take, so I'm checking what is broken", when nothing had been tried yet.
# What is left refers to a previous go: doing it again, differently, or falling back.
_RECOVERY = re.compile(r"(\bretry(?:ing)?\b|\bre-?install(?:ing)?\b|\bre-?run(?:ning)?\b|"
                       r"\bre-?try(?:ing)?\b|\btry(?:ing)? again\b|\bonce more\b|"
                       r"\bthis time\b|\binstead\b|\bfall(?:ing)? ?back\b|"
                       r"\bthat (?:did ?n[o']?t|failed)\b)", re.I)
_RECOVERY_OPENERS = ("That didn't take, so ", "That one failed, so ", "Hit a snag, so ")

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


def _join_clauses(clauses):
    if len(clauses) == 1:
        return clauses[0]
    return ", ".join(clauses[:-1]) + " and " + clauses[-1]


# ---------------------------------------------------------------- the check-in recap
# When the 40 s pace comes round, the line should also carry what he got through
# since the last one - but as part of the sentence, never as a report ("so far I
# have completed three items" is exactly the robot the user does not want). The
# clauses are gerunds already ("writing the hero section"), so they slot straight
# in after "after" or "having". Capped short, most recent first-in-time order.
# Recap items arrive as GERUND phrases ("inspecting the icons library"), because
# NARRATION_BRIEF asks for first-person descriptions and as_recap_item converts them. Only
# shapes that can take a gerund belong here. "{line}, with {done} already sorted." cannot:
# it produced "I'm verifying the live dev server status, with inspecting the local brand
# icons library and verifying that the development server responds already sorted" on
# camera, 2026-09-17 — three times in one build, because it is one of three shapes on a
# rotation. A shape that only works for noun phrases is a shape that is wrong one time in
# three, so it is gone rather than guarded.
_RECAP_SHAPES = (
    "{line}, after {done}.",
    "{line}. Just wrapped up {done}.",
)


# ashd.NARRATION_BRIEF asks him to write descriptions in the FIRST PERSON ("I'm
# installing the Tailwind plugin") - so a recap built for imperative to-do fragments
# produced "Just wrapped up I'm installing the Tailwind CSS executable and I'm
# installing all project dependencies and." (heard 2026-09-15, 20:21:39). A recap
# slot wants a bare gerund phrase, whichever shape the description arrived in.
_FIRST_PERSON = re.compile(r"^(?:i\s*'m|i\s+am|i\s*'ve|i\s+have|i\s*'ll|i\s+will|let\s+me|i)\s+", re.I)

# Cutting a phrase at N words lands mid-thought and leaves the conjunction hanging
# ("...and project dependencies and."). Trim back to something that can end.
_DANGLING_WORDS = {"and", "or", "but", "so", "then", "to", "the", "a", "an", "of", "in", "on",
             "for", "with", "that", "if", "from", "into", "at", "by", "as", "while"}


def as_recap_item(clause):
    """One 'what I was doing' phrase, in the shape a recap slot can take."""
    t = _FIRST_PERSON.sub("", (clause or "").strip())
    if not t:
        return ""
    head = t.split()[0].lower()
    if head in _VERBS:                      # "install X" -> "installing X"
        t = as_spoken_clause(t)
    return t[0].lower() + t[1:]


_CONJ = {"and", "or", "then", "but"}


def _short(clause, words=6):
    w = clause.split()[:words]
    # A cut that lands just after a conjunction leaves half of the second thing
    # ("installing all project dependencies and checking"): drop back to before it.
    for i in range(len(w) - 1, max(len(w) - 3, -1), -1):
        if w[i].lower().strip(",.;:") in _CONJ:
            w = w[:i]
            break
    while w and w[-1].lower().strip(",.;:") in _DANGLING_WORDS:
        w.pop()
    return " ".join(w).rstrip(",.;: ")


def with_recap(line, since, n=0):
    """A spoken progress line + a natural mention of what came before it."""
    items = [x for x in (_short(as_recap_item(c)) for c in since if c) if x][-2:]
    if not items or not line:
        return line
    out = _RECAP_SHAPES[n % len(_RECAP_SHAPES)].format(line=line.rstrip(".!"), done=_join_clauses(items))
    return out[0].upper() + out[1:]

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


def for_the_ear(text: str) -> str:
    """A written reply, rewritten to be heard: speakable() plus the internal
    machinery a listener should never be told about. A reply that is ONLY
    machinery comes back empty, and the caller keeps the original rather than
    saying nothing."""
    t = lead_in(" ".join((text or "").split()))        # before anything else can mistake it
    t = _CLAIMS_SENTENCE.sub(" ", t)
    t = _MACHINE_TAIL.sub("", t.strip())
    return one_article(speakable(for_reading_aloud(strip_machinery(t))))

_DANGLING = re.compile(r"[,;]?\s+(with|and|but|so|then|while|which|that|because|after|before|if|to|for|"
                       r"of|on|in|at|from|by)(\s+\S+)?$", re.I)


def narration_line(text):
    """One clean spoken clause out of a narration line.

    The narrator runs on a fast seat, and under load it staples clauses together. This went out
    over the speaker, on camera (2026-09-17): "I'm opening the page in your preview window right
    now, with checking if the development port is and checking that the development server is
    already so". The coherent part is always the front of it, so: the first sentence if there is
    one, otherwise the first clause, with a trailing conjunction cut off. Speaking half a sentence
    sounds broken; speaking a short whole one sounds deliberate."""
    t = " ".join((text or "").split())
    if not t:
        return ""
    end = re.search(r"[.!?]", t)
    if end:
        return t[:end.end()]
    words = t.split()
    if len(words) > 15:                      # the brief asks for under fifteen words
        head = " ".join(words[:15])
        cut = head.rfind(",")
        t = head[:cut] if cut > 20 else head
    t = _DANGLING.sub("", t).rstrip(" ,;:-")
    return (t + ".") if t else ""
