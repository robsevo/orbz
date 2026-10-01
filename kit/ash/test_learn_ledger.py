#!/usr/bin/env python3
"""What changed, and how to put it back. Run: orb/daemon/.venv/bin/python orb/daemon/test_learn_ledger.py

PLAN 20.6. The asymmetry is the design: `record()` is telemetry and must never block a
mutation; `capture()` is the safety net and must fail closed. Those point in opposite
directions on purpose.

LL.0 IS THE CONTROL, and 20.6_t names both halves: with the ledger unwritable, a **mutation
must still succeed** and a **rollback must refuse**. A ledger failing closed on both would
stop the product the first time a disk filled; failing open on both would lose the undo
exactly when it was needed. One direction proves nothing about the other.
"""

# ASH_TIER: product
import json, os, stat, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import learn_ledger as L                                        # noqa: E402

FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def fresh():
    d = Path(tempfile.mkdtemp(prefix="ll-"))
    (d/"memory").mkdir()
    return d, L.Ledger(d/"ledger.jsonl", d/"blobs")


# ── LL.0  THE CONTROL, both directions ───────────────────────────────────────────────
d, led = fresh()
f = d/"memory"/"a.md"
f.write_text("original\n")

# (a) telemetry: an unwritable LEDGER must not block the mutation.
# Genuinely unwritable, not merely absent — `mkdir(parents=True)` will happily create a deep
# path, so pointing at one proves nothing. A read-only parent is the real condition.
ro = d/"readonly"
ro.mkdir()
os.chmod(ro, 0o500)
try:
    led_broken = L.Ledger(ro/"ledger.jsonl", d/"blobs")
    eid = led_broken.record(actor="review", action="accept", before=[], after=[])
    ok(eid is None,
       f"LL.0 an unwritable ledger reports failure rather than raising: got {eid!r}")
finally:
    os.chmod(ro, 0o700)
f.write_text("changed anyway\n")
ok(f.read_text() == "changed anyway\n",
   "LL.0 CONTROL (a): the mutation still happens when the LOGBOOK cannot be written — the "
   "product does not stop because its history is full")

# (b) safety net: an unwritable BLOB STORE must stop the mutation before it starts
d2, _ = fresh()
g = d2/"memory"/"b.md"
g.write_text("precious\n")
blocked = L.Ledger(d2/"ledger.jsonl", d2/"blobs")
blocked.blobs.mkdir(parents=True, exist_ok=True)
os.chmod(blocked.blobs, 0o500)                    # readable, not writable
try:
    with blocked.mutate([g], actor="review", action="accept"):
        g.write_text("clobbered\n")
    FAIL.append("LL.0 CONTROL (b): the mutation proceeded with no capture. An undo you "
                "cannot take is worse than a change you did not make.")
except (L.CaptureFailed, PermissionError, OSError) as e:
    ok(True, "")
    ok(g.read_text() == "precious\n",
       f"LL.0 CONTROL (b): and NOTHING changed: {g.read_text()!r}")
finally:
    os.chmod(blocked.blobs, 0o700)

# (c) a rollback with no entry refuses rather than doing nothing quietly
try:
    led.rollback("no-such-entry")
    FAIL.append("LL.0 a rollback to an entry that does not exist silently succeeded")
except L.CaptureFailed as e:
    ok("nothing to roll back" in str(e), f"LL.0 it refuses and says so: {e}")

# ── LL.1  a single entry restores exactly what it touched, and nothing else ───────────
d, led = fresh()
touched = d/"memory"/"touched.md"
neighbour = d/"memory"/"neighbour.md"
touched.write_text("v1\n")
neighbour.write_text("not part of this\n")

with led.mutate([touched], actor="review", action="accept", candidate="c-1") as m:
    touched.write_text("v2\n")
neighbour.write_text("changed by somebody else afterwards\n")

led.rollback(m.id)
ok(touched.read_text() == "v1\n", f"LL.1 the touched file is restored: {touched.read_text()!r}")
ok(neighbour.read_text() == "changed by somebody else afterwards\n",
   f"LL.1 and the neighbour is LEFT ALONE — a rollback that reverts a change it did not make "
   f"is a second bug, and the person reaching for undo is already having a bad day: "
   f"{neighbour.read_text()!r}")
ok(sorted(x.name for x in (d/"memory").glob("*.tmp")) == [], "LL.1 no temp file is left")

# ── LL.2  a hard delete is recoverable from the blob store ───────────────────────────
d, led = fresh()
doomed = d/"memory"/"doomed.md"
doomed.write_text("the only copy\n")
with led.mutate([doomed], actor="user", action="delete") as m:
    doomed.unlink()
ok(not doomed.exists(), "LL.2 the file is gone")
led.rollback(m.id)
ok(doomed.exists() and doomed.read_text() == "the only copy\n",
   f"LL.2 and comes back byte-identical from the blob store")

