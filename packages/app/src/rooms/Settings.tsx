// Settings (owner, 2026-10-01: "back button on the side menu, that brings you to different tabs").
// What is the person's to set, in the app: what the office calls you, the sounds, how every orb
// replies, and the opening story again. Brains (ChatGPT, one Gemini key, a local coder) are the
// home's (PLAN 1.11), and are chosen here once the app talks to it (2.4); until then it says so.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { REPLIES, type Replies } from "../orb/spec.ts";
import { OneLine } from "../ui/Balanced.tsx";
import { checkName, type Person } from "../onboarding/story.ts";
import type { Office } from "../home/link.ts";
import { Devices } from "./Devices.tsx";
import { Brains } from "./Brains.tsx";

const panel: CSSProperties = { display: "grid", gap: "var(--s3)", padding: "var(--s4)", borderRadius: 18, background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", minWidth: 0 };
const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)", margin: 0 };
const chip = (on: boolean): CSSProperties => ({
  font: "600 13px/18px var(--font)", border: 0, borderRadius: 999, padding: "6px 12px", cursor: "pointer", minHeight: 32,
  background: on ? "var(--accent-fill)" : "var(--fill)", color: on ? "var(--text-1)" : "var(--text-2)", boxShadow: on ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 .5px var(--hairline)",
});
const button: CSSProperties = { font: "600 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 14px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 36 };

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={panel} aria-label={title}>
      <h3 style={head}>{title}</h3>
      {children}
    </section>
  );
}

export function Settings(o: {
  person: Person | null;
  rename: (p: Person) => void;
  sounds: boolean;
  setSounds: (on: boolean) => void;
  replies: Replies;
  setReplies: (r: Replies) => void;
  replayIntro: () => void;
  /** A preview only (no home behind the page): fill the office with a demo crew, to look round. */
  fillDemo?: () => void;
  /** The home behind the page, for your devices and passkeys (PLAN 2.7). */
  home?: Office | null;
}) {
  const [draft, setDraft] = useState(o.person?.name ?? "");
  useEffect(() => {
    setDraft(o.person?.name ?? ""); // the home's "about you" can arrive after the room opens
  }, [o.person?.name]);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const save = (): void => {
    const r = checkName(draft);
    if (!r.ok) return setSaid({ ok: false, text: r.why });
    o.rename({ name: r.name, since: o.person?.since ?? Date.now() });
    setSaid({ ok: true, text: `The office calls you ${r.name} now.` });
  };
  return (
    <div style={{ display: "grid", gap: "var(--s4)", padding: "var(--s5)", alignContent: "start", maxWidth: 720, width: "100%", justifySelf: "center" }}>
      <h2 style={{ margin: 0, font: "800 28px/34px var(--font)", color: "var(--text-1)" }}>Settings</h2>
      <Panel title="You">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          style={{ display: "flex", gap: 8, flexWrap: "nowrap" }}
        >
          <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="What the office calls you" size={1} maxLength={40} style={{ flex: "1 1 160px", minWidth: 0, font: "600 16px/22px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 12px", outline: 0, boxShadow: "inset 0 0 0 1px var(--hairline)" }} />
          <button type="submit" style={button}>
            Save
          </button>
        </form>
        {said && <span style={{ font: "500 13px/18px var(--font)", color: said.ok ? "var(--text-3)" : "var(--alert)" }}>{said.text}</span>}
        <button onClick={o.replayIntro} style={{ ...button, justifySelf: "start" }}>
          Play the opening story again
        </button>
      </Panel>
      <Panel title="Sounds">
        <OneLine style={{ justifyContent: "flex-start" }}>
          <button aria-pressed={o.sounds} onClick={() => o.setSounds(true)} style={chip(o.sounds)}>
            On
          </button>
          <button aria-pressed={!o.sounds} onClick={() => o.setSounds(false)} data-sound="none" style={chip(!o.sounds)}>
            Off
          </button>
        </OneLine>
      </Panel>
      <Panel title="Replies, for every orb">
        <OneLine style={{ justifyContent: "flex-start" }}>
          {(Object.keys(REPLIES) as Replies[]).map((r) => (
            <button key={r} aria-pressed={o.replies === r} onClick={() => o.setReplies(r)} style={chip(o.replies === r)}>
              {REPLIES[r]}
            </button>
          ))}
        </OneLine>
      </Panel>
      {o.fillDemo && (
        <Panel title="A preview">
          <span style={{ font: "400 14px/20px var(--font)", color: "var(--text-2)" }}>This page has no home behind it, so it keeps your office in this browser. Want company to look round with?</span>
          <button onClick={o.fillDemo} style={{ ...button, justifySelf: "start" }}>
            Fill the office with a demo crew
          </button>
        </Panel>
      )}
      {o.home ? (
        <Brains home={o.home} />
      ) : (
        <Panel title="Brains">
          <span style={{ font: "400 14px/20px var(--font)", color: "var(--text-2)" }}>
            Your orbs think with ChatGPT first, then a Gemini key, then a local coder. You choose them here once this app is connected to your home.
          </span>
        </Panel>
      )}
      {o.home && <Devices home={o.home} />}
    </div>
  );
}
