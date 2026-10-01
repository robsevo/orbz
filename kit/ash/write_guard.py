#!/usr/bin/env python3
"""write_guard — run a suite and prove it did not write to the user's real state.

PLAN 2.1 / 2.2. D10 is why this exists: an un-isolated watchdog test wrote 350 fabricated
spend alarms into the real `NOTIFICATIONS.md`, the CLI loads that file as system notice, and
Ash read "$3.50 a day, $25 this month, over cap" out loud as fact. It was $4.96. D57 was the
same shape at 1/10 scale — a fixture written into the real `seat-decisions.jsonl`.

Both were found by a person noticing something wrong days later. Each got a bespoke check
afterwards. This is the general one: it does not care what the suite MEANT to touch, only
whether the protected files are byte-identical after it ran.

    write_guard.py -- ./.venv/bin/python test_foo.py --no-live
    write_guard.py --list                      what is protected, and what exists right now

Deliberately NOT a sandbox. A sandbox that a suite escapes reports nothing; a comparison
reports exactly which file changed and by how much. It is also cheap enough to wrap every
suite: a few dozen stats and hashes per run.

Protected paths are the ones a person would notice being wrong, plus the ones this project
has already been burned by. Anything under a temp dir is the suite's own business.
"""
import hashlib
import os
import subprocess
import sys
import time
from pathlib import Path

HOME = Path.home()

# Each entry is (path, why it matters). A directory is compared as a listing plus the hash
# of every file directly in it — deep trees are summarised by name and size, because the
# question is "did a suite write here", not "what changed inside a 200 MB profile".
PROTECTED = [
    (HOME/"ash/brain"/"memory",            "the brain's long-term memory — what Ash believes"),
    (HOME/"ash/brain"/"NOTIFICATIONS.md",  "loaded into the CLI as system notice and READ ALOUD (D10)"),
    (HOME/"ash/brain"/"settings.json",     "hooks, seats and permissions for every turn"),
    (HOME/"ash/brain"/"litellm.yaml",      "the router: which model answers, and what it costs"),
    # ~/ash/voice, NOT ~/ash/brain. The broker writes `~/ash/voice/seat-decisions.jsonl`
    # (`seatbroker.py:35`) and this guard watched the other home — so it reported clean while
    # suites appended to the person's real spend ledger, 412 rows of it. A guard pointed at a
    # path that does not exist is worse than no guard: it is a green light with nothing
    # behind it. Both are listed now, because the wrong one existing is itself worth knowing.
    (HOME/"ash/voice"/"seat-decisions.jsonl",
     "THE spend ledger — what 4.12 reconciles against the provider's own report"),
    (HOME/"ash/brain"/"seat-decisions.jsonl", "the old location; nothing should appear here"),
    (HOME/"ash/voice"/"settings.json",  "the voice profile's hooks, incl. spoken approval (D67)"),
    (HOME/"ash/voice"/"wake-state.json", "what the orb reads to know he is awake"),
    (HOME/"ash/voice"/"ashd-prefs.json", "spoken preferences a hand edit also writes"),
    (HOME/"ash/voice"/"tutor-state.json", "the lesson the user is in the middle of"),
    (HOME/"ash/voice"/"preview.json",  "which window the preview owns"),
    (HOME/"ash/voice"/"anchors.json",  "everything he has been taught to point at"),
    # Added 2026-09-20 after a suite of mine wrote three candidates into the real store.
    # `learning.Candidates()` defaults to `runtime.DB`, so a test that forgets to redirect
    # gets the live one — the D10/D57 class in a store this list did not cover, found by the
    # second run failing on duplicates rather than by anything noticing the first.
    (HOME/"ash/voice"/"run"/"runtime.db", "the journal and the candidate store — what "
                                              "Ash has been told and what he believes"),
    (HOME/"ash/voice"/"learning-ledger.jsonl", "what changed in the brain and how to "
                                                   "put it back"),
    (HOME/"ash/voice"/"learning-blobs", "the before-states every rollback depends on"),
    (HOME/"ash/brain"/"skill-usage.json", "which skills have been used — the only evidence "
                                        "for retiring any of them"),
    # Added 2026-09-20 (PLAN 14.6). The brain's own 70 KB document, and the one this list did
    # not watch. PLAN 2.2 found THREE suites opening it — F.1, K.3 and K.14 all called
    # `CONSTITUTION.md.read_text()` — and F.1's drift check could never fail, because
    # `~/ash/voice/CONSTITUTION.md` is a symlink to this file and it was comparing the
    # file with itself. Those three were fixed; nothing stopped a fourth. The REAL path is
    # watched, not the symlink: comparing the link compares 35 bytes of path, not the prose.
    (HOME/"ash/brain"/"CONSTITUTION.md", "the constitution — every rule Ash is meant to follow"),
    # Orbs (kit/ash/CARRIED.md): the Orbs data directory, which a kit suite must never touch either.
    (HOME/".orbs"/"home.db", "the home's event log and every orb's queue"),
    (HOME/".orbs"/"kit"/"run"/"runtime.db", "the kit's journal and candidate store"),
    (HOME/".orbs"/"kit"/"learning-ledger.jsonl", "what an orb learned and how to put it back"),
    (HOME/".orbs"/"brain", "the owner's constitution and skills for Orbs"),
    (HOME/".orbs"/"brain"/"memory", "what the orbs believe"),
]


