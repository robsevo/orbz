#!/usr/bin/env python3
"""pagecheck, asserted in both directions. Run: orb/daemon/.venv/bin/python orb/daemon/test_pagecheck.py

A guard that has only ever been seen to FAIL proves nothing: it might fail everything. So
this serves two fixtures and requires opposite verdicts:

  broken/   the 2026-09-17 bug in miniature: CSS holding raw `@tailwind` lines, markup full
            of utility classes that nothing generated
  working/  real rules, and classed elements that are genuinely styled

Plus the honesty rule: when the browser cannot be reached the verdict is never exit 0.
"""
import http.server
import os
import socketserver
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = sys.executable
FAIL = []

CLASSES = " ".join(f"p-{i} bg-red-{i}00 rounded-lg flex" for i in range(1, 6))
MARKUP = "".join(f'<div class="{CLASSES}">card {i}</div>' for i in range(40))

BROKEN_CSS = "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n"
WORKING_CSS = "\n".join(
    [f".c{i} {{ padding: {i}px; background: #{i:02x}3344; border-radius: 6px; }}" for i in range(60)]
    + ["div { display: flex; padding: 8px; background: #222; border-radius: 4px; }"])


# ── SVG fixtures (2026-09-22) ──────────────────────────────────────────────────────────
# The `styled` check sampled backgroundColor, padding, borderRadius and display — HTML box
# properties — so every element of an SVG chart counted as unstyled however well drawn.
# Measured on `ashnew chartlive`, the house's reference look: 42 of 57 class-carrying
# elements were SVG, the page scored 15%, and a correct rendering FAILED the done-gate.
#
# BOTH DIRECTIONS, because teaching a check a new way to pass is how it stops being a check.
# The broken fixture carries real CSS rules that match NOTHING, so the `css` check still
# passes and only `styled` can be the thing that fails.
SVG_MARKUP = "".join(
    f'<circle class="pt s{i}" cx="{i * 9 + 5}" cy="40" r="4"/>' for i in range(30)
) + "".join(f'<text class="tick t{i}" x="{i * 30 + 5}" y="90">{i}</text>' for i in range(10))
SVG_PAGE = ('<!doctype html><html><head><title>svg fixture</title>'
            '<link rel="stylesheet" href="/style.css"></head><body>'
            f'<svg width="300" height="100" viewBox="0 0 300 100">{SVG_MARKUP}</svg>'
            '</body></html>')

# Padded to clear pagecheck's minimum RULE COUNT, so the only thing these two fixtures can
# differ on is `styled`. A fixture that trips a different check tests that check instead.
SVG_WORKING_CSS = (".pt { fill: #5aa9e6; stroke: #0b0f14; stroke-width: 2px; }\n"
                   ".tick { fill: #7d8b9a; opacity: 0.8; }\n"
                   + "\n".join(f".s{i} {{ opacity: 0.9; }}" for i in range(30)))
# Rules that exist and match nothing — the css check passes, so only `styled` can fail.
SVG_BROKEN_CSS = "\n".join(f".nothing-here-{i} {{ fill: #abc{i}ef; }}" for i in range(20))


def svg_site(root, css):
    root.mkdir(parents=True, exist_ok=True)
    (root / "style.css").write_text(css)
    (root / "index.html").write_text(SVG_PAGE)


def site(root, css):
    root.mkdir(parents=True, exist_ok=True)
    (root / "style.css").write_text(css)
    (root / "index.html").write_text(
        f'<!doctype html><html><head><title>fixture</title>'
        f'<link rel="stylesheet" href="/style.css"></head><body>{MARKUP}</body></html>')


