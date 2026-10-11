// Tools by kind (owner, 10-07: "we also want to see where we can cut token use but also keep the same functions so to
// say, and consistency without centralizing everything either"; then, of tools by department: "do both"). Every
// request carried every tool, some 5,000 tokens of them, whatever the orb did. Now a tool that only some work needs
// names its group here, in its own module (`ToolDef.group`); an orb starts a run with the shared tools (no group) and
// the groups its department uses, and loads any other with `more_tools` when its work needs it: nothing is taken
// away. A session's turn has the plans and the team; a tool already used in the conversation stays loaded.
//
// Only the groups' names, what each is for and which departments start with it are here; which tool is in which group is
// said where the tool is written.

/** A kind of tool, and the departments (home's SPECIALTY_FAMILIES) that start a run with it, or only the specialties that
 * do (a department's every orb carrying a specialist's tools would cost them all tokens for nothing). */
export type ToolGroup = { id: string; about: string; families: readonly string[]; specialties?: readonly string[] };

export const GROUPS = {
  day: { id: "day", about: "the person's day: reminders and bills, schedules, their mail and calendars", families: ["life", "finance", "business", "exec"] },
  plans: { id: "plans", about: "plans in the house format and their rows: propose a plan, use a template, start a row, check it, review one", families: ["build", "think", "make", "exec"] },
  team: { id: "team", about: "working on a plan with other orbs: take rows, hand off, propose and agree changes, record a decision, who fits a row, pass a habit on", families: ["exec"] },
  computer: { id: "computer", about: "your own browser: open a page, read it, click, type, sign in, check a page you built", families: ["build", "make", "business", "life"] },
  reading: { id: "reading", about: "the office's reading library: follow a site, search and read what it has read, unfollow", families: ["think", "finance", "exec"] },
  // reverse engineering (PLAN 4.8; owner, 10-10): the Reverse Engineer's, and the Guardian's (security), by specialty
  reverse: { id: "reverse", about: "reverse engineering, statically: a binary's anatomy (ELF, PE, Mach-O), a JavaScript or Electron app, a smart contract's bytecode, a network capture", families: [], specialties: ["reverse", "security"] },
  // the desk (PLAN 5.25): its department's, and the money orbs' by specialty
  desk: { id: "desk", about: "the desk: prices and charts of the majors and of any token on a DEX by its name or address (pump.fun's too), what a token can do to its holders, strategies backtested and run on its account, orders placed on that account, notes on a coin, the person's wallets (read only)", families: ["desk"], specialties: ["investor", "crypto", "fundamentals", "cfo"] },
} as const satisfies Record<string, ToolGroup>;

/** The groups a run starts with: its department's; every group for an all-rounder; the plans and the team in a session. */
export function startingGroups(o: { family: string | null; specialty: string | null; session: boolean }): Set<string> {
  const all = Object.values(GROUPS) as ToolGroup[];
  if (o.specialty === "general" || o.family === null) return new Set(all.map((g) => g.id));
  const out = new Set(all.filter((g) => g.families.includes(o.family!) || (o.specialty !== null && g.specialties?.includes(o.specialty))).map((g) => g.id));
  if (o.session) for (const g of [GROUPS.plans, GROUPS.team]) out.add(g.id);
  return out;
}
