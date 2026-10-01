"""How Ash says technical words.

THE FAILURE THIS FIXES. misaki returns `❓` for any word it does not know, and Kokoro then
guesses at it. Measured 2026-09-17, NINE entries in speakable.py's own pronunciation map
phonemised to `❓` — including the replacements it was substituting IN to fix pronunciation:
`vite`→"Veet"❓, `vitest`→"Veetest"❓, `postgres`→"post-gress"❓, `k8s`→"kubernetes"❓,
`YAML`→"yammle"❓, `regex`→"reg ex"❓, `Redis`→"red iss"❓, `nvim`→"neo vim"❓, and
`config`→"config"❓. So the map meant to make him sound like he had used these tools was
handing the voice words it could not say at all.

Chasing a spelling that happens to phonemise correctly is the wrong game — "veet", "veat",
"veete" and "veit" are all unknown, because they are not English words. misaki exposes its
dictionary (`lexicon.golds`), so the right move is to TELL it the pronunciation rather than
trick it with a misspelling.

WRITING AN ENTRY. Values are misaki phoneme strings, not IPA-as-you-remember-it. Its
notation differs where it matters: `A` is /eɪ/, `I` is /aɪ/, `O` is /oʊ/, `W` is /aʊ/,
`ʤ` is /dʒ/, `ʧ` is /tʃ/. `ˈ` marks primary stress and `ˌ` secondary. The reliable way to
write a new one is to phonemise a REAL word that rhymes and copy the result:

    from misaki import en; g = en.G2P(trf=False, british=False)
    g("beet")   -> bˈit      so vite is  vˈit

Every entry here is asserted non-`❓` by test_speakable.py, so a typo cannot ship silently.
"""

# Keys are matched lowercase. Both the TERM and any spelling speakable.py may substitute
# for it are registered, so the pronunciation holds whichever text reaches the voice.
TECH = {
    # build tooling
    "vite": "vˈit",
    "veet": "vˈit",
    "vitest": "vˈitɛst",
    "veetest": "vˈitɛst",
    "vitejs": "vˈit ʤˈA ˈɛs",
    "esbuild": "ˈi bˈɪld",
    "webpack": "wˈɛbpˌæk",
    "rollup": "ɹˈOlˌʌp",
    "turbopack": "tˈɜɹbOpˌæk",

    # runtimes and package managers
    "nvim": "nˈiO vˈɪm",
    "neovim": "nˈiO vˈɪm",
    "pnpm": "pˈi ˈɛn pˈi ˈɛm",
    "bun": "bˈʌn",
    "deno": "dˈɛnO",
    "uv": "jˈu vˈi",

    # servers, stores, infra
    "nginx": "ˈɛnʤən ˈɛks",
    "postgres": "pˈOstɡɹɛs",
    "postgresql": "pˈOstɡɹɛs ˈɛs kjˈu ˈɛl",
    "psql": "pˈi ˈɛs kjˈu ˈɛl",
    "redis": "ɹˈɛdɪs",
    "sqlite": "sˈikwəl lˈIt",
    "kubectl": "kjˈub kəntɹˈOl",
    "kubernetes": "kˌubɜɹnˈɛtiz",
    "k8s": "kˌubɜɹnˈɛtiz",
    "docker": "dˈɑkɜɹ",
    "systemd": "sˈɪstəm dˈi",
    "grafana": "ɡɹəfˈɑnə",
    "nixos": "nˈɪks ˈOˈɛs",

    # formats and protocols
    "yaml": "jˈæməl",
    "yammle": "jˈæməl",
    "toml": "tˈɑməl",
    "jsonl": "ʤˈAsən ˈɛl",
    "regex": "ɹˈɛʤɛks",
    "regexes": "ɹˈɛʤɛksɪz",
    "utf": "jˈu tˈi ˈɛf",
    "oauth": "ˈO ˈɔθ",
    "webrtc": "wˈɛb ˈɑɹ tˈi sˈi",
    "websocket": "wˈɛbsˌɑkɪt",
    "graphql": "ɡɹˈæf kjˈu ˈɛl",

    # everyday words the dictionary happens to miss
    "config": "kənfˈɪɡ",
    "configs": "kənfˈɪɡz",
    "repo": "ɹˈipO",
    "repos": "ɹˈipOz",
    "dotfiles": "dˈɑt fˈIlz",
    "async": "ˈAsɪŋk",
    "middleware": "mˈɪdəlwˌɛɹ",
    "runtime": "ɹˈʌntIm",
    "changelog": "ʧˈAnʤlˌɔɡ",
    "stdout": "ˈɛs tˈi dˈi ˈWt",
    "stderr": "ˈɛs tˈi dˈi ˈɛɹ",
    "localhost": "lˈOkəlhˌOst",
}


def install(g2p):
    """Teach a misaki G2P every word above. Returns how many entries were added.

    Safe to call more than once and safe to call on a G2P that has no lexicon: a voice
    that cannot learn a word should still speak, just no better than before.
    """
    lex = getattr(g2p, "lexicon", None)
    golds = getattr(lex, "golds", None)
    if golds is None:
        return 0
    n = 0
    for word, phonemes in TECH.items():
        golds[word] = phonemes
        n += 1
    return n


if __name__ == "__main__":
    import warnings
    warnings.filterwarnings("ignore")
    from misaki import en
    g = en.G2P(trf=False, british=False)
    print(f"installed {install(g)} entries")
    bad = [w for w in TECH if "❓" in str(g(w)[0])]
    print("unpronounceable after install:", bad or "none")


# ---------------------------------------------------------------- unknown words
# THE FAILURE THIS FIXES. misaki answers `❓` for a word it has never seen and Kokoro then
# says NOTHING for it — not a guess, silence. So an invented brand name swallows the end of
# the sentence: on 2026-09-18 the user heard "I'm creating a new web project for" and then
# nothing, because "Moonrunner" is not a word. "Saltline" from the previous shoot is the
# same, and nobody had diagnosed it either.
#
# A name he invents cannot be in a dictionary written in advance, so this repairs at speech
# time: an unknown word is split into the two real words it is made of ("Moonrunner" ->
# "Moon runner"), which phonemise correctly and sound exactly like the name. A word that
# cannot be split is left alone rather than mangled.
_SAYABLE = {}
_SPLIT = {}


def sayable(word, g):
    """Does the phonemiser know this word?"""
    if word not in _SAYABLE:
        try:
            _SAYABLE[word] = "❓" not in str(g(word)[0])
        except Exception:
            _SAYABLE[word] = True
    return _SAYABLE[word]


def split_compound(word, g):
    """"Moonrunner" -> "Moon runner", when both halves are real words. None otherwise."""
    if word in _SPLIT:
        return _SPLIT[word]
    found = None
    for i in range(3, len(word) - 2):
        head, tail = word[:i], word[i:]
        if sayable(head, g) and sayable(tail, g):
            found = f"{head} {tail}"
            break
    _SPLIT[word] = found
    return found


def repair(text, g):
    """Every word in `text`, made sayable — or left exactly as it was.

    A no-op when the phonemiser has an espeak fallback, which answers for any spelling and
    is the real fix; this stays as the belt for a build where espeak is missing.
    """
    if getattr(g, "fallback", None) is not None:
        return text
    import re as _re
    out = []
    for tok in _re.findall(r"[A-Za-z']+|[^A-Za-z']+", text or ""):
        if not tok[:1].isalpha() or len(tok) < 6 or sayable(tok, g):
            out.append(tok)
            continue
        out.append(split_compound(tok, g) or tok)
    return "".join(out)
