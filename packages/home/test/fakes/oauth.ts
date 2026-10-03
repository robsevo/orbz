// A stand-in for Google's and Microsoft's sign-in and calendars (PLAN 4.2), on the loopback address:
// the token endpoint (a code is good once, and only with the verifier its challenge was made from:
// PKCE), refresh (Microsoft hands out a new refresh token each time, as it does), Google Calendar's
// calendar list and events, and Microsoft Graph's calendar view. The browser's part, the provider's
// consent page, is the test's: it reads the address Orbs would open and calls the loopback callback.
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { TestContext } from "node:test";

export type FakeEvent = { id: string; title: string; start: string; end: string; allDay?: boolean; location?: string; cancelled?: boolean };
export type FakeProvider = {
  url: string;
  /** What the consent page would hand back: a code good for this challenge, for this account. */
  issue(code: string, challenge: string, email: string): void;
  /** The access tokens it gave, for mail and calendar (the latest of each). */
  tokens: { mail: string; calendar: string };
  refreshes: number;
  /** The calendars Google shows (by id: shown in Google or not, and their events), and Graph's view. */
  google: Map<string, { selected: boolean; events: FakeEvent[] }>;
  graph: FakeEvent[];
};

const idToken = (aud: string, email: string): string =>
  ["e30", Buffer.from(JSON.stringify({ aud, email, iss: "stand-in" })).toString("base64url"), "c2lnbmF0dXJl"].join(".");

export async function fakeProvider(t: TestContext, o: { client: string; secret?: string; rolls?: boolean }): Promise<FakeProvider> {
  const codes = new Map<string, { challenge: string; email: string }>();
  let refresh = "";
  let email = "";
  let n = 0;
  const fake: FakeProvider = {
    url: "", tokens: { mail: "", calendar: "" }, refreshes: 0, google: new Map(), graph: [],
    issue(code, challenge, who) {
      codes.set(code, { challenge, email: who });
    },
  };
  const form = (req: IncomingMessage) => new Promise<URLSearchParams>((ok) => {
    let b = "";
    req.on("data", (c: Buffer) => (b += c.toString()));
    req.on("end", () => ok(new URLSearchParams(b)));
  });
  const kindOf = (scope: string): "mail" | "calendar" => (/calendar/i.test(scope) ? "calendar" : "mail");
  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    const json = (code: number, body: unknown) => void res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (req.method === "POST" && u.pathname === "/token") {
      const f = await form(req);
      if (f.get("client_id") !== o.client || (o.secret !== undefined && f.get("client_secret") !== o.secret)) return json(401, { error: "invalid_client" });
      if (f.get("grant_type") === "authorization_code") {
        const c = codes.get(f.get("code") ?? "");
        codes.delete(f.get("code") ?? ""); // good once
        const verifier = f.get("code_verifier") ?? "";
        if (!c || createHash("sha256").update(verifier).digest("base64url") !== c.challenge) return json(400, { error: "invalid_grant", error_description: "the code or its verifier is wrong" });
        email = c.email;
        refresh = `refresh-not-real-${++n}`;
        const kind = kindOf(f.get("scope") ?? "");
        fake.tokens[kind] = `${kind}-token-not-real-${n}`;
        return json(200, { access_token: fake.tokens[kind], refresh_token: refresh, expires_in: 3600, id_token: idToken(o.client, email), token_type: "Bearer" });
      }
      if (f.get("grant_type") === "refresh_token") {
        if (f.get("refresh_token") !== refresh) return json(400, { error: "invalid_grant", error_description: "that refresh token is not current" });
        fake.refreshes++;
        const kind = kindOf(f.get("scope") ?? "");
        fake.tokens[kind] = `${kind}-token-not-real-${++n}`;
        if (o.rolls) refresh = `refresh-not-real-${n}`;
        return json(200, { access_token: fake.tokens[kind], expires_in: 3600, ...(o.rolls && { refresh_token: refresh }) });
      }
      return json(400, { error: "unsupported_grant_type" });
    }
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (bearer !== fake.tokens.calendar) return json(401, { error: { message: "not the calendar's token" } });
    if (u.pathname === "/calendar/v3/users/me/calendarList") {
      return json(200, { items: [...fake.google].map(([id, c]) => ({ id, selected: c.selected, ...(id === "primary" && { primary: true }) })) });
    }
    const cal = /^\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(u.pathname);
    if (cal) {
      const from = Date.parse(u.searchParams.get("timeMin") ?? ""), to = Date.parse(u.searchParams.get("timeMax") ?? "");
      const events = fake.google.get(decodeURIComponent(cal[1]!))?.events ?? [];
      return json(200, {
        items: events.filter((e) => (e.allDay ? Date.parse(`${e.end}T00:00`) : Date.parse(e.end)) > from && (e.allDay ? Date.parse(`${e.start}T00:00`) : Date.parse(e.start)) < to).map((e) => ({
          id: e.id, summary: e.title, ...(e.location && { location: e.location }), status: e.cancelled ? "cancelled" : "confirmed",
          start: e.allDay ? { date: e.start } : { dateTime: e.start }, end: e.allDay ? { date: e.end } : { dateTime: e.end },
        })),
      });
    }
    if (u.pathname === "/v1.0/me/calendarView") {
      if (req.headers.prefer !== 'outlook.timezone="UTC"') return json(400, { error: { message: "asked without a zone" } });
      return json(200, {
        value: fake.graph.map((e) => ({
          id: e.id, subject: e.title, isAllDay: Boolean(e.allDay), isCancelled: Boolean(e.cancelled), location: { displayName: e.location ?? "" },
          // Graph's own shape: UTC, seven decimals, no zone letter
          start: { dateTime: e.allDay ? `${e.start}T00:00:00.0000000` : `${e.start.replace("Z", "")}.0000000`, timeZone: "UTC" },
          end: { dateTime: e.allDay ? `${e.end}T00:00:00.0000000` : `${e.end.replace("Z", "")}.0000000`, timeZone: "UTC" },
        })),
      });
    }
    json(404, { error: { message: "no such thing" } });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  fake.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t.after(() => new Promise<void>((r) => {
    server.closeAllConnections();
    server.close(() => r());
  }));
  return fake;
}
