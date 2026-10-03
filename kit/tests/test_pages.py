#!/usr/bin/env python3
"""A page an orb built, checked (PLAN 4.1): kit/orbs_kit/pages.py runs Ash's carried pagecheck on
a page in a workspace, served from the workspace for the check only. Both ways, as Ash's own suite
asks of pagecheck: an unstyled page fails for being unstyled, a styled one passes. The browser it
looks with is the kit's own (kit/ash/browser.py): never a default port, a throwaway profile, gone
when the check is. A path out of the workspace, by name or by a link, is never served."""
import os
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT))
sys.path.insert(0, str(KIT / "ash"))
import browser  # noqa: E402
from orbs_kit import pages  # noqa: E402

FAIL = []


def ok(cond, label):
    print(f"{'PASS' if cond else 'FAIL'}  {label}")
    if not cond:
        FAIL.append(label)


# the kit's browser is never anyone else's: no default port, and nothing listens on port 0
ok(browser.PORT == 0 and not browser.cdp_up(), "PG.0 the kit's browser has no default port: it never asks the person's Chrome (9222) or Ash's (9223)")

CLASSES = " ".join(f"p-{i} bg-red-{i}00 rounded-lg flex" for i in range(1, 6))
MARKUP = "".join(f'<div class="{CLASSES}">card {i}</div>' for i in range(30))
STYLED = "\n".join([f".c{i} {{ padding: {i}px; }}" for i in range(40)] + ["div { display: flex; padding: 8px; background: #222; border-radius: 4px; }"])
PAGE = '<!doctype html><html><head><title>t</title><link rel="stylesheet" href="style.css"></head><body>{}</body></html>'

with tempfile.TemporaryDirectory(prefix="orbs-pages-") as d:
    ws = Path(d) / "workspace"
    for name, css in (("done", STYLED), ("unstyled", "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n")):
        (ws / "site" / name).mkdir(parents=True)
        (ws / "site" / name / "style.css").write_text(css)
        (ws / "site" / name / "index.html").write_text(PAGE.format(MARKUP))
    (Path(d) / "secret.txt").write_text("not in the workspace")
    os.symlink(Path(d) / "secret.txt", ws / "site" / "done" / "link.txt")

    v = pages.check(root=str(ws), path="site/unstyled/index.html")
    ok(v["verdict"] == "fail", f"PG.1 an unstyled page is not done: {v['verdict']}")
    ok("unprocessed @tailwind" in v["report"] or "compiled to nothing" in v["report"], f"PG.1 for the reason it is: its stylesheet never compiled: {v['report'][-300:]}")

    renders = bool(browser.chrome_bin())
    v = pages.check(root=str(ws), path="site/done/index.html")
    if renders:
        ok(v["verdict"] == "pass", f"PG.2 a styled page passes (the check does not fail everything): {v['report'][-300:]}")
        ok("look styled" in v["report"], "PG.2 and it was rendered and looked at, not only fetched")
    else:
        print("  (no Chromium on this machine: PG.2 needs one; with nothing to look, a pass is impossible)")
        ok(v["verdict"] == "inconclusive", "PG.2 with nothing able to render, the verdict is never a pass")

    ok(pages.check(root=str(ws), path="../secret.txt")["verdict"] == "fail", "PG.3 a path out of the workspace is refused")
    httpd, base = pages.serve(str(ws))
    try:
        try:
            urllib.request.urlopen(base + "site/done/link.txt", timeout=5)
            ok(False, "PG.3 a link out of the workspace is not served")
        except urllib.error.HTTPError as e:
            ok(e.code == 404, "PG.3 a link out of the workspace is not served (404)")
        try:
            urllib.request.urlopen(base + "site/", timeout=5)
            ok(False, "PG.3 a folder is not listed")
        except urllib.error.HTTPError as e:
            ok(e.code == 404, "PG.3 a folder is not listed")
        body = urllib.request.urlopen(base + "site/done/style.css", timeout=5).read().decode()
        ok("display: flex" in body, "PG.3 CONTROL: a file inside it is served")
    finally:
        httpd.shutdown()
        httpd.server_close()

    ok(pages.check(root=str(ws), path="site/none.html")["verdict"] == "fail", "PG.4 a page that is not there is not done")
    ok(browser.HEADLESS_PORT is None, "PG.5 no browser of the kit's is left running in this process (each check's is its own)")

print("ALL PASS" if not FAIL else f"{len(FAIL)} FAILED")
sys.exit(1 if FAIL else 0)
