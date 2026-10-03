// The first open, played (PLAN 2.5; story.ts has every line). A game's opening: your first orb,
// not yet made (a plain bean, no name), stands above a dialog box with his nameplate; his words
// type out with a soft blip; a press (a click, Enter or Space) finishes the line or moves on. He
// asks what to call you, you are made the office's CEO with a title card, and he asks you to make
// him: "Make me" opens the creator on him, "Surprise me" rolls him. "Skip the story" goes
// straight to what still needs you.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Orb } from "../orb/Orb.tsx";
import type { Character, PersonalityName } from "../orb/spec.ts";
import { play } from "../ui/sound.ts";
import { startMusic, stopMusic } from "../ui/music.ts";
import { checkName, line, NEWBORN, NEWBORN_PLATE, skipTo, storyFor, type Person } from "./story.ts";
import type { Brains as BrainsNow, ChatGPT, Office } from "../home/link.ts";

const TYPE_MS = 26;

/** Each personality talks in its own register (semitones over Ash's). */
const REGISTER: Partial<Record<PersonalityName, number>> = { cheerful: 3, silly: 5, shy: 4, curious: 2, sassy: 2, grumpy: -4, wise: -3, dapper: -2, sleepy: -2, cozy: -1 };

const box: CSSProperties = {
  position: "relative", width: "min(720px, 100%)", minHeight: 112, padding: "22px 22px 18px", borderRadius: 22,
  background: "linear-gradient(180deg, var(--fill) 0, transparent 60px), var(--card)", boxShadow: "inset 0 0 0 .5px var(--hairline), 0 8px 24px var(--shadow)",
  font: "500 18px/26px var(--font)", color: "var(--text-1)",
};
const button: CSSProperties = {
  font: "700 15px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 12, padding: "10px 18px", cursor: "pointer",
  boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 44,
};

