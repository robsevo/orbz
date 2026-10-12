// A stand-in IMAP server for the mail tests (PLAN 4.2), plain on the loopback address: just what
// Orbs' client asks (LOGIN, SELECT, UID SEARCH, UID FETCH of headers, flags and text, APPEND, LOGOUT;
// for a tidy, PLAN 4.10: CAPABILITY, LIST with special uses, CREATE, UID STORE, UID MOVE), over
// mailboxes kept in memory. It never expunges: a test that sees EXPUNGE or \\Deleted fails on it. It cannot send anything: there is no SMTP here at all, so a test
// can say "nothing was sent" and mean it.
import { createServer, type Socket } from "node:net";
import type { TestContext } from "node:test";

export type Kept = { uid: number; raw: string; flags: string[] };
export type FakeImap = {
  port: number;
  boxes: Map<string, Kept[]>;
  uidValidity: number;
  /** Puts a message in a mailbox (INBOX unless named), as a server receives it, with its flags (\\Answered, say). */
  deliver(raw: string, box?: string, flags?: string[]): number;
  logins: number;
  /** The OAuth token it takes now (a test moves it on when the provider hands out a new one). */
  token?: string;
  /** Every command it was sent, by its name and what followed (a tidy's are read back by the tests). */
  said: string[];
};

/** `token`: the OAuth token it takes by XOAUTH2 (Gmail's and Outlook's way); `drafts`: its drafts
 * folder's name, found by its special use (Gmail's is "[Gmail]/Drafts"). */
/** `archive`: a folder with that special use, as Gmail's "[Gmail]/All Mail" is \\All (none: there is no archive yet);
 * `move`: whether it can MOVE (RFC 6851; true unless said). */
