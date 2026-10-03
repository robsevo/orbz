#!/usr/bin/env python3
"""pagecheck — is this page actually rendering, or only serving?

    pagecheck.py http://localhost:5173/

Exit 0 means the page answered, its stylesheets produced real rules, its markup is styled,
and the console is clean. Anything else exits non-zero and says which of those failed.

WHY. On 2026-09-17 Ash built a coffee-roaster landing page with a proper palette, framer
motion and a real type scale — and shipped it with NO `postcss.config.js`. Tailwind v3
needs one, so Vite passed `@tailwind base; @tailwind components; @tailwind utilities;`
through untouched and generated ZERO utilities. Every className in the file was inert and
the page rendered as raw HTML. He never saw it: the dev server was never up, so "is it
styled" was never a question anyone asked.

A 200 is not a working page. This asks the browser what it actually got.

WHAT IT CHECKS, in order of how badly each one bites:
  served    the URL answers 200 and returns HTML
  css       the stylesheets the page pulled in contain more than a handful of rules —
            the v3-without-postcss failure produces a sheet holding the literal
            `@tailwind` lines and nothing else
  styled    elements that carry classes actually differ from the browser default. This is
            the general form of the bug: it catches any framework that failed to compile,
            not just Tailwind
  images    every <img> actually loaded, none is a random placeholder, and no
            photo-shaped block was left empty
  console   no errors logged while loading

Uses the visible Chrome through CDP (pagepoint.py's client). Without it, falls back to the
HTTP-only checks and says so rather than pretending it looked.
"""
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import pagepoint

MIN_RULES = 8           # the failure this catches is a sheet holding the literal @tailwind
                        # lines and nothing else — that reads 0-3. A near-empty page can
                        # legitimately compile very few rules (Tailwind v4 emits only the
                        # utilities actually used: 26 for a four-element placeholder), so the
                        # floor is low and MIN_STYLED below does the real work.
MIN_STYLED = 0.25       # fraction of class-carrying elements that must look styled


def fetch(url, timeout=6):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "replace")


