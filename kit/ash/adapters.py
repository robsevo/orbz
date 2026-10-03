"""Orbs' own stand-in for Ash's adapters (PLAN 4.5): only the journal the carried `day` and
`reminders` keep promises and fired reminders in. The rest of Ash's adapters is his legacy
file-slot transport, which Orbs does not have (its approvals are the home's cards, PLAN 1.6)."""
import runtime as rt

_journal = None


def journal():
    """Opened lazily: importing this module must not create a database."""
    global _journal
    if _journal is None:
        _journal = rt.Journal()
    return _journal
