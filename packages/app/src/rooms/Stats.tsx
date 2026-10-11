// The numbers behind the home page, as charts (PLAN 2.19; owner, 10-08: "when we press on brain today it brings us to
// settings? how about a chart with all the stats of tokens? lol"; "same for xp this week"): #/stats/brain and #/stats/xp,
// each a press from its number on the home page. The brains' tokens by day (read fresh, read from the cache, written),
// by model, kind of turn and orb, with the share the cache served; XP by day (earned, and taken back) and by orb; the
// last 7, 14 or 30 days. The sums are the home's (home/src/stats.ts); the bars are drawn here in the theme's colours.
import { useEffect, useState, type CSSProperties } from "react";
import type { Character, OrbHue } from "../orb/spec.ts";
import type { HueName } from "../design/tokens.ts";
import { idOf, type Office, type StatsState, type TokenCount } from "../home/link.ts";
import type { Route } from "../ui/nav.ts";
import { Balanced } from "../ui/Balanced.tsx";
import { short } from "./Home.tsx";

const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" };
const small: CSSProperties = { font: "500 13px/18px var(--font)", color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 };
const card: CSSProperties = { display: "grid", gap: 12, alignContent: "start", padding: "var(--s4)", borderRadius: 18, background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", minWidth: 0 };
const button: CSSProperties = { font: "600 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 14px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 36 };
/** The bars' colours, in turn, for what has no colour of its own (a model, a kind of turn). */
const HUES: HueName[] = ["azure", "mint", "honey", "violet", "coral", "teal", "rose", "citron"];
const RANGES = [7, 14, 30] as const;

/** A kind of turn in words (home/src/brain/cost.ts names them). */
const KIND_WORDS: Record<string, string> = {
  lead: "A session's lead", chime: "Joining in", asked: "Asked by a teammate", work: "Work",
  summary: "A summary", note: "A note", board: "The board", report: "The daily report",
  chat: "A chat or a schedule", other: "With no conversation",
};

const tokensOf = (t: TokenCount): number => t.input + t.output;
const cacheShare = (t: TokenCount): number => (t.input ? Math.round((100 * t.cached) / t.input) : 0);
const plural = (n: number, one: string): string => `${short(n)} ${n === 1 ? one : `${one}s`}`;
const dayWords = (d: string, o: Intl.DateTimeFormatOptions): string => new Date(`${d}T12:00`).toLocaleDateString("en-GB", o);

export function StatsRoom({ home, office, tab, go }: { home: Office | null; office: Character[]; tab: "brain" | "xp"; go: (r: Route) => void }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(7);
  const [s, setS] = useState<StatsState | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    if (!home) return;
    const load = (): void => void home.stats(days).then(setS, (e: Error) => setSaid(e.message));
    load();
    // live, but at most every few seconds: a brain is called many times a minute when the office is busy
    let wait = 0;
    const stop = home.watch({
      event: (e) => {
        if (wait || !(e.type === "brain.spend" || e.type.startsWith("xp."))) return;
        wait = window.setTimeout(() => ((wait = 0), load()), 4_000);
      },
    });
    return () => {
      stop();
      window.clearTimeout(wait);
    };
  }, [home, days]);
  if (!home) {
    return (
      <div style={{ display: "grid", placeItems: "center", alignContent: "center", gap: "var(--s3)", padding: "var(--s7) var(--s5)", textAlign: "center" }}>
        <span style={{ font: "700 20px/26px var(--font)", color: "var(--text-1)" }}>The charts read your home</span>
        <span style={{ font: "400 15px/21px var(--font)", color: "var(--text-3)", maxWidth: 440 }}>What the brains spent and the XP your orbs earned are kept there. Start it (pnpm start) and open the link it prints.</span>
      </div>
    );
  }
  const hueOf = (orb: string | null): OrbHue | undefined => office.find((c) => idOf(c.name) === orb)?.hue;
  return (
    <div data-stats={tab} style={{ display: "grid", gap: "var(--s5)", padding: "var(--s5)", alignContent: "start", minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, minWidth: 0 }}>
        <h2 style={{ margin: 0, font: "800 28px/34px var(--font)", color: "var(--text-1)" }}>{tab === "brain" ? "Tokens" : "XP"}</h2>
        <div role="tablist" aria-label="What to chart" style={{ display: "flex", gap: 3, padding: 3, borderRadius: 12, background: "var(--fill)" }}>
          {(["brain", "xp"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => go({ room: "stats", tab: t })} style={{ ...button, padding: "6px 14px", borderRadius: 9, boxShadow: tab === t ? "0 1px 3px var(--shadow)" : "none", background: tab === t ? "var(--fill-2)" : "transparent", color: tab === t ? "var(--text-1)" : "var(--text-3)" }}>
              {t === "brain" ? "Tokens" : "XP"}
            </button>
          ))}
        </div>
      </div>
      <div role="group" aria-label="How far back" style={{ display: "flex", gap: 6 }}>
        {RANGES.map((n) => (
          <button key={n} data-range={n} aria-pressed={days === n} onClick={() => setDays(n)} style={{ ...button, padding: "6px 12px", background: days === n ? "var(--accent-fill)" : "var(--fill)", boxShadow: days === n ? "inset 0 0 0 1.5px var(--accent)" : button.boxShadow }}>
            {`${n} days`}
          </button>
        ))}
      </div>
      {said && <span role="alert" style={{ color: "var(--alert)" }}>{said}</span>}
      {s && (tab === "brain" ? <Brain s={s} hueOf={hueOf} /> : <Xp s={s} hueOf={hueOf} />)}
    </div>
  );
}

