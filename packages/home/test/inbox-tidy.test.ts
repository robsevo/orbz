// PLAN 4.10_t (tidying an inbox, one press), with a stand-in IMAP server (fakes/imap.ts):
//   - The client marks read, makes a folder (its name in IMAP's UTF-7: "Reçus"), moves in one step (MOVE), finds the
//     archive by its special use; a server without MOVE is refused before anything changes; nothing is ever deleted
//     or expunged.
//   - An orb looks through the inbox and proposes a tidy: one card saying what goes where, by who it is from, and
//     nothing moves before your yes, even with every rule allowing (the turn read your mail: the one-way switch);
//     approved, exactly that moves: the newsletters archived (Gmail's All Mail), the receipts into Receipts (made),
//     the notifications marked read, the people left in your inbox.
//   - A tidy only of what it was shown: a message never listed, or one sent two ways, is sent back before you see it.
//   - A mailbox renumbered between the look and your yes moves nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryStore } from "../src/chatgpt/store.ts";
import { fromUtf7, Imap, utf7 } from "../src/connectors/imap.ts";
import { fakeImap, type FakeImap } from "./fakes/imap.ts";
import { agentHome } from "./helpers.ts";

const USER = { user: "robin@work.example", password: "pw-not-real-4321" };
const mail = (from: string, subject: string, list = false, day = 11) =>
  `From: ${from}\r\nSubject: ${subject}\r\nDate: ${day} Oct 2026 09:00:00 +0000\r\nMessage-ID: <${subject.replace(/\W+/g, "-")}@x.example>\r\n${list ? "List-Unsubscribe: <mailto:u@x.example>\r\n" : ""}\r\nbody\r\n`;
/** A work inbox: two people, two newsletters, two receipts, two notifications (uids 1-8). */
function stock(imap: FakeImap): void {
  imap.deliver(mail("Dana Whitfield <dana@acme.example>", "Q3 numbers for Thursday?"));
  imap.deliver(mail("LinkedIn <news@linkedin.example>", "12 new jobs for you", true));
  imap.deliver(mail("Uber Receipts <receipts@uber.example>", "Your Thursday trip"));
  imap.deliver(mail("Jira <jira@acme.example>", "[OPS-41] assigned to you", true));
  imap.deliver(mail("Marcus Lee <marcus@acme.example>", "Lunch Friday?"));
  imap.deliver(mail("Substack <hi@substack.example>", "This week in ops", true));
  imap.deliver(mail("Amazon <orders@amazon.example>", "Your order has shipped"));
  imap.deliver(mail("GitHub <noreply@github.example>", "CI passed on main", true));
}
const subjects = (imap: FakeImap, box: string): string[] => (imap.boxes.get(box) ?? []).map((m) => /^Subject: (.*)$/m.exec(m.raw)?.[1] ?? "?");