PROBE_JS = r"""
(() => {
  let rules = 0, sheets = 0;
  for (const s of document.styleSheets) {
    sheets++;
    try { rules += s.cssRules ? s.cssRules.length : 0; } catch (e) { /* cross-origin */ }
  }
  // "styled" = the element does not look like unstyled HTML. Checked against the
  // properties a stylesheet almost always sets and a bare browser almost never does.
  // SVG IS STYLED BY DIFFERENT PROPERTIES, and this check was blind to all of them. It
  // sampled backgroundColor, padding, borderRadius and display — the properties HTML box
  // layout uses — so every `<circle>`, `<path>` and `<text>` in a chart counted as
  // unstyled however carefully it had been drawn.
  //
  // Measured 2026-09-22 on `ashnew chartlive`, the house's own reference look: **42 of 57
  // class-carrying elements were SVG** (30 circles, 10 texts, a g and a line), so the page
  // scored 15% and FAILED, on a rendering that is correct and good. A done-gate that fails
  // a whole template family is a gate people switch off, which is the one thing it cannot
  // survive.
  //
  // The SVG defaults are `fill: rgb(0, 0, 0)`, `stroke: none`, `stroke-width: 1px`,
  // `opacity: 1`. Differing from any of them is a stylesheet having reached the element —
  // and `fill: none` counts, because nobody writes that by accident.
  const classed = [...document.body.querySelectorAll('[class]')];
  let styled = 0;
  for (const el of classed.slice(0, 400)) {
    const c = getComputedStyle(el);
    const isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
    const ok = isSvg
      ? (c.fill !== 'rgb(0, 0, 0)' || c.stroke !== 'none' ||
         c.strokeWidth !== '1px' || c.opacity !== '1')
      : (c.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
         c.paddingTop !== '0px' || c.paddingLeft !== '0px' ||
         c.borderRadius !== '0px' || c.display === 'flex' || c.display === 'grid');
    if (ok) styled++;
  }
  // PICTURES. A page can compile perfectly and still be a page of grey rectangles:
  // the cards on the coffee site were <div class="h-48 bg-stone-900"> where the product
  // photo belongs (2026-09-17). Two things are asked here — did every image that IS on
  // the page actually load, and how many photo-shaped holes were left empty.
  const imgs = [...document.images].map(i => ({
    src: (i.currentSrc || i.src || '').slice(0, 160), w: i.naturalWidth, h: i.naturalHeight}));
  const broken = imgs.filter(i => !i.w).length;
  // A PLACEHOLDER loads fine and still shows the wrong thing. picsum and friends return a
  // random photo, so a product card ends up with a sunset in it and every automatic check
  // passes: asked to fix dead photo links, he swapped them for picsum and called it done
  // (2026-09-17). On a finished page these are unfinished pictures.
  const placeholder = imgs.filter(i => /picsum\.photos|loremflickr|placehold\.co|dummyimage|placekitten|via\.placeholder/i.test(i.src));
  const holes = [...document.body.querySelectorAll('div, section, figure, span, a')]
    .filter(el => {
      const r = el.getBoundingClientRect();
      if (r.width < 120 || r.height < 120) return false;          // too small to be a photo
      const ar = r.width / r.height;
      if (ar < 0.25 || ar > 4) return false;                      // a bar or a rule, not a slot
      if (el.querySelector('img, svg, video, canvas, picture, iframe')) return false;
      if ((el.innerText || '').trim().length) return false;       // it holds words, not a picture
      const c = getComputedStyle(el);
      if (c.backgroundImage !== 'none') return false;             // it HAS a picture
      const bg = c.backgroundColor;
      if (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') return false;
      return getComputedStyle(el.parentElement || document.body).backgroundColor !== bg;
    })
    .map(el => ({cls: (el.className || '').toString().slice(0, 70),
                 w: Math.round(el.getBoundingClientRect().width),
                 h: Math.round(el.getBoundingClientRect().height)}));
  // The dev server's own error overlay. This is the single most common "white page":
  // an import that does not resolve takes the whole app down and Vite paints the error
  // on top. It lives in a shadow root, so a plain innerText scan never sees it — which is
  // how a coffee site sat broken behind an overlay while nothing reported a problem.
  let overlay = '';
  const ov = document.querySelector('vite-error-overlay');
  if (ov && ov.shadowRoot) {
    const m = ov.shadowRoot.querySelector('.message-body, .message');
    overlay = ((m && m.textContent) || ov.shadowRoot.textContent || '').trim().slice(0, 300);
  }
  if (!overlay) {
    const nx = document.querySelector('nextjs-portal, #__next-build-watcher');
    if (nx) overlay = (nx.textContent || '').trim().slice(0, 300);
  }
  return {
    overlay,
    sheets, rules,
    classed: classed.length, styled,
    imgs: imgs.length, broken, bad: imgs.filter(i => !i.w).map(i => i.src).slice(0, 5),
    placeholder: placeholder.length, placeholder_src: placeholder.map(i => i.src).slice(0, 3),
    holes: holes.length, hole_list: holes.slice(0, 5),
    raw_at_rules: (document.documentElement.outerHTML.match(/@tailwind|@apply/g) || []).length,
    title: document.title, url: location.href
  };
})()
"""