export function Onboarding({ office, person, home, onDone }: { office: Character[]; person: Person | null; home: Office | null; onDone: (p: Person, then: "make" | "surprise") => void }) {
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState(0);
  const [named, setNamed] = useState<Person | null>(person);
  const [draft, setDraft] = useState("");
  const [why, setWhy] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // the music (owner, 10-02): from your first press (a browser plays nothing before one), off with the sounds
  const [music, setMusic] = useState(true);
  const begin = (): void => {
    if (music) startMusic();
  };
  useEffect(() => () => stopMusic(), []); // the story over: it fades out
  const typer = useRef<ReturnType<typeof setInterval> | null>(null);
  const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const story = storyFor(office.map((c) => c.name));
  const beat = story[i]!;
  const who = beat.kind === "say" && beat.who !== "new" ? office.find((c) => c.name === beat.who) ?? NEWBORN : NEWBORN;
  const plate = who === NEWBORN ? NEWBORN_PLATE : who.name;
  const full = beat.kind === "say" ? line(beat.text, named) : beat.kind === "hire" ? line("Ready when you are, {name}.", named) : "";
  const typing = typed < full.length;

  // the words type out, with a blip every other letter in the speaker's register
  useEffect(() => {
    setTyped(calm ? full.length : 0);
    if (calm || !full) return;
    let n = 0;
    const t = setInterval(() => {
      n++;
      setTyped(n);
      const ch = full[n - 1] ?? "";
      if (n % 2 === 0 && /[\p{L}\p{N}]/u.test(ch)) play("blip", REGISTER[who.personality] ?? 0);
      if (n >= full.length) clearInterval(t);
    }, TYPE_MS);
    typer.current = t;
    return () => clearInterval(t);
  }, [i, full]);

  useEffect(() => {
    if (beat.kind === "ask-name") input.current?.focus();
    if (beat.kind === "ceo") play("create");
  }, [i]);

  const next = (): void => setI((n) => Math.min(n + 1, story.length - 1));
  const submitName = (): void => {
    const r = checkName(draft);
    if (!r.ok) {
      setWhy(r.why);
      return;
    }
    setWhy("");
    setNamed({ name: r.name, since: Date.now() });
    next();
  };
  const advance = (): void => {
    if (beat.kind === "ask-name" || beat.kind === "hire" || beat.kind === "brains") return; // these wait for their own answer
    if (typing) {
      // the whole line at once: the typing stops, or it would carry on from where it was
      if (typer.current) clearInterval(typer.current);
      setTyped(full.length);
    } else next();
  };

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      begin();
      if ((e.key === "Enter" || e.key === " ") && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const finish = (then: "make" | "surprise"): void => {
    stopMusic();
    onDone(named ?? { name: "boss", since: Date.now() }, then);
  };
  const stage = (): ReactNode => {
    if (beat.kind === "ceo") {
      return (
        // a badge on a lanyard (owner, 10-01: "make a nicer ceo badge"): it stamps in, then hangs and
        // sways; a glint crosses its gold now and then; a few twinkles around it
        // (room either side for the sway: at 2 degrees its foot swings about 12 px)
        <div data-ceo data-orb="honey" style={{ position: "relative", display: "grid", justifyItems: "center", padding: "0 16px 12px", animation: calm ? undefined : "orbs-stamp 700ms var(--m-spring) both" }}>
          {!calm &&
            ([[-7, 34, 0], [93, 22, 0.5], [-5, 80, 1.1], [95, 72, 1.6]] as const).map(([x, y, d], k) => (
              <svg key={k} aria-hidden viewBox="0 0 10 10" width={k % 2 ? 14 : 18} height={k % 2 ? 14 : 18} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, fill: "var(--accent)", animation: `orbs-twinkle 1.8s ease-in-out ${d}s infinite` }}>
                <path d="M5 0 L6 4 L10 5 L6 6 L5 10 L4 6 L0 5 L4 4 Z" />
              </svg>
            ))}
          <div style={{ display: "grid", justifyItems: "center", transformOrigin: "50% 0", animation: calm ? undefined : "orbs-sway 3.4s ease-in-out 700ms infinite" }}>
            {/* the lanyard, coming down from out of sight (room either side for its slant: 84 px at 12 degrees leans 18) */}
            <div aria-hidden style={{ display: "flex", height: 84, padding: "0 20px" }}>
              <i style={{ width: 22, background: "linear-gradient(transparent, var(--accent-fill) 35%, var(--accent))", transform: "skewX(12deg)", transformOrigin: "100% 100%" }} />
              <i style={{ width: 22, background: "linear-gradient(transparent, var(--accent-fill) 35%, var(--accent))", transform: "skewX(-12deg)", transformOrigin: "0 100%", filter: "brightness(.85)" }} />
            </div>
            <div style={{ position: "relative", overflow: "hidden", display: "grid", justifyItems: "center", gap: 2, marginTop: -4, padding: "26px 40px 20px", borderRadius: 26, background: "linear-gradient(165deg, var(--raised), var(--card))", boxShadow: "0 0 0 3px var(--accent), 0 0 0 7px var(--accent-fill), 0 18px 48px var(--shadow), 0 0 70px var(--accent-glow)" }}>
              <i aria-hidden style={{ position: "absolute", top: 10, width: 46, height: 8, borderRadius: 4, background: "var(--ground)", boxShadow: "inset 0 1px 2px var(--shadow)" }} />
              <span style={{ marginTop: 6, font: "700 11px/16px var(--font)", letterSpacing: ".24em", color: "var(--text-3)" }}>THE OFFICE</span>
              <svg aria-hidden viewBox="0 0 48 34" width={46} height={33} style={{ fill: "var(--accent)", marginTop: 4, filter: "drop-shadow(0 2px 6px var(--accent-glow))" }}>
                <path d="M5 27 L2 8 L14 17 L24 3 L34 17 L46 8 L43 27 Z" />
                <rect x="5" y="28" width="38" height="5" rx="2" />
                <circle cx="2.5" cy="7" r="2.5" />
                <circle cx="24" cy="3" r="3" />
                <circle cx="45.5" cy="7" r="2.5" />
              </svg>
              <span style={{ font: "900 58px/62px var(--font)", letterSpacing: ".08em", background: "linear-gradient(180deg, var(--text-1) 0%, var(--accent) 62%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>CEO</span>
              <span style={{ font: "800 26px/32px var(--font)", color: "var(--text-1)", maxWidth: "70vw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{named?.name}</span>
              <span style={{ font: "600 12px/16px var(--font)", letterSpacing: ".06em", color: "var(--text-2)", whiteSpace: "nowrap" }}>Chief Executive Officer</span>
              <span style={{ display: "flex", gap: 10, marginTop: 10, padding: "4px 12px", borderRadius: 999, background: "var(--fill)", font: "600 11px/16px var(--font)", color: "var(--text-3)" }}>
                <span style={{ font: "700 11px/16px var(--mono)", letterSpacing: ".08em" }}>No. 0001</span>
                <span>Since today</span>
              </span>
              {!calm && <i aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(105deg, transparent 40%, var(--accent-wash) 50%, transparent 60%) 160% 0 / 250% 100% no-repeat", animation: "orbs-glint 3.2s ease-in-out 900ms infinite", pointerEvents: "none" }} />}
            </div>
          </div>
        </div>
      );
    }
    return <Orb character={who} size={168} state={typing ? "speaking" : "idle"} gesture={{ name: i === 0 ? "pop" : "nod", n: i }} />;
  };

  const shownText = full.slice(0, typed);
  return (
    <div
      role="dialog"
      aria-label="Welcome to Orbs"
      data-onboarding={beat.kind}
      onPointerDownCapture={(e) => {
        if (!(e.target instanceof HTMLElement && e.target.closest("[data-music]"))) begin();
      }}
      onClick={(e) => {
        if (!(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement)) advance();
      }}
      style={{
        position: "fixed", inset: 0, zIndex: 40, display: "grid", gridTemplateRows: "1fr auto", justifyItems: "center", gap: "var(--s4)",
        padding: "var(--s6) var(--margin) var(--s6)", background: "radial-gradient(60% 50% at 50% 35%, var(--accent-wash), transparent 70%), var(--ground)", cursor: beat.kind === "say" || beat.kind === "ceo" ? "pointer" : "default",
      }}
    >
      <div style={{ position: "absolute", top: "var(--s4)", left: "var(--margin)", right: "var(--margin)", display: "flex", justifyContent: "space-between", gap: 8, pointerEvents: "none" }}>
      <button
        data-music
        aria-pressed={music}
        onClick={() => {
          if (music) stopMusic(0.4);
          else startMusic();
          setMusic(!music);
        }}
        data-sound="tick"
        style={{ ...button, pointerEvents: "auto", font: "600 13px/18px var(--font)", padding: "6px 12px", minHeight: 32, color: "var(--text-3)" }}
      >
        {music ? "♪ Music on" : "♪ Music off"}
      </button>
      <button onClick={() => setI(skipTo(named, story))} data-sound="tick" style={{ ...button, pointerEvents: "auto", font: "600 13px/18px var(--font)", padding: "6px 12px", minHeight: 32, color: "var(--text-3)" }}>
        Skip the story
      </button>
      </div>
      <div style={{ alignSelf: "center", display: "grid", justifyItems: "center", minWidth: 0, maxWidth: "100%" }}>{stage()}</div>
      <div style={box} data-orb={who.hue}>
        {(beat.kind === "say" || beat.kind === "ask-name" || beat.kind === "hire" || beat.kind === "brains") && (
          <span style={{ position: "absolute", top: -14, left: 18, font: "800 13px/18px var(--font)", letterSpacing: ".04em", color: "var(--text-1)", background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)", borderRadius: 999, padding: "4px 12px" }}>
            {plate}
          </span>
        )}
        {beat.kind === "ask-name" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitName();
            }}
            style={{ display: "grid", gap: "var(--s3)" }}
          >
            <span>What should we call you?</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "nowrap" }}>
              <input
                ref={input}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label="Your name"
                placeholder="Your name"
                maxLength={40}
                size={1}
                style={{ flex: "1 1 160px", minWidth: 0, font: "700 20px/28px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 12, padding: "8px 14px", outline: 0, boxShadow: "inset 0 0 0 1px var(--hairline)" }}
              />
              <button type="submit" data-sound="pick" style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}>
                That's me
              </button>
            </div>
            {why && <span style={{ font: "500 14px/20px var(--font)", color: "var(--alert)" }}>{why}</span>}
          </form>
        ) : beat.kind === "brains" ? (
          <BrainsStep home={home} next={next} />
        ) : beat.kind === "hire" ? (
          <div style={{ display: "grid", gap: "var(--s3)" }}>
            <span aria-label={full}>{shownText}</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button data-sound="create" onClick={() => finish("make")} style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}>
                Make me
              </button>
              <button data-sound="roll" onClick={() => finish("surprise")} style={button}>
                Surprise me
              </button>
            </div>
          </div>
        ) : (
          <>
            <span aria-label={full || "Press to continue"}>{beat.kind === "say" ? shownText : "You're hired."}</span>
            {!typing && <span aria-hidden style={{ position: "absolute", right: 20, bottom: 12, font: "800 14px/14px var(--font)", color: "var(--accent)", animation: calm ? undefined : "orbs-nudge 900ms ease-in-out infinite" }}>▼</span>}
          </>
        )}
      </div>
    </div>
  );
}

