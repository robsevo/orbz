// The team's tools (PLAN 5.1): what an orb does with the others in a session, on its plan's board.
//
//   claim_rows      rows and the files they touch: his alone until he hands them off (claims.ts)
//   hand_off        his rows done or passed on: what changed, which tests ran, the next free row
//   ask_orb         a request to another orb of the session (Open Dot's message_dot, in our words):
//                   at most two deep, so a request of a request of a request is refused
//   propose_change  a new row for the approved plan, with its test: agreed only with a second
//   agree_change    another orb's proposed change, seconded: ✓ Agreed, and the board has the row
//
// Only in a session's tab (team:<id>:<tab>); elsewhere each says so.
import type { ToolContext, ToolDef, ToolResult } from "./agent/tools.ts";
import { AmendmentError, type Amendments } from "./amendments.ts";
import { ClaimError, type Claims } from "./claims.ts";
import type { Board } from "./plans/board.ts";
import { parseTabConversation, type Team } from "./team.ts";

/** How deep a request of a request may go: you → an orb → another, never a third hand. */
export const DEPTH = 2;

const s = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(s).filter(Boolean) : s(v).split(",").map((x) => x.trim()).filter(Boolean));
const obj = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({ type: "object", properties, required, additionalProperties: false });

export function teamTools(o: { claims: Claims; amendments: Amendments; board: Board; team: () => Team; nameOf: (orb: string) => string; idOf: (name: string) => string | null }): ToolDef[] {
  const session = (ctx: ToolContext): number | null => parseTabConversation(ctx.conversation)?.id ?? null;
  const notHere: ToolResult = { content: "That is for a session's work with other orbs: this is not a session.", isError: true };
  const failed = (e: unknown): ToolResult => {
    if (e instanceof ClaimError || e instanceof AmendmentError) return { content: e.message, isError: true };
    throw e;
  };
  return [
    {
      name: "claim_rows",
      label: "Claiming work",
      description:
        "Before working on rows of the session's approved plan, claim them and the files they will touch (paths in the team's workspace; a folder covers what is in it). They are yours until you hand_off; another orb's claim is refused, naming whose it is.",
      parameters: obj({ plan: { type: "number" }, rows: { type: "array", items: { type: "string" } }, paths: { type: "array", items: { type: "string" } } }, ["plan", "rows"]),
      describe: (a) => `claim rows ${list(a.rows).join(", ")} of plan ${s(a.plan)}${list(a.paths).length ? ` and ${list(a.paths).join(", ")}` : ""}`,
      decision: "allow",
      async run(a, ctx) {
        const id = session(ctx);
        if (id === null) return notHere;
        try {
          const features = o.board.rows(Number(a.plan)).filter((r) => !r.test);
          const rows = new Set(features.map((r) => r.row));
          const unknown = list(a.rows).filter((r) => !rows.has(r));
          if (!rows.size) return { content: `plan ${s(a.plan)} has no board: it is not approved yet`, isError: true };
          if (unknown.length) return { content: `plan ${s(a.plan)} has no row ${unknown.join(", ")}`, isError: true };
          // an even share (PLAN 5.10; owner, 10-06: "lets give everyone equal work to do, it seemed like
          // only ash was given work"): with others in the tab, no one holds more than the open rows over them
          const at = parseTabConversation(ctx.conversation)!;
          const members = o.team().get(id)?.[at.tab] ?? [];
          const open = new Set(features.filter((r) => r.box !== "[x]").map((r) => r.row));
          const held = o.claims.live(id).find((c) => c.orb === ctx.orb && c.plan === Number(a.plan))?.rows ?? [];
          const share = Math.ceil(open.size / Math.max(1, members.length));
          const would = new Set([...held, ...list(a.rows)].filter((r) => open.has(r)));
          if (members.length > 1 && would.size > share) {
            return { content: `That is more than your share: ${open.size} open rows and ${members.length} orbs here, so ${share} each, and this would make yours ${would.size}. Claim at most ${Math.max(0, share - held.filter((r) => open.has(r)).length)} more, and leave the rest to the others.`, isError: true };
          }
          const c = o.claims.claim({ session: id, plan: Number(a.plan), orb: ctx.orb, rows: list(a.rows), paths: list(a.paths) });
          ctx.note?.(`${o.nameOf(ctx.orb)} took row${c.rows.length > 1 ? "s" : ""} ${c.rows.join(", ")}${c.paths.length ? ` (${c.paths.join(", ")})` : ""}.`, { board: true, claim: c.id });
          return { content: `Yours: rows ${c.rows.join(", ")}${c.paths.length ? `, and ${c.paths.join(", ")}` : ""}. Hand them off when done.` };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: "hand_off",
      label: "Handing off",
      description: "Hand off the rows you hold: the team is told what changed, which tests ran and the next row nobody holds.",
      parameters: obj({}, []),
      describe: () => "hand off the rows it holds",
      decision: "allow",
      async run(_a, ctx) {
        const id = session(ctx);
        if (id === null) return notHere;
        try {
          const mine = o.claims.live(id).find((c) => c.orb === ctx.orb);
          if (!mine) return { content: "You hold no rows to hand off.", isError: true };
          const h = o.claims.finish(id, ctx.orb, o.board.rows(mine.plan));
          const tests = h.tests.map((t) => `${t.row} ${t.box}${t.command ? ` (\`${t.command}\`)` : ""}`).join("; ");
          const said = `${o.nameOf(ctx.orb)} handed off ${h.rows.join(", ")}: changed ${h.changed.length ? h.changed.join(", ") : "nothing"}; tests ${tests}; next ${h.next ?? "nothing left"}.`;
          ctx.note?.(said, { board: true, handoff: h });
          return { content: said };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: "ask_orb",
      label: "Asking another orb",
      description: `Ask another orb of this session to do something: it reaches them in this tab, from you. A request of a request may go ${DEPTH} deep, no further.`,
      parameters: obj({ to: { type: "string", description: "Their name." }, request: { type: "string" } }, ["to", "request"]),
      describe: (a) => `ask ${s(a.to)}: ${s(a.request).slice(0, 120)}`,
      decision: "allow",
      async run(a, ctx) {
        const id = session(ctx);
        const at = parseTabConversation(ctx.conversation);
        if (id === null || !at) return notHere;
        const to = o.idOf(s(a.to));
        const sess = o.team().get(id);
        if (!to || !sess || !sess[at.tab].includes(to)) return { content: `${s(a.to)} does not work this tab: bring them in first`, isError: true };
        if (to === ctx.orb) return { content: "That is you.", isError: true };
        const depth = (ctx.depth ?? 0) + 1;
        if (depth > DEPTH) return { content: `Not asked: a request may go ${DEPTH} hands deep, and this one would be ${depth}. Do it yourself, or tell the person.`, isError: true };
        try {
          o.team().ask(id, at.tab, ctx.orb, to, s(a.request).slice(0, 4000), depth);
        } catch (e) {
          return { content: e instanceof Error ? e.message : String(e), isError: true };
        }
        return { content: `Asked ${o.nameOf(to)}.` };
      },
    },
    {
      name: "propose_change",
      label: "Proposing a change",
      description: "Propose a new row for the session's approved plan, with its test row. It changes the board only when another orb of the session, or the person, agrees.",
      parameters: obj(
        { plan: { type: "number" }, row: { type: "string", description: "Its number, like 2.4." }, feature: { type: "string" }, description: { type: "string" }, test: { type: "string", description: "What will show it works (its _t row)." } },
        ["plan", "row", "feature", "description", "test"],
      ),
      describe: (a) => `propose row ${s(a.row)} for plan ${s(a.plan)}: ${s(a.feature)}`,
      decision: "allow",
      async run(a, ctx) {
        const id = session(ctx);
        if (id === null) return notHere;
        try {
          const rows = o.board.rows(Number(a.plan)).map((r) => r.row.replace(/_t$/, ""));
          if (!rows.length) return { content: `plan ${s(a.plan)} has no board: it is not approved yet`, isError: true };
          const m = o.amendments.propose({ session: id, plan: Number(a.plan), proposer: ctx.orb, row: s(a.row), feature: s(a.feature), description: s(a.description), test: s(a.test), rows });
          ctx.note?.(`${o.nameOf(ctx.orb)} proposes row ${m.row}: ${m.feature}. It needs a second (change ${m.id}).`, { board: true, amendment: m.id });
          return { content: `Proposed as change ${m.id}: it needs another orb of the session, or the person, to agree.` };
        } catch (e) {
          return failed(e);
        }
      },
    },
    {
      name: "agree_change",
      label: "Agreeing a change",
      description: "Second another orb's proposed change to the plan: it becomes ✓ Agreed, and the board has its row.",
      parameters: obj({ id: { type: "number" } }, ["id"]),
      describe: (a) => `agree to change ${s(a.id)}`,
      decision: "allow",
      async run(a, ctx) {
        const id = session(ctx);
        if (id === null) return notHere;
        try {
          const m = o.amendments.agree(Number(a.id), ctx.orb, (x) => o.board.add(x.plan, x.row, `${x.feature}: ${x.description}`, x.test));
          ctx.note?.(`✓ Agreed: row ${m.row}, ${m.feature} (proposed by ${o.nameOf(m.proposer)}, seconded by ${o.nameOf(ctx.orb)})`, { agreed: `row ${m.row}: ${m.feature}`, amendment: m.id });
          return { content: `Agreed: row ${m.row} is on the board.` };
        } catch (e) {
          return failed(e);
        }
      },
    },
  ];
}
