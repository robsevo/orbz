// PLAN 2.8_t, what his computer shows, read from his conversation and his files (rooms/work.ts):
//   - his acts: the tool, on what, what came back, or that it waits for your OK; a decision is
//     not work; the files he touched, newest last;
//   - the kind of work a file is, and each kind read the way it is drawn: a CSV's rows (quotes,
//     line breaks inside them, a TSV), a JSON's bars, a document's blocks, a calendar's events.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "../src/home/link.ts";
import { actsOf, chartOf, docBlocks, filesOf, icsEvents, kindOf, parseCsv } from "../src/rooms/work.ts";

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
