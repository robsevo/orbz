// PLAN 4.2_t (owner 10-02: "the option for the user to add their teams or slack calendar, or simply
// gmail or outlook"), with stand-ins for Google's and Microsoft's sign-in, calendars and mail
// (fakes/oauth.ts, fakes/imap.ts):
//   - With no app registered with a provider, connecting says so, and nothing starts.
//   - Connect Google: the address Orbs opens asks for mail and the calendar, offline, with PKCE and
//     its own state; the browser coming back connects the account, its mail (by its token, drafts in
//     Gmail's own drafts folder) and its calendar (only the calendars shown in Google; cancelled
//     ones left out) on the home's calendar; the refresh token in the keychain and nowhere else; a
//     token that runs out is refreshed.
//   - A sign-in that comes back with another state, or refused, keeps nothing.
//   - Connect Microsoft: the Outlook calendar with Teams' meetings in it, from Graph, in UTC; the
//     mail by its own token; the refresh token Microsoft rolls is the one kept.
//   - Disconnected: the account, its mail, its calendar and its refresh token, all gone.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { serve } from "../src/api.ts";
import { MemoryStore } from "../src/chatgpt/store.ts";
import { FakeClock } from "../src/clock.ts";
import type { ProviderId } from "../src/connectors/accounts.ts";
import { fakeImap } from "./fakes/imap.ts";
import { fakeProvider } from "./fakes/oauth.ts";
import { agentHome } from "./helpers.ts";

const CLIENT = "orbs-test-client-not-real";

async function connected(t: TestContext, provider: ProviderId, email: string, o: { drafts?: string; rolls?: boolean } = {}) {
  const idp = await fakeProvider(t, { client: CLIENT, ...(provider === "google" && { secret: "not-a-real-secret" }), ...(o.rolls && { rolls: true }) });
  const imap = await fakeImap(t, { user: email, password: "", ...(o.drafts && { drafts: o.drafts }) });
  Object.defineProperty(imap, "token", { get: () => idp.tokens.mail }); // it takes whatever the provider handed out last
  const store = new MemoryStore();
  const clock = new FakeClock(new Date("2026-10-05T08:00:00Z").getTime());
  const { home, dataDir, model } = await agentHome(t, [], {
    clock, connectors: { store },
    accounts: {
      clients: { [provider]: { id: CLIENT, ...(provider === "google" && { secret: "not-a-real-secret" }) } },
      endpoints: { [provider]: { authorize: `${idp.url}/authorize`, token: `${idp.url}/token`, api: idp.url, imap: { host: "127.0.0.1", port: imap.port, tls: false } } },
    },
  });
  return { idp, imap, store, clock, home, dataDir, model };
}

/** The consent page's part: it hands back a code made for the challenge Orbs sent, to the address it gave. */
async function consent(url: string, idp: Awaited<ReturnType<typeof fakeProvider>>, email: string, q: Record<string, string> = {}): Promise<Response> {
  const asked = new URL(url);
  const code = `code-not-real-${Math.random().toString(36).slice(2)}`;
  idp.issue(code, asked.searchParams.get("code_challenge")!, email);
  const back = new URL(asked.searchParams.get("redirect_uri")!);
  back.search = new URLSearchParams({ code, state: asked.searchParams.get("state")!, ...q }).toString();
  return fetch(back);
}

test("with no app registered with a provider, connecting says so and nothing starts", async (t) => {
  const { home } = await agentHome(t, [], { connectors: { store: new MemoryStore() } });
  const was = { g: process.env.ORBS_GOOGLE_CLIENT_ID, m: process.env.ORBS_MICROSOFT_CLIENT_ID };
  delete process.env.ORBS_GOOGLE_CLIENT_ID;
  delete process.env.ORBS_MICROSOFT_CLIENT_ID;
  t.after(() => Object.assign(process.env, { ...(was.g && { ORBS_GOOGLE_CLIENT_ID: was.g }), ...(was.m && { ORBS_MICROSOFT_CLIENT_ID: was.m }) }));
  assert.deepEqual(home.accounts.providers().map((p) => [p.id, p.ready]), [["google", false], ["microsoft", false]]);
  await assert.rejects(home.connectAccount("google"), /no Google app registered/);
  assert.equal(home.events.ofType("account.connect_started").length, 0);
});

