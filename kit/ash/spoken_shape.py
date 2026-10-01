#!/usr/bin/env python3
"""
spoken_shape — how a spoken SENTENCE is put together (PLAN 18.3, second extraction).

`spoken_words` decides how a token is said; this decides how the words around it make a
sentence a person would say: a bare to-do imperative turned into a first-person clause with
its gerund and its article ("Install Tailwind plugin" -> "I'm installing the Tailwind
plugin"), a/an agreed by sound, a doubled article collapsed, the opener a line may begin
with, the recap slotted into a check-in, a narration line cut back to one whole clause.

It decides nothing about WHETHER a thing is said — that is `spoken_choice` — and it never
calls `speakable()`, so it sits under the pipeline rather than inside it. Every comment block
moved with its code: each is the scar of a line that was heard wrong.
"""
import re


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


# A word like "of" or "in" between the two is two noun phrases, and both keep their article
# (2026-09-24 sweep): "the root of the tree" came out "the root of tree", "the top of the page"
# as "the top of page", in every lesson and every reply.
_DOUBLE_ARTICLE = re.compile(
    r"\b(the|a|an)\s+((?:(?!(?:of|in|on|at|to|for|from|with|by|and|or|but|is|are|was|were|be|been|"
    r"into|onto|over|under|about|than|as|that|which|near|behind|beside|inside|across|through|after|"
    r"before|like|off|up|down|out)\b)[\w-]+\s+){0,2}?)\b(the)\s+", re.I)


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


# A/AN BY SOUND, not by spelling (D315). A lesson line went out as "a binary search tree is a
# organized network" (2026-09-22) — the owner's "bad English" complaint, in one word. Only a
# lowercase word after the article is judged: a spelled-out letter ("a U R L") or an acronym is
# left alone, because how it sounds depends on the letter, and a wrong fix is worse than none.
_ARTICLE = re.compile(r"\b([Aa]n?)\s+([A-Za-z][a-z'-]+)")
_VOWEL_SOUND_EXCEPT = ("hour", "honest", "honou", "honor", "heir")           # h is silent
_CONSONANT_SOUND_EXCEPT = ("one", "once", "uni", "use", "usu", "user", "uti", "euro", "eu",
                           "ufo", "ukul", "uran", "ure", "uri", "uro")        # "you"/"w" sounds


def _starts_with_vowel_sound(word):
    w = word.lower()
    if w.startswith(_VOWEL_SOUND_EXCEPT):
        return True
    if w.startswith(_CONSONANT_SOUND_EXCEPT):
        return False
    return w[0] in "aeiou"


def agree_articles(text: str) -> str:
    """'a organized' -> 'an organized', 'an function' -> 'a function', by sound."""
    def fix(m):
        art, word = m.group(1), m.group(2)
        if word[0].isupper():                  # a name, a letter, an acronym: not ours to judge
            return m.group(0)
        want = "an" if _starts_with_vowel_sound(word) else "a"
        if art.lower() == want:
            return m.group(0)
        return (want.capitalize() if art[0].isupper() else want) + " " + word
    return _ARTICLE.sub(fix, text or "")

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
