// An orb's words, formatted (ui/markdown.ts reads them): bold, italics, code, lists, headings, quotes,
// links, as elements of the page's own type and colours. Never HTML from the text: a reply cannot become
// markup, and a link opens only an http or https address, in a new tab, with nothing passed along.
import type { CSSProperties, ReactNode } from "react";
import { SideScroll } from "./Balanced.tsx";
import { blocks, type Block, type Span } from "./markdown.ts";

const code: CSSProperties = { font: "500 .92em/1.4 var(--mono)", padding: "1px 5px", borderRadius: 5, background: "var(--fill-2)", overflowWrap: "anywhere" };

function inline(c: Span[], key = ""): ReactNode[] {
  return c.map((s, i) => {
    const k = `${key}${i}`;
    switch (s.t) {
      case "text":
        return s.v;
      case "br":
        return <br key={k} />;
      case "b":
        return <strong key={k} style={{ fontWeight: 700, color: "var(--text-1)" }}>{inline(s.c, k)}</strong>;
      case "i":
        return <em key={k}>{inline(s.c, k)}</em>;
      case "code":
        return <code key={k} style={code}>{s.v}</code>;
      case "a":
        return (
          <a key={k} href={s.href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "underline", textUnderlineOffset: 2, overflowWrap: "anywhere" }}>
            {inline(s.c, k)}
          </a>
        );
    }
  });
}

function block(b: Block, i: number): ReactNode {
  switch (b.t) {
    case "p":
      return <p key={i} style={{ margin: 0 }}>{inline(b.c)}</p>;
    case "h":
      return <p key={i} role="heading" aria-level={Math.min(6, b.level + 2)} style={{ margin: 0, font: `${b.level <= 2 ? 800 : 700} ${b.level <= 1 ? 17 : 16}px/22px var(--font)`, color: "var(--text-1)" }}>{inline(b.c)}</p>;
    case "list": {
      const Tag = b.ordered ? "ol" : "ul";
      return (
        <Tag key={i} start={b.ordered ? b.start : undefined} style={{ margin: 0, paddingLeft: 22, display: "grid", gap: 3 }}>
          {b.items.map((it, j) => (
            <li key={j} style={{ marginLeft: it.depth * 18, paddingLeft: 2 }}>{inline(it.c, `${i}.${j}.`)}</li>
          ))}
        </Tag>
      );
    }
    case "quote":
      return <blockquote key={i} style={{ margin: 0, paddingLeft: 12, boxShadow: "inset 3px 0 0 var(--hairline)", color: "var(--text-2)" }}>{inline(b.c)}</blockquote>;
    case "pre":
      return (
        // a long line scrolls sideways, with arrows (owner, 10-07)
        <SideScroll as="pre" bare key={i} data-lang={b.lang || undefined} style={{ margin: 0, padding: "10px 12px", borderRadius: 10, background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", font: "500 13px/19px var(--mono)", color: "var(--text-1)", whiteSpace: "pre", overflowX: "auto", maxWidth: "100%" }}>
          {b.v}
        </SideScroll>
      );
    case "hr":
      return <hr key={i} style={{ width: "100%", height: 1, border: 0, margin: "2px 0", background: "var(--hairline)" }} />;
  }
}

/** `text` as formatted words: blocks a little apart, in the bubble's own type. */
export function Rich({ text }: { text: string }) {
  return <div data-rich style={{ display: "grid", gap: 8, whiteSpace: "normal", minWidth: 0 }}>{blocks(text).map(block)}</div>;
}
