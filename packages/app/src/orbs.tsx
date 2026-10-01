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
import { installFeel } from "./ui/feel.ts";
import { setSounds, soundsOn } from "./ui/sound.ts";
import type { Gesture, OrbState } from "./orb/life.ts";
import {
  ASH, EYES, FINISHES, GLASSES, HATS, orbName, PERSONALITIES, REPLIES, SHAPES, sheetOf, speaks, SPECIALTIES, surprise, voice, VOICES, withPersonality,
  type Character, type EyesName, type FinishName, type GlassesName, type HatName, type PersonalityName, type Replies, type ShapeName, type SpecialtyName,
} from "./orb/spec.ts";

const OFFICE: Character[] = [
  ASH,
  { name: "Oscar", personality: "dapper", specialty: "backend", seed: 11, hue: "iris", hue2: null, finish: "glass", shape: "pebble", eyes: "ovals", hat: "top hat", glasses: "monocle", voice: "bm_fable", goo: 0.3 },
  { name: "Luna", personality: "dreamy", specialty: "design", seed: 12, hue: "teal", hue2: "lavender", finish: "glass", shape: "ghost", eyes: "huge", hat: "antenna", glasses: "cat-eye", voice: "af_sky", goo: 0.9 },
  { name: "Daisy", personality: "cheerful", specialty: "frontend", seed: 13, hue: "rose", hue2: null, finish: "pearl", shape: "teddy", eyes: "happy", hat: "bow", glasses: "hearts", voice: "af_bella", goo: 0.75 },
  { name: "Milo", personality: "curious", specialty: "research", seed: 14, hue: "lime", hue2: null, finish: "glass", shape: "drop", eyes: "big", hat: "sprout", glasses: "big round", voice: "am_puck", goo: 0.6 },
  { name: "Theo", personality: "sleepy", specialty: "data", seed: 15, hue: "violet", hue2: null, finish: "smoke", shape: "kitty", eyes: "sleepy", hat: "headphones", glasses: "none", voice: "af_river", goo: 0.65 },
  { name: "Hazel", personality: "wise", specialty: "planning", seed: 16, hue: "honey", hue2: null, finish: "glass", shape: "moon", eyes: "close", hat: "crown", glasses: "reading", voice: "bm_george", goo: 0.35 },
  { name: "Rosie", personality: "cozy", specialty: "assistant", seed: 17, hue: "leaf", hue2: null, finish: "glass", shape: "cloud", eyes: "happy", hat: "beanie", glasses: "none", voice: "af_heart", goo: 0.8 },
  { name: "Benny", personality: "silly", specialty: "fullstack", seed: 18, hue: "coral", hue2: "marigold", finish: "glass", shape: "bean", eyes: "wink", hat: "party hat", glasses: "stars", voice: "am_santa", goo: 0.85 },
  { name: "June", personality: "shy", specialty: "writing", seed: 19, hue: "orchid", hue2: null, finish: "pearl", shape: "drop", eyes: "droopy", hat: "flower", glasses: "round", voice: "af_nicole", goo: 0.6 },
  { name: "Nico", personality: "techy", specialty: "testing", seed: 20, hue: "amber", hue2: null, finish: "glass", shape: "squircle", eyes: "dots", hat: "none", glasses: "goggles", voice: "am_echo", goo: 0.45 },
  { name: "Gus", personality: "grumpy", specialty: "devops", seed: 21, hue: "mint", hue2: null, finish: "black", shape: "cub", eyes: "beans", hat: "hard hat", glasses: "shades", voice: "am_onyx", goo: 0.4 },
];

const MOODS: [OrbState, string][] = [["idle", "Awake"], ["listening", "Listening"], ["thinking", "Thinking"], ["speaking", "Speaking"]];
const GESTURES: [Gesture, string][] = [["hop", "Hop"], ["wiggle", "Wiggle"], ["squish", "Squish"], ["jelly", "Jelly"], ["look", "Look round"], ["pout", "Pout"], ["doze", "Doze"], ["nod", "Nod"]];
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

