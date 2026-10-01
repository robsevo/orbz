// Outbound HTTP for the web tools (PLAN 3.10), ported from Ash's engine (`src/net.mjs`).
//
// The model chooses these URLs, so this is a server-side request forgery surface by construction:
// a prompt, or a page the orb just read, can name `http://169.254.169.254/latest/meta-data/`, the
// home's own door on 127.0.0.1, or a router on the local network. So every hop is checked against
// the RESOLVED address, in the lookup the socket itself uses (a name that answers "public" to a
// check and loopback to the connection is DNS rebinding), and redirects are followed one at a time
// with the same check. Bodies are read with a byte cap and a wall-clock timeout.
import { lookup as dnsLookup } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

export const MAX_BYTES = 5 * 1024 * 1024;
export const TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

/** Private, loopback, link-local and reserved IPv4: what a tool reaching "the web" must never reach. */
function blockedV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local: cloud metadata lives here
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

function blockedV6(ip: string): boolean {
  const s = ip.toLowerCase().split("%")[0]!;
  if (s === "::" || s === "::1") return true;
  if (s.startsWith("fe80") || s.startsWith("fec0") || /^f[cd]/.test(s) || s.startsWith("ff")) return true;
  // an IPv4-mapped address is an IPv4 address wearing a hat, in two spellings: the dotted
  // `::ffff:127.0.0.1` and the hex `::ffff:7f00:1` the URL parser normalises it to
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) return blockedV4(dotted[1]!);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  if (hex) {
    const hi = parseInt(hex[1]!, 16), lo = parseInt(hex[2]!, 16);
    return blockedV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return false;
}

export const blockedAddress = (ip: string): boolean => (isIP(ip) === 6 ? blockedV6(ip) : blockedV4(ip));

type Resolved = { address: string; family: number }[];
// Test seams, set in-process only, never from the environment: nothing outside a test can turn
// the guard off.
let refused: (ip: string) => boolean = blockedAddress;
let resolver: (host: string) => Promise<Resolved> = (host) => dnsLookup(host, { all: true });
/** For tests: the address policy (returns the previous one). */
export function _setAddressPolicy(fn: (ip: string) => boolean): (ip: string) => boolean {
  const prev = refused;
  refused = fn;
  return prev;
}
/** For tests: the resolver (returns the previous one). */
export function _setResolver(fn: (host: string) => Promise<Resolved>): (host: string) => Promise<Resolved> {
  const prev = resolver;
  resolver = fn;
  return prev;
}

const guardedLookup: LookupFunction = (hostname, options, cb) => {
  resolver(hostname).then(
    (addrs) => {
      const list = addrs.filter((a) => a?.address);
      if (!list.length) return cb(Object.assign(new Error(`${hostname} resolved to nothing`), { code: "ENOTFOUND" }), "", 0);
      const bad = list.find((a) => refused(a.address));
      if (bad) return cb(Object.assign(new Error(`${hostname} resolves to a private or reserved address (${bad.address}) at connect time`), { code: "EBLOCKED" }), "", 0);
      const usable = options?.family ? list.filter((a) => a.family === options.family) : list;
      const pick = usable.length ? usable : list;
      if (options?.all) return (cb as unknown as (e: null, a: Resolved) => void)(null, pick.map((a) => ({ address: a.address, family: a.family || isIP(a.address) })));
      return cb(null, pick[0]!.address, pick[0]!.family || isIP(pick[0]!.address));
    },
    (e: NodeJS.ErrnoException) => cb(e, "", 0),
  );
};

function get(url: string, o: { headers: Record<string, string>; signal: AbortSignal }): Promise<IncomingMessage> {
  return new Promise((ok, fail) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, { method: "GET", headers: o.headers, lookup: guardedLookup, signal: o.signal }, ok);
    req.on("error", fail);
    req.end();
  });
}

function decoded(res: IncomingMessage): NodeJS.ReadableStream {
  const enc = String(res.headers["content-encoding"] ?? "").trim().toLowerCase();
  const d = enc === "gzip" || enc === "x-gzip" ? createGunzip() : enc === "deflate" ? createInflate() : enc === "br" ? createBrotliDecompress() : null;
  if (!d) return res;
  res.on("error", (e) => d.destroy(e));
  return res.pipe(d);
}

