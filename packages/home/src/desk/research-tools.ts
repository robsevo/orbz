// The desk's research and its risk, as tools (PLAN 5.40; owner, 10-11: three more of the desk's jobs, "like a real ...
// firm"): what followed a condition on a market's history (`signal_study`), strategies compared on the history a choice
// among them never saw (`compare_strategies`), one strategy stress-tested (`stress_strategy`), and every account's risk
// (`desk_risk`). Their arithmetic is research.ts's and risk.ts's; here the bars are fetched and the result said in
// words. Each in its own group, so only the jobs that use it start with it (agent/groups.ts). They read, and move
// nothing; an account is an account (whichever money it is, nothing here says).
import type { ToolDef, ToolResult } from "../agent/tools.ts";
import { GROUPS } from "../agent/groups.ts";
import type { Candle } from "./indicators.ts";
import { YOU, type Desk } from "./desk.ts";
import { compareFitted, eventStudy, stress, type Part } from "./research.ts";
import { exposureOf, together, type Closes, type Exposure, type Holding } from "./risk.ts";
import { problemOf, rulesWords, SYMBOLS, TIMEFRAMES, words, type Rules, type Strategy, type Timeframe } from "./strategy.ts";
import { RULES, STRATEGY, symbolParam } from "./tools.ts";

