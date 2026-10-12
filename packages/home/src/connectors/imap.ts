// Mail, no middleman (PLAN 4.2): a small IMAP4rev1 client of our own, for what Orbs does with a
// mailbox and nothing more: read what is new (headers, and the start of its text) and keep a draft
// in Drafts (APPEND). It never sends: a reply owed is drafted, never sent (PLAN 4.5), and sending
// would be the floor's messaging in any case. Tidying (PLAN 4.10, only once you approve it): mark
// read (STORE +FLAGS \Seen), make a folder (CREATE) and move a message into one (RFC 6851's UID
// MOVE: one step, nothing left marked \Deleted). Nothing here deletes or expunges: a server without
// MOVE is told no, never moved by copy-and-delete.
//
// TLS by default (port 993); plain only to the loopback address (a test's server). Every exchange
// has a deadline. A message's words are someone else's: the orb reads them as from outside.
import { connect as tcp, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

/** An account by its password, or by an OAuth token (`token`: Gmail and Outlook take nothing else now). */
export type ImapAccount = { host: string; port?: number; user: string; password: string; token?: string; tls?: boolean; mailbox?: string };
/** `seen`: read (\Seen), as its flags say. */
export type Header = { uid: number; from: string; subject: string; date: number | null; messageId: string | null; automated: boolean; seen: boolean };
/** A folder by its name (decoded) and how the server spells it, with its special use (\Archive, \All, \Drafts…). */
export type Box = { name: string; wire: string; flags: string[] };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export class ImapError extends Error {}

export const IMAP_MS = 20_000;
const quote = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const sets = (uids: number[], n = 200): string[] => {
  const out: string[] = [];
  for (let i = 0; i < uids.length; i += n) out.push(uids.slice(i, i + n).join(","));
  return out;
};

/** A folder's name as IMAP spells it (RFC 3501 5.1.3, modified UTF-7): ASCII as itself, "&" as "&-", the rest
 * as UTF-16 in base64 with "," for "/" between "&" and "-". */
export function utf7(name: string): string {
  let out = "";
  let run = "";
  const flush = (): void => {
    if (!run) return;
    const b = Buffer.alloc(run.length * 2);
    for (let i = 0; i < run.length; i++) b.writeUInt16BE(run.charCodeAt(i), i * 2);
    out += `&${b.toString("base64").replace(/=+$/, "").replace(/\//g, ",")}-`;
    run = "";
  };
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 && c <= 0x7e) {
      flush();
      out += ch === "&" ? "&-" : ch;
    } else run += ch;
  }
  flush();
  return out;
}
/** A folder's name as IMAP spelled it, read. */
export function fromUtf7(wire: string): string {
  return wire.replace(/&([^-]*)-/g, (_m, b64: string) => {
    if (!b64) return "&";
    const b = Buffer.from(b64.replace(/,/g, "/"), "base64");
    let s = "";
    for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i));
    return s;
  });
}

/** RFC 2047 words (=?utf-8?B?…?= and =?utf-8?Q?…?=) as text. */
export function decodeWords(s: string): string {
  return s.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(\s+(?==\?))?/g, (_m, charset: string, enc: string, data: string) => {
    const bytes = enc.toUpperCase() === "B" ? Buffer.from(data, "base64") : Buffer.from(data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1");
    try {
      return new TextDecoder(charset.toLowerCase()).decode(bytes);
    } catch {
      return bytes.toString("utf8");
    }
  });
}

/** A header block's fields, unfolded, by lower-case name. */
export function headerFields(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = decodeWords(line.slice(i + 1).trim());
  }
  return out;
}

export class Imap {
  readonly #sock: Socket;
  #buf = Buffer.alloc(0);
  #tag = 0;
  #wake: (() => void) | null = null;
  #gone: string | null = null;
  readonly #ms: number;
  uidValidity = 0;
  uidNext = 0;

  private constructor(sock: Socket, ms: number) {
    this.#sock = sock;
    this.#ms = ms;
    sock.on("data", (b: Buffer) => {
      this.#buf = Buffer.concat([this.#buf, b]);
      this.#wake?.();
    });
    const end = (why: string) => {
      this.#gone ??= why;
      this.#wake?.();
    };
    sock.on("error", (e) => end(e.message));
    sock.on("close", () => end("the server closed the connection"));
  }

