#!/usr/bin/env python3
"""release_gate — everything that must hold before this tree is pushed, in one verdict.

PLAN rows 5.10, 5.11, 5.13. **A push is one-way.** Caches, forks and mirrors outlive a
delete, so the gate runs before a remote exists rather than after one does. Nothing here
pushes anything; the last section prints what a push *would* publish and stops.

    tools/release_gate.py              this checkout
    tools/release_gate.py --root DIR   another checkout — how the suite plants into a fixture
    tools/release_gate.py --manifest   print the push manifest only

**It scans what would be PUBLISHED, not what is tracked.** The first version of this file
scanned `git ls-files` and reported 80 clean files — while `PLAN.md`, `CLAUDE.md`,
`DEFECTS.md`, `tools/` and 300 other files sat untracked beside it, every one of them
destined for the same push the moment somebody types `git add -A`. A gate that is green
because the sensitive file has not been added yet is the `write_guard` failure (D172) in a
different costume: a check pointed at a set that does not contain the thing it is checking
for. The publishable set is **tracked ∪ untracked-but-not-ignored**, and `.gitignore` is the
only thing that removes a file from it.

Gates:

    G1  secrets, publishable working set   every pattern `secretscan` knows
    G2  secrets, every commit ever made    a key deleted yesterday is still in the pack
    G3  absolute home paths in SOURCE      publishes a username, and breaks on any other machine
    G3b permitted exceptions still apply   dead permission nobody revoked
    G3c absolute home paths in DOCUMENTS   reported, never gated — see below

**Why documents are reported and not gated.** `DEFECTS.md`, the handoffs and `docs/history/`
are evidence: they quote real sessions, real paths and the user's own words, and stripping
them would damage the record. Whether that record goes public at all is PLAN 5.12, and that
is the owner's judgement, not a scanner's. So the gate counts them, names the files, and
refuses to pretend a scan settled it. Source is different — a home path in code has no
evidentiary value and is simply a defect.

**Standard library only**, like every other tool here: the gate has to run in a fresh clone
that has installed nothing, which is exactly the state a person is in when deciding to push.

**Every path is resolved at call time from `root`.** A root bound at import is the defect
this project has hit four times (D104, D155, D166, D172) — and here it would have been
terminal, because the one claim 5.13_t must prove is that a planted credential fails the gate
*in history*, and proving that means committing one. To a fixture repo, never to this one.
"""
import argparse
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent


def repo_root(start=None):
    """Walk up to the checkout root. Never count directory levels — D54, and `secretscan.py`
    carries the same note: a root computed from a fixed depth was right while the tree was
    `ashd/` and silently wrong the moment it became `orb/daemon/`."""
    p = (start or HERE).resolve()
    for d in [p] + list(p.parents):
        if (d/".git").exists():
            return d
    return p


def _secretscan_module():
    """Import `secretscan` rather than copying its patterns.

    Two copies of a pattern list is two lists, and the second one is always the stale one.
    It is also what `make check` runs (PLAN 2.9), so the everyday check and the release gate
    cannot disagree about what a secret looks like.
    """
    d = str(repo_root()/"orb"/"daemon")
    if d not in sys.path:
        sys.path.insert(0, d)
    import secretscan
    return secretscan


# ── G3: what an absolute home path looks like ──────────────────────────────────────────
# Generalised past this machine on purpose. Matching only `/home/ovrsv` would pass a tree
# developed by somebody else and still leak THEIR username, while looking green — the shape
# of failure this project keeps rediscovering. `/home/user` is excluded because it is the
# conventional placeholder and carries no one's name.
HOME_PATH = re.compile(
    r'/(?:home|Users)/(?!user\b|USER\b|<)[a-z_][a-z0-9_-]{1,31}(?=[/"\'\s:,);\]]|$)')

# THE SAME PATH WITH THE SLASHES TURNED INTO DASHES. Claude Code names a project directory
# after the working directory that way, so a home path is spelled `-home-<name>` — and
# `memindex.py` had that segment written out as a literal. G3 called the file clean, because
# a regex looking for `/home/<name>` cannot see `-home-<name>`. It is the same disclosure and
# the same portability bug wearing different punctuation, which is precisely the kind of
# near-miss an allowlist-shaped check never catches: the pattern was right about the risk and
# wrong about the spelling.
HOME_DASHED = re.compile(
    r'(?<![A-Za-z0-9_])-(?:home|Users)-(?!user\b|USER\b)[a-z_][a-z0-9_]{1,31}\b')
