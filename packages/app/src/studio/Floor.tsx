// The game studio's floor, live (owner, 10-18: "one of the rooms needs to be a gaming studio", its own floor): the
// studio's orbs at their desks in their discipline's pod while they work, and between tasks wherever their traits and
// their jobs take them (an animator to the mocap stage, a sound designer into the booth, QA to the bug board, anyone to
// the arcade). What the home really does makes its moments: work that lands sends its orb to ring the ship gong, work
// that stops back to the milestone board, an ask for your OK to the studio head's door. studio/plan.ts plans;
// studio/art.tsx draws; the office floor's routing walks this floor's grid. Solid and bigger, as every floor's orbs are
// (floor/motion.ts FLOOR_ORB).
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Orb } from "../orb/Orb.tsx";
import { sheetOf, type Character } from "../orb/spec.ts";
import type { Gesture } from "../orb/life.ts";
import type { Mood } from "../orb/mood.ts";
import { WORN } from "../orb/useMood.ts";
import { idOf } from "../home/link.ts";
import type { Route } from "../ui/nav.ts";
import { FLOOR_CSS, skyAt } from "../floor/art.tsx";
import { FLOOR_ORB } from "../floor/motion.ts";
import { route, speed, type Spot } from "../floor/plan.ts";
import { titleAt } from "../orb/careers.ts";
import { Backdrop, Gong, Station, STUDIO_CSS } from "./art.tsx";
import { AREAS, H, momentOf, nextS, PODS, SDESKS, SGRID, SPOIS, studioSeats, TOP, W, WALL, type SMoment, type SPlan, type SPoiId } from "./plan.ts";

const ORB = FLOOR_ORB.size;
const tag: CSSProperties = { display: "inline-block", padding: "1px 8px", borderRadius: 999, font: "800 11px/16px var(--font)", whiteSpace: "nowrap" };
const sign: CSSProperties = { position: "absolute", zIndex: 1, ...tag, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-1)", background: "var(--card)", boxShadow: "inset 0 0 0 1px var(--accent)", pointerEvents: "none" };
type Traits = Parameters<typeof nextS>[0]["traits"];
type Moment = SMoment & { at: number };
type Sim = { c: Character; id: string; x: number; y: number; path: Spot[]; i: number; plan: SPlan | null; until: number; arrived: boolean; walking: boolean; phase: number; speed: number; traits: Traits; r: () => number; moment: Moment | null };
/** One of the home's events for a studio orb, numbered as it came. */
export type StudioEvent = { seq: number; type: string; orb: string; outcome?: unknown };

const seeded = (s: string): (() => number) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 1_000_000) / 1_000_000;
};

