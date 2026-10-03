#!/usr/bin/env python3
"""Carry Ash's Python modules and their suites into `kit/ash/` (PLAN 1.3), and say exactly how
the copy differs from Ash.

Read-only against `~/ash` (CLAUDE.md rule 7). Every file is copied as it is, then the PATCHES
and CUTS below are applied, each with its reason, and `kit/ash/CARRIED.md` records all of it:
Ash's hash, the kit's hash, and every difference. Nothing in `kit/ash/` is edited by hand; a
change to a carried file is a patch here, so the list of differences can never go stale.

A CUT removes whole check groups from a suite (a group starts at its `# ── <ID>` header and ends
at the next header or at the closing `if FAIL:`). Only checks that test ASH'S WIRING are cut —
that `ashd.py` calls the module, that Ash's installer ships a script — never a check of the
module itself, and each cut names the Orbs row that owns the same guarantee for Orbs.

    python tools/adoption/carry.py            # (re)carry from ~/ash; writes CARRIED.md and .json
    python tools/adoption/carry.py --check    # kit/ash still matches CARRIED.json (no ~/ash needed)
    python tools/adoption/carry.py --drift    # what Ash changed since the carry (needs ~/ash)
"""
from __future__ import annotations

import ast
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ASH_REPO = Path.home() / "ash/app"
ASH = ASH_REPO / "orb/daemon"
REPO = Path(__file__).resolve().parents[2]
KIT = REPO / "kit" / "ash"

# Wave 1: every kit module whose import closure (lazy imports included) stays inside the kit,
# plus the small infrastructure they share. Modules that reach Ash's daemon core or the GNOME
# desktop are carried by the row that rewires them (see CARRIED.md "Not carried yet").
MODULES = [
    # infrastructure
    "statepaths", "common", "runtime", "writer_stamp", "taskshape", "sourceof", "ran_everything",
    # spoken text
    "speakable", "spoken_shape", "spoken_words", "spoken_choice", "lexicon", "phrasing",
    # learning
    "learning", "learn_gate", "learn_ledger", "belief_use", "memindex", "skill_draft",
    "skill_lifecycle", "skill_usage",
    # lessons
    "learner_model", "practice_card",
    # the day
    "day_verbs", "briefs", "proactive", "whenparse",
    # the day itself (PLAN 4.5): its calendar is what the home hands in (eds.py, Orbs' own)
    "day", "dayplan", "reminders",
    # safety + honesty
    "oneway", "redact", "secretscan", "write_guard",
    # chat
    "chatstore", "sessionlog",
    # voice (the ONNX wave: kokoro-onnx, faster-whisper, openwakeword, onnxruntime; no torch/tflite)
    "micaudio", "wake", "stt", "turnend", "voice", "voiceturn", "pagesrc",
]

SUITES = [
    "test_day", "test_dayplan", "test_reminders", "test_proactive",
    "test_speakable", "test_articles", "test_narration_glitches", "test_phrasing",
    "test_learning", "test_learn_gate", "test_learn_ledger", "test_belief_use", "test_memindex",
    "test_skill_draft", "test_skill_lifecycle", "test_skill_usage",
    "test_learner_model", "test_practice_card",
    "test_day_verbs", "test_day_verbs_calendar", "test_remind_me", "test_whenparse",
    "test_oneway", "test_redact", "test_secretscan", "test_write_guard",
    "test_chatstore", "test_statepaths", "test_common", "test_runtime", "test_log_fields",
    "test_ad_voice", "test_stt", "test_voiceturn", "test_micaudio",
    "test_mic_fallback", "test_mic_stall", "test_voice_policy", "test_spoken_sounds",
    "test_reasoning_not_spoken", "test_wake_state",
]

# The kit's modules that are not carried yet, and the PLAN row that carries each. Each one reaches
# Ash's daemon core (controller, transport, seatbroker), the GNOME desktop (EDS, deskgeom,
# winplace), so it comes with the row that rewires it.
LATER = {
    "speech": "4.3", "listen": "4.3", "sayloop": "4.3",
    "adapters": "not carried: Ash's legacy file-slot transport; its approval rule (may_approve: only an explicit act of the person, never text) is the home's card channel (1.6). The journal the day keeps promises in is Orbs' own adapters.py",
    "learn_review": "3.5", "voice_distill": "3.5", "prefs_model": "3.5", "retrieve": "3.5",
    "lesson": "4.4", "lesson_demos": "4.4", "lessonturn": "4.4", "teachcanvas": "4.4", "tutor": "4.4",
    "summarize": "4.5 (with the documents it reads: docread and retrieve are not carried)",
    "pagecheck": "4.1",
}

# Suites of carried modules that are NOT carried, because every check in them is about Ash.
DROPPED = {
    "test_skill_entrypoints": "it tests Ash's `install/bin/ashlearn` launcher and its hand-off to "
                              "voice_distill; skill_draft itself is covered by test_skill_draft",
    "test_comma_beats": "red in Ash's own environment on 2026-10-01: CB.1 (no pause mid-sentence) failed "
                        "5 of 6 runs there and 6 of 6 in the kit, on the same sentence, the pause after a "
                        "different word each time (Ash's voice.py has uncommitted edits). A suite red at "
                        "its source would make the gate a coin flip; it returns with the voice in PLAN 4.3",
    "test_quick_answer": "it lifts the quick-answer methods out of ashd.py and runs them: the daemon's "
                         "turn, which Orbs rebuilds in the voice turn (PLAN 4.3)",
    "test_unattended_free": "it walks Ash's seat broker for paid calls from unattended loops; in Orbs "
                            "the spend cap and free-by-default seats are the brain ladder's (PLAN 1.4)",
}

