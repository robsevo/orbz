// Plan cards (PLAN 1.7): any job bigger than a one-liner starts with a plan the person can hold the
// orb to. The orb proposes it (the `propose_plan` tool); the gate (gate.ts) checks it first; a plan
// that passes is shown as a card with Approve / Change / Save / Decline, and is archived the
// moment it is shown (Ash's plans.mjs: archived at submission, not approval, so a declined plan
// is still there to revise from). The archived text is frozen; only its status moves.
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "../clock.ts";
import { tx } from "../db.ts";
import type { EventLog } from "../events.ts";
import type { ToolDef } from "../agent/tools.ts";
import { summary } from "./format.ts";
import { gate } from "./gate.ts";

export type PlanStatus = "submitted" | "approved" | "changed" | "saved" | "declined";
export type Plan = {
  id: number;
  orb: string;
  conversation: string;
  card: number | null;
  status: PlanStatus;
  title: string;
  body: string;
  shown: string;
  objections: string[];
  createdAt: number;
  updatedAt: number;
};

/** A plan's name: its first heading that is not a PHASE heading, else its first line. */
export function planTitle(body: string): string {
  const h = body.split("\n").map((l) => /^\s*#{1,4}\s+(.+?)\s*$/.exec(l)?.[1]).find((t) => t && !/^PHASE\s+\d/i.test(t));
  const first = body.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("|"));
  return (h ?? first ?? "A plan").replace(/[*_`]/g, "").slice(0, 120);
}

/** Soft objections send a plan back this many times; after that it is shown with them attached. */
export const SEND_BACKS = 2;

type Row = { id: number; orb: string; conversation: string; card: number | null; status: PlanStatus; title: string; body: string; shown: string; objections: string; created_at: number; updated_at: number };

export class Plans {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #clock: Clock;

  constructor(db: DatabaseSync, events: EventLog, clock: Clock) {
    this.#db = db;
    this.#events = events;
    this.#clock = clock;
  }

  /** Checks a proposed plan. Either it goes back to the orb (with why), or it is shown. */
  check(orb: string, conversation: string, body: string, roots: string[]): { sendBack: string } | { show: string; objections: string[] } {
    const since = this.#lastShown(conversation);
    const checks = this.#events.ofType("plan.checked").filter((e) => e.conversation === conversation && e.seq > since.seq);
    const previous = checks.at(-1)?.data.body;
    const changed = since.plan?.status === "changed" ? since.plan.body : null;
    const g = gate(body, { roots, previous: typeof previous === "string" ? previous : null, changedFrom: changed });
    const sentBack = checks.filter((e) => e.data.verdict === "sent_back").length;
    const verdict = g.hard.length ? "refused" : g.soft.length && sentBack < SEND_BACKS ? "sent_back" : "shown";
    this.#events.append("plan.checked", { verdict, hard: g.hard, soft: g.soft, tier: g.tier, body }, { orb, conversation });
    if (verdict === "refused") {
      return { sendBack: `The plan was not shown: ${g.hard.join("; ")}. Fix that and propose it again (or, if it is one small task, just do it).` };
    }
    if (verdict === "sent_back") {
      return { sendBack: `The plan gate sent it back (${sentBack + 1} of ${SEND_BACKS}): ${g.soft.join("; ")}. Revise it and propose it again; after ${SEND_BACKS} send-backs it is shown with the objections attached.` };
    }
    const objections = g.soft;
    const shown = `${body.trim()}\n\n### Count summary\n\n${summary(g.counts)}${objections.length ? `\n\n> The plan gate still objects: ${objections.join("; ")}` : ""}\n`;
    return { show: shown, objections };
  }

  /** Archives a plan as it is shown. */
  archive(p: { orb: string; conversation: string; card: number; body: string; shown: string; objections: string[] }): Plan {
    const now = this.#clock.now();
    const title = planTitle(p.body);
    const id = tx(this.#db, () => {
      const r = this.#db
        .prepare("INSERT INTO plans (orb, conversation, card, status, title, body, shown, objections, created_at, updated_at) VALUES (?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?) RETURNING id")
        .get(p.orb, p.conversation, p.card, title, p.body, p.shown, JSON.stringify(p.objections), now, now) as { id: number };
      this.#events.append("plan.shown", { plan: r.id, card: p.card, title, objections: p.objections.length }, { orb: p.orb, conversation: p.conversation });
      return r.id;
    });
    return this.get(id)!;
  }

  mark(id: number, status: Exclude<PlanStatus, "submitted">): void {
    tx(this.#db, () => {
      this.#db.prepare("UPDATE plans SET status = ?, updated_at = ? WHERE id = ?").run(status, this.#clock.now(), id);
      this.#events.append("plan.answered", { plan: id, status });
    });
  }

  get(id: number): Plan | undefined {
    const r = this.#db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as Row | undefined;
    return r && toPlan(r);
  }

  list(orb?: string): Plan[] {
    const rows = (orb ? this.#db.prepare("SELECT * FROM plans WHERE orb = ? ORDER BY id DESC").all(orb) : this.#db.prepare("SELECT * FROM plans ORDER BY id DESC").all()) as Row[];
    return rows.map(toPlan);
  }

  #lastShown(conversation: string): { seq: number; plan: Plan | null } {
    const e = this.#events.ofType("plan.shown").findLast((x) => x.conversation === conversation);
    return { seq: e?.seq ?? 0, plan: e ? (this.get(Number(e.data.plan)) ?? null) : null };
  }
}

function toPlan(r: Row): Plan {
  return {
    id: r.id, orb: r.orb, conversation: r.conversation, card: r.card, status: r.status, title: r.title,
    body: r.body, shown: r.shown, objections: JSON.parse(r.objections) as string[], createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/** The tool that puts a plan in front of the person. */
export function planTool(plans: Plans, roots: (workspace: string) => string[]): ToolDef {
  return {
    name: "propose_plan",
    label: "Writing a plan",
    description:
      "Show the person a plan before any job bigger than one small step, and wait for Approve, Change, Save or Decline. " +
      "House format: `### PHASE N — name` headings, each with a table `| # | Feature | Description | Done |`; one numbered row per " +
      "feature (`| 1.1 | … | [ ] |`) and right under it its test row (`| 1.1_t | Tests: … | [ ] |`) naming what proves it. Name the " +
      "files it touches, how each step is verified, and what it deliberately does not do. Do NOT type any counts: the home adds them. " +
      "A one-step task needs no plan; just do it.",
    parameters: {
      type: "object",
      properties: { plan: { type: "string", description: "The whole plan, in markdown, in the house format." } },
      required: ["plan"],
      additionalProperties: false,
    },
    describe: (a) => `show a plan: ${planTitle(String(a.plan ?? ""))}`,
    decision: "allow",
    pause: "plan",
    async gate(a, ctx) {
      const r = plans.check(ctx.orb, ctx.conversation, String(a.plan ?? ""), roots(ctx.workspace));
      if ("sendBack" in r) return { sendBack: r.sendBack };
      return {
        detail: r.show,
        meta: { objections: r.objections },
        opened: (card) => {
          const p = plans.archive({ orb: ctx.orb, conversation: ctx.conversation, card, body: String(a.plan ?? ""), shown: r.show, objections: r.objections });
          return { plan: p.id };
        },
      };
    },
  };
}

