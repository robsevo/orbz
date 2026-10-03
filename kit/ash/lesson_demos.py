"""Lessons that DEMONSTRATE: each step makes the visualiser do something, waits for the
animation to finish, rings what changed, and only then asks about it.

WHY THIS IS SCRIPTED. The model-planned lesson pointed at the right buttons and asked sensible
questions, and the user watched a page where nothing happened: "shows us absolutely nothing"
(2026-09-17). What makes a union-find lesson land is the tree changing shape in front of you,
and the sequence of operations that shows that is not a creative decision — init, union two
singletons, union two pairs, a FindSet that compresses a path, a same-set check. Getting that
order right every time matters more than varying it, so the operations and the questions are
fixed here, and the model does the one job that needs judgement: deciding whether an answer is
right. It is given what is ACTUALLY on the screen (roots and sizes read off the drawing),
because it cannot see it.

LAYOUT. Teaching is zoomed in. The page takes the whole recorded screen and the drawing is
re-framed to fill its width (visualgo.zoom): eight items span the screen as ~57px circles in at
most three rows, which leaves the lower-left of the page empty. The step panel goes there, sized
for a recording to read — it was a 330x230 box of 11px text sitting on top of the drawing. The
orb moves the panel itself (`panel` in the tutor state) and puts it back when the lesson ends;
moving it from outside could not resize it. Measured on the zoomed page (1920x1080):
    tree        y 240-492            (three rows, from the top of the page)
    step panel  x 48-828,  y 540-1000
    SAY box     x 840-1177, y 888-1048   (the orb's own; nothing of the page's under it)
    code panel  x 1342-1860, y 595-996   (VisuAlgo's pseudo-code, zoomed 1.4x)
"""
import ctypes
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import teachcanvas as vg  # noqa: E402
import statepaths  # noqa: E402 — PLAN 5.9: one root, and ASH_STATE_HOME moves it

PAGE_RECT = None
_RX, _RY, _RW, _RH = 0, 0, 1920, 1080
# A STRIP, NOT A DIALOG. This was 780x460 so a recording could read the explanation in it —
# but the same explanation is already captioned ON the drawing (vg.caption), and the box sat
# over the very thing it was explaining (user, 2026-09-19: "it takes up the whole fkn screen").
# The panel now only carries what the canvas cannot: how far in we are, and the NEXT button.
# Foot right: clear of the glass card the lesson is drawn on (canvas.html, y 40-740) and of
# the orb's own SAY box (x 840-1177). The canvas layout note names this rect — move both.
PANEL_W, PANEL_H = 420, 104
PANEL = {"x": _RX + _RW - PANEL_W - 40,
         "y": _RH - PANEL_H - 48, "w": PANEL_W, "h": PANEL_H}
RESPONSE_READ = 5.0                 # seconds a "right, and here's why" stays up before the next step

UFDS_STEPS = [
    {"do": [("init", 8)], "ring": list(range(8)),
     "text": "Eight items, each drawn as its own circle. Nothing is connected to anything yet.",
     "question": "How many separate groups are on screen right now?",
     "hint": "Count the circles that aren't attached to any other circle."},
    {"do": [("union", 0, 1)], "ring": [0, 1],
     "text": "I just ran UnionSet(0, 1). Watch the arrow that appeared between them.",
     "question": "One of them now points at the other. Which one is the root that stands for the group?",
     "hint": "The root is the one being pointed at, and it's the one wearing the r and s label."},
    {"do": [("union", 2, 3), ("union", 1, 3)], "ring": [1, 3],
     "text": "Now UnionSet(2, 3) makes a second pair, and UnionSet(1, 3) joins the two pairs.",
     "question": "When two groups merge, what actually gets linked: the two items you named, or their roots?",
     "hint": "Follow the new arrow. Which circles does it connect?"},
    {"do": [("find", 3)], "ring": [3],
     "text": "FindSet(3) climbs from 3 up to its root. Keep an eye on 3's arrow while it runs.",
     "question": "Where does 3 point after the search, and why does that make the next FindSet(3) faster?",
     "hint": "Count how many hops 3 needed to reach the root before, and how many it needs now."},
    {"do": [("same", 0, 2)], "ring": [0, 2],
     "text": "IsSameSet(0, 2) asks whether two items belong to the same group.",
     "question": "What does it compare to decide?",
     "hint": "Every item has exactly one root. What would two items in the same group have in common?"},
]