# Old versions of files that suites read from Ash's git history as their planted-defect controls
# (`git show <rev>:<path>`). The kit has no Ash history, so the exact blobs are carried into
# fixtures/git/<rev>/<path> and `carried_git.show()` serves them; the controls keep working.
GIT_FIXTURES = [
    ("caf23fd", "orb/daemon/speakable.py"),
    ("91cfcef", "orb/daemon/day_verbs.py"),
    ("edd72cc", "orb/daemon/day_verbs.py"),
    ("edd72cc", "orb/daemon/whenparse.py"),
    # test_narration_glitches reads HEAD, which in Ash is the commit before its uncommitted fix
    ("7c9ddd1", "orb/daemon/spoken_choice.py"),
    ("44388a8", "orb/daemon/voice.py"),
    ("f7a1726", "orb/daemon/speakable.py"),
    # RN.4's control: the ask path lived in ashd.py before the split. Only read, as text.
    ("f7a1726", "orb/daemon/ashd.py"),
    # test_mic_stall reads HEAD, the commit before Ash's uncommitted stall fix
    ("b015e3f", "orb/daemon/micaudio.py"),
    # DY.30 and DP.6/7 read HEAD, the commits before Ash's uncommitted day and dayplan edits
    ("9fe64ce", "orb/daemon/day.py"),
    ("2d6023c", "orb/daemon/dayplan.py"),
]

# Binary files carried as they are (path under kit/ash = path under Ash's daemon directory).
BINARIES = ["wakeword/model_out/hey_ash.onnx"]  # Ash's trained "hey ash" (PLAN 4.3 keeps it)

# Carried from elsewhere in Ash's repo (name in kit/ash -> path under ~/ash/app).
OTHER_SOURCES = {
    "release_gate.py": "tools/release_gate.py",
    # the WMO table the day's weather words are PARSED from (day._wmo): the panel's own file
    "weather.2.js": "orb/shell/panels/weather.2.js",
}

# Files in kit/ash written for Orbs, not carried (carry.py leaves them alone).
# eds.py: your calendar and list as the home hands them in (PLAN 4.5), in place of Ash's EDS;
# eds_sandbox.py: nothing to sweep (the kit's calendar cannot be written); adapters.py: the journal.
OURS = {"carried_git.py", "eds.py", "eds_sandbox.py", "adapters.py"}

