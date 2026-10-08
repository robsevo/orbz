// "About you" (PLAN 2.4): what every orb knows about the person, shared by all of them, while
// each orb's work memory stays his own. For now the name the office calls you, from the first
// open (2.5); it grows with the chat app. Kept in the home's database; changes are events.
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "./clock.ts";
import type { EventLog } from "./events.ts";

/** What the company can spend (PLAN 5.20; owner, 10-08: "we have to keep in mind that the user may not have any money to
 * start with. so ask how much they are willing to spend on infrastructure etc."): whole dollars to start, and each month
 * (hosting, tools, ads). Nothing is a fine answer. */
export type Budget = { start: number; month: number };
export type AboutYou = { name: string | null; since: number | null; company: string | null; budget: Budget | null };

/** The most a budget says, either amount. */
export const BUDGET_MAX = 10_000_000;

/** Dollars as a person writes them: $0, $50, $1,000. */
export const dollars = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;

/** What the company can spend, in a sentence: what each pitch for the board's report is told (report.ts), and every orb
 * (company.ts). Never said is taken as nothing. */
export function budgetLine(b: Budget | null, o: { founder: string; company: string }): string {
  if (!b) return `${o.founder} has not said yet what ${o.company} can spend, so take it as nothing.`;
  if (b.start === 0 && b.month === 0) return `${o.company} has no money to spend yet.`;
  return `${o.company} can spend up to ${dollars(b.start)} to start and ${dollars(b.month)} a month in all, on hosting, tools and ads.`;
}

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
    const budget = this.#db.prepare("SELECT value FROM about WHERE key = 'budget'").get() as { value: string } | undefined;
    return { name: row?.value ?? null, since: since ? Number(since.value) : null, company: company?.value ?? null, budget: budget ? (JSON.parse(budget.value) as Budget) : null };
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

  /** What the company can spend (PLAN 5.20), changed any time (owner, 10-08: "Lets be able to change the budget as
   * well"): whole dollars to start and each month, 0 or more. */
  setBudget(raw: unknown): AboutYou {
    const b = (raw ?? {}) as { start?: unknown; month?: unknown };
    const amount = (v: unknown, what: string): number => {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`${what} is a number of dollars, 0 or more`);
      if (v > BUDGET_MAX) throw new Error(`${what} is ${dollars(BUDGET_MAX)} at most`);
      return Math.round(v);
    };
    const budget: Budget = { start: amount(b.start, "what it can spend to start"), month: amount(b.month, "what it can spend a month") };
    const at = this.#clock.now();
    this.#db.prepare("INSERT INTO about (key, value, updated_at) VALUES ('budget', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(JSON.stringify(budget), at);
    this.#events.append("about.changed", { budget });
    return this.get();
  }
}
