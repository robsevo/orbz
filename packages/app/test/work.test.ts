// PLAN 2.8_t, what his computer shows, read from his conversation and his files (rooms/work.ts):
//   - his acts: the tool, on what, what came back, or that it waits for your OK; a decision is
//     not work; the files he touched, newest last;
//   - the kind of work a file is, and each kind read the way it is drawn: a CSV's rows (quotes,
//     line breaks inside them, a TSV), a JSON's bars, a document's blocks, a calendar's events;
//     a workbook is a spreadsheet (PLAN 4.9) and counts as a file he made;
//   - an inbox he tidies (PLAN 4.10): as he was shown it, each message's fate while it waits for
//     your OK, then what moved gone from it and what was marked read read; refused, it stays.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "../src/home/link.ts";
import { actsOf, chartOf, docBlocks, filesOf, icsEvents, inboxOf, kindOf, parseCsv } from "../src/rooms/work.ts";

const msg = (id: number, m: Partial<Message>): Message => ({ id, conversation: "c", orb: "hazel", run: 1, role: "assistant", content: "", toolCalls: null, meta: {}, at: id * 1000, ...m });

test("his acts: what he used, on what, what came back; one waiting for your OK; a decision is not work", () => {
  const messages: Message[] = [
    msg(1, { toolCalls: [{ id: "a", name: "write_file", arguments: JSON.stringify({ path: "sales.csv", content: "x" }) }, { id: "b", name: "agree", arguments: '{"decision":"Saturday"}' }] }),
    msg(2, { role: "tool", toolCallId: "a", content: "Wrote 1 characters to sales.csv." }),
    msg(3, { toolCalls: [{ id: "c", name: "shell", arguments: JSON.stringify({ command: "wc -l sales.csv" }) }] }),
    msg(4, { orb: "milo", toolCalls: [{ id: "d", name: "read_file", arguments: '{"path":"notes.md"}' }] }),
    msg(5, { toolCalls: [{ id: "e", name: "read_file", arguments: '{"path":"gone.txt"}' }] }),
    msg(6, { role: "tool", toolCallId: "e", content: "ENOENT", meta: { error: true } }),
  ];
  const acts = actsOf(messages, "hazel");
  assert.deepEqual(acts.map((a) => [a.tool, a.on, a.result, a.failed]), [
    ["write_file", "sales.csv", "Wrote 1 characters to sales.csv.", false],
    ["shell", "wc -l sales.csv", null, false],
    ["read_file", "gone.txt", "ENOENT", true],
  ]);
  assert.deepEqual(filesOf(acts), ["sales.csv", "gone.txt"]);
  assert.equal(actsOf(messages, "milo")[0]!.on, "notes.md", "each orb his own");
  assert.equal(actsOf(messages, "hazel", 1).length, 1);
});

test("the kind of work a file is", () => {
  assert.equal(kindOf("data/sales.csv"), "dataset");
  assert.equal(kindOf("Q1.TSV"), "dataset");
  assert.equal(kindOf("site/index.html"), "ui");
  assert.equal(kindOf("report.md"), "doc");
  assert.equal(kindOf("team.ics"), "calendar");
  assert.equal(kindOf("sales.json", '[{"month":"Jan","total":12}]'), "dashboard");
  assert.equal(kindOf("config.json", '{"port": 8080}'), "code", "numbers that are not a list of records are not a chart");
  assert.equal(kindOf("app.ts"), "code");
  assert.equal(kindOf("reports/Q3.XLSX"), "sheet");
  const made = actsOf([msg(1, { toolCalls: [{ id: "s", name: "write_sheet", arguments: JSON.stringify({ path: "q3.xlsx", sheets: [] }) }] })], "hazel");
  assert.deepEqual(filesOf(made), ["q3.xlsx"], "a workbook he made is a file he made");
});