function Brain({ s, hueOf }: { s: StatsState; hueOf: (orb: string | null) => OrbHue | undefined }) {
  const b = s.brain;
  const today = b.byDay.at(-1)!;
  const n = s.days.length;
  return (
    <>
      <Balanced min={150} gap={10}>
        <Figure id="tokens" label={`Tokens, ${n} days`} value={short(tokensOf(b.total))} sub={plural(b.total.calls, "call")} />
        <Figure id="today" label="Today" value={short(tokensOf(today))} sub={plural(today.calls, "call")} />
        <Figure id="cache" label="From the cache" value={`${cacheShare(b.total)}%`} sub="of what was read" />
      </Balanced>
      <section aria-label="Tokens by day" style={card}>
        <span style={head}>By day</span>
        {b.total.calls ? (
          <>
            <Columns
              days={s.days}
              label={`Tokens by day: ${short(tokensOf(b.total))} in ${n} days`}
              parts={b.byDay.map((d) => [
                { value: d.input - d.cached, hue: "azure", fill: "accent" },
                { value: d.cached, hue: "azure", fill: "accent-fill" },
                { value: d.output, hue: "honey", fill: "accent" },
              ])}
              title={(i) => {
                const d = b.byDay[i]!;
                return `${dayWords(s.days[i]!, { weekday: "short", day: "numeric", month: "short" })}: ${short(d.input)} read (${short(d.cached)} from the cache), ${short(d.output)} written, ${plural(d.calls, "call")}`;
              }}
            />
            <div style={{ display: "flex", gap: 14, minWidth: 0 }}>
              <Key hue="azure" fill="accent" words="Read" />
              <Key hue="azure" fill="accent-fill" words="Cached" />
              <Key hue="honey" fill="accent" words="Written" />
            </div>
          </>
        ) : (
          <span style={small}>{`No brain was asked in the last ${n} days.`}</span>
        )}
      </section>
      {b.total.calls > 0 && (
        <Balanced min={300} gap={12}>
          <section aria-label="By model" style={{ ...card, height: "100%" }}>
            <span style={head}>By model</span>
            <Bars rows={b.byModel.map((m, i) => ({ key: m.model, name: m.model, value: tokensOf(m), sub: `${plural(m.calls, "call")} · ${cacheShare(m)}% from the cache`, hue: HUES[i % HUES.length]! }))} />
          </section>
          <section aria-label="By kind of turn" style={{ ...card, height: "100%" }}>
            <span style={head}>By kind of turn</span>
            <Bars rows={b.byKind.map((k, i) => ({ key: k.kind, name: KIND_WORDS[k.kind] ?? k.kind, value: tokensOf(k), sub: plural(k.calls, "call"), hue: HUES[(i + 3) % HUES.length]! }))} />
          </section>
          <section aria-label="By orb" style={{ ...card, height: "100%" }}>
            <span style={head}>By orb</span>
            <Bars rows={b.byOrb.map((o) => ({ key: o.orb ?? "none", name: o.name, value: tokensOf(o), sub: plural(o.calls, "call"), hue: hueOf(o.orb) ?? "azure" }))} />
          </section>
        </Balanced>
      )}
    </>
  );
}

