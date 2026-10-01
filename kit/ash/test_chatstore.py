#!/usr/bin/env python3
"""Chats, kept and named by a rule (PLAN F.40). Run: orb/daemon/.venv/bin/python orb/daemon/test_chatstore.py

  CS.1  turns land in the current chat, in order, and the file is whole JSON
  CS.2  New chat starts a fresh file; the old one stays whole; an empty New chat leaves no file
  CS.3  names: first lines → `<Area> · <Topic>` (greeting, "can you", "please", "my" dropped;
        capitalised; ≤ 6 words then …), the same line always the same name, a greeting-only start
        is renamed by the next thing said, the weather before the calendar
  CS.4  grouping by day: today / yesterday / this week / earlier, around midnight
  CS.5  an id that is not the store's own shape is refused — nothing outside the folder is read,
        written or deleted
  CS.6  nothing is written until the live daemon enables it (F.33's rule); the session log hands
        its entries on to the store only then
  CS.7  rename (owner, 2026-09-27: "option to rename chat"): the current chat and a saved one take the
        owner's name, marked `named`; the naming rule never overwrites it; control characters and
        over-long names are cleaned, an empty one refused, and an id outside the store refused
  CS.0  CONTROL: a store that asks a model for the name (planted: `name()` replaced by a call) is
        caught by CS.3's same-line-same-name and no-network checks
"""
# ASH_TIER: product
import json
import os
import socket
import sys
import tempfile
import time
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
TMP = Path(tempfile.mkdtemp(prefix="chats-"))
os.environ["ASH_STATE_HOME"] = str(TMP)
import chatstore  # noqa: E402
import sessionlog  # noqa: E402

FAIL = []


def ok(cond, label):
    print(f"  {'PASS' if cond else 'FAIL'}  {label}")
    if not cond:
        FAIL.append(label)


D = TMP/"chats-fixture"
NOW = 1_790_400_000.0

print("── CS.1 / CS.2  the current chat, and New chat")
chatstore.new_chat(now=NOW, d=D)
ok(not D.exists() or not list(D.iterdir()), "CS.2 an empty New chat leaves no file")
chatstore.append({"who": "you", "how": "said", "text": "hey ash can you check my email", "t": NOW}, d=D)
chatstore.append({"who": "ash", "text": "12 emails since yesterday.", "t": NOW + 3}, d=D)
first = chatstore.current()
files = sorted(D.iterdir())
ok(len(files) == 1 and json.loads(files[0].read_text())["entries"][1]["text"] == "12 emails since yesterday.",
   f"CS.1 turns land in the current chat, in order, whole: {[f.name for f in files]}")
ok(first["title"] == "Mail · Check email" and first["area"] == "Mail", f"CS.3 named by the rule: {first['title']}")
chatstore.new_chat(now=NOW + 60, d=D)
chatstore.append({"who": "you", "how": "typed", "text": "could you fix the build please", "t": NOW + 61}, d=D)
files = sorted(D.iterdir())
old = json.loads((D/f"{first['id']}.json").read_text())
ok(len(files) == 2 and len(old["entries"]) == 2 and chatstore.current()["title"] == "Code · Fix the build",
   f"CS.2 New chat is a fresh file, the old one stays whole: {len(files)} files, old has {len(old['entries'])}")

print("── CS.3  names are a rule")
CASES = {
    "hey ash can you check my email": "Mail · Check email",
    "Could you fix the build please": "Code · Fix the build",
    "what's on tomorrow": "Calendar · What's on tomorrow",
    "what's the weather like tomorrow": "Weather · What's the weather like tomorrow",
    "teach me union find": "Lesson · Teach me union find",
    "open youtube": "Web · Open youtube",
    "add milk to my todo list": "Tasks · Add milk to todo list",
    "why is the sky blue": "Chat · Why is the sky blue",
    "Hey, Ash, I want you to write a script that renames my photos by date": "Code · Write a script that renames photos…",
    "hey ash": "Chat",
    "ok so um hi": "Chat",
    "please clean up my inbox for me": "Mail · Clean up inbox",
}
for line, want in CASES.items():
    ok(chatstore.name(line)[1] == want, f"CS.3 {line!r} → {want!r} (got {chatstore.name(line)[1]!r})")
ok(all(chatstore.name(k) == chatstore.name(k) for k in CASES), "CS.3 the same line, the same name")
chatstore.new_chat(now=NOW + 120, d=D)
chatstore.append({"who": "you", "how": "said", "text": "hey ash", "t": NOW + 121}, d=D)
chatstore.append({"who": "ash", "text": "Hi!", "t": NOW + 122}, d=D)
chatstore.append({"who": "you", "how": "said", "text": "what's on today", "t": NOW + 130}, d=D)
ok(chatstore.current()["title"] == "Calendar · What's on today",
   f"CS.3 a greeting-only start is named by the next thing said: {chatstore.current()['title']}")

print("── CS.4  grouping by day")
mid = time.mktime(time.strptime("2026-09-26 00:00:00", "%Y-%m-%d %H:%M:%S"))
g = chatstore._group
ok([g(mid + 60, mid + 3600), g(mid - 60, mid + 3600), g(mid - 3 * 86400, mid + 3600), g(mid - 9 * 86400, mid + 3600)]
   == ["Today", "Yesterday", "This week", "Earlier"], "CS.4 today / yesterday (a minute before midnight) / this week / earlier")
