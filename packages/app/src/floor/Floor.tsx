// The office floor (owner, 10-05: "the office should be a whole office visual of them working in an office
// ... see them move around the office etc. they sit at their desks. make it intricate and nice and fun"; and
// "we should also make a dashboard ... and when we press on the orb it goes to their profile w stats and
// all"). The office as a place, live: every orb at its desk in its department while it works, at the
// meeting table in a Brainstorm, on the sofa when it dozes, and, free, wherever its traits take it
// (floor/plan.ts decides; floor/art.tsx draws). Pressing an orb opens its profile. Over it, the day at a
// glance: who is working, who needs you, what is on today, and what just happened.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Orb } from "../orb/Orb.tsx";
import { FAMILIES, SPECIALTIES, sheetOf, type Character, type Family } from "../orb/spec.ts";
import type { Gesture } from "../orb/life.ts";
import type { Mood } from "../orb/mood.ts";
import { WORN } from "../orb/useMood.ts";
import { Balanced, OneLine } from "../ui/Balanced.tsx";
import { idOf, type CalendarEntry, type Meeting, type Notice, type Office } from "../home/link.ts";

/** A meeting under way, by the orbs' names (the home's ids turned to names). */
type Meet = Meeting;
/** How long the walk to a meeting is shown: after that, the two are already there when the floor opens. */
const MEET_WALK_MS = 12_000;
import type { Route } from "../ui/nav.ts";
import { CameraFeed } from "./camera.tsx";
import { DeskPiece, FLOOR_CSS, MeetingTable, PingPong, Room, SideTables, skyAt, type Screen } from "./art.tsx";
import { busiest, VIEWS, viewRect, zoneOf, type ViewId } from "./plan.ts";
import { DESKS, H, POIS, ROOMS, SEATS, W, WALL, ZONES, dice, dwell, meetPlan, meetSpot, next, route, seating, sentBy, speed, type Desk, type Plan, type PoiId, type Spot, type Traits } from "./plan.ts";

/** An orb's size on the plan (its window's width). */
const ORB = 84;
const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" };
const small: CSSProperties = { font: "500 13px/18px var(--font)", color: "var(--text-3)", textWrap: "pretty", overflowWrap: "anywhere" };
const panel: CSSProperties = { display: "grid", gap: 10, alignContent: "start", padding: "var(--s4)", borderRadius: 18, background: "var(--fill)", boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0 };
const ICON: Record<Family | "play", string> = { exec: "👑", build: "🛠", think: "💡", make: "🎨", finance: "💰", business: "📈", life: "🌿", play: "🎮" };

type Sim = {
  c: Character; id: string; x: number; y: number; path: Spot[]; i: number; plan: Plan | null;
  hold: { poi?: PoiId; seat?: number }; until: number; arrived: boolean; walking: boolean; phase: number;
  speed: number; traits: Traits; r: () => number; mood: Mood | null;
};
type Shown = { label: string; mark: string; kind: Plan["kind"] | "none"; arrived: boolean; poi?: PoiId; at: string };
type Line = { at: number; text: string; orb: string | null };

