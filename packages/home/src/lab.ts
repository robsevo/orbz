// The lab (PLAN 2.13; owner, 10-01: "a brainstorming lab, like in an office where we keep our
// brainstorms and plans"). Every session's brainstorm (what was agreed in it, who was in it, its
// last words) and every plan an orb showed you (1.7's archive: frozen as shown) with its rows and
// how far along they are (1.8's board, for an approved one). Searchable by a word in any of it. A
// brainstorm reopened is a new session with its history: the orbs in it are told what was agreed.
import type { Conversations } from "./agent/conversation.ts";
import type { Board } from "./plans/board.ts";
import { parse, type Box } from "./plans/format.ts";
import type { Plans, PlanStatus } from "./plans/plans.ts";
import type { Session, Team } from "./team.ts";

export type LabSession = { id: number; title: string; createdAt: number; members: string[]; agreed: string[]; lastWords: string | null; plans: number[] };
export type LabRow = { id: string; feature: string; description: string; test: boolean; box: Box };
export type LabPlan = {
  id: number; title: string; orb: string; conversation: string; session: number | null; status: PlanStatus; createdAt: number;
  rows: LabRow[]; done: number; total: number;
};
type Parts = { team: Team; conversations: Conversations; plans: Plans; board: Board };

const sessionOf = (conversation: string): number | null => {
  const m = /^team:(\d+):/.exec(conversation);
  return m ? Number(m[1]) : null;
};

/** The lab, newest first; with `q`, only what has that word (any case) in its title, what was agreed, or its rows. */
export function labOf(o: Parts, q = ""): { sessions: LabSession[]; plans: LabPlan[] } {
  const want = q.trim().toLowerCase();
  const has = (...texts: string[]): boolean => !want || texts.some((t) => t.toLowerCase().includes(want));
  const plans: LabPlan[] = o.plans.list().map((p) => {
    const live = new Map(o.board.rows(p.id).map((r) => [r.row, r.box]));
    const rows = parse(p.body).rows.map((r) => {
      const [, feature = "", description = ""] = r.text.split("|").map((c) => c.trim()).filter(Boolean); // | id | Feature | Description | Done |
      const id = r.test ? `${r.id}_t` : r.id; // the board's name for a test row
      return { id, feature, description, test: r.test, box: live.get(id) ?? r.box };
    });
    const features = rows.filter((r) => !r.test);
    return {
      id: p.id, title: p.title, orb: p.orb, conversation: p.conversation, session: sessionOf(p.conversation), status: p.status, createdAt: p.createdAt,
      rows, done: features.filter((r) => r.box === "[x]").length, total: features.length,
    };
  });
  const sessions: LabSession[] = o.team.list().map((s) => {
    const said = o.conversations.list(`team:${s.id}:brainstorm`);
    return {
      id: s.id, title: s.title, createdAt: s.createdAt, members: [...new Set([...s.brainstorm, ...s.floor])],
      agreed: said.filter((m) => m.role === "notice" && typeof m.meta.agreed === "string").map((m) => String(m.meta.agreed)),
      lastWords: said.findLast((m) => m.role === "assistant" && m.content.trim())?.content ?? null,
      plans: plans.filter((p) => p.session === s.id).map((p) => p.id),
    };
  });
  return {
    sessions: sessions.filter((s) => has(s.title, ...s.agreed, s.lastWords ?? "")).sort((a, b) => b.createdAt - a.createdAt || b.id - a.id),
    plans: plans.filter((p) => has(p.title, ...p.rows.flatMap((r) => [r.feature, r.description]))).sort((a, b) => b.createdAt - a.createdAt || b.id - a.id),
  };
}

/** A brainstorm, reopened: a new session with the same orbs, which begins with what was agreed
 * and where it was left (as a summary: the orbs hear it), and a line for the person saying so. */
export function reopen(o: Parts, id: number): Session {
  const s = o.team.get(id);
  if (!s) throw new Error(`no session ${id}`);
  const was = labOf(o).sessions.find((x) => x.id === id)!;
  const fresh = o.team.create(`${s.title} (reopened)`, { brainstorm: s.brainstorm, floor: s.floor });
  const conversation = `team:${fresh.id}:brainstorm`;
  const lines = [
    `This brainstorm is "${s.title}", reopened.`,
    was.agreed.length ? `What was agreed then:\n${was.agreed.map((a) => `- ${a}`).join("\n")}` : "Nothing was agreed then.",
    was.lastWords ? `Where it was left: ${was.lastWords}` : "",
  ].filter(Boolean);
  const orb = s.brainstorm[0] ?? s.floor[0] ?? "";
  o.conversations.add({ conversation, orb, role: "summary", content: lines.join("\n\n") });
  o.conversations.add({ conversation, orb, role: "notice", content: `Reopened from "${s.title}": everyone here knows what was agreed.`, meta: { reopened: id } });
  return fresh;
}