def _digest(p: Path):
    """A comparable fingerprint. Missing is a state too — a suite DELETING one of these is
    just as bad as writing it, and a plain hash of nothing would look like no change."""
    try:
        if p.is_dir():
            # ONE LEVEL DEEP, and that limit is load-bearing. `iterdir()` is not recursive, so
            # a protected directory is fingerprinted by its immediate children's names and
            # sizes: a write to `~/ash/brain/memory/x.md` is caught, a write to
            # `~/ash/brain/memory/sub/x.md` is NOT. Nothing writes a subdirectory under a
            # protected root today, and a recursive walk over the brain on every one of ~120
            # suites has a cost worth deciding deliberately rather than by default. Written
            # down because the next person to add a nested store there will otherwise assume
            # it is watched — which is the D172 failure exactly: a guard whose coverage is
            # narrower than the reader believes.
            parts = []
            for child in sorted(p.iterdir()):
                try:
                    st = child.stat()
                    parts.append(f"{child.name}:{st.st_size}")
                except OSError:
                    parts.append(f"{child.name}:?")
            return "dir:" + hashlib.sha256("|".join(parts).encode()).hexdigest()[:32]
        return "file:" + hashlib.sha256(p.read_bytes()).hexdigest()[:32]
    except FileNotFoundError:
        return "absent"
    except OSError as e:
        return f"unreadable:{type(e).__name__}"


# Background monitors that append to the user's inbox on their own schedules. They are NOT
# an exemption — a change is still reported and still fails. Naming them turns a phantom D10
# accusation into a two-second triage, which is the actual cost: `test_pagecheck.py` was
# charged with writing `NOTIFICATIONS.md` (2026-09-20) having never mentioned it, while
# seat-health, thinking-tripwire and the eval gate put fourteen lines in there that day.
# A guard that cries wolf on a five-minute timer teaches people to disbelieve it, and it is
# the thing standing between a suite and the user's real state.
EXTERNAL_WRITERS = ("seat-health", "thinking-tripwire", "guard-integrity", "eval gate",
                    "budget", "cost:", "url-verify")

_MAX_SNAPSHOT_BYTES = 512 * 1024

