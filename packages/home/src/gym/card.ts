// The morning card (PLAN 3.5): yesterday, as the event log has it, orb by orb. Who answered his
// work (his habits, his own brain, the big brain: the split the habits are meant to move), what it
// cost, what he learned (lessons you kept, habits promoted), and what you can undo in one tap. A
// quiet night says nothing: no card at all. Read off the log, so the card cannot disagree with it.
import type { EventLog } from "../events.ts";
import { NIGHT_HOUR } from "./night.ts";

export type Undo = { kind: "lesson"; orb: string; line: string; index: number } | { kind: "habit"; orb: string; habit: string; version: number };
export type OrbNight = { orb: string; habits: number; own: number; big: number; costUsd: number; tokens: number; learned: string[]; promoted: string[]; undo: Undo[] };
export type MorningCard = { day: string; orbs: OrbNight[] };

const pad = (n: number): string => String(n).padStart(2, "0");

/** The day before `now`, in the home's local time: its start and end, and its name. */
export function yesterday(now: number): { from: number; to: number; day: string } {
  const d = new Date(now);
  const to = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime();
  const y = new Date(from);
  return { from, to, day: `${y.getFullYear()}-${pad(y.getMonth() + 1)}-${pad(y.getDate())}` };
}

export function morningCard(events: EventLog, o: { now: number; learned: (orb: string) => string[] }): MorningCard | null {
  const { from, to, day } = yesterday(o.now);
  // the night after it: what the gym promoted from 03:00 this morning (the night is the day's)
  const t = new Date(to);
  const nightFrom = new Date(t.getFullYear(), t.getMonth(), t.getDate(), NIGHT_HOUR).getTime();
  const nightTo = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1, NIGHT_HOUR).getTime();
  const undone = new Set(events.ofType("habit.undone").map((e) => `${e.orb}|${String(e.data.kind)}|${Number(e.data.version)}`));
  const nights = new Map<string, OrbNight>();
  const night = (orb: string): OrbNight => {
    let n = nights.get(orb);
    if (!n) nights.set(orb, (n = { orb, habits: 0, own: 0, big: 0, costUsd: 0, tokens: 0, learned: [], promoted: [], undo: [] }));
    return n;
  };
  const byHabit = new Set<number>(); // runs a habit or his own brain answered: not the big brain's too
  for (const e of events.since(0, 1_000_000)) {
    if (e.type === "habit.promoted" && e.orb && e.at >= nightFrom && e.at < nightTo) {
      const n = night(e.orb);
      n.promoted.push(String(e.data.kind));
      const version = Number(e.data.version ?? 0);
      if (!undone.has(`${e.orb}|${String(e.data.kind)}|${version}`)) n.undo.push({ kind: "habit", orb: e.orb, habit: String(e.data.kind), version });
      continue;
    }
    if (e.at < from || e.at >= to || !e.orb) continue;
    if (e.type === "ladder.answered") {
      const n = night(e.orb);
      if ((e.data.tier === "habit" || e.data.tier === "own") && typeof e.data.run === "number") byHabit.add(e.data.run);
      if (e.data.tier === "habit") n.habits++;
      else if (e.data.tier === "own") n.own++;
      else n.big++;
    } else if (e.type === "run.finished" && e.data.outcome === "ok" && !byHabit.has(Number(e.data.run))) night(e.orb).big++; // a run of the agent: the big brain's
    else if (e.type === "brain.spend") {
      const n = night(e.orb);
      n.costUsd += Number(e.data.cost_usd ?? 0);
      n.tokens += Number(e.data.prompt_tokens ?? 0) + Number(e.data.completion_tokens ?? 0);
    } else if (e.type === "orb.learned") night(e.orb).learned.push(String(e.data.line));
  }
  for (const n of nights.values()) {
    // a lesson kept yesterday, still kept today: one tap takes it back
    const kept = o.learned(n.orb);
    for (const line of n.learned) {
      const index = kept.indexOf(line);
      if (index >= 0) n.undo.push({ kind: "lesson", orb: n.orb, line, index });
    }
    n.costUsd = Math.round(n.costUsd * 10_000) / 10_000;
  }
  const orbs = [...nights.values()].filter((n) => n.habits + n.own + n.big + n.learned.length + n.promoted.length > 0).sort((a, b) => a.orb.localeCompare(b.orb));
  return orbs.length ? { day, orbs } : null;
}