# ---------------------------------------------------------------- windows
_say_seq = 0            # monotonic within this process; see the say-queue note


def _x():
    import winplace as wp
    if wp.d is None:
        wp.d = wp.X.XOpenDisplay(None)
    X = wp.X
    X.XGetGeometry.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong),
                               ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int),
                               ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint),
                               ctypes.POINTER(ctypes.c_uint), ctypes.POINTER(ctypes.c_uint)]
    X.XTranslateCoordinates.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_int,
                                        ctypes.c_int, ctypes.POINTER(ctypes.c_int),
                                        ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_ulong)]
    return wp


def windows(cls):
    """{window id: (w, h)} for X windows whose WM_CLASS contains cls."""
    wp = _x()
    root = wp.X.XDefaultRootWindow(wp.d)
    out = {}
    for w in wp.client_list(root):
        if cls not in (wp.wm_class(w) or "").lower():
            continue
        r = ctypes.c_ulong(); x = ctypes.c_int(); y = ctypes.c_int()
        gw = ctypes.c_uint(); gh = ctypes.c_uint(); b = ctypes.c_uint(); dp = ctypes.c_uint()
        if wp.X.XGetGeometry(wp.d, w, ctypes.byref(r), ctypes.byref(x), ctypes.byref(y),
                             ctypes.byref(gw), ctypes.byref(gh), ctypes.byref(b), ctypes.byref(dp)):
            out[w] = (gw.value, gh.value)
    return out


def place(win, rect):
    x, y, w, h = rect
    subprocess.run([sys.executable, str(HERE / "winplace.py"), "--id", hex(win), str(x), str(y), str(w), str(h)],
                   capture_output=True, timeout=8)


def title(win):
    wp = _x()
    data, n = wp.getprop(win, "_NET_WM_NAME", wp.atom("UTF8_STRING"))
    if not data:
        return ""
    t = ctypes.string_at(data, n).decode("utf-8", "replace")
    wp.X.XFree(data)
    return t


def page_window():
    """The window showing the visualiser, by its title: the user's own Chrome can be open too,
    and the newest Chrome window is not necessarily the one with the lesson in it."""
    wins = windows("chrome")
    if not wins:
        return None
    return next((w for w in wins if "VisuAlgo" in title(w)), sorted(wins)[-1])


def visible_rect(win):
    """Where the window's VISIBLE edges are on screen: its origin plus the shadow it draws
    inside itself (_GTK_FRAME_EXTENTS), which is what PAGE_RECT describes."""
    wp = _x()
    root = wp.X.XDefaultRootWindow(wp.d)
    x = ctypes.c_int(); y = ctypes.c_int(); child = ctypes.c_ulong()
    wp.X.XTranslateCoordinates(wp.d, win, root, 0, 0, ctypes.byref(x), ctypes.byref(y), ctypes.byref(child))
    size = windows("chrome").get(win)
    if not size:
        return None
    l, r, t, b = wp.frame_extents(win)
    return (x.value + l, y.value + t, size[0] - l - r, size[1] - t - b)


def place_page():
    win = page_window()
    if win:
        place(win, PAGE_RECT)
    return bool(win)