const field: CSSProperties = { flex: "1 1 160px", minWidth: 0, font: "600 16px/22px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 12, padding: "8px 12px", outline: 0, boxShadow: "inset 0 0 0 1px var(--hairline)" };
const note: CSSProperties = { font: "400 13px/18px var(--font)", color: "var(--text-3)", textWrap: "pretty" };
const done: CSSProperties = { font: "700 14px/20px var(--font)", color: "var(--accent)" };

/** The brains (owner, 10-02): ChatGPT's sign-in, a Gemini key, a local coder if wanted, each kept by
 * the home as in Settings (PLAN 1.11); none is required, and each can be changed there later. */
function BrainsStep({ home, next }: { home: Office | null; next: () => void }) {
  const [plan, setPlan] = useState<ChatGPT | null>(null);
  const [now, setNow] = useState<BrainsNow | null>(null);
  const [key, setKey] = useState("");
  const [coder, setCoder] = useState<{ open: boolean; baseUrl: string; model: string }>({ open: false, baseUrl: "", model: "" });
  const [said, setSaid] = useState<string | null>(null);
  const load = (): void => {
    if (!home) return;
    home.chatgpt().then(setPlan, () => setPlan(null));
    home.brains().then(setNow, () => setNow(null));
  };
  useEffect(() => {
    if (!home) return;
    load();
    return home.watch({ event: (e) => void (/^(chatgpt|brain)\./.test(e.type) && load()) });
  }, [home]);
  const act = (p: Promise<unknown>, then?: () => void): void => {
    setSaid(null);
    p.then(() => {
      then?.();
      load();
    }, (e: Error) => setSaid(e.message));
  };
  if (!home) {
    return (
      <div data-brains-step style={{ display: "grid", gap: "var(--s3)" }}>
        <span>I think with ChatGPT, a Gemini key or a coder on your own computer. You choose them in Settings once this app is connected to your home.</span>
        <button data-sound="pick" onClick={next} style={{ ...button, justifySelf: "start" }}>
          Next
        </button>
      </div>
    );
  }
  const any = Boolean(plan?.connected || now?.gemini || now?.local);
  return (
    <div data-brains-step style={{ display: "grid", gap: "var(--s3)" }}>
      <span>What should I think with?</span>
      <div style={{ display: "grid", gap: 6 }}>
        {plan?.connected ? (
          <span data-brain-done="chatgpt" style={done}>✓ ChatGPT{plan.account?.email ? `, as ${plan.account.email}` : ""}</span>
        ) : (
          <button
            data-sound="pick"
            onClick={() => {
              // opened on the press itself (a window opened after a wait is blocked), then sent to the sign-in
              const w = globalThis.open?.("about:blank", "_blank") ?? null;
              if (w) w.opener = null;
              act(home.chatgptSignIn().then((url) => {
                if (w) w.location.href = url;
                else globalThis.location.assign(url);
              }, (e: unknown) => {
                w?.close();
                throw e;
              }));
            }}
            style={{ ...button, justifySelf: "start", background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}
          >
            {plan?.signingIn ? "Signing in…" : "Continue with ChatGPT"}
          </button>
        )}
        <span style={note}>Your ChatGPT plan answers first. The sign-in comes back to the computer your home runs on.</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) act(home.setKey("gemini", key.trim()), () => setKey(""));
        }}
        style={{ display: "grid", gap: 6 }}
      >
        {now?.gemini ? (
          <span data-brain-done="gemini" style={done}>✓ Gemini, {now.gemini.model}</span>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} aria-label="Your Gemini key" placeholder="A Gemini API key" size={1} style={field} />
            <button type="submit" style={button}>
              Keep
            </button>
          </div>
        )}
        <span style={note}>A free key from Google AI Studio. It stays in your home's keychain.</span>
      </form>
      {now?.local ? (
        <span data-brain-done="local" style={done}>✓ A local coder, {now.local.model}</span>
      ) : coder.open ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            act(home.setLocal({ baseUrl: coder.baseUrl.trim(), model: coder.model.trim() }));
          }}
          style={{ display: "grid", gap: 6 }}
        >
          <span style={note}>A local coder: a model served on your own computer (Ollama, LM Studio), by its address and its name.</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={coder.baseUrl} onChange={(e) => setCoder((c) => ({ ...c, baseUrl: e.target.value }))} aria-label="Its address" placeholder="http://127.0.0.1:11434/v1" size={1} style={field} />
            <input value={coder.model} onChange={(e) => setCoder((c) => ({ ...c, model: e.target.value }))} aria-label="Its model" placeholder="qwen2.5-coder" size={1} style={field} />
          </div>
          <button type="submit" style={{ ...button, justifySelf: "start" }}>
            Keep
          </button>
        </form>
      ) : (
        <button onClick={() => setCoder((c) => ({ ...c, open: true }))} style={{ ...button, justifySelf: "start" }}>
          Add a local coder
        </button>
      )}
      {said && <span role="alert" style={{ font: "500 14px/20px var(--font)", color: "var(--alert)" }}>{said}</span>}
      <button data-sound="pick" onClick={next} style={{ ...button, justifySelf: "end", ...(any && { background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }) }}>
        {any ? "Next" : "Skip for now"}
      </button>
    </div>
  );
}
