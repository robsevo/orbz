// An orb's words as it formats them (owner, 10-05: Ash's reply showed "**5 people**", asterisks and all).
// Models write Markdown; this reads the part of it a chat needs into blocks and spans, by code, and
// ui/Rich.tsx draws them as elements (never as HTML: nothing an orb writes can become markup). Pure, so a
// test can import it (node --test cannot import .tsx).
//
// Blocks: paragraphs (a single newline is a line break), headings, bullet and numbered lists (an indent
// is a level), quotes, code fences, a rule. Spans: **bold**, *italic* and _italic_ (an underscore only at
// a word's edge, so snake_case stays as it is), `code`, [links](https://…), and a bare https address.
// Only http and https make a link. A mark left open (a reply still streaming) shows as it is.

export type Span =
  | { t: "text"; v: string }
  | { t: "b"; c: Span[] }
  | { t: "i"; c: Span[] }
  | { t: "code"; v: string }
  | { t: "a"; href: string; c: Span[] }
  | { t: "br" };

export type Block =
  | { t: "p"; c: Span[] }
  | { t: "h"; level: number; c: Span[] }
  | { t: "list"; ordered: boolean; start: number; items: { depth: number; c: Span[] }[] }
  | { t: "quote"; c: Span[] }
  | { t: "pre"; v: string; lang: string }
  | { t: "hr" };

const BULLET = /^(\s*)[-*+•]\s+(.*)$/;
const NUMBER = /^(\s*)(\d{1,4})[.)]\s+(.*)$/;
const FENCE = /^\s*(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

/** The blocks of `src`. */
export function blocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const endPara = (): void => {
    if (para.length) out.push({ t: "p", c: spans(para.join("\n")) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE.exec(line);
    if (fence) {
      endPara();
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !(FENCE.exec(lines[j]!)?.[1] === fence[1])) body.push(lines[j++]!);
      out.push({ t: "pre", v: body.join("\n"), lang: fence[2] ?? "" });
      i = j; // past the closing fence (or the end, while it streams)
      continue;
    }
    if (!line.trim()) {
      endPara();
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      endPara();
      out.push({ t: "h", level: h[1]!.length, c: spans(h[2]!) });
      continue;
    }
    if (RULE.test(line)) {
      endPara();
      out.push({ t: "hr" });
      continue;
    }
    const b = BULLET.exec(line);
    const n = b ? null : NUMBER.exec(line);
    if (b || n) {
      endPara();
      const ordered = Boolean(n);
      const depth = Math.floor((b ? b[1]! : n![1]!).replace(/\t/g, "  ").length / 2);
      const text = b ? b[2]! : n![3]!;
      const last = out[out.length - 1];
      if (last?.t === "list" && last.ordered === ordered) last.items.push({ depth, c: spans(text) });
      else out.push({ t: "list", ordered, start: n ? Number(n[2]) : 1, items: [{ depth, c: spans(text) }] });
      continue;
    }
    const q = QUOTE.exec(line);
    if (q) {
      endPara();
      const last = out[out.length - 1];
      if (last?.t === "quote") last.c.push({ t: "br" }, ...spans(q[1]!));
      else out.push({ t: "quote", c: spans(q[1]!) });
      continue;
    }
    // a line under a list item, indented: more of that item
    const last = out[out.length - 1];
    if (!para.length && last?.t === "list" && /^\s{2,}\S/.test(line)) {
      last.items[last.items.length - 1]!.c.push({ t: "text", v: " " }, ...spans(line.trim()));
      continue;
    }
    para.push(line);
  }
  endPara();
  return out;
}

const URL = /^https?:\/\/[^\s<>()]+[^\s<>().,:;!?"'\]]/;

/** The spans of one block's text. */
export function spans(src: string): Span[] {
  const out: Span[] = [];
  let text = "";
  const flush = (): void => {
    if (text) out.push({ t: "text", v: text });
    text = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const rest = src.slice(i);
    if (ch === "\n") {
      flush();
      out.push({ t: "br" });
      i++;
      continue;
    }
    if (ch === "\\" && /[\\`*_[\]()#>-]/.test(src[i + 1] ?? "")) {
      text += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (rest.startsWith("**") || rest.startsWith("__")) {
      const mark = rest.slice(0, 2);
      const end = src.indexOf(mark, i + 2);
      if (end > i + 2 && !/\s/.test(src[i + 2]!) && !/\s/.test(src[end - 1]!) && (mark === "**" || edge(src, i, end + 2))) {
        flush();
        out.push({ t: "b", c: spans(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && src[i + 1] !== ch) {
      const end = closing(src, i + 1, ch);
      if (end > i + 1 && !/\s/.test(src[i + 1]!) && !/\s/.test(src[end - 1]!) && (ch === "*" || edge(src, i, end + 1))) {
        flush();
        out.push({ t: "i", c: spans(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const m = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/.exec(rest);
      if (m) {
        flush();
        out.push({ t: "a", href: m[2]!, c: spans(m[1]!) });
        i += m[0].length;
        continue;
      }
    }
    if ((ch === "h" || ch === "H") && (i === 0 || /[\s(]/.test(src[i - 1]!))) {
      const m = URL.exec(rest);
      if (m) {
        flush();
        out.push({ t: "a", href: m[0], c: [{ t: "text", v: m[0] }] });
        i += m[0].length;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

/** The next single `ch` from `from` that is not part of a double one. */
function closing(src: string, from: number, ch: string): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] === "\n") return -1;
    if (src[j] === ch) {
      if (src[j + 1] === ch) {
        j++;
        continue;
      }
      return j;
    }
  }
  return -1;
}

/** An underscore mark sits at a word's edge on both sides (so a_b_c is a name, not italics). */
const edge = (src: string, open: number, after: number): boolean => !/\w/.test(src[open - 1] ?? "") && !/\w/.test(src[after] ?? "");

/** The words alone, the marks gone: for a preview line, a notification, a speech bubble. */
export function plainOf(src: string): string {
  const flat = (c: Span[]): string => c.map((s) => (s.t === "text" || s.t === "code" ? s.v : s.t === "br" ? " " : flat(s.c))).join("");
  return blocks(src)
    .map((b) => (b.t === "p" || b.t === "h" || b.t === "quote" ? flat(b.c) : b.t === "list" ? b.items.map((x) => flat(x.c)).join("; ") : b.t === "pre" ? b.v : ""))
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
