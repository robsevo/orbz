#!/usr/bin/env python3
"""How a written token is SAID (PLAN 18.3, extracted from `speakable.py`).

Paths, filenames, directories, numbers, dates, abbreviations, units, package names. One
subject: taking something that was written to be read and producing the words a person would
actually say for it. `/home/user/programs/ash/orb/daemon/day.py` is not "slash home slash
user"; it is "day dot pee why", and everything in here is a decision of that kind.

**Why it moved.** `speakable.py` was 1,347 lines doing three separable jobs — saying a token,
shaping a sentence, and choosing what to say at all. This is the first, and it is the one with
no dependencies on the other two: nothing here knows about narration, openers, recaps or
repetition.

**The extraction is proved rather than asserted.** `behaviour_baseline.py` froze the answers
for these before the move — through the public surface, which is how callers reach them, plus
the five that take a plain value — and the move produced no drift and needed no re-bless. That
is the property 18.5_t exists for: the map says where a name lives, and only the answers say
whether it still works.
"""
import re

# ---- things that must never be read aloud ---------------------------------
_FENCE   = re.compile(r"```.*?```", re.S)
_INLINE  = re.compile(r"`([^`]*)`")
_MDLINK  = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_HEADING = re.compile(r"^#{1,6}\s*", re.M)
_BULLET  = re.compile(r"^\s*[-*•]\s+", re.M)
_NUMLIST = re.compile(r"^\s*(\d+)[.)]\s+", re.M)
_EMPH    = re.compile(r"(\*\*|\*|__|_)(.+?)\1")
_URL     = re.compile(r"https?://\S+")
# A dev-server address is spoken as digits, not as a quantity: "localhost:5173" is
# "localhost port five one seven three", never "localhost five thousand 173".
# ...and with a SPACE: "the page is up at localhost 5173" is prose the model writes all the
# time, and `[:/]?` required the digits to touch the word, so it fell through to number
# reading and was heard as "localhost five thousand one hundred seventy-three" (D13, 2026-09-18).
_LOCALHOST = re.compile(r"(?:https?://)?(?:localhost|127\.0\.0\.1)(?:[:/]|\s+(?:port\s+)?)?(\d{2,5})\b/?", re.I)
# The optional leading "the" is CONSUMED so the replacement's own "the …" does
# not double it ("the the page file").
_PATH    = re.compile(r"(?<![\w/])(?:[Tt]he\s+)?((?:~|/)[\w./-]{3,})")
# A relative path with a slash and a file extension — components/VideoPlayer.tsx,
# app/api/route.ts. Spoken verbatim these become "components slash video player
# dot t s x"; the extension anchor keeps "and/or" and "TCP/IP" from matching.
_RELPATH = re.compile(r"(?<![\w/])(?:[Tt]he\s+)?((?:[\w.-]+/)+[\w.-]*\.[A-Za-z]{1,5})(?![\w/])")
# A multi-segment relative path with NO extension — programs/in-progress/landing-page.
# Read literally it is "programs slash in progress slash...". Say the last segment
# as a folder. Requires >=2 slashes so a plain "and/or" or a fraction is untouched.
_RELDIR = re.compile(r"(?<![\w/])(?:[Tt]he\s+)?((?:[\w.-]+/){2,}[\w-]+)(?![\w/])")
# Product/framework names that end in a code-ish extension but are NOT files -
# protected before any filename rule runs.
_KEEP_DOTTED = re.compile(r"\b(Next\.js|Node\.js|Nuxt\.js|Vue\.js|Nest\.js|Express\.js|"
                          r"D3\.js|Three\.js|Ember\.js|Backbone\.js|Chart\.js|Alpine\.js|"
                          r"Socket\.io|Discord\.js)\b")
# A BARE filename with a known code/config extension and no slash — Hero.tsx,
# package.json, vite.config.js. Read literally it is "hero dot t s x". Only these
# extensions, so an ordinary sentence ("that's it. Done.") is never touched. The
# stem may itself contain dots (vite.config.js), captured greedily.
_FILE_EXT = ("tsx", "jsx", "ts", "js", "mjs", "cjs", "vue", "svelte", "css", "scss",
             "json", "html", "py", "rs", "go", "md", "yml", "yaml", "toml", "sh", "env")
