#!/usr/bin/env python3
"""Audio in: how the frames arrive (PLAN 18.1, first extraction out of `ashd.py`).

`ashd.py` is 2,761 lines. This is the job inside it that touches none of the others: **where
sixteen-kilohertz frames come from, and what happens when they do not come.** Nothing here
knows about wake words, transcription, state, speech or the orb — it hands out eighty
millisecond buffers and it is done.

**`FRAME` is defined here and only here.** It was typed in three places — `ashd.py:46`,
`wake.py:28` and `test_mic_fallback.py:106` — three copies of one number that the code, the
duplicate wake path and the suite each believed independently. That is the `910 → 960` seam
that kept A.2/A.3/A.4 red for a day, waiting to happen again: the copies agreed, so nothing
was wrong, so nothing said anything. Import it.

**`mic_frames` takes `stop` rather than reading `orphaned`.** The daemon owns the question
*"is the orb that started me gone"* — `PARENT` is its state, and an audio module that reached
back into it would make this extraction a circle. It is a parameter with no default
behaviour, so a caller that forgets gets a mic that never gives up rather than one that dies
quietly: `ashd.main` passes `orphaned`, and `test_micaudio` asserts that it does, because a
seam whose correct use is optional is a seam that will be used wrongly (D257 is the same
shape from the other side — the move that left behind the names it read).

**A failure to open the default is not a missing mic; it is a missing default.** That
sentence is the whole of `named_source`, and it cost a silent session on 2026-09-17.
"""
import os
import select
import subprocess
import time
import wave

from common import log

FRAME = 1280                                    # 80 ms at 16 kHz
FRAME_S = FRAME/16000
# A RECORDER THAT RUNS AND SENDS NOTHING IS A MIC THAT WENT AWAY (2026-09-28). With every input
# unplugged, `pw-record` kept running with its stream linked to nothing: 0 bytes a second, and
# the read below waited forever — so the loop it feeds, which also fires reminders and reads the
# sleep toggle, stood still, and mic-state.json still said "listening".
STALL_S = 3.0
_SILENCE = b"\0" * (FRAME * 2)
DRIFT_PPM = 200     # the capture clock may run this fast against the system clock (see CaptureClock)
_mono, _wall = time.monotonic, time.time        # bound at import: a suite that swaps `time` here
                                                # for instant sleeps must not break the clock