# (file, the exact text, its replacement, why). Applied in order; every anchor must be found.
PATCHES: list[tuple[str, str, str, str]] = [
    ("statepaths.py",
     '    override = os.environ.get("ASH_STATE_HOME")\n    return Path(override) if override else Path.home()/"ash/voice"',
     '    override = os.environ.get("ORBS_KIT_STATE") or os.environ.get("ASH_STATE_HOME")\n'
     '    return Path(override) if override else Path.home()/".orbs"/"kit"',
     "the kit's state lives in the Orbs data directory (the home sets ORBS_KIT_STATE); never "
     "Ash's live ~/ash/voice. ASH_STATE_HOME still works, because the carried suites use it"),
    ("statepaths.py",
     '    return Path(os.environ.get("ASH_HOME") or Path.home()/"ash/brain")',
     '    return Path(os.environ.get("ORBS_BRAIN") or os.environ.get("ASH_HOME") or Path.home()/".orbs"/"brain")',
     "the owner's brain for Orbs is <data>/brain, never ~/ash/brain"),
    ("learn_ledger.py",
     'HOME = Path(os.environ.get("ASH_BRAIN_HOME") or Path.home()/"ash/brain")',
     'HOME = Path(os.environ.get("ORBS_BRAIN") or os.environ.get("ASH_BRAIN_HOME") or Path.home()/".orbs"/"brain")',
     "same root as statepaths.brain(): the Orbs brain, never ~/ash/brain"),
    ("memindex.py",
     '    return Path(os.environ.get("ASH_BRAIN_HOME") or Path.home()/"ash/brain")/"memory"/"MEMORY.md"',
     '    return Path(os.environ.get("ORBS_BRAIN") or os.environ.get("ASH_BRAIN_HOME") or Path.home()/".orbs"/"brain")/"memory"/"MEMORY.md"',
     "same root as statepaths.brain()"),
    ("skill_draft.py",
     'BRAIN = Path(os.environ.get("ASH_BRAIN_HOME") or Path.home()/"ash/brain")',
     'BRAIN = Path(os.environ.get("ORBS_BRAIN") or os.environ.get("ASH_BRAIN_HOME") or Path.home()/".orbs"/"brain")',
     "same root as statepaths.brain()"),
    ("skill_usage.py",
     'HOME = Path(os.environ.get("ASH_BRAIN_HOME") or Path.home()/"ash/brain")',
     'HOME = Path(os.environ.get("ORBS_BRAIN") or os.environ.get("ASH_BRAIN_HOME") or Path.home()/".orbs"/"brain")',
     "same root as statepaths.brain()"),
    ("practice_card.py",
     'CARD = os.path.expanduser("~/ash/voice/practice-report.json")',
     'CARD = os.path.join(os.environ.get("ORBS_KIT_STATE") or os.path.expanduser("~/.orbs/kit"), "practice-report.json")',
     "the night's report card is written into the kit's state, never Ash's"),
    ("write_guard.py",
     '    (HOME/"ash/brain"/"CONSTITUTION.md", "the constitution — every rule Ash is meant to follow"),\n]',
     '    (HOME/"ash/brain"/"CONSTITUTION.md", "the constitution — every rule Ash is meant to follow"),\n'
     '    # Orbs (kit/ash/CARRIED.md): the Orbs data directory, which a kit suite must never touch either.\n'
     '    (HOME/".orbs"/"home.db", "the home\'s event log and every orb\'s queue"),\n'
     '    (HOME/".orbs"/"kit"/"run"/"runtime.db", "the kit\'s journal and candidate store"),\n'
     '    (HOME/".orbs"/"kit"/"learning-ledger.jsonl", "what an orb learned and how to put it back"),\n'
     '    (HOME/".orbs"/"brain", "the owner\'s constitution and skills for Orbs"),\n'
     '    (HOME/".orbs"/"brain"/"memory", "what the orbs believe"),\n]',
     "the guard keeps every Ash path (so a kit suite that reaches ~/ash is caught: rule 7) and also "
     "watches the Orbs data directory"),
    # the controls that read Ash's git history read the carried blobs instead
    ("test_articles.py",
     '_pre = subprocess.run(["git", "-C", str(ROOT), "show", "caf23fd:orb/daemon/speakable.py"],\n'
     '                      capture_output=True, text=True, env=dict(os.environ, ASH_NO_SHOW="1"))',
     '_pre = __import__("carried_git").show("caf23fd:orb/daemon/speakable.py")',
     "AR.0's pre-fix speakable.py comes from fixtures/git (the kit has no Ash history)"),
    ("test_day_verbs_calendar.py",
     '_pre = subprocess.run(["git", "-C", str(ROOT), "show", "91cfcef:orb/daemon/day_verbs.py"],\n'
     '                      capture_output=True, text=True, env=dict(os.environ, ASH_NO_SHOW="1"))',
     '_pre = __import__("carried_git").show("91cfcef:orb/daemon/day_verbs.py")',
     "DV.0's pre-fix day_verbs.py comes from fixtures/git"),
    ("test_remind_me.py",
     '    r = subprocess.run(["git", "-C", str(ROOT), "show", f"edd72cc:orb/daemon/{name}.py"],\n'
     '                       capture_output=True, text=True, env=dict(os.environ, ASH_NO_SHOW="1"))',
     '    r = __import__("carried_git").show(f"edd72cc:orb/daemon/{name}.py")',
     "RM.0's pre-fix table and parser come from fixtures/git"),
    ("test_narration_glitches.py",
     'old_src = subprocess.run(["git", "-C", str(HERE.parents[1]), "show", "HEAD:orb/daemon/spoken_choice.py"],\n'
     '                         capture_output=True, text=True).stdout',
     'old_src = __import__("carried_git").show("7c9ddd1:orb/daemon/spoken_choice.py").stdout',
     "NG.0 read Ash's HEAD, the commit before its uncommitted fix; the kit pins that commit"),
    ("test_ad_voice.py",
     'old = subprocess.run(["git", "-C", str(ROOT), "show", "44388a8:orb/daemon/voice.py"], capture_output=True, text=True).stdout',
     'old = __import__("carried_git").show("44388a8:orb/daemon/voice.py").stdout',
     "AV.0's pre-fix voice.py comes from fixtures/git"),
    ("test_reasoning_not_spoken.py",
     '_pre = subprocess.run(["git", "-C", str(ROOT), "show", "f7a1726:orb/daemon/speakable.py"],\n'
     '                      capture_output=True, text=True, env=dict(os.environ, ASH_NO_SHOW="1"))',
     '_pre = __import__("carried_git").show("f7a1726:orb/daemon/speakable.py")',
     "RN.0's pre-fix speakable.py comes from fixtures/git"),
    ("test_reasoning_not_spoken.py",
     '_pre_ashd = subprocess.run(["git", "-C", str(ROOT), "show", "f7a1726:orb/daemon/ashd.py"],\n'
     '                           capture_output=True, text=True, env=dict(os.environ, ASH_NO_SHOW="1"))',
     '_pre_ashd = __import__("carried_git").show("f7a1726:orb/daemon/ashd.py")',
     "RN.4's pre-fix ask path (then in ashd.py) comes from fixtures/git"),
    ("test_mic_stall.py",
     'old = subprocess.run(["git", "-C", str(HERE.parents[1]), "show", "HEAD:orb/daemon/micaudio.py"],\n'
     '                     capture_output=True, text=True).stdout',
     'old = __import__("carried_git").show("b015e3f:orb/daemon/micaudio.py").stdout',
     "MS.0 read Ash's HEAD, the commit before its uncommitted stall fix; the kit pins that commit"),
    ("test_micaudio.py",
     'ASHD = HERE/"ashd.py"\nASHD_TREE = ast.parse(ASHD.read_text())\n', '',
     "the kit has no ashd.py; the groups that read it are cut below"),
    ("test_wake_state.py",
     'ashd_src = code_only(__import__("sourceof").daemon_source(HERE))\n', '',
     "the kit has no ashd.py; K.3, which read it, is cut below"),
    # the kit's paths, asserted as the kit's
    ("test_common.py",
     'check("C.4b CFG is ~/ash/voice", c.CFG == Path.home()/"ash/voice", f"{c.CFG}")',
     'check("C.4b CFG is ~/.orbs/kit", c.CFG == Path.home()/".orbs"/"kit", f"{c.CFG}")',
     "the kit's state root is ~/.orbs/kit (see statepaths.py)"),
    # secretscan guards the Orbs repo; its declared fixtures are the kit's carried suites
    ("secretscan.py",
     '    "orb/daemon/test_redact.py": 9,',
     '    "kit/ash/test_redact.py": 9,',
     "secretscan scans the Orbs repo, where the planted-key suites live in kit/ash"),
    ("secretscan.py",
     '    "orb/daemon/test_desk_redaction.py": 10,\n    "orb/daemon/test_secretscan.py": 11,',
     '    "kit/ash/test_secretscan.py": 11,',
     "test_desk_redaction.py is not carried (its desk module is Ash's), so it is not a declared fixture"),
    ("test_secretscan.py", '_FX = "orb/daemon/test_redact.py"', '_FX = "kit/ash/test_redact.py"',
     "the fixture's path in the Orbs repo"),
    ("test_secretscan.py", 'ss.fixture_verdict("orb/daemon/common.py", "x = 1", _real)',
     'ss.fixture_verdict("kit/ash/common.py", "x = 1", _real)', "a path in the Orbs repo"),
    ("test_secretscan.py",
     'ok(set(ss.FIXTURES) == {"orb/daemon/test_redact.py", "orb/daemon/test_desk_redaction.py",\n'
     '                        "orb/daemon/test_secretscan.py"},',
     'ok(set(ss.FIXTURES) == {"kit/ash/test_redact.py", "kit/ash/test_secretscan.py"},',
     "the exempt list is exactly the kit's two detection suites"),
    ("test_memindex.py",
     '    _spec = _ilu.spec_from_file_location("vd_mi6", HERE/"voice_distill.py")\n'
     '    _vd = _ilu.module_from_spec(_spec); _spec.loader.exec_module(_vd)\n'
     '    eq(M.brain_index(), _vd.INDEX,\n'
     '       "MI.6 brain_index() is the very file voice_distill.accept appends to — two derivations "\n'
     '       "that disagree would warn about an index nobody writes")\n',
     '',
     "MI.6's agreement with voice_distill.INDEX waits for voice_distill (PLAN 3.5); MI.6's own "
     "checks and MI.7 stay"),
    ("test_statepaths.py",
     'ok(S.brain().name == "brain" and S.brain().parent.name == "ash",',
     'ok(S.brain().name == "brain" and S.brain().parent.name == ".orbs",',
     "the kit's brain root is ~/.orbs/brain"),
    ("test_statepaths.py",
     'ok(len(_users) >= 20, f"SP.6b CONTROL: the probe covers the swept modules, not a handful: {len(_users)}")',
     'ok(len(_users) >= 5, f"SP.6b CONTROL: the probe covers the swept modules, not a handful: {len(_users)}")',
     "the kit carries a third of Ash's daemon, so fewer modules use statepaths than Ash's 20+"),
    ("secretscan.py",
     '        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent.parent/"tools"))\n',
     '',
     "release_gate.py is carried beside secretscan.py in the kit, not in a tools/ directory"),
    ("secretscan.py",
     "    return p.parent.parent\n",
     "    return p.parents[2]\n",
     "without a .git (an install, not a checkout) the root is three up from kit/ash/secretscan.py; "
     "Ash's fallback counted Ash's layout"),
    # Found by the carried write_guard WG.4 (red in Ash's own tree too: turnend.py is new there):
    # a module-level path bound as a default at def time, so redirecting MODEL does nothing.
    ("turnend.py",
     "    def __init__(self, model=MODEL, threshold=THRESHOLD, early_s=EARLY_S):\n"
     "        self.model, self.threshold, self.early_s = Path(model), float(threshold), float(early_s)",
     "    def __init__(self, model=None, threshold=THRESHOLD, early_s=EARLY_S):\n"
     "        self.model = Path(MODEL if model is None else model)  # at call time (WG.4)\n"
     "        self.threshold, self.early_s = float(threshold), float(early_s)",
     "the Smart Turn model path is resolved at call time, so redirecting turnend.MODEL works "
     "(WG.4's D104 class; the same suite is red on this line in Ash today)"),
    # A latent race, found by carrying test_runtime T.7 to Python 3.13 (Ash runs 3.11, where it
    # passes): one sqlite3 connection shared by threads with no lock. Same SQLite (3.50.4,
    # serialized) on both, so it is the 3.13 sqlite3 module sharing a statement between threads
    # ("bad parameter or other API misuse"). Python's docs put the serialising on the caller.
    ("runtime.py",
     'class Journal:\n',
     'class _Serialized:\n'
     '    """One lock around the connection: each statement runs, and its rows are fetched, while\n'
     '    holding it (Orbs: Python 3.13 shares statements between threads; see kit/ash/CARRIED.md)."""\n'
     '\n'
     '    def __init__(self, conn):\n'
     '        self._conn = conn\n'
     '        self._lock = threading.RLock()\n'
     '\n'
     '    def execute(self, sql, params=()):\n'
     '        with self._lock:\n'
     '            cur = self._conn.execute(sql, params)\n'
     '            return _Rows(cur.fetchall(), cur.lastrowid, cur.rowcount)\n'
     '\n'
     '    def close(self):\n'
     '        with self._lock:\n'
     '            self._conn.close()\n'
     '\n'
     '\n'
     'class _Rows(list):\n'
     '    def __init__(self, rows, lastrowid, rowcount):\n'
     '        super().__init__(rows)\n'
     '        self.lastrowid, self.rowcount = lastrowid, rowcount\n'
     '\n'
     '    def fetchone(self):\n'
     '        return self[0] if self else None\n'
     '\n'
     '    def fetchall(self):\n'
     '        return list(self)\n'
     '\n'
     '\n'
     'class Journal:\n',
     "the Journal's connection is shared by threads; on Python 3.13 that raised 'bad parameter or "
     "other API misuse' and lost messages (T.7). Every statement now runs under one lock"),
    ("runtime.py",
     '        self.db = sqlite3.connect(str(path), isolation_level=None, check_same_thread=False)',
     '        self.db = _Serialized(sqlite3.connect(str(path), isolation_level=None, check_same_thread=False))',
     "(the same fix: the connection goes through the lock)"),
    ("runtime.py", "import sqlite3\nimport time\n", "import sqlite3\nimport threading\nimport time\n",
     "(the same fix)"),
    # Ash's owner lives in US/Eastern, and whenparse said so in code. An Orbs user anywhere else
    # would get every "tomorrow at 3" an hour or more off. The home passes its own IANA zone.
    ("whenparse.py",
     'ZONE = ZoneInfo("US/Eastern")',
     'ZONE = ZoneInfo(__import__("os").environ.get("ORBS_TZ") or "US/Eastern")',
     "the zone is the machine's (the home passes ORBS_TZ); US/Eastern stays only as the default the "
     "carried suites are written against"),
    # WG.2: the guard must be wired into the runner that actually runs these suites
    ("test_write_guard.py",
     'runner = (HERE/"run-tests.sh").read_text()\n'
     'code = "\\n".join(l for l in runner.splitlines() if not l.lstrip().startswith("#"))\n'
     'ok("write_guard.py" in code,\n'
     '   "WG.2 run-tests.sh does not invoke write_guard — it exists and guards nothing")\n'
     'ok(\'"$PY" "$t"\' not in code.replace(\'"$PY" "$HERE/write_guard.py" -- "$PY" "$t"\', ""),\n'
     '   "WG.2 a suite is still invoked directly somewhere, bypassing the guard")',
     'runner = (HERE.parent/"tests"/"run.py").read_text()\n'
     'code = "\\n".join(l for l in runner.splitlines() if not l.lstrip().startswith("#"))\n'
     'ok(\'str(ASH / "write_guard.py"), "--", sys.executable, t.name]\' in code,\n'
     '   "WG.2 kit/tests/run.py does not invoke write_guard — it exists and guards nothing")\n'
     'ok(code.count("t.name]") == 1,\n'
     '   "WG.2 a carried suite is still invoked directly somewhere, bypassing the guard")',
     "the kit's runner is kit/tests/run.py; it must wrap every carried suite in the guard"),
    # the day (PLAN 4.5): its weather table, its calendar, and the controls that read Ash's history
    ("day.py",
     '_WMO_JS = Path(__file__).resolve().parents[1]/"shell"/"panels"/"weather.2.js"',
     '_WMO_JS = Path(__file__).resolve().parent/"weather.2.js"',
     "the panel's WMO table is carried beside the day (weather.2.js), so the word said and the "
     "table stay one file"),
    ("test_day.py", "eds_sandbox.guard(__name__)\n",
     "eds_sandbox.guard(__name__)\n"
     "# Orbs: the kit's calendar is what the home hands in; the suite starts from an empty one\n"
     "eds.handed([], [])\n",
     "Ash's suite starts from the real calendar; the kit's is the home's hand-off (eds.py)"),
    ("test_day.py",
     '_real = eds.SYSTEM_PYTHON\neds.SYSTEM_PYTHON = "/nonexistent/python"',
     '_real = eds.FEED\neds.FEED = None  # Orbs: nothing handed in is the kit\'s unreachable calendar',
     "DY.4 breaks the calendar the kit's way: the home handed nothing in (Ash's broke the system "
     "Python his EDS child runs on)"),
    ("test_day.py", "    eds.SYSTEM_PYTHON = _real\n", "    eds.FEED = _real\n", "DY.4's restore, the same way"),
    ("test_day.py",
     '_a2 = sourceof.turn_source(HERE)  # the turn as it runs: _handle with verbs.dispatch\'s body in place (18.1)\n'
     'ok("note_promise" in _a2, "DY.6 and ashd listens for them")\n',
     '',
     "DY.6's last check reads ashd's turn; the home's runs listen for promises in 4.5"),
    ("test_day.py",
     '    _src30 = _sp30.run(["git", "-C", str(HERE.parents[1]), "show", "HEAD:orb/daemon/day.py"],\n'
     '                       capture_output=True, text=True).stdout',
     '    _src30 = __import__("carried_git").show("9fe64ce:orb/daemon/day.py").stdout',
     "DY.30 read Ash's HEAD, the commit before his uncommitted edit; the kit pins that commit"),
    ("test_day.py", "_saved_events = day.events_in_window\n_saved_eds_events = eds.events\n",
     "far = int(NOW) + 45 * 86400  # Orbs: DY.2, which defined it, is cut\n"
     "_saved_events = day.events_in_window\n_saved_eds_events = eds.events\n",
     "MV.5 uses DY.2's `far`, and DY.2 is cut below"),
    ("test_dayplan.py",
     '_old_src = _sp.run(["git", "-C", str(HERE.parents[1]), "show", "HEAD:orb/daemon/dayplan.py"],\n'
     '                   capture_output=True, text=True).stdout',
     '_old_src = __import__("carried_git").show("2d6023c:orb/daemon/dayplan.py").stdout',
     "DP.6/7 read Ash's HEAD, the commit before his uncommitted edit; the kit pins that commit"),
]

