"""Familiarity fingerprints: what "looks like the approved cases" means, decided by code.

A habit's own guard is written by the teacher from normal examples, and the calendar pilot showed
that is not enough: it let 3 of 4 unfamiliar inputs through. So every promoted habit also gets two
fingerprints learned by CODE from its approved cases — one over inputs, one over outputs — and the
ladder only lets the habit answer when the input is familiar AND the answer looks like an answer.

What is learned at each JSON path (list items collapse to `[]`):
  types        the JSON types seen
  keys         dict keys ever seen, and the ones present in every sample (required)
  shapes       for short formatted strings: their character-class shape ("2026-10-05" -> "9-9-9")
  symbols      unusual characters ever seen in the text ("$", "—", "é"); a new one is unfamiliar
  list_min     outputs only: a list that was never empty must not come back empty
  sign         outputs only: a number that was always > 0 must not come back <= 0
Datetimes are pooled by format: if every datetime of a format ever seen fell on a weekday, a
weekend one is unfamiliar. (An hour-of-day range was tried and dropped on 2026-09-30: in the first
full spike it caught none of 30 odd cases and refused 8 normal ones — a 17:00 end, a 9:00 slot.)
Output rules (never-empty, always-positive) only apply once MIN_EVIDENCE approved answers back them:
"never empty in 3 answers" is not evidence, and it refused ordinary inboxes with no bills.

Anything not seen is a reason to hand the case back. That is conservative on purpose: a deferred
case costs one big-brain call and becomes tomorrow's training data; a wrong habit answer costs trust.
"""
from __future__ import annotations

import datetime as dt
import re

COMMON = set(" .,:;!?'\"-()/@_&#%+=*[]{}<>\n\t")
FREE_LEN, FREE_SPACES, MAX_SHAPES = 40, 3, 6
MIN_EVIDENCE = 10


def shape(s: str) -> str:
    out, last = [], None
    for ch in s:
        c = "9" if ch.isdigit() else "A" if ch.isupper() else "a" if ch.islower() else ch
        if c != last:
            out.append(c)
        last = c
    return "".join(out)


def symbols(s: str) -> set[str]:
    return {ch for ch in s if not ch.isalnum() and ch not in COMMON} | {ch for ch in s if ord(ch) > 127}


def _iso(s: str):
    if not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", s):
        return None
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def kind(v) -> str:
    """JSON's types, with int and float as one: a total of 0 is not a different kind of thing from 0.5."""
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "number"
    return type(v).__name__


def _walk(x, path, visit):
    visit(path, x)
    if isinstance(x, dict):
        for k, v in x.items():
            _walk(v, f"{path}.{k}", visit)
    elif isinstance(x, list):
        for v in x:
            _walk(v, f"{path}[]", visit)


def learn(samples: list, outputs: bool = False) -> dict:
    stats: dict[str, dict] = {}
    times: dict[str, dict] = {}

    def visit(path, v):
        st = stats.setdefault(path, {"types": set(), "n": 0})
        st["n"] += 1
        st["types"].add(kind(v))
        if isinstance(v, dict):
            st.setdefault("keys", set()).update(v)
            st["required"] = set(v) if "required" not in st else st["required"] & set(v)
        elif isinstance(v, str):
            st.setdefault("shapes", set()).add(shape(v))
            st.setdefault("symbols", set()).update(symbols(v))
            st["free"] = st.get("free", False) or len(v) > FREE_LEN or v.count(" ") >= FREE_SPACES
            t = _iso(v)
            if t:
                pool = times.setdefault(shape(v), {"weekend": False, "n": 0})
                pool["n"] += 1
                pool["weekend"] |= t.weekday() >= 5
        elif isinstance(v, list) and outputs:
            st["list_min"] = min(st.get("list_min", len(v)), len(v))
        elif isinstance(v, (int, float)) and not isinstance(v, bool) and outputs:
            st["pos"] = st.get("pos", True) and v > 0

    for s in samples:
        _walk(s, "$", visit)
    for st in stats.values():
        if "shapes" in st and (st["free"] or len(st["shapes"]) > MAX_SHAPES):
            st["free"] = True
    return {"paths": stats, "times": times, "outputs": outputs}


def check(value, fp: dict) -> str | None:
    """None if the value looks like what was learned; otherwise the first reason it does not."""
    paths, times = fp["paths"], fp["times"]
    problems: list[str] = []

    def visit(path, v):
        if problems:
            return
        st = paths.get(path)
        if st is None:
            problems.append(f"never seen {path}")
            return
        if kind(v) not in st["types"]:
            problems.append(f"{path} is {kind(v)}, only saw {sorted(st['types'])}")
        elif isinstance(v, dict):
            extra, missing = set(v) - st.get("keys", set()), st.get("required", set()) - set(v)
            if extra:
                problems.append(f"unknown key(s) {sorted(extra)} at {path}")
            elif missing:
                problems.append(f"missing key(s) {sorted(missing)} at {path}")
        elif isinstance(v, str):
            new_sym = symbols(v) - st.get("symbols", set())
            if new_sym:
                problems.append(f"unfamiliar character(s) {''.join(sorted(new_sym))!r} at {path}")
            elif not st.get("free") and shape(v) not in st.get("shapes", set()):
                problems.append(f"new format {shape(v)!r} at {path}")
            else:
                t = _iso(v)
                pool = times.get(shape(v)) if t else None
                if t and pool and pool["n"] >= 10:
                    if t.weekday() >= 5 and not pool["weekend"]:
                        problems.append(f"{path} falls on a weekend; every one seen was a weekday")
        elif isinstance(v, list) and fp["outputs"] and st["n"] >= MIN_EVIDENCE and len(v) < st.get("list_min", 0):
            problems.append(f"{path} is empty; it never was in {st['n']} approved answers")
        elif (isinstance(v, (int, float)) and not isinstance(v, bool) and fp["outputs"] and st["n"] >= MIN_EVIDENCE
              and st.get("pos") and v <= 0):
            problems.append(f"{path} is {v}; it was always > 0 in {st['n']} approved answers")

    _walk(value, "$", visit)
    return problems[0] if problems else None
