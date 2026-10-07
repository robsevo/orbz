// What an orb has finished lately, in its own words (owner, 10-07: the career page is "where we see the orbs
// growth", and "beatrix exchanged ideas with another orb, what are those ideas?"). Read off the log by code,
// no brain asked: each finished run's summary, its first sentence, without the marks of formatting. A run
// that ended without doing anything (no brain answered, a pass, a loop stopped) is not work.
import type { EventLog } from "./events.ts";

export type Work = { at: number; orb: string; summary: string; conversation: string | null };

const NOT_WORK = /^(no brain|passed|looped|repeated|nothing to answer|step limit|plan (usage|not)|a card is still waiting|waiting for an answer|no brain answered)/i;

/** A summary as one plain sentence: no marks, no line breaks, at most `max` characters. */
export function plain(text: string, max = 160): string {
  const t = text.replace(/[*_`#>]+/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
  const end = /[.!?](\s|$)/.exec(t.slice(20));
  const first = end ? t.slice(0, 20 + end.index + 1) : t;
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/** Its latest finished work, newest first, `since` the given time; `orb` null: the whole office's. */
export function recentWork(events: EventLog, orb: string | null, o: { since?: number; limit?: number } = {}): Work[] {
  const out: Work[] = [];
  const done = events.ofType("run.finished");
  for (let i = done.length - 1; i >= 0 && out.length < (o.limit ?? 6); i--) {
    const e = done[i]!;
    if ((orb !== null && e.orb !== orb) || !e.orb || e.at < (o.since ?? 0) || e.data.outcome !== "ok") continue;
    const s = typeof e.data.summary === "string" ? e.data.summary.trim() : "";
    if (!s || NOT_WORK.test(s)) continue;
    out.push({ at: e.at, orb: e.orb, summary: plain(s), conversation: e.conversation ?? null });
  }
  return out;
}
