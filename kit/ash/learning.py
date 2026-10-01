#!/usr/bin/env python3
"""learning — the LearningCandidate state machine, in the journal's own database (PLAN 20.2).

    observed ──► candidate ──► reviewed ──► approved ──► active
                                  │                         │
                                  ▼                         ▼
                              rejected                  corrected ──► superseded ──► archived

**`observed → candidate` is the only transition a model may cause.** Every later one needs a
human or a deterministic rule, and that is enforced here rather than asked for in a prompt —
hard rule 5: a rule that lives only in the constitution competes with everything else in
context and loses.

SQLite owns the state, in the Phase 6 journal's database, so a candidate inherits the things
that database already gets right: `event_id UNIQUE` dedup, a monotonic `sequence` that is an
integer rather than wall-clock, and a source bound by the transport rather than claimed.

The proposal queue this replaces was a directory of `.md` files (14.2). That was the right
shape for a gate landing before the first write; it is the wrong shape for a state machine,
because a filename cannot hold a status, a provenance chain or a contradiction link — and a
store whose state lives in its filenames is one `ls` away from being wrong.

Every transition is also journalled as an event, so "why does Ash believe this" is answerable
from the same place as "why did he say that".
"""
import re
import hashlib
import json
import os
import sqlite3
import threading
import time
import uuid
from pathlib import Path

import runtime

# ONE FACT, ONE LAYER (PLAN 20.4). Routing is decided here, in code, from the candidate's
# type — never by whatever proposed it. Hermes wrote this rule against a recorded failure in
# which its reviewer put profile data in the fact store and the same lesson in both, until
# both hit their size limits: writing it twice bloats both and crowds out what matters, and
# misrouting it puts it where the next session will not look.
#
# `episodic` is not here on purpose. It is the journal itself (20.1), not something a
# candidate is routed to — a turn is recorded, not learned.
LAYERS = {
    "preference": ("profile",    "profile",    "explicit preferences, communication and working style"),
    "fact":       ("facts",      "memory",     "environment, projects, decisions, stable corrections"),
    "procedure":  ("procedural", "skills",     "reviewed skills with tests, provenance and rollback"),
    "mastery":    ("learner",    "learner",    "concepts demonstrated, misconceptions, pace"),
}
TYPES = tuple(LAYERS)

STATES = ("observed", "candidate", "reviewed", "approved", "active",
          "rejected", "corrected", "superseded", "archived")

# Where each state may go. Anything not listed is refused — a state machine that only
# discourages a transition is a comment.
ALLOWED = {
    "observed":   {"candidate", "rejected"},
    "candidate":  {"reviewed", "rejected"},
    "reviewed":   {"approved", "rejected"},
    "approved":   {"active", "rejected"},
    "active":     {"corrected", "superseded", "archived"},
    "corrected":  {"superseded", "archived"},
    "superseded": {"archived"},
    "rejected":   set(),
    # RESTORE (22.1, owner 2026-09-26: "go" on the panel's restore). `archived` was terminal, and
    # the rule it shared with turns — a LATE event must not reopen something finished (D1) — is
    # about automation arriving after the fact. A person pressing RESTORE on something they can
    # see is not that. So the one way back is `archived -> active`, and only a HUMAN may take it
    # (HUMAN_ONLY below); a model or a rule is refused exactly as before. `rejected` stays
    # terminal: 22.4, rejected stays rejected.
    "archived":   {"active"},
}

# Terminal means terminal — the same rule `runtime.next_state` enforces for turns (6.6), for
# the same reason: a late event reopening something finished is how a cancelled turn kept
# talking (D1).
TERMINAL = {s for s, to in ALLOWED.items() if not to}
# Waiting for a person. The panel asks about these, and only these can be put off (D350).
PENDING_REVIEW = ("candidate", "reviewed", "approved")

# The ONE transition a model may cause on its own.
MODEL_MAY = {("observed", "candidate")}
# The transitions only a person may make. Restoring something that was put away is a decision
# about what he believes, and nothing automatic gets to make it (22.1).
HUMAN_ONLY = {("archived", "active")}
# Who a transition CLAIMS to be. Asserted by the caller, not authenticated — see the note in
# `transition`. Recorded so the claim is inspectable, which is the most this layer can offer.
ACTORS = ("model", "human", "rule")

