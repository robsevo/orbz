// Spreadsheets (PLAN 4.9; owner, 10-01: "we want to see what theire doing ... wether its an excel file were creating";
// 10-12: "making a professional excel sheet for your boss"). A real workbook, Office Open XML (ECMA-376) written by
// our own code: an orb gives the data, the columns' kinds, formulas and totals, and the formatting is done here the
// way an analyst would do it by hand: a title, a header in the house's dark blue that stays in view as you scroll,
// filters on it, banded rows, each column's number format (currency, percent, dates), widths that fit, live
// formulas, a totals row, landscape and one page wide when printed.
//
// Every formula is written twice: as Excel's formula, and as its value worked out here, so a viewer that does not
// calculate (his computer's screen, a preview) shows the same number Excel will (Excel recalculates on open,
// `fullCalcOnLoad`). A formula names columns, "[Revenue]-[Cost]", and only does arithmetic: nothing it says can
// reach outside its row.
//
// Reading is any .xlsx's, for his computer's screen and for read_file: its sheets, each cell as it shows (its number
// format applied), with what part it plays (a title, a header, a total) from its style, never its colours.
import { unzip, zip, ZipError } from "./zip.ts";

export class SheetError extends Error {}

export const COLUMN_TYPES = ["text", "number", "integer", "currency", "percent", "date"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];
export const TOTALS = ["sum", "average", "min", "max", "count", "formula"] as const;
export type Total = (typeof TOTALS)[number];
export type Value = string | number | null;
export type Column = { name: string; type: ColumnType; formula: string | null; total: Total | null };
export type Sheet = { name: string; title: string | null; subtitle: string | null; columns: Column[]; rows: Value[][]; notes: string[] };
export type Book = { title: string | null; author: string | null; currency: string; sheets: Sheet[] };

/** How much one workbook may hold. */
export const LIMITS = { sheets: 12, columns: 40, rows: 5000, text: 2000 };
const SYMBOLS = ["$", "€", "£", "¥", "CA$", "US$", "A$", "CHF", "kr"];

// ---------------------------------------------------------------------------------------------- the book, checked

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const plainText = (s: string): string => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, ""); // what XML cannot hold

/** A sheet's name as Excel allows it: 31 characters, none of : \ / ? * [ ], not quoted at either end. */
function sheetName(v: unknown, n: number, taken: Set<string>): string {
  const name = str(v) || `Sheet${n + 1}`;
  if (name.length > 31) throw new SheetError(`a sheet's name is at most 31 characters ("${name.slice(0, 40)}…")`);
  if (/[:\\/?*[\]]/.test(name) || /^'|'$/.test(name)) throw new SheetError(`a sheet's name has none of : \\ / ? * [ ] and no ' at either end ("${name}")`);
  if (taken.has(name.toLowerCase())) throw new SheetError(`two sheets are called "${name}"`);
  taken.add(name.toLowerCase());
  return name;
}

/** "1,234.50", "$1,234.50", "(42)", "-7" as a number; null when it is not one. */
export function numberOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/^(CA\$|US\$|A\$|CHF|kr|[$€£¥])\s*/i, "").replace(/\s*(CA\$|US\$|A\$|CHF|kr|[$€£¥])$/i, "");
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1).replace(/^(CA\$|US\$|A\$|[$€£¥])/i, "");
  }
  if (!/^(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?$/.test(s) || s === "" || s === ".") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const EPOCH = Date.UTC(1899, 11, 30); // Excel's day 0 (its 1900 leap-year slip is behind every date after March 1900)
/** "2026-10-05" or "2026-10-05 14:30" as Excel's day number; null when it is not a date. */
export function serialOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(str(v));
  if (!m) return null;
  const [y, mo, d, h = "0", mi = "0", se = "0"] = m.slice(1);
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se));
  const back = new Date(t);
  if (back.getUTCMonth() !== Number(mo) - 1 || back.getUTCDate() !== Number(d)) return null; // 2026-02-30
  return (t - EPOCH) / 86_400_000;
}

/** A cell as its column takes it, or why not. */
function cellOf(v: unknown, col: Column, where: string): Value {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
  if (col.formula !== null) return null; // a formula column's cells are its formula's
  if (col.type === "text") return plainText(typeof v === "string" ? v : String(v)).slice(0, LIMITS.text);
  if (col.type === "date") {
    const d = serialOf(v);
    if (d === null) throw new SheetError(`${where}: "${String(v)}" is not a date (write it 2026-10-05, or 2026-10-05 14:30)`);
    return d;
  }
  if (col.type === "percent" && typeof v === "string" && v.trim().endsWith("%")) {
    const n = numberOf(v.trim().slice(0, -1));
    if (n === null) throw new SheetError(`${where}: "${v}" is not a percent`);
    return n / 100;
  }
  const n = numberOf(v);
  if (n === null) throw new SheetError(`${where}: "${String(v)}" is not a number (${col.name} is ${col.type})`);
  return col.type === "integer" ? Math.round(n) : n;
}

