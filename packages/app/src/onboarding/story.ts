// The first open (PLAN 2.5; owner, 2026-10-01: "when a user opens the app for the first time we
// want an onboarding process. a fun one, like what should we call you? backstory for the orbs,
// your their new CEO etc"). It plays like the opening of a game: Ash wakes up at his desk, asks
// what to call you, tells you about the office, and makes you its CEO; the crew says hello; you
// make your first hire, or look around first. The story is data, here, so a check can read every
// line; `Onboarding.tsx` plays it.

export type Person = { name: string; since: number };

/** One beat. A line is said by an orb in the office ("Ash", "Benny"…); `{name}` is the person. */
export type Beat =
  | { kind: "say"; who: string; text: string }
  | { kind: "ask-name" }
  | { kind: "ceo" }
  | { kind: "crew" }
  | { kind: "hire" };

export const STORY: readonly Beat[] = [
  { kind: "say", who: "Ash", text: "Oh! Hello. Sorry, I was asleep at my desk." },
  { kind: "say", who: "Ash", text: "I'm Ash. I'm an orb: a little glass someone who lives on your computer and gets things done." },
  { kind: "say", who: "Ash", text: "Before anything else, what should we call you?" },
  { kind: "ask-name" },
  { kind: "say", who: "Ash", text: "{name}. Nice. That has a ring to it." },
  { kind: "say", who: "Ash", text: "Here's the thing. There's a whole office of us in here. We plan, we build, we keep the books, we even plan dinner." },
  { kind: "say", who: "Ash", text: "We've been tidying our desks for weeks, waiting for someone to lead us." },
  { kind: "say", who: "Ash", text: "So, {name}, if you'll take the job..." },
  { kind: "ceo" },
  { kind: "say", who: "Ash", text: "Congratulations, boss. You're our new CEO." },
  { kind: "crew" },
  { kind: "say", who: "Ash", text: "Everyone, this is {name}. Be nice." },
  { kind: "say", who: "Benny", text: "Can we have a party?" },
  { kind: "say", who: "Hazel", text: "After the work, Benny." },
  { kind: "say", who: "Ash", text: "Here's how it works. You hand us work, we do it, and anything that matters waits for your OK." },
  { kind: "say", who: "Ash", text: "And every night we practise, so we get quicker at the things you ask for most." },
  { kind: "say", who: "Ash", text: "Every orb you hire is yours. Name them, dress them, choose what they're good at." },
  { kind: "hire" },
];

/** A line with the person in it. */
export const line = (text: string, p: Pick<Person, "name"> | null): string => text.replaceAll("{name}", p?.name ?? "boss");

/** The first beat a skip lands on: the name, if we have none yet, else the hire. */
export function skipTo(person: Pick<Person, "name"> | null): number {
  return person ? STORY.findIndex((b) => b.kind === "hire") : STORY.findIndex((b) => b.kind === "ask-name");
}

/** What a name has to be: something to call you, short enough for a nameplate. */
export function checkName(raw: string): { ok: true; name: string } | { ok: false; why: string } {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, why: "Ash needs something to call you." };
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
