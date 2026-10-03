#!/usr/bin/env python3
"""pagepoint — where is that thing on the page, in SCREEN coordinates?

    pagepoint.py --url https://example.com --css h1
    pagepoint.py --text "path compression"          # current tab, by visible text
    pagepoint.py --outline                          # what is on the page, with node ids
    pagepoint.py --node 1758291234567012            # an element --outline listed
    pagepoint.py --list                             # what tabs are open

Prints one JSON object: {"x":..,"y":..,"w":..,"h":..,"text":".."} — the rect the overlay
needs, ready for `ashtutor step --target x,y,w,h`.

WHY. Ash cannot see the screen, so a lesson could only point at things it already had
coordinates for: a taught anchor, an orb widget, or a screen third. For a lesson about a
CONCEPT there is nothing on screen at all, so on 2026-09-17 a union-find lesson pointed at
`screen:top-right` and drew a ring on empty desktop. The fix is not vision — it is asking
the browser, which knows exactly where everything on the page is.

THE BROWSER IT ASKS IS THE VISIBLE ONE. Chrome is started with --remote-debugging-port by
~/.config/chrome-flags.conf, so this talks to the window the user is looking at. Querying a
second headless browser would give coordinates for a page nobody can see, which is the bug
this exists to fix, not a fix for it.

NO NEW DEPENDENCIES. CDP is HTTP for discovery plus a WebSocket for commands, and the
WebSocket here is ~60 lines of stdlib socket work. That is deliberate: this box has a
history of heavy browser deps causing trouble (see webshot.sh), and winplace.py already
sets the precedent of talking a protocol directly rather than pulling in a stack for it.

POINT AT WHAT WAS LISTED, NOT AT WHAT IT SAID. --outline gives every entry an id that belongs to
the live node (a WeakMap in the page, the way browser-use's jev-ultrafast keys its targets), and
--node rings exactly that node. Re-searching for the words used a different rule from the one
that listed them, so a heading listed as "Merge" was rung on a "Merge" button further down.
Ids are unique per document: after a reload an old id resolves to nothing, never to whatever
now holds the same number.

A RING ON TOP OF SOMETHING ELSE IS REFUSED. After scrolling, the element must be what the
browser hit-tests at its own centre; under a cookie banner or a modal the ring would sit on
the banner, so that is exit 5 and no rect.

Exit codes: 0 found, 2 bad usage, 3 browser not reachable, 4 element not found,
5 found but covered by something else (or off screen at its centre).
"""
import argparse
import base64
import json
import os
import socket
import ssl  # noqa: F401  (kept for parity if a wss endpoint ever appears)
import struct
import sys
import time
import urllib.error
import urllib.request

# The port is the browser service's, not a second copy of it (9.3's "one address"): three
# modules typed 9222 by hand until 2026-09-23. `pagecheck` and the suites still rebind PORT
# here at run time for a private headless Chrome; this is only the default.
from browserservice import PORT as _BROWSER_PORT  # noqa: E402
HOST, PORT = "127.0.0.1", _BROWSER_PORT


# ---------------------------------------------------------------- CDP discovery
def http_json(path, timeout=3):
    url = f"http://{HOST}:{PORT}{path}"
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode())


def pages():
    return [t for t in http_json("/json") if t.get("type") == "page"
            and t.get("webSocketDebuggerUrl")]


