#!/usr/bin/env python3
"""secretscan, asserted. Run: orb/daemon/.venv/bin/python orb/daemon/test_secretscan.py

S.0 is the control. A secret scanner that reports clean is indistinguishable from one that
looks at nothing — and this project has shipped exactly that once already: the first CSP
detector caught 0 of 2 planted violations while calling all 16 pages clean.
SECRETSCAN-FIXTURES: this file holds synthetic key material on purpose — it cannot prove a
scanner catches a key without showing it one. `tools/release_gate.py` exempts it from G1, and
that exemption is the AGREEMENT of this line and an entry in its FIXTURE_FILES list: neither
half works alone, so this file cannot exempt itself and the list cannot keep covering it
after it stops being a fixture suite. Nothing here is a real credential.
"""

# secretscan-fixtures: this file contains planted keys on purpose
# They are planted so the redaction and scanning suites can prove they DETECT a
# key, which a fixture the detector misses cannot do. `secretscan.FIXTURES` pins
# the count: one more is a real key in a file nobody scans, one fewer is a suite
# that stopped testing. Change the fixtures and you change that number on purpose.
import sys

import secretscan as ss

FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


# --- S.0  CONTROL: every pattern must catch a planted secret ----------------------------
PLANTS = {
    "openai/anthropic key": 'KEY = "sk-abc123DEF456ghi789JKL012mno"',
    "google api key":       'k = "AIzaSyD-1234567890abcdefghijklmnopqrstu"',
    "github token":         'tok = "ghp_0123456789abcdefghijklmnopqrstuvwxyz"',
    "aws access key":       'aws = "AKIA2QRSTUVWXYZ12345"',
    "slack token":          'sl = "xoxb-1234567890-abcdefghijklmnop"',
    "private key block":    "-----BEGIN RSA PRIVATE KEY-----",
    "bearer literal":       'h = "Bearer abcdefghijklmnopqrstuvwxyz012345"',
    "assigned secret":      'password = "hunter2hunter2hunter2"',
}
for label, line in PLANTS.items():
    hits = ss.scan_text(line, "probe")
    ok(any(label in h for h in hits), f"S.0 CONTROL: {label!r} is caught")

ok(len(ss.PATTERNS) == len(PLANTS),
   f"S.0 every pattern has a planted control ({len(ss.PATTERNS)} patterns, {len(PLANTS)} plants)")

# --- S.1  a finding never prints the secret itself ---------------------------------------
hits = ss.scan_text('KEY = "sk-abc123DEF456ghi789JKL012mno"', "probe")
ok(hits and "sk-abc123DEF456ghi789JKL012mno" not in hits[0],
   "S.1 the finding is redacted — a scanner that echoes the key into a log has moved it")
ok(hits and "chars" in hits[0], "S.1 but it says how long the thing was")

# --- S.2  placeholders and env reads are not secrets --------------------------------------
for safe in (
    'key = os.environ.get("OPENAI_API_KEY", "sk-noop")',   # ashd.py:312 and :381, verbatim
    'token = process.env.GITHUB_TOKEN',
    'api_key = "your-key-here"',
    'password = "<redacted>"',
    'secret = "${VAULT_SECRET}"',
    'api_key = "example-not-a-real-key"',
):
    ok(ss.scan_text(safe, "probe") == [], f"S.2 not a secret: {safe[:44]!r}")

# --- S.2b  a placeholder word on the LINE must not excuse a real key in the MATCH ---------
ok(ss.scan_text('# example: KEY = "sk-abc123DEF456ghi789JKL012mno"', "probe") != [],
   "S.2b a comment saying 'example' does not suppress a real key on the same line")

# --- S.3  short values are not secrets ----------------------------------------------------
ok(ss.scan_text('password = "abc"', "probe") == [], "S.3 a three-character value is not key material")

# --- S.4  the real tracked tree is clean, and the scan actually opened files --------------
files = [f for f in ss.tracked()
         if f.suffix.lower() not in ss.SKIP_SUFFIX and f.is_file()]
ok(len(files) > 50, f"S.4 the scan sees the real tree ({len(files)} files)")
# Through `scan_tree`, the SAME traversal `main()` uses. This used to call `scan_text`
# directly, which meant it neither applied the fixture exemption nor keyed on the same path
# shape (absolute here, relative there) — two copies of one loop, already disagreeing.
real, seen = ss.scan_tree()
ok(seen == len(files), f"S.4 the shared traversal sees the same files ({seen} vs {len(files)})")
ok(real == [], "S.4 no tracked file carries key material:\n      " + "\n      ".join(real))