# and the reverse: undoing a CREATE means removing it again
d, led = fresh()
made = d/"memory"/"new.md"
with led.mutate([made], actor="gym", action="create") as m:
    made.write_text("brand new\n")
ok(made.exists(), "LL.2 a created file exists")
led.rollback(m.id)
ok(not made.exists(),
   "LL.2 undoing a CREATE removes it — a missing before-state is a legitimate one, and "
   "skipping it would leave the new file in place, which is not a rollback")

# ── LL.3  content-addressed: a hundred entries on one unchanged file cost one blob ────
d, led = fresh()
same = d/"memory"/"same.md"
same.write_text("unchanged\n")
for i in range(20):
    with led.mutate([same], actor="gym", action=f"pass-{i}"):
        pass                                       # touched, changed nothing
blobs = list((d/"blobs").glob("*"))
ok(len(blobs) == 1,
   f"LL.3 twenty entries over an unchanged file cost ONE blob, not twenty: {len(blobs)}")
ok(len(led.entries()) == 20, f"LL.3 while every entry is kept: {len(led.entries())}")

# Counting blobs cannot see a REWRITE — the same content lands on the same name, so the
# count is identical either way, and removing the short-circuit went undetected. The property
# is that an existing blob is not touched again; its mtime says so.
_b = blobs[0]
_was = _b.stat().st_mtime_ns
import time as _time
_time.sleep(0.01)
led.put_blob(same.read_bytes())
ok(_b.stat().st_mtime_ns == _was,
   "LL.3 re-storing identical content does not rewrite the blob — 'costs one blob' means no "
   "work, not merely no extra file")

with led.mutate([same], actor="gym", action="actually-change"):
    same.write_text("different now\n")
ok(len(list((d/"blobs").glob("*"))) == 2,
   "LL.3 CONTROL: a real change DOES add a blob — otherwise LL.3 passes because nothing is "
   "ever stored")

# ── LL.4  a partial rollback is refused ──────────────────────────────────────────────
# Half a restore is a state nobody has ever tested.
d, led = fresh()
a, b = d/"memory"/"a.md", d/"memory"/"b.md"
a.write_text("A1\n"); b.write_text("B1\n")
with led.mutate([a, b], actor="review", action="both") as m:
    a.write_text("A2\n"); b.write_text("B2\n")
h = led.entry(m.id)["before"][1]["sha256"]
(d/"blobs"/h).unlink()                             # lose one blob
try:
    led.rollback(m.id)
    FAIL.append("LL.4 a rollback proceeded with a missing blob — that is a PARTIAL restore")
except L.CaptureFailed as e:
    ok("PARTIAL" in str(e), f"LL.4 it refuses rather than half-restoring: {str(e)[:90]}")
# ...and NOTHING was changed. The first version of this check asserted only the raise, so it
# passed while `a.md` had already been restored and `b.md` had not — the exact half-restored
# state it claimed to refuse. Asserting an exception is not asserting an outcome.
# Read defensively: a broken rollback can DELETE one of these (treating a missing blob as
# "did not exist before"), and the first version of this crashed on the read instead of
# reporting. That is the rule I wrote in CLAUDE.md, broken by the next check I wrote.
def _now(path):
    try:
        return path.read_text()
    except OSError as _e:
        return f"<{type(_e).__name__}: gone>"


ok(_now(a) == "A2\n",
   f"LL.4 the file BEFORE the missing blob is untouched: {_now(a)!r} — a refusal that has "
   f"already written half the files is not a refusal")
ok(_now(b) == "B2\n",
   f"LL.4 and so is the one after it: {_now(b)!r} — if it is gone, the rollback treated a "
   f"missing blob as 'did not exist before' and DELETED a file it could not restore")

# ── LL.5  the entry says who, what and on whose evidence ─────────────────────────────
d, led = fresh()
p = d/"memory"/"c.md"; p.write_text("x\n")
with led.mutate([p], actor="review", action="accept",
                evidence="the user said yes out loud", candidate="cand-7") as m:
    p.write_text("y\n")
e = led.entry(m.id)
ok(e["actor"] == "review", f"LL.5 the actor: {e['actor']}")
ok(e["action"] == "accept" and e["candidate"] == "cand-7",
   f"LL.5 the action and the candidate it came from: {e['action']}/{e['candidate']}")
ok(e["evidence"] == "the user said yes out loud", "LL.5 and the evidence")
ok(e["before"][0]["sha256"] != e["after"][0]["sha256"],
   "LL.5 with before and after hashes that differ")
bad = led.record(actor="nobody", action="x", before=[])
ok(led.entry(bad)["actor"].startswith("unknown:"),
   "LL.5 an actor outside the known set is marked unknown, not accepted silently")

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f_ in FAIL:
        print(f"  - {f_}\n")
    sys.exit(1)
print("✓ learn ledger: telemetry never blocks, capture fails closed (LL.0 controls both)")