# (file, first line cut, first line kept after the cut, why it is Ash's wiring rather than
# the module, the Orbs row that owns the same guarantee). Lines are matched by their start.
CUTS: list[tuple[str, str, str, str, str]] = [
    ("test_belief_use.py", 'print("── BU.5', 'print("── BU.0',
     "BU.5-6 test Ash's belief-use.sh CLI hook and its installer", "1.5 (the agent loop's tool hooks)"),
    ("test_chatstore.py", 'asrc = (HERE/"ashd.py").read_text()', 'print("── CS.7',
     "CS.6's last check: ashd.main enables the store", "2.4 (the chat app enables it)"),
    ("test_common.py", "# ---- C.3", "# ---- C.4",
     "C.3: Ash's terminal.py must not import ashd (Ash's own process split)", "— (Orbs has no ashd)"),
    ("test_learn_gate.py", "# ── LG.3", "if FAIL:",
     "LG.3 runs the gate inside voice_distill.propose(), which is not carried yet",
     "3.5 (carries voice_distill and restores LG.3)"),
    ("test_log_fields.py", "# ── LF.3", "# ── LF.4",
     "LF.3: ashd binds the fields where its turn begins", "1.5 (the home's runs carry their ids)"),
    ("test_log_fields.py", '_lesson = (HERE/"lesson.py").read_text()', "if FAIL:",
     "LF.4's control reads lesson.py, which is not carried yet", "4.4 (carries lesson.py)"),
    ("test_redact.py", "# ── E.4", "# ── E.5",
     "E.4: redact is wired into ashd's heard/typed log lines", "1.6 (redaction at the MCP boundary)"),
    ("test_statepaths.py", "# ── SP.5", "# ── SP.6",
     "SP.5 tests Ash's tools/inventory.py", "— (Ash's tooling)"),
    ("test_oneway.py", "# ── OW.4", "if FAIL:",
     "OW.4-OW.5r: the switch is gated at Ash's terminal chokepoint and opened, tainted and reopened "
     "by ashd and turncontext", "1.6 (the same checks against the home's chokepoint, through MCP)"),
    ("test_memindex.py", "# ── MI.5", "# ── MI.6",
     "MI.5 checks one of Ash's proposal documents", "— (Ash's docs)"),
    ("test_micaudio.py", "# ── MA.8", "# ── MA.6",
     "MA.8: the names micaudio took from ashd still resolve through ashd", "4.3 (the voice turn)"),
    ("test_micaudio.py", "# ── MA.0", "try:",
     "MA.0: ashd calls mic_frames with `stop`", "4.3 (the voice turn passes stop)"),
    ("test_mic_stall.py", 'tree = ast.parse((HERE/"ashd.py").read_text())', "old = ",
     "MS.4: ashd asks mic_frames for keep_alive", "4.3"),
    ("test_stt.py", "# ── ST.3", "if FAIL:", "ST.3: the daemon calls the loader where it always did", "4.3"),
    ("test_voice_policy.py", "# ----------------------------------------- VP.7",
     "# a real parse, not a substring",
     "VP.7: ashd builds its Voice through the policy", "4.3 (the voice turn builds it the same way)"),
    ("test_wake_state.py", "# ── K.3", "# ── K.4", "K.3: ashd's write_state is the owner, and atomic",
     "— (ashd's own state file)"),
    ("test_wake_state.py", "# ── K.5", "# ── K.6", "K.5: Ash's orb page reads the schema wake.py writes",
     "2.3 (the living orb reads the home's state)"),
    ("test_voice_policy.py", "# ------------------------------------ VP.3",
     "# ------------------------------------------- VP.5/VP.6",
     "VP.3-4 check the owner's live ~/ash/voice/voice.json against the policy",
     "4.3 (each orb's voice config, through the same policy)"),
    ("test_write_guard.py", "# ── WG.8", "# ── WG.10",
     "WG.8-9 corroborate a change against the run windows of Ash's systemd timers "
     "(ash-seat-health and the rest); WG.9f's control needs those units on the machine",
     "— (Orbs has no systemd units: its loops run inside the home, 1.2)"),
    ("test_write_guard.py", "# (f) the writers really stamp", "if FAIL:",
     "WG.12f: Ash's live writers (ashd, wake, browser, tutor, seatbroker) stamp what they write",
     "— (the writers are Ash's daemon)"),
    # the day (PLAN 4.5)
    ("test_day.py", "# ── DY.2", "far = int(NOW) + 45 * 86400  # Orbs",
     "DY.2-3 and MV.0-4 book, move and remove a fixture event in the real calendar; Orbs reads "
     "your calendars by their ICS address and never writes them (the kit's eds refuses)",
     "4.2 (writing a calendar, when CalDAV comes)"),
    ("test_day.py", "# ── DY.5", "# ── DY.6  a promise",
     "DY.5: ashd calls the day behind its calendar leg", "4.5 (the home calls the kit's day tools)"),
    ("test_day.py", "# ── DY.6d", "# ── DB  travel",
     "DY.6d: where the promise offer sits in Ashd._handle", "4.5 (the home's runs)"),
    ("test_day.py", "# DB.7", "# ── DB.8",
     "DB.7 reads eds_child.py, the child process Ash reads EDS through", "— (Orbs has no EDS)"),
    ("test_day.py", "# ── CS.4", "# --- DY.9",
     "CS.4: the seam between the day and Ash's microphone loop", "4.3 (the voice turn)"),
    ("test_day.py", "# --- DY.9", "# ── DY.10",
     "DY.9: ashd calls the brief and asks proactive's gate first", "4.5 (the home's brief asks the gate)"),
    ("test_reminders.py", '_a = __import__("sourceof").daemon_source(HERE)', "eds.todos = _real_todos",
     "RM.5's second half: Ash's daemon loop fires reminders, at most once a minute",
     "2.11 (the home's notices bring a reminder up once)"),
    ("test_proactive.py", "# ── PR.5", "if FAIL:",
     "PR.5 reads ashd asking the gate; PR.6 reads Ash's baseline module (not carried)",
     "4.5 (the home's brief asks the gate)"),
]

