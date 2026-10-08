// What the company can spend (PLAN 5.20; owner, 10-08: "we have to keep in mind that the user may not have any money to
// start with. so ask how much they are willing to spend on infrastructure etc."; "Lets be able to change the budget as
// well"): whole dollars to start and each month, kept by the home (home/src/about.ts). The choices offered, and the
// words for one. Pure, so a test can read it; ui/Budget.tsx draws the choices.

export type Budget = { start: number; month: number };

/** The choices, nothing first: a fine answer, and the board takes it as that until you say. */
export const TIERS: readonly { id: "nothing" | "little" | "some" | "more"; label: string; budget: Budget }[] = [
  { id: "nothing", label: "Nothing yet", budget: { start: 0, month: 0 } },
  { id: "little", label: "A little", budget: { start: 50, month: 20 } },
  { id: "some", label: "Some", budget: { start: 250, month: 100 } },
  { id: "more", label: "More", budget: { start: 1000, month: 500 } },
];

/** The most either amount can be (the home's BUDGET_MAX). */
export const BUDGET_MAX = 10_000_000;

/** Dollars as a person writes them: $0, $50, $1,000. */
export const dollars = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;

const free = (b: Budget): boolean => b.start === 0 && b.month === 0;

/** A budget in words: "nothing yet, free tools only", "$50 to start, $20 a month". */
export function budgetWords(b: Budget): string {
  return free(b) ? "nothing yet, free tools only" : `${dollars(b.start)} to start, ${dollars(b.month)} a month`;
}

/** What an idea costs, in words, as its card shows it. */
export function costWords(start: number, month: number): string {
  return start === 0 && month === 0 ? "Nothing: free tools and free tiers" : `${dollars(start)} to start, ${dollars(month)} a month`;
}

/** Which choice a budget is: one of the four, "own" for amounts of your own, null when never said. */
export function tierOf(b: Budget | null | undefined): (typeof TIERS)[number]["id"] | "own" | null {
  if (!b) return null;
  return TIERS.find((t) => t.budget.start === b.start && t.budget.month === b.month)?.id ?? "own";
}

/** Your own amounts, as typed: whole dollars, 0 or more ("$1,000" and "1000" alike); a field left empty is nothing. */
export function checkBudget(start: string, month: string): { ok: true; budget: Budget } | { ok: false; why: string } {
  const read = (s: string): number | null => {
    const t = s.replace(/[$,\s]/g, "");
    if (!t) return 0;
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    return Math.round(Number(t));
  };
  const a = read(start);
  const b = read(month);
  if (a === null || b === null) return { ok: false, why: "Amounts in dollars, like 50." };
  if (a > BUDGET_MAX || b > BUDGET_MAX) return { ok: false, why: `${dollars(BUDGET_MAX)} at most.` };
  return { ok: true, budget: { start: a, month: b } };
}
