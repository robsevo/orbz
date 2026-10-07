// What the brains cost, and the cap (PLAN 1.4). Every brain call is a `brain.spend` event in the
// home's log with the cost the provider reported (or the price-table estimate, marked as one). A
// day's spend is the sum of that day's events (UTC days, like the loops' caps), so it survives a
// restart. Before each call the ladder asks `check()`: at or past the cap it throws
// SpendCapError, which the inbox turns into a clean stop ("capped"), never into a fall-through
// to a different paid brain.
import type { Clock } from "../clock.ts";
import type { EventLog } from "../events.ts";
import { utcDay } from "../loops.ts";
import type { CostSource } from "./openai.ts";

export class SpendCapError extends Error {
  readonly capUsd: number;
  readonly spentUsd: number;
  constructor(capUsd: number, spentUsd: number) {
    super(`today's spend cap is reached: $${spentUsd.toFixed(4)} of $${capUsd.toFixed(2)}`);
    this.name = "SpendCapError";
    this.capUsd = capUsd;
    this.spentUsd = spentUsd;
  }
}

export type SpendRecord = {
  tier: string;
  model: string;
  costUsd: number | null;
  costSource: CostSource;
  promptTokens: number;
  completionTokens: number;
  /** Of the prompt, how much the provider served from its cache (PLAN 5.10: measured, not assumed). */
  cachedTokens?: number;
  /** A session turn's kind (lead, chime, asked, work), so a session's cost can be read by kind. */
  turn?: string;
  orb?: string | null;
  conversation?: string | null;
};

export class Spend {
  readonly #events: EventLog;
  readonly #clock: Clock;
  #capUsd: number | null;
  #day = "";
  #spent = 0;
  readonly #warnedUnknown = new Set<string>();

  /** `capUsdPerDay`: null means no cap (the person's own choice, made in settings). */
  constructor(events: EventLog, clock: Clock, capUsdPerDay: number | null) {
    this.#events = events;
    this.#clock = clock;
    this.#capUsd = capUsdPerDay;
  }

  get capUsd(): number | null {
    return this.#capUsd;
  }

  setCap(usd: number | null): void {
    this.#capUsd = usd;
    this.#events.append("brain.cap_set", { cap_usd: usd });
  }

  /** Dollars spent today (UTC), from the event log. */
  today(): number {
    const day = utcDay(this.#clock.now());
    if (day !== this.#day) {
      this.#day = day;
      this.#spent = 0;
      for (const e of this.#events.ofType("brain.spend")) {
        if (utcDay(e.at) === day && typeof e.data.cost_usd === "number") this.#spent += e.data.cost_usd;
      }
    }
    return this.#spent;
  }

  capped(): boolean {
    return this.#capUsd !== null && this.today() >= this.#capUsd;
  }

  /** Throws SpendCapError when today's spend has reached the cap. */
  check(): void {
    if (this.capped()) throw new SpendCapError(this.#capUsd!, this.today());
  }

  record(r: SpendRecord): void {
    this.today(); // roll the day over first, so this call counts toward the right one
    this.#events.append(
      "brain.spend",
      {
        tier: r.tier,
        model: r.model,
        cost_usd: r.costUsd,
        cost_source: r.costSource,
        prompt_tokens: r.promptTokens,
        completion_tokens: r.completionTokens,
        ...(r.cachedTokens && { cached_tokens: r.cachedTokens }),
        ...(r.turn && { turn: r.turn }),
      },
      { orb: r.orb ?? null, conversation: r.conversation ?? null },
    );
    if (r.costUsd !== null) this.#spent += r.costUsd;
    if (r.costSource === "unknown" && !this.#warnedUnknown.has(r.model)) {
      this.#warnedUnknown.add(r.model);
      this.#events.append("notify", {
        level: "warn",
        text: `${r.model} reports no cost and has no price set, so the spend cap cannot count it.`,
      });
    }
  }
}
