// The desk's floor, live (PLAN 5.22; owner, 10-10: "like the office, with desks etc, funny, fast professional"): the
// desk's orbs at their desks in the pit while they work, and between trades wherever their traits take them, faster than
// the office's (half again its pace). What the desk really does makes its moments: a trade won on paper sends its orb to
// ring the bell, a loss to the coffee bar, a fill lights its screens green or red, a note is pinned to the corkboard, a
// strategy drawn on the war room's whiteboard, a real swap asked for at its head's door. desk/plan.ts plans;
// desk/art.tsx draws; the office floor's routing walks this floor's grid.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Orb } from "../orb/Orb.tsx";
import { sheetOf, SPECIALTIES, type Character } from "../orb/spec.ts";
import type { Gesture } from "../orb/life.ts";
import type { Mood } from "../orb/mood.ts";
import { WORN } from "../orb/useMood.ts";
import { idOf, type DeskEvent } from "../home/link.ts";
import type { Route } from "../ui/nav.ts";
import { FLOOR_CSS, skyAt } from "../floor/art.tsx";
import { route, speed, type Spot } from "../floor/plan.ts";
import { NAMES } from "../floor/props.ts";
import { Backdrop, Bell, Station, TRADE_CSS, type WallPrice } from "./art.tsx";
import { AREAS, H, momentOf, nextT, TDESKS, TGRID, TPOIS, deskSeats, W, type TMoment, type TPlan, type TPoiId } from "./plan.ts";

const ORB = 80;
const tag: CSSProperties = { display: "inline-block", padding: "1px 8px", borderRadius: 999, font: "800 11px/16px var(--font)", whiteSpace: "nowrap" };
const sign: CSSProperties = { position: "absolute", zIndex: 1, ...tag, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-1)", background: "var(--card)", boxShadow: "inset 0 0 0 1px var(--accent)", pointerEvents: "none" };
type Traits = Parameters<typeof nextT>[0]["traits"];
type Moment = TMoment & { at: number };
type Sim = { c: Character; id: string; x: number; y: number; path: Spot[]; i: number; plan: TPlan | null; until: number; arrived: boolean; walking: boolean; phase: number; speed: number; traits: Traits; r: () => number; moment: Moment | null };

const seeded = (s: string): (() => number) => {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 1_000_000) / 1_000_000;
};

