#!/usr/bin/env python3
"""The teaching canvas, driven for real.

The point of these is that the canvas is not just rendering — it holds the union-find
state the lesson asks questions about, and the answer judge is handed a description of it.
If the drawing and the description ever disagree, the judge marks a correct answer wrong.
So the live half runs the real operations in a real browser and checks the structure that
comes back, rather than checking that a function exists.

  .venv/bin/python test_teachcanvas.py          pure checks, plus live if Chrome is there
  .venv/bin/python test_teachcanvas.py --pure   skip the browser
"""
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pagepoint  # noqa: E402
import teachcanvas as tc  # noqa: E402

import socket as _socket  # Orbs: a port the system picks, never a fixed one (the person's Chrome, Ash's)
with _socket.socket() as _s:
    _s.bind(("127.0.0.1", 0))
    PORT = _s.getsockname()[1]
FAILS = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'' if ok else '  ' + str(detail)}")
    if not ok:
        FAILS.append(name)


# ---------------------------------------------------------------- without a browser
def pure():
    print("describe (no browser)")
    check("T.1 empty canvas says so", tc.describe({}) == "nothing on screen yet")

    # THE DOOR, not just the room. The live checks below launch Chrome with the canvas URL
    # directly, so they never went through show() — which is how a lesson actually opens it.
    # show.classify() read the file:// URI as a filesystem path, called the canvas "no such
    # file", and every lesson in the 2026-09-18 recording said "I couldn't open the canvas
    # just now" while this suite stayed green.
    # Every vg.<name> the union-find demo calls must exist here. zoom did not: it is only
    # reached when the browser window has MOVED, which the off-screen checks never do, so the
    # demo crashed on camera (2026-09-19) while this suite passed.
    import re as _re
    demo = (HERE/"lesson_demos.py").read_text()
    called = sorted(set(_re.findall(r"\bvg\.([a-z_]+)\(", demo)))
    absent = [n for n in called if not hasattr(tc, n)]
    check("T.00 every canvas call the lesson makes exists", not absent, f"missing: {absent}")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

    f = {"n": 3, "groups": [{"root": 0, "members": [0], "rank": 0, "size": 1},
                            {"root": 2, "members": [1, 2], "rank": 1, "size": 2}]}
    got = tc.describe(f)
    check("T.2 singletons and sets both described",
          "0 on its own" in got and "{1, 2} under root 2" in got, got)
    check("T.3 rank and size are carried to the judge",
          "rank 1" in got and "size 2" in got, got)
    check("T.4 the canvas file exists", tc.CANVAS.exists(), tc.CANVAS)
    check("T.5 it is served as a file url", tc.URL.startswith("file://"), tc.URL)


# ---------------------------------------------------------------- with one
def chrome_bin():
    return __import__("browser").chrome_bin()


def wait_for_page(timeout=25):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=2) as r:
                for t in json.loads(r.read().decode()):
                    if t.get("type") == "page" and "canvas.html" in (t.get("url") or ""):
                        return t
        except Exception:
            pass
        time.sleep(0.4)
    return None