# The lookbehind is the whole difference between a check people keep and one they turn
# off: without it this fires on `some-home-made-thing`, because `-home-made` matches.
# The encoded form always STARTS the directory name, so `-home-` preceded by a word
# character is ordinary English and not a path. RG.3l is the counter-control.

BINARY_SUFFIX = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".wav", ".mp3", ".mp4", ".webm",
                 ".vsix", ".pdf", ".woff", ".woff2", ".ttf", ".otf", ".zip", ".onnx", ".bin",
                 ".pyc", ".so", ".jsonl"}

# Source is gated; documents are reported. A `.md` under `docs/history/` is a verbatim
# snapshot by design (PLAN 1.1) and rewriting it would destroy the thing it exists to be.
DOC_SUFFIX = {".md", ".txt", ".csv", ".log"}

# THE ONLY PERMITTED ABSOLUTE PATHS IN SOURCE, each naming the row that permits it and the
# condition that ends it. A bare filename in an exception list reads as "this one is fine"
# rather than "this one is a known cost", and nobody revisits it.
#
# EACH ENTRY IS A RATCHET, not a blanket pass. `{path: (expected_count, reason)}`, and G3b
# fails if the real count moves in EITHER direction. Permission per FILE was the first
# version and it is too generous by half: a file allowed one home path is thereby allowed
# fifty, so the exception silently widens every time somebody edits it — and nobody reviews
# an exception that was granted months ago. Requiring the exact count means adding one costs
# a deliberate edit here, with a reason, which is the whole point of the list existing.
# Same shape as `ran_everything.NO_CONTROL_YET` and `test_orb_csp` C.6c.
ALLOWED = {
    # `orb/shell/panels/clawd.2.js` WAS here, permitted 1, and the entry said in its own
    # words that the exception dies with the import. PLAN 16.5 ended it on 2026-09-21: the
    # engine path is resolved in `main.js` from `os.homedir()` and handed to the panel on the
    # query string, so the renderer names nobody's home. The import is still there — the
    # trust-boundary cost CLAUDE.md §7 describes is unchanged — it simply no longer carries
    # an absolute path.
    #
    # WORTH RECORDING WHY THIS TOOK A PLANT TO SEE. With the permission in place, G3 printed
    # "no absolute home path in source (0 found)" over a file containing one, because one was
    # its budget. That is honest and it is also exactly what a missed defect looks like, so
    # a planted defect inside a permitted file proves nothing about the check — it is
    # absorbed. The permission is the thing to test, and G3b is what tests it: it failed the
    # moment the count went 1 -> 0, which is how this entry came to be removed rather than
    # left behind as dead permission.
    "orb/daemon/test_release_gate.py": (6,
        "PLAN 5.13_t — the gate's own suite. It plants a home path under a made-up name, "
        "because a detector cannot be proven against input it does not match: the file has "
        "to contain the thing it hunts. Five plants: source and document (G3 vs G3c are "
        "different verdicts), the ratchet's own baseline, and a symlink target with its "
        "relative-link counter-control, and the dash-encoded form (RG.3k). Raised 2 -> 5 -> 6 "
        "on 2026-09-21, both times because the ratchet refused the widening rather than "
        "absorbing it — which is the entire argument for a counted permission over a "
        "per-file one."),
}


# ── G1: the three suites that hold synthetic key material on purpose ───────────────────
# `test_secretscan`, `test_redact` and `test_desk_redaction` exist to prove that a key is
# caught or removed, so each must contain something shaped like a key. A scanner cannot tell
# a convincing fake from a real one, and it should not try: entropy heuristics on
# `sk-abc123…` are a coin flip, and a gate that guesses is a gate people learn to override.
#
# So the exemption is DECLARED, in two halves that must agree:
#
#   * the file carries `SECRETSCAN-FIXTURES:` in its own text, and
#   * the file is named here.
#
# Either half alone is a hole. A declaration alone lets any file exempt itself by adding a
# comment — which is not a gate, it is a suggestion. A list alone silently keeps covering a
# file that stopped being a fixture suite and started holding something real. G1b checks
# both directions, so a new file cannot self-exempt and a stale entry cannot linger.
FIXTURE_DECL = "SECRETSCAN-FIXTURES:"
FIXTURE_FILES = {
    "orb/daemon/test_secretscan.py":
        "the scanner's own suite — every pattern it knows needs a specimen to match",
    "orb/daemon/test_redact.py":
        "PLAN 13.4 — proves the redactor removes each shape from a log line",
    "orb/daemon/test_desk_redaction.py":
        "PLAN 13.4 — proves desk.json carries no key material out of a live session",
}