# Ash's live paths, which must never be a carried module's default (rule 7). Docstrings and
# comments may mention them; a string in the code may not. The one exception is the guard that
# exists to watch them.
NAMES_ASH_TO_GUARD_IT = {"write_guard.py"}
ASH_PATH = re.compile(r"^(~/)?ash/(voice|brain)\b")


def ash_paths_in_code(text: str) -> list[str]:
    tree = ast.parse(text)
    docs = {id(n.value) for n in ast.walk(tree) if isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)}
    return [n.value for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docs
            and ASH_PATH.match(n.value)]


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:12]


def cut_block(text: str, first: str, keep: str) -> str:
    lines = text.splitlines(keepends=True)
    start = next((i for i, l in enumerate(lines) if l.startswith(first)), None)
    if start is None:
        raise SystemExit(f"cut: no line starting {first!r}")
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith(keep)), None)
    if end is None:
        raise SystemExit(f"cut: no line starting {keep!r} after {first!r}")
    return "".join(lines[:start] + [f"# (cut in the Orbs kit: see kit/ash/CARRIED.md)\n\n"] + lines[end:])


def git_show(rev: str, path: str) -> str:
    r = subprocess.run(["git", "-C", str(ASH_REPO), "show", f"{rev}:{path}"], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"git show {rev}:{path} failed in {ASH_REPO}: {r.stderr.strip()}")
    return r.stdout