_BAREFILE = re.compile(r"(?<![\w/])(?:[Tt]he\s+)?([\w-]+(?:\.[\w-]+)*\.(?:" + "|".join(_FILE_EXT) + r"))(?![\w/])")
# A BARE hyphenated folder name — landing-page, my-app. Said as "landing-page" it
# is a raw token; "the landing page folder" is what a person says. Needs the
# hyphen (a single plain word is usually just a word, not a folder). A following
# "folder"/"directory"/"project" is consumed so we don't say "folder folder";
# but if it is followed by "component/file/module/page/section" it is describing
# THAT, not a folder, so it is left alone (negative lookahead).
# A hyphenated token followed by a common noun is a compound MODIFIER, not a
# directory: "event-listener effect", "drop-down menu", "read-only mode". Reading
# those as folders is how "the event listener folder effect" happened (2026-09-15).
_MODIFIED_NOUNS = (
    "component", "file", "files", "module", "page", "section", "button", "hook", "hooks",
    "util", "utils", "effect", "effects", "error", "errors", "warning", "warnings",
    "dependency", "dependencies", "call", "calls", "callback", "callbacks", "handler",
    "handlers", "listener", "listeners", "rule", "rules", "test", "tests", "logic",
    "flow", "issue", "issues", "bug", "bugs", "change", "changes", "update", "updates",
    "check", "checks", "guard", "gate", "loop", "queue", "cache", "config", "state",
    "props", "value", "values", "name", "names", "list", "item", "items", "pattern",
    "path", "paths", "route", "routes", "form", "field", "fields", "model", "schema",
    "type", "types", "event", "events", "class", "style", "styles", "layout", "header",
    "footer", "nav", "menu", "card", "cards", "grid", "row", "rows", "column", "columns",
    "setup", "step", "steps", "phase", "mode", "option", "options", "flag", "flags",
    "key", "keys", "code", "block", "blocks", "line", "lines", "text", "label", "labels",
    "title", "view", "views", "screen", "panel", "tab", "tabs", "modal", "dialog",
    "icon", "image", "images", "asset", "assets", "script", "scripts", "task", "tasks",
    "job", "jobs", "build", "builds", "server", "client", "endpoint", "request",
    "response", "session", "token", "tokens", "user", "users", "size", "color", "theme",
    "behaviour", "behavior", "support", "version", "output", "input", "message",
)

_BAREDIR = re.compile(r"(?<![\w/.-])((?:in|into|under|inside|from|at|to)\s+)?(?:[Tt]he\s+)?"
                      r"([a-z][a-z0-9]*(?:-[a-z0-9]+)+)"
                      r"(\s+(?:folder|directory|dir|project|repo))?"
                      r"(?!\s+(?:" + "|".join(_MODIFIED_NOUNS) + r"))"
                      # not a word/slash/hyphen after it, and not ".tsx" (that is a
                      # FILE) - but a sentence-ending "." must not block the match,
                      # which is what "(?![\w/.-])" quietly did: "I put it in
                      # landing-page." never matched at all.
                      r"(?![\w/-])(?!\.[A-Za-z0-9])", re.I)

# "@vitejs/plugin-react" is a package, and nobody says the punctuation.
_NPM_SCOPED = re.compile(r"@([a-z0-9][\w.-]*)/([\w.-]+)", re.I)