lst = chatstore.listing(now=NOW + 200, d=D)
ok([c["title"] for c in lst][:1] == ["Calendar · What's on today"] and all("group" in c for c in lst),
   f"CS.4 the listing is newest first, each with its group: {[c['title'] for c in lst]}")

print("── CS.5  ids are the store's own shape")
outside = TMP/"secret.json"
outside.write_text('{"x": 1}')
for bad in ("../secret", "../../etc/passwd", "20260926-161000-ab12/../../secret", "", "x.json"):
    try:
        chatstore.load(bad, d=D)
        ok(False, f"CS.5 {bad!r} is refused by load")
    except (ValueError, FileNotFoundError, OSError):
        ok(True, f"CS.5 {bad!r} is refused by load")
    try:
        chatstore.delete(bad, d=D)
        ok(False, f"CS.5 {bad!r} is refused by delete")
    except ValueError:
        ok(outside.exists(), f"CS.5 {bad!r} is refused by delete, and nothing outside is touched")

print("── CS.6  nothing written until the live daemon enables it")
real = chatstore.DIR
chatstore._enabled[0] = False
sessionlog._enabled[0] = False
sessionlog.said("from a suite", now=5.0)
chatstore.append({"who": "you", "text": "from a suite", "t": 5.0})
ok(not real.exists() or not list(real.iterdir()), "CS.6 before enable(), no chat file appears")
sessionlog.enable()
chatstore.enable()
chatstore.new_chat(now=NOW + 300)
sessionlog.said("hey ash check my email", now=NOW + 301)
ok(real.exists() and any("Check email" in f.read_text() for f in real.iterdir()),
   "CS.6 once enabled, a heard line reaches the current chat through the session log")
sessionlog._enabled[0] = chatstore._enabled[0] = False
# (cut in the Orbs kit: see kit/ash/CARRIED.md)

print("── CS.7  rename")
D7 = TMP/"chats-rename"
chatstore._cur.update(id=None, entries=[], title="New chat", area="Chat", named=False)
chatstore.new_chat(now=NOW, d=D7)
chatstore.append({"who": "you", "how": "said", "text": "hey ash", "t": NOW}, d=D7)
cid = chatstore.current()["id"]
ok(chatstore.rename(cid, "  Trip\x07 planning\n with Maggie ", d=D7) == "Trip planning with Maggie",
   "CS.7 a typed name is cleaned to one plain line")
chatstore.append({"who": "you", "how": "said", "text": "check my email", "t": NOW + 5}, d=D7)
ok(chatstore.current()["title"] == "Trip planning with Maggie" and chatstore.current().get("named"),
   f"CS.7 the rule never overwrites a name the owner gave: {chatstore.current()['title']}")
chatstore.new_chat(now=NOW + 60, d=D7)
ok(chatstore.rename(cid, "Old trip", d=D7) == "Old trip"
   and json.loads((D7/f"{cid}.json").read_text())["title"] == "Old trip",
   "CS.7 a saved chat (not the current one) is renamed on disk")
ok([c for c in chatstore.listing(d=D7) if c["id"] == cid][0]["named"] is True, "CS.7 the listing says it was named by the owner")
chatstore.append({"who": "you", "how": "said", "text": "what's on today", "t": NOW + 61}, d=D7)
ok(chatstore.current()["title"] == "Calendar · What's on today" and not chatstore.current().get("named"),
   f"CS.7 a NEW chat after a rename is named by the rule again: {chatstore.current()['title']}")
ok(len(chatstore.clean_title("x" * 200)) == 60, "CS.7 a name is at most 60 characters")
for bad_id, title in (("../evil", "x"), (cid, "   ")):
    try:
        chatstore.rename(bad_id, title, d=D7)
        ok(False, f"CS.7 refused: {bad_id!r} / {title!r}")
    except ValueError:
        ok(True, f"CS.7 refused: {bad_id!r} / {title!r}")

print("── CS.0  CONTROL")
src = (HERE/"chatstore.py").read_text()
old = '    area = next((a for a, rx in AREAS if re.search(rx, t, re.I)), "Chat")\n'
if src.count(old) != 1:
    ok(False, "CS.0 CONTROL: the rule the plant replaces has moved")
else:
    m = types.ModuleType("chatstore_planted")
    exec(compile(src.replace(old, old + '    import socket as _s; _s.create_connection(("127.0.0.1", 9), 0.2)  # "ask a model"\n', 1),
                 "chatstore_planted", "exec"), m.__dict__)
    _real = socket.create_connection
    socket.create_connection = lambda *a, **k: (_ for _ in ()).throw(AssertionError("the namer reached the network"))
    try:
        try:
            m.name("check my email")
            caught = False
        except AssertionError:
            caught = True
    finally:
        socket.create_connection = _real
    ok(caught, "CS.0 CONTROL: a namer that reaches out (a model call) is caught — the rule touches no network")
    socket.create_connection = lambda *a, **k: (_ for _ in ()).throw(AssertionError("network"))
    try:
        chatstore.name("check my email")
        ok(True, "CS.0 ...and the real namer touches none")
    except AssertionError:
        ok(False, "CS.0 ...and the real namer touches none")
    finally:
        socket.create_connection = _real

import shutil  # noqa: E402
shutil.rmtree(TMP, ignore_errors=True)
if FAIL:
    print(f"\nFAIL  chatstore  ({len(FAIL)} failing)")
    raise SystemExit(1)
print("\nPASS  chatstore  (0 failing)")
