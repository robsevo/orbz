"""School (PLAN 5.7): the exams the kit grades by code.

`speech(text)` measures plain spoken English, ASD-STE100 at about 80% (Andrej Karpathy's tip,
10-03). Each sentence is held to the spec's lengths (an instruction 20 words, any other 25), its
plain words (voicebox's PLAIN: one of the hard words costs the sentence), active voice, and one
instruction a sentence. The score is the share of sentences that keep every rule, with the ones
that broke a rule and why, so a report card can say so. What code cannot measure (did the answer
say what was asked) is the teacher's rubric, in the home.

`cpp(code, tests)` compiles a C++ program (C++17) and runs it on each test's input inside the habit
sandbox (habits.py: bubblewrap, no network, a read-only root, an empty /home, a private /tmp, CPU
and memory limits, a timeout). A test passes when the program exits 0 and prints the expected
output, whitespace aside.
"""
from __future__ import annotations

import re
import shutil

from . import habits
from .voicebox import PLAIN

INSTRUCTION_WORDS = 20
OTHER_WORDS = 25

_HARD = [(re.compile(rf"(?<![\w-]){re.escape(a)}(?![\w-])", re.I), a) for a, _ in PLAIN]
# a form of "be" and a past participle: "is sent", "was quickly fixed"
_IRREGULAR = set(("done made sent set put kept left built bought brought caught taught thought found held known shown given "
                  "taken written seen chosen broken spoken stolen forgotten hidden driven eaten fallen grown thrown worn sold "
                  "told paid said read run cut hit lost meant met won begun drawn").split())
# words in -ed that follow "is" as adjectives, not as a passive
_NOT_PASSIVE = {"tired", "interested", "excited", "worried", "scared", "bored", "based", "supposed", "used", "married",
                "pleased", "surprised", "prepared", "concerned", "involved", "related", "limited", "detailed", "advanced",
                "need", "red", "bed", "shed", "seed", "feed", "speed", "hundred", "naked", "wicked", "sacred", "ashamed",
                "allowed", "done"}
_BE = re.compile(r"\b(?:am|is|are|was|were|be|been|being)\s+(?:\w+ly\s+)?([a-z']+)\b", re.I)
# what an instruction starts with (after "Please", "First," and the like)
_VERBS = set(("open click tap press go select choose type enter turn check make find put take keep use set save close "
              "restart wait ask tell write read send add remove delete copy paste move plug unplug hold look try call "
              "pick follow sign log install update back connect charge switch drag scroll start stop give let do don't "
              "never always fill drink eat sleep breathe remember note change reset create share print run unlock lock").split())
_AND_VERBS = _VERBS - {"back"}  # "turn it off and back on" is one instruction
_LEAD = re.compile(r"^(?:please|first|then|next|now|finally|after that|to start|also|and)\b[,]?\s*", re.I)
_WORD = re.compile(r"[A-Za-z0-9']+")


def _sentences(text: str) -> list[str]:
    out = []
    for line in text.split("\n"):
        line = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", line).strip()  # a list item is a sentence
        out += [s.strip() for s in re.split(r"(?<=[.!?])\s+", line) if _WORD.search(s)]
    return out


def _instruction(words: list[str]) -> bool:
    return bool(words) and words[0].lower() in _VERBS


def _passive(sentence: str) -> str | None:
    for m in _BE.finditer(sentence):
        w = m.group(1).lower()
        if w in _NOT_PASSIVE:
            continue
        if w in _IRREGULAR or (w.endswith("ed") and len(w) >= 4):
            return m.group(0)
    return None


def _instructions(sentence: str) -> int:
    """How many instructions one sentence gives: the first, and each "and <verb>", ", then <verb>",
    "; <verb>" after it."""
    n = 1
    for m in re.finditer(r"(?:\band\b(?:\s+then)?|,\s*then\b|;|,)\s+([A-Za-z']+)", sentence):
        if m.group(1).lower() in _AND_VERBS:
            n += 1
    return n


def speech(text: str) -> dict:
    """Plain spoken English, by code: {score, sentences, broke: [{sentence, why: [...]}]}."""
    sentences = _sentences(text)
    broke = []
    for s in sentences:
        words = _WORD.findall(_LEAD.sub("", s))
        instruction = _instruction(words)
        limit = INSTRUCTION_WORDS if instruction else OTHER_WORDS
        why = []
        if len(_WORD.findall(s)) > limit:
            why.append(f"{len(_WORD.findall(s))} words, over {limit}")
        hard = [a for r, a in _HARD if r.search(s)]
        if hard:
            why.append("a hard word: " + ", ".join(hard))
        passive = _passive(s)
        if passive:
            why.append(f"passive: {passive}")
        if instruction and _instructions(s) > 1:
            why.append(f"{_instructions(s)} instructions in one sentence")
        if why:
            broke.append({"sentence": s[:240], "why": why})
    n = len(sentences)
    return {"score": round((n - len(broke)) / n, 4) if n else 0.0, "sentences": n, "broke": broke}


CPP_RUNNER = r'''
import json, os, resource, subprocess, sys
p = json.loads(sys.stdin.read())
env = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"}
def limits(mem, cpu):
    def set_():
        resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
    return set_
os.makedirs("/tmp/w", exist_ok=True)
try:
    c = subprocess.run([p["gxx"], "-std=c++17", "-O1", "-o", "/tmp/w/prog", "/tmp/habit/main.cpp"], capture_output=True, text=True,
                       timeout=p["compile_s"], env=env, preexec_fn=limits(1 << 30, int(p["compile_s"])))
except subprocess.TimeoutExpired:
    print(json.dumps({"compiled": False, "error": "it took too long to compile", "results": []}))
    sys.exit(0)
if c.returncode != 0:
    print(json.dumps({"compiled": False, "error": c.stderr[-1200:], "results": []}))
    sys.exit(0)
out = []
for t in p["tests"]:
    try:
        r = subprocess.run(["/tmp/w/prog"], input=t["input"], capture_output=True, text=True, timeout=p["run_s"], env=env,
                           preexec_fn=limits(256 << 20, p["cpu_s"]))
        out.append({"ok": r.returncode == 0 and r.stdout.split() == t["output"].split(), "got": r.stdout[-300:], "exit": r.returncode})
    except subprocess.TimeoutExpired:
        out.append({"ok": False, "got": "", "exit": None, "why": "it ran past its time"})
print(json.dumps({"compiled": True, "error": "", "results": out}))
'''


def cpp(code: str, tests: list[dict], run_s: float = 2.0, compile_s: float = 20.0) -> dict:
    """A C++ program compiled and run on each test inside the sandbox: {compiled, error, passed, results}."""
    gxx = shutil.which("g++") or shutil.which("clang++")
    if not gxx:
        return {"compiled": False, "error": "no C++ compiler on this machine", "passed": 0, "results": []}
    payload = {"gxx": gxx, "run_s": run_s, "compile_s": compile_s, "cpu_s": max(1, int(run_s) + 1),
               "tests": [{"input": str(t.get("input", "")), "output": str(t.get("output", ""))} for t in tests]}
    r, failed = habits._sandboxed(code, CPP_RUNNER, payload, compile_s + run_s * len(tests) + 10, file="main.cpp", what="the program")
    if failed:
        return {"compiled": False, "error": failed, "passed": 0, "results": []}
    results = list(r.get("results", []))
    return {"compiled": bool(r.get("compiled")), "error": str(r.get("error", "")), "passed": sum(1 for x in results if x.get("ok")), "results": results}