def ensure_page(ws):
    """Put the page back if anything moved it, and re-frame the drawing for the new size.

    Something does: while Ash's terminal is linked, pair.py's tiler puts every NEW Chrome window
    in the right column, once, within a couple of seconds of it appearing. The lesson opens the
    visualiser in a new window, so whether the page ends up full-width or squeezed into the right
    column (with every ring computed for the wrong layout) was a race. The tiler never moves a
    window twice, so checking at each step settles it."""
    win = page_window()
    now = visible_rect(win) if win else None
    if now is None or all(abs(a - b) <= 4 for a, b in zip(now, PAGE_RECT)):
        return False
    place(win, PAGE_RECT)
    time.sleep(1.0)
    vg.refit(ws)
    vg.zoom(ws)
    return True


# ---------------------------------------------------------------- the lesson
def _mark(ws, spec):
    """Highlight what just changed, IN the drawing.

    This used to be an operating-system ring drawn over a screen rectangle, which meant
    asking the page where a node was and trusting the answer. The canvas pulses the node
    itself, so the highlight cannot land on empty desktop and nothing has to be measured."""
    if spec == "drawing" or not isinstance(spec, (list, tuple)):
        return None
    try:
        vg.pulse(ws, list(spec), times=2)
    except Exception:
        pass
    return None


SAY_DIR = statepaths.config()/"say-queue"


def say(text):
    """Speak a line through ashd, the same queue pair.py uses.

    The lesson ran SILENT: every step was written to the panel and nothing was said out
    loud, so a viewer watched a teacher mouth the words (user, 2026-09-17: "he didnt tutor
    us with voice though"). Teaching is spoken; the panel is the blackboard beside it."""
    try:
        SAY_DIR.mkdir(parents=True, exist_ok=True)
        # Same collision as pair.queue_say (PLAN 6.11): millisecond names are not unique.
        global _say_seq
        _say_seq += 1
        # ITS OWN KIND, not "reply" (2026-09-24 sweep). As replies, lesson lines went silent when
        # terminal replies were switched off, a burst of them collapsed to the last one, and one
        # that repeated an earlier line, or read like a finish, was dropped. The say-loop shapes
        # a lesson line for the ear exactly as a reply, and gates it on nothing.
        name = f"{time.time():.3f}-{os.getpid()}-{_say_seq:04d}-lesson"
        tmp = SAY_DIR/f".{name}.tmp"
        tmp.write_text(json.dumps({"kind": "lesson", "text": text, "t": time.time()}))
        tmp.replace(SAY_DIR/f"{name}.json")
    except OSError:
        pass


# ---------------------------------------------------------------- he answers his own questions
# User, 2026-09-19: "we just want him to answer the questions too." A lesson that waits for a
# learner who is not there sat on step 1 for 900 s, never reached finish(), and so never closed
# its panel — it was still over the next task's page. With this switched on he asks, gives the
# room a moment, answers, and moves on, so every lesson runs to the end and tidies up after
# itself. A switch, not the default: a real lesson waits for the person learning.
LECTURE = statepaths.config()/"lesson-mode.json"
THINK = 3.0                    # a beat between the picture changing and him explaining it
EXPLAIN_HOLD = 14.0            # a step waits this long for "next" before it carries on
WAKE = statepaths.config()/"wake-state.json"


def lecture_on():
    try:
        return bool(json.loads(LECTURE.read_text()).get("answers_himself"))
    except Exception:
        return False


ARM = 14.0          # how long to wait for a queued line to actually START being spoken


