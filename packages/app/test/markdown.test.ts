// An orb's words as it formats them (ui/markdown.ts; owner, 10-05: Ash's reply showed "**5 people**"):
//   - the reply from the owner's screenshot: bold where it was marked, a list, no asterisks left;
//   - what is not formatting stays as it is (controls): snake_case, 2 * 3 * 4, a lone mark, a mark
//     left open while a reply streams, and text that looks like HTML;
//   - links: only http and https, a bare address too; javascript: never;
//   - headings, numbered lists from their own number, quotes, code fences, an indent a level.
import assert from "node:assert/strict";
import { test } from "node:test";
import { blocks, plainOf, spans, type Block, type Span } from "../src/ui/markdown.ts";

const flat = (c: Span[]): string => c.map((s) => (s.t === "text" || s.t === "code" ? s.v : s.t === "br" ? "\n" : flat(s.c))).join("");
const marks = (c: Span[]): string[] => c.flatMap((s) => (s.t === "b" || s.t === "i" || s.t === "a" ? [`${s.t}:${flat(s.c)}`, ...marks(s.c)] : s.t === "code" ? [`code:${s.v}`] : []));

test("the reply from the screenshot: bold where marked, its list, no asterisks left", () => {
  const reply = "Absolutely—I can make a bolognese recipe for **5 people**. If you already have the recipe for 2, send it over and I'll scale it by **2½**; otherwise I'll suggest one from scratch.\n\nFor the reminders:\n- **Pick up the kids:** tomorrow at **5 pm**—is that right?\n- **Pay the electric bill:** the **16th of which month and year**? What's the amount, if you'd like it included?";
  const b = blocks(reply);
  assert.deepEqual(b.map((x) => x.t), ["p", "p", "list"]);
  assert.deepEqual(marks((b[0] as Extract<Block, { t: "p" }>).c), ["b:5 people", "b:2½"]);
  const list = b[2] as Extract<Block, { t: "list" }>;
  assert.equal(list.items.length, 2);
  assert.deepEqual(marks(list.items[0]!.c), ["b:Pick up the kids:", "b:5 pm"]);
  assert.ok(!plainOf(reply).includes("*"), "no asterisks in what is shown");
});

test("what is not formatting stays as it is", () => {
  assert.deepEqual(marks(spans("call read_calendar_events with my_var")), [], "snake_case is a name");
  assert.equal(flat(spans("2 * 3 * 4 = 24")), "2 * 3 * 4 = 24", "a sum");
  assert.equal(flat(spans("a lone * here")), "a lone * here");
  assert.equal(flat(spans("still **stream")), "still **stream", "a mark left open shows as it is");
  assert.equal(flat(spans("<b>not bold</b> <script>x</script>")), "<b>not bold</b> <script>x</script>", "HTML is text");
  assert.deepEqual(marks(spans("\\*not italic\\*")), [], "an escaped mark");
  // controls: the same marks, formatting, are read
  assert.deepEqual(marks(spans("a _word_ and *this* and __that__ and `x_y`")), ["i:word", "i:this", "b:that", "code:x_y"]);
});

test("links: http and https only, a bare address too; javascript: never", () => {
  const s = spans("see [the docs](https://example.com/a_b) or https://orbz.app/x, not [this](javascript:alert(1))");
  const links = s.filter((x): x is Extract<Span, { t: "a" }> => x.t === "a");
  assert.deepEqual(links.map((l) => l.href), ["https://example.com/a_b", "https://orbz.app/x"], "the comma is not part of the address");
  assert.ok(flat(s).includes("[this](javascript:alert(1))"), "left as text");
});

test("headings, numbered lists from their number, quotes, code fences, an indent a level", () => {
  const b = blocks("## Plan\n3. third\n4. fourth\n\n> a quote\n> goes on\n\n```js\nconst a = 1 * 2;\n```\n- top\n  - under\n---");
  assert.deepEqual(b.map((x) => x.t), ["h", "list", "quote", "pre", "list", "hr"]);
  assert.equal((b[0] as Extract<Block, { t: "h" }>).level, 2);
  assert.equal((b[1] as Extract<Block, { t: "list" }>).start, 3);
  assert.equal(flat((b[2] as Extract<Block, { t: "quote" }>).c), "a quote\ngoes on");
  assert.deepEqual(b[3], { t: "pre", v: "const a = 1 * 2;", lang: "js" });
  assert.deepEqual((b[4] as Extract<Block, { t: "list" }>).items.map((i) => i.depth), [0, 1]);
  // a fence still streaming: what has come so far, as code
  assert.deepEqual(blocks("```\nhalf"), [{ t: "pre", v: "half", lang: "" }]);
});