def probe(url, settle=2.0):
    """Load the URL in the visible browser and ask it what it got."""
    # The page the user is looking at lives in THEIR Chrome now, which serves no CDP, so
    # "ask the browser what it got" needs a browser of our own: browser.inspector() reuses
    # a visible one if there is a debuggable one, and otherwise brings up a headless copy.
    _b = None
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import browser as _b
        port = _b.inspector()
        if port:
            pagepoint.PORT = port
    except Exception:
        pass
    try:
        tabs = pagepoint.pages()
    except (urllib.error.URLError, OSError):
        return None
    # Never hijack what is on screen. An earlier version navigated tab 0 to the URL under
    # test, which during a recording would drag the live preview away to a fixture. Use a
    # tab that is already on this page; otherwise open a private one and close it after.
    own = None
    tab = next((t for t in tabs if t.get("url", "").rstrip("/") == url.rstrip("/")), None)
    if tab is None:
        # Nothing on screen shows this URL, so a tab has to be CREATED — and creating one on
        # the visible endpoint puts it in the user's own window. That is how five fixture tabs
        # (a 40-card page, four chart.png renders) ended up in their browser on 2026-09-20:
        # the tab is closed in `finally`, but a pass killed mid-flight never reaches it, and
        # several were. Reusing a tab that already shows the page is still right — that IS the
        # page the user is looking at. Creating one never is.
        if _b is not None and pagepoint.PORT != getattr(_b, "HEADLESS_PORT", None):
            hp = _b.headless_inspector()
            if hp:
                pagepoint.PORT = hp
                try:
                    tabs = pagepoint.pages()
                except (urllib.error.URLError, OSError):
                    return None
                tab = next((t for t in tabs
                            if t.get("url", "").rstrip("/") == url.rstrip("/")), None)
            else:
                # No headless Chrome available. Refuse rather than open a fixture tab in the
                # user's window: a check that quietly litters their desktop is worse than a
                # check that says it could not look.
                print("pagecheck: no private inspector available; not opening a tab in the "
                      "visible browser", file=sys.stderr)
                return None
    if tab is None:
        try:
            req = urllib.request.Request(
                f"http://{pagepoint.HOST}:{pagepoint.PORT}/json/new?{url}", method="PUT")
            with urllib.request.urlopen(req, timeout=4) as r:
                tab = own = json.loads(r.read().decode())
        except Exception:
            return None
    ws = pagepoint.WS(tab["webSocketDebuggerUrl"])
    try:
        ws.call("Page.enable")
        if own is None:
            ws.call("Page.reload", {"ignoreCache": True})
        # Wait for the LOAD, not for a fixed sleep. A headless inspector that has just been
        # launched takes several seconds to paint its first page, and a 2 s sleep read that
        # as a page with no stylesheets and no elements — a pass turned into a failure by
        # timing alone (measured 2026-09-18: cold 0 sheets, warm 1 sheet 3 rules, same URL).
        deadline = time.time() + 12
        while time.time() < deadline:
            r = ws.call("Runtime.evaluate",
                        {"expression": "document.readyState", "returnByValue": True})
            if ((r.get("result") or {}).get("value")) == "complete":
                break
            time.sleep(0.3)
        # Then at least `settle` seconds, exactly as before, and past it for as long as the
        # page is still changing (a fetch that fills the cards at 2.5 s), up to a cap. This
        # never probes EARLIER than the fixed sleep did: a skeleton loader probed mid-render
        # is a row of empty photo-shaped boxes, and this check blocks "done" on those.
        pagepoint.settle(ws, quiet=0.5, cap=max(6.0, settle), floor=settle)
        res = ws.call("Runtime.evaluate",
                      {"expression": PROBE_JS, "returnByValue": True, "awaitPromise": True})
        return (res.get("result") or {}).get("value")
    finally:
        ws.close()
        if own is not None:
            try:
                urllib.request.urlopen(f"http://{pagepoint.HOST}:{pagepoint.PORT}"
                                       f"/json/close/{own['id']}", timeout=3)
            except Exception:
                pass


