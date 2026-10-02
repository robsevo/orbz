// What rank may widen (PLAN 3.8: "rank widens the orb's freedom only for low-risk actions in its
// specialty, never the floor in code"; the owner left the line to us, 10-02). One thing only: an
// orb at WIDENS_AT or above, in a Build-family specialty, may run a single read-only command in
// its workspace without asking. It enters the decision as a default (rules/policy.ts step 3), so
// your own rules, the floor, the one-way switch and away all still raise it to an ask.
//
// Read-only means it runs no code the orb could have written: no build or test runner (`pnpm test`
// runs whatever package.json says), no git (a repository's own config can run commands), no shell
// syntax at all (no pipes, redirects, substitutions, quotes), nothing outside the workspace, and
// none of the flags that make a reader run something (`find -exec`, `rg --pre`).
import type { Family } from "../brain/constitution.ts";
import { type Level, LEVELS } from "../gym/levels.ts";

export const WIDENS_AT: Level = "Senior";

const READERS = new Set(["ls", "cat", "head", "tail", "wc", "grep", "rg", "find", "tree", "du", "stat", "file", "diff", "pwd"]);
const SYNTAX = /[;&|`$<>(){}\\\n\r'"]/;
const RUNS_SOMETHING = /^(-exec|-execdir|-ok|-okdir|-delete|-fprint|-fprint0|-fprintf|-fls|--pre(=.*)?)$/;

/** A single command that only reads, inside the workspace. */
export function readOnlyCommand(command: string): boolean {
  const c = command.trim();
  if (!c || SYNTAX.test(c)) return false;
  const [program, ...rest] = c.split(/\s+/);
  if (!READERS.has(program!)) return false;
  return rest.every((t) => !RUNS_SOMETHING.test(t) && !t.startsWith("/") && !t.startsWith("~") && !t.split("/").includes(".."));
}

/** Why rank lets this call go without asking, or null. */
export function rankWidens(o: { level: Level; family: Family; command: string; background: boolean }): string | null {
  if (LEVELS.indexOf(o.level) < LEVELS.indexOf(WIDENS_AT) || o.family !== "build" || o.background || !readOnlyCommand(o.command)) return null;
  return `a ${o.level}'s read-only command in its own workspace`;
}
