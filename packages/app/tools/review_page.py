"""The owner's screen-review page (PLAN 2.6: renders go to the owner before a UI row is ticked):
`python3 tools/review_page.py RENDERS OUT.html [ICONS]` embeds tools/shoot_home.ts's pictures (and
the app's icons) as WebP, through ImageMagick (`magick`), into one page to publish privately.
`python3 tools/review_page.py RENDERS OUT.html --new` is the 10-02 batch (tools/shoot_new.ts), with
every voice's sample to listen to (public/voices, what Whisper heard in each)."""
import json
import re
import base64
import subprocess
import sys
import tempfile
from html import escape
from pathlib import Path

renders, out = Path(sys.argv[1]), Path(sys.argv[2])

SECTIONS = [
    ("morning", "This morning, and a promotion", "PLAN 3.5, 3.8",
     "The top of Notifications: yesterday's split (by habit, his own brain, the big brain), what it cost, what Dana learned and the habit the night made, each with Take back. Below it, Dana is ready for Mid, with Promote and Not yet.",
     ["morning-desk", "morning-phone"]),
    ("schedule", "A new schedule", "PLAN 2.4",
     "On the calendar: who, what, what to do each time, and when. The line under the days is the home's own words for the pattern it will run, with the next runs.",
     ["schedule-editor-desk", "schedule-editor-phone"]),
    ("settings", "Brains, devices, passkeys", "PLAN 1.11, 2.7",
     "Settings on a home: the brain order as it stands, then your devices with Add a phone pressed (the QR code is a pairing link, good once for five minutes), then passkeys.",
     ["settings-desk", "settings-phone"]),
    ("memory", "Memory updated", "PLAN 2.4",
     "A lesson kept shows in the chat as a chip under the message that taught it.",
     ["memory-chip-desk", "memory-chip-phone"]),
    ("mood", "Waiting for you", "PLAN 2.3",
     "Gus has a card waiting: his dot in the side menu is amber, his line says so, and the office's orb wears it.",
     ["mood-waiting-desk", "mood-waiting-phone"]),
    ("signin", "Sign in with your passkey", "PLAN 2.7",
     "A browser that is not signed in yet: a pairing link, or your passkey.",
     ["passkey-signin-desk", "passkey-signin-phone"]),
    ("icons", "The app's icon", "PLAN 2.7",
     "Drawn by the orb himself, for installing the app: 192 and 512, and the maskable one (him inside the safe zone a phone crops to).",
     ["icon:orbs-192", "icon:orbs-512", "icon:orbs-maskable-512"]),
]


NEW = "--new" in sys.argv
if NEW:
    SECTIONS = [
        ("day", "Your day, and the notice that was squeezed", "PLAN 4.5, 2.11",
         "Notifications opens on your day in Ash's words: what is on, the bill, the two things that clash (5 minutes to get from the Standup to the Dentist across town; Lunch and the review overlapping), and the reply you owe. Under it, Dana's promotion: on a phone the words keep the card's width and the buttons sit under them.",
         ["your-day-desk", "your-day-phone"]),
        ("settings", "Themes and your connections", "PLAN 2.1, 4.2",
         "Settings: the theme (System, or one of seven), then Connections: Connect Google, Connect Microsoft (Outlook, and the calendar Teams' meetings are in), Slack (which shows your Google or Outlook calendar), a calendar by its address, a mail account, and connectors from the catalog.",
         ["settings-connections-desk", "settings-connections-phone"]),
        ("calendar", "Your calendar's events", "PLAN 4.2",
         "Your own calendar's events on its days beside the orbs' bills and schedules, read only: changed in your calendar, not here.",
         ["calendar-events-desk", "calendar-events-phone"]),
        ("brains", "The first open asks what he thinks with", "PLAN 2.5",
         "After your name and the CEO badge: Continue with ChatGPT, a Gemini key, a local coder if you want one (open here), then Next, or Skip for now. Then you make him. The story has music from your first tap (switch at the top left).",
         ["first-open-brains-desk", "first-open-brains-phone"]),
        ("specialties", "Investor, Crypto Analyst, QA Lead", "PLAN 2.2",
         "The creator's specialties: QA Lead beside the Bug Hunter in Build; Investor and Crypto Analyst in Business, each saying he is not a financial adviser and every trade is yours (a trade always asks you).",
         ["specialty-business-desk", "specialty-business-phone"]),
        ("attach", "Give him a file", "PLAN 2.4",
         "In a chat, a file you give him lands in his workspace's from-you folder; it shows as a chip until you send.",
         ["chat-attach-desk", "chat-attach-phone"]),
        ("themes", "Five new themes", "PLAN 2.1",
         "Midnight, Forest, Sand, Rose and High contrast, beside Dark and Light; each held to the same contrast checks. On a phone, the office.",
         ["theme-midnight-phone", "theme-forest-phone", "theme-sand-phone", "theme-rose-phone", "theme-contrast-phone"]),
    ]


