// The night (PLAN 3.2, 3.3): once a night, from NIGHT_HOUR, the gym looks back over the last
// WINDOW_DAYS for candidates (finder.ts) and has the teacher write a habit for each (compile.ts).
// Only what a schedule or a trigger asks is a habit's (a chat or a session's turn is the brain's).
// A candidate whose approved runs a habit was already proved on, or already failed on, is left
// alone: nothing new to learn from. One with new approved runs (an ordinary run, or one a habit
// handed to the brain and you approved, 3.3) is compiled again, as the next version, on all of them;
// if that fails the version before it still stands, and it still hands those cases on.
// An orb you let go still learns (owner, 10-02: "just not active in company. it can get better,
// like an employee can"): the night looks back over HIS last WINDOW_DAYS of work, not the
// calendar's, which would empty a fortnight after he left. His promotion waits till he is back.
import type { Clock } from "../clock.ts";
import type { EventLog } from "../events.ts";
import { chat, type Endpoint } from "../brain/openai.ts";
import type { Spend } from "../brain/spend.ts";
import type { Streamed } from "../agent/stream.ts";
import { TOOLS, toolSpecs, type ToolDef } from "../agent/tools.ts";
import { type Case, casesOf } from "./cases.ts";
import { clears, gate, K, type Sitting, sit, type Verdict } from "./exam.ts";
import { brainStep, EXAMPLES, type Playbook, playbookOf } from "./playbook.ts";
import { AREAS_OF, nextFor } from "./levels.ts";
import { AREAS, tagRun } from "./specialty.ts";
import { cardDue, weekOf } from "./performance.ts";
import { promoteTemplates } from "./templates.ts";
import type { Plan } from "../plans/plans.ts";
import type { Specialty } from "../brain/constitution.ts";
import { compile, type Compiled, type KitCall } from "./compile.ts";
import { findHotPaths, type Candidate } from "./finder.ts";

export const NIGHT_HOUR = 3;
export const WINDOW_DAYS = 14;

const DAY_MS = 86_400_000;

/** The night that `at` falls in: from NIGHT_HOUR, local time, to the next. */
function nightOf(at: number): number {
  const d = new Date(at);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), NIGHT_HOUR).getTime();
  return at >= start ? start : new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, NIGHT_HOUR).getTime();
}

/** Who is away, let go and not rehired, and since when. */
function awayOf(events: EventLog): Map<string, number> {
  const away = new Map<string, number>();
  for (const e of [...events.ofType("orb.let_go"), ...events.ofType("orb.rehired")].sort((a, b) => a.seq - b.seq)) {
    if (!e.orb) continue;
    if (e.type === "orb.let_go") away.set(e.orb, e.at);
    else away.delete(e.orb);
  }
  return away;
}

export type Sat = { kind: string; verdict: Verdict["verdict"]; earned: boolean };
export type NightResult = { night: number; compiled: Compiled[]; sat: Sat[]; proposed: string[]; templates: string[]; left: number; stopped: string | null };

export type GymOptions = {
  events: EventLog; clock: Clock; dataDir: string; spend?: Spend;
  /** The kit, whose sandbox habits are tried in; with none, no habit is written (the rest still is). */
  kit: KitCall | null;
  /** Who writes habits: the preset's teacher, else the big brain. */
  teacher: () => Endpoint | null;
  /** The own brain that sits the exam for a task type (PLAN 3.4), if the preset has one. */
  own?: () => Endpoint | null;
  /** The tools its exam may call (as the loop's), and how many times a case is sat (tests). */
  tools?: ToolDef[];
  k?: number;
  /** The office, for the promotions the night proposes (PLAN 3.8). */
  orbs?: () => { id: string; specialty: Specialty }[];
  /** Every orb ever hired, away ones too (they still learn), with when he joined this time: for the
   * gap each night practises first (PLAN 5.4) and the weekly card (PLAN 5.5, office orbs only). */
  everyone?: () => { id: string; specialty: Specialty; hired: number; away: boolean }[];
  /** Every plan shown, for the templates its approved ones make (PLAN 3.2). */
  plans?: () => Plan[];
};

export class Gym {
  readonly #o: GymOptions;
  #running: Promise<NightResult> | null = null;
  readonly #closing = new AbortController();

  constructor(o: GymOptions) {
    this.#o = o;
  }

  /** When the next night is due: the start of the night after the last one the gym ran. */
  nextAt(): number {
    const last = this.#o.events.ofType("gym.night").at(-1);
    if (last) return Number(last.data.night) + DAY_MS; // nights slept through are run once, on waking
    // a new home waits for the first night after it began (its first event)
    const began = this.#o.events.since(0, 1)[0]?.at ?? this.#o.clock.now();
    return nightOf(began) + DAY_MS;
  }

