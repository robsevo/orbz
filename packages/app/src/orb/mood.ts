// An orb's mood from what really happens (PLAN 2.3: moods "driven by real events (approval → hop,
// failure → pout, done → sparkle)"), read off the home's event stream, by code. Pure: the face
// (Orb.tsx, life.ts) wears what this says, and a test feeds it a recorded day.
//
//   waiting   a card of his is open: he waits for you (it outranks everything else)
//   working   a tool of his is running
//   thinking  a run of his is going, between tools
//   gym       the night: the gym is writing habits and sitting exams
//   asleep    late at night, nothing for a while
//   dozing    nothing for DOZE_AFTER_MS
//   idle      otherwise
//
// and the moments, once each as they happen: a hop (you said yes), a pout (a no, or a run that
// failed), a sparkle (a run finished well).

export type Mood = "idle" | "thinking" | "working" | "waiting" | "gym" | "dozing" | "asleep";
export type Moment = "hop" | "pout" | "sparkle";
export type Heard = { type: string; orb: string | null; at?: number; data?: Record<string, unknown> };

export const DOZE_AFTER_MS = 10 * 60_000;
export const SLEEP_AFTER_MS = 30 * 60_000;
/** Late at night: from 23:00 to 06:00, local. */
const late = (at: number): boolean => {
  const h = new Date(at).getHours();
  return h >= 23 || h < 6;
};

export class MoodOf {
  readonly #orb: string;
  readonly #runs = new Set<number>();
  readonly #cards = new Set<number>();
  #tool = false;
  #gym = false;
  #last: number;

  constructor(orb: string, now: number) {
    this.#orb = orb;
    this.#last = now;
  }

  /** One event off the stream; the moment it makes him show, if any. */
  hear(e: Heard): Moment | null {
    if (e.type === "gym.night") this.#gym = true;
    if (e.type === "gym.night_done" || e.type === "gym.night_failed") this.#gym = false;
    if (e.orb !== this.#orb) return null;
    this.#last = Math.max(this.#last, e.at ?? this.#last);
    const d = e.data ?? {};
    switch (e.type) {
      case "run.started":
        this.#runs.add(Number(d.run));
        this.#tool = false;
        return null;
      case "trace.step":
        if (d.kind === "card") this.#tool = false;
        else if (d.kind === "model") this.#tool = Array.isArray(d.tool_calls) && d.tool_calls.length > 0; // a call made: its tool runs next
        else if (d.kind === "tool") this.#tool = false;
        return null;
      case "run.finished":
        this.#runs.delete(Number(d.run));
        this.#tool = false;
        return d.outcome === "ok" ? "sparkle" : d.outcome === "failed" ? "pout" : null;
      case "card.opened":
        this.#cards.add(Number(d.card));
        return null;
      case "card.resolved":
        this.#cards.delete(Number(d.card));
        return d.status === "denied" ? "pout" : d.status === "expired" ? null : "hop";
      default:
        return null;
    }
  }

  /** How he is now. */
  at(now: number): Mood {
    if (this.#cards.size) return "waiting";
    if (this.#runs.size) return this.#tool ? "working" : "thinking";
    if (this.#gym) return "gym";
    const quiet = now - this.#last;
    if (quiet >= SLEEP_AFTER_MS && late(now)) return "asleep";
    if (quiet >= DOZE_AFTER_MS) return "dozing";
    return "idle";
  }
}
