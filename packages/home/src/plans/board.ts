// Row by row, ticked with proof (PLAN 1.8). An approved plan becomes a board: every row's box,
// live, in the database (the plan's archived text stays frozen). The orb moves a row from [ ] to
// [~] when it starts it, and names, up front, the command that tests it. Only the HOME can make a
// row [x]: it runs that command itself, in the orb's workspace, and ticks the row and its test row
// together only if the command passed — Ash's practice grader, where a self-reported pass counts
// for nothing. The result is posted in the chat with its evidence, so a tick is something the
// person was shown, not something they are told.
//
//   a failing test cannot be [x]          the home ran it; it failed; the row stays [~]
//   the orb's own "done" ticks nothing    no tool sets a box; a command that cannot fail is refused
//   a feature never outranks its test     both move together, [~] and [x]
//   ticks survive a restart               they are rows, not memory
//   a junior's row is reviewed           (PLAN 5.4) its test passing makes it wait for a Senior's
//                                         review (or yours); only an approval ticks it
//   an agreed change adds rows            (PLAN 5.1) a new feature row and its test, both [ ]
//   a visual row also needs pagecheck     (PLAN 4.1) it names the page it builds when it starts,
//                                         and is ticked only when its test AND Ash's pagecheck
//                                         (through the kit) both pass: a page that only serves,
//                                         unstyled, is not done
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "../clock.ts";
import { tx } from "../db.ts";
import type { EventLog } from "../events.ts";
import type { Box } from "./format.ts";
import { parse } from "./format.ts";
import { inWorkspace, runCommand, type ToolContext, type ToolDef } from "../agent/tools.ts";
import type { PageCheck } from "../computer/tools.ts";
import { LEVELS, type Level } from "../gym/levels.ts";
import { parseTabConversation } from "../team.ts";
import { GROUPS } from "../agent/groups.ts";

/** Whose rows are reviewed before they are ticked, and who may review (PLAN 5.4): in a team (a
 * session's tab) only; an orb working alone with you ticks his own on the home's run. */
const REVIEWED: Level[] = ["Junior"];
const REVIEWS = (l: Level): boolean => LEVELS.indexOf(l) >= LEVELS.indexOf("Senior");

/** Who may review a junior's row (PLAN 5.4): a Senior or above, of the author's own specialty when
 * the office has one (owner, 10-02: "your first orb of that kind of employee is always the senior"),
 * else any Senior; never the author. Null when `who` may; else why not. */
export function reviewerProblem(who: string, author: string, office: { id: string; name: string; specialty: string; level: Level }[]): string | null {
  if (who === author) return "a row is reviewed by someone else: not by the orb whose row it is";
  const me = office.find((o) => o.id === who);
  const them = office.find((o) => o.id === author);
  if (!me || !REVIEWS(me.level)) return `reviews are a Senior's: you are ${me ? `a ${me.level}` : "not in the office"}`;
  const ofKind = office.filter((o) => o.id !== author && o.specialty === them?.specialty && REVIEWS(o.level));
  if (them && ofKind.length && me.specialty !== them.specialty) return `${them.name}'s row is ${them.specialty} work: ${ofKind.map((o) => o.name).join(" or ")} reviews it, the Senior of its kind`;
  return null;
}

export type BoardRow = { plan: number; row: string; test: boolean; box: Box; command: string | null; evidence: string | null; updatedAt: number; visual: boolean; page: string | null; review: string | null };

/** Commands that report success without testing anything. */
const CANNOT_FAIL = /^\s*(true|:|exit\s+0|echo\b.*|printf\b.*|test\s+1\s*(-eq|=)\s*1|\[\s*1\s*(-eq|=)\s*1\s*\]|sleep\s+\d+)\s*;?\s*$/i;
const VISUAL = /\(visual\)|\brender(s|ed|ing)?\b|\bscreenshot\b|\bpixel/i;

export class BoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardError";
  }
}

type Row = { plan: number; row: string; test: number; box: Box; command: string | null; evidence: string | null; updated_at: number; visual: number; page: string | null; review: string | null };

/** The page a visual row builds, as the orb names it: a file of its workspace, or its own page
 * served on this machine. Null when it is neither. */
export function pageOf(page: string): string | null {
  const p = page.trim();
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) {
    try {
      return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(p).hostname) ? p : null;
    } catch {
      return null;
    }
  }
  return p.startsWith("/") || p.split(/[\\/]/).includes("..") ? null : p.replace(/^\.\//, "");
}

export class Board {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #clock: Clock;

  constructor(db: DatabaseSync, events: EventLog, clock: Clock) {
    this.#db = db;
    this.#events = events;
    this.#clock = clock;
  }

