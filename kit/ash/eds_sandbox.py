"""Orbs' own stand-in for Ash's eds_sandbox (PLAN 4.5). Ash's swept his real GNOME calendar of
anything a suite made; the kit's calendar is only what the home hands in, kept in memory, and
it cannot be written at all (eds.py), so there is nothing to sweep."""


def guard(label=""):
    """Nothing to snapshot or remove: a suite cannot write the kit's calendar."""
    return None
