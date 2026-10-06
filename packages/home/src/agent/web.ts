// The web tools (PLAN 3.10: "we need researchers too ... give them ashs and serges research
// tools"), ported from Ash's engine (`src/tools/web.mjs`). The division of labour is Ash's: a
// search returns SNIPPETS, which are not sources; reading the page is how a source is read. An
// answer built from snippets reads like it was written off a results page, because it was.
//
//   web_fetch   a page's readable text (HTML to text, a PDF through pdftotext, JSON re-indented),
//               focused on what the orb is looking for when it is long, through the guarded
//               fetch (net.ts); binary is refused with its type, never decoded into noise
//   web_search  the person's own Tavily key (in the keychain, like the Gemini key; brains.ts):
//               a title, a URL and a one-line preview per result, and the domain filters
//               re-applied here, because the provider takes them as a hint
// Everything either returns came from outside: the turn is marked by it (the one-way switch, 1.6).
import { spawn } from "node:child_process";
import { safeFetch, type Fetched } from "./net.ts";

export const MAX_CHARS = 60_000;
const SEARCH_TIMEOUT_MS = 20_000;

// ── HTML → text ─────────────────────────────────────────────────────────────────────────────

const DROP = /<(script|style|noscript|template|svg|canvas|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

/** Named entities; the accented Latin-1 set is generated from its pattern, never hand-listed. */
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  hellip: "…", middot: "·", bull: "•", dagger: "†", prime: "′", laquo: "«", raquo: "»", copy: "©", reg: "®", trade: "™", deg: "°",
  plusmn: "±", times: "×", divide: "÷", frac12: "½", frac14: "¼", sup2: "²", sup3: "³", micro: "µ", para: "¶", sect: "§", euro: "€",
  pound: "£", yen: "¥", cent: "¢", shy: "", ensp: " ", emsp: " ", thinsp: " ", larr: "←", rarr: "→", harr: "↔", darr: "↓", uarr: "↑",
  ne: "≠", le: "≤", ge: "≥", szlig: "ß", aelig: "æ", AElig: "Æ", oelig: "œ", OElig: "Œ", eth: "ð", ETH: "Ð", thorn: "þ", THORN: "Þ",
  oslash: "ø", Oslash: "Ø", aring: "å", Aring: "Å", ccedil: "ç", Ccedil: "Ç",
};
for (const [suffix, upper, lower] of [
  ["grave", { A: 192, E: 200, I: 204, O: 210, U: 217 }, { a: 224, e: 232, i: 236, o: 242, u: 249 }],
  ["acute", { A: 193, E: 201, I: 205, O: 211, U: 218, Y: 221 }, { a: 225, e: 233, i: 237, o: 243, u: 250, y: 253 }],
  ["circ", { A: 194, E: 202, I: 206, O: 212, U: 219 }, { a: 226, e: 234, i: 238, o: 244, u: 251 }],
  ["uml", { A: 196, E: 203, I: 207, O: 214, U: 220 }, { a: 228, e: 235, i: 239, o: 246, u: 252, y: 255 }],
  ["tilde", { A: 195, N: 209, O: 213 }, { a: 227, n: 241, o: 245 }],
] as const) {
  for (const [ch, cp] of Object.entries(upper)) ENTITIES[ch + suffix] = String.fromCharCode(cp);
  for (const [ch, cp] of Object.entries(lower)) ENTITIES[ch + suffix] = String.fromCharCode(cp);
}

const safeChar = (code: number): string => (Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "");

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(parseInt(d, 10)))
    // exact case first: &Eacute; and &eacute; are different letters
    .replace(/&([a-zA-Z][a-zA-Z0-9]{1,14});/g, (m, name: string) => ENTITIES[name] ?? ENTITIES[name.toLowerCase()] ?? m);
}

/** A page's readable text, in reading order: block tags become line breaks, links keep their words. */
export function htmlToText(html: string): { title: string; text: string } {
  let s = String(html ?? "");
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(s)?.[1] ?? "").trim();
  s = s.replace(/<!--[\s\S]*?-->/g, "").replace(DROP, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre)\s*>/gi, "\n\n");
  s = s.replace(/<li\b[^>]*>/gi, "\n- ").replace(/<h([1-6])\b[^>]*>/gi, "\n\n").replace(/<[^>]+>/g, " ");
  s = decodeEntities(s).replace(/[ \t ]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title: decodeEntities(title), text: s };
}

/** Trims to `limit`, keeping the paragraphs most about `prompt`, in the page's own order (a page
 * often starts with its menu, so a plain cut can return a menu and nothing else). */
