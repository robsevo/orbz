// The reading library's tools (PLAN 3.12), and web_search's word on it. The library and web search
// help each other, neither replaces the other (owner, 10-06): the library is what the office already
// read, free and dated; the search is what is live and new; a result worth keeping up with is followed.
//
//   follow_source    follow a site (its folder): read at once, then each night (or each week)
//   search_reading   the pages read that match, each dated, with a snippet (outside text: fenced)
//   read_reading     a page as it was last read, focused on what is wanted (outside text: fenced)
//   list_reading     what the office follows, by whom and why, and how each read went
//   unfollow_source  stop following one; its pages leave the library
import type { ToolDef, ToolResult } from "../agent/tools.ts";
import { focus } from "../agent/web.ts";
import { PAGES_PER_READ, type Reading, ReadingError } from "./reading.ts";

const obj = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({ type: "object", properties, required, additionalProperties: false });
const s = (v: unknown): string => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const day = (t: number | null): string => (t ? new Date(t).toISOString().slice(0, 10) : "never");
const STOPPED: ToolResult = { content: "Stopped by the user.", isError: true, stoppedByUser: true };

export function readingTools(reading: Reading, nameOf: (orb: string) => string): ToolDef[] {
  return [
    {
      name: "follow_source",
      label: "Following a source",
      description:
        "Follow a site worth keeping up with (official docs, a changelog, a blog, a project's news): the home reads it now and then again each night, politely (it obeys the site's robots.txt and reads a page every few seconds), and keeps the pages in your office's reading library for search_reading. It reads the folder of the address you give and the pages under it, two links deep. Follow what you will need again; for a page you need once, web_fetch it.",
      parameters: obj(
        {
          url: { type: "string", description: "The address to follow: its folder is what is read (https://docs.example.com/guide/ reads the guide)." },
          why: { type: "string", description: "In one line, why it is worth keeping up with: the person sees it." },
          every: { type: "string", enum: ["day", "week"], description: "How often it is read again; each day unless it changes slowly." },
        },
        ["url", "why"],
      ),
      describe: (a) => `follow ${s(a.url)} (read each ${s(a.every) === "week" ? "week" : "night"})`,
      decision: "allow",
      precheck: (a) => (/^https?:\/\//i.test(s(a.url)) ? null : "Only an http or https address can be followed."),
      async run(a, ctx) {
        if (ctx.signal?.aborted) return STOPPED;
        try {
          const { source, already } = await reading.follow(ctx.orb, s(a.url), s(a.why), s(a.every) === "week" ? 7 : 1);
          if (already) return { content: `${source.url} is followed already (source #${source.id}, by ${nameOf(source.orb)}, ${source.pages} pages read so far). search_reading finds what it read.` };
          return {
            content: `Following ${source.url} (source #${source.id}): the site ${source.host}, under ${source.prefix}. The first read has started: at most ${PAGES_PER_READ} pages, a few seconds apart, so it takes some minutes; then search_reading finds them. It is read again each ${source.everyDays === 7 ? "week" : "night"}, and the person sees it in the Lab.`,
          };
        } catch (e) {
          if (e instanceof ReadingError) return { content: `Not followed: ${e.message}`, isError: true };
          throw e;
        }
      },
    },
    {
      name: "search_reading",
      label: "Searching the reading library",
      description:
        "Search the pages your office already read from the sources it follows: free and instant, each result dated (when it was read, when it last changed) with a snippet. It knows only what was read; for anything newer or not followed, use web_search. Read a whole page with read_reading.",
      parameters: obj(
        {
          query: { type: "string", description: "The words to look for." },
          source: { type: "number", description: "Only this source's pages (its number from list_reading)." },
        },
        ["query"],
      ),
      describe: (a) => `search the reading library for "${s(a.query)}"`,
      decision: "allow",
      untrusted: "page",
      async run(a) {
        const query = s(a.query).trim();
        if (query.length < 2) return { content: "search_reading needs a query of at least 2 characters.", isError: true };
        const hits = reading.search(query, { limit: 8, ...(typeof a.source === "number" && { source: a.source }) });
        if (!hits.length) {
          return { content: `Nothing in the reading library matches "${query}". Search the live web with web_search; a site that turns out worth keeping up with can be followed with follow_source.` };
        }
        const lines = hits.map((h, i) => {
          const changed = h.changedAt !== h.readAt ? `, last changed ${day(h.changedAt)}` : "";
          return `${i + 1}. ${h.title || "(untitled)"}\n   ${h.url}\n   read ${day(h.readAt)}${changed} · ${h.host} (source #${h.source})\n   ${h.snippet.replace(/\s+/g, " ").trim()}`;
        });
        return { content: `${hits.length} page(s) in the reading library for "${query}":\n\n${lines.join("\n\n")}\n\nThese are pages as they were when read (dates above). read_reading gives a whole page; for anything newer than that, or not here, web_search.` };
      },
    },
    {
      name: "read_reading",
      label: "Reading from the library",
      description: "A page from the reading library, as it was last read (no request to the site): its text, focused on `prompt` when long. For the page as it is right now, web_fetch it.",
      parameters: obj({ url: { type: "string" }, prompt: { type: "string", description: "What you want from the page." } }, ["url"]),
      describe: (a) => `read ${s(a.url)} from the reading library`,
      decision: "allow",
      untrusted: "page",
      async run(a) {
        const p = reading.page(s(a.url));
        if (!p) return { content: `The reading library does not have ${s(a.url)}. web_fetch reads it from the web.`, isError: true };
        const { text, trimmed } = focus(p.text, s(a.prompt) || undefined);
        const head = [
          p.url,
          `Read ${day(p.readAt)}${p.changedAt !== p.readAt ? `, last changed ${day(p.changedAt)}` : ""} · ${p.host} (source #${p.source})`,
          p.title ? `Title: ${p.title}` : "",
          trimmed ? "NOTE: the page was longer than the limit; the sections most relevant to your prompt were kept, in the page's order." : "",
        ].filter(Boolean).join("\n");
        return { content: `${head}\n\n${text || "(no readable text was kept)"}` };
      },
    },
    {
      name: "list_reading",
      label: "Looking at the reading library",
      description: "What your office follows: each source's number, its site and folder, who follows it and why, its pages, and how its last read went.",
      parameters: obj({}, []),
      describe: () => "list the reading library",
      decision: "allow",
      async run() {
        const all = reading.sources();
        if (!all.length) return { content: "The office follows no sources yet. follow_source a site worth keeping up with." };
        // the sites' own words (titles) stay out: this list is the office's own
        const lines = all.map((x) => `#${x.id} ${x.host}${x.prefix} · followed by ${nameOf(x.orb)}${x.why ? ` (${x.why})` : ""} · ${x.pages} pages · read ${day(x.lastReadAt)}, next ${day(x.nextAt)}${x.lastError ? ` · last read: ${x.lastError}` : ""}`);
        return { content: lines.join("\n") };
      },
    },
    {
      name: "unfollow_source",
      label: "Unfollowing a source",
      description: "Stop following a source (its number from list_reading); its pages leave the reading library.",
      parameters: obj({ source: { type: "number" } }, ["source"]),
      describe: (a) => `stop following source #${s(a.source)}`,
      decision: "allow",
      async run(a, ctx) {
        try {
          reading.unfollow(Number(a.source), ctx.orb);
          return { content: `Source #${s(a.source)} is no longer followed, and its pages left the library.` };
        } catch (e) {
          if (e instanceof ReadingError) return { content: e.message, isError: true };
          throw e;
        }
      },
    },
  ];
}

/** web_search, with the library's word on the same question after its results (they help each other). */
export function withReading(tool: ToolDef, reading: Reading): ToolDef {
  const run = tool.run;
  if (tool.name !== "web_search" || !run) return tool;
  return {
    ...tool,
    async run(a, ctx) {
      const out = await run(a, ctx);
      if (out.stoppedByUser) return out;
      const hint = reading.hint(s(a.query));
      return hint ? { ...out, content: `${out.content}\n\n${hint}` } : out;
    },
  };
}
