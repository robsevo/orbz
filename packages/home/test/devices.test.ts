// PLAN 2.7_t, the home's side of the personal web app:
//   - Every session is a device: listed by name, kept across a restart, and revoked at its next
//     request.
//   - The second door is HTTPS on the box's own names only: a rebound hostname is refused, plain
//     HTTP is never answered, the loopback token is not taken there, a pairing link through it
//     gives a Secure cookie.
//   - A passkey is made only from a signed-in device; then any device signs in with it. A sign-in
//     from another origin, for another name, without the person verified, with a bad signature, a
//     replayed challenge, an unknown passkey, or a counter gone back is refused.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { serve, type HomeDoor } from "../src/api.ts";
import { Home } from "../src/home.ts";
import { FakeAuthenticator } from "./fakes/authenticator.ts";
import { CHALLENGES_KEPT } from "../src/passkeys.ts";
import { tempDir } from "./helpers.ts";

const UA = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36";

function home(t: TestContext, dataDir = tempDir(t)) {
  const h = Home.open({ dataDir, protect: [], spendCapUsd: null });
  t.after(() => h.close());
  return h;
}

/** Calls the loopback door as a browser at localhost would (a session cookie), or with the token. */
const local = (door: HomeDoor) => async (method: string, path: string, o: { body?: unknown; cookie?: string; token?: boolean } = {}) => {
  const r = await fetch(`http://localhost:${door.port}${path}`, {
    method,
    headers: {
      "content-type": "application/json", "user-agent": UA,
      ...(o.token && { authorization: `Bearer ${door.token}` }),
      ...(o.cookie && { cookie: o.cookie, "x-orbs": "1" }),
    },
    ...(o.body !== undefined && { body: JSON.stringify(o.body) }),
  });
  return { status: r.status, json: (await r.json()) as Record<string, unknown>, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0]!, setCookie: r.headers.get("set-cookie") ?? "" };
};

test("a session is a device: listed by name, kept across a restart, revoked at its next request", async (t) => {
  const dataDir = tempDir(t);
  const h = home(t, dataDir);
  let door = await serve(h, { port: 0 });
  const call = local(door);
  const code = new URL(door.pairLink()).hash.replace("#pair=", "");
  const paired = await call("POST", "/session", { body: { code } });
  assert.equal(paired.status, 200);
  assert.match(paired.setCookie, /HttpOnly; SameSite=Strict/);
  assert.ok(!/Secure/.test(paired.setCookie), "on this machine's loopback, no Secure (plain http)");
  const devices = (await call("GET", "/devices", { cookie: paired.cookie })).json.devices as { id: number; name: string; via: string; current: boolean }[];
  assert.deepEqual(devices.map((d) => [d.name, d.via, d.current]), [["Chrome on Android", "pair", true]]);
  await door.close();
  await h.close();

  const again = home(t, dataDir); // the home restarted
  door = await serve(again, { port: 0 });
  t.after(() => door.close());
  const call2 = local(door);
  assert.equal((await call2("GET", "/status", { cookie: paired.cookie })).status, 200, "still signed in after a restart");
  assert.equal((await call2("POST", `/devices/${devices[0]!.id}/revoke`, { token: true })).json.revoked, true);
  assert.equal((await call2("GET", "/status", { cookie: paired.cookie })).status, 401, "revoked: locked out at its next request");
  assert.deepEqual((await call2("GET", "/devices", { token: true })).json.devices, []);
});

