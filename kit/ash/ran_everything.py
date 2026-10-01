#!/usr/bin/env python3
"""ran_everything — a suite's checks must actually run.

D45, 2026-09-19: four checks in `test_speakable.py` had never run. They were defined after
the suite printed its verdict, nothing called them, and when they were finally run **one was
red** — the rule that Ash never reads code aloud. The suite had been reporting green over
checks that were not being made. Same class as D4 and D5, in the one suite that holds the
whole voice together.

A collector would have made this impossible, but the house style is plain scripts (the venv
has no pytest, and a spoken claim that it did was never true). So the collector's one
guarantee is reimplemented as a static check:

  1. ORPHAN   a top-level `def` whose name appears nowhere else in the file — never called,
              never registered in a check list. This is the D45 shape.
  2. DEAD     code after an *unconditional* module-level `sys.exit(...)`. Nothing below it
              can ever execute.

Static on purpose: no tracing, no overhead, deterministic, and it cannot be fooled by a
suite that exits before the tracer sees anything.

    orb/daemon/ran_everything.py                 every test_*.py here
    orb/daemon/ran_everything.py a.py b.py       just those
"""
import ast
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Names that are called by the interpreter or a framework, not by this file.
EXEMPT = {"main", "__getattr__", "setUp", "tearDown"}


def orphans(src, tree):
    """Top-level defs never mentioned again. Counts NAME USES, not text, so a name that
    only appears inside a string or a comment does not excuse it."""
    used = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Name):
            used.add(n.id)
        elif isinstance(n, ast.Attribute):
            used.add(n.attr)
    out = []
    for n in tree.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if n.name in EXEMPT or n.name.startswith("_"):
                continue
            # A decorator that registers it counts as a use.
            if n.decorator_list:
                continue
            if n.name not in used:
                out.append((n.name, n.lineno))
    return out


def dead_after_exit(tree):
    """Statements after an unconditional module-level sys.exit. An exit inside an `if` or
    a `try` is a guard, not a terminator — test_pagepoint.py:90 is one, and an earlier
    version of this check flagged it."""
    for i, n in enumerate(tree.body):
        is_exit = (isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)
                   and ast.unparse(n.value).startswith(("sys.exit", "exit", "os._exit")))
        if is_exit and i + 1 < len(tree.body):
            return [(type(x).__name__, getattr(x, "name", ""), x.lineno)
                    for x in tree.body[i + 1:]]
    return []


# ── checks that cannot change the verdict (PLAN 2.3, found 2026-09-20) ────────────────
# `dead_after_exit` only flags an UNCONDITIONAL exit, because an exit inside an `if` is
# usually a guard (`if not shutil.which("node"): sys.exit(0)`) and flagging those cried wolf
# on seven suites. But one conditional exit is not a guard: the VERDICT —
# `if FAIL: ...; sys.exit(1)`. A check written below that line runs, appends to FAIL, and is
# then never examined: the suite prints its success banner and exits 0. It is the D45 shape
# wearing the one disguise the D45 guard was built to ignore.
#
# Found by falling into it — six checks were added under a suite's verdict block and could
# not have failed it. No other suite had the shape when this was written.
_ACCUMULATORS = ("FAIL", "FAILS", "FAILED", "failures", "fails")
_CHECK_CALLS = ("ok(", "eq(", "check(", "check_ok(", "expect(")


def _is_exit(node):
    return any(isinstance(x, ast.Expr) and isinstance(x.value, ast.Call)
               and ast.unparse(x.value).startswith(("sys.exit", "exit", "os._exit"))
               for x in ast.walk(node))


def checks_after_verdict(tree):
    """Checks below a `if <failure-accumulator>: ... exit`. They can never fail the suite.

    Narrow on purpose: the condition must name the accumulator, or every skip-guard in the
    tree gets accused — which is the mistake `dead_after_exit`'s docstring already records.
    """
    body = tree.body
    for i, n in enumerate(body):
        if not isinstance(n, ast.If) or not _is_exit(n):
            continue
        cond = ast.unparse(n.test)
        if not any(a in cond for a in _ACCUMULATORS):
            continue                                  # a guard, not a verdict
        after = []
        for stmt in body[i + 1:]:
            text = ast.unparse(stmt)
            if any(c in text for c in _CHECK_CALLS):
                after.append((stmt.lineno, text.strip().splitlines()[0][:70]))
        if after:
            return after
    return []


def scan(path):
    src = Path(path).read_text()
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        return [f"does not parse: {e}"]
    bad = []
    for name, line in orphans(src, tree):
        bad.append(f"{path}:{line}  `{name}` is defined and never called — "
                   f"it has never run, and D45 says one of those will be red")
    for kind, name, line in dead_after_exit(tree):
        bad.append(f"{path}:{line}  {kind} {name!r} is after an unconditional exit — dead")
    for line, text in checks_after_verdict(tree):
        bad.append(f"{path}:{line}  a check sits BELOW the `if FAIL:` verdict and can never "
                   f"fail this suite — it appends to the list, the list has already been "
                   f"read, the banner prints and the run exits 0: {text}")
    return bad


