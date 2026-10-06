// The standing context (PLAN 1.5): what every request to the model starts with. Rebuilt for every
// request and never stored in the conversation, so compaction, /clear and a restart can neither
// lose it nor say it twice (Ash's context-survival lesson: the block that IS the brain was lost
// after compaction, and duplicated by re-injection).
//
// Orbs writes only the first lines (who the orb is, where it works, and when it is: owner, 10-05, an orb
// that did not know the date could not keep "pick the kids up at 5 tomorrow"). Everything else is the
// owner's, read as it is (CLAUDE.md rule 6): each skill's name and description from
// <data>/brain/skills/*/SKILL.md, <data>/brain/memory/MEMORY.md, and <data>/brain/CONSTITUTION.md,
// of which each orb loads his own part (PLAN 3.9, brain/constitution.ts: the core and his
// specialty's sections, morals left out), with the lines the person approved for him.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { composeConstitution, sectioned, type Specialty } from "../brain/constitution.ts";

/** His turn in a session (team.ts): which tab, and who else is in it. */
export type TeamTurn = { session: number; title: string; tab: "brainstorm" | "floor"; with: string[] };

const TAB_RULE: Record<TeamTurn["tab"], string> = {
  // what the person asks of you for themselves is done here, not held over (owner, 10-05: "why wasnt he able to
  // add things to my calendar?", asked in a Brainstorm that said "do not do the work here")
  brainstorm: "This is the Brainstorm: ideas, questions, trade-offs, out loud and brief. Build on what the others said instead of repeating it, disagree when you do, and when you all agree on something, record it with the agree tool. The session's bigger work is for the Floor; but what the person asks you for directly (a reminder or a bill to keep, a quick answer, a recipe) do now, with your tools.",
  floor: "This is the Floor: do the agreed work, your part of it, with your tools, and say in a line or two what you did. Ask the person before anything that matters.",
};

/** Plain spoken English (PLAN 4.7; ASD-STE100 at about 80%, Andrej Karpathy's tip): for a reply the
 * person will hear, not read. Its plain words are swapped in again by code before he says it (the
 * kit's voicebox.plain); this is the part only the writer can do. */
export const ALOUD =
  "The person spoke to you, and will hear your answer read aloud: say it in plain spoken English. Short sentences of up to about 20 words, one idea each. Active voice, the action first. Common words, and the same word for the same thing. No lists, tables, headings or code: say the two or three things that matter, in order. Keep your own warmth and personality.";

/** No orb is a he or a she (owner, 10-03: "dont have the orbs be male or female at all"): what an
 * orb says is on the person's screen, so it names another orb, as the app does. */
export const NO_HE_OR_SHE = "No orb is a he or a she: say another orb's name (\"Pip's page\"), never he, she, his or her for an orb.";

export function standingContext(o: { orbName: string; brainDir: string; workspace: string; specialty?: Specialty; learned?: string[]; notebook?: { subject: string; text: string }[]; colleagues?: string | null; team?: TeamTurn; aloud?: boolean; now?: number }): string {
  const parts = [
    `You are ${o.orbName}, one of the person's orbs: an AI character and assistant that works on its own computer and asks before anything that matters.`,
    NO_HE_OR_SHE,
    `Working directory: ${o.workspace}`,
  ];
  if (o.now !== undefined) parts.push(nowLine(o.now));
  if (o.aloud) parts.push(ALOUD);
  if (o.team) {
    const others = o.team.with.filter((n) => n !== o.orbName);
    parts.push(
      `You are in a session, "${o.team.title}", with ${others.length ? others.join(", ") : "no other orb"} and the person. Messages from another orb come as "[Name]: ...". It is your turn: speak as yourself, ${o.orbName}, once. ${TAB_RULE[o.team.tab]}`,
    );
  }
  const owner = read(join(o.brainDir, "CONSTITUTION.md"));
  // a file not in sections (no ## or ### heading) is read whole, as before
  const cut = Boolean(owner) && sectioned(owner);
  const constitution = cut ? composeConstitution({ owner, specialty: o.specialty ?? "general", orbName: o.orbName, learned: o.learned }) : owner;
  if (constitution) parts.push(constitution);
  if (!cut && o.learned?.length) parts.push(`What you have learned (each line approved by the person):\n${o.learned.map((l) => `- ${l}`).join("\n")}`);
  // school (PLAN 5.7): each note was kept only because the exam scored higher with it
  if (!cut && o.notebook?.length) parts.push(`What you learned at school (your notebook):\n${o.notebook.map((n) => `- ${n.subject}: ${n.text}`).join("\n")}`);
  if (o.colleagues) parts.push(o.colleagues); // its friends and frictions in the office (PLAN 5.9)
  const skills = skillsIndex(join(o.brainDir, "skills"));
  if (skills) parts.push(`Skills you can use:\n${skills}`);
  const memory = read(join(o.brainDir, "memory", "MEMORY.md"));
  if (memory) parts.push(`What you remember (the index):\n${memory}`);
  return parts.join("\n\n");
}

/** The day and the time where the person is, today's and tomorrow's dates as the tools write them. */
export function nowLine(now: number): string {
  const d = new Date(now);
  const day = (x: Date): string => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  const said = d.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `It is ${said} where the person is (${zone}): today is ${day(d)}, tomorrow ${day(next)}. Work dates out from this ("the 16th" is the next 16th to come), and ask only when it is truly unclear.`;
}

function read(file: string): string {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function skillsIndex(dir: string): string {
  if (!existsSync(dir)) return "";
  const lines: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const text = read(join(dir, name, "SKILL.md"));
    if (!text) continue;
    const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    const field = (k: string): string => new RegExp(`^${k}:\\s*(.*)$`, "m").exec(front)?.[1]?.trim() ?? "";
    lines.push(`- ${field("name") || name}: ${field("description") || "(no description)"}`);
  }
  return lines.join("\n");
}