def fixture_disagreements(root, files):
    """(undeclared, unlisted) — the two ways the fixture exemption can rot.

    `undeclared`: listed here but the file no longer says so — dead permission.
    `unlisted`: the file says so but is not listed — a file exempting itself.
    """
    # A LISTED FILE THAT IS NOT IN THIS TREE IS NOT A VIOLATION. Both lists name paths in
    # THIS checkout, and the gate runs against any root — a fixture repo, a fresh clone, a
    # subdirectory. Treating "absent" as "dead permission" made every gate fail on every
    # other tree, which took RG.0 with it: the control that proves a clean tree passes was
    # red, so every plant below it was being caught by a gate that failed on everything.
    # That is the exact failure RG.0 exists to detect, and it detected it on its first run.
    present = set(files)
    undeclared = [rel for rel in FIXTURE_FILES
                  if rel in present and FIXTURE_DECL not in (_readable(root, rel) or "")]
    unlisted = [rel for rel in files
                if rel not in FIXTURE_FILES and not _is_self(rel)
                and FIXTURE_DECL in (_readable(root, rel) or "")]
    return undeclared, unlisted


def _is_self(rel):
    """This file necessarily contains every marker it hunts — it defines them.

    The house rule (CLAUDE.md §12) is that such a detector skips itself and is proven against
    a planted fixture instead, because the alternative is a scanner that reports its own
    source as a violation forever. Skipping by name rather than by a clever split literal: a
    split is quietly undone by the next person who writes the constant out in a comment, and
    it will still be wrong in a way that looks like it works.
    """
    return pathlib.Path(rel).name == pathlib.Path(__file__).name


def publishable(root):
    """(tracked, untracked_not_ignored) — everything a push would carry.

    `git ls-files` is what is in the index; `--others --exclude-standard` is what `git add -A`
    would add next. Their union is the honest denominator, and the difference is worth
    printing: a person reading "80 files" while 303 sit unadded has been told a number that
    is true and useless.
    """
    def _run(*args):
        r = subprocess.run(["git"] + list(args), cwd=root, capture_output=True, text=True)
        return [p for p in r.stdout.splitlines() if p]
    return _run("ls-files"), _run("ls-files", "--others", "--exclude-standard")


def _symlink_target(root, rel):
    """The target string of a tracked symlink, or None.

    **git stores a symlink's target as the blob's content**, so a link pointing at
    `/home/<someone>/...` publishes that path verbatim — and `_readable` deliberately refuses
    to follow links, which means G3 would never see it. There are none in this tree today;
    that is precisely when to close the hole, because the first one to appear will be added by
    somebody solving a different problem and nothing would say a word.
    """
    f = pathlib.Path(root)/rel
    try:
        return str(f.readlink()) if f.is_symlink() else None
    except OSError:
        return None


def _readable(root, rel):
    f = pathlib.Path(root)/rel
    if f.suffix.lower() in BINARY_SUFFIX or not f.is_file() or f.is_symlink():
        return None
    try:
        if f.stat().st_size > 4_000_000:
            return None
        return f.read_text(errors="replace")
    except OSError:
        return None


