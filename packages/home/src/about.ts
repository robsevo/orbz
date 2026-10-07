// "About you" (PLAN 2.4): what every orb knows about the person, shared by all of them, while
// each orb's work memory stays his own. For now the name the office calls you, from the first
// open (2.5); it grows with the chat app. Kept in the home's database; changes are events.
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "./clock.ts";
import type { EventLog } from "./events.ts";

export type AboutYou = { name: string | null; since: number | null; company: string | null };

export class About {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #clock: Clock;

  constructor(db: DatabaseSync, events: EventLog, clock: Clock) {
    this.#db = db;
    this.#events = events;
    this.#clock = clock;
  }

  get(): AboutYou {
    const row = this.#db.prepare("SELECT value, updated_at FROM about WHERE key = 'name'").get() as { value: string; updated_at: number } | undefined;
    const since = this.#db.prepare("SELECT value FROM about WHERE key = 'since'").get() as { value: string } | undefined;
    const company = this.#db.prepare("SELECT value FROM about WHERE key = 'company'").get() as { value: string } | undefined;
    return { name: row?.value ?? null, since: since ? Number(since.value) : null, company: company?.value ?? null };
  }

  /** What the office calls you: one line, 1-24 letters, said back exactly as kept. */
  setName(raw: string): AboutYou {
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name) throw new Error("the office needs something to call you");
    if (name.length > 24) throw new Error("a name is 24 letters at most");
    const at = this.#clock.now();
    const put = this.#db.prepare("INSERT INTO about (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at");
    put.run("name", name, at);
    if (this.get().since === null) put.run("since", String(at), at);
    this.#events.append("about.changed", { name });
    return this.get();
  }

  /** Your company's name (owner, 10-07: "the user first picks his own name, the company name"): one line, 1-40 letters. */
  setCompany(raw: string): AboutYou {
    const company = raw.replace(/\s+/g, " ").trim();
    if (!company) throw new Error("the company needs a name");
    if (company.length > 40) throw new Error("a company's name is 40 letters at most");
    const at = this.#clock.now();
    this.#db.prepare("INSERT INTO about (key, value, updated_at) VALUES ('company', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(company, at);
    this.#events.append("about.changed", { company });
    return this.get();
  }
}
