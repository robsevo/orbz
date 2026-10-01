"""Fixtures for the habit spike (PLAN 0.2): three tasks from the Dots film, generated from a seed.

Each generator returns (input, expected) where `expected` holds only the DETERMINISTIC fields —
the part a habit can be held to. The oracle here plays the user's approval: whatever the big brain
answered, the approved output is this one (a user would have corrected it to this).

`odd=True` produces inputs outside the family the habits will be taught on (another currency, a
French bill, an all-day event, an unseen phrasing…). A habit must not answer those; its guard has
to hand them back to the model. The compiler never sees odd inputs.
"""
from __future__ import annotations

import datetime as dt
import random

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# ───────────────────────────────────────────────────────────── task A: inbox digest

INBOX_RULES = """\
Sort the user's inbox into four groups. Rules, in order (the first that matches wins):
1. bills — the subject or body talks about an invoice, a bill, a statement or a payment, AND the
   body states an amount in dollars (like $1,234.56) AND a due date. For each bill give the vendor
   (the sender's display name), the amount as a number, currency "USD", and the due date as
   YYYY-MM-DD (a due date written without a year is in the year of `today`).
2. newsletters — the body contains the word "unsubscribe" (any case).
3. needs_reply — the sender is a person (the address is not noreply@, no-reply@ or notifications@)
   and the body asks a question (contains "?").
4. fyi — everything else.
Order needs_reply, newsletters and fyi by date (oldest first, then id); order bills by due date
(then id). counts = the size of each group plus total_due = the sum of the bill amounts rounded
to 2 decimals."""

VENDORS = [("Hydro Ottawa", "billing@hydroottawa.example"), ("Bell", "ebill@bell.example"),
           ("Figma", "billing@figma.example"), ("Linode", "invoices@linode.example"),
           ("City Water", "accounts@citywater.example"), ("Rogers", "billing@rogers.example"),
           ("Notion", "billing@notion.example"), ("Desjardins", "statements@desjardins.example")]
PEOPLE = [("Maya Chen", "maya@chenstudio.example"), ("Omar Haddad", "omar.haddad@mailbox.example"),
          ("Priya Nair", "priya@nairdesign.example"), ("Luc Tremblay", "luc.t@courriel.example"),
          ("Ana Souza", "ana@souza.example"), ("Ben Okafor", "ben@okafor.example")]
LISTS = [("The Pragmatic Engineer", "newsletter@pragmaticengineer.example"),
         ("Product Hunt Daily", "news@producthunt.example"), ("Dense Discovery", "hello@densediscovery.example"),
         ("Stratechery", "email@stratechery.example")]
NOTIFS = [("GitHub", "notifications@github.example"), ("Shopify", "no-reply@shopify.example"),
          ("Canada Post", "noreply@canadapost.example")]
QUESTIONS = ["Can you send me the final files by Thursday?", "Are you free for a call tomorrow at 2?",
             "Could you take a look at the new homepage draft?", "Did the client sign the contract yet?",
             "Would you be up for speaking at our meetup next month?", "Can we move our review to Friday?"]
FYIS = ["FYI, the deploy finished and everything is green.", "Just letting you know the files are uploaded.",
        "Thanks again for yesterday, it was great.", "Your order has shipped and will arrive Friday."]


def _money(rng: random.Random) -> float:
    return round(rng.uniform(18, 2400), 2)


def _fmt_usd(x: float) -> str:
    return f"${x:,.2f}"


def _date_long(d: dt.date) -> str:
    return f"{MONTHS[d.month - 1]} {d.day}, {d.year}"


