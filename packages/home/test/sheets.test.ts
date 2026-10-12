// PLAN 4.9_t (a real Excel workbook, formatted as an analyst would):
//   - What an orb hands in is checked before anything is written: a formula naming a column that is not there, a loop
//     of formulas, a text column summed, a share's total without the totals it reads, a date that is not one, a
//     sheet's name Excel refuses.
//   - Every cell the workbook shows is the cell a spreadsheet works out: LibreOffice, made to recalculate every formula
//     on opening (never trusting the values written beside them), reads the same numbers we wrote.
//   - It reads back as it was made: the title, the header frozen in view, banded rows, the totals, the notes, each
//     number in its column's format; a workbook LibreOffice wrote (shared strings, its own styles) reads too.
//   - The orb's tool: a workbook in its workspace that says its totals back, refused outside it or not named .xlsx;
//     read_file and his computer's screen read it as its cells.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { bookOf, display, readXlsx, writeXlsx } from "../src/sheets/xlsx.ts";
import { unzip, zip } from "../src/sheets/zip.ts";
import { readWorkspace, workspaceOf } from "../src/workspace.ts";
import { agentHome, tempDir } from "./helpers.ts";

const BOSS = {
  title: "Q3 by region",
  sheets: [
    {
      name: "Q3", title: "Q3 Results by Region", subtitle: "Prepared for Dana Whitfield · Oct 12, 2026",
      columns: [
        { name: "Region" }, { name: "Revenue", type: "currency", total: "sum" }, { name: "Cost", type: "currency", total: "sum" },
        { name: "Profit", type: "currency", formula: "[Revenue]-[Cost]", total: "sum" }, { name: "Margin", type: "percent", formula: "[Profit]/[Revenue]", total: "formula" },
        { name: "Closed", type: "date" }, { name: "Deals", type: "integer", total: "average" }, { name: "Per deal", type: "currency", formula: "-(([Cost]-[Revenue])/[Deals])" },
      ],
      rows: [
        ["North", "$1,250,000", "830000.50", "", "", "2026-09-30", "14"],
        ["South", "980000", "(12,000)", "", "", "2026-09-28", "9"],
        ["West", "0", "100", "", "", "", "3"],
        ["East", "42.5", "17.25", "", "", "2026-07-01", "0"],
      ],
      notes: ["Numbers from the September close."],
    },
    { name: "Notes & caveats", columns: ["Item", { name: "Owner" }], rows: [["Check FX on South", "Penny"]] },
  ],
};

const soffice = spawnSync("soffice", ["--version"], { encoding: "utf8" }).status === 0;
/** LibreOffice, in a profile of its own that recalculates every formula when it opens a workbook. */
function libre(t: { after: (f: () => void) => void } | null, dir: string, args: string[]): void {
  const profile = join(dir, "lo-profile");
  mkdirSync(join(profile, "user"), { recursive: true });
  writeFileSync(join(profile, "user", "registrymodifications.xcu"), `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>`);
  execFileSync("soffice", [`-env:UserInstallation=file://${profile}`, "--headless", ...args], { cwd: dir, timeout: 120_000, stdio: "ignore" });
  void t;
}
/** A CSV's rows (LibreOffice's: quoted where a field holds a comma). */
const csvRows = (text: string): string[][] => text.trim().split(/\r?\n/).map((l) => [...l.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1]!.replace(/^"|"$/g, "").replace(/""/g, '"')).slice(0, -1));

