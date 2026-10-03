// The opening splash (PLAN 2.14; owner, 10-01: "a beautiful loading splash and screen when we open
// it, kinda like ash's"). Ash's boot is him waking up (eyes shut, a blink, a little bounce) while
// the facts arrive and the router is really probed, so the animation IS the wait and the screen
// cannot claim a link that is not there. Here it is the office waking up: the orbs pop in one by
// one, asleep, and wake; the wordmark; a few facts, each arriving in turn; and the splash leaves
// once the animation has played AND what it waits for has answered. What it waits for is
// `ready`: the fonts and the first frame now, the home's door when the app talks to it (2.4).
// If that fails, it says so plainly, with what went wrong and a way to try again.
//
// `?splash=0` skips it (the render checks, the way Ash's ASH_BOOT=0 does); so does a person who
// asked their system for less motion, after a moment's still frame.
import { useEffect, useState, type CSSProperties } from "react";
import { Orb } from "../orb/Orb.tsx";
import type { Character } from "../orb/spec.ts";

import { STAGGER_MS, WAKE_MS } from "./splash.ts";
export { WAKE_MS } from "./splash.ts";

declare global {
  /** A test's stand-in for what the splash waits on (a slow home, a refused one). */
  var __orbsReady: Promise<unknown> | undefined;
}

export const splashWanted = (): boolean => {
  try {
    return new URLSearchParams(location.search).get("splash") !== "0";
  } catch {
    return true;
  }
};

/** `onLeaving` is told when it starts to fade, so what is under it can begin to draw (drawing it
 * all the while behind the veil would only slow the waking down). */
export function Splash({ office, facts, ready, onLeaving, onDone, signIn }: {
  office: Character[]; facts: string[]; ready: () => Promise<unknown>; onLeaving?: () => void; onDone: () => void;
  /** A browser that is not signed in can sign in with the owner's passkey (PLAN 2.7), then the home opens. */
  signIn?: () => Promise<void>;
}) {
  const [phase, setPhase] = useState<"waking" | "waiting" | "leaving" | "failed">("waking");
  const [why, setWhy] = useState("");
  const [tries, setTries] = useState(0);
  const calm = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  // seven across a desk, five on a phone: the row never spills (the layout rule, 2.1)
  const narrow = typeof innerWidth === "number" && innerWidth < 520;
  const shown = office.slice(0, narrow ? 5 : 7);
  const big = narrow ? 80 : 96, small = narrow ? 52 : 64;

  useEffect(() => {
    let live = true;
    setPhase("waking");
    // when the waking really starts (after the first orb's shader is built, which a slow machine
    // takes its time over): a performance mark, so a check can time the waking from it
    performance.mark("orbs-splash-wake");
    const waited = Promise.all([ready(), new Promise((r) => setTimeout(r, calm ? 300 : WAKE_MS))]);
    const slow = setTimeout(() => live && setPhase((p) => (p === "waking" ? "waiting" : p)), WAKE_MS + 50);
    waited.then(
      () => {
        if (!live) return;
        setPhase("leaving");
        onLeaving?.();
        setTimeout(() => live && onDone(), calm ? 0 : 380);
      },
      (e: unknown) => {
        if (!live) return;
        setWhy(e instanceof Error ? e.message : String(e));
        setPhase("failed");
      },
    );
    return () => {
      live = false;
      clearTimeout(slow);
    };
  }, [tries]);

  const retry: CSSProperties = { font: "600 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 16px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 36 };
  const veil: CSSProperties = {
    position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", alignContent: "center", gap: "var(--s5)",
    padding: "var(--s5) var(--margin)", background: "radial-gradient(60% 50% at 50% 40%, var(--accent-wash), transparent 70%), var(--ground)",
    opacity: phase === "leaving" ? 0 : 1, transition: "opacity 380ms var(--m-physical)", pointerEvents: phase === "leaving" ? "none" : "auto",
  };
  return (
    <div role="status" aria-live="polite" aria-label="Orbz is opening" data-splash={phase} style={veil}>
      <div style={{ display: "flex", flexWrap: "nowrap", justifyContent: "center", alignItems: "end", gap: 4, maxWidth: "100%" }}>
        {shown.map((c, i) => (
          <div key={c.name} style={{ animation: calm ? undefined : `orbs-arrive 520ms var(--m-spring) ${i * STAGGER_MS}ms both`, minWidth: 0 }}>
            <Orb character={c} size={i === Math.floor(shown.length / 2) ? big : small} poke={false} fidget={false} gesture={phase === "leaving" ? { name: "hop", n: 1 } : { name: "doze", n: 0 }} />
          </div>
        ))}
      </div>
      <div style={{ display: "grid", justifyItems: "center", gap: "var(--s2)", textAlign: "center" }}>
        <span style={{ font: "800 40px/44px var(--font)", letterSpacing: ".18em", color: "var(--text-1)", animation: calm ? undefined : "orbs-arrive 600ms var(--m-spring) 240ms both" }}>ORBZ</span>
        {phase === "failed" ? (
          <div style={{ display: "grid", justifyItems: "center", gap: "var(--s3)" }}>
            <span style={{ font: "600 15px/21px var(--font)", color: "var(--alert)", maxWidth: 520, textWrap: "balance" }}>Can't reach your home: {why}</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {signIn && /not signed in/.test(why) && (
                <button
                  data-sound="pick"
                  onClick={() => signIn().then(() => setTries((n) => n + 1), (e: unknown) => setWhy(e instanceof Error ? e.message : String(e)))}
                  style={{ ...retry, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}
                >
                  Sign in with your passkey
                </button>
              )}
              <button onClick={() => setTries((n) => n + 1)} style={retry}>
                Try again
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", justifyItems: "center", gap: 2 }}>
            {[...facts, ...(phase === "waiting" ? ["Waking your home…"] : [])].map((f, i) => (
              <span key={f} style={{ font: "400 13px/18px var(--font)", color: "var(--text-3)", animation: calm ? undefined : `orbs-fact 400ms var(--m-physical) ${500 + i * 160}ms both` }}>
                {f}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
