// The exam (PLAN 3.5): what guards every promotion of a brain to a task. Ash's eval gate
// (`brain/evals/run.mjs`) in the gym's terms: a brain sits a task's approved cases k times each,
// and is judged on its pass RATES, never one coin flip.
//   - a case passes when the brain makes the very calls the approved run made, in order, with the
//     same arguments, and then answers (a model never says the same words twice, so its words are
//     not graded byte for byte; a habit's are, in compile.ts);
//   - a repeat the brain could not answer (a rate limit, an outage) is no evidence either way; a
//     case with only those is left out of the verdict, and said so (a bad night is not a worse
//     playbook);
//   - against a baseline: a case that fell by TASK_MARGIN, or the whole sitting by SUITE_MARGIN, is
//     a regression; but a baseline on another model, or sampled differently, cannot be compared,
//     and a sitting that did not finish never becomes one.
// Nothing the brain says about how it did is read: the harness replays, and counts.
import { BrainCallError } from "../brain/openai.ts";
import { replay, type Case, type StepFn } from "./cases.ts";

/** How many times each case is sat (Ash's nightly k). */
export const K = 5;
/** A case regressed when its rate fell this far (at least 2 of 5 lost). */
export const TASK_MARGIN = 0.4;
/** The whole sitting regressed when its rate fell this far (far steadier than one case). */
export const SUITE_MARGIN = 0.1;
/** What a task type's own brain must clear before it answers that task (PLAN 3.4). */
export const BAR = 0.8;

export type Sitting = {
  kind: string;
  /** The model that answered (the brain's own name for it), or null if it could not be told. */
  brain: string | null;
  /** The playbook (or habit) version sat. */
  version: string;
  k: number;
  /** Each case's pass rate, by its run; null when every repeat was rate-limited. */
  rates: Record<string, number | null>;
  /** All passes over all repeats that counted. */
  suite: number | null;
  /** Cases not sat at all (the sitting was cut short). */
  missing: number[];
};

/** Sits each case k times. `step(c)` is the brain's step function for one repeat of a case. */
export async function sit(o: { kind: string; brain: string | null; version: string; cases: Case[]; k?: number; step: (c: Case) => StepFn; until?: () => boolean }): Promise<Sitting> {
  const k = o.k ?? K;
  const rates: Record<string, number | null> = {};
  const missing: number[] = [];
  let passes = 0;
  let counted = 0;
  for (const c of o.cases) {
    if (o.until?.()) {
      missing.push(c.run);
      continue;
    }
    let p = 0;
    let n = 0;
    for (let i = 0; i < k; i++) {
      try {
        const r = await replay(o.step(c), c, { answer: "said" });
        n++;
        if (r.ok) p++;
      } catch (e) {
        if (e instanceof BrainCallError) continue; // no evidence either way
        throw e;
      }
    }
    rates[String(c.run)] = n ? p / n : null;
    passes += p;
    counted += n;
  }
  return { kind: o.kind, brain: o.brain, version: o.version, k, rates, suite: counted ? passes / counted : null, missing };
}

export type Verdict = { verdict: "pass" | "regressed" | "incomparable"; regressed: string[]; why: string[] };

/** A sitting against its baseline, by Ash's gate. With no baseline there is nothing to fall from. */
export function gate(base: Sitting | null, now: Sitting, m: { task?: number; suite?: number } = {}): Verdict {
  const task = m.task ?? TASK_MARGIN;
  const suite = m.suite ?? SUITE_MARGIN;
  const why: string[] = [];
  if (now.missing.length) return { verdict: "incomparable", regressed: [], why: [`${now.missing.length} case(s) never sat: a partial sitting proves nothing`] };
  if (!base) return { verdict: "pass", regressed: [], why: ["no baseline: nothing to fall from"] };
  if (base.brain && now.brain && base.brain !== now.brain) return { verdict: "incomparable", regressed: [], why: [`the baseline was sat by ${base.brain}, this by ${now.brain}: that is the model, not the playbook`] };
  if ((base.k > 1) !== (now.k > 1)) return { verdict: "incomparable", regressed: [], why: [`sampled x${base.k} then x${now.k}: a rate cannot be compared with one coin flip`] };
  const regressed: string[] = [];
  for (const [run, rate] of Object.entries(now.rates)) {
    const was = base.rates[run];
    if (rate === null) {
      why.push(`case ${run}: the brain could not be asked, not judged`);
      continue;
    }
    if (was === undefined || was === null) continue; // a new case: nothing to fall from
    if (was - rate >= task) regressed.push(run);
  }
  if (regressed.length) why.push(`case(s) ${regressed.join(", ")} fell by ${task} or more`);
  const fell = base.suite !== null && now.suite !== null && base.suite - now.suite >= suite;
  if (fell) why.push(`the whole sitting fell from ${pct(base.suite!)} to ${pct(now.suite!)}`);
  return { verdict: regressed.length || fell ? "regressed" : "pass", regressed, why };
}

/** Whether a sitting earns a task type for its brain (PLAN 3.4): sat in full, more than once a
 * case, every case judged, and the whole of it at the bar. No rate, no move. */
export function clears(s: Sitting | null, bar = BAR): boolean {
  if (!s || s.missing.length || s.k < 2 || s.suite === null) return false;
  if (Object.values(s.rates).some((r) => r === null)) return false;
  return s.suite >= bar;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;
