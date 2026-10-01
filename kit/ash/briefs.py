"""briefs — the instructions that ride along with a task, WITHOUT being typed on screen.

These used to be appended to the task text itself, which meant the whole brief was typed
into the terminal in front of the user: nine hundred words of internal instruction filling
the recording (user, 2026-09-18: "user should not see that"). The text is unchanged; what
changed is the delivery. `~/ash/brain/ash-brief.sh`, a UserPromptSubmit hook, imports this
module and hands the brief to the session as context, so what appears on screen is the one
line the user actually asked for and the brief arrives invisibly.

ashd imports the same names, so the triggers and the wording have exactly one home.
"""
import re


# The lines the user HEARS while he works are the `description` field of each tool
# call. Left alone the model writes them for a log — "Install Tailwind Vite plugin.",
# "Start the Vite development server in background." — bare imperatives with no
# subject and no articles, which is the robot voice the user keeps hearing. The
# cheapest fix by far is to change what gets written, not to repair it afterwards:
# he is composing that string anyway, so ask for a spoken one (2026-09-15).
NARRATION_BRIEF = (
    " While this runs, your tool `description` fields are read out loud to the user in real time, "
    "so write each one as a short spoken sentence in the first person, the way you would say it to "
    "someone sitting next to you: \"I'm installing the Tailwind plugin\", \"that didn't work, so I'm "
    "reinstalling the dependencies\", \"the dev server is up, opening the page now\". Say what you are "
    "doing and why it matters, not the command you are about to type. No paths, no package names with "
    "slashes, no flags, no backticks, no shorthand — plain spoken English, ten to eighteen words. "
    "A WHOLE SENTENCE, NOT A STUB: \"I'm starting the dev server, so the page shows up while I "
    "work\", never \"Starting the dev server.\" A stub spoken on its own is drawled and sung by the "
    "voice — measured, a fragment runs a quarter slower per syllable than the same thought written "
    "as a sentence, and swings twice as far in pitch. Two clauses joined by so, then, which or "
    "while is the shape that sounds like a person. "
    "NEVER REPEAT A LINE YOU HAVE ALREADY SAID. Measured across 35 sessions on 2026-09-18, one in "
    "twenty-three spoken lines was word-for-word identical to an earlier one, and in the worst "
    "session fourteen of seventy-eight were — the user hears every one of them twice. If you are "
    "doing the same kind of step again, say what is DIFFERENT about this one (\"now the same check "
    "on the search tests\"), and if nothing is different, say nothing at all: a silent tool call is "
    "better than an echo."
)


# The constitution says the server comes up first. A constitution is read once at
# session start and competes with everything else in context; the instruction the
# user's own request arrives in does not. On 2026-09-15, with the rule in place, he
# still scaffolded, installed and wrote every file before starting the server at
# minute three - so the user watched an empty right-hand screen through the whole
# build. Same lesson as NARRATION_BRIEF: change what gets WRITTEN, not what gets
# remembered.
# "menu" (2026-09-27): "build a bright, colourful tropical smoothie bar menu" matched nothing here,
# so it went without the build brief at all — no template, no photo rule, no style — and came out
# however the model felt. A menu is a page, and the passes below (hero, product cards, footer) fit it.
SERVED_RE = re.compile(r"\b(landing page|website|web ?app|site|page|menu|dashboard|portfolio|blog|"
                       r"front ?end|ui|react|next\.?js|vite|svelte|vue|angular|astro)\b", re.I)

# HIS OWN LOOK, so the prompt on screen can stay short. The user types a handful of words
# into the SAY box and the camera zooms in on it (2026-09-19: "not so complicated when it
# comes to the prompt in the text box, we will be zooming in on that"), so the house style
# lives here instead of in the prompt. Values read off his own panels, and the accent is
# the hue his orb is actually set to right now: 200 degrees, azure.
# NO WORDS BETWEEN PASSES (2026-09-28, take 10). The pass briefs asked for "one short sentence what
# just appeared" after each pass, and a message with only words in it is the END of his turn: the
# drum machine stopped after pass 1 ("the drum machine's grid is now visible"), and asking for the
# sentence to ride with the next edit instead did not hold — the dashboard stopped after pass 2
# the same way. Take 8's page, the one that finished, went pass to pass in 31 s with nothing in
# between. His tool descriptions are read out as he works (NARRATION_BRIEF), so nothing is lost.
NO_STOP_BETWEEN = ("with no message in between \u2014 a message with only words in it ends your "
                   "turn, and the job is all four passes; say what is on the page once, after the "
                   "fourth")