export async function checkUrl(raw: string): Promise<{ ok: true; address: string } | { ok: false; reason: string }> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: `not a valid URL: ${raw}` };
  }
  // file: would read the disk through a "web" tool, past the workspace's boundary
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: `only http and https are allowed, not ${u.protocol}` };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return refused(host) ? { ok: false, reason: `refusing to fetch a private or reserved address (${host})` } : { ok: true, address: host };
  let addrs: Resolved;
  try {
    addrs = await resolver(host);
  } catch (e) {
    return { ok: false, reason: `cannot resolve ${host}: ${(e as NodeJS.ErrnoException)?.code ?? String(e)}` };
  }
  if (!addrs.length) return { ok: false, reason: `${host} resolved to nothing` };
  // every address must be public: one public and one loopback record would be a coin flip
  const bad = addrs.find((a) => refused(a.address));
  if (bad) return { ok: false, reason: `${host} resolves to a private or reserved address (${bad.address})` };
  return { ok: true, address: addrs[0]!.address };
}

export type Fetched = {
  ok: boolean; status?: number; statusText?: string; url?: string; contentType?: string;
  buffer?: Buffer; body?: string; bytes?: number; truncated?: boolean; reason?: string;
};

/** A GET with the address check on every hop, a byte cap and a timeout; a stop ends it at once. */
export async function safeFetch(raw: string, o: { headers?: Record<string, string>; maxBytes?: number; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Fetched> {
  const maxBytes = o.maxBytes ?? MAX_BYTES;
  const timeoutMs = o.timeoutMs ?? TIMEOUT_MS;
  const started = Date.now();
  let url = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (o.signal?.aborted) return { ok: false, reason: "stopped by the user" };
    const check = await checkUrl(url);
    if (!check.ok) return { ok: false, reason: check.reason };
    const left = timeoutMs - (Date.now() - started);
    if (left <= 0) return { ok: false, reason: `timed out after ${timeoutMs}ms` };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), left);
    const onStop = (): void => ac.abort();
    o.signal?.addEventListener("abort", onStop, { once: true });
    const release = (): void => {
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", onStop);
    };
    let res: IncomingMessage;
    try {
      res = await get(url, {
        headers: { "user-agent": "orbs-home", accept: "text/html,text/plain,*/*", "accept-encoding": "gzip, deflate, br", ...o.headers },
        signal: ac.signal,
      });
    } catch (e) {
      release();
      const err = e as NodeJS.ErrnoException;
      if (err?.code === "EBLOCKED") return { ok: false, reason: err.message };
      if (o.signal?.aborted) return { ok: false, reason: "stopped by the user" };
      if (ac.signal.aborted) return { ok: false, reason: `timed out after ${timeoutMs}ms` };
      return { ok: false, reason: `request failed: ${err?.message ?? String(e)}` };
    }
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      release();
      res.resume();
      try {
        url = new URL(res.headers.location, url).toString();
      } catch {
        return { ok: false, reason: `bad redirect target from ${url}` };
      }
      continue;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    try {
      // counted after decoding: a small compressed body that inflates to gigabytes still stops
      for await (const chunk of decoded(res) as AsyncIterable<Buffer>) {
        chunks.push(Buffer.from(chunk));
        bytes += chunk.length;
        if (bytes >= maxBytes) {
          truncated = true;
          break;
        }
      }
    } catch (e) {
      release();
      if (o.signal?.aborted) return { ok: false, reason: "stopped by the user" };
      if (ac.signal.aborted) return { ok: false, reason: `timed out reading ${url}` };
      return { ok: false, reason: `read failed: ${(e as Error)?.message ?? String(e)}` };
    }
    release();
    if (truncated) res.destroy();
    const good = status >= 200 && status < 300;
    const buffer = Buffer.concat(chunks);
    return {
      ok: good, status, statusText: res.statusMessage ?? "", url, contentType: String(res.headers["content-type"] ?? ""),
      buffer, body: buffer.toString("utf8"), bytes, truncated,
      ...(!good && { reason: `HTTP ${status} ${res.statusMessage ?? ""}`.trim() }),
    };
  }
  return { ok: false, reason: `too many redirects (more than ${MAX_REDIRECTS}) from ${raw}` };
}