class CaptureClock:
    """A LOWER bound on when the frame just read was CAPTURED (PLAN 11.9).

    WHY A LOWER BOUND. The wake -> listening and end of speech -> first word rows start at the
    microphone. The time a frame is READ is later than its capture — it sat in PipeWire, in
    pw-record and in the pipe, and after a stall in a backlog — so "orb painted minus frame
    read" is a LOWER bound on the latency and can never pass a target. An EARLIER-than-true
    capture instant makes the latency an over-estimate, and a pass on that is honest.

    HOW. Nothing a recorder captures can predate the recorder, and its samples are 1/16000 s
    apart on the AUDIO clock. So the last sample of the n-th frame read from a recorder was
    captured at or after `spawn + n * FRAME_S * (1 - DRIFT)`, where `spawn` is taken just
    BEFORE the recorder is started (monotonic, so an NTP step cannot move it). A dropped
    sample only makes the true capture later. A new recorder — a restart, the named-source
    retry — resets the base, so a count never runs past the process it counts.

    WHAT IT ASSUMES, AND HOW IT CHECKS ITSELF. Two things could make the bound too LATE: an
    audio clock faster than DRIFT_PPM against the system clock (the bound's error grows
    with the recorder's age), or a running source handing a new recorder audio it had
    captured before the spawn. Both show the same way — a frame READ before its own capture
    bound, which is impossible while the bound holds — and the reader keeps up with the
    stream, so either would be seen within frames. The first such read withholds every
    stamp from that recorder (`falsified` says why) until the next one starts. What the
    check cannot see is a violation smaller than the reader's lag behind capture, which
    while it keeps up is about one graph cycle.

    WHAT IT COSTS. The bound is early by the recorder's start-up (spawn to first capture)
    plus DRIFT_PPM of its age — 60 ms at five minutes. Both widen the latency, never narrow
    it; the age is reported with every stamp so a stale recorder is visible, not hidden."""

    def __init__(self, drift_ppm=DRIFT_PPM, mono=None, wall=None):
        self.drift = drift_ppm*1e-6
        self._m, self._w = mono or _mono, wall or _wall
        self.spawn = None           # monotonic, just before the current recorder was started
        self.n = 0                  # frames read from it
        self.read_at = None         # monotonic, when the n-th frame's read returned
        self.recorders = 0
        self.falsified = ""

    def started(self):
        self.spawn, self.n, self.read_at, self.falsified = self._m(), 0, None, ""
        self.recorders += 1

    def read(self):
        """A whole frame has just been read. Returns the reason if this read FALSIFIED the
        bound (for the caller to say once), else ""."""
        self.read_at = self._m()
        self.n += 1
        if self.spawn is not None and not self.falsified and self.read_at < self._end(self.n):
            self.falsified = (f"frame {self.n} of recorder {self.recorders} was read "
                              f"{(self._end(self.n) - self.read_at)*1000:.1f} ms before its capture "
                              f"bound: the audio clock runs faster than {self.drift*1e6:.0f} ppm, or "
                              f"the source handed over audio from before the recorder started")
            return self.falsified
        return ""

    def _end(self, n):
        return self.spawn + n*FRAME_S*(1 - self.drift)

    def _wallof(self, m):
        return self._w() - (self._m() - m)

    def _ok(self):
        return self.spawn is not None and self.n > 0 and not self.falsified

    def end_wall(self):
        """Wall-clock lower bound on the capture of the LAST sample of the frame just read."""
        return self._wallof(self._end(self.n)) if self._ok() else None

    def start_wall(self):
        """...and of its FIRST sample (where speech in it may have begun, or ended)."""
        return self._wallof(self._end(self.n - 1)) if self._ok() else None

    def fields(self):
        """The wake's stamp: `cap` (the bound, floored to the millisecond so rounding can
        only widen it), `cap_read` (when that frame was read — the latest it can have been
        captured, for the proven lower bound) and `cap_age` (the recorder's age, which the
        drift allowance grows with). Empty when there is no bound to give."""
        if not self._ok():
            return {}
        import math
        return {"cap": math.floor(self.end_wall()*1000)/1000,
                "cap_read": math.ceil(self._wallof(self.read_at)*1000)/1000,
                "cap_age": round(self._m() - self.spawn, 1)}