function Xp({ s, hueOf }: { s: StatsState; hueOf: (orb: string | null) => OrbHue | undefined }) {
  const x = s.xp;
  const n = s.days.length;
  const today = x.byDay.at(-1)!;
  return (
    <>
      <Balanced min={150} gap={10}>
        <Figure id="kept" label={`Kept, ${n} days`} value={`${short(x.total.earned - x.total.lost)}`} sub="after take-backs" />
        <Figure id="earned" label="Earned" value={`+${short(x.total.earned)}`} sub={`+${short(today.earned)} today`} />
        <Figure id="lost" label="Taken back" value={`−${short(x.total.lost)}`} sub="for work you said no to" />
      </Balanced>
      <section aria-label="XP by day" style={card}>
        <span style={head}>By day</span>
        {x.total.earned || x.total.lost ? (
          <>
            <Columns
              days={s.days}
              label={`XP by day: ${short(x.total.earned)} earned and ${short(x.total.lost)} taken back in ${n} days`}
              parts={x.byDay.map((d) => [
                { value: d.earned, hue: "mint", fill: "accent" },
                { value: d.lost, hue: "coral", fill: "accent" },
              ])}
              title={(i) => `${dayWords(s.days[i]!, { weekday: "short", day: "numeric", month: "short" })}: +${short(x.byDay[i]!.earned)}, −${short(x.byDay[i]!.lost)}`}
            />
            <div style={{ display: "flex", gap: 14, minWidth: 0 }}>
              <Key hue="mint" fill="accent" words="Earned" />
              <Key hue="coral" fill="accent" words="Taken back" />
            </div>
          </>
        ) : (
          <span style={small}>{`No XP in the last ${n} days: it comes from work you approve.`}</span>
        )}
      </section>
      {/* the jobs you approved by how hard each was in its own area (PLAN 3.13; owner, 10-10: "different weights based on
          difficulty in their domain") */}
      {x.byTier && x.byTier.some((t) => t.jobs > 0) && (
        <section aria-label="XP by how hard the work was" data-xp-tiers style={card}>
          <span style={head}>By how hard the work was</span>
          <Bars rows={x.byTier.map((t) => ({ key: t.tier, name: TIER_WORDS[t.tier].name, value: t.earned, sub: `${plural(t.jobs, "job")} · ${TIER_WORDS[t.tier].each}`, hue: TIER_WORDS[t.tier].hue }))} />
        </section>
      )}
      {x.byOrb.length > 0 && (
        <section aria-label="XP by orb" style={card}>
          <span style={head}>By orb</span>
          <Bars rows={x.byOrb.map((o) => ({ key: o.orb, name: o.name, value: Math.max(0, o.earned - o.lost), sub: `+${short(o.earned)} earned · ${o.lost ? `−${short(o.lost)} taken back` : "nothing taken back"}`, hue: hueOf(o.orb) ?? "azure" }))} />
        </section>
      )}
    </>
  );
}

/** Each tier of difficulty in words: its name, what one job of it earns (the home's gym/xp.ts XP.job), its colour. */
const TIER_WORDS: Record<"easy" | "standard" | "hard" | "expert", { name: string; each: string; hue: OrbHue }> = {
  easy: { name: "Easy", each: "10 XP each", hue: "mint" },
  standard: { name: "Standard", each: "25 XP each", hue: "cornflower" },
  hard: { name: "Hard", each: "40 XP each", hue: "amber" },
  expert: { name: "Expert", each: "60 XP each", hue: "violet" },
};