def home_paths(root, files):
    """{"source": [...], "docs": [...]} — (relpath, lineno, line) for each absolute home path.

    Comments are NOT stripped, and that is deliberate — the opposite of the house rule for
    detectors. A detector hunting a code defect must strip comments, because the fix's own
    explanation quotes the code it replaced (X.4, X.9, W.2). This one hunts a *disclosure*,
    and a username in a comment is published exactly as loudly as one in a string.
    """
    out = {"source": [], "docs": []}
    for rel in files:
        # THIS FILE NECESSARILY CONTAINS WHAT IT HUNTS — the patterns, and the examples that
        # explain why each one is shaped the way it is. `_is_self` is already how G1b handles
        # the same problem for the fixture marker, and the house rule (CLAUDE.md §12) is that
        # such a detector skips itself and is proven against a planted fixture instead.
        # RG.3a/k/l are that proof: they plant both encodings and the near-miss into a
        # throwaway repository and require the right verdict on each.
        if rel in ALLOWED or _is_self(rel):
            continue
        text = _readable(root, rel)
        if text is None:
            continue
        kind = "docs" if pathlib.Path(rel).suffix.lower() in DOC_SUFFIX else "source"
        for i, line in enumerate(text.splitlines(), 1):
            if HOME_PATH.search(line) or HOME_DASHED.search(line):
                out[kind].append((rel, i, line.strip()[:110]))
    # A symlink has no readable text, so the loop above never reaches one. Its TARGET is the
    # published content, and a link is always source — there is no such thing as a symlink
    # that is evidence.
    for rel in files:
        if rel in ALLOWED or _is_self(rel):
            continue
        tgt = _symlink_target(root, rel)
        if tgt and (HOME_PATH.search(tgt) or HOME_DASHED.search(tgt)):
            out["source"].append((rel, 0, f"symlink -> {tgt[:90]}"))
    return out


def allowed_drift(root, files):
    """[(path, expected, actual)] where a permitted file's count has moved.

    Both directions are a finding. FEWER means the reason expired and nobody revoked the
    permission — dead permission that will silently cover the next occurrence. MORE means the
    exception grew without anyone deciding it should.

    Scoped to `files` for the same reason as `fixture_disagreements`: a path this checkout has
    and another does not is absent, not expired, and treating the two alike made every gate
    fail on every tree but this one (D178).
    """
    present, out = set(files), []
    for rel, (expected, _reason) in ALLOWED.items():
        if rel not in present:
            continue
        text = _readable(root, rel) or ""
        actual = sum(1 for line in text.splitlines()
                     if HOME_PATH.search(line) or HOME_DASHED.search(line))
        if actual != expected:
            out.append((rel, expected, actual))
    return out


def secrets_in_files(root, files):
    ss = _secretscan_module()
    undeclared, unlisted = fixture_disagreements(root, files)
    # A listed file that no longer declares itself is NOT exempt. The exemption is the
    # agreement of the two halves, so when they disagree the file is scanned like any other
    # and G1b says why. Failing closed costs a noisy report; failing open costs a key.
    exempt = {rel for rel in FIXTURE_FILES if rel not in undeclared}
    hits = []
    for rel in files:
        if rel in exempt or pathlib.Path(rel).suffix.lower() in ss.SKIP_SUFFIX:
            continue
        text = _readable(root, rel)
        if text is not None:
            hits += ss.scan_text(text, rel)
    return hits


