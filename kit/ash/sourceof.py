#!/usr/bin/env python3
"""sourceof — where a name's code really lives, for the suites that read, load or patch source.

PLAN 9.3 / SP.7k. A module that re-exports names from another (`from browserservice import
show, _launch`) is a SHIM, and a shim is three different things to a suite:

  * its TEXT is not the code — a check that greps `show.py` for the ASH_NO_SHOW guard, or
    slices `browser.py` between two `def`s, goes blind or raises on a file of imports;
  * LOADED BY PATH it hands back the real module's functions, which read the real module's
    globals — so `mod._wp = fake` on the loaded copy reaches nothing, and the real window
    closer runs against the real desk;
  * PATCHED it reaches only callers that read the name through the shim at call time.

So a suite asks here, by module and name, for the module that DEFINES the name, and gets the
right answer before a move and after it without changing a line. Everything is read with `ast`
from the files under `here`; nothing here imports the module it describes, except `module()`,
which exists to be patched.
"""
import ast
import re
import importlib
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _parse(mod, here):
    p = Path(here)/f"{mod}.py"
    try:
        return ast.parse(p.read_text())
    except (OSError, SyntaxError):
        return None


def _top(tree):
    """Module-level statements, looking inside top-level `try`/`if` blocks (browser.py binds
    `_stamped` in a `try`), never inside a function or class."""
    out, todo = [], list(tree.body if tree else [])
    while todo:
        n = todo.pop(0)
        out.append(n)
        if isinstance(n, ast.Try):
            todo[:0] = n.body + [x for h in n.handlers for x in h.body] + n.orelse + n.finalbody
        elif isinstance(n, ast.If):
            todo[:0] = n.body + n.orelse
    return out


