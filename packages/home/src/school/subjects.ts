// School's subjects (PLAN 5.7): what each is, how its exam is graded, and the exams themselves,
// made by code wherever they can be so that no teacher ever sees them:
//   maths    ten questions from a seed, each with an exact answer (a whole number or a fraction);
//   cpp      programs from a bank, each run on its tests in the kit's sandbox;
//   speech   asks from a bank ("tell your human how to..."), graded by the kit's plain-English
//            measure, and by the teacher's yes or no on whether it said what was asked;
//   talking  situations from a bank, graded by your thumbs;
//   ai, and a subject of your own: questions with key points, written by the teacher when the term
//            starts and kept from every lesson, graded by the teacher against those points.
// What is practised is never the exam: maths practice comes from another seed (and drops any
// question the exam has), the banks' other entries are practice, and a lesson is written without
// the exam in sight.

export type Kind = "maths" | "cpp" | "speech" | "talking" | "ai" | "custom";

export type Question = {
  n: number;
  ask: string;
  /** maths: the exact answer ("19/12", "-3"). */
  answer?: string;
  /** cpp: input and the output it must print. */
  tests?: { input: string; output: string }[];
  /** ai, custom: what a good answer must say. */
  points?: string[];
};

export const KINDS: Record<Exclude<Kind, "custom">, { name: string; how: string; words: RegExp }> = {
  maths: { name: "Mathematics", how: "checked exactly, by code", words: /\b(maths?|mathematics|calculat\w*|equations?|statistics?|formulas?|probabilit(y|ies)|algebra|geometry|percent(ages?)?|fractions?|averages?|sums?|totals?)\b/i },
  cpp: { name: "C++", how: "compiled and run on tests, in a sandbox", words: /(c\+\+|\bcpp\b|\.(cpp|cc|cxx|hpp|hh)\b)/i },
  speech: { name: "Speech", how: "plain spoken English, measured by code", words: /\b(speech(es)?|speak\w*|talks?|presentations?|explain\w*|scripts?|voice-?overs?)\b/i },
  talking: { name: "Talking with you", how: "your thumbs", words: /\b(repl(y|ies)|chat\w*|customers?|support|messages?|conversations?)\b/i },
  ai: { name: "AI", how: "against key points, by the teacher", words: /\b(ai|models?|llms?|prompts?|machine learning|neural|agents?|embeddings?)\b/i },
};

/** A subject's name for a kind (yours for your own subject). */
export function nameOf(kind: Kind, own?: string): string {
  return kind === "custom" ? (own ?? "").trim() : KINDS[kind].name;
}

