"""Orbs' own (PLAN 4.1), in place of Ash's `browserservice`: the one name pagepoint takes from it.

Ash's pagepoint defaults to his browser service's port (9222, his visible Chrome). In the kit
that default must never be anyone's browser, so it is `browser.PORT`, 0, which nothing listens
on; pagecheck points pagepoint at the kit's own headless Chromium before it asks anything
(`browser.inspector()`).
"""
from browser import PORT  # noqa: F401
