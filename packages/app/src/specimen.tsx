// The design system's own page (PLAN 2.1): every token as it renders, so the owner decides by
// looking and the render harness has something real to measure. Phone first; the card grows into
// two columns on a wide screen. Every colour comes from the tokens: this file names none.
import { StrictMode, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { HUES, hue, orbAttr, stylesheet, TYPE, type Hue, type TypeStyle } from "./design/tokens.ts";
import { Balanced, OneLine } from "./ui/Balanced.tsx";

const page: CSSProperties = { maxWidth: 1040, margin: "0 auto", padding: "var(--s6) var(--margin) var(--s7)" };
const glass: CSSProperties = {
  background: "var(--card)",
  borderRadius: "var(--r-card)",
  boxShadow: "inset 0 0 0 .5px var(--hairline), 0 24px 60px var(--shadow)",
  padding: "var(--s5) var(--margin)",
};
const raised: CSSProperties = { background: "var(--raised)", borderRadius: "var(--r-inner)", padding: "var(--s3) var(--s4)" };
const label: CSSProperties = { font: "var(--t-caption)", color: "var(--text-3)", letterSpacing: ".04em", textTransform: "uppercase" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: "var(--s6)" }}>
      <h2 style={{ ...label, margin: "0 0 var(--s3)" }}>{title}</h2>
      {children}
    </section>
  );
}

/** A small glass bead of the orb's colour, as the widgets' header dot. */
function Bead() {
  return <span aria-hidden style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: "var(--accent)", boxShadow: "inset 0 0 0 .5px var(--hairline)" }} />;
}

function OrbName({ h, children }: { h: Hue; children?: ReactNode }) {
  return (
    <span {...orbAttr(h)} style={{ display: "inline-flex", alignItems: "center", gap: "var(--s2)", color: "var(--accent)", font: "var(--t-headline)" }}>
      <Bead />
      {children ?? h.name[0]!.toUpperCase() + h.name.slice(1)}
    </span>
  );
}

function TypeRow({ name }: { name: TypeStyle }) {
  const [size, line, weight] = TYPE[name];
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "var(--s4)", minWidth: 0, padding: "var(--s1) 0" }}>
      <span className="num" style={{ ...label, flex: "0 0 92px", textTransform: "none", letterSpacing: 0 }}>
        {name} {size}/{line}
      </span>
      <span style={{ font: `var(--t-${name})`, color: weight >= 600 ? "var(--text-1)" : "var(--text-2)", minWidth: 0 }}>
        {size >= 22 ? "Juniper" : "Juniper finished the invoice"}
      </span>
    </div>
  );
}

function Swatch({ name, varName, text }: { name: string; varName: string; text?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--s3)", minWidth: 0 }}>
      <span
        aria-hidden
        style={{
          flex: "0 0 auto", width: 40, height: 40, borderRadius: "var(--r-control)",
          background: text ? "var(--ground)" : `var(${varName})`, boxShadow: "inset 0 0 0 .5px var(--hairline)",
          display: "grid", placeItems: "center", color: text ? `var(${varName})` : undefined, font: "var(--t-headline)",
        }}
      >
        {text ? "Aa" : null}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", font: "var(--t-subhead)", color: "var(--text-1)" }}>{name}</span>
        <span style={{ display: "block", font: "var(--t-caption)", color: "var(--text-3)" }}>{varName}</span>
      </span>
    </div>
  );
}

function Chat() {
  const ash = hue("azure");
  return (
    <div style={{ display: "grid", gap: "var(--s3)" }}>
      <div style={{ ...raised, justifySelf: "end", maxWidth: "85%", color: "var(--text-1)" }}>Can you draft the invoice for the Halden job?</div>
      <div style={{ display: "grid", gap: "var(--s1)", maxWidth: "92%" }}>
        <OrbName h={ash}>Ash</OrbName>
        <div style={{ color: "var(--text-2)" }}>
          Done: <span className="num">3 items, $1,240.00</span>. It's in your drafts, not sent.
        </div>
      </div>
      <div style={{ ...raised, display: "grid", gap: "var(--s2)", boxShadow: "inset 0 0 0 .5px var(--hairline)" }}>
        <span style={{ font: "var(--t-headline)", color: "var(--text-1)" }}>Ash wants to email the invoice to Halden</span>
        <span style={{ font: "var(--t-footnote)", color: "var(--text-3)" }}>It asks because sending is messaging someone new.</span>
        <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap" }}>
          <button {...orbAttr(ash)} style={{ ...button, color: "var(--accent)" }}>Approve</button>
          <button style={button}>Not now</button>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)", color: "var(--alert)", font: "var(--t-footnote)" }}>
        <span aria-hidden>▲</span> Usage limit reached. Review your plan in ChatGPT settings.
      </div>
    </div>
  );
}

