#!/usr/bin/env python3
"""secretscan — no key material in anything git tracks.

PLAN rows 2.9 and 5.10. `keys.env` is symlinked into the runtime dir, logs and `desk.json`
are written continuously, and the end state for this repository is a push to GitHub — which
is one-way: caches and forks outlive a delete. So the gate runs before the push exists, not
after.

Deliberately NOT semgrep: `make check` has to stay in seconds or it gets bypassed, and a
bypassed gate is no gate. This is a fast pattern pass over tracked files only. `make live`
territory can afford a deeper scan; this one is the floor.

    orb/daemon/secretscan.py             every tracked file
    orb/daemon/secretscan.py --history   also every blob ever committed (slower)
"""
import argparse
import pathlib
import re
import subprocess
import sys
from pathlib import Path

def _repo_root(start=None):
    """Walk up to the checkout root instead of counting directory levels.

    `ROOT = Path(__file__).parent.parent` was right while this file lived in `ashd/`, and
    silently wrong the moment the tree became `orb/daemon/` (PLAN 5.7): the scan still ran,
    still reported green, and was looking at a subdirectory. A path computed from a fixed
    depth is the same brittleness the brain hooks had — fixed there on the same day."""
    p = (start or Path(__file__)).resolve()
    for d in [p] + list(p.parents):
        if (d/".git").exists():
            return d
    return p.parents[2]


ROOT = _repo_root()

# Shapes that are key material wherever they appear. Anchored to real prefixes so a word
# in prose cannot trip them.
PATTERNS = [
    ("openai/anthropic key", re.compile(r'\bsk-[A-Za-z0-9_-]{16,}')),
    ("google api key",       re.compile(r'\bAIza[A-Za-z0-9_-]{30,}')),
    ("github token",         re.compile(r'\bgh[pousr]_[A-Za-z0-9]{30,}')),
    ("aws access key",       re.compile(r'\bAKIA[A-Z0-9]{12,}')),
    ("slack token",          re.compile(r'\bxox[abprs]-[A-Za-z0-9-]{10,}')),
    ("private key block",    re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY')),
    ("bearer literal",       re.compile(r'[Bb]earer\s+[A-Za-z0-9_\-.]{24,}')),
    ("assigned secret",      re.compile(
        r'(?i)\b(?:api[_-]?key|secret|passwd|password|access[_-]?token)\b\s*[:=]\s*'
        r'["\'][^"\'\s$<{]{12,}["\']')),
]

# A placeholder is not a secret. `sk-noop` is ashd's own no-key sentinel and appears twice
# in ashd.py; an env read is not a literal.
SAFE = re.compile(r'(?i)noop|example|placeholder|dummy|redacted|xxxx|your[_-]?key|'
                  r'os\.environ|process\.env|getenv|\$\{|<[a-z_]+>|\.\.\.')

SKIP_SUFFIX = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".wav", ".mp4", ".vsix", ".pdf",
               ".woff", ".woff2", ".ttf", ".zip", ".onnx"}


def tracked(root=None):
    """Tracked files under `root` — resolved at CALL time, never from the import-time global.

    Without the argument this could only ever scan its own checkout, so the one thing 5.13_t
    has to prove — that a planted credential fails the gate in HISTORY — would have meant
    committing a fake key to this repository to test the check for committed keys. The
    fixture gets its own throwaway repo instead. (D104/D155/D166/D172 are all this shape: a
    path computed in one place cannot be redirected from another.)"""
    root = root or ROOT
    out = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True, text=True)
    return [pathlib.Path(root) / p for p in out.stdout.splitlines() if p]


# The generic pattern is the only one where the LINE matters — `os.environ.get(...)` and
# `${VAULT}` are on the line, not in the match. The anchored patterns judge the MATCH alone:
# a line-level skip there would let `# example: KEY = "sk-<real key>"` through, which is a
# comment away from being a real leak.
LINE_JUDGED = {"assigned secret"}


def scan_text(text, where="<text>"):
    hits = []
    for i, line in enumerate(text.splitlines(), 1):
        for label, rx in PATTERNS:
            m = rx.search(line)
            if not m:
                continue
            subject = line if label in LINE_JUDGED else m.group(0)
            if SAFE.search(subject):
                continue
            shown = m.group(0)
            shown = shown[:8] + "\u2026" + str(len(shown)) + " chars"
            hits.append(f"{where}:{i}  {label}  {shown}")
    return hits


