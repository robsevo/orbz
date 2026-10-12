// The news screen (PLAN 5.43; owner, 10-12: "a news section too that we can click on that could affect crypto prices.
// like the chart, click and news modal comes up"): the research corner's TV pressed, over the floor, as the war room's
// screen is: the crypto press's latest, newest first, each story with its outlet and time, the majors it names and how
// each moved since it came out (pressed, that coin's chart on the war room's screen), what kind of news it is, and a mark
// on what has tended to move prices; filters for what could move it, a coin or a kind; read again every minute while
// open (the home asks the feeds at most every five). Headlines are the outlets' words, opened on their own sites.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { NewsFeed, NewsStory, Office } from "../home/link.ts";
import { OneLine } from "../ui/Balanced.tsx";
import { useCramped } from "../ui/fill.ts";
import { ago, button, chip, head, small } from "./kit.ts";
import { facets, filtered, KIND_WORDS, MOVING, moveWords, type NewsFilter } from "./news.ts";

export function NewsDesk({ home, close, openMajor }: { home: Office; close: () => void; openMajor: (symbol: string) => void }) {
  const phone = useCramped("(max-width: 760px)");
  const [news, setNews] = useState<{ items: NewsStory[]; sources: NewsFeed[]; at: number } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [f, setF] = useState<NewsFilter>({ kind: "all" });
  useEffect(() => {
    const load = (): void => void home.deskNews().then((n) => (setNews(n), setSaid(null)), (e: Error) => setSaid(e.message));
    load();
    const every = window.setInterval(load, 60_000);
    const esc = (e: KeyboardEvent): void => void (e.key === "Escape" && close());
    window.addEventListener("keydown", esc);
    return () => {
      window.clearInterval(every);
      window.removeEventListener("keydown", esc);
    };
  }, [home]);
  const items = news?.items ?? [];
  const shown = useMemo(() => filtered(items, f), [items, f]);
  const fs = useMemo(() => facets(items), [items]);
  const on = (g: NewsFilter): boolean => JSON.stringify(g) === JSON.stringify(f);
  const down = news?.sources.filter((s) => !s.ok) ?? [];
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="The news" data-news-desk style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: phone ? "stretch" : "center", padding: phone ? 0 : "var(--s4)" }}>
      <div aria-hidden onClick={close} style={{ position: "absolute", inset: 0, background: "var(--ground)", opacity: 0.86, backdropFilter: "blur(6px)" }} />
      <section style={{ position: "relative", display: "grid", gridTemplateRows: "auto auto minmax(0, 1fr) auto", width: phone ? "100%" : "min(900px, 100%)", height: phone ? "100dvh" : "min(900px, 100%)", borderRadius: phone ? 0 : 22, background: "var(--card)", boxShadow: "0 24px 70px var(--shadow), inset 0 0 0 1px var(--hairline)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: phone ? "12px 12px 8px" : "16px 18px 10px", minWidth: 0 }}>
          <span aria-hidden data-orb="coral" style={{ width: 10, height: 10, borderRadius: 99, background: "var(--accent)", boxShadow: "0 0 10px var(--accent)", flex: "0 0 auto" }} />
          <span style={{ display: "grid", minWidth: 0, flex: "1 1 auto" }}>
            <span style={{ font: "800 18px/24px var(--font)", color: "var(--text-1)" }}>The news</span>
            <span style={small}>What could move a coin, newest first.</span>
          </span>
          <button type="button" data-news-close onClick={close} aria-label="Close the news" style={{ ...button, flex: "0 0 auto", padding: "8px 14px" }}>✕</button>
        </div>
        <div style={{ padding: phone ? "0 12px 10px" : "0 18px 12px", borderBottom: "1px solid var(--sep)", minWidth: 0 }}>
          <OneLine gap={6}>
            <button type="button" data-news-filter="all" aria-pressed={on({ kind: "all" })} onClick={() => setF({ kind: "all" })} style={chip(on({ kind: "all" }))}>All</button>
            <button type="button" data-news-filter="moving" aria-pressed={on({ kind: "moving" })} onClick={() => setF({ kind: "moving" })} style={chip(on({ kind: "moving" }))}>Could move it</button>
            {fs.coins.slice(0, 8).map(([c, n]) => (
              <button key={c} type="button" data-news-filter={`coin:${c}`} aria-pressed={on({ kind: "coin", coin: c })} onClick={() => setF({ kind: "coin", coin: c })} style={chip(on({ kind: "coin", coin: c }))}>{`${c} ${n}`}</button>
            ))}
            {fs.kinds.map(([k, n]) => (
              <button key={k} type="button" data-news-filter={`type:${k}`} aria-pressed={on({ kind: "type", type: k })} onClick={() => setF({ kind: "type", type: k })} style={chip(on({ kind: "type", type: k }))}>{`${KIND_WORDS[k] ?? k} ${n}`}</button>
            ))}
          </OneLine>
        </div>
        <div data-news-body style={{ overflowY: "auto", overscrollBehavior: "contain", padding: phone ? "4px 12px 20px" : "6px 18px 20px", minWidth: 0 }}>
          {!news ? (
            <span role="status" style={{ ...small, display: "block", padding: "18px 0" }}>{said ?? "Reading the press…"}</span>
          ) : !shown.length ? (
            <span style={{ ...small, display: "block", padding: "18px 0" }}>{items.length ? "No story for this filter just now." : "No story could be read just now."}</span>
          ) : (
            shown.map((x) => <Story key={x.id} x={x} now={news.at} openMajor={openMajor} />)
          )}
        </div>
        <span data-news-sources style={{ ...small, padding: phone ? "8px 12px 12px" : "10px 18px 14px", borderTop: "1px solid var(--sep)" }}>
          {news ? `From ${news.sources.map((s) => s.name).join(", ")}; read at most every five minutes.${down.length ? ` Not read just now: ${down.map((s) => s.name).join(", ")}.` : ""}` : " "}
        </span>
      </section>
    </div>,
    document.body,
  );
}

