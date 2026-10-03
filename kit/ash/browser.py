"""The browser pagecheck asks (PLAN 4.1): Orbs' own, in place of Ash's `browser`.

Ash's pagecheck renders a page in a Chrome it reaches over CDP: his visible one when it is
debuggable, else a headless copy on port 9223 with a profile of its own. Neither is right in the
kit. The person's own Chrome (which may listen on 9222, for Ash) must never be asked, and a fixed
port would be shared with Ash's own headless copy on the same machine. So here:

  inspector() and headless_inspector() are one thing: a headless Chromium of THIS process's own,
    on a port the OS picks, with a throwaway profile, stopped (its profile deleted) when the
    process that started it exits
  cdp_up() asks a port, never a default one: PORT is 0, which nothing listens on
  chrome_bin() is $ORBS_CHROME, else a Chromium or Chrome on the PATH, else Playwright's own

The names and their meanings are Ash's (`browserservice.inspector`, `headless_inspector`,
`HEADLESS_PORT`, `cdp_up`, `chrome_bin`), so his pagecheck and its suite run unchanged.
"""
import atexit
import glob
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

# Never anyone's browser: nothing listens on port 0.
PORT = 0
# The port of this process's own headless Chromium, once it is up.
HEADLESS_PORT = None
_proc = None
_profile = None
_registered = False


def _real_home():
    """The real home, for Playwright's cache: the carried suites run with HOME pointed at an
    empty directory, and a Chromium binary is not state."""
    try:
        import pwd
        return Path(pwd.getpwuid(os.getuid()).pw_dir)
    except (ImportError, KeyError, AttributeError):
        return Path.home()


def chrome_bin():
    env = os.environ.get("ORBS_CHROME")
    if env and os.path.exists(env):
        return env
    for name in ("chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "chrome"):
        found = shutil.which(name)
        if found:
            return found
    home = _real_home()
    for pattern in (".cache/ms-playwright/chromium-*/chrome-linux*/chrome",
                    "Library/Caches/ms-playwright/chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium",
                    "AppData/Local/ms-playwright/chromium-*/chrome-win*/chrome.exe"):
        hits = sorted(glob.glob(str(home / pattern)), reverse=True)
        if hits:
            return hits[0]
    mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    return mac if os.path.exists(mac) else None


def cdp_up(timeout=1.5, port=None):
    port = port or PORT
    if not port:
        return False
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=timeout)
        return True
    except Exception:
        return False


def _stop():
    global _proc, _profile, HEADLESS_PORT
    if _proc is not None and _proc.poll() is None:
        _proc.terminate()
        try:
            _proc.wait(5)
        except subprocess.TimeoutExpired:
            _proc.kill()
            _proc.wait(5)
    if _profile:
        shutil.rmtree(_profile, ignore_errors=True)
    _proc = _profile = HEADLESS_PORT = None


def _start(exe, sandbox, timeout):
    """Starts one headless Chromium on a port the OS picks; its port, or None."""
    global _proc, _profile, HEADLESS_PORT, _registered
    _profile = tempfile.mkdtemp(prefix="orbs-pagecheck-")
    argv = [exe, "--headless=new", "--remote-debugging-port=0", f"--user-data-dir={_profile}",
            "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-extensions"]
    if not sandbox:
        argv.append("--no-sandbox")
    _proc = subprocess.Popen(argv + ["about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not _registered:
        atexit.register(_stop)
        _registered = True
    active = Path(_profile) / "DevToolsActivePort"
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _proc.poll() is not None:
            break
        try:
            port = int(active.read_text().split()[0])
        except (OSError, ValueError, IndexError):
            time.sleep(0.2)
            continue
        if cdp_up(port=port):
            HEADLESS_PORT = port
            return port
        time.sleep(0.2)
    _stop()
    return None


def headless_inspector(timeout=15):
    """A CDP port on this process's own headless Chromium, started if it is not up."""
    if HEADLESS_PORT and cdp_up(port=HEADLESS_PORT):
        return HEADLESS_PORT
    exe = chrome_bin()
    if not exe:
        return None
    # Chromium's own sandbox where it can start (it cannot as root, nor in most containers)
    return _start(exe, True, timeout) or _start(exe, False, timeout)


def inspector(timeout=15):
    """In the kit, looking and showing are never the person's browser: the same as headless."""
    return headless_inspector(timeout)