export function focus(text: string, prompt: string | undefined, limit = MAX_CHARS): { text: string; trimmed: boolean } {
  if (text.length <= limit) return { text, trimmed: false };
  const terms = new Set(String(prompt ?? "").toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g)?.filter((w) => w.length > 3) ?? []);
  const paras = text.split(/\n{2,}/);
  if (!terms.size || paras.length < 4) return { text: text.slice(0, limit), trimmed: true };
  const scored = paras.map((p, i) => {
    const words = p.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [];
    let hits = 0;
    for (const w of words) if (terms.has(w)) hits++;
    return { i, p, score: words.length ? hits / Math.sqrt(words.length) : 0 }; // per word: a long paragraph does not win on length
  });
  const keep = new Set<number>();
  let used = 0;
  for (const s of [...scored].sort((a, b) => b.score - a.score)) {
    if (used + s.p.length + 2 > limit) continue;
    keep.add(s.i);
    used += s.p.length + 2;
    if (used >= limit * 0.98) break;
  }
  if (!keep.size) return { text: text.slice(0, limit), trimmed: true };
  return { text: scored.filter((s) => keep.has(s.i)).map((s) => s.p).join("\n\n"), trimmed: true };
}

// ── binary bodies ───────────────────────────────────────────────────────────────────────────

const BINARY_TYPE = /^(image|audio|video|font)\/|^application\/(octet-stream|zip|gzip|x-tar|x-7z|x-rar|vnd\.|msword|x-executable|wasm)/;
const isPdf = (r: Fetched): boolean => (r.contentType ?? "").toLowerCase().includes("application/pdf") || r.buffer?.subarray(0, 5).toString("latin1") === "%PDF-";

/** pdftotext, fed from stdin, bounded in time and output. */
function pdfToText(buf: Buffer, signal?: AbortSignal): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("pdftotext", ["-enc", "UTF-8", "-", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      return resolve({ ok: false, reason: (e as Error).message });
    }
    let out = "", err = "";
    child.stdout!.setEncoding("utf8");
    child.stderr!.setEncoding("utf8");
    child.stdout!.on("data", (d: string) => { if (out.length < 4_000_000) out += d; });
    child.stderr!.on("data", (d: string) => { if (err.length < 4000) err += d; });
    child.stdin!.on("error", () => {}); // pdftotext may exit before reading all of it
    const kill = (): void => { try { child.kill("SIGKILL"); } catch { /* gone */ } };
    const timer = setTimeout(kill, 20_000);
    signal?.addEventListener("abort", kill, { once: true });
    const done = (v: { ok: true; text: string } | { ok: false; reason: string }): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      resolve(v);
    };
    child.on("error", (e: NodeJS.ErrnoException) => done({ ok: false, reason: e.code === "ENOENT" ? "pdftotext is not installed" : e.message }));
    child.on("close", (code) => done(code === 0 ? { ok: true, text: out } : { ok: false, reason: err.trim().split("\n")[0] || `pdftotext exited with code ${code}` }));
    child.stdin!.end(buf);
  });
}

// ── the tools' work ─────────────────────────────────────────────────────────────────────────

export type ToolOut = { content: string; isError?: boolean; stoppedByUser?: boolean };
const stopped = (what: string): ToolOut => ({ content: `${what} was stopped by the user.`, isError: true, stoppedByUser: true });

