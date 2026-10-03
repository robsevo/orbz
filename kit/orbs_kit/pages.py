"""A page an orb built, checked the way Ash checks his (PLAN 4.1): Ash's pagecheck, carried.

The home calls this before a page may be called done (`check_page`, and a visual row of a plan's
board). It runs `kit/ash/pagecheck.py` as a process of its own, so the headless Chromium that
process starts (`kit/ash/browser.py`: a throwaway profile, never the person's browser) stops
with it. Ash's exit codes are kept as they are: 0 the page renders and is styled, 1 it is not
(and says what), 2 nothing could look at what it rendered, which is never a pass.

A page in the orb's workspace is served for the check from the workspace itself, on this machine
only, for as long as the check takes; a path that leads out of the workspace (a link to elsewhere)
is not served.
"""
from __future__ import annotations

import http.server
import os
import socketserver
import subprocess
import sys
import threading
from pathlib import Path
from urllib.parse import quote

ASH = Path(__file__).resolve().parent.parent / "ash"
# inside the home's 60 s for a call to the kit, so the home hears this verdict, not a timeout
TIMEOUT_S = 50


class _Inside(http.server.SimpleHTTPRequestHandler):
    """Serves files under `root` only: a path whose real place is outside it is a 404."""

    root = ""

    def translate_path(self, path):
        p = super().translate_path(path)
        real, root = os.path.realpath(p), os.path.realpath(self.root)
        if real != root and not real.startswith(root + os.sep):
            return os.path.join(root, ".orbs-not-served")
        return p

    def list_directory(self, path):
        self.send_error(404, "not served")
        return None

    def log_message(self, *a):
        pass


class _Server(socketserver.ThreadingTCPServer):
    # Chromium opens speculative sockets it may never use: daemon threads, or shutdown waits on them
    daemon_threads = True
    allow_reuse_address = True


def serve(root: str):
    """A server for `root` on 127.0.0.1, and its address. Stop it with .shutdown()."""
    handler = type("Handler", (_Inside,), {"root": root})
    httpd = _Server(("127.0.0.1", 0), lambda *a, **k: handler(*a, directory=root, **k))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/"


def _run(url: str) -> dict:
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    try:
        r = subprocess.run([sys.executable, str(ASH / "pagecheck.py"), url], cwd=ASH, env=env,
                           capture_output=True, text=True, timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return {"verdict": "fail", "report": f"pagecheck did not finish within {TIMEOUT_S} s"}
    out = (r.stdout + r.stderr).strip()
    verdict = {0: "pass", 1: "fail", 2: "inconclusive"}.get(r.returncode, "fail")
    return {"verdict": verdict, "report": out or f"pagecheck exited {r.returncode} and said nothing"}


def check(url: str | None = None, root: str | None = None, path: str | None = None) -> dict:
    """{"verdict": "pass" | "fail" | "inconclusive", "report": pagecheck's own words}."""
    if root is not None:
        if not path:
            return {"verdict": "fail", "report": "a page in the workspace is checked by its path"}
        if not os.path.isdir(root):
            return {"verdict": "fail", "report": "the workspace is not there"}
        target = os.path.realpath(os.path.join(root, path))
        if not target.startswith(os.path.realpath(root) + os.sep):
            return {"verdict": "fail", "report": f"{path} is outside the workspace"}
        if not os.path.isfile(target):
            return {"verdict": "fail", "report": f"there is no {path} in the workspace"}
        rel = path.replace(os.sep, "/").lstrip("/")
        # a folder's index by the folder's address: pagecheck joins a stylesheet's relative
        # address onto the page's, so "site/index.html" + "style.css" would miss it
        if rel == "index.html" or rel.endswith("/index.html"):
            rel = rel[: -len("index.html")]
        httpd, base = serve(root)
        try:
            return _run(base + quote(rel))
        finally:
            httpd.shutdown()
            httpd.server_close()
    if not url:
        return {"verdict": "fail", "report": "check a page by its path in the workspace, or its address"}
    return _run(url)
