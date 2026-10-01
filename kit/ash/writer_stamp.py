"""writer_stamp — who wrote this runtime file, in a form the kernel can confirm later.

PLAN 2.2. `write_guard` proves a suite did not touch the user's real state by comparing
protected files before and after. With the orb up that proof was impossible: the live daemon
writes `wake-state.json` several times a second, `preview.json` and `tutor-state.json` as it
works, and the spend ledger on every model call — so every full pass during live work came
back with eleven suites "caught" writing files they never opened, all of them green standalone
(2026-09-22). A guard that is red for a non-reason is the guard people stop reading, and the
next red after that is the real D10.

**Not an exemption.** An exemption names a path and switches the guard off for it. This is
positive evidence about ONE write: the writer records its own ancestor chain — pid, kernel
start time and name for each process up to init — and `write_guard.live_writer()` accepts the
write only if that chain contains the running orb or `ashd`, still alive with the SAME start
time, and started before the suite did. A suite writing real state through the same code
stamps its own chain, which has no such process in it. A suite that starts its own `ashd`
(the `--wav` tests do) starts it after the suite began, so that one is refused too.

The chain is computed once per process: ancestors only change by reparenting, and a
reparented process's stamp then names systemd rather than the orb, which is the safe
direction. Best-effort by design — a stamp that cannot be computed is simply absent, and an
absent stamp is never evidence for anything.
"""
import os

KEY = "_writer"
_CACHE = {}


def _stat(pid):
    """(ppid, start_ticks, name) from /proc/<pid>/stat, or None."""
    try:
        raw = open(f"/proc/{pid}/stat").read()
    except OSError:
        return None
    # `comm` is in parentheses and may itself contain spaces or ')', so split on the LAST ')'.
    head, _, rest = raw.rpartition(")")
    name = head.partition("(")[2]
    fields = rest.split()
    try:
        return int(fields[1]), int(fields[19]), name
    except (IndexError, ValueError):
        return None


def chain(pid=None):
    """[[pid, start_ticks, name], ...] from `pid` up to init. Cached per process."""
    pid = os.getpid() if pid is None else pid
    if pid == os.getpid() and pid in _CACHE:
        return _CACHE[pid]
    out, seen = [], set()
    cur = pid
    while cur and cur not in seen and len(out) < 64:
        seen.add(cur)
        st = _stat(cur)
        if st is None:
            break
        ppid, start, name = st
        out.append([cur, start, name])
        cur = ppid
    if pid == os.getpid():
        _CACHE.clear()          # a forked child inherits the parent's cache; never reuse it
        _CACHE[pid] = out
    return out


def stamp():
    """The value to store under KEY, or None when it cannot be computed."""
    try:
        c = chain()
        return {"pid": os.getpid(), "chain": c} if c else None
    except Exception:
        return None


def stamped(obj):
    """`obj` with the stamp added, for a dict about to be written. Never raises."""
    if isinstance(obj, dict):
        s = stamp()
        if s:
            obj = dict(obj)
            obj[KEY] = s
    return obj
