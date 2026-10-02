// Make an orb (PLAN 2.2-2.3): a character creator, the way a game has one, in Ash's own look (his
// chat window: a charcoal card with a sheen, a solid sidebar, his colour only on what is his).
// Every orb is a different Ash: his glass and his liquid, in another shape, with other eyes,
// a hat and glasses, with a personality, a specialty and a voice that go together. Each part has
// its own dice, and one roll does everything; his character sheet says who he turned out to be.
// Once he is created he joins the office as he is (owner, 10-01: "once an orb is created, he can be
// deleted, but not edited"): the creator is for a new orb only.
// It plays like a game (owner, 10-01: "when i push something, i wanna feel like im pushing it"):
// every press squishes and clicks (ui/feel.ts, ui/sound.ts), and he reacts to each thing you
// choose for him: a hat makes him hop, glasses make him nod, a colour makes him wiggle, a shape
// makes him wobble.
import { StrictMode, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { HUES, stylesheet, type HueName } from "./design/tokens.ts";
import { Orb } from "./orb/Orb.tsx";
import { Balanced, OneLine, useMore } from "./ui/Balanced.tsx";
import { Paged } from "./ui/Paged.tsx";
import { installFeel } from "./ui/feel.ts";
import { setSounds, soundsOn } from "./ui/sound.ts";
import { Splash, splashWanted } from "./ui/Splash.tsx";
import { Onboarding } from "./onboarding/Onboarding.tsx";
import { introWanted, loadPerson, savePerson, type Person } from "./onboarding/story.ts";
import { parseRoute, routeHash, type Route } from "./ui/nav.ts";
import { Settings } from "./rooms/Settings.tsx";
import { SessionsRoom } from "./rooms/Sessions.tsx";
import { Chat } from "./rooms/Chat.tsx";
import { connect, keepOffice, keptOffice, type Office, type Tab as SessionTab } from "./home/link.ts";
import { DEMO_CREW } from "./orb/demo.ts";
import { NEWBORN } from "./onboarding/story.ts";
import type { Gesture, OrbState } from "./orb/life.ts";
import {
  ASH, EYES, FAMILIES, FINISHES, GLASSES, HATS, orbName, PERSONALITIES, REPLIES, SHAPES, sheetOf, speaks, SPECIALTIES, surprise, voice, VOICES, withPersonality,
  type Character, type EyesName, type Family, type FinishName, type GlassesName, type HatName, type PersonalityName, type Replies, type ShapeName, type SpecialtyName,
} from "./orb/spec.ts";



const MOODS: [OrbState, string][] = [["idle", "Awake"], ["listening", "Listening"], ["thinking", "Thinking"], ["speaking", "Speaking"]];
const GESTURES: [Gesture, string][] = [["hop", "Hop"], ["wink", "Wink"], ["wiggle", "Wiggle"], ["squish", "Squish"], ["jelly", "Jelly"], ["look", "Look round"], ["pout", "Pout"], ["doze", "Doze"], ["nod", "Nod"]];
const TABS = ["Personality", "Specialty", "Shape", "Eyes", "Hat", "Glasses", "Colour", "Voice"] as const;
type Tab = (typeof TABS)[number];
const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);
const roll = (): number => Math.floor(Math.random() * 1e6);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

const s = {
  window: {
    position: "relative", maxWidth: 1240, margin: "0 auto", borderRadius: "var(--r-card)", overflow: "clip",
    display: "grid", gridTemplateColumns: "var(--side-w, 248px) minmax(0, 1fr)",
    background: "linear-gradient(180deg, var(--fill) 0, transparent 90px), var(--card)",
    boxShadow: "inset 0 0 0 .5px var(--hairline), 0 3px 8px var(--shadow)",
  },
  side: { background: "var(--side)", boxShadow: "1px 0 0 var(--sep)", padding: "var(--s4) var(--s3)", display: "flex", flexDirection: "column", gap: "var(--s2)", minWidth: 0 },
  head: { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)", margin: 0 },
  btn: { font: "600 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 14px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 36 },
  chip: { font: "600 13px/18px var(--font)", color: "var(--text-2)", background: "var(--fill)", border: 0, borderRadius: 999, padding: "6px 12px", cursor: "pointer", minHeight: 32 },
  panel: { background: "var(--fill)", borderRadius: 18, boxShadow: "inset 0 0 0 .5px var(--hairline)", padding: "var(--s4)", minWidth: 0, gridTemplateColumns: "minmax(0, 1fr)" },
} satisfies Record<string, CSSProperties>;

const chosen = (on: boolean): CSSProperties => ({
  background: on ? "var(--accent-fill)" : "var(--fill)",
  color: on ? "var(--text-1)" : "var(--text-2)",
  boxShadow: on ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 .5px var(--hairline)",
});

function Die({ onRoll, label, said = label }: { onRoll: () => void; label: string; said?: string }) {
  const [spins, setSpins] = useState(0);
  return (
    <button
      data-sound="roll"
      onClick={() => {
        setSpins((n) => n + 1);
        onRoll();
      }}
      aria-label={said}
      title={said}
      style={{ ...s.chip, display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-1)" }}
    >
      <DieIcon spins={spins} />
      {label}
    </button>
  );
}

/** A die, drawn: five pips on a rounded square, in the text's own colour. It tumbles when rolled. */
function DieIcon({ size = 16, spins = 0 }: { size?: number; spins?: number }) {
  const pips: [number, number][] = [[5, 5], [11, 5], [8, 8], [5, 11], [11, 11]];
  return (
    <svg key={spins} aria-hidden width={size} height={size} viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto", animation: spins ? "orbs-roll 520ms var(--m-spring)" : undefined }}>
      <rect x="1.25" y="1.25" width="13.5" height="13.5" rx="3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {pips.map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="1.35" fill="currentColor" />
      ))}
    </svg>
  );
}

function Head({ children }: { children: ReactNode }) {
  return <span style={s.head}>{children}</span>;
}

