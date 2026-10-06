// robots.txt, as RFC 9309 says a crawler reads it (PLAN 3.12, the reading library). Pure: the text in,
// what may be read out; fetching it, and what an unavailable or unreachable file means, are
// reading.ts's.
//
//   - Groups start at one or more User-agent lines. Ours is the group naming our product token
//     (case-insensitive); several such groups are combined; with none, the `*` groups, combined;
//     with neither, everything may be read.
//   - A rule's pattern is matched against the address's path and query, from its start: `*` is any
//     run of characters, `$` at the end anchors it there. The longest matching pattern wins; an
//     Allow and a Disallow of the same length: Allow. An empty Disallow forbids nothing.
//   - Both sides are compared in one percent-encoding: what is outside US-ASCII is encoded as UTF-8,
//     an encoded unreserved character is decoded, and the hex is upper case.
//   - /robots.txt itself may always be read. Crawl-delay (not in the RFC, kept by most sites that
//     care) is read from our group; Sitemap lines belong to no group.

export const TOKEN = "orbzreader";
/** RFC 9309 2.5: a crawler must read at least the first 500 KiB. */
export const MAX_ROBOTS_BYTES = 512 * 1024;

export type Rule = { allow: boolean; pattern: string };
export type Robots = { rules: Rule[]; crawlDelay: number | null; sitemaps: string[] };

const UNRESERVED = /[A-Za-z0-9\-._~]/;

/** One percent-encoding for both sides: non-ASCII encoded as UTF-8, unreserved characters decoded, hex upper case. */
export function normalizePath(p: string): string {
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === "%" && /^[0-9A-Fa-f]{2}$/.test(p.slice(i + 1, i + 3))) {
      const ch = String.fromCharCode(parseInt(p.slice(i + 1, i + 3), 16));
      out += UNRESERVED.test(ch) ? ch : `%${p.slice(i + 1, i + 3).toUpperCase()}`;
      i += 2;
    } else if (c.charCodeAt(0) > 0x7e || c.charCodeAt(0) < 0x21) {
      const cp = p.codePointAt(i)!;
      if (cp > 0xffff) i++;
      out += [...Buffer.from(String.fromCodePoint(cp), "utf8")].map((b) => `%${b.toString(16).toUpperCase().padStart(2, "0")}`).join("");
    } else out += c;
  }
  return out;
}

/** The parts of robots.txt that apply to `token` (ours unless a test says otherwise). */
export function parseRobots(text: string, token = TOKEN): Robots {
  type Group = { agents: string[]; rules: Rule[]; crawlDelay: number | null };
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of String(text ?? "").slice(0, MAX_ROBOTS_BYTES).split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      // the product token is the name before any version or comment ("OrbzReader/1.0" names orbzreader)
      current.agents.push(value.split(/[\s/]/)[0]!.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") {
      if (/^https?:\/\//i.test(value)) sitemaps.push(value);
      continue;
    }
    if (!current) continue; // a rule before any User-agent belongs to no one
    if (key === "allow" || key === "disallow") {
      if (!value) continue; // an empty Disallow forbids nothing; an empty Allow says nothing
      current.rules.push({ allow: key === "allow", pattern: normalizePath(value) });
    } else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelay = n;
    }
  }
  const t = token.toLowerCase();
  const ours = groups.filter((g) => g.agents.includes(t));
  const chosen = ours.length ? ours : groups.filter((g) => g.agents.includes("*"));
  const delays = chosen.map((g) => g.crawlDelay).filter((d): d is number => d !== null);
  return { rules: chosen.flatMap((g) => g.rules), crawlDelay: delays.length ? Math.max(...delays) : null, sitemaps };
}

/** Whether `pattern` matches `path` from its start (`*` any run, a final `$` the end). */
function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split("*");
  if (!path.startsWith(parts[0]!)) return false;
  let at = parts[0]!.length;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    if (i === parts.length - 1 && anchored) {
      // the last piece must end the path, and may start anywhere from here
      return path.length - part.length >= at && path.endsWith(part);
    }
    const found = path.indexOf(part, at);
    if (found < 0) return false;
    at = found + part.length;
  }
  return anchored ? at === path.length : true;
}

/** May an address with this path and query be read? The longest matching rule decides; Allow on a tie. */
export function allowed(robots: Robots, pathAndQuery: string): boolean {
  const path = normalizePath(pathAndQuery || "/");
  if (path === "/robots.txt") return true;
  let best: Rule | null = null;
  for (const r of robots.rules) {
    if (!matches(r.pattern, path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow && !best.allow)) best = r;
  }
  return best ? best.allow : true;
}

/** Everything may be read (a robots.txt that is not there: RFC 9309 2.3.1.3). */
export const ALLOW_ALL: Robots = { rules: [], crawlDelay: null, sitemaps: [] };
/** Nothing may be read (one that could not be reached: 2.3.1.4). */
export const DISALLOW_ALL: Robots = { rules: [{ allow: false, pattern: "/" }], crawlDelay: null, sitemaps: [] };
