// The desk's cases (PLAN 5.42; owner, 10-12: "investigate where we lead them (can be a pump coin or 5 or how many we ask
// it) and investigate like ZachXBT does ... notice patterns ... Things we notice too"): coins pasted in and the desk's
// investigator sent to work them; the things you have noticed, which every case is checked for; every case; and one
// case whole: its coins and their patterns, the money drawn as he draws it (flow.ts), the findings with their evidence
// (each a press away on the chain's explorer), the write-up and how it could be played, a finding of yours, and any
// wallet in it labelled. What the investigator reads is the home's (desk/trail.ts); nothing here moves money.
import { useEffect, useMemo, useRef, useState } from "react";
import { idOf, type CaseFinding, type CaseNode, type CaseRole, type DeskCase, type DeskCaseRow, type DeskLabel, type DeskNoticed, type Office } from "../home/link.ts";
import type { Character } from "../orb/spec.ts";
import type { HueName } from "../design/tokens.ts";
import { NAMES } from "../floor/props.ts";
import { Pick } from "../ui/Pick.tsx";
import { OneLine } from "../ui/Balanced.tsx";
import { ago, button, card, chip, field, head, shortAddress, small, strong, well } from "./kit.ts";
import { coinsIn, layout, when } from "./flow.ts";

const EXPLORER = "https://solscan.io";
const HUE: Record<CaseRole, HueName> = { deployer: "coral", funder: "violet", first: "amber", holder: "azure", wallet: "teal", busy: "mint", exit: "mint", pool: "teal" };
const ROLE: Record<CaseRole, string> = { deployer: "Deployer", funder: "Funder", first: "First hand", holder: "Holder", wallet: "Wallet", busy: "Busy: an exchange, a bridge or a bot", exit: "A way out", pool: "Pool" };
/** Each pattern's short name on its chip (what it means, the home's words, under the pointer). */
const PATTERN: Record<string, string> = { bundled: "Bundled launch", devHeavy: "Heavy deployer buy", oneFunder: "One funder holds a lot", fresh: "Fresh wallets", devSold: "Deployer sold", soldTogether: "Sold together", roundTrips: "Money in circles", cashOut: "Cashing out", seenBefore: "Seen before", spread: "Spread out" };
const WEIGHT: Record<CaseFinding["weight"], string> = { strong: "The chain shows it", likely: "Likely", hunch: "A hunch" };
/** The desk's jobs that start with the investigation's tools (the home's agent/groups.ts `trace`). */
const INVESTIGATORS = new Set(["onchain", "deskhead"]);
const isSig = (x: string): boolean => x.length > 60;
const linkOf = (x: string): string => `${EXPLORER}/${isSig(x) ? "tx" : "account"}/${x}`;