function Bars({ items }: { items: { name: string; value: number }[] }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {items.map((t) => (
        <div key={t.name} style={{ display: "grid", gridTemplateColumns: "84px 1fr", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ font: "600 12px/16px var(--font)", color: "var(--text-3)" }}>{t.name}</span>
          <span aria-label={`${t.name} ${t.value} of 5`} style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 3 }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <i key={n} style={{ height: 6, borderRadius: 3, background: n <= t.value ? "var(--accent)" : "var(--fill-2)" }} />
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Where he leans, on eight skills: a radar in his colour. */
function Radar({ items }: { items: { name: string; value: number }[] }) {
  const n = items.length;
  const R = 70;
  const at = (i: number, v: number): [number, number] => {
    const a = -Math.PI / 2 + (i / n) * 2 * Math.PI;
    return [Math.cos(a) * R * (v / 5), Math.sin(a) * R * (v / 5)];
  };
  const poly = items.map((t, i) => at(i, t.value).join(",")).join(" ");
  return (
    <svg viewBox="-118 -100 236 200" role="img" aria-label={`Leans toward: ${items.map((t) => `${t.name} ${t.value}`).join(", ")}`} style={{ width: "100%", maxWidth: 300, display: "block", margin: "0 auto" }}>
      {[1, 2, 3, 4, 5].map((ring) => (
        <polygon key={ring} points={items.map((_, i) => at(i, ring).join(",")).join(" ")} fill="none" stroke="var(--fill-2)" strokeWidth={1} />
      ))}
      {items.map((_, i) => {
        const [x, y] = at(i, 5);
        return <line key={i} x1={0} y1={0} x2={x} y2={y} stroke="var(--fill-2)" strokeWidth={1} />;
      })}
      <polygon points={poly} fill="var(--accent-wash)" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
      {items.map((t, i) => {
        const [x, y] = at(i, 6.4);
        return (
          <text key={t.name} x={x} y={y} textAnchor="middle" dominantBaseline="middle" style={{ font: "600 11px var(--font)", fill: "var(--text-3)" }}>
            {t.name}
          </text>
        );
      })}
    </svg>
  );
}

function Sheet({ c, onRename, replies }: { c: Character; onRename?: (name: string) => void; replies: Replies }) {
  const sh = sheetOf(c);
  const v = voice(c.voice);
  const name = { font: "800 26px/32px var(--font)", color: "var(--accent)" } satisfies CSSProperties;
  return (
    <div data-orb={c.hue} style={{ ...s.panel, display: "grid", gap: "var(--s4)" }}>
      <div style={{ display: "grid", gap: 4 }}>
        {onRename ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              value={c.name}
              onChange={(e) => onRename(e.target.value.slice(0, 16))}
              aria-label="Name"
              placeholder="His name"
              size={1}
              style={{ ...name, flex: "1 1 120px", minWidth: 0, background: "transparent", border: 0, outline: 0, padding: 0 }}
            />
            <Die label="Name" said="Roll a name" onRoll={() => onRename(orbName(() => Math.random()))} />
          </div>
        ) : (
          <h2 style={{ ...name, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</h2>
        )}
        <span style={{ font: "600 15px/20px var(--font)", color: "var(--text-1)" }}>{cap(sh.title)}</span>
        <span style={{ font: "400 13px/18px var(--font)", color: "var(--text-3)" }}>
          {onRename ? "Not in the office yet · he is fixed once you create him" : "Junior · 0 XP · levels come from finished work you approve"}
        </span>
      </div>
      <p style={{ margin: 0, font: "400 15px/21px var(--font)", color: "var(--text-2)" }}>{sh.bio}</p>
      {/* a role a licence stands behind says so: he is a persona that helps, never the professional */}
      {"limits" in SPECIALTIES[c.specialty] && (
        <p style={{ margin: 0, font: "400 13px/18px var(--font)", color: "var(--text-3)" }}>{(SPECIALTIES[c.specialty] as { limits: string }).limits}</p>
      )}
      <div style={{ display: "grid", gap: 4 }}>
        <Head>Quirk</Head>
        <span style={{ font: "400 14px/20px var(--font)", color: "var(--text-2)" }}>{cap(sh.quirk)}.</span>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <Head>Says</Head>
        <span style={{ font: "italic 400 15px/20px var(--font)", color: "var(--text-1)" }}>“{sh.catchphrase}”</span>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        <Head>Voice</Head>
        <span style={{ font: "400 14px/20px var(--font)", color: "var(--text-2)" }}>
          {c.voice === "silent" ? "Silent: he writes, never speaks" : `${v.label} · ${v.accent}`}
          {c.voice !== "silent" && !speaks(c, replies) ? ` (${REPLIES[replies].toLowerCase()} for now)` : ""}
        </span>
      </div>
      <div style={{ display: "grid", gap: "var(--s2)" }}>
        <Head>Traits</Head>
        <Bars items={sh.traits} />
      </div>
      <div style={{ display: "grid", gap: "var(--s2)" }}>
        <Head>Leans toward</Head>
        <Radar items={sh.leans} />
      </div>
    </div>
  );
}

/** A picture tab's choices: him in each, three across and nine to a page (ui/Paged.tsx), every tab
 * the same (owner, 10-01: "same amount of orbs and accessories per tab, with page numbers. 3 per
 * row"). A thumbnail is drawn at one size and shrinks to fit a narrow cell. */
const THUMB = 96;
function Thumbs<T extends string>({ c, options, field, label, onPick, face = false, title }: { c: Character; options: T[]; field: "shape" | "eyes" | "hat" | "glasses" | "finish"; label: (o: T) => string; onPick: (o: T) => void; face?: boolean; title: string }) {
  return (
    <Paged
      label={title}
      at={options.indexOf(c[field] as T)}
      items={options.map((o) => {
        const on = c[field] === o;
        return (
          <button key={o} data-pick={o} onClick={() => onPick(o)} aria-pressed={on} style={{ ...chosen(on), border: 0, borderRadius: 14, padding: "6px 4px 8px", cursor: "pointer", display: "grid", justifyItems: "center", alignContent: "center", gap: 2, minWidth: 0 }}>
            <Orb character={{ ...c, [field]: o }} size={THUMB} still poke={false} framing={face ? "portrait" : "window"} style={{ maxWidth: "100%", height: "auto" }} />
            <span style={{ font: "600 12px/16px var(--font)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(o)}</span>
          </button>
        );
      })}
    />
  );
}

/** An accessory's colour: its own, or any of his 24 (owner, 10-01: "just like the orb we should be
 * able to change the colors of our accessories"). One line, scrolling sideways on a phone. */
function AccessoryColour({ what, value, onPick }: { what: string; value: HueName | null; onPick: (h: HueName | null) => void }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Head>{cap(what)} colour</Head>
      <OneLine style={{ justifyContent: "flex-start", alignItems: "center", padding: "4px 2px" }} gap={8}>
        <button onClick={() => onPick(null)} aria-pressed={value === null} style={{ ...s.chip, ...chosen(value === null), flex: "0 0 auto" }}>
          Its own
        </button>
        {HUES.map((h) => (
          <span key={h.name} style={{ flex: "0 0 auto", display: "grid" }}>
            <Swatch hue={h.name} size={28} on={value === h.name} label={`${what} in ${h.name}`} onPick={() => onPick(h.name)} />
          </span>
        ))}
      </OneLine>
    </div>
  );
}

function Cards<K extends string>({ value, entries, onPick }: { value: K; entries: [K, string, string][]; onPick: (k: K) => void }) {
  return (
    <Balanced min={180}>
      {entries.map(([k, title, line]) => (
        <button key={k} onClick={() => onPick(k)} aria-pressed={value === k} style={{ ...chosen(value === k), border: 0, borderRadius: 14, padding: "10px 12px", cursor: "pointer", textAlign: "left", display: "grid", gap: 2, minWidth: 0 }}>
          <span style={{ font: "700 14px/20px var(--font)", color: "var(--text-1)" }}>{title}</span>
          <span style={{ font: "400 12px/16px var(--font)", color: "var(--text-3)" }}>{line}</span>
        </button>
      ))}
    </Balanced>
  );
}

function Swatch({ hue, on, size, label, onPick }: { hue: HueName; on: boolean; size: number; label: string; onPick: () => void }) {
  return (
    <button
      data-orb={hue}
      aria-label={label}
      aria-pressed={on}
      title={cap(hue)}
      onClick={onPick}
      style={{ width: size, height: size, borderRadius: "50%", border: 0, cursor: "pointer", background: "var(--accent)", boxShadow: on ? "0 0 0 2px var(--card), 0 0 0 4px var(--text-1)" : "inset 0 0 0 1px var(--hairline)" }}
    />
  );
}

/** The tab bar: one line, and a pill that slides to the chosen tab with a spring. */
function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  useMore(bar);
  useLayoutEffect(() => {
    const el = bar.current!;
    const place = (): void => {
      const on = el.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!on) return;
      setPill({ x: on.offsetLeft, w: on.offsetWidth });
      // keep the chosen tab in view when the bar scrolls (a phone), without moving the page
      if (on.offsetLeft < el.scrollLeft) el.scrollTo({ left: on.offsetLeft - 3, behavior: "smooth" });
      else if (on.offsetLeft + on.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollTo({ left: on.offsetLeft + on.offsetWidth - el.clientWidth + 3, behavior: "smooth" });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tab]);
  return (
    <div ref={bar} role="tablist" className="one-line" style={{ position: "relative", display: "flex", flexWrap: "nowrap", overflowX: "auto", gap: 3, padding: 3, borderRadius: 12, background: "var(--fill)", scrollbarWidth: "none" }}>
      {pill && (
        <i
          aria-hidden
          style={{ position: "absolute", top: 3, bottom: 3, left: 0, width: pill.w, translate: `${pill.x}px 0`, borderRadius: 9, background: "var(--fill-2)", boxShadow: "0 1px 3px var(--shadow)", transition: "translate var(--m-slow) var(--m-spring), width var(--m-slow) var(--m-spring)" }}
        />
      )}
      {TABS.map((t) => (
        <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={{ ...s.chip, position: "relative", flex: "1 0 auto", padding: "6px 10px", borderRadius: 9, background: "transparent", color: tab === t ? "var(--text-1)" : "var(--text-3)" }}>
          {t}
        </button>
      ))}
    </div>
  );
}

function Creator({ me, edit, replies, setReplies }: { me: Character; edit: (p: Partial<Character>) => void; replies: Replies; setReplies: (r: Replies) => void }) {
  const [tab, setTab] = useState<Tab>("Personality");
  const hues = HUES.map((h) => h.name);
  const dice: Record<Tab, () => void> = {
    Personality: () => edit(withPersonality(me, pick(Object.keys(PERSONALITIES) as PersonalityName[]))),
    Specialty: () => edit({ specialty: pick(Object.keys(SPECIALTIES) as SpecialtyName[]) }),
    Shape: () => edit({ shape: pick(Object.keys(SHAPES) as ShapeName[]) }),
    Eyes: () => edit({ eyes: pick(Object.keys(EYES) as EyesName[]) }),
    Hat: () => edit({ hat: pick(Object.keys(HATS) as HatName[]), hatHue: Math.random() < 0.35 ? pick(hues) : null }),
    Glasses: () => edit({ glasses: pick(Object.keys(GLASSES) as GlassesName[]), glassesHue: Math.random() < 0.35 ? pick(hues) : null }),
    Colour: () => edit({ hue: pick(hues), hue2: Math.random() < 0.25 ? pick(hues) : null, finish: Math.random() < 0.7 ? "glass" : pick(Object.keys(FINISHES) as FinishName[]) }),
    Voice: () => edit({ voice: pick(VOICES.filter((v) => v.english && v.id !== "ash" && v.id !== "silent").map((v) => v.id)) }),
  };
  const P = PERSONALITIES[me.personality];
  const voiceGroups: [string, typeof VOICES][] = [
    [`Suits a ${P.label.toLowerCase()} orb`, VOICES.filter((v) => (P.voices as readonly string[]).includes(v.id))],
    ["American", VOICES.filter((v) => v.accent.startsWith("American"))],
    ["British", VOICES.filter((v) => v.accent.startsWith("British"))],
    ["In their own language (English for these comes with the voice row)", VOICES.filter((v) => !v.english)],
    ["Classic, or none", VOICES.filter((v) => v.id === "silent" || v.id === "ash")],
  ];
  return (
    <div style={{ ...s.panel, display: "grid", gap: "var(--s4)", alignContent: "start" }}>
      <Tabs tab={tab} setTab={setTab} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ font: "700 17px/22px var(--font)", color: "var(--text-1)" }}>{tab}</span>
        <Die label={`Roll ${tab.toLowerCase()}`} onRoll={dice[tab]} />
      </div>
      {tab === "Personality" && (
        <Cards value={me.personality} entries={(Object.keys(PERSONALITIES) as PersonalityName[]).map((k) => [k, PERSONALITIES[k].label, PERSONALITIES[k].blurb])} onPick={(p) => edit(withPersonality(me, p))} />
      )}
      {tab === "Specialty" && (
        <div style={{ display: "grid", gap: "var(--s4)" }}>
          {(Object.keys(FAMILIES) as Family[]).map((fam) => (
            <div key={fam} style={{ display: "grid", gap: 8 }}>
              <Head>{FAMILIES[fam]}</Head>
              <Cards
                value={me.specialty}
                entries={(Object.keys(SPECIALTIES) as SpecialtyName[]).filter((k) => SPECIALTIES[k].family === fam).map((k) => [k, SPECIALTIES[k].title, cap(SPECIALTIES[k].focus)])}
                onPick={(specialty) => edit({ specialty })}
              />
            </div>
          ))}
        </div>
      )}
      {tab === "Shape" && <Thumbs title="Shapes" c={me} options={Object.keys(SHAPES) as ShapeName[]} field="shape" label={cap} onPick={(shape) => edit({ shape })} />}
      {tab === "Eyes" && <Thumbs title="Eyes" c={me} options={Object.keys(EYES) as EyesName[]} field="eyes" label={cap} onPick={(eyes) => edit({ eyes })} face />}
      {tab === "Hat" && (
        <div style={{ display: "grid", gap: "var(--s4)" }}>
          <Thumbs title="Hats" c={me} options={Object.keys(HATS) as HatName[]} field="hat" label={cap} onPick={(hat) => edit({ hat })} />
          {me.hat !== "none" && <AccessoryColour what="hat" value={me.hatHue ?? null} onPick={(hatHue) => edit({ hatHue })} />}
        </div>
      )}
      {tab === "Glasses" && (
        <div style={{ display: "grid", gap: "var(--s4)" }}>
          <Thumbs title="Glasses" c={me} options={Object.keys(GLASSES) as GlassesName[]} field="glasses" label={cap} onPick={(glasses) => edit({ glasses })} face />
          {me.glasses !== "none" && <AccessoryColour what="frame" value={me.glassesHue ?? null} onPick={(glassesHue) => edit({ glassesHue })} />}
        </div>
      )}
      {tab === "Colour" && (
        <div style={{ display: "grid", gap: "var(--s4)" }}>
          <Balanced min={32} style={{ justifyItems: "center" }}>
            {hues.map((h) => (
              <Swatch key={h} hue={h} size={32} on={me.hue === h} label={h} onPick={() => edit({ hue: h })} />
            ))}
          </Balanced>
          <div style={{ display: "grid", gap: 8 }}>
            <Head>Finish</Head>
            <Thumbs title="Finishes" c={me} options={Object.keys(FINISHES) as FinishName[]} field="finish" label={(f) => FINISHES[f].label} onPick={(finish) => edit({ finish })} face />
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <Head>Gradient: a second colour, top to bottom</Head>
            <button onClick={() => edit({ hue2: null })} aria-pressed={me.hue2 === null} style={{ ...s.chip, ...chosen(me.hue2 === null), justifySelf: "start" }}>
              No gradient
            </button>
            <Balanced min={24} style={{ justifyItems: "center" }}>
              {hues.map((h) => (
                <Swatch key={h} hue={h} size={24} on={me.hue2 === h} label={`then ${h}`} onPick={() => edit({ hue2: h })} />
              ))}
            </Balanced>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <Head>Goo: {Math.round(me.goo * 100)}%</Head>
            <input type="range" min={0} max={100} value={Math.round(me.goo * 100)} onChange={(e) => edit({ goo: Number(e.target.value) / 100 })} data-orb={me.hue} style={{ accentColor: "var(--accent)", width: "100%", minWidth: 0, margin: 0, display: "block" }} aria-label="How gooey" />
          </div>
        </div>
      )}
      {tab === "Voice" && (
        <div style={{ display: "grid", gap: "var(--s4)" }}>
          <RepliesRow replies={replies} setReplies={setReplies} />
          {voiceGroups.map(([title, vs]) => (
            <div key={title} style={{ display: "grid", gap: 8 }}>
              <Head>{title}</Head>
              <Balanced min={128} gap={6}>
                {vs.map((v) => (
                  <button key={v.id} onClick={() => edit({ voice: v.id })} aria-pressed={me.voice === v.id} title={v.accent} style={{ ...s.chip, ...chosen(me.voice === v.id), display: "grid", textAlign: "left", borderRadius: 12, padding: "6px 12px" }}>
                    <span>{v.label}</span>
                    <span style={{ font: "400 11px/14px var(--font)", color: "var(--text-3)" }}>{v.accent}</span>
                  </button>
                ))}
              </Balanced>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RepliesRow({ replies, setReplies }: { replies: Replies; setReplies: (r: Replies) => void }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Head>Replies, for every orb</Head>
      <OneLine style={{ justifyContent: "flex-start" }}>
        {(Object.keys(REPLIES) as Replies[]).map((r) => (
          <button key={r} onClick={() => setReplies(r)} aria-pressed={replies === r} style={{ ...s.chip, ...chosen(replies === r) }}>
            {REPLIES[r]}
          </button>
        ))}
      </OneLine>
    </div>
  );
}

/** An orb in the office: what he is made of, fixed, and the one thing you can still do (let him go). */
function Card({ c, replies, setReplies, onDelete, onChat }: { c: Character; replies: Replies; setReplies: (r: Replies) => void; onDelete: () => void; onChat: () => void }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => setAsking(false), [c.name]);
  const facts: [string, string][] = [
    ["Personality", PERSONALITIES[c.personality].label],
    ["Specialty", SPECIALTIES[c.specialty].label],
    ["Shape", cap(c.shape)],
    ["Eyes", cap(c.eyes)],
    ["Hat", c.hat === "none" ? "None" : `${cap(c.hat)}${c.hatHue ? `, ${c.hatHue}` : ""}`],
    ["Glasses", c.glasses === "none" ? "None" : `${cap(c.glasses)}${c.glassesHue ? `, ${c.glassesHue} frames` : ""}`],
    ["Colour", c.hue2 ? `${cap(c.hue)} to ${c.hue2}` : cap(c.hue)],
    ["Finish", FINISHES[c.finish].label],
    ["Voice", c.voice === "silent" ? "Silent" : voice(c.voice).label],
  ];
  return (
    <div data-orb={c.hue} style={{ ...s.panel, display: "grid", gap: "var(--s4)", alignContent: "start" }}>
      <button data-sound="pick" onClick={onChat} style={{ ...s.btn, justifySelf: "stretch", background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)", fontWeight: 800 }}>
        Chat with {c.name}
      </button>
      <span style={{ font: "700 17px/22px var(--font)", color: "var(--text-1)" }}>Made of</span>
      <Balanced min={100}>
        {facts.map(([k, v]) => (
          <div key={k} style={{ display: "grid", gap: 2, padding: "8px 10px", borderRadius: 12, background: "var(--fill)", minWidth: 0 }}>
            <span style={{ ...s.head, fontSize: 11 }}>{k}</span>
            <span style={{ font: "600 14px/20px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
          </div>
        ))}
      </Balanced>
      <RepliesRow replies={replies} setReplies={setReplies} />
      <p style={{ margin: 0, font: "400 13px/18px var(--font)", color: "var(--text-3)" }}>
        An orb stays as he was made. He grows from the work you approve, not from edits.
      </p>
      {asking ? (
        <div role="group" aria-label={`Delete ${c.name}?`} style={{ display: "grid", gap: 8, padding: "var(--s3)", borderRadius: 14, background: "var(--fill)", boxShadow: "inset 0 0 0 1px var(--off)" }}>
          <span style={{ font: "600 14px/20px var(--font)", color: "var(--text-1)" }}>{c.name} goes for good. An orb can't be brought back.</span>
          <OneLine style={{ justifyContent: "flex-start" }}>
            <button data-sound="delete" onClick={onDelete} style={{ ...s.btn, color: "var(--off)", boxShadow: "inset 0 0 0 1px var(--off)" }}>
              Delete {c.name}
            </button>
            <button onClick={() => setAsking(false)} style={s.btn}>
              Keep him
            </button>
          </OneLine>
        </div>
      ) : (
        <button onClick={() => setAsking(true)} style={{ ...s.btn, justifySelf: "start", color: "var(--text-3)" }}>
          Delete {c.name}…
        </button>
      )}
    </div>
  );
}

/** A speaker, drawn: with its waves when sounds are on, crossed out when they are off. */
function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <path d="M2.5 6h2.5l3.5-3v10l-3.5-3h-2.5z" fill="currentColor" />
      {on ? <path d="M11 5.5c.9.7 1.4 1.6 1.4 2.5s-.5 1.8-1.4 2.5M12.8 3.6c1.5 1.1 2.3 2.7 2.3 4.4s-.8 3.3-2.3 4.4" /> : <path d="M11.2 5.8l3.6 4.4M14.8 5.8l-3.6 4.4" />}
    </svg>
  );
}

const REACT: [keyof Character, Gesture][] = [["hat", "hop"], ["glasses", "nod"], ["personality", "hop"], ["shape", "jelly"], ["goo", "jelly"], ["eyes", "nod"], ["specialty", "nod"], ["hue", "wiggle"], ["hue2", "wiggle"], ["finish", "wiggle"], ["voice", "squish"]];

type View = { kind: "orb"; name: string } | { kind: "new"; draft: Character };

function App() {
  // an office starts with the one orb you make (owner, 10-01: "we should start with only 1 orb,
  // the one we make at the beginning"); until then, the creator, on a newborn
  const [office, setOffice] = useState<Character[]>(() => keptOffice(NEWBORN));
  const [view, setView] = useState<View>(() => {
    const kept = keptOffice(NEWBORN);
    return kept.length ? { kind: "orb", name: kept[0]!.name } : { kind: "new", draft: { ...NEWBORN, seed: roll() } };
  });
  const [state, setState] = useState<OrbState>("idle");
  const [gesture, setGesture] = useState<{ name: Gesture; n: number } | null>(null);
  const [replies, setReplies] = useState<Replies>("speak");
  const [sounds, setSoundsShown] = useState(soundsOn());
  const [leaving, setLeaving] = useState<string | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  const [rolls, setRolls] = useState(0);
  const lastReact = useRef(0);
  const [opening, setOpening] = useState(splashWanted);
  const [drawn, setDrawn] = useState(!opening); // the office draws once the splash starts to leave
  const [person, setPerson] = useState<Person | null>(loadPerson);
  // the first open is a story (PLAN 2.5): until it is played, it is what the person sees
  const [intro, setIntro] = useState(() => !loadPerson() && introWanted());
  // the home behind this page, when there is one (PLAN 2.4): its office, and what it calls you
  const [home, setHome] = useState<Office | null>(null);
  const [said, setSaid] = useState<string | null>(null); // what the home said when it refused something
  const linked = useRef<Promise<void> | null>(null);
  /** Finds the home and loads its office, once; after a failure, the next ask tries again (Try again). */
  const link = (): Promise<void> => (linked.current ??= connect(ASH).then(async (l) => {
    if (!l) return; // a preview: the office lives in this browser
    if ("trouble" in l) throw new Error(l.trouble);
    const orbs = (await l.office.orbs()) ?? [];
    const me = await l.office.me();
    setHome(l.office);
    setOffice(orbs);
    setPerson(me);
    setIntro(!me && introWanted());
    setView((v) => {
      if (!orbs.length) return v.kind === "new" ? v : { kind: "new", draft: { ...NEWBORN, seed: roll() } }; // an empty office: make the first
      const r = parseRoute(location.hash);
      if (r.room === "new" && v.kind === "new") return v; // the creator, because you asked for it
      return { kind: "orb", name: r.room === "office" && r.orb && orbs.some((c) => c.name === r.orb) ? r.orb : orbs[0]!.name };
    });
  }).catch((e: unknown) => {
    linked.current = null;
    throw e;
  }));
  useEffect(() => {
    link().catch(() => {}); // the splash says what went wrong
  }, []);
  const keep = (p: Person): void => {
    setPerson(p);
    if (home) home.setName(p).catch((e: Error) => setSaid(e.message));
    else savePerson(p);
  };
  const [room, setRoom] = useState<"office" | "settings" | "chat" | "sessions">(() => {
    const r = parseRoute(location.hash).room;
    return r === "settings" || r === "chat" || r === "sessions" ? r : "office";
  });
  const [inSession, setInSession] = useState<{ id: number | null; tab: SessionTab }>(() => {
    const r = parseRoute(location.hash);
    return r.room === "sessions" ? { id: r.id, tab: r.tab } : { id: null, tab: "brainstorm" };
  });
  const [talking, setTalking] = useState<string | null>(() => {
    const r = parseRoute(location.hash);
    return r.room === "chat" ? r.orb : null;
  });
  const [depth, setDepth] = useState(0); // how far in this visit has gone: Back is there when it is more than none
  const [menu, setMenu] = useState(false); // the side menu, slid in on a phone
  useEffect(installFeel, []);
  // a preview's office is kept in this browser; a home's is the home's
  useEffect(() => {
    if (!home) keepOffice(office);
  }, [office, home]);

  const making = view.kind === "new";
  const at = view.kind === "orb" ? Math.max(0, office.findIndex((c) => c.name === view.name)) : -1;
  const me = view.kind === "new" ? view.draft : office[at] ?? NEWBORN;
  const play = (g: Gesture): void => setGesture((x) => ({ name: g, n: (x?.n ?? 0) + 1 }));
  useEffect(() => play("pop"), [making ? "new" : me.name]);

  const taken = (name: string): boolean => office.some((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  /** A new orb by the dice, with a name nobody in the office has. */
  const fresh = (): Character => {
    let c = surprise(roll());
    for (let i = 0; i < 40 && taken(c.name); i++) c = { ...c, name: orbName(() => Math.random()) };
    return c;
  };
  const edit = (patch: Partial<Character>): void => {
    if (view.kind !== "new") return; // once he is in the office he is fixed
    setView({ kind: "new", draft: { ...view.draft, ...patch } });
    // he reacts to what you choose for him (at most every 300 ms, for a slider dragged)
    const g = REACT.find(([k]) => k in patch && patch[k] !== view.draft[k])?.[1];
    const t = performance.now();
    if (g && Object.keys(patch).length < 4 && t - lastReact.current > 300) {
      lastReact.current = t;
      play(g);
    }
  };
  const name = me.name.trim();
  const blocked = !making ? null : !name ? "Give him a name first" : taken(name) ? `Someone in the office is already called ${name}` : null;
  const create = (): void => {
    if (view.kind !== "new" || blocked) return;
    const made = { ...view.draft, name };
    setOffice((o) => [...o, made]);
    home?.add(made).catch((e: Error) => setSaid(`${made.name} was not hired: ${e.message}`));
    setArrived(made.name);
    setView({ kind: "orb", name: made.name });
    // the creator's address becomes his: a reload shows him, and Back does not reopen a creator for him
    history.replaceState(history.state, "", routeHash({ room: "office", orb: made.name }));
    window.setTimeout(() => play("hop"), 120);
  };
  const remove = (who: string): void => {
    const i = office.findIndex((c) => c.name === who);
    const rest = office.filter((c) => c.name !== who);
    const gone = office[i];
    if (home && gone) home.letGo(gone).catch((e: Error) => setSaid(`${who} was not let go: ${e.message}`));
    setLeaving(who);
    window.setTimeout(() => {
      setLeaving(null);
      setOffice(rest);
      const next = rest[Math.max(0, i - 1)];
      setView(next ? { kind: "orb", name: next.name } : { kind: "new", draft: surprise(roll()) });
      history.replaceState(history.state, "", routeHash(next ? { room: "office", orb: next.name } : { room: "new" }));
    }, 260);
  };
  const flipSounds = (): void => {
    setSounds(!sounds);
    setSoundsShown(!sounds);
  };

  // where you are is an address (ui/nav.ts): going somewhere adds it to the history, so the side
  // menu's Back and the browser's Back are the same Back
  const routeOf = (): Route =>
    room === "settings" ? { room: "settings" } : room === "sessions" ? { room: "sessions", ...inSession } : room === "chat" && talking ? { room: "chat", orb: talking } : view.kind === "new" ? { room: "new" } : { room: "office", orb: view.name };
  const show = (r: Route): void => {
    if (r.room === "settings") setRoom("settings");
    else if (r.room === "sessions") {
      setRoom("sessions");
      setInSession({ id: r.id, tab: r.tab });
    } else if (r.room === "chat") {
      setRoom("chat");
      setTalking(r.orb);
    } else {
      setRoom("office");
      if (r.room === "new") setView((v) => (v.kind === "new" ? v : { kind: "new", draft: fresh() }));
      else if (!office.length) setView((v) => (v.kind === "new" ? v : { kind: "new", draft: { ...NEWBORN, seed: roll() } })); // an empty office: make the first
      else setView({ kind: "orb", name: r.orb && office.some((c) => c.name === r.orb) ? r.orb : office[0]!.name });
    }
  };
  const go = (r: Route): void => {
    setMenu(false);
    if (routeHash(r) === routeHash(routeOf())) return show(r);
    history.pushState({ orbs: depth + 1 }, "", routeHash(r));
    setDepth((d) => d + 1);
    show(r);
  };
  useEffect(() => {
    const back = (e: PopStateEvent): void => {
      setDepth(Number((e.state as { orbs?: number } | null)?.orbs ?? 0));
      setMenu(false);
      show(parseRoute(location.hash));
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  });
  useEffect(() => {
    const r = parseRoute(location.hash);
    if (r.room === "office" || r.room === "new") show(r); // a link straight to an orb, or to a new one
    history.replaceState({ orbs: 0 }, "", location.hash || routeHash(routeOf()));
  }, []);
  useEffect(() => {
    if (!menu) return;
    const esc = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [menu]);
  const backButton = (style: CSSProperties = {}): ReactNode => (
    <button onClick={() => history.back()} disabled={depth === 0} aria-label="Back" style={{ ...s.btn, display: "inline-flex", alignItems: "center", gap: 6, opacity: depth === 0 ? 0.45 : 1, cursor: depth === 0 ? "default" : "pointer", ...style }}>
      <span aria-hidden style={{ font: "800 16px/16px var(--font)" }}>‹</span> Back
    </button>
  );
  const navItem = (label: string, on: boolean, to: Route, mark: ReactNode): ReactNode => (
    <button key={label} aria-current={on ? "page" : undefined} onClick={() => go(to)} style={{ ...s.btn, display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: on ? "var(--accent-wash)" : "transparent", boxShadow: on ? "inset 0 0 0 1px var(--accent)" : "none" }} data-orb={me.hue}>
      <span aria-hidden style={{ width: 18, display: "grid", placeItems: "center", color: "var(--accent)", font: "800 15px/16px var(--font)" }}>{mark}</span>
      {label}
    </button>
  );

  return (
    <main style={{ padding: "var(--s5) var(--margin)" }}>
      {opening && (
        <Splash
          office={office.length ? office : [NEWBORN]}
          facts={[office.length ? `${office.length} ${office.length === 1 ? "orb" : "orbs"} in the office` : "A new office", sounds ? "Sounds on" : "Sounds off"]}
          ready={() => globalThis.__orbsReady ?? Promise.all([document.fonts.ready, link()])}
          onLeaving={() => setDrawn(true)}
          onDone={() => setOpening(false)}
        />
      )}
      {!opening && intro && (
        <Onboarding
          office={office}
          person={person}
          onDone={(p, then) => {
            keep(p);
            setIntro(false);
            // "Make me": the creator, on him as he told the story; "Surprise me": the dice
            if (then === "surprise") setView({ kind: "new", draft: fresh() });
            go({ room: "new" });
          }}
        />
      )}
      {drawn && !intro && (
      <div className="orbs-window" style={s.window}>
        {/* on a phone: Back, the name, and the menu, which slides in */}
        <div className="orbs-topbar" style={{ display: "none", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "var(--s3) var(--s4) 0" }}>
          {backButton({ padding: "6px 12px" })}
          <span style={{ font: "700 12px/20px var(--font)", letterSpacing: ".12em", color: "var(--text-3)" }}>ORBS</span>
          <button aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(true)} style={{ ...s.btn, padding: "6px 12px", font: "800 16px/20px var(--font)" }}>
            ☰
          </button>
        </div>
        {menu && <div className="orbs-scrim" aria-hidden onClick={() => setMenu(false)} />}
        <aside className="orbs-side" data-open={menu} style={s.side}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 var(--s2)", font: "700 12px/20px var(--font)", letterSpacing: ".12em", color: "var(--text-3)" }}>
            <i aria-hidden data-orb={me.hue} style={{ width: 9, height: 9, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, var(--text-1) 0%, var(--accent) 60%)", boxShadow: "0 0 8px var(--accent-glow)" }} />
            ORBS
          </div>
          {person && (
            <div style={{ padding: "0 var(--s2)", font: "600 13px/18px var(--font)", color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              CEO {person.name}
            </div>
          )}
          <nav aria-label="Rooms" style={{ display: "grid", gap: 4, marginTop: "var(--s2)" }}>
            {backButton({ justifySelf: "start", marginBottom: "var(--s1)" })}
            {navItem("The office", room === "office" && !making, { room: "office", orb: making ? null : me.name }, "◉")}
            {navItem("New orb", room === "office" && making, { room: "new" }, "+")}
            {navItem("Sessions", room === "sessions", { room: "sessions", id: null, tab: "brainstorm" }, "▦")}
            {navItem("Settings", room === "settings", { room: "settings" }, "⚙")}
          </nav>
          <div style={{ ...s.head, margin: "var(--s3) var(--s2) var(--s1)" }}>The office</div>
          <div style={{ display: "grid", gap: 2, overflowY: "auto", minHeight: 0 }}>
            {office.map((c) => (
              <button
                key={c.name}
                data-orb={c.hue}
                onClick={() => go({ room: "office", orb: c.name })}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px", border: 0, borderRadius: 10, cursor: "pointer", textAlign: "left", background: room === "office" && !making && c.name === me.name ? "var(--accent-wash)" : "transparent", color: "var(--text-2)", font: "600 14px/20px var(--font)", minWidth: 0 }}
              >
                <Orb character={c} size={30} poke={false} every={3} fidget={false} />
                <span style={{ display: "grid", minWidth: 0 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  <span style={{ font: "400 11px/14px var(--font)", color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{SPECIALTIES[c.specialty].label}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        {room === "sessions" ? (
          <SessionsRoom home={home} office={office} open={inSession.id} tab={inSession.tab} go={(id, tab) => go({ room: "sessions", id, tab: tab ?? "brainstorm" })} />
        ) : room === "chat" ? (
          <Chat orb={office.find((c) => c.name === talking) ?? office[0] ?? ASH} home={home} person={person?.name ?? null} />
        ) : room === "settings" ? (
          <Settings
            person={person}
            rename={keep}
            sounds={sounds}
            setSounds={(on) => {
              if (on !== sounds) flipSounds();
            }}
            replies={replies}
            setReplies={setReplies}
            replayIntro={() => setIntro(true)}
            {...(!home && {
              fillDemo: () => {
                const filled = [...office, ...DEMO_CREW.filter((c) => !office.some((x) => x.name.toLowerCase() === c.name.toLowerCase()))];
                setOffice(filled);
                // straight to the office, by its address, with the crew in it (go would read the office before the fill)
                history.pushState({ orbs: depth + 1 }, "", routeHash({ room: "office", orb: filled[0]!.name }));
                setDepth((d) => d + 1);
                setRoom("office");
                setView({ kind: "orb", name: filled[0]!.name });
              },
            })}
          />
        ) : (
        <section style={{ minWidth: 0, display: "grid", alignContent: "start", gap: "var(--s5)", padding: "0 0 var(--s6)" }}>
          {said && (
            <div role="alert" style={{ margin: "var(--s4) var(--s5) 0", padding: "var(--s3) var(--s4)", borderRadius: 14, background: "var(--fill)", boxShadow: "inset 0 0 0 1px var(--alert)", font: "500 14px/20px var(--font)", color: "var(--text-1)", display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
              <span>Your home said: {said}</span>
              <button onClick={() => setSaid(null)} style={{ ...s.chip, padding: "4px 10px" }}>OK</button>
            </div>
          )}
          <div data-orb={me.hue} data-cradle data-gesture={gesture?.name} style={{ position: "relative", display: "grid", justifyItems: "center", gap: "var(--s2)", padding: "var(--s5) var(--s4) 0", background: "radial-gradient(50% 80% at 50% 30%, var(--accent-wash), transparent 70%)" }}>
            <button aria-label={sounds ? "Sounds on" : "Sounds off"} aria-pressed={sounds} title={sounds ? "Sounds on" : "Sounds off"} data-sound="none" onClick={flipSounds} style={{ ...s.chip, position: "absolute", top: "var(--s4)", right: "var(--s4)", padding: 8, display: "grid", placeItems: "center", color: sounds ? "var(--text-1)" : "var(--text-3)" }}>
              <SoundIcon on={sounds} />
            </button>
            <span style={{ ...s.head }}>{making ? "A new orb" : "In the office"}</span>
            <Orb character={me} size={176} state={state} gesture={gesture} />
            <OneLine>
              {MOODS.map(([m, label]) => (
                <button key={m} onClick={() => setState(m)} aria-pressed={state === m} style={{ ...s.chip, ...chosen(state === m) }}>
                  {label}
                </button>
              ))}
            </OneLine>
            <OneLine>
              {GESTURES.map(([g, label]) => (
                <button key={g} style={s.chip} onClick={() => play(g)}>
                  {label}
                </button>
              ))}
            </OneLine>
            {making && (
              <OneLine gap={8} style={{ marginTop: "var(--s2)" }}>
                <button
                  data-sound="roll"
                  style={{ ...s.btn, display: "inline-flex", alignItems: "center", gap: 8 }}
                  onClick={() => {
                    edit(fresh());
                    setRolls((n) => n + 1);
                    play("hop");
                  }}
                >
                  <DieIcon size={18} spins={rolls} />
                  Roll everything
                </button>
                <button data-sound="create" disabled={Boolean(blocked)} onClick={create} style={{ ...s.btn, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)", fontWeight: 800, opacity: blocked ? 0.5 : 1, cursor: blocked ? "not-allowed" : "pointer" }}>
                  Create {name || "him"}
                </button>
              </OneLine>
            )}
            <p style={{ margin: 0, font: "400 13px/18px var(--font)", color: blocked ? "var(--alert)" : "var(--text-3)", textAlign: "center" }}>
              {blocked ?? `${name || "He"}, ${sheetOf(me).title}. Click him, or move your pointer: he watches.`}
            </p>
          </div>

          <div className="orbs-pair" style={{ display: "grid", gap: "var(--s4)", padding: "0 var(--s5)", gridTemplateColumns: "minmax(0, 1fr)", alignItems: "start" }}>
            <Sheet c={me} onRename={making ? (n) => edit({ name: n }) : undefined} replies={replies} />
            {making ? <Creator me={me} edit={edit} replies={replies} setReplies={setReplies} /> : <Card c={me} replies={replies} setReplies={setReplies} onDelete={() => remove(me.name)} onChat={() => go({ room: "chat", orb: me.name })} />}
          </div>

          <div style={{ padding: "0 var(--s5)" }}>
            <div style={{ ...s.head, margin: "0 0 var(--s3)" }}>The office</div>
            <Balanced
              min={144}
              gap={12}
              lead={
                <button
                  aria-pressed={making}
                  onClick={() => go({ room: "new" })}
                  style={{ display: "grid", placeItems: "center", alignContent: "center", gap: 4, minHeight: 72, padding: "var(--s3) var(--s2)", border: 0, cursor: "pointer", borderRadius: 18, background: making ? "var(--accent-wash)" : "transparent", boxShadow: "inset 0 0 0 1.5px var(--fill-2)", color: "var(--text-2)", font: "700 15px/20px var(--font)", minWidth: 0 }}
                >
                  <b aria-hidden style={{ font: "800 30px/30px var(--font)", color: "var(--text-3)" }}>+</b>
                  New orb
                </button>
              }
            >
              {office.map((c) => (
                <button
                  key={c.name}
                  data-orb={c.hue}
                  onClick={() => go({ room: "office", orb: c.name })}
                  style={{
                    display: "grid", justifyItems: "center", alignContent: "start", gap: 2, padding: "var(--s3) var(--s2)", border: 0, cursor: "pointer", borderRadius: 18, background: !making && c.name === me.name ? "var(--accent-wash)" : "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", minWidth: 0,
                    animation: leaving === c.name ? "orbs-leave 260ms var(--m-physical) forwards" : arrived === c.name ? "orbs-arrive 520ms var(--m-spring)" : undefined,
                  }}
                >
                  <Orb character={c} size={100} poke={false} style={{ marginBottom: -14 }} />
                  <span style={{ font: "700 15px/20px var(--font)", color: "var(--accent)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  {/* his class, then his manner and his voice: each a line of its own, never wrapped */}
                  <span style={{ font: "600 12px/16px var(--font)", color: "var(--text-2)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{SPECIALTIES[c.specialty].title}</span>
                  <span style={{ font: "400 11px/14px var(--font)", color: "var(--text-3)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {PERSONALITIES[c.personality].label} · {c.voice === "silent" ? "Silent" : voice(c.voice).label}
                  </span>
                </button>
              ))}
            </Balanced>
          </div>
        </section>
        )}
      </div>
      )}
    </main>
  );
}

const style = document.createElement("style");
style.textContent = `${stylesheet(`${import.meta.env.BASE_URL}fonts/Nunito.ttf`)}
/* a phone: the side menu slides in from the left, over a scrim, and a top bar holds Back and the menu */
@media (max-width: 760px) {
  .orbs-window { grid-template-columns: minmax(0, 1fr) !important; overflow: visible !important; }
  .orbs-topbar { display: flex !important; }
  /* closed, it is hidden once it has slid away (out of Tab's reach and a screen reader's), and shown as it slides in */
  .orbs-side { position: fixed; inset: 0 auto 0 0; z-index: 30; width: min(300px, 86vw); overflow-y: auto; translate: -105% 0; visibility: hidden; transition: translate var(--m-slow) var(--m-spring), visibility 0s linear var(--m-slow); box-shadow: 4px 0 24px var(--shadow) !important; }
  .orbs-side[data-open="true"] { translate: 0 0; visibility: visible; transition: translate var(--m-slow) var(--m-spring), visibility 0s; }
  .orbs-scrim { position: fixed; inset: 0; z-index: 29; background: var(--ground); opacity: .72; }
}
@media (min-width: 1100px) { .orbs-pair { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) !important; } }`;
document.head.append(style);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