def gen_inbox(rng: random.Random, odd: bool = False):
    today = dt.date(2026, 10, 1) + dt.timedelta(days=rng.randrange(0, 60))
    emails, n = [], rng.randint(8, 14)
    odd_at = rng.randrange(n) if odd else -1
    for i in range(n):
        eid = f"m{i + 1:02d}"
        when = dt.datetime.combine(today - dt.timedelta(days=rng.randrange(0, 4)), dt.time(rng.randrange(7, 22), rng.choice([0, 15, 30, 45])))
        kind = rng.choices(["bill", "newsletter", "reply", "fyi"], [3, 3, 3, 2])[0]
        if i == odd_at:
            kind = "odd"
        if kind in ("bill", "odd"):
            name, addr = rng.choice(VENDORS)
            amt = _money(rng)
            due = today + dt.timedelta(days=rng.randrange(3, 40))
            if kind == "odd":
                body = rng.choice([
                    f"Montant dû : {amt:,.2f} $ avant le {due.day} octobre. Merci de votre confiance.".replace(",", " ").replace(".", ",", 1),
                    f"Statement total EUR {amt:,.2f} — payable by {due.day:02d}/{due.month:02d}/{due.year}.".replace(",", "X").replace(".", ",").replace("X", "."),
                    f"Your balance of {amt:,.2f} CAD is due {due.isoformat()}. Pay online any time.",
                ])
                subject = rng.choice(["Votre facture est prête", "Statement available", "Balance reminder"])
            else:
                t = rng.randrange(3)
                if t == 0:
                    body = f"Hello,\nYour invoice is ready. Amount due: {_fmt_usd(amt)}. Due date: {_date_long(due)}.\nThanks for your business."
                elif t == 1:
                    body = f"Hi there, your statement is available. Your total is {_fmt_usd(amt)} and is due on {due.isoformat()}."
                else:
                    body = f"Reminder: please pay {_fmt_usd(amt)} by {MONTHS[due.month - 1]} {due.day}. Questions? Reply to this email."
                subject = rng.choice(["Your invoice is ready", "Bill ready: monthly statement", "Payment reminder", "Your statement"])
        elif kind == "newsletter":
            name, addr = rng.choice(LISTS)
            subject = rng.choice(["This week in tech", "Issue #214", "5 things worth reading", "The weekly digest"])
            body = f"Here is this week's issue. Is AI eating software? Read more inside.\n\nUnsubscribe here: https://{addr.split('@')[1]}/u"
        elif kind == "reply":
            name, addr = rng.choice(PEOPLE)
            subject = rng.choice(["Quick question", "Re: project", "Tomorrow", "Following up"])
            body = f"Hi Sam,\n{rng.choice(QUESTIONS)}\n\n{name.split()[0]}"
        else:
            name, addr = rng.choice(PEOPLE + NOTIFS)
            subject = rng.choice(["Update", "Done", "Shipping update", "Notes"])
            body = rng.choice(FYIS)
        emails.append({"id": eid, "from_name": name, "from_addr": addr, "subject": subject,
                       "date": when.isoformat(timespec="minutes"), "body": body})
    inp = {"today": today.isoformat(), "user": "sam@rivera.example", "emails": emails}
    return inp, inbox_oracle(inp)


import re as _re

_BILL_WORDS = _re.compile(r"invoice|bill|statement|payment|pay\b", _re.I)
_USD = _re.compile(r"\$([0-9][0-9,]*\.[0-9]{2})")
_DUE = [
    (_re.compile(r"Due date: ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})"), "mdy"),
    (_re.compile(r"due on (\d{4}-\d{2}-\d{2})"), "iso"),
    (_re.compile(r"by ([A-Z][a-z]{2}) (\d{1,2})\b(?!,)"), "md"),
]


def _bill(email: dict, today: dt.date):
    text = email["subject"] + "\n" + email["body"]
    if not _BILL_WORDS.search(text):
        return None
    m = _USD.search(email["body"])
    if not m:
        return None
    due = None
    for pat, kind in _DUE:
        d = pat.search(email["body"])
        if not d:
            continue
        if kind == "iso":
            due = d.group(1)
        else:
            mon = MONTHS.index(d.group(1)) + 1
            year = int(d.group(3)) if kind == "mdy" else today.year
            due = dt.date(year, mon, int(d.group(2))).isoformat()
        break
    if not due:
        return None
    return {"id": email["id"], "vendor": email["from_name"], "amount": float(m.group(1).replace(",", "")),
            "currency": "USD", "due": due}


