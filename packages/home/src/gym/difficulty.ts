// How hard a job was, in its own area (owner, 10-10: "Make exp points earned have different weights based on difficulty
// in their domain"). A job you approve used to earn by its tool calls alone, so a reminder set in five calls earned
// what a feature across six files with its tests did. Now each area (specialty.ts's AREAS, the run's own by code) has
// its own measure of work, in the units that make a job hard there, and four tiers on it:
//   code (frontend, backend, data, devops, design)  files, lines written, checks run, problems fixed on the way
//   research                                        sources read, searches, pages
//   writing                                         words written, files, sources
//   inbox, scheduling, bookings, finance, teaching  the items handled
//   untagged                                        the tool calls
// All of it read off the run's trace by code (rule 8: never what the orb says about its work). Easy, standard, hard
// and expert earn 10, 25, 40 and 60 XP (xp.ts XP.job), under the same daily cap.
import type { EventLog } from "../events.ts";
import { trace } from "../agent/trace.ts";
import { tagRun, type Area } from "./specialty.ts";

export const TIERS = ["easy", "standard", "hard", "expert"] as const;
export type Tier = (typeof TIERS)[number];

export type Measures = {
  /** tool calls, and how many kinds of tool */
  calls: number; tools: number;
  /** files written, their lines, and words written (files and the final reply) */
  files: number; lines: number; words: number;
  /** commands run, those that check work (tests, builds, linters), and failed steps put right later in the run */
  commands: number; checks: number; recovered: number;
  /** pages read, the sites they came from, searches */
  pages: number; sources: number; searches: number;
  /** what a mail, calendar, reminder or lesson job handles: one a call */
  items: number;
};

type Scale = { unit: (m: Measures) => number; at: readonly [standard: number, hard: number, expert: number]; says: (m: Measures) => string };

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const list = (parts: (string | null)[]): string => parts.filter(Boolean).join(", ");

const CODE: Scale = {
  unit: (m) => m.files + m.lines / 60 + 2 * m.checks + 2 * m.recovered,
  at: [2, 6, 12],
  says: (m) => list([plural(m.files, "file"), m.lines ? plural(m.lines, "line") : null, m.checks ? plural(m.checks, "check") : null, m.recovered ? plural(m.recovered, "fix", "fixes") : null]),
};
const ITEMS = (at: Scale["at"], what: string): Scale => ({ unit: (m) => m.items, at, says: (m) => plural(m.items, what) });

/** Each area's own measure of work and where its tiers begin (standard, hard, expert). */
export const SCALES: Record<Area | "other", Scale> = {
  frontend: CODE, backend: CODE, data: CODE, devops: CODE, design: CODE,
  research: {
    unit: (m) => m.sources + m.searches / 2 + m.pages / 3,
    at: [2, 5, 9],
    says: (m) => list([plural(m.sources, "source"), m.searches ? plural(m.searches, "search", "searches") : null, m.pages ? plural(m.pages, "page") : null]),
  },
  writing: {
    unit: (m) => m.words / 250 + m.files / 2 + m.sources / 2,
    at: [1.5, 4, 8],
    says: (m) => list([plural(m.words, "word"), m.files ? plural(m.files, "file") : null, m.sources ? plural(m.sources, "source") : null]),
  },
  inbox: ITEMS([2, 5, 10], "mail"),
  scheduling: ITEMS([2, 4, 8], "item"),
  bookings: { unit: (m) => m.items + m.pages / 2, at: [3, 6, 12], says: (m) => list([plural(m.items, "item"), m.pages ? plural(m.pages, "page") : null]) },
  finance: { unit: (m) => m.items + m.files + 2 * m.checks, at: [2, 5, 10], says: (m) => list([plural(m.items, "item"), m.files ? plural(m.files, "file") : null, m.checks ? plural(m.checks, "check") : null]) },
  teaching: ITEMS([3, 6, 12], "step"),
  desk: ITEMS([3, 6, 12], "desk step"),
  other: { unit: (m) => m.calls, at: [3, 8, 15], says: (m) => plural(m.calls, "step") },
};

/** A tier from a measure and where an area's tiers begin. */
export const tierOf = (unit: number, at: Scale["at"]): Tier => (unit >= at[2] ? "expert" : unit >= at[1] ? "hard" : unit >= at[0] ? "standard" : "easy");