const button: CSSProperties = {
  font: "var(--t-headline)", color: "var(--text-1)", background: "var(--raised)", border: 0, cursor: "pointer",
  borderRadius: "var(--r-pill)", padding: "var(--s2) var(--s4)", minHeight: 44, boxShadow: "inset 0 0 0 .5px var(--hairline)",
};

function Specimen() {
  const [theme, setTheme] = useState<"dark" | "light" | null>(() => (document.documentElement.dataset.theme as "dark" | "light" | undefined) ?? null);
  const pick = (t: "dark" | "light"): void => {
    document.documentElement.dataset.theme = t;
    setTheme(t);
  };
  return (
    <main style={page}>
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "end", justifyContent: "space-between", gap: "var(--s4)" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ font: "var(--t-large)", color: "var(--text-1)", margin: 0, letterSpacing: "-.01em" }}>Orbz</h1>
          <p style={{ font: "var(--t-subhead)", color: "var(--text-3)", margin: "var(--s1) 0 0" }}>The design system: every token, as it renders.</p>
        </div>
        <div role="group" aria-label="Theme" style={{ display: "flex", gap: "var(--s2)" }}>
          {(["dark", "light"] as const).map((t) => (
            <button key={t} onClick={() => pick(t)} aria-pressed={theme === t} style={{ ...button, font: "var(--t-subhead)", color: theme === t ? "var(--text-1)" : "var(--text-3)" }}>
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </header>

      <div style={{ ...glass, marginTop: "var(--s5)", display: "grid", gap: "0 var(--s6)", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))" }}>
        <div style={{ minWidth: 0 }}>
          <Section title="Orb colours: the only accent">
            <Balanced min={120} gap={10}>
              {HUES.map((h) => (
                <OrbName key={h.name} h={h} />
              ))}
            </Balanced>
          </Section>
          <Section title="In a chat">
            <Chat />
          </Section>
        </div>
        <div style={{ minWidth: 0 }}>
          <Section title="Type: Nunito, Apple's scale">
            {(Object.keys(TYPE) as TypeStyle[]).reverse().map((n) => (
              <TypeRow key={n} name={n} />
            ))}
          </Section>
          <Section title="Surfaces and text">
            <Balanced min={150} gap={12}>
              <Swatch name="Ground" varName="--ground" />
              <Swatch name="Glass card" varName="--card" />
              <Swatch name="Raised" varName="--raised" />
              <Swatch name="Title" varName="--text-1" text />
              <Swatch name="Reading" varName="--text-2" text />
              <Swatch name="Secondary" varName="--text-3" text />
              <Swatch name="Alert" varName="--alert" text />
            </Balanced>
          </Section>
          <Section title="The grid">
            <OneLine gap={8} style={{ alignItems: "end", justifyContent: "flex-start" }}>
              {[4, 8, 12, 16, 24, 32, 48, 64].map((px) => (
                <div key={px} style={{ display: "grid", justifyItems: "center", gap: "var(--s1)" }}>
                  <span aria-hidden style={{ width: px, height: px, borderRadius: 4, background: "var(--raised)", boxShadow: "inset 0 0 0 .5px var(--hairline)" }} />
                  <span className="num" style={{ font: "var(--t-caption2)", color: "var(--text-3)" }}>
                    {px}
                  </span>
                </div>
              ))}
            </OneLine>
          </Section>
        </div>
      </div>
    </main>
  );
}

const style = document.createElement("style");
style.textContent = stylesheet(`${import.meta.env.BASE_URL}fonts/Nunito.ttf`);
document.head.append(style);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Specimen />
  </StrictMode>,
);
