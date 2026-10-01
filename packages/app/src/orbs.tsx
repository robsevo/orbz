// Make an orb (PLAN 2.2-2.3): a character creator, the way a game has one, in Ash's own look (his
// chat window: a charcoal card with a sheen, a solid sidebar, his colour only on what is his).
// Every orb is a different Ash: his glass and his liquid, in another shape, with other eyes,
// wearing something, with a personality, a specialty and a voice that go together. Each part has
// its own dice, and one roll does everything; his character sheet says who he turned out to be.
import { StrictMode, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { HUES, stylesheet, type HueName } from "./design/tokens.ts";
import { Orb } from "./orb/Orb.tsx";
import type { Gesture, OrbState } from "./orb/life.ts";
import {
  ASH, EYES, FINISHES, orbName, PERSONALITIES, REPLIES, SHAPES, sheetOf, speaks, SPECIALTIES, surprise, voice, VOICES, WEAR, withPersonality,
  type Character, type EyesName, type FinishName, type PersonalityName, type Replies, type ShapeName, type SpecialtyName, type WearName,
} from "./orb/spec.ts";

const FAMILY: Character[] = [
  ASH,
  { name: "Oscar", personality: "dapper", specialty: "backend", seed: 11, hue: "iris", hue2: null, finish: "glass", shape: "pebble", eyes: "ovals", wear: "top hat", voice: "bm_fable", goo: 0.3 },
  { name: "Luna", personality: "dreamy", specialty: "design", seed: 12, hue: "teal", hue2: "lavender", finish: "glass", shape: "ghost", eyes: "huge", wear: "antenna", voice: "af_sky", goo: 0.9 },
  { name: "Daisy", personality: "cheerful", specialty: "frontend", seed: 13, hue: "rose", hue2: null, finish: "pearl", shape: "teddy", eyes: "happy", wear: "bow", voice: "af_bella", goo: 0.75 },
  { name: "Milo", personality: "curious", specialty: "research", seed: 14, hue: "lime", hue2: null, finish: "glass", shape: "drop", eyes: "big", wear: "sprout", voice: "am_puck", goo: 0.6 },
  { name: "Theo", personality: "sleepy", specialty: "data", seed: 15, hue: "violet", hue2: null, finish: "smoke", shape: "kitty", eyes: "sleepy", wear: "headphones", voice: "af_river", goo: 0.65 },
  { name: "Hazel", personality: "wise", specialty: "planning", seed: 16, hue: "honey", hue2: null, finish: "glass", shape: "moon", eyes: "close", wear: "crown", voice: "bm_george", goo: 0.35 },
  { name: "Rosie", personality: "cozy", specialty: "assistant", seed: 17, hue: "leaf", hue2: null, finish: "glass", shape: "cloud", eyes: "happy", wear: "beanie", voice: "af_heart", goo: 0.8 },
  { name: "Benny", personality: "silly", specialty: "fullstack", seed: 18, hue: "coral", hue2: "marigold", finish: "glass", shape: "bean", eyes: "wink", wear: "party hat", voice: "am_santa", goo: 0.85 },
  { name: "June", personality: "shy", specialty: "writing", seed: 19, hue: "orchid", hue2: null, finish: "pearl", shape: "drop", eyes: "droopy", wear: "flower", voice: "af_nicole", goo: 0.6 },
  { name: "Nico", personality: "techy", specialty: "testing", seed: 20, hue: "amber", hue2: null, finish: "glass", shape: "squircle", eyes: "dots", wear: "glasses", voice: "am_echo", goo: 0.45 },
  { name: "Gus", personality: "grumpy", specialty: "devops", seed: 21, hue: "mint", hue2: null, finish: "black", shape: "cub", eyes: "beans", wear: "beanie", voice: "am_onyx", goo: 0.4 },
];

const MOODS: [OrbState, string][] = [["idle", "Awake"], ["listening", "Listening"], ["thinking", "Thinking"], ["speaking", "Speaking"]];
const GESTURES: [Gesture, string][] = [["hop", "Hop"], ["wiggle", "Wiggle"], ["squish", "Squish"], ["jelly", "Jelly"], ["look", "Look round"], ["pout", "Pout"], ["doze", "Doze"], ["nod", "Nod"]];
const TABS = ["Personality", "Specialty", "Shape", "Eyes", "Wears", "Colour", "Voice"] as const;
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

function Die({ onRoll, label }: { onRoll: () => void; label: string }) {
  return (
    <button onClick={onRoll} aria-label={label} title={label} style={{ ...s.chip, display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-1)" }}>
      <DieIcon />
      {label}
    </button>
  );
}

/** A die, drawn: five pips on a rounded square, in the text's own colour. */
function DieIcon({ size = 16 }: { size?: number }) {
  const pips: [number, number][] = [[5, 5], [11, 5], [8, 8], [5, 11], [11, 11]];
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 16 16" style={{ display: "block", flex: "0 0 auto" }}>
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

function Sheet({ c, onRename, replies }: { c: Character; onRename: (name: string) => void; replies: Replies }) {
  const sh = sheetOf(c);
  const v = voice(c.voice);
  return (
    <div data-orb={c.hue} style={{ ...s.panel, display: "grid", gap: "var(--s4)" }}>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <input
            value={c.name}
            onChange={(e) => onRename(e.target.value.slice(0, 16))}
            aria-label="Name"
            size={1}
            style={{ flex: "1 1 120px", minWidth: 0, font: "800 26px/32px var(--font)", color: "var(--accent)", background: "transparent", border: 0, outline: 0, padding: 0 }}
          />
          <Die label="Name" onRoll={() => onRename(orbName(() => Math.random()))} />
        </div>
        <span style={{ font: "600 15px/20px var(--font)", color: "var(--text-1)" }}>{cap(sh.title)}</span>
        <span style={{ font: "400 13px/18px var(--font)", color: "var(--text-3)" }}>Junior · 0 XP · levels come from finished work you approve</span>
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

function Thumbs<T extends string>({ c, options, field, label, onPick, size = 64 }: { c: Character; options: T[]; field: "shape" | "eyes" | "wear"; label: (o: T) => string; onPick: (o: T) => void; size?: number }) {
  return (
    <div style={{ display: "grid", gap: 8, gridTemplateColumns: `repeat(auto-fill, minmax(${size + 20}px, 1fr))` }}>
      {options.map((o) => {
        const on = c[field] === o;
        return (
          <button key={o} data-pick={o} onClick={() => onPick(o)} aria-pressed={on} style={{ ...chosen(on), border: 0, borderRadius: 14, padding: "6px 4px 8px", cursor: "pointer", display: "grid", justifyItems: "center", gap: 2, minWidth: 0 }}>
            <Orb character={{ ...c, [field]: o }} size={size} still poke={false} />
            <span style={{ font: "600 12px/16px var(--font)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(o)}</span>
          </button>
        );
      })}
    </div>
  );
}

function Cards<K extends string>({ value, entries, onPick }: { value: K; entries: [K, string, string][]; onPick: (k: K) => void }) {
  return (
    <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 190px), 1fr))" }}>
      {entries.map(([k, title, line]) => (
        <button key={k} onClick={() => onPick(k)} aria-pressed={value === k} style={{ ...chosen(value === k), border: 0, borderRadius: 14, padding: "10px 12px", cursor: "pointer", textAlign: "left", display: "grid", gap: 2, minWidth: 0 }}>
          <span style={{ font: "700 14px/20px var(--font)", color: "var(--text-1)" }}>{title}</span>
          <span style={{ font: "400 12px/16px var(--font)", color: "var(--text-3)" }}>{line}</span>
        </button>
      ))}
    </div>
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

function Creator({ me, edit, replies, setReplies }: { me: Character; edit: (p: Partial<Character>) => void; replies: Replies; setReplies: (r: Replies) => void }) {
  const [tab, setTab] = useState<Tab>("Personality");
  const hues = HUES.map((h) => h.name);
  const dice: Record<Tab, () => void> = {
    Personality: () => edit(withPersonality(me, pick(Object.keys(PERSONALITIES) as PersonalityName[]))),
    Specialty: () => edit({ specialty: pick(Object.keys(SPECIALTIES) as SpecialtyName[]) }),
    Shape: () => edit({ shape: pick(Object.keys(SHAPES) as ShapeName[]) }),
    Eyes: () => edit({ eyes: pick(Object.keys(EYES) as EyesName[]) }),
    Wears: () => edit({ wear: pick(Object.keys(WEAR) as WearName[]) }),
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
      <div role="tablist" style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: 3, borderRadius: 12, background: "var(--fill)" }}>
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={{ ...s.chip, borderRadius: 9, background: tab === t ? "var(--fill-2)" : "transparent", color: tab === t ? "var(--text-1)" : "var(--text-3)", boxShadow: tab === t ? "0 1px 3px var(--shadow)" : "none" }}>
            {t}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
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
      {tab === "Eyes" && <Thumbs c={me} options={Object.keys(EYES) as EyesName[]} field="eyes" label={cap} onPick={(eyes) => edit({ eyes })} size={92} />}
      {tab === "Wears" && <Thumbs c={me} options={Object.keys(WEAR) as WearName[]} field="wear" label={cap} onPick={(wear) => edit({ wear })} />}
      {tab === "Colour" && (
        <div style={{ display: "grid", gap: "var(--s4)" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {hues.map((h) => (
              <Swatch key={h} hue={h} size={32} on={me.hue === h} label={h} onPick={() => edit({ hue: h })} />
            ))}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <Head>Finish</Head>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(Object.keys(FINISHES) as FinishName[]).map((f) => (
                <button key={f} onClick={() => edit({ finish: f })} aria-pressed={me.finish === f} style={{ ...s.chip, ...chosen(me.finish === f) }}>
                  {FINISHES[f].label}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <Head>Gradient: a second colour, top to bottom</Head>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <button onClick={() => edit({ hue2: null })} aria-pressed={me.hue2 === null} style={{ ...s.chip, ...chosen(me.hue2 === null) }}>
                None
              </button>
              {hues.map((h) => (
                <Swatch key={h} hue={h} size={24} on={me.hue2 === h} label={`then ${h}`} onPick={() => edit({ hue2: h })} />
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <Head>Goo: {Math.round(me.goo * 100)}%</Head>
            <input type="range" min={0} max={100} value={Math.round(me.goo * 100)} onChange={(e) => edit({ goo: Number(e.target.value) / 100 })} data-orb={me.hue} style={{ accentColor: "var(--accent)", width: "100%", minWidth: 0, margin: 0, display: "block" }} aria-label="How gooey" />
          </div>
        </div>
      )}
      {tab === "Voice" && (
        <div style={{ display: "grid", gap: "var(--s4)" }}>
          <div style={{ display: "grid", gap: 8 }}>
            <Head>Replies, for every orb</Head>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {(Object.keys(REPLIES) as Replies[]).map((r) => (
                <button key={r} onClick={() => setReplies(r)} aria-pressed={replies === r} style={{ ...s.chip, ...chosen(replies === r) }}>
                  {REPLIES[r]}
                </button>
              ))}
            </div>
          </div>
          {voiceGroups.map(([title, vs]) => (
            <div key={title} style={{ display: "grid", gap: 8 }}>
              <Head>{title}</Head>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {vs.map((v) => (
                  <button key={v.id} onClick={() => edit({ voice: v.id })} aria-pressed={me.voice === v.id} title={v.accent} style={{ ...s.chip, ...chosen(me.voice === v.id), display: "grid", textAlign: "left", borderRadius: 12, padding: "6px 12px" }}>
                    <span>{v.label}</span>
                    <span style={{ font: "400 11px/14px var(--font)", color: "var(--text-3)" }}>{v.accent}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function App() {
  const [family, setFamily] = useState(FAMILY);
  const [current, setCurrent] = useState(0);
  const [state, setState] = useState<OrbState>("idle");
  const [gesture, setGesture] = useState<{ name: Gesture; n: number } | null>(null);
  const [replies, setReplies] = useState<Replies>("speak");
  const me = family[current]!;
  const edit = (patch: Partial<Character>): void => setFamily((f) => f.map((c, i) => (i === current ? { ...c, ...patch } : c)));
  const play = (g: Gesture): void => setGesture((x) => ({ name: g, n: (x?.n ?? 0) + 1 }));
  useEffect(() => play("pop"), [current]);

  return (
    <main style={{ padding: "var(--s5) var(--margin)" }}>
      <div className="orbs-window" style={s.window}>
        <aside className="orbs-side" style={s.side}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 var(--s2)", font: "700 12px/20px var(--font)", letterSpacing: ".12em", color: "var(--text-3)" }}>
            <i aria-hidden data-orb={me.hue} style={{ width: 9, height: 9, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, var(--text-1) 0%, var(--accent) 60%)", boxShadow: "0 0 8px var(--accent-glow)" }} />
            ORBS
          </div>
          <button
            style={{ ...s.btn, textAlign: "left", marginTop: "var(--s2)" }}
            onClick={() => {
              setFamily((f) => [...f, surprise(roll())]);
              setCurrent(family.length);
            }}
          >
            <b data-orb={me.hue} style={{ color: "var(--accent)", marginRight: 8 }}>+</b>New orb
          </button>
          <div style={{ ...s.head, margin: "var(--s3) var(--s2) var(--s1)" }}>Your orbs</div>
          <div style={{ display: "grid", gap: 2, overflowY: "auto", minHeight: 0 }}>
            {family.map((c, i) => (
              <button
                key={`${c.name}${i}`}
                data-orb={c.hue}
                onClick={() => setCurrent(i)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px", border: 0, borderRadius: 10, cursor: "pointer", textAlign: "left", background: i === current ? "var(--accent-wash)" : "transparent", color: "var(--text-2)", font: "600 14px/20px var(--font)", minWidth: 0 }}
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
          <div data-orb={me.hue} style={{ display: "grid", justifyItems: "center", gap: "var(--s2)", padding: "var(--s5) var(--s4) 0", background: "radial-gradient(50% 80% at 50% 30%, var(--accent-wash), transparent 70%)" }}>
            <Orb character={me} size={176} state={state} gesture={gesture} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
              {MOODS.map(([m, label]) => (
                <button key={m} onClick={() => setState(m)} aria-pressed={state === m} style={{ ...s.chip, ...chosen(state === m) }}>
                  {label}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", maxWidth: 640 }}>
              {GESTURES.map(([g, label]) => (
                <button key={g} style={s.chip} onClick={() => play(g)}>
                  {label}
                </button>
              ))}
            </div>
            <button
              style={{ ...s.btn, marginTop: "var(--s2)", background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)", fontWeight: 800 }}
              onClick={() => {
                edit(surprise(roll()));
                play("hop");
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <DieIcon size={18} />
                Roll everything
              </span>
            </button>
            <p style={{ margin: 0, font: "400 13px/18px var(--font)", color: "var(--text-3)", textAlign: "center" }}>
              {me.name}, {sheetOf(me).title}. Click him, or move your pointer: he watches.
            </p>
          </div>

          <div style={{ display: "grid", gap: "var(--s4)", padding: "0 var(--s5)", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", alignItems: "start" }}>
            <Sheet c={me} onRename={(name) => edit({ name })} replies={replies} />
            <Creator me={me} edit={edit} replies={replies} setReplies={setReplies} />
          </div>

          <div style={{ padding: "0 var(--s5)" }}>
            <div style={{ ...s.head, margin: "0 0 var(--s3)" }}>The family</div>
            <div style={{ display: "grid", gap: "var(--s3)", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
              {family.map((c, i) => (
                <button
                  key={`${c.name}${i}`}
                  data-orb={c.hue}
                  onClick={() => setCurrent(i)}
                  style={{ display: "grid", justifyItems: "center", gap: 2, padding: "var(--s3) var(--s2)", border: 0, cursor: "pointer", borderRadius: 18, background: i === current ? "var(--accent-wash)" : "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", minWidth: 0 }}
                >
                  <Orb character={c} size={100} poke={false} style={{ marginBottom: -14 }} />
                  <span style={{ font: "700 15px/20px var(--font)", color: "var(--accent)" }}>{c.name}</span>
                  <span style={{ font: "600 12px/16px var(--font)", color: "var(--text-2)", textAlign: "center" }}>{cap(sheetOf(c).title)}</span>
                  <span style={{ font: "400 11px/14px var(--font)", color: "var(--text-3)" }}>{c.voice === "silent" ? "Silent" : voice(c.voice).label}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

const style = document.createElement("style");
style.textContent = `${stylesheet(`${import.meta.env.BASE_URL}fonts/Nunito.ttf`)}
@media (max-width: 760px) { .orbs-window { grid-template-columns: minmax(0, 1fr) !important; } .orbs-side { display: none !important; } }`;
document.head.append(style);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