/** What an orb hands in, checked and made whole, or why it cannot be a workbook. */
export function bookOf(given: unknown): Book {
  const g = (given ?? {}) as Record<string, unknown>;
  const sheetsIn = Array.isArray(g.sheets) ? g.sheets : [];
  if (!sheetsIn.length) throw new SheetError("a workbook needs at least one sheet");
  if (sheetsIn.length > LIMITS.sheets) throw new SheetError(`a workbook here has at most ${LIMITS.sheets} sheets`);
  const currency = str(g.currency) || "$";
  if (!SYMBOLS.includes(currency)) throw new SheetError(`the currency is one of ${SYMBOLS.join(" ")}`);
  const taken = new Set<string>();
  const sheets = sheetsIn.map((s0, n): Sheet => {
    const s = (s0 ?? {}) as Record<string, unknown>;
    const name = sheetName(s.name, n, taken);
    const colsIn = Array.isArray(s.columns) ? s.columns : [];
    if (!colsIn.length) throw new SheetError(`sheet "${name}" needs its columns`);
    if (colsIn.length > LIMITS.columns) throw new SheetError(`sheet "${name}" has more than ${LIMITS.columns} columns`);
    const names = new Set<string>();
    const columns = colsIn.map((c0, i): Column => {
      const c = (typeof c0 === "string" ? { name: c0 } : (c0 ?? {})) as Record<string, unknown>;
      const cname = plainText(str(c.name)).slice(0, 255);
      if (!cname) throw new SheetError(`sheet "${name}": column ${i + 1} needs a name`);
      if (/[[\]]/.test(cname)) throw new SheetError(`sheet "${name}": a column's name has no [ or ] ("${cname}")`);
      if (names.has(cname.toLowerCase())) throw new SheetError(`sheet "${name}": two columns are called "${cname}"`);
      names.add(cname.toLowerCase());
      const type = (str(c.type) || "text") as ColumnType;
      if (!COLUMN_TYPES.includes(type)) throw new SheetError(`sheet "${name}": ${cname}'s type is one of ${COLUMN_TYPES.join(", ")}`);
      const total = str(c.total) ? (str(c.total) as Total) : null;
      if (total !== null && !TOTALS.includes(total)) throw new SheetError(`sheet "${name}": ${cname}'s total is one of ${TOTALS.join(", ")}`);
      if (total && total !== "count" && type === "text") throw new SheetError(`sheet "${name}": ${cname} is text, so its total can only be count`);
      const formula = str(c.formula).replace(/^=/, "") || null;
      if (total === "formula" && !formula) throw new SheetError(`sheet "${name}": ${cname}'s total is its formula, so it needs one`);
      return { name: cname, type, formula, total };
    });
    for (const c of columns) if (c.formula) parseFormula(c.formula, columns, `sheet "${name}", ${c.name}`); // refused here, before anything is written
    order(columns, name);
    for (const c of columns) {
      if (c.total !== "formula") continue;
      const lacking = refsOf(c.formula!, columns).filter((r) => columns[r]!.total === null || columns[r]!.total === "count");
      if (lacking.length) throw new SheetError(`sheet "${name}": ${c.name}'s total is its formula on the totals, so ${lacking.map((r) => columns[r]!.name).join(" and ")} need a total (sum, average, min or max)`);
    }
    const rowsIn = Array.isArray(s.rows) ? s.rows : [];
    if (rowsIn.length > LIMITS.rows) throw new SheetError(`sheet "${name}" has more than ${LIMITS.rows} rows`);
    const rows = rowsIn.map((r0, i): Value[] => {
      const r = Array.isArray(r0) ? r0 : r0 && typeof r0 === "object" ? columns.map((c) => (r0 as Record<string, unknown>)[c.name]) : null;
      if (!r) throw new SheetError(`sheet "${name}", row ${i + 1}: a row is a list of its cells, in the columns' order`);
      if (r.length > columns.length) throw new SheetError(`sheet "${name}", row ${i + 1} has ${r.length} cells for ${columns.length} columns`);
      return columns.map((c, j) => cellOf(r[j], c, `sheet "${name}", row ${i + 1}, ${c.name}`));
    });
    const notes = (Array.isArray(s.notes) ? s.notes : []).map((x) => plainText(str(x)).slice(0, LIMITS.text)).filter(Boolean).slice(0, 20);
    const line = (v: unknown): string | null => plainText(str(v)).slice(0, 255) || null;
    return { name, title: line(s.title), subtitle: line(s.subtitle), columns, rows, notes };
  });
  return { title: str(g.title).slice(0, 255) || null, author: str(g.author).slice(0, 255) || null, currency, sheets };
}

// -------------------------------------------------------------------------------------------------- formulas

type Node = { k: "num"; v: number } | { k: "ref"; col: number } | { k: "neg"; a: Node } | { k: "op"; op: "+" | "-" | "*" | "/"; a: Node; b: Node };