HOUSE_STYLE = (
    " HOUSE STYLE — build it the way HE looks, unless the request says otherwise. Near-black "
    "ground (#07070A to #0B0B0D). Glass panels: a 7% cool-grey fill rgba(140,157,175,.07), a "
    "hairline border rgba(140,157,175,.18), 18-24px backdrop blur, 16-20px radius, a soft "
    "shadow under each. Type in cool grey — #BCCAD8 for what matters, #8C9DAF for what does "
    "not — with ONE accent, his own azure: #5EB3DE for anything live, #93CAE5 when it needs "
    "to be brighter, #307EA6 for the quiet end of it. Amber #BF8B49 only for something that "
    "needs attention. Generous space, nothing cramped, big quiet headings. Motion is slow and "
    "physical: things fade and rise a few pixels, glass catches the light on hover, nothing "
    "bounces or spins. CSS and IntersectionObserver only — install nothing for animation. It "
    "should look like it belongs beside his orb on the same desk."
)


BUILD_BRIEF = (
    # ONE RULE PER LINE (PLAN 7.7). This was a single 2,362-character paragraph carrying six
    # separate rules, and the ones in the middle are the ones that got dropped — `npm create
    # vite` was forbidden here, in two skills and in the constitution, and he ran it anyway,
    # twice, on camera. The wording is unchanged; only the shape is. The two most-violated
    # rules sit FIRST and LAST, where a long context is read most reliably.
    "IMPORTANT \u2014 the user is watching this happen on screen.\n"
    "\n"
    "1. SERVER FIRST. Get a dev server RUNNING FIRST, before you write any application "
    "code. The fastest way is the template: run `ashnew web ~/ash-projects/<name>`, which "
    "copies a Vite + React + Tailwind v4 project that is already installed, already serving "
    "and already verified, and prints the URL \u2014 about three seconds. Every project lives "
    "in ~/ash-projects, never loose in the person's home folder. That server stays up while "
    "you work: never start a second one \u2014 another `npm run dev` lands on the next port, "
    "and the page the person is watching is left on the old one.\n"
    "\n"
    "2. DO NOT SCAFFOLD BY HAND \u2014 not `npm create`, `bun create`, `pnpm create`, `yarn "
    "create` or `npx create-*`. Any of them costs two to three minutes of install output "
    "nobody wants to watch, and it is where these builds keep breaking: Tailwind wired the "
    "old way gives an unstyled white page, and an install that silently resolves nothing "
    "leaves no dev server at all.\n"
    "\n"
    "3. ICONS come from src/lib/icons.tsx, which the template carries. lucide-react has no "
    "brand marks, and importing one from it kills the module \u2014 the page then renders "
    "white with no error on it.\n"
    "\n"
    "4. PHOTOGRAPHS come from src/lib/photos.ts. Every image. For a drink, a smoothie or a "
    "bowl, use `photoFor(item.name)` \u2014 it gives the photo that matches the name (Mango "
    "Madness gets a mango smoothie) from files inside the project, so it always loads; for "
    "anything else use `pick(theme, n)`. Never type a photo address: an Unsplash id written "
    "from memory 404s, and a replacement from memory is a random picture \u2014 on "
    "2026-09-27 \"Mango Madness\" got a 404, then a salad bowl.\n"
    "\n"
    "5. BUILD IT IN PASSES, NOT IN ONE WRITE. The user is watching your terminal and the "
    "preview side by side, and a single write of the whole file gives them nothing to "
    "watch: the screen sits still while you think, then the finished page appears all at "
    "once. Put the page up in four separate edits, in this order, leaving a beat between "
    "them so the preview can reload.\n"
    "\n"
    "     (1) the shell \u2014 page background, nav bar, and the hero heading and "
    "subheading only;\n"
    "     (2) the hero image and its call-to-action buttons;\n"
    "     (3) the three product cards with their photographs and prices;\n"
    "     (4) the story section and the footer.\n"
    "\n"
    "   Go straight from each pass to the next, " + NO_STOP_BETWEEN + ". Each pass is a real "
    "edit to src/App.tsx, not a comment or a placeholder, and the page must render "
    "correctly after every one of them: four working pages that get richer, never a broken "
    "page waiting on the next edit.\n"
    "\n"
    "6. STAY IN THE PROJECT FOLDER. Your shell starts in the person's HOME directory. cd into "
    "the project folder before anything that acts on \"this folder\": never run `git init`, "
    "`git add .`, `npm install` or `rm` from home \u2014 from there `git add .` tries to add every "
    "file the person owns (2026-09-27: it ran two minutes, wrote 459 MB, and asked to rm -rf "
    "~/.git on camera). Git is optional; if you use it, only inside the project.\n"
    "\n"
    "7. CHECK IT, THEN SAY IT ONCE. Write the page into src/App.tsx with the preview open "
    "beside you so it updates as you work, and check it with `ashpagecheck <url>` before "
    "you call it done. When it is done, say so ONCE and stop. Do not re-check the server "
    "and announce it again, and do not restate the summary in different words \u2014 the "
    "person heard you the first time, and every repeat is read out loud to them."
)


