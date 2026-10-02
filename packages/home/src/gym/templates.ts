// Plan templates (PLAN 3.2: "plan shapes you approve repeatedly become plan templates the same
// way"). A plan's shape is its features, in order, by name (plans/format.ts reads the rows). An
// orb's shape you approved MIN_APPROVED times becomes a template: the newest of those plans, its
// boxes back to [ ], promoted only if the plan gate (plans/gate.ts) passes it with nothing to
// say, hard or soft. The orb starts a plan of that kind from it (the `plan_templates` tool); the
// plan it then proposes goes through the gate like any other.
import type { EventLog } from "../events.ts";
import type { Plan } from "../plans/plans.ts";
import { parse } from "../plans/format.ts";
import { gate } from "../plans/gate.ts";
import { MIN_APPROVED } from "./finder.ts";

export type Template = { orb: string; shape: string; title: string; body: string; plans: number[] };

/** A plan's shape: its features' names, in order. Empty when it has none. */
export function shapeOfPlan(body: string): string {
  return parse(body).rows.filter((r) => !r.test).map((r) => (r.text.split("|")[2] ?? "").trim().toLowerCase().replace(/\s+/g, " ")).join(" > ");
}

/** The templates an orb's approved plans make now, and why each other candidate is not one. */
export function templatesOf(plans: Plan[], orb: string): { templates: Template[]; refused: { shape: string; why: string[] }[] } {
  const groups = new Map<string, Plan[]>();
  for (const p of plans) {
    if (p.orb !== orb || p.status !== "approved") continue;
    const s = shapeOfPlan(p.body);
    if (s) groups.set(s, [...(groups.get(s) ?? []), p]);
  }
  const templates: Template[] = [];
  const refused: { shape: string; why: string[] }[] = [];
  for (const [shape, ps] of groups) {
    if (ps.length < MIN_APPROVED) continue;
    const newest = ps.reduce((a, b) => (b.updatedAt > a.updatedAt || (b.updatedAt === a.updatedAt && b.id > a.id) ? b : a));
    const body = newest.body.replace(/\[(x|~)\]/gi, "[ ]");
    const g = gate(body, { roots: [] });
    const why = [...g.hard, ...g.soft];
    if (why.length) refused.push({ shape, why });
    else templates.push({ orb, shape, title: newest.title, body, plans: ps.map((p) => p.id).sort((a, b) => a - b) });
  }
  return { templates, refused };
}

/** Each orb's new templates, kept in the log once (`template.promoted`); the night calls it. */
export function promoteTemplates(events: EventLog, plans: Plan[], orb: string): Template[] {
  const known = new Set(events.ofType("template.promoted").filter((e) => e.orb === orb).map((e) => `${String(e.data.shape)}|${(e.data.plans as number[]).join(",")}`));
  const out: Template[] = [];
  for (const t of templatesOf(plans, orb).templates) {
    if (known.has(`${t.shape}|${t.plans.join(",")}`)) continue;
    events.append("template.promoted", { shape: t.shape, title: t.title, body: t.body, plans: t.plans }, { orb });
    out.push(t);
  }
  return out;
}

/** An orb's templates: the newest promotion of each shape. */
export function templatesFor(events: EventLog, orb: string): Template[] {
  const byShape = new Map<string, Template>();
  for (const e of events.ofType("template.promoted")) {
    if (e.orb !== orb) continue;
    byShape.set(String(e.data.shape), { orb, shape: String(e.data.shape), title: String(e.data.title), body: String(e.data.body), plans: e.data.plans as number[] });
  }
  return [...byShape.values()];
}