test("Connect Google: mail by its token, drafts in Gmail's own folder, the calendars shown in Google; the refresh token kept secret and used", { timeout: 60_000 }, async (t) => {
  const { idp, imap, store, clock, home, dataDir } = await connected(t, "google", "robin@gmail.test", { drafts: "[Gmail]/Drafts" });
  idp.google.set("primary", { selected: true, events: [
    { id: "g1", title: "Standup", start: "2026-10-05T09:00:00Z", end: "2026-10-05T09:30:00Z", location: "Office" },
    { id: "g2", title: "Dropped", start: "2026-10-05T11:00:00Z", end: "2026-10-05T12:00:00Z", cancelled: true },
  ] });
  idp.google.set("family@group.calendar.google.com", { selected: true, events: [{ id: "g3", title: "Half term", start: "2026-10-26", end: "2026-10-31", allDay: true }] });
  idp.google.set("holidays-hidden", { selected: false, events: [{ id: "g4", title: "Hidden holiday", start: "2026-10-05", end: "2026-10-06", allDay: true }] });
  const { url, done } = await home.connectAccount("google");
  const asked = new URL(url);
  assert.equal(`${asked.origin}${asked.pathname}`, `${idp.url}/authorize`);
  assert.deepEqual([asked.searchParams.get("client_id"), asked.searchParams.get("code_challenge_method"), asked.searchParams.get("access_type"), asked.searchParams.get("response_type")], [CLIENT, "S256", "offline", "code"]);
  assert.match(asked.searchParams.get("scope")!, /https:\/\/mail\.google\.com\/ .*calendar\.readonly/);
  assert.match(asked.searchParams.get("redirect_uri")!, /^http:\/\/127\.0\.0\.1:\d+\/callback$/, "back to this machine");
  const page = await consent(url, idp, "robin@gmail.test");
  assert.equal(page.status, 200);
  assert.equal(await done, "google");

  assert.deepEqual(home.accounts.list(), { google: { provider: "google", email: "robin@gmail.test" } });
  assert.equal(await store.get("account:google:refresh"), "refresh-not-real-1", "the refresh token in the keychain");
  for (const f of ["accounts.json", "mail.json", "calendars.json"]) assert.ok(!readFileSync(join(dataDir, f), "utf8").includes("not-real"), `never in ${f}`);
  assert.ok(!JSON.stringify(home.events.since(0, 100_000)).includes("not-real"), "nor the log");

  // the mail, by its token: what is owed, and a draft kept in Gmail's own drafts folder
  imap.deliver("From: Dana <dana@example.com>\r\nSubject: Lunch Thursday?\r\nDate: Sat, 03 Oct 2026 10:00:00 +0000\r\n\r\nAre you free?\r\n");
  assert.deepEqual((await home.mail.owed(clock.now())).owed.map((o) => o.subject), ["Lunch Thursday?"]);
  await home.mail.with("google", (c) => c.draft("From: robin@gmail.test\r\nTo: dana@example.com\r\nSubject: Re: Lunch Thursday?\r\n\r\nYes!"));
  assert.equal(imap.boxes.get("[Gmail]/Drafts")!.length, 1, "in Gmail's drafts, found by its special use");
  assert.equal(imap.boxes.get("Drafts"), undefined, "not a new folder called Drafts");

  // the calendar: the ones shown in Google, without what was cancelled
  const span = { start: new Date("2026-10-01T00:00").getTime(), end: new Date("2026-11-01T00:00").getTime() };
  const titles = (await home.calendars.events(span.start, span.end)).map((e) => `${e.title} (${e.calendar})`);
  assert.deepEqual(titles, ["Standup (Google (robin@gmail.test))", "Half term (Google (robin@gmail.test))"]);

  // an hour later its tokens have run out: refreshed from the keychain, and the mail still opens
  await clock.advance(3600_000);
  const before = idp.refreshes;
  await home.mail.with("google", async () => {});
  assert.equal(idp.refreshes, before + 1, "refreshed once");
});

