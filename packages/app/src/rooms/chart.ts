// The org chart's shape (PLAN 5.6, 5.12; owner, 10-08: "Org chart needs to be nicer too lol. like a family tree or
// corporate latter"): you at its root, the CEO under you, each department's head a branch under the CEO, and under
// each head the department's team by the kind of work they do, each kind's lead first. Pure (no React, no DOM), so a
// test can read it; rooms/Org.tsx draws it.
import type { HueName } from "../design/tokens.ts";
import { FAMILIES, SPECIALTIES, type Family } from "../orb/spec.ts";
import { ZONES } from "../floor/plan.ts";

/** Each department's head's post (home org.ts HEAD_OF). */
export const HEAD_OF: Record<Family, keyof typeof SPECIALTIES> = { exec: "ceo", build: "cto", think: "chiefofstaff", make: "cmo", finance: "cfo", business: "coo", life: "assistant", desk: "deskhead" };

/** Each department's colour: its zone's on the floor, and for the three with no zone of their own the CEO's gold, the
 * CFO's green and the desk's lime. */
export const HUE_OF: Record<Family, HueName> = {
  exec: "honey",
  finance: "jade",
  desk: "lime",
  ...(Object.fromEntries(ZONES.filter((z) => z.id !== "play").map((z) => [z.id, z.hue])) as Record<Exclude<Family, "exec" | "finance" | "desk">, HueName>),
};

/** One kind of work in a team: its lead (none when the lead heads the department), then the rest. */
export type Kind = { kind: string; lead: string | null; rest: string[] };
/** A department under the CEO: its head (none when its post is empty) and its team. */
export type Branch = { family: Family; head: string | null; team: Kind[] };
/** The whole tree: the CEO, any other officer of the CEO's own post, and the departments in the company's order. */
export type Chart = { ceo: string | null; executive: Kind[]; branches: Branch[] };

type Org = { leads: Record<string, string>; heads?: Record<string, string | null>; orbs: { id: string; specialty: string }[] };

/** The department an orb works in: its kind's own, or, for an officer, the department its post heads (a second CFO
 * works in Finance, under the CFO). */
export function departmentOf(specialty: string): Family {
  const family = (SPECIALTIES[specialty as keyof typeof SPECIALTIES]?.family ?? "think") as Family;
  if (family !== "exec") return family;
  return (Object.keys(HEAD_OF) as Family[]).find((f) => HEAD_OF[f] === specialty) ?? "exec";
}

/** The org chart's tree from the home's org: every orb once, a head only at the top of its branch. */
export function chartOf(org: Org): Chart {
  const heads = org.heads ?? {};
  const isHead = new Set(Object.values(heads).filter((h): h is string => !!h));
  // a team's kinds of work in the roster's order (its own kinds first, an officer's post last), never by who joined first
  const roster = Object.keys(SPECIALTIES);
  const kinds = [...new Set(org.orbs.map((o) => o.specialty))].sort((a, b) => (roster.indexOf(a) + 1 || roster.length + 1) - (roster.indexOf(b) + 1 || roster.length + 1));
  const teamOf = (f: Family): Kind[] =>
    kinds
      .filter((k) => departmentOf(k) === f)
      .map((k) => {
        const lead = org.leads[k] ?? null;
        return { kind: k, lead: lead && !isHead.has(lead) ? lead : null, rest: org.orbs.filter((o) => o.specialty === k && o.id !== lead && !isHead.has(o.id)).map((o) => o.id) };
      })
      .filter((t) => t.lead || t.rest.length);
  const branches = (Object.keys(FAMILIES) as Family[])
    .filter((f) => f !== "exec")
    .map((f) => ({ family: f, head: heads[f] ?? null, team: teamOf(f) }))
    .filter((b) => b.head || b.team.length);
  return { ceo: heads.exec ?? null, executive: teamOf("exec"), branches };
}
