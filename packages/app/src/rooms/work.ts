// What an orb's computer shows (PLAN 2.8; owner, 10-01: "we want to see what theire doing ...
// wether its an excel file were creating or an app or just doing our finances"), worked out from
// his conversation and his files, pure so its tests can read it (rooms/Computer.tsx draws it):
//   - his acts: each tool he used, on what, and what came back (or that it waits for your OK);
//   - the kind of work a file is: a dataset, a page (UI), a dashboard's numbers, a document, a
//     calendar, or code;
//   - each kind read the way it is drawn: a CSV's rows, a JSON's bars, a document's blocks, a
//     calendar's events. Every number shown is one of these, read from the file: none is typed.
import type { Message } from "../home/link.ts";

/** One thing he did on his computer. `result` is null while it waits for your OK; `view` is what the home kept of it
 * for his screen (an inbox's rows, PLAN 4.10). */
export type Act = { id: string; tool: string; on: string; args: Record<string, unknown>; result: string | null; failed: boolean; at: number; view: Record<string, unknown> | null };

/** His acts in a conversation, oldest first (the last `last` of them). */
export function actsOf(messages: Message[], orb: string, last = Infinity): Act[] {
  const results = new Map(messages.filter((m) => m.role === "tool" && m.toolCallId).map((m) => [m.toolCallId!, m]));
  const acts: Act[] = [];
  for (const m of messages) {
    if (m.role !== "assistant" || m.orb !== orb || !m.toolCalls) continue;
    for (const c of m.toolCalls) {
      if (c.name === "agree") continue; // a decision shows as ✓ Agreed, not as work
      let args: Record<string, unknown> = {};
      try {
        const v = JSON.parse(c.arguments || "{}") as unknown;
        if (v && typeof v === "object" && !Array.isArray(v)) args = v as Record<string, unknown>;
      } catch {
        args = { raw: c.arguments };
      }
      const firstText = String(Object.values(args).find((v) => typeof v === "string") ?? "");
      const on = String(args.path ?? args.command ?? args.url ?? args.query ?? firstText);
      const r = results.get(c.id);
      const view = r?.meta?.view && typeof r.meta.view === "object" ? (r.meta.view as Record<string, unknown>) : null;
      acts.push({ id: c.id, tool: c.name, on: on.length > 90 ? `${on.slice(0, 89)}…` : on, args, result: r?.content ?? null, failed: r?.meta?.error === true, at: r?.at ?? m.at, view });
    }
  }
  return acts.slice(-last);
}

/** What a tool does, in a few words, for his activity. */
export const ACT_WORDS: Record<string, string> = {
  write_file: "Wrote", read_file: "Read", list_files: "Looked in", shell: "Ran", shell_output: "Checked", stop_shell: "Stopped",
  web_search: "Searched for", web_fetch: "Read the page", ask_owner: "Asked you", propose_plan: "Proposed a plan",
  open_page: "Opened", read_page: "Read the page", click: "Clicked", type_into: "Typed into", sign_in: "Signed in", check_page: "Checked",
  write_sheet: "Made the spreadsheet", read_mail: "Read the mail", draft_reply: "Drafted a reply", list_mail: "Looked through the inbox of", tidy_mail: "Tidied the inbox of",
};

/** The tools that make a file he shows: a text file, a workbook. */
export const WRITES = new Set(["write_file", "write_sheet"]);

/** The files he made or touched here, newest last, by their path. */
export const filesOf = (acts: Act[]): string[] => {
  const seen = new Map<string, number>();
  acts.forEach((a, i) => {
    if ((WRITES.has(a.tool) || a.tool === "read_file") && typeof a.args.path === "string") seen.set(a.args.path, i);
  });
  return [...seen.entries()].sort((x, y) => x[1] - y[1]).map(([p]) => p);
};

export type Kind = "dataset" | "ui" | "dashboard" | "doc" | "calendar" | "code" | "sheet";

/** The kind of work a file is, from its name (a JSON is a dashboard when its numbers can be drawn). */
export function kindOf(path: string, text: string | null = null): Kind {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx") return "sheet";
  if (ext === "csv" || ext === "tsv") return "dataset";
  if (ext === "html" || ext === "htm") return "ui";
  if (ext === "md" || ext === "markdown" || ext === "txt") return "doc";
  if (ext === "ics") return "calendar";
  if (ext === "json" && text !== null && chartOf(text)) return "dashboard";
  return "code";
}

/** A CSV's (or a TSV's) rows: quoted fields, quotes doubled inside them, line breaks inside quotes. */
export function parseCsv(text: string, sep = text.split("\n", 1)[0]!.includes("\t") ? "\t" : ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === sep) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f !== ""));
}

export type Chart = { label: string; value: string; bars: { label: string; value: number }[] };

/** A JSON list of records, drawn as bars: the first field that names each one, the first that is a
 * number in every one. Anything else is not a chart (it is shown as code). */
export function chartOf(text: string): Chart | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  const list = Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v as object).find(Array.isArray) : null;
  if (!Array.isArray(list) || !list.length || !list.every((r) => r && typeof r === "object" && !Array.isArray(r))) return null;
  const recs = list as Record<string, unknown>[];
  const keys = Object.keys(recs[0]!);
  const value = keys.find((k) => recs.every((r) => typeof r[k] === "number" && Number.isFinite(r[k])));
  const label = keys.find((k) => k !== value && recs.every((r) => typeof r[k] === "string" || typeof r[k] === "number"));
  if (!value || !label) return null;
  return { label, value, bars: recs.map((r) => ({ label: String(r[label]), value: r[value] as number })) };
}

export type Block = { kind: "h1" | "h2" | "h3" | "p" | "li" | "code"; text: string };

