// Settings (owner, 2026-10-01: "back button on the side menu, that brings you to different tabs").
// What is the person's to set, in the app: what the office calls you, the sounds, how every orb
// replies, and the opening story again. Brains (ChatGPT, one Gemini key, a local coder) are the
// home's (PLAN 1.11), and are chosen here once the app talks to it (2.4); until then it says so.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { REPLIES, type Replies } from "../orb/spec.ts";
import { Balanced, OneLine } from "../ui/Balanced.tsx";
import { applyTheme, savedTheme } from "../ui/theme.ts";
import { baseOf, HUES, SURFACES, THEMES, type ThemeId } from "../design/tokens.ts";
import { hex } from "../design/color.ts";
import { checkName, type Person } from "../onboarding/story.ts";
import { BudgetChoice } from "../ui/Budget.tsx";
import type { Office, ProjectsState } from "../home/link.ts";
import { Devices } from "./Devices.tsx";
import { Brains } from "./Brains.tsx";
import { Connections } from "./Connections.tsx";
import { Passwords } from "./Passwords.tsx";
import { useCramped } from "../ui/fill.ts";

const panel: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "var(--s3)", padding: "var(--s4)", borderRadius: 18, background: "var(--fill)", boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0 };
const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)", margin: 0 };
const chip = (on: boolean): CSSProperties => ({
  font: "600 13px/18px var(--font)", border: 0, borderRadius: 999, padding: "6px 12px", cursor: "pointer", minHeight: 32,
  background: on ? "var(--accent-fill)" : "var(--fill)", color: on ? "var(--text-1)" : "var(--text-2)", boxShadow: on ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 .5px var(--hairline)",
});
const button: CSSProperties = { font: "600 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 14px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 36 };

/** Settings in sections, each with its place in the index (owner, 10-10: "organize it professionally ... just organize the
 * containers better"): beside them on a wide screen, the one you are in lit as you scroll; a row along the top on a
 * narrow one. Links, not buttons: an index is a way round the page. */
const SECTIONS = [["you", "You"], ["budget", "Budget"], ["theme", "Theme"], ["sound", "Sounds and replies"], ["preview", "A preview"], ["folder", "Projects folder"], ["brains", "Brains"], ["connections", "Connections"], ["passwords", "Passwords"], ["devices", "Devices"]] as const;
type SectionId = (typeof SECTIONS)[number][0];
const sectionStyle: CSSProperties = { display: "grid", gap: "var(--s4)", minWidth: 0, scrollMarginTop: "var(--s4)" };

function Index({ ids, active, wide }: { ids: SectionId[]; active: SectionId | null; wide: boolean }) {
  const jump = (id: SectionId): void => {
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const items = SECTIONS.filter(([id]) => ids.includes(id)).map(([id, label]) => (
    <a key={id} href="#/settings" data-jump={id} aria-current={active === id ? "location" : undefined}
      onClick={(e) => {
        e.preventDefault();
        jump(id);
      }}
      style={{ font: "600 13px/18px var(--font)", textDecoration: "none", whiteSpace: "nowrap", borderRadius: wide ? 10 : 999, padding: wide ? "7px 12px" : "6px 12px", color: active === id ? "var(--text-1)" : "var(--text-3)", background: active === id ? "var(--fill-2)" : wide ? "transparent" : "var(--fill)", boxShadow: !wide && active !== id ? "inset 0 0 0 .5px var(--hairline)" : undefined }}>
      {label}
    </a>
  ));
  return wide ? (
    <nav aria-label="Settings sections" className="orbs-settings-index" style={{ position: "sticky", top: "var(--s4)", display: "grid", gap: 2, alignContent: "start" }}>
      {items}
    </nav>
  ) : (
    <nav aria-label="Settings sections">
      <OneLine style={{ justifyContent: "flex-start" }}>{items}</OneLine>
    </nav>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={panel} aria-label={title}>
      <h3 style={head}>{title}</h3>
      {children}
    </section>
  );
}

/** Your projects folder (owner, 10-04: "all projects should also go into a file, add that in settings"):
 * where the home copies every project's files after each run, on or off, and Copy now. */
function ProjectsFolder({ home }: { home: Office }) {
  const [p, setP] = useState<ProjectsState | null>(null);
  const [dir, setDir] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    void home.projects().then((x) => (setP(x), setDir(x.dir)), (e: Error) => setSaid(e.message));
  }, [home]);
  const act = (f: Promise<ProjectsState>): void => void f.then((x) => (setP(x), setDir(x.dir), setSaid(null)), (e: Error) => setSaid(e.message));
  if (!p) return null;
  const ago = p.last ? Math.max(0, Math.round((Date.now() - p.last.at) / 60000)) : null;
  return (
    <Panel title="Your projects folder">
      <span style={{ font: "400 14px/20px var(--font)", color: "var(--text-2)" }}>
        Every project's files, copied where you can open them: each session under its name, each orb's own work under theirs. After every finished task, and whenever you say. Nothing there is ever deleted.
      </span>
      <form onSubmit={(e) => (e.preventDefault(), act(home.setProjects({ dir })))} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input value={dir} onChange={(e) => setDir(e.target.value)} aria-label="Projects folder" size={1} style={{ flex: "1 1 260px", minWidth: 0, font: "500 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 12px", boxShadow: "inset 0 0 0 1px var(--hairline)" }} />
        <button type="submit" disabled={dir.trim() === p.dir} style={{ ...button, opacity: dir.trim() === p.dir ? 0.5 : 1 }}>Use this folder</button>
      </form>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <button aria-pressed={p.on} onClick={() => act(home.setProjects({ on: !p.on }))} style={chip(p.on)}>{p.on ? "Copying: on" : "Copying: off"}</button>
        <button onClick={() => act(home.syncProjects())} disabled={!p.on} style={{ ...button, opacity: p.on ? 1 : 0.5 }}>Copy now</button>
      </div>
      <div>
        <span data-projects-last style={{ font: "400 13px/18px var(--font)", color: "var(--text-3)" }}>
          {!p.on ? "Off: nothing is copied" : p.last ? `Last copied ${ago === 0 ? "just now" : `${ago} min ago`}: ${p.last.files} ${p.last.files === 1 ? "file" : "files"} new or changed` : "Not copied yet"}
        </span>
      </div>
      {(said ?? p.why) && <span role="alert" style={{ font: "500 13px/18px var(--font)", color: "var(--alert)" }}>{said ?? p.why}</span>}
    </Panel>
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
  const [theme, setTheme] = useState<ThemeId | null>(savedTheme);
  const wide = useCramped("(min-width: 1100px)");
  const ids: SectionId[] = ["you", ...(o.person ? ["budget" as const] : []), "theme", "sound", ...(o.fillDemo ? ["preview" as const] : []), ...(o.home ? ["folder" as const] : []), "brains", ...(o.home ? ["connections" as const, "passwords" as const, "devices" as const] : [])];
  // the section you are in: the last whose top has passed a fifth of the way down the screen
  const [active, setActive] = useState<SectionId | null>("you");
  useEffect(() => {
    const at = (): void => {
      const line = innerHeight * 0.2;
      let on: SectionId | null = null;
      for (const id of ids) {
        const el = document.getElementById(`settings-${id}`);
        if (el && el.getBoundingClientRect().top <= line) on = id;
      }
      setActive(on ?? ids[0] ?? null);
    };
    at();
    addEventListener("scroll", at, { passive: true });
    return () => removeEventListener("scroll", at);
  }, [ids.join(",")]);
  const wear = (t: ThemeId | null): void => {
    applyTheme(t);
    setTheme(t);
  };
  const save = (): void => {
    const r = checkName(draft);
    if (!r.ok) return setSaid({ ok: false, text: r.why });
    o.rename({ ...o.person, name: r.name, since: o.person?.since ?? Date.now() }); // your company and its budget kept
    setSaid({ ok: true, text: `The office calls you ${r.name} now.` });
  };
  return (
    <div className="orbs-settings" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "var(--s4) var(--s5)", padding: "var(--s5)", alignContent: "start", alignItems: "start", width: "100%" }}>
      <h2 style={{ gridColumn: "1 / -1", margin: 0, font: "800 28px/34px var(--font)", color: "var(--text-1)" }}>Settings</h2>
      <Index ids={ids} active={active} wide={wide} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: "var(--s4)", minWidth: 0, maxWidth: 760 }}>
      <div id="settings-you" style={sectionStyle}>
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
      </div>
      {o.person && (
        // what the company can spend (PLAN 5.20; owner, 10-08: "Lets be able to change the budget as well")
        <div id="settings-budget" style={sectionStyle}>
        <Panel title="Budget">
          <span style={{ font: "400 14px/20px var(--font)", color: "var(--text-2)", textWrap: "pretty" }}>
            {`What ${o.person.company ?? "your company"} can spend, to start and each month, on hosting, tools and ads. The board's ideas to make money fit it, and every orb keeps to it.${o.person.budget ? "" : " Not said yet, so it is taken as nothing."}`}
          </span>
          <BudgetChoice value={o.person.budget ?? null} onPick={(b) => o.rename({ ...o.person!, budget: b })} />
        </Panel>
        </div>
      )}
      <div id="settings-theme" style={sectionStyle}>
      <Panel title="Theme">
        <Balanced min={118} gap={8}>
          {([null, ...(Object.keys(THEMES) as ThemeId[])] as (ThemeId | null)[]).map((t) => (
            <button key={t ?? "system"} data-theme-choice={t ?? "system"} aria-pressed={theme === t} onClick={() => wear(t)} style={{ ...chip(theme === t), display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-start" }}>
              {/* the theme in small: its page, its card and Ash's azure as it wears it */}
              <span aria-hidden style={{ display: "flex", flex: "0 0 auto", borderRadius: 8, overflow: "hidden", boxShadow: "inset 0 0 0 1px var(--hairline)" }}>
                {(t ? [SURFACES[t].ground, SURFACES[t].card, HUES[0]![baseOf(t)]] : [SURFACES.dark.card, SURFACES.light.card, HUES[0]!.dark]).map((c, k) => (
                  <i key={k} style={{ width: 12, height: 22, background: hex(c) }} />
                ))}
              </span>
              <span>{t ? THEMES[t].label : "System"}</span>
            </button>
          ))}
        </Balanced>
        <span style={{ font: "400 12px/17px var(--font)", color: "var(--text-3)" }}>System follows this device's light or dark. Your choice is kept on this device.</span>
      </Panel>
      </div>
      {/* two small ones side by side where there is room */}
      <div id="settings-sound" className="orbs-settings-pair" style={{ ...sectionStyle, gridTemplateColumns: "minmax(0, 1fr)", alignItems: "stretch" }}>
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
      </div>
      {o.fillDemo && (
        <div id="settings-preview" style={sectionStyle}>
        <Panel title="A preview">
          <span style={{ font: "400 14px/20px var(--font)", color: "var(--text-2)" }}>This page has no home behind it, so it keeps your office in this browser. Want company to look round with?</span>
          <button onClick={o.fillDemo} style={{ ...button, justifySelf: "start" }}>
            Fill the office with a demo crew
          </button>
        </Panel>
        </div>
      )}
      {o.home && <div id="settings-folder" style={sectionStyle}><ProjectsFolder home={o.home} /></div>}
      <div id="settings-brains" style={sectionStyle}>
      {o.home ? (
        <Brains home={o.home} />
      ) : (
        <Panel title="Brains">
          <span style={{ font: "400 14px/20px var(--font)", color: "var(--text-2)" }}>
            Your orbs think with ChatGPT first, then a Gemini key, then a local coder. You choose them here once this app is connected to your home.
          </span>
        </Panel>
      )}
      </div>
      {o.home && <div id="settings-connections" style={sectionStyle}><Connections home={o.home} /></div>}
      {o.home && <div id="settings-passwords" style={sectionStyle}><Passwords home={o.home} /></div>}
      {o.home && <div id="settings-devices" style={sectionStyle}><Devices home={o.home} /></div>}
      </div>
    </div>
  );
}
