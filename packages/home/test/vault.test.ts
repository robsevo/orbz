// PLAN 4.1's vault: the passwords you save for your orbs' browsers.
//   - Sealed with AES-256-GCM under a key kept in the keychain: the file never holds a password,
//     nor the key; the log names the site, never the username or the password.
//   - A password is handed out only for a page on the very site it was saved for (www. aside):
//     never for another host, a subdomain of it, a look-alike or a page that is not on the web.
//   - Each sealed password is bound to its site and username: moved onto another entry, it opens
//     to nothing, not to someone else's password.
//   - What an orb reads is scrubbed of every saved password (as written, URL-encoded, base64).
//   - Without its key (another keychain), it says so, and nothing opens.
import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { MemoryStore } from "../src/chatgpt/store.ts";
import { HIDDEN, hostOf, siteOf, Vault, VaultError } from "../src/computer/vault.ts";
import { openHome } from "./helpers.ts";

const PASSWORD = "hunter2-correct-horse";

function vault(t: Parameters<typeof openHome>[0], store = new MemoryStore()) {
  const { home, dataDir, clock } = openHome(t);
  return { v: new Vault({ dataDir, events: home.events, store: () => Promise.resolve(store), now: () => clock.now() }), store, home, dataDir };
}

test("a site is the host of its sign-in page, as the person typed it", () => {
  assert.equal(siteOf("https://www.GitHub.com/login?return=/x"), "github.com");
  assert.equal(siteOf("accounts.google.com"), "accounts.google.com");
  assert.equal(siteOf("http://127.0.0.1:8080/login"), "127.0.0.1");
  assert.throws(() => siteOf(""), VaultError);
  assert.throws(() => siteOf("localhost"), VaultError, "a bare name is not a site");
  assert.throws(() => siteOf("not a site"), VaultError);
  assert.equal(hostOf("https://www.github.com/session"), "github.com");
  assert.equal(hostOf("file:///home/x/login.html"), null, "only a web page");
  assert.equal(hostOf("about:blank"), null);
});

test("sealed with its key in the keychain: the file holds no password and no key; the log no username", async (t) => {
  const { v, store, home, dataDir } = vault(t);
  await v.add("https://github.com/login", "robin", PASSWORD);
  const file = readFileSync(join(dataDir, "vault.json"), "utf8");
  const key = await store.get("vault:key");
  assert.ok(key && /^[0-9a-f]{64}$/.test(key), "the key is in the keychain");
  assert.ok(!file.includes(PASSWORD) && !file.includes(key!), "the file holds neither the password nor the key");
  assert.ok(!file.includes(Buffer.from(PASSWORD).toString("base64")), "nor the password in another spelling");
  if (process.platform !== "win32") assert.equal(statSync(join(dataDir, "vault.json")).mode & 0o777, 0o600, "the person's alone");
  assert.deepEqual(v.list().map((e) => [e.site, e.username]), [["github.com", "robin"]]);
  const log = JSON.stringify(home.events.since(0, 1000));
  assert.ok(log.includes("vault.saved") && log.includes("github.com"), "the log says a password was saved for the site");
  assert.ok(!log.includes("robin") && !log.includes(PASSWORD), "never whose, never the password");
  // saving again replaces it, never a second entry
  await v.add("github.com", "robin", "another-secret-9");
  assert.equal(v.list().length, 1);
  assert.equal((await v.loginFor("https://github.com/login")).password, "another-secret-9");
});

test("handed out only for a page on the very site it was saved for", async (t) => {
  const { v } = vault(t);
  await v.add("github.com", "robin", PASSWORD);
  assert.equal((await v.loginFor("https://github.com/login")).password, PASSWORD);
  assert.equal((await v.loginFor("https://www.github.com/session")).username, "robin", "www. is the same site");
  for (const url of ["https://github.com.evil.test/login", "https://evil-github.com/login", "https://gist.github.com/login", "https://githubb.com/", "file:///tmp/github.com/login.html", "about:blank"]) {
    await assert.rejects(v.loginFor(url), VaultError, `never for ${url}`);
  }
  await assert.rejects(v.loginFor("https://evil.test/login"), /saved: github\.com; a password is typed only on the site it was saved for/);
});

test("two usernames on one site: he names one, and only a saved one", async (t) => {
  const { v } = vault(t);
  await v.add("github.com", "robin", PASSWORD);
  await v.add("github.com", "robin-work", "work-secret-77");
  await assert.rejects(v.loginFor("https://github.com/login"), /2 usernames are saved for github\.com: robin, robin-work\. Say which/);
  assert.equal((await v.loginFor("https://github.com/login", "robin-work")).password, "work-secret-77");
  await assert.rejects(v.loginFor("https://github.com/login", "mallory"), /no password saved for mallory on github\.com/);
  v.remove("github.com", "robin-work");
  assert.equal((await v.loginFor("https://github.com/login")).username, "robin");
  assert.throws(() => v.remove("github.com", "robin-work"), VaultError);
});

test("each sealed password is bound to its site and username: moved, it opens to nothing", async (t) => {
  const { v, dataDir } = vault(t);
  await v.add("bank.test", "robin", "bank-secret-123");
  await v.add("forum.test", "robin", "forum-secret-456");
  const f = join(dataDir, "vault.json");
  const j = JSON.parse(readFileSync(f, "utf8")) as { entries: { site: string; sealed: string }[] };
  const bank = j.entries.find((e) => e.site === "bank.test")!.sealed;
  j.entries.find((e) => e.site === "forum.test")!.sealed = bank; // the bank's blob on the forum's entry
  writeFileSync(f, JSON.stringify(j));
  await assert.rejects(v.loginFor("https://forum.test/login"), /cannot be opened with this vault's key/, "never the bank's password on the forum");
  assert.equal((await v.loginFor("https://bank.test/login")).password, "bank-secret-123", "CONTROL: in its own place it opens");
});

test("what an orb reads is scrubbed of every saved password, in every spelling", async (t) => {
  const { v } = vault(t);
  assert.equal(await v.scrub(`your password is ${PASSWORD}`), `your password is ${PASSWORD}`, "CONTROL: an empty vault hides nothing");
  await v.add("github.com", "robin", PASSWORD);
  await v.add("short.test", "robin", "1234");
  assert.equal(await v.scrub(`Welcome robin, your password is ${PASSWORD}.`), `Welcome robin, your password is ${HIDDEN}.`);
  assert.equal(await v.scrub(`?p=${encodeURIComponent(PASSWORD)}`), `?p=${HIDDEN}`);
  assert.equal(await v.scrub(Buffer.from(PASSWORD).toString("base64")), HIDDEN);
  assert.equal(await v.scrub("call 1234 for help"), "call 1234 for help", "a password too short to look for hides nothing else");
  await v.add("github.com", "robin", "a-new-password-0");
  assert.equal(await v.scrub("a-new-password-0"), HIDDEN, "a changed password is looked for at once");
});

test("without its key (another keychain), it says so and nothing opens", async (t) => {
  const { v, dataDir, home } = vault(t);
  await v.add("github.com", "robin", PASSWORD);
  const other = new Vault({ dataDir, events: home.events, store: () => Promise.resolve(new MemoryStore()), now: () => 0 });
  assert.deepEqual(other.list().map((e) => e.site), ["github.com"], "it still knows what is saved");
  await assert.rejects(other.loginFor("https://github.com/login"), /the vault's key is not in this home's secret store/);
  assert.equal(await other.scrub(PASSWORD), PASSWORD, "with nothing openable, nothing could have been typed");
});