test("the second door: HTTPS on its own names only; a rebound name, plain HTTP and the token are refused", async (t) => {
  const dir = tempDir(t);
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "1", "-subj", "/CN=orbs.test", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem")], { stdio: "ignore" });
  const h = home(t);
  const door = await serve(h, { port: 0, remote: { names: ["orbs.test"], cert: readFileSync(join(dir, "cert.pem")), key: readFileSync(join(dir, "key.pem")), host: "127.0.0.1" } });
  t.after(() => door.close());
  const port = door.remote!.port;
  const call = (method: string, path: string, o: { host?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    new Promise<{ status: number; json: Record<string, unknown>; setCookie: string }>((ok, fail) => {
      const r = httpsRequest({ host: "127.0.0.1", port, path, method, rejectUnauthorized: false, servername: "orbs.test", headers: { host: o.host ?? `orbs.test:${port}`, "content-type": "application/json", ...o.headers } }, (res) => {
        let s = "";
        res.on("data", (c: Buffer) => (s += c.toString()));
        res.on("end", () => ok({ status: res.statusCode ?? 0, json: JSON.parse(s || "{}") as Record<string, unknown>, setCookie: String(res.headers["set-cookie"] ?? "") }));
      });
      r.on("error", fail);
      r.end(o.body === undefined ? undefined : JSON.stringify(o.body));
    });
  assert.equal((await call("GET", "/status")).status, 401, "no session, no way in");
  assert.equal((await call("GET", "/status", { host: `evil.example:${port}` })).status, 421, "a hostname rebound to it is refused");
  assert.equal((await call("GET", "/status", { headers: { authorization: `Bearer ${door.token}` } })).status, 401, "the loopback token is for this machine's tools only");
  const link = door.remote!.pairLink();
  assert.match(link, new RegExp(`^https://orbs\\.test:${port}/app/orbs\\.html#pair=`));
  const paired = await call("POST", "/session", { body: { code: new URL(link).hash.replace("#pair=", "") }, headers: { "user-agent": UA } });
  assert.match(paired.setCookie, /HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+; Secure/);
  const cookie = paired.setCookie.split(";")[0]!;
  assert.equal((await call("GET", "/status", { headers: { cookie } })).status, 200, "a phone, paired through the second door");
  const plain = await new Promise<string>((ok) => {
    const r = httpRequest({ host: "127.0.0.1", port, path: "/status", headers: { host: `orbs.test:${port}`, cookie } }, (res) => ok(`answered ${res.statusCode}`));
    r.on("error", (e) => ok(`refused: ${e.message}`));
    r.end();
  });
  assert.match(plain, /^refused/, `plain HTTP is never answered (${plain})`);
  assert.equal((await local(door)("GET", "/status", { token: true })).status, 200, "the loopback door is as it was");
});

test("a passkey: made from a signed-in device, then any device signs in with it; every bent sign-in is refused", async (t) => {
  const h = home(t);
  h.about.setName("Robin");
  const door = await serve(h, { port: 0 });
  t.after(() => door.close());
  const call = local(door);
  const origin = `http://localhost:${door.port}`;
  const key = new FakeAuthenticator();

  assert.equal((await call("POST", "/passkeys/new/options")).status, 401, "a passkey is never how a stranger gets in");
  const made = (await call("POST", "/passkeys/new/options", { token: true })).json as { challenge: string; rp: { id: string }; user: { name: string } };
  assert.deepEqual([made.rp.id, made.user.name], ["localhost", "Robin"]);
  const kept = await call("POST", "/passkeys", { token: true, body: { credential: key.create(made, origin), name: "Robin's laptop" } });
  assert.equal(kept.status, 200, JSON.stringify(kept.json));
  assert.deepEqual(((await call("GET", "/passkeys", { token: true })).json.passkeys as { name: string }[]).map((p) => p.name), ["Robin's laptop"]);

  const options = async () => (await call("POST", "/passkeys/sign-in/options")).json as { challenge: string; rpId: string };
  const signIn = (credential: unknown) => call("POST", "/passkeys/sign-in", { body: { credential } });
  const first = await options();
  const good = key.get(first, origin);
  const ok = await signIn(good);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal((await call("GET", "/status", { cookie: ok.cookie })).status, 200, "signed in with no pairing link at all");
  assert.deepEqual(((await call("GET", "/devices", { token: true })).json.devices as { via: string }[]).map((d) => d.via), ["passkey"]);

  const refused = async (credential: unknown, why: RegExp) => {
    const r = await signIn(credential);
    assert.equal(r.status, 401, JSON.stringify(r.json));
    assert.match(String(r.json.error), why);
  };
  await refused(good, /challenge .* used/);
  await refused(key.get(await options(), origin, { origin: "https://evil.example" }), /asked for by https:\/\/evil\.example/);
  await refused(key.get(await options(), origin, { rpId: "evil.example" }), /another name than localhost/);
  await refused(key.get(await options(), origin, { verified: false }), /verified/);
  await refused(key.get(await options(), origin, { type: "webauthn.create" }), /not a webauthn\.get/);
  const bad = key.get(await options(), origin) as { response: { signature: string } };
  const sig = Buffer.from(bad.response.signature, "base64url");
  sig[sig.length - 1] = sig[sig.length - 1]! ^ 1;
  bad.response.signature = sig.toString("base64url");
  await refused(bad, /signature is not that passkey's|not base64url/);
  await refused(new FakeAuthenticator().get(await options(), origin), /not one of this home's/);
  await refused(key.get(await options(), origin, { count: 1 }), /counter went backwards/);
  assert.equal((await signIn(key.get(await options(), origin))).status, 200, "control: the same passkey, used properly, still signs in");

  // anyone can ask the door for a challenge: a flood keeps only the newest, and never grows past them
  const early = await options();
  for (let i = 0; i < CHALLENGES_KEPT; i++) await options();
  await refused(key.get(early, origin), /challenge .* (lapsed|used)/);
  assert.equal((await signIn(key.get(await options(), origin))).status, 200, "a fresh one still works");
});
