#!/usr/bin/env python3
"""copyscan — prove Orbs contains no code copied from Open Dot (PLAN 0.4).

Open Dot (composio-community/open-dot) has no licence, so its code is all-rights-reserved:
we may read it for ideas, never copy it. This compares every source file in our tree against
every source file in theirs, two ways:

  exact       the token stream as written. A run of EXACT_RUN identical tokens is a copy.
  normalized  identifiers -> I, strings -> S, numbers -> N. A run of NORM_RUN identical tokens
              is a copy with the names changed, which is still a copy.

Fingerprints are winnowed k-grams (the MOSS method), so a 50-file tree scans in well under a
second; every candidate pair is then extended into its maximal common run, and only runs over
the thresholds are reported. Comments are stripped first: describing their design in our own
words is allowed, reproducing their code is not.

Exit 0 = clean, 1 = a copy was found, 2 = the scan could not run (missing tree). A scan that
cannot run must never read as a pass.

  python3 tools/copyscan/copyscan.py                    # scan the repo against the cached checkout (cloned if missing)
  python3 tools/copyscan/copyscan.py --fetch            # clone/refresh Open Dot first
  python3 tools/copyscan/copyscan.py --ours DIR --theirs DIR
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
CACHE = HERE / ".opendot"
UPSTREAM = "https://github.com/composio-community/open-dot"

CODE_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".css", ".html"}
SKIP_DIRS = {".git", "node_modules", ".opendot", "__pycache__", ".venv", "dist", "build", ".next"}
# Generated or vendored data, not code anyone writes by hand.
SKIP_FILES = {"apps.json", "pnpm-lock.yaml"}

K = 12            # tokens per fingerprinted k-gram
WINDOW = 6        # winnowing window
EXACT_RUN = 40    # identical tokens in a row = copied
NORM_RUN = 70     # identical normalized tokens in a row = copied with renames
# A normalized run counts only if it has the structure of code: at least one identifier or
# keyword per STRUCTURE_EVERY tokens. With strings normalized to S, any long table of string
# pairs ({"a": "b", "c": "d", ...}: a MIME map, a pronunciation lexicon; or {a: "b", ...} with
# bare keys, whose keys are not counted as names) is the same S : S , run
# as every other one; that is data with nothing of anyone's code in it. Exact mode is untouched,
# so pasting their actual table is still caught.
STRUCTURE_EVERY = 10

_TOKEN = re.compile(
    r"""
    (?P<str>"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)
  | (?P<num>\b\d+(?:\.\d+)?\b)
  | (?P<id>[A-Za-z_$][A-Za-z0-9_$]*)
  | (?P<op>===|!==|=>|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\.\.\.|\*\*|[{}()\[\];,.:?<>=+\-*/%!&|^~@#])
    """,
    re.VERBOSE,
)


def strip_comments(text: str, ext: str) -> str:
    """Remove comments without touching string contents (strings are matched first)."""
    if ext == ".py":
        pattern = re.compile(r'("""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\'|"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\')|#[^\n]*')
    elif ext in {".css"}:
        pattern = re.compile(r'("(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\')|/\*[\s\S]*?\*/')
    elif ext == ".html":
        pattern = re.compile(r'("(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\')|<!--[\s\S]*?-->')
    else:
        pattern = re.compile(r'("(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\'|`(?:\\.|[^`\\])*`)|//[^\n]*|/\*[\s\S]*?\*/')

    def keep(m: re.Match) -> str:
        if m.group(1) is not None:
            return m.group(1)
        return "\n" * m.group(0).count("\n")  # keep line numbers stable

    return pattern.sub(keep, text)


def tokenize(text: str, ext: str) -> list[tuple[str, str, int]]:
    """(exact, normalized, line) per token."""
    body = strip_comments(text, ext)
    out = []
    line_starts = [0]
    for i, ch in enumerate(body):
        if ch == "\n":
            line_starts.append(i + 1)
    import bisect

    for m in _TOKEN.finditer(body):
        kind = m.lastgroup
        tok = m.group(0)
        line = bisect.bisect_right(line_starts, m.start())
        if kind == "str":
            norm = "S"
            tok = re.sub(r"\s+", " ", tok)
        elif kind == "num":
            norm = "N"
        elif kind == "id":
            norm = "I" if tok not in _KEYWORDS else tok
        else:
            norm = tok
        out.append((tok, norm, line))
    return out


_KEYWORDS = set(
    """
    if else for while do switch case break continue return function const let var class new this
    import from export default async await try catch finally throw typeof instanceof in of
    def lambda pass yield with as and or not is None True False elif except raise global nonlocal
    null undefined true false void delete interface type extends implements
    """.split()
)


def kgram_hashes(seq: list[str], k: int) -> list[int]:
    hs = []
    for i in range(len(seq) - k + 1):
        h = hashlib.blake2b("\x1f".join(seq[i : i + k]).encode(), digest_size=8).digest()
        hs.append(int.from_bytes(h, "big"))
    return hs


def winnow(hs: list[int], w: int) -> dict[int, list[int]]:
    """MOSS winnowing: the minimum hash of every window, with its position."""
    picked: dict[int, list[int]] = {}
    last = -1
    for start in range(0, max(1, len(hs) - w + 1)):
        window = hs[start : start + w]
        if not window:
            break
        j = min(range(len(window)), key=lambda i: (window[i], -i))
        pos = start + j
        if pos != last:
            picked.setdefault(window[j], []).append(pos)
            last = pos
    return picked


class Source:
    def __init__(self, path: Path, root: Path):
        self.path = path
        self.rel = str(path.relative_to(root))
        text = path.read_text(encoding="utf-8", errors="replace")
        toks = tokenize(text, path.suffix)
        self.exact = [t[0] for t in toks]
        self.norm = [t[1] for t in toks]
        self.lines = [t[2] for t in toks]


def sources(root: Path) -> list[Source]:
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for name in filenames:
            p = Path(dirpath) / name
            if p.suffix in CODE_EXT and name not in SKIP_FILES:
                found.append(Source(p, root))
    return found


def longest_run(a: list[str], b: list[str], ia: int, ib: int) -> tuple[int, int, int]:
    """Extend a shared k-gram at (ia, ib) both ways into its maximal common run."""
    s_a, s_b = ia, ib
    while s_a > 0 and s_b > 0 and a[s_a - 1] == b[s_b - 1]:
        s_a -= 1
        s_b -= 1
    e_a, e_b = ia, ib
    while e_a < len(a) and e_b < len(b) and a[e_a] == b[e_b]:
        e_a += 1
        e_b += 1
    return s_a, s_b, e_a - s_a


def has_structure(norm_run: list[str]) -> bool:
    """True when a normalized run reads as code (names and keywords), not a table of literals. A
    name that is only a key in front of a literal (`ENTER: "Enter"`, `af_bella: "Sunny"`) is part of
    the table, not a name the code uses: an unquoted-key table is data as much as a quoted one."""
    named = 0
    for i, tok in enumerate(norm_run):
        if tok in _KEYWORDS:
            named += 1
        elif tok == "I":
            if i + 2 < len(norm_run) and norm_run[i + 1] == ":" and norm_run[i + 2] in ("S", "N"):
                continue
            named += 1
    return named * STRUCTURE_EVERY >= len(norm_run)


def compare(ours: list[Source], theirs: list[Source]) -> list[dict]:
    findings = []
    for mode, attr, threshold in (("exact", "exact", EXACT_RUN), ("normalized", "norm", NORM_RUN)):
        index: dict[int, list[tuple[Source, int]]] = {}
        for t in theirs:
            seq = getattr(t, attr)
            for h, positions in winnow(kgram_hashes(seq, K), WINDOW).items():
                for pos in positions:
                    index.setdefault(h, []).append((t, pos))
        for o in ours:
            seq = getattr(o, attr)
            best: dict[str, dict] = {}
            for h, positions in winnow(kgram_hashes(seq, K), WINDOW).items():
                for t, tpos in index.get(h, []):
                    tseq = getattr(t, attr)
                    for opos in positions:
                        s_o, s_t, n = longest_run(seq, tseq, opos, tpos)
                        if mode == "normalized" and not has_structure(seq[s_o:s_o + n]):
                            continue
                        if n >= threshold and n > best.get(t.rel, {}).get("tokens", 0):
                            best[t.rel] = {
                                "mode": mode,
                                "ours": o.rel,
                                "ours_lines": (o.lines[s_o], o.lines[s_o + n - 1]),
                                "theirs": t.rel,
                                "theirs_lines": (t.lines[s_t], t.lines[s_t + n - 1]),
                                "tokens": n,
                            }
            findings.extend(best.values())
    # A copy found in both modes is one finding; keep the exact one.
    seen, unique = set(), []
    for f in sorted(findings, key=lambda f: (f["mode"] != "exact", -f["tokens"])):
        key = (f["ours"], f["theirs"], f["ours_lines"])
        if key not in seen:
            seen.add(key)
            unique.append(f)
    return unique


def fetch() -> None:
    if (CACHE / ".git").exists():
        subprocess.run(["git", "-C", str(CACHE), "pull", "--ff-only", "-q"], check=True)
    else:
        subprocess.run(["git", "clone", "--depth", "1", "-q", UPSTREAM, str(CACHE)], check=True)
    head = subprocess.run(["git", "-C", str(CACHE), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    print(f"open-dot @ {head}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--ours", type=Path, default=REPO)
    ap.add_argument("--theirs", type=Path, default=CACHE)
    ap.add_argument("--fetch", action="store_true", help="clone or refresh Open Dot into the cache first")
    args = ap.parse_args(argv)

    # a fresh clone has no cached tree yet (it is git-ignored): clone it once instead of failing the gate;
    # a fetch that fails is still a scan that cannot run
    if args.fetch or (args.theirs == CACHE and not (CACHE / ".git").exists()):
        try:
            fetch()
        except (subprocess.CalledProcessError, OSError) as e:
            print(f"copyscan: CANNOT RUN — could not fetch Open Dot ({e})", file=sys.stderr)
            return 2
    if not args.theirs.is_dir() or not any(args.theirs.iterdir()):
        print(f"copyscan: CANNOT RUN — no Open Dot tree at {args.theirs} (use --fetch)", file=sys.stderr)
        return 2
    ours, theirs = sources(args.ours.resolve()), sources(args.theirs.resolve())
    if not theirs:
        print("copyscan: CANNOT RUN — their tree has no source files", file=sys.stderr)
        return 2

    findings = compare(ours, theirs)
    print(f"copyscan: {len(ours)} of our files vs {len(theirs)} of theirs")
    for f in findings:
        print(
            f"  COPY ({f['mode']}, {f['tokens']} tokens): {f['ours']}:{f['ours_lines'][0]}-{f['ours_lines'][1]}"
            f"  <=  {f['theirs']}:{f['theirs_lines'][0]}-{f['theirs_lines'][1]}"
        )
    print("copyscan: CLEAN" if not findings else f"copyscan: {len(findings)} copied region(s)")
    return 0 if not findings else 1


if __name__ == "__main__":
    sys.exit(main())
