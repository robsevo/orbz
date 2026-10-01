#!/usr/bin/env python3
"""Protocol v1, asserted. Run: orb/daemon/.venv/bin/python test_runtime.py

PLAN 6.1-6.5. Each group names the SPECIFIC loss it replaces, measured on the file slots
this protocol exists to retire — because "we have a protocol now" is not a proof.

T.0 is the control: the old slot behaviour must be shown losing a message. If a plain file
slot does not drop anything under these conditions, the protocol is solving nothing.
"""
import json
import sys
import tempfile
import threading
from pathlib import Path

import runtime as rt

FAIL = []


def ok(cond, label):
    if not cond:
        FAIL.append(label)


def eq(got, want, label):
    if got != want:
        FAIL.append(f"{label}\n     got: {got!r}\n    want: {want!r}")


def journal():
    return rt.Journal(Path(tempfile.mkdtemp(prefix="rtj-"))/"t.db")


# ── T.0  CONTROL: the slot this replaces really does lose messages ─────────────────────
d = Path(tempfile.mkdtemp(prefix="slot-"))
slot = d/"typed.json"
for text in ("first task", "second task"):          # two sends inside one reader tick
    slot.write_text(json.dumps({"t": 1.0, "text": text}))
eq(json.loads(slot.read_text())["text"], "second task",
   "T.0 CONTROL: a file slot keeps only the LAST write")
ok("first task" not in slot.read_text(),
   "T.0 CONTROL: the first message is gone with no error on either side — this is "
   "typed.json today, and the reader cannot tell it happened")

j = journal()
for text in ("first task", "second task"):
    j.append(rt.envelope("command", "orb", {"text": text}), source="orb")
eq([e["payload"]["text"] for e in j.since(0)], ["first task", "second task"],
   "T.0 the journal keeps both, in order")

# ── T.1  sequence is monotonic, not wall-clock ─────────────────────────────────────────
j = journal()
seqs = [j.append(rt.envelope("health", "ashd"), source="ashd")["sequence"] for _ in range(5)]
eq(seqs, sorted(seqs), "T.1 sequence increases")
eq(len(set(seqs)), 5, "T.1 and never repeats")
# A message stamped in the PAST must still get the next sequence. `t` was wall-clock on nine
# slots, so an NTP step backwards stalled every high-water reader until the clock caught up.
back = rt.envelope("health", "ashd")
back["timestamp"] = 0.0
eq(j.append(back, source="ashd")["sequence"], max(seqs) + 1,
   "T.1 a message from the past still sequences forward — a clock step backwards cannot "
   "stall a reader the way it could on the timestamp slots")

# ── T.2  at-least-once delivery executes once ──────────────────────────────────────────
j = journal()
m = j.append(rt.envelope("command", "orb", {"text": "open the weather panel"}), source="orb")
again = j.append(m, source="orb")
eq(again["sequence"], m["sequence"], "T.2 a duplicate event_id returns the ORIGINAL")
eq(len(j.since(0)), 1, "T.2 and is not journalled twice")
eq(again["payload"], m["payload"], "T.2 with the original's payload, not the resend's")

# ── T.3  resume from a sequence ────────────────────────────────────────────────────────
j = journal()
for i in range(10):
    j.append(rt.envelope("health", "ashd", {"i": i}), source="ashd")
mark = j.since(0)[4]["sequence"]
eq([e["payload"]["i"] for e in j.since(mark)], [5, 6, 7, 8, 9],
   "T.3 a consumer resumes from its last sequence and sees no gap and no repeat")
j2 = rt.Journal(Path(j.db.execute("PRAGMA database_list").fetchone()[2]))
eq(j2.last_sequence(), 10, "T.3 and the journal survives being reopened — this is a restart")

# ── T.4  the source is BOUND, not claimed (D56) ────────────────────────────────────────
j = journal()
liar = rt.envelope("approval.answer", "orb", {"answer": "yes"})
bound = j.append(liar, source="ash-turn-7")
eq(bound["source"], "ash-turn-7",
   "T.4 the transport's source overrides what the message CLAIMS — D56 is a turn answering "
   "its own permission question by writing the file first")
eq(j.since(0)[0]["source"], "ash-turn-7", "T.4 and the journal records the bound source")

# ── T.5  fail closed on anything not understood ────────────────────────────────────────
for bad, why in (
    ({}, "an empty object"),
    ({"schema_version": 99, "event_id": "x", "source": "s", "type": "health", "timestamp": 1},
     "a schema from the future"),
    ({"schema_version": 1, "event_id": "x", "source": "s", "type": "nonsense", "timestamp": 1},
     "an unknown type"),
    ({"schema_version": 1, "event_id": "", "source": "s", "type": "health", "timestamp": 1},
     "a missing event_id"),
    ({"schema_version": 1, "event_id": "x", "source": "s", "type": "health", "timestamp": 1,
      "payload": "a string"}, "a payload that is not an object"),
    ({"schema_version": 1, "event_id": "x", "source": "s", "type": "turn.state", "timestamp": 1,
      "payload": {"state": "vibing"}}, "an unknown turn state"),
):
    try:
        rt.validate(bad)
        FAIL.append(f"T.5 ACCEPTED {why} — the protocol must refuse what it cannot understand")
    except rt.ProtocolError:
        pass
ok(True, "T.5 six malformed shapes all refused")

# ── T.6  a finished turn cannot be revived ─────────────────────────────────────────────
eq(rt.next_state("running", "speaking"), "speaking", "T.6 an ordinary transition is allowed")
for done in ("completed", "cancelled", "failed"):
    try:
        rt.next_state(done, "speaking")
        FAIL.append(f"T.6 a {done} turn was allowed to start SPEAKING — that is the late "
                    f"event that talks after a stop (D1)")
    except rt.ProtocolError:
        pass
ok(True, "T.6 a terminal turn stays terminal")

# ── T.7  concurrent producers lose nothing ─────────────────────────────────────────────
# The say-queue orders by filename at millisecond resolution: two writers in the same
# millisecond produce the same name and tmp.replace silently destroys one.
j = journal()
errors = []


def hammer(n):
    for i in range(40):
        try:
            j.append(rt.envelope("task.state", f"w{n}", {"w": n, "i": i}), source=f"w{n}")
        except Exception as e:                       # noqa: BLE001 - counted, not raised
            errors.append(repr(e))


ts = [threading.Thread(target=hammer, args=(n,)) for n in range(6)]
for t in ts:
    t.start()
for t in ts:
    t.join()
eq(errors, [], "T.7 six concurrent producers raise nothing")
eq(len(j.since(0)), 240, "T.7 and every one of the 240 messages is there")
seqs = [e["sequence"] for e in j.since(0)]
eq(len(set(seqs)), 240, "T.7 with no duplicate sequence — unlike a millisecond filename")

if FAIL:
    print(f"✗ {len(FAIL)} failure(s):\n")
    for f in FAIL:
        print(f"  - {f}\n")
    sys.exit(1)
print("✓ runtime v1: 8 groups green (T.0 control: the slot it replaces loses a message)")
