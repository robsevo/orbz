// A conversation, as it happens (PLAN 2.10 a private chat, 2.9 a session's tab). Through the home's
// door (home/link.ts):
//   - every orb's words arrive as they are written, each in his own colour, with his name when
//     there is more than one;
//   - your words are yours;
//   - "✓ Agreed" stands out;
//   - what needs your OK waits on a card at the bottom until you answer it.
// `busy` tells the room who is working, for his avatar.
//
// With one orb (a private chat) it can be spoken too (PLAN 4.3): his replies in his own voice, when
// your replies are "Speak & show"; you, by pressing the microphone, or hands-free by saying his name.
// While he speaks or works, Send is Stop: one press silences him and ends his run. Hands-free is a
// real conversation (PLAN 4.7): his name once, talking over him, "didn't catch that" (ears.ts and
// turns.ts); what you said is marked as said, so he answers for the ear.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Character } from "../orb/spec.ts";
import { idOf, type Card, type Choice, type Message, type Office } from "../home/link.ts";
import { saying, speak, speaking, stopSpeaking } from "../orb/speech.ts";
import { type Ears, listenFor, pressToTalk } from "../orb/ears.ts";
import { Rich } from "../ui/Rich.tsx";
import { Asked } from "../ui/Asked.tsx";

const bubble = (mine: boolean): CSSProperties => ({
  justifySelf: mine ? "end" : "start", maxWidth: "min(80%, 620px)", padding: "10px 14px", borderRadius: 18,
  borderBottomRightRadius: mine ? 6 : 18, borderBottomLeftRadius: mine ? 18 : 6,
  background: mine ? "var(--accent-fill)" : "var(--raised)", boxShadow: mine ? "inset 0 0 0 1px var(--accent)" : "inset 0 0 0 .5px var(--hairline)",
  font: "400 15px/22px var(--font)", color: "var(--text-1)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", minWidth: 0,
});
const button: CSSProperties = { font: "600 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 14px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 36 };
/** How tall the box you write in grows before it scrolls. */
const BOX_MAX = 200; // about seven lines, then it scrolls (owner, 10-10: "make it bigger")
// the composer's icons: round, quiet, the size of a fingertip with orbs-small's reach above and below
const icon: CSSProperties = { display: "grid", placeItems: "center", width: 40, height: 40, minHeight: 40, padding: 0, border: 0, borderRadius: 999, background: "transparent", color: "var(--text-2)", cursor: "pointer", flex: "0 0 auto" };
const round: CSSProperties = { ...icon, background: "var(--accent)", color: "var(--ground)" };
/** A line glyph in the button's own colour. */
function Glyph({ d, width = 1.9 }: { d: string; width?: number }) {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <path d={d} />
    </svg>
  );
}

export type Busy = Record<string, "thinking" | "speaking">;

/** What he says when Whisper could not make out what you said (PLAN 4.7): a few ways, so it never
 * sounds like a recording. */
const MISSED = ["Sorry, I didn't catch that.", "Say that again?", "I missed that, sorry."];

