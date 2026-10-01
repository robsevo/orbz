"""A tiny OpenAI-compatible client for the spike, pointed at Ash's router (stdlib only).

Every call is written to the run's ledger with its purpose and token counts, because the spike's
whole claim is about tokens. Router fallbacks are DISABLED per request: a fallback chain can end on
a paid seat, and the spike must never spend money (Ash's rule: unattended work never spends).
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = os.environ.get("ORBS_ROUTER", "http://localhost:4000/v1")
# Verified free on 2026-09-30 by reading litellm.yaml: Gemini free tier, NVIDIA NIM trial, OpenRouter :free.
FREE_SEATS = {"bedrock-brain", "think-brain", "cloud-brain", "free-flash", "free-flash25", "free-flash3",
              "nim-ultra", "free-coder", "free-ultra"}


class BrainError(RuntimeError):
    pass


class Brain:
    def __init__(self, model: str, ledger: Path | None = None, timeout: int = 300):
        if model not in FREE_SEATS:
            raise BrainError(f"refusing seat {model!r}: the spike only runs on free seats {sorted(FREE_SEATS)}")
        self.model, self.ledger, self.timeout = model, ledger, timeout

    def chat(self, messages: list[dict], purpose: str, max_tokens: int = 8000) -> dict:
        # The router's per-seat timeout (60 s on think-brain) is shorter than a thinking model needs to
        # write a whole module; a per-request timeout overrides it without touching the router.
        body = {"model": self.model, "messages": messages, "max_tokens": max_tokens, "temperature": 0,
                "disable_fallbacks": True, "timeout": max(30, self.timeout - 10)}
        data = json.dumps(body).encode()
        delay, last = 2.0, None
        tries = 10  # ~7 minutes of patience with the 60 s cap: Gemini's 503 "high demand" passes, but slowly
        for attempt in range(tries):
            req = urllib.request.Request(f"{BASE}/chat/completions", data=data, headers={"Content-Type": "application/json"})
            t0 = time.time()
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    resp = json.loads(r.read())
                break
            except urllib.error.HTTPError as e:
                last = f"HTTP {e.code}: {e.read()[:300]!r}"
                if e.code not in (408, 429, 500, 502, 503, 504):
                    raise BrainError(last) from e
            except (urllib.error.URLError, TimeoutError) as e:
                last = f"{type(e).__name__}: {e}"
            time.sleep(delay)
            delay = min(delay * 2, 60)
        else:
            raise BrainError(f"{self.model} gave up after {tries} tries: {last}")
        text = (resp["choices"][0]["message"].get("content") or "")
        u = resp.get("usage") or {}
        rec = {"ts": time.time(), "purpose": purpose, "model": self.model, "served": resp.get("model"),
               "prompt": int(u.get("prompt_tokens") or 0), "completion": int(u.get("completion_tokens") or 0),
               "latency_s": round(time.time() - t0, 2), "finish": resp["choices"][0].get("finish_reason")}
        rec["total"] = rec["prompt"] + rec["completion"]
        if self.ledger:
            with self.ledger.open("a") as f:
                f.write(json.dumps(rec) + "\n")
        return {"text": text, **rec}


class FreeChain:
    """Try free seats in order; a seat that keeps failing hands over to the next. Never a paid seat."""

    def __init__(self, brains: list[Brain]):
        self.brains = brains
        self.model = "+".join(getattr(b, "model", "?") for b in brains)

    def chat(self, messages, purpose, max_tokens=8000):
        last = None
        for b in self.brains:
            try:
                return b.chat(messages, purpose, max_tokens)
            except BrainError as e:
                last = e
        raise last


def extract_json(text: str):
    """The first JSON object in a reply: a ```json fence if present, else the first balanced {...}."""
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    if m:
        return json.loads(m.group(1))
    start = text.find("{")
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(text)):
            c = text[i]
            if in_str:
                esc = (c == "\\" and not esc)
                if c == '"' and not esc:
                    in_str = False
                continue
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break
        start = text.find("{", start + 1)
    raise ValueError("no JSON object in reply")


def extract_python(text: str) -> str:
    m = re.search(r"```python\s*\n(.*?)```", text, re.S) or re.search(r"```\s*\n(.*?)```", text, re.S)
    if not m:
        raise ValueError("no ```python block in reply")
    return m.group(1)
