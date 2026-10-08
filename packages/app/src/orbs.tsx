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
import { HUES, MATERIALS, stylesheet, type HueName } from "./design/tokens.ts";
import { hex } from "./design/color.ts";
import { Orb } from "./orb/Orb.tsx";
import { DESIGN } from "./orb/renderer.ts";
import { CEILING, dnaOf, grownOf, grownSays, type Growth, type Move, TOTAL } from "./orb/dna.ts";
import { readStrand, shareOf, strandOf } from "./orb/strand.ts";
import { Balanced, OneLine, SideScroll, Tall } from "./ui/Balanced.tsx";
import { Paged } from "./ui/Paged.tsx";
import { installFeel } from "./ui/feel.ts";
import { noFieldZoom } from "./ui/zoom.ts";
import { setSounds, soundsOn } from "./ui/sound.ts";
import { Splash, splashWanted } from "./ui/Splash.tsx";
import { Onboarding } from "./onboarding/Onboarding.tsx";
import { introWanted, loadPerson, savePerson, type Person } from "./onboarding/story.ts";
import { parseRoute, routeHash, type Route } from "./ui/nav.ts";
import { Settings } from "./rooms/Settings.tsx";
import { SessionsRoom } from "./rooms/Sessions.tsx";
import { NoticesRoom, useNotices } from "./rooms/Notices.tsx";
import { CalendarRoom } from "./rooms/Calendar.tsx";
import { LabRoom } from "./rooms/Lab.tsx";
import { Chat } from "./rooms/Chat.tsx";
import { type CareerState, connect, type Friend, idOf, keepOffice, keptOffice, type Office, passkeysHere, signInWithPasskey, type Standing, type Tab as SessionTab } from "./home/link.ts";
import { DEMO_CREW } from "./orb/demo.ts";
import { NEWBORN, TOUR } from "./onboarding/story.ts";
import { headOf, nextFounding, openDepartments, whyNot } from "./orb/company.ts";
import type { Gesture, OrbState } from "./orb/life.ts";
import { useMood, useMoods, WORN } from "./orb/useMood.ts";
import { preview, stopPreview } from "./orb/preview.ts";
import { span } from "./orb/age.ts";
import { Radar } from "./ui/Radar.tsx";
import { ReportRoom } from "./rooms/Report.tsx";
import { useCramped } from "./ui/fill.ts";
import { OrgRoom } from "./rooms/Org.tsx";
import { CareerRoom } from "./rooms/Career.tsx";
import { HomeRoom } from "./rooms/Home.tsx";
import { RecruiterRoom } from "./rooms/Recruiter.tsx";
import { Floor } from "./floor/Floor.tsx";
import { applyTheme, savedTheme } from "./ui/theme.ts";

applyTheme(savedTheme(), false); // before the first paint: the theme you chose, never a flash of another
noFieldZoom(document, navigator); // an iPhone does not zoom into a text box (owner, 10-07)
import {
  ASH, EYES, FAMILIES, FINISHES, GLASSES, HATS, offered, orbName, partnerOf, type Scheme, SCHEMES, type AccessoryHue, PERSONALITIES, REPLIES, SHAPES, sheetOf, speaks, SPECIALTIES, surprise, voice, VOICES, withPersonality,
  type Character, type EyesName, type Family, type FinishName, type GlassesName, type HatName, type PersonalityName, type Replies, type ShapeName, type SpecialtyName,
} from "./orb/spec.ts";



const MOODS: [OrbState, string][] = [["idle", "Awake"], ["listening", "Listening"], ["thinking", "Thinking"], ["speaking", "Speaking"]];
const GESTURES: [Gesture, string][] = [["hop", "Hop"], ["wink", "Wink"], ["wiggle", "Wiggle"], ["squish", "Squish"], ["jelly", "Jelly"], ["look", "Look round"], ["pout", "Pout"], ["doze", "Doze"], ["nod", "Nod"]];
const TABS = ["Personality", "Specialty", "Shape", "Eyes", "Hat", "Glasses", "Colour", "Voice"] as const;
type Tab = (typeof TABS)[number];
const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);
const roll = (): number => Math.floor(Math.random() * 1e6);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

// the tour your CEO gives once made (owner, 10-07), played once on this device
const TOURED = "orbs.toured";
const toured = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(TOURED) === "1";
  } catch {
    return false;
  }
};
const setToured = (): void => {
  try {
    globalThis.localStorage?.setItem(TOURED, "1");
  } catch {
    // a private window: it plays again next time
  }
};

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
  panel: { background: "var(--fill)", borderRadius: 18, boxShadow: "inset 0 0 0 1px var(--hairline)", padding: "var(--s4)", minWidth: 0, gridTemplateColumns: "minmax(0, 1fr)" },
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

// ── Roll everything, as a change (owner, 10-04: "a cooler animation when pressing rolling everything?
// kind of like a pokemon evolving", then "it like stutters, make it fluid. 3 or four second evolve fade
// out to the orb", then "just a bit quicker"): he goes white and glowing, the old shape melts into the
// new one as he breathes twice, a soft flash and a ring of sparks, then the white fades away to the new
// orb, who hops; 2.4 s in all. One smooth line, no flicker; still for anyone who asked for less motion. The frames are set
// straight on the elements, so nothing is redrawn but what moves.
const EVOLVE_MS = 2400; // owner, 10-04: "just a bit quicker" than 3.6 s
const REVEAL = 1800; // the hop, as his colours come back
const calm = (): boolean => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (x: number): number => { const k = clamp01(x); return k * k * (3 - 2 * k); };
const easeOut = (x: number): number => 1 - (1 - clamp01(x)) ** 3;
const SPARK = "M0 -6 C.8 -1.6 1.6 -.8 6 0 C1.6 .8 .8 1.6 0 6 C-.8 1.6 -1.6 .8 -6 0 C-1.6 -.8 -.8 -1.6 0 -6 Z";

/** The change, `t` ms in: how white he is, how much of the new one shows, his size, the flash and sparks. */
export function evolveAt(t: number): { white: number; next: number; scale: number; glow: number; burst: number } {
  const white = t < 1750 ? smooth(t / 420) : 1 - easeOut((t - 1750) / 650); // in over 0.4 s, out over the last 0.65 s
  const next = smooth((t - 450) / 1150); // the old shape melting into the new, 0.45 to 1.6 s
  const env = Math.sin(Math.PI * clamp01((t - 350) / 1350)); // two breaths, swelling and settling
  const scale = 1 + 0.05 * white + 0.035 * env * Math.sin(((t - 350) / 675) * 2 * Math.PI);
  return { white, next, scale, glow: 10 * white + 8 * env, burst: (t - 1550) / 550 };
}

/** The cradle's orb: as he is, or changing from `from` into him. */
function Evolving({ me, from, size, state, gesture, onDone }: { me: Character; from: { c: Character; n: number } | null; size: number; state: OrbState; gesture: { name: Gesture; n: number } | null; onDone?: (n: number) => void }) {
  // changing from the roll's press until its last frame: worked out as he renders, so the very render
  // that changes him already knows (no pop, who he was drawn behind)
  const [done, setDone] = useState(from?.n ?? 0);
  const was = from && from.n !== done && !calm() ? from.c : null;
  const mine = useRef<HTMLSpanElement>(null);
  const old = useRef<HTMLSpanElement>(null);
  const light = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!from || from.n === done) return;
    if (calm()) return void (setDone(from.n), onDone?.(from.n));
    const start = performance.now();
    let raf = 0;
    const tick = (): void => {
      const t = performance.now() - start;
      const f = evolveAt(t);
      const look = `contrast(${1 - f.white}) brightness(${1 + f.white}) drop-shadow(0 0 ${f.glow.toFixed(1)}px var(--flash-glow))`;
      for (const [el, shown] of [[mine.current, f.next], [old.current, 1 - f.next]] as const) {
        if (!el) continue;
        el.style.filter = look;
        el.style.opacity = shown.toFixed(3);
        el.style.transform = `scale(${f.scale.toFixed(4)})`;
      }
      const l = light.current;
      if (l) {
        const b = f.burst;
        l.style.opacity = b > 0 && b < 1 ? "1" : "0";
        const glow = l.firstElementChild as HTMLElement | null;
        if (glow) {
          glow.style.transform = `scale(${(0.3 + 1.7 * easeOut(b)).toFixed(3)})`;
          glow.style.opacity = (1 - smooth(b)).toFixed(3);
        }
        [...l.querySelectorAll<SVGElement>("svg")].forEach((sv, i) => {
          const a = (i / 8) * Math.PI * 2 + 0.4;
          const r = 0.18 + 0.52 * easeOut(b * 1.1) * (i % 2 ? 0.82 : 1);
          sv.style.transform = `translate(${(Math.cos(a) * r * size).toFixed(1)}px, ${(Math.sin(a) * r * size).toFixed(1)}px) scale(${(1.3 - 0.6 * clamp01(b)).toFixed(3)}) rotate(${(clamp01(b) * 90).toFixed(1)}deg)`;
          sv.style.opacity = (1 - clamp01(b) ** 2).toFixed(3);
        });
      }
      if (t < EVOLVE_MS) raf = requestAnimationFrame(tick);
      else {
        // he is himself again; who he was stays out of sight until React takes him away (cleared, he would
        // show over the new one for a frame: owner, 10-04, "it glitches back to the new one after")
        if (mine.current) mine.current.style.filter = mine.current.style.opacity = mine.current.style.transform = "";
        if (old.current) old.current.style.opacity = "0";
        setDone(from.n);
        onDone?.(from.n);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (mine.current) mine.current.style.filter = mine.current.style.opacity = mine.current.style.transform = "";
      // left before the end (another room, say): the change counts as over, so his card is his again
      onDone?.(from.n);
    };
  }, [from?.n]);
  const h = (size * DESIGN.h) / DESIGN.w;
  const cy = h * DESIGN.cy; // his centre, where the flash comes from
  return (
    <span data-evolve={was ? "changing" : undefined} style={{ position: "relative", display: "grid", width: size, height: h }}>
      <span ref={mine} style={{ gridArea: "1 / 1", display: "block", willChange: was ? "transform, opacity, filter" : undefined }}>
        {/* no pop when he changes: the change is the show */}
        <Orb character={me} size={size} state={state} gesture={gesture} pop={!was} />
      </span>
      {was && (
        // who he was, for the change: not pressable, and not read out as a second orb
        <span ref={old} aria-hidden style={{ gridArea: "1 / 1", display: "block", pointerEvents: "none", willChange: "transform, opacity, filter" }}>
          <Orb character={was} size={size} state={state} poke={false} pop={false} />
        </span>
      )}
      {was && (
        <span ref={light} aria-hidden style={{ position: "absolute", left: 0, top: 0, width: size, height: h, pointerEvents: "none", opacity: 0 }}>
          <span style={{ position: "absolute", left: size / 2 - size * 0.45, top: cy - size * 0.45, width: size * 0.9, height: size * 0.9, borderRadius: "50%", background: "radial-gradient(circle, var(--flash) 0%, var(--flash-mid) 34%, var(--flash-none) 70%)" }} />
          {Array.from({ length: 8 }, (_, i) => (
            <svg key={i} width="14" height="14" viewBox="-7 -7 14 14" style={{ position: "absolute", left: size / 2 - 7, top: cy - 7, filter: "drop-shadow(0 0 4px var(--accent))", overflow: "visible" }}>
              <path d={SPARK} fill="var(--flash)" />
            </svg>
          ))}
        </span>
      )}
    </span>
  );
}