/** A document's blocks (markdown, lightly: headings, list items, paragraphs, fenced code). */
export function docBlocks(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let code: string[] | null = null;
  const flush = (): void => {
    if (para.length) out.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    if (code) {
      if (/^```/.test(raw)) {
        out.push({ kind: "code", text: code.join("\n") });
        code = null;
      } else code.push(raw);
      continue;
    }
    if (/^```/.test(raw)) {
      flush();
      code = [];
      continue;
    }
    const line = raw.trim();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (h) {
      flush();
      out.push({ kind: `h${h[1]!.length}` as Block["kind"], text: plain(h[2]!) });
    } else if (li) {
      flush();
      out.push({ kind: "li", text: plain(li[1]!) });
    } else para.push(plain(line));
  }
  if (code) out.push({ kind: "code", text: code.join("\n") });
  flush();
  return out;
}
const plain = (s: string): string => s.replace(/\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`/g, (_, a, b, c) => a ?? b ?? c);

export type Happening = { start: string; summary: string };

/** A calendar's events (an .ics file): when each starts (as written, YYYY-MM-DD[ HH:MM]) and what it is, in order. */
export function icsEvents(text: string): Happening[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/); // a folded line continues on the next
  const out: Happening[] = [];
  let ev: Partial<Happening> | null = null;
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") ev = {};
    else if (l === "END:VEVENT") {
      if (ev?.start) out.push({ start: ev.start, summary: ev.summary ?? "(untitled)" });
      ev = null;
    } else if (ev) {
      const m = /^([A-Z-]+)(?:;[^:]*)?:(.*)$/.exec(l);
      if (!m) continue;
      if (m[1] === "SUMMARY") ev.summary = m[2]!.replace(/\\([,;\\])/g, "$1").replace(/\\n/gi, " ");
      if (m[1] === "DTSTART") {
        const d = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(m[2]!);
        if (d) ev.start = `${d[1]}-${d[2]}-${d[3]}${d[4] ? ` ${d[4]}:${d[5]}` : ""}`;
      }
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** Where a message goes in a tidy (PLAN 4.10): archived, filed into a folder, or marked read where it is. */
export type Fate = { kind: "archive" } | { kind: "folder"; folder: string } | { kind: "read" };
/** `gone`: moved out of the inbox by a tidy that was done (kept a moment for his screen to show it leaving). */
export type InboxRow = { uid: number; from: string; subject: string; date: number | null; seen: boolean; list: boolean; fate: Fate | null; gone: boolean };
/** An inbox on his screen: as he was shown it, then what he proposes for each message (waiting for your OK), then what
 * was done (`done`: those moved are gone from it, those marked read are read). `act` is the step it is drawn from. */
export type Inbox = { account: string; total: number; unread: number; rows: InboxRow[]; state: "shown" | "asking" | "done" | "refused"; act: string; summary: string | null };

const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const nums = (v: unknown): number[] => listOf(v).map(Number).filter((n) => Number.isInteger(n));

/** The inbox he looked through last (list_mail's rows), with the tidy he proposed for it after, if any. Null when he
 * has looked through none. */
export function inboxOf(acts: Act[]): Inbox | null {
  const at = acts.findLastIndex((a) => a.tool === "list_mail" && a.view?.inbox);
  if (at < 0) return null;
  const v = acts[at]!.view!.inbox as { account?: unknown; total?: unknown; unread?: unknown; rows?: unknown };
  const account = String(v.account ?? "");
  const rows: InboxRow[] = listOf(v.rows).map((r0) => {
    const r = (r0 ?? {}) as Record<string, unknown>;
    return { uid: Number(r.uid), from: String(r.from ?? ""), subject: String(r.subject ?? ""), date: typeof r.date === "number" ? r.date : null, seen: r.seen === true, list: r.list === true, fate: null, gone: false };
  });
  const base = { account, total: Number(v.total ?? rows.length), unread: Number(v.unread ?? 0), rows };
  const tidy = acts.slice(at + 1).findLast((a) => a.tool === "tidy_mail" && String(a.args.account ?? "") === account);
  if (!tidy) return { ...base, state: "shown", act: acts[at]!.id, summary: null };
  const fate = new Map<number, Fate>();
  for (const u of nums(tidy.args.read)) fate.set(u, { kind: "read" });
  for (const f of listOf(tidy.args.folders)) {
    const g = (f ?? {}) as Record<string, unknown>;
    for (const u of nums(g.uids)) fate.set(u, { kind: "folder", folder: String(g.folder ?? "") });
  }
  for (const u of nums(tidy.args.archive)) fate.set(u, { kind: "archive" });
  const fated = rows.map((r) => ({ ...r, fate: fate.get(r.uid) ?? null }));
  if (tidy.result === null) return { ...base, rows: fated, state: "asking", act: tidy.id, summary: null };
  if (tidy.failed || !tidy.view?.tidied) return { ...base, rows: fated, state: "refused", act: tidy.id, summary: tidy.result };
  // done: what moved has left the inbox, what was marked read is read
  const after = fated.map((r) => ({ ...r, gone: r.fate?.kind === "archive" || r.fate?.kind === "folder", seen: r.seen || r.fate?.kind === "read" }));
  const left = after.filter((r) => !r.gone);
  const unreadElsewhere = Math.max(0, base.unread - rows.filter((r) => !r.seen).length);
  return { ...base, total: Math.max(0, base.total - (after.length - left.length)), unread: left.filter((r) => !r.seen).length + unreadElsewhere, rows: after, state: "done", act: tidy.id, summary: tidy.result.replace(/^Done in [^:]*: (.)/, (_m, c: string) => c.toUpperCase()) };
}