export function StudioFloor({ crew, moods, events, levels, shipped, go }: {
  crew: Character[]; moods: Record<string, Mood>; events: StudioEvent[];
  /** Each orb's level, by its id (the org chart's), for its title on the floor. */
  levels: Record<string, string>;
  /** How much of the studio's work has landed (the head's shelf of awards, the milestone board's done column). */
  shipped: number;
  go: (r: Route) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current!;
    const fit = (): void => setWidth(el.clientWidth);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const phone = width > 0 && width < 640;
  // on a phone the floor opens on the pods' middle, the code pod in view
  const view = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const v = view.current;
    if (phone && v) v.scrollLeft = Math.max(0, 450 * 0.62 - v.clientWidth / 2);
  }, [phone]);
  const scale = !width ? 0.75 : phone ? 0.62 : Math.min(1.05, width / W);
  const px = (v: number): number => v * scale;
  const size = Math.round(ORB * scale);
  const [now, setNow] = useState(() => new Date());
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    // the build on the wall plays a frame every 700 ms (its hero hops; the waveform moves); held on a held clock
    const b = (globalThis as { __orbsTime?: number }).__orbsTime === undefined ? setInterval(() => setFrame((n) => n + 1), 700) : 0;
    return () => {
      clearInterval(t);
      if (b) clearInterval(b);
    };
  }, []);
  const seats = useMemo(() => studioSeats(crew.map((c) => ({ name: c.name, specialty: c.specialty }))), [crew]);

  // ── who is where ──
  const sims = useRef(new Map<string, Sim>());
  const els = useRef(new Map<string, HTMLDivElement>());
  const bobs = useRef(new Map<string, HTMLDivElement>());
  const live = useRef({ scale, moods, seats });
  live.current = { scale, moods, seats };
  const [shown, setShown] = useState<Record<string, { mark: string; label: string; arrived: boolean; at: string }>>({});
  const [speech, setSpeech] = useState<Record<string, string>>({});
  const [gest, setGest] = useState<Record<string, { name: Gesture; n: number }>>({});
  const [ringing, setRinging] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const later = (ms: number, fn: () => void): void => void timers.current.push(window.setTimeout(fn, ms));
  const say = (s: Sim, line: string): void => {
    setSpeech((sp) => ({ ...sp, [s.id]: line }));
    later(4_200, () => setSpeech((sp) => {
      if (sp[s.id] !== line) return sp;
      const { [s.id]: _, ...rest } = sp;
      return rest;
    }));
  };

  const assign = (s: Sim, plan: SPlan, instant = false): void => {
    s.plan = plan;
    s.until = performance.now() + (plan.kind === "desk" ? 16_000 : 9_000) + s.r() * 10_000;
    const seat = live.current.seats.get(s.c.name);
    const poi = plan.kind === "poi" ? SPOIS.find((p) => p.id === plan.poi)! : null;
    const target = poi ? { approach: poi.approach, at: poi.at } : seat ? { approach: seat.approach, at: seat.seat } : { approach: { x: 600, y: 330 }, at: { x: 600, y: 330 } };
    if (instant) {
      s.x = target.at.x;
      s.y = target.at.y;
      s.path = [];
      s.i = 0;
      s.arrived = true;
    } else {
      const way = route({ x: s.x, y: s.y }, target.approach, SGRID) ?? [{ x: s.x, y: s.y }, target.approach];
      s.path = target.at.x !== target.approach.x || target.at.y !== target.approach.y ? [...way, target.at] : way;
      s.i = 1;
      s.arrived = false;
    }
    setShown((m) => ({ ...m, [s.c.name]: { mark: plan.mark, label: plan.label, arrived: s.arrived, at: plan.kind === "poi" ? `poi:${plan.poi}` : "desk" } }));
  };
  const decide = (s: Sim, instant = false): void => {
    const mood = live.current.moods[s.id] ?? "idle";
    const working = mood === "working" || mood === "thinking" || mood === "waiting";
    if (s.moment && !(working && !s.moment.poi)) {
      const m = s.moment;
      if (m.poi && (s.plan?.kind !== "poi" || s.plan.poi !== m.poi)) {
        const p = SPOIS.find((x) => x.id === m.poi)!;
        return assign(s, { kind: "poi", poi: m.poi, label: p.label, mark: p.mark });
      }
      if (m.poi || s.plan?.kind === "desk") return;
    }
    const due = s.arrived && performance.now() > s.until;
    if (working && s.plan?.kind === "desk") return;
    if (!working && !due && s.plan) return;
    const busy = new Set<SPoiId>();
    for (const o of sims.current.values()) if (o !== s && o.plan?.kind === "poi") busy.add(o.plan.poi);
    assign(s, nextS({ traits: s.traits, working, job: s.c.specialty }, busy, s.r), instant);
  };

  useEffect(() => {
    const ms = sims.current;
    for (const name of [...ms.keys()]) if (!crew.some((c) => c.name === name)) ms.delete(name);
    for (const c of crew) {
      if (ms.has(c.name)) {
        ms.get(c.name)!.c = c;
        continue;
      }
      const traits = Object.fromEntries(sheetOf(c).traits.map((t) => [t.name, t.value])) as Traits;
      const s: Sim = { c, id: idOf(c.name), x: 600, y: 330, path: [], i: 0, plan: null, until: 0, arrived: true, walking: false, phase: 0, speed: speed(traits) * 1.2, traits, r: seeded(`${c.name}:${c.seed}`), moment: null };
      ms.set(c.name, s);
      decide(s, true);
    }
  }, [crew]);
  useEffect(() => {
    const t = setInterval(() => {
      for (const s of sims.current.values()) decide(s);
    }, 600);
    return () => clearInterval(t);
  }, []);

  // ── the home's events, as moments ──
  const heard = useRef(0);
  useEffect(() => {
    const fresh = events.filter((e) => e.seq > heard.current).sort((a, b) => a.seq - b.seq);
    if (!fresh.length) return;
    heard.current = Math.max(heard.current, ...fresh.map((e) => e.seq));
    for (const e of fresh) {
      const s = [...sims.current.values()].find((x) => x.id === e.orb);
      if (!s) continue;
      const said = momentOf(e);
      if (!said) continue;
      const m: Moment = { ...said, at: Date.now() };
      s.moment = m;
      if (!m.poi) {
        say(s, m.line);
        later(2_500, () => (s.moment === m ? (s.moment = null) : undefined));
      }
      decide(s);
    }
  }, [events]);

  // ── the walking: by the clock, straight onto the page ──
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (t: number): void => {
      const dt = Math.min(0.5, (t - last) / 1000);
      last = t;
      const k = live.current.scale;
      for (const s of sims.current.values()) {
        if (s.i < s.path.length) {
          const p = s.path[s.i]!;
          const d = Math.hypot(p.x - s.x, p.y - s.y);
          const step = s.speed * dt;
          if (step >= d) {
            s.x = p.x;
            s.y = p.y;
            s.i++;
          } else {
            s.x += ((p.x - s.x) / d) * step;
            s.y += ((p.y - s.y) / d) * step;
          }
          s.walking = true;
          s.phase += dt * s.speed * 0.13;
          if (s.i >= s.path.length) {
            s.walking = false;
            s.arrived = true;
            const m = s.moment;
            const name = s.c.name;
            setShown((x) => (x[name] ? { ...x, [name]: { ...x[name]!, arrived: true } } : x));
            if (m && m.poi && s.plan?.kind === "poi" && s.plan.poi === m.poi) {
              say(s, m.line);
              setGest((g) => ({ ...g, [name]: { name: m.gong ? "hop" : m.poi === "sprint" ? "pout" : "nod", n: (g[name]?.n ?? 0) + 1 } }));
              if (m.gong) {
                setRinging(true);
                later(1_900, () => setRinging(false));
              }
              s.until = performance.now() + 6_000;
              later(5_000, () => (s.moment === m ? (s.moment = null) : undefined));
            }
          }
        }
        const el = els.current.get(s.c.name);
        if (el) {
          el.style.transform = `translate(${(s.x * k).toFixed(1)}px, ${(s.y * k).toFixed(1)}px)`;
          el.style.zIndex = String(Math.round(s.y));
        }
        const bob = bobs.current.get(s.c.name);
        if (bob) bob.style.transform = s.walking ? `translateY(${(-Math.abs(Math.sin(s.phase)) * 5 * k).toFixed(1)}px) rotate(${(Math.sin(s.phase) * 3).toFixed(1)}deg)` : "";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const working = crew.filter((c) => ["working", "thinking"].includes(moods[idOf(c.name)] ?? "idle")).length;
  const sitter = (n: number): Character | null => crew.find((c) => seats.get(c.name)?.desk?.n === n) ?? null;
  const freeDesk = SDESKS.find((d) => d.pod !== "audio" && d.pod !== "qa" && !sitter(d.n));
  return (
    <div ref={box} data-studio-floor style={{ minWidth: 0 }}>
      <style>{FLOOR_CSS + STUDIO_CSS}</style>
      <div ref={view} data-floor-view style={{ overflowX: phone ? "auto" : "visible", overflowY: "hidden", borderRadius: 20, boxShadow: "inset 0 0 0 1px var(--hairline)", overscrollBehaviorX: "contain", scrollbarWidth: "thin" }}>
        <div data-floor-plan style={{ position: "relative", width: px(W), height: px(H), borderRadius: 20, overflow: "hidden", isolation: "isolate" }}>
          <Backdrop now={now} sky={skyAt(now.getHours())} frame={frame} todo={Math.max(2, crew.length - working)} doing={working} done={shipped} bugs={Math.max(3, 9 - shipped)} shipped={shipped} />
          {SDESKS.map((d) => {
            const c = sitter(d.n);
            return <Station key={d.n} d={d} seat={c ? { hue: c.hue, working: ["working", "thinking"].includes(moods[idOf(c.name)] ?? "idle") } : null} />;
          })}
          <Gong ringing={ringing} />
          {AREAS.filter((a) => a.id !== "pods").map((a) => (
            <span key={a.id} data-orb={a.hue} data-area={a.id} style={{ ...sign, left: px(a.door!.x + a.door!.w / 2), top: px(a.rect.y === WALL ? TOP - 30 : a.rect.y + 14), translate: "-50% 0" }}>{a.name}</span>
          ))}
          {PODS.map((p) => (
            <span key={p.id} data-orb={p.hue} data-pod={p.id} style={{ ...sign, left: px(p.x + 150), top: px(352 + 4), translate: "-50% 0" }}>{p.name}</span>
          ))}
          {freeDesk && (
            <button type="button" className="orbs-tag" data-hire-studio onClick={() => go({ room: "recruiter", family: "studio" })} aria-label="Hiring for the game studio: see who applied" data-orb="iris"
              style={{ position: "absolute", left: px(freeDesk.rect.x + freeDesk.rect.w / 2), top: px(freeDesk.rect.y - 54), translate: "-50% 0", zIndex: H + 10, ...tag, cursor: "pointer", border: 0, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1px var(--accent)", color: "var(--text-1)" }}>
              + Hire
            </button>
          )}
          {crew.map((c) => {
            const id = idOf(c.name);
            const m = moods[id] ?? "idle";
            const sh = shown[c.name];
            const talking = speech[id];
            const top = -size * 1.17;
            const above = c.hat !== "none" ? top : -size * 0.62;
            return (
              <div key={c.name} ref={(el) => void (el ? els.current.set(c.name, el) : els.current.delete(c.name))} style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, willChange: "transform" }}>
                <div ref={(el) => void (el ? bobs.current.set(c.name, el) : bobs.current.delete(c.name))} style={{ position: "absolute", left: 0, top: 0 }}>
                  <button className="orbs-tag" type="button" data-studio-orb={c.name} data-at={sh?.at} data-arrived={sh?.arrived ? "true" : "false"} data-orb={c.hue}
                    onClick={() => go({ room: "office", orb: c.name })} aria-label={`${c.name}, ${titleAt(c.specialty, levels[id] ?? "Junior")}: ${sh?.label ?? "on the floor"}. Open the profile`} title={`${c.name} · ${sh?.label ?? ""}`}
                    style={{ position: "absolute", left: -size / 2, top, width: size, height: size * 1.25, padding: 0, border: 0, background: "transparent", cursor: "pointer" }}>
                    <Orb character={c} size={size} state={talking ? "speaking" : WORN[m].state} gesture={gest[c.name] ?? null} poke={false} every={2} solid={FLOOR_ORB.solid} />
                  </button>
                  <span data-orb={c.hue} aria-hidden style={{ position: "absolute", left: 0, top: above - 4, transform: "translate(-50%, -100%)", display: "flex", alignItems: "center", gap: 4, pointerEvents: "none", whiteSpace: "nowrap" }}>
                    <span style={{ ...tag, color: "var(--ground)", background: "var(--accent)" }}>{c.name}</span>
                    {sh?.mark && <span data-mark style={{ ...tag, padding: "0 5px", background: m === "waiting" ? "var(--alert)" : "var(--card)", color: m === "waiting" ? "var(--ground)" : "var(--text-1)", boxShadow: "inset 0 0 0 1px var(--hairline)" }}>{sh.mark}</span>}
                  </span>
                  {talking && (
                    <span data-speech style={{ position: "absolute", left: 0, top: above - 28, transform: "translate(-50%, -100%)", width: "max-content", maxWidth: 180, padding: "6px 10px", borderRadius: 12, background: "var(--card)", boxShadow: "0 0 0 1px var(--hairline)", font: "600 12px/16px var(--font)", color: "var(--text-1)", pointerEvents: "none" }}>
                      {talking}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {phone && <span style={{ display: "block", marginTop: 6, textAlign: "center", font: "500 13px/18px var(--font)", color: "var(--text-3)" }}>Swipe to look around the studio · press an orb for its profile</span>}
    </div>
  );
}
