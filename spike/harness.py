"""The spike's day and night: the ladder (habit → big brain) and the nightly habit compiler.

Day:   ladder() runs one task instance. A promoted habit answers first (inside the sandbox); if its
       guard trips or it errors, the case falls back to the big brain. Fuzzy fields (a headline, a
       cover note) always come from a model — a much smaller call when a habit did the rest.
Night: compile_habit() asks the teacher for a habit, then the HARNESS re-runs every approved case
       through it. It is promoted only if every case passes and its guard accepts every one of
       them. The teacher's own opinion of its code counts for nothing.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field

import fingerprint as fpm
from brain import BrainError, extract_json, extract_python
from fixtures import SCHEMAS, TASKS
from sandbox import run_habit

MAX_EXAMPLES = 8


def norm(x):
    """Comparison form: numbers by value to the cent, strings trimmed, structure kept."""
    if isinstance(x, bool) or x is None:
        return x
    if isinstance(x, (int, float)):
        return round(float(x), 2)
    if isinstance(x, str):
        return x.strip()
    if isinstance(x, list):
        return [norm(v) for v in x]
    if isinstance(x, dict):
        return {k: norm(v) for k, v in x.items()}
    return x


def det(task: str, out: dict) -> dict:
    return {k: out.get(k) for k in TASKS[task]["fields"]}


def same(task: str, got: dict | None, expected: dict | None) -> bool:
    return got is not None and expected is not None and norm(det(task, got)) == norm(expected)


SYSTEM = "You are an orb, a personal assistant. Follow the user's rules exactly. Reply with ONE JSON object and nothing else."


def big_brain_answer(brain, task: str, inp: dict) -> tuple[dict | None, int, str]:
    """The big brain does the whole job. Returns (answer or None, tokens, note on what went wrong)."""
    t = TASKS[task]
    fuzzy = "; ".join(f"{k}: {v}" for k, v in t["fuzzy"].items())
    msg = (f"{t['rules']}\n\nReply with ONE JSON object of exactly this shape ({fuzzy}):\n{SCHEMAS[task]}\n\n"
           f"Input:\n```json\n{json.dumps(inp, indent=1)}\n```")
    r = brain.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": msg}], purpose=f"day:{task}:big",
                   max_tokens=16000)
    note = "truncated" if r.get("finish") == "length" else ""
    try:
        out = extract_json(r["text"])
    except (ValueError, json.JSONDecodeError):
        return None, r["total"], note or "unparseable"
    # A reply cut off mid-object can still contain a complete INNER object; never mistake it for the answer.
    if not isinstance(out, dict) or not set(t["fields"]) <= set(out):
        return None, r["total"], note or f"missing keys {sorted(set(t['fields']) - set(out or {}))}"
    return out, r["total"], note


def fuzzy_fields(brain, task: str, decided: dict) -> tuple[dict, int]:
    """The friendly part. If its seat is down the decided part still stands; the note is just missing."""
    try:
        return _fuzzy_fields(brain, task, decided)
    except BrainError:
        return {}, 0


def _fuzzy_fields(brain, task: str, decided: dict) -> tuple[dict, int]:
    t = TASKS[task]
    want = ", ".join(f'"{k}": {v}' for k, v in t["fuzzy"].items())
    msg = (f"Everything below is already decided; do not change it. Write only {want}.\n\n"
           f"```json\n{json.dumps(decided)}\n```\nReply with a JSON object with just those keys.")
    r = brain.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": msg}], purpose=f"day:{task}:fuzzy")
    try:
        return extract_json(r["text"]), r["total"]
    except (ValueError, json.JSONDecodeError):
        return {}, r["total"]


@dataclass
class Result:
    route: str            # "habit" | "big" | "fallback"
    output: dict | None
    tokens: int
    habit_steps: int
    steps: int
    reason: str = ""      # why a habit did not answer
    note: str = ""        # what went wrong with the big brain's reply, if anything


def make_habit(code: str, traces: list[tuple[dict, dict]]) -> dict:
    """A promoted habit: the teacher's code plus two fingerprints learned by code from the approved cases."""
    return {"code": code, "in_fp": fpm.learn([i for i, _ in traces]), "out_fp": fpm.learn([e for _, e in traces], outputs=True)}