  /** The tick's: tonight's work, if it is due and not already going. */
  due(): Promise<NightResult> | null {
    if (this.#running || this.#o.clock.now() < this.nextAt()) return null;
    this.#running = this.night()
      .catch((e: unknown): NightResult => {
        const why = e instanceof Error ? e.message : String(e);
        try {
          this.#o.events.append("gym.night_failed", { error: why });
        } catch {
          // the log is closed: the home went away mid-night
        }
        return { night: 0, compiled: [], sat: [], proposed: [], templates: [], left: 0, stopped: why };
      })
      .finally(() => (this.#running = null));
    return this.#running;
  }

  /** The home is closing: a teacher's answer is not waited for, and no candidate after it begins. */
  async close(): Promise<void> {
    this.#closing.abort();
    await this.#running?.catch(() => {});
  }

  /** Tonight's work, now. */
  async night(): Promise<NightResult> {
    const { events, clock } = this.#o;
    const night = nightOf(clock.now());
    events.append("gym.night", { night });
    const compiled: Compiled[] = [];
    const sat: Sat[] = [];
    let left = 0;
    let stopped: string | null = null;
    let noTeacher = false;
    const away = awayOf(events);
    const found = findHotPaths(events, { since: clock.now() - WINDOW_DAYS * DAY_MS }).filter((c) => !away.has(c.orb));
    for (const [orb, left] of away) found.push(...findHotPaths(events, { since: left - WINDOW_DAYS * DAY_MS }).filter((c) => c.orb === orb));
    // each orb's promotion gap first (PLAN 5.4): when a task learned in his specialty is what stands
    // between him and his next level, his work in its areas is tried before anything else
    const people = new Map((this.#o.everyone?.() ?? []).map((p) => [p.id, p]));
    const gapFirst = (c: Candidate): number => {
      const p = people.get(c.orb);
      if (!p || !nextFor(events, c.orb, { specialty: p.specialty, now: clock.now() })?.missing.some((m) => /task/.test(m))) return 1;
      const area = c.runs[0] === undefined ? null : tagRun(events, c.runs[0]).area;
      return area && (AREAS_OF[p.specialty] ?? [...AREAS]).includes(area) ? 0 : 1;
    };
    found.sort((a, b) => gapFirst(a) - gapFirst(b)); // stable: the most approved first, within each
    for (const c of found) {
      if (!c.trigger.startsWith("schedule:") && !c.trigger.startsWith("trigger:")) continue;
      const cases = casesOf(events, c.runs);
      const version = this.#o.kit ? this.#nextVersion(c) : null;
      const teacher = version === null ? null : this.#o.teacher();
      if (version !== null && !teacher) noTeacher = true;
      const exam = this.#examDue(c, cases);
      if ((version === null || !teacher) && !exam) {
        left++;
        continue;
      }
      if (this.#closing.signal.aborted) stopped ??= "the home was closing";
      if (stopped) {
        left++;
        continue;
      }
      try {
        this.#o.spend?.check(); // over the cap: the rest wait for another night
      } catch (e) {
        stopped = e instanceof Error ? e.message : String(e);
        left++;
        continue;
      }
      try {
        if (version !== null && teacher && this.#o.kit) {
          compiled.push(await compile({
            candidate: c, cases, version, kit: this.#o.kit, dataDir: this.#o.dataDir, events, signal: this.#closing.signal,
            teacher: async (brief) => {
              const r = await chat(teacher, [{ role: "user", content: brief }], { maxTokens: 4000, signal: this.#closing.signal });
              this.#o.spend?.record({ tier: "teacher", model: teacher.model, costUsd: r.costUsd, costSource: r.costSource, promptTokens: r.promptTokens, completionTokens: r.completionTokens, orb: c.orb });
              return r.text;
            },
          }));
        }
        if (exam) sat.push(await this.#sit(c, cases, exam));
      } catch (e) {
        // the home closing, or the kit down mid-tryout: nothing was kept or rejected, so these runs wait for another night
        stopped = this.#closing.signal.aborted ? "the home was closing" : `the kit stopped: ${e instanceof Error ? e.message : String(e)}`;
        left++;
      }
    }
    stopped ??= noTeacher ? "no teacher brain is set up" : null;
    const proposed = this.#propose();
    // the weekly performance card (PLAN 5.5): a suggestion and its evidence, for you; it never acts
    for (const p of this.#o.everyone?.() ?? []) {
      if (p.away || !cardDue(events, p.id, { hired: p.hired, now: clock.now() })) continue;
      events.append("performance.card", weekOf(events, p.id, { specialty: p.specialty, hired: p.hired, now: clock.now() }), { orb: p.id });
    }
    const templates = (this.#o.orbs?.() ?? []).flatMap((o) => promoteTemplates(events, this.#o.plans?.() ?? [], o.id)).map((x) => `${x.orb}: ${x.title}`);
    events.append("gym.night_done", {
      night, promoted: compiled.filter((x) => x.promoted).map((x) => x.key), rejected: compiled.filter((x) => !x.promoted).map((x) => x.key),
      earned: sat.filter((x) => x.earned).map((x) => x.kind), refused: sat.filter((x) => x.verdict === "regressed").map((x) => x.kind), proposed, templates, left, ...(stopped && { stopped }),
    });
    return { night, compiled, sat, proposed, templates, left, stopped };
  }

  /** Each orb the evidence now makes ready for its next level, proposed to you once (until you say
   * yes or no). Nothing here promotes: only you do (`Home.promote`). */
  #propose(): string[] {
    const { events, clock } = this.#o;
    const out: string[] = [];
    for (const o of this.#o.orbs?.() ?? []) {
      const p = nextFor(events, o.id, { specialty: o.specialty, now: clock.now() });
      if (!p?.ready) continue;
      const settled = Math.max(0, ...[...events.ofType("orb.promoted"), ...events.ofType("promotion.declined")].filter((e) => e.orb === o.id).map((e) => e.seq));
      if (events.ofType("promotion.proposed", settled).some((e) => e.orb === o.id && e.data.to === p.to)) continue;
      events.append("promotion.proposed", { from: p.from, to: p.to, evidence: p.evidence }, { orb: o.id });
      out.push(o.id);
    }
    return out;
  }

  /** The own brain's exam for a candidate, when there is an own brain and something new to sit:
   * a playbook not sat yet on these runs (new runs make a new playbook, or a new case). */
  #examDue(c: Candidate, cases: Case[]): { ep: Endpoint; pb: Playbook; base: Sitting | null } | null {
    const ep = this.#o.own?.() ?? null;
    if (!ep || cases.length <= EXAMPLES) return null; // its examples are not its exam: it needs more runs than it is shown
    const pb = playbookOf(c, cases);
    const runs = cases.map((k) => k.run);
    const all = this.#o.events.ofType("exam.sat").filter((e) => e.orb === c.orb && e.data.kind === c.key && e.data.brain === ep.model);
    // sat already on every run, or the new ones are only what it (or a habit) answered: no news
    const answered = this.#answered(c.orb);
    const sat = new Set(all.flatMap((e) => (e.data.runs as number[] | undefined) ?? []));
    if (all.length && runs.every((r) => sat.has(r) || answered.has(r))) return null;
    const last = all.findLast((e) => e.data.accepted === true);
    return { ep, pb, base: last ? (last.data.sitting as Sitting) : null };
  }

  /** Sits it, judges it against the baseline, and keeps the verdict. A sitting that passes the gate
   * (or cannot be compared because the model changed) is the new baseline; one that regressed is
   * refused, and the playbook before it stands. */
  async #sit(c: Candidate, cases: Case[], x: { ep: Endpoint; pb: Playbook; base: Sitting | null }): Promise<Sat> {
    const spent = (r: Pick<Streamed, "costUsd" | "costSource" | "promptTokens" | "completionTokens">) =>
      this.#o.spend?.record({ tier: "own", model: x.ep.model, costUsd: r.costUsd, costSource: r.costSource, promptTokens: r.promptTokens, completionTokens: r.completionTokens, orb: c.orb });
    // the runs its playbook shows as worked examples are not its exam: it is sat on the others
    const s = await sit({
      kind: c.key, brain: x.ep.model, version: x.pb.version, cases: cases.slice(0, -EXAMPLES), k: this.#o.k ?? K,
      step: brainStep(x.ep, x.pb, toolSpecs(this.#o.tools ?? TOOLS), { signal: this.#closing.signal, spent }),
      until: () => this.#closing.signal.aborted,
    });
    if (s.missing.length) throw new Error("the exam was cut short"); // never a baseline, never a verdict
    const v = gate(x.base, s);
    const accepted = v.verdict === "pass" || v.verdict === "incomparable";
    const earned = accepted && clears(s);
    this.#o.events.append("exam.sat", {
      kind: c.key, task: c.task, brain: x.ep.model, version: x.pb.version, runs: cases.map((k) => k.run),
      sitting: s, verdict: v.verdict, why: v.why, accepted, earned, ...(accepted && { system: x.pb.system }),
    }, { orb: c.orb });
    if (v.verdict === "regressed") this.#o.events.append("playbook.refused", { kind: c.key, version: x.pb.version, why: v.why }, { orb: c.orb });
    return { kind: c.key, verdict: v.verdict, earned };
  }

  /** The version to compile next for a candidate, or null when every approved run of it was
   * already tried (by a promotion or a rejection), or answered by its own habit or own brain:
   * nothing new to learn from (a habit that works is not written again every night). */
  #nextVersion(c: Candidate): number | null {
    const answered = this.#answered(c.orb);
    let version = 0;
    for (const type of ["habit.promoted", "habit.rejected"]) {
      for (const e of this.#o.events.ofType(type)) {
        if (e.orb !== c.orb || e.data.kind !== c.key) continue;
        version = Math.max(version, Number(e.data.version));
        const tried = new Set((e.data.runs as number[] | undefined) ?? []);
        if (c.runs.every((r) => tried.has(r) || answered.has(r))) return null;
      }
    }
    return version + 1;
  }

  /** The runs a habit or its own brain answered: what they already do is no news to them. */
  #answered(orb: string): Set<number> {
    return new Set(this.#o.events.ofType("ladder.answered").filter((e) => e.orb === orb && (e.data.tier === "habit" || e.data.tier === "own")).map((e) => Number(e.data.run)));
  }
}