/** One story: its outlet and time, its headline (its own site, a new tab), a line of it, its kinds, and each coin it
 * names with how that coin moved since (pressed: its chart). A story of a kind that has moved prices is marked. */
function Story({ x, now, openMajor }: { x: NewsStory; now: number; openMajor: (symbol: string) => void }) {
  const moving = x.weight >= MOVING;
  return (
    <article data-story={x.id} data-moving={moving ? "true" : "false"} style={{ display: "grid", gap: 6, padding: "14px 0 14px 14px", borderBottom: "1px solid var(--sep)", boxShadow: moving ? "inset 3px 0 0 var(--accent)" : "inset 3px 0 0 var(--hairline)", minWidth: 0 }} data-orb={moving ? "coral" : undefined}>
      <span style={{ ...head, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <span>{x.source}</span>
        <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>{ago(x.at, now)}</span>
        {moving && <span style={{ color: "var(--accent)" }}>Could move it</span>}
      </span>
      <a href={x.url} target="_blank" rel="noreferrer noopener" style={{ font: "700 16px/22px var(--font)", color: "var(--text-1)", textDecoration: "none", overflowWrap: "anywhere" }}>{x.title}</a>
      {x.summary && <span style={{ ...small, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{x.summary}</span>}
      {(x.coins.length > 0 || x.kinds.length > 0) && (
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {x.coins.map((c) => {
            const m = x.moves[c];
            return (
              <button key={c} type="button" className="orbs-small" data-story-coin={c} onClick={() => openMajor(c)} aria-label={`${c}'s chart`} style={{ ...chip(false), minHeight: 28, padding: "3px 10px", display: "inline-flex", gap: 6 }}>
                <span>{c}</span>
                {m !== null && m !== undefined && <span style={{ color: m >= 0 ? "var(--ok)" : "var(--off)" }}>{`${moveWords(m)} since`}</span>}
              </button>
            );
          })}
          {x.kinds.map((k) => <span key={k} style={{ ...small, color: "var(--text-2)" }}>{`· ${KIND_WORDS[k] ?? k}`}</span>)}
        </span>
      )}
    </article>
  );
}