def serve(root):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass
    handler = lambda *a, **k: Quiet(*a, directory=str(root), **k)
    # THREADING, with daemon threads. Chrome opens speculative preconnect sockets and may
    # never send a request on them; a single-threaded TCPServer then blocks reading that
    # socket forever and shutdown() never returns — which is how this test hung (measured
    # 2026-09-17: stuck with no child processes, in its own teardown).
    class Srv(socketserver.ThreadingTCPServer):
        daemon_threads = True
        allow_reuse_address = True
    httpd = Srv(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/"


def check(url):
    r = subprocess.run([PY, str(HERE / "pagecheck.py"), url],
                       capture_output=True, text=True, timeout=60)
    return r.returncode, r.stdout + r.stderr


sys.path.insert(0, str(HERE))
import browser  # noqa: E402

cdp = browser.cdp_up()
# pagecheck does not need the VISIBLE browser: with no debuggable window it brings up a
# headless copy on its own port and renders there (browser.HEADLESS_PORT). So "no window
# on screen" stopped meaning "no render" when that fallback was added, and check 4 below
# — which asserts a page cannot pass unrendered — began failing against correct behaviour
# whenever the orb's browser happened to be closed (2026-09-18). It is inconclusive only
# when there is no Chrome on the box at all.
renderable = bool(cdp or browser.cdp_up(port=browser.HEADLESS_PORT) or browser.chrome_bin())

with tempfile.TemporaryDirectory(prefix="pagecheck-") as d:
    d = Path(d)
    site(d / "broken", BROKEN_CSS)
    site(d / "working", WORKING_CSS)
    hb, broken = serve(d / "broken")
    hw, working = serve(d / "working")
    try:
        # 1. the bug is caught — even without a browser, raw directives are visible over HTTP
        rc, out = check(broken)
        if rc == 0:
            FAIL.append(f"broken page PASSED:\n{out}")
        if "unprocessed @tailwind" not in out:
            FAIL.append(f"broken page failed for the wrong reason:\n{out}")

        if cdp:
            # 2. a genuinely styled page passes — the guard does not fail everything
            rc, out = check(working)
            if rc != 0:
                FAIL.append(f"working page FAILED (rc={rc}):\n{out}")
            # 3. the render check itself sees the inert classes, not just the HTTP scan
            rc, out = check(broken)
            if "classes are inert" not in out and "compiled to nothing" not in out:
                FAIL.append(f"browser view did not report the unstyled render:\n{out}")
        elif renderable:
            # the headless fallback did the rendering: the working page must still pass
            print("  (no visible browser — pagecheck rendered headless; checks 2-3 run there)")
            rc, out = check(working)
            if rc != 0:
                FAIL.append(f"working page FAILED under the headless fallback (rc={rc}):\n{out}")
        else:
            print("  (no Chrome on this machine — render checks skipped)")
            # 4. with nothing able to render, a clean HTTP view is INCONCLUSIVE, never a pass
            rc, out = check(working)
            if rc == 0:
                FAIL.append("with nothing able to render, a page PASSED uninspected")
        # ── SVG, both ways ────────────────────────────────────────────────────────
        if renderable:
            with tempfile.TemporaryDirectory(prefix="pagecheck-svg-") as _td:
                _root = Path(_td)
                svg_site(_root / "ok", SVG_WORKING_CSS)
                svg_site(_root / "bad", SVG_BROKEN_CSS)
                _ho, _uo = serve(_root / "ok")
                _hb2, _ub = serve(_root / "bad")
                try:
                    _rc, _out = check(_uo)
                    if _rc != 0:
                        FAIL.append(f"a STYLED svg page failed — the done-gate rejects the "
                                    f"house's own chart template (rc={_rc}):\n{_out}")
                    if "styled" in _out:
                        _frac = [l for l in _out.splitlines() if l.strip().startswith("styled")]
                        print(f"  svg styled : {_frac[0].strip() if _frac else '?'}")
                    _rc2, _out2 = check(_ub)
                    if _rc2 == 0:
                        FAIL.append(f"CONTROL: an UNSTYLED svg page PASSED — teaching the "
                                    f"check a new way to say yes has stopped it being a "
                                    f"check:\n{_out2}")
                    if "classes are inert" not in _out2:
                        FAIL.append(f"CONTROL: the unstyled svg page failed for some other "
                                    f"reason than being unstyled:\n{_out2}")
                finally:
                    _ho.shutdown(); _hb2.shutdown()
    finally:
        hb.shutdown(); hw.shutdown()

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print(f"✓ pagecheck: broken fails, {'working passes' if renderable else 'no-render is not a pass'}")
