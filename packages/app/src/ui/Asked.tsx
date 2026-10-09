// What an orb asks your OK for, in words you can read before you answer (owner, 10-08: a request's Python
// ran together in one paragraph on its notice): the command between the card's backticks is shown as code,
// on its own lines when it has them, a long one scrolling in its own box; a short one stays in the sentence.
// A card in a conversation and its notice say it the same way.
import type { CSSProperties } from "react";

const code: CSSProperties = { font: "500 12px/17px var(--mono)", color: "var(--text-1)", background: "var(--fill)", borderRadius: 8, overflowWrap: "anywhere" };

/** A card's title ("Milfred wants to run `…` in its workspace"), its command as code. */
export function Asked({ title, style }: { title: string; style?: CSSProperties }) {
  const a = title.indexOf("`");
  const b = title.lastIndexOf("`");
  if (a < 0 || b <= a) return <span style={style}>{title}</span>;
  const command = title.slice(a + 1, b);
  if (!command.includes("\n") && command.length <= 60) {
    return (
      <span style={style}>
        {title.slice(0, a)}
        <code style={{ ...code, padding: "1px 5px" }}>{command}</code>
        {title.slice(b + 1)}
      </span>
    );
  }
  const before = title.slice(0, a).trim();
  const after = title.slice(b + 1).trim();
  return (
    <span style={{ ...style, display: "grid", gap: 6, minWidth: 0 }}>
      {before && <span>{before}</span>}
      <code data-command style={{ ...code, display: "block", whiteSpace: "pre-wrap", padding: "8px 10px", maxHeight: 240, overflowY: "auto", overscrollBehavior: "contain" }}>
        {command}
      </code>
      {after && <span>{after}</span>}
    </span>
  );
}