/** A formula's tree: numbers, [Column], + - * / and brackets; or why not. */
function parseFormula(src: string, columns: Column[], where: string): Node {
  const toks = src.match(/\s*(\[[^\]]*\]|\d+(?:\.\d+)?|\.\d+|[-+*/()]|\S)/g)?.map((t) => t.trim()) ?? [];
  let i = 0;
  const fail = (why: string): never => {
    throw new SheetError(`${where}: the formula "${src}" ${why} (a formula names columns in brackets and uses + - * / and ( ), like [Revenue]-[Cost])`);
  };
  const atom = (): Node => {
    const t = toks[i++];
    if (t === undefined) return fail("ends too soon");
    if (t === "(") {
      const n = sum();
      if (toks[i++] !== ")") fail("has a ( that is never closed");
      return n;
    }
    if (t === "-") return { k: "neg", a: atom() };
    if (t === "+") return atom();
    if (/^\[.*\]$/.test(t)) {
      const name = t.slice(1, -1).trim().toLowerCase();
      const col = columns.findIndex((c) => c.name.toLowerCase() === name);
      if (col < 0) fail(`names ${t}, which is not one of its columns`);
      return { k: "ref", col };
    }
    if (/^(\d+(\.\d+)?|\.\d+)$/.test(t)) return { k: "num", v: Number(t) };
    return fail(`has "${t}" in it`);
  };
  const product = (): Node => {
    let n = atom();
    while (toks[i] === "*" || toks[i] === "/") n = { k: "op", op: toks[i++] as "*" | "/", a: n, b: atom() };
    return n;
  };
  const sum = (): Node => {
    let n = product();
    while (toks[i] === "+" || toks[i] === "-") n = { k: "op", op: toks[i++] as "+" | "-", a: n, b: product() };
    return n;
  };
  if (!toks.length) fail("is empty");
  const n = sum();
  if (i < toks.length) fail(`has "${toks[i]}" where it should end`);
  return n;
}

const refsOf = (src: string, columns: Column[]): number[] => {
  const out = new Set<number>();
  const walk = (n: Node): void => {
    if (n.k === "ref") out.add(n.col);
    else if (n.k === "neg") walk(n.a);
    else if (n.k === "op") (walk(n.a), walk(n.b));
  };
  walk(parseFormula(src, columns, ""));
  return [...out];
};

/** The formula columns in an order that works each out after what it reads; a loop is refused. */
function order(columns: Column[], sheet: string): number[] {
  const out: number[] = [];
  const state = new Map<number, "doing" | "done">();
  const visit = (i: number, path: string[]): void => {
    if (state.get(i) === "done" || columns[i]!.formula === null) return;
    if (state.get(i) === "doing") throw new SheetError(`sheet "${sheet}": the formulas go round in a loop (${[...path, columns[i]!.name].join(" → ")})`);
    state.set(i, "doing");
    for (const r of refsOf(columns[i]!.formula!, columns)) visit(r, [...path, columns[i]!.name]);
    state.set(i, "done");
    out.push(i);
  };
  columns.forEach((_, i) => visit(i, []));
  return out;
}

export type Worked = number | string | null; // a number, an error ("#DIV/0!"), or nothing
const ERR = /^#/;
function evaluate(n: Node, cell: (col: number) => Worked): Worked {
  if (n.k === "num") return n.v;
  if (n.k === "ref") {
    const v = cell(n.col);
    if (v === null) return 0; // an empty cell is 0 to arithmetic, as in Excel
    return v;
  }
  if (n.k === "neg") {
    const a = evaluate(n.a, cell);
    return typeof a === "number" ? -a : ERR.test(String(a)) ? a : "#VALUE!";
  }
  const a = evaluate(n.a, cell);
  const b = evaluate(n.b, cell);
  if (typeof a === "string" && ERR.test(a)) return a;
  if (typeof b === "string" && ERR.test(b)) return b;
  if (typeof a !== "number" || typeof b !== "number") return "#VALUE!";
  if (n.op === "/" && b === 0) return "#DIV/0!";
  const v = n.op === "+" ? a + b : n.op === "-" ? a - b : n.op === "*" ? a * b : a / b;
  return Number(v.toPrecision(15));
}
const excelOf = (n: Node, ref: (col: number) => string): string => {
  if (n.k === "num") return String(n.v);
  if (n.k === "ref") return ref(n.col);
  if (n.k === "neg") return n.a.k === "op" ? `-(${excelOf(n.a, ref)})` : `-${excelOf(n.a, ref)}`;
  const wrap = (m: Node, right: boolean): string => {
    const s = excelOf(m, ref);
    const low = m.k === "op" && (m.op === "+" || m.op === "-");
    return (low && (n.op === "*" || n.op === "/")) || (right && m.k === "op" && (n.op === "-" || n.op === "/") && (low || n.op === "/")) ? `(${s})` : s;
  };
  return `${wrap(n.a, false)}${n.op}${wrap(n.b, true)}`;
};

// -------------------------------------------------------------------------------------- the sheet worked out

export const colLetter = (i: number): string => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const SUBTOTAL: Record<Exclude<Total, "formula">, number> = { average: 101, count: 103, max: 104, min: 105, sum: 109 };

