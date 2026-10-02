#!/usr/bin/env python3
"""The kit's MCP server, from the kit's own side (PLAN 1.3): it starts on the kit's Python,
lists its tools, answers with Ash's carried modules, and a module that prints cannot corrupt the
protocol. Uses the SDK's own stdio client, so it needs no Node — which is how the fresh-machine
check (tools/fresh_machine.sh) proves the kit works on a box that had no Python at all."""
import asyncio
import os
import shutil
import sys
import tempfile
from pathlib import Path

from mcp import ClientSession, StdioServerParameters, stdio_client

KIT = Path(__file__).resolve().parent.parent
FAIL = []


def ok(cond, label):
    print(f"{'PASS' if cond else 'FAIL'}  {label}")
    if not cond:
        FAIL.append(label)


async def main():
    state = tempfile.mkdtemp(prefix="orbs-kit-server-")
    env = {k: v for k, v in os.environ.items() if not k.startswith("ASH_")}
    env.update(ORBS_KIT_STATE=state, ORBS_BRAIN=state + "/brain", ORBS_KIT_TEST_TOOLS="1")
    params = StdioServerParameters(command=sys.executable, args=["-m", "orbs_kit.server"], cwd=str(KIT), env=env)
    with open(Path(state) / "server.err", "w") as errlog:
        async with stdio_client(params, errlog=errlog) as (read, write):
            async with ClientSession(read, write) as s:
                await s.initialize()
                names = {t.name for t in (await s.list_tools()).tools}
                ok({"secret_findings", "redact_text", "for_the_ear", "when", "kit_status"} <= names,
                   f"SV.1 the kit lists its tools: {sorted(names)}")

                r = await s.call_tool("kit_status", {})
                st = r.structured_content or {}
                ok(st.get("state") == state and st.get("python") == sys.version.split()[0],
                   f"SV.2 it runs on this Python, on the state it was given: {st}")

                r = await s.call_tool("when", {"text": "tomorrow at 3pm", "now": 1790870400})
                ok((r.structured_content or {}).get("said") == "tomorrow at 3 pm",
                   f"SV.3 a carried module answers through the protocol: {r.structured_content}")

                r = await s.call_tool("test_print", {"text": "careless"})
                r2 = await s.call_tool("kit_status", {})
                ok(not r.is_error and (r2.structured_content or {}).get("pid"),
                   "SV.4 a module that prints to stdout does not corrupt the next message")

                r = await s.call_tool("learn_verdict", {"text": "Charts start at zero on the y axis."})
                good = r.structured_content or {}
                r = await s.call_tool("learn_verdict", {"text": "The export tool is broken, never use it."})
                bad = r.structured_content or {}
                ok(good.get("ok") is True and bad.get("ok") is False and bad.get("klass") == "negative" and "capture" in bad.get("reason", ""),
                   f"SV.6 a lesson goes through Ash's learn_gate: a durable one passes, a negative one is refused with what to capture instead ({good}, {bad})")

                r = await s.call_tool("no_such_tool", {})
                ok(r.is_error, "SV.5 CONTROL: an unknown tool is an error, so SV.1-SV.4 are not "
                               "passing on a server that answers everything")


try:
    asyncio.run(main())
except BaseException:
    for f in Path(tempfile.gettempdir()).glob("orbs-kit-server-*/server.err"):
        print(f"the server's stderr:\n{f.read_text()[-3000:]}")
    raise
finally:
    for d in Path(tempfile.gettempdir()).glob("orbs-kit-server-*"):
        shutil.rmtree(d, ignore_errors=True)
print("ALL PASS" if not FAIL else f"{len(FAIL)} FAILED")
sys.exit(1 if FAIL else 0)