test("the client: marks read, makes a folder by its UTF-7 name, moves in one step, finds the archive; no MOVE, no moving; never a delete", async (t) => {
  assert.equal(utf7("Reçus & factures"), "Re&AOc-us &- factures");
  assert.equal(fromUtf7("Re&AOc-us &- factures"), "Reçus & factures");
  assert.equal(fromUtf7(utf7("日本語 / Ünïcode ✓")), "日本語 / Ünïcode ✓");
  const imap = await fakeImap(t, { ...USER, archive: { name: "[Gmail]/All Mail", use: "\\All" } });
  stock(imap);
  const c = await Imap.open({ host: "127.0.0.1", port: imap.port, tls: false, ...USER });
  t.after(() => c.close());
  assert.deepEqual(await c.all(), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok((await c.capabilities()).has("MOVE"));
  assert.deepEqual((await c.boxes()).find((b) => b.name === "[Gmail]/All Mail")?.flags, ["\\HasNoChildren", "\\All"]);
  await c.markSeen([4, 8]);
  assert.deepEqual((await c.headers([4, 5, 8])).map((h) => h.seen), [true, false, true], "read as its flags say");
  await c.create("Reçus");
  const box = (await c.boxes()).find((b) => b.name === "Reçus");
  assert.equal(box?.wire, "Re&AOc-us", "kept by the server in IMAP's own spelling");
  await c.move([3, 7], box!.wire);
  assert.deepEqual(subjects(imap, "Re&AOc-us"), ["Your Thursday trip", "Your order has shipped"]);
  assert.deepEqual(await c.all(), [1, 2, 4, 5, 6, 8], "gone from the inbox in the same step");
  assert.ok(!imap.said.some((l) => /EXPUNGE|\\Deleted/i.test(l)), `nothing deleted: ${imap.said.join(" | ")}`);

  const old = await fakeImap(t, { ...USER, move: false });
  stock(old);
  const d = await Imap.open({ host: "127.0.0.1", port: old.port, tls: false, ...USER });
  t.after(() => d.close());
  await assert.rejects(d.move([2], "Drafts"), /cannot move mail \(it has no MOVE\)/);
  assert.equal(old.boxes.get("INBOX")!.length, 8, "nothing moved, and no copy-and-delete instead");
  assert.ok(!old.said.some((l) => /^(UID )?(COPY|STORE|EXPUNGE)/i.test(l)));
});

const tidyArgs = { account: "work", archive: [2, 6], folders: [{ folder: "Receipts", uids: [3, 7] }], read: [4, 8] };

test("a tidy is one card that says what goes where, and nothing moves before your yes, even with every rule allowing; then exactly that", { timeout: 90_000 }, async (t) => {
  const imap = await fakeImap(t, { ...USER, archive: { name: "[Gmail]/All Mail", use: "\\All" } });
  stock(imap);
  const { home } = await agentHome(t, [
    { calls: [{ name: "list_mail", args: { account: "work", count: 20 } }] },
    { calls: [{ name: "tidy_mail", args: tidyArgs }] },
    { chunks: ["Your inbox is down to the two people waiting on you."] },
  ], { kit: true, connectors: { store: new MemoryStore() }, agent: { decide: () => "allow" } }); // your rules allow every call
  await home.mail.add("work", { host: "127.0.0.1", port: imap.port, tls: false, user: USER.user }, USER.password);
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "clean up my work email");
  await home.inbox.idle();
  const card = home.conversations.openCard("chat:juniper");
  assert.equal(card?.tool, "tidy_mail", "it waits for you");
  assert.match(card!.title, /Juniper wants to tidy 6 emails in work: archive 2, file 2 in Receipts, mark 2 read/);
  assert.deepEqual(card!.detail.split("\n"), [
    "Archive 2: LinkedIn, Substack",
    "Into Receipts 2: Amazon, Uber Receipts",
    "Mark read 2: GitHub, Jira",
    "Left in your inbox: 4, from Dana Whitfield, Marcus Lee, GitHub, and 1 more", // who waits on you first
    "Nothing is deleted: archived mail stays in your archive.",
  ]);
  assert.ok((card!.meta.why as string[]).some((w) => /read something from outside/.test(w)), "the turn read your mail: a fresh yes");
  assert.equal(card!.meta.mayAlways, false, "and never 'always'");
  assert.equal(imap.boxes.get("INBOX")!.length, 8, "nothing moved yet");
  assert.ok(!imap.said.some((l) => /^UID (STORE|MOVE)|^CREATE/i.test(l)), "nothing changed yet");
  // what his screen shows: the inbox as he was shown it
  const listed = home.conversations.list("chat:juniper").find((m) => m.role === "tool" && m.meta.tool === "list_mail")!;
  const rows = (listed.meta.view as { inbox: { rows: { uid: number; from: string; subject: string; seen: boolean; list: boolean }[] } }).inbox.rows;
  assert.deepEqual(rows.map((r) => r.uid), [8, 7, 6, 5, 4, 3, 2, 1], "newest first");
  assert.deepEqual([rows[0]!.from, rows[0]!.subject, rows[0]!.list, rows[3]!.from, rows[3]!.list], ["GitHub", "CI passed on main", true, "Marcus Lee", false]);

  home.answerCard(card!.id, "approve");
  for (let i = 0; i < 100 && !home.conversations.list("chat:juniper").some((m) => m.role === "tool" && m.meta.tool === "tidy_mail"); i++) {
    await home.inbox.idle();
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.deepEqual(subjects(imap, "INBOX"), ["Q3 numbers for Thursday?", "[OPS-41] assigned to you", "Lunch Friday?", "CI passed on main"], "the people stay, and what was marked read");
  assert.deepEqual(subjects(imap, "[Gmail]/All Mail"), ["12 new jobs for you", "This week in ops"], "archived where Gmail keeps it");
  assert.deepEqual(subjects(imap, "Receipts"), ["Your Thursday trip", "Your order has shipped"], "filed, the folder made");
  assert.deepEqual(imap.boxes.get("INBOX")!.filter((m) => m.flags.includes("\\Seen")).map((m) => m.uid), [4, 8]);
  assert.ok(!imap.said.some((l) => /EXPUNGE|\\Deleted/i.test(l)), "nothing deleted");
  const done = home.conversations.list("chat:juniper").find((m) => m.role === "tool" && m.meta.tool === "tidy_mail")!;
  assert.equal(done.content, "Done in work: archived 2 (in [Gmail]/All Mail), filed 2 in Receipts, marked 2 read. Nothing was deleted.");
  assert.deepEqual(home.events.ofType("mail.tidied").map((e) => e.data), [{ account: "work", archived: 2, read: 2, filed: { Receipts: 2 } }]);
});

test("a tidy only of what it was shown: a message never listed, or one sent two ways, goes back to him before you see it", { timeout: 90_000 }, async (t) => {
  const imap = await fakeImap(t, USER);
  stock(imap);
  const { home } = await agentHome(t, [
    { calls: [{ name: "tidy_mail", args: { account: "work", archive: [2] } }] }, // before any look
    { calls: [{ name: "list_mail", args: { account: "work", count: 3 } }] }, // shows 6, 7, 8
    { calls: [{ name: "tidy_mail", args: { account: "work", archive: [2, 6] } }] }, // 2 was not shown
    { calls: [{ name: "tidy_mail", args: { account: "work", archive: [6], folders: [{ folder: "Receipts", uids: [6, 7] }] } }] },
    { chunks: ["I'll look again."] },
  ], { connectors: { store: new MemoryStore() } });
  await home.mail.add("work", { host: "127.0.0.1", port: imap.port, tls: false, user: USER.user }, USER.password);
  home.inbox.enqueue("juniper", "chat:juniper", "chat", "tidy my inbox");
  await home.inbox.idle();
  assert.equal(home.conversations.openCard("chat:juniper"), undefined, "no card: you were never asked");
  const back = home.conversations.list("chat:juniper").filter((m) => m.role === "tool" && m.meta.tool === "tidy_mail").map((m) => m.content);
  assert.equal(back.length, 3);
  assert.match(back[0]!, /^Not shown to the person: look through work's inbox first \(list_mail\)/);
  assert.match(back[1]!, /^Not shown to the person: message 2 was never shown/);
  assert.match(back[2]!, /^Not shown to the person: message 6 would go two places at once/);
  assert.equal(imap.boxes.get("INBOX")!.length, 8, "nothing moved");
  assert.ok(!imap.said.some((l) => /^UID (STORE|MOVE)|^CREATE/i.test(l)));
});

test("a mailbox renumbered between the look and your yes moves nothing; a server without MOVE changes nothing", { timeout: 90_000 }, async (t) => {
  for (const how of ["renumbered", "no MOVE"] as const) {
    const imap = await fakeImap(t, { ...USER, ...(how === "no MOVE" && { move: false }) });
    stock(imap);
    const { home } = await agentHome(t, [
      { calls: [{ name: "list_mail", args: { account: "work" } }] },
      { calls: [{ name: "tidy_mail", args: tidyArgs }] },
      { chunks: ["It could not be tidied."] },
    ], { connectors: { store: new MemoryStore() } });
    await home.mail.add("work", { host: "127.0.0.1", port: imap.port, tls: false, user: USER.user }, USER.password);
    home.inbox.enqueue("juniper", "chat:juniper", "chat", "tidy my inbox");
    await home.inbox.idle();
    const card = home.conversations.openCard("chat:juniper")!;
    if (how === "renumbered") imap.uidValidity = 8;
    home.answerCard(card.id, "approve");
    for (let i = 0; i < 100 && !home.conversations.list("chat:juniper").some((m) => m.role === "tool" && m.meta.tool === "tidy_mail"); i++) {
      await home.inbox.idle();
      await new Promise((r) => setTimeout(r, 30));
    }
    const done = home.conversations.list("chat:juniper").find((m) => m.role === "tool" && m.meta.tool === "tidy_mail")!;
    assert.match(done.content, how === "renumbered" ? /renumbered since it was shown: look through it again, nothing was moved/ : /cannot move mail \(it has no MOVE\), so nothing was moved/, how);
    assert.equal(done.meta.error, true);
    assert.equal(imap.boxes.get("INBOX")!.length, 8, `${how}: nothing moved`);
    assert.ok(!imap.boxes.get("INBOX")!.some((m) => m.flags.includes("\\Seen")), `${how}: nothing marked read either`);
    assert.ok(!imap.said.some((l) => /^UID (STORE|MOVE)|^CREATE/i.test(l)), `${how}: ${imap.said.join(" | ")}`);
  }
});
