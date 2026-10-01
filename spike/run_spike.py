#!/usr/bin/env python3
"""The habit spike (PLAN 0.2): does an orb get cheaper and stay right as it forms habits?

For each task: 20 "days" (one fresh instance a day) go through the ladder, the user's approval is
simulated by the oracle, and each "night" the teacher compiles a habit from the approved cases,
which the harness re-runs before promoting it. Then held-out cases (never seen) and planted odd
cases (outside the family) go through the habit alone — no model calls — to measure coverage,
accuracy and whether a guard ever lets a wrong answer through.

The go/no-go (PLAN 0.2_t), all measured, never typed:
  G1  >= 60% of steps on habits over the last 5 days
  G2  habit output matches the approved output on >= 95% of the held-out cases it answered
      (and it answers some — a habit that never answers proves nothing)
  G3  tokens per run down >= 10x (mean of days 1-3 vs mean of the last 3 days)
  G4  0 wrong habit outputs on the planted odd inputs

  python3 run_spike.py                       # all three tasks, defaults below
  python3 run_spike.py --tasks calendar --days 8 --heldout 10 --odd 5
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from quiet import guard as ash_quiet_guard
from brain import Brain, BrainError, FreeChain
from fixtures import TASKS, instance
from harness import compile_habit, det, gate, ladder, make_habit, same

HERE = Path(__file__).resolve().parent
DOCS = HERE.parent / "docs"


def can_absorb(task: str, habit: dict | None, case: tuple[dict, dict]) -> bool:
    """True when the current habit already gets this approved case right (its own guard accepts it and its
    answer matches): then only the familiarity checks were in the way, and the case widens them for free."""
    return habit is not None and not gate(task, habit["code"], [case])


def run_task(task, brain, teacher, a, out: Path, own=None) -> dict:
    traces, habit, days, nights = [], None, [], []
    (out / "habits").mkdir(parents=True, exist_ok=True)
    for day in range(1, a.days + 1):
        inp, exp = instance(task, a.seed, day)
        try:
            r = ladder(brain, task, inp, habit, own=own)
        except BrainError as e:
            # The big brain is unreachable: the job would be queued and retried, never answered by
            # guesswork. The day is recorded as skipped and kept out of every metric.
            days.append({"day": day, "skipped": True, "reason": str(e)[:160]})
            print(f"  [{task}] day {day:2d}: SKIPPED — big brain unreachable", flush=True)
            continue
        ok = same(task, r.output, exp)
        days.append({"day": day, "route": r.route, "correct": ok, "tokens": r.tokens,
                     "habit_steps": r.habit_steps, "steps": r.steps, "reason": r.reason[:160], "note": r.note})
        if not ok:
            with (out / "diffs.jsonl").open("a") as f:
                f.write(json.dumps({"task": task, "day": day, "route": r.route, "note": r.note,
                                    "got": det(task, r.output) if r.output else None, "expected": exp}) + "\n")
        print(f"  [{task}] day {day:2d}: {r.route:8s} {'ok ' if ok else 'BAD'} {r.tokens:6d} tok" +
              (f"  ({r.reason[:70]})" if r.route != "habit" and habit else ""), flush=True)
        traces.append((inp, exp))
        if r.route != "habit" and can_absorb(task, habit, (inp, exp)):
            # The habit itself gets this approved case right: only its familiarity checks were in the
            # way. Absorb the case into the evidence (fingerprints re-learned) with no teacher call.
            habit = make_habit(habit["code"], traces)
            nights.append({"after_day": day, "promoted": False, "absorbed": True, "attempts": 0, "tokens": 0, "failures": 0})
            print(f"  [{task}] night {day:2d}: absorbed — the habit already handles it; familiarity widened, 0 tok", flush=True)
            continue
        if len(traces) >= a.min_traces and (habit is None or r.route != "habit" or not ok):
            try:
                c = compile_habit(teacher, task, traces)
            except BrainError as e:
                # The gym's teacher being unreachable skips a night; it never stops the day.
                nights.append({"after_day": day, "promoted": False, "attempts": 0, "tokens": 0, "failures": 0,
                               "error": str(e)[:200]})
                print(f"  [{task}] night {day:2d}: SKIPPED — teacher unreachable ({str(e)[:80]})", flush=True)
                continue
            nights.append({"after_day": day, "promoted": c.code is not None, "attempts": c.attempts,
                           "tokens": c.tokens, "failures": len(c.failures)})
            print(f"  [{task}] night {day:2d}: {'PROMOTED' if c.code else 'not promoted'} "
                  f"({c.attempts} attempt(s), {c.tokens} tok, {len(c.failures)} failing)", flush=True)
            if c.code:
                habit = make_habit(c.code, traces)
                (out / "habits" / f"{task}-night{day:02d}.py").write_text(c.code)

    held = []
    for i in range(1, a.heldout + 1):
        inp, exp = instance(task, a.seed, 1000 + i)
        r = ladder(brain, task, inp, habit, do_fuzzy=False, call_big=False)
        held.append({"route": r.route, "correct": r.route == "habit" and same(task, r.output, exp)})
    odd = []
    for j in range(1, a.odd + 1):
        inp, exp = instance(task, a.seed, j, odd=True)
        r = ladder(brain, task, inp, habit, do_fuzzy=False, call_big=False)
        wrong = r.route == "habit" and (exp is None or not same(task, r.output, exp))
        odd.append({"route": r.route, "wrong": wrong, "reason": r.reason[:160]})
        print(f"  [{task}] odd {j}: {r.route:8s} {'WRONG' if wrong else 'ok'}  {r.reason[:90]}", flush=True)
    return {"days": days, "nights": nights, "heldout": held, "odd": odd, "final_habit": bool(habit)}


def metrics(task: str, r: dict) -> dict:
    days = [d for d in r["days"] if not d.get("skipped")]
    last5 = days[-5:]
    mean = lambda xs: sum(xs) / len(xs) if xs else 0.0  # noqa: E731
    first3 = mean([d["tokens"] for d in days[:3]])
    last3 = mean([d["tokens"] for d in days[-3:]])
    answered = [h for h in r["heldout"] if h["route"] == "habit"]
    bigs = [d for d in days if d["route"] != "habit"]
    m = {
        "steps_on_habits_last5": sum(d["habit_steps"] for d in last5) / max(1, sum(d["steps"] for d in last5)),
        "tokens_first3": round(first3), "tokens_last3": round(last3),
        "token_ratio": (first3 / last3) if last3 else float("inf") if first3 else 0.0,
        "heldout_coverage": len(answered) / max(1, len(r["heldout"])),
        "heldout_accuracy": (sum(h["correct"] for h in answered) / len(answered)) if answered else None,
        "odd_answered": sum(o["route"] == "habit" for o in r["odd"]),
        "odd_wrong": sum(o["wrong"] for o in r["odd"]),
        "training_wrong_habit": sum(d["route"] == "habit" and not d["correct"] for d in days),
        "big_brain_accuracy": (sum(d["correct"] for d in bigs) / len(bigs)) if bigs else None,
        "night_tokens": sum(n["tokens"] for n in r["nights"]),
        "promotions": sum(n["promoted"] for n in r["nights"]),
        "first_promotion_day": next((n["after_day"] for n in r["nights"] if n["promoted"]), None),
    }
    big_costs = [d["tokens"] for d in days if d["route"] != "habit"]
    last5_mean = mean([d["tokens"] for d in last5])
    m["token_ratio_robust"] = (mean(big_costs) / last5_mean) if last5_mean else (float("inf") if big_costs else 0.0)
    m["G3_robust"] = m["token_ratio_robust"] >= 10   # reported only; the owner decides whether it replaces G3
    m["absorbed"] = sum(1 for n in r["nights"] if n.get("absorbed"))
    m["G1"] = m["steps_on_habits_last5"] >= 0.60
    m["G2"] = m["heldout_accuracy"] is not None and m["heldout_accuracy"] >= 0.95
    m["G3"] = m["token_ratio"] >= 10
    m["G4"] = m["odd_wrong"] == 0
    return m


def report(results: dict, args, out: Path) -> str:
    pct = lambda x: "—" if x is None else f"{100 * x:.0f}%"  # noqa: E731
    yn = lambda b: "**PASS**" if b else "**FAIL**"  # noqa: E731
    lines = [
        "# Habit spike — results (generated)",
        "",
        f"Generated by `spike/run_spike.py` from `{out.relative_to(HERE.parent)}`. Do not edit by hand.",
        f"Big brain `{args.model}`, teacher `{args.teacher}`, own brain `{args.own}` (free seats, router fallbacks disabled); "
        f"{args.days} days, {args.heldout} held-out and {args.odd} odd cases per task, seed {args.seed}.",
        "",
        "| Task | G1 steps on habits (last 5 days) | G2 held-out accuracy (coverage) | G3 tokens/run first 3 → last 3 | G4 wrong habit answers on odd inputs |",
        "|---|---|---|---|---|",
    ]
    allpass = True
    for task, r in results.items():
        m = r["metrics"]
        allpass &= all(m[g] for g in ("G1", "G2", "G3", "G4"))
        ratio = "∞" if m["token_ratio"] == float("inf") else f"{m['token_ratio']:.1f}×"
        lines.append(
            f"| {task} | {pct(m['steps_on_habits_last5'])} {yn(m['G1'])} | {pct(m['heldout_accuracy'])} "
            f"({pct(m['heldout_coverage'])} answered) {yn(m['G2'])} | {m['tokens_first3']} → {m['tokens_last3']} "
            f"({ratio}) {yn(m['G3'])} | {m['odd_wrong']} of {m['odd_answered']} answered "
            f"({len(r['odd'])} planted) {yn(m['G4'])} |"
        )
    lines += ["", f"**Go/no-go: {'GO' if allpass else 'NO-GO'}**", "", "## Detail", ""]
    for task, r in results.items():
        m = r["metrics"]
        lines += [
            f"### {task}",
            "",
            f"- first habit promoted after night {m['first_promotion_day']}; {m['promotions']} promotion(s); "
            f"teaching cost {m['night_tokens']} tokens",
            f"- big brain's own accuracy on the days it answered: {pct(m['big_brain_accuracy'])} "
            f"(the approval corrected the rest)",
            f"- wrong habit answers during training: {m['training_wrong_habit']}",
            "- days: " + " ".join(f"{d['day']}:skipped" if d.get("skipped") else f"{d['day']}:{d['route'][0]}{'' if d['correct'] else '✗'}"
                                  for d in r["days"]),
            "",
        ]
    lines += ["`h` = habit answered, `b` = big brain (no habit yet), `f` = fallback (the guard handed it back); ✗ = differed from the approved output.", ""]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tasks", default="inbox,invoice,calendar")
    ap.add_argument("--days", type=int, default=20)
    ap.add_argument("--heldout", type=int, default=30)
    ap.add_argument("--odd", type=int, default=10)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--min-traces", type=int, default=3)
    ap.add_argument("--model", default="bedrock-brain")
    ap.add_argument("--teacher", default="think-brain,nim-ultra", help="free seats, tried in order")
    ap.add_argument("--own", default="free-flash25", help="the own-brain stand-in for fuzzy fields (a cheap cloud seat)")
    ap.add_argument("--force", action="store_true", help="start even inside Ash's gym window")
    a = ap.parse_args()

    ash_quiet_guard(a.force)
    out = HERE / "runs" / f"{time.strftime('%Y%m%d-%H%M%S')}-s{a.seed}"   # seed in the name: parallel runs never collide
    out.mkdir(parents=True)
    ledger = out / "calls.jsonl"
    brain = Brain(a.model, ledger)
    teacher = FreeChain([Brain(m, ledger) for m in a.teacher.split(",")])
    results = {}
    for task in a.tasks.split(","):
        print(f"== {task}", flush=True)
        r = run_task(task, brain, teacher, a, out, own=Brain(a.own, ledger))
        r["metrics"] = metrics(task, r)
        results[task] = r
        (out / "results.json").write_text(json.dumps(results, indent=1))
    doc = report(results, a, out)
    (out / "report.md").write_text(doc)
    DOCS.mkdir(exist_ok=True)
    (DOCS / "spike-results.md").write_text(doc)
    print("\n" + doc)
    return 0


if __name__ == "__main__":
    sys.exit(main())