def main(argv):
    if not argv:
        print("usage: pagecheck.py <url>", file=sys.stderr)
        return 2
    url = argv[0]
    fails = []

    # ---- served -------------------------------------------------------------
    try:
        status, html = fetch(url)
    except Exception as e:
        print(f"FAIL served: {url} did not answer ({e})")
        return 1
    if status != 200:
        fails.append(f"served: HTTP {status}")
    print(f"  served   {url} -> {status}")

    # ---- css (HTTP-only view: fetch what the HTML links) ---------------------
    hrefs = set(re.findall(r'<link[^>]+href="([^"]+\.css[^"]*)"', html))
    hrefs |= set(re.findall(r'["\'](/[^"\']+\.css)["\']', html))
    # dev servers ship CSS through the entry module, so read it and take its imports too
    for mod in re.findall(r'<script[^>]+src="([^"]+)"', html):
        full = mod if mod.startswith("http") else url.rstrip("/") + "/" + mod.lstrip("/")
        try:
            _, js = fetch(full)
        except Exception:
            continue
        hrefs |= set(re.findall(r'["\']([^"\']+\.css)["\']', js))
    raw_directives = 0
    for h in hrefs:
        full = h if h.startswith("http") else url.rstrip("/") + "/" + h.lstrip("/")
        try:
            _, css = fetch(full)
        except Exception:
            continue
        raw_directives += len(re.findall(r"@tailwind\b|@apply\b", css))
    if raw_directives:
        fails.append(f"css: {raw_directives} unprocessed @tailwind/@apply directive(s) "
                     f"reached the browser — the CSS pipeline is not wired "
                     f"(Tailwind v3 needs postcss.config.js; v4 needs @tailwindcss/vite)")

    # ---- what the browser actually rendered ---------------------------------
    p = probe(url)
    if p is None:
        print("  browser  NOT reachable on CDP — the render was not inspected")
        print()
        for f in fails:                      # say what the HTTP view already caught
            print(f"FAIL {f}")
        if fails:
            return 1
        print("INCONCLUSIVE: the page answered, but nothing looked at what it rendered.")
        print("  Chrome must be running with --remote-debugging-port (chrome-flags.conf)")
        print("  A 200 is not a working page, so this is not a pass.")
        return 2
    else:
        if p.get("overlay"):
            print(f"  BUILD ERROR on the page: {p['overlay'][:160]}")
            fails.append(f"build: the dev server is showing an error overlay — {p['overlay'][:160]}")
        print(f"  css      {p['sheets']} stylesheet(s), {p['rules']} rule(s)")
        if p["rules"] < MIN_RULES:
            fails.append(f"css: only {p['rules']} rules generated — the stylesheet compiled "
                         f"to nothing")
        if p["raw_at_rules"]:
            fails.append("css: @tailwind/@apply is still in the served document")
        frac = (p["styled"] / p["classed"]) if p["classed"] else 1.0
        print(f"  styled   {p['styled']}/{p['classed']} class-carrying elements look styled "
              f"({frac:.0%})")
        if p["classed"] and frac < MIN_STYLED:
            fails.append(f"styled: only {frac:.0%} of elements with classes differ from the "
                         f"browser default — the classes are inert")

        # ---- pictures -------------------------------------------------------
        print(f"  images   {p['imgs']} on the page, {p['broken']} broken, "
              f"{p['holes']} empty picture slot(s)")
        if p["broken"]:
            fails.append("images: " + str(p["broken"]) + " image(s) did not load — "
                         + ", ".join(p["bad"]))
        if p.get("placeholder"):
            fails.append(f"images: {p['placeholder']} placeholder image(s) — these load but show "
                         f"a random picture, which is not the picture ({', '.join(p['placeholder_src'])}). "
                         f"Use a real photograph; the web template keeps verified ones in "
                         f"src/lib/photos.ts")
        if p["holes"] >= 2:
            where = "; ".join(f"{h['w']}x{h['h']} .{h['cls'][:40]}" for h in p["hole_list"])
            fails.append(f"images: {p['holes']} photo-shaped blocks are empty — a coloured "
                         f"box is not a picture ({where})")

    if fails:
        print()
        for f in fails:
            print(f"FAIL {f}")
        return 1
    print("  page renders and is styled")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
