// The `orbs` terminal's conversation (PLAN 1.9): Ink, ported from Ash's Ink UI in its codex look:
// `›` for what you said, `•` for the orb's own words and for what it did, `└` under a tool's
// result, the terminal's own foreground for prose. Written with createElement rather than JSX, so
// Node runs it as it is, without a build.
//
// Everything on screen comes from the home: the conversation's rows, its open card, and the live
// stream (each event as it is committed, and a reply's words as they arrive). The terminal holds
// nothing of its own but what you are typing.
//
// The Ink freeze lesson (Ash, 2026-09-08): stopping a reply by throwing away the streamed words
// took the live region from many rows to none in one frame, Ink's idea of the screen stopped
// matching the terminal, and it never painted again. So a reply's words are never dropped: when
// the home commits them they move to the scrollback in the same frame they leave the live region,
// and words that are never committed (a stop the home did not record) are committed here.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput, useWindowSize } from "ink";
import type { Card, HomeClient, HomeEvent, Message, Orb, TextDelta } from "./client.ts";

const h = React.createElement;

const ACCENT = "#63A8F8"; // codex's UI accent on a dark ground
const DIM = "#79797B";
const BAND = "#323234";
const WARN = "#C4A767";
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const HISTORY = 40; // rows of an old conversation shown at the start
const KIT_STATES: Record<string, string> = { "kit.started": "up", "kit.died": "restarting", "kit.restarting": "restarting", "kit.gave_up": "gave up", "kit.start_failed": "down" };

export type Item =
  | { key: string; kind: "user"; text: string }
  | { key: string; kind: "speech"; text: string; stopped?: boolean }
  | { key: string; kind: "tool"; verb: string; what: string }
  | { key: string; kind: "result"; text: string; error: boolean }
  | { key: string; kind: "asked"; text: string; status: string }
  | { key: string; kind: "notice"; text: string; warn: boolean }
  | { key: string; kind: "rule"; text: string };

// what a tool call is called on screen: when it is done, while it runs, and what it acted on
const VERBS: Record<string, (a: Record<string, unknown>) => [string, string, string]> = {
  shell: (a) => ["Ran", "Running", String(a.command ?? "")],
  shell_output: (a) => ["Read", "Reading", `the output of ${String(a.id ?? "a background job")}`],
  stop_shell: (a) => ["Stopped", "Stopping", String(a.id ?? "a background job")],
  read_file: (a) => ["Read", "Reading", String(a.path ?? "")],
  write_file: (a) => ["Wrote", "Writing", String(a.path ?? "")],
  list_files: (a) => ["Listed", "Listing", !a.path || a.path === "." ? "the workspace" : String(a.path)],
  web_fetch: (a) => ["Fetched", "Fetching", String(a.url ?? "")],
  ask_owner: () => ["Asked", "Asking", "you"],
  propose_plan: () => ["Proposed", "Proposing", "a plan"],
  start_row: (a) => ["Started", "Starting", `row ${String(a.row ?? "")}`],
  check_row: (a) => ["Tested", "Testing", `row ${String(a.row ?? "")}`],
};

/** How a card was answered, as its record in the conversation says it. */
export const ANSWERED: Record<string, string> = {
  approved: "you approved",
  denied: "you said no",
  answered: "you answered",
  expired: "it expired unanswered",
  changed: "you asked for changes",
  saved: "you saved it for later",
};

const oneLine = (s: string, max = 160): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * The conversation's rows as the screen shows them. A tool call is drawn when its result comes
 * back, so its row stands after the card that asked for it, not before: "Ran" is not said of a
 * command still waiting for you. A card's record is held until the card is answered, and then
 * says how. Rows reach the scrollback once, in order, and are never redrawn.
 */
export class Transcript {
  readonly #calls = new Map<string, [string, string, string]>();
  readonly #held = new Map<number, Message>();
  /** The call that has no result yet, as the activity line says it: ["Running", "sleep 30"]. */
  running: [string, string] | null = null;

