// The brains, in Settings (PLAN 1.11, owner 10-01: "ChatGPT first, then a Gemini key, then a local
// coder"; sign-in is ChatGPT only). The order as it stands now, each brain ready, resting (and
// why, till when) or not set up; ChatGPT's sign-in and its model; one Gemini key; a web-search key
// for the researchers (PLAN 3.10); a local coder. A key goes to the home's keychain and never comes
// back to the page: the page only learns whether one is kept.
import { useEffect, useState, type CSSProperties } from "react";
import type { Brains as BrainsNow, ChatGPT, Office } from "../home/link.ts";

const panel: CSSProperties = { display: "grid", gap: "var(--s3)", padding: "var(--s4)", borderRadius: 18, background: "var(--fill)", boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0 };
const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)", margin: 0 };
const button: CSSProperties = { font: "600 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 14px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 36, flex: "0 0 auto" };
const field: CSSProperties = { flex: "1 1 160px", minWidth: 0, font: "600 15px/21px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 12px", outline: 0, boxShadow: "inset 0 0 0 1px var(--hairline)" };
const small: CSSProperties = { font: "400 12px/17px var(--font)", color: "var(--text-3)", overflowWrap: "anywhere", textWrap: "balance" };
const name: CSSProperties = { font: "700 14px/19px var(--font)", color: "var(--text-1)" };
const STATE_WORDS = { ready: "Ready", resting: "Resting", absent: "Not set up" } as const;

function Key({ label, kept, save, clear }: { label: string; kept: boolean; save: (k: string) => void; clear: () => void }) {
  const [draft, setDraft] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) save(draft.trim());
        setDraft("");
      }}
      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
    >
      <input type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={label} placeholder={kept ? "A key is kept: paste another to replace it" : "Paste the key"} size={1} style={field} />
      <span style={{ display: "flex", gap: 8 }}>
        <button type="submit" style={button}>
          Keep
        </button>
        {kept && (
          <button type="button" onClick={clear} style={button}>
            Remove
          </button>
        )}
      </span>
    </form>
  );
}

export function Brains({ home }: { home: Office }) {
  const [now, setNow] = useState<BrainsNow | null>(null);
  const [plan, setPlan] = useState<ChatGPT | null>(null);
  const [local, setLocal] = useState({ baseUrl: "", model: "" });
  const [said, setSaid] = useState<string | null>(null);
  const load = (): void => {
    home.brains().then((b) => {
      setNow(b);
      if (b.local) setLocal(b.local);
    }, (e: Error) => setSaid(e.message));
    home.chatgpt().then(setPlan, () => setPlan(null));
  };
  useEffect(() => {
    load();
    return home.watch({ event: (e) => void (/^(chatgpt|brain)\./.test(e.type) && load()) });
  }, [home]);
  const act = (p: Promise<unknown>): void => {
    setSaid(null);
    p.then(load, (e: Error) => setSaid(e.message));
  };
  const until = (t: number | null): string => (t ? ` until ${new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "");
  return (
    <section style={panel} aria-label="Brains">
      <h3 style={head}>Brains</h3>
      <span style={small}>Your orbs ask the first that can answer, in this order; one that cannot rests and the next says so.</span>
      <ol style={{ display: "grid", gap: 6, margin: 0, padding: 0, listStyle: "none" }}>
        {(now?.order ?? []).map((b, i) => (
          <li key={b.id} data-brain={b.id} data-state={b.state} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 10, alignItems: "start" }}>
            <span aria-hidden style={{ width: 24, height: 24, borderRadius: "50%", display: "grid", placeItems: "center", font: "800 12px/14px var(--font)", background: b.state === "ready" ? "var(--accent-fill)" : "var(--fill)", color: b.state === "ready" ? "var(--accent)" : "var(--text-3)", boxShadow: "inset 0 0 0 .5px var(--hairline)" }}>{i + 1}</span>
            <span style={{ display: "grid", minWidth: 0 }}>
              <span style={name}>{b.label.charAt(0).toUpperCase() + b.label.slice(1)} · {STATE_WORDS[b.state]}{b.state === "resting" ? until(b.until) : ""}</span>
              {b.state === "resting" && b.why && <span style={small}>{b.why}</span>}
            </span>
          </li>
        ))}
      </ol>
      <div style={{ display: "grid", gap: 8 }}>
        <span style={name}>ChatGPT</span>
        {plan?.connected ? (
          <>
            <span style={small}>Signed in{plan.account?.email ? ` as ${plan.account.email}` : ""}. Your plan answers first{plan.paused ? `; at its limit${until(plan.paused.until)}` : ""}.</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {plan.models.length > 0 && (
                <select aria-label="ChatGPT's model" value={plan.model ?? ""} onChange={(e) => act(home.chatgptModel(e.target.value))} style={{ ...field, flex: "1 1 200px" }}>
                  {plan.models.map((m) => (
                    <option key={m.slug} value={m.slug}>{m.name}</option>
                  ))}
                </select>
              )}
              <button onClick={() => act(home.chatgptSignOut())} style={button}>
                Sign out
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              data-sound="pick"
              onClick={() => {
                // opened on the press itself (a window opened after a wait is blocked), then sent to the sign-in
                const w = globalThis.open?.("about:blank", "_blank") ?? null;
                if (w) w.opener = null;
                act(home.chatgptSignIn().then((url) => {
                  if (w) w.location.href = url;
                  else globalThis.location.assign(url);
                }, (e: unknown) => {
                  w?.close();
                  throw e;
                }));
              }}
              style={{ ...button, background: "var(--accent-fill)", boxShadow: "inset 0 0 0 1.5px var(--accent)" }}
            >
              {plan?.signingIn ? "Signing in…" : "Continue with ChatGPT"}
            </button>
            <span style={{ ...small, flex: "1 1 200px" }}>On the machine your home runs on: the sign-in comes back to it.</span>
          </div>
        )}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <span style={name}>Gemini{now?.gemini ? ` · ${now.gemini.model}` : ""}</span>
        <Key label="Your Gemini key" kept={Boolean(now?.gemini)} save={(k) => act(home.setKey("gemini", k))} clear={() => act(home.setKey("gemini", null))} />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <span style={name}>Web search, for the researchers</span>
        <Key label="Your Tavily key" kept={Boolean(now?.search)} save={(k) => act(home.setKey("search", k))} clear={() => act(home.setKey("search", null))} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act(home.setLocal({ baseUrl: local.baseUrl.trim(), model: local.model.trim() }));
        }}
        style={{ display: "grid", gap: 8 }}
      >
        <span style={name}>A local coder</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={local.baseUrl} onChange={(e) => setLocal((l) => ({ ...l, baseUrl: e.target.value }))} aria-label="Its address" placeholder="http://127.0.0.1:11434/v1" size={1} style={field} />
          <input value={local.model} onChange={(e) => setLocal((l) => ({ ...l, model: e.target.value }))} aria-label="Its model" placeholder="qwen2.5-coder" size={1} style={field} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="submit" style={button}>
            Keep
          </button>
          {now?.local && (
            <button type="button" onClick={() => act(home.setLocal(null).then(() => setLocal({ baseUrl: "", model: "" })))} style={button}>
              Remove
            </button>
          )}
        </div>
      </form>
      {said && <span role="alert" style={{ color: "var(--alert)", font: "600 13px/18px var(--font)" }}>{said}</span>}
    </section>
  );
}