export function Talk(o: {
  home: Office;
  conversation: string;
  /** The orbs who may speak here (their words are labelled by name when there is more than one). */
  orbs: Character[];
  /** `said`: you spoke it, by the microphone or hands-free (PLAN 4.7). */
  send: (text: string, o?: { said?: boolean }) => Promise<void>;
  placeholder: string;
  /** Shorter words for the empty box, longest first, for where `placeholder` does not fit its one line. */
  shorter?: string[];
  empty: ReactNode;
  /** A private chat lets you give him files (PLAN 2.4): each kept on the home, its path in your message. */
  attach?: (file: File) => Promise<string>;
  onBusy?: (b: Busy) => void;
  /** How his ears are (hands-free on), and his listening cues: he leans in when called, nods at your pause. */
  onEars?: (e: Ears | null) => void;
  onCue?: (cue: "hop" | "nod") => void;
  onMessages?: (m: Message[]) => void;
  /** A private chat's voice (PLAN 4.3): the orb, his pace, and whether his replies are spoken. */
  voice?: { orb: Character; speed: number; speaks: boolean };
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [card, setCard] = useState<Card | null>(null);
  const [live, setLive] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Busy>({});
  const [draft, setDraft] = useState("");
  const [given, setGiven] = useState<string[]>([]); // files kept for this message, by path
  const picker = useRef<HTMLInputElement>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [open, setOpen] = useState(false); // the live stream: words arrive as written only once it is open
  const [talking, setTalking] = useState(false); // he is speaking
  const [recording, setRecording] = useState<{ stop: () => Promise<{ words: string; unsure: boolean }> } | null>(null);
  const [ears, setEarsState] = useState<Ears | null>(null); // hands-free, when on
  const stopEars = useRef<(() => void) | null>(null);
  const busyNow = useRef<Busy>({}); // who is working now, for the ears (a closure over state would be stale)
  const setEars = (e: Ears | null): void => {
    setEarsState(e);
    o.onEars?.(e);
  };
  const spokenUpTo = useRef<number | null>(null); // the newest reply already spoken (or there before you came)
  const log = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const [unseen, setUnseen] = useState(false);
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
    // his voice (PLAN 4.3): a new reply of his is spoken; what was there before you came is not
    const newest = Math.max(0, ...r.messages.filter((m) => m.role === "assistant" && m.content.trim()).map((m) => m.id));
    if (spokenUpTo.current === null) spokenUpTo.current = newest;
    else if (o.voice?.speaks && newest > spokenUpTo.current) {
      const reply = r.messages.find((m) => m.id === newest)!;
      spokenUpTo.current = newest;
      setTalking(true);
      void speak(o.home, o.voice.orb, o.voice.speed, reply.content).then((why) => {
        setTalking(speaking());
        if (why) setSaid(why);
      });
    } else spokenUpTo.current = Math.max(spokenUpTo.current, newest);
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
    busyNow.current = busy;
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
    spokenUpTo.current = null;
    stopSpeaking();
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
  // the conversation scrolls inside the screen (owner, 10-07: "scrolling bar on the WHOLE CONVO that doesnt
  // go past the screen"): it follows what arrives only while you are at its end; scrolled up to read, you
  // stay where you are, and "Jump to latest" says there is more below
  useEffect(() => {
    const el = log.current;
    if (!el) return;
    if (atEnd.current) el.scrollTop = el.scrollHeight;
    else setUnseen(true);
  }, [messages.length, live, card?.id]);
  // shown again after being hidden (a narrow Floor's "The chat"), or resized: still at its latest line if it was there
  useEffect(() => {
    const el = log.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => {
      if (atEnd.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const toEnd = (): void => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
    atEnd.current = true;
    setUnseen(false);
  };

  // the box you write in fits what is in it (owner, 10-08, on a phone: "Say something to the brainstorm doesnt
  // fit in the text box"): empty, the longest of its words that fits its one line; written in, it grows with
  // your words up to BOX_MAX, then scrolls
  const box = useRef<HTMLTextAreaElement>(null);
  const [hint, setHint] = useState(o.placeholder);
  const grow = (): void => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, BOX_MAX)}px`;
  };
  useLayoutEffect(grow, [draft]);
  const shorter = (o.shorter ?? []).join("\n");
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const words = [o.placeholder, ...(o.shorter ?? [])];
    let width = -1;
    const pick = (): void => {
      if (el.clientWidth === width) return; // only a new width changes what fits
      width = el.clientWidth;
      const cs = getComputedStyle(el);
      const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const probe = document.createElement("span");
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily};letter-spacing:${cs.letterSpacing}`;
      document.body.append(probe);
      const fits = words.find((w) => ((probe.textContent = w), probe.getBoundingClientRect().width <= room)) ?? words.at(-1)!;
      probe.remove();
      setHint(fits);
      grow();
    };
    pick();
    // a frame later, so the box's height changing here is never the change its own observer is told of
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => requestAnimationFrame(pick)) : null;
    ro?.observe(el);
    void document.fonts?.ready.then(() => {
      width = -1;
      pick();
    });
    return () => ro?.disconnect();
  }, [o.placeholder, shorter]);

  const send = (): void => {
    const text = [draft.trim(), ...given.map((p) => `[Attached: ${p}]`)].filter(Boolean).join("\n");
    if (!text) return;
    setDraft("");
    setGiven([]);
    toEnd(); // what you say, and what answers it, at the end where you can see them
    o.send(text).catch((e: Error) => setSaid(e.message));
  };
  const give = (files: FileList | null): void => {
    for (const f of [...(files ?? [])]) o.attach?.(f).then((p) => setGiven((g) => [...g, p]), (e: Error) => setSaid(e.message));
    if (picker.current) picker.current.value = "";
  };
  // one press silences him and ends his run
  const stop = (): void => {
    stopSpeaking();
    setTalking(false);
    if (o.voice) o.home.stop(o.voice.orb).catch(() => {});
  };
  // what Whisper could not make out (PLAN 4.7): he says so, and nothing reaches his brain
  const missed = (): void => {
    if (!o.voice) return;
    const line = MISSED[Math.floor(Math.random() * MISSED.length)]!;
    if (o.voice.speaks) {
      setTalking(true);
      void speak(o.home, o.voice.orb, o.voice.speed, line).then(() => setTalking(speaking()));
    } else setSaid(line);
  };
  const talk = (): void => {
    if (!o.voice) return;
    if (recording) {
      const r = recording;
      setRecording(null);
      r.stop()
        .then((h) => (h.unsure ? missed() : h.words ? o.send(h.words, { said: true }) : undefined), (e: Error) => setSaid(e.message))
        .catch((e: Error) => setSaid(e.message));
      return;
    }
    stopSpeaking();
    pressToTalk(o.home, o.voice.orb).then(setRecording, (e: Error) => setSaid(e.message === "Permission denied" ? "the microphone was not allowed" : e.message));
  };
  const handsFree = (): void => {
    if (!o.voice) return;
    if (stopEars.current) {
      stopEars.current();
      stopEars.current = null;
      setEars(null);
      return;
    }
    listenFor(o.home, o.voice.orb, {
      heard: (w) => void o.send(w, { said: true }).catch((e: Error) => setSaid(e.message)),
      missed,
      interrupt: stop, // you took the floor: he stops, as with Stop, and listens
      cue: (c) => o.onCue?.(c),
      state: setEars,
      failed: setSaid,
      he: () => ({ speaking: speaking(), busy: Object.keys(busyNow.current).length > 0 }),
      saying,
    }).then(
      (end) => (stopEars.current = end),
      (e: Error) => setSaid(e.message),
    );
  };
  useEffect(() => () => stopEars.current?.(), []);
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
    <div data-stream={open ? "open" : "connecting"} style={{ display: "grid", gridTemplateRows: "minmax(0, 1fr) auto", height: "100%", minHeight: 0, minWidth: 0 }}>
      <div
        ref={log}
        role="log"
        aria-label="The conversation"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (atEnd.current) setUnseen(false);
        }}
        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", alignContent: "start", gap: 8, padding: "var(--s4) var(--s5)", overflowY: "auto", overscrollBehavior: "contain", minHeight: 0, minWidth: 0 }}
      >
        {!shown.length && !Object.values(live).some(Boolean) && <span style={{ justifySelf: "center", font: "400 14px/20px var(--font)", color: "var(--text-3)", padding: "var(--s5) 0", textAlign: "center" }}>{o.empty}</span>}
        {shown.map((m) =>
          m.role === "notice" ? (
            typeof m.meta.agreed === "string" ? (
              // the mark and its word on one line, at the first line of what was agreed (owner, 10-08: "Agreed and
              // checkmark should always be on same line"; a long decision squeezed it to "✓" over "AGREED")
              <div key={m.id} data-agreed style={{ justifySelf: "center", display: "flex", gap: 8, alignItems: "baseline", padding: "8px 14px", borderRadius: 14, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)", font: "700 14px/20px var(--font)", color: "var(--text-1)", maxWidth: 560, minWidth: 0, animation: "orbs-arrive 520ms var(--m-spring)" }}>
                <span aria-hidden data-agreed-mark style={{ letterSpacing: ".1em", fontSize: 11, color: "var(--accent)", whiteSpace: "nowrap", flex: "0 0 auto" }}>✓ AGREED</span>
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{m.meta.agreed}</span>
              </div>
            ) : typeof m.meta.memory === "string" ? (
              <div key={m.id} data-memory data-orb={byId.get(m.orb)?.hue} style={{ justifySelf: "center", display: "flex", gap: 8, alignItems: "baseline", padding: "6px 12px", borderRadius: 999, background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", font: "600 13px/18px var(--font)", color: "var(--text-1)", maxWidth: 560, animation: "orbs-arrive 520ms var(--m-spring)" }}>
                <span aria-hidden style={{ letterSpacing: ".1em", fontSize: 10, fontWeight: 800, color: "var(--accent)", flex: "0 0 auto", whiteSpace: "nowrap" }}>MEMORY UPDATED</span>
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
                {/* an orb's reply formatted as it wrote it (owner, 10-05: "**5 people**" showed its asterisks); yours as you typed it */}
                {m.role === "assistant" ? <Rich text={m.content} /> : m.content}
              </div>
            </div>
          ) : null,
        )}
        {Object.entries(live).filter(([, t]) => t).map(([orb, t]) => (
          <div key={`live-${orb}`} style={{ display: "grid", justifyItems: "start", minWidth: 0 }} data-orb={byId.get(orb)?.hue}>
            {nameplate(orb)}
            <div data-role="live" data-from={orb} style={{ ...bubble(false), opacity: 0.92 }}>
              <Rich text={t} />
            </div>
          </div>
        ))}
        {card && (
          <div role="group" aria-label={card.title} data-card={card.id} style={{ display: "grid", gap: "var(--s2)", padding: "var(--s4)", borderRadius: 16, background: "var(--card)", boxShadow: "inset 0 0 0 1.5px var(--accent)", maxWidth: 620 }}>
            <Asked title={card.title} style={{ font: "700 15px/20px var(--font)", color: "var(--text-1)" }} />
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
        {/* held at the bottom of the conversation's own window, over what scrolls under it */}
        {unseen && (
          <button type="button" data-jump onClick={toEnd} style={{ ...button, position: "sticky", bottom: 4, justifySelf: "center", zIndex: 2, boxShadow: "0 4px 14px var(--shadow), inset 0 0 0 1px var(--hairline)", background: "var(--raised)" }}>
            ↓ Jump to latest
          </button>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        style={{ display: "grid", gap: 8, padding: "var(--s3) var(--s4) var(--s4)", boxShadow: "0 -1px 0 var(--sep)" }}
      >
        {given.length > 0 && (
          <div data-given style={{ display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
            {given.map((p) => (
              <span key={p} style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", padding: "4px 6px 4px 10px", borderRadius: 999, background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", font: "600 12px/16px var(--font)", color: "var(--text-1)" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{p.replace(/^from-you\//, "")}</span>
                <button type="button" aria-label={`Don't send ${p}`} onClick={() => setGiven((g) => g.filter((x) => x !== p))} style={{ border: 0, background: "transparent", color: "var(--text-3)", cursor: "pointer", font: "700 12px/16px var(--font)", padding: "0 4px" }}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        {/* one composer (owner, 10-10, on a phone: "restructure the chat box and its surroundings on mobile professionally.
            hands free and file containers should be icons. and placed differently, even the text box when we type it grows
            weirdly, make it bigger"): what you write across the whole of it (it had a third of a phone's width beside File,
            the microphone and Send, so a line wrapped every few words); under it, inside it, a file and hands-free as icons
            with what hands-free hears beside them, and one round button at the end: the microphone while there is nothing to
            send, Send once there is, Stop while he talks or works */}
        <div data-composer style={{ display: "grid", gap: 2, padding: 6, borderRadius: 22, background: "var(--fill)", boxShadow: "inset 0 0 0 1px var(--hairline)" }}>
        <textarea
          ref={box}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          aria-label={o.placeholder}
          placeholder={hint}
          rows={1}
          style={{ display: "block", width: "100%", minWidth: 0, resize: "none", font: "400 16px/24px var(--font)", color: "var(--text-1)", background: "transparent", border: 0, padding: "8px 10px 4px", outline: 0, maxHeight: BOX_MAX }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
          {o.attach && (
            <>
              <input ref={picker} type="file" multiple hidden aria-label={`Files to give ${o.orbs[0]?.name ?? "the orb"}`} onChange={(e) => give(e.target.files)} />
              <button type="button" className="orbs-small" onClick={() => picker.current?.click()} aria-label={`Give ${o.orbs[0]?.name ?? "the orb"} a file`} title="Give a file" style={icon}>
                <Glyph d="M15 7.5 8.6 13.9a1.9 1.9 0 0 0 2.7 2.7l7-7a3.9 3.9 0 0 0-5.5-5.5l-7.1 7.1a5.9 5.9 0 0 0 8.3 8.3l6.4-6.4" />
              </button>
            </>
          )}
          {o.voice ? (
            <div data-ears style={{ display: "flex", gap: 4, alignItems: "center", minWidth: 0, flex: "1 1 auto" }}>
              <button type="button" className="orbs-small" aria-pressed={ears !== null} aria-label="Hands-free" onClick={handsFree} title="Hands-free: say his name" style={{ ...icon, ...(ears && { background: "var(--accent-fill)", color: "var(--text-1)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }) }}>
                <Glyph d="M5 10.5v3M8.5 8v8M12 5v14M15.5 8v8M19 10.5v3" />
              </button>
              <span style={{ font: "500 12px/16px var(--font)", color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {ears === "called" ? `${o.voice.orb.name} is listening…` : ears === "hearing" ? "Hearing you…" : ears === "conversing" ? `Talking with ${o.voice.orb.name} · “thanks” ends it` : ears ? `Say “hey ${o.voice.orb.name}”` : recording ? "Recording: press the microphone again to send" : ""}
              </span>
            </div>
          ) : (
            <span style={{ flex: "1 1 auto" }} />
          )}
          {o.voice && (talking || Object.keys(busy).length > 0) && !draft.trim() ? (
            <button type="button" className="orbs-small" aria-label="Stop" onClick={stop} style={{ ...round, background: "var(--accent-fill)", color: "var(--text-1)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}>
              <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" style={{ display: "block" }}><rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" /></svg>
            </button>
          ) : !o.voice || draft.trim() || given.length > 0 ? (
            <button type="submit" className="orbs-small" aria-label="Send" data-sound="pick" disabled={!draft.trim() && !given.length} style={{ ...round, opacity: draft.trim() || given.length ? 1 : 0.4 }}>
              <Glyph d="M12 19V5.5M6 11.5l6-6 6 6" width={2.2} />
            </button>
          ) : (
            <button type="button" className="orbs-small" onClick={talk} aria-pressed={recording !== null} aria-label={recording ? "Send what you said" : `Talk to ${o.voice.orb.name}`} style={{ ...round, ...(!recording && { background: "var(--raised)", color: "var(--text-1)", boxShadow: "inset 0 0 0 1px var(--hairline)" }) }}>
              {/* drawn here, in the text's own colour: no glyph brings a colour of its own */}
              <svg aria-hidden width="18" height="18" viewBox="0 0 16 16" style={{ display: "block" }}>
                {recording ? (
                  <rect x="4" y="4" width="8" height="8" rx="2" fill="currentColor" />
                ) : (
                  <path d="M8 1.5a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0V4A2.5 2.5 0 0 1 8 1.5Zm-4.5 6.5h1a3.5 3.5 0 0 0 7 0h1a4.5 4.5 0 0 1-4 4.47V14.5h-1v-2.03A4.5 4.5 0 0 1 3.5 8Z" fill="currentColor" />
                )}
              </svg>
            </button>
          )}
        </div>
        </div>
      </form>
    </div>
  );
}