function Head({ children }: { children: ReactNode }) {
  return <span style={s.head}>{children}</span>;
}

/** His traits (his DNA, orb/dna.ts): each out of the ceiling, a tick where his nature put it, and how
 * far everything he is moved it. They always add up to the same total. */
/** Office life (PLAN 5.9): how it gets on with each colleague, from their time together (the home's),
 * best friends first; a bar from the middle, the accent for friends and the alert for friction. */
const MOMENT: Record<string, string> = { coffee: "Had a coffee together", ideas: "Swapped ideas", game: "Played a game", lesson: "A lesson between them" };
function Colleagues({ me, friends }: { me: string; friends: Friend[] }) {
  const day = (t: number): string => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const momentOf = (f: Friend): string | null => {
    const m = f.last;
    if (!m) return null;
    const what = m.kind === "game" ? `${m.place === "arcade" ? "Played at the arcade" : "Played ping-pong"}${m.winner ? `: ${m.winner === f.orb ? f.name : me} won` : ""}` : MOMENT[m.kind] ?? "Met";
    return `${what} · ${day(m.at)}`;
  };
  return (
    <div data-colleagues style={{ display: "grid", gap: "var(--s2)" }}>
      <Head>In the office</Head>
      {friends.map((f) => {
        const half = Math.min(50, Math.abs(f.score) / 2);
        const tone = f.score >= 20 ? "var(--accent)" : f.score <= -20 ? "var(--alert)" : "var(--text-3)";
        return (
          <div key={f.orb} data-friend={f.name} data-score={f.score} style={{ display: "grid", gap: 3, minWidth: 0 }}>
            <span style={{ display: "flex", justifyContent: "space-between", gap: 8, font: "600 13px/18px var(--font)", color: "var(--text-1)", minWidth: 0 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
              <span style={{ color: tone, whiteSpace: "nowrap" }}>{f.word.charAt(0).toUpperCase() + f.word.slice(1)}</span>
            </span>
            <span aria-hidden style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--fill)" }}>
              <i style={{ position: "absolute", top: 0, bottom: 0, left: f.score >= 0 ? "50%" : `${50 - half}%`, width: `${half}%`, borderRadius: 3, background: tone }} />
              <i style={{ position: "absolute", top: -1, bottom: -1, left: "50%", width: 1, background: "var(--hairline)" }} />
            </span>
            {momentOf(f) && <span style={{ font: "400 12px/16px var(--font)", color: "var(--text-3)" }}>{momentOf(f)}</span>}
          </div>
        );
      })}
    </div>
  );
}

function Bars({ items, max = CEILING, kind = "traits" }: { items: { name: string; value: number; nature: number }[]; max?: number; kind?: "traits" | "skills" }) {
  return (
    <div data-traits={kind === "traits" ? "" : undefined} data-skills={kind === "skills" ? "" : undefined} style={{ display: "grid", gap: 6 }}>
      {items.map((t) => {
        const moved = Math.round((t.value - t.nature) * 10) / 10;
        return (
          <div key={t.name} data-trait={t.name} style={{ display: "grid", gridTemplateColumns: "84px 1fr 22px 26px", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ font: "600 12px/16px var(--font)", color: "var(--text-3)" }}>{t.name}</span>
            <span style={{ display: "grid", alignItems: "center", height: 16 }}>
              <span role="img" aria-label={`${t.name} ${t.value} of ${max}${moved ? `, ${moved > 0 ? "up" : "down"} ${Math.abs(moved)} from ${kind === "traits" ? "its nature" : "where it started"}` : ""}`} style={{ position: "relative", height: 6, borderRadius: 3, background: "var(--fill-2)" }}>
                <i style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(t.value / max) * 100}%`, borderRadius: 3, background: "var(--accent)", transition: "width var(--m-base) var(--m-spring)" }} />
                <i aria-hidden style={{ position: "absolute", top: -3, bottom: -3, left: `calc(${(t.nature / max) * 100}% - 1px)`, width: 2, borderRadius: 1, background: "var(--text-2)" }} />
              </span>
            </span>
            {/* the number in a column of its own, every one under the last; what moved it beside it (owner, 10-04) */}
            <span className="num" style={{ font: "600 12px/16px var(--font)", color: "var(--text-2)", textAlign: "right", whiteSpace: "nowrap" }}>{Math.round(t.value)}</span>
            <span className="num" style={{ minHeight: 16, font: "600 12px/16px var(--font)", color: moved > 0 ? "var(--accent)" : "var(--text-3)", whiteSpace: "nowrap" }}>{moved !== 0 ? `${moved > 0 ? "+" : "−"}${Math.abs(Math.round(moved))}` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

/** His DNA strand (owner, 10-04: "a unique dna strand number or string the user gets and can share with
 * others or recreate the orb in question"): everything he is made of, to copy and share; pasted into
 * the creator, it makes him again (orb/strand.ts). */
function Strand({ c }: { c: Character }) {
  const [copied, setCopied] = useState(false);
  let strand: string | null = null;
  try {
    strand = strandOf(c);
  } catch {
    return null; // an orb from before strands, with dice too big for one: nothing to share
  }
  const copy = (): void => {
    const text = shareOf(c);
    void (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error("no clipboard"))).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <div data-strand style={{ display: "grid", gap: 4 }}>
      <Head>DNA</Head>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <span data-dna style={{ padding: "6px 12px", borderRadius: 999, background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", font: "700 13px/20px var(--font)", color: "var(--text-1)", letterSpacing: ".04em", fontVariantNumeric: "tabular-nums", userSelect: "all", overflowWrap: "anywhere" }}>{strand}</span>
        <button onClick={copy} data-sound="pick" style={{ ...s.chip, padding: "4px 12px" }}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <span style={{ font: "400 12px/16px var(--font)", color: "var(--text-3)" }}>Share it: pasted into New orb, it makes {c.name || "this orb"} again, traits and all.</span>
    </div>
  );
}

/** What shaped him: the biggest moves of his DNA, a clash first, each what it gave and what it took, as
 * two small tags. */
function Shaped({ c, moves }: { c: Character; moves: Move[] }) {
  const top = [...moves].sort((a, b) => Number(Boolean(b.clash)) - Number(Boolean(a.clash)) || b.n - a.n).slice(0, 5);
  const tag: CSSProperties = { display: "inline-block", padding: "1px 7px", borderRadius: 999, font: "700 11px/16px var(--font)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
  return (
    <div data-shaped style={{ display: "grid", gap: 8 }}>
      <Head>What shaped {c.name || "your orb"}</Head>
      {top.map((m, i) => (
        <div key={i} data-move={m.clash ? "clash" : "choice"} style={{ display: "grid", gap: 4 }}>
          <span style={{ font: "400 13px/18px var(--font)", color: "var(--text-2)", textWrap: "pretty" }}>
            {m.clash && <span style={{ ...tag, marginRight: 6, color: "var(--ground)", background: "var(--accent)" }}>Clash</span>}
            {cap(m.why)}
          </span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {/* the text in the body's colour on the orb's tint and ring: the hue itself as text fails contrast on light orbs (honey, 10-05) */}
            <span style={{ ...tag, color: "var(--text-1)", background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1px var(--accent)" }}>+{m.n} {m.to}</span>
            <span style={{ ...tag, color: "var(--text-2)", background: "var(--fill)" }}>−{m.n} {m.from}</span>
          </span>
        </div>
      ))}
    </div>
  );
}


/** His level, Pokémon's way (owner, 10-04: "they should level up like pokemon"): Lv. N and how far to the
 * next; the first time he is seen at a new level, a card says so and what it gave him. Which level was
 * last seen is this device's. */
function LevelUp({ c, g }: { c: Character; g: Growth }) {
  const key = `orbs.seenLevel.${c.name.toLowerCase()}`;
  const [fresh] = useState(() => {
    try {
      const seen = Number(localStorage.getItem(key) ?? "0");
      localStorage.setItem(key, String(g.level.level));
      return seen > 0 && g.level.level > seen ? seen : null;
    } catch {
      return null;
    }
  });
  const [open, setOpen] = useState(fresh !== null);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => setOpen(false), 6000);
    return () => window.clearTimeout(t);
  }, [open]);
  const span = g.level.next === null ? 1 : g.level.next - g.level.at;
  const into = g.level.next === null ? 1 : (g.level.xp - g.level.at) / span;
  const gave = [...Object.entries(g.last.traits).map(([k, n]) => `+${n} ${k}`), ...Object.entries(g.last.skills).map(([k, n]) => `+${n} ${k}`)];
  return (
    <div data-level={g.level.level} style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ padding: "2px 10px", borderRadius: 999, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1px var(--accent)", font: "800 13px/20px var(--font)", color: "var(--text-1)" }}>Lv. {g.level.level}</span>
        <span role="progressbar" aria-label={`Level ${g.level.level}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(into * 100)} style={{ position: "relative", flex: "1 1 auto", height: 6, borderRadius: 3, background: "var(--fill-2)" }}>
          <i style={{ position: "absolute", inset: 0, width: `${Math.round(into * 100)}%`, borderRadius: 3, background: "var(--accent)" }} />
        </span>
        <span className="num" style={{ font: "600 12px/16px var(--font)", color: "var(--text-3)", whiteSpace: "nowrap" }}>{g.level.next === null ? "top level" : `${(g.level.next - g.level.xp).toLocaleString("en-GB")} XP to Lv. ${g.level.level + 1}`}</span>
      </div>
      {open && (
        <div role="status" data-level-up style={{ display: "grid", gap: 4, padding: "10px 14px", borderRadius: 14, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)", animation: "orbs-stamp 520ms var(--m-spring)" }}>
          <span style={{ font: "800 16px/22px var(--font)", color: "var(--text-1)" }}>{c.name} grew to Lv. {g.level.level}!</span>
          {gave.length > 0 && <span style={{ font: "600 13px/18px var(--font)", color: "var(--text-2)" }}>{gave.join(" · ")}</span>}
        </div>
      )}
    </div>
  );
}

// `applying`: an applicant's profile, from the Recruiter (owner, 10-05: "recruiter should also be able to show
// the orbs profile when we click on it")
function Sheet({ c, onRename, replies, standing, startsAs, career, applying, friends, onChat, onCareer }: { c: Character; onRename?: (name: string) => void; replies: Replies; standing?: Standing | null; startsAs?: "Junior" | "Senior"; career?: CareerState | null; applying?: boolean; friends?: Friend[] | null; onChat?: () => void; onCareer?: () => void }) {
  const sh = sheetOf(c);
  // what his graded work has grown him into (PLAN 3.11), once a home has some to show
  const grown = career ? grownOf(c, sh.leans, career.radar, career.niches, sh.dna, standing?.xp ?? career.xp) : null;
  const grew = grown && grown.level.level > 1 ? grown : null; // grown past where every orb starts
  const v = voice(c.voice);
  const name = { font: "800 26px/32px var(--font)", color: "var(--accent)" } satisfies CSSProperties;
  return (
    <div data-orb={c.hue} className="orbs-sheet" style={{ ...s.panel, display: "grid", gap: "var(--s4)" }}>
      <div style={{ display: "grid", gap: 4 }}>
        {onRename ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              value={c.name}
              onChange={(e) => onRename(e.target.value.slice(0, 16))}
              aria-label="Name"
              placeholder="Name"
              size={1}
              style={{ ...name, flex: "1 1 120px", minWidth: 0, background: "transparent", border: 0, outline: 0, padding: 0 }}
            />
            <Die label="Name" said="Roll a name" onRoll={() => onRename(orbName(() => Math.random()))} />
          </div>
        ) : (
          // its name, and beside it Chat and its career, small (owner, 10-07: "put chat and career for orb on orb page
          // next to the orbs name, but just put chat and career as smaller buttons")
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <h2 style={{ ...name, margin: 0, flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</h2>
            {onChat && (
              <button data-sound="pick" data-chat-with aria-label={`Chat with ${c.name}`} onClick={onChat} style={{ ...s.chip, flex: "0 0 auto", background: "var(--accent)", color: "var(--ground)", fontWeight: 800 }}>
                Chat
              </button>
            )}
            {onCareer && (
              <button data-career-open aria-label={`${c.name}'s career`} onClick={onCareer} style={{ ...s.chip, flex: "0 0 auto", background: "var(--accent-wash)", boxShadow: "inset 0 0 0 1.5px var(--accent)", color: "var(--text-1)", fontWeight: 800 }}>
                Career
              </button>
            )}
          </div>
        )}
        <span style={{ font: "600 15px/20px var(--font)", color: "var(--text-1)" }}>{cap(sh.title)}</span>
        <span style={{ font: "400 13px/18px var(--font)", color: "var(--text-3)" }}>
          {onRename
            ? "Not in the office yet · fixed once created"
            : applying
              ? `Applying · would start as ${startsAs === "Senior" ? `the Senior, your first ${SPECIALTIES[c.specialty].title}` : "a Junior"}`
              : `${standing?.level ?? startsAs ?? "Junior"} · ${(standing?.xp ?? 0).toLocaleString("en-GB")} XP · ${standing?.next?.ready ? `ready for ${standing.next.to}` : "levels come from finished work you approve"}`}
        </span>
        {/* the first of his kind in the office starts as the Senior (owner, 10-02), so the work has someone to lead it;
            "your first All-Rounder" kept together, so a one-word title never stands alone on a small phone's last line (10-07) */}
        {onRename && startsAs && (
          <span style={{ font: "400 13px/18px var(--font)", color: "var(--text-3)", textWrap: "pretty" }}>
            {startsAs === "Senior" ? <>Starts as the Senior: <span style={{ whiteSpace: "nowrap" }}>your first {SPECIALTIES[c.specialty].title}</span></> : "Starts as a Junior"}
          </span>
        )}
        {/* how long he has been about, and been with you (owner, 10-02): his age never restarts; his days in the company start again when he is rehired */}
        {!onRename && standing && (
          <span style={{ font: "400 13px/18px var(--font)", color: "var(--text-3)" }}>
            {`Age ${span(standing.born, standing.now)} · ${standing.left === null ? `${span(standing.hired, standing.now)} in the company` : `${span(standing.hired, standing.left)} in the company, then let go`}`}
          </span>
        )}
      </div>
      {/* on a phone the rest scrolls under his name (owner, 10-04) */}
      <Tall label={`${c.name || "Your orb"}'s card`} style={{ display: "grid", gap: "var(--s4)" }}>
      {grown && <LevelUp c={c} g={grown} />}
      <p style={{ margin: 0, font: "400 15px/21px var(--font)", color: "var(--text-2)", textWrap: "pretty" }}>{grew && grownSays(grew) ? `${sh.bio} ${grownSays(grew)}` : sh.bio}</p>
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
          {c.voice === "silent" ? "Silent: writes, never speaks" : `${v.label} · ${v.accent}`}
          {c.voice !== "silent" && !speaks(c, replies) ? ` (${REPLIES[replies].toLowerCase()} for now)` : ""}
        </span>
      </div>
      <div style={{ display: "grid", gap: "var(--s2)" }}>
        <Head>Traits</Head>
        <Bars items={grew ? grew.traits : sh.traits} max={Math.max(CEILING, ...(grew ? grew.traits : sh.traits).map((t) => t.value))} />
        <span style={{ font: "400 12px/16px var(--font)", color: "var(--text-3)" }}>{TOTAL} points across them, like every orb</span>
      </div>
      <Shaped c={c} moves={grew ? [...grew.moves, ...sh.dna.moves] : sh.dna.moves} />
      <Strand key={c.name + c.seed} c={c} />
      {grew && (
        <div style={{ display: "grid", gap: "var(--s2)" }}>
          <Head>Grown from work · each skill since it started</Head>
          <Bars kind="skills" max={Math.max(5, Math.ceil(Math.max(...grew.skills.map((k) => k.value))))} items={grew.skills.map((k) => ({ name: k.name, value: k.value, nature: k.start }))} />
        </div>
      )}
      <div style={{ display: "grid", gap: "var(--s2)" }}>
        <Head>Leans toward</Head>
        <Radar items={grew ? grew.skills : sh.leans} />
        <span style={{ font: "400 12px/16px var(--font)", color: "var(--text-3)" }}>24 points across them, like every orb: its specialty sets the shape, its traits pull it</span>
      </div>
      {friends && friends.length > 0 && <Colleagues me={c.name} friends={friends} />}
      </Tall>
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
function AccessoryColour({ what, value, onPick }: { what: string; value: AccessoryHue | null; onPick: (h: AccessoryHue | null) => void }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Head>{cap(what)} colour</Head>
      <OneLine style={{ justifyContent: "flex-start", alignItems: "center", padding: "4px 2px" }} gap={8}>
        <button onClick={() => onPick(null)} aria-pressed={value === null} style={{ ...s.chip, ...chosen(value === null), flex: "0 0 auto" }}>
          Its own
        </button>
        {/* white and black (owner, 10-03), then his 24 colours */}
        {(["white", "black"] as const).map((m) => (
          <span key={m} style={{ flex: "0 0 auto", display: "grid" }}>
            <button aria-label={`${what} in ${m}`} aria-pressed={value === m} title={cap(m)} onClick={() => onPick(m)} data-material={m}
              style={{ width: 28, height: 28, borderRadius: "50%", border: 0, cursor: "pointer", background: hex(MATERIALS[m]), boxShadow: value === m ? "0 0 0 2px var(--card), 0 0 0 4px var(--text-1)" : "inset 0 0 0 1px var(--hairline)" }} />
          </span>
        ))}
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
      className="orbs-tag" // a colour is a dot; on a phone a finger's ring round it, not a bigger dot (PLAN 2.17)
      data-orb={hue}
      aria-label={label}
      aria-pressed={on}
      title={cap(hue)}
      onClick={onPick}
      style={{ position: "relative", width: size, height: size, borderRadius: "50%", border: 0, cursor: "pointer", background: "var(--accent)", boxShadow: on ? "0 0 0 2px var(--card), 0 0 0 4px var(--text-1)" : "inset 0 0 0 1px var(--hairline)" }}
    />
  );
}

/** The tab bar: one line, and a pill that slides to the chosen tab with a spring. */
function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
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
    // its own track already: on a phone, the arrows beside it (owner, 10-07: "add arrows to every side scroll")
    <SideScroll scrollRef={bar} bare role="tablist" className="one-line" style={{ position: "relative", display: "flex", flexWrap: "nowrap", overflowX: "auto", gap: 3, padding: 3, borderRadius: 12, background: "var(--fill)", scrollbarWidth: "none" }}>
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
    </SideScroll>
  );
}

function Creator({ me, edit, replies, setReplies, kinds = [] }: { me: Character; edit: (p: Partial<Character>) => void; replies: Replies; setReplies: (r: Replies) => void; /** the office's orbs' specialties: who may join next (orb/company.ts) */ kinds?: string[] }) {
  // the CEO, then your assistant, before anyone; then each department with its head (owner, 10-07)
  const founding = nextFounding(kinds);
  const open = openDepartments(kinds);
  const [tab, setTab] = useState<Tab>("Personality");
  // a colour that goes with his (spec.ts SCHEMES): what the colour dice roll, like Roll everything's
  const partner = (): HueName => partnerOf(me.hue, pick(Object.keys(SCHEMES) as Scheme[]), Math.random());
  useEffect(() => stopPreview, []); // a voice still talking when the creator closes stops with it
  const hues = HUES.map((h) => h.name);
  const dice: Record<Tab, () => void> = {
    Personality: () => edit(withPersonality(me, pick(Object.keys(PERSONALITIES) as PersonalityName[]))),
    Specialty: () => edit({ specialty: founding ?? pick((Object.keys(SPECIALTIES) as SpecialtyName[]).filter((k) => !whyNot(k, kinds))) }),
    Shape: () => edit({ shape: pick(Object.keys(SHAPES) as ShapeName[]) }),
    Eyes: () => edit({ eyes: pick(Object.keys(EYES) as EyesName[]) }),
    Hat: () => edit({ hat: pick(Object.keys(HATS) as HatName[]), hatHue: Math.random() < 0.35 ? partner() : null }),
    Glasses: () => edit({ glasses: pick(Object.keys(GLASSES) as GlassesName[]), glassesHue: Math.random() < 0.35 ? partner() : null }),
    Colour: () => {
      const hue = pick(hues);
      edit({ hue, hue2: Math.random() < 0.25 ? partnerOf(hue, "analogous", Math.random()) : null, finish: Math.random() < 0.7 ? "glass" : pick(Object.keys(FINISHES) as FinishName[]) });
    },
    Voice: () => edit({ voice: pick(VOICES.filter((v) => v.english && offered(v) && v.id !== "ash" && v.id !== "silent").map((v) => v.id)) }),
  };
  const P = PERSONALITIES[me.personality];
  const voiceGroups: [string, typeof VOICES][] = [
    [`Suits a ${P.label.toLowerCase()} orb`, VOICES.filter((v) => (P.voices as readonly string[]).includes(v.id))],
    ["American", VOICES.filter((v) => v.accent === "American" && offered(v))],
    ["British", VOICES.filter((v) => v.accent === "British" && offered(v))],
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
      <Tall label={`${tab} choices`} style={{ display: "grid", gap: "var(--s4)" }}>
      {tab === "Personality" && (
        <Cards value={me.personality} entries={(Object.keys(PERSONALITIES) as PersonalityName[]).map((k) => [k, PERSONALITIES[k].label, PERSONALITIES[k].blurb])} onPick={(p) => edit(withPersonality(me, p))} />
      )}
      {tab === "Specialty" && founding && (
        // the CEO first, then your assistant (owner, 10-07: "Your first orb is the CEO, you must appoint one before
        // apointing any orbs, and a personal assistant"): the rest you hire after
        <div data-founding={founding} style={{ display: "grid", gap: 8 }}>
          <span style={{ font: "400 14px/20px var(--font)", color: "var(--text-2)" }}>
            {founding === "ceo" ? "Your first orb is your CEO: they run the company and chair the board. Your personal assistant comes next, then everyone else." : "Next, your personal assistant: they keep your day and bring the CEO what the company should do. Then you can hire everyone else."}
          </span>
          <Cards value={me.specialty} entries={[[founding, SPECIALTIES[founding].title, cap(SPECIALTIES[founding].focus)]]} onPick={(specialty) => edit({ specialty })} />
        </div>
      )}
      {tab === "Specialty" && !founding && (
        <div style={{ display: "grid", gap: "var(--s4)" }}>
          {(Object.keys(FAMILIES) as Family[]).map((fam) => (
            <div key={fam} data-specialty-group={fam} style={{ display: "grid", gap: 8 }}>
              <Head>{FAMILIES[fam]}</Head>
              {open.includes(fam) ? (
                <Cards
                  value={me.specialty}
                  entries={(Object.keys(SPECIALTIES) as SpecialtyName[]).filter((k) => SPECIALTIES[k].family === fam).map((k) => [k, SPECIALTIES[k].title, cap(SPECIALTIES[k].focus)])}
                  onPick={(specialty) => edit({ specialty })}
                />
              ) : (
                // a department opens with its head (owner, 10-07: "for every section in recruiter they need to unlock")
                <span data-locked={fam} style={{ font: "500 14px/20px var(--font)", color: "var(--text-3)" }}>{`🔒 Hire a ${headOf(fam)} to open ${FAMILIES[fam]}: the ${headOf(fam)} is in the Executive above.`}</span>
              )}
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
                  <button
                    key={v.id}
                    data-voice={v.id}
                    onClick={() => {
                      edit({ voice: v.id });
                      preview(v.id, P.speed); // heard as he will speak: his personality's pace
                    }}
                    aria-pressed={me.voice === v.id}
                    title={v.accent} style={{ ...s.chip, ...chosen(me.voice === v.id), display: "grid", textAlign: "left", borderRadius: 12, padding: "6px 12px" }}>
                    <span>{v.label}</span>
                    <span style={{ font: "400 11px/14px var(--font)", color: "var(--text-3)" }}>{v.accent}</span>
                  </button>
                ))}
              </Balanced>
            </div>
          ))}
        </div>
      )}
      </Tall>
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
function Card({ c, replies, setReplies, onDelete, others }: { c: Character; replies: Replies; setReplies: (r: Replies) => void; onDelete: (handTo?: string, school?: boolean) => void; others: Character[] }) {
  const [asking, setAsking] = useState(false);
  const [handTo, setHandTo] = useState(""); // whose his habits become when he goes, if anyone's
  useEffect(() => {
    setAsking(false);
    setHandTo("");
  }, [c.name]);
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
        An orb stays as made, and grows from the work you approve, not from edits.
      </p>
      {asking ? (
        <div role="group" aria-label={`Let ${c.name} go?`} style={{ display: "grid", gap: 8, padding: "var(--s3)", borderRadius: 14, background: "var(--fill)", boxShadow: "inset 0 0 0 1px var(--off)" }}>
          <span style={{ font: "600 14px/20px var(--font)", color: "var(--text-1)", textWrap: "pretty" }}>{c.name} leaves the office. All of {c.name}'s work is kept, the learning goes on, and a rehire is a press away on the org chart. Or send {c.name} to school: the subjects you pick, an exam, and a diploma that counts when you rehire.</span>
          {others.length > 0 && (
            <label style={{ display: "flex", alignItems: "center", gap: 8, font: "500 13px/18px var(--font)", color: "var(--text-2)", minWidth: 0 }}>
              Hand {c.name}'s habits to
              <select value={handTo} onChange={(e) => setHandTo(e.target.value)} style={{ font: "500 13px/18px var(--font)", color: "var(--text-1)", background: "var(--raised)", border: 0, borderRadius: 8, padding: "4px 8px", minWidth: 0 }}>
                <option value="">No one</option>
                {others.map((o) => (
                  <option key={o.name} value={idOf(o.name)}>{o.name}</option>
                ))}
              </select>
            </label>
          )}
          <OneLine style={{ justifyContent: "flex-start" }}>
            <button data-sound="delete" onClick={() => onDelete(handTo || undefined)} style={{ ...s.btn, color: "var(--off)", boxShadow: "inset 0 0 0 1px var(--off)" }}>
              Let {c.name} go
            </button>
            <button data-sound="delete" onClick={() => onDelete(handTo || undefined, true)} style={s.btn}>
              Let {c.name} go and send to school
            </button>
            <button onClick={() => setAsking(false)} style={s.btn}>
              Keep {c.name}
            </button>
          </OneLine>
        </div>
      ) : (
        <button onClick={() => setAsking(true)} style={{ ...s.btn, justifySelf: "start", color: "var(--text-3)" }}>
          Let {c.name} go…
        </button>
      )}
    </div>
  );
}

/** A speaker, drawn: with its waves when sounds are on, crossed out when they are off. */
/** The lab's mark (owner, 10-07: "change the lab icon in menu to a labratory flask"): a flask, a little of what is
 * being tried in it, a bubble rising; drawn in the menu's colour. */
function FlaskIcon() {
  return (
    <svg data-icon="flask" width="16" height="16" viewBox="0 0 16 16" aria-hidden style={{ display: "block", overflow: "visible" }}>
      <path d="M5.6 9.6 L3.3 13.1 Q2.9 13.9 3.8 13.9 H12.2 Q13.1 13.9 12.7 13.1 L10.4 9.6 Z" fill="currentColor" opacity=".38" />
      <path d="M6.3 1.6 H9.7 M6.9 1.6 V6.2 L3.1 12.4 Q2.2 14.2 4.2 14.2 H11.8 Q13.8 14.2 12.9 12.4 L9.1 6.2 V1.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7.4" cy="11.6" r=".9" fill="currentColor" />
      <circle cx="9.3" cy="10.3" r=".6" fill="currentColor" />
    </svg>
  );
}

function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg aria-hidden width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <path d="M2.5 6h2.5l3.5-3v10l-3.5-3h-2.5z" fill="currentColor" />
      {on ? <path d="M11 5.5c.9.7 1.4 1.6 1.4 2.5s-.5 1.8-1.4 2.5M12.8 3.6c1.5 1.1 2.3 2.7 2.3 4.4s-.8 3.3-2.3 4.4" /> : <path d="M11.2 5.8l3.6 4.4M14.8 5.8l-3.6 4.4" />}
    </svg>
  );
}