test("an inbox he tidies: as shown, each message's fate while it waits for you, then what moved gone and what was read read", () => {
  const rows = [
    { uid: 4, from: "GitHub", subject: "CI passed", date: 4000, seen: false, list: true },
    { uid: 3, from: "Uber", subject: "Your trip", date: 3000, seen: true, list: false },
    { uid: 2, from: "LinkedIn", subject: "12 jobs", date: 2000, seen: false, list: true },
    { uid: 1, from: "Dana Whitfield", subject: "Q3?", date: 1000, seen: false, list: false },
  ];
  const list = msg(1, { toolCalls: [{ id: "l", name: "list_mail", arguments: '{"account":"work"}' }] });
  const listed = msg(2, { role: "tool", toolCallId: "l", content: "(fenced)", meta: { view: { inbox: { account: "work", total: 30, unread: 9, rows } } } });
  const tidy = msg(3, { toolCalls: [{ id: "t", name: "tidy_mail", arguments: JSON.stringify({ account: "work", archive: [2], folders: [{ folder: "Receipts", uids: [3] }], read: [4] }) }] });
  assert.equal(inboxOf(actsOf([msg(9, { toolCalls: [{ id: "x", name: "shell", arguments: "{}" }] })], "hazel")), null, "no look, no inbox");
  const shown = inboxOf(actsOf([list, listed], "hazel"))!;
  assert.deepEqual([shown.state, shown.account, shown.total, shown.unread, shown.rows.map((r) => r.fate)], ["shown", "work", 30, 9, [null, null, null, null]]);
  const asking = inboxOf(actsOf([list, listed, tidy], "hazel"))!;
  assert.equal(asking.state, "asking");
  assert.deepEqual(asking.rows.map((r) => [r.uid, r.fate, r.gone]), [[4, { kind: "read" }, false], [3, { kind: "folder", folder: "Receipts" }, false], [2, { kind: "archive" }, false], [1, null, false]]);
  const done = inboxOf(actsOf([list, listed, tidy, msg(4, { role: "tool", toolCallId: "t", content: "Done in work: archived 1, filed 1 in Receipts, marked 1 read. Nothing was deleted.", meta: { view: { tidied: {} } } })], "hazel"))!;
  assert.deepEqual([done.state, done.summary, done.total, done.unread], ["done", "Archived 1, filed 1 in Receipts, marked 1 read. Nothing was deleted.", 28, 7]);
  assert.deepEqual(done.rows.map((r) => [r.uid, r.gone, r.seen]), [[4, false, true], [3, true, true], [2, true, false], [1, false, false]], "moved ones leave, the read one is read");
  const refused = inboxOf(actsOf([list, listed, tidy, msg(4, { role: "tool", toolCallId: "t", content: "The inbox was not tidied: no MOVE", meta: { error: true } })], "hazel"))!;
  assert.deepEqual([refused.state, refused.rows.filter((r) => r.gone).length], ["refused", 0], "refused: nothing left it");
});

test("a CSV's rows: quotes, a doubled quote, a line break inside quotes, CRLF, a TSV", () => {
  assert.deepEqual(parseCsv('name,note\r\n"Smith, Jo","said ""hi"""\n"two\nlines",x\n\n'), [["name", "note"], ["Smith, Jo", 'said "hi"'], ["two\nlines", "x"]]);
  assert.deepEqual(parseCsv("a\tb\n1\t2"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsv("a,b,c\n1,,3"), [["a", "b", "c"], ["1", "", "3"]], "an empty field is kept");
});

test("a JSON's bars: a field that names each record, one that is a number in every one", () => {
  assert.deepEqual(chartOf('[{"month":"Jan","total":12,"note":"x"},{"month":"Feb","total":30,"note":"y"}]'), { label: "month", value: "total", bars: [{ label: "Jan", value: 12 }, { label: "Feb", value: 30 }] });
  assert.deepEqual(chartOf('{"title":"Sales","rows":[{"m":"Jan","n":1}]}')?.bars, [{ label: "Jan", value: 1 }], "a list inside an object");
  assert.equal(chartOf('[{"month":"Jan","total":"12"}]'), null, "a number written as text is not drawn");
  assert.equal(chartOf("not json"), null);
  assert.equal(chartOf("[]"), null);
});

test("a document's blocks: headings, list items, paragraphs joined, fenced code kept as it is", () => {
  assert.deepEqual(docBlocks("# Plan\n\nThe **first** step\nis `small`.\n\n- one\n2. two\n\n```\nlet x = 1;\n  y\n```\n### Done"), [
    { kind: "h1", text: "Plan" },
    { kind: "p", text: "The first step is small." },
    { kind: "li", text: "one" },
    { kind: "li", text: "two" },
    { kind: "code", text: "let x = 1;\n  y" },
    { kind: "h3", text: "Done" },
  ]);
});

test("a calendar's events, in order: a day, a time, a line folded mid-word, escaped commas", () => {
  const ics = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART;TZID=Europe/Lisbon:20261005T093000", "SUMMARY:Stand-up\\, team", "END:VEVENT", "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261003", "SUMMARY:Rent is d", " ue", "END:VEVENT", "BEGIN:VEVENT", "SUMMARY:no start", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  assert.deepEqual(icsEvents(ics), [{ start: "2026-10-03", summary: "Rent is due" }, { start: "2026-10-05 09:30", summary: "Stand-up, team" }]);
});
