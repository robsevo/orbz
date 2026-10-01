#!/usr/bin/env python3
"""What he says out loud, asserted. Run: orb/daemon/.venv/bin/python orb/daemon/test_speakable.py

Covers the rules that already existed (paths, filenames, framework names) so a
future fix to the narration voice cannot quietly undo them, plus the narration
composer added 2026-09-15 after a live build made him sound like a robot.
"""
import sys
import speakable as s

FAIL = []


def eq(got, want, label):
    if got != want:
        FAIL.append(f"{label}\n     got: {got!r}\n    want: {want!r}")


def has(got, want, label):
    if want not in got:
        FAIL.append(f"{label}\n     got: {got!r}\n   wants: {want!r} in it")


def hasnt(got, unwanted, label):
    if unwanted in got:
        FAIL.append(f"{label}\n     got: {got!r}\n  forbids: {unwanted!r}")


# ---- the rules that were already there ------------------------------------
has(s.speakable("I edited `src/components/VideoPlayer.tsx` today."),
    "the video player component", "path -> component")
has(s.speakable("Check package.json for the version."), "the package file", "config name")
has(s.speakable("Updated vite.config.js."), "vite config", "vite config name")
has(s.speakable("It is a Next.js app."), "Next.js", "framework name survives")
hasnt(s.speakable("It is a Next.js app."), "next file", "framework not read as a file")

# ---- the false positives that made him sound broken -----------------------
hasnt(s.speakable("Re-install dependencies and fix the build."), "folder",
      "re-install is a verb, not a folder")
hasnt(s.speakable("Remove the callback from the event-listener effect."), "folder",
      "compound modifier is not a folder")
hasnt(s.speakable("There is a follow-up to check."), "folder", "follow-up is not a folder")
has(s.speakable("I put it in landing-page."), "the landing page folder", "real folder still reads")
has(s.speakable("Open the landing-page directory."), "the landing page directory", "folder w/ cue")

# ---- symbols a listener cannot hear ---------------------------------------
eq(s.speakable("Run npm ci && npm run build").count(" and "), 1, "&& is one 'and'")
has(s.speakable("Install @vitejs/plugin-react now."), "the vitejs plugin react package",
    "scoped package is spoken")
has(s.speakable("Serving on localhost:5173."), "localhost port 5 1 7 3", "port as digits")
hasnt(s.speakable("Serving on localhost:5173."), "thousand", "port is not a quantity")
has(s.speakable("Set up Vite + Tailwind."), "Vite and Tailwind", "plus is 'and'")

# ---- internal machinery never reaches the ear -----------------------------
eq(s.for_the_ear("Re-ran `npm run build` as a dedicated single command to match the "
                 "claims checker lookup."), "", "a reply that is only machinery is dropped")
has(s.for_the_ear("The landing page is done and the build passes."), "landing page",
    "a real reply survives")

# ---- narration: a to-do line becomes something a person would say ---------
# Every one of these used to expect a subjectless gerund — "Installing the Tailwind
# plugin." Spoken aloud that is a caption, not a sentence, and it is what the user heard
# and called horrible English on 2026-09-18. A spoken line names who is doing the thing.
line, _ = s.narration("Install Tailwind Vite plugin.", "", 0, "")
eq(line, "I'm installing the Tailwind Vite plugin.", "imperative -> spoken clause, first person")
line, _ = s.narration("Create project directory and initialize Vite + Tailwind.", "", 0, "")
eq(line, "I'm creating the project directory and initializing Vite and Tailwind.", "conjoined verbs")
line, _ = s.narration("Start the Vite development server in background.", "", 0, "")
eq(line, "I'm starting the Vite development server in the background.", "'in background' gets its article")

# ---- the workshop stays out of the spoken line (user, 2026-09-18) ---------
line, _ = s.narration("Scaffold Moonrunner web project using ashnew.", "", 0, "")
eq(line, "I'm creating the Moonrunner web project.", "no in-house command, no template")
line, _ = s.narration("Run ashpagecheck to verify the rendered dev page.", "", 0, "")
eq(line, "I'm running the page check to verify the rendered dev page.", "tool name -> plain words")
line, _ = s.narration("List files in moonrunner project.", "", 0, "")
eq(line, "I'm listing files in the moonrunner project.", "a bare noun after a preposition takes its article")
line, _ = s.narration("Get actual sha256 of App.tsx.", "", 0, "")
eq(line, "", "a pure receipt is not spoken at all")
eq(s.for_the_ear("I built it from the verified web template."), "I built it.",
   "a spoken reply does not mention the template either")

