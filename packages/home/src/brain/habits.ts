// The habit shelf (PLAN 1.4): the first rung. A habit is either TypeScript the home ships (trusted,
// hand-written: a built-in) or Python the gym compiled (PLAN 3.2), which only ever runs inside the
// kit's sandbox, behind its three code checks (kit/orbs_kit/habits.py). Either way the answer is
// the same shape: answered with an output, or not, with the reason.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Kit } from "../kit.ts";

export type HabitAnswer = { answered: true; output: unknown; version: number } | { answered: false; why: string };

export interface Habit {
  readonly kind: string;
  answer(input: unknown): Promise<HabitAnswer>;
}

/** A hand-written habit the home ships. Its guard is still asked first, every time. */
export class TsHabit implements Habit {
  readonly kind: string;
  readonly #guard: (input: unknown) => string | null;
  readonly #run: (input: unknown) => unknown;
  readonly #version: number;

  constructor(
    kind: string,
    fns: { guard: (input: unknown) => string | null; run: (input: unknown) => unknown },
    version = 1,
  ) {
    this.kind = kind;
    this.#guard = fns.guard;
    this.#run = fns.run;
    this.#version = version;
  }

  async answer(input: unknown): Promise<HabitAnswer> {
    let why: string | null;
    try {
      why = this.#guard(input);
    } catch (e) {
      return { answered: false, why: `its guard raised ${e instanceof Error ? e.message : String(e)}` };
    }
    if (why !== null) return { answered: false, why: `its guard said no: ${why}` };
    try {
      return { answered: true, output: await this.#run(input), version: this.#version };
    } catch (e) {
      return { answered: false, why: `it raised ${e instanceof Error ? e.message : String(e)}` };
    }
  }
}

/** A compiled habit, answered by the kit in its sandbox. */
export class KitHabit implements Habit {
  readonly kind: string;
  readonly #kit: Kit;
  readonly #dir: string;

  constructor(kind: string, kit: Kit, dir: string) {
    this.kind = kind;
    this.#kit = kit;
    this.#dir = dir;
  }

  async answer(input: unknown): Promise<HabitAnswer> {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return { answered: false, why: "a compiled habit takes a JSON object as its input" };
    }
    try {
      const r = (await this.#kit.call("habit_answer", { habit_dir: this.#dir, input })) as {
        answered?: boolean;
        output?: unknown;
        why?: string;
        version?: number;
      };
      return r.answered === true
        ? { answered: true, output: r.output, version: r.version ?? 1 }
        : { answered: false, why: r.why ?? "the kit gave no reason" };
    } catch (e) {
      return { answered: false, why: `the kit could not run it: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
}

/** Where the ladder looks for a task kind's habit: shipped ones first, then `<data>/habits/<kind>/`. */
export class HabitShelf {
  readonly #dir: string;
  readonly #kit: Kit | null;
  readonly #shipped = new Map<string, Habit>();

  constructor(dataDir: string, kit: Kit | null) {
    this.#dir = join(dataDir, "habits");
    this.#kit = kit;
  }

  get dir(): string {
    return this.#dir;
  }

  ship(habit: Habit): void {
    this.#shipped.set(habit.kind, habit);
  }

  get(kind: string): Habit | null {
    const shipped = this.#shipped.get(kind);
    if (shipped) return shipped;
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(kind)) return null;
    const dir = join(this.#dir, kind);
    if (this.#kit && existsSync(join(dir, "habit.json"))) return new KitHabit(kind, this.#kit, dir);
    return null;
  }
}
