// The guard (PLAN 1.6): what the agent loop asks before every tool call, and what it hands every
// untrusted result through. It gathers the facts — the floor, the person's rules, Ash's one-way
// switch (through the kit, over MCP), whether anyone is watching — and policy.ts decides.
//
// A turn is one request of the person's (its message id); its one-way state lives in the home's
// database, so neither a restart nor the kit dying mid-turn can wash it clean. Without the kit
// the switch fails CLOSED: a turn that read untrusted content asks before acting, and untrusted
// text is withheld rather than shown to the model unfenced.
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "../clock.ts";
import type { Kit } from "../kit.ts";
import type { ToolDef, ToolResult } from "../agent/tools.ts";
import type { Decision } from "../agent/tools.ts";
import { type FloorHit, shellFloor } from "./floor.ts";
import { decide, type Mode, type Verdict } from "./policy.ts";
import type { Matcher, Rules } from "./rules.ts";
import { rankWidens } from "./rank.ts";
import type { Family } from "../brain/constitution.ts";
import type { Level } from "../gym/levels.ts";

export type Taint = { source: string; detail: string };
export type TurnState = { taints: Taint[]; approved: string[] };

export class Turns {
  readonly #db: DatabaseSync;
  readonly #clock: Clock;

  constructor(db: DatabaseSync, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  get(id: string): TurnState {
    const r = this.#db.prepare("SELECT taints, approved FROM turns WHERE id = ?").get(id) as { taints: string; approved: string } | undefined;
    if (!r) return { taints: [], approved: [] };
    return { taints: JSON.parse(r.taints) as Taint[], approved: JSON.parse(r.approved) as string[] };
  }

  #put(id: string, s: TurnState): void {
    this.#db
      .prepare("INSERT INTO turns (id, taints, approved, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET taints = excluded.taints, approved = excluded.approved, updated_at = excluded.updated_at")
      .run(id, JSON.stringify(s.taints), JSON.stringify(s.approved), this.#clock.now());
  }

  taint(id: string, t: Taint): void {
    const s = this.get(id);
    s.taints.push({ source: t.source, detail: t.detail.slice(0, 200) });
    this.#put(id, s);
  }

  approve(id: string, action: string): void {
    const s = this.get(id);
    if (!s.approved.includes(action)) s.approved.push(action);
    this.#put(id, s);
  }
}

export type GuardOptions = {
  db: DatabaseSync;
  clock: Clock;
  rules: Rules;
  turns: Turns;
  kit: Kit | null;
  dataDir: string;
  matcher?: () => Matcher | null;
  /** Test hook: overrides what the rules say (the floor, the switch and away still apply). */
  ruleOverride?: (def: ToolDef, args: Record<string, unknown>) => Decision | null;
  /** An orb's level and its specialty's family, for the one thing rank widens (rules/rank.ts). */
  rankOf?: (orb: string) => { level: Level; family: Family } | null;
};

export type CallSite = { orb: string; turn: string; mode: Mode; signal?: AbortSignal };

export class Guard {
  readonly #o: GuardOptions;
  #protected: string[] | null = null;

  constructor(opts: GuardOptions) {
    this.#o = opts;
  }

  /** The owner's brain and Orbs' own data, plus every path the kit's write_guard protects. */
  async protectedPaths(): Promise<string[]> {
    if (this.#protected) return this.#protected;
    const d = resolve(this.#o.dataDir);
    const own = [join(d, "brain"), join(d, "home.db"), join(d, "rules"), join(d, "loops")];
    let kit: string[] = [];
    try {
      const r = (await this.#o.kit?.call("protected_paths")) as { path: string }[] | undefined;
      kit = (r ?? []).map((p) => p.path);
      if (r) this.#protected = [...own, ...kit];
    } catch {
      // the kit is down: the home's own paths still stand; ask the kit again next time
    }
    return this.#protected ?? own;
  }

  async verdict(def: ToolDef, args: Record<string, unknown>, at: CallSite): Promise<Verdict & { described: string }> {
    const described = def.describe(args);
    const floor: FloorHit[] = [...(def.floor?.(args) ?? [])];
    let command = String(args.command ?? "");
    if (def.act === "shell") {
      try {
        command = def.commandOf?.(args) ?? command;
      } catch {
        // no command to read (the tool will refuse on its own)
      }
      floor.push(...shellFloor(command, await this.protectedPaths(), homedir()));
    }
    const override = this.#o.ruleOverride?.(def, args) ?? null;
    const rule = override
      ? { decision: override, why: "" }
      : await this.#o.rules.decide(at.orb, described, this.#o.matcher?.() ?? null, at.signal);
    const oneway = def.act ? await this.#oneway(at.turn, def.act) : null;
    const r = def.act === "shell" ? this.#o.rankOf?.(at.orb) : null;
    const rank = r ? rankWidens({ ...r, command, background: Boolean(args.background) }) : null;
    return { ...decide({ floor, rule, defaultDecision: def.decision, oneway, mode: at.mode, outward: Boolean(def.act), rank }), described };
  }

  /** A card's yes for an outward action opens the switch for that action, this turn only. */
  approved(turn: string, def: ToolDef): void {
    if (def.act) this.#o.turns.approve(turn, def.act);
  }

  /** What an untrusted tool brought back: the turn is marked, and the text goes to the model fenced
   * as data by Ash's oneway.quote, or not at all. */
  async result(def: ToolDef, args: Record<string, unknown>, turn: string, r: ToolResult): Promise<ToolResult> {
    if (!def.untrusted || r.stoppedByUser) return r;
    this.#o.turns.taint(turn, { source: def.untrusted, detail: def.describe(args) });
    try {
      const fenced = (await this.#o.kit?.call("oneway_quote", { turn, text: r.content })) as string | undefined;
      if (typeof fenced === "string") return { ...r, content: fenced };
    } catch {
      // fall through: withheld
    }
    return { ...r, content: "(The page was read, but its text is withheld: the kit that fences untrusted text is not running.)" };
  }

  async #oneway(turn: string, action: string): Promise<{ allowed: boolean; why: string }> {
    const s = this.#o.turns.get(turn);
    if (!s.taints.length) return { allowed: true, why: "" };
    try {
      const r = (await this.#o.kit?.call("oneway_check", { turn, action, taints: s.taints, approved: s.approved })) as
        | { allowed: boolean; why: string }
        | undefined;
      if (r) return { allowed: r.allowed, why: r.allowed ? r.why : `this turn read something from outside (${[...new Set(s.taints.map((t) => t.source))].join(", ")}), so acting needs a fresh yes` };
    } catch {
      // the kit is down
    }
    return { allowed: false, why: "this turn read something from outside and the one-way switch is not running, so it asks" };
  }
}