const traitsOf = (c: Character): Traits => Object.fromEntries(sheetOf(c).traits.map((t) => [t.name, t.value])) as Traits;
const time = (at: number): string => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const today = (now: Date): string => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
/** Which room a phone's floor shows, kept on this device. */
const VIEW_KEY = "orbs.floor.view";
const greeting = (h: number): string => (h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");

export function Floor({ home, office, moods, person, go }: { home: Office | null; office: Character[]; moods: Record<string, Mood>; person: string | null; go: (r: Route) => void }) {
  // ── the size it is drawn at ──
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
  // on a phone, one room at a time, the width of the screen, and chips to go from one to another (owner, 10-07:
  // "can we make it by room on mobile and the user can switch?"); the choice is this device's
  const [picked, setPicked] = useState<ViewId | null>(() => {
    try {
      const v = globalThis.localStorage?.getItem(VIEW_KEY);
      return VIEWS.some((x) => x.id === v) ? (v as ViewId) : null;
    } catch {
      return null;
    }
  });
  const pick = (v: ViewId): void => {
    setPicked(v);
    try {
      globalThis.localStorage?.setItem(VIEW_KEY, v);
    } catch {
      // a private window: for as long as the page is open
    }
  };
  const desks = useMemo(() => seating(office.map((c) => ({ name: c.name, family: SPECIALTIES[c.specialty].family }))), [office]);
  const view: ViewId = picked ?? busiest(desks); // until you choose, where most of the office sits
  const shownRect = phone ? viewRect(view) : null;
  const scale = !width ? 0.75 : shownRect ? width / shownRect.w : phone ? 0.62 : Math.min(1.05, width / W);
  const size = Math.round(ORB * scale);
  const pan = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = pan.current;
    if (!phone || !el) return;
    // a room: the floor moved under the window to it; the whole office: wider than the screen, from its middle
    if (shownRect) {
      el.scrollLeft = shownRect.x * scale;
      el.scrollTop = shownRect.y * scale;
    } else el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [phone, view, scale]);
  // the room shown, its chip in sight (a block, not an arrow's value: scrollIntoView returns a Promise)
  useEffect(() => {
    if (phone) box.current?.querySelector(`[data-view-choice="${view}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [phone, view]);

  // ── the clock: the windows' sky, the wall clock, the greeting ──
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ── what the home says, live: who is in a Brainstorm, what each is doing, what each is saying ──
  const [meeting, setMeeting] = useState<Record<string, string>>({}); // orb → its Brainstorm's conversation
  const [doing, setDoing] = useState<Record<string, string>>({}); // orb → what it says it is doing (orb.activity)
  const [speech, setSpeech] = useState<Record<string, string>>({});
  const said = useRef<Record<string, string>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [day, setDay] = useState<CalendarEntry[]>([]);
  const [hiring, setHiring] = useState<string[]>([]);
  const [sessions, setSessions] = useState<Record<number, string>>({});
  // office life (PLAN 5.9): the meetings the home decided that are under way, by the orbs' names
  const [meets, setMeets] = useState<Meet[]>([]);
  const skew = useRef(0); // the home's clock less this device's: a meeting is timed by the home's
  const nameOf = useMemo(() => new Map(office.map((c) => [idOf(c.name), c.name])), [office]);
  useEffect(() => {
    if (!home) return;
    const loadDay = (): void => void home.calendar(today(new Date()), today(new Date())).then(setDay, () => {});
    const loadHiring = (): void => void home.recruiting().then((r) => setHiring(r.positions), () => {});
    const loadSessions = (): void => void home.sessions().then((ss) => setSessions(Object.fromEntries(ss.map((x) => [x.id, x.title]))), () => {});
    const loadMeets = (): void => void home.socialOf().then(
      (x) => (skew.current = x.now - Date.now(), setMeets(x.current.map((m) => ({ ...m, a: nameOf.get(m.a) ?? m.a, b: nameOf.get(m.b) ?? m.b, winner: m.winner ? (nameOf.get(m.winner) ?? m.winner) : null })))),
      () => {},
    );
    loadDay();
    loadHiring();
    loadSessions();
    loadMeets();
    void home.notices().then(
      (ns: Notice[]) => setLines((l) => (l.length ? l : ns.slice(0, 8).map((n) => ({ at: n.at, orb: n.orb, text: noticeLine(n, nameOf.get(n.orb) ?? n.orb) })))),
      () => {},
    );
    const fade = new Map<string, number>();
    let flush = 0;
    const stop = home.watch({
      event: (e) => {
        const who = e.orb ? (nameOf.get(e.orb) ?? e.orb) : null;
        const d = e.data ?? {};
        if (e.type === "run.started" && e.orb) said.current[e.orb] = "";
        // a board vote (PLAN 5.17): its members go to the Board room's table, and back to their desks once it is decided;
        // a session meets in Sessions, not on the floor (owner, 10-07)
        if (e.type === "board.proposed" && Array.isArray(d.members)) setMeeting((m) => ({ ...m, ...Object.fromEntries((d.members as string[]).map((o) => [o, "board"])) }));
        if (e.type === "board.decided") setMeeting((m) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== "board")));
        if ((e.type === "run.finished" || e.type === "run.interrupted") && e.orb) {
          const orb = e.orb;
          setDoing((m) => {
            const { [orb]: _, ...rest } = m;
            return rest;
          });
          window.clearTimeout(fade.get(orb));
          fade.set(orb, window.setTimeout(() => setSpeech((s) => {
            const { [orb]: _, ...rest } = s;
            return rest;
          }), 6_000));
        }
        if (e.type === "orb.activity" && e.orb && typeof d.text === "string") setDoing((m) => ({ ...m, [e.orb!]: String(d.text) }));
        if (/^reminder\.|^schedule\./.test(e.type)) loadDay();
        if (/^position\./.test(e.type)) loadHiring();
        if (e.type === "session.created") loadSessions();
        if (/^social\./.test(e.type)) loadMeets();
        const text = eventLine(e.type, who, d, e.conversation ?? null);
        if (text) setLines((l) => [{ at: e.at ?? Date.now(), orb: e.orb, text }, ...l].slice(0, 12));
      },
      text: (t) => {
        said.current[t.orb] = ((said.current[t.orb] ?? "") + t.delta).slice(-400);
        if (!flush)
          flush = window.setTimeout(() => {
            flush = 0;
            setSpeech((s) => {
              const out = { ...s };
              for (const [o, x] of Object.entries(said.current)) if (x.trim()) out[o] = lastWords(x);
              return out;
            });
          }, 160);
      },
    });
    return () => {
      stop();
      for (const t of fade.values()) window.clearTimeout(t);
      window.clearTimeout(flush);
    };
  }, [home, nameOf]);

  // ── who sits where, and the walking ──
  const sims = useRef(new Map<string, Sim>());
  const els = useRef(new Map<string, HTMLElement>());
  const bobs = useRef(new Map<string, HTMLElement>());
  const tags = useRef(new Map<string, HTMLElement>()); // a name tag or a speech bubble, kept inside the floor
  const widths = useRef(new Map<HTMLElement, number>());
  const [shown, setShown] = useState<Record<string, Shown>>({});
  const [gest, setGest] = useState<Record<string, { name: Gesture; n: number }>>({});
  const live = useRef({ moods, meeting, scale, desks, meets });
  live.current = { moods, meeting, scale, desks, meets };

  const targetOf = (s: Sim, plan: Plan): { approach: Spot; at: Spot } => {
    const desk = live.current.desks.get(s.c.name);
    if (plan.kind === "desk") return desk ? { approach: desk.approach, at: desk.seat } : { approach: { x: s.x, y: s.y }, at: { x: s.x, y: s.y } };
    if (plan.kind === "meeting") return SEATS[plan.seat]!;
    if (plan.kind === "meet") {
      // the home's meeting (PLAN 5.9): the two ends of the table, side by side at a spot, or at the teacher's desk
      if (plan.place === "desk") {
        if (plan.side === 0 && desk) return { approach: desk.approach, at: desk.seat };
        const theirs = live.current.desks.get(plan.with);
        const at = theirs ? { x: theirs.approach.x + 40, y: theirs.approach.y } : { x: s.x, y: s.y };
        return { approach: at, at };
      }
      return meetSpot(plan.place, plan.side);
    }
    if (plan.kind === "poi") {
      const p = POIS.find((q) => q.id === plan.poi)!;
      return { approach: p.approach, at: p.at };
    }
    const theirs = live.current.desks.get(plan.who);
    const side = s.r() < 0.5 ? -1 : 1;
    const at = theirs ? { x: theirs.approach.x + side * 40, y: theirs.approach.y } : { x: s.x, y: s.y };
    return { approach: at, at };
  };
  const assign = (s: Sim, plan: Plan, instant = false): void => {
    s.plan = plan;
    s.hold = plan.kind === "poi" ? { poi: plan.poi }
      : plan.kind === "meeting" ? { seat: plan.seat }
      : plan.kind === "meet" && plan.place !== "desk" ? { poi: plan.place === "pingpong" ? (plan.side ? "ping2" : "ping1") : plan.place }
      : {};
    const t = targetOf(s, plan);
    const free = sentBy(live.current.moods[s.id] ?? "idle", Boolean(live.current.meeting[s.id])) === null;
    // a meeting lasts as long as the home says; a break as long as the orb's Calm keeps it
    s.until = plan.kind === "meet" ? performance.now() + Math.max(0, plan.until - (Date.now() + skew.current)) : free ? performance.now() + dwell(s.traits, s.r) + (instant ? s.r() * 8000 : 0) : Infinity;
    if (instant || Math.hypot(s.x - t.at.x, s.y - t.at.y) < 1) {
      // already there (a desk's orb whose state changed): a new label, no walk
      s.x = t.at.x;
      s.y = t.at.y;
      s.path = [];
      s.i = 0;
      s.arrived = true;
    } else {
      const way = route({ x: s.x, y: s.y }, t.approach) ?? [{ x: s.x, y: s.y }, t.approach];
      s.path = t.at.x !== t.approach.x || t.at.y !== t.approach.y ? [...way, t.at] : way;
      s.i = 1;
      s.arrived = false;
    }
    // where it is headed, said plainly on the page (desk:build0, meeting:2, poi:coffee, visit:Pip)
    const desk = live.current.desks.get(s.c.name);
    const where = plan.kind === "desk" ? (desk ? `desk:${desk.zone}${desk.n}` : "desk:none") : plan.kind === "meeting" ? `meeting:${plan.seat}` : plan.kind === "poi" ? `poi:${plan.poi}` : plan.kind === "meet" ? `meet:${plan.place}:${plan.with}` : `visit:${plan.who}`;
    setShown((m) => ({ ...m, [s.c.name]: { label: plan.label, mark: plan.mark, kind: plan.kind, arrived: s.arrived, at: where, ...(plan.kind === "poi" && { poi: plan.poi }) } }));
  };

  // the orbs come and go with the office
  useEffect(() => {
    const ms = sims.current;
    for (const name of [...ms.keys()]) if (!office.some((c) => c.name === name)) ms.delete(name);
    for (const c of office) {
      if (ms.has(c.name)) {
        ms.get(c.name)!.c = c;
        continue;
      }
      const traits = traitsOf(c);
      const s: Sim = { c, id: idOf(c.name), x: 600, y: 326, path: [], i: 0, plan: null, hold: {}, until: 0, arrived: true, walking: false, phase: 0, speed: speed(traits), traits, r: dice(`${c.name}:${today(new Date())}:${c.seed}`), mood: null };
      ms.set(c.name, s);
      decide(s, true); // where it is when you come in: already there
    }
  }, [office]);

  /** What one orb does now, if what it is doing no longer fits. */
  function decide(s: Sim, instant = false): void {
    const { moods: m, meeting: mt } = live.current;
    const mood = m[s.id] ?? "idle";
    const inMeeting = Boolean(mt[s.id]);
    const sent = sentBy(mood, inMeeting);
    // a meeting the home decided, if this orb is free and in one that is under way (PLAN 5.9)
    const homeNow = Date.now() + skew.current;
    const meet = sent === null ? live.current.meets.find((x) => x.until > homeNow && (x.a === s.c.name || x.b === s.c.name)) : undefined;
    if (meet) {
      s.mood = mood;
      if (s.plan?.kind === "meet" && s.plan.until === meet.until && s.plan.with === (meet.a === s.c.name ? meet.b : meet.a)) return;
      // a meeting under way for a while is where they already are: coming back to the office (or opening it)
      // shows them there, never walking to it again (owner, 10-06: "every time i go back and forth if two
      // orbs are interacting or playing a game the animation restarts"); one that has just begun, they walk to
      return assign(s, meetPlan(meet, s.c.name), instant || homeNow - meet.at > MEET_WALK_MS);
    }
    const cur = s.plan;
    const resting = cur?.kind === "poi" && POIS.find((p) => p.id === cur.poi)?.rest;
    const fits = cur && (sent === "desk" ? cur.kind === "desk" && cur.why !== "tidy" : sent === "meeting" ? cur.kind === "meeting" : sent === "rest" ? Boolean(resting) || (cur.kind === "desk" && cur.mark === "💤") : cur.kind !== "meeting" && !(cur.kind === "desk" && cur.why !== "tidy") && !resting && cur.mark !== "💤");
    const due = sent === null && s.arrived && performance.now() > s.until;
    const relabel = sent === "desk" && s.mood !== mood; // thinking, working, waiting: the same desk, new words
    s.mood = mood;
    if (fits && !due && !relabel) return;
    const busy = { pois: new Set<PoiId>(), seats: new Set<number>(), waitingAt: null as PoiId | null };
    for (const o of sims.current.values()) {
      if (o === s) continue;
      if (o.hold.poi) busy.pois.add(o.hold.poi);
      if (o.hold.seat !== undefined) busy.seats.add(o.hold.seat);
    }
    const p1 = busy.pois.has("ping1");
    const p2 = busy.pois.has("ping2");
    busy.waitingAt = p1 && !p2 ? "ping1" : p2 && !p1 ? "ping2" : null;
    // a colleague to drop in on: only one that is at its desk, so the chat is where it sits
    const others = [...sims.current.values()].filter((o) => o !== s && o.plan?.kind === "desk" && o.arrived && live.current.desks.has(o.c.name)).map((o) => o.c.name);
    assign(s, next({ name: s.c.name, mood, meeting: inMeeting, traits: s.traits }, busy, others, s.r), instant);
  }

  // every half second: does anyone's state send it somewhere new, or is a break over?
  useEffect(() => {
    const t = setInterval(() => {
      for (const el of tags.current.values()) widths.current.set(el, el.offsetWidth); // read here, never in a frame
      for (const s of sims.current.values()) decide(s);
      // a rally keeps both players at the table
      const ends = [...sims.current.values()].filter((s) => s.hold.poi === "ping1" || s.hold.poi === "ping2");
      if (ends.length === 2 && ends.every((s) => s.arrived)) for (const s of ends) s.until = Math.max(s.until, performance.now() + 4_000);
    }, 500);
    return () => clearInterval(t);
  }, []);
  // a change of state is seen at once
  useEffect(() => {
    for (const s of sims.current.values()) decide(s);
  }, [moods, meeting]);

  // the walking itself: every frame, straight onto the page (no React in the loop)
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (t: number): void => {
      // by the clock, not the frame: a slow machine draws fewer frames, its orbs still walk at their pace
      const dt = Math.min(0.5, (t - last) / 1000);
      last = t;
      const k = live.current.scale;
      for (const s of sims.current.values()) {
        if (s.i < s.path.length) {
          const p = s.path[s.i]!;
          const dx = p.x - s.x;
          const dy = p.y - s.y;
          const d = Math.hypot(dx, dy);
          const step = s.speed * dt;
          if (step >= d) {
            s.x = p.x;
            s.y = p.y;
            s.i++;
          } else {
            s.x += (dx / d) * step;
            s.y += (dy / d) * step;
          }
          s.walking = true;
          s.phase += dt * s.speed * 0.13;
          if (s.i >= s.path.length) {
            s.walking = false;
            s.arrived = true;
            const name = s.c.name;
            setShown((m) => (m[name] ? { ...m, [name]: { ...m[name]!, arrived: true } } : m));
            if (s.plan?.kind === "poi" || s.plan?.kind === "visit" || s.plan?.kind === "meet") setGest((g) => ({ ...g, [name]: { name: s.plan?.mark === "💤" ? "doze" : "nod", n: (g[name]?.n ?? 0) + 1 } }));
          }
        }
        const el = els.current.get(s.c.name);
        if (el) {
          el.style.transform = `translate(${(s.x * k).toFixed(1)}px, ${(s.y * k).toFixed(1)}px)`;
          el.style.zIndex = String(Math.round(s.y));
        }
        // its tag and its words stay on the floor, near an edge too
        for (const key of [s.c.name, `${s.c.name}:said`]) {
          const tagEl = tags.current.get(key);
          if (!tagEl) continue;
          const w = widths.current.get(tagEl) ?? tagEl.offsetWidth;
          const left = Math.min(Math.max(s.x * k - w / 2, 4), W * k - 4 - w);
          tagEl.style.transform = `translate(${(left - s.x * k).toFixed(1)}px, -100%)`;
        }
        const bob = bobs.current.get(s.c.name);
        if (bob) bob.style.transform = s.walking ? `translateY(${(-Math.abs(Math.sin(s.phase)) * 5 * k).toFixed(1)}px) rotate(${(Math.sin(s.phase) * 3).toFixed(1)}deg)` : "";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── what each desk's screen shows, and the counts ──
  const at = (c: Character): Shown | undefined => shown[c.name];
  const screenOf = (d: Desk): { screen: Screen; hue: Character["hue"] | null } => {
    const who = office.find((c) => desks.get(c.name) === d);
    if (!who) return { screen: "off", hue: null };
    const m = moods[idOf(who.name)] ?? "idle";
    const sh = at(who);
    const there = sh?.kind === "desk" && sh.arrived;
    const screen: Screen = m === "waiting" ? "wait" : m === "working" ? "work" : m === "thinking" ? "think" : m === "gym" ? "gym" : there ? "idle" : "idle";
    return { screen, hue: who.hue };
  };
  const counts = { working: 0, meeting: 0, waiting: 0, free: 0, resting: 0 };
  for (const c of office) {
    const id = idOf(c.name);
    const m = moods[id] ?? "idle";
    if (m === "waiting") counts.waiting++;
    else if (meeting[id]) counts.meeting++;
    else if (m === "working" || m === "thinking" || m === "gym") counts.working++;
    else if (m === "dozing" || m === "asleep") counts.resting++;
    else counts.free++;
  }
  const rally = ["ping1", "ping2"].every((p) => office.some((c) => shown[c.name]?.poi === p && shown[c.name]?.arrived));
  const inMeeting = Object.values(meeting)[0];
  const meetingTitle = inMeeting ? "A board vote" : null;
  const sky = skyAt(now.getHours());
  const px = (v: number): number => v * scale;
  // where a department's Hiring tag stands (owner, 10-06): a free desk in the zone it works in, else that zone's door;
  // the Executive and Finance share Think's and Business's zones until they have their own (PLAN 5.17, zoneOf)
  const hiringTags = (() => {
    const out: { family: Family; zone: string; x: number; y: number; z: number; hue: string }[] = [];
    const taken = new Set([...desks.values()]);
    const used = new Set<Desk>();
    for (const f of Object.keys(FAMILIES) as Family[]) {
      if (!hiring.some((k) => SPECIALTIES[k as keyof typeof SPECIALTIES]?.family === f)) continue;
      const zone = ZONES.find((x) => x.id === zoneOf(f));
      if (!zone) continue;
      const d = DESKS.find((x) => x.zone === zone.id && !taken.has(x) && !used.has(x));
      if (d) {
        used.add(d);
        out.push({ family: f, zone: zone.id, x: d.seat.x, y: d.rect.y - 40, z: d.rect.y + d.rect.h + 1, hue: zone.hue });
      } else {
        const n = out.filter((t) => t.zone === zone.id).length;
        out.push({ family: f, zone: zone.id, x: zone.door.x + zone.door.w / 2 + n * 74, y: zone.rect.y + 16, z: zone.rect.y + 20, hue: zone.hue });
      }
    }
    return out;
  })();
  const todayList = [...day].sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));

  return (
    <section data-floor aria-label="The office" style={{ display: "grid", gap: "var(--s4)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      <style>{FLOOR_CSS}</style>
      {/* the day at a glance */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "end", justifyContent: "space-between", gap: "var(--s3)", minWidth: 0 }}>
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <h2 style={{ margin: 0, font: "800 22px/28px var(--font)", color: "var(--text-1)" }}>{`${greeting(now.getHours())}${person ? `, ${person}` : ""}`}</h2>
          <span style={small}>{`${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · ${time(now.getTime())} · ${office.length} ${office.length === 1 ? "orb" : "orbs"} in the office`}</span>
        </div>
        {(() => {
          const stats = [
            <Stat key="w" n={counts.working} label="Working" hue="cornflower" />,
            <Stat key="m" n={counts.meeting} label="In a meeting" hue="teal" />,
            <Stat key="f" n={counts.free} label="Free" hue="mint" />,
            ...(counts.resting > 0 ? [<Stat key="r" n={counts.resting} label="Resting" hue="iris" />] : []),
            <Stat key="n" n={counts.waiting} label="Need you" alert={counts.waiting > 0} onPress={counts.waiting ? () => go({ room: "notices" }) : undefined} />,
          ];
          // on a phone a balanced grid, never one alone on a row; on a desk, one line
          return phone ? (
            <div role="group" aria-label="Right now" style={{ flex: "1 1 100%", minWidth: 0 }}>
              <Balanced min={130} gap={6}>{stats}</Balanced>
            </div>
          ) : (
            <div role="group" aria-label="Right now" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{stats}</div>
          );
        })()}
      </div>

      {/* the floor */}
      <div ref={box} style={{ minWidth: 0 }}>
        {phone && (
          // the rooms, a press each: the floor goes to the one you choose
          <OneLine style={{ justifyContent: "flex-start", marginBottom: 8 }} gap={6}>
            {VIEWS.map((v) => (
              <button key={v.id} type="button" data-view-choice={v.id} data-orb={v.hue} aria-pressed={view === v.id} onClick={() => pick(v.id)}
                style={{ flex: "0 0 auto", font: "600 13px/18px var(--font)", border: 0, borderRadius: 999, padding: "6px 12px", cursor: "pointer", color: view === v.id ? "var(--text-1)" : "var(--text-3)", background: view === v.id ? "var(--accent-fill)" : "var(--fill)", boxShadow: view === v.id ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 .5px var(--hairline)" }}>
                {v.name}
              </button>
            ))}
          </OneLine>
        )}
        {/* the floor through a camera (owner, 10-07: "vibe it like a camera room"): the camera over the view, so it
            stays put while a phone pans; each room a phone goes to is a camera of its own */}
        <CameraFeed n={shownRect ? VIEWS.findIndex((v) => v.id === view) + 1 : 1} room={shownRect ? VIEWS.find((v) => v.id === view)!.name : "Whole office"}>
        <div ref={pan} data-floor-view data-viewport={shownRect ? "room" : undefined} style={{ overflowX: shownRect ? "hidden" : phone ? "auto" : "visible", overflowY: "hidden", ...(shownRect && { height: px(shownRect.h) }), borderRadius: 20, boxShadow: "inset 0 0 0 1px var(--hairline)", overscrollBehaviorX: "contain", scrollbarWidth: "thin" }}>
          <div data-floor-plan style={{ position: "relative", width: px(W), height: px(H), borderRadius: 20, overflow: "hidden", isolation: "isolate" }}>
            <Room now={now} sky={sky} />
            {DESKS.map((d) => {
              const { screen, hue } = screenOf(d);
              return <DeskPiece key={`${d.zone}${d.n}`} d={d} screen={screen} hue={hue} />;
            })}
            <MeetingTable />
            <PingPong rally={rally} />
            <SideTables />

            {/* the signs */}
            {ZONES.map((z) => (
              <span key={z.id} data-orb={z.hue} data-zone={z.id} style={{ ...sign, left: px(z.rect.x + 14), top: px(z.rect.y - 34) }}>
                <span aria-hidden>{ICON[z.id]}</span> {z.id === "play" ? "Games" : FAMILIES[z.id]}
              </span>
            ))}
            {ROOMS.map((r) => (
              <span key={r.id} data-orb={r.hue} style={{ ...sign, left: px(r.door.x + r.door.w / 2), top: px(262), translate: "-50% 0" }}>{r.name}</span>
            ))}
            {/* the Board room's screen: the vote going on, or where to put a proposal (the org chart's board) */}
            <button type="button" className="orbs-tag" data-meeting-screen onClick={() => go({ room: "org" })} data-orb="honey"
              style={{ position: "absolute", left: px(ROOMS[1]!.rect.x + 111), top: px(15), width: px(170), height: px(52), border: 0, borderRadius: 4, background: "transparent", cursor: "pointer", display: "grid", placeItems: "center", padding: "0 6px", zIndex: 1 }}>
              <span style={{ font: "700 11px/14px var(--font)", color: "var(--text-1)", textAlign: "center", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{meetingTitle ? `Now: ${meetingTitle}` : "The board · put a proposal"}</span>
            </button>
            {/* the family calendar shows today */}
            {(() => {
              const life = ZONES.find((z) => z.id === "life")!.rect;
              return (
                <button type="button" className="orbs-tag" onClick={() => go({ room: "calendar" })} aria-label={`Today: ${todayList.length} on the calendar`}
                  style={{ position: "absolute", left: px(life.x + life.w - 124), top: px(life.y - 50), width: px(96), height: px(42), border: 0, padding: 0, background: "transparent", cursor: "pointer", display: "grid", placeItems: "end center", zIndex: 1 }}>
                  <span style={{ font: "800 11px/14px var(--font)", color: "var(--ground)", padding: "0 6px", borderRadius: 6, background: "var(--text-2)" }}>{`${now.getDate()} · ${todayList.length} today`}</span>
                </button>
              );
            })()}
            {/* an empty desk where you are hiring: it opens on who applied to that department (owner, 10-06) */}
            {hiringTags.map((h) => {
              const z = h.family;
              return (
                <button key={z} type="button" className="orbs-tag" data-hiring={z} onClick={() => go({ room: "recruiter", family: z })} aria-label={`Hiring for ${FAMILIES[z]}: see who applied`} data-orb={h.hue}
                  style={{ position: "absolute", left: px(h.x), top: px(h.y), translate: "-50% 0", zIndex: h.z, ...tag, cursor: "pointer", border: 0, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1px var(--accent)", color: "var(--text-1)" }}>
                  + Hiring
                </button>
              );
            })}

            {/* the orbs */}
            {office.map((c) => {
              const id = idOf(c.name);
              const m = moods[id] ?? "idle";
              const sh = shown[c.name];
              const words = m === "working" && doing[id] ? doing[id]! : sh?.label ?? "";
              const talking = speech[id];
              const hat = c.hat !== "none";
              const top = -size * 1.17; // the canvas, from its feet
              const above = hat ? top : -size * 0.62;
              return (
                <div key={c.name} ref={(el) => void (el ? els.current.set(c.name, el) : els.current.delete(c.name))} style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, willChange: "transform" }}>
                  <div ref={(el) => void (el ? bobs.current.set(c.name, el) : bobs.current.delete(c.name))} style={{ position: "absolute", left: 0, top: 0 }}>
                    <button className="orbs-tag"
                      type="button"
                      data-floor-orb={c.name}
                      data-doing={sh?.kind ?? "none"}
                      data-at={sh?.at}
                      data-arrived={sh?.arrived ? "true" : "false"}
                      data-orb={c.hue}
                      onClick={() => go({ room: "office", orb: c.name })}
                      aria-label={`${c.name}, ${SPECIALTIES[c.specialty].title}: ${words || "in the office"}. Open the profile`}
                      title={`${c.name} · ${words}`}
                      style={{ position: "absolute", left: -size / 2, top, width: size, height: size * 1.25, padding: 0, border: 0, background: "transparent", cursor: "pointer" }}
                    >
                      <Orb character={c} size={size} state={talking ? "speaking" : WORN[m].state} gesture={gest[c.name] ?? null} poke={false} every={2} />
                    </button>
                    {/* the name, and what it is doing as a mark */}
                    <span ref={(el) => void (el ? tags.current.set(c.name, el) : tags.current.delete(c.name))} data-orb={c.hue} aria-hidden style={{ position: "absolute", left: 0, top: above - 4, transform: "translate(-50%, -100%)", display: "flex", alignItems: "center", gap: 4, pointerEvents: "none", whiteSpace: "nowrap" }}>
                      <span style={{ ...tag, color: "var(--ground)", background: "var(--accent)" }}>{c.name}</span>
                      {sh?.mark && <span data-mark style={{ ...tag, padding: "0 5px", background: m === "waiting" ? "var(--alert)" : "var(--card)", color: m === "waiting" ? "var(--ground)" : "var(--text-1)", boxShadow: "inset 0 0 0 1px var(--hairline)", animation: m === "waiting" ? "orbs-floor-glow 1s ease-in-out infinite" : undefined }}>{sh.mark}</span>}
                    </span>
                    {/* what it is saying, as it says it */}
                    {talking && (
                      <span ref={(el) => void (el ? tags.current.set(`${c.name}:said`, el) : tags.current.delete(`${c.name}:said`))} data-speech style={{ position: "absolute", left: 0, top: above - 28, transform: "translate(-50%, -100%)", width: "max-content", maxWidth: 190, padding: "6px 10px", borderRadius: 12, background: "var(--card)", boxShadow: "0 0 0 1px var(--hairline), 0 4px 12px var(--shadow)", font: "500 12px/16px var(--font)", color: "var(--text-1)", pointerEvents: "none", animation: "orbs-floor-pop 220ms var(--m-spring)" }}>
                        {talking}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </CameraFeed>
        {phone && <span style={{ ...small, display: "block", marginTop: 6, textAlign: "center" }}>{shownRect ? "Press a room above to go there · press an orb for its profile" : "Swipe to look around the office · press an orb for its profile"}</span>}
      </div>

      {/* the dashboard: who is doing what, today, what just happened */}
      <section aria-label="Who's doing what" style={panel}>
        <span style={head}>Who's doing what</span>
        <Balanced min={210} gap={4}>
          {office.map((c) => {
            const id = idOf(c.name);
            const m = moods[id] ?? "idle";
            const words = m === "working" && doing[id] ? doing[id]! : shown[c.name]?.label ?? "In the office";
            return (
              <button key={c.name} type="button" data-who={c.name} onClick={() => go({ room: "office", orb: c.name })} data-orb={c.hue}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px", border: 0, borderRadius: 10, background: "transparent", cursor: "pointer", textAlign: "left", minWidth: 0, color: "inherit" }}>
                <Orb character={c} size={30} poke={false} still />
                <span style={{ display: "grid", minWidth: 0, flex: "1 1 auto" }}>
                  <span style={{ font: "700 14px/19px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  <span style={{ ...small, color: m === "waiting" ? "var(--alert)" : "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{words}</span>
                </span>
                <span aria-hidden style={{ flex: "0 0 auto", width: 8, height: 8, borderRadius: 4, background: m === "waiting" ? "var(--alert)" : m === "idle" ? "var(--text-3)" : "var(--accent)" }} />
              </button>
            );
          })}
        </Balanced>
      </section>
      <Balanced min={300} gap={12}>
        <section aria-label="Today" style={{ ...panel, height: "100%" }}>
          <span style={head}>Today</span>
          {!todayList.length && <span style={small}>Nothing on the calendar today.</span>}
          {todayList.slice(0, 6).map((e) => (
            <button key={`${e.kind}${e.id}`} type="button" onClick={() => go({ room: "calendar" })} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "2px 0", border: 0, background: "transparent", cursor: "pointer", textAlign: "left", minWidth: 0, color: "inherit" }}>
              <span className="num" style={{ flex: "0 0 52px", font: "700 13px/18px var(--font)", color: "var(--text-2)" }}>{e.time ?? "All day"}</span>
              <span style={{ font: "500 14px/19px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{e.title}</span>
            </button>
          ))}
          {todayList.length > 6 && <span style={small}>{`And ${todayList.length - 6} more on the calendar`}</span>}
        </section>
        <section aria-label="Activity" style={{ ...panel, height: "100%" }}>
          <span style={head}>Activity</span>
          {!lines.length && <span style={small}>What the office does shows here as it happens.</span>}
          {lines.slice(0, 6).map((l, i) => (
            <div key={`${l.at}${i}`} style={{ display: "flex", gap: 10, alignItems: "baseline", minWidth: 0 }}>
              <span className="num" style={{ flex: "0 0 44px", font: "600 12px/17px var(--font)", color: "var(--text-3)" }}>{time(l.at)}</span>
              <span style={{ font: "500 13px/18px var(--font)", color: "var(--text-2)", textWrap: "balance", minWidth: 0 }}>{l.text}</span>
            </div>
          ))}
        </section>
      </Balanced>
    </section>
  );
}

const tag: CSSProperties = { display: "inline-block", padding: "1px 8px", borderRadius: 999, font: "800 11px/16px var(--font)", whiteSpace: "nowrap" };
const sign: CSSProperties = { position: "absolute", zIndex: 1, ...tag, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-1)", background: "var(--card)", boxShadow: "inset 0 0 0 1px var(--accent)", pointerEvents: "none" };

function Stat({ n, label, hue, alert = false, onPress }: { n: number; label: string; hue?: Character["hue"]; alert?: boolean; onPress?: () => void }) {
  const style: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 999, border: 0, font: "600 13px/18px var(--font)", color: "var(--text-1)", background: alert ? "var(--fill-2)" : "var(--fill)", boxShadow: alert ? "inset 0 0 0 1.5px var(--alert)" : "inset 0 0 0 1px var(--hairline)", cursor: onPress ? "pointer" : "default", whiteSpace: "nowrap" };
  const inner = (
    <>
      <span className="num" data-orb={hue} style={{ font: "800 15px/18px var(--font)", color: alert ? "var(--alert)" : hue ? "var(--accent)" : "var(--text-1)" }}>{n}</span>
      {label}
    </>
  );
  return onPress ? <button type="button" onClick={onPress} style={style}>{inner}</button> : <span data-stat={label} style={style}>{inner}</span>;
}

/** The last words of a reply as it streams, from a word's start, for a speech bubble. */
function lastWords(text: string): string {
  const t = text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
  if (t.length <= 72) return t;
  const cut = t.slice(-72);
  return `…${cut.slice(cut.indexOf(" ") + 1)}`;
}

const where = (conversation: string | null): string =>
  !conversation ? "" : conversation.startsWith("chat:") ? " in your chat" : /:brainstorm$/.test(conversation) ? " in a Brainstorm" : /:floor$/.test(conversation) ? " on the Floor" : "";

/** An event, as a line of the office's activity; null for what is not worth a line. */
function eventLine(type: string, who: string | null, d: Record<string, unknown>, conversation: string | null): string | null {
  if (!who) return null;
  switch (type) {
    case "run.started":
      return `${who} started work${where(conversation)}`;
    case "run.finished":
      return d.outcome === "ok" ? `${who} finished${where(conversation)}` : d.outcome === "failed" ? `${who}'s work stopped short${where(conversation)}` : null;
    case "card.opened":
      return `${who} needs your OK`;
    case "reminder.added":
      return `${who} put a ${d.kind === "bill" ? "bill" : "reminder"} on your calendar for ${String(d.due ?? "").replace("T", " at ")}`;
    case "xp.earned":
      return `${who} earned ${String(d.amount)} XP`;
    case "orb.added":
      return `${who} joined the office`;
    case "orb.promoted":
      return `${who} was promoted`;
    case "habit.promoted":
      return `${who} learned a new habit`;
    default:
      return null;
  }
}

function noticeLine(n: Notice, who: string): string {
  if (n.kind === "approval") return `${who} needs your OK: ${n.title}`;
  if (n.kind === "done") return `${who} finished: ${n.title}`;
  if (n.kind === "bill" || n.kind === "reminder") return `${n.title}${n.detail ? ` (${n.detail})` : ""}`;
  return n.title;
}
