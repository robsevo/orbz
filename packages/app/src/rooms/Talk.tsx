// A conversation, as it happens (PLAN 2.10 a private chat, 2.9 a session's tab). Through the home's
// door (home/link.ts):
//   - every orb's words arrive as they are written, each in his own colour, with his name when
//     there is more than one;
//   - your words are yours;
//   - "✓ Agreed" stands out;
//   - what needs your OK waits on a card at the bottom until you answer it.
// `busy` tells the room who is working, for his avatar.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Character } from "../orb/spec.ts";
import { idOf, type Card, type Choice, type Message, type Office } from "../home/link.ts";

const bubble = (mine: boolean): CSSProperties => ({
  justifySelf: mine ? "end" : "start", maxWidth: "min(80%, 620px)", padding: "10px 14px", borderRadius: 18,
  borderBottomRightRadius: mine ? 6 : 18, borderBottomLeftRadius: mine ? 18 : 6,
  background: mine ? "var(--accent-fill)" : "var(--raised)", boxShadow: mine ? "inset 0 0 0 1px var(--accent)" : "inset 0 0 0 .5px var(--hairline)",
  font: "400 15px/22px var(--font)", color: "var(--text-1)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", minWidth: 0,
});
const button: CSSProperties = { font: "600 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 14px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 36 };

export type Busy = Record<string, "thinking" | "speaking">;

export function Talk(o: {
  home: Office;
  conversation: string;
  /** The orbs who may speak here (their words are labelled by name when there is more than one). */
  orbs: Character[];
  send: (text: string) => Promise<void>;
  placeholder: string;
  empty: ReactNode;
  onBusy?: (b: Busy) => void;
  onMessages?: (m: Message[]) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [card, setCard] = useState<Card | null>(null);
  const [live, setLive] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Busy>({});
  const [draft, setDraft] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [open, setOpen] = useState(false); // the live stream: words arrive as written only once it is open
  const end = useRef<HTMLDivElement>(null);
  const shownUpTo = useRef(0); // the newest message already shown
  const ended = useRef(new Set<string>()); // orbs whose run has finished: their streamed words go once its reply is in
  const byId = new Map(o.orbs.map((c) => [idOf(c.name), c]));
  const many = o.orbs.length > 1;

  const load = async (): Promise<void> => {
    const r = await o.home.messages(o.conversation);
    // a reply kept takes the place of the words that streamed in for it, that orb's only, and only
    // as far as it goes (the next step's words may already be streaming); your own words, or
    // another orb's, take nothing away (they did: a slow load wiped a reply mid-stream)
    const fresh = r.messages.filter((m) => m.id > shownUpTo.current && m.role === "assistant" && m.content);
    shownUpTo.current = Math.max(shownUpTo.current, ...r.messages.map((m) => m.id));
    const done = new Set(ended.current);
    ended.current.clear();
    if (fresh.length || done.size) {
      setLive((l) => {
        const next = { ...l };
        for (const m of fresh) {
          const t = next[m.orb];
          if (t !== undefined) next[m.orb] = t.startsWith(m.content) ? t.slice(m.content.length) : "";
        }
        for (const orb of done) delete next[orb];
        return next;
      });
    }
    setMessages(r.messages);
    o.onMessages?.(r.messages);
    setCard(r.card && r.card.status === "pending" ? r.card : null);
  };
  const working = (orb: string, how: "thinking" | "speaking" | null): void =>
    setBusy((b) => {
      const next = { ...b };
      if (how) next[orb] = how;
      else delete next[orb];
      return next;
    });
  useEffect(() => {
    o.onBusy?.(busy);
  }, [busy]);
  useEffect(() => {
    setMessages([]);
    o.onMessages?.([]);
    setLive({});
    setOpen(false);
    shownUpTo.current = 0;
    ended.current.clear();
    setBusy({});
    void load().catch((e: Error) => setSaid(e.message));
    return o.home.watch({
      open: () => {
        setOpen(true);
        void load().catch(() => {}); // what happened while it was connecting
      },
      event: (e) => {
        if (e.conversation !== o.conversation) return;
        if (e.type === "message.added" || e.type.startsWith("card.") || e.type.startsWith("run.")) void load().catch(() => {});
        if (e.type === "run.started" && e.orb) working(e.orb, "thinking");
        if (e.type === "run.finished" && e.orb) {
          working(e.orb, null);
          ended.current.add(e.orb); // the load this event starts brings his reply, and clears what streamed
        }
      },
      text: (d) => {
        if (d.conversation !== o.conversation) return;
        working(d.orb, "speaking");
        setLive((l) => ({ ...l, [d.orb]: (l[d.orb] ?? "") + d.delta }));
      },
    });
  }, [o.conversation]);
  // a committed reply takes the place of the words that streamed in
  // a block, not an arrow's value: Chromium's scrollIntoView returns a Promise now, and an effect
  // that returns one takes it for its clean-up and throws when it is torn down
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, live, card?.id]);

  const send = (): void => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    o.send(text).catch((e: Error) => setSaid(e.message));
  };
  const answer = (choice: Choice): void => {
    if (!card) return;
    o.home.answer(card.id, choice).then(load, (e: Error) => setSaid(e.message));
  };
  const nameplate = (orb: string): ReactNode => {
    const c = byId.get(orb);
    return many && c ? <span data-orb={c.hue} style={{ font: "700 12px/16px var(--font)", color: "var(--accent)", marginBottom: 2 }}>{c.name}</span> : null;
  };
  const shown = messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "notice");
  return (
    <div data-stream={open ? "open" : "connecting"} style={{ display: "grid", gridTemplateRows: "1fr auto", minHeight: 0, minWidth: 0 }}>
      <div role="log" aria-label="The conversation" aria-live="polite" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", alignContent: "start", gap: 8, padding: "var(--s4) var(--s5)", overflowY: "auto", minWidth: 0 }}>
        {!shown.length && !Object.values(live).some(Boolean) && <span style={{ justifySelf: "center", font: "400 14px/20px var(--font)", color: "var(--text-3)", padding: "var(--s5) 0", textAlign: "center" }}>{o.empty}</span>}
        {shown.map((m) =>
          m.role === "notice" ? (
            typeof m.meta.agreed === "string" ? (
              <div key={m.id} data-agreed style={{ justifySelf: "center", display: "flex", gap: 8, alignItems: "center", padding: "8px 14px", borderRadius: 14, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)", font: "700 14px/20px var(--font)", color: "var(--text-1)", maxWidth: 560, animation: "orbs-arrive 520ms var(--m-spring)" }}>
                <span aria-hidden style={{ letterSpacing: ".1em", fontSize: 11, color: "var(--accent)" }}>✓ AGREED</span>
                {m.meta.agreed}
              </div>
            ) : typeof m.meta.memory === "string" ? (
              <div key={m.id} data-memory data-orb={byId.get(m.orb)?.hue} style={{ justifySelf: "center", display: "flex", gap: 8, alignItems: "center", padding: "6px 12px", borderRadius: 999, background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", font: "600 13px/18px var(--font)", color: "var(--text-1)", maxWidth: 560, animation: "orbs-arrive 520ms var(--m-spring)" }}>
                <span aria-hidden style={{ letterSpacing: ".1em", fontSize: 10, fontWeight: 800, color: "var(--accent)", flex: "0 0 auto" }}>MEMORY UPDATED</span>
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{m.meta.memory}</span>
              </div>
            ) : (
              <span key={m.id} data-notice style={{ justifySelf: "center", font: "500 13px/18px var(--font)", color: m.meta.error ? "var(--alert)" : "var(--text-3)", textAlign: "center", maxWidth: 560 }}>
                {m.content}
              </span>
            )
          ) : m.content.trim() ? (
            <div key={m.id} style={{ display: "grid", justifyItems: m.role === "user" ? "end" : "start", minWidth: 0 }} data-orb={byId.get(m.orb)?.hue}>
              {m.role === "assistant" && nameplate(m.orb)}
              <div data-role={m.role} data-from={m.role === "assistant" ? m.orb : "you"} style={bubble(m.role === "user")}>
                {m.content}
              </div>
            </div>
          ) : null,
        )}
        {Object.entries(live).filter(([, t]) => t).map(([orb, t]) => (
          <div key={`live-${orb}`} style={{ display: "grid", justifyItems: "start", minWidth: 0 }} data-orb={byId.get(orb)?.hue}>
            {nameplate(orb)}
            <div data-role="live" data-from={orb} style={{ ...bubble(false), opacity: 0.92 }}>
              {t}
            </div>
          </div>
        ))}
        {card && (
          <div role="group" aria-label={card.title} data-card={card.id} style={{ display: "grid", gap: "var(--s2)", padding: "var(--s4)", borderRadius: 16, background: "var(--card)", boxShadow: "inset 0 0 0 1.5px var(--accent)", maxWidth: 620 }}>
            <span style={{ font: "700 15px/20px var(--font)", color: "var(--text-1)" }}>{card.title}</span>
            {card.detail && <span style={{ font: "400 13px/18px var(--font)", color: "var(--text-3)", whiteSpace: "pre-wrap" }}>{card.detail}</span>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button data-sound="pick" onClick={() => answer("approve")} style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}>
                Approve
              </button>
              <button onClick={() => answer("deny")} style={button}>
                Deny
              </button>
            </div>
          </div>
        )}
        {said && <span role="alert" style={{ justifySelf: "center", font: "500 13px/18px var(--font)", color: "var(--alert)" }}>{said}</span>}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        style={{ display: "flex", gap: 8, padding: "var(--s3) var(--s5) var(--s4)", boxShadow: "0 -1px 0 var(--sep)" }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          aria-label={o.placeholder}
          placeholder={o.placeholder}
          rows={1}
          style={{ flex: "1 1 auto", minWidth: 0, resize: "none", font: "400 15px/22px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 14, padding: "10px 14px", outline: 0, boxShadow: "inset 0 0 0 1px var(--hairline)", maxHeight: 160 }}
        />
        <button type="submit" data-sound="pick" disabled={!draft.trim()} style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)", opacity: draft.trim() ? 1 : 0.5 }}>
          Send
        </button>
      </form>
    </div>
  );
}
