"""Drive Ash's own teaching canvas — the replacement for visualgo.py.

WHY. visualgo.py works, and a lesson recorded off it still looks like a screen-share of
somebody else's website: their pacing, their chrome, their colours, a fixed layout the
lesson has to be squeezed around, and an operation that takes ~7 s whether or not that is
the right length for what is being said over it. teach/canvas.html is his own surface, so
this driver gets to say how fast a union happens and where the tree sits on the frame.

SAME SHAPE AS visualgo.py on purpose — tab_ws / prepare / init / union / find / same /
facts / describe — so lesson_demos.py switches by changing which module it imports.

TWO THINGS THIS DOES THAT THE OLD ONE COULD NOT:

  The canvas highlights what changed ITSELF, in the drawing, so the lesson no longer needs
  an operating-system ring drawn over a coordinate. That removes the whole failure class
  where a confident ring lands on empty desktop because the element moved.

  Every operation is a promise that resolves when its animation has finished, and this
  awaits it. No sleeping and hoping: if a union takes longer because the tree got deeper,
  the step still lands exactly when the movement stops.
"""
import json
import pathlib

import pagepoint

HERE = pathlib.Path(__file__).resolve().parent
CANVAS = HERE / "teach" / "canvas.html"
URL = CANVAS.as_uri()

# Long enough for the slowest scripted operation (a union that re-lays a whole forest is
# ~2.5 s at rate 1.0) with room for a page that is still settling.
OP_WAIT = 60


def tab_ws():
    """The canvas tab, or None — including when the browser is not running at all."""
    try:
        tab = next((t for t in pagepoint.pages()
                    if "teach/canvas.html" in (t.get("url") or "")), None)
        return pagepoint.WS(tab["webSocketDebuggerUrl"]) if tab else None
    except OSError:
        return None


def ev(ws, js, wait=OP_WAIT):
    """Evaluate and RAISE on a JavaScript error.

    visualgo.py's version returns None when the page throws, which is indistinguishable
    from an operation that legitimately returned nothing — a lesson then carries on
    narrating steps over a drawing that stopped changing several steps ago."""
    r = ws.call("Runtime.evaluate",
                {"expression": js, "returnByValue": True, "awaitPromise": True}, wait=wait)
    exc = r.get("exceptionDetails")
    if exc:
        desc = ((exc.get("exception") or {}).get("description")
                or exc.get("text") or "javascript error")
        raise RuntimeError(f"canvas: {desc}")
    return (r.get("result") or {}).get("value")


def ready(ws):
    try:
        return bool(ev(ws, "!!(window.teach && window.teach.ready)", wait=5))
    except Exception:
        return False


def prepare(ws, rate=1.0):
    """Nothing to dismiss and nothing to scroll — the page is the lesson. Only the speed
    is worth setting: a recording wants the movement slower than a person clicking would."""
    ev(ws, f"window.teach.rate({float(rate)})", wait=5)


def refit(ws):
    """Kept so this module stays a drop-in for visualgo.py. The canvas is a viewBox that
    scales itself to the window, so there is nothing to re-fit."""
    return True


def zoom(ws):
    """Kept for the same reason as refit, and missing until 2026-09-19. lesson_demos.ensure_page()
    calls vg.refit() then vg.zoom() whenever the browser window has moved — which happens live,
    when the terminal tiler places a new Chrome window, and never in the off-screen test. With
    zoom absent that was an AttributeError, and the union-find lesson died six seconds in on
    camera with "Something went wrong with that lesson". The viewBox re-frames itself."""
    return True


def title(ws, text):
    ev(ws, f"window.teach.title({json.dumps(text)})", wait=5)


def caption(ws, text):
    ev(ws, f"window.teach.caption({json.dumps(text)})", wait=10)


def init(ws, n):
    ev(ws, f"window.teach.makeSet({int(n)})")


def union(ws, a, b):
    ev(ws, f"window.teach.union({int(a)},{int(b)})")


def find(ws, a):
    ev(ws, f"window.teach.find({int(a)})")


def same(ws, a, b):
    return bool(ev(ws, f"window.teach.same({int(a)},{int(b)})"))


def chain(ws, ids):
    """Link ids into a path, deepest first: chain(ws, [3, 2, 1, 0]) draws 3 -> 2 -> 1 -> 0.

    Union by rank never produces a deep tree, which is the algorithm working and a lesson
    about path compression failing: with every node already a direct child of the root,
    find() has nothing to shorten and the drawing does not change."""
    ev(ws, f"window.teach.chain({json.dumps([int(i) for i in ids])})")