function Thumbs<T extends string>({ c, options, field, label, onPick, size = 64, face = false }: { c: Character; options: T[]; field: "shape" | "eyes" | "hat" | "glasses"; label: (o: T) => string; onPick: (o: T) => void; size?: number; face?: boolean }) {
  return (
    <Balanced min={size + 20}>
      {options.map((o) => {
        const on = c[field] === o;
        return (
          <button key={o} data-pick={o} onClick={() => onPick(o)} aria-pressed={on} style={{ ...chosen(on), border: 0, borderRadius: 14, padding: "6px 4px 8px", cursor: "pointer", display: "grid", justifyItems: "center", gap: 2, minWidth: 0 }}>
            <Orb character={{ ...c, [field]: o }} size={size} still poke={false} framing={face ? "portrait" : "window"} />
            <span style={{ font: "600 12px/16px var(--font)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(o)}</span>
          </button>
        );
      })}
    </Balanced>
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
    Hat: () => edit({ hat: pick(Object.keys(HATS) as HatName[]) }),
    Glasses: () => edit({ glasses: pick(Object.keys(GLASSES) as GlassesName[]) }),
    Colour: () => edit({ hue: pick(hues), hue2: Math.random() < 0.25 ? pick(hues) : null, finish: Math.random() < 0.7 ? "glass" : pick(Object.keys(FINISHES) as FinishName[]) }),
    Voice: () => edit({ voice: pick(VOICES.filter((v) => v.english && v.id !== "ash" && v.id !== "silent").map((v) => v.id)) }),
  };
  const P = PERSONALITIES[me.personality];
  const voiceGroups: [string, typeof VOICES][] = [
    [`Suits a ${P.label.toLowerCase()} orb`, VOICES.filter((v) => (P.voices as readonly string[]).includes(v.id))],
    ["American", VOICES.filter((v) => v.accent.startsWith("American"))],
    ["British", VOICES.filter((v) => v.accent.startsWith("British"))],
    ["In their own language (English for these comes with the voice row)", VOICES.filter((v) => !v.english)],
    ["Ash's own, or none", VOICES.filter((v) => v.id === "silent" || v.id === "ash")],
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
        <Cards value={me.specialty} entries={(Object.keys(SPECIALTIES) as SpecialtyName[]).map((k) => [k, SPECIALTIES[k].label, cap(SPECIALTIES[k].focus)])} onPick={(specialty) => edit({ specialty })} />
      )}
      {tab === "Shape" && <Thumbs c={me} options={Object.keys(SHAPES) as ShapeName[]} field="shape" label={cap} onPick={(shape) => edit({ shape })} />}
      {tab === "Eyes" && <Thumbs c={me} options={Object.keys(EYES) as EyesName[]} field="eyes" label={cap} onPick={(eyes) => edit({ eyes })} size={88} face />}
      {tab === "Hat" && <Thumbs c={me} options={Object.keys(HATS) as HatName[]} field="hat" label={cap} onPick={(hat) => edit({ hat })} />}
      {tab === "Glasses" && <Thumbs c={me} options={Object.keys(GLASSES) as GlassesName[]} field="glasses" label={cap} onPick={(glasses) => edit({ glasses })} size={88} face />}
      {tab === "Colour" && (
        <div style={{ display: "grid", gap: "var(--s4)" }}>
          <Balanced min={32} style={{ justifyItems: "center" }}>
            {hues.map((h) => (
              <Swatch key={h} hue={h} size={32} on={me.hue === h} label={h} onPick={() => edit({ hue: h })} />
            ))}
          </Balanced>
          <div style={{ display: "grid", gap: 8 }}>
            <Head>Finish</Head>
            <OneLine style={{ justifyContent: "flex-start" }}>
              {(Object.keys(FINISHES) as FinishName[]).map((f) => (
                <button key={f} onClick={() => edit({ finish: f })} aria-pressed={me.finish === f} style={{ ...s.chip, ...chosen(me.finish === f) }}>
                  {FINISHES[f].label}
                </button>
              ))}
            </OneLine>
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
function Card({ c, replies, setReplies, onDelete }: { c: Character; replies: Replies; setReplies: (r: Replies) => void; onDelete: () => void }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => setAsking(false), [c.name]);
  const facts: [string, string][] = [
    ["Personality", PERSONALITIES[c.personality].label],
    ["Specialty", SPECIALTIES[c.specialty].label],
    ["Shape", cap(c.shape)],
    ["Eyes", cap(c.eyes)],
    ["Hat", c.hat === "none" ? "None" : cap(c.hat)],
    ["Glasses", c.glasses === "none" ? "None" : cap(c.glasses)],
    ["Colour", c.hue2 ? `${cap(c.hue)} to ${c.hue2}` : cap(c.hue)],
    ["Finish", FINISHES[c.finish].label],
    ["Voice", c.voice === "silent" ? "Silent" : voice(c.voice).label],
  ];
  return (
    <div data-orb={c.hue} style={{ ...s.panel, display: "grid", gap: "var(--s4)", alignContent: "start" }}>
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
  const [office, setOffice] = useState(OFFICE);
  const [view, setView] = useState<View>({ kind: "orb", name: OFFICE[0]!.name });
  const [state, setState] = useState<OrbState>("idle");
  const [gesture, setGesture] = useState<{ name: Gesture; n: number } | null>(null);
  const [replies, setReplies] = useState<Replies>("speak");
  const [sounds, setSoundsShown] = useState(soundsOn());
  const [leaving, setLeaving] = useState<string | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  const [rolls, setRolls] = useState(0);
  const lastReact = useRef(0);
  useEffect(installFeel, []);

  const making = view.kind === "new";
  const at = view.kind === "orb" ? Math.max(0, office.findIndex((c) => c.name === view.name)) : -1;
  const me = view.kind === "new" ? view.draft : office[at]!;
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
    setArrived(made.name);
    setView({ kind: "orb", name: made.name });
    window.setTimeout(() => play("hop"), 120);
  };
  const remove = (who: string): void => {
    const i = office.findIndex((c) => c.name === who);
    const rest = office.filter((c) => c.name !== who);
    setLeaving(who);
    window.setTimeout(() => {
      setLeaving(null);
      setOffice(rest);
      setView(rest.length ? { kind: "orb", name: rest[Math.max(0, i - 1)]!.name } : { kind: "new", draft: surprise(roll()) });
    }, 260);
  };
  const flipSounds = (): void => {
    setSounds(!sounds);
    setSoundsShown(!sounds);
  };

  return (
    <main style={{ padding: "var(--s5) var(--margin)" }}>
      <div className="orbs-window" style={s.window}>
        <aside className="orbs-side" style={s.side}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 var(--s2)", font: "700 12px/20px var(--font)", letterSpacing: ".12em", color: "var(--text-3)" }}>
            <i aria-hidden data-orb={me.hue} style={{ width: 9, height: 9, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, var(--text-1) 0%, var(--accent) 60%)", boxShadow: "0 0 8px var(--accent-glow)" }} />
            ORBS
          </div>
          <button aria-pressed={making} onClick={() => setView({ kind: "new", draft: fresh() })} style={{ ...s.btn, ...(making ? chosen(true) : {}), textAlign: "left", marginTop: "var(--s2)" }}>
            <b data-orb={me.hue} style={{ color: "var(--accent)", marginRight: 8 }}>+</b>New orb
          </button>
          <div style={{ ...s.head, margin: "var(--s3) var(--s2) var(--s1)" }}>The office</div>
          <div style={{ display: "grid", gap: 2, overflowY: "auto", minHeight: 0 }}>
            {office.map((c) => (
              <button
                key={c.name}
                data-orb={c.hue}
                onClick={() => setView({ kind: "orb", name: c.name })}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px", border: 0, borderRadius: 10, cursor: "pointer", textAlign: "left", background: !making && c.name === me.name ? "var(--accent-wash)" : "transparent", color: "var(--text-2)", font: "600 14px/20px var(--font)", minWidth: 0 }}
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

        <section style={{ minWidth: 0, display: "grid", alignContent: "start", gap: "var(--s5)", padding: "0 0 var(--s6)" }}>
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
            {making ? <Creator me={me} edit={edit} replies={replies} setReplies={setReplies} /> : <Card c={me} replies={replies} setReplies={setReplies} onDelete={() => remove(me.name)} />}
          </div>

          <div style={{ padding: "0 var(--s5)" }}>
            <div style={{ ...s.head, margin: "0 0 var(--s3)" }}>The office</div>
            <Balanced
              min={144}
              gap={12}
              lead={
                <button
                  aria-pressed={making}
                  onClick={() => setView({ kind: "new", draft: fresh() })}
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
                  onClick={() => setView({ kind: "orb", name: c.name })}
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
      </div>
    </main>
  );
}

const style = document.createElement("style");
style.textContent = `${stylesheet(`${import.meta.env.BASE_URL}fonts/Nunito.ttf`)}
@media (max-width: 760px) { .orbs-window { grid-template-columns: minmax(0, 1fr) !important; } .orbs-side { display: none !important; } }
@media (min-width: 1100px) { .orbs-pair { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) !important; } }`;
document.head.append(style);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