# A chart is not "served", so SERVED_RE never matched one and a plotting task got no
# brief at all. Measured 2026-09-17: asked to chart a week of weather he spent about two
# minutes checking whether matplotlib was installed, then whether requests was, one probe
# at a time, before writing a line — with `ashnew chart` sitting there holding all three in
# a verified venv. Same lesson as the build brief: the template only helps if the
# instruction arrives with the work.
# Two kinds of trigger. The first names a chart outright. The second is a question ABOUT
# measurements — "was this week warmer than the same week last year?" — which is the shape
# that most wants a picture and never says the word, and which on 2026-09-17 sent him
# probing for matplotlib all over again. The brief below is written conditionally ("if this
# needs a chart") so the second, looser trigger cannot mislead a task that turns out to
# need no plot at all.
CHART_RE = re.compile(r"\b(chart|plot|graph|histogram|scatter|visuali[sz]e|bar ?chart|"
                      r"line ?chart|pie ?chart|trend ?line"
                      r"|(?:warmer|colder|hotter|cooler|wetter|drier|higher|lower|faster|slower"
                      r"|more|less|better|worse)\s+than"
                      r"|compared?\s+(?:to|with)|over\s+the\s+(?:last|past)\s+\w+)\b", re.I)

CHART_BRIEF = (
    # Four rules, four blocks (PLAN 7.7). This was one 3,167-character paragraph that
    # already knew it needed headings — it had WHERE THE NUMBERS COME FROM shouted in the
    # middle of a wall of prose. Wording unchanged; the data-source rule is LAST because it
    # is the one that went wrong on camera.
    "IMPORTANT \u2014 if this needs a chart, do not go looking for plotting libraries, and "
    "do not install any.\n"
    "\n"
    "1. START FROM THE TEMPLATE. Run `ashnew chart <dir>`, which copies a project whose "
    "virtual environment already has matplotlib, pandas and requests in it, verified, plus "
    "a house-style dark chart to edit and a `run` script that plots it and puts it on "
    "screen. Checking whether matplotlib is present, then whether requests is, one at a "
    "time, costs two minutes of a recording and answers a question the template already "
    "settled. Edit chart.py, run it, and the chart opens by itself \u2014 if you plot some "
    "other way, you must still finish with `ashshow <path>`, because a chart nobody can see "
    "was not delivered.\n"
    "\n"
    "2. IF IT IS GOING ON SCREEN IN FRONT OF SOMEONE, MAKE IT ONE THEY CAN POKE AT. "
    "`ashnew chartlive <dir>` copies a page whose chart already has a hover readout, "
    "arrow-key stepping, series you can switch off and a line that draws itself in \u2014 "
    "near-black, glass, his azure, no dependencies. Edit `fetch()` and META in build.py, "
    "then `./run`, and it opens itself. That is the house chart now, and everything else on "
    "screen is expected to look like it. Use `ashnew chart` instead only when a still image "
    "is what was asked for.\n"
    "\n"
    "3. HOW IT HAS TO LOOK. A chart that is merely correct still reads as homework on "
    "camera.\n"
    "\n"
    "     \u2022 A real title that says what the reader is looking at, and a one-line "
    "subtitle with the place, the period and the source.\n"
    "     \u2022 Label both axes with their units.\n"
    "     \u2022 Type big enough to read on a phone: title around 20pt, labels 12 to 13, "
    "nothing under 11.\n"
    "\n"
    "     \u2022 Keep the house dark ground, draw ONE accent colour for the data and let "
    "everything else be grey \u2014 no rainbow of colours for a single series.\n"
    "     \u2022 Drop the top and right spines, keep a faint horizontal grid only, and give "
    "the figure room to breathe (tight_layout, generous margins).\n"
    "     \u2022 Where a number is the point, say it on the chart: annotate the peak, the "
    "trough, the last value, or the total \u2014 one or two callouts, not a label on every "
    "point.\n"
    "     \u2022 If the x axis is dates, format them as dates a person writes, not "
    "timestamps.\n"
    "     \u2022 Nothing may overlap: if the labels collide, rotate them or drop every "
    "other one.\n"
    "\n"
    "4. WHERE THE NUMBERS COME FROM \u2014 this is the part that keeps going wrong. "
    "A WEB SEARCH IS NOT A DATA SOURCE. Reading figures out of a search result and typing "
    "them into the script produces a chart that is wrong and a citation that is false: on "
    "2026-09-18 that gave seven Montreal daily highs spanning 20 to 22 degrees for a week "
    "that actually ran 17.9 to 24.1, credited to a site that was never called. Fetch the "
    "numbers IN THE SCRIPT, from an endpoint that returns data.\n"
    "\n"
    "   For weather, Open-Meteo "
    "needs no key: `https://api.open-meteo.com/v1/forecast?latitude=..&longitude=.."
    "&daily=temperature_2m_max&past_days=7&timezone=auto` for the last week, and "
    "`https://archive-api.open-meteo.com/v1/archive?..&start_date=YYYY-MM-DD"
    "&end_date=YYYY-MM-DD` for any date in the past.\n"
    "\n"
    "   The script must contain the request, "
    "not the answer \u2014 a literal list of numbers with no fetch above it is a made-up "
    "chart however it was arrived at. If no endpoint gives you the data, say so plainly and "
    "plot nothing; a missing chart is honest and a fabricated one is not."
)


