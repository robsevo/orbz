// The owner's rules (PLAN 1.6; Open Dot's idea, our code): plain English, per orb or for every
// orb. Two kinds:
//
//   exact   written by "Always allow" on a card: it matches that action word for word
//   plain   written by the person ("never install packages", "ask before touching ~/Documents"),
//           matched by a model against the action described in plain words
//
// When several match, the strictest wins: never > ask > allow. When the matcher cannot answer,
// the call asks: a rule nobody could check is not permission. Rules sit ON TOP of the floor
// (floor.ts): they can tighten anything and loosen nothing it covers.
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "../clock.ts";
import { tx } from "../db.ts";
import type { EventLog } from "../events.ts";
import type { Decision } from "../agent/tools.ts";
import { chat, type Endpoint } from "../brain/openai.ts";
import type { Spend } from "../brain/spend.ts";

export type Rule = {
  id: number;
  orb: string | null;
  text: string;
  decision: Decision;
  /** For an exact rule, the action it matches word for word. */
  action: string | null;
  source: "owner" | "card";
  createdAt: number;
};

export interface Matcher {
  /** The ids of the rules that apply to the action. Throws when it cannot tell. */
  match(described: string, rules: Rule[], signal?: AbortSignal): Promise<number[]>;
}

type Row = { id: number; orb: string | null; text: string; decision: Decision; action: string | null; source: "owner" | "card"; created_at: number };

const RANK: Record<Decision, number> = { allow: 0, ask: 1, never: 2 };
export const strictest = (a: Decision, b: Decision): Decision => (RANK[a] >= RANK[b] ? a : b);

export class Rules {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #clock: Clock;

  constructor(db: DatabaseSync, events: EventLog, clock: Clock) {
    this.#db = db;
    this.#events = events;
    this.#clock = clock;
  }

  add(r: { orb: string | null; text: string; decision: Decision; action?: string | null; source: "owner" | "card" }): Rule {
    const id = tx(this.#db, () => {
      const row = this.#db
        .prepare("INSERT INTO rules (orb, text, decision, action, source, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
        .get(r.orb, r.text, r.decision, r.action ?? null, r.source, this.#clock.now()) as { id: number };
      this.#events.append("rule.added", { rule: row.id, text: r.text, decision: r.decision, source: r.source }, { orb: r.orb });
      return row.id;
    });
    return this.list(r.orb).find((x) => x.id === id)!;
  }

  remove(id: number): void {
    tx(this.#db, () => {
      this.#db.prepare("UPDATE rules SET removed_at = ? WHERE id = ? AND removed_at IS NULL").run(this.#clock.now(), id);
      this.#events.append("rule.removed", { rule: id });
    });
  }

  /** The rules in force for an orb: its own and everyone's. */
  list(orb: string | null): Rule[] {
    const rows = this.#db
      .prepare("SELECT * FROM rules WHERE removed_at IS NULL AND (orb IS NULL OR orb = ?) ORDER BY id")
      .all(orb) as Row[];
    return rows.map((r) => ({ id: r.id, orb: r.orb, text: r.text, decision: r.decision, action: r.action, source: r.source, createdAt: r.created_at }));
  }

  /** What the rules say about an action (null: nothing does). */
  async decide(orb: string, described: string, matcher: Matcher | null, signal?: AbortSignal): Promise<{ decision: Decision | null; why: string }> {
    const rules = this.list(orb);
    const exact = rules.filter((r) => r.action !== null && r.action === described);
    const plain = rules.filter((r) => r.action === null);
    let decision: Decision | null = null;
    const why: string[] = [];
    for (const r of exact) {
      decision = decision ? strictest(decision, r.decision) : r.decision;
      why.push(`your rule: ${r.text}`);
    }
    if (plain.length) {
      let ids: number[];
      try {
        if (!matcher) throw new Error("no rule matcher is set up");
        ids = await matcher.match(described, plain, signal);
      } catch (e) {
        return {
          decision: decision ? strictest(decision, "ask") : "ask",
          why: `your rules could not be checked (${e instanceof Error ? e.message : String(e)}), so it asks`,
        };
      }
      for (const r of plain.filter((p) => ids.includes(p.id))) {
        decision = decision ? strictest(decision, r.decision) : r.decision;
        why.push(`your rule: ${r.text}`);
      }
    }
    return { decision, why: why.join("; ") };
  }
}

/** Matches plain-English rules with a model (a cheap one does). Its answer can only pick among
 * the person's own rules; it cannot invent one or change what a rule says. */
export class ModelMatcher implements Matcher {
  readonly #ep: Endpoint;
  readonly #spend: Spend;

  constructor(ep: Endpoint, spend: Spend) {
    this.#ep = ep;
    this.#spend = spend;
  }

  async match(described: string, rules: Rule[], signal?: AbortSignal): Promise<number[]> {
    this.#spend.check();
    const list = rules.map((r) => `${r.id}. ${r.text}`).join("\n");
    const r = await chat(
      this.#ep,
      [
        {
          role: "user",
          content:
            `Rules the person set:\n${list}\n\nAction: ${described}\n\n` +
            "Which of the rules apply to this action? Reply with only a JSON array of their numbers, [] if none.",
        },
      ],
      { maxTokens: 50, ...(signal && { signal }) },
    );
    this.#spend.record({ tier: "own", model: this.#ep.model, costUsd: r.costUsd, costSource: r.costSource, promptTokens: r.promptTokens, completionTokens: r.completionTokens });
    const m = /\[[\d\s,]*\]/.exec(r.text);
    if (!m) throw new Error("the matcher's reply was not a list of rule numbers");
    const ids = (JSON.parse(m[0]) as number[]).filter((n) => rules.some((x) => x.id === n));
    return ids;
  }
}
