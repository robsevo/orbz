// School (PLAN 5.7; owner, 10-03: "school happens when we fire, we can actually send them back to
// school", and "it should be put into consideration, whos more qualified for the job").
//
// An orb you let go can be sent to school for the subjects you pick, with a pass mark. When the term
// starts the teacher writes each subject's syllabus (you can change it), the exam is made (by code
// for maths, C++, speech and talking with you; by the teacher for AI and your own subjects, kept
// from every lesson), and the starting exam is sat. Then each night, within the spend cap, a class
// for each subject: a lesson on the next topic (written without the exam in sight), practice
// (checked by code where it can be), and a note for the notebook, which is kept only when the exam,
// sat again with it, scores higher than without it. The mark you set, reached twice in a row, is a
// diploma. A diploma never promotes and earns no XP: it counts when the office asks who is more
// qualified for the job (org.ts `whoFits`, the org chart's Away list, the recruiter). Rehiring ends
// the term; the report card, the notebook and the diplomas stay, and the notebook goes to work with
// the orb (agent/standing.ts). Until there is a local model the orb's brain at school is the shared
// one: what it learns is its notebook, and the exam says whether it learned.
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "../clock.ts";
import { tx } from "../db.ts";
import type { EventLog } from "../events.ts";
import { SpendCapError } from "../brain/spend.ts";
import type { KitCall } from "../gym/compile.ts";
import { nightOf } from "../gym/night.ts";
import { answers, programOf, same, teacherExam, topics, verdicts } from "./grade.ts";
import { CPP, examOf, type Kind, KINDS, mathsPractice, nameOf, type Question, SPEECH, split, TALKING } from "./subjects.ts";

/** The pass marks you can set, and how many subjects a term may have. */
export const PASS_MARKS = [0.6, 0.7, 0.8, 0.9] as const;
export const MOST_SUBJECTS = 6;
/** Questions in a teacher's exam (AI, your own subjects). */
export const TEACHER_QUESTIONS = 5;
/** The brain asks school may make in a night, every orb together: your plan's use is the office's
 * work first (with ChatGPT's plan a class costs no money, so the spend cap alone would not hold it). */
export const ASKS_A_NIGHT = 60;
const DAY_MS = 86_400_000;

export type Message = { role: "system" | "user" | "assistant"; content: string };
/** A brain's answer: the teacher's (the preset's teacher, else the big brain), or the orb's own (the
 * shared big brain, until a local model). The home records its cost and refuses at the spend cap. */
export type Ask = (who: "teacher" | "orb", orb: string, messages: Message[], maxTokens: number) => Promise<string>;

export type Answer = { n: number; ask: string; answer: string; ok: boolean | null; why?: string; up?: boolean | null };
export type Sitting = { id: number; at: number; score: number | null; state: "graded" | "waiting" | "void"; kept: boolean | null; starting: boolean };
export type SubjectCard = {
  id: number; kind: Kind; name: string; how: string;
  syllabus: string[] | null; lessons: number; notes: { text: string; at: number }[];
  started: number | null; now: number | null; sittings: Sitting[];
  graduatedAt: number | null;
  /** Talking with you: the answers waiting for your thumbs. */
  rate: { sitting: number; answers: Answer[] } | null;
  /** Why its classes are not going on, if they are not. */
  trouble: string | null;
};
export type ReportCard = { orb: string; atSchool: boolean; passMark: number | null; since: number | null; subjects: SubjectCard[]; diplomas: Diploma[] };
export type Diploma = { kind: Kind; name: string; at: number; score: number };
export type NightSchool = { night: number; classes: number; left: number; stopped: string | null };

type SubjectRow = { id: number; term: number; kind: Kind; name: string; syllabus: string | null; exam: string | null; kept_score: number | null; graduated_at: number | null; trouble: string | null; seed: number };
type SittingRow = { id: number; subject: number; at: number; score: number | null; state: Sitting["state"]; answers: string; candidate: string | null; kept: number | null; starting: number };

export class SchoolError extends Error {}

export type SchoolOptions = {
  ask: Ask;
  /** The kit, which grades speech and runs C++ in its sandbox; with none, those subjects wait. */
  kit: KitCall | null;
  /** An orb's name and kind of work, for the teacher's prompts. */
  who: (orb: string) => { name: string; work: string } | null;
  /** Tonight's share of the brain (ASKS_A_NIGHT); tests set fewer. */
  asksANight?: number;
};