# WHO IS LISTENING. Everything he says out loud is heard by someone who may have started
# coding last week — the user, 2026-09-19: "like hes explaining to every vibe coder in
# existence, even people who have just started". This is not a request to dumb anything
# down: he does the same work, and says it in words that do not need a glossary.
# He can see now (ashd/see.py, `ashsee`), so "I can't see your screen" is no longer true
# and no longer an acceptable answer.
SEE_BRIEF = (
    " GREET LIKE A PERSON. \"Hey.\" on its own, or \"Morning.\" — one word, then say the thing. "
    "Never \"Hey there\", \"Hi there\", \"Hello!\", \"Greetings\" or \"How may I help you\": those "
    "are the noises a chatbot makes, and they are the first thing anyone hears. "
    " CONTRACTIONS, ALWAYS. You're, it's, that's, I'll, I'm, doesn't, isn't, here's. Written "
    "out — \"How is your Saturday going? What is on your mind?\" — it reads as a machine being "
    "polite, and that is exactly what it sounds like out loud. "
    " YOU CAN LOOK AT THE SCREEN. `ashsee` takes one look at the working screen and tells "
    "you what is on it, and `ashsee \"is the hero image loading?\"` asks something specific. "
    "Use it when you are asked what is on screen, when you want to check the page you just "
    "built actually looks right, or when something is described to you that you could "
    "simply go and look at. Say what you can actually see, with the real values on it — "
    "never \"I can't see your screen\"."
)


