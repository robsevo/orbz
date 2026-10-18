// The company (PLAN 5.13, 5.14; owner, 10-07): "You are the Founder of a brand new Orb startup"; "Your first orb is
// the CEO, you must appoint one before apointing any orbs, and a personal assistant"; "these two work in tandem yo give
// you what you need ... find a strucure for those two to work in tandem"; "the role of the CFO is to keep all info there
// for you"; "and the orbs really do listen"; then "for every section in recruiter they need to unlock, they need to hire
// the cfo for example first, but ceo and personal assistant is mandatory".
//
// The CEO and your personal assistant are appointed first, in that order, and nothing else joins before both are in.
// Then the Executive is open, and every other department opens with its head: Build with a CTO, Think with a Chief of
// Staff, Make with a CMO, Finance with a CFO, Business with a COO (Life's head is your assistant, in from the start).
// Pure, so the door, the recruiter and the app's own check are the one rule (`whyNot`).
//
// The tandem, said to each in its standing context (`companyLine`): the assistant keeps your day and is your way in;
// what is company work it hands to the CEO, who decides who does it and leads it, and sends the result back to you
// through the assistant. The CFO keeps every money record in one place (its books, and the bills: Home.plannerFor),
// and every money orb reports to it. Everyone takes direction from the CEO and follows what the board decides.
import { budgetLine, type Budget } from "./about.ts";
import { SPECIALTY_FAMILIES, type Family, type Specialty } from "./brain/constitution.ts";
import { DESK_NAMES } from "./desk/names.ts";

/** The two appointed first, in this order: nothing else joins before both are in. */
export const FOUNDING: readonly Specialty[] = ["ceo", "assistant"];

/** Each department's head, by its post (owner, 10-07: "restructure it so it fits this makes things easier to see"):
 * the Executive the CEO, Build the CTO, Think the Chief of Staff, Make the CMO, Finance the CFO, Business the COO, Life
 * your personal assistant. A department opens for hiring with its head. */
export const HEAD_OF: Record<Family, Specialty> = { exec: "ceo", build: "cto", think: "chiefofstaff", make: "cmo", finance: "cfo", business: "coo", life: "assistant", desk: "deskhead", studio: "studiohead" };
const POST: Partial<Record<Specialty, string>> = { studiohead: "Studio Head", ceo: "CEO", assistant: "personal assistant", cfo: "CFO", cto: "CTO", chiefofstaff: "Chief of Staff", cmo: "CMO", coo: "COO", deskhead: DESK_NAMES.head };
const DEPARTMENT: Record<Family, string> = { exec: "the Executive", build: "Build", think: "Think", make: "Make", finance: "Finance", business: "Business", life: "Life", desk: DESK_NAMES.dept, studio: "the Game Studio" };

/** Who is to be appointed next, while the CEO and your assistant are not both in. */
export function nextFounding(office: readonly string[]): Specialty | null {
  return FOUNDING.find((r) => !office.includes(r)) ?? null;
}

/** Why an orb of this kind cannot join the office as it is (its orbs' specialties), or null when it can. */
export function whyNot(specialty: string, office: readonly string[]): string | null {
  const next = nextFounding(office);
  if (next && specialty !== next) return `Appoint your ${POST[next]} first: your CEO and your personal assistant come before anyone else.`;
  const family = SPECIALTY_FAMILIES[specialty as Specialty];
  if (!family || family === "exec") return null; // the Executive is open once the two are in
  const head = HEAD_OF[family];
  if (specialty !== head && !office.includes(head)) return `Hire a ${POST[head]} first: they open ${DEPARTMENT[family]}.`;
  return null;
}

/** Which departments are open for hiring in an office as it is (its orbs' specialties). */
export function openDepartments(office: readonly string[]): Family[] {
  if (nextFounding(office)) return [];
  return (Object.keys(HEAD_OF) as Family[]).filter((f) => f === "exec" || office.includes(HEAD_OF[f]));
}

type Who = { id: string; name: string; specialty: string };

/** What an orb is told about the company and its part in it, by code; null when there is no company yet. */
export function companyLine(o: { me: Who; founder: string | null; company?: string | null; budget?: Budget | null; office: readonly Who[]; decisions?: readonly string[]; ideas?: readonly { name: string; text: string }[] }): string | null {
  const F = o.founder ?? "the Founder";
  const first = (s: string): Who | undefined => o.office.find((w) => w.specialty === s);
  const ceo = first("ceo"), pa = first("assistant"), cfo = first("cfo");
  if (!ceo && !pa && !cfo) return null;
  const who = [ceo && `${ceo.name} is the CEO and runs it`, pa && `${pa.name} is ${F}'s personal assistant`, cfo && `${cfo.name} is the CFO and keeps the books`].filter(Boolean).join("; ");
  const lines = [`The company${o.company ? `, ${o.company}` : ""}: ${F} is its Founder; ${who}. Take direction from the CEO and follow what the board decides.`];
  // what the company can spend (PLAN 5.20; owner, 10-08: "the user may not have any money to start with"), for its work
  // alone: never said is nothing, and nothing means free tools and free tiers
  const free = !o.budget || (o.budget.start === 0 && o.budget.month === 0);
  lines.push(`${budgetLine(o.budget ?? null, { founder: F, company: o.company ?? "the company" })} ${free ? "The company's work uses free tools and free tiers only, and signs up for nothing paid." : `Anything the company's work costs is ${F}'s yes first.`}`);
  // what the board has carried, newest first: every orb follows it ("and the orbs really do listen")
  if (o.decisions?.length) lines.push(`The board has decided: ${o.decisions.map((d) => `"${d}"`).join("; ")}.`);
  // the ideas the Founder approved from the board's report (PLAN 5.18), newest first: the office works toward them
  if (o.ideas?.length) lines.push(`${F} approved these ideas from the board's report: ${o.ideas.map((x) => `${x.name}'s "${x.text}"`).join("; ")}.`);
  const money = o.office.filter((w) => SPECIALTY_FAMILIES[w.specialty as Specialty] === "finance").map((w) => w.name);
  if (o.me.specialty === "ceo") {
    lines.push(`You are the CEO. ${pa ? pa.name : "The personal assistant"} keeps ${F}'s day and brings you what the company should do: take it, decide who does it (ask_orb, or a session you lead), and send ${F} the result through ${pa ? pa.name : "the assistant"} in a few lines. You chair the board.`);
  } else if (o.me.specialty === "assistant") {
    lines.push(`You are ${F}'s personal assistant: you keep their day (the calendar, reminders, mail) and you are their way into the company. Hand what is company work (building, research, marketing, money) to the CEO${ceo ? `, ${ceo.name},` : ""} with ask_orb, and bring ${F} the answer in plain words. You are the board's secretary.`);
  } else if (o.me.specialty === "cfo") {
    lines.push(`You are the CFO: you keep every money record of the company in one place, the books in your workspace (books/), and the bills are yours to keep.${money.length ? ` ${money.join(", ")} report${money.length === 1 ? "s" : ""} to you.` : ""} Every payment, trade and transfer is ${F}'s yes. You are the board's treasurer.`);
  } else if (SPECIALTY_FAMILIES[o.me.specialty as Specialty] === "finance" && cfo) {
    lines.push(`You report to the CFO, ${cfo.name}: whatever you learn or do with money, send ${cfo.name} a one-line record for the books (ask_orb).`);
  }
  return lines.join("\n");
}