# ---------------------------------------------------------------- fixtures (PLAN 2.10)
#
# A SECRET SCANNER'S OWN TEST DATA LOOKS EXACTLY LIKE A SECRET, and it has to: a suite that
# proves detection with strings the detector misses proves nothing. These three files were
# invisible to this scan for as long as they were UNTRACKED — `tracked()` asks `git ls-files`
# — so the first `git add -A` of this working tree produced 27 findings, every one a planted
# `sk-abcde…` or `AIzaSyA1…` from the redaction suites.
#
# The exemption is deliberately two locks, because "skip this file" is how a scanner gets
# quietly switched off one path at a time:
#
#   1. the file must DECLARE itself with the marker below, so the exemption lives in the
#      file it exempts and is visible to anyone editing it; and
#   2. the count must match EXACTLY. One more finding than declared fails — that is a real
#      key added to a file nobody scans any more. One fewer fails too, because a fixture
#      that stopped matching is a suite that stopped testing anything, which is the failure
#      this scanner exists to make impossible.
#
# Adding a file here is a visible, reviewable act. Raising a number without saying why is
# the thing to look for in a diff.
FIXTURE_MARKER = "secretscan-fixtures: this file contains planted keys on purpose"
FIXTURES = {
    "kit/ash/test_redact.py": 9,
    # 7 -> 10 on 2026-09-22: DR.6 added three, one per pattern, for the NESTED walk. Every
    # fixture in that file was a flat string and `desk` entries are panel payloads full of
    # arrays and objects, so removing the walk — anything inside a list written to disk
    # verbatim — was NOT CAUGHT. The three are defined once and referenced twice, which is
    # why this went up by three and not six.
    "kit/ash/test_secretscan.py": 11,
}


def fixture_verdict(rel, text, hits):
    """(kept_hits, complaint). `kept_hits` is what still counts against the scan."""
    want = FIXTURES.get(rel)
    if want is None:
        return hits, None
    if FIXTURE_MARKER not in text:
        return hits, (f"{rel} is listed as a fixture file but does not declare itself — "
                      f"add the marker, or take it off the list")
    if len(hits) != want:
        return hits, (f"{rel} declares {want} planted key(s) and has {len(hits)}. "
                      f"More means a real one arrived in a file nobody scans; fewer means "
                      f"the fixtures stopped matching and the suite stopped testing.")
    return [], None


def scan_tree(root=None):
    """(hits, files_scanned) for a whole checkout — the ONE traversal.

    `main()` and `test_secretscan` S.4 each had their own copy of this loop and they had
    already diverged: the suite called `scan_text` directly, so it never applied the fixture
    exemption, and it keyed findings on an ABSOLUTE path where `main` uses one relative to
    the root, so the two could not have agreed even if it had. A scanner with two traversals
    has two answers.
    """
    root = root or ROOT
    hits, n = [], 0
    for f in tracked(root):
        if f.suffix.lower() in SKIP_SUFFIX or not f.is_file():
            continue
        try:
            text = f.read_text(errors="replace")
        except OSError:
            continue
        rel = str(f.relative_to(root))
        kept, complaint = fixture_verdict(rel, text, scan_text(text, rel))
        hits += kept
        if complaint:
            hits.append(complaint)
        n += 1
    return hits, n


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--history", action="store_true", help="also scan every committed blob")
    ap.add_argument("--root", default=None, help="scan this checkout instead of my own")
    a = ap.parse_args()
    root = pathlib.Path(a.root).resolve() if a.root else ROOT
    hits, n = scan_tree(root)
    if a.history:
        # BYTES, NOT TEXT, and blobs only. `text=True` decodes as UTF-8 and raises on the
        # first PNG in the history, so the scan reported a traceback instead of a verdict —
        # and `rev-list --objects` lists trees, which `cat-file -p` prints as directory
        # listings nobody should be scanning. `tools/release_gate.py` carries the same fix
        # and the full reasoning; this is the fast path `make check` uses.
        import release_gate
        hits += release_gate.secrets_in_history(root)
    if hits:
        print(f"✗ secretscan: {len(hits)} finding(s)\n", file=sys.stderr)
        for h in dict.fromkeys(hits):
            print(f"  - {h}", file=sys.stderr)
        print("\n  A secret in a tracked file is a secret after a push, and a push is "
              "one-way.", file=sys.stderr)
        return 1
    print(f"✓ secretscan: {n} tracked file(s), no key material")
    return 0


if __name__ == "__main__":
    sys.exit(main())
