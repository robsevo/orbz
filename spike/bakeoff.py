#!/usr/bin/env python3
"""Brain bake-off (PLAN 0.3), cloud seats only (owner, 2026-09-30: never the RX 580; no local models yet).

Which of the free cloud seats we have is best at each job on the ladder, measured as RATES:

  big      does the whole task from the rules              (k cases per task)
  teacher  writes a habit that passes the harness's gate   (k compiles per task, then the habit is
           run on held-out and odd cases with no model calls — a promoted habit has to be right too)
  own      a cheap seat doing the task from a PLAYBOOK — the rules plus a few approved examples — the
           cloud stand-in for the own-brain tier until a local model is allowed

Every seat is free and called with router fallbacks disabled. A seat that errors (503, timeout)
is counted as unavailable for that case, never as a wrong answer, and both rates are reported.
The defaults the setup wizard will offer are GENERATED from the results (0.3_t), never typed.

  python3 bakeoff.py                                    # everything below
  python3 bakeoff.py --roles big --tasks calendar --k 2 # a quick look
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from quiet import guard as ash_quiet_guard
from brain import Brain, BrainError, extract_json
from fixtures import SCHEMAS, TASKS, instance
from harness import SYSTEM, big_brain_answer, compile_habit, ladder, make_habit, same

HERE = Path(__file__).resolve().parent
DOCS = HERE.parent / "docs"
SEED = 11  # separate from the spike's seed 7

ROLES = {
    "big": ["bedrock-brain", "cloud-brain", "free-flash3", "nim-ultra", "free-coder"],
    "teacher": ["think-brain", "cloud-brain", "nim-ultra"],
    "own": ["free-flash25", "free-flash"],
}


class Recorder:
    """Keeps every call's record (tokens, latency) so the bake-off can report means per seat."""

    def __init__(self, brain):
        self.brain, self.calls, self.model = brain, [], brain.model

    def chat(self, messages, purpose, max_tokens=8000):
        r = self.brain.chat(messages, purpose, max_tokens)
        self.calls.append(r)
        return r


def playbook_answer(brain, task: str, inp: dict, examples: list[tuple[dict, dict]]) -> tuple[dict | None, str]:
    """The own-brain tier's job: the rules plus approved examples, and nothing else."""
    t = TASKS[task]
    shown = "\n\n".join(f"Input:\n```json\n{json.dumps(i)}\n```\nApproved answer:\n```json\n{json.dumps(e)}\n```" for i, e in examples)
    msg = (f"{t['rules']}\n\nHere is how this user wants it done — approved past answers:\n\n{shown}\n\n"
           f"Now do the same for this input. Reply with ONE JSON object with exactly the keys {t['fields']} "
           f"(same shape as the approved answers; shape reference: {SCHEMAS[task]}).\n\nInput:\n```json\n{json.dumps(inp)}\n```")
    r = brain.chat([{"role": "system", "content": SYSTEM}, {"role": "user", "content": msg}], purpose=f"bake:{task}:own", max_tokens=16000)
    try:
        out = extract_json(r["text"])
    except (ValueError, json.JSONDecodeError):
        return None, "truncated" if r.get("finish") == "length" else "unparseable"
    if not isinstance(out, dict) or not set(t["fields"]) <= set(out):
        return None, "truncated" if r.get("finish") == "length" else "missing keys"
    return out, ""


def run_big(seat, task, k, ledger):
    rows = []
    for i in range(1, k + 1):
        inp, exp = instance(task, SEED, 500 + i)
        rec = Recorder(Brain(seat, ledger))
        try:
            out, _, note = big_brain_answer(rec, task, inp)
            rows.append({"ok": same(task, out, exp), "error": None, "note": note,
                         "tokens": sum(c["total"] for c in rec.calls), "latency": sum(c["latency_s"] for c in rec.calls)})
        except BrainError as e:
            rows.append({"ok": False, "error": str(e)[:160], "note": "", "tokens": 0, "latency": 0})
        print(f"    big     {seat:13s} {task:8s} case {i}: {'ok ' if rows[-1]['ok'] else 'ERR' if rows[-1]['error'] else 'BAD'}"
              f" {rows[-1]['tokens']:6d} tok {rows[-1]['latency']:6.1f}s {rows[-1]['note']}", flush=True)
    return rows