const REACT: [keyof Character, Gesture][] = [["hat", "hop"], ["glasses", "nod"], ["personality", "hop"], ["shape", "jelly"], ["goo", "jelly"], ["eyes", "nod"], ["specialty", "nod"], ["hue", "wiggle"], ["hue2", "wiggle"], ["finish", "wiggle"], ["voice", "squish"]];

// "floor": the office itself, everyone at work (owner, 10-05: "the office should be a whole office visual of
// them working in an office"); "orb": one orb's profile, pressed on the floor or picked in the side menu
type View = { kind: "orb"; name: string } | { kind: "new"; draft: Character } | { kind: "floor" };
/** Where an address in the office leads: an orb's profile when it names one, else the floor. */
const viewOf = (orbs: Character[], r: Route): View => (r.room === "office" && r.orb && orbs.some((c) => c.name === r.orb) ? { kind: "orb", name: r.orb } : { kind: "floor" });

/** Whether the window is a phone's (the stylesheet's own line, 760px): some things are drawn smaller there. */
function usePhone(): boolean {
  const q = typeof matchMedia === "function" ? matchMedia("(max-width: 760px)") : null;
  const [phone, setPhone] = useState(Boolean(q?.matches));
  useEffect(() => {
    if (!q) return;
    const on = (): void => setPhone(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return phone;
}

function App() {
  // an office starts with the one orb you make (owner, 10-01: "we should start with only 1 orb,
  // the one we make at the beginning"); until then, the creator, on a newborn
  const [office, setOffice] = useState<Character[]>(() => keptOffice(NEWBORN));
  const [view, setView] = useState<View>(() => {
    const kept = keptOffice(NEWBORN);
    return kept.length ? viewOf(kept, parseRoute(location.hash)) : { kind: "new", draft: { ...NEWBORN, seed: roll() } };
  });
  const [state, setState] = useState<OrbState>("idle");
  const [picked, setPicked] = useState(false); // a mood you chose by hand stands over his real one
  const [gesture, setGesture] = useState<{ name: Gesture; n: number } | null>(null);
  // the move you last pressed in the creator, lit and fading back (owner, 10-03: "highlight when hop wink etc is pressed")
  const [flash, setFlash] = useState<{ g: Gesture; n: number } | null>(null);
  const [replies, setReplies] = useState<Replies>("speak");
  const [sounds, setSoundsShown] = useState(soundsOn());
  const [leaving, setLeaving] = useState<string | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  const [rolls, setRolls] = useState(0);
  const [evolve, setEvolve] = useState<{ c: Character; n: number } | null>(null); // Roll everything: who he was
  const phone = usePhone(); // the hero's orb smaller on a phone (owner, 10-04: "make hero a bit smaller")
  const smallPhone = useCramped("(max-width: 360px)"); // its gestures three to a row, never one left alone
  // his card says who he is only once he has been shown whole (owner, 10-04: "only show the orbs info when the
  // orb has been shown completely"): until the change is over it still says who he was
  const [shown, setShown] = useState(0);
  const recent = useRef<string[]>([]); // the names rolled lately: a roll brings a new one
  const [strandText, setStrandText] = useState(""); // a DNA strand pasted into the creator
  const [strandSaid, setStrandSaid] = useState<string | null>(null);
  const [seatHop, setSeatHop] = useState(0); // the New orb seat's orb hops as the pointer comes to it
  const lastReact = useRef(0);
  const [opening, setOpening] = useState(splashWanted);
  const [drawn, setDrawn] = useState(!opening); // the office draws once the splash starts to leave
  const [person, setPerson] = useState<Person | null>(loadPerson);
  // the first open is a story (PLAN 2.5): until it is played, it is what the person sees
  const [intro, setIntro] = useState(() => !loadPerson() && introWanted());
  const [touring, setTouring] = useState<Character | null>(null); // your CEO, showing you round (TOUR)
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
      return viewOf(orbs, r);
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
  const [room, setRoom] = useState<"home" | "office" | "settings" | "chat" | "sessions" | "notices" | "calendar" | "lab" | "org" | "career" | "recruiter" | "report">(() => {
    const r = parseRoute(location.hash).room;
    return r === "home" || r === "settings" || r === "chat" || r === "sessions" || r === "notices" || r === "calendar" || r === "lab" || r === "org" || r === "career" || r === "recruiter" || r === "report" ? r : "office";
  });
  // which department's applicants the Recruiter shows (owner, 10-06: the floor's Hiring tags), or all
  // whose school sheet the org chart opens with (#/org/school/<id>; owner, 10-06)
  const [schoolFor, setSchoolFor] = useState<string | null>(() => {
    const r = parseRoute(location.hash);
    return r.room === "org" ? (r.school ?? null) : null;
  });
  const [hiringFor, setHiringFor] = useState<string | null>(() => {
    const r = parseRoute(location.hash);
    return r.room === "recruiter" ? r.family ?? null : null;
  });
  // whose career page is open (PLAN 5.6)
  const [careerOf, setCareerOf] = useState<string | null>(() => {
    const r = parseRoute(location.hash);
    return r.room === "career" ? r.orb : null;
  });
  const notices = useNotices(home);
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
  // who may join next (orb/company.ts): the CEO, then your assistant, then each department with its head
  const kinds = office.map((c) => c.specialty);
  const founding = nextFounding(kinds);
  const before = making && evolve && evolve.n !== shown ? evolve.c : null;
  const at = view.kind === "orb" ? Math.max(0, office.findIndex((c) => c.name === view.name)) : -1;
  const me = view.kind === "new" ? view.draft : (view.kind === "floor" ? office[0] : office[at]) ?? NEWBORN;
  // his real mood, on a home (PLAN 2.3): what happens to him, worn by the face
  const moodNow = useMood(home, view.kind === "new" ? null : idOf(me.name));
  const live = home && view.kind !== "new" ? moodNow : null;
  const moods = useMoods(home, office.map((c) => idOf(c.name))); // the side menu's dots (PLAN 2.4)
  // where he stands, on a home (PLAN 3.8): his level and XP, kept up as they change
  const [standing, setStanding] = useState<Standing | null>(null);
  const [career, setCareer] = useState<CareerState | null>(null); // what his work has grown him into (PLAN 3.11)
  const [friends, setFriends] = useState<Friend[] | null>(null); // how it gets on with the office (PLAN 5.9)
  useEffect(() => {
    if (!home || view.kind === "new") return void (setStanding(null), setCareer(null), setFriends(null));
    const c = me;
    const load = (): void => {
      void home.standing(c).then(setStanding, () => setStanding(null));
      void home.career(c).then(setCareer, () => setCareer(null));
    };
    const loadFriends = (): void => void home.friendsOf(idOf(c.name)).then(setFriends, () => setFriends(null));
    load();
    loadFriends();
    return home.watch({
      event: (e) => {
        if (e.orb === idOf(c.name) && /^(xp\.|orb\.promoted|promotion\.)/.test(e.type)) load();
        if (/^social\.met$/.test(e.type) && (e.data?.a === idOf(c.name) || e.data?.b === idOf(c.name))) loadFriends();
      },
    });
  }, [home, view.kind === "new" ? "" : me.name]);
  // the home's meetings go by how the orbs' traits get on (PLAN 5.9): it is told each one's DNA, which only the
  // app can read, once a load and whenever it changes
  const traitsSent = useRef(new Map<string, string>());
  useEffect(() => {
    if (!home) return;
    for (const c of office) {
      const traits = Object.fromEntries(dnaOf(c).traits.map((t) => [t.name, t.value]));
      const json = JSON.stringify(traits);
      if (traitsSent.current.get(c.name) === json) continue;
      traitsSent.current.set(c.name, json);
      home.setTraits(idOf(c.name), traits).catch(() => traitsSent.current.delete(c.name));
    }
  }, [home, office]);
  const worn: OrbState = live && !picked ? WORN[live.mood].state : state; // what his face wears, and the chip that says so
  useEffect(() => {
    if (live?.moment && !picked) play(live.moment.name); // his moments play through the face's one gesture line
  }, [live?.moment?.n]);
  const play = (g: Gesture): void => setGesture((x) => ({ name: g, n: (x?.n ?? 0) + 1 }));
  useEffect(() => play("pop"), [making ? "new" : me.name]);

  const taken = (name: string): boolean => office.some((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  // the level he starts at (owner, 10-02): the Senior when he is the first of his kind in the office
  // (the office is in hiring order), a Junior after; a home's word on his level comes first
  const startsAs = (making ? !office.some((o) => o.specialty === me.specialty) : office.find((o) => o.specialty === me.specialty) === me) ? "Senior" : "Junior";
  /** A new orb by the dice, with a name nobody in the office has. */
  const fresh = (): Character => {
    // the dice keep to who may join: the CEO first, then your assistant, then an open department's (owner, 10-07)
    const may = (Object.keys(SPECIALTIES) as SpecialtyName[]).filter((k) => !whyNot(k, kinds));
    const seed = roll();
    let c = surprise(seed, founding ? { specialty: founding } : { specialty: may[seed % may.length] ?? "general" });
    for (let i = 0; i < 40 && (taken(c.name) || recent.current.includes(c.name)); i++) c = { ...c, name: orbName(() => Math.random()) };
    recent.current = [c.name, ...recent.current].slice(0, 40);
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
  const blocked = !making ? null : !name ? "Give your orb a name first" : taken(name) ? `Someone in the office is already called ${name}` : whyNot(me.specialty, kinds);
  const create = (): void => {
    if (view.kind !== "new" || blocked) return;
    const made = { ...view.draft, name };
    setOffice((o) => [...o, made]);
    home?.add(made).catch((e: Error) => setSaid(`${made.name} was not hired: ${e.message}`));
    setArrived(made.name);
    // your CEO made: the tour it gives you, then your assistant (owner, 10-07: "hires the CEO and then through a little
    // tour the user can skip if they want, they hire the personal assistant"), once, in a first open
    if (made.specialty === "ceo" && nextFounding([...kinds, "ceo"]) === "assistant" && introWanted() && !toured()) setTouring(made);
    setRoom("office"); // its profile, whichever room it was made from (an empty office's home page opens the creator)
    setView({ kind: "orb", name: made.name });
    // the creator's address becomes his: a reload shows him, and Back does not reopen a creator for him
    history.replaceState(history.state, "", routeHash({ room: "office", orb: made.name }));
    window.setTimeout(() => play("hop"), 120);
  };
  const remove = (who: string, handTo?: string, school = false): void => {
    const i = office.findIndex((c) => c.name === who);
    const rest = office.filter((c) => c.name !== who);
    const gone = office[i];
    if (home && gone) home.letGo(gone, handTo).catch((e: Error) => setSaid(`${who} was not let go: ${e.message}`));
    setLeaving(who);
    window.setTimeout(() => {
      setLeaving(null);
      setOffice(rest);
      // let go to be sent to school (owner, 10-06): the org chart, its school sheet open
      if (school) return go({ room: "org", school: idOf(who) });
      const next = rest[Math.max(0, i - 1)];
      setView(next ? { kind: "orb", name: next.name } : { kind: "new", draft: surprise(roll(), { specialty: "assistant" }) });
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
    room === "home" ? { room: "home" } : room === "settings" ? { room: "settings" } : room === "notices" ? { room: "notices" } : room === "calendar" ? { room: "calendar" } : room === "lab" ? { room: "lab" } : room === "report" ? { room: "report" } : room === "org" ? { room: "org", school: schoolFor } : room === "recruiter" ? { room: "recruiter", family: hiringFor } : room === "career" && careerOf ? { room: "career", orb: careerOf } : room === "sessions" ? { room: "sessions", ...inSession } : room === "chat" && talking ? { room: "chat", orb: talking } : view.kind === "new" ? { room: "new" } : { room: "office", orb: view.kind === "orb" ? view.name : null };
  const show = (r: Route): void => {
    if (r.room === "home") setRoom("home"); // the home page (owner, 10-07): what the app opens on
    else if (r.room === "settings") setRoom("settings");
    else if (r.room === "notices") setRoom("notices");
    else if (r.room === "calendar") setRoom("calendar");
    else if (r.room === "lab") setRoom("lab");
    else if (r.room === "report") setRoom("report"); // the board's daily report (PLAN 5.18)
    else if (r.room === "org") {
      setRoom("org");
      setSchoolFor(r.school ?? null);
    }
    else if (r.room === "recruiter" && !nextFounding(office.map((c) => c.specialty))) {
      setRoom("recruiter");
      setHiringFor(r.family ?? null);
    }
    else if (r.room === "recruiter") {
      // no orbs yet: the recruiter waits for your assistant; its address opens the making of it
      setRoom("office");
      setView((v) => (v.kind === "new" ? v : { kind: "new", draft: { ...NEWBORN, seed: roll() } }));
    }
    else if (r.room === "career") {
      setRoom("career");
      setCareerOf(r.orb);
    }
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
      else setView(viewOf(office, r));
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
    // an open with no address keeps none: no address is the office, and the home's orbs may not have come
    // yet. Writing where the page stood then ("#/new", the creator, until they come) kept every launch on
    // New orb (owner, 10-06: "we always default to new orb when opening")
    if (location.hash) history.replaceState({ orbs: 0 }, "", location.hash);
    else history.replaceState({ orbs: 0 }, "");
  }, []);
  // the menu slides in on a phone only: a window made wide with it open closes it, or its scrim stayed in the
  // desk's layout as a stray box, and it came back open when the window was narrow again (owner, 10-06:
  // "when we resize from mobile to desktop with menu open it glitches and looks weird")
  useEffect(() => {
    if (!phone) setMenu(false);
  }, [phone]);
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
  // `locked`: why it is not open yet (greyed, not pressable, its reason on hover)
  const navItem = (label: string, on: boolean, to: Route, mark: ReactNode, count = 0, invite = false, locked = ""): ReactNode => (
    <button key={label} aria-current={on ? "page" : undefined} aria-label={count ? `${label}, ${count} waiting` : undefined} onClick={locked ? undefined : () => go(to)} disabled={Boolean(locked)} title={locked || undefined} data-locked={locked ? "" : undefined} data-invite={invite || undefined} style={{ ...s.btn, display: "flex", alignItems: "center", gap: 10, textAlign: "left", background: on ? "var(--accent-wash)" : "transparent", boxShadow: on ? "inset 0 0 0 1px var(--accent)" : "none", ...(locked && { opacity: 0.45, cursor: "not-allowed" }), ...(invite && { background: "var(--accent)", color: "var(--ground)", fontWeight: 800, boxShadow: on ? "0 0 0 2px var(--card), 0 0 0 3.5px var(--accent)" : "none" }) }} data-orb={me.hue}>
      <span aria-hidden style={{ width: 18, display: "grid", placeItems: "center", color: invite ? "var(--ground)" : "var(--accent)", font: invite ? "800 20px/16px var(--font)" : "800 15px/16px var(--font)" }}>{mark}</span>
      {label}
      {count > 0 && (
        // a count, quiet: no sound, no motion beyond its arrival
        <span data-badge style={{ marginLeft: "auto", minWidth: 20, height: 20, padding: "0 6px", borderRadius: 10, display: "grid", placeItems: "center", background: "var(--accent)", color: "var(--ground)", font: "800 11px/12px var(--font)", animation: "orbs-arrive 420ms var(--m-spring)" }}>{count}</span>
      )}
    </button>
  );

  return (
    <main className="orbs-main">
      {opening && (
        <Splash
          office={office.length ? office : [NEWBORN]}
          facts={[office.length ? `${office.length} ${office.length === 1 ? "orb" : "orbs"} in the office` : "A new office"]} // no word on the sounds here (owner, 10-04)
          ready={() => globalThis.__orbsReady ?? Promise.all([document.fonts.ready, link()])}
          onLeaving={() => setDrawn(true)}
          onDone={() => setOpening(false)}
          {...(passkeysHere() && { signIn: signInWithPasskey })}
        />
      )}
      {!opening && intro && (
        <Onboarding
          office={office}
          person={person}
          home={home}
          onDone={(p, then) => {
            keep(p);
            setIntro(false);
            // "Make me": the creator, on him as he told the story; "Surprise me": the dice
            if (then === "surprise") setView({ kind: "new", draft: fresh() });
            go({ room: "new" });
          }}
        />
      )}
      {touring && (
        <Onboarding
          office={office}
          person={person}
          home={home}
          story={TOUR}
          narrator={touring}
          onDone={(p, then) => {
            setTouring(null);
            setToured();
            keep(p);
            // your assistant next: "Make my assistant" a plain bean to dress, "Surprise me" the dice
            setView({ kind: "new", draft: then === "surprise" ? fresh() : { ...NEWBORN, specialty: "assistant", seed: roll() } });
            go({ room: "new" });
          }}
        />
      )}
      {drawn && !intro && !touring && (
      <div className={/* a conversation fills the screen (owner, 10-07): the window keeps to it, its menu scrolling on its own */ room === "chat" || (room === "sessions" && inSession.id !== null) ? "orbs-window orbs-fit" : "orbs-window"} style={s.window}>
        {/* on a phone: Back, the name, and the menu, which slides in */}
        {/* a band of its own, clear of the hero (owner, 10-04: "the back button and menu buttons kind of bleed into the hero") */}
        <div className="orbs-topbar" style={{ display: "none", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "var(--s3) var(--s4)", marginBottom: "var(--s3)", boxShadow: "0 1px 0 var(--sep)" }}>
          {backButton({ padding: "6px 12px" })}
          <span style={{ font: "700 12px/20px var(--font)", letterSpacing: ".12em", color: "var(--text-3)" }}>ORBZ</span>
          <button aria-label="Menu" aria-expanded={menu} onClick={() => setMenu(true)} style={{ ...s.btn, padding: "6px 12px", font: "800 16px/20px var(--font)" }}>
            ☰
          </button>
        </div>
        {menu && phone && <div className="orbs-scrim" aria-hidden onClick={() => setMenu(false)} />}
        <aside className="orbs-side" data-open={menu} style={s.side}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 var(--s2)", font: "700 12px/20px var(--font)", letterSpacing: ".12em", color: "var(--text-3)" }}>
            <i aria-hidden data-orb={me.hue} style={{ width: 9, height: 9, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, var(--text-1) 0%, var(--accent) 60%)", boxShadow: "0 0 8px var(--accent-glow)" }} />
            ORBZ
          </div>
          {person && (
            <div style={{ padding: "0 var(--s2)", font: "600 13px/18px var(--font)", color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {person.company ? <span data-company style={{ display: "block", font: "800 14px/20px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{person.company}</span> : null}
              Founder {person.name}
            </div>
          )}
          <nav aria-label="Rooms" style={{ display: "grid", gap: 4, marginTop: "var(--s2)" }}>
            {backButton({ justifySelf: "start", marginBottom: "var(--s1)" })}
            {navItem("Home", room === "home", { room: "home" }, "⌂")}
            {navItem("The office", room === "office" && view.kind === "floor", { room: "office", orb: null }, "◉")}
            {navItem("New orb", room === "office" && making, { room: "new" }, "+", 0, true) /* asks to be pressed (owner, 10-03) */}
            {navItem("Sessions", room === "sessions", { room: "sessions", id: null, tab: "brainstorm" }, "▦")}
            {navItem("Notifications", room === "notices", { room: "notices" }, "◔", notices.notices.length)}
            {navItem("Calendar", room === "calendar", { room: "calendar" }, "▤")}
            {navItem("The lab", room === "lab", { room: "lab" }, <FlaskIcon />)}
            {navItem("Org chart", room === "org", { room: "org" }, "◇")}
            {/* hiring comes after your assistant, the first orb (owner, 10-04: "if you have not created your assistant yet ... you
                shouldnt be able to see the recruiter page yet, it should be greyed out and inaccesible") */}
            {navItem("Recruiter", room === "recruiter" && !founding, { room: "recruiter" }, "✚", 0, false, founding ? (founding === "ceo" ? "Appoint your CEO first" : "Appoint your personal assistant first") : "")}
            {navItem("Settings", room === "settings", { room: "settings" }, "⚙")}
          </nav>
          <div style={{ ...s.head, margin: "var(--s3) var(--s2) var(--s1)" }}>The office</div>
          <div style={{ display: "grid", gap: 2, overflowY: "auto", minHeight: 0, paddingBlock: 4 }}>
            {office.map((c) => (
              <button
                key={c.name}
                data-orb={c.hue}
                onClick={() => go({ room: "office", orb: c.name })}
                aria-current={room === "office" && view.kind === "orb" && c.name === me.name ? "page" : undefined} // its profile is the page you are on
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px", border: 0, borderRadius: 10, cursor: "pointer", textAlign: "left", background: room === "office" && view.kind === "orb" && c.name === me.name ? "var(--accent-wash)" : "transparent", color: "var(--text-2)", font: "600 14px/20px var(--font)", minWidth: 0 }}
              >
                <span style={{ position: "relative", flex: "0 0 auto", display: "grid" }}>
                  <Orb character={c} size={30} poke={false} every={3} fidget={false} />
                  {moods[idOf(c.name)] && moods[idOf(c.name)] !== "idle" && (
                    <span aria-hidden data-mood-dot={moods[idOf(c.name)]} style={{ position: "absolute", right: -1, bottom: -1, width: 10, height: 10, borderRadius: "50%", boxShadow: "0 0 0 2px var(--side)", background: moods[idOf(c.name)] === "waiting" ? "var(--alert)" : moods[idOf(c.name)] === "thinking" || moods[idOf(c.name)] === "working" || moods[idOf(c.name)] === "gym" ? "var(--accent)" : "var(--text-3)" }} />
                  )}
                </span>
                <span style={{ display: "grid", minWidth: 0 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  {/* on the chosen row's wash the quiet grey falls under AA in light: there it is the reading grey */}
                  <span style={{ font: "400 11px/14px var(--font)", color: moods[idOf(c.name)] === "waiting" ? "var(--alert)" : room === "office" && view.kind === "orb" && c.name === me.name ? "var(--text-2)" : "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {moods[idOf(c.name)] && moods[idOf(c.name)] !== "idle" ? WORN[moods[idOf(c.name)]!].words : SPECIALTIES[c.specialty].label}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* the home page, once there is an office; an empty one opens on making its first orb, as it always has */}
        {room === "home" && office.length ? (
          <HomeRoom home={home} office={office} person={person?.name ?? null} moods={moods} go={go} />
        ) : room === "recruiter" && !founding ? (
          <RecruiterRoom home={home} office={office} family={hiringFor} pick={(family) => go({ room: "recruiter", family })} hired={() => void home?.orbs().then((o) => o && setOffice(o))} profile={(c, startsAs) => <Sheet c={c} replies={replies} startsAs={startsAs} applying />} />
        ) : room === "org" ? (
          <OrgRoom home={home} office={office} school={schoolFor} open={(c) => go({ room: "career", orb: c.name })} rehired={() => void home?.orbs().then((o) => o && setOffice(o))} />
        ) : room === "career" ? (
          <CareerRoom home={home} orb={office.find((c) => c.name === careerOf) ?? office[0] ?? ASH} />
        ) : room === "lab" ? (
          <LabRoom home={home} office={office} go={go} />
        ) : room === "report" ? (
          <ReportRoom home={home} office={office} go={go} person={person} keep={keep} />
        ) : room === "calendar" ? (
          <CalendarRoom home={home} office={office} />
        ) : room === "notices" ? (
          <NoticesRoom home={home} office={office} notices={notices.notices} reload={notices.reload} live={notices.live} go={go} />
        ) : room === "sessions" ? (
          <SessionsRoom home={home} office={office} open={inSession.id} tab={inSession.tab} go={(id, tab) => go({ room: "sessions", id, tab: tab ?? "brainstorm" })} />
        ) : room === "chat" ? (
          <Chat orb={office.find((c) => c.name === talking) ?? office[0] ?? ASH} home={home} person={person?.name ?? null} replies={replies} />
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
            home={home}
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
        ) : view.kind === "floor" && office.length ? (
          <Floor home={home} office={office} moods={moods} person={person?.name ?? null} go={go} />
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
            <Evolving me={me} from={evolve} size={phone ? 128 : 176} state={worn} gesture={gesture} onDone={setShown} />
            {live && !picked && WORN[live.mood].words && (
              <span data-mood={live.mood} style={{ font: "600 13px/18px var(--font)", color: "var(--text-2)" }}>
                {WORN[live.mood].words}
              </span>
            )}
            {/* his moods a little more square, and his gestures as small, quieter boxes under them, not a row to scroll
                (owner, 10-07: "make the awake listening etc a little more square ... take out the wheel under it, put
                those as smaller containers under awake lisening etc with a dimmer font color") */}
            <OneLine>
              {MOODS.map(([m, label]) => (
                <button key={m} data-mood-pick={m} onClick={() => (setState(m), setPicked(true))} aria-pressed={worn === m} style={{ ...s.chip, ...chosen(worn === m), borderRadius: 10 }}>
                  {label}
                </button>
              ))}
            </OneLine>
            <div role="group" aria-label={`What ${me.name || "your orb"} can do`} data-gestures style={{ display: "grid", gap: 8, justifyItems: "center", maxWidth: "100%" }}>
              {(smallPhone ? [GESTURES.slice(0, 3), GESTURES.slice(3, 6), GESTURES.slice(6)] : [GESTURES.slice(0, 5), GESTURES.slice(5)]).map((row, r) => (
                <div key={r} style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6 }}>
                  {row.map(([g, label]) => (
                    <button key={g} className="orbs-small" data-gesture-pick={g} data-flash={flash?.g === g ? flash.n : undefined}
                      style={{ font: "600 12px/16px var(--font)", color: "var(--text-3)", background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", border: 0, borderRadius: 8, padding: "6px 11px", minHeight: 30, cursor: "pointer", whiteSpace: "nowrap", ...(flash?.g === g && { animation: `${flash.n % 2 ? "orbs-flash-a" : "orbs-flash-b"} 900ms ease-out` }) }}
                      onClick={() => (play(g), setFlash((f) => ({ g, n: (f?.n ?? 0) + 1 })))}>
                      {label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            {making && (
              <OneLine gap={8} style={{ marginTop: "var(--s2)" }}>
                <button
                  data-sound="roll"
                  style={{ ...s.btn, display: "inline-flex", alignItems: "center", gap: 8 }}
                  onClick={() => {
                    setEvolve((x) => ({ c: me, n: (x?.n ?? 0) + 1 }));
                    edit(fresh());
                    setRolls((n) => n + 1);
                    // the hop as his colours come back (at once, with less motion)
                    window.setTimeout(() => play("hop"), calm() ? 0 : REVEAL);
                  }}
                >
                  <DieIcon size={18} spins={rolls} />
                  Roll everything
                </button>
                <button data-sound="create" disabled={Boolean(blocked)} onClick={create} style={{ ...s.btn, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)", fontWeight: 800, opacity: blocked ? 0.5 : 1, cursor: blocked ? "not-allowed" : "pointer" }}>
                  Create {name || "your orb"}
                </button>
              </OneLine>
            )}
            {making && (
              // an orb from its DNA: someone's strand, pasted, and the creator changes into that orb
              <form
                data-from-dna
                onSubmit={(e) => {
                  e.preventDefault();
                  const read = readStrand(strandText, me.name || undefined);
                  if (!read.ok) return void setStrandSaid(read.why);
                  setStrandSaid(null);
                  setStrandText("");
                  setEvolve((x) => ({ c: me, n: (x?.n ?? 0) + 1 }));
                  edit(read.orb);
                  window.setTimeout(() => play("hop"), calm() ? 0 : REVEAL);
                }}
                style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8, width: "min(100%, 460px)" }}
              >
                <input value={strandText} onChange={(e) => (setStrandText(e.target.value), setStrandSaid(null))} aria-label="DNA strand" placeholder="Paste a DNA strand" size={1}
                  style={{ flex: "1 1 220px", minWidth: 0, font: "600 13px/18px var(--font)", letterSpacing: ".03em", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 12px", boxShadow: "inset 0 0 0 .5px var(--hairline)" }} />
                <button type="submit" disabled={!strandText.trim()} style={{ ...s.chip, opacity: strandText.trim() ? 1 : 0.5 }}>Make it</button>
                {strandSaid && <span role="alert" style={{ flex: "1 1 100%", textAlign: "center", font: "500 13px/18px var(--font)", color: "var(--alert)" }}>{strandSaid}</span>}
              </form>
            )}
            <p style={{ margin: 0, font: "400 13px/18px var(--font)", color: blocked ? "var(--alert)" : "var(--text-3)", textAlign: "center" }}>
              {before ? `${before.name || "Your orb"}, ${sheetOf(before).title}. Give a click, or move your pointer: the eyes follow.` : blocked ?? `${name || "Your orb"}, ${sheetOf(me).title}. Give a click, or move your pointer: the eyes follow.`}
            </p>
          </div>

          <div className="orbs-pair" style={{ display: "grid", gap: "var(--s4)", padding: "0 var(--s5)", gridTemplateColumns: "minmax(0, 1fr)", alignItems: "start" }}>
            {making ? (
              <Sheet c={before ?? me} key={before ? "was" : "now"} onRename={(n) => edit({ name: n })} replies={replies} standing={null} startsAs={startsAs} career={null} friends={null} />
            ) : (
              // Chat and its career beside its name (owner, 10-07)
              <Sheet c={before ?? me} key={before ? "was" : "now"} replies={replies} standing={standing} startsAs={startsAs} career={career} friends={friends}
                onChat={() => go({ room: "chat", orb: me.name })} onCareer={() => go({ room: "career", orb: me.name })} />
            )}
            {making ? <Creator me={me} edit={edit} replies={replies} setReplies={setReplies} kinds={kinds} /> : <Card c={me} replies={replies} setReplies={setReplies} onDelete={(handTo, school) => remove(me.name, handTo, school)} others={office.filter((o) => o.name !== me.name)} />}
          </div>

          <div style={{ padding: "0 var(--s5)" }}>
            <div style={{ ...s.head, margin: "0 0 var(--s3)" }}>The office</div>
            <Tall max="34dvh" label="The office">
            <Balanced
              min={144}
              gap={12}
              lead={
                // the empty seat (owner, 10-03: "+ new orb button has to be more inviting than that"): an
                // orb not made yet sits in it (the first open's newborn), its eyes on you, a + on it; it hops
                // when the pointer comes. On the New orb screen it is the orb being made, as it is made
                // (owner, 10-04: "can it be the new orb we are creating at the same time that shows? only on new
                // orb screen")
                <button
                  aria-pressed={making}
                  aria-label="New orb"
                  data-new-orb
                  data-orb={making ? me.hue : NEWBORN.hue}
                  onClick={() => go({ room: "new" })}
                  onPointerEnter={() => setSeatHop((n) => n + 1)}
                  style={{ display: "grid", justifyItems: "center", alignContent: "center", gap: 2, minHeight: 72, padding: "var(--s3) var(--s2)", border: 0, cursor: "pointer", borderRadius: 18, minWidth: 0, background: "radial-gradient(80% 70% at 50% 30%, var(--accent-fill), var(--accent-wash) 75%)", boxShadow: `inset 0 0 0 ${making ? 2 : 1.5}px var(--accent)` }}
                >
                  <span style={{ position: "relative", display: "grid", marginBottom: -14 }}>
                    <Orb character={making ? me : NEWBORN} size={100} poke={false} gesture={seatHop ? { name: "hop", n: seatHop } : null} />
                    <span aria-hidden data-plus style={{ position: "absolute", right: 10, bottom: 20, width: 30, height: 30, borderRadius: 15, display: "grid", placeItems: "center", background: "var(--accent)", color: "var(--ground)", font: "800 22px/22px var(--font)", boxShadow: "0 2px 10px var(--accent-glow)" }}>+</span>
                  </span>
                  <span style={{ font: "700 15px/20px var(--font)", color: "var(--accent)" }}>New orb</span>
                  <span style={{ font: "600 12px/16px var(--font)", color: "var(--text-2)" }}>Make one your way</span>
                </button>
              }
            >
              {office.map((c) => (
                <button
                  key={c.name}
                  data-orb={c.hue}
                  onClick={() => go({ room: "office", orb: c.name })}
                  style={{
                    display: "grid", justifyItems: "center", alignContent: "start", gap: 2, padding: "var(--s3) var(--s2)", border: 0, cursor: "pointer", borderRadius: 18, background: !making && c.name === me.name ? "var(--accent-wash)" : "var(--fill)", boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0,
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
            </Tall>
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
/* the page's margin round the app, kept clear of a phone's notch and home bar (the page asks to cover them:
   viewport-fit=cover, for the home-screen app) */
main.orbs-main { padding: max(var(--s5), env(safe-area-inset-top)) max(var(--margin), env(safe-area-inset-right)) max(var(--s5), env(safe-area-inset-bottom)) max(var(--margin), env(safe-area-inset-left)); }
/* a small phone (owner, 10-06: "more responsive and mobile friendly app wide"): edge to edge, so its whole
   width is the room's, the notch and the home bar still clear */
@media (max-width: 480px) {
  main.orbs-main { padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
  /* the window fills the screen; its rows stay at the top (a short room leaves room below, never a stretched top bar) */
  .orbs-window { border-radius: 0 !important; box-shadow: none !important; min-height: 100dvh; align-content: start; }
}
/* a finger's targets on a touch screen (WCAG 2.5.5, Apple's 44 pt): every control at least 44 by 44; the floor's
   small tags keep their look, and a finger gets an area round them; a text field at 16 px or more, or an
   iPhone zooms into it */
@media (pointer: coarse), (max-width: 760px) {
  button:not(.orbs-tag):not(.orbs-small), [role="button"]:not(.orbs-tag), select, textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]) { min-height: 44px !important; }
  button:not(.orbs-tag):not(.orbs-calday):not(.orbs-narrow), [role="button"]:not(.orbs-tag) { min-width: 44px !important; }
  /* a row of page numbers keeps to one line on a small phone: 44 high, 32 wide (WCAG 2.5.8 asks 24) */
  .orbs-narrow { min-width: 32px !important; }
  /* a month's days, seven across, cannot each be 44 wide on a small phone: they keep 44 of height and at least
     24 of width (WCAG 2.5.8) */
  .orbs-calday { min-width: 24px !important; }
  input, select, textarea { font-size: max(16px, 1em) !important; }
  .orbs-tag::after { content: ""; position: absolute; inset: -13px; }
  /* a small box (an orb's gestures, owner 10-07: "smaller containers"): 30 high as drawn, a finger's 44 round it */
  .orbs-small { position: relative; }
  .orbs-small::after { content: ""; position: absolute; inset: -7px 0; }
}
/* a phone: the side menu slides in from the left, over a scrim, and a top bar holds Back and the menu;
   wider, there is no scrim, not even for the frame before a widened window closes the menu */
.orbs-scrim { display: none; }
@media (max-width: 760px) {
  .orbs-window { grid-template-columns: minmax(0, 1fr) !important; overflow: visible !important; }
  .orbs-topbar { display: flex !important; }
  /* closed, it is hidden once it has slid away (out of Tab's reach and a screen reader's), and shown as it slides in */
  .orbs-side { position: fixed; inset: 0 auto 0 0; z-index: 30; width: min(300px, 86vw); overflow-y: auto; translate: -105% 0; visibility: hidden; transition: translate var(--m-slow) var(--m-spring), visibility 0s linear var(--m-slow); box-shadow: 4px 0 24px var(--shadow) !important; }
  .orbs-side { padding-top: calc(var(--s4) + env(safe-area-inset-top)) !important; padding-bottom: calc(var(--s4) + env(safe-area-inset-bottom)) !important; padding-left: calc(var(--s3) + env(safe-area-inset-left)) !important; }
  .orbs-side[data-open="true"] { translate: 0 0; visibility: visible; transition: translate var(--m-slow) var(--m-spring), visibility 0s; }
  /* the menu scrolls when it is taller than the phone; nothing in it is squeezed to fit instead (owner, 10-06:
     "under orbz, it says CEO Rob but the bottom is cut off": a line that hides its overflow had shrunk below its height) */
  .orbs-side > :not(:last-child) { flex-shrink: 0; } /* the office's list, last, is the part that gives way and scrolls */
  .orbs-scrim { display: block; position: fixed; inset: 0; z-index: 29; background: var(--ground); opacity: .72; }
}
@media (min-width: 1100px) { .orbs-pair { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) !important; } }
/* side by side, no hole under the shorter one (owner, 10-04: "no dead space please. to industry standards"):
   the row is as tall as the panel beside the card (never under 560px), and the card fills it, its body
   scrolling under his name with a fade where there is more */
@media (min-width: 1100px) {
  .orbs-pair { align-items: stretch !important; }
  .orbs-pair > .orbs-sheet { height: 0; min-height: max(100%, 560px); display: flex !important; flex-direction: column; }
  .orbs-pair > .orbs-sheet > .orbs-tall { flex: 1 1 0; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-gutter: stable; padding: 4px 10px 4px 0; margin-right: -6px; }
}
/* the work and the chat beside it (a session's Floor, a private chat with his computer open), on a wide screen; one above the other on a narrow one */
/* the calendar on a phone: each day its number, and a dot for each thing on it (the words are under it, for the day you pick) */
@media (max-width: 760px) {
  .orbs-calday { display: flex !important; flex-wrap: wrap; align-content: flex-start; gap: 3px !important; min-height: 46px !important; padding: 4px !important; }
  .orbs-calnum { flex-basis: 100%; }
  .orbs-calword { display: none; }
}
@media (min-width: 1100px) { .orbs-beside { grid-template-columns: minmax(0, 6fr) minmax(320px, 5fr) !important; } }
/* a conversation fits the screen (owner, 10-07: "scrolling bar on the WHOLE CONVO that doesnt go past the screen"):
   its room is the window's height (ui/fill.ts), the conversation one row of it that scrolls on its own; beside
   it, his computer or the team's board scrolls on its own too */
.orbs-convo { display: grid; grid-template-rows: minmax(0, 1fr); min-height: 0; }
.orbs-convo > * { min-height: 0; }
.orbs-talk { display: grid; min-height: 0; }
.orbs-switch { display: none; }
/* narrower than side by side: one at a time, each the whole height, a switch between them (10-07) */
@media (max-width: 1099px) {
  .orbs-convo.orbs-beside[data-view="work"] > .orbs-talk, .orbs-convo.orbs-beside[data-view="talk"] > .orbs-pane { display: none; }
  .orbs-switch { display: flex; }
}
/* a pane scrolls; what is in it keeps its own height (10-07: under a fixed height its rows shrank, the
   computers' row to a sliver and the board cut short, "we cant see this section anymore") */
.orbs-pane { overflow-y: auto; overscroll-behavior: contain; grid-auto-rows: max-content; }
/* every scroll bar in the app's own: thin, the quiet grey on nothing (owner, 10-07: "make the scrolling
   containers take the style of the app") */
* { scrollbar-width: thin; scrollbar-color: var(--quiet) transparent; }
@media (min-width: 761px) { .orbs-fit .orbs-side { max-height: calc(100dvh - 2 * var(--s5)); } }
@media (min-width: 1100px) { .orbs-convo.orbs-beside { grid-template-rows: minmax(0, 1fr); } }`;
document.head.append(style);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
