// The passwords you save for your orbs' browsers (PLAN 4.1), in Settings. Each is kept sealed on
// your home, its key in the keychain; an orb signs in with one only on the very site it was saved
// for, and never sees it. Here a password goes in once and is never shown back: the list names the
// site and the username, and the field is emptied the moment it is saved.
import { useEffect, useState, type CSSProperties } from "react";
import type { Office, VaultEntry } from "../home/link.ts";

const panel: CSSProperties = { display: "grid", gap: "var(--s3)", padding: "var(--s4)", borderRadius: 18, background: "var(--fill)", boxShadow: "inset 0 0 0 1px var(--hairline)", minWidth: 0 };
const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)", margin: 0 };
const button: CSSProperties = { font: "600 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 14px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 36 };
const row: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "center", minWidth: 0 };
const name: CSSProperties = { font: "700 14px/19px var(--font)", color: "var(--text-1)", overflowWrap: "anywhere" };
const small: CSSProperties = { font: "400 12px/17px var(--font)", color: "var(--text-3)", overflowWrap: "anywhere", textWrap: "balance" };
const field: CSSProperties = { minWidth: 0, font: "600 15px/21px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 12px", outline: 0, boxShadow: "inset 0 0 0 1px var(--hairline)" };

export function Passwords({ home }: { home: Office }) {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [site, setSite] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    home.vault().then(setEntries, (e: Error) => setSaid({ ok: false, text: e.message }));
  }, [home]);
  const save = (): void => {
    setSaid(null);
    const pw = password;
    setPassword(""); // out of the page at once, whatever the home says
    home.savePassword(site, user, pw).then(
      (e) => {
        setEntries(e);
        setSaid({ ok: true, text: `Saved for ${user.trim()}. Your orbs can sign in with it on that site only.` });
        setSite("");
        setUser("");
      },
      (e: Error) => setSaid({ ok: false, text: e.message }),
    );
  };
  return (
    <section style={panel} aria-label="Passwords">
      <h3 style={head}>Passwords</h3>
      <span style={small}>For your orbs' browsers. Kept sealed on your home; typed only on the site it was saved for, and never shown to an orb.</span>
      {entries.map((e) => (
        <div key={`${e.site} ${e.username}`} data-password={e.site} style={row}>
          <span style={{ display: "grid", minWidth: 0 }}>
            <span style={name}>{e.site}</span>
            <span style={small}>{e.username}</span>
          </span>
          <button onClick={() => home.removePassword(e.site, e.username).then(setEntries, (x: Error) => setSaid({ ok: false, text: x.message }))} aria-label={`Remove the password for ${e.username} on ${e.site}`} style={button}>
            Remove
          </button>
        </div>
      ))}
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          save();
        }}
        style={{ display: "grid", gap: 8, minWidth: 0 }}
      >
        <input value={site} onChange={(ev) => setSite(ev.target.value)} aria-label="The site's sign-in address" placeholder="Its sign-in page (github.com/login)" autoComplete="off" spellCheck={false} size={1} style={field} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 8, minWidth: 0 }}>
          <input value={user} onChange={(ev) => setUser(ev.target.value)} aria-label="Username" placeholder="Username or email" autoComplete="off" spellCheck={false} size={1} style={field} />
          <input value={password} onChange={(ev) => setPassword(ev.target.value)} aria-label="Password" placeholder="Password" type="password" autoComplete="new-password" size={1} style={field} />
        </div>
        <span>
          <button type="submit" data-sound="pick" disabled={!site.trim() || !user.trim() || !password} style={{ ...button, opacity: !site.trim() || !user.trim() || !password ? 0.55 : 1 }}>
            Save the password
          </button>
        </span>
      </form>
      {said && <span role={said.ok ? "status" : "alert"} style={{ font: "500 13px/18px var(--font)", color: said.ok ? "var(--text-3)" : "var(--alert)" }}>{said.text}</span>}
    </section>
  );
}