export async function fakeImap(t: TestContext, o: { user: string; password: string; token?: string; drafts?: string; archive?: { name: string; use: "\\Archive" | "\\All" }; move?: boolean }): Promise<FakeImap> {
  const draftsBox = o.drafts ?? "Drafts";
  const boxes = new Map<string, Kept[]>([["INBOX", []], [draftsBox, []], ...(o.archive ? [[o.archive.name, []] as [string, Kept[]]] : [])]);
  const next = new Map<string, number>([["INBOX", 1], [draftsBox, 1]]);
  const use = (name: string): string => (name === draftsBox ? " \\Drafts" : name === o.archive?.name ? ` ${o.archive.use}` : "");
  const fake: FakeImap = {
    port: 0, boxes, uidValidity: 7, logins: 0, said: [], ...(o.token && { token: o.token }),
    deliver(raw, box = "INBOX", flags = []) {
      const uid = next.get(box) ?? 1;
      next.set(box, uid + 1);
      boxes.get(box)!.push({ uid, raw: raw.replace(/\r?\n/g, "\r\n"), flags: [...flags] });
      return uid;
    },
  };
  const unq = (s: string): string => s.replace(/^"|"$/g, "").replace(/\\(.)/g, "$1");
  const open = new Set<Socket>();
  const server = createServer((sock: Socket) => {
    open.add(sock);
    sock.on("close", () => open.delete(sock));
    let buf = Buffer.alloc(0);
    let user = false;
    let box = "INBOX";
    let pendingAppend: { tag: string; folder: string; flags: string[]; n: number } | null = null;
    let pendingChallenge: string | null = null; // a refused token: the client's empty answer, then NO
    const say = (s: string) => sock.write(`${s}\r\n`);
    say("* OK stand-in IMAP ready");
    sock.on("error", () => {});
    sock.on("data", (b: Buffer) => {
      buf = Buffer.concat([buf, b]);
      for (;;) {
        if (pendingAppend) {
          if (buf.length < pendingAppend.n + 2) return;
          const raw = buf.subarray(0, pendingAppend.n).toString("utf8");
          buf = buf.subarray(pendingAppend.n + 2);
          const { tag, folder, flags } = pendingAppend;
          pendingAppend = null;
          if (!boxes.has(folder)) boxes.set(folder, []);
          const uid = next.get(folder) ?? 1;
          next.set(folder, uid + 1);
          boxes.get(folder)!.push({ uid, raw, flags });
          say(`${tag} OK APPEND done`);
          continue;
        }
        const i = buf.indexOf("\r\n");
        if (i < 0) return;
        const line = buf.subarray(0, i).toString("utf8");
        buf = buf.subarray(i + 2);
        if (pendingChallenge) {
          say(`${pendingChallenge} NO [AUTHENTICATIONFAILED] the token was not accepted`);
          pendingChallenge = null;
          continue;
        }
        const [tag, cmd = "", ...rest] = line.split(" ");
        const args = rest.join(" ");
        const C = cmd.toUpperCase();
        if (!/^(LOGIN|AUTHENTICATE)$/i.test(C)) fake.said.push(`${C} ${args}`.trim());
        if (C === "LOGIN") {
          const m = /^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/.exec(args);
          if (m && unq(m[1]!) === o.user && unq(m[2]!) === o.password) {
            user = true;
            fake.logins++;
            say(`${tag} OK signed in`);
          } else say(`${tag} NO [AUTHENTICATIONFAILED] wrong user or password`);
        } else if (C === "AUTHENTICATE" && /^XOAUTH2 /i.test(args)) {
          const sent = Buffer.from(args.split(" ")[1] ?? "", "base64").toString("utf8");
          if (fake.token && sent === `user=${o.user}\x01auth=Bearer ${fake.token}\x01\x01`) {
            user = true;
            fake.logins++;
            say(`${tag} OK signed in by token`);
          } else {
            pendingChallenge = tag!;
            say(`+ ${Buffer.from(JSON.stringify({ status: "400", schemes: "Bearer" })).toString("base64")}`);
          }
        } else if (!user && C !== "LOGOUT") say(`${tag} NO sign in first`);
        else if (C === "LIST") {
          for (const name of boxes.keys()) say(`* LIST (\\HasNoChildren${use(name)}) "/" "${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
          say(`${tag} OK list done`);
        } else if (C === "CAPABILITY") {
          say(`* CAPABILITY IMAP4rev1 UIDPLUS SPECIAL-USE${o.move === false ? "" : " MOVE"}`);
          say(`${tag} OK capability done`);
        } else if (C === "CREATE") {
          const name = unq(args);
          if (boxes.has(name)) say(`${tag} NO [ALREADYEXISTS] it is there`);
          else {
            boxes.set(name, []);
            say(`${tag} OK created`);
          }
        } else if (C === "UID" && /^SEARCH (ALL|UNSEEN)$/i.test(args)) {
          const unseen = /UNSEEN/i.test(args);
          const hits = (boxes.get(box) ?? []).filter((m) => !unseen || !m.flags.includes("\\Seen")).map((m) => m.uid);
          say(`* SEARCH${hits.length ? ` ${hits.join(" ")}` : ""}`);
          say(`${tag} OK search done`);
        } else if (C === "UID" && /^STORE /i.test(args)) {
          const [, set = "", how = "", flags = ""] = /^STORE (\S+) ([+-]?FLAGS(?:\.SILENT)?) \(([^)]*)\)$/i.exec(args) ?? [];
          const want = new Set(set.split(",").map(Number));
          for (const m of boxes.get(box) ?? []) {
            if (!want.has(m.uid)) continue;
            for (const f of flags.split(" ").filter(Boolean)) {
              if (how.startsWith("-")) m.flags = m.flags.filter((x) => x !== f);
              else if (!m.flags.includes(f)) m.flags.push(f);
            }
          }
          say(`${tag} OK store done`);
        } else if (C === "UID" && /^MOVE /i.test(args)) {
          if (o.move === false) say(`${tag} BAD what is MOVE`);
          else {
            const [, set = "", to = ""] = /^MOVE (\S+) (.+)$/i.exec(args) ?? [];
            const dest = unq(to);
            if (!boxes.has(dest)) say(`${tag} NO [TRYCREATE] no such folder`);
            else {
              const want = new Set(set.split(",").map(Number));
              const here = boxes.get(box) ?? [];
              for (const m of here.filter((x) => want.has(x.uid))) {
                const uid = next.get(dest) ?? 1;
                next.set(dest, uid + 1);
                boxes.get(dest)!.push({ uid, raw: m.raw, flags: [...m.flags] });
              }
              boxes.set(box, here.filter((x) => !want.has(x.uid)));
              say(`${tag} OK move done`);
            }
          }
        }
        else if (C === "SELECT") {
          box = unq(args);
          const msgs = boxes.get(box) ?? [];
          say(`* ${msgs.length} EXISTS`);
          say(`* OK [UIDVALIDITY ${fake.uidValidity}] UIDs valid`);
          say(`* OK [UIDNEXT ${next.get(box) ?? 1}] next`);
          say(`${tag} OK [READ-WRITE] selected`);
        } else if (C === "UID" && /^SEARCH UID (\d+):\*$/i.test(args)) {
          const from = Number(/(\d+):\*/.exec(args)![1]);
          const msgs = boxes.get(box) ?? [];
          const hits = msgs.filter((m) => m.uid >= from).map((m) => m.uid);
          if (!hits.length && msgs.length) hits.push(msgs.at(-1)!.uid); // as servers do: "n:*" holds the last
          say(`* SEARCH${hits.length ? ` ${hits.join(" ")}` : ""}`);
          say(`${tag} OK search done`);
        } else if (C === "UID" && /^SEARCH (UNANSWERED )?SINCE (\d{1,2})-([A-Z][a-z]{2})-(\d{4})$/i.test(args)) {
          const [, unanswered, d, mon, y] = /^SEARCH (UNANSWERED )?SINCE (\d{1,2})-([A-Z][a-z]{2})-(\d{4})$/i.exec(args)!;
          const since = new Date(`${mon} ${d} ${y}`).getTime();
          const dateOf = (raw: string) => Date.parse(/^Date: (.+)$/im.exec(raw)?.[1] ?? "");
          const hits = (boxes.get(box) ?? []).filter((m) => (!unanswered || !m.flags.includes("\\Answered")) && dateOf(m.raw) >= since).map((m) => m.uid);
          say(`* SEARCH${hits.length ? ` ${hits.join(" ")}` : ""}`);
          say(`${tag} OK search done`);
        } else if (C === "UID" && /^FETCH /i.test(args)) {
          const [, set = "", what = ""] = /^FETCH (\S+) \((.*)\)$/i.exec(args) ?? [];
          const want = new Set(set.split(",").map(Number));
          const msgs = (boxes.get(box) ?? []).filter((m) => want.has(m.uid));
          msgs.forEach((m, k) => {
            const [head, ...body] = m.raw.split("\r\n\r\n");
            if (/HEADER\.FIELDS/i.test(what)) {
              const fields = head!.split("\r\n").filter((l) => /^(from|subject|date|message-id|list-unsubscribe|auto-submitted|precedence):/i.test(l)).join("\r\n") + "\r\n\r\n";
              const flagged = /\bFLAGS\b/i.test(what) ? `FLAGS (${m.flags.join(" ")}) ` : "";
              sock.write(`* ${k + 1} FETCH (UID ${m.uid} ${flagged}BODY[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)] {${Buffer.byteLength(fields)}}\r\n${fields})\r\n`);
            } else {
              const max = Number(/<0\.(\d+)>/.exec(what)?.[1] ?? 1e9);
              const text = Buffer.from(body.join("\r\n\r\n")).subarray(0, max).toString("utf8");
              sock.write(`* ${k + 1} FETCH (UID ${m.uid} BODY[TEXT]<0> {${Buffer.byteLength(text)}}\r\n${text})\r\n`);
            }
          });
          say(`${tag} OK fetch done`);
        } else if (C === "APPEND") {
          const m = /^("(?:[^"\\]|\\.)*"|\S+) \(([^)]*)\) \{(\d+)\}$/.exec(args);
          if (!m) say(`${tag} BAD append`);
          else {
            pendingAppend = { tag: tag!, folder: unq(m[1]!), flags: m[2]!.split(" ").filter(Boolean), n: Number(m[3]) };
            say("+ go ahead");
          }
        } else if (C === "LOGOUT") {
          say("* BYE");
          say(`${tag} OK bye`);
          sock.end();
        } else say(`${tag} BAD what is ${C}`);
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  fake.port = (server.address() as { port: number }).port;
  t.after(() => new Promise<void>((r) => {
    for (const s of open) s.destroy();
    server.close(() => r());
  }));
  return fake;
}
