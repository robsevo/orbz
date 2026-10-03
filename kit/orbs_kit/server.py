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
import threading
from pathlib import Path
from typing import Any, TypedDict

KIT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(KIT / "ash"))

from mcp.server.mcpserver import Context, MCPServer  # noqa: E402
import mcp.types as mcp_types  # noqa: E402

import redact  # noqa: E402
import secretscan  # noqa: E402
import speakable  # noqa: E402
import statepaths  # noqa: E402
import oneway  # noqa: E402
import whenparse  # noqa: E402
import write_guard  # noqa: E402
import seatbroker  # noqa: E402  (Orbs' own: a lesson's model calls go to the home)
import learn_gate  # noqa: E402
import day  # noqa: E402
import eds  # noqa: E402

from orbs_kit import habits  # noqa: E402
from orbs_kit import pages  # noqa: E402
from orbs_kit import voicebox  # noqa: E402
from orbs_kit import lessons  # noqa: E402

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


class OnewayVerdict(TypedDict):
    allowed: bool
    why: str


class Protected(TypedDict):
    path: str
    why: str


class LearnVerdict(TypedDict):
    ok: bool
    klass: str
    reason: str


@server.tool(description="Whether a lesson an orb proposes may be learned at all (PLAN 3.5: Ash's learn_gate). "
             "Refused, it says which class it is and what to capture instead; the person still decides on the rest.")
def learn_verdict(text: str) -> LearnVerdict:
    ok, klass, reason = learn_gate.verdict(text)
    return {"ok": ok, "klass": klass, "reason": reason}


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


# ── the day (PLAN 4.5): Ash's day, dayplan and reminders, on what the home hands in ───────────
# The carried modules read the calendar through `eds`, which in the kit is the home's hand-off
# (kit/ash/eds.py): your calendars' events and the bills and reminders the orbs keep for you.
# One module's state, so one day question at a time; handed in for the call and taken back after.

_DAY = threading.Lock()


class DayAnswer(TypedDict):
    kind: str
    said: str


class Clash(TypedDict):
    kind: str
    first: str
    second: str
    at: float
    gap_minutes: int | None


def _with_day(events: list[dict], todos: list[dict], now: float, failed: list[dict] | None, ask):
    with _DAY:
        eds.handed(events, todos, failed or [], now)
        try:
            return ask()
        finally:
            eds.FEED = None


@server.tool(description="The morning brief (Ash's day.brief): what is on today and what is still open, said once, "
                         "from the events and the list the home hands in.")
def day_brief(events: list[dict], todos: list[dict], now: float, failed: list[dict] | None = None) -> DayAnswer:
    said, _ = _with_day(events, todos, now, failed, lambda: day.brief(now=now))
    return {"kind": "say", "said": said}


@server.tool(description="A question about the person's day in their own words ('what's next', 'am I free thursday "
                         "afternoon'), answered by Ash's day. Reads only: a booking, a move or a cancel is never made here.")
def day_answer(text: str, events: list[dict], todos: list[dict], now: float, failed: list[dict] | None = None) -> DayAnswer:
    kind, said, _ = _with_day(events, todos, now, failed, lambda: day.handle(text, now=now))
    if kind != "say":  # Orbs reads your calendars and does not change them
        return {"kind": "read_only", "said": eds.Unavailable("", "read_only").spoken()}
    return {"kind": kind, "said": said}


@server.tool(description="What clashes among the events already on: two that overlap, and two too close to get from "
                         "one to the other (Ash's day.tight: time to get ready, more to travel when the place changes). "
                         "Day-long events never clash. Named, never refused.")