  /** Signs in and opens the mailbox (INBOX unless named). */
  static async open(a: ImapAccount, o: { timeoutMs?: number } = {}): Promise<Imap> {
    const tls = a.tls ?? true;
    if (!tls && a.host !== "127.0.0.1" && a.host !== "localhost") throw new ImapError("mail goes over TLS: plain IMAP only to this machine");
    const port = a.port ?? (tls ? 993 : 143);
    const sock = tls ? tlsConnect({ host: a.host, port, servername: a.host }) : tcp({ host: a.host, port });
    const c = new Imap(sock, o.timeoutMs ?? IMAP_MS);
    try {
      const hello = await c.#line();
      if (!/^\* (OK|PREAUTH)/i.test(hello)) throw new ImapError(`the server did not greet: ${hello.slice(0, 120)}`);
      if (a.token) await c.run(`AUTHENTICATE XOAUTH2 ${Buffer.from(`user=${a.user}\x01auth=Bearer ${a.token}\x01\x01`).toString("base64")}`);
      else await c.run(`LOGIN ${quote(a.user)} ${quote(a.password)}`);
      const sel = await c.run(`SELECT ${quote(a.mailbox ?? "INBOX")}`);
      c.uidValidity = Number(/UIDVALIDITY (\d+)/i.exec(sel)?.[1] ?? 0);
      c.uidNext = Number(/UIDNEXT (\d+)/i.exec(sel)?.[1] ?? 0);
      return c;
    } catch (e) {
      c.close();
      throw e instanceof ImapError ? e : new ImapError(e instanceof Error ? e.message : String(e));
    }
  }

  async #more(): Promise<void> {
    if (this.#gone) throw new ImapError(this.#gone);
    await new Promise<void>((ok, no) => {
      const t = setTimeout(() => no(new ImapError(`the mail server gave no answer in ${Math.round(this.#ms / 1000)} s`)), this.#ms);
      this.#wake = () => {
        clearTimeout(t);
        this.#wake = null;
        ok();
      };
    });
  }

  /** One line (without its CRLF), or, when it ends in a literal {n}, the line with the literal inlined. */
  async #line(): Promise<string> {
    let out = "";
    for (;;) {
      let i = this.#buf.indexOf("\r\n");
      while (i < 0) {
        await this.#more();
        i = this.#buf.indexOf("\r\n");
      }
      const line = this.#buf.subarray(0, i).toString("utf8");
      this.#buf = this.#buf.subarray(i + 2);
      out += line;
      const lit = /\{(\d+)\}$/.exec(line);
      if (!lit) return out;
      const n = Number(lit[1]);
      while (this.#buf.length < n) await this.#more();
      out += `\n${this.#buf.subarray(0, n).toString("utf8")}\n`;
      this.#buf = this.#buf.subarray(n);
    }
  }

  /** Runs a command; its untagged lines (joined), or why the server said no. */
  async run(command: string, literal?: string): Promise<string> {
    const tag = `o${++this.#tag}`;
    if (literal !== undefined) {
      this.#sock.write(`${tag} ${command} {${Buffer.byteLength(literal)}}\r\n`);
      const go = await this.#line();
      if (!go.startsWith("+")) throw new ImapError(`the server would not take it: ${go.slice(0, 120)}`);
      this.#sock.write(`${literal}\r\n`);
    } else this.#sock.write(`${tag} ${command}\r\n`);
    const lines: string[] = [];
    for (;;) {
      const l = await this.#line();
      // a challenge mid-command is a refused AUTHENTICATE telling us why: answer it empty, and the NO follows
      if (l.startsWith("+")) {
        this.#sock.write("\r\n");
        continue;
      }
      if (l.startsWith(`${tag} `)) {
        if (!/^\S+ OK/i.test(l)) throw new ImapError(`${command.split(" ")[0]}: ${l.slice(tag.length + 1, 200)}`);
        return lines.join("\n");
      }
      lines.push(l);
    }
  }

  /** The messages after `uid`, oldest first. */
  async since(uid: number): Promise<number[]> {
    const r = await this.run(`UID SEARCH UID ${uid + 1}:*`);
    const found = /\* SEARCH ?([\d ]*)/i.exec(r)?.[1] ?? "";
    return found.split(" ").map(Number).filter((n) => n > uid).sort((a, b) => a - b); // "n:*" always holds the last, even below n
  }