type Laid = {
  /** The row numbers (1-based) of the header, the first and last data rows, and the totals (or null). */
  head: number; first: number; last: number; totals: number | null;
  /** Every data row's cells, formulas worked out. */
  values: Worked[][];
  /** The totals row's cells (a label, or a total worked out), with the Excel formula of each. */
  sums: { v: Worked; f: string | null }[] | null;
};

/** Where everything goes in a sheet, and every formula's value. */
export function lay(s: Sheet): Laid {
  const head = 1 + (s.title ? 1 : 0) + (s.subtitle ? 1 : 0) + (s.title || s.subtitle ? 1 : 0);
  const first = head + 1;
  const last = head + s.rows.length;
  const formulas = new Map(s.columns.map((c, i) => [i, c.formula ? parseFormula(c.formula, s.columns, "") : null] as const));
  const seq = order(s.columns, s.name);
  const values = s.rows.map((r) => {
    const row: Worked[] = [...r];
    for (const i of seq) row[i] = evaluate(formulas.get(i)!, (c) => row[c] ?? null);
    return row;
  });
  const totaled = s.columns.some((c) => c.total) && s.rows.length > 0;
  if (!totaled) return { head, first, last, totals: null, values, sums: null };
  const sums: { v: Worked; f: string | null }[] = s.columns.map(() => ({ v: null, f: null }));
  s.columns.forEach((c, i) => {
    if (!c.total || c.total === "formula") return;
    const nums = values.map((r) => r[i]).filter((v): v is number => typeof v === "number");
    const filled = values.filter((r) => r[i] !== null && r[i] !== "").length;
    const err = values.map((r) => r[i]).find((v) => typeof v === "string" && ERR.test(v));
    const v: Worked =
      c.total === "count" ? filled
        : err !== undefined ? err
          : c.total === "sum" ? Number(nums.reduce((a, b) => a + b, 0).toPrecision(15))
            : !nums.length ? (c.total === "average" ? "#DIV/0!" : 0)
              : c.total === "average" ? Number((nums.reduce((a, b) => a + b, 0) / nums.length).toPrecision(15))
                : c.total === "min" ? Math.min(...nums) : Math.max(...nums);
    sums[i] = { v, f: `SUBTOTAL(${SUBTOTAL[c.total]},${colLetter(i)}${first}:${colLetter(i)}${last})` };
  });
  const totals = last + 1;
  for (const i of seq) {
    const c = s.columns[i]!;
    if (c.total !== "formula") continue;
    const n = formulas.get(i)!;
    sums[i] = { v: evaluate(n, (col) => sums[col]!.v), f: excelOf(n, (col) => `${colLetter(col)}${totals}`) };
  }
  if (!s.columns[0]!.total) sums[0] = { v: "Total", f: null };
  return { head, first, last, totals, values, sums };
}

// ---------------------------------------------------------------------------------------- numbers as they show

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Each column type's number format, Excel's way. */
export function formatCode(type: ColumnType, currency: string, withTime = false): string {
  if (type === "number") return "#,##0.00";
  if (type === "integer") return "#,##0";
  if (type === "percent") return "0.0%";
  if (type === "date") return withTime ? "mmm d, yyyy h:mm" : "mmm d, yyyy";
  if (type === "currency") return `"${currency}"#,##0.00;[Red]\\-"${currency}"#,##0.00`;
  return "@";
}