PLAIN_BRIEF = (
    " HOW TO SAY IT. Whoever is listening may have written their first line of code last "
    "week. Every spoken line has to land for them. Say what a thing is FOR before you say "
    "what it is called: \"the dev server — the little program that keeps showing the page "
    "while I change it\", \"a component, which is just one piece of the page I can reuse\". "
    "One new word per sentence at most, explained in the same breath, and never twice — "
    "once it is explained it is yours to use. No file paths, no flags, no package names, "
    "no acronym without what it does. Short sentences, spoken rhythm, no lists read out "
    "loud. When something breaks, say what broke in plain words and what it means for the "
    "page before you say what you are doing about it. Never say \"as you can see\" — say "
    "what changed. The test for every line: could someone who has never opened a terminal "
    "follow it without stopping you? And your LAST line is the finding itself \u2014 the number, "
    "the answer, what is on screen now (\"Montreal loses about three minutes of daylight a "
    "day this month\") \u2014 never where the file is saved, whether it is deployed or public, "
    "or which checks you ran."
)


# GAMES AND TOOLS GET A BRIEF TOO (2026-09-27, take 9). SERVED_RE is about PAGES, so "build a
# snake game", "a drum machine", "a pomodoro timer" and "a tip calculator" reached him with no
# build brief at all \u2014 no template, no ~/ash-projects, no one-server rule \u2014 and he
# improvised. The landing-page passes (hero, product cards, footer) do not fit a thing you USE,
# so APP_BRIEF is BUILD_BRIEF with only rule 5 swapped: one copy of every shared rule.
APP_RE = re.compile(r"\b(game|machine|timer|stopwatch|countdown|calculator|converter|tracker|"
                    r"player|quiz|clock|counter|simulator|visuali[sz]er|generator|piano|synth|"
                    r"sequencer|drums?|instrument|tool)\b", re.I)
APP_PASSES = (
    "5. BUILD IT IN PASSES, NOT IN ONE WRITE. The user is watching your terminal and the "
    "preview side by side. Put it up in four separate edits to src/App.tsx, in this order, "
    "leaving a beat between them so the preview can reload:\n\n"
    "     (1) the thing itself, working at its simplest \u2014 the board, the pads, the timer face;\n"
    "     (2) its controls \u2014 the keys and buttons, on screen and working;\n"
    "     (3) its state \u2014 the score, the total, the time left \u2014 and a way to start again;\n"
    "     (4) polish \u2014 sound where it belongs, motion, a title.\n\n"
    "   Go straight from each pass to the next, " + NO_STOP_BETWEEN + ". Each "
    "pass is a real edit, and the page works after every one of them.")
_RULES = re.split(r"\n\n(?=\d+\. )", BUILD_BRIEF.strip())
APP_BRIEF = "\n\n" + "\n\n".join(
    APP_PASSES if r.startswith("5. ") else r for r in _RULES) + "\n"

# THIS MACHINE'S NUMBERS ARE REAL (2026-09-28, take 10). Asked for "a live dashboard of my CPU and
# memory" he drew Math.random() and labelled it the person's machine (take 9), because a browser
# cannot read the CPU and nothing said the template could. It can now: the web template's dev
# server answers GET /api/stats from /proc (~/ash-templates/web/stats.ts, src/lib/stats.ts). A
# dashboard of it gets passes that fit a dashboard, not the landing page's hero and product cards.
MACHINE_RE = re.compile(r"\b(cpu|processors?|system monitor|load average|(?:ram|memory)\s+(?:usage|use|used|load)"
                        r"|my\s+(?:ram|memory|computer|machine|pc|laptop))\b", re.I)