  items(m: Message, cards: Record<string, string> = {}): Item[] {
    const k = `m${m.id}`;
    switch (m.role) {
      case "user":
        return [{ key: k, kind: "user", text: m.content }];
      case "assistant": {
        for (const c of m.toolCalls ?? []) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(c.arguments || "{}") as Record<string, unknown>;
          } catch {
            // shown by name
          }
          const said = VERBS[c.name]?.(args) ?? [c.name, c.name, oneLine(c.arguments, 80)];
          this.#calls.set(c.id, said);
          this.running = [said[1], oneLine(said[2], 80)];
        }
        return m.content.trim() ? [{ key: k, kind: "speech", text: m.content, ...(m.meta.stopped === true && { stopped: true }) }] : [];
      }
      case "tool": {
        const [verb, , what] = this.#calls.get(m.toolCallId ?? "") ?? [String(m.meta.tool ?? "tool"), "", ""];
        this.running = null;
        const row: Item = { key: `${k}t`, kind: "tool", verb, what: oneLine(what) };
        if (m.meta.stopped === true) return [row, { key: k, kind: "result", text: "(stopped)", error: false }];
        const lines = m.content.trimEnd().split("\n");
        const shown = lines.slice(0, 3).map((l) => oneLine(l, 140)).join("\n");
        const more = lines.length > 3 ? `\n… ${lines.length - 3} more lines` : "";
        return [row, { key: k, kind: "result", text: `${shown}${more}` || "(no output)", error: m.meta.error === true }];
      }
      case "notice": {
        const card = typeof m.meta.card === "number" ? m.meta.card : null;
        if (card !== null) {
          const status = cards[String(card)];
          if (!status || status === "pending") {
            this.#held.set(card, m);
            return [];
          }
          return [{ key: k, kind: "asked", text: m.content, status }];
        }
        return [{ key: k, kind: "notice", text: m.content, warn: Boolean(m.meta.stopped) || /^(error|no brain|stopped)/i.test(m.content) }];
      }
      case "summary":
        return [{ key: k, kind: "rule", text: "earlier messages were summarised to make room" }];
      case "clear":
        return [{ key: k, kind: "rule", text: "the conversation was cleared" }];
    }
  }

  /** A card was answered: its held record, saying how. */
  answered(card: number, status: string): Item[] {
    const m = this.#held.get(card);
    if (!m) return [];
    this.#held.delete(card);
    return [{ key: `m${m.id}`, kind: "asked", text: m.content, status }];
  }
}

// A row with a mark and its text hanging under itself, as wide as the terminal. The text's box is
// sized by flexBasis 0 inside a row of the terminal's width: with flexShrink alone Yoga sizes it from
// the text's natural width and Ink writes one column past the terminal, which wraps a word through
// the middle (measured at 100 columns: a 101-column line); and inside <Static> a row is only as wide
// as its content unless it is told the width.
function Row({ item }: { item: Item }): React.ReactElement {
  const { columns } = useWindowSize();
  const hang = (mark: React.ReactElement, body: React.ReactElement, top = 1): React.ReactElement =>
    h(Box, { marginTop: top, width: Math.max(20, columns) }, mark, h(Box, { flexGrow: 1, flexShrink: 1, flexBasis: 0 }, body));
  switch (item.kind) {
    case "user":
      return h(Box, { marginTop: 1 }, h(Text, { backgroundColor: BAND }, `› ${item.text} `));
    case "speech":
      return hang(h(Text, null, "• "), h(Text, null, item.text));
    case "tool":
      return hang(h(Text, null, "• "), h(Text, null, h(Text, { bold: true }, item.verb), ` ${item.what}`));
    case "result":
      return hang(h(Text, { color: DIM }, "  └ "), h(Text, { color: item.error ? "red" : DIM }, item.text), 0);
    case "asked": {
      // one text, so a long record wraps as a sentence, under itself
      const tone = item.status === "approved" || item.status === "answered" ? ACCENT : item.status === "denied" ? WARN : DIM;
      return hang(h(Text, { color: DIM }, "  ? "), h(Text, { color: DIM }, `${item.text} · `, h(Text, { color: tone }, ANSWERED[item.status] ?? item.status)));
    }
    case "notice":
      return h(Box, { marginTop: 1 }, h(Text, { color: item.warn ? WARN : DIM }, `  ${item.text}`));
    case "rule":
      return h(Box, { marginTop: 1 }, h(Text, { color: DIM }, `── ${item.text} ──`));
  }
}

/** The keys a card answers to: [key, label, choice]. Questions are typed, so they have none. */
export function cardKeys(card: Card): [string, string, "approve" | "deny" | "always" | "change" | "save"][] {
  if (card.kind === "plan") return [["a", "approve", "approve"], ["c", "change…", "change"], ["s", "save for later", "save"], ["d", "decline", "deny"]];
  if (card.kind === "question") return [];
  const keys: [string, string, "approve" | "deny" | "always"][] = [["a", "approve", "approve"], ["d", "deny", "deny"]];
  if (card.meta.mayAlways === true) keys.push(["y", "always allow this", "always"]);
  return keys;
}