  /** Who, what and when, for these messages. */
  async headers(uids: number[]): Promise<Header[]> {
    if (!uids.length) return [];
    // a newsletter, a notification or an auto-reply says so in its headers: never a reply anyone owes
    const r = await this.run(`UID FETCH ${uids.join(",")} (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID LIST-UNSUBSCRIBE AUTO-SUBMITTED PRECEDENCE)])`);
    const out: Header[] = [];
    for (const part of r.split(/^\* \d+ FETCH /m).slice(1)) {
      const uid = Number(/UID (\d+)/i.exec(part)?.[1]);
      const h = headerFields(part.slice(part.indexOf("\n") + 1));
      const date = h.date ? Date.parse(h.date) : NaN;
      const automated = Boolean(h["list-unsubscribe"]) || /^auto-/i.test(h["auto-submitted"] ?? "") || /^(bulk|list|junk)$/i.test(h.precedence ?? "");
      // its flags come before the header's literal or after it, as the server likes: never read inside it
      const lines = part.split("\n");
      const seen = [lines[0]!, lines.at(-1)!].some((l) => /\\Seen\b/i.test(/FLAGS \(([^)]*)\)/i.exec(l)?.[1] ?? ""));
      out.push({ uid, from: h.from ?? "", subject: h.subject ?? "", date: Number.isNaN(date) ? null : date, messageId: h["message-id"] ?? null, automated, seen });
    }
    return out.sort((a, b) => a.uid - b.uid);
  }

  /** What has come since `day` (a day, the server's way) that you have not answered (no \Answered flag). */
  async unanswered(since: number): Promise<number[]> {
    const d = new Date(since);
    const r = await this.run(`UID SEARCH UNANSWERED SINCE ${d.getDate()}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`);
    const found = /\* SEARCH ?([\d ]*)/i.exec(r)?.[1] ?? "";
    return found.split(" ").filter(Boolean).map(Number).sort((a, b) => a - b);
  }

  /** The start of a message's text, as it came (at most `max` bytes). */
  async text(uid: number, max = 8192): Promise<string> {
    const r = await this.run(`UID FETCH ${uid} (BODY.PEEK[TEXT]<0.${max}>)`);
    const i = r.indexOf("\n");
    return i < 0 ? "" : r.slice(i + 1).replace(/\n\)?$/, "");
  }

  /** Every message in the mailbox, oldest first. */
  async all(): Promise<number[]> {
    const r = await this.run("UID SEARCH ALL");
    const found = /\* SEARCH ?([\d ]*)/i.exec(r)?.[1] ?? "";
    return found.split(" ").filter(Boolean).map(Number).sort((a, b) => a - b);
  }

  /** What the server can do (CAPABILITY), in capitals. */
  async capabilities(): Promise<Set<string>> {
    const r = await this.run("CAPABILITY");
    return new Set((/\* CAPABILITY (.*)$/im.exec(r)?.[1] ?? "").toUpperCase().split(/\s+/).filter(Boolean));
  }

  /** The account's folders, each with its special use (RFC 6154). */
  async boxes(): Promise<Box[]> {
    const out: Box[] = [];
    for (const l of (await this.run(`LIST "" "*"`)).split("\n")) {
      const m = /^\* LIST \(([^)]*)\) (?:"(?:[^"\\]|\\.)*"|NIL) (.+)$/i.exec(l);
      if (!m) continue;
      const wire = m[2]!.trim().replace(/^"|"$/g, "").replace(/\\(.)/g, "$1");
      out.push({ name: fromUtf7(wire), wire, flags: m[1]!.split(/\s+/).filter(Boolean) });
    }
    return out;
  }

  /** The account's drafts folder, by its special use (RFC 6154: Gmail's is "[Gmail]/Drafts", named in
   * the account's language), else the one called Drafts. */
  async draftsBox(): Promise<string> {
    try {
      return (await this.boxes()).find((b) => b.flags.some((f) => /^\\Drafts$/i.test(f)))?.wire ?? "Drafts";
    } catch {
      return "Drafts";
    }
  }

  /** Marks messages read. */
  async markSeen(uids: number[]): Promise<void> {
    for (const set of sets(uids)) await this.run(`UID STORE ${set} +FLAGS.SILENT (\\Seen)`);
  }

  /** Makes a folder (by its name, spelled for the server here). */
  async create(name: string): Promise<void> {
    await this.run(`CREATE ${quote(utf7(name))}`);
  }

  /** Moves messages into a folder (its `wire` name) in one step (RFC 6851); a server without MOVE is refused. */
  async move(uids: number[], wire: string, caps?: Set<string>): Promise<void> {
    if (!(caps ?? (await this.capabilities())).has("MOVE")) throw new ImapError("this mail server cannot move mail (it has no MOVE), so nothing was moved");
    for (const set of sets(uids)) await this.run(`UID MOVE ${set} ${quote(wire)}`);
  }

  /** Keeps a draft in the drafts folder, marked a draft. Never sends. */
  async draft(raw: string, folder?: string): Promise<void> {
    folder ??= await this.draftsBox();
    await this.run(`APPEND ${quote(folder)} (\\Draft \\Seen)`, raw.replace(/\r?\n/g, "\r\n"));
  }

  close(): void {
    try {
      this.#sock.write(`o${++this.#tag} LOGOUT\r\n`);
    } catch {
      // gone already
    }
    this.#sock.destroy();
  }
}

/** A draft reply as a mail (RFC 5322), never sent: kept in Drafts for the person to look at. */
export function draftOf(o: { from: string; to: string; subject: string; body: string; inReplyTo?: string | null; date?: Date }): string {
  const enc = (s: string): string => (/^[\x20-\x7e]*$/.test(s) ? s : `=?utf-8?B?${Buffer.from(s).toString("base64")}?=`);
  return [
    `From: ${o.from}`, `To: ${o.to}`, `Subject: ${enc(o.subject)}`, `Date: ${(o.date ?? new Date()).toUTCString()}`,
    ...(o.inReplyTo ? [`In-Reply-To: ${o.inReplyTo}`, `References: ${o.inReplyTo}`] : []),
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", o.body,
  ].join("\r\n");
}
