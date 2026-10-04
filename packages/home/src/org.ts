// How the org works (PLAN 5.4), all by code: who leads each kind of work, and which orb fits a
// plan's row.
//
//   leadsOf    the Chief leads everything; under him each specialty's top-ranked orb leads that
//              kind of work (the first hired, on a tie, which is the first of a kind: he starts as
//              its Senior, owner 10-02)
//   areaOfText a row's area from its words: the files it names, by their kind (as specialty.ts
//              reads a run's), and the work it names ("invoice" is finance, "landing page" frontend)
//   whoFits    for a row: first the orbs whose specialty covers its area, then by the XP their
//              runs earned there (the radar), then by level, then who joined first; each with a line
//              of why, so the lead hands it on with a reason
import type { Specialty } from "./brain/constitution.ts";
import type { ToolDef } from "./agent/tools.ts";
import type { EventLog } from "./events.ts";
import { AREAS_OF, LEVELS, type Level } from "./gym/levels.ts";
import { AREAS, type Area, BY_EXTENSION, radarOf } from "./gym/specialty.ts";
import type { Diploma } from "./school/school.ts";
import { inSubject } from "./school/subjects.ts";

export type Member = { id: string; name: string; specialty: Specialty; level: Level; createdAt: number };

/** Work words, in the order they are tried; a file a row names counts first. */
const WORK: [RegExp, Area][] = [
  [/\b(invoices?|receipts?|budgets?|tax(es)?|payments?|ledger|expenses?|payroll)\b/i, "finance"],
  [/\b(pages?|buttons?|layouts?|css|components?|screens?|forms?|landing|responsive|navigation|menu)\b/i, "frontend"],
  [/\b(api|servers?|endpoints?|databases?|schemas?|migrations?|routes?|queues?|workers?|backend)\b/i, "backend"],
  [/\b(csv|spreadsheets?|charts?|datasets?|queries|query|sql|metrics|analysis|analytics)\b/i, "data"],
  [/\b(deploy(ment)?|docker|ci|pipelines?|nginx|systemd|backups?|hosting|dns)\b/i, "devops"],
  [/\b(logos?|icons?|mockups?|palettes?|illustrations?|brand(ing)?|typography|wireframes?)\b/i, "design"],
  [/\b(research|compare|sources?|survey|competitors?|market)\b/i, "research"],
  [/\b(write|writing|drafts?|copy|blog|articles?|docs|documentation|readme|newsletter|posts?)\b/i, "writing"],
  [/\b(emails?|inbox|mail|replies|reply)\b/i, "inbox"],
  [/\b(calendar|meetings?|schedule|appointments?)\b/i, "scheduling"],
  [/\b(bookings?|flights?|hotels?|reservations?|tickets?)\b/i, "bookings"],
  [/\b(lessons?|teach|tutor(ing)?|quiz(zes)?)\b/i, "teaching"],
];

/** A plan row's area by code: the kind of the files it names first, then the work it names. */
export function areaOfText(text: string): Area | null {
  for (const m of text.matchAll(/[\w./-]+\.(\w+)\b/g)) {
    const a = BY_EXTENSION[m[1]!.toLowerCase()];
    if (a) return a;
  }
  return WORK.find(([re]) => re.test(text))?.[1] ?? null;
}

const rank = (m: Member): number => LEVELS.indexOf(m.level);

/** Who leads what: the Chief (if there is one), and per specialty its top-ranked orb, the first to
 * join on a tie. */
export function leadsOf(team: Member[]): { chief: string | null; bySpecialty: Map<Specialty, string> } {
  const chief = team.find((m) => m.level === "Chief")?.id ?? null;
  const by = new Map<Specialty, string>();
  for (const m of [...team].sort((a, b) => rank(b) - rank(a) || a.createdAt - b.createdAt)) if (!by.has(m.specialty)) by.set(m.specialty, m.id);
  return { chief, bySpecialty: by };
}

/** What a diploma in a row's subject counts for when ranking (school, PLAN 5.7: "it should be put into
 * consideration, whos more qualified for the job"): this much XP, in the ranking only, never in the
 * ledger (a diploma never promotes). */
export const DIPLOMA_XP = 150;

