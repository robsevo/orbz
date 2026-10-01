#!/usr/bin/env python3
"""Where a new task's work goes, decided before it is typed (PLAN 18.1, out of `ashd.py`).

One subject: a task that makes something NEW with no place named gets its own folder, and a
one-off picture (a chart, a plot) gets its own script rather than being written into whatever
project was open a moment ago. It reads a string and returns a string, which is why it could
leave the daemon alone.

**Proved by the behaviour baseline:** `daemon.with_folder` carried ONE frozen case for three
branches, so seven were added and blessed BEFORE the move — `chaincheck`'s own three plus the
edges — and the move changed one line of RESOLVE, with no drift. `chaincheck`'s "a new task
gets its own folder" link imports this module instead of slicing `ashd.py`'s source.
"""
import re


def with_folder(task):
    """A script dropped straight into ~ has no project to sit in, and the next task then
    writes into whatever folder the last one happened to use. So something NEW with no
    location said goes in its own folder. Done here, not in the planner prompt: the model
    dropped the rule."""
    new = re.search(r"\b(create|make|build|write|generate|scaffold|start)\b", task, re.I)
    thing = re.search(r"\b(script|app|program|file|generator|game|project|website|site|tool|bot|api|cli|"
                      r"page|landing page|dashboard|portfolio|blog|form|widget|component|extension|"
                      r"server|service|scraper|parser|demo|prototype|mockup)\b", task, re.I)
    # A web address elsewhere is a REFERENCE, not a location (2026-09-24 sweep): "build a site like
    # https://stripe.com" read as placed because of its slashes, and got no folder of its own.
    # A local one (localhost, 127.x) is the thing itself, already running somewhere, and stays placed.
    bare = re.sub(r"https?://(?!localhost\b|127\.|0\.0\.0\.0)\S+", " ", task, flags=re.I)
    placed = re.search(r"(/|~|\bfolder\b|\bdirectory\b|\brepo\b|\bin (this|the|my)\b)", bare, re.I)
    # A one-off picture — a chart, a plot, a graph — is not a feature of whatever app he
    # happens to be sitting in. Asked to "chart Montreal's daily highs" straight after a
    # coffee landing page, he wrote a WeatherChart component INTO the coffee site, imported
    # chart.js which was never installed, and the whole site became a Vite error overlay:
    # the user's "the oak app is just white" (2026-09-17).
    artifact = re.search(r"\b(chart|plot|graph|diagram|visuali[sz]e|visuali[sz]ation)\b", task, re.I)
    if artifact and not placed:
        return (task.rstrip(". ") + ". Write it as its own standalone script and open the result "
                "when it is done. Do NOT add it to a project you were working on a moment ago.")
    if new and thing and not placed:
        return (task.rstrip(". ") + ". Put it in a new folder named for it under ~/ash-projects — "
                "a new thing gets a new folder, never a file dropped into the last project.")
    return task