/** A subject's dice: its exam (and practice) come from it, the same for the same term and subject. */
export function seedOf(orb: string, term: number, kind: Kind, name: string): number {
  return Number.parseInt(createHash("sha256").update(`${orb}|${term}|${kind}|${name}`).digest("hex").slice(0, 8), 16);
}

export class School {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #clock: Clock;
  readonly #o: SchoolOptions;
  readonly #busy = new Set<number>(); // a subject in a class now: a term's start and a night never share one
  readonly #starting = new Map<string, Promise<void>>(); // a term's start, once at a time per orb
  readonly #closing = new AbortController();
  #night: Promise<NightSchool> | null = null;
  #asked = 0; // asks made tonight

  constructor(db: DatabaseSync, events: EventLog, clock: Clock, o: SchoolOptions) {
    this.#db = db;
    this.#events = events;
    this.#clock = clock;
    this.#o = o;
  }

  // ── the term ────────────────────────────────────────────────────────────────────────────────

  /** The open term an orb is in, if any. */
  term(orb: string): { id: number; passMark: number; startedAt: number } | null {
    const r = this.#db.prepare("SELECT id, pass_mark, started_at FROM school_terms WHERE orb = ? AND ended_at IS NULL").get(orb) as { id: number; pass_mark: number; started_at: number } | undefined;
    return r ? { id: r.id, passMark: r.pass_mark, startedAt: r.started_at } : null;
  }

  /** Sends an orb to school (the home has checked it was let go): the subjects you picked, the mark
   * that makes a diploma. The syllabus, the exam and the starting exam follow (`start`). */
  enrol(orb: string, subjects: { kind: Kind; name?: string }[], passMark: number): void {
    if (this.term(orb)) throw new SchoolError("already at school: rehire to end the term first, or wait for it");
    if (!PASS_MARKS.includes(passMark as (typeof PASS_MARKS)[number])) throw new SchoolError(`a pass mark is one of ${PASS_MARKS.map((m) => `${m * 100}%`).join(", ")}`);
    if (!subjects.length || subjects.length > MOST_SUBJECTS) throw new SchoolError(`pick 1 to ${MOST_SUBJECTS} subjects`);
    const named = subjects.map((s) => {
      if (!(s.kind in KINDS) && s.kind !== "custom") throw new SchoolError(`"${String(s.kind)}" is not a subject`);
      const name = nameOf(s.kind, s.name);
      if (s.kind === "custom" && (name.length < 2 || name.length > 40)) throw new SchoolError("your own subject needs a name of 2 to 40 letters");
      return { kind: s.kind, name };
    });
    if (new Set(named.map((s) => s.name.toLowerCase())).size !== named.length) throw new SchoolError("a subject is picked twice");
    const now = this.#clock.now();
    tx(this.#db, () => {
      const term = (this.#db.prepare("INSERT INTO school_terms (orb, started_at, pass_mark) VALUES (?, ?, ?) RETURNING id").get(orb, now, passMark) as { id: number }).id;
      for (const s of named) {
        const seed = seedOf(orb, term, s.kind, s.name);
        const exam = examOf(s.kind, seed);
        this.#db.prepare("INSERT INTO school_subjects (term, kind, name, seed, exam) VALUES (?, ?, ?, ?, ?)").run(term, s.kind, s.name, seed, exam && JSON.stringify(exam));
      }
      this.#events.append("school.enrolled", { term, subjects: named.map((s) => s.name), passMark }, { orb });
    });
  }