# ---- commands, ports and links (all heard on 2026-09-18) ------------------
line, _ = s.narration("Check the Moonrunner dev server is responding on port 3456.", "", 0, "")
eq(line, "I'm checking the Moonrunner dev server is responding on port three four five six.",
   "a port is read digit by digit, not as a quantity")
line, _ = s.narration("Run npm run build to verify Tailwind v4 CSS generation.", "", 0, "")
eq(line, "I'm running the production build to verify Tailwind generation.",
   "a command becomes what it is for, and the version number goes")
line, _ = s.narration("Start the dev server with npm run dev.", "", 0, "")
eq(line, "I'm starting the dev server.", "how it was run is not news")
eq(s.for_the_ear("The Moonrunner landing page is fully complete and serving correctly at "
                 "http://localhost:5173"),
   "The Moonrunner landing page is fully complete and serving correctly",
   "a sentence does not end on a link that points at nothing")
eq(s.for_the_ear("The page is at http://localhost:5173"), "The page is at the link",
   "unless the link is the whole point of the sentence")
line, op = s.narration("Re-install dependencies and fix the build.", "prev line", 2, "Now ")
has(line, "reinstalling dependencies", "recovery line is spoken as recovery")
if op == "Now ":
    FAIL.append("recovery opener repeated the previous opener")

# no two consecutive lines open the same way
prev_op, opens = "", []
for i, d in enumerate(["Write the navbar component.", "Write the hero section.",
                       "Add the feature cards.", "Update the footer.", "Run the build."]):
    ln, prev_op = s.narration(d, "", i, prev_op)
    opens.append(prev_op)
# A repeated FILLER is the tic. Two plain sentences in a row share the empty opener and that
# is not a repeat — it is how people talk, and it is the normal case now that openers are rare.
for a, b in zip(opens, opens[1:]):
    if a and a == b:
        FAIL.append(f"two consecutive lines opened the same way: {a!r}")

# a description that is pure machinery says nothing at all
line, _ = s.narration("Run the build to match the claims checker lookup.", "", 3, "")
if line and "claims" in line:
    FAIL.append(f"claims-gate jargon reached the voice: {line!r}")

# ---- program names are pronounced, not read (2026-09-15) --------------------
eq(s.speakable("opening vscode"), "opening V S Code", "vscode is 'V S Code', not 'vistcode'")
has(s.speakable("editing App.tsx in VS Code"), "V S Code", "VS Code spelled out")
# "vite" now stays as itself in the text and is pronounced from lexicon.py. Asserting the
# respelling was asserting the bug: "Veet" is not a word, so the phonemiser returned ❓ and
# the voice guessed. The requirement is unchanged and is checked on the PHONEMES below.
has(s.speakable("starting the vite dev server"), "vite", "vite is left for the lexicon")
eq(s.speakable("an invitation to the site"), "an invitation to the site", "no 'vite' inside 'invitation'")
has(s.speakable("running npm run dev"), "N P M", "npm is lettered")
hasnt(s.as_spoken_clause(s.speakable("Run npm run dev")), "the N P M", "no article before a command")
eq(s.as_spoken_clause(s.speakable("Install Tailwind plugin")), "installing the Tailwind plugin",
   "a real object still gets its article")

# ---- a finished task says so -----------------------------------------------
# REVISED 2026-09-16. This used to require the literal word "complete" in EVERY
# shape, which is why all fourteen ended in "task completed" and a build of eight
# items said those two words eight times ("he sounds robotic", user). A completion
# has to READ as a completion; it does not have to read out a status field. The
# stamp is now capped rather than required, so it cannot creep back in.
_DONE_WORDS = ("done", "finished", "wrapped up", "complete", "that's in", "those are in",
               "sorted", "one down")
_STAMPED = [x for x in s._COMPLETION_SHAPES if "task completed" in x.lower()]
if len(_STAMPED) > 3:
    FAIL.append(f"{len(_STAMPED)}/{len(s._COMPLETION_SHAPES)} shapes say 'task completed' — "
                f"at most 3 should; the rest must say it in their own words")