def wait_spoken(timeout=45.0, line=""):
    """Until ashd has finished saying THIS line — read from its own state, because a guess at
    the length of a sentence either clips it or leaves dead air.

    The arm used to be 4 s and matched nothing: say() only QUEUES, so when anything was
    already in the queue this line's turn came later than that, wait_spoken returned as
    though it were done, and the step's 14 s "next" timer ran while he was still mid-sentence
    — the panel pressed its own NEXT under him, twice in one lesson (user, 2026-09-19: "he
    clicked twice while talking"). So: wait for HIS state to be speaking THIS line, and treat
    the gap between two queued lines as still speaking."""
    import re as _re
    # THE LINE AS HE SAYS IT (2026-09-24 sweep): the state carries the spoken text, which has been
    # through `for_the_ear` — "That is the root" is "That's the root" there — so the raw head never
    # matched, and every such step waited out the whole arm window in silence.
    def _h(s):
        return _re.sub(r"\s+", " ", (s or "")).strip().lower()[:24]
    heads = {_h(line)}
    try:
        import speakable as _sp
        shaped = _sp.for_the_ear(_sp.strip_internal(line or "") or (line or ""))
        heads |= {_h(shaped), _h(_sp.from_report(shaped))}
    except Exception:
        pass
    heads.discard("")
    head = bool(heads)

    def st():
        try:
            d = json.loads(WAKE.read_text())
            return d.get("state"), _re.sub(r"\s+", " ", str(d.get("reply") or "")).strip().lower()
        except Exception:
            return None, ""

    t0 = time.time()
    while time.time() - t0 < ARM:
        s, r = st()
        if s == "speaking" and (not head or any(r.startswith(h) for h in heads)):
            break
        time.sleep(0.15)
    quiet = 0.0
    while time.time() - t0 < timeout:
        s, _ = st()
        if s == "speaking":
            quiet = 0.0
        else:
            quiet += 0.15
            if quiet >= 0.45:       # a real stop, not the gap between two queued lines
                return
        time.sleep(0.15)


def ufds_answer(st, now):
    """His answer to his own union-find question, worked out from what is ON the canvas.

    Not a model call: the script is fixed, so the right answer is knowable, and a slow or
    failed call would be dead air in the middle of a recording. Steps 1, 2 and 4 depend on
    the drawing (how many groups, which circle is the root, where 3 points after the search),
    so those are read from it; 3 and 5 are true of union-find itself."""
    groups = (now or {}).get("groups") or []
    parent = {int(k): int(v) for k, v in ((now or {}).get("parent") or {}).items()}

    def root_of(x):
        seen = set()
        while x in parent and parent[x] != x and x not in seen:
            seen.add(x); x = parent[x]
        return x
    q = (st.get("question") or "").lower()
    if "how many separate groups" in q:
        n = len(groups)
        return (f"Every item starts out on its own, so right now there are {n} separate "
                f"groups — one for each circle.")
    if "which one is the root" in q:
        r = root_of(0)
        other = 1 if r == 0 else 0
        return f"{r} is the root. {other} points at it, so {r} stands for the whole group."
    if "what actually gets linked" in q:
        return ("A union never links the two items you named — it links the root of one group "
                "to the root of the other.")
    if "where does 3 point" in q:
        r = root_of(3)
        return (f"3 now points straight at {r}, the root. The search flattened the path on its "
                f"way back, so the next look-up from 3 is a single hop.")
    if "what does it compare" in q:
        return ("It compares their roots. Every item has exactly one root, so two items are in "
                "the same group exactly when their roots match.")
    return st.get("hint") or ""


def _run_ops(ws, ops):
    for op in ops:
        name, args = op[0], op[1:]
        getattr(vg, name)(ws, *args)


# name -> the canvas call. The planner's vocabulary and this table are the same list; an op
# that is in one and not the other is an op that validates and then draws nothing.
_DRAW = {
    "cells": vg.cells, "marks": vg.marks, "span": vg.span, "compare": vg.compare,
    "swap": vg.swap, "found": vg.found, "light": vg.light,
    "makeSet": vg.init, "union": vg.union, "find": vg.find, "chain": vg.chain,
    "callout": vg.callout, "pulse": vg.pulse,
}