export async function webFetch(a: { url?: unknown; prompt?: unknown }, signal?: AbortSignal): Promise<ToolOut> {
  const url = String(a.url ?? "").trim();
  if (!url) return { content: "web_fetch needs a url.", isError: true };
  const started = Date.now();
  const res = await safeFetch(url, { signal });
  if (signal?.aborted) return stopped("web_fetch");
  if (!res.ok && !res.body) return { content: `web_fetch failed: ${res.reason}`, isError: true };
  const ct = (res.contentType ?? "").toLowerCase();
  const kb = `${Math.max(1, Math.round((res.bytes ?? 0) / 1024))} KB`;
  let title = "", body: string, converted = "";
  if (isPdf(res)) {
    const pdf = await pdfToText(res.buffer!, signal);
    if (signal?.aborted) return stopped("web_fetch");
    if (!pdf.ok) return { content: `web_fetch: ${res.url} is a PDF (${kb}) and its text could not be extracted: ${pdf.reason}.${res.truncated ? " The download hit the size cap, so the file is incomplete." : ""}`, isError: true };
    body = pdf.text;
    converted = "NOTE: this is a PDF, converted to text; tables and figures do not survive the conversion.";
  } else if (BINARY_TYPE.test(ct) || (!/text|json|xml|javascript/.test(ct) && res.buffer?.includes(0))) {
    return { content: `web_fetch: ${res.url} is binary (${ct || "unknown type"}, ${kb}), not text, so it was not read; nothing from it is in the conversation.`, isError: true };
  } else body = res.body ?? "";
  if (!converted && (ct.includes("html") || /^\s*<(!doctype|html)\b/i.test(body))) ({ title, text: body } = htmlToText(body));
  else if (!converted && ct.includes("json")) {
    try {
      body = JSON.stringify(JSON.parse(body), null, 2);
    } catch { /* as it came */ }
  }
  const { text, trimmed } = focus(body, typeof a.prompt === "string" ? a.prompt : undefined);
  const head = [
    `${res.url}${res.url !== url ? `  (redirected from ${url})` : ""}`,
    `HTTP ${res.status} ${res.statusText ?? ""} · ${ct || "unknown type"} · ${res.bytes} bytes · ${Date.now() - started}ms`,
    title ? `Title: ${title}` : "",
    converted,
    // a cut is said, never silent: an orb that does not know the page was cut answers as though it read it all
    res.truncated ? "NOTE: the download hit the size cap; this is the start of the page only." : "",
    trimmed ? "NOTE: the page was longer than the limit; the sections most relevant to your prompt were kept, in the page's order." : "",
  ].filter(Boolean).join("\n");
  if (!text.trim()) return { content: `${head}\n\n(no readable text: the page may be an app shell drawn by JavaScript)`, isError: !res.ok };
  return { content: `${head}\n\n${text}`, isError: !res.ok };
}

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return "";
  }
};
const domainMatch = (host: string, d: string): boolean => {
  const dd = String(d).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return host === dd || host.endsWith(`.${dd}`);
};

export type SearchKey = { key: string; base: string };

export async function webSearch(a: { query?: unknown; allowed_domains?: unknown; blocked_domains?: unknown }, key: SearchKey | null, signal?: AbortSignal): Promise<ToolOut> {
  const query = String(a.query ?? "").trim();
  if (query.length < 2) return { content: "web_search needs a query of at least 2 characters.", isError: true };
  // named plainly: an orb told only "search failed" tries again forever
  if (!key) return { content: "web_search is not set up: the person has not added a Tavily key in Settings. web_fetch still works, so a known address can be read.", isError: true };
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
  const allow = list(a.allowed_domains), block = list(a.blocked_domains);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SEARCH_TIMEOUT_MS);
  const onStop = (): void => ac.abort();
  signal?.addEventListener("abort", onStop, { once: true });
  let data: { results?: { title?: string; url?: string; content?: string }[]; answer?: string };
  try {
    const res = await fetch(`${key.base.replace(/\/$/, "")}/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key.key}` },
      body: JSON.stringify({ query, max_results: 10, search_depth: "basic", ...(allow.length && { include_domains: allow }), ...(block.length && { exclude_domains: block }) }),
      signal: ac.signal,
    });
    const raw = await res.text();
    if (!res.ok) return { content: `web_search failed: HTTP ${res.status}: ${raw.slice(0, 200)}`, isError: true };
    data = JSON.parse(raw) as typeof data;
  } catch (e) {
    if (signal?.aborted) return stopped("web_search");
    if (ac.signal.aborted) return { content: `web_search timed out after ${SEARCH_TIMEOUT_MS}ms.`, isError: true };
    return { content: `web_search failed: ${(e as Error)?.message ?? String(e)}`, isError: true };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onStop);
  }
  let results = Array.isArray(data?.results) ? data.results : [];
  // re-applied here: a blocked domain the provider returned anyway would hand the orb exactly what it was told to avoid
  if (allow.length) results = results.filter((r) => allow.some((d) => domainMatch(hostOf(String(r.url)), d)));
  if (block.length) results = results.filter((r) => !block.some((d) => domainMatch(hostOf(String(r.url)), d)));
  if (!results.length) return { content: `No results for "${query}"${allow.length || block.length ? " after the domain filters" : ""}.` };
  const lines = results.map((r, i) => {
    const desc = String(r.content ?? "").replace(/\s+/g, " ").trim().slice(0, 260);
    return `${i + 1}. ${String(r.title ?? "(untitled)").replace(/\s+/g, " ").slice(0, 140)}\n   ${r.url}\n   ${desc}`;
  });
  const answer = typeof data?.answer === "string" && data.answer.trim() ? `\nThe provider's summary (unverified; check it against the sources):\n${data.answer.trim().slice(0, 600)}\n` : "";
  return { content: `${results.length} result(s) for "${query}":\n\n${lines.join("\n\n")}\n${answer}\nThese are snippets, not sources. Read the ones worth reading with web_fetch before answering from them.` };
}
