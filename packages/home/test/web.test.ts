// PLAN 3.10_t, the researchers' tools (ported from Ash's web.mjs and net.mjs), against a fixture
// web: a page server on loopback, let through by the in-process address policy, and a stand-in
// for Tavily.
//   - The guard: a private, loopback, link-local or metadata address is refused, in either IPv6
//     spelling; a name that rebinds to loopback at connect time is refused; a redirect into the
//     metadata address is refused.
//   - Pages: HTML becomes readable text with its title and its entities decoded; a long page
//     keeps the parts about the prompt, in the page's order; binary is refused with its type;
//     JSON is re-indented.
//   - Search: snippets with their addresses, the person's key sent as a bearer, the domain filters
//     re-applied, and a plain message when there is no key.
//   - Both tools are marked as reading from outside (1.6). The key lives in the keychain only.
//   - A researcher's constitution carries the method; a builder's does not.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { serve } from "../src/api.ts";
import { composeConstitution, RESEARCH_METHOD } from "../src/brain/constitution.ts";
import { MemoryStore } from "../src/chatgpt/store.ts";
import { _setAddressPolicy, _setResolver, blockedAddress, checkUrl, safeFetch } from "../src/agent/net.ts";
import { TOOLS } from "../src/agent/tools.ts";
import { focus, htmlToText, webFetch, webSearch } from "../src/agent/web.ts";
import { agentHome } from "./helpers.ts";

let pages: Server;
let base = "";
before(async () => {
  pages = createServer((req, res) => {
    const u = req.url ?? "/";
    if (u === "/cafe") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><head><title>Caf&eacute; &amp; Co</title><script>steal()</script></head><body><nav>Home | About</nav><h1>The menu</h1><p>Espresso costs &euro;2.</p></body></html>");
    } else if (u === "/long") {
      res.writeHead(200, { "content-type": "text/html" });
      const filler = Array.from({ length: 900 }, (_, i) => `<p>Paragraph ${i} about nothing much, the weather and the menu bar.</p>`).join("");
      res.end(`<html><body><p>FIRST the opening of the page.</p>${filler}<p>ZEBRA migration happens in March across the Serengeti.</p>${filler}<p>LAST zebra herds return.</p></body></html>`);
    } else if (u === "/image") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(Buffer.from([137, 80, 78, 71, 0, 0, 0, 13]));
    } else if (u === "/json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"a":1,"b":[2,3]}');
    } else if (u === "/to-metadata") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
    } else {
      res.writeHead(404);
      res.end("no");
    }
  });
  await new Promise<void>((r) => pages.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(pages.address() as { port: number }).port}`;
});
after(() => new Promise<void>((r) => pages.close(() => r())));

/** The fixture web: loopback is let through for the page server's address only. */
function letFixtureThrough(): () => void {
  const prev = _setAddressPolicy((ip) => (ip === "127.0.0.1" ? false : blockedAddress(ip)));
  return () => void _setAddressPolicy(prev);
}

test("the guard refuses private, loopback, link-local and metadata addresses, in every spelling", async () => {
  for (const u of ["http://127.0.0.1/", "http://10.0.0.5/", "http://169.254.169.254/latest/", "http://192.168.1.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "file:///etc/passwd"]) {
    const r = await checkUrl(u);
    assert.equal(r.ok, false, `${u} was let through`);
  }
  assert.equal((await checkUrl("http://93.184.216.34/")).ok, true, "control: a public address is fine");
  // a name that resolves to loopback is refused before connecting
  const prev = _setResolver(async () => [{ address: "127.0.0.1", family: 4 }]);
  try {
    assert.match(((await checkUrl("http://evil.test/")) as { reason: string }).reason, /private or reserved/);
  } finally {
    _setResolver(prev);
  }
});

test("a name that answers 'public' to the check and loopback to the connection is refused at connect time", async () => {
  let n = 0;
  const prev = _setResolver(async () => (n++ === 0 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }]));
  try {
    const r = await safeFetch(`http://rebind.test:${new URL(base).port}/cafe`);
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /at connect time/, "the checked address is the connected address");
  } finally {
    _setResolver(prev);
  }
});

test("a redirect into the metadata address is refused, hop by hop", async () => {
  const restore = letFixtureThrough();
  try {
    const r = await safeFetch(`${base}/to-metadata`);
    assert.equal(r.ok, false);
    assert.match(r.reason ?? "", /169\.254\.169\.254/);
  } finally {
    restore();
  }
});