/** A format's sections, split on ; outside quotes. */
const sections = (code: string): string[] => {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    if (ch === '"') q = !q;
    if (ch === "\\" && !q) {
      cur += ch + (code[++i] ?? "");
      continue;
    }
    if (ch === ";" && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
};
const isDateCode = (code: string): boolean => /[dyhs]|(^|[^"])m/i.test(code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, "")) && !/^General$/i.test(code) && !/[0#]/.test(code.replace(/"[^"]*"|\\./g, ""));

/** A number as a format shows it: grouping, decimals, a percent, a currency's symbol, a date. Close to Excel's for
 * the formats a workbook uses for money, counts, shares and days; anything stranger shows as a plain number. */
export function display(v: number, code = "General"): string {
  if (!Number.isFinite(v)) return String(v);
  if (/^(General|@)?$/i.test(code)) return String(Number(v.toPrecision(10)));
  if (isDateCode(code)) {
    const d = new Date(EPOCH + Math.round(v * 86_400_000));
    const day = /mmm/i.test(code) ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
      : `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const time = `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    const hasDay = /[dy]/i.test(code.replace(/"[^"]*"/g, ""));
    return /h/i.test(code) ? (hasDay ? `${day} ${time}` : time) : day;
  }
  const secs = sections(code);
  const neg = v < 0;
  const sec = neg && secs[1] !== undefined && secs[1] !== "" ? secs[1] : secs[0]!;
  const body = sec.replace(/\[[^\]]*\]/g, ""); // [Red], [$-409]
  let pre = "";
  let post = "";
  let num = "";
  let seen = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    let lit = "";
    if (ch === '"') {
      const j = body.indexOf('"', i + 1);
      lit = body.slice(i + 1, j < 0 ? undefined : j);
      i = j < 0 ? body.length : j;
    } else if (ch === "\\") lit = body[++i] ?? "";
    else if (ch === "_") {
      i++; // a space the width of the next character
      continue;
    } else if (/[0#?.,%]/.test(ch)) {
      num += ch;
      seen = true;
      continue;
    } else if (ch === "*") {
      i++;
      continue;
    } else lit = ch;
    if (seen) post += lit;
    else pre += lit;
  }
  const decimals = (/\.([0#?]+)/.exec(num)?.[1] ?? "").replace(/[^0]/g, "").length;
  const group = /[0#],[0#]/.test(num);
  let x = Math.abs(v) * (num.includes("%") ? 100 : 1);
  x = Number(x.toFixed(decimals));
  let s = x.toFixed(decimals);
  if (group) {
    const [int, frac] = s.split(".");
    s = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac !== undefined ? `.${frac}` : "");
  }
  const shown = `${pre}${s}${num.includes("%") ? "%" : ""}${post}`;
  // a negative with its own section says how it shows (a minus, brackets); with none it takes a minus
  return neg && x !== 0 && (secs[1] === undefined || secs[1] === "") ? `-${shown}` : shown;
}

/** A column's total's format: a count is whole, an average of whole numbers keeps a decimal. */
export function totalCode(col: Column, currency: string, withTime = false): string {
  if (col.total === "count") return "#,##0";
  if (col.total === "average" && col.type === "integer") return "#,##0.0";
  return formatCode(col.type, currency, withTime);
}

/** A worked-out cell as its column shows it. */
export function shown(v: Worked, col: Column | null, currency: string, withTime = false): string {
  if (v === null) return "";
  if (typeof v === "string") return v;
  return display(v, col ? formatCode(col.type, currency, withTime) : "General");
}

// ------------------------------------------------------------------------------------------------- the writing

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NAVY = "FF1F3A5F";
const BAND = "FFF2F5F9";
const GREY = "FF5B6B7F";

type Role = "title" | "subtitle" | "head" | "body" | "band" | "total" | "note";
/** The workbook's styles: each (role, column type) a cell format, made as they are first asked for. */
class Styles {
  readonly #fmts = new Map<string, number>();
  readonly #xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  readonly #index = new Map<string, number>();

  fmt(code: string): number {
    if (code === "@") return 49;
    let id = this.#fmts.get(code);
    if (id === undefined) this.#fmts.set(code, (id = 164 + this.#fmts.size));
    return id;
  }

  /** The cell format for a role and a column (null: the role's own, text). */
  xf(role: Role, code: string | null, right: boolean): number {
    const key = `${role}\u0000${code}\u0000${right}`;
    const had = this.#index.get(key);
    if (had !== undefined) return had;
    const numFmt = code ? this.fmt(code) : 0;
    const font = { title: 1, subtitle: 2, note: 2, head: 3, total: 4, body: 0, band: 0 }[role];
    const fill = role === "head" ? 2 : role === "band" ? 3 : 0;
    const border = role === "head" ? 1 : role === "total" ? 2 : 0;
    const align = role === "title" || role === "subtitle" || role === "note"
      ? '<alignment vertical="center"/>'
      : `<alignment horizontal="${right ? "right" : "left"}" vertical="center"${role === "head" ? ' wrapText="1"' : ""}/>`;
    const xf = `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`;
    const id = this.#xfs.length;
    this.#xfs.push(xf);
    this.#index.set(key, id);
    return id;
  }

  xml(): string {
    const font = (inner: string, color: string): string => `<font>${inner}<color rgb="${color}"/><name val="Calibri"/><family val="2"/></font>`;
    return `${XML}<styleSheet xmlns="${MAIN}">`
      + (this.#fmts.size ? `<numFmts count="${this.#fmts.size}">${[...this.#fmts].map(([c, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(c)}"/>`).join("")}</numFmts>` : "")
      + `<fonts count="5">${font('<sz val="11"/>', "FF1B1F24")}${font('<b/><sz val="16"/>', NAVY)}${font('<i/><sz val="11"/>', GREY)}${font('<b/><sz val="11"/>', "FFFFFFFF")}${font('<b/><sz val="11"/>', "FF1B1F24")}</fonts>`
      + `<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>`
      + `<fill><patternFill patternType="solid"><fgColor rgb="${NAVY}"/><bgColor indexed="64"/></patternFill></fill>`
      + `<fill><patternFill patternType="solid"><fgColor rgb="${BAND}"/><bgColor indexed="64"/></patternFill></fill></fills>`
      + `<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>`
      + `<border><left/><right/><top/><bottom style="thin"><color rgb="${NAVY}"/></bottom><diagonal/></border>`
      + `<border><left/><right/><top style="thin"><color rgb="${NAVY}"/></top><bottom style="double"><color rgb="${NAVY}"/></bottom><diagonal/></border></borders>`
      + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
      + `<cellXfs count="${this.#xfs.length}">${this.#xfs.join("")}</cellXfs>`
      + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
}

const quoted = (name: string): string => `'${name.replace(/'/g, "''")}'`;
const numeric = (t: ColumnType): boolean => t !== "text";
const hasTime = (s: Sheet, i: number): boolean => s.columns[i]!.type === "date" && s.rows.some((r) => typeof r[i] === "number" && !Number.isInteger(r[i]));

function sheetXml(s: Sheet, book: Book, st: Styles): { xml: string; laid: Laid } {
  const L = lay(s);
  const ncol = s.columns.length;
  const lastCol = colLetter(ncol - 1);
  const codes = s.columns.map((c, i) => (c.type === "text" ? null : formatCode(c.type, book.currency, hasTime(s, i))));
  const rows: string[] = [];
  const widths = s.columns.map((c) => Math.max(c.name.length * 1.15, 6));
  const cell = (ref: string, xf: number, v: Worked, f: string | null = null): string => {
    const fx = f ? `<f>${esc(f)}</f>` : "";
    if (v === null) return f ? `<c r="${ref}" s="${xf}">${fx}</c>` : `<c r="${ref}" s="${xf}"/>`;
    if (typeof v === "number") return `<c r="${ref}" s="${xf}">${fx}<v>${Number(v.toPrecision(15))}</v></c>`;
    if (ERR.test(v) && f) return `<c r="${ref}" s="${xf}" t="e">${fx}<v>${esc(v)}</v></c>`;
    if (f) return `<c r="${ref}" s="${xf}" t="str">${fx}<v>${esc(v)}</v></c>`;
    return `<c r="${ref}" s="${xf}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  let r = 1;
  if (s.title) rows.push(`<row r="${r}" ht="26" customHeight="1">${cell(`A${r++}`, st.xf("title", null, false), s.title)}</row>`);
  if (s.subtitle) rows.push(`<row r="${r}">${cell(`A${r++}`, st.xf("subtitle", null, false), s.subtitle)}</row>`);
  if (s.title || s.subtitle) r++; // a blank line before the table
  rows.push(`<row r="${L.head}" ht="22" customHeight="1">${s.columns.map((c, i) => cell(`${colLetter(i)}${L.head}`, st.xf("head", null, numeric(c.type)), c.name)).join("")}</row>`);
  L.values.forEach((vals, k) => {
    const rn = L.first + k;
    const role: Role = k % 2 === 1 ? "band" : "body";
    rows.push(`<row r="${rn}">${s.columns.map((c, i) => {
      const f = c.formula ? excelOf(parseFormula(c.formula, s.columns, ""), (col) => `${colLetter(col)}${rn}`) : null;
      widths[i] = Math.max(widths[i]!, shown(vals[i] ?? null, c, book.currency, hasTime(s, i)).length);
      return cell(`${colLetter(i)}${rn}`, st.xf(role, codes[i]!, numeric(c.type)), vals[i] ?? null, f);
    }).join("")}</row>`);
  });
  if (L.totals !== null && L.sums) {
    rows.push(`<row r="${L.totals}">${s.columns.map((c, i) => {
      const t = L.sums![i]!;
      const code = c.total ? totalCode(c, book.currency, hasTime(s, i)) : codes[i]!;
      widths[i] = Math.max(widths[i]!, (typeof t.v === "number" ? display(t.v, code ?? "General") : String(t.v ?? "")).length * 1.1);
      return cell(`${colLetter(i)}${L.totals}`, st.xf("total", typeof t.v === "number" ? code : null, numeric(c.type) || c.total === "count"), t.v, t.f);
    }).join("")}</row>`);
  }
  let nr = (L.totals ?? L.last) + 2;
  for (const n of s.notes) rows.push(`<row r="${nr}">${cell(`A${nr++}`, st.xf("note", null, false), n)}</row>`);
  const lastRow = Math.max(nr - 1, L.totals ?? L.last, L.head);
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(9, Math.ceil(w + 3))).toFixed(1)}" customWidth="1"/>`).join("");
  const filter = s.rows.length ? `<autoFilter ref="A${L.head}:${lastCol}${L.last}"/>` : "";
  const xml = `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${RELS}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>`
    + `<dimension ref="A1:${lastCol}${lastRow}"/>`
    + `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${L.head}" topLeftCell="A${L.first}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${L.first}" sqref="A${L.first}"/></sheetView></sheetViews>`
    + `<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows.join("")}</sheetData>${filter}`
    + `<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>`
    + `<pageSetup orientation="${ncol > 6 ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  return { xml, laid: L };
}

/** The workbook as an .xlsx file's bytes, and each sheet laid out (where its rows went, its totals worked out). */
export function writeXlsx(book: Book, at = new Date()): { bytes: Buffer; laid: Laid[] } {
  const st = new Styles();
  const done = book.sheets.map((s) => sheetXml(s, book, st));
  const names = book.sheets.map((s, i) => {
    const L = done[i]!.laid;
    const last = colLetter(s.columns.length - 1);
    return (s.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(quoted(s.name))}!$A$${L.head}:$${last}$${L.last}</definedName>` : "")
      + `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${esc(quoted(s.name))}!$${L.head}:$${L.head}</definedName>`;
  }).join("");
  const iso = at.toISOString().replace(/\.\d+Z$/, "Z");
  const parts = [
    { name: "[Content_Types].xml", data: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${book.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: "_rels/.rels", data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELS}/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${RELS}/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: "docProps/core.xml", data: `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${book.title ? `<dc:title>${esc(book.title)}</dc:title>` : ""}${book.author ? `<dc:creator>${esc(book.author)}</dc:creator>` : ""}<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>` },
    { name: "docProps/app.xml", data: `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Orbz</Application></Properties>` },
    { name: "xl/workbook.xml", data: `${XML}<workbook xmlns="${MAIN}" xmlns:r="${RELS}"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${book.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${names ? `<definedNames>${names}</definedNames>` : ""}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${book.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${RELS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${book.sheets.length + 1}" Type="${RELS}/styles" Target="styles.xml"/></Relationships>` },
    ...done.map((d, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: d.xml })),
    { name: "xl/styles.xml", data: st.xml() }, // last: every sheet has asked for its formats by now
  ];
  return { bytes: zip(parts, at), laid: done.map((d) => d.laid) };
}

// ------------------------------------------------------------------------------------------------- the reading

/** What part a cell plays, read off its style (never its colours: the app draws in its own). */
export type CellRole = "title" | "head" | "total" | "note" | "band" | "bold";
export type ViewCell = { v: string; num: boolean; f?: string; role?: CellRole };
export type SheetView = { name: string; rows: (ViewCell | null)[][]; widths: number[]; frozen: number; truncated: boolean };
export type BookView = { sheets: SheetView[]; truncated: boolean };
/** How much of a workbook is shown. */
export const VIEW_CAP = { sheets: 12, rows: 400, columns: 40 };

const unesc = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(cp);
      } catch {
        return "";
      }
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]!;
  });