def run_own(seat, task, k, ledger):
    examples = [instance(task, SEED, 600 + j) for j in range(1, 4)]
    rows = []
    for i in range(1, k + 1):
        inp, exp = instance(task, SEED, 500 + i)
        rec = Recorder(Brain(seat, ledger))
        try:
            out, note = playbook_answer(rec, task, inp, examples)
            rows.append({"ok": same(task, out, exp), "error": None, "note": note,
                         "tokens": sum(c["total"] for c in rec.calls), "latency": sum(c["latency_s"] for c in rec.calls)})
        except BrainError as e:
            rows.append({"ok": False, "error": str(e)[:160], "note": "", "tokens": 0, "latency": 0})
        print(f"    own     {seat:13s} {task:8s} case {i}: {'ok ' if rows[-1]['ok'] else 'ERR' if rows[-1]['error'] else 'BAD'}"
              f" {rows[-1]['tokens']:6d} tok {rows[-1]['latency']:6.1f}s {rows[-1]['note']}", flush=True)
    return rows


def run_teacher(seat, task, k, ledger, heldout=20, odd=10):
    rows = []
    for i in range(1, k + 1):
        traces = [instance(task, SEED, 700 + 10 * i + j) for j in range(6)]
        rec = Recorder(Brain(seat, ledger))
        try:
            c = compile_habit(rec, task, traces)
        except BrainError as e:
            rows.append({"ok": False, "error": str(e)[:160], "attempts": 0, "tokens": sum(x["total"] for x in rec.calls),
                         "latency": sum(x["latency_s"] for x in rec.calls), "coverage": None, "accuracy": None, "odd_wrong": None})
            print(f"    teacher {seat:13s} {task:8s} compile {i}: ERR {rows[-1]['error'][:60]}", flush=True)
            continue
        row = {"ok": c.code is not None, "error": None, "attempts": c.attempts, "tokens": c.tokens,
               "latency": sum(x["latency_s"] for x in rec.calls), "coverage": None, "accuracy": None, "odd_wrong": None}
        if c.code:
            habit = make_habit(c.code, traces)
            held = [ladder(None, task, inst[0], habit, do_fuzzy=False, call_big=False) for inst in
                    (instance(task, SEED, 900 + h) for h in range(1, heldout + 1))]
            exps = [instance(task, SEED, 900 + h)[1] for h in range(1, heldout + 1)]
            answered = [(r, e) for r, e in zip(held, exps) if r.route == "habit"]
            row["coverage"] = len(answered) / heldout
            row["accuracy"] = (sum(same(task, r.output, e) for r, e in answered) / len(answered)) if answered else None
            wrong = 0
            for j in range(1, odd + 1):
                inp, exp = instance(task, SEED, j, odd=True)
                r = ladder(None, task, inp, habit, do_fuzzy=False, call_big=False)
                wrong += r.route == "habit" and (exp is None or not same(task, r.output, exp))
            row["odd_wrong"] = wrong
        rows.append(row)
        print(f"    teacher {seat:13s} {task:8s} compile {i}: {'PROMOTED' if row['ok'] else 'rejected'} "
              f"({row['attempts']} att, {row['tokens']} tok, {row['latency']:.0f}s) coverage={row['coverage']} "
              f"accuracy={row['accuracy']} odd_wrong={row['odd_wrong']}", flush=True)
    return rows


def summarize(rows: list[dict]) -> dict:
    n = len(rows)
    avail = [r for r in rows if not r["error"]]
    mean = lambda xs: (sum(xs) / len(xs)) if xs else None  # noqa: E731
    s = {"n": n, "available": len(avail) / n if n else 0.0,
         "rate": (sum(r["ok"] for r in avail) / len(avail)) if avail else None,
         "tokens": mean([r["tokens"] for r in avail]), "latency": mean([r["latency"] for r in avail])}
    if rows and "coverage" in rows[0]:
        good = [r for r in avail if r["ok"]]
        s["coverage"] = mean([r["coverage"] for r in good if r["coverage"] is not None])
        s["accuracy"] = mean([r["accuracy"] for r in good if r["accuracy"] is not None])
        s["odd_wrong"] = sum(r["odd_wrong"] or 0 for r in good)
    return s


