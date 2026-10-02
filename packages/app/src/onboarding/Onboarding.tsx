// The first open, played (PLAN 2.5; story.ts has every line). A game's opening: the one speaking
// stands above a dialog box with his nameplate, his words type out with a soft blip in his own
// register, and a press (a click, Enter or Space) finishes the line or moves on. Ash asks what
// to call you; you are made the office's CEO with a title card; the crew pops in and says hello;
// and you choose where to start. "Skip the story" goes straight to what still needs you.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Orb } from "../orb/Orb.tsx";
import { ASH, type Character, type PersonalityName } from "../orb/spec.ts";
import { Balanced } from "../ui/Balanced.tsx";
import { play } from "../ui/sound.ts";
import { checkName, line, STORY, skipTo, type Person } from "./story.ts";

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

export function Onboarding({ office, person, onDone }: { office: Character[]; person: Person | null; onDone: (p: Person, then: "hire" | "office") => void }) {
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState(0);
  const [named, setNamed] = useState<Person | null>(person);
  const [draft, setDraft] = useState("");
  const [why, setWhy] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const typer = useRef<ReturnType<typeof setInterval> | null>(null);
  const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const beat = STORY[i]!;
  const who = beat.kind === "say" ? office.find((c) => c.name === beat.who) ?? ASH : ASH;
  const full = beat.kind === "say" ? line(beat.text, named) : beat.kind === "hire" ? line("Where to first, {name}?", named) : "";
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

  const next = (): void => setI((n) => Math.min(n + 1, STORY.length - 1));
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
    if (beat.kind === "ask-name" || beat.kind === "hire") return; // these wait for their own answer
    if (typing) {
      // the whole line at once: the typing stops, or it would carry on from where it was
      if (typer.current) clearInterval(typer.current);
      setTyped(full.length);
    } else next();
  };

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if ((e.key === "Enter" || e.key === " ") && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const finish = (then: "hire" | "office"): void => onDone(named ?? { name: "boss", since: Date.now() }, then);
  const stage = (): ReactNode => {
    if (beat.kind === "ceo") {
      return (
        <div data-ceo style={{ display: "grid", justifyItems: "center", gap: 6, padding: "28px 40px", borderRadius: 24, background: "linear-gradient(160deg, var(--raised), var(--card))", boxShadow: "inset 0 0 0 1.5px var(--accent), 0 16px 40px var(--shadow)", animation: calm ? undefined : "orbs-stamp 700ms var(--m-spring) both" }} data-orb="honey">
          <span style={{ font: "700 12px/16px var(--font)", letterSpacing: ".2em", color: "var(--text-3)" }}>THE OFFICE</span>
          <span style={{ font: "800 54px/58px var(--font)", letterSpacing: ".06em", color: "var(--accent)" }}>CEO</span>
          <span style={{ font: "800 26px/32px var(--font)", color: "var(--text-1)", maxWidth: "80vw", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{named?.name}</span>
          <span style={{ font: "400 13px/18px var(--font)", color: "var(--text-3)" }}>Since today</span>
        </div>
      );
    }
    if (beat.kind === "crew") {
      const crew = office.slice(0, typeof innerWidth === "number" && innerWidth < 520 ? 6 : 10);
      return (
        <div style={{ display: "grid", justifyItems: "center", gap: "var(--s3)" }}>
          <span style={{ font: "700 13px/18px var(--font)", letterSpacing: ".14em", color: "var(--text-3)" }}>MEET THE OFFICE</span>
          <Balanced min={76} gap={6} style={{ width: "min(720px, 90vw)" }}>
            {crew.map((c, k) => (
              <div key={c.name} data-orb={c.hue} style={{ display: "grid", justifyItems: "center", minWidth: 0, animation: calm ? undefined : `orbs-arrive 520ms var(--m-spring) ${k * 90}ms both` }}>
                <Orb character={c} size={64} poke={false} gesture={{ name: "hop", n: 1 }} />
                <span style={{ font: "700 12px/16px var(--font)", color: "var(--accent)" }}>{c.name}</span>
              </div>
            ))}
          </Balanced>
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
      onClick={(e) => {
        if (!(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement)) advance();
      }}
      style={{
        position: "fixed", inset: 0, zIndex: 40, display: "grid", gridTemplateRows: "1fr auto", justifyItems: "center", gap: "var(--s4)",
        padding: "var(--s6) var(--margin) var(--s6)", background: "radial-gradient(60% 50% at 50% 35%, var(--accent-wash), transparent 70%), var(--ground)", cursor: beat.kind === "say" || beat.kind === "ceo" || beat.kind === "crew" ? "pointer" : "default",
      }}
    >
      <button onClick={() => setI(skipTo(named))} data-sound="tick" style={{ ...button, position: "absolute", top: "var(--s4)", right: "var(--margin)", font: "600 13px/18px var(--font)", padding: "6px 12px", minHeight: 32, color: "var(--text-3)" }}>
        Skip the story
      </button>
      <div style={{ alignSelf: "center", display: "grid", justifyItems: "center", minWidth: 0, maxWidth: "100%" }}>{stage()}</div>
      <div style={box} data-orb={who.hue}>
        {(beat.kind === "say" || beat.kind === "ask-name" || beat.kind === "hire") && (
          <span style={{ position: "absolute", top: -14, left: 18, font: "800 13px/18px var(--font)", letterSpacing: ".04em", color: "var(--text-1)", background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)", borderRadius: 999, padding: "4px 12px" }}>
            {beat.kind === "say" ? who.name : "Ash"}
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
        ) : beat.kind === "hire" ? (
          <div style={{ display: "grid", gap: "var(--s3)" }}>
            <span aria-label={full}>{shownText}</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button data-sound="create" onClick={() => finish("hire")} style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}>
                Hire my first orb
              </button>
              <button onClick={() => finish("office")} style={button}>
                Show me the office
              </button>
            </div>
          </div>
        ) : (
          <>
            <span aria-label={full || "Press to continue"}>{beat.kind === "say" ? shownText : beat.kind === "ceo" ? "You're hired." : "The whole office came to say hello."}</span>
            {!typing && <span aria-hidden style={{ position: "absolute", right: 20, bottom: 12, font: "800 14px/14px var(--font)", color: "var(--accent)", animation: calm ? undefined : "orbs-nudge 900ms ease-in-out infinite" }}>▼</span>}
          </>
        )}
      </div>
    </div>
  );
}