/** What a card shows under its title. An approval's arguments, one per line, leaving out any the
 * title already says (the command it names); other cards show their text as it is. */
export function cardBody(card: Card): string {
  let body = card.detail;
  if (card.kind === "approval") {
    try {
      const args = JSON.parse(card.detail) as Record<string, unknown>;
      body = Object.entries(args)
        .map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)] as const)
        .filter(([, v]) => v.trim() && !card.title.includes(v))
        .map(([k, v]) => (v.includes("\n") ? `${k}:\n${v.replace(/^/gm, "  ")}` : `${k}: ${v}`))
        .join("\n");
    } catch {
      // not arguments: shown as it is
    }
  }
  const lines = body.split("\n");
  return lines.length > 14 ? [...lines.slice(0, 14), `… ${lines.length - 14} more lines`].join("\n") : body;
}

function CardPanel({ card, changing }: { card: Card; changing: boolean }): React.ReactElement {
  const why = Array.isArray(card.meta.why) ? (card.meta.why as unknown[]).map(String) : [];
  const floor = Array.isArray(card.meta.floor) && card.meta.floor.length > 0; // the floor asked, not a rule
  const detail = cardBody(card);
  const keys = cardKeys(card);
  return h(
    Box,
    { flexDirection: "column", borderStyle: "round", borderColor: floor ? WARN : ACCENT, paddingX: 1, marginTop: 1 },
    h(Text, { bold: true }, card.title),
    detail.trim() ? h(Text, { color: DIM }, detail) : null,
    why.length ? h(Text, { color: floor ? WARN : DIM }, `It asks because ${why.join("; ")}.`) : null,
    h(
      Text,
      null,
      changing
        ? h(Text, { color: DIM }, "say what to change, then Enter · Esc goes back")
        : keys.length
          ? keys.map(([k, label], i) => h(Text, { key: k }, i ? "   " : "", h(Text, { color: ACCENT, bold: true }, `[${k}]`), ` ${label}`))
          : h(Text, { color: DIM }, "type your answer below, then Enter"),
    ),
  );
}

/** The one line that says what he is doing: the call it waits on, cut to fit, and how to stop it. */
export function activityLine(spin: string, running: [string, string] | null, activity: string | null, secs: number, columns: number): React.ReactElement {
  const tail = ` (${secs}s · esc to stop)`;
  const [verb, what] = running ?? [activity ?? "Working", ""];
  const room = Math.max(8, columns - 2 - verb.length - 1 - tail.length - 1);
  const said = what.length > room ? `${what.slice(0, room - 1)}…` : what;
  return h(Text, { wrap: "truncate-end" }, h(Text, { color: ACCENT }, `${spin} `), running ? h(Text, { bold: true }, verb) : verb, said ? ` ${said}` : "", h(Text, { color: DIM }, tail));
}

export type AppProps = {
  client: HomeClient;
  orb: Orb;
  conversation: string;
  since: number; // the event the home had reached when this screen opened
  history: Message[];
  cards: Record<string, string>; // how each card in the history was answered
  card: Card | null;
  kit: string | null;
};

