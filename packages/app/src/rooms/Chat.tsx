// A private chat with one orb (PLAN 2.10; owner, 2026-10-01: "you can also just have a single
// private chat with one of your orbs, whether its voice or text"). Text first; his voice comes
// with the kit's (4.3). The conversation (Talk.tsx) is his and yours only: no other orb, and no
// session, sees it.
import { useState } from "react";
import { Orb } from "../orb/Orb.tsx";
import { SPECIALTIES, type Character } from "../orb/spec.ts";
import { chatOf, idOf, type Message, type Office } from "../home/link.ts";
import { Talk, type Busy } from "./Talk.tsx";
import { Computer } from "./Computer.tsx";

export function Chat({ orb, home, person }: { orb: Character; home: Office | null; person: string | null }) {
  const [busy, setBusy] = useState<Busy>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [computer, setComputer] = useState(true); // his computer beside the chat (PLAN 2.8), there unless you hide it
  if (!home) {
    return (
      <div style={{ display: "grid", placeItems: "center", alignContent: "center", gap: "var(--s3)", padding: "var(--s7) var(--s5)", textAlign: "center" }}>
        <Orb character={orb} size={120} />
        <span style={{ font: "700 20px/26px var(--font)", color: "var(--text-1)" }}>Chatting needs your home</span>
        <span style={{ font: "400 15px/21px var(--font)", color: "var(--text-3)", maxWidth: 420 }}>
          This is a preview. Start your home (pnpm start) and open the link it prints: then {orb.name} can answer.
        </span>
      </div>
    );
  }
  const how = busy[idOf(orb.name)];
  const conv = chatOf(orb);
  return (
    <div data-orb={orb.hue} data-chat={conv} style={{ display: "grid", gridTemplateRows: "auto 1fr", minHeight: "min(100%, calc(100dvh - 120px))", minWidth: 0 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "var(--s3) var(--s5)", boxShadow: "0 1px 0 var(--sep)", minWidth: 0 }}>
        <Orb character={orb} size={52} state={how ?? "idle"} poke={false} />
        <div style={{ display: "grid", minWidth: 0 }}>
          <span style={{ font: "800 18px/24px var(--font)", color: "var(--accent)" }}>{orb.name}</span>
          <span style={{ font: "400 13px/18px var(--font)", color: "var(--text-3)" }}>{how === "speaking" ? "Writing…" : how ? "Working…" : `${SPECIALTIES[orb.specialty].title} · a private chat`}</span>
        </div>
        <button onClick={() => setComputer((v) => !v)} aria-pressed={computer} style={{ marginLeft: "auto", flex: "0 0 auto", font: "600 13px/18px var(--font)", color: "var(--text-1)", background: computer ? "var(--accent-fill)" : "var(--fill)", border: 0, borderRadius: 10, padding: "6px 12px", cursor: "pointer", boxShadow: computer ? "inset 0 0 0 1.5px var(--accent)" : "inset 0 0 0 .5px var(--hairline)", minHeight: 36 }}>
          His computer
        </button>
      </header>
      <div className={computer ? "orbs-beside" : undefined} style={{ display: "grid", gap: "var(--s4)", minWidth: 0, paddingTop: computer ? "var(--s4)" : 0 }}>
        {computer && (
          <div style={{ padding: "0 var(--s5)", minWidth: 0 }}>
            <Computer home={home} orb={orb} messages={messages} busy={how} />
          </div>
        )}
        <Talk
          home={home}
          conversation={conv}
          orbs={[orb]}
          send={(text) => home.say(orb, text)}
          attach={(file) => home.give(orb, file)}
          placeholder={`Message ${orb.name}`}
          empty={`Say hello to ${orb.name}${person ? `, ${person}` : ""}. Just you two: no one else sees this.`}
          onBusy={setBusy}
          onMessages={setMessages}
        />
      </div>
    </div>
  );
}
