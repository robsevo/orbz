// A private chat with one orb (PLAN 2.10; owner, 2026-10-01: "you can also just have a single
// private chat with one of your orbs, whether its voice or text"). Text first; his voice comes
// with the kit's (4.3). The conversation (Talk.tsx) is his and yours only: no other orb, and no
// session, sees it.
import { useState } from "react";
import { Orb } from "../orb/Orb.tsx";
import { SPECIALTIES, type Character } from "../orb/spec.ts";
import { chatOf, idOf, type Office } from "../home/link.ts";
import { Talk, type Busy } from "./Talk.tsx";

export function Chat({ orb, home, person }: { orb: Character; home: Office | null; person: string | null }) {
  const [busy, setBusy] = useState<Busy>({});
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
      <header style={{ display: "flex", alignItems: "center", gap: 12, padding: "var(--s3) var(--s5)", boxShadow: "0 1px 0 var(--sep)" }}>
        <Orb character={orb} size={52} state={how ?? "idle"} poke={false} />
        <div style={{ display: "grid", minWidth: 0 }}>
          <span style={{ font: "800 18px/24px var(--font)", color: "var(--accent)" }}>{orb.name}</span>
          <span style={{ font: "400 13px/18px var(--font)", color: "var(--text-3)" }}>{how === "speaking" ? "Writing…" : how ? "Working…" : `${SPECIALTIES[orb.specialty].title} · a private chat`}</span>
        </div>
      </header>
      <Talk
        home={home}
        conversation={conv}
        orbs={[orb]}
        send={(text) => home.say(orb, text)}
        placeholder={`Message ${orb.name}`}
        empty={`Say hello to ${orb.name}${person ? `, ${person}` : ""}. Just you two: no one else sees this.`}
        onBusy={setBusy}
      />
    </div>
  );
}
