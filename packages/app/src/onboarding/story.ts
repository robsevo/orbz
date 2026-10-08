// The first open (PLAN 2.5; owner, 2026-10-01: "when a user opens the app for the first time we
// want an onboarding process. a fun one, like what should we call you? backstory for the orbs,
// your their new CEO etc", and "we should start with only 1 orb, the one we make at the
// beginning"). It plays like the opening of a game. Your first orb wakes up on an empty office
// floor, still a plain glass bean with no name; he asks what to call you, makes you the office's
// CEO, and asks you to make him: his name, his look, what he is good at. The story is data, here,
// so a check can read every line; `Onboarding.tsx` plays it.
//
// Since 10-07 (owner: "We ask for the users name yes but you are not the CEO. Your first orb is the CEO"; "You are the
// Founder of a brand new Orb startup"; "in the onboarding the user first picks his own name, the company name, hires the
// CEO and then through a little tour the user can skip if they want, they hire the personal assistant"): you give your
// name and your company's, you are its Founder, and the orb who woke up is the one you make your CEO. Once it is made,
// your CEO shows you round (the TOUR, skippable) and asks you to hire your personal assistant.
import type { Character } from "../orb/spec.ts";
import type { Budget } from "../ui/budget.ts";

/** You, as the home keeps you ("about you"): your name, since when, your company's name, and what it can spend (PLAN
 * 5.20; null or missing, never said). */
export type Person = { name: string; since: number; company?: string | null; budget?: Budget | null };

/** Who tells it: your first orb, before you have made him (a plain bean, no name yet). */
export const NEWBORN: Character = {
  name: "", personality: "steady", specialty: "ceo", seed: 7, hue: "azure", hue2: null, finish: "glass",
  shape: "bean", eyes: "classic", hat: "none", glasses: "none", voice: "am_michael", goo: 0.6,
};
/** What his nameplate says until he has a name. */
export const NEWBORN_PLATE = "Your first orb";

/** One beat. A line is said by an orb ("new" is the one you are about to make); `{name}` is you. */
export type Beat =
  | { kind: "say"; who: string; text: string }
  | { kind: "ask-name" }
  | { kind: "ask-company" }
  | { kind: "founder" }
  /** what the company can spend (PLAN 5.20; owner, 10-08: "ask how much they are willing to spend on infrastructure") */
  | { kind: "ask-budget" }
  | { kind: "brains" }
  /** a stop on the tour: a room, what it is for */
  | { kind: "tour"; room: "home" | "office" | "sessions" | "recruiter" | "org"; title: string; text: string }
  /** the making of an orb: your CEO (the story's end), or your assistant (the tour's) */
  | { kind: "hire"; role?: "ceo" | "assistant" };

export const STORY: readonly Beat[] = [
  { kind: "say", who: "new", text: "Oh! Hello. I think I just woke up." },
  { kind: "say", who: "new", text: "I'm an orb: a little glass someone who lives on your computer and gets things done." },
  { kind: "say", who: "new", text: "Before anything else, what should I call you?" },
  { kind: "ask-name" },
  { kind: "say", who: "new", text: "{name}. Nice. That has a ring to it." },
  { kind: "say", who: "new", text: "So, here's the thing. This is a brand new Orb startup, and it's yours. What's it called?" },
  { kind: "ask-company" },
  { kind: "founder" },
  { kind: "say", who: "new", text: "Congratulations, {name}. You're the Founder of {company}." },
  // what it can spend (owner, 10-08: "we have to keep in mind that the user may not have any money to start with. so ask
  // how much they are willing to spend on infrastructure etc.")
  { kind: "say", who: "new", text: "Plenty of startups begin with no money at all, and that's fine: we'll look for ways to earn that start free." },
  { kind: "ask-budget" },
  { kind: "say", who: "new", text: "Every startup starts with two: a CEO to run the company, and a personal assistant to keep your day. The rest you hire as you grow, each department with its head." },
  // the brains (owner, 10-02: "after asking name and showing CEO badge, ask user to sign into chatgpt and input gemini
  // api key and if they want to add a local coder, then go to create orb screen")
  { kind: "say", who: "new", text: "First, though, we need a brain to think with. Give us one or two, and we'll use the first that can answer." },
  { kind: "brains" },
  // the first orb is the CEO (owner, 10-07: "Your first orb is the CEO, you must appoint one before apointing any orbs")
  { kind: "say", who: "new", text: "Now, your CEO. That's me, if you'll have me: I'll run the company and chair the board. I don't have a name yet. Or a look. Will you make me?" },
  { kind: "hire", role: "ceo" },
];

