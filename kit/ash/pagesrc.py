#!/usr/bin/env python3
"""A page's scripts, wherever they live — one definition (PLAN 10.2).

Until 10.2 every one of the orb's pages carried its JavaScript inline, and a dozen suites
read the `.html` and found the code in it. All 29 inline blocks are files now, so grepping
the markup finds no JavaScript at all — and four suites reported working guarantees as
**gone**:

    XT.1a the RSS title is appended as a TEXT NODE — the one call the whole guarantee rests on is gone
    PE.1  tasks.html defines an escaper — no `const esc = ...` found — this panel interpolates unescaped
    U.6   the panel still has an onTutorInject handler to write for
    K.5   index.html still DEFAULTS a missing `state`

Not one of those had changed by a character. That is the most expensive kind of false
finding: it accuses correct code, it accuses it loudly, and three of the four name a security
guarantee. Somebody reading at speed re-adds a defence that was never missing, or concludes
the refactor was unsafe and reverts it.

**Why this is a module and not a helper copied into each suite.** It was copied into three
before the fourth and fifth turned up, which is the same "two copies of one thing" this
project keeps paying for — and the copies had already started to differ. `ran_everything`'s
`code_only` set the precedent that a shared checking helper lives in one importable place.

The rule this encodes: **read what the browser reads.** The page, plus every script it loads
from its own directory, in load order. Remote and absolute-URL sources are deliberately not
fetched — a check has no business reaching the network, and nothing in these pages loads
script from anywhere but beside itself.
"""
import pathlib
import re

_SRC = re.compile(r'<script[^>]*\bsrc=["\']([^"\']+)["\']', re.I)


def local_scripts(page):
    """[(name, text)] for every same-directory script the page loads, in load order."""
    page = pathlib.Path(page)
    out = []
    for src in _SRC.findall(page.read_text()):
        # Anything with a scheme or an absolute path is somebody else's file. `clawd.html`
        # loads the engine's `clawd.mjs` over `file://`, which is PLAN 10.3's recorded
        # trust-boundary cost and explicitly NOT part of this repository.
        if "://" in src or src.startswith("/"):
            continue
        f = page.parent/src
        if f.is_file():
            out.append((src, f.read_text()))
    return out


def page_source(page):
    """The page's markup plus the text of every local script it loads, in load order.

    Concatenated rather than returned separately because every caller is asking the same
    question — "does this page's code do X" — and the answer does not depend on which file
    the code sits in. A caller that needs to know WHICH file should use `local_scripts`.
    """
    page = pathlib.Path(page)
    return "\n".join([page.read_text()] + [t for _n, t in local_scripts(page)])


if __name__ == "__main__":
    import sys
    for arg in sys.argv[1:]:
        n = len(local_scripts(arg))
        print(f"{arg}: {len(page_source(arg))} chars over 1 page + {n} local script(s)")