for i in range(len(s._COMPLETION_SHAPES)):
    line = s.completion_line(["Build the hero section"], i)
    if not any(w in line.lower() for w in _DONE_WORDS):
        FAIL.append(f"completion shape {i} does not read as a completion: {line!r}")
    has(line, "building the hero section", f"completion shape {i} names the task")
    # humbly excited: one lift, a settled close, no hype
    if line.count("!") != 1:
        FAIL.append(f"completion shape {i} should have exactly one '!': {line!r}")
    if line.endswith("!"):
        FAIL.append(f"completion shape {i} should settle, not end on the lift: {line!r}")
    for hype in ("amazing", "awesome", "perfect", "incredible", "fantastic", "crushed", "nailed"):
        hasnt(line.lower(), hype, f"completion shape {i} is not hyped")
# Plurality has to be audible, but "tasks completed" is not the only way to say it.
_PLURAL_WORDS = ("those", "tasks", "all", "them")
for i in range(len(s._COMPLETION_SHAPES_MANY)):
    line = s.completion_line(["Build the hero", "Add the form"], i)
    if not any(w in line.lower() for w in _PLURAL_WORDS):
        FAIL.append(f"plural shape {i} does not sound plural: {line!r}")
    if not any(w in line.lower() for w in _DONE_WORDS):
        FAIL.append(f"plural shape {i} does not read as a completion: {line!r}")
    if line.count("!") != 1 or line.endswith("!"):
        FAIL.append(f"plural shape {i} should lift once and settle: {line!r}")
eq(s.completion_line([]), "Task completed!", "nothing to name still announces")

# ---- technical words said correctly ----------------------------------------
# "he says apee. these are technical words man that are super important" (user,
# 2026-09-17). Three separate faults were behind that, and all three are asserted here
# against the PHONEMES, not the spelling - the spelling looked fine in every case.
#
#   API   -> misaki read a lone capital A as the ARTICLE (schwa), so the acronym blurred
#            into one word. Measured: `ˌApˌiˈI`. A is the ONLY letter that does this.
#   AWS   -> not in the map at all, so it was said as the word "awz" (`ˈɔz`).
#   nginx -> never in the map either: a trailing comment on the `vite` line had swallowed
#            it, and an unknown word phonemises to `❓`, which the voice then guesses at.
try:
    import warnings; warnings.filterwarnings("ignore")
    from misaki import en as _en
    _g = _en.G2P(trf=False, british=False)
    import lexicon as _lex
    _lex.install(_g)          # the voice installs these too; test what he actually says

    def ph(text):
        return str(_g(s.speakable(text))[0])

    # The letter A must say its own name (misaki writes /eɪ/ as A) rather than the
    # schwa of the article. Checked on the ACRONYM alone: "an API gateway" contains a
    # real article whose schwa is correct, so scanning the whole line would be wrong.
    for line in ("the API is down", "call the API", "AWS S3 API", "an API gateway"):
        acro = ph(line)
        if "ɐ pˈi" in acro or "ɐ dˈʌbᵊlju" in acro:
            FAIL.append(f"a spelled A is still a schwa in {line!r}: {acro}")
    has(ph("the API is down"), "ˈA pˈi", "API says ay-pee, not apee")
    has(ph("AWS is down"), "dˈʌbᵊlju", "AWS is spelled out, not said as a word")
    hasnt(ph("AWS is down"), "ˈɔz", "AWS is never the word 'awz'")
    # nothing technical may phonemise to the unknown marker
    for word in ("nginx", "psql", "vite", "vitest", "npm", "postgres", "redis",
                 "kubectl", "the YAML config", "an async regex"):
        if "❓" in ph(word):
            FAIL.append(f"{word!r} has no pronunciation: {ph(word)}")
    has(ph("restart nginx"), "ˈɛnʤən", "nginx is engine-ex")
    _broken = [w for w in _lex.TECH if "❓" in str(_g(w)[0])]
    if _broken:
        FAIL.append(f"lexicon entries that do not phonemise: {_broken}")
except ImportError:
    print("  (misaki not importable — phoneme checks skipped)")

# ---- the check-in folds in what went by, without reading a list -------------
base = "Okay, writing the booking form."
for i in range(3):
    line = s.with_recap(base, ["creating the navbar", "installing Tailwind CSS"], i)
    has(line, "creating the navbar", f"recap shape {i} mentions earlier work")
    hasnt(line.lower(), "so far", f"recap shape {i} does not sound like a report")
    hasnt(line.lower(), "completed", f"recap shape {i} does not restate completions")
eq(s.with_recap(base, []), base, "nothing went by: the line is unchanged")