/** A number on its card. */
function Figure({ id, label, value, sub }: { id: string; label: string; value: string; sub: string }) {
  return (
    <div data-stat={id} style={{ ...card, gap: 2 }}>
      <span style={head}>{label}</span>
      <span className="num" style={{ font: "800 26px/32px var(--font)", color: "var(--text-1)" }}>{value}</span>
      <span style={small}>{sub}</span>
    </div>
  );
}

/** A column a day, its parts stacked from the floor of the chart up; the day's words under some of them. */
function Columns({ days, parts, label, title }: { days: string[]; parts: { value: number; hue: HueName; fill: string }[][]; label: string; title: (i: number) => string }) {
  const most = Math.max(1, ...parts.map((p) => p.reduce((n, x) => n + x.value, 0)));
  const n = days.length;
  const named = (i: number): boolean => n <= 7 || i === 0 || i === n - 1 || i === Math.floor((n - 1) / 2);
  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <div role="img" aria-label={label} data-columns={n} style={{ display: "grid", gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gridTemplateRows: "150px", gap: n > 14 ? 2 : 6, minWidth: 0 }}>
        {parts.map((p, i) => (
          <div key={days[i]} data-day={days[i]} title={title(i)} style={{ display: "flex", flexDirection: "column-reverse", minWidth: 0, borderRadius: 4, background: "var(--fill-2)", overflow: "hidden", boxShadow: i === n - 1 ? "inset 0 0 0 1px var(--hairline)" : "none" }}>
            {p.map((x, k) => (
              <div key={k} data-orb={x.hue} style={{ height: `${(100 * x.value) / most}%`, background: `var(--${x.fill})`, flex: "0 0 auto" }} />
            ))}
          </div>
        ))}
      </div>
      {n <= 7 ? (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 6, minWidth: 0 }}>
          {days.map((d, i) => (
            <span key={d} style={{ font: "600 11px/14px var(--font)", color: i === n - 1 ? "var(--text-1)" : "var(--text-3)", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden" }}>
              {i === n - 1 ? "Today" : dayWords(d, { weekday: "short" })}
            </span>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
          {days.filter((_, i) => named(i)).map((d, i, all) => (
            <span key={d} style={{ font: "600 11px/14px var(--font)", color: i === all.length - 1 ? "var(--text-1)" : "var(--text-3)", whiteSpace: "nowrap" }}>
              {i === all.length - 1 ? "Today" : dayWords(d, { day: "numeric", month: "short" })}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** One colour of a chart, and what it is. */
function Key({ hue, fill, words }: { hue: HueName; fill: string; words: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "600 12px/16px var(--font)", color: "var(--text-2)", whiteSpace: "nowrap" }}>
      <span aria-hidden data-orb={hue} style={{ width: 10, height: 10, borderRadius: 3, background: `var(--${fill})`, boxShadow: "inset 0 0 0 1px var(--hairline)" }} />
      {words}
    </span>
  );
}

/** A bar a row, the longest the most; its name, its number and a line about it. */
function Bars({ rows }: { rows: { key: string; name: string; value: number; sub: string; hue: OrbHue }[] }) {
  const most = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div role="list" style={{ display: "grid", gap: 12, minWidth: 0 }}>
      {rows.map((r) => (
        <div key={r.key} role="listitem" data-bar={r.key} data-orb={r.hue} style={{ display: "grid", gap: 4, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span style={{ font: "700 14px/19px var(--font)", color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{r.name}</span>
            <span className="num" data-value style={{ font: "700 14px/19px var(--font)", color: "var(--text-1)", flex: "0 0 auto" }}>{short(r.value)}</span>
          </div>
          <div aria-hidden style={{ height: 8, borderRadius: 4, background: "var(--fill-2)", overflow: "hidden" }}>
            <div style={{ width: `${(100 * r.value) / most}%`, height: "100%", borderRadius: 4, background: "var(--accent)" }} />
          </div>
          <span style={small}>{r.sub}</span>
        </div>
      ))}
    </div>
  );
}

