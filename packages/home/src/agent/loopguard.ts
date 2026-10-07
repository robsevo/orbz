// Stops a reply that has fallen into a loop (owner, 10-07: "build the ash stuff next, the repeat guard").
// Ported from Ash's engine (cli/engine/src/loop-guard.mjs), measured there on 09-12: asked to check a
// codebase against plan.md, a seat wrote "The codebase includes all the necessary testing considerations
// as outlined in the plan.md file." several hundred times until its output ran out; the reader got a
// wall of one sentence and the turn spent its whole budget saying nothing. Repetition penalties are a
// knob each provider tunes (or drops) differently; a check in the stream works for every brain.
//
//   a run     the same sentence RUN times in a row ("A A A A A")
//   a cycle   the last WINDOW_MIN or more sentences use at most DISTINCT different ones ("A B A B A B ...")
//
// Sentences shorter than MIN_LEN repeat legitimately and are not counted; neither is anything inside a
// ``` block (a table of numbers, a list of files). The reply is kept up to the end of the first time
// the looping sentence was said (a cycle: its first full turn): what came before was real, after is the loop.

export const MIN_LEN = 25;
export const RUN = 5;
export const WINDOW = 12;
export const WINDOW_MIN = 8;
export const DISTINCT = 2;

export type Trip = { kind: "run" | "cycle"; sentence: string; count: number; cutAt: number };

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
/** A sentence ends at a terminator, any closing quotes or brackets, then whitespace. */
const SENTENCE_END = /[.!?]["')\]]*\s/g;

export class LoopGuard {
  /** Everything pushed so far. */
  #all = "";
  /** Where in `#all` the sentence being built began. */
  #from = 0;
  #fence = false;
  #history: string[] = [];
  #run = { key: "", n: 0 };
  /** Where each sentence first ended, by its normalised words: the cut point if it loops. */
  #firstEnd = new Map<string, number>();
  tripped: Trip | null = null;

  /** Takes the next piece of the reply; the trip, the first time a loop is certain. */
  push(chunk: string): Trip | null {
    if (!chunk || this.tripped) return this.tripped;
    // only the unsplit tail is scanned again, never the whole reply (Ash: rescanning was quadratic)
    const scanFrom = Math.max(this.#from, this.#all.length - 4);
    this.#all += chunk;
    SENTENCE_END.lastIndex = scanFrom;
    let m: RegExpExecArray | null;
    while ((m = SENTENCE_END.exec(this.#all))) {
      const end = m.index + m[0].length;
      if (end <= this.#from) continue;
      const sentence = this.#all.slice(this.#from, end);
      this.#from = end;
      const trip = this.#consider(sentence, end);
      if (trip) return trip;
    }
    return null;
  }

  #consider(sentence: string, end: number): Trip | null {
    const fences = (sentence.match(/```/g) ?? []).length;
    const was = this.#fence;
    if (fences % 2) this.#fence = !this.#fence;
    if (was || this.#fence) return null;
    const key = norm(sentence);
    if (key.length < MIN_LEN) return null;
    if (!this.#firstEnd.has(key)) this.#firstEnd.set(key, end);
    this.#run = key === this.#run.key ? { key, n: this.#run.n + 1 } : { key, n: 1 };
    if (this.#run.n >= RUN) return this.#trip("run", sentence, this.#run.n, key);
    this.#history.push(key);
    if (this.#history.length > WINDOW) this.#history.shift();
    if (this.#history.length >= WINDOW_MIN && new Set(this.#history).size <= DISTINCT) {
      // a cycle: kept through its first full turn, the last of its sentences the first time it was said
      const once = Math.max(...[...new Set(this.#history)].map((k) => this.#firstEnd.get(k) ?? end));
      this.tripped = { kind: "cycle", sentence: sentence.trim(), count: this.#history.length, cutAt: once };
      return this.tripped;
    }
    return null;
  }

  #trip(kind: "run", sentence: string, count: number, key: string): Trip {
    this.tripped = { kind, sentence: sentence.trim(), count, cutAt: this.#firstEnd.get(key) ?? this.#all.length };
    return this.tripped;
  }
}
