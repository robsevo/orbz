// An orb's real mood on the page (PLAN 2.3): the home's stream fed to his MoodOf (mood.ts), what he
// is now, and each moment once (a hop, a pout, a sparkle) for the face to play.
import { useEffect, useRef, useState } from "react";
import type { Office } from "../home/link.ts";
import { type Mood, MoodOf, type Moment } from "./mood.ts";
import type { Gesture, OrbState } from "./life.ts";

/** How a mood is worn, with what the face already has: a state, and a gesture now and then. */
export const WORN: Record<Mood, { state: OrbState; every: Gesture | null; words: string }> = {
  idle: { state: "idle", every: null, words: "" },
  thinking: { state: "thinking", every: null, words: "Thinking" },
  working: { state: "thinking", every: "look", words: "Working" },
  waiting: { state: "listening", every: "nod", words: "Waiting for you" },
  gym: { state: "idle", every: "jelly", words: "At the gym" },
  dozing: { state: "idle", every: "doze", words: "Dozing" },
  asleep: { state: "idle", every: "doze", words: "Asleep" },
};
export const MOMENT_GESTURE: Record<Moment, Gesture> = { hop: "hop", pout: "pout", sparkle: "pop" };

/** What was already so when the page opened (the stream brings only what happens after): a card
 * of his that waits for you is a notice, so he starts out waiting. */
function seed(home: Office, machines: Map<string, MoodOf>, then: () => void): void {
  home.notices().then((ns) => {
    for (const n of ns) if (n.kind === "approval" && n.card !== null) machines.get(n.orb)?.hear({ type: "card.opened", orb: n.orb, at: n.at, data: { card: n.card } });
    then();
  }, () => {});
}

/** Every orb's mood at once, for the side menu's dots. */
export function useMoods(home: Office | null, orbs: string[]): Record<string, Mood> {
  const [moods, setMoods] = useState<Record<string, Mood>>({});
  const key = orbs.join("\n");
  useEffect(() => {
    if (!home || !orbs.length) return;
    const now = Date.now();
    const ms = new Map(orbs.map((o) => [o, new MoodOf(o, now)]));
    const sync = (): void => setMoods(Object.fromEntries([...ms].map(([o, m]) => [o, m.at(Date.now())])));
    seed(home, ms, sync);
    const stop = home.watch({
      event: (e) => {
        for (const m of ms.values()) m.hear({ ...e, at: e.at ?? Date.now() });
        sync();
      },
    });
    const tick = setInterval(sync, 30_000);
    return () => {
      stop();
      clearInterval(tick);
    };
  }, [home, key]);
  return moods;
}

export function useMood(home: Office | null, orb: string | null): { mood: Mood; moment: { name: Gesture; n: number } | null } {
  const [mood, setMood] = useState<Mood>("idle");
  const [moment, setMoment] = useState<{ name: Gesture; n: number } | null>(null);
  const machine = useRef<MoodOf | null>(null);
  useEffect(() => {
    if (!home || !orb) return;
    const m = new MoodOf(orb, Date.now());
    machine.current = m;
    setMood("idle");
    seed(home, new Map([[orb, m]]), () => setMood(m.at(Date.now())));
    const stop = home.watch({
      event: (e) => {
        const now = Date.now();
        const said = m.hear({ ...e, at: e.at ?? now });
        if (said) setMoment((x) => ({ name: MOMENT_GESTURE[said], n: (x?.n ?? 0) + 1 }));
        setMood(m.at(now));
      },
    });
    const tick = setInterval(() => setMood(m.at(Date.now())), 30_000); // a doze comes on its own
    return () => {
      stop();
      clearInterval(tick);
    };
  }, [home, orb]);
  // a mood worn as a gesture now and then (a doze, a nod while he waits)
  useEffect(() => {
    const g = WORN[mood].every;
    if (!g) return;
    const t = setInterval(() => setMoment((x) => ({ name: g, n: (x?.n ?? 0) + 1 })), 9_000);
    return () => clearInterval(t);
  }, [mood]);
  return { mood, moment };
}