export function App(p: AppProps): React.ReactElement {
  const { exit } = useApp();
  const { columns } = useWindowSize();
  const once = useRef<Transcript | null>(null);
  once.current ??= new Transcript();
  const transcript = once.current; // one for the screen's life: it remembers calls and held cards
  const [items, setItems] = useState<Item[]>(() => {
    const all = p.history.flatMap((m) => transcript.items(m, p.cards));
    const cut = Math.max(0, all.length - HISTORY);
    return cut ? [{ key: "earlier", kind: "rule", text: `${cut} earlier rows` }, ...all.slice(cut)] : all;
  });
  const [stream, setStream] = useState(""); // the reply arriving now
  const [settling, setSettling] = useState<{ msg: number; text: string } | null>(null); // committed, not fetched yet
  const [pending, setPending] = useState<string[]>([]); // sent, not in the conversation yet
  const [card, setCard] = useState<Card | null>(p.card);
  const [busy, setBusy] = useState(p.orb.status === "working");
  const [started, setStarted] = useState(Date.now());
  const [activity, setActivity] = useState<string | null>(p.orb.activity);
  const [running, setRunning] = useState<[string, string] | null>(null); // the call without a result yet
  const [input, setInput] = useState("");
  const [changing, setChanging] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [kit, setKit] = useState(p.kit);
  const [tick, setTick] = useState(0);

  const lastMsg = useRef(p.history.at(-1)?.id ?? 0);
  const streamRef = useRef("");
  const fetching = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const say = useCallback((text: string, warn = true) => {
    setItems((xs) => [...xs, { key: `n${Date.now()}${Math.random()}`, kind: "notice", text, warn }]);
  }, []);

  // New rows of the conversation, fetched one request at a time (a burst of events is one fetch).
  const refresh = useCallback((): Promise<void> => {
    if (fetching.current) {
      again.current = true;
      return fetching.current;
    }
    const run = async (): Promise<void> => {
      do {
        again.current = false;
        const r = await p.client.get<{ messages: Message[]; cards: Record<string, string>; card: Card | null }>(
          `/conversations/${encodeURIComponent(p.conversation)}/messages?since=${lastMsg.current}`,
        );
        const fresh = r.messages.filter((m) => m.id > lastMsg.current);
        if (fresh.length) lastMsg.current = fresh.at(-1)!.id;
        // one render: the rows reach the scrollback in the frame their live copies leave
        const rows = fresh.flatMap((m) => transcript.items(m, r.cards));
        setItems((xs) => [...xs, ...rows]);
        setRunning(transcript.running);
        setSettling((s) => (s && fresh.some((m) => m.id === s.msg) ? null : s));
        const said = fresh.filter((m) => m.role === "user").map((m) => m.content);
        if (said.length) {
          setPending((ps) => {
            const left = [...ps];
            for (const x of said) {
              const i = left.indexOf(x);
              if (i >= 0) left.splice(i, 1);
            }
            return left;
          });
        }
        setCard(r.card);
      } while (again.current);
    };
    fetching.current = run()
      .catch((e: unknown) => setProblem((e as Error).message))
      .finally(() => {
        fetching.current = null;
      });
    return fetching.current;
  }, [p.client, p.conversation]);

  // The live stream, reconnected from the last event seen if the home goes away and comes back.
  useEffect(() => {
    const ac = new AbortController();
    let seq = p.since;
    const mine = (e: { orb?: string | null; conversation?: string | null }): boolean => e.orb === p.orb.id && e.conversation === p.conversation;
    const onEvent = (e: HomeEvent): void => {
      seq = Math.max(seq, e.seq);
      const k = KIT_STATES[e.type];
      if (k) setKit(k);
      if (e.orb !== p.orb.id) return;
      if (e.type === "run.started" && e.conversation === p.conversation) {
        setBusy(true);
        setStarted(Date.now());
      } else if (e.type === "orb.activity") {
        setActivity(typeof e.data.text === "string" ? e.data.text : null);
      } else if ((e.type === "run.finished" || e.type === "run.interrupted") && e.conversation === p.conversation) {
        setBusy(false);
        setActivity(null);
        setRunning(null);
        // words the home never committed are still the person's: commit them here, never drop them
        const left = streamRef.current;
        if (left.trim()) setItems((xs) => [...xs, { key: `s${e.seq}`, kind: "speech", text: left, stopped: true }]);
        streamRef.current = "";
        setStream("");
        void refresh();
      } else if (e.type === "message.added" && mine(e)) {
        if (e.data.role === "assistant" && streamRef.current) {
          // its words stay on screen, as they are, until the committed copy arrives
          setSettling({ msg: Number(e.data.id), text: streamRef.current });
          streamRef.current = "";
          setStream("");
        }
        void refresh();
      } else if ((e.type === "card.opened" || e.type === "card.resolved") && mine(e)) {
        if (e.type === "card.resolved") {
          setCard((c) => (c && c.id === Number(e.data.card) ? null : c));
          const rows = transcript.answered(Number(e.data.card), String(e.data.status));
          if (rows.length) setItems((xs) => [...xs, ...rows]);
        }
        void refresh();
      }
    };
    const onText = (t: TextDelta): void => {
      if (t.orb !== p.orb.id || t.conversation !== p.conversation) return;
      streamRef.current += t.delta;
      setStream(streamRef.current);
    };
    void (async () => {
      while (!ac.signal.aborted) {
        try {
          await p.client.stream(seq, { event: onEvent, text: onText }, ac.signal);
          if (!ac.signal.aborted) setProblem("the home closed the stream; reconnecting…");
        } catch (e) {
          if (ac.signal.aborted) return;
          setProblem(`the home is not answering (${(e as Error).message}); reconnecting…`);
        }
        await new Promise((r) => setTimeout(r, 1000));
        if (!ac.signal.aborted) {
          try {
            await p.client.get("/status");
            setProblem(null);
            void refresh();
          } catch {
            // still away; the loop tries again
          }
        }
      }
    })();
    return () => ac.abort();
  }, [p.client, p.orb.id, p.conversation, p.since, refresh]);

  // The spinner: the live region repaints while he works, which is also how a frozen screen shows.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setTick((n) => n + 1), 120);
    return () => clearInterval(t);
  }, [busy]);

  const answer = useCallback(
    (choice: string, text?: string) => {
      if (!card) return;
      setChanging(false);
      p.client.post(`/cards/${card.id}`, { choice, ...(text !== undefined && { answer: text }) }).catch((e: unknown) => say(`that answer did not reach the card: ${(e as Error).message}`));
    },
    [card, p.client, say],
  );

  const stop = useCallback(() => {
    p.client.post(`/orbs/${encodeURIComponent(p.orb.id)}/stop`).catch((e: unknown) => say(`could not stop ${p.orb.name}: ${(e as Error).message}`));
  }, [p.client, p.orb, say]);

  // What is being typed lives in a ref as well as in state: keys typed faster than a frame
  // (or "text" and Enter in one read) must see each other, not the last render's copy.
  const typed = useRef("");
  const setTyped = (s: string): void => {
    typed.current = s;
    setInput(s);
  };

  const submit = (): void => {
    const text = typed.current.trim();
    if (!text) return;
    setTyped("");
    if (card && changing) answer("change", text);
    else if (card && card.kind === "question") answer("answer", text);
    else if (!card) {
      setPending((ps) => [...ps, text]);
      p.client
        .post(`/orbs/${encodeURIComponent(p.orb.id)}/messages`, { conversation: p.conversation, text })
        .catch((e: unknown) => {
          setPending((ps) => ps.filter((x) => x !== text));
          say(`not sent: ${(e as Error).message}`);
        });
    }
  };

  useInput((ch, key) => {
    if (key.ctrl && ch === "c") {
      if (typed.current) setTyped("");
      else exit();
      return;
    }
    if (key.escape) {
      if (changing) setChanging(false);
      else if (busy) stop();
      return;
    }
    const typing = !card || card.kind === "question" || changing;
    if (key.return || ch === "\n") {
      if (typing) submit();
      return;
    }
    if (key.backspace || key.delete) {
      if (typing) setTyped(typed.current.slice(0, -1));
      return;
    }
    if (!typing) {
      // a card that is not typed into answers to its keys, and only to them
      const k = cardKeys(card!).find(([c]) => c === ch.toLowerCase());
      if (k?.[2] === "change") setChanging(true);
      else if (k) answer(k[2]);
      return;
    }
    if (!ch || key.ctrl || key.meta) return;
    // an Enter inside a read (keys typed faster than a frame, or typed before raw mode began) still sends
    ch.split(/\r\n?|\n/).forEach((part, i) => {
      if (i > 0) submit();
      if (part) setTyped(typed.current + part);
    });
  });

  const secs = Math.floor((Date.now() - started) / 1000);
  const placeholder = card && !changing && card.kind !== "question" ? "answer the card above" : `Ask ${p.orb.name} to do anything`;
  return h(
    Box,
    { flexDirection: "column" },
    h(Static, { items: items as unknown[], children: (it: unknown) => h(Row, { key: (it as Item).key, item: it as Item }) }),
    settling ? h(Row, { item: { key: "settling", kind: "speech", text: settling.text } }) : null,
    stream ? h(Row, { item: { key: "stream", kind: "speech", text: stream } }) : null,
    ...pending.map((t, i) => h(Box, { key: `p${i}`, marginTop: 1 }, h(Text, { color: DIM }, `› ${t}  (queued)`))),
    card ? h(CardPanel, { card, changing }) : null,
    busy ? h(Box, { marginTop: 1 }, activityLine(SPIN[tick % SPIN.length]!, running, activity, secs, columns)) : null,
    problem ? h(Box, { marginTop: 1 }, h(Text, { color: WARN }, problem)) : null,
    h(
      Box,
      { marginTop: 1 },
      h(Text, { color: ACCENT, bold: true }, "› "),
      input ? h(Text, null, input, h(Text, { inverse: true }, " ")) : h(Text, null, h(Text, { inverse: true }, placeholder[0]), h(Text, { color: DIM }, placeholder.slice(1))),
    ),
    h(Text, { color: DIM }, `  ${p.orb.name} · ${busy ? "working" : card ? "waiting for you" : "idle"} · kit ${kit ?? "off"} · ${p.conversation}`),
  );
}