  /** Lays out an approved plan's rows, as its text has them. Once per plan. */
  open(plan: number, body: string): BoardRow[] {
    const now = this.#clock.now();
    tx(this.#db, () => {
      const ins = this.#db.prepare("INSERT OR IGNORE INTO board (plan, row, test, box, visual, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
      for (const r of parse(body).rows) ins.run(plan, r.test ? `${r.id}_t` : r.id, r.test ? 1 : 0, r.box, VISUAL.test(r.text) ? 1 : 0, now);
      this.#events.append("board.opened", { plan });
    });
    return this.rows(plan);
  }

  rows(plan: number): BoardRow[] {
    return (this.#db.prepare("SELECT * FROM board WHERE plan = ? ORDER BY rowid").all(plan) as Row[]).map((r) => ({
      plan: r.plan, row: r.row, test: r.test === 1, box: r.box, command: r.command, evidence: r.evidence, updatedAt: r.updated_at,
      visual: r.visual === 1, page: r.page, review: r.review,
    }));
  }

  /** [ ] → [~]: the orb starts a feature, and commits to the command that will test it (and, for
   * a visual row, the page it builds, which pagecheck will look at). */
  start(plan: number, row: string, command: string, page?: string): void {
    const f = this.#feature(plan, row);
    if (f.box === "[x]") throw new BoardError(`row ${row} is already done`);
    if (!command.trim()) throw new BoardError(`row ${row} needs the command that tests it`);
    if (CANNOT_FAIL.test(command)) throw new BoardError(`\`${command}\` cannot fail, so it proves nothing: name the command that tests row ${row}`);
    const visual = this.#visual(plan, row);
    const named = page === undefined || page === "" ? null : pageOf(page);
    if (page && !named) throw new BoardError(`${page} is not a page this row can be checked on: a file in your workspace (site/index.html), or your page on this machine (http://localhost:5173/)`);
    if (visual && !named) throw new BoardError(`row ${row} is visual: name the page it builds (page: its path in your workspace, or its address on this machine), so the home can check it really renders`);
    tx(this.#db, () => {
      const set = this.#db.prepare("UPDATE board SET box = '[~]', command = ?, page = ?, updated_at = ? WHERE plan = ? AND row IN (?, ?)");
      set.run(command, named, this.#clock.now(), plan, row, `${row}_t`);
      this.#events.append("board.started", { plan, row, command, ...(named && { page: named }) });
    });
  }

  /** The command a started row will be tested with: the one it committed to, not one chosen later. */
  command(plan: number, row: string): string {
    const f = this.#feature(plan, row);
    if (f.box !== "[~]" || !f.command) throw new BoardError(`row ${row} has not been started, so it has no test to run`);
    return f.command;
  }

  /** The page a started visual row committed to, which pagecheck must pass; null for any other row. */
  page(plan: number, row: string): string | null {
    const f = this.#feature(plan, row);
    return this.#visual(plan, row) ? f.page : null;
  }

  /** The home ran the row's command: [x] on a pass, [~] with the evidence on a failure. */
  record(plan: number, row: string, passed: boolean, evidence: string): BoardRow[] {
    this.#feature(plan, row);
    tx(this.#db, () => {
      this.#db
        .prepare("UPDATE board SET box = ?, evidence = ?, updated_at = ? WHERE plan = ? AND row IN (?, ?)")
        .run(passed ? "[x]" : "[~]", evidence.slice(0, 4000), this.#clock.now(), plan, row, `${row}_t`);
      this.#events.append(passed ? "board.ticked" : "board.failed", { plan, row });
    });
    return this.rows(plan);
  }

  /** An agreed change (PLAN 5.1): a new feature row and its test row, both [ ]. */
  add(plan: number, row: string, text: string, test: string): BoardRow[] {
    const rows = this.rows(plan);
    if (!rows.length) throw new BoardError(`plan ${plan} has no board`);
    if (rows.some((r) => r.row === row)) throw new BoardError(`row ${row} is on the board already`);
    const now = this.#clock.now();
    tx(this.#db, () => {
      const ins = this.#db.prepare("INSERT INTO board (plan, row, test, box, visual, updated_at) VALUES (?, ?, ?, ?, ?, ?)");
      ins.run(plan, row, 0, "[ ]", VISUAL.test(text) ? 1 : 0, now);
      ins.run(plan, `${row}_t`, 1, "[ ]", VISUAL.test(`${text} ${test}`) ? 1 : 0, now);
      this.#events.append("board.amended", { plan, row });
    });
    return this.rows(plan);
  }

  /** A junior's row passed its test (PLAN 5.4): it waits for a review, its evidence kept. */
  awaitReview(plan: number, row: string, by: string, evidence: string): BoardRow[] {
    this.#feature(plan, row);
    tx(this.#db, () => {
      this.#db.prepare("UPDATE board SET box = '[~]', evidence = ?, review = ?, updated_at = ? WHERE plan = ? AND row IN (?, ?)").run(evidence.slice(0, 4000), `waiting:${by}`, this.#clock.now(), plan, row, `${row}_t`);
      this.#events.append("board.review_asked", { plan, row, by });
    });
    return this.rows(plan);
  }

  /** A review (PLAN 5.4): approved, the row is [x]; with changes, it stays [~] and says what. Only a
   * row waiting for one, and never by the orb whose row it is. */
  review(plan: number, row: string, reviewer: string, approve: boolean, note: string): BoardRow[] {
    const f = this.#feature(plan, row);
    if (!f.review?.startsWith("waiting:")) throw new BoardError(`row ${row} is not waiting for a review`);
    if (f.review === `waiting:${reviewer}`) throw new BoardError(`row ${row} is yours: another must review it`);
    const said = `${approve ? "approved" : "changes asked"} by ${reviewer}${note.trim() ? `: ${note.trim()}` : ""}`;
    tx(this.#db, () => {
      this.#db
        .prepare("UPDATE board SET box = ?, review = ?, evidence = ?, updated_at = ? WHERE plan = ? AND row IN (?, ?)")
        .run(approve ? "[x]" : "[~]", approve ? `approved:${reviewer}` : `changes:${reviewer}`, `${f.evidence ?? ""}\n\nreview: ${said}`.slice(-4000), this.#clock.now(), plan, row, `${row}_t`);
      this.#events.append(approve ? "board.ticked" : "board.review_changes", { plan, row, reviewer });
    });
    return this.rows(plan);
  }

  #feature(plan: number, row: string): BoardRow {
    const f = this.rows(plan).find((r) => r.row === row && !r.test);
    if (!f) throw new BoardError(`plan ${plan} has no feature row ${row} (an approved plan's board, by its numbers)`);
    return f;
  }

  #visual(plan: number, row: string): boolean {
    const r = this.#db.prepare("SELECT visual FROM board WHERE plan = ? AND row IN (?, ?) AND visual = 1").get(plan, row, `${row}_t`);
    return Boolean(r);
  }
}