def source_rel(name: str) -> str:
    return OTHER_SOURCES.get(name, f"orb/daemon/{name}")


def provenance(name: str) -> str:
    """Where Ash's copy stands: the last commit that touched it, and whether it is edited since."""
    rel = source_rel(name)
    last = subprocess.run(["git", "-C", str(ASH_REPO), "log", "-1", "--format=%h", "--", rel],
                          capture_output=True, text=True).stdout.strip()
    dirty = subprocess.run(["git", "-C", str(ASH_REPO), "status", "--porcelain", "--", rel],
                           capture_output=True, text=True).stdout.strip()
    if not last:
        return "uncommitted in Ash"
    return f"{last}{' + uncommitted edits' if dirty else ''}"


def carry() -> dict[str, str]:
    """Every carried file's kit text, built from Ash's file plus the patches and cuts."""
    out: dict[str, str] = {}
    for name in [f"{m}.py" for m in MODULES] + [f"{t}.py" for t in SUITES]:
        out[name] = (ASH / name).read_text()
    for name, rel in OTHER_SOURCES.items():
        out[name] = (ASH_REPO / rel).read_text()
    for name, old, new, _ in PATCHES:
        if old not in out[name]:
            raise SystemExit(f"patch: anchor not found in {name}: {old[:60]!r}")
        out[name] = out[name].replace(old, new, 1)
    for name, first, keep, _, _ in CUTS:
        out[name] = cut_block(out[name], first, keep)
    for rev, path in GIT_FIXTURES:
        out[f"fixtures/git/{rev}/{path}"] = git_show(rev, path)
    for name in [f"{m}.py" for m in MODULES]:
        hits = ash_paths_in_code(out[name])
        if hits and name not in NAMES_ASH_TO_GUARD_IT:
            raise SystemExit(f"{name} still points at Ash's live state ({hits}); add a patch")
    return out