# ---- two things must not share one name ------------------------------------
# _DANGLING was a set of words at the top of the module and a compiled regex 50
# lines further down; the regex won, and the membership test in _short raised
# TypeError inside pair.py's narrator — which killed the link, the terminal
# session and its dev server mid-build (2026-09-17).
import re as _re
if not isinstance(s._DANGLING_WORDS, (set, frozenset, tuple, list)):
    FAIL.append("_DANGLING_WORDS must stay a container of words")
if not isinstance(s._DANGLING, _re.Pattern):
    FAIL.append("_DANGLING must stay a compiled regex")
eq(s._short("installing all project dependencies and checking the"),
   "installing all project dependencies", "a recap item drops its dangling tail")


# ---- no opener may sound like a tool name ----------------------------------
# "Right, I'm checking the dependencies" was heard as the tool Write and the user asked why
# he keeps saying "write" before a sentence (2026-09-17). Openers are spoken, so they are
# judged by ear, not by spelling.
_SOUNDALIKES = {"right", "write", "read", "reed", "edit", "bash", "task", "grep", "glob"}
for _op in s._OPENERS:
    _w = _op.strip().strip(",").lower()
    if _w in _SOUNDALIKES:
        FAIL.append(f"opener {_op!r} sounds like a tool name")


# ---- a hyphenated SERVICE is not a directory -------------------------------
# "fetched from open-meteo" was spoken as "fetched from the open meteo folder" on camera
# (2026-09-17): the preposition is the folder cue and an API name looks like a project dir.
eq(s.speakable("fetched from open-meteo"), "fetched from open-meteo", "a service keeps its name")
eq(s.speakable("from gpt-oss"), "from gpt-oss", "gpt-oss is not a folder")
has(s.speakable("i put it in landing-page"), "landing page folder", "a real folder still reads as one")


def test_code_never_spoken():
    """2026-09-17, on camera: a real sentence ran into a serialised tool call and the whole
    thing was read out, JSX and all. The old guard only looked at the first characters."""
    from speakable import cut_code, speakable

    leak = ("I'm now applying the first pass of the landing page: the dark shell, "
            "navigation bar, and hero heading. tools defaultapi:Write filepath the app "
            "component content export default function App() { return ( div "
            'className="min-h-screen bg-zinc-950"')
    out = cut_code(leak)
    assert "hero heading" in out, out
    assert "defaultapi" not in out and "className" not in out and "{" not in out, out

    # prose is untouched
    assert cut_code("The dev server is up on port 5173.") == "The dev server is up on port 5173."
    # nothing but code says nothing at all, rather than reading it
    assert cut_code("export default function App() { return null }") == ""
    assert cut_code("Write(/home/user/app.tsx)") == ""
    # and it is wired into the path every spoken line goes through
    assert "className" not in speakable(leak)
    print("  code never reaches the voice")



def test_every_recap_shape_is_english():
    """Recap items are gerund phrases, so every shape has to read correctly with one.
    2026-09-17: "..., with inspecting the icons library ... already sorted." went out three
    times in a single build, because the broken shape was one of three on a rotation."""
    from speakable import with_recap, _RECAP_SHAPES

    line = "I'm verifying the live dev server status"
    since = ["I'm inspecting the local brand icons library",
             "I'm verifying that the development server responds"]
    for n in range(len(_RECAP_SHAPES) * 2):
        out = with_recap(line, since, n)
        assert "already sorted" not in out, out
        # "with" directly in front of a gerund is the shape that failed
        assert " with inspecting" not in out and " with verifying" not in out, out
        assert out.rstrip().endswith("."), out
    print("  every recap shape reads as English")



def test_spoken_lines_are_short_enough_to_listen_to():
    """One short sentence per pass is what the brief asks for. On 2026-09-17 a single build
    pass went out as three sentences and 55 words. Trimming is by whole sentences: a line
    cut mid-clause leaves the listener waiting for an ending that never comes."""
    from speakable import clamp_spoken

    long_pass = ("I'm currently setting up the component skeleton and importing icons for "
                 "the navigation bar, logo, and links. I'm focusing on responsiveness and a "
                 "modern dark aesthetic using Tailwind CSS with a subtle backdrop blur "
                 "effect. I've built the hero section with a cinematic dark background "
                 "gradient and the main heading.")
    out, trimmed = clamp_spoken(long_pass)
    assert trimmed and len(out.split()) <= 40, (trimmed, len(out.split()))
    assert out.rstrip().endswith("."), out            # never mid-clause

    # Things that must survive untouched.
    for keep in ("The hero is up.",
                 "The page is built and running at the link. All five photos load.",
                 "I fetched the daily highs for the past week and put the chart on screen."):
        out, trimmed = clamp_spoken(keep)
        assert not trimmed and out == keep, (keep, out)

    # A single long sentence is never chopped in half.
    one = ("I fetched the daily highs for the past week from the weather service and "
           "rendered them as a dark line chart with the values annotated above each point "
           "and the whole thing is now on your screen.")
    out, _ = clamp_spoken(one)
    assert out == one, out
    assert clamp_spoken("")[0] == ""
    print("  spoken lines are trimmed by sentence, never mid-clause")