const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? unesc(m[2] ?? m[3] ?? "") : null;
};
/** Every element named `name` (any prefix): its opening tag and what is inside it. */
function* elements(xml: string, name: string): Generator<{ tag: string; inner: string }> {
  const re = new RegExp(`<(?:\\w+:)?${name}(?=[\\s/>])[^>]*?(/?)>`, "g");
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[1] === "/") {
      yield { tag: m[0], inner: "" };
      continue;
    }
    const close = new RegExp(`</(?:\\w+:)?${name}>`, "g");
    close.lastIndex = re.lastIndex;
    const c = close.exec(xml);
    const end = c ? c.index : xml.length;
    yield { tag: m[0], inner: xml.slice(re.lastIndex, end) };
    re.lastIndex = c ? close.lastIndex : xml.length;
  }
}
const texts = (xml: string): string => [...elements(xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, ""), "t")].map((t) => unesc(t.inner)).join("");
const BUILTIN: Record<number, string> = {
  0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00", 14: "yyyy-mm-dd", 15: "d-mmm-yy", 16: "d-mmm",
  17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "yyyy-mm-dd h:mm", 37: "#,##0;(#,##0)", 38: "#,##0;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mm:ss.0", 49: "@",
};
const cellCol = (ref: string): number => {
  let n = 0;
  for (const ch of /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "A") n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Any .xlsx as it shows: each sheet's cells (as their formats show them), its columns' widths, the rows frozen at
 * its top. Up to VIEW_CAP; `truncated` says when there was more. */
export function readXlsx(bytes: Buffer): BookView {
  let z;
  try {
    z = unzip(bytes);
  } catch (e) {
    throw new SheetError(`it is not a workbook: ${e instanceof ZipError ? e.message : String(e)}`);
  }
  const part = (name: string): string | null => {
    const b = z.read(name);
    return b ? b.toString("utf8") : null;
  };
  const wb = part("xl/workbook.xml");
  if (wb === null) throw new SheetError("it is not a workbook: it has no xl/workbook.xml");
  const rels = new Map<string, string>();
  for (const r of elements(part("xl/_rels/workbook.xml.rels") ?? "", "Relationship")) {
    const id = attr(r.tag, "Id");
    const target = attr(r.tag, "Target");
    if (id && target) rels.set(id, target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);
  }
  const shared = [...elements(part("xl/sharedStrings.xml") ?? "", "si")].map((si) => texts(si.inner));
  const styles = part("xl/styles.xml") ?? "";
  const fmts = new Map<number, string>(Object.entries(BUILTIN).map(([k, v]) => [Number(k), v]));
  for (const f of elements(styles, "numFmt")) fmts.set(Number(attr(f.tag, "numFmtId")), attr(f.tag, "formatCode") ?? "General");
  const section = (name: string): string => [...elements(styles, name)][0]?.inner ?? "";
  const fonts = [...elements(section("fonts"), "font")].map((f) => ({
    b: /<(?:\w+:)?b(\s+val="(1|true)")?\s*\/>/.test(f.inner), i: /<(?:\w+:)?i(\s+val="(1|true)")?\s*\/>/.test(f.inner),
    sz: Number(attr([...elements(f.inner, "sz")][0]?.tag ?? "", "val") ?? 11),
  }));
  const fills = [...elements(section("fills"), "fill")].map((f) => /patternType="solid"/.test(f.inner));
  const borders = [...elements(section("borders"), "border")].map((b) => /<(?:\w+:)?top\b[^>]*\sstyle="/.test(b.inner));
  const xfs = [...elements(section("cellXfs"), "xf")].map((x) => ({
    fmt: Number(attr(x.tag, "numFmtId") ?? 0), font: Number(attr(x.tag, "fontId") ?? 0), fill: Number(attr(x.tag, "fillId") ?? 0), border: Number(attr(x.tag, "borderId") ?? 0),
  }));
  const roleOf = (s: number): CellRole | undefined => {
    const x = xfs[s];
    if (!x) return undefined;
    const f = fonts[x.font] ?? { b: false, i: false, sz: 11 };
    const filled = fills[x.fill] ?? false;
    if (f.sz >= 14) return "title";
    if (filled && f.b) return "head";
    if (f.b && borders[x.border]) return "total";
    if (f.i) return "note";
    if (filled) return "band";
    return f.b ? "bold" : undefined;
  };
  const list = [...elements(wb, "sheet")];
  const out: SheetView[] = [];
  for (const s of list.slice(0, VIEW_CAP.sheets)) {
    const name = attr(s.tag, "name") ?? `Sheet${out.length + 1}`;
    const target = rels.get(attr(s.tag, "r:id") ?? "") ?? null;
    const xml = target ? part(target) : null;
    if (xml === null) continue; // a chart sheet, or a part not there
    let truncated = false;
    const rows: (ViewCell | null)[][] = [];
    let maxCol = 0;
    for (const row of elements(xml, "row")) {
      const rn = Number(attr(row.tag, "r") ?? rows.length + 1) - 1;
      if (rn >= VIEW_CAP.rows) {
        truncated = true;
        break;
      }
      const cells: (ViewCell | null)[] = [];
      let next = 0;
      for (const c of elements(row.inner, "c")) {
        const ref = attr(c.tag, "r");
        const col = ref ? cellCol(ref) : next;
        next = col + 1;
        if (col >= VIEW_CAP.columns) {
          truncated = true;
          continue;
        }
        const t = attr(c.tag, "t") ?? "n";
        const s0 = Number(attr(c.tag, "s") ?? 0);
        const raw = [...elements(c.inner, "v")][0]?.inner;
        const f = [...elements(c.inner, "f")][0]?.inner;
        let v = "";
        let num = false;
        if (t === "s") v = shared[Number(raw)] ?? "";
        else if (t === "inlineStr") v = texts([...elements(c.inner, "is")][0]?.inner ?? "");
        else if (t === "str" || t === "e") v = unesc(raw ?? "");
        else if (t === "b") v = raw === "1" ? "TRUE" : "FALSE";
        else if (raw !== undefined && raw !== "") {
          const n = Number(raw);
          v = Number.isFinite(n) ? display(n, fmts.get(xfs[s0]?.fmt ?? 0) ?? "General") : unesc(raw);
          num = Number.isFinite(n);
        }
        const role = roleOf(s0);
        if (!v && !role && !f) continue;
        cells[col] = { v, num, ...(f && { f: `=${unesc(f)}` }), ...(role && { role }) };
        maxCol = Math.max(maxCol, col + 1);
      }
      rows[rn] = cells;
    }
    const widths: number[] = [];
    for (const c of elements(xml, "col")) {
      const w = Number(attr(c.tag, "width"));
      for (let i = Number(attr(c.tag, "min") ?? 1) - 1; i < Math.min(Number(attr(c.tag, "max") ?? 1), VIEW_CAP.columns); i++) if (Number.isFinite(w)) widths[i] = w;
    }
    const pane = [...elements(xml, "pane")][0];
    const frozen = pane && attr(pane.tag, "state") === "frozen" ? Number(attr(pane.tag, "ySplit") ?? 0) : 0;
    const filled = Array.from({ length: rows.length }, (_, i) => Array.from({ length: maxCol }, (_x, j) => rows[i]?.[j] ?? null));
    out.push({ name, rows: filled, widths: Array.from({ length: maxCol }, (_, i) => widths[i] ?? 9), frozen, truncated });
  }
  return { sheets: out, truncated: list.length > VIEW_CAP.sheets };
}

/** A workbook as text, for a model (read_file): each sheet's cells as they show, a tab between them, and its formulas. */
export function bookText(view: BookView, cap = 30_000): string {
  const parts: string[] = [];
  for (const s of view.sheets) {
    const lines = s.rows.map((r) => r.map((c) => c?.v ?? "").join("\t").replace(/\t+$/, ""));
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    const formulas = s.rows.flatMap((r, i) => r.flatMap((c, j) => (c?.f ? [`${colLetter(j)}${i + 1} ${c.f}`] : []))).slice(0, 12);
    parts.push(`Sheet "${s.name}"${s.truncated ? " (only its first part)" : ""}:\n${lines.join("\n")}${formulas.length ? `\nFormulas: ${formulas.join("; ")}` : ""}`);
  }
  const text = parts.join("\n\n") + (view.truncated ? "\n\n(More sheets than are shown.)" : "");
  return text.length > cap ? `${text.slice(0, cap)}\n… (cut)` : text;
}
