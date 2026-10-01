#!/usr/bin/env python3
"""Log redaction, asserted. Run: orb/daemon/.venv/bin/python test_redact.py

PLAN 13.4. Everything Ash hears is logged verbatim and those logs are kept for days, so
saying an API key out loud to test the microphone puts it on disk in three files.

E.0 is the control, and it is the one that matters: a redactor that returns its input
unchanged passes every "no key in the output" check trivially, because there was no key in
the *test* either. Each pattern is shown a real-shaped secret it must remove.
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

import redact

FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


PLANTS = {
    "openai/anthropic key": "use sk-abc123DEF456ghi789JKL012mno now",
    "google api key":       "key=AIzaSyD-1234567890abcdefghijklmnopqrstu",
    "github token":         "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
    "aws access key":       "AKIAIOSFODNN7ABCDEFG",
    "slack token":          "xoxb-1234567890-abcdefghijklmnop",
    "bearer token":         "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123",
    "private key block":    "-----BEGIN RSA PRIVATE KEY-----",
    "spoken secret":        "my password is hunter2hunter2",
}

# ── E.0  CONTROL ───────────────────────────────────────────────────────────────────────
ok(len(PLANTS) == len(redact.PATTERNS),
   f"E.0 every pattern has a plant ({len(redact.PATTERNS)} patterns, {len(PLANTS)} plants) — "
   f"a pattern with no control is a pattern nobody has seen work")
for name, text in PLANTS.items():
    ok(name in redact.findings(text), f"E.0 CONTROL: {name!r} is detected in {text[:34]!r}")
    out = redact.redact(text)
    ok(out != text, f"E.0 CONTROL: {name!r} is actually removed, not just detected")

# ── E.1  the secret itself never survives ──────────────────────────────────────────────
for name, text in PLANTS.items():
    out = redact.redact(text)
    secret = max(text.split(), key=len)
    ok(secret not in out, f"E.1 the {name} value is gone from the output")

# ── E.2  the mask does not leak the length ─────────────────────────────────────────────
short = redact.redact("sk-abc123DEF456ghi789JKL0")
long_ = redact.redact("sk-abc123DEF456ghi789JKL012mno456pqr789stu012vwx")
ok(len(short) == len(long_),
   "E.2 a short and a long key redact to the same width — a length-preserving mask tells "
   "you how long the key was")

# ── E.3  ordinary speech is untouched ──────────────────────────────────────────────────
for benign in ("open the weather panel", "build me a landing page for a surf school",
               "what's on my calendar tomorrow", "stop", "",
               "the password field is on the left"):     # talking ABOUT a password
    ok(redact.redact(benign) == benign, f"E.3 untouched: {benign[:40]!r}")
ok(redact.findings("the password field is on the left") == [],
   "E.3 'password' as a word is not a secret — only `password is <value>` is")

# (cut in the Orbs kit: see kit/ash/CARRIED.md)

# ── E.5  None and non-strings do not raise ─────────────────────────────────────────────
ok(redact.redact(None) is None, "E.5 None passes through")
ok(redact.redact(1234) == "1234", "E.5 a number is stringified, not raised on")

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print(f"✓ redact: 6 groups green, {len(redact.PATTERNS)} patterns each proven by a plant")