# ── control coverage (PLAN 2.11) ──────────────────────────────────────────────────────
# ran_everything proves every check is CALLED. It says nothing about whether any of them
# could FAIL. Four defects on 2026-09-20 were in the checking rather than the code: a
# watermark control that could not see a lost turn, a lock test that stayed green with
# `fcntl.flock` deleted, a detector that accused three innocent files, and a control that
# passed while the hook it guarded was crashing into silence. A suite with no control is a
# suite whose greenness is an untested claim.
#
# This is a RATCHET, not a gate on the world. Turning eleven suites red at once teaches
# everyone to ignore the runner. So: no NEW suite without a control, and the existing debt
# is named here and may only shrink — a suite that grows a control must be removed from the
# list, or this fails and says so.
NO_CONTROL_YET = {
    "test_claims_chain.py",
    "test_launch.py",
        "test_pagepoint.py",
    "test_phrasing.py",
    "test_teachcanvas.py",
    "test_term_ready.py",
}


# Written twice already and about to be written a third time, so it lives here once.
_DOC_HOLDERS = (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)


def docstring_ids(tree):
    """ids of every string Constant that is a docstring, so a scanner can skip prose.

    Only the four node types that CAN hold one: `getattr(node, "body")` on an `IfExp` returns
    a `Call`, and indexing it raises — which is exactly what a hand-rolled copy of this did
    on 2026-09-20."""
    out = set()
    for n in ast.walk(tree):
        if not isinstance(n, _DOC_HOLDERS):
            continue
        body = getattr(n, "body", None)
        if isinstance(body, list) and body and isinstance(body[0], ast.Expr) \
                and isinstance(body[0].value, ast.Constant) \
                and isinstance(body[0].value.value, str):
            out.add(id(body[0].value))
    return out


def code_only(source):
    """Every identifier and non-docstring literal in `source`, newline-joined.

    A detector that greps raw text reports the CORRECTED file as broken when the fix is a
    comment quoting the old code — and reports a REMOVED thing as present when a docstring
    still names it. Both have happened here. Comments never reach the AST; docstrings are
    dropped explicitly."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return source
    docs = docstring_ids(tree)
    out = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docs:
            out.append(n.value)
        elif isinstance(n, ast.Name):
            out.append(n.id)
        elif isinstance(n, ast.Attribute):
            out.append(n.attr)
        elif isinstance(n, ast.keyword) and n.arg:
            out.append(n.arg)
    return "\n".join(out)


def has_control(path):
    """Does this suite name a control anywhere a MACHINE would read it?

    Any string literal except a docstring. Comments never reach the AST, so they are
    excluded for free; docstrings are excluded deliberately, because "CONTROL for F.1" in
    prose above a function is documentation, not a check.

    Both narrower rules were tried and both were wrong. Grepping for uppercase `CONTROL`
    missed `test_pair_shutdown.py:64`, which spells it lowercase. Restricting the walk to a
    call's ARGUMENTS missed `test_verify.py`, which registers its four controls
    declaratively as `("H.2c", "CONTROL: ...", h2_control)` tuples in a list — a shape this
    house uses and a call-args rule cannot see. A detector that only recognises one spelling
    of a thing reports the other spellings as absent.
    """
    try:
        tree = ast.parse(Path(path).read_text())
    except (OSError, SyntaxError):
        return False
    docstrings = docstring_ids(tree)
    for node in ast.walk(tree):
        # a bare string statement anywhere else is prose too
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) \
                and isinstance(node.value.value, str):
            docstrings.add(id(node.value))
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) \
                and id(node) not in docstrings and "control" in node.value.lower():
            return True
    return False


def control_debt(files):
    """(suites with no control, entries on the list that no longer belong there)."""
    missing, stale = [], []
    names = {f.name for f in files}
    for f in files:
        if not has_control(f) and f.name not in NO_CONTROL_YET:
            missing.append(f.name)
    for name in sorted(NO_CONTROL_YET):
        if name not in names:
            stale.append(f"{name} is on the no-control list but is not a suite here")
        elif has_control(HERE/name):
            stale.append(f"{name} has a control now — remove it from NO_CONTROL_YET")
    return missing, stale


def main(argv):
    files = [Path(a) for a in argv] or sorted(HERE.glob("test_*.py"))
    bad = []
    for f in files:
        bad += scan(f)
    if bad:
        print(f"✗ ran_everything: {len(bad)} check(s) that cannot have run\n")
        for b in bad:
            print(f"  - {b}")
        return 1

    missing, stale = control_debt(files)
    if missing or stale:
        print(f"✗ ran_everything: control coverage (PLAN 2.11)\n")
        for m in missing:
            print(f"  - {m} has no control. Every detector ships with one: plant the defect "
                  f"it is meant to catch and require the check to see it, or its green is an "
                  f"untested claim.")
        for s in stale:
            print(f"  - {s}")
        return 1

    debt = len(NO_CONTROL_YET)
    print(f"✓ ran_everything: {len(files)} suite(s), every defined check is reachable and "
          f"called; {len(files) - debt} carry a control ({debt} on the recorded list)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
