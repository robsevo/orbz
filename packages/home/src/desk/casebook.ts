// The desk's cases (PLAN 5.42; owner, 10-12: "investigate where we lead them (can be a pump coin or 5 or how many we
// ask it) ... like ZachXBT does"): a case is the coins it looks into (one to ten), the question, the orb working it,
// what was read of each coin (its launch, its first hands' and its holders' first money in, its trades), the money as one
// graph (desk/trace.ts), the findings, and the write-up with how it could be played. A finding of an orb's is kept only
// on evidence the case itself read (a transfer's signature on its graph, or a wallet in it: rule 8, nothing the model
// says is evidence); yours need none. Wallets labelled (a way out: an exchange, a bridge, a mixer; or a name) are the
// desk's, for every case. The things you have noticed are kept too, and every case is checked against them.
import type { DatabaseSync } from "node:sqlite";
import type { EventLog } from "../events.ts";
import { YOU } from "./desk.ts";
import { cited, emptyGraph, type Buy, type CoinFacts, type Funding, type Graph, type Holding, type Part, type Sell } from "./trace.ts";

/** What a case read of one coin. */
export type CaseCoin = {
  /** "solana:<mint>" */
  key: string;
  label: string | null;
  /** its price when the case opened, in dollars (what its record is measured from) */
  priceAtOpen: number | null;
  launch: { deployer: string; sig: string; slot: number; at: number; pool: string | null; supply: number; reachedStart: boolean; txs: number } | null;
  buys: Buy[];
  sells: Sell[];
  fundings: Funding[];
  holders: { holdings: Holding[]; accounts: number; at: number } | null;
  facts: CoinFacts | null;
};
export type Weight = "strong" | "likely" | "hunch";
export type Finding = { id: number; by: string; words: string; evidence: string[]; weight: Weight; at: number };
export type Case = {
  id: number; title: string; question: string; orb: string | null; openedAt: number; closedAt: number | null;
  summary: string | null; play: string | null; coins: CaseCoin[]; graph: Graph; findings: Finding[];
};
export type Label = { address: string; label: string; exit: boolean; by: string; at: number };
export type Noticed = { id: number; words: string; by: string; at: number };

export class CaseError extends Error {}

/** The most coins one case looks into. */
export const MAX_COINS = 10;

type CaseRow = { id: number; title: string; question: string; orb: string | null; opened_at: number; closed_at: number | null; summary: string | null; play: string | null; coins: string; graph: string };

export const blankCoin = (key: string, label: string | null, priceAtOpen: number | null): CaseCoin =>
  ({ key, label, priceAtOpen, launch: null, buys: [], sells: [], fundings: [], holders: null, facts: null });

export class Casebook {
  readonly #db: DatabaseSync;
  readonly #events: EventLog;
  readonly #now: () => number;

  constructor(db: DatabaseSync, events: EventLog, now: () => number) {
    this.#db = db;
    this.#events = events;
    this.#now = now;
  }

  open(o: { coins: { key: string; label: string | null; price: number | null }[]; question: string; orb: string | null; title?: string }): Case {
    const keys = [...new Map(o.coins.map((c) => [c.key, c])).values()];
    if (!keys.length || keys.length > MAX_COINS) throw new CaseError(`a case looks into 1 to ${MAX_COINS} coins`);
    const title = (o.title?.trim() || (keys.length === 1 ? `${keys[0]!.label ?? keys[0]!.key.slice(-8)}` : `${keys.length} coins: ${keys.slice(0, 3).map((c) => c.label ?? c.key.slice(-6)).join(", ")}${keys.length > 3 ? "…" : ""}`)).slice(0, 120);
    const coins = keys.map((c) => blankCoin(c.key, c.label, c.price));
    const now = this.#now();
    const r = this.#db.prepare("INSERT INTO desk_cases (title, question, orb, opened_at, coins, graph) VALUES (?, ?, ?, ?, ?, ?)").run(title, o.question.trim().slice(0, 1000), o.orb, now, JSON.stringify(coins), JSON.stringify(emptyGraph()));
    const id = Number(r.lastInsertRowid);
    this.#events.append("desk.case_opened", { case: id, title, coins: coins.map((c) => c.key) }, o.orb ? { orb: o.orb } : {});
    return this.get(id)!;
  }

  get(id: number): Case | null {
    const row = this.#db.prepare("SELECT * FROM desk_cases WHERE id = ?").get(id) as CaseRow | undefined;
    if (!row) return null;
    const findings = (this.#db.prepare("SELECT * FROM desk_findings WHERE case_id = ? ORDER BY id").all(id) as { id: number; by: string; words: string; evidence: string; weight: Weight; at: number }[])
      .map((f) => ({ id: f.id, by: f.by, words: f.words, evidence: JSON.parse(f.evidence) as string[], weight: f.weight, at: f.at }));
    return {
      id: row.id, title: row.title, question: row.question, orb: row.orb, openedAt: row.opened_at, closedAt: row.closed_at,
      summary: row.summary, play: row.play, coins: JSON.parse(row.coins) as CaseCoin[], graph: JSON.parse(row.graph) as Graph, findings,
    };
  }

  /** Every case, the newest first, without its graph's bulk (how many wallets and transfers it holds). */
  list(): { id: number; title: string; orb: string | null; openedAt: number; closedAt: number | null; coins: string[]; wallets: number; transfers: number; findings: number }[] {
    return (this.#db.prepare("SELECT c.*, (SELECT COUNT(*) FROM desk_findings f WHERE f.case_id = c.id) AS n FROM desk_cases c ORDER BY id DESC").all() as (CaseRow & { n: number })[]).map((r) => {
      const g = JSON.parse(r.graph) as Graph;
      return { id: r.id, title: r.title, orb: r.orb, openedAt: r.opened_at, closedAt: r.closed_at, coins: (JSON.parse(r.coins) as CaseCoin[]).map((c) => c.key), wallets: g.nodes.length, transfers: g.edges.reduce((n, e) => n + e.count, 0), findings: r.n };
    });
  }

