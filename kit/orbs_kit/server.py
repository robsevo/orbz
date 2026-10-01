"""The kit as an MCP server over stdio (PLAN 1.3).

The home starts this process, supervises it (restart with backoff, give up loudly on a crash
loop) and calls Ash's carried modules through it, over the same protocol as any connector. Each
tool is a thin wrapper: the behaviour, and its tests, are the carried module's.

stdout is the protocol. The SDK claims file descriptor 1 for the transport and diverts the
process's own stdout, so a carried module that prints cannot corrupt a message
(`kit/tests/test_server.py` proves it with a tool that prints).

    uv run --project kit --locked python -m orbs_kit.server
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any, TypedDict

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT / "ash"))

from mcp.server.mcpserver import MCPServer  # noqa: E402

import redact  # noqa: E402
import secretscan  # noqa: E402
import speakable  # noqa: E402
import statepaths  # noqa: E402
import whenparse  # noqa: E402

from orbs_kit import habits  # noqa: E402

VERSION = "0.0.0"

server = MCPServer(
    name="orbs-kit",
    version=VERSION,
    instructions="Ash's Python kit inside Orbs: spoken text, time phrases, and the honesty checks.",
)


@server.tool(description="Key material in the text, by line and kind (never the key itself).")
def secret_findings(text: str) -> list[str]:
    return secretscan.scan_text(text, "<text>")


@server.tool(description="The text with every key, token and spoken secret masked.")
def redact_text(text: str) -> str:
    return redact.redact(text) or ""


@server.tool(description="A written reply rewritten to be heard: no markdown, paths or machinery.")
def for_the_ear(text: str) -> str:
    return speakable.for_the_ear(text)


class When(TypedDict):
    epoch: int | None
    said: str | None


class HabitAnswer(TypedDict, total=False):
    answered: bool
    output: Any
    why: str
    version: int


class KitStatus(TypedDict):
    version: str
    pid: int
    python: str
    state: str
    brain: str
    carried_files: int
    zone: str
    ash_env: list[str]


@server.tool(description="The instant a phrase like 'tomorrow at 3' names, and how to say it back.")
def when(text: str, now: float | None = None) -> When:
    epoch = whenparse.resolve(text, now)
    return {"epoch": epoch, "said": whenparse.describe(epoch, now) if epoch is not None else None}


@server.tool(description="Let a Python habit answer, if its three code checks agree (PLAN 1.4).")
def habit_answer(habit_dir: str, input: dict) -> HabitAnswer:  # noqa: A002 - the protocol's word
    return habits.answer(Path(habit_dir), input)


@server.tool(description="Store a habit learned from approved (input, output) cases (PLAN 3.2 calls this "
                        "only after the harness re-ran it on every case).")
def habit_learn(habit_dir: str, code: str, approved: list[dict], version: int = 1) -> str:
    habits.save(Path(habit_dir), code, [(c["input"], c["output"]) for c in approved], version)
    return habit_dir


@server.tool(description="Which kit is running, on which Python, with which state directory.")
def kit_status() -> KitStatus:
    carried = KIT / "ash" / "CARRIED.json"
    return {
        "version": VERSION,
        "pid": os.getpid(),
        "python": sys.version.split()[0],
        "state": str(statepaths.config()),
        "brain": str(statepaths.brain()),
        "carried_files": len(json.loads(carried.read_text())) if carried.exists() else 0,
        "zone": str(whenparse.ZONE),
        "ash_env": sorted(k for k in os.environ if k.startswith("ASH_")),
    }


if os.environ.get("ORBS_KIT_TEST_TOOLS") == "1":
    # Only for the supervisor's tests: a call that takes a while (to be killed mid-call), one
    # that kills the process, and one that prints to stdout as a careless module would.

    @server.tool(description="TEST: wait, then answer.")
    async def test_wait(seconds: float) -> str:
        await asyncio.sleep(seconds)
        return f"waited {seconds}"

    @server.tool(description="TEST: the kit dies on purpose.")
    def test_die(code: int = 7) -> str:
        os._exit(code)

    @server.tool(description="TEST: print to stdout, then answer.")
    def test_print(text: str) -> str:
        print(f"a careless module printed: {text}")
        print(f"and again: {text}", flush=True)
        return text


def main() -> None:
    server.run("stdio")


if __name__ == "__main__":
    main()