const tail = (s: string): string => (s.length > 1200 ? `…${s.slice(-1200)}` : s);

/** The orb's two tools for a board. Neither sets a box: start_row commits a test, check_row has the
 * home run it. `shown` posts the result where the person sees it. */
export function boardTools(
  board: Board,
  shown: (ctx: ToolContext, text: string) => void,
  pageCheck: PageCheck | null = null,
  o: { levelOf?: (orb: string) => Level; reviewer?: (who: string, author: string) => string | null } = {},
): ToolDef[] {
  const levelOf = o.levelOf ?? ((): Level => "Mid");
  const n = (a: Record<string, unknown>): number => Number(a.plan);
  const r = (a: Record<string, unknown>): string => String(a.row ?? "");
  return [
    {
      name: "start_row",
      group: GROUPS.plans,
      label: "Starting a row",
      description:
        "Start a row of an approved plan ([ ] → [~]) and name the command that tests it — the one its _t row describes. " +
        "A visual row (a page, a render) also names the page it builds, which the home checks with Ash's pagecheck. " +
        "Only the home can mark a row done: it runs that command itself (check_row).",
      parameters: {
        type: "object",
        properties: {
          plan: { type: "number" },
          row: { type: "string", description: "The feature row, e.g. 1.2" },
          test_command: { type: "string" },
          page: { type: "string", description: "For a visual row: the page it builds, a path in your workspace or its address on this machine (localhost)." },
        },
        required: ["plan", "row", "test_command"],
        additionalProperties: false,
      },
      describe: (a) => `start row ${r(a)} of plan ${n(a)}, tested by \`${String(a.test_command ?? "")}\`${a.page ? ` and pagecheck on ${String(a.page)}` : ""}`,
      decision: "allow",
      async run(a, ctx) {
        board.start(n(a), r(a), String(a.test_command ?? ""), typeof a.page === "string" ? a.page : undefined);
        const page = board.page(n(a), r(a));
        shown(ctx, `Row ${r(a)} started: it will be tested by \`${String(a.test_command)}\`${page ? `, and ${page} must pass pagecheck` : ""}.`);
        return { content: `Row ${r(a)} is [~]. Build it, then call check_row; the home will run \`${String(a.test_command)}\` itself${page ? ` and check that ${page} really renders` : ""}.` };
      },
    },
    {
      name: "check_row",
      group: GROUPS.plans,
      label: "Testing a row",
      description: "Ask the home to run a started row's test command. It ticks the row [x] only if the command passes.",
      parameters: {
        type: "object",
        properties: { plan: { type: "number" }, row: { type: "string" } },
        required: ["plan", "row"],
        additionalProperties: false,
      },
      describe: (a) => {
        let cmd = "its test";
        try {
          cmd = `\`${board.command(n(a), r(a))}\``;
        } catch {
          // shown as "its test"
        }
        return `test row ${r(a)} of plan ${n(a)} by running ${cmd} in its workspace`;
      },
      decision: "ask", // it runs a command; the person's rules can allow it, the floor still reads it
      act: "shell",
      commandOf: (a) => board.command(n(a), r(a)),
      async run(a, ctx) {
        const cmd = board.command(n(a), r(a));
        const page = board.page(n(a), r(a));
        if (page && !pageCheck) {
          const said = `Row ${r(a)} stays [~]: it is visual, and pagecheck runs in the kit, which is not running, so nothing can look at ${page}.`;
          shown(ctx, said);
          return { content: said, isError: true };
        }
        const res = await runCommand(cmd, ctx.workspace, 600_000, ctx.signal, { wrap: ctx.sandbox, onOutput: ctx.onOutput }); // in his sandbox (PLAN 4.6)
        if (res.stoppedByUser) return res;
        let passed = !res.isError;
        let evidence = res.content;
        let why = passed ? `the home ran \`${cmd}\` and it passed` : `the home ran \`${cmd}\` and it failed`;
        if (passed && page && pageCheck) {
          // the page it committed to, looked at in a browser of the kit's own (Ash's pagecheck)
          const target = /^https?:\/\//i.test(page) ? { url: page } : inWorkspace(ctx.workspace, page) ? { root: ctx.workspace, path: page } : null;
          const v = target ? await pageCheck(target) : { verdict: "fail" as const, report: `${page} is outside the workspace` };
          passed = v.verdict === "pass";
          evidence = `${res.content}\n\npagecheck ${page}:\n${v.report}`;
          why = passed ? `the home ran \`${cmd}\` and pagecheck saw ${page} render, styled` : `the home ran \`${cmd}\` and it passed, but pagecheck says ${page} is not done (${v.verdict})`;
        }
        if (passed && REVIEWED.includes(levelOf(ctx.orb)) && parseTabConversation(ctx.conversation)) {
          // a junior's row: its test passed, and a senior (or you) reviews it before it is ticked
          board.awaitReview(n(a), r(a), ctx.orb, evidence);
          const said = `Row ${r(a)} passed (${why}) and waits for a review: by the Senior of its kind, or by you.\n${tail(evidence)}`;
          shown(ctx, said);
          return { content: said };
        }
        board.record(n(a), r(a), passed, evidence);
        const said = passed ? `Row ${r(a)} is done [x]: ${why}.\n${tail(evidence)}` : `Row ${r(a)} stays [~]: ${why}.\n${tail(evidence)}`;
        shown(ctx, said);
        return { content: said, isError: !passed };
      },
    },
    {
      name: "review_row",
      group: GROUPS.plans,
      label: "Reviewing a row",
      description: "Review a junior's row that passed its test and waits for a review: approve it (it is ticked [x]) or ask for changes (it stays [~], with your note). A Senior reviews: the Senior of the junior's own kind when the office has one.",
      parameters: {
        type: "object",
        properties: { plan: { type: "number" }, row: { type: "string" }, approve: { type: "boolean" }, note: { type: "string" } },
        required: ["plan", "row", "approve"],
        additionalProperties: false,
      },
      describe: (a) => `${a.approve ? "approve" : "ask for changes on"} row ${r(a)} of plan ${n(a)}`,
      decision: "allow",
      async run(a, ctx) {
        const waiting = board.rows(n(a)).find((x) => x.row === r(a) && !x.test)?.review;
        const author = waiting?.startsWith("waiting:") ? waiting.slice("waiting:".length) : null;
        const why = author ? (o.reviewer ? o.reviewer(ctx.orb, author) : REVIEWS(levelOf(ctx.orb)) ? null : `reviews are a Senior's: you are a ${levelOf(ctx.orb)}`) : null;
        if (why) return { content: `Not reviewed: ${why}.`, isError: true };
        const rows = board.review(n(a), r(a), ctx.orb, Boolean(a.approve), String(a.note ?? ""));
        const f = rows.find((x) => x.row === r(a) && !x.test)!;
        const said = a.approve ? `Row ${r(a)} is done [x], reviewed.` : `Row ${r(a)} stays [~]: changes asked${a.note ? `: ${String(a.note)}` : ""}.`;
        shown(ctx, said);
        return { content: `${said} (${f.box})` };
      },
    },
  ];
}
