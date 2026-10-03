// Chatter written from the board (PLAN 5.2): what a team did on its plan, said by code from the
// board's and the claims' own events, never by a model. The cheapest tier is no tier: a job nobody
// watches spends nothing on it, and the chat you open is the board, line for line, because it is
// read off the very events the board replays from (nothing is stored but the events).
import type { EventLog, HomeEvent } from "./events.ts";

export type Chatter = { seq: number; at: number; orb: string | null; text: string };

const TYPES = [
  "claim.made", "claim.handed_off", "claim.recovered", "amendment.proposed", "amendment.agreed",
  "board.started", "board.ticked", "board.failed", "board.review_asked", "board.review_changes", "board.amended", "session.asked",
] as const;

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const rows = (v: unknown): string => {
  const r = list(v);
  return r.length === 1 ? `row ${r[0]}` : `rows ${r.join(", ")}`;
};

/** A session's chatter, oldest first: its claims and asks (they carry the session) and what
 * happened on the boards of the plans it worked (`plans`). */
export function chatterOf(events: EventLog, session: number, o: { plans: number[]; nameOf: (orb: string) => string }): Chatter[] {
  const plans = new Set(o.plans);
  const name = (orb: unknown): string => (orb === "you" ? "You" : o.nameOf(String(orb ?? "")));
  const mine = (e: HomeEvent): boolean => (e.data.session !== undefined ? Number(e.data.session) === session : plans.has(Number(e.data.plan)));
  const all = TYPES.flatMap((t) => events.ofType(t)).filter(mine).sort((a, b) => a.seq - b.seq);
  const out: Chatter[] = [];
  for (const e of all) {
    const d = e.data;
    const text = ((): string | null => {
      switch (e.type) {
        case "claim.made":
          return `${name(d.orb)} took ${rows(d.rows)}${list(d.paths).length ? ` (${list(d.paths).join(", ")})` : ""}.`;
        case "claim.handed_off": {
          const changed = list(d.changed);
          return `${name(d.orb)} handed off ${rows(d.rows)}: ${changed.length ? `changed ${changed.join(", ")}` : "changed nothing"}; next ${d.next ? `row ${String(d.next)}` : "nothing left"}.`;
        }
        case "claim.recovered":
          return d.by === "you" ? `You let ${name(d.from)}'s stale claim go.` : `${name(d.by)} took over ${name(d.from)}'s stale claim.`;
        case "amendment.proposed":
          return `${name(d.proposer)} proposed row ${String(d.row)}: it needs a second.`;
        case "amendment.agreed":
          return `✓ Agreed: row ${String(d.row)} (${name(d.proposer)}, seconded by ${name(d.by)}).`;
        case "board.amended":
          return null; // said by amendment.agreed
        case "board.started":
          return `Row ${String(d.row)} started: tested by \`${String(d.command ?? "")}\`.`;
        case "board.ticked":
          return `Row ${String(d.row)} is done [x]${d.reviewer ? `, reviewed by ${name(d.reviewer)}` : ""}.`;
        case "board.failed":
          return `Row ${String(d.row)}'s test failed: it stays [~].`;
        case "board.review_asked":
          return `${name(d.by)}'s row ${String(d.row)} passed its test and waits for a review.`;
        case "board.review_changes":
          return `${name(d.reviewer)} asked for changes on row ${String(d.row)}.`;
        case "session.asked":
          return `${name(d.from)} asked ${name(d.to)} for a hand.`;
      }
      return null;
    })();
    if (text) out.push({ seq: e.seq, at: e.at, orb: e.orb, text });
  }
  return out;
}