  /** What was read of its coins and its graph, kept. */
  save(c: Case): void {
    this.#db.prepare("UPDATE desk_cases SET coins = ?, graph = ? WHERE id = ?").run(JSON.stringify(c.coins), JSON.stringify(c.graph), c.id);
    this.#events.append("desk.case_read", { case: c.id, wallets: c.graph.nodes.length, edges: c.graph.edges.length }, c.orb ? { orb: c.orb } : {});
  }

  /** A finding: an orb's kept only when every piece of its evidence is in the case (a transfer it read, a wallet in its
   * graph), at least one; yours as you say it. */
  find(id: number, by: string, words: string, evidence: readonly string[], weight: Weight): Finding {
    const c = this.get(id);
    if (!c) throw new CaseError(`no case ${id}`);
    const w = words.trim();
    if (!w) throw new CaseError("a finding needs words");
    if (by !== YOU) {
      if (!evidence.length) throw new CaseError("a finding needs its evidence: the signatures of the transfers it rests on, or the wallets, as the case read them");
      const { unknown } = cited(c.graph, evidence);
      if (unknown.length) throw new CaseError(`not in this case: ${unknown.slice(0, 5).join(", ")}. Read them first (trace_wallet), or cite what the case read`);
    }
    const r = this.#db.prepare("INSERT INTO desk_findings (case_id, by, words, evidence, weight, at) VALUES (?, ?, ?, ?, ?, ?)").run(id, by, w.slice(0, 2000), JSON.stringify([...evidence].slice(0, 40)), weight, this.#now());
    this.#events.append("desk.case_finding", { case: id, finding: Number(r.lastInsertRowid), weight }, by === YOU ? {} : { orb: by });
    return this.get(id)!.findings.at(-1)!;
  }

  close(id: number, summary: string, play: string): Case {
    const c = this.get(id);
    if (!c) throw new CaseError(`no case ${id}`);
    if (!summary.trim()) throw new CaseError("a case closes with its write-up");
    this.#db.prepare("UPDATE desk_cases SET closed_at = ?, summary = ?, play = ? WHERE id = ?").run(this.#now(), summary.trim().slice(0, 8000), play.trim().slice(0, 4000), id);
    this.#events.append("desk.case_closed", { case: id }, c.orb ? { orb: c.orb } : {});
    return this.get(id)!;
  }

  label(address: string, label: string, exit: boolean, by: string): Label {
    const l = label.trim().slice(0, 80);
    if (!l) throw new CaseError("a label needs words");
    this.#db.prepare("INSERT INTO desk_labels (address, label, exit, by, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (address) DO UPDATE SET label = excluded.label, exit = excluded.exit, by = excluded.by, at = excluded.at").run(address, l, exit ? 1 : 0, by, this.#now());
    return { address, label: l, exit, by, at: this.#now() };
  }

  labels(): Label[] {
    return (this.#db.prepare("SELECT * FROM desk_labels ORDER BY at DESC").all() as { address: string; label: string; exit: number; by: string; at: number }[]).map((r) => ({ ...r, exit: r.exit === 1 }));
  }

  notice(words: string, by: string): Noticed {
    const w = words.trim().slice(0, 600);
    if (!w) throw new CaseError("say what you noticed");
    const r = this.#db.prepare("INSERT INTO desk_noticed (words, by, at) VALUES (?, ?, ?)").run(w, by, this.#now());
    return { id: Number(r.lastInsertRowid), words: w, by, at: this.#now() };
  }

  noticed(): Noticed[] {
    return this.#db.prepare("SELECT * FROM desk_noticed ORDER BY id").all() as Noticed[];
  }

  forget(id: number): void {
    this.#db.prepare("DELETE FROM desk_noticed WHERE id = ?").run(id);
  }

  /** Every wallet's part in every coin of every case but `except`: the deployer, the funders, the first hands and the
   * holders (what `repeats` reads). */
  parts(except?: number): Part[] {
    const out: Part[] = [];
    for (const r of this.#db.prepare("SELECT id, coins FROM desk_cases").all() as { id: number; coins: string }[]) {
      if (r.id === except) continue;
      for (const c of JSON.parse(r.coins) as CaseCoin[]) out.push(...partsOf(c));
    }
    return out;
  }
}

/** A coin's wallets as a case read them, each in its part. */
export function partsOf(c: CaseCoin): Part[] {
  const out: Part[] = [];
  if (c.launch?.deployer) out.push({ coin: c.key, address: c.launch.deployer, role: "deployer" });
  const first = new Set(c.buys.filter((b) => c.launch && b.slot <= c.launch.slot + 2).map((b) => b.wallet));
  for (const w of first) if (w !== c.launch?.deployer) out.push({ coin: c.key, address: w, role: "first" });
  for (const f of c.fundings) if (f.funder && !f.busy) out.push({ coin: c.key, address: f.funder, role: "funder" });
  for (const h of c.holders?.holdings ?? []) if (!h.pool) out.push({ coin: c.key, address: h.owner, role: "holder" });
  return out;
}
