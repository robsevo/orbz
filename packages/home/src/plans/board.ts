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
//   a visual row also needs pagecheck     (PLAN 4.1) until then it cannot be ticked at all
import type { DatabaseSync } from "node:sqlite";
import type { Clock } from "../clock.ts";
import { tx } from "../db.ts";
import type { EventLog } from "../events.ts";
import type { Box } from "./format.ts";
import { parse } from "./format.ts";
import { runCommand, type ToolContext, type ToolDef } from "../agent/tools.ts";

export type BoardRow = { plan: number; row: string; test: boolean; box: Box; command: string | null; evidence: string | null; updatedAt: number };

/** Commands that report success without testing anything. */
const CANNOT_FAIL = /^\s*(true|:|exit\s+0|echo\b.*|printf\b.*|test\s+1\s*(-eq|=)\s*1|\[\s*1\s*(-eq|=)\s*1\s*\]|sleep\s+\d+)\s*;?\s*$/i;
const VISUAL = /\(visual\)|\brender(s|ed|ing)?\b|\bscreenshot\b|\bpixel/i;

export class BoardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardError";
  }
}

type Row = { plan: number; row: string; test: number; box: Box; command: string | null; evidence: string | null; updated_at: number };

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
    }));
  }

  /** [ ] → [~]: the orb starts a feature, and commits to the command that will test it. */
  start(plan: number, row: string, command: string): void {
    const f = this.#feature(plan, row);
    if (f.box === "[x]") throw new BoardError(`row ${row} is already done`);
    if (!command.trim()) throw new BoardError(`row ${row} needs the command that tests it`);
    if (CANNOT_FAIL.test(command)) throw new BoardError(`\`${command}\` cannot fail, so it proves nothing: name the command that tests row ${row}`);
    tx(this.#db, () => {
      const set = this.#db.prepare("UPDATE board SET box = '[~]', command = ?, updated_at = ? WHERE plan = ? AND row IN (?, ?)");
      set.run(command, this.#clock.now(), plan, row, `${row}_t`);
      this.#events.append("board.started", { plan, row, command });
    });
  }

  /** The command a started row will be tested with: the one it committed to, not one chosen later. */
  command(plan: number, row: string): string {
    const f = this.#feature(plan, row);
    if (f.box !== "[~]" || !f.command) throw new BoardError(`row ${row} has not been started, so it has no test to run`);
    if (this.#visual(plan, row)) throw new BoardError(`row ${row} is visual: it also needs pagecheck (PLAN 4.1), so it cannot be ticked yet`);
    return f.command;
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
export function boardTools(board: Board, shown: (ctx: ToolContext, text: string) => void): ToolDef[] {
  const n = (a: Record<string, unknown>): number => Number(a.plan);
  const r = (a: Record<string, unknown>): string => String(a.row ?? "");
  return [
    {
      name: "start_row",
      label: "Starting a row",
      description:
        "Start a row of an approved plan ([ ] → [~]) and name the command that tests it — the one its _t row describes. " +
        "Only the home can mark a row done: it runs that command itself (check_row).",
      parameters: {
        type: "object",
        properties: { plan: { type: "number" }, row: { type: "string", description: "The feature row, e.g. 1.2" }, test_command: { type: "string" } },
        required: ["plan", "row", "test_command"],
        additionalProperties: false,
      },
      describe: (a) => `start row ${r(a)} of plan ${n(a)}, tested by \`${String(a.test_command ?? "")}\``,
      decision: "allow",
      async run(a, ctx) {
        board.start(n(a), r(a), String(a.test_command ?? ""));
        shown(ctx, `Row ${r(a)} started: it will be tested by \`${String(a.test_command)}\`.`);
        return { content: `Row ${r(a)} is [~]. Build it, then call check_row; the home will run \`${String(a.test_command)}\` itself.` };
      },
    },
    {
      name: "check_row",
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
        const res = await runCommand(cmd, ctx.workspace, 600_000, ctx.signal);
        if (res.stoppedByUser) return res;
        const passed = !res.isError;
        board.record(n(a), r(a), passed, res.content);
        const said = passed
          ? `Row ${r(a)} is done [x]: the home ran \`${cmd}\` and it passed.\n${tail(res.content)}`
          : `Row ${r(a)} stays [~]: the home ran \`${cmd}\` and it failed.\n${tail(res.content)}`;
        shown(ctx, said);
        return { content: said, isError: !passed };
      },
    },
  ];
}
