#!/usr/bin/env python3
"""School's exams graded by code (PLAN 5.7_t): orbs_kit/school.py.

  SC.1 plain spoken English measured sentence by sentence: an instruction held to 20 words and any
       other sentence to 25, the spec's hard words, passive voice, one instruction a sentence; plain
       instructions keep every rule
  SC.2 a C++ program compiled and run on its tests inside the habit sandbox: a right one passes, a
       wrong one fails with what it printed, one that does not compile says why, a loop runs out of
       its time while the other tests still run, and nothing it writes or sends leaves the sandbox"""
import shutil
import sys
import tempfile
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT))
from orbs_kit import habits, school  # noqa: E402

FAIL = []


def ok(cond, label):
    print(f"{'PASS' if cond else 'FAIL'}  {label}")
    if not cond:
        FAIL.append(label)


# ── SC.1 plain spoken English ──────────────────────────────────────────────────────────────────────
g = school.speech("Open Settings.\nTap Backup.\n- Turn on the switch.\nYour phone keeps a copy each night.")
ok(g == {"score": 1.0, "sentences": 4, "broke": []}, f"SC.1 plain instructions keep every rule: {g}")

g = school.speech(
    "Utilize the blue button. "
    "Open Settings and tap Backup. "
    "Your photos are sent to the cloud every night. "
    "This is a very long sentence that goes on and on with many words in it so that it is longer than the spec allows for a sentence. "
    "Your phone keeps a copy. Turn it off and back on."
)
why = {b["sentence"].split()[0]: b["why"] for b in g["broke"]}
ok(g["sentences"] == 6, f"SC.1 six sentences: {g['sentences']}")
ok(why == {"Utilize": ["a hard word: utilize"], "Open": ["2 instructions in one sentence"], "Your": ["passive: are sent"], "This": ["28 words, over 25"]},
   f"SC.1 each rule on its own sentence: {why}")
ok(g["score"] == round(2 / 6, 4), f"SC.1 the share that kept every rule: {g['score']}")
words = " ".join(["the"] * 19)
ok(school.speech(f"Press {words} button.")["broke"][0]["why"] == ["21 words, over 20"], "SC.1 an instruction is held to 20 words")
ok(school.speech(f"It is {words} button.")["broke"] == [], "SC.1 CONTROL: any other sentence to 25")
ok(school.speech("")["score"] == 0.0, "SC.1 nothing said scores nothing")

# ── SC.2 C++ in the sandbox ────────────────────────────────────────────────────────────────────────
if habits.sandbox() is None or not (shutil.which("g++") or shutil.which("clang++")):
    print("SKIP  SC.2 no habit sandbox or no C++ compiler on this machine")
else:
    SUM = '#include <iostream>\nint main(){long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}\n'
    tests = [{"input": "2 3", "output": "5"}, {"input": "-4 10\n", "output": "6\n"}]
    ok(school.cpp(SUM, tests)["passed"] == 2, "SC.2 a right program passes its tests")
    g = school.cpp(SUM.replace("a+b", "a-b"), tests)
    ok(g["compiled"] and g["passed"] == 0 and [r["got"].strip() for r in g["results"]] == ["-1", "-14"], f"SC.2 a wrong one fails, with what it printed: {g['results']}")
    g = school.cpp("int main( {", [{"input": "", "output": ""}])
    ok(not g["compiled"] and g["passed"] == 0 and "error" in g["error"], f"SC.2 what does not compile says why: {g['error'][:80]!r}")
    loop = '#include <iostream>\nint main(){int n;std::cin>>n;if(n==0){for(;;){}}std::cout<<n;}\n'
    g = school.cpp(loop, [{"input": "0", "output": ""}, {"input": "7", "output": "7"}], run_s=1.0)
    ok([r["ok"] for r in g["results"]] == [False, True] and g["results"][0].get("why") == "it ran past its time", f"SC.2 a loop runs out of time, the next test still runs: {g['results']}")
    with tempfile.TemporaryDirectory() as d:
        target = Path(d) / "escaped"
        school.cpp(f'#include <fstream>\nint main(){{std::ofstream f("{target}");f<<"x";}}\n', [{"input": "", "output": ""}])
        ok(not target.exists(), "SC.2 a write never lands outside the sandbox's own /tmp")
    net = ("#include <sys/socket.h>\n#include <netinet/in.h>\n#include <arpa/inet.h>\n#include <iostream>\n"
           "int main(){int s=socket(AF_INET,SOCK_STREAM,0);sockaddr_in a{};a.sin_family=AF_INET;a.sin_port=htons(53);"
           'inet_pton(AF_INET,"1.1.1.1",&a.sin_addr);std::cout<<(connect(s,(sockaddr*)&a,sizeof a)==0?"online":"offline");}\n')
    ok(school.cpp(net, [{"input": "", "output": "offline"}])["passed"] == 1, "SC.2 no network inside the sandbox")

print("ALL PASS" if not FAIL else f"{len(FAIL)} FAILED")
sys.exit(1 if FAIL else 0)