# ── STRETCHED INTERJECTIONS (D364, owner 2026-09-24: "some words like 'ohh' sound robotic") ──
# A model writing for the ear stretches its interjections — "Ohh", "Ahh", "Oooh", "Hmmm",
# "Uhh", "Awww" — and the phonemiser takes the spelling literally: "Ahh" is `ˈɑɑ`, "Oooh" is
# `ˈuu`, "Awww" is `ˈɔɔɔ`, "Uhh" is `ˈʌʌ`, a doubled vowel Kokoro renders as a stutter, and
# without the espeak fallback "Ohh" and "Aah" are `❓`, which Kokoro guesses at. Measured
# through the live phonemiser (misaki + espeak + lexicon). Each is folded to the one spelling
# that phonemises to a single clean sound — every target below is one token, checked in
# test_speakable — and the capital of the first letter is kept, so a sentence still opens
# with one. A word that merely starts the same way ("Ohio", "Ahead", "Hummus") is untouched:
# every pattern is anchored at both ends of the word.
_INTERJECTIONS = [
    (re.compile(r"\b([Oo])h{2,}\b", re.I), "Oh"),          # Ohh, Ohhh
    (re.compile(r"\b([Oo])o+h+\b", re.I), "Ooh"),          # Oooh, Ooohh
    (re.compile(r"\b([Aa])a+h+\b", re.I), "Ah"),           # Aah, Aaah
    (re.compile(r"\b([Aa])h{2,}\b", re.I), "Ah"),          # Ahh, Ahhh
    (re.compile(r"\b([Uu])h{2,}\b", re.I), "Uh"),          # Uhh
    (re.compile(r"\b([Uu])m{2,}\b", re.I), "Um"),          # Umm
    (re.compile(r"\b([Hh])m{3,}\b", re.I), "Hmm"),         # Hmmm
    (re.compile(r"\b([Mm])m{2,}\b", re.I), "Mm"),          # Mmm
    (re.compile(r"\b([Aa])w{2,}\b", re.I), "Aw"),          # Aww, Awww
    (re.compile(r"\b([Ww])hoa{2,}\b", re.I), "Whoa"),      # Whoaa
]


def fold_interjections(t):
    """Stretched interjections to the spelling the voice says as one sound (D364)."""
    for rx, canon in _INTERJECTIONS:
        t = rx.sub(lambda m, c=canon: (c[0].upper() if m.group(1).isupper() else c[0].lower()) + c[1:], t)
    return t


def _say_package(m):
    scope, name = m.group(1), m.group(2)
    words = f"{scope} {name}".replace("-", " ").replace("_", " ").replace(".", " ")
    return "the " + re.sub(r"\s+", " ", words).strip() + " package"


# Program names are their own pronunciation problem, separate from acronyms: the
# voice reads "vscode" as "vistcode", "vite" as if it rhymed with "bite" (it is
# French - "veet"), and "npm" as a word. Getting a tool's name wrong is the kind of
# mistake that makes a competent assistant sound like it has never used the tool,
# so they are spelled out the way a developer says them out loud (user, 2026-09-15:
# "pronunciation matters for programs").
# Matched case-insensitively, longest first, so "visual studio code" wins over "code".
PROGRAMS = {
    "visual studio code": "V S Code", "vs code": "V S Code", "vscode": "V S Code",
    "vs-code": "V S Code", "code-oss": "V S Code",
    "npm": "N P M", "npx": "N P X", "pnpm": "P N P M", "nvm": "N V M",
    # vite/vitest/postgres/nvim are NOT rewritten here — see lexicon.py. A misspelling
    # invented to force a pronunciation is a word the phonemiser does not know, and an
    # unknown word is `❓`, which Kokoro guesses at. Teaching the dictionary beats tricking it.
    # These two were INSIDE the comment above until 2026-09-17 — a trailing `#` on the
    # vite line swallowed them, so "nginx" was never in the dict and he said it as a word.
    "nginx": "engine X", "psql": "P S Q L",
    "sqlite": "sequel lite", "mysql": "my sequel",
    "zsh": "Z shell", "bash": "bash", "ssh": "S S H", "tmux": "tee-mux",
    "ffmpeg": "F F mpeg", "systemd": "system D",
    "jq": "J Q", "eslint": "E S lint", "tsc": "T S C", "k8s": "kubernetes",
    "wsl": "W S L", "ide": "I D E", "llm": "L L M", "ui/ux": "U I U X",
    "github": "GitHub", "gitlab": "GitLab", "dotfiles": "dot files",
}
_PROGRAMS_RX = re.compile(r"(?<![\w])(" + "|".join(re.escape(k) for k in
                          sorted(PROGRAMS, key=len, reverse=True)) + r")(?![\w])", re.I)