def webp(png: Path, width: int) -> str:
    with tempfile.TemporaryDirectory() as td:
        dst = Path(td) / "x.webp"
        subprocess.run(["magick", str(png), "-resize", f"{width}x>", "-quality", "80", str(dst)], check=True)
        return "data:image/webp;base64," + base64.b64encode(dst.read_bytes()).decode()


icons = Path(sys.argv[3]) if len(sys.argv) > 3 and not sys.argv[3].startswith("--") else None
parts = []
for key, title, row, words, shots in SECTIONS:
    figs = []
    for s in shots:
        if s.startswith("icon:"):
            if not icons:
                continue
            f = icons / f"{s[5:]}.png"
            kind, width = "icon", 512
        else:
            f = renders / f"{s}.png"
            kind, width = ("phone", 780) if s.endswith("phone") else ("desk", 1600)
        if not f.exists():
            continue
        label = s[5:] if kind == "icon" else ("Phone" if kind == "phone" else "Desk")
        figs.append(f'<figure class="{kind}"><img src="{webp(f, width)}" alt="{escape(title)}, {label}" loading="lazy"><figcaption>{escape(label)}</figcaption></figure>')
    if figs:
        phones = all(x.endswith("phone") for x in shots) and len(shots) > 2
        parts.append(f'<section id="{key}"><header><span class="row">{escape(row)}</span><h2>{escape(title)}</h2><p>{escape(words)}</p></header><div class="shots{" phones" if phones else ""}">{"".join(figs)}</div></section>')

if NEW:
    # every voice's sample, as the creator plays it, with what Whisper heard in it when it was kept
    app = Path(__file__).resolve().parent.parent
    heard = json.loads((app / "tools" / "voice_samples.json").read_text())
    spec = (app / "src" / "orb" / "spec.ts").read_text()
    names = dict(re.findall(r'(\w{2}_\w+): "([^"]+)"', spec.split("const OUR_NAMES")[1].split("};")[0]))
    names["ash"] = "Classic"
    rows = []
    for vid, h in sorted(heard.items(), key=lambda kv: (kv[0] != "ash", kv[0])):
        mp3 = app / "public" / "voices" / f"{vid}.mp3"
        if not mp3.exists():
            continue
        src = "data:audio/mpeg;base64," + base64.b64encode(mp3.read_bytes()).decode()
        rows.append(f'<li><span class="who">{escape(names.get(vid, vid))}</span><span class="id">{escape(vid)}</span><audio controls preload="none" src="{src}"></audio><span class="heard">heard: {escape(h["heard"])}</span></li>')
    parts.append(f'<section id="voices"><header><span class="row">PLAN 2.2</span><h2>Hear the voices</h2><p>What pressing a voice in the creator plays: each says one line in its own language, and was kept only once Whisper heard that line in it ({len(rows)} of {len(heard)}).</p></header><ul class="voices">{"".join(rows)}</ul></section>')
    SECTIONS.append(("voices", "Hear the voices", "", "", []))

