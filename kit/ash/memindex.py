#!/usr/bin/env python3
"""The memory index has a budget, and going over it is said out loud (PLAN 14.8).

`MEMORY.md` is injected whole into every session. Its own first rule says *"one line per
fact, keep the hook under ~90 characters… this index is injected into EVERY session"* — and
that rule is enforced by nothing. `ASH_MEMORY_CAP` is 100 and the loader only nudges at
it; `voice_distill` never reads it and appends unconditionally. Hard rule 5, aimed at Ash's
own memory: **a rule that lives only in prose competes with everything else and loses.**

THE SHAPE OF THE FIX IS THE POINT. Over budget **names what to consolidate**, never a
silent drop:

    a store that quietly sheds entries is indistinguishable from one that never learned them

— and the person cannot tell which happened, so they stop trusting the store rather than
fixing it. `over_budget()` returns the offenders, worst first, with a reason each.

**This module only reports.** `~/ash/brain/memory/MEMORY.md` is owner-owned (hard rule 3), so
nothing here writes, moves or trims anything.

**THE OWNER'S DECISION, 2026-09-23: WARN, NEVER REFUSE.** Asked outright, the owner chose
"warn only" over the refusal `docs/proposals/14.8-memory-budget.md` proposed: a new memory is
still written, and over budget is a warning that names what to consolidate, worst first —
`warning()`, said by `voice_distill.accept` (the only thing that appends to the index), by the
nightly `learn_review apply`, and by `health` as a degraded section that is never "down".
Nothing is blocked and nothing is dropped: the refusal's cost was a learning loop that stops
silently the week nobody reads the report.
"""
import os
import re
from pathlib import Path

# The index's own stated rules, made numeric. These are not new limits — they are what the
# file already says about itself, which until now nothing checked.
MAX_ENTRIES = 100           # ASH_MEMORY_CAP's value, honoured rather than nudged at
MAX_HOOK_CHARS = 90         # "keep the hook under ~90 characters"
MAX_TOTAL_CHARS = 12_000    # what is reasonable to prepend to EVERY session

ENTRY = re.compile(r"^\s*-\s+\[(?P<title>[^\]]+)\]\((?P<file>[^)]+)\)\s*(?:—|-|–)?\s*(?P<hook>.*)$")


def parse(text):
    """[(title, file, hook, line_no)] for every index entry."""
    out = []
    for i, line in enumerate(str(text or "").splitlines(), 1):
        m = ENTRY.match(line)
        if m:
            out.append((m.group("title").strip(), m.group("file").strip(),
                        m.group("hook").strip(), i))
    return out


def measure(text):
    """What the index costs, as numbers rather than an impression."""
    entries = parse(text)
    body = str(text or "")
    lines = [l for l in body.splitlines() if l.strip()]
    return {"entries": len(entries), "lines": len(lines), "chars": len(body),
            "loose_lines": len(lines) - len(entries) }


def over_budget(text, *, max_entries=MAX_ENTRIES, max_hook=MAX_HOOK_CHARS,
                max_chars=MAX_TOTAL_CHARS):
    """[(what, why)] — everything over, worst first. [] means within budget.

    Worst first because the point is to name what to consolidate: a list that opens with
    twelve long hooks buries the fact that the file is a thousand characters over.
    """
    m = measure(text)
    entries = parse(text)
    out = []
    if m["chars"] > max_chars:
        out.append(("the whole index",
                    f"{m['chars']:,} characters, {m['chars'] - max_chars:,} over — and this "
                    f"is prepended to EVERY session, so it is a tax on every turn"))
    if m["entries"] > max_entries:
        out.append(("the entry count",
                    f"{m['entries']} entries against a cap of {max_entries} — "
                    f"{m['entries'] - max_entries} to consolidate or retire"))
    long_hooks = sorted(((t, h) for t, _f, h, _n in entries if len(h) > max_hook),
                        key=lambda x: -len(x[1]))
    for title, hook in long_hooks:
        out.append((title, f"the hook is {len(hook)} characters, {len(hook) - max_hook} over"))
    if m["loose_lines"]:
        out.append(("lines that are not entries",
                    f"{m['loose_lines']} line(s) are not `- [Title](file.md) — hook`; the "
                    f"index's own rule is one line per memory"))
    return out


