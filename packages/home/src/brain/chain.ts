// The brain order (PLAN 1.11; owner, 2026-10-01): "1- chatgpt sign in, once limit is done or not
// avail then 2- google gemini api key, 1 of them is fine, pro users get more obviously. once limit
// is done or not avail then 3- local coder, if none of those are avail after 3 times then error
// message." Habits come before all of it (the ladder, 1.4): they are free.
//
// A chain of brains, tried in order. A brain that cannot answer (a limit, an absence, nothing
// listening) rests for a while and the next one answers, saying so. When none can, the chain
// looks again, three times in all, and then gives one plain error that names each brain, why it
// is not answering, and what would fix it.
import type { Endpoint } from "./openai.ts";

export type LinkId = "chatgpt" | "gemini" | "local";

export type Link = {
  id: LinkId;
  /** What a person calls it: "ChatGPT", "Gemini", "the local coder". */
  label: string;
  /** Its endpoint now, or null when it is not set up (or, for ChatGPT, paused at its own limit). */
  endpoint: () => Endpoint | null;
  /** What to do when it is not set up, for the error: "sign in with ChatGPT in Settings". */
  setup: string;
};

export type Rest = { why: string; until: number };

export type LinkState = { id: LinkId; label: string; state: "ready" | "resting" | "absent"; why: string | null; until: number | null };

export class NoBrainAnswered extends Error {
  readonly states: LinkState[];
  constructor(states: LinkState[], tries: number) {
    super(explain(states, tries));
    this.name = "NoBrainAnswered";
    this.states = states;
  }
}

const clockTime = (ms: number): string => new Date(ms).toTimeString().slice(0, 5);

/** The one error, in words: each brain, why it is not answering, and what to do. */
export function explain(states: LinkState[], tries: number): string {
  const lines = states.map((s) => {
    if (s.state === "absent") return `${s.label}: not set up`;
    if (s.state === "resting") return `${s.label}: ${s.why}${s.until ? `, back about ${clockTime(s.until)}` : ""}`;
    return `${s.label}: ready`;
  });
  return `No brain could answer after ${tries} tries. ${lines.join(". ")}.`;
}

export class BrainChain {
  readonly links: readonly Link[];
  readonly #rest = new Map<LinkId, Rest>();
  readonly #clock: () => number;

  constructor(links: Link[], clock: () => number = Date.now) {
    this.links = links;
    this.#clock = clock;
  }

  /** The first brain that can answer now, with its endpoint (tagged with its place in the chain). */
  current(): { link: Link; ep: Endpoint } | null {
    const now = this.#clock();
    for (const link of this.links) {
      const r = this.#rest.get(link.id);
      if (r && r.until > now) continue;
      if (r) this.#rest.delete(link.id); // rested enough: it is first again
      const ep = link.endpoint();
      if (ep) return { link, ep: { ...ep, chain: link.id } };
    }
    return null;
  }

  /** A brain could not answer: it rests until `until`, and the next one is asked. */
  rest(id: LinkId, why: string, until: number): void {
    this.#rest.set(id, { why, until });
  }

  /** Each brain and where it stands, for the error and for Settings. */
  states(): LinkState[] {
    const now = this.#clock();
    return this.links.map((link) => {
      const r = this.#rest.get(link.id);
      if (r && r.until > now) return { id: link.id, label: link.label, state: "resting", why: r.why, until: r.until };
      return link.endpoint() ? { id: link.id, label: link.label, state: "ready", why: null, until: null } : { id: link.id, label: link.label, state: "absent", why: null, until: null };
    });
  }

  /** The next brain to answer after `id` steps aside, for the notice ("… answering with Gemini"). */
  after(id: LinkId): Link | null {
    const i = this.links.findIndex((l) => l.id === id);
    const now = this.#clock();
    for (const link of this.links.slice(i + 1)) {
      const r = this.#rest.get(link.id);
      if ((!r || r.until <= now) && link.endpoint()) return link;
    }
    return null;
  }
}

/** How long a brain rests after it could not answer: until its limit resets when the reply says
 * (a Retry-After, a daily quota), a minute when nothing was listening, else a minute too. */
export function restFor(o: { status: number | null; message: string; retryAfterS?: number | null }, now: number): { why: string; until: number } {
  if (o.status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit|usage limit/i.test(o.message)) {
    const daily = /PerDay|per day|daily/i.test(o.message);
    const s = o.retryAfterS ?? (daily ? 3600 : 60);
    return { why: daily ? "its daily limit is reached" : "its limit is reached", until: now + s * 1000 };
  }
  if (o.status === null) return { why: "nothing answered", until: now + 60_000 };
  if (o.status === 401 || o.status === 403) return { why: "its key was refused", until: now + 3_600_000 };
  return { why: `it failed (${o.status})`, until: now + 60_000 };
}
