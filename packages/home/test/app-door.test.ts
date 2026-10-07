// PLAN 2.4_t, the app's way into the home, through its door:
//   - The built app is served at /app/, without a pass, never a file outside it, and with a
//     policy that lets the page load only its own things.
//   - A pairing link's code buys a session once, never twice, and not after five minutes.
//   - With the session the app reads; a change needs the app's header as well (a page on another
//     site cannot add it).
//   - The token still works; a stranger gets nothing.
//   - What the orbs know about you is kept; each orb's look round-trips.
//   - Letting an orb go archives him, his work kept, out of the office and taking no work; a
//     rehire brings him back.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { FakeClock } from "../src/clock.ts";
import { agentHome, tempDir, openCompany } from "./helpers.ts";

async function door(t: Parameters<typeof agentHome>[0], more: Parameters<typeof agentHome>[2] = {}) {
  const h = await agentHome(t, [{ chunks: ["hi"] }], more);
  const root = tempDir(t);
  const appDir = join(root, "dist");
  mkdirSync(join(appDir, "assets"), { recursive: true });
  writeFileSync(join(root, "secret.txt"), "the home's own, beside the app"); // a file outside the app, to be refused
  writeFileSync(join(appDir, "orbs.html"), "<!doctype html><title>Orbs</title>");
  writeFileSync(join(appDir, "assets", "app.js"), "console.log(1)");
  const d = await serve(h.home, { port: 0, appDir });
  t.after(() => d.close());
  const base = `http://127.0.0.1:${d.port}`;
  const call = (path: string, o: { method?: string; body?: unknown; token?: boolean; cookie?: string; app?: boolean } = {}) =>
    fetch(`${base}${path}`, {
      method: o.method ?? "GET",
      redirect: "manual",
      headers: {
        ...(o.token && { authorization: `Bearer ${d.token}` }),
        ...(o.cookie && { cookie: o.cookie }),
        ...(o.app && { "x-orbs": "1" }),
        ...(o.body !== undefined && { "content-type": "application/json" }),
      },
      ...(o.body !== undefined && { body: JSON.stringify(o.body) }),
    });
  const pair = async (): Promise<string> => {
    const code = new URL(d.pairLink()).hash.replace("#pair=", "");
    const r = await call("/session", { method: "POST", body: { code } });
    assert.equal(r.status, 200);
    const c = r.headers.get("set-cookie")!;
    assert.match(c, /HttpOnly/);
    assert.match(c, /SameSite=Strict/);
    return c.split(";")[0]!;
  };
  return { ...h, d, call, pair };
}

test("the app's files, without a pass, never one outside it, with a policy of its own", async (t) => {
  const { call } = await door(t);
  const page = await call("/app/orbs.html");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.equal(page.headers.get("cache-control"), "no-store", "the page always fresh");
  assert.equal((await call("/app/assets/app.js")).status, 200);
  // never a file outside the app, in any spelling (%2E%2E is folded to .. by the URL parser itself,
  // and lands outside /app/, where a pass is needed)
  for (const path of ["/app/..%2Fsecret.txt", "/app/%2E%2E/secret.txt", "/app/assets/..%2F..%2Fsecret.txt"]) {
    const r = await call(path);
    assert.ok(r.status >= 400, `${path}: ${r.status}`);
    assert.doesNotMatch(await r.text(), /beside the app/, `${path} gave the file away`);
  }
  assert.equal((await call("/app/orbs.html", {})).status, 200, "control: the app's own file is served");
  assert.equal((await call("/")).headers.get("location"), "/app/orbs.html");
});

test("a pairing link buys a session once, never twice, and not after five minutes", async (t) => {
  const clock = new FakeClock(Date.parse("2026-10-01T12:00:00Z"));
  const { d, call, pair } = await door(t, { clock });
  const cookie = await pair();
  assert.equal((await call("/status", { cookie })).status, 200, "the session reads");
  const code = new URL(d.pairLink()).hash.replace("#pair=", "");
  assert.equal((await call("/session", { method: "POST", body: { code } })).status, 200, "a fresh code works");
  assert.equal((await call("/session", { method: "POST", body: { code } })).status, 401, "and only once");
  const late = new URL(d.pairLink()).hash.replace("#pair=", "");
  clock.suspend(5 * 60_000 + 1000); // the wall clock moves on past the code's five minutes
  assert.equal((await call("/session", { method: "POST", body: { code: late } })).status, 401, "not after five minutes");
  assert.equal((await call("/session", { method: "POST", body: { code: "made-up" } })).status, 401);
});

test("with a session the app reads, and a change needs its header too; the token still works; a stranger gets nothing", async (t) => {
  const { call, pair } = await door(t);
  const cookie = await pair();
  assert.equal((await call("/me", { method: "PUT", body: { name: "Robin" }, cookie })).status, 403, "no header: a page on another site could have sent it");
  assert.equal((await call("/me", { method: "PUT", body: { name: "Robin" }, cookie, app: true })).status, 200);
  assert.equal((await call("/me", { method: "PUT", body: { name: "Sam" }, token: true })).status, 200, "the token needs no header (it is not a browser's)");
  assert.equal((await call("/status")).status, 401, "nothing at all");
  assert.equal((await call("/status", { cookie: "orbs_session=forged" })).status, 401, "a made-up session");
});

test("about you is kept; an orb's look round-trips; letting him go archives him, and a rehire brings him back", async (t) => {
  const { call, home } = await door(t);
  openCompany(home); // the company in place, so Build is open (PLAN 5.13)
  assert.equal(((await (await call("/me", { method: "PUT", body: { name: "  Robin  " }, token: true })).json()) as { me: { name: string } }).me.name, "Robin");
  assert.equal((await call("/me", { method: "PUT", body: { name: "   " }, token: true })).status, 400, "a name is something to call you");
  const look = { shape: "teddy", eyes: "big", hat: "beret", glasses: "round", hue: "rose" };
  assert.equal((await call("/orbs", { method: "POST", body: { id: "daisy", name: "Daisy", specialty: "frontend", look }, token: true })).status, 200);
  const listed = ((await (await call("/orbs", { token: true })).json()) as { orbs: { id: string; look: unknown }[] }).orbs;
  assert.deepEqual(listed.find((o) => o.id === "daisy")?.look, look);
  home.inbox.send("daisy", "chat:daisy", "hello");
  await home.inbox.idle();
  await call("/orbs/daisy", { method: "DELETE", token: true });
  const after = ((await (await call("/orbs", { token: true })).json()) as { orbs: { id: string }[] }).orbs;
  assert.ok(!after.some((o) => o.id === "daisy"), "out of the office");
  assert.ok(home.conversations.list("chat:daisy").length > 0, "his work kept");
  assert.throws(() => home.inbox.send("daisy", "chat:daisy", "more"), /let go/, "and he takes no work");
  await call("/orbs/daisy/rehire", { method: "POST", token: true });
  assert.ok(((await (await call("/orbs", { token: true })).json()) as { orbs: { id: string }[] }).orbs.some((o) => o.id === "daisy"), "back");
});