def inbox_oracle(inp: dict) -> dict:
    today = dt.date.fromisoformat(inp["today"])
    groups = {"needs_reply": [], "bills": [], "newsletters": [], "fyi": []}
    for e in inp["emails"]:
        b = _bill(e, today)
        if b:
            groups["bills"].append(b)
        elif "unsubscribe" in e["body"].lower():
            groups["newsletters"].append(e)
        elif not _re.match(r"(noreply|no-reply|notifications)@", e["from_addr"]) and "?" in e["body"]:
            groups["needs_reply"].append(e)
        else:
            groups["fyi"].append(e)
    by_date = lambda e: (e["date"], e["id"])  # noqa: E731
    out = {
        "needs_reply": [e["id"] for e in sorted(groups["needs_reply"], key=by_date)],
        "bills": sorted(groups["bills"], key=lambda b: (b["due"], b["id"])),
        "newsletters": [e["id"] for e in sorted(groups["newsletters"], key=by_date)],
        "fyi": [e["id"] for e in sorted(groups["fyi"], key=by_date)],
    }
    out["counts"] = {"needs_reply": len(out["needs_reply"]), "bills": len(out["bills"]),
                     "newsletters": len(out["newsletters"]), "fyi": len(out["fyi"]),
                     "total_due": round(sum(b["amount"] for b in out["bills"]), 2)}
    return out


# ───────────────────────────────────────────────────────────── task B: invoice from a thread

INVOICE_RULES = """\
Draft the invoice the client just agreed to in this email thread.
- invoice_no: the input's next_invoice_no. issue_date: today. currency: "USD".
- client: the name and email of the person who agreed (the client, not "me").
- items: every piece of work agreed, in the order first mentioned, as {desc, qty, unit_price}.
  desc is the service exactly as written in the thread, in lowercase. "N hours of X at $R/hr" is
  qty N at R; "X for a flat $P" is qty 1 at P; "N <things> of X at $R each" is qty N at R.
- subtotal = the sum of qty * unit_price. tax = subtotal * the tax rate if the thread says
  "plus N% HST" (else 0). total = subtotal + tax. Round money to 2 decimals.
- due_date = issue_date + the "net N" days if the thread states them, else 30 days."""

SERVICES = ["logo design", "brand guidelines", "landing page design", "copywriting", "ux audit",
            "illustration", "motion graphics", "photo retouching", "seo review", "user interviews"]
UNITS = [("rounds", "revision"), ("pages", "page layout"), ("screens", "screen design"), ("posts", "social post")]


def gen_invoice(rng: random.Random, odd: bool = False):
    today = dt.date(2026, 10, 1) + dt.timedelta(days=rng.randrange(0, 60))
    client_name, client_email = rng.choice(PEOPLE)
    me = {"name": "Sam Rivera", "email": "sam@rivera.example"}
    picks = rng.sample(SERVICES, rng.randint(1, 3))
    phrases, items = [], []
    for svc in picks:
        t = rng.randrange(3)
        if t == 0:
            q, r = rng.randint(2, 30), rng.choice([65, 75, 85, 95, 110, 120, 140])
            phrases.append(f"{q} hours of {svc} at ${r}/hr")
            items.append({"desc": svc, "qty": q, "unit_price": float(r)})
        elif t == 1:
            p = rng.choice([250, 400, 600, 850, 1200, 1500, 2200])
            phrases.append(f"{svc} for a flat ${p:,}")
            items.append({"desc": svc, "qty": 1, "unit_price": float(p)})
        else:
            unit, _ = rng.choice(UNITS)
            q, r = rng.randint(2, 8), rng.choice([40, 60, 75, 90, 150])
            phrases.append(f"{q} {unit} of {svc} at ${r} each")
            items.append({"desc": svc, "qty": q, "unit_price": float(r)})
    tax_rate = rng.choice([0, 0, 13, 15])
    net = rng.choice([None, None, 15, 45])
    terms = (f" plus {tax_rate}% HST" if tax_rate else "") + (f", net {net}" if net else "")
    if odd:
        odd_phrase = rng.choice([
            "a retainer of 20h per month at 90 CAD",
            "€500 for the logo and €300 for the cards",
            "a per-word rate of 0.12 for 3000 words",
            "half now and half on delivery, 2,000 total",
        ])
        # Half the time the unfamiliar term hides behind a familiar one: a habit that parses only
        # what it knows would bill the first item and silently drop the rest.
        phrases = [phrases[0], odd_phrase] if rng.random() < 0.5 else [odd_phrase]
    work = ", ".join(phrases[:-1]) + (" and " if len(phrases) > 1 else "") + phrases[-1]
    thread = [
        {"from_name": client_name, "from_addr": client_email, "date": (today - dt.timedelta(days=3)).isoformat(),
         "body": f"Hi Sam, we'd love your help with the rebrand. What would it cost?"},
        {"from_name": me["name"], "from_addr": me["email"], "date": (today - dt.timedelta(days=2)).isoformat(),
         "body": f"Happy to help! I'd propose {work}{terms}. Does that work?"},
        {"from_name": client_name, "from_addr": client_email, "date": (today - dt.timedelta(days=1)).isoformat(),
         "body": rng.choice(["Sounds great, let's go ahead.", "Perfect — agreed. Please send the invoice.",
                             "Works for us. Go for it!"])},
    ]
    inp = {"today": today.isoformat(), "me": me, "next_invoice_no": f"INV-{rng.randint(10, 999):04d}", "thread": thread}
    if odd:
        return inp, None  # outside the family: no oracle a habit could be held to
    sub = round(sum(i["qty"] * i["unit_price"] for i in items), 2)
    tax = round(sub * tax_rate / 100, 2)
    exp = {"invoice_no": inp["next_invoice_no"], "client": {"name": client_name, "email": client_email},
           "items": items, "subtotal": sub, "tax": tax, "total": round(sub + tax, 2), "currency": "USD",
           "issue_date": today.isoformat(), "due_date": (today + dt.timedelta(days=net or 30)).isoformat()}
    return inp, exp


