// What each orb has learned (PLAN 3.9; owner, 10-01: "as they gain experience etc and learn,
// they add to that constitution ... the dots must learn off you too, each individual one"). Each
// orb has his own lines, in <data>/orbs/<id>/learned.md, added to his constitution and no one
// else's. A line is added only by the person (the door), never by a model; the night's proposals
// come through the learning gate (3.5) as cards the person approves. Every line can be taken back.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EventLog } from "../events.ts";

export class Learned {
  readonly #dir: string;
  readonly #events: EventLog;

  constructor(dataDir: string, events: EventLog) {
    this.#dir = join(dataDir, "orbs");
    this.#events = events;
  }

  #file(orb: string): string {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(orb)) throw new Error(`orb id "${orb}"`);
    return join(this.#dir, orb, "learned.md");
  }

  list(orb: string): string[] {
    const f = this.#file(orb);
    if (!existsSync(f)) return [];
    return readFileSync(f, "utf8").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  }

  #write(orb: string, lines: string[]): void {
    mkdirSync(join(this.#dir, orb), { recursive: true, mode: 0o700 });
    writeFileSync(this.#file(orb), lines.map((l) => `- ${l}\n`).join(""), { mode: 0o600 });
  }

  /** The person approved this line for this orb. */
  add(orb: string, line: string): string[] {
    const l = line.replace(/\s+/g, " ").trim();
    if (!l) throw new Error("an empty line teaches nothing");
    if (l.length > 400) throw new Error("a learned line is one line, under 400 characters");
    const lines = [...this.list(orb), l];
    this.#write(orb, lines);
    this.#events.append("orb.learned", { line: l, count: lines.length }, { orb });
    return lines;
  }

  /** Takes a line back (its number, from 0). */
  remove(orb: string, index: number): string[] {
    const lines = this.list(orb);
    if (!Number.isInteger(index) || index < 0 || index >= lines.length) throw new Error(`no line ${index}`);
    const [gone] = lines.splice(index, 1);
    this.#write(orb, lines);
    this.#events.append("orb.unlearned", { line: gone, count: lines.length }, { orb });
    return lines;
  }
}
