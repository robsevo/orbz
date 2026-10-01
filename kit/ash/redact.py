#!/usr/bin/env python3
"""redact — no key material in a log line, a desk snapshot, or a spoken sentence.

PLAN 13.4. `keys.env` is symlinked into the runtime dir, `desk.json` is rewritten every
second, `pair.log` and `ashd-manual.log` grow all day, and everything Ash hears is logged
verbatim: `log(f"heard {text!r}")`. Say an API key out loud to test the microphone and it is
on disk in three files.

Deliberately NOT a general "sanitiser". It knows a small set of shapes exactly, and is used
at the two places text crosses into something durable — which is why it can afford to be
strict about what it replaces rather than guessing at what looks sensitive.
"""
import re

# Same shapes secretscan hunts in source, plus the ones that only appear at runtime.
PATTERNS = [
    ("openai/anthropic key", re.compile(r"\bsk-[A-Za-z0-9_-]{16,}")),
    ("google api key",       re.compile(r"\bAIza[A-Za-z0-9_-]{30,}")),
    ("github token",         re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}")),
    ("aws access key",       re.compile(r"\bAKIA[A-Z0-9]{12,}")),
    ("slack token",          re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
    ("bearer token",         re.compile(r"([Bb]earer\s+)[A-Za-z0-9_\-.]{20,}")),
    ("private key block",    re.compile(r"-----BEGIN[^-]*PRIVATE KEY-----")),
    # A password or token being SPOKEN, which is how it reaches the transcript at all.
    ("spoken secret",        re.compile(r"(?i)\b(?:password|passphrase|api key|secret) (?:is|=|:)\s*\S+")),
]

MASK = "█" * 6


def redact(text):
    """Return `text` with key material replaced. Length is NOT preserved — a mask that
    matches the original length tells an attacker how long the key was."""
    if not text:
        return text
    s = str(text)
    for _, rx in PATTERNS:
        s = rx.sub(lambda m: (m.group(1) + MASK) if m.groups() else MASK, s)
    return s


def findings(text):
    """What redact() would remove, by name. For a privacy scan that must report rather
    than silently clean."""
    return [name for name, rx in PATTERNS if rx.search(str(text or ""))]