DASH_PASSES = (
    "5. BUILD IT IN PASSES, NOT IN ONE WRITE. The user is watching your terminal and the "
    "preview side by side. Put it up in four separate edits to src/App.tsx, in this order, "
    "leaving a beat between them so the preview can reload:\n\n"
    "     (1) the two big live readouts \u2014 CPU busy and memory used of total \u2014 from useStats();\n"
    "     (2) a line chart of the last minute of both, an SVG drawn from `history` \u2014 no chart library;\n"
    "     (3) one bar per core from `stats.cores`, and the load average;\n"
    "     (4) polish \u2014 a title, the host name and uptime, the numbers easing as they change.\n\n"
    "   Go straight from each pass to the next, " + NO_STOP_BETWEEN + ". Each "
    "pass is a real edit, and the page works after every one of them.")
DASH_BRIEF = "\n\n" + "\n\n".join(
    DASH_PASSES if r.startswith("5. ") else r for r in _RULES) + "\n"
MACHINE_BRIEF = (
    " DATA \u2014 THIS MACHINE'S NUMBERS ARE REAL, AND ALREADY SERVED. The web template's dev server "
    "answers GET /api/stats with this computer's live CPU and memory, read from /proc. In src/App.tsx: "
    "`import { useStats, gb } from './lib/stats'`, then `const { stats, history } = useStats()` \u2014 "
    "`stats.cpu` and `stats.cores` are percent busy; `stats.memory.used` and `.total` are bytes (`gb()` "
    "formats them) and `.percent` is the share in use; `history` holds the last 60 one-second readings "
    "for a chart. Show those and nothing else: never Math.random, never sample or made-up figures \u2014 "
    "a dashboard of invented numbers labelled as the person's machine is a lie. No new server and no "
    "package: it is already running.")


def machine_brief(task):
    return MACHINE_BRIEF if MACHINE_RE.search(task or "") else ""


# A CHANGE TO A PAGE THAT EXISTS IS AN EDIT, NOT A BUILD (2026-09-28, take 10). "add a dark mode
# toggle to the page in ~/ash-projects/tropical-smoothie-bar" matched SERVED_RE ("page") and got
# the whole build brief \u2014 server first, four passes \u2014 so he set out to write the 800-line page
# again in one go, announced it twice, and never emitted the write. The page is up; the task is one
# change to it.
EDIT_RE = re.compile(r"\b(add|change|make|turn|put|move|remove|fix|swap|replace)\b.*"
                     r"\b(?:in|to|on|at)\s+(?:the\s+page\s+in\s+)?~?/[\w./-]*ash-projects/[\w.-]+", re.I)
EDIT_BRIEF = (
    "\n\nIMPORTANT \u2014 this page already exists and is on screen, with its dev server running. "
    "This is ONE CHANGE to it. Make it with small, targeted Edits to the file that holds the part "
    "being changed \u2014 never write the whole file again, never run ashnew, never start another "
    "server. Read the file, change what the request names, check it with `ashpagecheck <url>`, and "
    "say in one sentence what is different on the page now.\n")
KEEP_LOOK = (" STYLE \u2014 THE PAGE KEEPS ITS OWN LOOK. Change only what the request names; every "
             "colour, font and layout it does not mention stays exactly as it is.")


def edit_style(task):
    """An edit restyles nothing it was not asked to: bright or a dark-mode toggle only when named."""
    return style_for(task) if (BRIGHT_RE.search(task or "") or DARK_TOGGLE_RE.search(task or "")) else KEEP_LOOK

