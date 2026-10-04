// Your devices and passkeys (PLAN 2.7), in Settings: every browser signed in to your home, each one
// signed out in a press (it is locked out at its next request); a phone added by a QR code (a link
// good once, for five minutes); and your passkeys, to sign in from anywhere without a link.
import { useEffect, useState, type CSSProperties } from "react";
import { type Device, type Office, type Passkey, passkeysHere } from "../home/link.ts";
import { QrCode } from "../ui/Qr.tsx";

const panel: CSSProperties = { display: "grid", gap: "var(--s3)", padding: "var(--s4)", borderRadius: 18, background: "var(--fill)", boxShadow: "inset 0 0 0 .5px var(--hairline)", minWidth: 0 };
const head: CSSProperties = { font: "700 11px/16px var(--font)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)", margin: 0 };
const button: CSSProperties = { font: "600 14px/20px var(--font)", color: "var(--text-1)", background: "var(--fill)", border: 0, borderRadius: 10, padding: "8px 14px", cursor: "pointer", boxShadow: "inset 0 0 0 .5px var(--hairline)", minHeight: 36 };
const row: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "center", minWidth: 0 };
const name: CSSProperties = { font: "700 14px/19px var(--font)", color: "var(--text-1)", overflowWrap: "anywhere" };
const small: CSSProperties = { font: "400 12px/17px var(--font)", color: "var(--text-3)", overflowWrap: "anywhere", textWrap: "balance" };

const ago = (t: number): string => {
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

/** A passkey needs a name to belong to: this page's, not a bare address (127.0.0.1). */
const nameHere = (): boolean => !/^[\d.]+$|^\[/.test(globalThis.location?.hostname ?? "");

export function Devices({ home }: { home: Office }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [keys, setKeys] = useState<Passkey[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false); // the pairing link just copied (owner, 10-03)
  const [said, setSaid] = useState<string | null>(null);
  const load = (): void => {
    home.devices().then(setDevices, (e: Error) => setSaid(e.message));
    home.passkeys().then(setKeys, (e: Error) => setSaid(e.message));
  };
  useEffect(load, [home]);
  const act = (p: Promise<unknown>, after: () => void = load): void => {
    setSaid(null);
    p.then(after, (e: Error) => setSaid(e.message));
  };
  return (
    <>
      <section style={panel} aria-label="Your devices">
        <h3 style={head}>Your devices</h3>
        {devices.map((d) => (
          <div key={d.id} data-device={d.id} style={row}>
            <span style={{ display: "grid", minWidth: 0 }}>
              <span style={name}>{d.name}{d.current ? " · this one" : ""}</span>
              <span style={small}>{d.via === "passkey" ? "Signed in with your passkey" : "Paired by a link"} · seen {ago(d.seenAt)}</span>
            </span>
            <button onClick={() => act(home.signOut(d.id), d.current ? () => location.reload() : load)} aria-label={`Sign out ${d.name}`} style={button}>
              Sign out
            </button>
          </div>
        ))}
        {link ? (
          <div data-pairing style={{ display: "flex", gap: "var(--s4)", alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
            <QrCode text={link} size={200} label="A QR code: scan it with your phone's camera to pair it" />
            <span style={{ display: "grid", gap: 6, flex: "1 1 220px", minWidth: 0 }}>
              <span style={name}>Scan it with your phone</span>
              <span style={small}>
                {/^(127\.|localhost$|\[::1\]$)/.test(new URL(link).hostname) ? (
                  <>
                    Good once, for five minutes, on this computer only: a phone reaches your home by its own name. Start it with one (
                    <span style={{ font: "400 12px/17px var(--mono)", whiteSpace: "nowrap" }}>pnpm start --name</span>, with that name's certificate) and add the phone here again.
                  </>
                ) : (
                  "Good once, for five minutes. Or open this on the phone:"
                )}
              </span>
              <span style={{ font: "400 12px/17px var(--mono)", color: "var(--text-2)", overflowWrap: "anywhere", userSelect: "all" }}>{link}</span>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {/* the same link to paste where a camera cannot reach (owner, 10-03: "add copy link ... next to the qr code") */}
                <button
                  onClick={() => void navigator.clipboard.writeText(link).then(
                    () => (setCopied(true), void setTimeout(() => setCopied(false), 2000)),
                    () => setSaid("This browser would not copy: select the link above and copy it."),
                  )}
                  style={button}>
                  {copied ? "Copied" : "Copy link"}
                </button>
                <button onClick={() => (setLink(null), setCopied(false), load())} style={button}>
                  Done
                </button>
              </span>
            </span>
          </div>
        ) : (
          <span>
            <button data-sound="pick" onClick={() => act(home.pairPhone().then(setLink), () => undefined)} style={button}>
              Add a phone
            </button>
          </span>
        )}
      </section>
      <section style={panel} aria-label="Passkeys">
        <h3 style={head}>Passkeys</h3>
        <span style={small}>Sign in from any of your devices with a fingerprint, a face or a PIN, without a pairing link.</span>
        {keys.map((k) => (
          <div key={k.id} data-passkey={k.id} style={row}>
            <span style={{ display: "grid", minWidth: 0 }}>
              <span style={name}>{k.name}</span>
              <span style={small}>Added {ago(k.createdAt)}{k.usedAt ? ` · used ${ago(k.usedAt)}` : ""}</span>
            </span>
            <button onClick={() => act(home.removePasskey(k.id))} aria-label={`Remove the passkey ${k.name}`} style={button}>
              Remove
            </button>
          </div>
        ))}
        {passkeysHere() && nameHere() ? (
          <span>
            <button onClick={() => act(home.addPasskey())} style={button}>
              Add a passkey on this device
            </button>
          </span>
        ) : (
          <span style={small}>A passkey is made where your home has a name: open it at localhost, or by your box's own name.</span>
        )}
      </section>
      {said && <span role="alert" style={{ color: "var(--alert)", font: "600 13px/18px var(--font)" }}>{said}</span>}
    </>
  );
}