# Which systemd user unit each name in EXTERNAL_WRITERS comes from, so "these lines mention
# seat-health" can become "seat-health RAN, from 08:25:55 to 08:34:26". The first is a claim
# about text and the second is evidence — and D238 is the standing record that a unit's run
# WINDOW is where collisions live, not its start time: `ash-seat-health` took eight and a
# half minutes on 2026-09-22 and a full pass ran inside it, so three suites were charged
# with its writes.
# A NAME MAY MAP TO SEVERAL UNITS. Until 2026-09-26 this machine ran two of everything, an
# `ash-*` set and a second install's set writing the same brain, and the first version of this
# table knew only one of them — so a write by the other printed the wrong unit's window and
# read as corroboration for an attribution that window refuted. Since the move to ~/ash the
# other install writes only its own home, so only Ash's units are listed.
UNIT_OF = {"seat-health": ("ash-seat-health.service",),
           "eval gate": ("ash-loop@eval-gate.service",),
           "thinking-tripwire": ("ash-loop@thinking-tripwire.service",),
           "budget": ("ash-budget-watchdog.service",)}


def _unit_window(unit):
    """(start, end) epoch seconds for a unit's last run, or None. `end` is None if running.

    **The HUMAN timestamps, not the `…USec` ones.** `ExecMainStartTimestampUSec` is not a
    property systemd exposes for these user units — asking for it returns nothing at all, so
    the first version of this silently answered `None` for every unit and every window came
    back empty. A lookup that fails by returning "no information" is indistinguishable from
    one that ran and found nothing, which is how it went unnoticed: the NOTE simply stopped
    saying anything.

    A missing or zero exit timestamp means STILL RUNNING, which is the normal case for the
    monitor that is writing the file while a pass reads it.
    """
    try:
        r = subprocess.run(["systemctl", "--user", "show", unit, "--no-pager",
                            "-p", "ExecMainStartTimestamp", "-p", "ExecMainExitTimestamp"],
                           capture_output=True, text=True, timeout=5)
    except Exception:
        return None
    v = dict(l.split("=", 1) for l in r.stdout.splitlines() if "=" in l)

    def _epoch(raw):
        raw = (raw or "").strip()
        if not raw:
            return None
        parts = raw.split()
        # "Tue 2026-09-22 11:35:47 EDT" -> drop the weekday and the zone name; %Z round-trips
        # badly and the comparison is against a local mtime anyway.
        for i in range(len(parts)):
            try:
                return time.mktime(time.strptime(" ".join(parts[i:i + 2]),
                                                 "%Y-%m-%d %H:%M:%S"))
            except ValueError:
                continue
        return None

    start = _epoch(v.get("ExecMainStartTimestamp"))
    if start is None:
        return None
    return (start, _epoch(v.get("ExecMainExitTimestamp")))


def _lines(p: Path):
    """The file's lines, for reporting WHAT changed. None for anything big or binary."""
    try:
        if p.is_dir() or p.stat().st_size > _MAX_SNAPSHOT_BYTES:
            return None
        return p.read_text(errors="replace").splitlines()
    except OSError:
        return None


# ── the third account of a change: the live daemon wrote it (2026-09-22) ────────────────────
# With the orb up, `ashd` writes `wake-state.json` several times a second and the ledger on
# every model call, so a full pass during live work charged eleven suites with writes they
# never made — each green standalone. The monitor locks above cannot help: no systemd unit
# writes these. So the writer says who it is. `writer_stamp` records its ancestor chain at
# write time, and a change is accounted for only when EVERY record in it carries a chain that
# reaches the running orb or `ashd`:
#   * alive now, with the SAME kernel start time as at write time (so not a reused pid);
#   * started BEFORE this guard, so a suite that launches its own `ashd --wav` is refused;
#   * identified by its command line and working tree, not by the name it gives itself.
# A suite's own write stamps a chain through this guard and no live daemon, and fails.
# Anything unparseable, unstamped, or removed from an append-only ledger fails too.
_SELF_START = None


def _start_ticks(pid):
    try:
        raw = open(f"/proc/{pid}/stat").read()
        return int(raw.rpartition(")")[2].split()[19])
    except (OSError, ValueError, IndexError):
        return None


