// The office's culture (PLAN 5.45; owner, 10-14: "culture too, which is affected by everyones brand ... make it fun") and
// the CEO's brand watch (PLAN 5.46: "we want our CEO to be absolutely obsessed with it ... thats how he chooses and lets
// you know who to promote. and skills too"), on the org chart. Both are the home's, read off its log by code: the
// culture's score and parts, its flavour from the office's DNA, the traditions it keeps, the week's champion; every
// orb's brand and skills, the CEO's verdict on each, and whom it recommends (only you promote).
import { useEffect, useState, type CSSProperties } from "react";
import type { CultureState, Office, WatchState } from "../home/link.ts";
import { Tall } from "../ui/Balanced.tsx";

const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" };
const small: CSSProperties = { font: "500 13px/18px var(--font)", color: "var(--text-3)", textWrap: "pretty", overflowWrap: "anywhere" };
const card: CSSProperties = { display: "grid", gap: 10, alignContent: "start", padding: "var(--s4)", borderRadius: 18, background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", minWidth: 0 };
const REACH: Record<string, number> = { brands: 25, together: 15, floor: 10 };
const VERDICT: Record<string, { fill: string; ink: string }> = {
  Promote: { fill: "var(--accent-fill)", ink: "var(--accent)" },
  Rising: { fill: "var(--fill-2)", ink: "var(--text-1)" },
  Steady: { fill: "transparent", ink: "var(--text-3)" },
  "Brand first": { fill: "var(--fill-2)", ink: "var(--off)" },
  Watch: { fill: "transparent", ink: "var(--off)" },
};

function Ring({ score, label, size = 64 }: { score: number; label: string; size?: number }) {
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} style={{ position: "relative", width: size, height: size, flex: "0 0 auto", borderRadius: "50%", background: `conic-gradient(var(--accent) ${score * 3.6}deg, var(--fill-2) 0)` }}>
      <span style={{ position: "absolute", inset: 6, display: "grid", placeItems: "center", borderRadius: "50%", background: "var(--fill)", font: "800 22px/1 var(--font)", color: "var(--text-1)", fontVariantNumeric: "tabular-nums" }}>{score}</span>
    </div>
  );
}

/** The office's culture: its score, its flavour, the three parts, its traditions and the week's champion. */
export function CultureCard({ c }: { c: CultureState }) {
  return (
    <section aria-label="Culture" data-culture={c.score} style={{ ...card, background: "linear-gradient(160deg, var(--accent-wash), var(--fill) 60%)" }}>
      <span style={head}>Culture</span>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s3)", minWidth: 0 }}>
        <Ring score={c.score} label="The office's culture" />
        <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
          <span data-culture-word style={{ font: "800 18px/24px var(--font)", color: "var(--accent)" }}>{c.word}</span>
          <span data-culture-flavour style={small}>{c.flavour.length ? `A ${c.flavour.join(" and ")} office.` : "Its flavour comes with its orbs."}</span>
        </div>
      </div>
      <span style={small}>Everyone's brand makes most of it, then how the office gets on and the mood on the floor.</span>
      <ul aria-label="What makes it" style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
        {c.parts.map((p) => {
          const share = Math.min(1, Math.abs(p.points) / (REACH[p.key] ?? 25)) * 50;
          return (
            <li key={p.key} data-culture-part={p.key} style={{ display: "grid", gap: 3, minWidth: 0 }}>
              <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ ...small, color: "var(--text-2)", fontWeight: 700 }}>{p.label}</span>
                <b style={{ font: "800 13px/18px var(--font)", color: p.points > 0 ? "var(--accent)" : p.points < 0 ? "var(--off)" : "var(--text-3)", fontVariantNumeric: "tabular-nums" }}>{p.points > 0 ? `+${p.points}` : p.points}</b>
              </span>
              <span style={{ position: "relative", display: "block", height: 6, borderRadius: 3, background: "var(--fill-2)", overflow: "hidden" }}>
                <i style={{ position: "absolute", top: 0, bottom: 0, left: p.points < 0 ? `${50 - share}%` : "50%", width: `${share}%`, background: p.points < 0 ? "var(--off)" : "var(--accent)" }} />
              </span>
              <span style={small}>{p.why}</span>
            </li>
          );
        })}
      </ul>
      <div style={{ display: "grid", gap: 6 }}>
        <span style={{ ...small, color: "var(--text-2)", fontWeight: 700 }}>Traditions</span>
        {c.traditions.length ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {c.traditions.map((t) => (
              <span key={t.key} data-tradition={t.key} style={{ padding: "4px 10px", borderRadius: 999, background: "var(--fill-2)", font: "700 12px/16px var(--font)", color: "var(--text-1)" }}>
                {t.name} <span style={{ color: "var(--text-3)", fontWeight: 600 }}>{`×${t.times}`}</span>
              </span>
            ))}
          </div>
        ) : <span style={small}>None yet: what the office keeps doing becomes one.</span>}
      </div>
      {c.champion && (
        <span data-champion={c.champion.orb} style={{ font: "700 13px/18px var(--font)", color: "var(--text-1)" }}>
          {`Culture champion of the week: ${c.champion.name}, brand up ${c.champion.rise}.`}
        </span>
      )}
    </section>
  );
}