ABBREV = {
    "e.g.": "for example", "i.e.": "that is", "etc.": "and so on",
    "vs.": "versus", "approx.": "roughly", "min": "minutes", "hr": "hours",
    "config": "config", "repo": "repo", "dir": "directory",
    "CPU": "C P U", "GPU": "G P U", "RAM": "ram", "SSD": "S S D",
    "API": "A P I", "CLI": "command line", "JSON": "jason", "YAML": "yammle",
    "URL": "U R L", "HTTP": "H T T P", "SQL": "sequel", "UI": "U I",
    # Added 2026-09-17: getting a technical term wrong out loud is the mistake that makes
    # a competent assistant sound like it has never used the thing (user: "these are
    # technical words man that are super important").
    "HTTPS": "H T T P S", "AWS": "A W S", "SDK": "S D K", "CDN": "C D N",
    "DNS": "D N S", "TLS": "T L S", "SSL": "S S L", "JWT": "J W T",
    "CORS": "cors", "CRUD": "crud", "ORM": "O R M", "REST": "rest",
    "GraphQL": "graph Q L", "CSS": "C S S", "HTML": "H T M L", "SVG": "S V G",
    "CSV": "C S V", "XML": "X M L", "SSH": "S S H", "TCP": "T C P",
    "CI/CD": "C I C D", "CI": "C I", "PR": "P R", "OS": "O S",
    "AI": "A I", "ML": "M L", "NPM": "N P M", "IDE": "I D E",
    "UUID": "you you I D",
    # regex / async / OAuth / Redis are in lexicon.py, not here.
}


# A SPELLED-OUT "A" IS NOT THE WORD "A".
#
# Every other letter phonemises correctly on its own, but a lone capital A is read as the
# ARTICLE — misaki gives `ɐ`, a schwa — so "A P I" came out "uh-pee-eye" (user, 2026-09-17:
# "he says apee. these are technical words"). Measured across the whole alphabet: A is the
# only letter that breaks, and only when nothing before it forces the letter reading ("the
# A P I" was already correct, "S3 A P I" was not).
#
# "A-" phonemises as `ˈA`, which IS the letter name. "A." works too and was rejected: the
# phrase splitter breaks sentences on `[.!?]\s+`, so a period would cut "A. P I" in half and
# put a pause inside the acronym.
_LETTER_RUN = re.compile(r"(?<![\w-])([A-Z](?: [A-Z])+)(?![\w-])")


def _fix_letter_a(t):
    """Inside a run of spelled letters, make a bare A say its own name."""
    return _LETTER_RUN.sub(
        lambda m: re.sub(r"(?<![\w-])A(?![\w-])", "A-", m.group(1)), t)


UNITS = {
    "GB": "gigabytes", "MB": "megabytes", "KB": "kilobytes", "TB": "terabytes",
    "ms": "milliseconds", "s": "seconds", "kW": "kilowatts", "W": "watts",
    "°C": "degrees", "%": "percent",
}

# Written English is denser than spoken English. Contractions are the single
# cheapest naturalness win there is - nobody says "I have found" out loud.
# An auxiliary cannot contract when it is STRANDED - left at the end of a clause
# with nothing after it. "I am ready whenever you are." is English; "whenever
# you're." is not, and it is what he actually said out loud. Negatives are exempt,
# because they strand perfectly well ("No, I don't.", "It isn't."), so the guard
# below is applied only to the positive forms.
# "too", "as well" and "either" also leave the auxiliary stranded by ellipsis:
# "and you have too" is English, "and you've too" is not.
NOT_STRANDED = r"(?!\s*(?:[.,;:!?]|too\b|either\b|as well\b|$))"

CONTRACT = [
    (r"\bI have\b", "I've"), (r"\bI will\b", "I'll"), (r"\bI am\b", "I'm"),
    (r"\byou have\b", "you've"), (r"\byou are\b", "you're"), (r"\byou will\b", "you'll"),
    (r"\bit is\b", "it's"), (r"\bthat is\b", "that's"), (r"\bthere is\b", "there's"),
    (r"\bwe have\b", "we've"), (r"\bwe are\b", "we're"), (r"\bwe will\b", "we'll"),
    (r"\bdo not\b", "don't"), (r"\bdoes not\b", "doesn't"), (r"\bdid not\b", "didn't"),
    (r"\bis not\b", "isn't"), (r"\bare not\b", "aren't"), (r"\bwas not\b", "wasn't"),
    (r"\bcannot\b", "can't"), (r"\bcan not\b", "can't"), (r"\bwill not\b", "won't"),
    (r"\bhave not\b", "haven't"), (r"\bhas not\b", "hasn't"),
    (r"\blet us\b", "let's"), (r"\bhere is\b", "here's"),
]
# "have" contracts only when it is an AUXILIARY. As the main verb — meaning possess — it
# cannot: "we've a timer project" and "what files we've here" are both broken English, and
# both went out on camera (2026-09-18). The tell is what follows: a determiner, a number or
# a place word means "have" is carrying the sentence itself and has to stay whole. A past
# participle after it ("we have seen") is the auxiliary reading, which contracts fine.
_MAIN_VERB_HAVE = (r"(?!\s+(?:a|an|the|some|any|no|my|our|your|their|his|her|its|this|that|"
                   r"these|those|two|three|four|five|six|seven|eight|nine|ten|"
                   r"here|there|enough|plenty|one|it)\b)")