test("what an orb hands in is checked before anything is written", () => {
  const sheet = (columns: unknown[], rows: unknown[][] = []) => ({ sheets: [{ name: "S", columns, rows }] });
  const refused: [unknown, RegExp][] = [
    [{ sheets: [] }, /at least one sheet/],
    [sheet([{ name: "A", type: "number" }, { name: "B", formula: "[A]*[C]" }]), /names \[C\], which is not one of its columns/],
    [sheet([{ name: "A", formula: "[B]+1" }, { name: "B", formula: "[A]+1" }]), /go round in a loop \(A → B → A\)/],
    [sheet([{ name: "A", total: "sum" }]), /A is text, so its total can only be count/],
    [sheet([{ name: "A", type: "number" }, { name: "B", type: "number" }, { name: "R", type: "percent", formula: "[A]/[B]", total: "formula" }]), /R's total is its formula on the totals, so A and B need a total/],
    [sheet([{ name: "D", type: "date" }], [["2026-02-30"]]), /"2026-02-30" is not a date/],
    [sheet([{ name: "N", type: "number" }], [["twelve"]]), /row 1, N: "twelve" is not a number/],
    [sheet([{ name: "A" }], [["x", "y"]]), /row 1 has 2 cells for 1 columns/],
    [{ sheets: [{ name: "Q3/Q4", columns: ["A"], rows: [] }] }, /a sheet's name has none of/],
    [{ sheets: [{ name: "x".repeat(32), columns: ["A"], rows: [] }] }, /at most 31 characters/],
    [sheet([{ name: "A", type: "number", formula: "SUM(1)" }]), /has "S" in it/],
    [{ currency: "BTC", sheets: [{ name: "S", columns: ["A"], rows: [] }] }, /currency is one of/],
  ];
  for (const [given, why] of refused) assert.throws(() => bookOf(given), why, JSON.stringify(given).slice(0, 80));
  const b = bookOf(sheet([{ name: "P", type: "percent" }, { name: "C", type: "currency" }, { name: "I", type: "integer" }], [["12.5%", "-$1,200.50", "7.6"], ["0.25", "(3)", "2"]]));
  assert.deepEqual(b.sheets[0]!.rows, [[0.125, -1200.5, 8], [0.25, -3, 2]], "a percent as written or a fraction; money as written; whole numbers rounded");
  assert.equal(display(-1200.5, '"$"#,##0.00;[Red]\\-"$"#,##0.00'), "-$1,200.50");
  assert.equal(display(46295, "mmm d, yyyy"), "Sep 30, 2026");
  assert.equal(display(0.33599, "0.0%"), "33.6%");
  assert.equal(display(-4, "#,##0;(#,##0)"), "(4)");
});

test("every cell the workbook shows is the cell LibreOffice works out, recalculating every formula itself", { skip: !soffice && "LibreOffice is not installed" }, (t) => {
  const dir = tempDir(t);
  const book = bookOf(BOSS);
  const { bytes, laid } = writeXlsx(book, new Date("2026-10-12T15:00:00Z"));
  // the values written beside the formulas made wrong: LibreOffice must find the right ones by working each formula
  // out itself (were it reading what we wrote, this copy would show zeros and the comparison below would fail)
  const z = unzip(bytes);
  const wrong = z.names.map((name) => {
    const data = z.read(name)!.toString("utf8");
    return { name, data: name === "xl/worksheets/sheet1.xml" ? data.replace(/(<f>[^<]*<\/f>)<v>[^<]*<\/v>/g, "$1<v>0</v>") : data };
  });
  assert.ok(wrong.some((p) => p.name === "xl/worksheets/sheet1.xml" && (p.data.match(/<f>[^<]*<\/f><v>0<\/v>/g) ?? []).length >= 12), "every formula's value made 0");
  writeFileSync(join(dir, "q3.xlsx"), zip(wrong));
  libre(t, dir, ["--convert-to", "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,true,false,false,-1", "q3.xlsx", "--outdir", "out"]);
  const csvs = readdirSync(join(dir, "out")).sort();
  assert.deepEqual(csvs, ["q3-Notes & caveats.csv", "q3-Q3.csv"], "a CSV a sheet");
  const theirs = csvRows(readFileSync(join(dir, "out", "q3-Q3.csv"), "utf8"));
  const ours = readXlsx(bytes).sheets[0]!.rows.map((r) => r.map((c) => c?.v ?? ""));
  // LibreOffice shows each cell as formatted (the "true" for formatted text in the filter): the same strings
  const width = BOSS.sheets[0]!.columns.length;
  const norm = (rows: string[][]): string[][] => rows.map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").replace(/ /g, " ")));
  assert.deepEqual(norm(theirs), norm(ours), "the same cells, formulas recalculated by LibreOffice");
  const L = laid[0]!;
  assert.deepEqual([L.head, L.first, L.last, L.totals], [4, 5, 8, 9]);
  assert.deepEqual(ours[8], ["Total", "$2,230,042.50", "$818,117.75", "$1,411,924.75", "63.3%", "", "6.5", ""], "the totals row: sums, the margin from the totals, an average keeps its decimal");
  assert.deepEqual(ours[6]!.slice(3, 5), ["-$100.00", "#DIV/0!"], "a share of nothing is Excel's own error");
  assert.equal(ours[7]![7], "#DIV/0!", "and a division by zero deals");
});

test("it reads back as it was made; a workbook LibreOffice wrote reads too", { skip: !soffice && "LibreOffice is not installed" }, (t) => {
  const v = readXlsx(writeXlsx(bookOf(BOSS)).bytes);
  const s = v.sheets[0]!;
  assert.equal(s.name, "Q3");
  assert.equal(s.frozen, 4, "the header stays in view");
  assert.deepEqual(s.rows.map((r) => r[0]?.role ?? null), ["title", "note", null, "head", null, "band", null, "band", "total", null, "note"], "title, subtitle, header, banded rows, totals, a note");
  assert.deepEqual(s.rows[3]!.map((c) => c?.v), ["Region", "Revenue", "Cost", "Profit", "Margin", "Closed", "Deals", "Per deal"]);
  assert.deepEqual([s.rows[4]![1], s.rows[4]![3]], [{ v: "$1,250,000.00", num: true }, { v: "$419,999.50", num: true, f: "=B5-C5" }]);
  assert.equal(s.rows[4]![7]?.f, "=-((C5-B5)/G5)", "brackets kept where they change the sum");
  assert.ok(s.widths[1]! >= "$2,230,042.50".length, "a column as wide as its widest number");
  assert.equal(v.sheets[1]!.name, "Notes & caveats");
  // LibreOffice's own .xlsx: shared strings and its own styles
  const dir = tempDir(t);
  writeFileSync(join(dir, "plain.csv"), "Item,Amount\nRent,1200.5\nPower,85\n");
  libre(t, dir, ["--convert-to", "xlsx", "plain.csv", "--outdir", "out"]);
  const theirs = readXlsx(readFileSync(join(dir, "out", "plain.xlsx")));
  assert.deepEqual(theirs.sheets[0]!.rows.map((r) => r.map((c) => c?.v ?? "")), [["Item", "Amount"], ["Rent", "1200.5"], ["Power", "85"]]);
  assert.throws(() => readXlsx(Buffer.from("not a zip at all")), /it is not a workbook/);
});

test("the orb's tool: a workbook in its workspace that says its totals back; read_file and his screen read its cells", { timeout: 60_000 }, async (t) => {
  const args = { path: "reports/q3-by-region.xlsx", title: BOSS.title, sheets: BOSS.sheets };
  const { home, dataDir } = await agentHome(t, [
    { calls: [{ name: "write_sheet", args: { ...args, path: "q3.csv" } }] },
    { calls: [{ name: "write_sheet", args: { ...args, path: "../q3.xlsx" } }] },
    { calls: [{ name: "write_sheet", args }] },
    { calls: [{ name: "read_file", args: { path: "reports/q3-by-region.xlsx" } }] },
    { chunks: ["It's in reports/q3-by-region.xlsx: $1,411,924.75 profit, a 63.3% margin."] },
  ]);
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "make Dana a professional Q3 sheet by region");
  await home.inbox.idle();
  const results = home.conversations.list("chat:juniper").filter((m) => m.role === "tool").map((m) => m.content);
  assert.match(results[0]!, /^Refused: q3\.csv is not a workbook's name: end it in \.xlsx\./);
  assert.match(results[1]!, /^Refused: \.\.\/q3\.xlsx is outside the workspace\./);
  assert.match(results[2]!, /^Made reports\/q3-by-region\.xlsx \(\d+ KB\), a workbook that opens in Excel:\n- "Q3": 4 rows, 8 columns; totals: Revenue \$2,230,042\.50, Cost \$818,117\.75, Profit \$1,411,924\.75, Margin 63\.3%, Deals 6\.5; formulas: Profit = \[Revenue\]-\[Cost\]; Margin = \[Profit\]\/\[Revenue\]; Per deal = /);
  assert.match(results[2]!, /\n- "Notes & caveats": 1 row, 2 columns$/);
  assert.match(results[3]!, /^Sheet "Q3":\nQ3 Results by Region\n[^]*\nTotal\t\$2,230,042\.50\t\$818,117\.75\t\$1,411,924\.75\t63\.3%\t\t6\.5\n[^]*Formulas: D5 =B5-C5;/, "read_file reads its cells, not its bytes");
  const f = readWorkspace(dataDir, "juniper", "reports/q3-by-region.xlsx");
  assert.equal(f.text, null);
  assert.equal(f.sheet?.sheets[0]?.rows[8]?.[3]?.v, "$1,411,924.75", "his screen gets the sheet as it shows");
  const bad = join(workspaceOf(dataDir, "juniper"), "broken.xlsx");
  writeFileSync(bad, "PK not really");
  assert.match(readWorkspace(dataDir, "juniper", "broken.xlsx").sheetError ?? "", /not a workbook/);
});
