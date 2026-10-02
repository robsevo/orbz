// One decision per tool call (PLAN 1.6), made of everything that has a say, in this order:
//
//   1. a write to a protected path            → never   (the floor)
//   2. a rule that says never                 → never   (the person can always tighten)
//   3. the rules, else the tool's own default → allow / ask
//   4. the floor's categories                 → at least ask, whatever the rules allowed
//   5. the one-way switch: a turn that read untrusted content acts outward only with a fresh yes
//   6. away (a schedule or trigger running unwatched): read-only, so anything outward asks
//
// Steps 4-6 only ever raise. Tier (habit, own brain, big brain) is not an input. Rank (Junior to
// Chief, PLAN 3.8) enters at step 3 only, as a default where neither your rules nor anything else
// said (rules/rank.ts: a Senior's read-only command): steps 4-6 still raise it, so nothing about
// who proposes an action loosens the floor.
import type { Decision } from "../agent/tools.ts";
import { type FloorHit } from "./floor.ts";
import { strictest } from "./rules.ts";

export type Mode = "attended" | "away";

export type CallFacts = {
  floor: FloorHit[];
  rule: { decision: Decision | null; why: string };
  defaultDecision: Decision;
  /** The one-way switch's verdict for an outward action; null for a tool that does not act outward. */
  oneway: { allowed: boolean; why: string } | null;
  mode: Mode;
  outward: boolean;
  /** Why the orb's rank lets an "ask" by default go without asking (rules/rank.ts), or null. */
  rank?: string | null;
};

export type Verdict = { decision: Decision; why: string[]; floor: FloorHit[]; mayAlways: boolean };

export function decide(f: CallFacts): Verdict {
  const why: string[] = [];
  const protectedHit = f.floor.find((h) => h.category === "protected");
  if (protectedHit) return { decision: "never", why: [protectedHit.why], floor: f.floor, mayAlways: false };
  if (f.rule.decision === "never") return { decision: "never", why: [f.rule.why], floor: f.floor, mayAlways: false };

  let d: Decision = f.rule.decision ?? f.defaultDecision;
  if (f.rule.why) why.push(f.rule.why);
  if (f.rule.decision === null && d === "ask" && f.rank) {
    d = "allow";
    why.push(f.rank);
  }
  for (const h of f.floor) {
    d = strictest(d, "ask");
    why.push(h.why);
  }
  if (f.oneway && !f.oneway.allowed) {
    d = strictest(d, "ask");
    why.push(f.oneway.why);
  }
  if (f.mode === "away" && f.outward) {
    d = strictest(d, "ask");
    why.push("while you're away it only reads; acting needs you");
  }
  // "Always allow" could only ever cover what the floor and the switch do not; offering it on a
  // card they raised would promise something the next call cannot keep.
  const mayAlways = f.floor.length === 0 && !(f.oneway && !f.oneway.allowed) && f.mode === "attended";
  return { decision: d, why, floor: f.floor, mayAlways };
}