# WHERE A CANDIDATE MAY COME FROM (PLAN 21.2). This is Phase 3's trust boundary reaching the
# learning path, and it is where the Rule of Two bites hardest: a turn that read a page and
# then wrote a durable preference has held all three legs — untrusted content, private data,
# and a state change — and left the third one on disk for every session afterwards.
#
# TRUSTED is what a person said, through a channel that can say who they were.
TRUSTED_SOURCES = {
    "ashd",            # the microphone, transcribed by the daemon itself
    "terminal",        # typed at the keyboard in the visible terminal
    "user",            # an explicit act in the orb's own control surface
}
# Everything else is untrusted, and these are named because they are the ones that exist:
UNTRUSTED_SOURCES = {
    "page", "feed", "document", "tool", "agent",
    # `orb:slot` is a FILE. Anything able to write ~/ash/voice/typed.json produces a
    # message indistinguishable from the text box, including an ash turn holding a Write
    # tool (D56). It runs a turn — that is the slot's job — but it may not write a durable
    # belief, because nothing can say who typed it. The socket path (6.7) IS authenticated
    # and is trusted when it arrives that way.
    "orb:slot",
}

# Characters that make a document read one way to a person and another to the model: bidi
# overrides, zero-width joiners and separators, and the byte-order mark used as a separator.
# A candidate carrying these is refused whatever its source — a promotion is a person saying
# "I read this and I mean it", and they did not read this.
_DECEPTIVE = re.compile(
    "[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u00ad]")


def trust_of(source_class):
    """'trusted' | 'untrusted'. Unknown is untrusted — fail closed, like the seat classifier
    (4.3): a source nobody has classified is not a source anybody vouched for."""
    s = str(source_class or "").strip()
    return "trusted" if s in TRUSTED_SOURCES else "untrusted"


class Refused(RuntimeError):
    """A candidate the do-not-capture gate turned away (20.3). Separate from StateError so a
    caller can tell "this must never be learned" from "not from that state"."""


class StateError(RuntimeError):
    """A refused transition. Raised, not returned: a caller that ignores a return value is
    how a guard becomes advisory."""


def _hash(text):
    return hashlib.sha256(str(text or "").encode()).hexdigest()[:32]