# ───────────────────────────────────────────────────────────── task C: calendar clash

CALENDAR_RULES = """\
A new meeting request arrived. Find what it clashes with and offer alternatives.
- Times are ISO 8601 with a -04:00 offset. Working hours are 09:00-17:00, Monday to Friday.
- clashes: ids of existing events that overlap the new event (touching end-to-start is not an
  overlap), ordered by start time.
- alternatives: if there is a clash, the first 3 free slots with the same duration as the new
  event, starting on a :00 or :30 boundary, inside working hours, that overlap no event, searching
  forward from the new event's start (later the same day first, then the next working days).
  Each slot is {start, end} in the same ISO format. If there is no clash, alternatives is []."""

TITLES = ["Standup", "Design review", "Client call", "1:1 with Omar", "Lunch", "Focus block", "Planning",
          "Interview", "Demo prep", "Sync with Maya"]


def _iso(t: dt.datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:00-04:00")


def gen_calendar(rng: random.Random, odd: bool = False):
    monday = dt.date(2026, 10, 5) + dt.timedelta(weeks=rng.randrange(0, 8))
    events, eid = [], 1
    for d in range(5):
        day = monday + dt.timedelta(days=d)
        t = dt.datetime.combine(day, dt.time(9, 0))
        while True:
            t += dt.timedelta(minutes=30 * rng.randrange(0, 4))
            dur = 30 * rng.randint(1, 4)
            if t.time() >= dt.time(16, 30) or t + dt.timedelta(minutes=dur) > dt.datetime.combine(day, dt.time(17, 0)):
                break
            if rng.random() < 0.55:
                events.append({"id": f"e{eid}", "title": rng.choice(TITLES), "start": _iso(t), "end": _iso(t + dt.timedelta(minutes=dur))})
                eid += 1
            t += dt.timedelta(minutes=dur)
    day = monday + dt.timedelta(days=rng.randrange(0, 5))
    start = dt.datetime.combine(day, dt.time(rng.randrange(9, 16), rng.choice([0, 30])))
    dur = 30 * rng.randint(1, 3)
    new = {"title": "Kickoff with Acme", "start": _iso(start), "end": _iso(start + dt.timedelta(minutes=dur)),
           "attendees": ["sam@rivera.example", "jo@acme.example"]}
    if odd:
        kind = rng.randrange(3)
        if kind == 0:
            events.append({"id": f"e{eid}", "title": "Offsite", "all_day": True, "date": day.isoformat()})
        elif kind == 1:
            new["start"] = start.strftime("%Y-%m-%dT%H:%M:00Z")
            new["end"] = (start + dt.timedelta(minutes=dur)).strftime("%Y-%m-%dT%H:%M:00Z")
        else:
            sat = monday + dt.timedelta(days=5)
            s2 = dt.datetime.combine(sat, dt.time(10, 0))
            new["start"], new["end"] = _iso(s2), _iso(s2 + dt.timedelta(minutes=dur))
    inp = {"timezone": "America/Toronto", "work_hours": ["09:00", "17:00"], "events": events, "new_event": new}
    return inp, (None if odd else calendar_oracle(inp))


def calendar_oracle(inp: dict) -> dict:
    p = lambda s: dt.datetime.fromisoformat(s)  # noqa: E731
    ns, ne = p(inp["new_event"]["start"]), p(inp["new_event"]["end"])
    evs = sorted(inp["events"], key=lambda e: (e["start"], e["id"]))
    clashes = [e["id"] for e in evs if p(e["start"]) < ne and ns < p(e["end"])]
    alts = []
    if clashes:
        dur = ne - ns
        t = ns
        # round up to the next :00/:30
        if t.minute % 30 or t.second:
            t = t.replace(minute=(t.minute // 30) * 30, second=0) + dt.timedelta(minutes=30)
        while len(alts) < 3:
            day_open = t.replace(hour=9, minute=0)
            day_close = t.replace(hour=17, minute=0)
            if t.weekday() >= 5 or t + dur > day_close:
                nxt = (t + dt.timedelta(days=1)).replace(hour=9, minute=0)
                t = nxt
                continue
            if t < day_open:
                t = day_open
                continue
            end = t + dur
            if all(not (p(e["start"]) < end and t < p(e["end"])) for e in evs):
                alts.append({"start": _iso(t), "end": _iso(end)})
            t += dt.timedelta(minutes=30)
    return {"clashes": clashes, "alternatives": alts}


# ───────────────────────────────────────────────────────────── registry

SCHEMAS = {
    "inbox": '{"needs_reply": ["<email id>", ...], "bills": [{"id": "<email id>", "vendor": "<sender display name>", '
             '"amount": <number>, "currency": "USD", "due": "YYYY-MM-DD"}, ...], "newsletters": ["<email id>", ...], '
             '"fyi": ["<email id>", ...], "counts": {"needs_reply": <int>, "bills": <int>, "newsletters": <int>, '
             '"fyi": <int>, "total_due": <number>}, "headline": "<one sentence>"}',
    "invoice": '{"invoice_no": "<id>", "client": {"name": "<name>", "email": "<email>"}, "items": [{"desc": "<service>", '
               '"qty": <number>, "unit_price": <number>}, ...], "subtotal": <number>, "tax": <number>, "total": <number>, '
               '"currency": "USD", "issue_date": "YYYY-MM-DD", "due_date": "YYYY-MM-DD", "cover_note": "<short email>"}',
    "calendar": '{"clashes": ["<event id>", ...], "alternatives": [{"start": "<ISO 8601 with -04:00>", '
                '"end": "<ISO 8601 with -04:00>"}, ...], "message": "<short note>"}',
}

TASKS = {
    "inbox": {"gen": gen_inbox, "rules": INBOX_RULES, "fields": ["needs_reply", "bills", "newsletters", "fyi", "counts"],
              "fuzzy": {"headline": "one friendly sentence summing up the inbox for the user"}},
    "invoice": {"gen": gen_invoice, "rules": INVOICE_RULES,
                "fields": ["invoice_no", "client", "items", "subtotal", "tax", "total", "currency", "issue_date", "due_date"],
                "fuzzy": {"cover_note": "a short friendly email to the client that goes with the invoice"}},
    "calendar": {"gen": gen_calendar, "rules": CALENDAR_RULES, "fields": ["clashes", "alternatives"],
                 "fuzzy": {"message": "a short polite note proposing the alternatives (or confirming if no clash)"}},
}


def instance(task: str, seed: int, n: int, odd: bool = False):
    """The n-th instance of a task under a seed. Same arguments, same instance, always."""
    rng = random.Random(f"{task}:{seed}:{n}:{'odd' if odd else 'ok'}")
    return TASKS[task]["gen"](rng, odd=odd)