  /** The term starts: each subject's syllabus, exam and starting exam, now, not at night. Asked
   * again while it goes, the same start. */
  start(orb: string): Promise<void> {
    const t = this.term(orb);
    if (!t) return Promise.resolve();
    const going = this.#starting.get(orb);
    if (going) return going;
    const run = (async () => {
      for (const s of this.#subjects(t.id)) {
        if (this.#closing.signal.aborted) return;
        await this.#guarded(s.id, () => this.#prepare(orb, s.id)).catch(() => {}); // its trouble is on its card
      }
    })().finally(() => this.#starting.delete(orb));
    this.#starting.set(orb, run);
    return run;
  }

  /** Rehired (or the term over): no more classes; the report card, notebook and diplomas stay. */
  end(orb: string, why: string): void {
    const t = this.term(orb);
    if (!t) return;
    tx(this.#db, () => {
      this.#db.prepare("UPDATE school_terms SET ended_at = ? WHERE id = ?").run(this.#clock.now(), t.id);
      // answers still waiting for thumbs are no evidence now: the term they were sat in is over
      this.#db.prepare("UPDATE school_sittings SET state = 'void' WHERE state = 'waiting' AND subject IN (SELECT id FROM school_subjects WHERE term = ?)").run(t.id);
      this.#events.append("school.ended", { term: t.id, why }, { orb });
    });
  }

  /** You changed a syllabus: the next lessons follow it. */
  setSyllabus(subject: number, list: string[]): void {
    const s = this.#subject(subject);
    if (!this.#open(s.term)) throw new SchoolError("that term is over");
    const clean = list.map((x) => String(x).trim()).filter(Boolean);
    if (!clean.length || clean.length > 12 || clean.some((x) => x.length > 120)) throw new SchoolError("a syllabus is 1 to 12 topics, each a short line");
    this.#db.prepare("UPDATE school_subjects SET syllabus = ? WHERE id = ?").run(JSON.stringify(clean), subject);
    this.#events.append("school.syllabus", { subject, topics: clean.length }, { orb: this.#orbOf(s.term) });
  }

  /** Your thumb on an answer in Talking with you: once every answer has one, the sitting is graded
   * (the share of thumbs up), and the note it was sat with is kept only if that beat the last. */
  thumb(sitting: number, n: number, up: boolean): void {
    const row = this.#db.prepare("SELECT * FROM school_sittings WHERE id = ?").get(sitting) as SittingRow | undefined;
    if (!row || row.state !== "waiting") throw new SchoolError("no answers wait for a thumb there");
    const list = JSON.parse(row.answers) as Answer[];
    const a = list.find((x) => x.n === n);
    if (!a) throw new SchoolError(`there is no answer ${n}`);
    a.up = up;
    const done = list.every((x) => typeof x.up === "boolean");
    tx(this.#db, () => {
      this.#db.prepare("UPDATE school_sittings SET answers = ? WHERE id = ?").run(JSON.stringify(list), sitting);
      this.#events.append("school.rated", { subject: row.subject, sitting, n, up, done }, { orb: this.#orbOf(this.#subject(row.subject).term) });
      if (done) {
        const score = list.filter((x) => x.up).length / list.length;
        this.#db.prepare("UPDATE school_sittings SET state = 'graded', score = ? WHERE id = ?").run(score, sitting);
        this.#settle(this.#subject(row.subject), { ...row, score, state: "graded" });
      }
    });
  }

  // ── what the rest of the home reads ─────────────────────────────────────────────────────────

  /** Every diploma an orb holds, from any term. */
  diplomas(orb: string): Diploma[] {
    return (this.#db.prepare(`SELECT s.kind, s.name, s.graduated_at AS at, s.kept_score AS score FROM school_subjects s JOIN school_terms t ON t.id = s.term
      WHERE t.orb = ? AND s.graduated_at IS NOT NULL ORDER BY s.graduated_at`).all(orb) as Diploma[]).map((d) => ({ kind: d.kind, name: d.name, at: d.at, score: d.score }));
  }

  /** The notebook: every note an orb kept, newest first, each with its subject. */
  notebook(orb: string, most = 24): { subject: string; text: string }[] {
    return this.#db.prepare(`SELECT s.name AS subject, n.text FROM school_notes n JOIN school_subjects s ON s.id = n.subject JOIN school_terms t ON t.id = s.term
      WHERE t.orb = ? ORDER BY n.id DESC LIMIT ?`).all(orb, most) as { subject: string; text: string }[];
  }

  /** The report card: the term now (or the last), each subject's scores, notebook and syllabus. */
  report(orb: string): ReportCard {
    const t = (this.#db.prepare("SELECT id, pass_mark, started_at, ended_at FROM school_terms WHERE orb = ? ORDER BY id DESC LIMIT 1").get(orb) as { id: number; pass_mark: number; started_at: number; ended_at: number | null } | undefined) ?? null;
    const subjects = t ? this.#subjects(t.id).map((s) => this.#card(s)) : [];
    return { orb, atSchool: !!t && t.ended_at === null, passMark: t?.pass_mark ?? null, since: t?.started_at ?? null, subjects, diplomas: this.diplomas(orb) };
  }

  // ── the night ───────────────────────────────────────────────────────────────────────────────

  /** When the next night's classes are due: the night after the last one school ran. */
  nextAt(): number {
    const last = this.#events.ofType("school.night").at(-1);
    if (last) return Number(last.data.night) + DAY_MS;
    const began = this.#events.since(0, 1)[0]?.at ?? this.#clock.now();
    return nightOf(began) + DAY_MS;
  }

  /** The tick's: tonight's classes, if due and not already going. */
  due(): Promise<NightSchool> | null {
    if (this.#night || this.#clock.now() < this.nextAt()) return null;
    this.#night = this.night()
      .catch((e: unknown): NightSchool => ({ night: 0, classes: 0, left: 0, stopped: e instanceof Error ? e.message : String(e) }))
      .finally(() => (this.#night = null));
    return this.#night;
  }

  /** Tonight's classes, now: one for each subject of each orb at school, while the spend cap allows. */
  async night(): Promise<NightSchool> {
    const night = nightOf(this.#clock.now());
    this.#events.append("school.night", { night });
    let classes = 0;
    let left = 0;
    let stopped: string | null = null;
    this.#asked = 0;
    const share = this.#o.asksANight ?? ASKS_A_NIGHT;
    // each orb's first subject, then each one's second, and so on: no orb's term takes the night
    const terms = this.#db.prepare("SELECT id, orb FROM school_terms WHERE ended_at IS NULL ORDER BY id").all() as { id: number; orb: string }[];
    const lists = terms.map((t) => this.#subjects(t.id).filter((s) => s.graduated_at === null).map((s) => ({ t, s })));
    const queue = Array.from({ length: Math.max(0, ...lists.map((l) => l.length)) }, (_, i) => lists.flatMap((l) => (l[i] ? [l[i]] : []))).flat();
    for (const { t, s } of queue) {
      if (this.#closing.signal.aborted) stopped ??= "the home was closing";
      if (!stopped && this.#asked >= share) stopped = "tonight's share of the brain is used: the other classes are tomorrow night's";
      if (stopped || !this.#open(t.id)) {
        left++;
        continue;
      }
      try {
        if (await this.#guarded(s.id, () => this.#lesson(t.orb, s.id))) classes++;
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        if (e instanceof SpendCapError) stopped = why; // over the cap (every ask checks it): tonight's other classes wait
        left++;
      }
    }
    this.#events.append("school.night_done", { night, classes, left, ...(stopped && { stopped }) });
    return { night, classes, left, stopped };
  }

  /** The home is closing: no class after the one going on. */
  async close(): Promise<void> {
    this.#closing.abort();
    await Promise.allSettled([...this.#starting.values(), this.#night]);
  }

  // ── a class ─────────────────────────────────────────────────────────────────────────────────

  /** One ask of a brain, counted against tonight's share. */
  #ask(who: "teacher" | "orb", orb: string, messages: Message[], maxTokens: number): Promise<string> {
    this.#asked++;
    return this.#o.ask(who, orb, messages, maxTokens);
  }

  /** What a class needs first: the syllabus, the teacher's exam, and the starting exam. */
  async #prepare(orb: string, id: number): Promise<void> {
    let s = this.#subject(id);
    const who = this.#who(orb);
    if (s.syllabus === null) {
      const text = await this.#ask("teacher", orb, [{ role: "user", content:
        `You teach at the orbs' school. Write a syllabus in ${s.name} for ${who.name}, an orb (an AI character) whose work is ${who.work}. Six to eight topics, from the first steps to harder ones, each a line of a few words. Reply with the topics only, one a line.` }], 400);
      const list = topics(text);
      if (!list) return this.#trouble(s, "the teacher's syllabus could not be read; the next class tries again");
      this.#db.prepare("UPDATE school_subjects SET syllabus = ? WHERE id = ?").run(JSON.stringify(list), id);
    }
    if (s.exam === null) {
      const text = await this.#ask("teacher", orb, [{ role: "user", content:
        `You are writing the final exam in ${s.name} for an AI assistant who is learning it. Write ${TEACHER_QUESTIONS} questions, each answerable in a few sentences, and for each two to four key points a good answer must make. Reply in exactly this form and nothing else:\nQ: the question\nP: a key point\nP: a key point\n\nQ: the next question\n...` }], 1500);
      const exam = teacherExam(text, TEACHER_QUESTIONS);
      if (!exam) return this.#trouble(s, "the teacher's exam could not be read; the next class tries again");
      this.#db.prepare("UPDATE school_subjects SET exam = ? WHERE id = ?").run(JSON.stringify(exam.map((q, i) => ({ n: i + 1, ...q }))), id);
    }
    s = this.#subject(id);
    if (!this.#sittings(id).length) {
      const sat = await this.#sit(orb, s, null);
      this.#store(s, sat, null, true);
    }
    this.#trouble(s, null);
  }

  /** Tonight's class in a subject: a lesson, practice, a note, and the exam sat with the note.
   * Returns false when it waits (for your thumbs). */
  async #lesson(orb: string, id: number): Promise<boolean> {
    await this.#prepare(orb, id);
    const s = this.#subject(id);
    if (s.syllabus === null || s.exam === null) return false;
    const waiting = this.#sittings(id).find((x) => x.state === "waiting");
    if (waiting) {
      this.#trouble(s, "waiting for your thumbs on its answers");
      return false;
    }
    const who = this.#who(orb);
    const syllabus = JSON.parse(s.syllabus) as string[];
    const exam = JSON.parse(s.exam) as Question[];
    const done = (this.#db.prepare("SELECT count(*) AS n FROM school_lessons WHERE subject = ?").get(id) as { n: number }).n;
    const topic = syllabus[done % syllabus.length]!;
    const notes = this.#notes(id);
    const book = notes.length ? `\n\nTheir notebook so far:\n${notes.map((n) => `- ${n}`).join("\n")}` : "";
    const asksPractice = s.kind === "ai" || s.kind === "custom";
    // the lesson: written from the syllabus and the notebook, never the exam
    let lesson = await this.#ask("teacher", orb, [{ role: "user", content:
      `You are ${who.name}'s teacher in ${s.name} at the orbs' school; ${who.name} is an orb (an AI character) whose work is ${who.work}. Today's topic: ${topic}.${book}\n\nWrite today's lesson in plain words, at most 300 words: what to know, one worked example, and the mistakes to avoid.${asksPractice ? " End with two practice questions, each on its own line starting PRACTICE:." : ""}` }], 900);
    lesson = withoutExam(lesson, exam);
    this.#db.prepare("INSERT INTO school_lessons (subject, topic, text, at) VALUES (?, ?, ?, ?)").run(id, topic, lesson, this.#clock.now());
    this.#events.append("school.lesson", { subject: id, topic }, { orb });
    // practice: never the exam
    const practice = this.#practice(s, exam, lesson, done);
    const sys = { role: "system" as const, content: `You are ${who.name}, an orb (an AI character) at school, learning ${s.name}.${notes.length ? `\n\nYour notebook:\n${notes.map((n) => `- ${n}`).join("\n")}` : ""}` };
    let feedback = "";
    if (practice.length) {
      const reply = await this.#ask("orb", orb, [sys, { role: "user", content: `Today's lesson:\n${lesson}\n\nPractice:\n${practice.map((q) => `${q.n}. ${q.ask}`).join("\n")}\n\n${howToAnswer(s.kind)}` }], 1500);
      feedback = await this.#feedback(orb, s, practice, reply);
    }
    // a note for the notebook, from the lesson and the practice
    const note = (await this.#ask("orb", orb, [sys, { role: "user", content:
      `Today's lesson:\n${lesson}\n\n${feedback ? `How your practice went:\n${feedback}\n\n` : ""}Write ONE note for your notebook: a rule, a worked example, or a mistake to avoid, that will help you next time. At most 80 words. Reply with the note only.` }], 300)).trim().slice(0, 700);
    const sat = await this.#sit(orb, s, note || null);
    this.#store(s, sat, note || null, false);
    return true;
  }

  /** The practice for tonight: code-made for maths, the banks' other entries, or the teacher's. */
  #practice(s: SubjectRow, exam: Question[], lesson: string, done: number): Question[] {
    if (s.kind === "maths") return mathsPractice(s.seed + done + 1, exam, 3);
    const nth = <T>(xs: T[]): T[] => (xs.length ? [xs[done % xs.length]!] : []);
    if (s.kind === "cpp") return nth(split(s.seed, CPP, 5).practice).map((t) => ({ n: 1, ask: t.ask, tests: t.tests }));
    if (s.kind === "speech") return nth(split(s.seed, SPEECH, 5).practice).map((ask) => ({ n: 1, ask }));
    if (s.kind === "talking") return nth(split(s.seed, TALKING, 5).practice).map((ask) => ({ n: 1, ask }));
    return [...lesson.matchAll(/^\s*PRACTICE:\s*(.+)$/gim)].map((m, i) => ({ n: i + 1, ask: m[1]!.trim() })).slice(0, 2);
  }

  /** How the practice went: by code where it can be, else the teacher's word. */
  async #feedback(orb: string, s: SubjectRow, practice: Question[], reply: string): Promise<string> {
    if (s.kind === "maths") {
      const got = answers(reply);
      return practice.map((q) => (same(got.get(q.n) ?? "", q.answer!) ? `${q.n}: right (${q.answer})` : `${q.n}: wrong: you said ${got.get(q.n) ?? "nothing"}, the answer is ${q.answer}`)).join("\n");
    }
    if (s.kind === "cpp") {
      const code = programOf(reply);
      if (!code) return "There was no program in your answer.";
      const r = await this.#cpp(code, practice[0]!.tests!);
      return r.compiled ? `It compiled; it passed ${r.passed} of ${practice[0]!.tests!.length} tests.${r.first ? ` ${r.first}` : ""}` : `It did not compile: ${r.error.slice(0, 400)}`;
    }
    if (s.kind === "speech") {
      const g = await this.#speech(reply);
      return `${Math.round(g.score * 100)}% of your sentences were plain spoken English.${g.broke.length ? ` To fix: ${g.broke.slice(0, 3).map((b) => `"${b.sentence}" (${b.why.join("; ")})`).join(" ")}` : ""}`;
    }
    return (await this.#ask("teacher", orb, [{ role: "user", content:
      `You teach ${s.name}. Your student answered this practice:\n${practice.map((q) => `${q.n}. ${q.ask}`).join("\n")}\n\nTheir answer:\n${reply}\n\nIn two or three sentences: what was good, and what to fix.${s.kind === "talking" ? " A good reply to the person is warm, honest, short, and asks when it is unsure." : ""}` }], 300)).trim();
  }

  /** The exam, sat with the notebook (and tonight's note, if any): graded by code, by the teacher
   * against its points, or (Talking with you) waiting for your thumbs. */
  async #sit(orb: string, s: SubjectRow, candidate: string | null): Promise<{ answers: Answer[]; score: number | null; state: Sitting["state"] }> {
    const who = this.#who(orb);
    const exam = JSON.parse(s.exam!) as Question[];
    const notes = [...this.#notes(s.id), ...(candidate ? [candidate] : [])];
    const sys = { role: "system" as const, content: `You are ${who.name}, an orb (an AI character) at school, sitting your ${s.name} exam. Answer as well as you can, on your own.${notes.length ? `\n\nYour notebook:\n${notes.map((n) => `- ${n}`).join("\n")}` : ""}` };
    if (s.kind === "maths") {
      const reply = await this.#ask("orb", orb, [sys, { role: "user", content: `${exam.map((q) => `${q.n}. ${q.ask}`).join("\n")}\n\n${howToAnswer("maths")}` }], 2000);
      const got = answers(reply);
      const list = exam.map((q) => ({ n: q.n, ask: q.ask, answer: got.get(q.n) ?? "", ok: same(got.get(q.n) ?? "", q.answer!) }));
      return { answers: list, score: list.filter((a) => a.ok).length / list.length, state: "graded" };
    }
    const list: Answer[] = [];
    for (const q of exam) {
      const reply = (await this.#ask("orb", orb, [sys, { role: "user", content: `${q.ask}\n\n${howToAnswer(s.kind)}` }], s.kind === "cpp" ? 1500 : 600)).trim();
      list.push({ n: q.n, ask: q.ask, answer: reply, ok: null });
    }
    if (s.kind === "talking") return { answers: list.map((a) => ({ ...a, up: null })), score: null, state: "waiting" };
    if (s.kind === "cpp") {
      for (const a of list) {
        const code = programOf(a.answer);
        const tests = exam.find((q) => q.n === a.n)!.tests!;
        const r = code ? await this.#cpp(code, tests) : null;
        a.ok = !!r && r.compiled && r.passed === tests.length;
        a.why = !code ? "no program" : !r!.compiled ? "did not compile" : `passed ${r!.passed} of ${tests.length}`;
      }
      return { answers: list, score: list.filter((a) => a.ok).length / list.length, state: "graded" };
    }
    // speech, AI, your own: the teacher's yes or no on each answer (did it say what was asked; does
    // it make the key points), one ask for all; an answer it did not rate leaves no evidence
    const judged = verdicts(await this.#ask("teacher", orb, [{ role: "user", content: s.kind === "speech"
      ? `For each answer, say whether it does what was asked, in a way a person could follow out loud. Reply with one line per answer, "1: yes" or "1: no", and nothing else.\n\n${list.map((a) => `${a.n}. Asked: ${a.ask}\nAnswer: ${a.answer}`).join("\n\n")}`
      : `For each answer, say whether it makes the key points listed. Reply with one line per answer, "1: yes" or "1: no", and nothing else.\n\n${list.map((a) => `${a.n}. Question: ${a.ask}\nKey points: ${exam.find((q) => q.n === a.n)!.points!.join("; ")}\nAnswer: ${a.answer}`).join("\n\n")}` }], 300), list.length);
    if (judged.some((v) => v === null)) return { answers: list, score: null, state: "void" };
    let total = 0;
    for (const [i, a] of list.entries()) {
      if (s.kind === "speech") {
        const g = judged[i] ? await this.#speech(a.answer) : { score: 0, broke: [] };
        a.ok = judged[i]! && g.score >= 0.8;
        a.why = judged[i] ? `${Math.round(g.score * 100)}% plain` : "did not do what was asked";
        total += g.score;
      } else {
        a.ok = judged[i]!;
        total += a.ok ? 1 : 0;
      }
    }
    return { answers: list, score: total / list.length, state: "graded" };
  }

  /** A sitting kept, and what it decides: the starting one sets the score; another keeps its note
   * only when it beat the score before it. */
  #store(s: SubjectRow, sat: { answers: Answer[]; score: number | null; state: Sitting["state"] }, candidate: string | null, starting: boolean): void {
    const orb = this.#orbOf(s.term);
    tx(this.#db, () => {
      const row = this.#db.prepare("INSERT INTO school_sittings (subject, at, score, state, answers, candidate, starting) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *")
        .get(s.id, this.#clock.now(), sat.score, sat.state, JSON.stringify(sat.answers), candidate, starting ? 1 : 0) as SittingRow;
      this.#events.append("school.sat", { subject: s.id, sitting: row.id, score: sat.score, state: sat.state, starting }, { orb });
      if (sat.state === "graded") this.#settle(this.#subject(s.id), row);
    });
  }

  /** A graded sitting's decision: its note kept if it raised the score (the starting sitting only
   * sets it), and a diploma when the mark is reached on two sittings in a row. */
  #settle(s: SubjectRow, row: SittingRow): void {
    const orb = this.#orbOf(s.term);
    const score = row.score!;
    if (row.starting) {
      this.#db.prepare("UPDATE school_subjects SET kept_score = ? WHERE id = ?").run(score, s.id);
    } else if (row.candidate && (s.kept_score === null || score > s.kept_score)) {
      this.#db.prepare("INSERT INTO school_notes (subject, text, at) VALUES (?, ?, ?)").run(s.id, row.candidate, this.#clock.now());
      this.#db.prepare("UPDATE school_subjects SET kept_score = ? WHERE id = ?").run(score, s.id);
      this.#db.prepare("UPDATE school_sittings SET kept = 1 WHERE id = ?").run(row.id);
      this.#events.append("school.note_kept", { subject: s.id, sitting: row.id, score, before: s.kept_score }, { orb });
    } else {
      this.#db.prepare("UPDATE school_sittings SET kept = 0 WHERE id = ?").run(row.id);
      this.#events.append("school.note_dropped", { subject: s.id, sitting: row.id, score, before: s.kept_score }, { orb });
    }
    const mark = (this.#db.prepare("SELECT pass_mark FROM school_terms WHERE id = ?").get(s.term) as { pass_mark: number }).pass_mark;
    const last = this.#sittings(s.id).filter((x) => x.state === "graded").slice(-2);
    if (s.graduated_at === null && last.length === 2 && last.every((x) => x.score! >= mark)) {
      const kept = (this.#db.prepare("SELECT kept_score FROM school_subjects WHERE id = ?").get(s.id) as { kept_score: number }).kept_score;
      this.#db.prepare("UPDATE school_subjects SET graduated_at = ? WHERE id = ?").run(this.#clock.now(), s.id);
      this.#events.append("school.graduated", { subject: s.id, name: s.name, kind: s.kind, score: kept }, { orb });
    }
  }

  // ── the kit's graders ───────────────────────────────────────────────────────────────────────

  async #cpp(code: string, tests: { input: string; output: string }[]): Promise<{ compiled: boolean; error: string; passed: number; first: string }> {
    if (!this.#o.kit) throw new SchoolError("the kit is not running: C++ is compiled and run in its sandbox");
    const r = (await this.#o.kit("school_cpp", { code, tests })) as { compiled: boolean; error: string; passed: number; results: { ok: boolean; got: string; why?: string }[] };
    const bad = r.results.findIndex((x) => !x.ok);
    const first = bad < 0 ? "" : `On input "${tests[bad]!.input}" it ${r.results[bad]!.why ?? `printed "${r.results[bad]!.got.trim()}"`}, not "${tests[bad]!.output}".`;
    return { compiled: r.compiled, error: r.error, passed: r.passed, first };
  }

  async #speech(text: string): Promise<{ score: number; broke: { sentence: string; why: string[] }[] }> {
    if (!this.#o.kit) throw new SchoolError("the kit is not running: speech is measured by its plain-English rules");
    return (await this.#o.kit("school_speech", { text })) as { score: number; broke: { sentence: string; why: string[] }[] };
  }

  // ── rows ────────────────────────────────────────────────────────────────────────────────────

  async #guarded<T>(id: number, fn: () => Promise<T>): Promise<T | false> {
    if (this.#busy.has(id)) return false;
    this.#busy.add(id);
    try {
      return await fn();
    } catch (e) {
      this.#trouble(this.#subject(id), e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      this.#busy.delete(id);
    }
  }

  #trouble(s: SubjectRow, why: string | null): void {
    this.#db.prepare("UPDATE school_subjects SET trouble = ? WHERE id = ?").run(why, s.id);
  }

  #who(orb: string): { name: string; work: string } {
    return this.#o.who(orb) ?? { name: orb, work: "general" };
  }

  #open(term: number): boolean {
    return !!this.#db.prepare("SELECT 1 FROM school_terms WHERE id = ? AND ended_at IS NULL").get(term);
  }

  #orbOf(term: number): string {
    return (this.#db.prepare("SELECT orb FROM school_terms WHERE id = ?").get(term) as { orb: string }).orb;
  }

  #subjects(term: number): SubjectRow[] {
    return this.#db.prepare("SELECT * FROM school_subjects WHERE term = ? ORDER BY id").all(term) as SubjectRow[];
  }

  #subject(id: number): SubjectRow {
    const s = this.#db.prepare("SELECT * FROM school_subjects WHERE id = ?").get(id) as SubjectRow | undefined;
    if (!s) throw new SchoolError("no such subject");
    return s;
  }

  #sittings(id: number): SittingRow[] {
    return this.#db.prepare("SELECT * FROM school_sittings WHERE subject = ? ORDER BY id").all(id) as SittingRow[];
  }

  #notes(id: number): string[] {
    return (this.#db.prepare("SELECT text FROM school_notes WHERE subject = ? ORDER BY id").all(id) as { text: string }[]).map((r) => r.text);
  }

  #card(s: SubjectRow): SubjectCard {
    const sittings = this.#sittings(s.id);
    const waiting = sittings.find((x) => x.state === "waiting");
    return {
      id: s.id, kind: s.kind, name: s.name, how: s.kind === "custom" ? "against key points, by the teacher" : KINDS[s.kind].how,
      syllabus: s.syllabus === null ? null : (JSON.parse(s.syllabus) as string[]),
      lessons: (this.#db.prepare("SELECT count(*) AS n FROM school_lessons WHERE subject = ?").get(s.id) as { n: number }).n,
      notes: this.#db.prepare("SELECT text, at FROM school_notes WHERE subject = ? ORDER BY id").all(s.id) as { text: string; at: number }[],
      started: sittings.find((x) => x.starting)?.score ?? null, now: s.kept_score,
      sittings: sittings.map((x) => ({ id: x.id, at: x.at, score: x.score, state: x.state, kept: x.kept === null ? null : x.kept === 1, starting: x.starting === 1 })),
      graduatedAt: s.graduated_at,
      rate: waiting ? { sitting: waiting.id, answers: JSON.parse(waiting.answers) as Answer[] } : null,
      trouble: s.trouble,
    };
  }
}

/** How an answer is written, by kind (maths is read by code, a program is compiled). */
function howToAnswer(kind: Kind): string {
  if (kind === "maths") return "Work each one out, then end it with a line: ANSWER <number>: <the value only>.";
  if (kind === "cpp") return "Write a complete C++17 program that reads standard input and prints the answer. Reply with the program in one ```cpp block.";
  if (kind === "speech") return "Say it as you would out loud to them: short sentences, one instruction each, plain words.";
  if (kind === "talking") return "Reply to them as you would in a chat.";
  return "Answer in a few sentences.";
}

/** A lesson with no line of the exam in it: a line that has an exam question's words is cut. */
export function withoutExam(text: string, exam: Question[]): string {
  const asks = exam.map((q) => q.ask.toLowerCase().replace(/\s+/g, " ").trim()).filter((a) => a.length >= 12);
  return text.split("\n").filter((line) => {
    const l = line.toLowerCase().replace(/\s+/g, " ");
    return !asks.some((a) => l.includes(a));
  }).join("\n");
}