const CHECK = /\b(test|tests|pytest|jest|vitest|mocha|tsc|eslint|ruff|mypy|clippy|build|check|lint|typecheck)\b|\bcargo\s+(test|build|check)\b|\bgo\s+(test|build|vet)\b|\bmake\b/;
const TEXT = /\.(md|txt|html?|docx?|rtf|tex)$/i;
const ITEM_TOOLS = /^(read_mail|draft_reply|remind|move_reminder|list_reminders|schedule_job|read_calendar|ask_day|teach|lesson_step|market_prices|market_chart|backtest_strategy|propose_strategy|run_strategy|place_order|desk_book|market_note|wallet_holdings)$|^mcp__/;
const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []); // a list in a call's arguments, or none
const wordCount = (t: string): number => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

/** What one run did, measured from its trace. */
export function measure(events: EventLog, run: number): Measures {
  const m: Measures = { calls: 0, tools: 0, files: 0, lines: 0, words: 0, commands: 0, checks: 0, recovered: 0, pages: 0, sources: 0, searches: 0, items: 0 };
  const tools = new Set<string>();
  const files = new Set<string>();
  const hosts = new Set<string>();
  const failed = new Set<string>(); // tools that failed and are waiting to be put right
  const examined = new Set<string>(); // what a reverse engineer read (PLAN 4.8): each a source of its own
  for (const s of trace(events, run)) {
    if (s.kind === "model") {
      for (const c of (s.data.tool_calls ?? []) as { name: string; arguments: string }[]) {
        let a: Record<string, unknown> = {};
        try {
          a = JSON.parse(c.arguments || "{}") as Record<string, unknown>;
        } catch {
          /* the call as written */
        }
        m.calls++;
        tools.add(c.name);
        if (c.name === "write_file" && typeof a.path === "string") {
          files.add(a.path);
          const content = typeof a.content === "string" ? a.content : "";
          m.lines += content ? content.split("\n").length : 0;
          if (TEXT.test(a.path)) m.words += wordCount(content);
        }
        if (c.name === "shell" && typeof a.command === "string") {
          m.commands++;
          if (CHECK.test(a.command)) m.checks++;
        }
        if (c.name === "check_page") m.checks++;
        if (c.name === "web_fetch" || c.name === "read_page" || c.name === "open_page" || c.name === "read_reading") {
          m.pages++;
          const h = typeof a.url === "string" ? hostOf(a.url) : null;
          if (h) hosts.add(h);
        }
        if (c.name === "web_search" || c.name === "search_reading") m.searches++;
        if (/^inspect_(binary|app|contract|capture)$/.test(c.name)) examined.add(typeof a.path === "string" ? a.path : `${c.name}:${m.calls}`);
        if (ITEM_TOOLS.test(c.name)) m.items++;
        // a tidy handles each message in it (PLAN 4.10): one card for forty emails is forty of the inbox's items
        if (c.name === "tidy_mail") {
          m.items += new Set([...listOf(a.archive), ...listOf(a.read), ...listOf(a.folders).flatMap((f) => listOf((f as { uids?: unknown })?.uids))]).size;
        }
        // a workbook is a file, its rows its lines (PLAN 4.9)
        if (c.name === "write_sheet" && typeof a.path === "string") {
          files.add(a.path);
          m.lines += listOf(a.sheets).reduce((n: number, sh) => n + listOf((sh as { rows?: unknown })?.rows).length, 0);
        }
      }
    } else if (s.kind === "tool") {
      const name = String(s.data.name ?? "");
      if (s.data.is_error === true) failed.add(name);
      else if (failed.delete(name)) m.recovered++;
    } else if (s.kind === "output") m.words += wordCount(String(s.data.text ?? ""));
  }
  m.tools = tools.size;
  m.files = files.size;
  m.sources = hosts.size + examined.size;
  m.recovered = Math.min(m.recovered, 5);
  return m;
}

export type Difficulty = { area: Area | null; tier: Tier; unit: number; measures: Measures; why: string };

/** How hard a run was, in its own area: its tier on that area's scale, and the measures that put it there. */
export function difficulty(events: EventLog, run: number): Difficulty {
  const { area } = tagRun(events, run);
  const measures = measure(events, run);
  const scale = SCALES[area ?? "other"];
  const unit = Math.round(scale.unit(measures) * 100) / 100;
  return { area, tier: tierOf(unit, scale.at), unit, measures, why: scale.says(measures) };
}