def _is_live_root(pid, start):
    """Is (pid, start) the running orb or ashd of THIS checkout, older than this guard?"""
    # `start is None` FIRST (D338): a process that exited between the /proc listing and this
    # read gives None for both, `None != None` is False, and the comparison below then raised
    # TypeError and killed the contract tier on whatever process happened to die mid-scan.
    if start is None or _start_ticks(pid) != start:
        return None                              # gone, or the pid now belongs to someone else
    if _SELF_START is not None and start >= _SELF_START:
        return None                              # started during the run: could be the suite's
    here = Path(__file__).resolve().parent
    try:
        argv = open(f"/proc/{pid}/cmdline", "rb").read().split(b"\0")
        argv = [a.decode(errors="replace") for a in argv if a]
        # Electron rewrites its process title into ONE space-joined string, so the orb's
        # argv[0] is "/usr/lib/electron42/electron --ozone-platform=x11 ." (measured).
        if len(argv) == 1 and " " in argv[0]:
            argv = argv[0].split()
        cwd = os.readlink(f"/proc/{pid}/cwd")
    except OSError:
        return None
    if any(Path(a).name == "ashd.py" and Path(a).resolve().parent == here for a in argv[1:3]):
        if "--wav" not in argv:
            return f"ashd pid {pid}"
    if argv and Path(argv[0]).name == "electron" and "--type" not in " ".join(argv) \
            and Path(cwd).resolve() == here.parent/"shell":
        return f"orb pid {pid}"
    return None


def _live_writer(stamp):
    """The live root a stamp's chain reaches, or None."""
    if not isinstance(stamp, dict):
        return None
    for entry in stamp.get("chain") or []:
        try:
            pid, start = int(entry[0]), int(entry[1])
        except (TypeError, ValueError, IndexError):
            continue
        root = _is_live_root(pid, start)
        if root:
            return root
    return None


def _live_account(key, was_lines, now_lines):
    """A sentence naming the live writer of EVERY changed record, or None."""
    import json as _json
    if now_lines is None:
        return None
    if key.endswith(".jsonl"):
        added, removed = _delta(was_lines, now_lines)
        if removed or not added:
            return None                          # an append-only ledger never loses a line
        roots = set()
        for line in added:
            try:
                root = _live_writer(_json.loads(line).get("_writer"))
            except (ValueError, AttributeError):
                return None
            if not root:
                return None
            roots.add(root)
        return f"{len(added)} ledger row(s), every one written by the live {', '.join(sorted(roots))}"
    try:
        obj = _json.loads("\n".join(now_lines))
    except ValueError:
        return None
    root = _live_writer(obj.get("_writer")) if isinstance(obj, dict) else None
    return f"rewritten by the live {root}" if root else None


def snapshot():
    return {str(p): (_digest(p), _lines(p)) for p, _ in PROTECTED}


def _delta(was_lines, now_lines):
    """Lines added and removed. Deliberately simple: these files are appended to, and an
    exact diff is not needed to tell a suite's write from a monitor's."""
    if was_lines is None or now_lines is None:
        return [], []
    old_set = set(was_lines)
    added = [l for l in now_lines if l.strip() and l not in old_set]
    new_set = set(now_lines)
    removed = [l for l in was_lines if l.strip() and l not in new_set]
    return added, removed


def _covering(hits, when):
    """(covering, missed) — labels for candidate units, split by whether they cover `when`.

    A VALUE, not a sentence. The downgrade in `review()` turns on "did a unit's own run
    window contain the moment this file changed", and deciding that by matching text in a
    rendered message is how a formatting change silently becomes a policy change.
    """
    covering, missed = [], []
    for h in hits:
        for unit in UNIT_OF.get(h, ()):
            w = _unit_window(unit)
            if not w:
                continue
            start, end = w
            label = (f"{unit} ran {time.strftime('%H:%M:%S', time.localtime(start))}"
                     + (f"-{time.strftime('%H:%M:%S', time.localtime(end))}"
                        if end else " (still running)"))
            # `end + 5`: the mtime is taken after the run finished by up to a scheduling
            # slice. Five seconds is slack, not a window of its own.
            if when is not None and start <= when and (end is None or when <= end + 5):
                covering.append(label)
            else:
                missed.append(label)
    return covering, missed