CONTRACT = [(pat + (_MAIN_VERB_HAVE if rep.endswith("'ve") else ""), rep)
            for pat, rep in CONTRACT]

# add the guard to every positive contraction; the n't forms keep their freedom
CONTRACT = [(pat if "n't" in rep else pat + NOT_STRANDED, rep) for pat, rep in CONTRACT]


_ONES = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
         "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
         "seventeen", "eighteen", "nineteen")
_TENS = ("", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")


def _two_digit_words(n):
    if n < 20:
        return _ONES[n]
    tens, ones = divmod(n, 10)
    return _TENS[tens] + (f"-{_ONES[ones]}" if ones else "")


def _year_words(n):
    """A year as a person says it: 2026 -> twenty twenty-six, 2009 -> twenty oh nine.

    This used to emit the DIGITS "20 26" and leave the engine to infer it, which put a
    pause in the middle of the year — "September tenth, twenty ... twenty-six" (user,
    2026-09-17). Saying the words outright removes the guess."""
    hi, lo = divmod(n, 100)
    if lo == 0:
        return f"{_two_digit_words(hi)} hundred" if hi % 10 else f"{_ONES[hi // 10]} thousand"
    if lo < 10:
        return f"{_two_digit_words(hi)} oh {_ONES[lo]}"
    return f"{_two_digit_words(hi)} {_two_digit_words(lo)}"


_MONTHS = ("January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December")
_ORD = {1: "first", 2: "second", 3: "third", 5: "fifth", 8: "eighth", 9: "ninth",
        12: "twelfth", 20: "twentieth", 30: "thirtieth"}
_ISO_DATE = re.compile(r"\b(19\d{2}|20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b")


def _ordinal(n):
    if n in _ORD:
        return _ORD[n]
    if 20 < n < 30 and n % 10 in _ORD:
        return f"twenty-{_ORD[n % 10]}"
    return _two_digit_words(n) + "th"


def _say_iso_date(m):
    """2026-09-13 -> September thirteenth. Nobody says a date by reading its hyphens, and
    since years became words an ISO date would otherwise read "twenty twenty-six-09-13"."""
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return f"{_MONTHS[mo - 1]} {_ordinal(d)}"


def _say_number(m):
    n = m.group(0)
    if len(n) == 4 and n.isdigit() and 1900 <= int(n) <= 2099:
        return _year_words(int(n))
    if n.isdigit() and len(n) > 3:
        return f"{int(n):,}".replace(",", " thousand ", 1) if len(n) == 4 else f"{int(n):,}"
    return n


_CODE_EXT = {"tsx", "jsx", "vue", "svelte"}          # a "component", said aloud, not a "file"
# Config files people name by their whole filename; "the vite config file" is
# how they're said, and a few have a natural short spoken name.
_CONFIG_NAMES = {"package.json": "the package file", "tsconfig.json": "the t-s config",
                 "next.config.js": "the next config", "next.config.mjs": "the next config",
                 "vite.config.js": "the vite config", "vite.config.ts": "the vite config",
                 "tailwind.config.js": "the tailwind config", "postcss.config.js": "the post-c-s-s config",
                 "package-lock.json": "the lock file", "readme.md": "the readme"}


def _say_file(m):
    """A bare filename (Hero.tsx, package.json). Same word-ification as _say_path
    but no directory case - it is always a file/component/config."""
    raw = m.group(1)
    low = raw.lower()
    if low in _CONFIG_NAMES:
        return _CONFIG_NAMES[low]
    stem, _dot, ext = raw.rpartition(".")
    base = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", stem)
    base = base.replace("-", " ").replace("_", " ").replace(".", " ")
    base = re.sub(r"\s+", " ", base).strip().lower() or "file"
    if ext.lower() in _CODE_EXT:
        return f"the {base} component"
    return f"the {base} file"


# A hyphenated token is only a FOLDER when it isn't ordinary hyphenated English.
# "Re-install dependencies" became "the re install folder dependencies" (measured
# 2026-09-15, live narration): the rule fired on a verb. Two guards, both cheap:
# a leading word that is an English prefix ("re-", "pre-", "non-"), and a trailing
# particle that makes a compound ("check-in", "follow-up"), are never directories.
_HYPHEN_PREFIX = {"re", "pre", "post", "non", "anti", "semi", "sub", "super", "multi",
                  "self", "co", "ex", "un", "de", "dis", "mis", "over", "under", "out",
                  "up", "off", "on", "mid", "cross", "inter", "intra", "well", "ill",
                  "half", "all", "near", "far", "long", "short", "high", "low", "real",
                  "full", "part", "best", "worst", "first", "second", "third", "one",
                  "two", "three", "no", "in", "at", "by", "per", "auto", "double", "single"}
_HYPHEN_PARTICLE = {"in", "up", "out", "down", "off", "on", "over", "through", "away",
                    "back", "through", "by", "to"}


def _is_hyphenated_word(name):
    """True when a hyphenated token is English, not a directory name."""
    parts = name.lower().split("-")
    return parts[0] in _HYPHEN_PREFIX or parts[-1] in _HYPHEN_PARTICLE


# Hyphenated names that are SERVICES, not directories. "fetched from open-meteo" came out
# as "fetched from the open meteo folder" on camera (2026-09-17): the preposition is the
# folder cue, and a hyphenated API name looks exactly like a project directory. Read them
# as written; nobody hears a hyphen anyway.
_NOT_FOLDERS = {
    "open-meteo", "hugging-face", "cloudflare-workers", "gpt-oss", "flash-lite",
    "ai-studio", "workers-ai", "github-actions", "next-auth", "tailwind-css",
}


def _say_dir(m):
    """A bare hyphenated folder name (landing-page -> "the landing page folder").
    A trailing 'folder'/'directory'/'project' word is kept (group 2), so
    'landing-page folder' -> 'the landing page folder', not '... folder folder'."""
    prep, raw, tail = m.group(1), m.group(2), m.group(3)
    # Only a sentence that positions it like a folder ("in landing-page", "landing-page
    # directory") gets the folder reading. Without a cue, a hyphenated token is far more
    # often ordinary English - "event-listener effect" became "event listener FOLDER
    # effect" (2026-09-15) - and reading it as written is always safe.
    if _is_hyphenated_word(raw) or raw.lower() in _NOT_FOLDERS or not (prep or tail):
        return m.group(0)
    name = raw.replace("-", " ").replace("_", " ").lower()
    return f"{prep or ''}the {name} {(tail or ' folder').strip()}"


def _say_path(m):
    """A path read character by character is the most robotic sound there is.
    Say the last component as words: components/VideoPlayer.tsx -> "the video
    player component", app/api/route.ts -> "the route file"."""
    p = m.group(1).rstrip("/")
    name = p.split("/")[-1] or p
    if name.startswith("."):
        name = name[1:]
    stem, dot, ext = name.rpartition(".")
    base = stem if dot else name
    base = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", base)   # VideoPlayer -> Video Player
    base = base.replace("-", " ").replace("_", " ").replace(".", " ")
    base = re.sub(r"\s+", " ", base).strip().lower()
    if not base:
        return "the file"
    if dot and ext.lower() in _CODE_EXT:
        return f"the {base} component"
    if dot:
        return f"the {base} file"
    return f"the {base} directory"


# Where prose stops and code starts.
#
# 2026-09-17, on camera: he said "I've reviewed the project files and verified the available
# verified photos and Tailwind setup. I'm now applying the first pass of the landing page:
# the dark shell, navigation bar, and hero heading. tools defaultapi:Write filepath the app
# component the filepath directory content export default function App() { return ( div
# className="minutes-h-screen bg-zinc-950 ..." — a real sentence that ran straight into a
# serialised tool call, read out loud, with "min-h-screen" rendered as "minutes-h-screen".
#
# pair.py already refused anything that LOOKED like a tool call, but it only inspected the
# first characters, and this line opened with "I've". A prefix test cannot catch prose that
# turns into code halfway through. So the cut happens wherever the code starts, and what
# comes after it is dropped rather than spoken.