def named_source():
    """The first real (non-monitor) input, by NAME.

    PipeWire's default target can be unset while a perfectly good microphone exists:
    `pw-record` with no target — and with the node's numeric id — both die on "no target
    node available", while the same device passed by name captures normally (measured
    2026-09-17, the orb came up deaf and the wake word never fired all session). So a
    failure to open the default is not a missing mic; it is a missing default."""
    try:
        out = subprocess.run(["pactl", "list", "short", "sources"],
                             capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return None
    for line in out.splitlines():
        f = line.split()
        if len(f) > 1 and not f[1].endswith(".monitor"):
            return f[1]
    return None


def _frame(p, n, stall_s=STALL_S):
    """The recorder's next `n` bytes (short or empty once it has ended), or None when it is
    running and has sent nothing for `stall_s`. A stand-in with no descriptor is just read."""
    try:
        fd = p.stdout.fileno()
    except (AttributeError, OSError, ValueError):
        return p.stdout.read(n)
    buf = b""
    while len(buf) < n:
        ready, _, _ = select.select([fd], [], [], stall_s)
        if not ready:
            return None
        chunk = os.read(fd, n - len(buf))
        if not chunk:
            break
        buf += chunk
    return buf


def mic_frames(target=None, stop=None, on_state=None, clock=None, keep_alive=False):
    """Endless 80 ms frames from the default source; survives a missing mic.

    `stop` is asked between retries — the daemon passes `orphaned`, so a mic that never
    opens does not outlive the orb that wanted it. With no `stop` it retries forever, which
    is right for anything that is not a supervised child.

    `on_state(ok, why)` is told when the mic goes down and when it comes back (D334): the
    log line alone was the only trace of a dead mic. Once per change, never per frame, and a
    callback that raises is never the reason he stops listening.

    `clock` (a CaptureClock) is told when each recorder starts and each frame is read, and
    nothing else: with no clock this loop is byte-for-byte what it was.

    `keep_alive`: while the mic is down, yield SILENT frames at the frame rate instead of
    nothing, so a consumer that does more than listen (ashd: reminders, the sleep toggle) keeps
    running without a microphone. Off by default: a caller that only wants real audio gets
    none while there is none.
    """
    def _tell(ok, why=""):
        if on_state is not None:
            try:
                on_state(ok, why)
            except Exception:
                pass
    base = ["pw-record", "--raw", "--rate", "16000", "--channels", "1", "--format", "s16"]
    cmd = base + (["--target", target] if target else [])
    warned = False
    heard = False                             # told on_state it works, since the last failure
    while True:
        if clock is not None: clock.started()     # BEFORE pw-record exists: it captures nothing earlier
        p = subprocess.Popen(cmd + ["-"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        got, stalled = 0, False
        try:
            while True:
                buf = _frame(p, FRAME*2)
                if buf is None:
                    stalled = True
                    break
                if len(buf) < FRAME*2: break
                if clock is not None and clock.read():
                    log(f"mic clock: {clock.falsified}; capture stamps withheld until the recorder restarts")
                got += 1
                warned = False
                if not heard:
                    heard = True
                    _tell(True)
                yield buf
        finally:
            p.kill()
        err = [] if stalled else p.stderr.read().decode(errors="replace").strip().splitlines()
        if stalled:
            err = [f"no sound from the microphone for {STALL_S:.0f} s: nothing is plugged in, or it was unplugged"]
        if got == 0 and not target and any("no target node" in e for e in err):
            named = named_source()
            if named:
                log(f"mic: no default source; using {named}")
                target, cmd = named, base + ["--target", named]
                continue                      # straight back in, no 5 s penalty
        if not warned:
            log("mic: unavailable" + (f" ({err[-1]})" if err else "") + "; retrying every 5 s")
            warned = True
            heard = False
            _tell(False, err[-1] if err else "")
        for _ in range(10 if got < 25 else 1):
            if stop and stop(): return
            if not keep_alive:
                time.sleep(0.5)
                continue
            for _f in range(int(0.5 / FRAME_S)):      # the same half second, as silent frames
                time.sleep(FRAME_S)
                yield _SILENCE


def _wav_chunks(path):
    with wave.open(path) as w:
        assert w.getframerate() == 16000 and w.getnchannels() == 1 and w.getsampwidth() == 2, path
        data = w.readframes(w.getnframes())
    data = bytes(16000*2) + data + bytes(16000*2)
    return [data[i:i+FRAME*2] for i in range(0, len(data) - FRAME*2 + 1, FRAME*2)]


def wav_frames(paths, d, replies=(), followups=()):
    """Testing without a mic. `paths` play straight through. After that, silence
    flows (paced, so a turn has time to happen) until the daemon is idle again,
    and each time he asks a yes/no question the next `replies` wav is played
    into the window instead - so a permission round trip is testable end to end.
    Likewise each follow-up window after an answer gets the next `followups` wav,
    with no wake word in front of it."""
    silence = bytes(FRAME*2)
    for p in paths:
        yield from _wav_chunks(p)
    replies, followups = list(replies), list(followups)
    idle_for = 0
    while idle_for < int(3/FRAME_S) or (d.board and not d.board.finished):   # a running task list keeps the test alive
        if d.reply_slot and d.state == "listening" and replies:
            yield from _wav_chunks(replies.pop(0))
            continue
        if d.following and d.state == "listening" and followups:
            yield from _wav_chunks(followups.pop(0))
            while d.state == "listening":           # let the endpoint land before the next answer
                time.sleep(0.004)
                yield silence
            continue
        idle_for = idle_for + 1 if d.state == "idle" else 0
        time.sleep(0.004)
        yield silence
