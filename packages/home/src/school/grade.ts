// School's grading by code (PLAN 5.7), pure: a maths answer read as an exact number, a program
// taken out of a reply, and a teacher's yes-or-no lines read without guessing (a line it did not
// write is no evidence, and the sitting it belongs to counts for nothing).

const NUMBER = /(-?\d+)\s+(\d+)\/(\d+)|(-?\d+)\s*\/\s*(-?\d+)|(-?\d*\.?\d+)/;

/** An answer as an exact fraction [p, q], or null: "19/12", "-3", "72.0", "2,000", "1 1/2", "72 km/h",
 * "x = 6", "3/4 + 5/6 = 19/12" (after an "=", what follows it). */
export function rational(s: string): [number, number] | null {
  const t = s.replace(/(?<=\d),(?=\d{3}\b)/g, "");
  const m = NUMBER.exec(t.includes("=") ? t.slice(t.lastIndexOf("=") + 1) : t);
  if (!m) return null;
  if (m[1] !== undefined) {
    const q = Number(m[3]);
    return q ? [(m[1].startsWith("-") ? -1 : 1) * (Math.abs(Number(m[1])) * q + Number(m[2])), q] : null;
  }
  if (m[4] !== undefined) return Number(m[5]) ? [Number(m[4]), Number(m[5])] : null;
  const [whole, frac = ""] = m[6]!.replace("-", "").split(".");
  const q = 10 ** frac.length;
  return [(m[6]!.startsWith("-") ? -1 : 1) * (Number(whole || "0") * q + Number(frac || "0")), q];
}

/** Whether two answers are the same number exactly. */
export function same(a: string, b: string): boolean {
  const x = rational(a);
  const y = rational(b);
  return !!x && !!y && x[0] * y[1] === y[0] * x[1];
}

/** "ANSWER 3: 19/12" lines, by question number (the last one for a number wins). */
export function answers(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of text.matchAll(/^\s*\**\s*answer\s*(\d+)\s*\**\s*[:.)-]\s*(.+?)\s*$/gim)) out.set(Number(m[1]), m[2]!.replace(/\*+/g, "").trim());
  return out;
}

/** The program in a reply: its ```cpp block (or its only ``` block), else the reply if it is code. */
export function programOf(text: string): string | null {
  const blocks = [...text.matchAll(/```([\w+#-]*)\s*\n([\s\S]*?)```/g)];
  const cpp = blocks.find((b) => /^(c\+\+|cpp|cc|cxx)$/i.test(b[1]!)) ?? (blocks.length === 1 ? blocks[0] : undefined);
  if (cpp) return cpp[2]!;
  return /#include\s*</.test(text) && /\bmain\s*\(/.test(text) ? text : null;
}

/** A judge's "1: yes" / "2: no" lines: one verdict a question, null where it gave none. */
export function verdicts(text: string, n: number): (boolean | null)[] {
  const out: (boolean | null)[] = Array.from({ length: n }, () => null);
  for (const m of text.matchAll(/^\s*\**\s*(\d+)\s*\**\s*[:.)-]\s*\**\s*(yes|no)\b/gim)) {
    const i = Number(m[1]) - 1;
    if (i >= 0 && i < n) out[i] = m[2]!.toLowerCase() === "yes";
  }
  return out;
}

/** The teacher's exam for an AI or your own subject: "Q: ..." then its "P: ..." points, or null
 * when it is not that (a reply cut short is never half an exam). */
export function teacherExam(text: string, want: number): { ask: string; points: string[] }[] | null {
  const out: { ask: string; points: string[] }[] = [];
  for (const line of text.split("\n").map((l) => l.trim())) {
    const q = /^\**\s*Q\s*\d*\s*[:.]\s*\**\s*(.+)$/i.exec(line);
    const p = /^[-*]?\s*\**\s*P\s*[:.]\s*\**\s*(.+)$/i.exec(line);
    if (q) out.push({ ask: q[1]!.trim(), points: [] });
    else if (p && out.length) out.at(-1)!.points.push(p[1]!.trim());
  }
  const whole = out.filter((x) => x.ask.length > 8 && x.points.length >= 2);
  return whole.length >= want ? whole.slice(0, want) : null;
}

/** A syllabus from the teacher's lines: 4 to 10 topics, each a short line. */
export function topics(text: string): string[] | null {
  const lines = text.split("\n").map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)]|topic\s*\d*[:.])\s*/i, "").replace(/\*+/g, "").trim()).filter((l) => l.length > 2 && l.length <= 120);
  return lines.length >= 4 ? lines.slice(0, 10) : null;
}