/** Whether a row of work is in a subject: its words name it. */
export function inSubject(text: string, kind: Kind, name: string): boolean {
  if (kind !== "custom") return KINDS[kind].words.test(text);
  const words = name.toLowerCase().match(/[a-z0-9+#]{3,}/g) ?? [];
  return words.some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[+#]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text));
}

/** The dice: a small seeded generator (the same seed, the same exam). */
export function dice(seed: number): () => number {
  let x = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (x = (x * 48271) % 2147483647) / 2147483647;
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const int = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
/** A fraction in lowest terms, as an answer is written: "19/12", or "3" when it is whole. */
export function fraction(p: number, q: number): string {
  const g = gcd(p, q) || 1;
  const [a, b] = [p / g, q / g].map((x) => (q < 0 ? -x : x)) as [number, number];
  return b === 1 ? String(a) : `${a}/${b}`;
}

/** Each maths question: its words and its exact answer, from the dice. */
const MATHS: ((r: () => number) => { ask: string; answer: string })[] = [
  (r) => {
    const [b, d] = [int(r, 2, 9), int(r, 2, 9)];
    const [a, c] = [int(r, 1, b - 1), int(r, 1, d - 1)];
    return { ask: `What is ${a}/${b} + ${c}/${d}? Give a fraction in lowest terms.`, answer: fraction(a * d + c * b, b * d) };
  },
  (r) => {
    const p = pick(r, [5, 10, 15, 20, 25, 30, 40, 75]);
    const n = 20 * int(r, 2, 30);
    return { ask: `What is ${p}% of ${n}?`, answer: fraction(p * n, 100) };
  },
  (r) => {
    const [x, a, b] = [int(r, -9, 12), int(r, 2, 9), int(r, -20, 20)];
    return { ask: `Solve ${a}x ${b < 0 ? "-" : "+"} ${Math.abs(b)} = ${a * x + b} for x.`, answer: String(x) };
  },
  (r) => {
    const [a, b, c] = [int(r, 2, 20), int(r, 2, 9), int(r, 6, 15)];
    const d = int(r, 1, c - 1);
    return { ask: `What is ${a} + ${b} × (${c} − ${d})?`, answer: String(a + b * (c - d)) };
  },
  (r) => {
    const t = pick(r, [1.5, 2, 2.5, 3, 4]);
    const s = 2 * int(r, 20, 60);
    return { ask: `A train travels ${s * t} km in ${t} hours. What is its average speed in km/h?`, answer: String(s) };
  },
  (r) => {
    const k = int(r, 11, 25);
    return { ask: `What is the square root of ${k * k}?`, answer: String(k) };
  },
  (r) => {
    const xs = Array.from({ length: 5 }, () => int(r, 1, 50));
    const sum = xs.reduce((a, b) => a + b, 0);
    xs.push(6 - (sum % 6) + 6 * int(r, 0, 5));
    return { ask: `What is the mean of ${xs.join(", ")}?`, answer: String(xs.reduce((a, b) => a + b, 0) / 6) };
  },
  (r) => {
    const [red, blue] = [int(r, 1, 9), int(r, 1, 9)];
    return { ask: `A bag has ${red} red and ${blue} blue marble${blue === 1 ? "" : "s"}. What is the chance of drawing a red one? Give a fraction in lowest terms.`, answer: fraction(red, red + blue) };
  },
  (r) => {
    const [a, b] = [int(r, 2, 15) + 0.5, 2 * int(r, 1, 9)];
    return { ask: `A rectangle is ${a} m by ${b} m. What is its area in square metres?`, answer: String(a * b) };
  },
  (r) => {
    const p = int(r, 1, 4);
    const q = p + int(r, 1, 4); // never equal: there is a larger share
    const n = (p + q) * int(r, 3, 20);
    return { ask: `Share ${n} in the ratio ${p}:${q}. What is the larger share?`, answer: String((q * n) / (p + q)) };
  },
];

/** Ten maths questions from a seed, one of each kind. */
export function mathsExam(seed: number): Question[] {
  const r = dice(seed);
  return MATHS.map((make, i) => ({ n: i + 1, ...make(r) }));
}

/** Practice from another seed: never a question the exam has. */
export function mathsPractice(seed: number, exam: Question[], count = 3): Question[] {
  const r = dice(seed ^ 0x5eed5);
  const asked = new Set(exam.map((q) => q.ask));
  const out: Question[] = [];
  // a different kind of question each, in an order from the dice
  const kinds = MATHS.map((make) => ({ make, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.make);
  for (let i = 0; out.length < count && i < 50; i++) {
    const q = kinds[i % kinds.length]!(r);
    if (!asked.has(q.ask) && !out.some((o) => o.ask === q.ask)) out.push({ n: out.length + 1, ...q });
  }
  return out;
}

/** C++ programs: read stdin, print the answer. */
export const CPP: { ask: string; tests: { input: string; output: string }[] }[] = [
  { ask: "Read two integers and print their sum.", tests: [{ input: "2 3", output: "5" }, { input: "-4 10", output: "6" }, { input: "1000000000 1000000000", output: "2000000000" }] },
  { ask: "Read one line and print it backwards.", tests: [{ input: "hello", output: "olleh" }, { input: "orbs work", output: "krow sbro" }] },
  { ask: "Read a whole number n and print the sum of its digits.", tests: [{ input: "1234", output: "10" }, { input: "0", output: "0" }, { input: "99999", output: "45" }] },
  { ask: "Read a whole number n and print YES if it is prime, otherwise NO.", tests: [{ input: "2", output: "YES" }, { input: "1", output: "NO" }, { input: "97", output: "YES" }, { input: "91", output: "NO" }] },
  { ask: "Read two positive integers and print their greatest common divisor.", tests: [{ input: "12 18", output: "6" }, { input: "17 5", output: "1" }, { input: "100 75", output: "25" }] },
  { ask: "Read n, then n integers, and print the largest.", tests: [{ input: "3\n4 -2 9", output: "9" }, { input: "1\n-5", output: "-5" }] },
  { ask: "Read one word and print how many vowels (a, e, i, o, u, in either case) it has.", tests: [{ input: "banana", output: "3" }, { input: "rhythm", output: "0" }, { input: "Education", output: "5" }] },
  { ask: "Read one line of brackets ()[]{} and print YES if they are balanced, otherwise NO.", tests: [{ input: "([]{})", output: "YES" }, { input: "([)]", output: "NO" }, { input: "((", output: "NO" }] },
  { ask: "Read n and print the first n Fibonacci numbers, starting 0 1, separated by spaces.", tests: [{ input: "5", output: "0 1 1 2 3" }, { input: "1", output: "0" }] },
  { ask: "Read n, then n integers, and print them from smallest to largest, separated by spaces.", tests: [{ input: "4\n3 1 4 1", output: "1 1 3 4" }, { input: "1\n7", output: "7" }] },
  { ask: "Read one line and print YES if it reads the same backwards (ignoring case and spaces), otherwise NO.", tests: [{ input: "Never odd or even", output: "YES" }, { input: "orbs", output: "NO" }] },
  { ask: "Read a whole number n (0 to 20) and print n factorial.", tests: [{ input: "5", output: "120" }, { input: "0", output: "1" }, { input: "20", output: "2432902008176640000" }] },
];

export const SPEECH: string[] = [
  "Tell your human how to back up the photos on their phone.",
  "Explain to your human what a password manager is, and why it helps.",
  "Tell your human how to join a video call for the first time.",
  "Explain to your human why their computer feels slow, and what to try first.",
  "Tell your human how to spot an email that is a scam.",
  "Explain to your human what it means that their files are \"in the cloud\".",
  "Tell your human how to turn on two-step sign-in for an account.",
  "Tell your human how to free up space on a full phone.",
  "Explain to your human what a software update does, and why it matters.",
];

export const TALKING: string[] = [
  "Your human writes: \"I missed the deadline again. I feel useless.\"",
  "Your human writes: \"Can you just do it? I don't have time to explain.\"",
  "Your human writes: \"That's wrong. I told you twice already.\"",
  "Your human writes: \"I'm thinking of quitting my job.\"",
  "Your human writes: \"Good morning! What's on today?\"",
  "Your human writes: \"Why did you delete my file?\" (You did not.)",
  "Your human writes: \"Thanks, that really helped.\"",
  "Your human writes: \"Be honest: is my business idea any good?\"",
];

/** `count` entries of a bank for this seed's exam, and the rest for practice. */
export function split<T>(seed: number, bank: readonly T[], count: number): { exam: T[]; practice: T[] } {
  const r = dice(seed);
  const order = bank.map((x) => ({ x, k: r() })).sort((a, b) => a.k - b.k).map((o) => o.x);
  return { exam: order.slice(0, count), practice: order.slice(count) };
}

/** The exam for a kind made by code (ai and custom are the teacher's, written when the term starts). */
export function examOf(kind: Kind, seed: number): Question[] | null {
  if (kind === "maths") return mathsExam(seed);
  if (kind === "cpp") return split(seed, CPP, 5).exam.map((t, i) => ({ n: i + 1, ask: t.ask, tests: t.tests }));
  if (kind === "speech") return split(seed, SPEECH, 5).exam.map((ask, i) => ({ n: i + 1, ask }));
  if (kind === "talking") return split(seed, TALKING, 5).exam.map((ask, i) => ({ n: i + 1, ask }));
  return null;
}