def secrets_in_history(root, max_blob=4_000_000):
    """Every blob ever committed. A key deleted yesterday is still in the pack.

    THREE THINGS THIS GETS RIGHT THAT THE OBVIOUS VERSION DOES NOT, each of which cost a run:

    * **Bytes, not text.** `capture_output=True, text=True` decodes as UTF-8 and *raises* on
      the first PNG in the history. The gate then reported nothing at all — not "no secrets",
      not "one secret", a traceback — which is the house's own rule that a check which dies
      is not a check that reported. Binary is normal in any history; it must not be fatal.
    * **Blobs only.** `rev-list --objects` lists trees and tags too, and `cat-file -p` on a
      tree prints a directory listing that no scanner should be reading.
    * **One process, not one per object.** `--batch` streams; a `cat-file` fork per blob is
      minutes on a real history, and a gate slow enough to skip is a gate that gets skipped.
    """
    ss = _secretscan_module()
    # REACHABLE FROM A REF, not every object in the database. `--batch-all-objects` also
    # returns loose objects nothing points at: blobs from a `git add` that was replaced
    # before it was committed, and anything written with `git hash-object -w`. Measured on
    # this repository the day it got its first real commit: **560 blobs in the database, 493
    # reachable** — and the 67 difference made the gate fail over a staged-then-superseded
    # copy of a test fixture that is in no commit and will be pruned by `git gc`.
    #
    # It matters because of what this gate is FOR. A push publishes what the refs reach. An
    # unreferenced loose object cannot leak and is not evidence of anything; blocking a
    # release over one is a false positive that teaches people to skip the gate. This also
    # makes the docstring true — it says "every blob ever committed", which is what
    # `rev-list --objects --all` returns and what `--batch-all-objects` never did.
    reachable = subprocess.run(["git", "rev-list", "--objects", "--all"],
                               cwd=root, capture_output=True, text=True).stdout.splitlines()
    want = {l.split()[0] for l in reachable if l.strip()}
    listing = subprocess.run(
        ["git", "cat-file", "--batch-all-objects", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
        cwd=root, capture_output=True, text=True).stdout.splitlines()
    shas = []
    for line in listing:
        parts = line.split()
        if (len(parts) == 3 and parts[1] == "blob" and int(parts[2]) <= max_blob
                and parts[0] in want):
            shas.append(parts[0])
    if not shas:
        return []
    batch = subprocess.run(["git", "cat-file", "--batch"], cwd=root,
                           input=("\n".join(shas) + "\n").encode(), capture_output=True)
    hits, buf, i = [], batch.stdout, 0
    while i < len(buf):
        nl = buf.find(b"\n", i)
        if nl < 0:
            break
        header = buf[i:nl].split()
        if len(header) != 3:
            break
        sha, size = header[0].decode(), int(header[2])
        body, i = buf[nl + 1:nl + 1 + size], nl + 1 + size + 1
        # A NUL byte means binary. Scanning its mojibake produces findings nobody can act on.
        if b"\x00" in body[:8000]:
            continue
        text = body.decode("utf-8", errors="replace")
        # A FIXTURE BLOB IS STILL A FIXTURE. The redaction and scanning suites carry planted
        # keys on purpose — a fixture the detector misses proves nothing — and once they are
        # committed they are in the pack for good. Without this the gate is permanently red
        # over its own test data, and a gate that is always red is a gate nobody reads.
        #
        # ONE LOCK HERE, TWO IN THE TREE, and the difference is not laziness. `secretscan`
        # exempts a live file only if it declares itself AND its finding count matches
        # exactly. History cannot honour the count: an old blob holds the count that file had
        # when it was committed, and editing the fixtures later would retroactively fail every
        # earlier blob. So history trusts the marker alone — which is the part that is
        # verifiable about a frozen object — and the count stays a live-tree ratchet.
        if ss.FIXTURE_MARKER in text:
            continue
        hits += ss.scan_text(text, f"<blob {sha[:8]}>")
    return list(dict.fromkeys(hits))


def manifest(root):
    tracked, untracked = publishable(root)
    total, by_dir = 0, {}
    for rel in tracked + untracked:
        f = pathlib.Path(root)/rel
        try:
            n = f.stat().st_size
        except OSError:
            n = 0
        total += n
        top = rel.split("/")[0] if "/" in rel else "(root)"
        d = by_dir.setdefault(top, [0, 0])
        d[0] += 1
        d[1] += n
    commits = subprocess.run(["git", "rev-list", "--count", "--all"], cwd=root,
                             capture_output=True, text=True).stdout.strip() or "0"
    remotes = subprocess.run(["git", "remote", "-v"], cwd=root,
                             capture_output=True, text=True).stdout.strip()
    return {"tracked": len(tracked), "untracked": len(untracked), "bytes": total,
            "by_dir": by_dir, "commits": commits, "remotes": remotes}


def print_manifest(m):
    print(f"  {m['tracked'] + m['untracked']} files would be published "
          f"({m['tracked']} tracked + {m['untracked']} untracked-not-ignored), "
          f"{m['bytes']/1e6:.2f} MB")
    for top, (n, b) in sorted(m["by_dir"].items(), key=lambda kv: -kv[1][1])[:10]:
        print(f"    {top:24} {n:4} files  {b/1e6:7.2f} MB")
    # THE HISTORY IS PUBLISHED TOO, and it is the half people forget. The working tree is
    # what they looked at; the pack is what they send.
    print(f"  history: {m['commits']} commits — all of them are published, not just HEAD")
    if m["remotes"]:
        print("  remotes:")
        for line in m["remotes"].splitlines():
            print(f"    {line}")
    else:
        print("  remotes: none — nothing can be pushed by accident yet, which is the right "
              "state until 5.12 is decided")


def run(root, history=True):
    """(ok, [(gate, passed, detail)]) — every gate runs, even after one fails.

    Stopping at the first failure means a person fixes a secret, reruns, and only then learns
    about the paths. A release gate is read once and acted on once.
    """
    tracked, untracked = publishable(root)
    files = tracked + untracked
    results = []

    hits = secrets_in_files(root, files)
    results.append((f"G1 no key material in the {len(files)} publishable files",
                    not hits, "\n".join(f"  - {h}" for h in hits[:20])))

    undeclared, unlisted = fixture_disagreements(root, files)
    results.append((
        "G1b the fixture exemption's two halves agree", not (undeclared or unlisted),
        "\n".join(
            [f"  - {r}: listed as a fixture suite but no longer declares itself — dead permission"
             for r in undeclared] +
            [f"  - {r}: declares itself a fixture suite but is not listed — a file cannot "
             "exempt itself" for r in unlisted])))

    if history:
        h = secrets_in_history(root)
        results.append(("G2 no key material in any commit ever made", not h,
                        "\n".join(f"  - {x}" for x in h[:20])))
    else:
        results.append(("G2 no key material in any commit ever made", None,
                        "skipped (--no-history)"))

    hp = home_paths(root, files)
    src = hp["source"]
    detail = "\n".join(f"  - {r}:{n}  {ln}" for r, n, ln in src[:20])
    if len(src) > 20:
        detail += f"\n  … and {len(src) - 20} more"
    results.append((f"G3 no absolute home path in source ({len(src)} found)", not src, detail))

    drift = allowed_drift(root, files)
    results.append((
        "G3b every permitted exception still matches its recorded count", not drift,
        "\n".join(
            f"  - {r}: permitted {e}, found {a} — "
            + ("the reason expired and the permission was not revoked" if a < e
               else "the exception grew without anyone deciding it should")
            for r, e, a in drift)))

    return all(p is not False for _, p, _ in results), results, hp


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", default=None, help="gate this checkout instead of my own")
    ap.add_argument("--manifest", action="store_true", help="print the push manifest only")
    ap.add_argument("--no-history", action="store_true", help="skip the history scan")
    a = ap.parse_args()
    root = pathlib.Path(a.root).resolve() if a.root else repo_root()

    if a.manifest:
        print("push manifest — what would become public")
        print_manifest(manifest(root))
        return 0

    print(f"release gate  ({root})")
    ok, results, hp = run(root, history=not a.no_history)
    for name, passed, detail in results:
        mark = "SKIP" if passed is None else ("PASS" if passed else "FAIL")
        print(f"  {mark}  {name}")
        if passed is False and detail:
            for line in detail.splitlines():
                print(f"        {line}")

    # G3c REPORTS AND DOES NOT GATE. See the module docstring: whether the evidence record
    # goes public is PLAN 5.12, an owner's judgement. Printing a count is not deciding it,
    # and silently passing would be pretending there was nothing to decide.
    docs = hp["docs"]
    by_file = {}
    for rel, _, _ in docs:
        by_file[rel] = by_file.get(rel, 0) + 1
    print(f"\n  NOTE  G3c {len(docs)} absolute home path(s) across {len(by_file)} document(s) "
          "— PLAN 5.12, the owner's call, not a gate")
    for rel, n in sorted(by_file.items(), key=lambda kv: -kv[1])[:8]:
        print(f"        {n:4}  {rel}")
    if len(by_file) > 8:
        print(f"        … and {len(by_file) - 8} more documents")

    print("\npush manifest — what would become public")
    print_manifest(manifest(root))

    if ok:
        # PASSING IS NOT PERMISSION. 5.12 is a judgement about DEFECTS.md and docs/history/,
        # which carry real session ids, spend figures and the user's own quoted words.
        # No scan decides that, and 5.13 says the push waits for it.
        print("\n✓ gates pass. This is NOT approval to push: 5.12 — public or private, and "
              "what gets scrubbed — is the owner's decision, and 5.13 holds the push for it.")
    else:
        print("\n✗ release gate failed. A push is one-way; fix these first.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
