// Your connections, in Settings (PLAN 4.2: "connectors, no middleman"). First your Google and Microsoft
// accounts (owner 10-02: "teams or slack calendar, or simply gmail or outlook"), each connected by its
// own sign-in: its mail and its calendar at once. Teams' calendar is the Microsoft one, and Slack keeps
// none of its own: it shows your Google or Outlook calendar, so it points there. Then, by hand: your own calendars by their
// subscribe address (read only), your mail accounts (read, and replies kept as drafts: Orbs never
// sends), and connectors (MCP servers: by their address, or a program on your home's machine). Each
// goes straight from your home to the service, nobody in between. A password, a key or a calendar's
// secret address goes to the home's keychain and never comes back to the page.
import { useEffect, useState, type CSSProperties } from "react";
import { idOf, type Accounts, type CalendarFeed, type Connector, type ConnectorSpec, type MailAccount, type Office } from "../home/link.ts";
import { CATALOG } from "../home/catalog.ts";

const panel: CSSProperties = { display: "grid", gap: "var(--s3)", padding: "var(--s4)", borderRadius: 18, background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", minWidth: 0 };
const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)", margin: 0 };
const button: CSSProperties = { font: "600 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 14px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 36, flex: "0 0 auto" };
const field: CSSProperties = { flex: "1 1 160px", minWidth: 0, font: "600 15px/21px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 12px", outline: 0, boxShadow: "inset 0 0 0 1px var(--hairline)" };
const small: CSSProperties = { font: "400 12px/17px var(--font)", color: "var(--text-3)", overflowWrap: "anywhere", textWrap: "balance" };
const name: CSSProperties = { font: "700 14px/19px var(--font)", color: "var(--text-1)", overflowWrap: "anywhere" };
const pair: CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const row: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "center" };
const list: CSSProperties = { display: "grid", gap: 8, margin: 0, padding: 0, listStyle: "none" };

/** A name the home can keep (lowercase letters, digits, - and _, up to 32), not one already taken. */
export function nameFor(words: string, taken: string[]): string {
  const base = idOf(words).slice(0, 28).replace(/-+$/, "") || "mine";
  let n = base;
  for (let i = 2; taken.includes(n); i++) n = `${base}-${i}`;
  return n;
}