def pick_defaults(summary: dict) -> dict:
    """The wizard's defaults, generated: per role, the seat with the best rate across tasks (it must be
    measured on every task the role was measured on, and available on every case it was asked), ties
    broken by fewer tokens, then lower latency. A teacher whose habits ever answered an odd case
    wrongly can never be the default."""
    picks = {}
    for role, seats in summary.items():
        best = None
        everything = set().union(*(set(t) for t in seats.values())) if seats else set()
        for seat, tasks in seats.items():
            vals = list(tasks.values())
            # A seat measured on only some tasks cannot win on its average: partial data flatters it.
            if set(tasks) != everything:
                continue
            if not vals or any(v["available"] < 1.0 or v["rate"] is None for v in vals):
                continue
            if role == "teacher" and any((v.get("odd_wrong") or 0) > 0 for v in vals):
                continue
            rate = sum(v["rate"] for v in vals) / len(vals)
            tok = sum(v["tokens"] or 0 for v in vals) / len(vals)
            lat = sum(v["latency"] or 0 for v in vals) / len(vals)
            key = (-rate, tok, lat)
            if best is None or key < best[0]:
                best = (key, seat, rate)
        picks[role] = {"seat": best[1], "rate": round(best[2], 3)} if best else None
    return picks


def report(summary, picks, args, out) -> str:
    pct = lambda x: "—" if x is None else f"{100 * x:.0f}%"  # noqa: E731
    num = lambda x: "—" if x is None else f"{x:,.0f}"  # noqa: E731
    lines = ["# Brain bake-off — results (generated)", "",
             f"Generated by `spike/bakeoff.py` from `{out.relative_to(HERE.parent)}`. Cloud seats only (owner, 2026-09-30); "
             f"all free, router fallbacks disabled; k={args.k} per task per seat, seed {SEED}.", ""]
    names = {"big": "Big brain — does the whole task", "teacher": "Teacher — writes habits that must pass the gate",
             "own": "Own brain (cloud stand-in) — the task from a playbook of approved examples"}
    for role, seats in summary.items():
        lines += [f"## {names[role]}", ""]
        if role == "teacher":
            lines += ["| Seat | Task | Promoted | Habit held-out accuracy (coverage) | Odd answered wrongly | Tokens | Seconds | Available |",
                      "|---|---|---|---|---|---|---|---|"]
            for seat, tasks in seats.items():
                for task, v in tasks.items():
                    lines.append(f"| `{seat}` | {task} | {pct(v['rate'])} | {pct(v.get('accuracy'))} ({pct(v.get('coverage'))}) | "
                                 f"{v.get('odd_wrong', '—')} | {num(v['tokens'])} | {num(v['latency'])} | {pct(v['available'])} |")
        else:
            lines += ["| Seat | Task | Right | Tokens | Seconds | Available |", "|---|---|---|---|---|---|"]
            for seat, tasks in seats.items():
                for task, v in tasks.items():
                    lines.append(f"| `{seat}` | {task} | {pct(v['rate'])} | {num(v['tokens'])} | {num(v['latency'])} | {pct(v['available'])} |")
        lines.append("")
    lines += ["## Defaults the wizard will offer (generated from the table above)", ""]
    for role, p in picks.items():
        lines.append(f"- **{role}**: " + (f"`{p['seat']}` ({pct(p['rate'])} right on average)" if p else "no seat qualified"))
    lines += ["", "A seat qualifies only if it answered every case it was asked (no errors); a teacher only if none of",
              "its promoted habits ever answered an odd case wrongly.", ""]
    return "\n".join(lines)