/** The team ranked for a row, best first, each with why. */
export function whoFits(events: EventLog, text: string, team: Member[], diplomas: (orb: string) => Diploma[] = () => []): { orb: string; name: string; why: string }[] {
  const area = areaOfText(text);
  const covers = (m: Member): boolean => area === null || (AREAS_OF[m.specialty] ?? [...AREAS]).includes(area);
  const xp = new Map(team.map((m) => [m.id, area ? radarOf(events, m.id)[area].xp : 0]));
  const studied = new Map(team.map((m) => [m.id, diplomas(m.id).find((d) => inSubject(text, d.kind, d.name)) ?? null]));
  const weight = (m: Member): number => xp.get(m.id)! + (studied.get(m.id) ? DIPLOMA_XP : 0);
  return [...team]
    .sort((a, b) => Number(covers(b)) - Number(covers(a)) || weight(b) - weight(a) || rank(b) - rank(a) || a.createdAt - b.createdAt)
    .map((m) => ({
      orb: m.id,
      name: m.name,
      why: [area ? (covers(m) ? `${area} is ${m.name}'s kind of work` : `${area} is not ${m.name}'s kind of work`) : "the row names no kind of work", area ? `${xp.get(m.id)} XP in ${area}` : null, studied.get(m.id) ? `a diploma in ${studied.get(m.id)!.name}` : null, m.level].filter(Boolean).join("; "),
    }));
}

const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));

/** The org's tools: who fits a row (for a session's lead) and passing a habit on (mentoring). */
export function orgTools(o: {
  events: EventLog;
  dataDir: string;
  /** The office, each with his level now. */
  office: () => Member[];
  /** The orbs working a conversation's session tab, or null outside one. */
  tabOf: (conversation: string) => string[] | null;
  /** A plan's row text, from the plan as shown. */
  rowText: (plan: number, row: string) => string | null;
  habits: (orb: string) => { task: string; version: number }[];
  share: (from: string, to: string, task: string) => { task: string };
  /** An orb's diplomas from school (PLAN 5.7), which count when ranking who fits a row. */
  diplomas?: (orb: string) => Diploma[];
}): ToolDef[] {
  const nameOf = (id: string): string => o.office().find((m) => m.id === id)?.name ?? id;
  return [
    {
      name: "who_fits",
      label: "Finding who fits",
      description:
        "For a row of the session's approved plan: the orbs of this tab ranked for it (its kind of work, the XP they earned in it, their level), each with why. As the lead, hand each row to the best fit (ask_orb).",
      parameters: { type: "object", properties: { plan: { type: "number" }, row: { type: "string" } }, required: ["plan", "row"], additionalProperties: false },
      describe: (a) => `who fits row ${str(a.row)} of plan ${str(a.plan)}`,
      decision: "allow",
      async run(a, ctx) {
        const members = o.tabOf(ctx.conversation);
        if (!members) return { content: "That is for a session's work: this is not a session.", isError: true };
        const text = o.rowText(Number(a.plan), str(a.row));
        if (text === null) return { content: `plan ${str(a.plan)} has no row ${str(a.row)}`, isError: true };
        const team = o.office().filter((m) => members.includes(m.id));
        const ranked = whoFits(o.events, text, team, o.diplomas);
        return { content: ranked.map((r, i) => `${i + 1}. ${r.name}: ${r.why}`).join("\n") || "No one works this tab." };
      },
    },
    {
      name: "share_habit",
      label: "Passing a habit on",
      description:
        "Mentoring: pass one of your habits (by its task) to a junior of your own kind. It becomes the junior's, under the junior's own rules; yours stays yours. Name no task to see your habits. The person says yes first.",
      parameters: { type: "object", properties: { to: { type: "string", description: "The junior's name." }, task: { type: "string" } }, required: ["to"], additionalProperties: false },
      describe: (a) => `pass the habit ${str(a.task)} on to ${str(a.to)}`,
      decision: "ask",
      precheck: (a, ctx) => {
        const office = o.office();
        const me = office.find((m) => m.id === ctx.orb);
        const them = office.find((m) => m.name.toLowerCase() === str(a.to).trim().toLowerCase());
        if (!me || !them) return `${str(a.to)} is not in the office.`;
        if (LEVELS.indexOf(me.level) < LEVELS.indexOf("Senior")) return "Mentoring is a Senior's: pass habits on once you are one.";
        if (them.specialty !== me.specialty) return `${them.name} does ${them.specialty} work, not ${me.specialty}: a habit is passed to a junior of your own kind.`;
        if (LEVELS.indexOf(them.level) >= LEVELS.indexOf(me.level)) return `${them.name} is not junior to you.`;
        const mine = o.habits(ctx.orb);
        if (!str(a.task)) return mine.length ? `Name the task. Your habits: ${mine.map((h) => h.task).join("; ")}` : "You have no habits yet.";
        if (!mine.some((h) => h.task === str(a.task))) return `You have no habit for ${str(a.task)}.`;
        return null;
      },
      async run(a, ctx) {
        const them = o.office().find((m) => m.name.toLowerCase() === str(a.to).trim().toLowerCase())!;
        const got = o.share(ctx.orb, them.id, str(a.task));
        ctx.note?.(`${nameOf(ctx.orb)} passed a habit to ${them.name}: ${got.task}.`, { shared: got.task });
        return { content: `Passed on: ${them.name} has it now, as ${got.task}, under ${them.name}'s own rules.` };
      },
    },
  ];
}
