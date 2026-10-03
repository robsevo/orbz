// Lessons on an orb's own canvas (PLAN 4.4): "teach me X". Ash's carried lesson.py plans it once
// (through the kit: his scripted union-find lesson, or steps drawn for the canvas by the home's own
// brain); then code runs it, a step at a time, on the canvas in the app's Computer tab. Every step
// is the canvas's caption and its drawing; the person answers its question, or asks him to tell; the
// judge is told what is ON the canvas as well as the step, and a judge that could not judge never
// praises (the hint is said instead).
//
// What a lesson notes about you is only what Ash's learner_model allows (a concept mastered, a
// misconception), never a judgement of you. All of it is in the event log (lesson.*), so a lesson
// survives a restart and the app reads it back.
import type { ToolDef } from "./agent/tools.ts";
import type { EventLog } from "./events.ts";

export type Step = { text: string; do: unknown[][]; question: string; hint: string };
export type Lesson = { id: number; orb: string; topic: string; title: string; kind: string; steps: Step[]; at: number; ended: string | null };
export type Judged = { correct: boolean | null; say: string };

export class LessonError extends Error {}

export class Lessons {
  readonly #events: EventLog;
  readonly #kit: () => ((tool: string, args: Record<string, unknown>, o?: { timeoutMs?: number }) => Promise<unknown>) | null;

  constructor(events: EventLog, kit: () => ((tool: string, args: Record<string, unknown>, o?: { timeoutMs?: number }) => Promise<unknown>) | null) {
    this.#events = events;
    this.#kit = kit;
  }

  #call(tool: string, args: Record<string, unknown>, timeoutMs = 150_000): Promise<unknown> {
    const kit = this.#kit();
    if (!kit) throw new LessonError("a lesson is planned in the kit, and the kit is not running");
    return kit(tool, args, { timeoutMs });
  }

  /** The lesson an orb is giving now, and the step it is on (1-based; 0 before the first). */
  current(orb: string): { lesson: Lesson; step: number } | null {
    const started = this.#events.ofType("lesson.started").findLast((e) => e.orb === orb);
    if (!started) return null;
    const id = started.seq;
    if (this.#events.ofType("lesson.ended", id).some((e) => Number(e.data.id) === id)) return null;
    const step = this.#events.ofType("lesson.step", id).filter((e) => Number(e.data.id) === id).at(-1);
    const d = started.data as { topic: string; title: string; kind: string; steps: Step[] };
    return { lesson: { id, orb, topic: d.topic, title: d.title, kind: d.kind, steps: d.steps, at: started.at, ended: null }, step: step ? Number(step.data.n) : 1 };
  }

  /** Plans a lesson and begins it at its first step; one with nothing to draw says why. */
  async start(orb: string, topic: string): Promise<{ lesson: Lesson } | { why: string; kind: string }> {
    const p = (await this.#call("lesson_plan", { topic })) as { kind: string; title: string; steps: Step[]; why: string };
    if (!p.steps.length) return { why: p.why, kind: p.kind };
    const was = this.current(orb);
    if (was) this.end(orb, "a new lesson began");
    this.#events.append("lesson.started", { topic, title: p.title, kind: p.kind, steps: p.steps }, { orb });
    return { lesson: this.current(orb)!.lesson };
  }

  /** The next step (the last one ends the lesson). */
  next(orb: string): { step: number; done: boolean } {
    const c = this.current(orb);
    if (!c) throw new LessonError("no lesson is going");
    if (c.step >= c.lesson.steps.length) {
      this.end(orb, "finished");
      return { step: c.step, done: true };
    }
    this.#events.append("lesson.step", { id: c.lesson.id, n: c.step + 1 }, { orb });
    return { step: c.step + 1, done: false };
  }

  end(orb: string, why: string): void {
    const c = this.current(orb);
    if (c) this.#events.append("lesson.ended", { id: c.lesson.id, why }, { orb });
  }

  /** An answer to this step's question, judged with what the canvas shows (`facts`, from the page). */
  async answer(orb: string, answer: string, facts: Record<string, unknown>): Promise<Judged> {
    const c = this.current(orb);
    if (!c) throw new LessonError("no lesson is going");
    const step = c.lesson.steps[c.step - 1]!;
    const j = (await this.#call("lesson_judge", { topic: c.lesson.topic, step, answer: answer.slice(0, 2000), facts })) as Judged;
    this.#events.append("lesson.answered", { id: c.lesson.id, n: c.step, correct: j.correct }, { orb });
    // what the lesson may note about you, and only that (Ash's learner_model: an allowlisted kind,
    // never a judgement of you); an answer the judge could not judge notes nothing
    if (j.correct !== null) {
      const kind = j.correct ? "mastery" : "misconception";
      const text = `${c.lesson.title}: ${step.question || step.text}`.slice(0, 300);
      const ok = (await this.#call("lesson_observe", { kind, text }, 10_000)) as { ok: boolean; reason: string };
      if (ok.ok) this.#events.append("lesson.noted", { id: c.lesson.id, n: c.step, kind, text }, { orb });
    }
    return { correct: j.correct, say: j.say };
  }

  /** "Tell me": a scripted step's own answer, read off the canvas (no model). */
  async explain(orb: string, facts: Record<string, unknown>): Promise<string> {
    const c = this.current(orb);
    if (!c) throw new LessonError("no lesson is going");
    if (c.lesson.kind !== "scripted") return c.lesson.steps[c.step - 1]?.hint || "Look at what moved on the canvas.";
    return String(await this.#call("lesson_explain", { index: c.step - 1, facts }, 30_000));
  }
}

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

/** The orb's tool: "teach me X" becomes a lesson on his computer's canvas. */
export function lessonTools(l: Lessons): ToolDef[] {
  return [
    {
      name: "teach",
      label: "Planning a lesson",
      description:
        "Teach the person something on your computer's canvas (\"teach me X\"): the lesson is planned once and drawn in steps, " +
        "each with a question; the person goes through it on the Lesson tab of your computer. It draws data structures and " +
        "processes (union-find is a scripted lesson); a web page or a file is better explained in words, or opened in your browser.",
      parameters: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"], additionalProperties: false },
      describe: (a) => `teach ${str(a.topic)}`,
      decision: "allow",
      async run(a, ctx) {
        const r = await l.start(ctx.orb, str(a.topic).slice(0, 300));
        if ("why" in r) return { content: `Nothing to draw for that here (${r.kind}: ${r.why}). Explain it in words, or open a page about it in your browser.`, isError: true };
        ctx.note?.(`A lesson on ${r.lesson.title}, ${r.lesson.steps.length} steps: it is on the Lesson tab of the computer.`, { lesson: r.lesson.id });
        return { content: `The lesson "${r.lesson.title}" is open on your computer's Lesson tab, ${r.lesson.steps.length} steps. Tell the person it is there: they answer each step's question, or ask you to tell them, and Next moves on.` };
      },
    },
  ];
}