def _binding(tree, name):
    """How the module binds `name` at top level: ('def', node), ('from', module), or None."""
    found = None
    for n in _top(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.name == name:
            return ("def", n)
        if isinstance(n, (ast.Assign, ast.AnnAssign)):
            targets = n.targets if isinstance(n, ast.Assign) else [n.target]
            if any(isinstance(x, ast.Name) and x.id == name
                   for t in targets for x in ast.walk(t)):
                return ("def", n)
        if isinstance(n, ast.Import) and any((a.asname or a.name).split(".")[0] == name
                                             for a in n.names):
            return ("def", n)
        if isinstance(n, ast.ImportFrom) and n.module and n.level == 0:
            for a in n.names:
                if (a.asname or a.name) == name:
                    found = found or ("from", n.module, a.name)
    return found


def home(mod, name, here=None):
    """The module that DEFINES `name` as reached from `mod`, following every `from X import`
    re-export into a sibling module, however deep. Raises LookupError when nothing binds it —
    a reader that cannot find its code must say so, not read an empty string."""
    here = HERE if here is None else here
    seen = []
    while mod not in seen:
        seen.append(mod)
        b = _binding(_parse(mod, here), name)
        if b is None:
            raise LookupError(f"{name!r} is not bound in {' -> '.join(seen)}")
        if b[0] == "def":
            return mod
        _kind, src, orig = b
        if not (Path(here)/f"{src}.py").is_file():
            return mod                       # bound from outside this tree: this is its home
        mod, name = src, orig
    raise LookupError(f"re-export cycle: {' -> '.join(seen)}")


def path(mod, name, here=None):
    here = HERE if here is None else here
    return Path(here)/f"{home(mod, name, here)}.py"


def text(mod, name, here=None):
    """The whole source of the module that defines `name`."""
    here = HERE if here is None else here
    return path(mod, name, here).read_text()


def segment(mod, name, here=None):
    """The source of `name`'s own definition — a top-level def, class or assignment, or a
    METHOD of a top-level class (`Ashd.page_context`) — in the module that defines it. A method
    is found where it is written; a re-exported function is followed to its home."""
    here = HERE if here is None else here
    try:
        where = home(mod, name, here)
    except LookupError:
        where = mod                          # a method is not a module-level binding
    src = (Path(here)/f"{where}.py").read_text()
    tree = ast.parse(src)
    b = _binding(tree, name)
    if b and b[0] == "def" and not isinstance(b[1], (ast.Import, ast.ImportFrom)):
        return ast.get_source_segment(src, b[1])
    for c in tree.body:
        if isinstance(c, ast.ClassDef):
            for n in c.body:
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name:
                    return ast.get_source_segment(src, n)
    raise LookupError(f"no definition of {name!r} in {where}.py")


def module(mod, name, here=None):
    """The imported module that defines `name` — the one to PATCH when the code under test
    reads it as its own global."""
    here = HERE if here is None else here
    return importlib.import_module(home(mod, name, here))


def code_files(mod, here=None):
    """`mod.py`, plus the home of every function or class it re-exports: the files a scanner
    must read to see all of the code that answers to `mod`'s name."""
    here = HERE if here is None else here
    out = [Path(here)/f"{mod}.py"]
    tree = _parse(mod, here)
    for n in _top(tree):
        if not (isinstance(n, ast.ImportFrom) and n.module and n.level == 0
                and (Path(here)/f"{n.module}.py").is_file()):
            continue
        for a in n.names:
            try:
                h = home(n.module, a.name, here)
            except LookupError:
                continue
            b = _binding(_parse(h, here), a.name)
            if b and b[0] == "def" and isinstance(b[1], (ast.FunctionDef, ast.AsyncFunctionDef,
                                                         ast.ClassDef)):
                p = Path(here)/f"{h}.py"
                if p not in out:
                    out.append(p)
    return out


# ── THE TURN, AS IT RUNS (PLAN 18.1, tenth extraction) ─────────────────────────────────────
# `Ashd._handle` hands its deterministic verbs to `verbs.dispatch` in ONE statement:
#     if verbs.dispatch(self, text, gen) is not verbs.NOT_MINE:
#         return
# and `dispatch` is the old block unchanged, ending every branch in `return` and falling off
# the end only to go on. So putting its body back where that statement stands is the turn
# exactly as it runs — a `return` in the body ends `_handle` just as it ends `dispatch` — and
# the suites that hold the ORDER of the turn's verbs (orbctl before the day verbs, the offer
# before the learning verbs, all of it before the command table, a lesson and the terminal)
# read one text in which that order is written, instead of each stitching two files together.
# It fails in the safe direction: if the call or the function cannot be found, the text comes
# back UNCHANGED, the verbs are absent from `_handle`, and every reader goes red.
DISPATCH_CALL = ("        if verbs.dispatch(self, text, gen) is not verbs.NOT_MINE:\n"
                 "            return\n")


def turn_source(here=None):
    """ashd.py's text with `_handle`'s call into `verbs.dispatch` replaced by its body — read from
    `daemon_source`, so a `_handle` that is itself a delegate is read where it lives (PLAN 18.1)."""
    here = Path(here or HERE)
    src = daemon_source(here, only={"_handle"})   # the turn itself; its callees stay as ashd writes them
    try:
        vsrc = (here/"verbs.py").read_text()
    except OSError:
        return src
    fn = next((n for n in (_parse("verbs", here) or ast.Module(body=[])).body
               if isinstance(n, ast.FunctionDef) and n.name == "dispatch"), None)
    if fn is None or DISPATCH_CALL not in src or not fn.body:
        return src
    body = fn.body
    if isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
        body = body[1:]                                  # the docstring
    if body and isinstance(body[-1], ast.Return) and ast.unparse(body[-1]) == "return NOT_MINE":
        body = body[:-1]                                 # the one line that is not the old block
    if not body:
        return src
    lines = vsrc.splitlines(keepends=True)
    # From the first statement's first line (or the comment block right above it) to the last
    # statement's end — comments included, because several readers slice by a comment.
    start = body[0].lineno - 1
    while start > fn.body[0].end_lineno and lines[start - 1].strip().startswith("#"):
        start -= 1
    block = "".join(lines[start:body[-1].end_lineno])
    import re
    block = "".join(("    " + l if l.strip() else l) for l in block.splitlines(keepends=True))
    block = re.sub(r"\bowner\b", "self", block)
    return src.replace(DISPATCH_CALL, block, 1)

if __name__ == "__main__":
    import sys
    if len(sys.argv) != 3:
        print("usage: sourceof.py <module> <name>   — which file defines it", file=sys.stderr)
        sys.exit(2)
    print(path(sys.argv[1], sys.argv[2]))


def daemon_source(here=None, only=None):
    """ashd.py's text as it would read with every one-call DELEGATE inlined again (PLAN 18.1).

    A delegate is an `Ashd` method whose body is `return mod.fn(self, ...)` (after an optional
    docstring), where `mod.py` sits beside `ashd.py` and defines `fn` with `owner` as its first
    parameter. Its lines are replaced by `fn`'s own source, re-indented to the method and with the
    NAME token `owner` turned back into `self`, under the method's name. The suites that read the
    daemon as TEXT (a phrase, a call, an order of calls) then see the code where it runs, wherever
    an extraction moved it — and a method that is not a delegate is left exactly as written, so
    nothing that did not move reads differently."""
    import io
    import textwrap
    import tokenize
    here = Path(here or HERE)
    src = (here/"ashd.py").read_text()
    tree = ast.parse(src)
    lines = src.splitlines(keepends=True)
    cls = next((n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Ashd"), None)
    if cls is None:
        return src
    edits = []
    for m in cls.body:
        if not isinstance(m, ast.FunctionDef) or (only is not None and m.name not in only):
            continue            # `only`: inline just these methods, leave every other delegate as written
        body = list(m.body)
        if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant) \
                and isinstance(body[0].value.value, str):
            body = body[1:]
        # `return mod.fn(self, ...)` or a bare `mod.fn(self, ...)` — both are one call and nothing else
        if len(body) != 1 or not isinstance(body[0], (ast.Return, ast.Expr)) \
                or not isinstance(body[0].value, ast.Call):
            continue
        call = body[0].value
        f = call.func
        if not (isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name) and call.args
                and isinstance(call.args[0], ast.Name) and call.args[0].id == "self"):
            continue
        mod, fn = f.value.id, f.attr
        p = here/f"{mod}.py"
        if not p.exists():
            continue
        msrc = p.read_text()
        mtree = ast.parse(msrc)
        target = next((n for n in mtree.body if isinstance(n, ast.FunctionDef) and n.name == fn
                       and n.args.args and n.args.args[0].arg == "owner"), None)
        if target is None:
            continue
        seg = ast.get_source_segment(msrc, target)
        toks = []
        for t in tokenize.generate_tokens(io.StringIO(seg).readline):
            if t.type == tokenize.NAME and t.string == "owner":
                t = t._replace(string="self")
            elif t.type == tokenize.STRING and re.match(r"[rRbBuU]*[fF]", t.string):
                # Before 3.12 an f-string is ONE token, so `{owner.x}` inside it is not a NAME. Rename
                # inside the replacement fields only — the literal text of the string is left alone.
                t = t._replace(string=re.sub(r"\{[^{}]*\}",
                                             lambda m: re.sub(r"(?<![\w.])owner\b", "self", m.group(0)),
                                             t.string))
            toks.append(t)
        seg = tokenize.untokenize(toks)
        seg = f"def {m.name}(" + seg[len(f"def {fn}("):]
        seg = textwrap.indent(textwrap.dedent(seg), " " * m.col_offset)
        edits.append((m.lineno - 1, m.end_lineno, seg.rstrip("\n") + "\n"))
    for a, b, seg in sorted(edits, reverse=True):
        lines[a:b] = [seg]
    return "".join(lines)