def test_have_contracts_only_as_an_auxiliary():
    """"we've a timer project" is not English. `have` contracts when it is an auxiliary
    ("we've finished") and not when it is the main verb meaning possess ("we have a
    project"). Both broken forms went out on camera on 2026-09-18."""
    from speakable import speakable

    for t in ("to see if we have a timer project",
              "what project files we have here",
              "I have two options",
              "you have the link",
              "we have enough data"):
        assert speakable(t) == t, f"should not contract: {speakable(t)}"

    for t, want in (("I have finished the page", "I've finished the page"),
                    ("we have already checked that", "we've already checked that"),
                    ("you have seen the chart", "you've seen the chart")):
        assert speakable(t) == want, f"{speakable(t)!r} != {want!r}"
    print("  have contracts only as an auxiliary")


# ---- D13: a numbered list is not read aloud --------------------------------
# The last thing he said on camera on 2026-09-18: "…and the full hooks contract suite. What
# They Prove 1. Environment Integ". The list was read out and then cut off mid-word.
_R1 = ("I've run the environment contract test suite and the full hooks contract suite. "
       "What They Prove 1. Environment Integrity: every variable resolves. 2. Hook Wiring: "
       "all 72 hooks fire in order. 3. Exit codes are honest.")
eq(s.clamp_spoken(s.for_the_ear(_R1))[0],
   "I've run the environment contract test suite and the full hooks contract suite.",
   "an inline list is cut back to its lead-in, heading and all")
_R2 = ("I've built the world clock wall project exactly as requested: 1. Created a New Folder: "
       "The project has been created under the world clock directory. 2. Installed the template.")
eq(s.clamp_spoken(s.for_the_ear(_R2))[0],
   "I've built the world clock wall project exactly as requested.",
   "the lead-in before a colon survives (it used to be thrown away as a receipt row)")
eq(s.lead_in("1. First thing. 2. Second thing."), "First thing.",
   "a reply that is only a list says its first item")
eq(s.lead_in("It uses Tailwind v4. It renders."), "It uses Tailwind v4. It renders.",
   "a version number is not a list")
eq(s.lead_in("It was step 1. Then it stopped."), "It was step 1. Then it stopped.",
   "a lone number is not a list")
hasnt(s.for_the_ear("The page is up at localhost 5173."), "thousand",
      "a port written with a space is an address, not a quantity")


# ---- a written answer is not a spoken one --------------------------------
# Heard on 2026-09-19: he read a numbered report out loud, "2." included, and a whole
# paragraph written for the claims gate. Prose answers sounded human on the same day,
# which is what "sometimes a robot, sometimes not" actually was.
_REPORT = ("I've built the world clock wall project exactly as requested: "
           "1. Created a New Folder: The project has been create under the world "
           "clock directory and verified. 2.")
hasnt(s.from_report(_REPORT), "1.", "list numbers are for the eye, never the ear")
hasnt(s.from_report(_REPORT), "as requested", "form-letter filler is not speech")
eq(s.from_report(_REPORT), "I've built the world clock wall project.",
   "a list keeps its lead-in and stops there")
eq(s.from_report("I've executed the production build command within this turn to ensure "
                 "the exact command signature matches the claims validation check."), "",
   "a sentence written for a gate is not said out loud at all")
eq(s.from_report("No, Montreal's Septembers aren't getting wetter over the last ten years."),
   "No, Montreal's Septembers aren't getting wetter over the last ten years.",
   "a real answer passes through untouched")
hasnt(s.from_report("**Done** — the `hero` section is up."), "*", "markdown is not pronounceable")

# ---- an opener is a rare human word, not a rotation -----------------------
# Every line after the first used to take the next opener in turn: "Okay, I'm... Next,
# I'm... Then I'm... So I'm...". Five filler-led sentences in a row is a tic.
_lines, _last = [], ""
for _i, _d in enumerate(["Creating the project", "Starting the dev server",
                         "Writing the hero section", "Adding the glass cards",
                         "Checking the page renders", "Wiring the newsletter box"]):
    _l, _last = s.narration(_d, n=_i, last_opener=_last)
    _lines.append(_l)