/** The CEO's brand watch: every orb's brand and skills, its verdict, and whom it recommends you promote. */
export function WatchCard({ w }: { w: WatchState }) {
  if (!w.ceo) return (
    <section aria-label="Brand watch" style={card}>
      <span style={head}>Brand watch</span>
      <span style={small}>No CEO yet: the CEO keeps the brand watch.</span>
    </section>
  );
  return (
    <section aria-label="Brand watch" data-watch={w.ceo.orb} style={card}>
      <span style={head}>{`${w.ceo.name}'s brand watch`}</span>
      <span style={small}>{`${w.ceo.name}, your CEO, checks every brand and every skill, and recommends who to promote by them. Only you promote.`}</span>
      {w.pick ? (
        <div data-watch-pick={w.pick.orb} style={{ display: "grid", gap: 2, padding: "10px 12px", borderRadius: 12, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}>
          <span style={{ font: "800 14px/20px var(--font)", color: "var(--text-1)" }}>{`Recommends ${w.pick.name} for ${w.pick.to}`}</span>
          <span style={{ ...small, color: "var(--text-2)" }}>{w.pick.why}</span>
        </div>
      ) : <span style={small}>No one to recommend yet: ready by the work, and a brand of 50 or more.</span>}
      <Tall max="40dvh" label="Every orb's brand and skills">
        <ul aria-label="Every orb's brand and skills" style={{ display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
          {w.rows.map((r) => (
            <li key={r.orb} data-watch-orb={r.orb} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "center" }}>
              <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
                <span style={{ display: "flex", gap: 6, alignItems: "baseline", minWidth: 0 }}>
                  <b style={{ font: "700 13px/18px var(--font)", color: "var(--text-1)" }}>{r.name}</b>
                  <span style={{ ...small, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.skill ? `${r.skill.xp.toLocaleString("en-GB")} XP in ${r.skill.area}` : "no skills shown yet"}</span>
                </span>
                <span style={{ display: "block", height: 6, borderRadius: 3, background: "var(--fill-2)", overflow: "hidden" }}>
                  <i style={{ display: "block", height: "100%", width: `${r.brand}%`, background: r.brand < 40 ? "var(--off)" : "var(--accent)", opacity: 0.85 }} />
                </span>
              </span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <b data-watch-brand style={{ font: "800 13px/18px var(--font)", color: "var(--text-1)", fontVariantNumeric: "tabular-nums" }}>{r.brand}</b>
                <span style={{ ...small, minWidth: "3.2ch", fontVariantNumeric: "tabular-nums", color: r.week > 0 ? "var(--accent)" : r.week < 0 ? "var(--off)" : "var(--text-3)" }}>{r.week > 0 ? `▲${r.week}` : r.week < 0 ? `▼${-r.week}` : "–"}</span>
                <span data-verdict={r.verdict} style={{ padding: "2px 8px", borderRadius: 999, font: "700 11px/16px var(--font)", whiteSpace: "nowrap", background: VERDICT[r.verdict]!.fill, color: VERDICT[r.verdict]!.ink, boxShadow: "inset 0 0 0 1px var(--hairline)" }}>{r.verdict}</span>
              </span>
            </li>
          ))}
        </ul>
      </Tall>
    </section>
  );
}

/** Both, side by side on a desk: loaded from the home, again whenever a brand, the culture or the office moves. */
export function CultureAndWatch({ home }: { home: Office }) {
  const [c, setC] = useState<CultureState | null>(null);
  const [w, setW] = useState<WatchState | null>(null);
  useEffect(() => {
    const load = (): void => {
      void home.culture().then(setC, () => setC(null));
      void home.brandWatch().then(setW, () => setW(null));
    };
    load();
    return home.watch({ event: (e) => void (/^(brand\.|culture\.|ceo\.|social\.|xp\.|orb\.|report\.idea_|card\.resolved|trace\.feedback)/.test(e.type) && load()) });
  }, [home]);
  if (!c && !w) return null;
  return (
    <div className="orbs-pair" style={{ display: "grid", gap: "var(--s4)", minWidth: 0 }}>
      {c && <CultureCard c={c} />}
      {w && <WatchCard w={w} />}
    </div>
  );
}