def day_clashes(events: list[dict], now: float, days: float = 2) -> list[Clash]:
    rows = sorted((eds._event(e) for e in events), key=lambda r: r["start"])
    rows = [r for r in rows if not r["all_day"] and r["end"] > now and r["start"] < now + days * 86400]
    out: list[Clash] = []
    for i, a in enumerate(rows):
        later = rows[i + 1:]
        for b in later:
            if b["start"] < a["end"]:
                out.append({"kind": "overlap", "first": a["summary"], "second": b["summary"], "at": float(b["start"]), "gap_minutes": None})
        for b, kind, gap in day.tight(a["start"], a["end"], rows=[b for b in later if b["start"] >= a["end"]], location=a["location"]):
            out.append({"kind": kind, "first": a["summary"], "second": b["summary"], "at": float(b["start"]), "gap_minutes": int(gap // 60)})
    return out


@server.tool(description="Let a Python habit answer, if its three code checks agree (PLAN 1.4).")
def habit_answer(habit_dir: str, input: dict) -> HabitAnswer:  # noqa: A002 - the protocol's word
    return habits.answer(Path(habit_dir), input)


# ── the one-way switch, through the MCP boundary (PLAN 1.6) ──────────────────────────────
# Ash's oneway keeps a turn's state in a thread-local, and this server may answer each call on a
# different thread. So the state travels WITH the call: the home stores each turn's taints and
# approvals (durably, so a restart cannot wash a turn clean), hands them in, and Ash's own
# `check` and `quote` decide, exactly as they do in Ash.

def _install(turn: str, taints: list[dict], approved: list[str]) -> None:
    oneway.begin(turn)
    for t in taints:
        oneway.read_untrusted(str(t.get("source", "")), str(t.get("detail", "")))
    for a in approved:
        oneway.approve(a)


@server.tool(description="May this turn act outward (shell, open, calendar, send)? Ash's one-way switch.")
def oneway_check(turn: str, action: str, taints: list[dict], approved: list[str]) -> OnewayVerdict:
    _install(turn, taints, approved)
    allowed, why = oneway.check(action)
    return {"allowed": allowed, "why": why}


@server.tool(description="Untrusted text, fenced as data for the model (Ash's oneway.quote).")
def oneway_quote(turn: str, text: str, limit: int = 20000) -> str:
    _install(turn, [], [])
    return oneway.quote(text, limit=limit)


@server.tool(description="The paths write_guard protects: what no orb may write.")
def protected_paths() -> list[Protected]:
    return [{"path": str(p), "why": why} for p, why in write_guard.PROTECTED]


class HabitStep(TypedDict, total=False):
    call: dict
    output: str
    refused: str


@server.tool(description="A step habit's next step (PLAN 3.2): the next call, the answer, or why it will not; "
             "with `code`, that code is tried in the sandbox before anything is saved.")
def habit_step(habit_dir: str, input: dict, done: list[dict], code: str | None = None, check_input: bool = True) -> HabitStep:  # noqa: A002
    return habits.step(Path(habit_dir), input, done, code=code, check_input=check_input)


@server.tool(description="Store a step habit, and the familiarity learned from the inputs of the runs it replayed (PLAN 3.2).")
def habit_learn_steps(habit_dir: str, code: str, inputs: list[dict], version: int = 1) -> str:
    habits.save_steps(Path(habit_dir), code, inputs, version)
    return habit_dir


@server.tool(description="Store a habit learned from approved (input, output) cases (PLAN 3.2 calls this "
                        "only after the harness re-ran it on every case).")
def habit_learn(habit_dir: str, code: str, approved: list[dict], version: int = 1) -> str:
    habits.save(Path(habit_dir), code, [(c["input"], c["output"]) for c in approved], version)
    return habit_dir


class PageVerdict(TypedDict):
    verdict: str
    report: str


@server.tool(description="Whether a page an orb built really renders (PLAN 4.1, Ash's pagecheck): it answered, its "
             "stylesheet produced rules, its classes are styled, its pictures loaded, no build error covers it. A page "
             "in a workspace (root + path) is served from it for the check; or a page on this machine (url). "
             "pass, fail, or inconclusive (nothing could look): never a pass unseen.")
async def page_check(url: str | None = None, root: str | None = None, path: str | None = None) -> PageVerdict:
    # its own process and its own browser, off this loop: a slow page holds up no other call
    r = await asyncio.to_thread(pages.check, url=url, root=root, path=path)
    return {"verdict": r["verdict"], "report": r["report"]}


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



# ── voice for the app (PLAN 4.3): Ash's voice stack behind what a page needs (orbs_kit/voicebox.py)

class Spoken(TypedDict):
    wav: str
    seconds: float


class Heard(TypedDict):
    text: str
    seconds: float
    unsure: bool


class Woken(TypedDict):
    woken: bool
    heard: str


class Finished(TypedDict):
    finished: bool
    p: float


class Turned(TypedDict):
    finished: bool
    p: float
    hold: bool
    words: str
    unsure: bool


class Overlapped(TypedDict):
    kind: str
    words: str
    voiced: float


def _voice_call(fn, *a):
    """A voicebox call; a voice or a clip it cannot use is an error the home shows, not a crash."""
    try:
        return fn(*a)
    except voicebox.VoiceError as e:
        raise ValueError(str(e)) from e


@server.tool(description="The phrases an orb will say a reply in, Ash's way: shaped for the ear (no markdown, paths or "
             "machinery), his openers and pauses (PLAN 4.3).")
async def voice_phrases(text: str, voice: str = "ash", speed: float = 1.0) -> list[str]:
    return await asyncio.to_thread(_voice_call, voicebox.phrases, text, voice, speed)


@server.tool(description="One phrase in an orb's voice (Kokoro; Classic is Ash's own blend), as a base64 WAV, 24 kHz mono.")
async def voice_say(phrase: str, voice: str = "ash", speed: float = 1.0) -> Spoken:
    return await asyncio.to_thread(_voice_call, voicebox.say, phrase, voice, speed)


@server.tool(description="What the person said, in a recording a browser made (base64; webm, ogg or wav): Whisper base.en, "
             "biased to the orb's name.")
async def voice_hear(audio: str, name: str = "Ash") -> Heard:
    return await asyncio.to_thread(_voice_call, voicebox.hear, audio, name)


@server.tool(description="Whether the last moments of what the page heard were someone calling the orb: 'hey <name>'.")
async def voice_woken(audio: str, name: str) -> Woken:
    return await asyncio.to_thread(_voice_call, voicebox.woken, audio, name)


@server.tool(description="Whether the person sounds finished or only paused (Smart Turn v3.2, Ash's 0.97).")
async def voice_finished(audio: str) -> Finished:
    return await asyncio.to_thread(_voice_call, voicebox.finished, audio)


@server.tool(description="At the person's first pause, in one ask (PLAN 4.7): whether they finished (Smart Turn, and words "
             "that do not trail off on 'and', 'um', 'the'...), and their words so far, with Whisper's doubt.")
async def voice_turn(audio: str, name: str = "Ash") -> Turned:
    return await asyncio.to_thread(_voice_call, voicebox.turn, audio, name)


@server.tool(description="What the person said while the orb spoke what `saying` holds (PLAN 4.7): 'echo' (his own words "
             "back through the microphone), 'backchannel' (an 'mhm': he goes on), 'interrupt' (he stops and listens) or 'nothing'.")
async def voice_overlap(audio: str, name: str, saying: str = "") -> Overlapped:
    return await asyncio.to_thread(_voice_call, voicebox.overlap, audio, name, saying)


# ── lessons (PLAN 4.4): Ash's lesson.py plans once; its model calls are the home's brain order ──
# A lesson's model calls (draw_plan, judge) come back to the home over MCP sampling for the length
# of the tool's call: seatbroker.py (Orbs' own) hands them to ASK_HOME, set here, one lesson at a time.

_lesson_lock = threading.Lock()


def _asking_home(ctx: Context, loop: asyncio.AbstractEventLoop):
    """The home's brain, asked from the lesson's worker thread: (messages, max_tokens, timeout) -> (served, text)."""
    def ask(messages: list[dict], max_tokens: int, timeout: float) -> tuple[str, str]:
        system = "\n\n".join(str(m.get("content") or "") for m in messages if m.get("role") == "system")
        said = [mcp_types.SamplingMessage(role="assistant" if m.get("role") == "assistant" else "user",
                                          content=mcp_types.TextContent(type="text", text=str(m.get("content") or "")))
                for m in messages if m.get("role") != "system"]
        fut = asyncio.run_coroutine_threadsafe(
            ctx.session.create_message(said, max_tokens=max_tokens, system_prompt=system or None, related_request_id=ctx.request_id), loop)
        r = fut.result(timeout=timeout + 5)
        content = r.content
        text = content.text if getattr(content, "type", "") == "text" else ""
        return str(r.model or "home"), text
    return ask


def _with_home(ctx: Context, loop: asyncio.AbstractEventLoop, fn):
    with _lesson_lock:
        seatbroker.ASK_HOME = _asking_home(ctx, loop)
        try:
            return fn()
        finally:
            seatbroker.ASK_HOME = None


class Planned(TypedDict):
    kind: str
    title: str
    steps: list[dict]
    why: str


class Judged(TypedDict):
    correct: bool | None
    say: str
    told: str


class Observed(TypedDict):
    ok: bool
    reason: str


@server.tool(description="A lesson for a topic (PLAN 4.4, Ash's lesson.py): his scripted union-find lesson, or steps "
             "drawn for the canvas (the model asked once, through the home); a page or a file has no canvas steps here.")
async def lesson_plan(topic: str, ctx: Context) -> Planned:
    loop = asyncio.get_running_loop()
    return await asyncio.to_thread(_with_home, ctx, loop, lambda: lessons.plan(topic))


@server.tool(description="Ash's judge on one answer, told the step and what the canvas shows now. correct is null when "
             "it could not judge: then the hint is said, never praise.")
async def lesson_judge(topic: str, step: dict, answer: str, facts: dict, ctx: Context) -> Judged:
    loop = asyncio.get_running_loop()
    return await asyncio.to_thread(_with_home, ctx, loop, lambda: lessons.judge(topic, step, answer, facts))


@server.tool(description="A scripted step's answer, read off the canvas (no model): for 'tell me'.")
async def lesson_explain(index: int, facts: dict) -> str:
    return await asyncio.to_thread(lessons.explain, index, facts)


@server.tool(description="Whether a lesson may note this about the person (Ash's learner_model: an allowlisted kind, "
             "never a judgement of them).")
async def lesson_observe(kind: str, text: str) -> Observed:
    return lessons.observe(kind, text)


def main() -> None:
    server.run("stdio")


if __name__ == "__main__":
    main()
