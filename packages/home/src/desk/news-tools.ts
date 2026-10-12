// The news, as a tool (PLAN 5.43): the stories that could move a coin, newest first, each with the majors it names, what
// kind of news it is and how those coins moved since it came out. Outside words: a headline is an outlet's claim.
import type { ToolDef } from "../agent/tools.ts";
import { GROUPS } from "../agent/groups.ts";
import { moved, type News } from "./news.ts";
import { SYMBOLS } from "./strategy.ts";

const pct = (x: number): string => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
const at = (t: number): string => new Date(t).toISOString().slice(5, 16).replace("T", " ");

export function newsTools(o: { news: News; bars: (symbol: string) => Promise<readonly { t: number; o: number; c: number }[]> }): ToolDef[] {
  return [
    {
      name: "desk_news", group: GROUPS.desk, label: "Reading the news", untrusted: "feed",
      description: `The crypto press's latest (CoinDesk, Cointelegraph, Decrypt, The Block, CryptoSlate, Bitcoin Magazine; read at most every five minutes), newest first: each story's outlet, time (UTC), the majors it names, what kind of news it is (regulation, lawsuit, etf, hack, macro, listing, unlock, buyer, outage, liquidations) and how much that kind tends to move prices (0 to 4), and how each named coin moved since it came out. One coin (${SYMBOLS.slice(0, 6).join(", ")} …) or all; the last few hours or all. A headline is the outlet's claim: weigh it, check it against the chart, never act on it alone.`,
      parameters: { type: "object", properties: { coin: { type: "string", enum: [...SYMBOLS] }, hours: { type: "integer", minimum: 1, maximum: 72 } }, additionalProperties: false },
      describe: (a) => `read the news${a.coin ? ` on ${String(a.coin)}` : ""}`, decision: "allow",
      async run(a) {
        const { items, sources } = await o.news.read({ coin: typeof a.coin === "string" ? a.coin : null, hours: typeof a.hours === "number" ? a.hours : undefined, max: 25 });
        const down = sources.filter((s) => !s.ok).map((s) => s.name);
        if (!items.length) return { content: `No story${a.coin ? ` naming ${String(a.coin)}` : ""}${a.hours ? ` in the last ${String(a.hours)} hours` : ""}.${down.length ? ` Not read just now: ${down.join(", ")}.` : ""}` };
        const lines = (await moved(items, o.bars)).map((x) => {
          const moves = Object.entries(x.moves).filter((e): e is [string, number] => e[1] !== null).map(([c, m]) => `${c} ${pct(m)} since`);
          return `- ${at(x.at)} UTC, ${x.source}${x.coins.length ? ` [${x.coins.join(", ")}]` : ""}${x.kinds.length ? ` (${x.kinds.join(", ")}; weight ${x.weight})` : ""}: ${x.title}${moves.length ? ` (${moves.join("; ")})` : ""}`;
        });
        return { content: `News that could move prices, newest first (the outlets' claims, not facts):\n${lines.join("\n")}${down.length ? `\nNot read just now: ${down.join(", ")}.` : ""}` };
      },
    },
  ];
}