# THE STYLE FOLLOWS THE REQUEST (2026-09-27, takes 8 and 9). "build a bright, colourful tropical
# smoothie bar menu" came out near-black: HOUSE_STYLE says "unless the request says otherwise",
# and a paragraph of hex codes outweighs two adjectives in the prompt. And "add a dark mode
# toggle" carried the same near-black brief, which reads as "restyle it dark". Now a request for
# a bright page gets BRIGHT_STYLE instead, a dark-mode toggle keeps the page's own look, and
# only everything else gets the house look.
BRIGHT_RE = re.compile(r"\b(bright|light|colou?rful|vibrant|pastel|sunny|cheerful)\b", re.I)
DARK_TOGGLE_RE = re.compile(r"\b(dark|night)\s+(mode|theme)\b", re.I)
BRIGHT_STYLE = (
    " STYLE \u2014 THIS PAGE IS BRIGHT, because the request asks for it. A light ground (#FFFFFF to "
    "#FFF8EE), never a dark one; vivid colour on what matters \u2014 the products, the buttons, the "
    "total; rounded cards with soft shadows; dark text (#1B1B1F) to read. No near-black background "
    "anywhere. A dark mode, if one is ever asked for, is a toggle, never the default.")
KEEP_STYLE = (
    " STYLE \u2014 THE PAGE KEEPS ITS OWN LOOK. Its current colours stay the default exactly as they "
    "are; the dark mode is only what the toggle switches TO, and the toggle must visibly change the "
    "page both ways.")


def style_for(task):
    if BRIGHT_RE.search(task or ""):
        return BRIGHT_STYLE
    if DARK_TOGGLE_RE.search(task or ""):
        return KEEP_STYLE
    return HOUSE_STYLE


def with_narration_brief(task, narrating):
    """Append the spoken-description brief to work sent to a linked, narrating CLI, plus
    the brief for the kind of work it is: server-first for anything served, template-first
    for anything plotted. A task gets at most one — they both open with a template and
    stacking them would just be two sets of setup instructions arguing."""
    out = task.rstrip()
    if EDIT_RE.search(task or ""):
        out += EDIT_BRIEF + edit_style(task) + machine_brief(task)
    elif MACHINE_RE.search(task or "") and (SERVED_RE.search(task or "") or APP_RE.search(task or "")):
        out += DASH_BRIEF + style_for(task) + MACHINE_BRIEF
    elif SERVED_RE.search(task or ""):
        out += BUILD_BRIEF + style_for(task)
    elif CHART_RE.search(task or ""):
        out += CHART_BRIEF
    elif APP_RE.search(task or ""):
        out += APP_BRIEF + style_for(task)
    return out + NARRATION_BRIEF if narrating else out


def folder_brief(task):
    """Where a new thing goes, as CONTEXT (2026-09-28). `taskshape.with_folder` appended this to
    the TYPED task, so "…Put it in a new folder named for it under ~/ash-projects — a new thing
    gets a new folder…" scrolled past in his terminal on camera: hard rule 4 (CLAUDE.md §9.4) says
    what he is told reaches him through the hook, never concatenated onto what the person typed.
    Same decision, same words, delivered here instead."""
    try:
        import taskshape
    except Exception:
        return ""
    base = str(task or "")
    shaped = taskshape.with_folder(base)
    if shaped == base:
        return ""
    extra = shaped[len(base.rstrip(". ")):].strip(" .")
    return f"\n\n{extra}." if extra else ""


def for_task(task, narrating=True):
    """JUST the brief for this task — no task text — for the hook to hand over as context.

    Same choice `with_narration_brief` used to make: server-first for anything served,
    template-first for anything plotted, at most one of the two, and the spoken-description
    brief on top whenever his lines are being read out loud.
    """
    out = folder_brief(task)
    if EDIT_RE.search(task or ""):
        out += EDIT_BRIEF + edit_style(task) + machine_brief(task)
    elif MACHINE_RE.search(task or "") and (SERVED_RE.search(task or "") or APP_RE.search(task or "")):
        out += DASH_BRIEF + style_for(task) + MACHINE_BRIEF
    elif SERVED_RE.search(task or ""):
        out += BUILD_BRIEF + style_for(task)
    elif CHART_RE.search(task or ""):
        out += CHART_BRIEF
    elif APP_RE.search(task or ""):
        out += APP_BRIEF + style_for(task)
    if narrating:
        out += NARRATION_BRIEF
    out += PLAIN_BRIEF          # every spoken line, whether it is narration or an answer
    out += SEE_BRIEF
    return out.strip()