export function CasesPanel({ home, crew, opening, opened }: { home: Office; crew: Character[]; opening: number | null; opened: () => void }) {
  const [list, setList] = useState<{ cases: DeskCaseRow[]; noticed: DeskNoticed[]; labels: DeskLabel[] } | null>(null);
  const [open, setOpen] = useState<number | null>(opening);
  const [said, setSaid] = useState<string | null>(null);
  const load = (): void => void home.deskCases().then(setList, (e: Error) => setSaid(e.message));
  useEffect(() => {
    load();
    return home.watch({ event: (e) => void (String(e.type).startsWith("desk.case") && load()) });
  }, [home]);
  useEffect(() => {
    if (opening !== null) {
      setOpen(opening);
      opened();
    }
  }, [opening]);
  // the on-chain job first, then the desk's head
  const sleuths = [...crew.filter((c) => c.specialty === "onchain"), ...crew.filter((c) => c.specialty !== "onchain" && INVESTIGATORS.has(c.specialty))];
  if (open !== null) return <CaseView home={home} id={open} crew={crew} labels={list?.labels ?? []} back={() => setOpen(null)} relabel={load} />;
  return (
    <div data-cases style={{ display: "grid", gap: "var(--s3)", minWidth: 0 }}>
      <NewCase home={home} sleuths={sleuths} started={(id) => (load(), setOpen(id))} />
      <Noticed home={home} noticed={list?.noticed ?? []} changed={load} />
      <section aria-label="Cases" style={card}>
        <span style={head}>Cases</span>
        {!list ? (
          <span role="status" style={small}>{said ?? "Opening the cases…"}</span>
        ) : !list.cases.length ? (
          <span style={small}>No case yet. Paste a coin above and send the investigator to it.</span>
        ) : (
          list.cases.map((c) => (
            <button key={c.id} type="button" data-case-row={c.id} onClick={() => setOpen(c.id)} style={{ ...well, textAlign: "left", cursor: "pointer", border: 0, font: "inherit", color: "inherit" }}>
              <span style={{ display: "flex", gap: 8, alignItems: "baseline", minWidth: 0 }}>
                <span style={{ font: "700 15px/21px var(--font)", color: "var(--text-1)", flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" }}>{c.title}</span>
                <span style={{ ...small, flex: "0 0 auto", color: c.closedAt ? "var(--ok)" : "var(--text-3)" }}>{c.closedAt ? "Closed" : "Open"}</span>
              </span>
              <span style={small}>{`${c.coins.length} coin${c.coins.length === 1 ? "" : "s"} · ${c.wallets} wallets · ${c.transfers} transfers · ${c.findings} finding${c.findings === 1 ? "" : "s"}${c.orb ? ` · ${crew.find((o) => idOf(o.name) === c.orb)?.name ?? c.orb}` : ""} · ${ago(c.openedAt)}`}</span>
            </button>
          ))
        )}
      </section>
    </div>
  );
}

/** Coins pasted in (a mint, a pump.fun or DexScreener link, "solana:<mint>"; one to ten), what you want to know, and the
 * investigator sent: a case opened, the orb told in its chat. */
function NewCase({ home, sleuths, started }: { home: Office; sleuths: Character[]; started: (id: number) => void }) {
  const [text, setText] = useState("");
  const [question, setQuestion] = useState("");
  const [who, setWho] = useState(sleuths[0]?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const coins = coinsIn(text);
  const job = NAMES.jobs.onchain.title;
  if (!sleuths.length) {
    return (
      <section data-new-case aria-label="Look into coins" style={card}>
        <span style={head}>Look into coins</span>
        <span style={small}>{`No ${job} on the desk yet: hire one, and lead it to any coin from here.`}</span>
      </section>
    );
  }
  const orb = sleuths.find((c) => c.name === who) ?? sleuths[0]!;
  const go = async (): Promise<void> => {
    setBusy(true);
    setSaid(null);
    try {
      const c = await home.openCase({ orb: idOf(orb.name), coins, question: question.trim() || undefined });
      setText("");
      setQuestion("");
      started(c.id);
    } catch (e) {
      setSaid((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section data-new-case aria-label="Look into coins" style={card}>
      <span style={head}>Look into coins</span>
      <textarea data-case-coins value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Paste one or more Solana coins: their mint addresses, or pump.fun or DexScreener links" style={{ ...field, resize: "vertical", font: "500 14px/20px var(--font)" }} />
      <input data-case-question value={question} maxLength={1000} onChange={(e) => setQuestion(e.target.value)} placeholder="What do you want to know? (who is behind it, is it bundled, how to play it)" size={1} style={field} />
      {sleuths.length > 1 && <Pick title="Investigator" label="The orb to send" value={orb.name} options={sleuths.map((c) => [c.name, c.name] as const)} onChange={setWho} />}
      <button type="button" data-case-go disabled={busy || !coins.length} onClick={() => void go()} style={{ ...strong, minHeight: 44, opacity: coins.length ? 1 : 0.5 }}>
        {coins.length ? `Send ${orb.name} to ${coins.length} coin${coins.length === 1 ? "" : "s"}` : `Paste a coin for ${orb.name}`}
      </button>
      {said && <span role="alert" style={{ ...small, color: "var(--alert)" }}>{said}</span>}
    </section>
  );
}

/** What you have noticed: every case is checked against each. */
function Noticed({ home, noticed, changed }: { home: Office; noticed: DeskNoticed[]; changed: () => void }) {
  const [words, setWords] = useState("");
  const keep = async (): Promise<void> => {
    if (!words.trim()) return;
    await home.notice(words.trim());
    setWords("");
    changed();
  };
  return (
    <section data-noticed aria-label="Things you've noticed" style={card}>
      <span style={head}>Things you've noticed</span>
      <span style={small}>Every case is checked against each of them.</span>
      {noticed.map((n) => (
        <div key={n.id} data-noticed-row style={{ ...well, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ ...small, color: "var(--text-1)", flex: "1 1 auto" }}>{n.words}</span>
          <button type="button" className="orbs-small" aria-label={`Forget "${n.words}"`} onClick={() => void home.forgetNoticed(n.id).then(changed)} style={{ ...button, minHeight: 32, padding: "4px 10px" }}>✕</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
        <input data-noticed-words value={words} maxLength={600} onChange={(e) => setWords(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void keep()} placeholder="Deployers funded an hour before launch, in round amounts" size={1} style={{ ...field, flex: "1 1 auto" }} />
        <button type="button" data-noticed-keep disabled={!words.trim()} onClick={() => void keep()} style={{ ...button, flex: "0 0 auto" }}>Keep it</button>
      </div>
    </section>
  );
}

function CaseView({ home, id, crew, labels, back, relabel }: { home: Office; id: number; crew: Character[]; labels: DeskLabel[]; back: () => void; relabel: () => void }) {
  const [c, setC] = useState<DeskCase | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const load = (): void => void home.deskCase(id).then(setC, (e: Error) => setSaid(e.message));
  useEffect(() => {
    load();
    return home.watch({ event: (e) => void (String(e.type).startsWith("desk.case") && (e.data as { case?: number })?.case === id && load()) });
  }, [home, id]);
  const named = useMemo(() => new Map(labels.map((l) => [l.address, l.label])), [labels]);
  const assets = useMemo(() => Object.fromEntries((c?.coins ?? []).map((k) => [k.key.slice(7), k.label ?? "tokens"])), [c]);
  const orbName = (o: string | null): string => (o === "~you" ? "You" : crew.find((x) => idOf(x.name) === o)?.name ?? o ?? "");
  if (!c) return <span role="status" style={small}>{said ?? "Opening the case…"}</span>;
  const node = picked ? c.graph.nodes.find((n) => n.address === picked) ?? null : null;
  return (
    <div data-case={c.id} style={{ display: "grid", gap: "var(--s3)", minWidth: 0 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
        <button type="button" data-case-back onClick={back} style={button}>‹ Cases</button>
        <span style={{ font: "800 18px/24px var(--font)", color: "var(--text-1)", flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" }}>{c.title}</span>
        <span style={{ ...small, color: c.closedAt ? "var(--ok)" : "var(--text-3)" }}>{c.closedAt ? "Closed" : "Open"}</span>
      </div>
      <section aria-label="The question" style={card}>
        <span style={head}>{`Case ${c.id}${c.orb ? ` · ${orbName(c.orb)}` : ""} · ${ago(c.openedAt)}`}</span>
        <span style={{ font: "500 15px/22px var(--font)", color: "var(--text-1)" }}>{c.question}</span>
        {c.coins.map((k) => (
          <div key={k.key} data-case-coin={k.key} style={{ ...well, gap: 6 }}>
            <span style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", minWidth: 0 }}>
              <span style={{ font: "700 15px/20px var(--font)", color: "var(--text-1)" }}>{k.label ?? shortAddress(k.key.slice(7))}</span>
              <a href={linkOf(k.key.slice(7))} target="_blank" rel="noreferrer" style={{ ...small, fontFamily: "var(--mono)" }}>{shortAddress(k.key.slice(7))}</a>
              {k.priceAtOpen !== null && <span style={small}>{`$${k.priceAtOpen.toPrecision(4)} when opened`}</span>}
            </span>
            {k.launch?.reachedStart && <span style={small}>{`Launched ${when(k.launch.at)} UTC by ${named.get(k.launch.deployer) ?? shortAddress(k.launch.deployer)}${k.facts?.first ? `; its first hands took ${(k.facts.first.share * 100).toFixed(1)}% in ${k.facts.first.slots + 1} slots` : ""}`}</span>}
            {!k.facts && <span style={small}>Not read yet.</span>}
            {k.patterns.length > 0 && (
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {k.patterns.map((p) => <span key={p.id} data-pattern={p.id} title={p.words} style={{ ...chip(p.id !== "spread"), cursor: "default" }}>{PATTERN[p.id] ?? p.id}</span>)}
              </span>
            )}
          </div>
        ))}
      </section>
      {c.graph.nodes.some((x) => !x.roles.includes("pool") || x.roles.length > 1) && (
        <section aria-label="The money" style={card}>
          <span style={head}>The money</span>
          <FlowChart graph={c.graph} assets={assets} named={named} picked={picked} pick={setPicked} />
          {node && <Picked home={home} node={node} named={named} done={() => (relabel(), setPicked(null))} />}
        </section>
      )}
      <section aria-label="Findings" style={card}>
        <span style={head}>Findings</span>
        {!c.findings.length && <span style={small}>None kept yet.</span>}
        {c.findings.map((f) => (
          <div key={f.id} data-finding={f.weight} style={{ ...well, gap: 6 }}>
            <span style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ font: "700 12px/16px var(--font)", color: f.weight === "strong" ? "var(--ok)" : f.weight === "likely" ? "var(--accent)" : "var(--text-3)" }}>{WEIGHT[f.weight]}</span>
              <span style={small}>{`${orbName(f.by)} · ${ago(f.at)}`}</span>
            </span>
            <span style={{ font: "500 14px/20px var(--font)", color: "var(--text-1)", whiteSpace: "pre-wrap" }}>{f.words}</span>
            {f.evidence.length > 0 && (
              <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {f.evidence.map((x) => <a key={x} href={linkOf(x)} target="_blank" rel="noreferrer" style={{ ...small, fontFamily: "var(--mono)" }}>{named.get(x) ?? shortAddress(x)}</a>)}
              </span>
            )}
          </div>
        ))}
        <YourFinding home={home} id={c.id} added={load} />
      </section>
      {c.summary && (
        <section data-writeup aria-label="The write-up" style={card}>
          <span style={head}>What happened</span>
          <span style={{ font: "500 15px/23px var(--font)", color: "var(--text-1)", whiteSpace: "pre-wrap" }}>{c.summary}</span>
          {c.play && (
            <>
              <span style={head}>How it could be played</span>
              <span style={{ font: "500 15px/23px var(--font)", color: "var(--text-1)", whiteSpace: "pre-wrap" }}>{c.play}</span>
              <span style={small}>Facts and a lean, never a promise: test a rule on paper first. Every trade is yours.</span>
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** The money as he draws it: the wallets in columns as it ran, each line a pair's transfers summed. Fitted to its box;
 * on a narrow screen it scrolls sideways inside it. */
function FlowChart({ graph, assets, named, picked, pick }: { graph: DeskCase["graph"]; assets: Record<string, string>; named: ReadonlyMap<string, string>; picked: string | null; pick: (a: string | null) => void }) {
  const r = 18;
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const seen = new ResizeObserver(() => setRoom(el.clientWidth));
    seen.observe(el);
    setRoom(el.clientWidth);
    return () => seen.disconnect();
  }, []);
  const flow = useMemo(() => layout(graph.nodes, graph.edges, { assets, ...(room > 0 && { width: room }) }), [graph, assets, room]);
  // wider than its box (a phone): opened on the deployer, the case's middle, the rest a swipe either way
  useEffect(() => {
    const el = box.current;
    const dev = flow.nodes.find((p) => p.role === "deployer");
    if (el && dev && flow.width > el.clientWidth) el.scrollLeft = Math.max(0, dev.x - el.clientWidth / 3);
  }, [flow]);
  return (
    <>
    <div ref={box} data-flow style={{ overflowX: "auto", minWidth: 0, borderRadius: 14, background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)" }}>
      <svg data-flow-chart width={flow.width} height={flow.height} viewBox={`0 0 ${flow.width} ${flow.height}`} role="img" aria-label="Where the money went" style={{ display: "block" }}>
        {flow.edges.map((d, i) => {
          const fwd = d.to.x > d.from.x;
          const tip = fwd ? `M${d.to.x - r},${d.to.y} l-9,-5 l0,10 z` : `M${d.to.x},${d.to.y - r} l-5,-9 l10,0 z`;
          return (
            <g key={i} data-orb={HUE[d.from.role]} data-flow-edge={`${d.edge.from}>${d.edge.to}`} opacity={picked && picked !== d.edge.from && picked !== d.edge.to ? 0.25 : 1}>
              <path d={d.path} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeOpacity={0.75} />
              <path d={tip} fill="var(--accent)" />
              <text x={d.mid.x} y={d.mid.y - 4} textAnchor="middle" style={{ font: "600 11px/1 var(--font)", fill: "var(--text-1)", paintOrder: "stroke", stroke: "var(--fill)", strokeWidth: 4 }}>{d.label}</text>
              <text x={d.mid.x} y={d.mid.y + 10} textAnchor="middle" style={{ font: "500 10px/1 var(--font)", fill: "var(--text-3)", paintOrder: "stroke", stroke: "var(--fill)", strokeWidth: 4 }}>{d.when}</text>
            </g>
          );
        })}
        {flow.nodes.map((p) => (
          <g key={`${p.node.address}:${p.side ?? ""}`} data-orb={HUE[p.role]} data-flow-node={p.node.address} data-side={p.side ?? ""} data-role={p.role} onClick={() => pick(picked === p.node.address ? null : p.node.address)} style={{ cursor: "pointer" }}>
            <circle cx={p.x} cy={p.y} r={r} fill="var(--accent-fill)" stroke="var(--accent)" strokeWidth={picked === p.node.address ? 3 : 1.6} />
            <text x={p.x} y={p.y + 4} textAnchor="middle" style={{ font: "800 11px/1 var(--font)", fill: "var(--text-1)" }}>{p.role === "deployer" ? "D" : p.role === "funder" ? "F" : p.role === "first" ? "1st" : p.role === "busy" || p.role === "exit" ? "⇥" : "W"}</text>
            <text x={p.x} y={p.y + r + 14} textAnchor="middle" style={{ font: "700 11px/1 var(--font)", fill: "var(--text-1)" }}>{named.get(p.node.address) ?? p.node.label ?? `${p.node.address.slice(0, 4)}…${p.node.address.slice(-4)}`}</text>
            <text x={p.x} y={p.y + r + 27} textAnchor="middle" style={{ font: "500 10px/1 var(--font)", fill: "var(--text-3)" }}>{ROLE[p.role].split(":")[0]}</text>
          </g>
        ))}
      </svg>
    </div>
    <span style={small}>{`Each line sums the transfers between two wallets, with when the first went. An exchange drawn where its money came out and where money went in. Pools left out${flow.hidden ? `; ${flow.hidden} lesser wallets not drawn` : ""}. Press a wallet to label it.`}</span>
    </>
  );
}

/** A wallet pressed on the chart: what it is in the case, on the explorer, and a label for every case. */
function Picked({ home, node, named, done }: { home: Office; node: CaseNode; named: ReadonlyMap<string, string>; done: () => void }) {
  const [label, setLabel] = useState(named.get(node.address) ?? "");
  const [out, setOut] = useState(node.roles.includes("exit"));
  const [said, setSaid] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    try {
      await home.labelWallet(node.address, label.trim(), out);
      done();
    } catch (e) {
      setSaid((e as Error).message);
    }
  };
  return (
    <div data-picked={node.address} style={{ ...well, gap: 8 }}>
      <a href={linkOf(node.address)} target="_blank" rel="noreferrer" style={{ ...small, fontFamily: "var(--mono)", color: "var(--text-1)" }}>{node.address}</a>
      <span style={small}>{`${node.roles.map((r) => ROLE[r].split(":")[0]).join(", ") || "Wallet"}${node.coins.length ? ` · in ${node.coins.length} coin${node.coins.length === 1 ? "" : "s"}` : ""}`}</span>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
        <input data-label-words value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="What it is: an exchange's hot wallet, a bot…" size={1} style={{ ...field, flex: "1 1 200px" }} />
        <label style={{ ...small, display: "flex", gap: 6, alignItems: "center", color: "var(--text-1)" }}>
          <input type="checkbox" data-label-exit checked={out} onChange={(e) => setOut(e.target.checked)} />
          A way out
        </label>
        <button type="button" data-label-save disabled={!label.trim()} onClick={() => void save()} style={button}>Label it</button>
      </div>
      {said && <span role="alert" style={{ ...small, color: "var(--alert)" }}>{said}</span>}
    </div>
  );
}

/** A finding of yours: no evidence asked (yours is your word); the investigator's need theirs. */
function YourFinding({ home, id, added }: { home: Office; id: number; added: () => void }) {
  const [words, setWords] = useState("");
  const [weight, setWeight] = useState<CaseFinding["weight"]>("hunch");
  const add = async (): Promise<void> => {
    if (!words.trim()) return;
    await home.caseFinding(id, words.trim(), weight);
    setWords("");
    added();
  };
  return (
    <div data-your-finding style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <textarea value={words} onChange={(e) => setWords(e.target.value)} rows={2} placeholder="Something you see in it" style={{ ...field, resize: "vertical", font: "500 14px/20px var(--font)" }} />
      {/* how sure: one row, sideways on a narrow screen; Keep it under it */}
      <OneLine gap={6}>
        {(["hunch", "likely", "strong"] as const).map((w) => (
          <button key={w} type="button" aria-pressed={weight === w} onClick={() => setWeight(w)} style={chip(weight === w)}>{WEIGHT[w]}</button>
        ))}
      </OneLine>
      <button type="button" data-your-finding-add disabled={!words.trim()} onClick={() => void add()} style={{ ...strong, justifySelf: "end" }}>Keep it</button>
    </div>
  );
}