def merge(dirs: list[Path], args) -> int:
    """Several bake-off jobs → one summary, one report, the defaults. A seat measured twice is an error."""
    summary: dict = {}
    drop = set(getattr(args, "drop", []) or [])
    dropped = []
    for d in dirs:
        part = json.loads((d / "results.json").read_text())["summary"]
        for role, seats in part.items():
            for seat, tasks in seats.items():
                if f"{role}/{seat}" in drop:
                    dropped.append(f"{role}/{seat} from {d.name}")
                    continue
                if seat in summary.get(role, {}):
                    raise SystemExit(f"merge: {role}/{seat} appears in two runs — refusing to pick one silently")
                summary.setdefault(role, {})[seat] = tasks
    picks = pick_defaults(summary)
    partial = getattr(args, "partial", "")
    if partial:
        picks = {"partial": True, "still_to_measure": partial, **picks}
    base = HERE / "runs" / f"bakeoff-merged-{time.strftime('%Y%m%d-%H%M%S')}"
    out, n = base, 1
    while out.exists():          # two merges in one second must not collide
        n += 1
        out = base.with_name(f"{base.name}-{n}")
    out.mkdir(parents=True)
    (out / "sources.txt").write_text("\n".join(str(d) for d in dirs) + "\n")
    (out / "results.json").write_text(json.dumps({"summary": summary}, indent=1))
    doc = report(summary, {k: v for k, v in picks.items() if k in ROLES}, args, out)
    if dropped:
        doc += "\nLeft out of this merge on purpose (stale or superseded): " + "; ".join(dropped) + ".\n"
    if partial:
        doc = doc.replace("# Brain bake-off — results (generated)",
                          "# Brain bake-off — results (generated) — PARTIAL\n\n> **Not final.** Still to measure: " + partial, 1)
    (out / "report.md").write_text(doc)
    (DOCS / "bakeoff-results.md").write_text(doc)
    (DOCS / "bakeoff-defaults.json").write_text(json.dumps(picks, indent=1))
    print(doc)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--roles", default="big,teacher,own")
    ap.add_argument("--tasks", default="inbox,invoice,calendar")
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--k-teacher", type=int, default=3)
    ap.add_argument("--seats", default="", help="only these seats (comma list), for splitting a bake-off into jobs")
    ap.add_argument("--merge", nargs="+", type=Path, help="combine finished bake-off runs into one report and the defaults")
    ap.add_argument("--partial", default="", help="with --merge: a banner saying what is still unmeasured (defaults marked partial)")
    ap.add_argument("--drop", nargs="*", default=[], help="with --merge: ROLE/SEAT entries to leave out (stale or superseded), recorded in the report")
    ap.add_argument("--force", action="store_true", help="start even inside Ash's gym window")
    a = ap.parse_args()
    if a.merge:
        return merge(a.merge, a)
    ash_quiet_guard(a.force)
    only = {x for x in a.seats.split(",") if x}
    tag = "-".join([a.roles.replace(",", "+")] + sorted(only))[:60]
    out = HERE / "runs" / f"bakeoff-{time.strftime('%Y%m%d-%H%M%S')}-{tag}"
    out.mkdir(parents=True)
    ledger = out / "calls.jsonl"
    summary: dict = {}
    raw: dict = {}
    for role in a.roles.split(","):
        print(f"== {role}", flush=True)
        for seat in [x for x in ROLES[role] if not only or x in only]:
            for task in a.tasks.split(","):
                if role == "big":
                    rows = run_big(seat, task, a.k, ledger)
                elif role == "own":
                    rows = run_own(seat, task, a.k, ledger)
                else:
                    rows = run_teacher(seat, task, a.k_teacher, ledger)
                raw.setdefault(role, {}).setdefault(seat, {})[task] = rows
                summary.setdefault(role, {}).setdefault(seat, {})[task] = summarize(rows)
                (out / "results.json").write_text(json.dumps({"summary": summary, "raw": raw}, indent=1))
    picks = pick_defaults(summary)
    (out / "defaults.json").write_text(json.dumps(picks, indent=1))
    doc = report(summary, picks, a, out)
    (out / "report.md").write_text(doc)
    DOCS.mkdir(exist_ok=True)
    (DOCS / "bakeoff-results.md").write_text(doc)
    (DOCS / "bakeoff-defaults.json").write_text(json.dumps(picks, indent=1))
    print("\n" + doc)
    return 0


if __name__ == "__main__":
    sys.exit(main())
