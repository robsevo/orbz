// The plan, restated at the end of a working orb's context (owner, 10-07: "build the ash stuff next, the
// repeat guard and recitation"). Ported from Ash's engine (cli/engine/src/loop.mjs, "RECITATION"): a plan
// written early and used for many steps is the first thing a model loses track of (plan signal down 4.1x
// after one action-observation step; arXiv 2606.22953, "Plans Don't Persist"), and Manus answers it the
// same way, by restating the open steps where attention is highest, the end. Ash's owner put the result
// as "the planning is awesome, but he doesnt finish coding what im telling him to code".
//
// What an orb still has open: in a session, the rows it holds (claims.ts); alone with you, the rows of a
// plan you approved in that conversation. Nothing open, nothing said. It is rebuilt for every request
// and never stored, and it goes last, so the requests before it stay the same prefix for the cache.
import type { Board } from "./board.ts";
import type { Plans } from "./plans.ts";
import { parse } from "./format.ts";
import type { Claims } from "../claims.ts";
import { parseTabConversation } from "../team.ts";

export function recital(o: { orb: string; conversation: string; plans: Plans; board: Board; claims: Claims }): string | null {
  const at = parseTabConversation(o.conversation);
  // plan → the rows of it this orb is to finish
  const mine = new Map<number, Set<string> | null>();
  if (at) for (const c of o.claims.live(at.id)) if (c.orb === o.orb) mine.set(c.plan, new Set([...(mine.get(c.plan) ?? []), ...c.rows]));
  if (!at) for (const p of o.plans.list()) if (p.conversation === o.conversation && p.status === "approved") mine.set(p.id, null); // all of it
  const lines: string[] = [];
  for (const [plan, only] of mine) {
    const p = o.plans.get(plan);
    if (!p) continue;
    const names = new Map(parse(p.body).rows.filter((r) => !r.test).map((r) => [r.id, r.text.split("|").map((c) => c.trim()).filter(Boolean)[1] ?? r.id]));
    const rows = o.board.rows(plan).filter((r) => !r.test && (!only || only.has(r.row)));
    const open = rows.filter((r) => r.box !== "[x]");
    if (!open.length) continue;
    const done = rows.length - open.length;
    const on = open.find((r) => r.box === "[~]");
    const said = open.map((r) => `${r.row} ${names.get(r.row) ?? ""} ${r.box}${r.command ? ` (its test: \`${r.command}\`)` : ""}`.replace(/\s+/g, " ").trim());
    lines.push(`Plan ${plan}, "${p.title}": ${done} of ${rows.length} ${only ? "of your rows " : ""}done. Still open: ${said.join("; ")}.${on ? ` You are on ${on.row}.` : ""}`);
  }
  if (!lines.length) return null;
  return [
    "Your plan, restated by the home (it is not the person speaking):",
    ...lines,
    `Don't end your turn while one of these is open: build it, then check_row it${at ? ", and hand_off when all of yours are done" : ""}. If one turns out to be unnecessary, say so in one line and go on to the next.`,
  ].join("\n");
}