_led = [l for l in _lines if _re.match(r"(Now|Okay,|Next,|Then|So|Right,|Alright,)\s", l)]
if len(_led) > 2:
    FAIL.append(f"at most 2 of 6 lines may open with a filler word\n     got: {len(_led)}: {_led}")
hasnt(" ".join(_lines), "Next, ", "'Next,' reads as a slide deck, not a person")


# ---- the checks below were DEFINED but never CALLED ------------------------
# They sat after the verdict and its sys.exit, so they had never run. One of them was red the
# first time it did (test_code_never_spoken: "export default" leaked into speech). Found
# 2026-09-18. They run now, and a failure counts like any other.
for _fn in (test_code_never_spoken, test_every_recap_shape_is_english,
            test_spoken_lines_are_short_enough_to_listen_to,
            test_have_contracts_only_as_an_auxiliary):
    try:
        _fn()
    except AssertionError as e:
        FAIL.append(f"{_fn.__name__}: {str(e)[:160] or 'assertion failed'}")


# ---- SP.0  THE CONTROL: the transforms must be doing the work -----------------------
# Every assertion above judges the OUTPUT of a speakable function. None of them showed that
# the input would have failed — so a transform that quietly became a pass-through would keep
# this suite green, and the first anyone would hear of it is Ash reading a file path aloud
# character by character. Three checks in this project passed for the wrong reason this week;
# "it passes" is not evidence on its own.
#
# So: feed the RAW text to the same assertions the shaped text has to satisfy, and require
# the raw text to fail them. Each pair is one rule this module exists to enforce.
_CONTROL = [
    # (raw, what must NOT survive into speech, which rule)
    ("open /home/user/ash/app/orb/daemon/ashd.py",
     "/home/user", "a path is not read out as a path"),
    ("run `npm run build && npm test`", "&&", "shell operators are not spoken"),
    ("see README.md for details", ".md", "a file extension is not spelled out"),
    ("install @tailwindcss/vite", "@", "a package name is not read as punctuation"),
]
for _raw, _forbidden, _rule in _CONTROL:
    _spoken = s.for_the_ear(_raw)
    if _forbidden not in _raw:
        FAIL.append(f"SP.0 CONTROL fixture is wrong: {_forbidden!r} is not in {_raw!r}, "
                    f"so it cannot demonstrate anything about {_rule}")
    elif _forbidden in _spoken:
        FAIL.append(f"SP.0 {_rule}\n     got: {_spoken!r}\n  forbids: {_forbidden!r}")
    elif _spoken == _raw:
        FAIL.append(f"SP.0 CONTROL: for_the_ear returned its input unchanged for {_raw!r} — "
                    f"a pass-through would satisfy every assertion above it")

# and the composer — asserted as the PIPELINE, which is what actually reaches the speaker.
# Shaping is two stages in two places: `speak()` runs from_report before queueing, and the
# say-loop runs strip_internal + for_the_ear when it picks the line up (ashd.py:1699, :1752).
# The first draft of this control required from_report alone to strip a path, which is
# for_the_ear's job one stage later — it reported a defect that was not there. A stage tested
# in isolation is not the thing the user hears.
def _pipeline(text):
    stage = s.from_report(text)
    return s.for_the_ear(s.strip_internal(stage) or stage)


_report = ("Build complete. See /home/user/out/index.html and run `npm run preview`.\n"
           "- 3 files changed\n- 0 errors")
_said = _pipeline(_report)
if _said.strip() == _report.strip():
    FAIL.append("SP.0 CONTROL: the pipeline returned the report verbatim — a written report "
                "read aloud is what made him sound like a robot")
for _bad in ("/home/user", "`", "- 3 files", "index.html"):
    if _bad in _said:
        FAIL.append(f"SP.0 a written report is not spoken as written\n     got: {_said!r}\n"
                    f"  forbids: {_bad!r}")
# CONTROL: the raw report must fail the same assertions, or the pipeline is doing nothing.
_leaks = [b for b in ("/home/user", "`", "- 3 files", "index.html") if b in _report]
if len(_leaks) < 3:
    FAIL.append(f"SP.0 CONTROL fixture is too clean to prove anything: only {_leaks} present")

if FAIL:
    print(f"\n{len(FAIL)} FAILED\n")
    for f in FAIL:
        print("  ✗", f)
    sys.exit(1)
print("speakable: all checks pass")
