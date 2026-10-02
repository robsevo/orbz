// The habit compiler (PLAN 3.2): at night, for a candidate (finder.ts), the teacher writes a step
// habit from its approved runs (cases.ts); the harness replays every run through it in the kit's
// sandbox, one step at a time, and promotes it only if every replay matches, call for call and
// word for word. What the teacher (or the habit) says about the result is never read: a habit
// that "claims" a pass but fails a replay is rejected, with why. Promoted, it is kept with the
// familiarity of the inputs it was proved on (kit/orbs_kit/habits.py), and `habit.promoted` is
// evidence for the orb's XP (xp.ts).
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { EventLog } from "../events.ts";
import type { Candidate } from "./finder.ts";
import { replay, type Case, type StepFn } from "./cases.ts";

/** What the compiler needs of the kit: its tools, by name (kit.ts `call`). */
export type KitCall = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export type Compiled = { key: string; orb: string; promoted: boolean; why: string | null; dir: string; version: number };

/** Where a version of a candidate's habit is kept: <data>/habits/steps/<orb>/<the key's hash>/v<n>
 * (each its own, so taking one back leaves the one before it as it was). */
export const habitDir = (dataDir: string, c: Pick<Candidate, "orb" | "key">, version: number): string =>
  join(dataDir, "habits", "steps", c.orb, createHash("sha256").update(c.key).digest("hex").slice(0, 16), `v${version}`);

/** How many approved runs the brief shows (the newest; every one is replayed), and how much of a
 * tool's result it quotes. */
export const BRIEF_RUNS = 12;
export const BRIEF_RESULT = 2000;

/** The teacher's brief: the protocol, then the approved runs as they happened. */
export function brief(c: Candidate, cases: Case[]): string {
  const shown = cases.slice(-BRIEF_RUNS).map((k) => ({
    input: k.input, output: k.output,
    steps: k.steps.map((x) => ({ ...x, result: x.result.length > BRIEF_RESULT ? `${x.result.slice(0, BRIEF_RESULT)}…(cut here for the brief; the run had it all)` : x.result })),
  }));
  return [
    `You are writing a habit for an assistant called ${c.orb}: Python code that does, by itself, a task it has done ${cases.length} times and the person approved every time${cases.length > shown.length ? ` (the newest ${shown.length} are below)` : ""}.`,
    `The task starts from ${c.trigger} and was done as: ${c.shape}.`,
    "",
    "Write a module with exactly two functions:",
    "  guard(inp) -> None, or a short reason (a string) when this input is not one you can handle exactly as the approved runs did.",
    "  step(inp, done) -> the next step: {\"call\": {\"name\": TOOL, \"args\": {...}}} to call a tool, or {\"output\": TEXT} to give the final answer.",
    "`inp` is {\"text\": ..., \"data\": {...}}. `done` is the list of calls made so far, each {\"call\": {...}, \"result\": \"...\", \"isError\": bool}, in order.",
    "Your code will be replayed against every approved run: it must make the same calls, with the same arguments, in the same order, and give the same final answer, character for character. Anything you cannot reproduce from the input and the results, refuse in guard.",
    "Plain Python 3 only: no imports beyond the standard library, no network, no files.",
    "",
    "The approved runs, as JSON:",
    ...shown.map((k, i) => `Run ${i + 1}: ${JSON.stringify(k)}`),
    "",
    "Reply with the module only, in one ```python block.",
  ].join("\n");
}

/** The code in the teacher's reply: its python block (or the whole reply, if it gave no fence). */
export function codeOf(reply: string): string {
  const m = /```(?:python|py)?\s*\n([\s\S]*?)```/.exec(reply);
  return (m ? m[1]! : reply).trim() + "\n";
}

export async function compile(o: {
  candidate: Candidate; cases: Case[]; teacher: (brief: string) => Promise<string>; kit: KitCall; dataDir: string; events: EventLog; version?: number;
  /** The home closing: the teacher's silence is not a rejection (it throws, and the runs wait). */
  signal?: AbortSignal;
}): Promise<Compiled> {
  const c = o.candidate;
  const version = o.version ?? 1;
  const dir = habitDir(o.dataDir, c, version);
  const done = (promoted: boolean, why: string | null): Compiled => {
    o.events.append(promoted ? "habit.promoted" : "habit.rejected", { kind: c.key, task: c.task, version, runs: o.cases.map((k) => k.run), ...(why && { why }) }, { orb: c.orb });
    return { key: c.key, orb: c.orb, promoted, why, dir, version };
  };
  if (!o.cases.length) return done(false, "no approved run could be replayed");
  let code: string;
  try {
    code = codeOf(await o.teacher(brief(c, o.cases)));
  } catch (e) {
    if (o.signal?.aborted) throw e;
    return done(false, `the teacher did not answer: ${e instanceof Error ? e.message : String(e)}`);
  }
  // tried in the sandbox, step by step, before anything is kept; the comparing is the harness's
  const step: StepFn = async (input, steps) => (await o.kit("habit_step", { habit_dir: dir, input, done: steps, code, check_input: false })) as Awaited<ReturnType<StepFn>>;
  for (const k of o.cases) {
    const r = await replay(step, k);
    if (!r.ok) return done(false, `run ${k.run}: ${r.why}`);
  }
  await o.kit("habit_learn_steps", { habit_dir: dir, code, inputs: o.cases.map((k) => k.input), version });
  return done(true, null);
}