test("a sign-in that comes back with another state, or refused, keeps nothing", { timeout: 60_000 }, async (t) => {
  const { idp, home, store } = await connected(t, "google", "robin@gmail.test");
  const one = await home.connectAccount("google");
  const forged = new URL(one.url);
  idp.issue("code-not-real-x", forged.searchParams.get("code_challenge")!, "robin@gmail.test");
  const back = new URL(forged.searchParams.get("redirect_uri")!);
  back.search = new URLSearchParams({ code: "code-not-real-x", state: "not-the-state" }).toString();
  assert.equal((await fetch(back)).status, 400);
  await assert.rejects(one.done, /a state this sign-in did not send/);
  const two = await home.connectAccount("google");
  const refused = new URL(new URL(two.url).searchParams.get("redirect_uri")!);
  refused.search = new URLSearchParams({ error: "access_denied", state: new URL(two.url).searchParams.get("state")! }).toString();
  assert.equal((await fetch(refused)).status, 400);
  await assert.rejects(two.done, /did not connect the account \(access_denied\)/);
  assert.deepEqual(home.accounts.list(), {});
  assert.deepEqual(home.mail.accounts(), {});
  assert.equal(await store.get("account:google:refresh"), null);
});

test("Connect Microsoft: the Outlook calendar with Teams' meetings, from Graph in UTC; the mail by its own token; the rolled refresh token kept; disconnected, all gone", { timeout: 60_000 }, async (t) => {
  const { idp, imap, store, clock, home } = await connected(t, "microsoft", "robin@outlook.test", { rolls: true });
  idp.graph.push(
    { id: "m1", title: "Team sync", start: "2026-10-05T13:00:00Z", end: "2026-10-05T13:30:00Z", location: "Microsoft Teams Meeting" },
    { id: "m2", title: "Off sick", start: "2026-10-06", end: "2026-10-07", allDay: true },
    { id: "m3", title: "Moved away", start: "2026-10-05T15:00:00Z", end: "2026-10-05T16:00:00Z", cancelled: true },
  );
  const { url, done } = await home.connectAccount("microsoft");
  const asked = new URL(url);
  assert.match(asked.searchParams.get("scope")!, /offline_access .*IMAP\.AccessAsUser\.All .*Calendars\.Read/);
  assert.match(asked.searchParams.get("redirect_uri")!, /^http:\/\/localhost:\d+\/callback$/, "Microsoft matches localhost on any port");
  assert.equal((await consent(url, idp, "robin@outlook.test")).status, 200);
  assert.equal(await done, "microsoft");
  assert.equal(imap.logins, 1, "the mail signed in with its token as it was kept");

  const span = { start: new Date("2026-10-01T00:00").getTime(), end: new Date("2026-11-01T00:00").getTime() };
  const got = await home.calendars.events(span.start, span.end);
  assert.deepEqual(got.map((e) => [e.title, e.allDay ? null : new Date(e.start).toISOString(), e.location]), [
    ["Team sync", "2026-10-05T13:00:00.000Z", "Microsoft Teams Meeting"],
    ["Off sick", null, null],
  ], "Teams' meeting at its UTC time; the day off on its day; the cancelled one left out");
  assert.equal(new Date(got[1]!.start).getDate(), 6, "a day-long event is the day it is on, here");
  assert.equal(await store.get("account:microsoft:refresh"), "refresh-not-real-2", "the calendar's token came with a new refresh token, and that is the one kept");

  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const call = async (method: string, path: string) => (await fetch(`http://127.0.0.1:${door.port}${path}`, { method, headers: { authorization: `Bearer ${door.token}` } })).json() as Promise<Record<string, unknown>>;
  const listed = await call("GET", "/accounts");
  assert.deepEqual((listed.providers as { id: string; ready: boolean }[]).find((p) => p.id === "microsoft")?.ready, true);
  assert.ok(!JSON.stringify(listed).includes("not-real"), "no token through the door");
  await call("POST", "/accounts/microsoft/remove");
  assert.deepEqual([home.accounts.list(), home.mail.accounts(), home.calendars.list()], [{}, {}, []], "its mail and its calendar went with it");
  assert.equal(await store.get("account:microsoft:refresh"), null);
  void clock;
});