/** Once your CEO is made: a little tour of the company, which you can skip, and then your personal assistant. Said by
 * your CEO ("ceo" is whoever you made it). */
export const TOUR: readonly Beat[] = [
  { kind: "say", who: "ceo", text: "Thank you, {name}. Before we hire your assistant, let me show you round {company}." },
  { kind: "tour", room: "home", title: "Your home page", text: "This is where the app opens: how the company is today, what's coming up, and who's doing best." },
  { kind: "tour", room: "office", title: "The office", text: "The office floor. You'll see us at our desks, in the Board room, and on our breaks." },
  { kind: "tour", room: "sessions", title: "Sessions", text: "Sessions are where we work on something together: we plan it out loud, then build it." },
  { kind: "tour", room: "recruiter", title: "The Recruiter", text: "Where you hire. Each department opens when you hire its head: a CTO opens Build, a CFO opens Finance." },
  { kind: "tour", room: "org", title: "The org chart and the board", text: "Who heads what, and the board, where we vote on the big decisions." },
  { kind: "say", who: "ceo", text: "That's the tour. Now, your personal assistant: they keep your day, and bring me what the company should do." },
  { kind: "hire", role: "assistant" },
];

/** The story for this office: a line is said only by one who is there (your first orb always is). */
export function storyFor(names: readonly string[]): Beat[] {
  return STORY.filter((b) => b.kind !== "say" || b.who === "new" || names.includes(b.who));
}

/** A line with the person, and their company, in it. */
export const line = (text: string, p: Pick<Person, "name" | "company"> | null): string => text.replaceAll("{name}", p?.name ?? "boss").replaceAll("{company}", p?.company ?? "your company");

/** The first beat a skip lands on: your name, then your company's, then what it can spend, if we have them not yet, else
 * the brains (setting up, not story: skipping the story never skips choosing what he thinks with), else the hire (the
 * tour's skip). */
export function skipTo(person: Pick<Person, "name" | "company" | "budget"> | null, story: readonly Beat[] = STORY): number {
  const at = (k: Beat["kind"]): number => story.findIndex((b) => b.kind === k);
  if (!person && at("ask-name") >= 0) return at("ask-name");
  if (!person?.company && at("ask-company") >= 0) return at("ask-company");
  if (!person?.budget && at("ask-budget") >= 0) return at("ask-budget");
  const brains = at("brains");
  return brains >= 0 ? brains : at("hire");
}

/** What a company's name has to be: something, and short enough for the menu (40 letters at most). */
export function checkCompany(raw: string): { ok: true; company: string } | { ok: false; why: string } {
  const company = raw.replace(/\s+/g, " ").trim();
  if (!company) return { ok: false, why: "It needs a name, even a working one." };
  if (company.length > 40) return { ok: false, why: "A little shorter (40 letters at most)." };
  return { ok: true, company };
}

/** What a name has to be: something to call you, short enough for a nameplate. */
export function checkName(raw: string): { ok: true; name: string } | { ok: false; why: string } {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, why: "I need something to call you." };
  if (name.length > 24) return { ok: false, why: "A little shorter, for the nameplate (24 letters at most)." };
  return { ok: true, name };
}

// Remembered in the browser for now: a per-person convenience until the home keeps "about you"
// (PLAN 2.4), when this moves there.
const KEY = "orbs.person";

export function loadPerson(): Person | null {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "null") as Person | null;
    return v && typeof v.name === "string" && v.name ? v : null;
  } catch {
    return null;
  }
}

export function savePerson(p: Person): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(p));
  } catch {
    // a private window: remembered for as long as the page is open
  }
}

/** `?intro=0` skips it (the render checks), the way `?splash=0` skips the splash. */
export const introWanted = (): boolean => {
  try {
    return new URLSearchParams(location.search).get("intro") !== "0";
  } catch {
    return true;
  }
};
