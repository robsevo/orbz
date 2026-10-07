// The company (PLAN 5.13, 5.14; owner, 10-07): "You are the Founder of a brand new Orb startup"; "Your first orb is
// the CEO, you must appoint one before apointing any orbs, and a personal assistant ... they must have a CFO appointed
// before touching any orbs that have to do with money, investing, and crypto so those 3 need to be appointed at the
// beginning"; "these two work in tandem yo give you what you need ... find a strucure for those two to work in tandem";
// "the role of the CFO is to keep all info there for you"; "and the orbs really do listen".
//
// The founding three are appointed in order (the CEO, your personal assistant, the CFO), and nothing else joins
// before they are all in; a money orb (Finance) never joins without a CFO. Pure, so the door, the recruiter and the
// app's own check are the one rule (`whyNot`).
//
// The tandem, said to each in its standing context (`companyLine`): the assistant keeps your day and is your way in;
// what is company work it hands to the CEO, who decides who does it and leads it, and sends the result back to you
// through the assistant. The CFO keeps every money record in one place (its books, and the bills: Home.plannerFor),
// and every money orb reports to it. Everyone takes direction from the CEO and follows what the board decides.
import { SPECIALTY_FAMILIES, type Specialty } from "./brain/constitution.ts";

/** The founding three, in the order they are appointed. */
export const FOUNDING: readonly Specialty[] = ["ceo", "assistant", "cfo"];
const POST: Partial<Record<Specialty, string>> = { ceo: "CEO", assistant: "personal assistant", cfo: "CFO" };

/** Who is to be appointed next, while the founding three are not all in. */
export function nextFounding(office: readonly string[]): Specialty | null {
  return FOUNDING.find((r) => !office.includes(r)) ?? null;
}

/** Why an orb of this kind cannot join the office as it is (its orbs' specialties), or null when it can. */
export function whyNot(specialty: string, office: readonly string[]): string | null {
  const next = nextFounding(office);
  if (next && specialty !== next) return `Appoint your ${POST[next]} first: the CEO, your personal assistant and the CFO come before anyone else.`;
  if (SPECIALTY_FAMILIES[specialty as Specialty] === "finance" && !office.includes("cfo")) return "Appoint a CFO first: every money orb answers to one.";
  return null;
}

type Who = { id: string; name: string; specialty: string };

/** What an orb is told about the company and its part in it, by code; null when there is no company yet. */
export function companyLine(o: { me: Who; founder: string | null; office: readonly Who[] }): string | null {
  const F = o.founder ?? "the Founder";
  const first = (s: string): Who | undefined => o.office.find((w) => w.specialty === s);
  const ceo = first("ceo"), pa = first("assistant"), cfo = first("cfo");
  if (!ceo && !pa && !cfo) return null;
  const who = [ceo && `${ceo.name} is the CEO and runs it`, pa && `${pa.name} is ${F}'s personal assistant`, cfo && `${cfo.name} is the CFO and keeps the books`].filter(Boolean).join("; ");
  const lines = [`The company: ${F} is its Founder; ${who}. Take direction from the CEO and follow what the board decides.`];
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