def _ran_in_window(hits, when=None):
    """What the units say, and — given `when` — whether they actually cover it.

    **A window is evidence, and evidence that contradicts the claim has to say so.** The
    first version printed the last run of one unit beside "every changed line names
    seat-health", which reads as corroboration whatever the timestamps are. Measured
    2026-09-22: the file changed at 11:37:54 and the unit it named had last run 08:25-08:34,
    three hours earlier — the NOTE reassured about an attribution its own evidence refuted,
    and only a reader who subtracted two timestamps would notice.

    Best-effort and non-fatal by design: `systemctl` may be unreadable, the unit may not
    exist, and a guard that dies while explaining a finding has destroyed the finding.
    """
    covering, missed = _covering(hits, when)
    if when is None:
        both = covering + missed
        return (" " + "; ".join(both) + ".") if both else ""
    if covering:
        return " Confirmed: " + "; ".join(covering) + ", which covers the change."
    if missed:
        return (" BUT NOT CONFIRMED: " + "; ".join(missed) + ", and the file changed at "
                + time.strftime("%H:%M:%S", time.localtime(when))
                + " — outside every one of those. Something else wrote lines that name it.")
    return ""


def _mtime(path):
    """When the file last changed, or None. The NOTE's attribution is checked against it."""
    try:
        return Path(path).stat().st_mtime
    except OSError:
        return None


def review(before, after):
    """(failures, confirmed_external).

    **A change lands in `confirmed_external` only under TWO positive locks**, and the
    distinction from an exemption is the whole of it. An exemption names a path and switches
    the guard off for it, one path at a time — which is how `TS.3b`'s `or True` and every
    other quietly-disabled check in this project happened. These are positive evidence about
    one specific change:

      1. **every changed line names a monitor this file knows**, not merely one of them; and
      2. **that monitor's own systemd run window contains the moment the file changed.**

    A suite's own write satisfies neither. One unclaimed line, or a window that misses, and
    the change is a failure again.

    Why it is worth having at all: a full pass goes red every time `legacy-seat-health` runs,
    which is several times a day, and **a suite that is red for a non-reason teaches people
    to stop reading it.** D62 is the standing record of three red runs written off as flakes;
    what it stops them reading next is a real D10. The downgraded case still PRINTS, with the
    covering window quoted — silence and a pass are the same thing to a reader.
    """
    why = {str(p): reason for p, reason in PROTECTED}
    failures, confirmed = [], []
    for key, was in before.items():
        now = after.get(key, ("absent", None))
        if now[0] == was[0]:
            continue
        block = [f"{key}", f"      {was[0]} -> {now[0]}", f"      {why[key]}"]
        added, removed = _delta(was[1], now[1])
        # SHOW THE CHANGE. The old message named a file and a pair of hashes, which is not
        # enough to tell whether the suite did it — and that question is the whole point.
        for label, rows in (("+", added), ("-", removed)):
            for line in rows[:4]:
                block.append(f"      {label} {line.strip()[:120]}")
            if len(rows) > 4:
                block.append(f"      {label} ... and {len(rows) - 4} more")
        # EVERY LINE, OR IT IS NOT "EVERY LINE". `hits` was collected from ANY changed
        # line and the message then said *every changed line names X* — so one monitor line
        # arriving beside a real suite write described the suite's write as the monitor's,
        # which is the one case this NOTE must never cover for. It reads each line now, and
        # a line nothing claims is named.
        #
        # The old guard on it was `not (added or removed) == ([], [])`: a list compared to a
        # TUPLE of two lists, always False, so `not` made it always True. Dead, and the
        # `or True` shape in disguise — TS.3b's mistake in different clothes.
        rows = added + removed
        claimed = {line: sorted({w for w in EXTERNAL_WRITERS if w in line}) for line in rows}
        unclaimed = [line for line, ws in claimed.items() if not ws]
        hits = sorted({w for ws in claimed.values() for w in ws})
        when = _mtime(key)
        covering, _missed = _covering(hits, when) if hits else ([], [])
        both_locks = bool(rows) and bool(hits) and not unclaimed and bool(covering)
        live = _live_account(key, was[1], now[1])
        if live:
            block.append(f"      NOTE: {live} — it started before this suite and is still "
                         f"running with the same identity. Not this suite, and not an "
                         f"exemption: the stamp names its writer and the kernel confirms it.")
            confirmed.append("\n".join(block))
            continue
        if rows and hits and not unclaimed:
            # THREE CASES, NOT TWO. A window that covers is confirmation. A window that
            # misses is evidence against. **No mtime at all is the weakest of the three** —
            # the file is gone, or this is a synthetic report — and it must hedge hardest,
            # because "I could not check" and "I checked and it is fine" are opposite
            # answers. The first version dropped the hedge whenever it had anything to say.
            hedge = ("" if covering else
                     " Still reported: confirm it, do not assume it.")
            block.append(f"      NOTE: every changed line names {', '.join(hits)} — a "
                         f"background monitor, not this suite.{hedge}"
                         f"{_ran_in_window(hits, when)}")
        elif rows and hits:
            block.append(f"      NOTE: {len(rows) - len(unclaimed)} of {len(rows)} changed "
                         f"lines name {', '.join(hits)}; {len(unclaimed)} name no known "
                         f"monitor, so SOMETHING here is unaccounted for. First: "
                         f"{unclaimed[0].strip()[:90]}")
        (confirmed if both_locks else failures).append("\n".join(block))
    return failures, confirmed