def live():
    binary = chrome_bin()
    if not binary:
        check("live: a Chromium to draw the canvas in", False, "none found: set ORBS_CHROME")
        return
    print("\nlive (headless chrome)")
    profile = tempfile.mkdtemp(prefix="teachtest-")
    proc = subprocess.Popen(
        [binary, "--headless=new", f"--remote-debugging-port={PORT}", "--no-sandbox",
         "--disable-gpu", f"--user-data-dir={profile}", "--window-size=1920,1080",
         # without these the renderer is treated as backgrounded and rAF stops, which
         # would hang every await on an animation that never gets a frame
         "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
         "--disable-backgrounding-occluded-windows", tc.URL],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ws = None
    try:
        tab = wait_for_page()
        if not tab:
            check("T.6 canvas opens in a browser", False, "page never appeared")
            return
        ws = pagepoint.WS(tab["webSocketDebuggerUrl"])
        check("T.6 canvas opens in a browser", True)
        # Poll, the way production does. open_page() waits up to 30 s for window.teach; this
        # checked ONCE, the instant the tab appeared, and went red on 2026-09-18 while a video
        # render had every core busy — the API arrived a moment later and T.20-T.22 passed
        # against it. A readiness check that does not wait is a race waiting for load.
        up = False
        for _ in range(40):
            if tc.ready(ws):
                up = True; break
            time.sleep(0.5)
        check("T.7 the teach api is exposed", up)

        tc.prepare(ws, rate=4.0)                 # animations at speed; the test is not a demo
        tc.init(ws, 8)
        f = tc.facts(ws)
        check("T.8 eight singletons", f.get("n") == 8 and len(f.get("groups", [])) == 8,
              tc.describe(f))
        check("T.9 every singleton has size one",
              all(gr["size"] == 1 for gr in f["groups"]), tc.describe(f))

        tc.union(ws, 0, 1)
        f = tc.facts(ws)
        check("T.10 a union removes a group", len(f["groups"]) == 7, tc.describe(f))
        check("T.11 and makes one of size two",
              any(gr["size"] == 2 for gr in f["groups"]), tc.describe(f))

        tc.union(ws, 2, 3)
        tc.union(ws, 1, 3)
        f = tc.facts(ws)
        big = max(f["groups"], key=lambda gr: gr["size"])
        check("T.12 joining two pairs makes a four", big["size"] == 4, tc.describe(f))
        check("T.13 all four are in it", sorted(big["members"]) == [0, 1, 2, 3], big)

        # Path compression is the thing the lesson asks about, so it has to be real and not
        # just an animation: after a find, 0 must point AT the root, not through a chain.
        before = tc.facts(ws)["parent"]
        # Pick a node that is genuinely two hops from its root. union by rank leaves
        # 3 -> 2 -> 0 here, and calling find on a node that is already the root would
        # "pass" while proving nothing.
        deep = next((int(c) for c, par in before.items()
                     if str(par) in before and int(par) != big["root"]), None)
        check("T.14a there is a node two hops from the root", deep is not None, before)
        tc.find(ws, deep if deep is not None else 0)
        after = tc.facts(ws)["parent"]
        root = big["root"]
        check("T.14 find compresses the path", after.get(str(deep)) == root,
              {"node": deep, "before": before, "after": after})
        check("T.15 and does not change the groups",
              len(tc.facts(ws)["groups"]) == 5, tc.describe(tc.facts(ws)))

        check("T.16 same set is true inside the group", tc.same(ws, 0, 2) is True)
        check("T.17 and false outside it", tc.same(ws, 0, 4) is False)

        tc.caption(ws, "Eight items, each on its own.")
        check("T.18 the caption reaches the drawing",
              tc.facts(ws).get("caption") == "Eight items, each on its own.")

        # The scripted lesson itself, run against the canvas. This is the check that would
        # have caught "shows us absolutely nothing": every step's operations execute, and
        # the drawing is different afterwards than it was before.
        try:
            import lesson_demos
            steps = lesson_demos.UFDS_STEPS
        except Exception as e:
            steps = None
            check("T.20 the scripted lesson imports", False, e)
        if steps:
            tc.init(ws, 8)
            seen = [tc.describe(tc.facts(ws))]
            ok = True
            for st in steps:
                tc.caption(ws, st["text"])  # Orbs: the app captions each step with its words
                for op in st["do"]:
                    try:
                        getattr(tc, op[0])(ws, *op[1:])
                    except Exception as e:
                        ok = False
                        print(f"    step op {op} failed: {e}")
                seen.append(tc.describe(tc.facts(ws)))
            check("T.20 every scripted step runs on the canvas", ok)
            # Not every step reshapes the forest — the first is an init and the last only
            # asks a question — but the step about path compression MUST change what the
            # judge is told, or the question it asks cannot be marked.
            check("T.21 every step changes what the judge is told", all(a != b for a, b in zip(seen, seen[1:])), seen)
            find_at = next((k for k, st in enumerate(steps, start=1)
                            if any(op[0] == "find" for op in st["do"])), None)
            check("T.22 path compression is visible to the judge",
                  find_at is not None and seen[find_at] != seen[find_at - 1],
                  {"before": seen[find_at - 1] if find_at else None,
                   "after": seen[find_at] if find_at else None})

        # What the judge is told must match what is drawn, or a right answer gets marked wrong.
        f = tc.facts(ws)
        drawn = {int(k): v for k, v in f["parent"].items()}
        roots = {gr["root"] for gr in f["groups"]}
        check("T.19 no described root is a child of anything",
              not (roots & set(drawn.keys())), {"roots": roots, "children": list(drawn)})
    except Exception as e:
        check("live run completed", False, f"{type(e).__name__}: {e}")
    finally:
        if ws:
            try:
                ws.close()
            except Exception:
                pass
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)


def main():
    pure()
    if "--pure" not in sys.argv:
        live()
    print(f"\n{len(FAILS)} failed: {', '.join(FAILS)}" if FAILS else "\nall passed")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