/** A command line as its words: spaces split, "quoted words" kept together. */
export function wordsOf(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

const at = (t: number): string => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function Connections({ home }: { home: Office }) {
  const [feeds, setFeeds] = useState<CalendarFeed[]>([]);
  const [accounts, setAccounts] = useState<Record<string, MailAccount>>({});
  const [servers, setServers] = useState<Connector[]>([]);
  const [linked, setLinked] = useState<Accounts | null>(null);
  const [slack, setSlack] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cal, setCal] = useState({ label: "", address: "" });
  const [mail, setMail] = useState({ email: "", host: "", password: "", port: "" });
  const [tool, setTool] = useState({ kind: "url" as "url" | "command", name: "", where: "", secret: "" });
  const [preset, setPreset] = useState("");
  const chosen = CATALOG.find((c) => c.id === preset);
  const load = (): void => {
    home.calendars().then(setFeeds, (e: Error) => setSaid(e.message));
    home.mail().then(setAccounts, (e: Error) => setSaid(e.message));
    home.connectors().then(setServers, (e: Error) => setSaid(e.message));
    home.accounts().then(setLinked, (e: Error) => setSaid(e.message));
  };
  useEffect(() => {
    load();
    return home.watch({ event: (e) => void (/^(calendar|mail|connector|account)\./.test(e.type) && load()) });
  }, [home]);
  /** Does one thing; what it says goes up when it fails, and the forms are cleared only when it works. */
  const act = (p: () => Promise<unknown>, then?: () => void): void => {
    setSaid(null);
    setBusy(true);
    Promise.resolve().then(p).then(() => {
      then?.();
      load();
    }, (e: Error) => setSaid(e.message)).finally(() => setBusy(false));
  };

  const connector = (): { spec: ConnectorSpec; secrets: Record<string, string> } => {
    const secret = tool.secret.trim();
    if (tool.kind === "url") {
      return secret
        ? { spec: { url: tool.where.trim(), headers: { Authorization: { secret: "token" } } }, secrets: { token: /^bearer /i.test(secret) ? secret : `Bearer ${secret}` } }
        : { spec: { url: tool.where.trim() }, secrets: {} };
    }
    const [command = "", ...args] = wordsOf(tool.where);
    // a secret it needs, as NAME=value: kept in the keychain, handed to the program in its environment
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(secret);
    return m ? { spec: { command, args, env: { [m[1]!]: { secret: m[1]!.toLowerCase() } } }, secrets: { [m[1]!.toLowerCase()]: m[2]! } } : { spec: { command, args }, secrets: {} };
  };

  return (
    <section style={panel} aria-label="Connections">
      <h3 style={head}>Connections</h3>
      <span style={small}>Your own calendar, mail and tools, straight from your home to them: nobody in between. Passwords and keys stay in your home's keychain.</span>

      <div style={{ display: "grid", gap: 8 }} data-connections="accounts">
        <span style={name}>Your accounts</span>
        {linked && Object.keys(linked.accounts).length > 0 && (
          <ul style={list}>
            {Object.entries(linked.accounts).map(([n, a]) => (
              <li key={n} data-account={n} style={row}>
                <span style={{ display: "grid", minWidth: 0 }}>
                  <span style={name}>{a.email}</span>
                  <span style={small}>{a.provider === "google" ? "Google: Gmail and Google Calendar" : "Microsoft: Outlook mail, the Outlook and Teams calendar"}</span>
                </span>
                <button onClick={() => act(() => home.disconnectAccount(n))} aria-label={`Disconnect ${a.email}`} style={button}>
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(linked?.providers ?? []).map((p) => (
            <button
              key={p.id}
              data-provider={p.id}
              data-sound="pick"
              disabled={busy}
              onClick={() => {
                if (!p.ready) {
                  setSaid(`${p.title} can't be connected yet: ${p.why ?? "it is not set up"}`);
                  return;
                }
                // opened on the press itself (a window opened after a wait is blocked), then sent to the sign-in
                const w = globalThis.open?.("about:blank", "_blank") ?? null;
                if (w) w.opener = null;
                act(() => home.connectAccount(p.id).then((url) => {
                  if (w) w.location.href = url;
                  else globalThis.location.assign(url);
                }, (e: unknown) => {
                  w?.close();
                  throw e;
                }));
              }}
              style={{ ...button, display: "grid", textAlign: "left", flex: "1 1 200px", gap: 2 }}
            >
              <span>{p.id === "google" ? "Connect Google" : "Connect Microsoft"}</span>
              <span style={{ ...small, fontWeight: 400 }}>{p.id === "google" ? "Gmail and Google Calendar" : "Outlook mail, and your Outlook and Teams calendar"}</span>
            </button>
          ))}
          <button onClick={() => setSlack((v) => !v)} aria-expanded={slack} style={{ ...button, display: "grid", textAlign: "left", flex: "1 1 200px", gap: 2 }}>
            <span>Slack</span>
            <span style={{ ...small, fontWeight: 400 }}>Its calendar is your Google or Outlook one</span>
          </button>
        </div>
        {slack && <span data-slack style={{ ...small, color: "var(--text-2)" }}>Slack keeps no calendar of its own: it shows the Google or Outlook calendar it is linked to. Connect that account above, and its meetings are here too.</span>}
        <span style={small}>The sign-in opens in this browser and comes back to the computer your home runs on. Your orbs read your mail and keep replies in Drafts; they never send, and never change your calendar.</span>
      </div>

      <div style={{ display: "grid", gap: 8 }} data-connections="calendars">
        <span style={name}>Calendars</span>
        {feeds.length > 0 && (
          <ul style={list}>
            {feeds.map((f) => (
              <li key={f.name} data-calendar={f.name} style={row}>
                <span style={{ display: "grid", minWidth: 0 }}>
                  <span style={name}>{f.label}</span>
                  <span style={{ ...small, color: f.why ? "var(--alert)" : "var(--text-3)" }}>{f.why ? `Can't be read: ${f.why}` : f.read ? `Read at ${at(f.read)}` : "Not read yet"}</span>
                </span>
                {f.account ? (
                  <span style={small}>With its account</span>
                ) : (
                  <button onClick={() => act(() => home.removeCalendar(f.name))} aria-label={`Remove the calendar ${f.label}`} style={button}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const label = cal.label.trim() || "My calendar";
            act(() => home.addCalendar(nameFor(label, feeds.map((f) => f.name)), label, cal.address.trim()), () => setCal({ label: "", address: "" }));
          }}
          style={{ display: "grid", gap: 8 }}
        >
          <div style={pair}>
            <input value={cal.label} onChange={(e) => setCal((c) => ({ ...c, label: e.target.value }))} aria-label="What to call the calendar" placeholder="Work" size={1} maxLength={60} style={{ ...field, flex: "1 1 120px" }} />
            <input type="url" autoComplete="off" value={cal.address} onChange={(e) => setCal((c) => ({ ...c, address: e.target.value }))} aria-label="The calendar's address" placeholder="webcal:// or https:// …" size={1} required style={{ ...field, flex: "3 1 220px" }} />
          </div>
          <span style={small}>The address your calendar gives for subscribing (in Google Calendar: its settings, the secret address in iCal format). Your orbs read it; only you change it.</span>
          <button type="submit" disabled={busy} style={{ ...button, justifySelf: "start" }}>
            Add the calendar
          </button>
        </form>
      </div>

      <div style={{ display: "grid", gap: 8 }} data-connections="mail">
        <span style={name}>Mail</span>
        {Object.keys(accounts).length > 0 && (
          <ul style={list}>
            {Object.entries(accounts).map(([n, a]) => (
              <li key={n} data-mail={n} style={row}>
                <span style={{ display: "grid", minWidth: 0 }}>
                  <span style={name}>{a.address ?? a.user}</span>
                  <span style={small}>{a.host}</span>
                </span>
                {a.oauth ? (
                  <span style={small}>With its account</span>
                ) : (
                  <button onClick={() => act(() => home.removeMail(n))} aria-label={`Remove the mail account ${a.address ?? a.user}`} style={button}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const email = mail.email.trim();
            const port = Number(mail.port.trim() || "993");
            const host = mail.host.trim();
            // a mail server on this machine (a bridge, say) speaks plain IMAP: the home allows that only here
            const account: MailAccount = { host, user: email, address: email, ...(port !== 993 && { port }), ...(/^(127\.0\.0\.1|localhost|::1)$/.test(host) && { tls: false }) };
            act(() => home.addMail(nameFor(email.split("@")[0] ?? email, Object.keys(accounts)), account, mail.password), () => setMail({ email: "", host: "", password: "", port: "" }));
          }}
          style={{ display: "grid", gap: 8 }}
        >
          <div style={pair}>
            <input type="email" autoComplete="off" value={mail.email} onChange={(e) => setMail((m) => ({ ...m, email: e.target.value }))} aria-label="Your email address" placeholder="you@example.com" size={1} required style={field} />
            <input value={mail.host} onChange={(e) => setMail((m) => ({ ...m, host: e.target.value }))} aria-label="Its mail server (IMAP)" placeholder="imap.example.com" size={1} required style={field} />
          </div>
          <div style={pair}>
            <input type="password" autoComplete="off" value={mail.password} onChange={(e) => setMail((m) => ({ ...m, password: e.target.value }))} aria-label="Its password" placeholder="An app password, if your mail has them" size={1} required style={field} />
            <input inputMode="numeric" value={mail.port} onChange={(e) => setMail((m) => ({ ...m, port: e.target.value.replace(/\D/g, "") }))} aria-label="Its port" placeholder="993" size={1} maxLength={5} style={{ ...field, flex: "0 1 96px" }} />
          </div>
          <span style={small}>Your orbs read what arrives and keep replies in your Drafts for you to send. Orbs never sends mail.</span>
          <button type="submit" disabled={busy} style={{ ...button, justifySelf: "start" }}>
            Add the account
          </button>
        </form>
      </div>

      <div style={{ display: "grid", gap: 8 }} data-connections="connectors">
        <span style={name}>Connectors</span>
        {servers.length > 0 && (
          <ul style={list}>
            {servers.map((c) => (
              <li key={c.name} data-connector={c.name} data-state={c.state} style={row}>
                <span style={{ display: "grid", minWidth: 0 }}>
                  <span style={name}>{c.name}</span>
                  <span style={{ ...small, color: c.state === "failed" ? "var(--alert)" : "var(--text-3)" }}>
                    {c.state === "ready" ? `Ready · ${c.tools.length} ${c.tools.length === 1 ? "tool" : "tools"}` : c.state === "starting" ? "Starting…" : `Didn't start: ${c.why ?? "no reason given"}`}
                  </span>
                </span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => act(() => home.connector(c.name, "restart"))} aria-label={`Restart ${c.name}`} style={button}>
                    Restart
                  </button>
                  <button onClick={() => act(() => home.connector(c.name, "remove"))} aria-label={`Remove ${c.name}`} style={button}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const { spec, secrets } = connector();
            const label = tool.name.trim() || ("url" in spec ? new URL(spec.url, "http://x").hostname.split(".")[0] ?? "tools" : spec.command.split("/").at(-1) ?? "tools");
            act(() => home.addConnector(nameFor(label, servers.map((s) => s.name)), spec, secrets), () => {
              setTool((t) => ({ ...t, name: "", where: "", secret: "" }));
              setPreset("");
            });
          }}
          style={{ display: "grid", gap: 8 }}
        >
          <select
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              const c = CATALOG.find((x) => x.id === e.target.value);
              setTool(c ? { kind: c.kind, name: c.title, where: c.where, secret: "" } : { kind: "url", name: "", where: "", secret: "" });
            }}
            aria-label="From the catalog"
            style={{ ...field, flex: "none" }}
          >
            <option value="">Your own connector</option>
            {CATALOG.map((c) => (
              <option key={c.id} value={c.id}>{`${c.title}: ${c.what}`}</option>
            ))}
          </select>
          <div style={pair}>
            <select value={tool.kind} onChange={(e) => setTool((t) => ({ ...t, kind: e.target.value as "url" | "command" }))} aria-label="How it is reached" style={{ ...field, flex: "1 1 160px" }}>
              <option value="url">By its address</option>
              <option value="command">A program on your home's machine</option>
            </select>
            <input value={tool.name} onChange={(e) => setTool((t) => ({ ...t, name: e.target.value }))} aria-label="What to call it" placeholder="Its name" size={1} maxLength={28} style={{ ...field, flex: "1 1 120px" }} />
          </div>
          <div style={pair}>
            <input
              autoComplete="off" value={tool.where} onChange={(e) => setTool((t) => ({ ...t, where: e.target.value }))} size={1} required style={{ ...field, flex: "3 1 220px" }}
              aria-label={tool.kind === "url" ? "Its address" : "The command that runs it"} placeholder={tool.kind === "url" ? "https://…/mcp" : "npx some-mcp-server"}
            />
            <input
              type="password" autoComplete="off" value={tool.secret} onChange={(e) => setTool((t) => ({ ...t, secret: e.target.value }))} size={1} style={{ ...field, flex: "1 1 160px" }}
              aria-label={tool.kind === "url" ? "Its key, if it needs one" : "A secret it needs, as NAME=value"} placeholder={chosen?.secret ?? (tool.kind === "url" ? "Its key (optional)" : "NAME=value (optional)")}
            />
          </div>
          {chosen?.fill && <span style={{ ...small, color: "var(--text-2)" }}>{chosen.fill}</span>}
          <span style={small}>{tool.kind === "url" ? "A connector's tools ask you before each use, and what they say back is never taken as your word." : "A program runs on the machine your home is on, so it is added there, not from another device."}</span>
          <button type="submit" disabled={busy} style={{ ...button, justifySelf: "start" }}>
            Add the connector
          </button>
        </form>
      </div>
      {said && <span role="alert" style={{ color: "var(--alert)", font: "600 13px/18px var(--font)" }}>{said}</span>}
    </section>
  );
}