# --- S.5  --history, end to end, against a throwaway repository --------------------------
# `--history` delegates to `release_gate.secrets_in_history` (D176), and after that rewrite
# NOTHING exercised it: the delegating branch only runs under `--history`, and a scan with no
# findings prints the same line whether it looked at the pack or not. So the one way to know
# it works is to commit a key, delete it, and require the exit code to change.
#
# Into a `git init` in a tempdir, never this repository — the pack is the thing the check
# exists to protect, and a test for committed keys must not be the reason one is committed.
import subprocess as _sub, tempfile as _tmp, shutil as _sh, pathlib as _pl

_d = _pl.Path(_tmp.mkdtemp(prefix="ss-history-"))


def _git(*a):
    return _sub.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", *a],
                    cwd=_d, capture_output=True, text=True)


def _scan(*extra):
    return _sub.run([sys.executable, str(_pl.Path(__file__).resolve().parent/"secretscan.py"),
                     "--root", str(_d), *extra], capture_output=True, text=True)


_git("init", "-q", "-b", "master")
(_d/"leak.py").write_text('TOKEN = "ghp_' + "A1b2C3d4E5" * 4 + '"\n')
_git("add", "-A"); _git("commit", "-q", "-m", "leak")
_before = _scan("--history")
ok(_before.returncode == 1, "S.5a CONTROL: a committed key is found while it is still present")

(_d/"leak.py").unlink()
_git("add", "-A"); _git("commit", "-q", "-m", "removed")
_tree, _hist = _scan(), _scan("--history")
ok(_tree.returncode == 0,
   f"S.5b CONTROL: with the file deleted the WORKING TREE is clean ({_tree.returncode})")
ok(_hist.returncode == 1,
   "S.5c --history still finds it — a key deleted from the tree is still in the pack")
ok("blob" in (_hist.stdout + _hist.stderr),
   f"S.5d ...and says which blob, so it can be acted on: {(_hist.stdout + _hist.stderr)[-160:]!r}")

# A binary blob used to kill this path outright: `text=True` raises on the first PNG, so the
# scan produced a traceback rather than a verdict. A check that dies is not a check that
# reported, and a history worth scanning always has binaries in it.
(_d/"logo.png").write_bytes(bytes(range(256)) * 40)
_git("add", "-A"); _git("commit", "-q", "-m", "binary")
_bin = _scan("--history")
ok(_bin.returncode == 1 and "Traceback" not in (_bin.stdout + _bin.stderr),
   f"S.5e a binary blob does not kill the scan: rc={_bin.returncode} "
   f"{(_bin.stdout + _bin.stderr)[-200:]!r}")
_sh.rmtree(_d, ignore_errors=True)

# ── S.6  the fixture exemption cannot be used to hide a real key (PLAN 2.10) ──────────
#
# This scanner's own test data has to look exactly like a secret — a fixture the detector
# misses proves nothing — and for as long as these files were UNTRACKED the scan never saw
# them: `tracked()` asks `git ls-files`. The first `git add -A` of this tree produced 27
# findings, all planted. So there is an exemption now, and an exemption in a security gate
# is only as good as the checks that it cannot be widened quietly.
_FX = "kit/ash/test_redact.py"
_txt = (ss.ROOT/_FX).read_text()
_real = ss.scan_text(_txt, _FX)

_kept, _why = ss.fixture_verdict(_FX, _txt, _real)
ok(_kept == [] and _why is None,
   f"S.6a a declared fixture file at its declared count is clean: {_why}")

_kept, _why = ss.fixture_verdict(_FX, _txt, _real + ["planted: one more"])
ok(_kept and _why and "More means a real one" in _why,
   f"S.6b CONTROL: ONE MORE finding than declared fails — that is a real key arriving in a "
   f"file nobody scans any more: {_why}")

_kept, _why = ss.fixture_verdict(_FX, _txt, _real[:-1])
ok(_kept and _why and "stopped matching" in _why,
   f"S.6c CONTROL: one FEWER fails too — a fixture that stopped matching is a suite that "
   f"stopped testing, which is what this scanner exists to prevent: {_why}")

_kept, _why = ss.fixture_verdict(_FX, _txt.replace("# " + ss.FIXTURE_MARKER, "# gone", 1), _real)
ok(_kept and _why and "does not declare itself" in _why,
   f"S.6d CONTROL: the file must DECLARE itself — the exemption lives in the file it "
   f"exempts, so it is visible to whoever edits it: {_why}")

_kept, _why = ss.fixture_verdict("kit/ash/common.py", "x = 1", _real)
ok(_kept == _real and _why is None,
   "S.6e CONTROL: a file that is NOT declared keeps every finding — the exemption did not "
   "weaken the general case")

ok(set(ss.FIXTURES) == {"kit/ash/test_redact.py", "kit/ash/test_secretscan.py"},
   f"S.6f the exempt list is exactly the three suites that test detection — a new entry "
   f"here is a deliberate, reviewable act: {sorted(ss.FIXTURES)}")

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print(f"✓ secretscan: 6 groups green, {len(ss.PATTERNS)} patterns each proven by a plant, "
      "and --history proven against a committed-then-deleted key")