class Candidates:
    def __init__(self, path=None, journal=None, ledger=None):
        path = Path(path or runtime.DB)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), isolation_level=None, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS candidates (
                id            TEXT PRIMARY KEY,
                type          TEXT NOT NULL,
                status        TEXT NOT NULL,
                name          TEXT NOT NULL,
                body          TEXT NOT NULL,
                content_hash  TEXT NOT NULL,
                explicit      INTEGER NOT NULL,     -- "remember this" vs inferred
                source_events TEXT NOT NULL,        -- the event_ids it was judged from
                source_class  TEXT NOT NULL,        -- the AUTHENTICATED source class
                model         TEXT, provider TEXT, seat_decision TEXT,
                confidence    REAL,
                contradicts   TEXT,                 -- ids this disagrees with
                created       REAL NOT NULL,
                activated     REAL, expires REAL, replaced_by TEXT,
                uses          INTEGER NOT NULL DEFAULT 0,
                helped        INTEGER NOT NULL DEFAULT 0
            )""")
        # `projected_hash` is what WE last wrote to the projection. It is how a hand edit is
        # told apart from a stale projection, and it is added by migration because this table
        # may already exist on a machine that ran an earlier build.
        # `summary`, `why` and `later_until` are PLAN 20.2's voice move (2026-09-23): a voice
        # fact carries its one-line hook (the index line it becomes) and the words it was
        # heard in (what the panel shows under "why do I believe this?"), and LATER defers a
        # card rather than settling it (D350).
        for col, decl in (("projected_hash", "TEXT"), ("projected_path", "TEXT"),
                          ("promoted_by", "TEXT"), ("summary", "TEXT"), ("why", "TEXT"),
                          ("later_until", "REAL"),
                          # 22.1: pinned (never goes cold, drawn first), and WHEN it was last
                          # used and last said to have helped — a count alone says how often,
                          # never whether it is still earning its place.
                          ("pinned", "INTEGER NOT NULL DEFAULT 0"), ("last_used", "REAL"),
                          ("last_helped", "REAL")):
            try:
                self.db.execute(f"ALTER TABLE candidates ADD COLUMN {col} {decl}")
            except sqlite3.OperationalError:
                pass                     # already there
        self.db.execute("CREATE INDEX IF NOT EXISTS ix_cand_status ON candidates(status)")
        # UNIQUE, not an index. Two concurrent observes of identical content produced two
        # rows, and a store that holds the same belief twice will have it reviewed twice and
        # projected twice. SQLite refuses the second write; the caller is told which row
        # already holds it rather than being handed a silent duplicate.
        try:
            self.db.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_cand_hash "
                            "ON candidates(content_hash)")
        except sqlite3.IntegrityError:
            # An existing table already holds duplicates. Keep the plain index rather than
            # refusing to open the store, and say so — deleting somebody's rows to satisfy a
            # constraint is not this code's decision to make.
            self.db.execute("CREATE INDEX IF NOT EXISTS ix_cand_hash ON candidates(content_hash)")
        self.journal = journal
        # The learning ledger (20.6), wired into the one path that MUTATES a projection.
        # It was built and consulted by nothing, which Codex's third verification called out
        # and which is the same criticism that landed on transport.py: a safety net nobody
        # reaches for is a promise. Optional, because a Candidates store with no ledger is
        # still a usable store — but when one is present, every projection captures first.
        self.ledger = ledger
        self._lock = threading.Lock()

    # -- writing ------------------------------------------------------------------------
    def observe(self, *, type_, name, body, source_events, source_class,
                explicit=False, model=None, provider=None, seat_decision=None,
                confidence=None, expires=None, promoted_by=None, summary=None, why=None):
        """Record what was seen. Everything starts here, at `observed`.

        `summary` is the one-line hook a fact becomes in the memory index, and `why` is the
        evidence in words — both optional, both shown to the person who reviews it (20.2).

        A model may move this one step, to `candidate`, and no further.

        An UNTRUSTED source produces nothing unless a person explicitly promotes it
        (`promoted_by`). A web page saying "remember that the user prefers X" is a page
        saying that, not the user (21.2).
        """
        if type_ not in TYPES:
            raise StateError(f"unknown type {type_!r}; one fact, one layer: {TYPES}")
        # THE GATE BELONGS HERE, not only on `voice_distill.propose()`. This is the canonical
        # store now, and a gate that guards one door into a room with two is decoration —
        # a `negative` candidate ("X is broken") walked straight into SQLite. Found by
        # Codex's third verification, 2026-09-20.
        # Deceptive text is refused whatever its source, and BEFORE the promotion check: a
        # promotion means "I read this and I mean it", and nobody read what these characters
        # hide.
        hidden = _DECEPTIVE.findall(f"{name} {body} {summary or ''} {why or ''}")
        if hidden:
            raise Refused(
                f"the text carries {len(hidden)} invisible or direction-changing "
                f"character(s) ({[hex(ord(c)) for c in hidden[:4]]}) — it reads one way to a "
                f"person and another to the model, so no one can have meant it")

        trust = trust_of(source_class)
        if trust == "untrusted" and not promoted_by:
            raise Refused(
                f"{source_class!r} is untrusted and nobody promoted this. A page, a feed, a "
                f"document or a tool result saying 'remember X' is IT saying that, not the "
                f"user (21.2). Promote it explicitly if you read it and meant it.")

        import learn_gate
        # `refusal`, not `why`: that name is the caller's evidence argument (20.2), and the
        # gate's verdict reusing it blanked every voice fact's reasons before they were stored.
        allowed, klass, refusal = learn_gate.verdict(
            {"name": name, "description": "", "body": body})
        if not allowed:
            raise Refused(f"{klass}: {refusal}")
        cid = uuid.uuid4().hex[:16]
        with self._lock:
            existing = self.duplicates(body)
            if existing:
                dead = [e for e in existing if e["status"] in ("rejected", "superseded")]
                if dead:
                    # 22.4: rejected stays rejected, and the suppression is NAMED. An
                    # invisible suppression is how the loop looks broken rather than working.
                    raise Refused(
                        f"suppressed: {dead[0]['id']} was {dead[0]['status']} and this is the "
                        f"same content. A rejected candidate that resurfaces teaches the user "
                        f"to ignore the queue.")
                raise Refused(
                    f"already held as {existing[0]['id']} ({existing[0]['status']}); "
                    f"re-proposing it verbatim is the review being asked again, not new "
                    f"learning")
            self.db.execute(
                "INSERT INTO candidates(id,type,status,name,body,content_hash,explicit,"
                "source_events,source_class,model,provider,seat_decision,confidence,"
                "created,expires,promoted_by,summary,why) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (cid, type_, "observed", name, body, _hash(body), int(bool(explicit)),
                 json.dumps(list(source_events or [])), source_class, model, provider,
                 seat_decision, confidence, time.time(), expires, promoted_by,
                 (" ".join(str(summary).split())[:200] or None) if summary else None,
                 str(why)[:600] if why else None))
        self._journal(cid, None, "observed", "rule", "first seen")
        return cid

    def get(self, cid):
        cur = self.db.execute("SELECT * FROM candidates WHERE id=?", (cid,))
        row = cur.fetchone()
        if not row:
            return None
        cols = [d[0] for d in cur.description]
        return dict(zip(cols, row))

    def transition(self, cid, to, *, actor, reason=""):
        """Move a candidate, or raise.

        The write is a CONDITIONAL UPDATE on the current status, so two callers racing for
        the same transition cannot both win: SQLite decides, and the loser sees zero rows
        changed and is told so. That is the deterministic form of the same rule D66 learned
        the hard way — prove exclusion, do not infer it from undamaged output.
        """
        # ACTOR IS ASSERTED, NOT AUTHENTICATED, and saying so is the honest part. A caller
        # can pass `actor="human"` for a move a model is making; nothing here can tell.
        # Codex's third verification is right about that, and it is not fixable at this
        # layer — an in-process Python argument has no provenance.
        #
        # What IS enforceable here: the value is a known actor, the claim is journalled so a
        # later reader can see who it said it was, and `human` moves are the ones the ask
        # bridge already authenticates elsewhere (4.7, `voice-approve.mjs` — a real spoken
        # yes, id-correlated, failing closed on timeout). Wiring transitions to THAT is
        # 21.x's work; until then the guarantee is "the machine refuses illegal moves", not
        # "the machine knows who you are".
        if actor not in ACTORS:
            raise StateError(f"unknown actor {actor!r}; one of {ACTORS}")
        if to not in STATES:
            raise StateError(f"unknown state {to!r}")
        cur = self.get(cid)
        if cur is None:
            raise StateError(f"no candidate {cid!r}")
        was = cur["status"]
        if was in TERMINAL:
            raise StateError(f"{cid} is {was}; {to!r} arrives too late")
        if to not in ALLOWED[was]:
            raise StateError(
                f"{was} -> {to} is not a transition; from {was} you may go to "
                f"{sorted(ALLOWED[was]) or 'nowhere'}")
        if (was, to) in HUMAN_ONLY and actor != "human":
            raise StateError(f"only a person may take {was} -> {to}; {actor!r} was refused (22.1)")
        if actor == "model" and (was, to) not in MODEL_MAY:
            raise StateError(
                f"a model may only do {sorted(MODEL_MAY)}, not {was} -> {to}. Every later "
                f"step needs a human or a deterministic rule.")
        with self._lock:
            extra = ", activated=?" if to == "active" else ""
            args = [to]
            if to == "active":
                args.append(time.time())
            args += [cid, was]
            n = self.db.execute(
                f"UPDATE candidates SET status=?{extra} WHERE id=? AND status=?",
                tuple(args)).rowcount
        if not n:
            raise StateError(
                f"{cid} was not {was} when the write landed — somebody else moved it first")
        self._journal(cid, was, to, actor, reason)
        return to

    def defer(self, cid, until, *, actor, reason=""):
        """LATER (D350): keep a pending card pending and out of the queue until `until`.

        NOT a transition. The first LATER walked the state machine to `archived`, which is
        terminal and passes through `active` on the way — so "ask me later" switched the belief
        ON and then threw it away for good, and on a fresh `candidate` card it refused outright
        and called the card settled. A deferral changes when it is asked about, never what it
        is. Only a pending card can be deferred; a settled one has nothing left to ask.
        """
        if actor not in ACTORS:
            raise StateError(f"unknown actor {actor!r}; one of {ACTORS}")
        cur = self.get(cid)
        if cur is None:
            raise StateError(f"no candidate {cid!r}")
        if cur["status"] not in PENDING_REVIEW:
            raise StateError(f"{cid} is {cur['status']}; only a card still waiting for a "
                             f"decision can be put off")
        with self._lock:
            self.db.execute("UPDATE candidates SET later_until=? WHERE id=?",
                            (float(until), cid))
        self._journal(cid, cur["status"], cur["status"], actor,
                      reason or f"later, until {time.strftime('%Y-%m-%d %H:%M', time.localtime(until))}")
        return until

    def by_name(self, name, statuses=None):
        """Candidates with this slug, newest first — `voice_distill accept NAME` finds its card
        this way. A name is not unique (content is), so the caller gets every match."""
        q, args = "SELECT * FROM candidates WHERE name=?", [name]
        if statuses:
            q += f" AND status IN ({','.join('?' * len(statuses))})"
            args += list(statuses)
        cur = self.db.execute(q + " ORDER BY created DESC", tuple(args))
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    def used(self, cid, helped=False):
        """It was used; say so, and whether it helped. The time goes with the count (22.1)."""
        now = time.time()
        with self._lock:
            self.db.execute(
                "UPDATE candidates SET uses=uses+1, helped=helped+?, last_used=?, "
                "last_helped=CASE WHEN ? THEN ? ELSE last_helped END WHERE id=?",
                (1 if helped else 0, now, 1 if helped else 0, now, cid))

    # States a belief is live in: the ones a pin or a correction can apply to.
    LIVE_STATES = ("active", "corrected")

    def pin(self, cid, on=True, *, actor):
        """PIN (22.1): a live belief that never goes cold and is drawn first. Only a person pins,
        and only something he currently believes; a pin is recorded in the journal like a move."""
        if actor != "human":
            raise StateError(f"only a person may pin; {actor!r} was refused")
        cur = self.get(cid)
        if cur is None:
            raise StateError(f"no candidate {cid!r}")
        if cur["status"] not in self.LIVE_STATES:
            raise StateError(f"{cid} is {cur['status']}; only something he believes now can be pinned")
        with self._lock:
            self.db.execute("UPDATE candidates SET pinned=? WHERE id=?", (1 if on else 0, cid))
        self._journal(cid, cur["status"], cur["status"], actor, "pinned" if on else "unpinned")
        return bool(on)

    def correct(self, cid, body, *, actor, source_class="user"):
        """CORRECT (22.1): the person rewrites a belief. `supersede` keeps the old wording as a
        row with a status (recoverable, never deleted), and the new wording is ACTIVE at once:
        a person typed it, so there is nobody left to review it for. Every step is its own
        recorded move with the person as its actor. A correction still passes the same gate as
        anything new (`observe`), so it cannot smuggle in what an observation could not."""
        if actor != "human":
            raise StateError(f"only a person may correct; {actor!r} was refused")
        old = self.get(cid)
        if old is None:
            raise StateError(f"no candidate {cid!r}")
        body = " ".join(str(body or "").split())
        if not body:
            raise StateError("a correction needs the new wording")
        if body == " ".join((old.get("body") or "").split()):
            raise StateError("that is what it already says")
        events = json.loads(old.get("source_events") or "[]") if isinstance(old.get("source_events"), str) \
            else list(old.get("source_events") or [])
        new = self.supersede(cid, type_=old["type"], name=old["name"], body=body, source_events=events,
                             source_class=source_class, explicit=True, promoted_by="human", actor="human")
        for step in ("candidate", "reviewed", "approved", "active"):
            self.transition(new, step, actor="human", reason=f"corrected from {cid} on the learning panel")
        if old.get("pinned"):
            self.pin(new, True, actor="human")          # a pin belongs to the belief, not its wording
        return new

    # -- reading ------------------------------------------------------------------------
    def by_status(self, status):
        cur = self.db.execute(
            "SELECT * FROM candidates WHERE status=? ORDER BY created", (status,))
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    def duplicates(self, body):
        """Anything already holding this exact content, whatever its state. A rejected
        candidate re-proposed verbatim is the review being asked again, not new learning."""
        h = _hash(body)
        cur = self.db.execute("SELECT * FROM candidates WHERE content_hash=?", (h,))
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    def close(self):
        try:
            self.db.close()
        except Exception:
            pass

    # -- rejected stays rejected (PLAN 22.4) ----------------------------------------------
    def supersede(self, old_cid, *, type_, name, body, source_events, source_class,
                  explicit=False, promoted_by=None, actor="human"):
        """Replace `old_cid` with a correction. Returns the new candidate's id.

        A correction SUPERSEDES rather than competing: the old one is walked to `superseded`
        and points at its replacement, so the store never holds two live answers to the same
        question. The superseded version stays recoverable — it is a row with a status, not
        a deletion, which is what lets "what did you used to think" be answerable.
        """
        old = self.get(old_cid)
        if old is None:
            raise StateError(f"no candidate {old_cid!r}")
        new_cid = self.observe(type_=type_, name=name, body=body,
                               source_events=source_events, source_class=source_class,
                               explicit=explicit, promoted_by=promoted_by)
        # `superseded` is only reachable from active/corrected, so walk it there if it is
        # somewhere earlier. A candidate superseded from `observed` is still superseded.
        route = {"observed": ["candidate", "reviewed", "approved", "active", "corrected"],
                 "candidate": ["reviewed", "approved", "active", "corrected"],
                 "reviewed": ["approved", "active", "corrected"],
                 "approved": ["active", "corrected"],
                 "active": ["corrected"], "corrected": []}.get(old["status"])
        if route is None:
            raise StateError(f"{old_cid} is {old['status']}; it cannot be superseded")
        for step in route + ["superseded"]:
            self.transition(old_cid, step, actor=actor, reason=f"superseded by {new_cid}")
        with self._lock:
            self.db.execute("UPDATE candidates SET replaced_by=? WHERE id=?",
                            (new_cid, old_cid))
        return new_cid

    def suppressed(self, body):
        """(suppress, reason). True when this content was already rejected or superseded.

        A rejected candidate that resurfaces teaches the user to ignore the queue, which is
        the same failure as a suite that goes red for no defect. The suppression is RECORDED
        by the caller — an invisible one is how the loop looks broken instead of working.
        """
        for row in self.duplicates(body):
            if row["status"] in ("rejected", "superseded"):
                return True, (f"{row['id']} was {row['status']} on "
                              f"{time.strftime('%Y-%m-%d', time.localtime(row['created']))}"
                              + (f", replaced by {row['replaced_by']}"
                                 if row.get("replaced_by") else ""))
        return False, ""

    # -- "remember this" (PLAN 21.5) ------------------------------------------------------
    def confirm_explicit(self, cid, ask, *, preview=None):
        """Walk an EXPLICIT candidate to `active` in this turn, on a spoken yes.

        `ask(question) -> bool` is the caller's ask bridge — `ashd.ask_yes_no`, which speaks,
        opens the mic, and returns False on silence after 20 s. **Extend that one**; a second
        approval mechanism is another thing to keep honest, and 4.7's already fails closed and
        is id-correlated.

        The asymmetry this implements: what you SAID he repeats back now; what he GUESSED
        waits in the queue until you see it. So an inferred candidate is refused here at any
        confidence — not discouraged, refused.

        Everything that is not a clear yes is a no: silence, a malformed answer, a timeout, a
        callback that raises, a missing callback. The approval is the ANSWER to this question
        and nothing else — no text in the candidate's own body, a page, a transcript or a feed
        title can stand in for it (3.10, D56).
        """
        c = self.get(cid)
        if c is None:
            raise StateError(f"no candidate {cid!r}")
        if not c["explicit"]:
            raise StateError(
                f"{cid} was INFERRED, not asked for. Inferred learning always waits for the "
                f"nightly review — that asymmetry is the whole design (21.5).")
        if c["status"] != "observed":
            raise StateError(f"{cid} is {c['status']}; confirm only from observed")

        question = preview or (
            f"Shall I remember that? {c['body'].strip()[:160]}")
        try:
            said_yes = bool(ask(question))
        except Exception:
            said_yes = False             # a question that raised was not answered yes

        self.transition(cid, "candidate", actor="model", reason="explicit instruction")
        if not said_yes:
            self.transition(cid, "rejected", actor="human", reason="not confirmed in turn")
            return False
        for step, why in (("reviewed", "previewed out loud"),
                          ("approved", "confirmed in turn"),
                          ("active", "explicit instruction")):
            self.transition(cid, step, actor="human", reason=why)
        return True

    # -- routing (PLAN 20.4) -------------------------------------------------------------
    def route(self, cid, root):
        """(layer, path, reason) for one candidate. Decided from its TYPE, in code.

        Raises rather than guessing on an unknown type: a candidate with nowhere to go is a
        contradiction to surface, not something to drop in the nearest layer.
        """
        c = self.get(cid)
        if c is None:
            raise StateError(f"no candidate {cid!r}")
        entry = LAYERS.get(c["type"])
        if entry is None:
            raise StateError(
                f"{c['type']!r} has no layer; one fact goes to exactly one of {sorted(LAYERS)}")
        layer, subdir, holds = entry
        path = Path(root)/subdir/f"{c['name']}.md"
        return layer, path, f"type {c['type']!r} -> {layer} ({holds})"

    def routed_layers(self, cid):
        """Every layer this candidate has actually been written to.

        More than one is the double write 20.4 forbids: it is found by asking where the
        projections ARE, not by trusting that routing was obeyed.
        """
        c = self.get(cid)
        if not c or not c.get("projected_path"):
            return []
        return [Path(c["projected_path"]).parent.name]

    # -- projections (PLAN 20.5) ---------------------------------------------------------
    def render(self, cid):
        """The projection's exact bytes, from the candidate alone.

        A pure function of the row, so a projection is byte-derivable from what is behind it
        — which is what makes a hand edit detectable at all. If this ever consults anything
        but the candidate, that property is gone.
        """
        c = self.get(cid)
        if c is None:
            raise StateError(f"no candidate {cid!r}")
        # The one-line summary when the proposer gave one (20.2's voice facts do), else the
        # name — the fallback is what every row written before 2026-09-23 renders, so their
        # projected bytes (and so `hand_edited`) are unchanged.
        desc = " ".join(str(c.get("summary") or c.get("name") or "").split())[:110]
        return (f"---\nname: {c['name']}\ndescription: {desc}\nmetadata:\n"
                f"  type: {c['type']}\n  candidate: {c['id']}\n---\n{c['body'].strip()}\n")

    def hand_edited(self, cid):
        """(edited, detail). True when the file on disk is not what we last wrote.

        The user editing their own memory by hand is a LEGITIMATE act. Overwriting it is the
        lost-update bug with feelings, so this is reported and the write refused — never
        resolved by clobbering.
        """
        c = self.get(cid)
        if not c or not c.get("projected_path"):
            return False, "never projected"
        path = Path(c["projected_path"])
        if not path.exists():
            return True, f"{path} was deleted after it was projected"
        now = _hash(path.read_text())
        if now != c.get("projected_hash"):
            return True, (f"{path} has changed since it was written — the user edited it, "
                          f"and that is theirs to do")
        return False, ""

    def project(self, cid, path, *, force=False):
        """Write one approved candidate to its projection. THE ONLY writer (20.5 / 14.1).

        Refuses unless the candidate is `active`: a projection is what Ash currently
        believes, and writing one for something still under review would make the review
        cosmetic.
        """
        import fcntl
        c = self.get(cid)
        if c is None:
            raise StateError(f"no candidate {cid!r}")
        if c["status"] != "active":
            raise StateError(
                f"{cid} is {c['status']}; only an active candidate is projected. Writing one "
                f"earlier would make the review cosmetic.")
        # ROUTING IS NOT ADVISORY. `route()` decided where this belongs (20.4); accepting
        # any path the caller supplies makes that a suggestion, and a preference could be
        # written into the fact layer by passing the path. The caller may still choose the
        # ROOT — that is how a test or a mirror points elsewhere — but not the layer or the
        # name. Found by Codex's third verification, 2026-09-20.
        path = Path(path)
        _layer, want, _why = self.route(cid, path.parent.parent)
        if path != want:
            raise StateError(
                f"{cid} routes to {want} (layer {_layer!r}), not {path}. One fact, one "
                f"layer — the path is derived from the type, not chosen.")
        # A candidate already written to a DIFFERENT layer is a contradiction to surface,
        # never a second write. Both copies would then bloat their layer and neither would
        # be the one the next session finds.
        prev = c.get("projected_path")
        if prev and Path(prev).parent != path.parent:
            raise StateError(
                f"{cid} is already projected to {Path(prev).parent.name!r}; writing it to "
                f"{path.parent.name!r} as well is the double write 20.4 forbids. One fact, "
                f"one layer — decide which, and supersede the other.")
        text = self.render(cid)
        path.parent.mkdir(parents=True, exist_ok=True)
        # CAPTURE BEFORE THE WRITE, and fail closed. `learn_ledger.capture` raises if the
        # before-state cannot be stored, so a projection that cannot be undone does not
        # happen — the asymmetry 20.6 exists for, applied at the only place that changes a
        # file the user can open.
        before = None
        if self.ledger is not None:
            before = self.ledger.capture([path])
        lock = path.with_suffix(path.suffix + ".lock")
        try:
            lk = open(lock, "w")
        except OSError:
            lk = None
        try:
            if lk:
                fcntl.flock(lk, fcntl.LOCK_EX)
            edited, why = self.hand_edited(cid)
            if edited and not force:
                raise StateError(f"refusing to overwrite: {why}")
            # The same pid-and-thread-unique tmp `adapters.write_slot` uses: a shared ".tmp"
            # is its own race, and it is the one that bit write_state on 2026-09-15.
            tmp = path.with_suffix(f".{os.getpid()}.{threading.get_ident()}.tmp")
            tmp.write_text(text)
            os.replace(tmp, path)
        finally:
            if lk:
                try:
                    fcntl.flock(lk, fcntl.LOCK_UN)
                finally:
                    lk.close()
        with self._lock:
            self.db.execute(
                "UPDATE candidates SET projected_hash=?, projected_path=? WHERE id=?",
                (_hash(text), str(path), cid))
        if self.ledger is not None:
            # Telemetry, after the fact and never fatal: the write has already happened.
            self.ledger.record(actor="review", action="project", before=before,
                               after=[{"path": str(path),
                                       "sha256": self.ledger.put_blob(text)}],
                               evidence=f"candidate {cid} is active", candidate=cid)
        self._journal(cid, c["status"], c["status"], "rule", f"projected to {path}")
        return path

    # -- the audit trail ----------------------------------------------------------------
    def _journal(self, cid, was, to, actor, reason):
        """Never fatal: a transition that cannot be journalled still happened, and refusing
        to record it by refusing to do it loses both."""
        if not self.journal:
            return None
        try:
            msg = runtime.envelope("task.state", actor,
                                   {"candidate": cid, "from": was, "to": to,
                                    "actor": actor, "reason": reason})
            return self.journal.append(msg, source=actor)
        except Exception:
            return None
