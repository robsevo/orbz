// An orb's spreadsheet tool (PLAN 4.9; owner, 10-12: "making a professional excel sheet for your boss"): a real
// workbook in its workspace from the data it gives, formatted here (sheets/xlsx.ts), so it opens in Excel, Numbers,
// LibreOffice and Google Sheets and lands in your projects folder with the rest of its work. What comes back is what
// the sheet says (its totals as they show), so what the orb tells you about it is the sheet's, not its own guess.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ToolDef } from "../agent/tools.ts";
import { inWorkspace } from "../agent/tools.ts";
import { GROUPS } from "../agent/groups.ts";
import { bookOf, COLUMN_TYPES, display, SheetError, TOTALS, totalCode, type Column, type Worked, writeXlsx } from "./xlsx.ts";

const s = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const totalShown = (v: Worked, c: Column, currency: string): string => (typeof v === "number" ? display(v, totalCode(c, currency)) : String(v ?? ""));
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export const SHEET_TOOL: ToolDef = {
  name: "write_sheet",
  group: GROUPS.sheets,
  label: "Making a spreadsheet",
  description:
    "Make a real Excel workbook (.xlsx) in your workspace, formatted to a professional standard for you: a title and a line under it, a header that stays in view and filters, banded rows, each column's number format, widths that fit, live formulas and a totals row; landscape and one page wide in print. Give the data and say what each column is: text, number, integer, currency, percent (0.125 or \"12.5%\") or date (2026-10-05). A formula column works itself out from the others, naming them in brackets: \"[Revenue]-[Cost]\" (+ - * / and brackets only; leave its cells empty). A total is sum, average, min, max or count, or formula (a share like a margin: its own formula on the totals). Use it for anything someone will open in Excel; a .csv is for data another program reads.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Relative to your workspace, ending in .xlsx." },
      title: { type: "string", description: "The workbook's title (its properties)." },
      currency: { type: "string", description: "The currency's symbol: $ (the default), €, £, ¥, CA$, US$, A$, CHF or kr." },
      sheets: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "The tab's name, 31 characters at most." },
            title: { type: "string", description: "A title over the table." },
            subtitle: { type: "string", description: "A line under the title: who it is for, the period, the source." },
            columns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  type: { type: "string", enum: [...COLUMN_TYPES] },
                  formula: { type: "string", description: "Optional: this column from the others, like [Revenue]-[Cost]." },
                  total: { type: "string", enum: [...TOTALS] },
                },
                required: ["name"],
                additionalProperties: false,
              },
            },
            rows: { type: "array", description: "One list per row, its cells in the columns' order (an empty string for none).", items: { type: "array", items: { type: "string" } } },
            notes: { type: "array", description: "Optional lines under the table: sources, assumptions.", items: { type: "string" } },
          },
          required: ["name", "columns", "rows"],
          additionalProperties: false,
        },
      },
    },
    required: ["path", "sheets"],
    additionalProperties: false,
  },
  describe: (a) => `make the spreadsheet ${s(a.path)} in its workspace`,
  decision: "allow",
  precheck: (a, ctx) => {
    const path = s(a.path);
    if (!/\.xlsx$/i.test(path)) return `${path || "(no path)"} is not a workbook's name: end it in .xlsx.`;
    if (!inWorkspace(ctx.workspace, path)) return `${path} is outside the workspace.`;
    // a file another orb of the session claimed is his until he hands it off (PLAN 5.1)
    const who = ctx.heldBy?.(path);
    return who ? `${path} is ${who}'s: it is in what ${who} claimed. Ask ${who}, or claim rows of your own.` : null;
  },
  async run(a, ctx) {
    const path = s(a.path);
    let book;
    try {
      book = bookOf({ ...a, author: null });
    } catch (e) {
      if (e instanceof SheetError) return { content: `The workbook was not made: ${e.message}.`, isError: true };
      throw e;
    }
    const { bytes, laid } = writeXlsx(book);
    const p = inWorkspace(ctx.workspace, path)!;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, bytes);
    const lines = book.sheets.map((sh, i) => {
      const L = laid[i]!;
      const totals = L.sums
        ? sh.columns.flatMap((c, j) => (c.total ? [`${c.name} ${totalShown(L.sums![j]!.v, c, book.currency)}`] : []))
        : [];
      const formulas = sh.columns.filter((c) => c.formula).map((c) => `${c.name} = ${c.formula}`);
      return `- "${sh.name}": ${plural(sh.rows.length, "row")}, ${plural(sh.columns.length, "column")}`
        + (totals.length ? `; totals: ${totals.join(", ")}` : "")
        + (formulas.length ? `; formulas: ${formulas.join("; ")}` : "");
    });
    return { content: `Made ${path} (${Math.ceil(bytes.length / 1024)} KB), a workbook that opens in Excel:\n${lines.join("\n")}` };
  },
};