def changed(before, after):
    """Every change, failures first. One computation, two views — a second function that
    recomputed this is how the two would disagree by the end of the month."""
    failures, confirmed = review(before, after)
    return failures + confirmed


def main(argv):
    if argv and argv[0] == "--list":
        for p, reason in PROTECTED:
            print(f"  {_digest(p):<40} {p}\n      {reason}")
        return 0
    if argv and argv[0] == "--":
        argv = argv[1:]
    if not argv:
        print(__doc__.strip().split("\n\n")[0], file=sys.stderr)
        print("usage: write_guard.py -- <command...>", file=sys.stderr)
        return 2

    global _SELF_START
    _SELF_START = _start_ticks(os.getpid())
    before = snapshot()
    r = subprocess.run(argv)
    after = snapshot()
    failures, confirmed = review(before, after)

    # THE DOWNGRADED CASE STILL PRINTS. Silence and a pass are the same thing to a reader,
    # and the whole point of the two locks is that the evidence is showable: the units named,
    # their run windows, and the fact that one of them covers the moment the file changed.
    if confirmed:
        print(f"\n  NOTE  write_guard: a protected file changed under "
              f"{' '.join(argv[-2:])}, and every change is accounted for — by a background "
              f"monitor whose own run window covers it, or by the live daemon whose stamp the "
              f"kernel confirms. Not this suite, and not an exemption:\n")
        for d in confirmed:
            print(f"  · {d}")

    if failures:
        # Say it on stdout as well: run-tests.sh captures stdout, and a warning nobody sees
        # is the same as no warning at all.
        print(f"\n✗ write_guard: {' '.join(argv[-2:])} wrote to the user's REAL state "
              f"(PLAN 2.2). A suite that does this can be green and still be lying about "
              f"the machine — that is D10.\n")
        for d in failures:
            print(f"  - {d}")
        return 1 if r.returncode == 0 else r.returncode
    return r.returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