def report(text, **kw):
    """(say, findings). The finding, worded as the person would need to act on it."""
    findings = over_budget(text, **kw)
    m = measure(text)
    if not findings:
        return (f"The memory index is within budget: {m['entries']} entries, "
                f"{m['chars']:,} characters."), []
    worst = findings[0]
    return (f"The memory index is over budget in {len(findings)} way(s). "
            f"Worst: {worst[0]} — {worst[1]}."), findings


def warning(text, *, top=3, **kw):
    """None within budget; otherwise ONE line a person can act on (14.8, warn only).

    How many ways over, then the `top` worst things to consolidate, worst first — each with
    the number that put it there — and the fact that nothing was dropped, because "over
    budget" on its own reads like "something was thrown away".
    """
    findings = over_budget(text, **kw)
    if not findings:
        return None
    named = "; ".join(f"{what} ({why.split(' — ')[0]})" for what, why in findings[:top])
    more = f"; and {len(findings) - top} more" if len(findings) > top else ""
    return (f"the memory index is over budget in {len(findings)} way(s). Consolidate, worst "
            f"first: {named}{more}. Nothing was dropped — orb/daemon/memindex.py lists it all.")


def brain_index():
    """ASH'S index — the one `voice_distill.accept` appends to. Resolved at CALL time from the
    same root voice_distill uses (`ASH_BRAIN_HOME`, else `~/ash/brain`), so a suite that moves the
    brain moves this too; MI.6 holds the two to the same path."""
    return Path(os.environ.get("ORBS_BRAIN") or os.environ.get("ASH_BRAIN_HOME") or Path.home()/".orbs"/"brain")/"memory"/"MEMORY.md"


def read_index(path=None):
    """The index text, or None. Never writes, never moves anything (hard rule 3).

    AN EXPLICIT PATH IS NEVER SECOND-GUESSED. The first version fell through to the live
    index whenever the given file was missing, so `--file /tmp/fixture.md` on a typo read
    the OWNER'S REAL MEMORY and measured that instead — a redirect that quietly does not
    redirect, which is D104 and D155's shape in a file hard rule 3 says not to touch. A
    caller that names a file gets that file or nothing.
    """
    # D349 — THE DEFAULT WAS A DIFFERENT ASSISTANT'S MEMORY. With no path this read Claude
    # Code's own project index (`~/.claude/projects/-home-<name>/memory/MEMORY.md`) FIRST and
    # Ash's only if that was missing — so on a machine where a developer uses Claude Code, the
    # 2026-09-21 measurement in PLAN 14.8 ("70 entries, 13,306 characters") was of the wrong
    # file. Ash's own was 87 entries and 15,139 characters, unchanged since 5 September. One
    # default: his.
    p = Path(path) if path is not None else brain_index()
    try:
        return p.read_text(errors="replace")
    except OSError:
        return None


def main():
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--file", help="an index to measure (default: Ash's own, read-only)")
    ap.add_argument("--check", action="store_true", help="exit 1 when over budget")
    a = ap.parse_args()
    text = read_index(a.file)
    if text is None:
        print("  no memory index found")
        return 0
    m = measure(text)
    print(f"  {m['entries']} entries, {m['lines']} lines, {m['chars']:,} characters")
    said, findings = report(text)
    print(f"  {said}")
    for what, why in findings[:10]:
        print(f"    ✗ {what}: {why}")
    if len(findings) > 10:
        print(f"    … and {len(findings) - 10} more")
    return 1 if (a.check and findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
