// A saved network capture (a HAR from a browser's developer tools), read statically (PLAN 4.8): the hosts an app talks
// to, its endpoints (each path with its ids folded, `/users/:id`), the methods, statuses and kinds of content, the shape
// of what each sends and answers (its JSON's keys, never its values), GraphQL operations, websockets, and which
// requests carry credentials (their names only: a cookie's or a token's value never leaves this file).
//
// Logic ported from REA (https://github.com/morluto/rea), MIT License, Copyright (c) 2026 morluto: its HAR reading
// (UTF-8 with one byte-order mark skipped, log.entries, the 1.2 profile, sensitive values redacted). Rewritten for Orbz;
// see docs/third-party/rea.md.
import { Unreadable } from "./bytes.ts";

export type Endpoint = { method: string; host: string; path: string; count: number; statuses: number[]; types: string[]; sends: string[]; answers: string[] };
export type HarFacts = {
  version: string;
  entries: number;
  span: { from: string; to: string } | null;
  hosts: { host: string; requests: number; bytes: number }[];
  endpoints: Endpoint[];
  credentials: string[];
  cookies: string[];
  graphql: string[];
  websockets: number;
  notes: string[];
};

type Header = { name?: unknown; value?: unknown };
type Entry = {
  startedDateTime?: unknown;
  request?: { method?: unknown; url?: unknown; headers?: Header[]; postData?: { mimeType?: unknown; text?: unknown }; cookies?: { name?: unknown }[] };
  response?: { status?: unknown; headers?: Header[]; content?: { mimeType?: unknown; text?: unknown; encoding?: unknown; size?: unknown }; bodySize?: unknown; cookies?: { name?: unknown }[] };
  _webSocketMessages?: unknown[];
};

const CREDENTIAL_HEADERS = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|x-auth-token|x-access-token|x-csrf-token|x-xsrf-token|x-session-id|x-amz-security-token)$/i;
const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[A-Za-z0-9_-]{24,})$/i;

/** A path with its ids folded, so /users/42 and /users/43 are one endpoint. */
export const templateOf = (path: string): string => path.split("/").map((seg) => (ID_SEGMENT.test(seg) ? ":id" : seg)).join("/") || "/";

/** A JSON value's shape: its keys two deep, never its values. */
export function shapeOf(text: string): string[] {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return [];
  }
  const keys: string[] = [];
  const walk = (x: unknown, prefix: string, depth: number): void => {
    if (keys.length >= 40 || depth > 2) return;
    if (Array.isArray(x)) return walk(x[0], `${prefix}[]`, depth);
    if (x && typeof x === "object") for (const [k, val] of Object.entries(x)) {
      keys.push(`${prefix}${k}`);
      walk(val, `${prefix}${k}.`, depth + 1);
    }
  };
  walk(v, "", 0);
  return keys;
}

export function readHar(raw: string): HarFacts {
  const text = raw.replace(/^﻿/, ""); // HAR 1.2 lets a writer put a byte-order mark first
  let doc: { log?: { version?: unknown; entries?: unknown } };
  try {
    doc = JSON.parse(text) as typeof doc;
  } catch {
    throw new Unreadable("a HAR is JSON, and this is not");
  }
  if (!doc?.log || !Array.isArray(doc.log.entries)) throw new Unreadable("a HAR has log.entries, and this has none");
  const entries = doc.log.entries.slice(0, 50_000) as Entry[];
  const version = String(doc.log.version ?? "?");
  const notes: string[] = [];
  if (version !== "1.2") notes.push(`HAR version ${version}: read as 1.2`);
  if (doc.log.entries.length > entries.length) notes.push(`only the first ${entries.length.toLocaleString("en-US")} of ${doc.log.entries.length.toLocaleString("en-US")} requests read`);
  const hosts = new Map<string, { host: string; requests: number; bytes: number }>();
  const endpoints = new Map<string, Endpoint>();
  const credentials = new Set<string>();
  const cookies = new Set<string>();
  const graphql = new Set<string>();
  let websockets = 0;
  const times: string[] = [];
  for (const e of entries) {
    const url = typeof e.request?.url === "string" ? e.request.url : "";
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      continue;
    }
    if (typeof e.startedDateTime === "string") times.push(e.startedDateTime);
    const method = String(e.request?.method ?? "GET").toUpperCase();
    const status = Number(e.response?.status) || 0;
    const type = String(e.response?.content?.mimeType ?? "").split(";")[0]!.trim() || "none";
    const bytes = Math.max(0, Number(e.response?.content?.size ?? e.response?.bodySize) || 0);
    const h = hosts.get(u.host) ?? hosts.set(u.host, { host: u.host, requests: 0, bytes: 0 }).get(u.host)!;
    h.requests++;
    h.bytes += bytes;
    const path = templateOf(u.pathname);
    const key = `${method} ${u.host}${path}`;
    const ep = endpoints.get(key) ?? endpoints.set(key, { method, host: u.host, path, count: 0, statuses: [], types: [], sends: [], answers: [] }).get(key)!;
    ep.count++;
    if (status && !ep.statuses.includes(status)) ep.statuses.push(status);
    if (!ep.types.includes(type)) ep.types.push(type);
    const body = typeof e.request?.postData?.text === "string" ? e.request.postData.text : "";
    if (body && !ep.sends.length) ep.sends = shapeOf(body);
    const answer = typeof e.response?.content?.text === "string" && e.response.content.encoding !== "base64" ? e.response.content.text : "";
    if (answer && !ep.answers.length) ep.answers = shapeOf(answer);
    for (const hd of e.request?.headers ?? []) if (typeof hd.name === "string" && CREDENTIAL_HEADERS.test(hd.name)) credentials.add(`${hd.name.toLowerCase()} → ${u.host}`);
    for (const k of u.searchParams.keys()) if (/token|key|secret|sig|auth|session|password/i.test(k)) credentials.add(`?${k}= → ${u.host}`);
    for (const c of [...(e.request?.cookies ?? []), ...(e.response?.cookies ?? [])]) if (typeof c.name === "string") cookies.add(c.name);
    if (body && /"query"\s*:/.test(body)) {
      const op = /"operationName"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? /\b(query|mutation|subscription)\s+(\w+)/.exec(body)?.[2];
      if (op) graphql.add(op);
    }
    if (Array.isArray(e._webSocketMessages) || u.protocol === "wss:" || u.protocol === "ws:") websockets++;
  }
  times.sort();
  return {
    version, entries: entries.length, span: times.length ? { from: times[0]!, to: times[times.length - 1]! } : null,
    hosts: [...hosts.values()].sort((a, b) => b.requests - a.requests),
    endpoints: [...endpoints.values()].sort((a, b) => b.count - a.count),
    credentials: [...credentials], cookies: [...cookies].slice(0, 60), graphql: [...graphql], websockets, notes,
  };
}