def ladder(brain, task: str, inp: dict, habit: dict | None, do_fuzzy: bool = True, call_big: bool = True,
           own=None) -> Result:
    """`own` answers the fuzzy fields when a habit did the rest (the own-brain tier); default: `brain`."""
    t = TASKS[task]
    steps = len(t["fields"]) + len(t["fuzzy"])
    reason = "no habit yet"
    if habit:
        # Layer 1 — is the input familiar? Decided by code, before the habit runs at all.
        reason = fpm.check(inp, habit["in_fp"])
        if reason is None:
            # Layer 2 — the teacher's own guard, then the habit.
            res = run_habit(habit["code"], [inp])
            r = (res.get("results") or [{}])[0]
            if r.get("guard") is None and "output" in r and isinstance(r["output"], dict):
                # Layer 3 — does the answer look like an approved answer? Also code.
                reason = fpm.check(det(task, r["output"]), habit["out_fp"])
                if reason is None:
                    out, tokens = dict(r["output"]), 0
                    if do_fuzzy:
                        f, tokens = fuzzy_fields(own or brain, task, det(task, out))
                        out.update({k: f.get(k) for k in t["fuzzy"]})
                    return Result("habit", out, tokens, len(t["fields"]), steps)
                reason = f"answer check: {reason}"
            else:
                reason = r.get("guard") or r.get("error") or res.get("crash") or res.get("load_error") or "no output"
        else:
            reason = f"unfamiliar input: {reason}"
    if not call_big:
        return Result("fallback" if habit else "big", None, 0, 0, steps, reason)
    out, tokens, note = big_brain_answer(brain, task, inp)
    return Result("fallback" if habit else "big", out, tokens, 0, steps, reason, note)


@dataclass
class Compiled:
    code: str | None
    tokens: int
    attempts: int
    failures: list = field(default_factory=list)


TEACHER_SYSTEM = (
    "You turn an assistant's repeated, approved work into a HABIT: a small deterministic Python 3 "
    "module that produces exactly the approved outputs. Standard library only. No I/O, no network, "
    "no randomness, no reading the clock (dates come from the input)."
)


def _examples(traces: list[tuple[dict, dict]]) -> list[tuple[dict, dict]]:
    """Up to MAX_EXAMPLES, newest first — a fallback case that just arrived must be among them."""
    return list(reversed(traces))[:MAX_EXAMPLES]


def compile_habit(teacher, task: str, traces: list[tuple[dict, dict]], max_attempts: int = 2) -> Compiled:
    t = TASKS[task]
    shown = "\n\n".join(
        f"### Example {i + 1}\nInput:\n```json\n{json.dumps(inp)}\n```\nApproved output:\n```json\n{json.dumps(exp)}\n```"
        for i, (inp, exp) in enumerate(_examples(traces))
    )
    ask = (
        f"The user's rules for this job:\n{t['rules']}\n\n"
        f"Write a module defining exactly:\n"
        f"- `guard(inp: dict) -> str | None` — return None ONLY when the input has the same shape and the same "
        f"formats as the examples (keys, date and time formats, currency symbols, phrasings). Otherwise return a "
        f"short reason; a bigger model will handle it. When in doubt, return a reason. Never guess. Partial "
        f"understanding is not understanding: if any part of the text you parse is not fully accounted for by the "
        f"patterns you handle, return a reason.\n"
        f"- `run(inp: dict) -> dict` — return exactly the keys {t['fields']}, computed from the input, matching the "
        f"approved outputs exactly (types, order, rounding).\n\n{shown}\n\n"
        f"Reply with the whole module in one ```python block."
    )
    messages = [{"role": "system", "content": TEACHER_SYSTEM}, {"role": "user", "content": ask}]
    tokens, failures = 0, []
    for attempt in range(1, max_attempts + 1):
        r = teacher.chat(messages, purpose=f"night:{task}:compile", max_tokens=24000)
        tokens += r["total"]
        try:
            code = extract_python(r["text"])
        except ValueError:
            failures = [{"error": "no python block"}]
            messages += [{"role": "assistant", "content": r["text"]}, {"role": "user", "content": "Reply with the module in one ```python block."}]
            continue
        failures = gate(task, code, traces)
        if not failures:
            return Compiled(code, tokens, attempt)
        detail = "\n\n".join(
            f"Input:\n```json\n{json.dumps(f['input'])}\n```\nExpected:\n```json\n{json.dumps(f.get('expected'))}\n```\n"
            f"Got: {json.dumps(f.get('got'))}\nGuard: {f.get('guard')}\nError: {f.get('error')}"
            for f in failures[:3]
        )
        messages += [{"role": "assistant", "content": r["text"]},
                     {"role": "user", "content": f"The harness re-ran your habit on the approved cases and {len(failures)} failed. "
                                                 f"Fix it; every approved case must pass and the guard must accept each one.\n\n{detail}"}]
    return Compiled(None, tokens, max_attempts, failures)


def gate(task: str, code: str, traces: list[tuple[dict, dict]]) -> list[dict]:
    """The promotion gate: every approved case, re-run by the harness. Returns the failures."""
    res = run_habit(code, [inp for inp, _ in traces], timeout=60)
    if "results" not in res:
        return [{"input": traces[0][0], "expected": traces[0][1], "error": res.get("load_error") or res.get("crash")}]
    fails = []
    for (inp, exp), r in zip(traces, res["results"]):
        if r.get("guard") is not None:
            fails.append({"input": inp, "expected": exp, "guard": r["guard"]})
        elif "output" not in r or not same(task, r["output"], exp):
            fails.append({"input": inp, "expected": exp, "got": r.get("output"), "error": r.get("error")})
    return fails