def manifest(files: dict[str, str]) -> str:
    rows = []
    for name in sorted(n for n in files if "/" not in n):
        src = (ASH_REPO / source_rel(name)).read_text()
        changed = [why for f, _, _, why in PATCHES if f == name] + \
                  [f"**cut** {why} (Orbs: {row})" for f, _, _, why, row in CUTS if f == name]
        rows.append(f"| `{name}` | {provenance(name)} | `{sha(src)}` | `{sha(files[name])}` | "
                    f"{'; '.join(changed) or 'unchanged'} |")
    dropped = "\n".join(f"- `{t}.py`: {why}" for t, why in DROPPED.items())
    fixtures = "\n".join(f"- `fixtures/git/{rev}/{path}` (`git show {rev}:{path}` in Ash)" for rev, path in GIT_FIXTURES)
    binaries = "\n".join(f"- `{rel}` (`{hashlib.sha256((ASH / rel).read_bytes()).hexdigest()[:12]}`)" for rel in BINARIES)
    mods = len(MODULES)
    return f"""# Carried from Ash (generated)

Generated by `tools/adoption/carry.py` from `~/ash/app/orb/daemon` (read-only). Do not edit
anything in `kit/ash/` by hand: a change is a patch or a cut in `carry.py`, so this list of
differences cannot go stale. `--check` fails when a file here differs from what the script
carries.

{mods} modules and {len(SUITES)} suites. Paths are the kit's own: state under `ORBS_KIT_STATE`
(`<data>/kit`), the brain under `ORBS_BRAIN` (`<data>/brain`), never `~/ash`.

| File | Ash version | Ash sha256 | Kit sha256 | Differences |
|---|---|---|---|---|
""" + "\n".join(rows) + f"""

## Suites not carried

{dropped}

## Old versions carried for the controls

{fixtures}

## Binary files carried as they are

{binaries}

Model files are not carried: `python -m orbs_kit.models` fetches them from their upstream
releases and keeps each only if its sha256 is the pinned one.
"""