const obj = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({ type: "object", properties, required, additionalProperties: false });
const usd = (n: number): string => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number | null, places = 2): string => (n === null || !Number.isFinite(n) ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(places)}%`);
const fail = (e: unknown): ToolResult => ({ content: e instanceof Error ? e.message : String(e), isError: true });
const day = (t: number): string => new Date(t).toISOString().slice(0, 16).replace("T", " ");

/** How much history research reads: up to this many closed bars. */
const HISTORY = 1_000;
/** A part said in a line. */
const partWords = (p: Part): string => `${pct(p.returnPct)}, deepest fall ${p.maxDrawdownPct.toFixed(1)}%, ${p.trades} trade${p.trades === 1 ? "" : "s"}${p.trades ? `, ${p.winRate === null ? "none" : `${Math.round(p.winRate * 100)}%`} won, profit factor ${p.profitFactor === null ? "n/a" : p.profitFactor.toFixed(2)}` : ""}`;

export function researchTools(o: { desk: Desk; nameOf: (orb: string) => string }): ToolDef[] {
  const { desk } = o;
  const bars = async (symbol: string, tf: Timeframe): Promise<Candle[]> => {
    const c = await desk.market.closed(symbol, tf, HISTORY);
    if (c.length < 60) throw new Error(`${symbol} on ${tf} gave ${c.length} bars: too few to study`);
    return c;
  };
  const q = GROUPS.quant;
  const r = GROUPS.risk;
  return [
    {
      name: "signal_study", group: q, label: "Studying a signal",
      description: `What followed a condition on a market's history (up to ${HISTORY} closed bars): each time it first held (a bar where it holds and did not the bar before), how the price moved over the bars after (1, 4, 12 and 24 unless you say), how often it rose, against what followed any bar (the base rate), and a t statistic of the difference (beyond 2 either way: unlikely to be chance alone). The condition is a strategy's rules. Study before you build: a strategy on a condition with no edge has none.`,
      parameters: obj({ market: symbolParam, timeframe: { type: "string", enum: [...TIMEFRAMES] }, when: RULES, horizons: { type: "array", items: { type: "integer", minimum: 1, maximum: 200 }, maxItems: 6 } }, ["market", "timeframe", "when"]),
      describe: (a) => `study a signal on ${String(a.market)} ${String(a.timeframe)}`, decision: "allow",
      precheck: (a) => problemOf({ name: "study", symbol: a.market, timeframe: a.timeframe, entry: a.when, sizePct: 100 }),
      async run(a) {
        try {
          const symbol = String(a.market);
          const tf = a.timeframe as Timeframe;
          const horizons = Array.isArray(a.horizons) && a.horizons.length ? (a.horizons as number[]) : [1, 4, 12, 24];
          const c = await bars(symbol, tf);
          const st = eventStudy(a.when as Rules, c, horizons);
          const head = `${symbol} on ${tf}, ${st.bars} closed bars from ${day(c[0]!.t)} to ${day(c.at(-1)!.t)}: the condition (${rulesWords(a.when as Rules)})`;
          if (!st.events) return { content: `${head} never held: nothing to study. Loosen it, or read another timeframe.` };
          const lines = [`${head} first held ${st.events} time${st.events === 1 ? "" : "s"}.`];
          for (const x of st.after) {
            const bars = `${x.bars} bar${x.bars === 1 ? "" : "s"} after`;
            lines.push(x.n
              ? `  ${bars} (${x.n}): ${pct(x.avgPct)} on average, median ${pct(x.medianPct)}, up ${Math.round((x.upRate ?? 0) * 100)}% of the time; any bar: ${pct(x.basePct)}, up ${Math.round((x.baseUpRate ?? 0) * 100)}%; t ${x.t === null ? "n/a" : x.t.toFixed(2)}`
              : `  ${bars}: no event far enough from the end`);
          }
          if (st.events < 20) lines.push(`Only ${st.events} events: too few to trust either way.`);
          if (st.latest.length) lines.push(`The latest: ${st.latest.map((e) => `${day(e.t)} at ${e.px.toPrecision(6)}`).join("; ")}.`);
          return { content: lines.join("\n") };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "compare_strategies", group: q, label: "Comparing strategies",
      description: `Strategies compared honestly: 2 to 12 variants of one market and timeframe (one change each is clearest), each run once over the same history (up to ${HISTORY} closed bars) and judged on its earlier part (70% unless you say) and on the later part, which a choice made on the earlier never saw: return, deepest fall, trades, win rate and profit factor in each. Says which was best on the earlier part, how it did on the later, and warns when a lead did not carry (fitted to the past).`,
      parameters: obj({ strategies: { type: "array", items: STRATEGY, minItems: 2, maxItems: 12 }, split: { type: "number", minimum: 0.5, maximum: 0.9 } }, ["strategies"]),
      describe: (a) => `compare ${Array.isArray(a.strategies) ? a.strategies.length : 0} strategies`, decision: "allow",
      precheck: (a) => {
        const list = Array.isArray(a.strategies) ? (a.strategies as Strategy[]) : [];
        if (list.length < 2) return "give 2 to 12 strategies";
        for (const x of list) {
          const p = problemOf(x);
          if (p) return `${x?.name ?? "a strategy"}: ${p}`;
        }
        const [f] = list;
        return list.every((x) => x.symbol === f!.symbol && x.timeframe === f!.timeframe) ? null : "compare variants of one market and timeframe: the same history for each";
      },
      async run(a) {
        try {
          const list = a.strategies as Strategy[];
          const c = await bars(list[0]!.symbol, list[0]!.timeframe);
          const cmp = compareFitted(list, c, typeof a.split === "number" ? a.split : 0.7);
          const lines = [
            `${list[0]!.symbol} on ${list[0]!.timeframe}: the earlier ${cmp.fitBars} bars (to ${day(cmp.splitAt)}) and the later ${cmp.testBars}, which no choice here saw.`,
            ...cmp.rows.map((x) => `  ${x.name}: earlier ${partWords(x.fit)}; later ${partWords(x.test)}`),
          ];
          if (cmp.best) lines.push(`Best on the earlier part: ${cmp.best}.`);
          if (cmp.warning) lines.push(`Warning: ${cmp.warning}.`);
          return { content: lines.join("\n") };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "stress_strategy", group: q, label: "Stress-testing a strategy",
      description: `One strategy stress-tested before it runs (up to ${HISTORY} closed bars): its result as written against holding the coin; with fees and slippage doubled and tripled; on each half of its history alone; the same rules on its neighbouring timeframes and on other markets (BTC, ETH and SOL unless you name up to four); with what each says.`,
      parameters: obj({ strategy: STRATEGY, markets: { type: "array", items: { type: "string", enum: [...SYMBOLS] }, maxItems: 4 } }, ["strategy"]),
      describe: (a) => `stress-test ${String((a.strategy as Strategy | undefined)?.name ?? "a strategy")}`, decision: "allow",
      precheck: (a) => problemOf(a.strategy),
      async run(a) {
        try {
          const spec = a.strategy as Strategy;
          const c = await bars(spec.symbol, spec.timeframe);
          const i = TIMEFRAMES.indexOf(spec.timeframe);
          const near = [TIMEFRAMES[i - 1], TIMEFRAMES[i + 1]].filter((x): x is Timeframe => x !== undefined && x !== "1m");
          const markets = (Array.isArray(a.markets) && a.markets.length ? (a.markets as string[]) : ["BTC", "ETH", "SOL"]).filter((m) => m !== spec.symbol);
          const others: { label: string; bars: Candle[] }[] = [];
          for (const tf of near) others.push({ label: `${spec.symbol} on ${tf}`, bars: await desk.market.closed(spec.symbol, tf, HISTORY).catch(() => []) });
          for (const m of markets) others.push({ label: `${m} on ${spec.timeframe}`, bars: await desk.market.closed(m, spec.timeframe, HISTORY).catch(() => []) });
          const s = stress(spec, c, others);
          const lines = [
            words(spec),
            `Over ${c.length} bars: ${partWords(s.base)}; holding the coin ${pct(s.base.holdPct)}.`,
            `Fees and slippage doubled: ${partWords(s.costs2)}. Tripled: ${partWords(s.costs3)}.`,
            `The first half: ${partWords(s.firstHalf)}. The second: ${partWords(s.secondHalf)}.`,
            ...s.others.map((x) => `  ${x.label}: ${x.part ? `${partWords(x.part)}; holding ${pct(x.holdPct)}` : "no bars"}`),
            ...s.verdicts,
          ];
          return { content: lines.join("\n") };
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "desk_risk", group: r, label: "Reading the desk's risk",
      description: "The desk's risk now: each account on the desk, by its orb, and all of them together: its dollars, what it holds and what that is worth, how much of it is in coins and in its largest one, a day's value at risk at 95% and the worst day of the last 90 replayed on what it holds now (each coin's own daily closes, on the same days).",
      parameters: obj({}, []),
      describe: () => "read the desk's risk", decision: "allow",
      async run() {
        try {
          // each orb's account, and the runs it has going on it
          const orbs = [...new Set([...desk.accounts().map((x) => x.orb), ...desk.books().filter((b) => b.state === "live").map((b) => b.orb)])].filter((x) => x !== YOU);
          const accounts = orbs.map((orb) => {
            const own = desk.account(orb).book;
            const runs = desk.books().filter((b) => b.orb === orb && b.strategy !== null && b.state === "live");
            const holdings: Holding[] = [
              ...own.holdings.filter((h) => h.qty > 0).map((h) => ({ market: h.symbol, qty: h.qty, px: null })),
              ...runs.filter((b) => b.qty > 0 && b.symbol).map((b) => ({ market: b.symbol!, qty: b.qty, px: null })),
            ];
            return { orb, cash: own.cash + runs.reduce((n, b) => n + b.cash, 0), holdings };
          });
          const markets = [...new Set(accounts.flatMap((x) => x.holdings.map((h) => h.market)))];
          const price = new Map<string, number | null>();
          const closes = new Map<string, Closes>();
          let tokens = 0;
          for (const m of markets) {
            price.set(m, await desk.market.price(m).catch(() => null));
            // a token's days come from the DEX data, which is asked sparingly: four tokens a reading
            if (m.includes(":") && ++tokens > 4) continue;
            const daily = await desk.market.closed(m, "1d", 91).catch(() => [] as Candle[]);
            if (daily.length) closes.set(m, daily.map((b) => ({ t: b.t, c: b.c })));
          }
          const priced = (h: readonly Holding[]): Holding[] => h.map((x) => ({ ...x, px: price.get(x.market) ?? null }));
          const say = (x: Exposure, name: string): string => {
            const top = x.positions.slice(0, 5).map((p) => `${p.qty.toPrecision(5)} ${p.market} (${usd(p.value)}, ${p.pct.toFixed(1)}%)`).join("; ");
            return [
              `${name}: ${usd(x.equity)}, ${usd(x.cash)} of it dollars; ${x.investedPct.toFixed(1)}% in coins${x.largestPct !== null ? `, the largest ${x.positions[0]!.market} at ${x.largestPct.toFixed(1)}%` : ""}.`,
              top ? ` Holding: ${top}.` : " Holding nothing.",
              x.var95 !== null ? ` A day's value at risk (95%): ${usd(x.var95)}; the worst of the last ${x.days} days, replayed on what it holds: ${usd(x.worstDay!)}.` : x.positions.length ? " Too few days to measure its value at risk." : "",
              x.unmeasured.length ? ` Not measured (no price or no daily closes): ${x.unmeasured.join(", ")}.` : "",
            ].join("");
          };
          if (!accounts.length) return { content: "No account on the desk holds anything or has a run going." };
          const all = together("The desk", accounts.map((x) => ({ cash: x.cash, holdings: priced(x.holdings) })));
          const lines = [say(exposureOf(all.who, all.cash, all.holdings, closes), "The desk, every account together")];
          for (const x of accounts) lines.push(say(exposureOf(x.orb, x.cash, priced(x.holdings), closes), o.nameOf(x.orb)));
          return { content: lines.join("\n") };
        } catch (e) {
          return fail(e);
        }
      },
    },
  ];
}