def callout(ws, node, text):
    ev(ws, f"window.teach.callout({int(node)},{json.dumps(text)})", wait=10)


def clearCallout(ws):
    ev(ws, "window.teach.clearCallout()", wait=5)


def pulse(ws, ids, times=2):
    ev(ws, f"window.teach.pulse({json.dumps(list(ids))},{int(times)})")


# ---- the sequence family ----------------------------------------------------
# The canvas could always draw a row of cells; nothing in Python could call it, so every
# topic that was not union-find got taught by pointing at a web page and showed nothing
# (user, 2026-09-19). A row, a narrowing window, labelled edges and a hit are enough
# vocabulary for binary search, two pointers, a sliding window, a linear scan, and a sort.

def cells(ws, values):
    ev(ws, f"window.teach.cells({json.dumps(list(values))})", wait=20)


def compare(ws, i, j):
    return ev(ws, f"window.teach.compare({int(i)},{int(j)})", wait=10)


def swap(ws, i, j):
    ev(ws, f"window.teach.swap({int(i)},{int(j)})", wait=10)


def span(ws, lo, hi):
    """Dim everything outside [lo, hi] — the half a search just threw away."""
    ev(ws, f"window.teach.span({int(lo)},{int(hi)})", wait=10)


def marks(ws, pairs):
    """Labelled arrows under cells: marks(ws, [[0,"lo"],[4,"mid"],[9,"hi"]])."""
    clean = [[int(i), str(t)[:12]] for i, t in (pairs or [])]
    ev(ws, f"window.teach.marks({json.dumps(clean)})", wait=10)


def found(ws, i):
    ev(ws, f"window.teach.found({int(i)})", wait=10)


def light(ws, ids, on=True):
    ev(ws, f"window.teach.light({json.dumps([int(i) for i in ids])},{str(bool(on)).lower()})", wait=5)


def reset(ws):
    ev(ws, "window.teach.reset()", wait=10)


def facts(ws):
    return ev(ws, "window.teach.facts()", wait=10) or {}


def describe(f):
    """The drawing, in a sentence, for the answer judge — which cannot see the screen.

    Built here rather than read back out of the page so it can be tested without a browser,
    and so it can never describe anything the drawing does not actually show."""
    groups = (f or {}).get("groups") or []
    # Orbs (PLAN 4.4_t): the caption and the cells are on the screen too. The app captions every step
    # with its own words, so every step changes what the judge is told
    caption = str((f or {}).get("caption") or "").strip()
    cells = (f or {}).get("cells") or []
    said = ([f'the caption reads "{caption}"'] if caption else []) + ([f"cells: {', '.join(str(c) for c in cells)}"] if cells else [])
    if not groups:
        return "; ".join(said) if said else "nothing on screen yet"
    parts = []
    for gr in groups:
        members = gr.get("members") or []
        if len(members) == 1:
            parts.append(f"{gr['root']} on its own")
        else:
            inside = ", ".join(str(m) for m in members)
            parts.append(f"{{{inside}}} under root {gr['root']} "
                         f"(rank {gr.get('rank', 0)}, size {gr.get('size', len(members))})")
    n = len(groups)
    out = f"{n} group{'' if n == 1 else 's'}: " + "; ".join(parts)
    # The arrows, spelled out. Without them the description of the screen is IDENTICAL
    # before and after a path compression — same groups, same roots, same sizes — so the
    # judge marking an answer about "where does 3 point now" had nothing to check it
    # against. What changed is exactly what the question is about.
    arrows = (f or {}).get("parent") or {}
    if arrows:
        pairs = sorted(((int(c), v) for c, v in arrows.items()), key=lambda kv: kv[0])
        out += "; arrows: " + ", ".join(f"{c}->{p}" for c, p in pairs)
    return "; ".join([out, *said])


def open_page(show_mod, timeout=30.0):
    """Put the canvas on screen and hand back a live socket, or None.

    Returns only once window.teach exists: a tab that has been created but has not run its
    script yet answers CDP perfectly well and fails every operation sent to it."""
    import time
    ws = tab_ws()
    if ws is None:
        show_mod.show(URL)
    deadline = time.time() + timeout
    while time.time() < deadline:
        ws = tab_ws()
        if ws is not None and ready(ws):
            return ws
        if ws is not None:
            ws.close()
        time.sleep(0.5)
    return None