test("a page reads as text: its title, its entities, no script; JSON re-indented; binary refused with its type", async () => {
  const restore = letFixtureThrough();
  try {
    const cafe = await webFetch({ url: `${base}/cafe` });
    assert.match(cafe.content, /Title: Café & Co/);
    assert.match(cafe.content, /The menu\n\nEspresso costs €2\./);
    assert.doesNotMatch(cafe.content, /steal/, "scripts are not prose");
    const json = await webFetch({ url: `${base}/json` });
    assert.match(json.content, /"b": \[\n {4}2,/);
    const png = await webFetch({ url: `${base}/image` });
    assert.equal(png.isError, true);
    assert.match(png.content, /is binary \(image\/png/);
    assert.match((await webFetch({ url: `http://169.254.169.254/` })).content, /private or reserved/, "the tool goes through the guard");
  } finally {
    restore();
  }
});

test("a long page keeps what the prompt is about, in the page's own order, and says it was cut", async () => {
  const restore = letFixtureThrough();
  try {
    const r = await webFetch({ url: `${base}/long`, prompt: "zebra migration serengeti herds" });
    assert.match(r.content, /the sections most relevant to your prompt were kept/);
    const z = r.content.indexOf("ZEBRA migration"), l = r.content.indexOf("LAST zebra");
    assert.ok(z > 0 && l > z, "both zebra paragraphs kept, in the page's order");
  } finally {
    restore();
  }
  // focus itself: the page's order even when the best match comes LAST (by score it would come first)
  const para = (words: string): string => `${words} `.repeat(30).trim();
  const text = [para("menu bar home about"), para("alpha zebra plains grass"), para("filler weather nothing"), para("beta zebra migration serengeti")].join("\n\n");
  const f = focus(text, "zebra migration serengeti", 1750); // room for the two zebra paragraphs, not a third
  assert.ok(f.trimmed, "control: it was over the limit");
  assert.ok(f.text.includes("beta") && f.text.includes("alpha"), "both zebra paragraphs kept");
  assert.ok(f.text.indexOf("alpha") < f.text.indexOf("beta"), "alpha (one match) before beta (three), as on the page");
  assert.equal(htmlToText("<p>&#x1F600; &bogus; &Eacute;</p>").text, "😀 &bogus; É", "entities: hex, unknown left as is, the exact case");
});

test("search: snippets with addresses, the key as a bearer, the domain filters re-applied, and a plain word with no key", async () => {
  const seen: { auth?: string; body?: Record<string, unknown> } = {};
  const tavily = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += String(d)));
    req.on("end", () => {
      seen.auth = String(req.headers.authorization);
      seen.body = JSON.parse(raw) as Record<string, unknown>;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ results: [
        { title: "Zebra facts", url: "https://www.nationalgeographic.com/zebra", content: "Zebras migrate." },
        { title: "Spam", url: "https://spam.example/zebra", content: "Buy zebras." },
      ] }));
    });
  });
  await new Promise<void>((r) => tavily.listen(0, "127.0.0.1", () => r()));
  try {
    const key = { key: "tvly-test-0123456789", base: `http://127.0.0.1:${(tavily.address() as { port: number }).port}` };
    const r = await webSearch({ query: "zebra migration", blocked_domains: ["spam.example"] }, key);
    assert.equal(seen.auth, "Bearer tvly-test-0123456789");
    assert.deepEqual(seen.body?.exclude_domains, ["spam.example"]);
    assert.match(r.content, /1\. Zebra facts\n {3}https:\/\/www\.nationalgeographic\.com\/zebra/);
    assert.doesNotMatch(r.content, /spam\.example/, "the provider returned it anyway; the filter here removed it");
    assert.match(r.content, /These are snippets, not sources/);
    const none = await webSearch({ query: "zebra" }, null);
    assert.equal(none.isError, true);
    assert.match(none.content, /not set up.*Tavily key/);
  } finally {
    await new Promise<void>((r) => tavily.close(() => r()));
  }
});

test("both web tools read from outside: the turn is marked by what they return", () => {
  for (const name of ["web_search", "web_fetch"]) assert.equal(TOOLS.find((t) => t.name === name)?.untrusted, "page", name);
});

test("the search key is kept in the keychain only, and its shape is checked", async (t) => {
  const store = new MemoryStore();
  const { home, dataDir } = await agentHome(t, [], { brains: { store } });
  const door = await serve(home, { port: 0 });
  t.after(() => door.close());
  const post = (body: unknown) => fetch(`http://127.0.0.1:${door.port}/brains/search`, { method: "POST", headers: { authorization: `Bearer ${door.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post({ key: "not-a-key" })).status, 400);
  assert.equal((await post({ key: "tvly-REAL-KEY-0123456789" })).status, 200);
  assert.equal(await store.get("orbs.tavily"), "tvly-REAL-KEY-0123456789");
  assert.deepEqual(await home.brains.searchKey(), { key: "tvly-REAL-KEY-0123456789", base: "https://api.tavily.com" });
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
  for (const f of files(dataDir)) assert.ok(!readFileSync(f).includes("tvly-REAL-KEY"), `the key is in ${f}`);
});

test("a researcher's constitution carries the method; a builder's does not", () => {
  const owner = "# Serge\nintro\n### communication\nSerge writes clearly.\n";
  assert.ok(composeConstitution({ owner, specialty: "research", orbName: "Milo" }).includes(RESEARCH_METHOD));
  assert.ok(composeConstitution({ owner, specialty: "factcheck", orbName: "Milo" }).includes("two independent sources"));
  assert.ok(!composeConstitution({ owner, specialty: "frontend", orbName: "Daisy" }).includes("How you research"));
});
