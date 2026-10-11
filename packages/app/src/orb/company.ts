// Who may join the company, the app's copy of the home's rule (home/src/company.ts; PLAN 5.13; owner, 10-07: "for every
// section in recruiter they need to unlock, they need to hire the cfo for example first, but ceo and personal assistant
// is mandatory"). The CEO and your personal assistant come first, in that order; then the Executive is open, and every
// other department opens with its head. test/company.test.ts holds the two to the same answers, so the creator and the
// Recruiter never offer what the home would refuse.
import { FAMILIES, SPECIALTIES, type Family, type SpecialtyName } from "./spec.ts";
import { NAMES } from "../floor/props.ts";

export const FOUNDING: readonly SpecialtyName[] = ["ceo", "assistant"];
export const HEAD_OF: Record<Family, SpecialtyName> = { exec: "ceo", build: "cto", think: "chiefofstaff", make: "cmo", finance: "cfo", business: "coo", life: "assistant", desk: "deskhead" };
const POST: Partial<Record<SpecialtyName, string>> = { ceo: "CEO", assistant: "personal assistant", cfo: "CFO", cto: "CTO", chiefofstaff: "Chief of Staff", cmo: "CMO", coo: "COO", deskhead: NAMES.jobs.deskhead.title };
const DEPARTMENT: Record<Family, string> = { exec: "the Executive", build: "Build", think: "Think", make: "Make", finance: "Finance", business: "Business", life: "Life", desk: NAMES.dept };

/** Who is to be appointed next, while the CEO and your assistant are not both in. */
export function nextFounding(office: readonly string[]): SpecialtyName | null {
  return FOUNDING.find((r) => !office.includes(r)) ?? null;
}

/** Why an orb of this kind cannot join the office as it is (its orbs' specialties), or null when it can. */
export function whyNot(specialty: string, office: readonly string[]): string | null {
  const next = nextFounding(office);
  if (next && specialty !== next) return `Appoint your ${POST[next]} first: your CEO and your personal assistant come before anyone else.`;
  const family = SPECIALTIES[specialty as SpecialtyName]?.family as Family | undefined;
  if (!family || family === "exec") return null;
  const head = HEAD_OF[family];
  if (specialty !== head && !office.includes(head)) return `Hire a ${POST[head]} first: they open ${DEPARTMENT[family]}.`;
  return null;
}

/** Which departments are open for hiring. */
export function openDepartments(office: readonly string[]): Family[] {
  if (nextFounding(office)) return [];
  return (Object.keys(FAMILIES) as Family[]).filter((f) => f === "exec" || office.includes(HEAD_OF[f]));
}

/** A department's head's post, in words ("a CTO"). */
export const headOf = (f: Family): string => POST[HEAD_OF[f]] ?? SPECIALTIES[HEAD_OF[f]].label;