export function DeskFloor({ crew, moods, events, prices, spark, notes, strategies, riskOn, board, go }: {
  crew: Character[]; moods: Record<string, Mood>; events: DeskEvent[]; prices: WallPrice[]; spark: number[]; notes: number; strategies: number; riskOn: boolean;
  board: { name: string; hue: Character["hue"]; bar: number; up: boolean }[]; go: (r: Route) => void;
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
  const scale = !width ? 0.75 : phone ? 0.62 : Math.min(1.05, width / W);
  const px = (v: number): number => v * scale;
  const size = Math.round(ORB * scale);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const seats = useMemo(() => deskSeats(crew.map((c) => ({ name: c.name, specialty: c.specialty }))), [crew]);

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
  const [flash, setFlash] = useState<Record<string, "ok" | "off">>({});
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

  const assign = (s: Sim, plan: TPlan, instant = false): void => {
    s.plan = plan;
    s.until = performance.now() + (plan.kind === "desk" ? 14_000 : 8_000) + s.r() * 10_000;
    const seat = live.current.seats.get(s.c.name);
    const poi = plan.kind === "poi" ? TPOIS.find((p) => p.id === plan.poi)! : null;
    const target = poi ? { approach: poi.approach, at: poi.at } : seat ? { approach: seat.approach, at: seat.seat } : { approach: { x: 600, y: 330 }, at: { x: 600, y: 330 } };
    if (instant) {
      s.x = target.at.x;
      s.y = target.at.y;
      s.path = [];
      s.i = 0;
      s.arrived = true;
    } else {
      const way = route({ x: s.x, y: s.y }, target.approach, TGRID) ?? [{ x: s.x, y: s.y }, target.approach];
      s.path = target.at.x !== target.approach.x || target.at.y !== target.approach.y ? [...way, target.at] : way;
      s.i = 1;
      s.arrived = false;
    }
    setShown((m) => ({ ...m, [s.c.name]: { mark: plan.mark, label: plan.label, arrived: s.arrived, at: plan.kind === "poi" ? `poi:${plan.poi}` : "desk" } }));
  };
  const decide = (s: Sim, instant = false): void => {
    const mood = live.current.moods[s.id] ?? "idle";
    const working = mood === "working" || mood === "thinking" || mood === "waiting";
    if (s.moment && !working) {
      const m = s.moment;
      if (m.poi && (s.plan?.kind !== "poi" || s.plan.poi !== m.poi)) {
        const p = TPOIS.find((x) => x.id === m.poi)!;
        return assign(s, { kind: "poi", poi: m.poi, label: p.label, mark: p.mark });
      }
      if (!m.poi && s.plan?.kind !== "desk") return assign(s, { kind: "desk", label: NAMES.dept, mark: "📊" });
      return;
    }
    const due = s.arrived && performance.now() > s.until;
    if (working && s.plan?.kind === "desk") return;
    if (!working && !due && s.plan) return;
    const busy = new Set<TPoiId>();
    for (const o of sims.current.values()) if (o !== s && o.plan?.kind === "poi") busy.add(o.plan.poi);
    assign(s, nextT({ traits: s.traits, working }, busy, s.r), instant);
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
      const s: Sim = { c, id: idOf(c.name), x: 600, y: 330, path: [], i: 0, plan: null, until: 0, arrived: true, walking: false, phase: 0, speed: speed(traits) * 1.5, traits, r: seeded(`${c.name}:${c.seed}`), moment: null };
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

  // ── the desk's events, as moments ──
  const heard = useRef(0);
  useEffect(() => {
    const fresh = events.filter((e) => e.seq > heard.current).sort((a, b) => a.seq - b.seq);
    if (!fresh.length) return;
    const first = heard.current === 0;
    heard.current = Math.max(heard.current, ...fresh.map((e) => e.seq));
    if (first) return; // what happened before the floor opened is history, not a moment
    for (const e of fresh) {
      const s = [...sims.current.values()].find((x) => x.id === e.orb);
      if (!s) continue;
      const said = momentOf({ ...e, type: String(e.type) });
      if (!said) continue;
      const m: Moment = { ...said, at: Date.now() };
      s.moment = m;
      if (m.flash) {
        setFlash((f) => ({ ...f, [s.c.name]: m.flash! }));
        later(1_400, () => setFlash((f) => {
          const { [s.c.name]: _, ...rest } = f;
          return rest;
        }));
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
              setGest((g) => ({ ...g, [name]: { name: m.ring ? "hop" : m.poi === "coffee" ? "pout" : "nod", n: (g[name]?.n ?? 0) + 1 } }));
              if (m.ring) {
                setRinging(true);
                later(1_700, () => setRinging(false));
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

  // each desk's two seats: who sits there, whether it is at work, its screens' flash
  const seatOf = (n: number, side: 0 | 1): Character | null => crew.find((c) => {
    const s = seats.get(c.name);
    return s?.desk?.n === n && s.seat.x === TDESKS[n]!.seats[side].x;
  }) ?? null;
  const freeDesk = TDESKS.find((d) => !seatOf(d.n, 0) || !seatOf(d.n, 1));
  return (
    <div ref={box} data-desk-floor style={{ minWidth: 0 }}>
      <style>{FLOOR_CSS + TRADE_CSS}</style>
      <div data-floor-view style={{ overflowX: phone ? "auto" : "visible", overflowY: "hidden", borderRadius: 20, boxShadow: "inset 0 0 0 1px var(--hairline)", overscrollBehaviorX: "contain", scrollbarWidth: "thin" }}>
        <div data-floor-plan style={{ position: "relative", width: px(W), height: px(H), borderRadius: 20, overflow: "hidden", isolation: "isolate" }}>
          <Backdrop now={now} sky={skyAt(now.getHours())} prices={prices} spark={spark} notes={notes} strategies={strategies} riskOn={riskOn} board={board} />
          {TDESKS.map((d) => {
            const a = seatOf(d.n, 0);
            const b = seatOf(d.n, 1);
            const busy = (c: Character | null) => (c ? { hue: c.hue, working: ["working", "thinking"].includes(moods[idOf(c.name)] ?? "idle") } : null);
            return <Station key={d.n} d={d} seats={[busy(a), busy(b)]} flash={[a ? (flash[a.name] ?? null) : null, b ? (flash[b.name] ?? null) : null]} />;
          })}
          <Bell ringing={ringing} />
          {AREAS.map((a) => (
            <span key={a.id} data-orb={a.hue} data-area={a.id} style={{ ...sign, left: px(a.door ? a.door.x + a.door.w / 2 : a.rect.x + 40), top: px(a.id === "pit" ? a.rect.y - 11 : a.rect.y === 84 ? 300 - 30 : a.rect.y + 14), translate: a.door ? "-50% 0" : undefined }}>{a.name}</span>
          ))}
          <span data-orb={riskOn ? "mint" : "coral"} data-risk-tag={riskOn ? "on" : "off"} style={{ ...sign, left: px(1000), top: px(H - 44), translate: "-50% 0" }}>{riskOn ? "Real trades on" : "Real trades off"}</span>
          {freeDesk && (
            <button type="button" className="orbs-tag" data-hire-desk onClick={() => go({ room: "recruiter", family: "desk" })} aria-label={NAMES.hiring} data-orb="lime"
              style={{ position: "absolute", left: px(freeDesk.rect.x + freeDesk.rect.w / 2), top: px(freeDesk.rect.y - 50), translate: "-50% 0", zIndex: H + 10, ...tag, cursor: "pointer", border: 0, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1px var(--accent)", color: "var(--text-1)" }}>
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
                  <button className="orbs-tag" type="button" data-desk-orb={c.name} data-at={sh?.at} data-arrived={sh?.arrived ? "true" : "false"} data-orb={c.hue}
                    onClick={() => go({ room: "office", orb: c.name })} aria-label={`${c.name}, ${SPECIALTIES[c.specialty].title}: ${sh?.label ?? "on the floor"}. Open the profile`} title={`${c.name} · ${sh?.label ?? ""}`}
                    style={{ position: "absolute", left: -size / 2, top, width: size, height: size * 1.25, padding: 0, border: 0, background: "transparent", cursor: "pointer" }}>
                    <Orb character={c} size={size} state={talking ? "speaking" : WORN[m].state} gesture={gest[c.name] ?? null} poke={false} every={2} />
                  </button>
                  <span data-orb={c.hue} aria-hidden style={{ position: "absolute", left: 0, top: above - 4, transform: "translate(-50%, -100%)", display: "flex", alignItems: "center", gap: 4, pointerEvents: "none", whiteSpace: "nowrap" }}>
                    <span style={{ ...tag, color: "var(--ground)", background: "var(--accent)" }}>{c.name}</span>
                    {sh?.mark && <span data-mark style={{ ...tag, padding: "0 5px", background: m === "waiting" ? "var(--alert)" : "var(--card)", color: m === "waiting" ? "var(--ground)" : "var(--text-1)", boxShadow: "inset 0 0 0 1px var(--hairline)" }}>{sh.mark}</span>}
                  </span>
                  {talking && (
                    <span data-speech style={{ position: "absolute", left: 0, top: above - 28, transform: "translate(-50%, -100%)", width: "max-content", maxWidth: 180, padding: "6px 10px", borderRadius: 12, background: "var(--card)", boxShadow: "0 0 0 1px var(--hairline), 0 4px 12px var(--shadow)", font: "700 12px/16px var(--font)", color: "var(--text-1)", pointerEvents: "none", animation: "orbs-floor-pop 220ms var(--m-spring)" }}>
                      {talking}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {phone && <span style={{ display: "block", marginTop: 6, textAlign: "center", font: "500 13px/18px var(--font)", color: "var(--text-3)" }}>Swipe to look around the floor · press an orb for its profile</span>}
    </div>
  );
}