# ---------------------------------------------------------------- minimal websocket
class WS:
    """Just enough RFC 6455 to send a JSON command and read JSON replies."""

    def __init__(self, url, timeout=8):
        assert url.startswith("ws://"), url
        rest = url[5:]
        hostport, _, path = rest.partition("/")
        host, _, port = hostport.partition(":")
        self.sock = socket.create_connection((host, int(port or 80)), timeout=timeout)
        self.sock.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        req = (f"GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n"
               f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
               f"Sec-WebSocket-Version: 13\r\n\r\n")
        self.sock.sendall(req.encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("handshake closed early")
            buf += chunk
        if b"101" not in buf.split(b"\r\n", 1)[0]:
            raise ConnectionError(f"upgrade refused: {buf.split(chr(13).encode())[0][:80]}")
        self.rest = buf.split(b"\r\n\r\n", 1)[1]

    def send(self, obj):
        payload = json.dumps(obj).encode()
        head = bytearray([0x81])                       # FIN + text
        n = len(payload)
        mask = os.urandom(4)
        if n < 126:
            head.append(0x80 | n)
        elif n < (1 << 16):
            head.append(0x80 | 126); head += struct.pack(">H", n)
        else:
            head.append(0x80 | 127); head += struct.pack(">Q", n)
        head += mask
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(head) + masked)

    def _read(self, n):
        while len(self.rest) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("closed")
            self.rest += chunk
        out, self.rest = self.rest[:n], self.rest[n:]
        return out

    def recv(self):
        b0, b1 = self._read(2)
        length = b1 & 0x7F
        if length == 126:
            length = struct.unpack(">H", self._read(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self._read(8))[0]
        if b1 & 0x80:                                   # server frames are unmasked, but
            mask = self._read(4)                        # tolerate it rather than desync
            data = bytes(c ^ mask[i % 4] for i, c in enumerate(self._read(length)))
        else:
            data = self._read(length)
        if (b0 & 0x0F) == 0x8:
            raise ConnectionError("server closed the socket")
        return json.loads(data.decode())

    def call(self, method, params=None, _id=[0], wait=8):
        _id[0] += 1
        mid = _id[0]
        self.send({"id": mid, "method": method, "params": params or {}})
        end = time.time() + wait
        while time.time() < end:
            msg = self.recv()
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(msg["error"].get("message", "cdp error"))
                return msg.get("result", {})
        raise TimeoutError(method)

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


# ---------------------------------------------------------------- waiting for a page
# Wait for the state that is needed, not for a number of seconds. A fixed sleep is too long
# on a static page and too short on a slow one; these return when the page says it is ready,
# and a cap bounds every wait.
def navigate(ws, url, timeout=12.0):
    """Load `url` in this tab and wait for the NEW document to finish loading. The old one is
    still answering for a moment after Page.navigate, with its own readyState 'complete' — and
    on a reload of the same URL its href matches too — so a new document is told by its
    performance.timeOrigin, which every document gets afresh. A #fragment change stays in the
    same document, so that one only waits for readyState."""
    before, href = None, ""
    try:
        r = ws.call("Runtime.evaluate", {"expression": "[performance.timeOrigin, location.href]",
                                         "returnByValue": True})
        before, href = (r.get("result") or {}).get("value") or [None, ""]
    except Exception:
        pass
    ws.call("Page.navigate", {"url": url})
    same_doc = "#" in url and url.split("#")[0] == href.split("#")[0]
    return wait_loaded(ws, timeout, not_origin=None if same_doc else before)


def wait_loaded(ws, timeout=12.0, not_origin=None):
    """True once document.readyState is complete. An evaluate that lands mid-navigation fails
    with its context destroyed; that means 'not yet', not a failure. `not_origin` is the
    timeOrigin of a document that must NOT be the one answering."""
    expr = "document.readyState"
    if not_origin is not None:
        expr = f"performance.timeOrigin !== {json.dumps(not_origin)} && document.readyState"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = ws.call("Runtime.evaluate", {"expression": expr, "returnByValue": True})
            if (r.get("result") or {}).get("value") == "complete":
                return True
        except (RuntimeError, TimeoutError):
            pass
        time.sleep(0.1)
    return False


# Resolves once the page has stopped changing for QUIET ms and nothing it is waiting on is
# pending: element count, text length, stylesheets and eager images all hold still. setTimeout,
# not requestAnimationFrame, so a tab that is not painting still answers — just more coarsely.
SETTLE_JS = r"""
new Promise(resolve => {
  const QUIET = %(quiet)d, CAP = %(cap)d, FLOOR = %(floor)d, t0 = performance.now();
  const pending = () => [...document.images].filter(i => !i.complete && i.loading !== 'lazy').length;
  const sig = () => [document.readyState, document.getElementsByTagName('*').length,
    (document.body && document.body.textContent.length) || 0, document.styleSheets.length,
    pending()].join('|');
  let last = sig(), since = t0;
  const tick = () => {
    const now = performance.now(), s = sig();
    if (s !== last) { last = s; since = now; }
    const quiet = document.readyState === 'complete' && !pending() && now - since >= QUIET;
    if ((quiet && now - t0 >= FLOOR) || now - t0 >= CAP) {
      resolve({settled: quiet, ms: Math.round(now - t0)});
    } else {
      setTimeout(tick, 50);
    }
  };
  setTimeout(tick, 50);
})
"""


def settle(ws, quiet=0.4, cap=3.0, floor=0.0):
    """Wait until the page holds still for `quiet` seconds, at least `floor` and at most `cap`.
    Returns {"settled": bool, "ms": int}, or None if the page could not be asked (it navigated
    away mid-wait, say) — in which case `floor` is still slept, so a caller that needs a
    minimum wait gets it either way."""
    cap = max(cap, floor)
    js = SETTLE_JS % {"quiet": int(quiet * 1000), "cap": int(cap * 1000), "floor": int(floor * 1000)}
    old = ws.sock.gettimeout()
    t = time.time()
    try:
        ws.sock.settimeout(cap + 5)
        r = ws.call("Runtime.evaluate",
                    {"expression": js, "returnByValue": True, "awaitPromise": True}, wait=cap + 5)
        return (r.get("result") or {}).get("value")
    except (RuntimeError, TimeoutError, OSError):
        time.sleep(max(0.0, floor - (time.time() - t)))
        return None
    finally:
        try:
            ws.sock.settimeout(old)
        except OSError:
            pass


# ---------------------------------------------------------------- the locator
# Runs IN the page. The screen mapping is the only subtle part: a page's own coordinates
# are viewport-relative, and the viewport sits below the tab strip and address bar, so the
# offset is the window's screen position plus the chrome the browser draws around it.
#
# Chrome on X11 also draws its drop shadow INSIDE its own window (_GTK_FRAME_EXTENTS: 39px on
# every side here), so outerWidth/outerHeight include that shadow on all four sides. The side
# gap is shadow and nothing else, which makes it the shadow's size; the bottom carries the same
# shadow, and counting it as browser chrome put every ring 39px below its target (measured
# 2026-09-17: window at screenY -7, visible top 32, viewport top 119, formula said 158). A
# maximized window has no shadow, both gaps are 0, and the same arithmetic still holds.
ORIGIN_JS = r"""
  const _shadow = (window.outerWidth - window.innerWidth) / 2;
  const dx = window.screenX + _shadow;
  const dy = window.screenY + (window.outerHeight - window.innerHeight) - _shadow;
"""

#
# VISIBLE means checkVisibility with opacity and visibility, which walks the ancestors. The old
# test was `offsetParent`, which is null for every position:fixed element (so a fixed help
# button could never be found) and blind to an opacity:0 ancestor (so text in a faded-out
# panel could be rung).
LOCATE_JS = r"""
(() => {
  const MODE = %(mode)s, NEEDLE = %(needle)s;
  const shown = e => e.checkVisibility({checkOpacity: true, checkVisibilityCSS: true});
  let el = null;
  if (MODE === 'node') {
    el = (window.__ashPoint && window.__ashPoint.nodes.get(NEEDLE)) || null;
    if (el && (!el.isConnected || !shown(el))) el = null;
  } else if (MODE === 'css') {
    el = [...document.querySelectorAll(NEEDLE)].find(shown) || null;
  } else {
    const want = NEEDLE.toLowerCase();
    let best = null, bestLen = 0;
    for (const n of document.body.querySelectorAll('*')) {
      if (!shown(n)) continue;
      const t = (n.innerText || '').trim().toLowerCase();
      if (t && t.includes(want) && (!best || t.length < bestLen)) { best = n; bestLen = t.length; }
    }
    el = best;
  }
  if (!el) return null;
  el.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'});
  const r = el.getBoundingClientRect();
  // The element must be what the browser hits at its own centre. An ancestor counts (a label
  // with pointer-events:none hit-tests to its button); anything else is on top of it.
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const hit = (cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight)
    ? document.elementFromPoint(cx, cy) : null;
  if (!hit || !(el.contains(hit) || hit.contains(el))) {
    const by = !hit ? 'nothing: its centre is off screen'
      : hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '')
        + ((hit.getAttribute('class') || '').trim() ? '.' + hit.getAttribute('class').trim().split(/\s+/).join('.') : '');
    return {covered: true, by: by.slice(0, 80), url: location.href};
  }
  %(origin)s
  return {
    x: Math.round(dx + r.left), y: Math.round(dy + r.top),
    w: Math.round(r.width), h: Math.round(r.height),
    text: (el.innerText || el.getAttribute('alt') || '').trim().slice(0, 80),
    url: location.href
  };
})()
"""


def locate(mode, needle, url=None, cap=4.0):
    """(rect, 0) for the element, or (None, rc) with the exit code main() would return.
    `mode` is css, text or node; `cap` bounds the wait when `url` has to be loaded first."""
    try:
        tabs = pages()
    except (urllib.error.URLError, OSError) as e:
        print(f"browser not reachable on {HOST}:{PORT} ({e}). Chrome must be started with "
              f"--remote-debugging-port (see ~/.config/chrome-flags.conf) and restarted "
              f"fully, not just its window closed.", file=sys.stderr)
        return None, 3
    if not tabs:
        print("no page tabs open", file=sys.stderr)
        return None, 3

    tab = tabs[0]
    if url:
        match = [t for t in tabs if t.get("url", "").startswith(url)]
        tab = match[0] if match else tabs[0]

    ws = WS(tab["webSocketDebuggerUrl"])
    try:
        if url and not tab.get("url", "").startswith(url):
            navigate(ws, url)
            settle(ws, cap=cap)
        js = LOCATE_JS % {"mode": json.dumps(mode), "needle": json.dumps(needle), "origin": ORIGIN_JS}
        res = ws.call("Runtime.evaluate",
                      {"expression": js, "returnByValue": True, "awaitPromise": True})
        val = (res.get("result") or {}).get("value")
        if not val:
            print(f"no element matching {mode}={needle!r} on {tab.get('url','')}",
                  file=sys.stderr)
            return None, 4
        if val.get("covered"):
            print(f"{mode}={needle!r} is there but covered by {val.get('by')} on "
                  f"{val.get('url') or tab.get('url','')}; no ring", file=sys.stderr)
            return None, 5
        return val, 0
    finally:
        ws.close()


# ---------------------------------------------------------------- the outline
# What a lesson can point at, READ OFF THE PAGE. Measured 2026-09-17: a live lesson opened
# VisuAlgo and targeted `page-text:Initially, we have N disjoint sets` — wording it had
# guessed, because Ash cannot see the page. No such text existed, so (correctly) no ring was
# drawn, and the step taught nothing on screen. Targets must be COPIED from what is there.
#
# Each entry carries the id of its live node, so a target chosen from this list is pointed at
# by identity (LOCATE_JS mode 'node'), not searched for again. Ids start from the document's
# timeOrigin, so no two documents share one: an id from before a reload finds nothing.
OUTLINE_JS = r"""
(() => {
  const cache = window.__ashPoint = window.__ashPoint ||
    {ids: new WeakMap(), nodes: new Map(), next: Math.round(performance.timeOrigin) * 1000 + 1};
  for (const [id, e] of cache.nodes) if (!e.isConnected) cache.nodes.delete(id);
  const identity = e => {
    if (!cache.ids.has(e)) cache.ids.set(e, cache.next++);
    const id = cache.ids.get(e);
    cache.nodes.set(id, e);
    return id;
  };
  const out = [], seen = new Set();
  const vis = el => {
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4 && parseFloat(getComputedStyle(el).opacity || '1') > 0.05
           && el.checkVisibility({checkOpacity: true, checkVisibilityCSS: true});
  };
  const pick = 'h1,h2,h3,h4,button,a,label,li,th,td,summary,[role=button],[role=tab],p,span,div';
  for (const el of document.querySelectorAll(pick)) {
    if (!vis(el)) continue;
    // own text only, so a container does not repeat all of its children
    let t = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ');
    t = t.replace(/\s+/g, ' ').trim();
    if (t.length < 3 || t.length > 90 || seen.has(t)) continue;
    seen.add(t);
    const r = el.getBoundingClientRect();
    out.push({id: identity(el), tag: el.tagName.toLowerCase(), text: t, top: Math.round(r.top + scrollY)});
    if (out.length >= 80) break;
  }
  return out.sort((a, b) => a.top - b.top);
})()
"""


def outline(url=None):
    try:
        tabs = pages()
    except (urllib.error.URLError, OSError) as e:
        print(f"browser not reachable on {HOST}:{PORT} ({e})", file=sys.stderr)
        return None, 3
    tab = tabs[0]
    if url:
        tab = next((t for t in tabs if t.get("url", "").startswith(url)), tabs[0])
    ws = WS(tab["webSocketDebuggerUrl"])
    try:
        res = ws.call("Runtime.evaluate", {"expression": OUTLINE_JS, "returnByValue": True})
        return (res.get("result") or {}).get("value") or [], 0
    finally:
        ws.close()


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--url")
    ap.add_argument("--css")
    ap.add_argument("--text")
    ap.add_argument("--node", type=int, help="an id printed by --outline")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--outline", action="store_true",
                    help="the visible text on the page, with the node id to point at each")
    a = ap.parse_args()

    if a.list:
        try:
            for t in pages():
                print(f"{t.get('title','')[:50]:52} {t.get('url','')[:90]}")
        except (urllib.error.URLError, OSError) as e:
            print(f"browser not reachable: {e}", file=sys.stderr)
            return 3
        return 0

    if a.outline:
        items, rc = outline(a.url)
        for it in items or []:
            print(f"{it['id']}  {it['tag']:8} {it['text']}")
        return rc

    if not (a.css or a.text or a.node is not None):
        ap.print_usage(sys.stderr)
        return 2
    mode, needle = (("css", a.css) if a.css else ("text", a.text) if a.text
                    else ("node", a.node))
    val, rc = locate(mode, needle, a.url)
    if val:
        print(json.dumps(val))
    return rc


if __name__ == "__main__":
    sys.exit(main())