def full_sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def check_kit() -> int:
    """Self-contained (no ~/ash needed, so it runs in CI and on a fresh clone): every carried
    file matches the hash recorded when it was carried, and nothing uncarried sits beside them."""
    import json
    rec = json.loads((KIT / "CARRIED.json").read_text())
    def digest(n: str) -> str:
        return hashlib.sha256((KIT / n).read_bytes()).hexdigest() if n in BINARIES else full_sha((KIT / n).read_text())

    bad = [n for n, h in rec.items() if not (KIT / n).is_file() or digest(n) != h]
    extra = sorted(p.name for p in KIT.glob("*.py") if p.name not in rec and p.name not in OURS)
    for n in bad:
        print(f"FAIL  kit/ash/{n} was edited by hand or is missing; change it with a patch in carry.py")
    for n in extra:
        print(f"FAIL  kit/ash/{n} is not carried by carry.py and not declared as Orbs' own")
    if not bad and not extra:
        print(f"carry: kit/ash matches what carry.py carried ({len(rec)} files)")
    return 1 if bad or extra else 0


def main(argv: list[str]) -> int:
    import json
    if "--check" in argv:
        return check_kit()
    files = carry()
    want = dict(files, **{"CARRIED.md": manifest(files)})
    if "--drift" in argv:
        drift = [n for n, t in files.items() if not (KIT / n).exists() or (KIT / n).read_text() != t]
        for n in drift:
            print(f"DRIFT  {n}: Ash's copy has changed since it was carried (re-run carry.py to take it)")
        return 1 if drift else 0
    KIT.mkdir(parents=True, exist_ok=True)
    for n, t in want.items():
        (KIT / n).parent.mkdir(parents=True, exist_ok=True)
        (KIT / n).write_text(t)
    for p in KIT.glob("*.py"):
        if p.name not in want and p.name not in OURS:
            p.unlink()
    record = {n: full_sha(t) for n, t in files.items()}
    for rel in BINARIES:
        data = (ASH / rel).read_bytes()
        (KIT / rel).parent.mkdir(parents=True, exist_ok=True)
        (KIT / rel).write_bytes(data)
        record[rel] = hashlib.sha256(data).hexdigest()
    (KIT / "CARRIED.json").write_text(json.dumps(dict(sorted(record.items())), indent=1) + "\n")
    print(f"carried {len(MODULES) + len(OTHER_SOURCES)} modules and {len(SUITES)} suites into kit/ash")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