def run_drawn(plan, finish, log, hold=14.0):
    """Any topic, drawn by him on his own canvas.

    Same shape as run_ufds, but the steps come from a plan instead of a script — which is
    what makes every topic look like his (user, 2026-09-19: "all topics and new topics
    learnt should always have that theme"), instead of only the one that had a demo
    written by hand."""
    import show
    ws = vg.open_page(show)
    if ws is None:
        return finish("I couldn't open the canvas just now. Ask me again in a moment.")
    vg.prepare(ws, rate=0.85)          # the movement is the explanation, so it gets room
    vg.title(ws, plan["title"])
    place_page()
    time.sleep(2.5)                    # outlast the terminal tiler's first look at a new window
    ensure_page(ws)

    steps = plan["steps"]
    tutor.write(id=str(int(time.time())), title=plan["title"], of=len(steps), step=0,
                mode="ring", text="", question="", hint="", waiting="", target=None,
                panel=PANEL, bar=True)
    for i, st in enumerate(steps, 1):
        last = i == len(steps)
        tutor.write(step=i, text=st["text"], question="", hint="",
                    waiting="" if last else "say next when you're ready",
                    mode="ring", target=None, auto=False)
        say(st["text"])
        if ensure_page(ws):
            log(f"step {i}: the page had been moved; put it back")
        vg.caption(ws, st["text"])     # the line is ON the drawing, not only in the strip
        for op in st["do"]:
            try:
                _DRAW[op[0]](ws, *op[1:])
            except Exception as e:     # one op that will not draw is not a dead lesson
                log(f"step {i}: {op[0]} did not draw: {type(e).__name__}: {e}")
        log(f"step {i} drew: {', '.join(o[0] for o in st['do']) or 'nothing'}")
        wait_spoken(line=st["text"])
        if last:
            break
        tutor.wait_reply(time.time() - 0.2, hold)
        time.sleep(0.4)
    return finish(f"That's {plan['title']}, end to end.")


def run_ufds(topic, judge, finish, log):
    import show
    ws = vg.open_page(show)
    if ws is None:
        return finish("I couldn't open the canvas just now. Ask me again in a moment.")
    # slower than a person clicking: the movement is the explanation, so it gets room
    vg.prepare(ws, rate=0.8)
    vg.title(ws, "Union-Find, step by step")
    place_page()
    time.sleep(2.5)                      # outlast the terminal tiler's first look at a new window
    ensure_page(ws)

    steps = UFDS_STEPS
    tutor.write(id=str(int(time.time())), title="Union-Find, step by step", of=len(steps), step=0,
                mode="ring", text="", question="", hint="", waiting="", target=None,
                panel=PANEL, bar=True)

    # A VISUAL EXPLAINER, NOT A QUIZ (user, 2026-09-19: "ITS A VISUAL EXPLAINER ... WITHOUT
    # THE QUESTIONS ... WITH A NEXT BUTTON OR THE USER CAN SAY NEXT OR GOT IT"). Each step
    # says what is about to happen, the canvas does it, and he says what it meant. It moves
    # on when the learner says so, or by itself, so a demo never stalls on silence.
    for i, st in enumerate(steps, 1):
        tutor.write(step=i, text=st["text"], question="", hint="", waiting="watch the page",
                    mode="ring", target=None, auto=True)
        say(st["text"])
        if ensure_page(ws):
            log(f"step {i}: the page had been moved; put it back")
        vg.caption(ws, st["text"])       # the line is ON the drawing, not only in the panel
        _run_ops(ws, st["do"])
        now = vg.facts(ws)
        log(f"step {i} on screen: {vg.describe(now)}")
        rect = _mark(ws, st["ring"])
        explain = ufds_answer(st, now)   # what the drawing just showed, said plainly
        last = i == len(steps)
        tutor.write(step=i, text=explain, question="", hint="",
                    waiting="" if last else "say next when you're ready",
                    mode="ring", target=rect, auto=False)
        vg.caption(ws, explain)
        say(explain)
        wait_spoken(line=explain)
        if last:
            break
        tutor.wait_reply(time.time() - 0.2, EXPLAIN_HOLD)
        time.sleep(0.4)
    ws.close()
    return finish("That's union-find: every group has one root, merging links roots, and FindSet "
                  "shortens the path as it goes. Nicely done.")