html = f"""<title>Orbs Screen Review</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;800&display=swap">
<style>
/* Layout: one column of review sections, each a heading, what to look at, then its pictures (desk wide, phone narrow) */
:root {{
  --ground: #0e0e10; --card: #19191c; --text-1: #f2f2f5; --text-2: #b9b9c2; --text-3: #8a8a95; --accent: #4aa3ff; --hairline: rgba(255,255,255,.09);
  --display: "Nunito", ui-rounded, system-ui, sans-serif; --body: "Nunito", system-ui, sans-serif;
  color-scheme: dark;
}}
@media (prefers-color-scheme: light) {{ :root:not([data-theme="dark"]) {{ --ground: #e9e9ee; --card: #ffffff; --text-1: #17171a; --text-2: #45454d; --text-3: #6b6b75; --accent: #0a66d1; --hairline: rgba(0,0,0,.1); color-scheme: light; }} }}
:root[data-theme="light"] {{ --ground: #e9e9ee; --card: #ffffff; --text-1: #17171a; --text-2: #45454d; --text-3: #6b6b75; --accent: #0a66d1; --hairline: rgba(0,0,0,.1); color-scheme: light; }}
body {{ background: var(--ground); color: var(--text-2); font: 400 16px/1.55 var(--body); padding-inline: 16px; padding-block: 32px 64px; }}
main {{ max-width: 1240px; margin: 0 auto; display: grid; gap: 56px; }}
.top h1 {{ font: 800 34px/1.15 var(--display); color: var(--text-1); margin: 0 0 8px; text-wrap: balance; }}
.top p {{ margin: 0; max-width: 65ch; }}
nav {{ display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }}
nav a {{ font: 600 13px/1 var(--body); color: var(--text-1); text-decoration: none; padding: 8px 12px; border-radius: 999px; background: var(--card); box-shadow: inset 0 0 0 .5px var(--hairline); }}
nav a:focus-visible, nav a:hover {{ box-shadow: inset 0 0 0 1.5px var(--accent); outline: none; }}
section {{ display: grid; gap: 16px; }}
section header {{ display: grid; gap: 4px; max-width: 70ch; }}
.row {{ font: 800 11px/1 var(--body); letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }}
h2 {{ font: 800 24px/1.2 var(--display); color: var(--text-1); margin: 0; text-wrap: balance; }}
section p {{ margin: 0; }}
.shots {{ display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 1fr); gap: 16px; align-items: start; }}
.shots:has(.icon) {{ grid-template-columns: repeat(3, minmax(0, 220px)); }}
figure {{ margin: 0; display: grid; gap: 6px; min-width: 0; }}
figure img {{ width: 100%; height: auto; border-radius: 14px; box-shadow: 0 0 0 .5px var(--hairline), 0 18px 40px rgba(0,0,0,.25); background: var(--card); }}
figure.icon img {{ border-radius: 22%; }}
figcaption {{ font: 600 12px/1 var(--body); color: var(--text-3); letter-spacing: .04em; }}
.shots.phones {{ grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); }}
.voices {{ list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }}
.voices li {{ display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 8px; align-items: center; padding: 10px 12px; border-radius: 12px; background: var(--card); box-shadow: inset 0 0 0 .5px var(--hairline); min-width: 0; }}
.voices .who {{ font: 800 14px/1.3 var(--body); color: var(--text-1); }}
.voices .id {{ font: 600 11px/1 var(--body); color: var(--text-3); }}
.voices audio {{ grid-column: 1 / -1; width: 100%; height: 32px; }}
.voices .heard {{ grid-column: 1 / -1; font: 400 12px/1.4 var(--body); color: var(--text-3); overflow-wrap: anywhere; }}
@media (max-width: 720px) {{ .shots, .shots:has(.icon) {{ grid-template-columns: minmax(0, 1fr); }} .top h1 {{ font-size: 28px; }} }}
</style>
<main>
  <div class="top">
    <h1>New Orbs screens, ready for your look</h1>
    <p>Each one rendered on a real home with example data (Dana, Gus and Robin are stand-ins), at desk and phone size. A screen's plan row is ticked only once you've looked; tell me what to change.</p>
    <nav>{"".join(f'<a href="#{k}">{escape(t)}</a>' for k, t, *_ in SECTIONS)}</nav>
  </div>
  {"".join(parts)}
</main>
"""
out.write_text(html)
print(out, f"{out.stat().st_size / 1e6:.1f} MB", len(parts), "sections")
