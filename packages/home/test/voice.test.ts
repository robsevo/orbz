// PLAN 4.3_t through the door, on the real kit (Kokoro, Whisper base.en, Smart Turn v3.2):
//   - a reply is said in phrases shaped for the ear, each a WAV in his own voice;
//   - what you said is heard, biased to his name; his name wakes him, another orb's does not;
//   - whether you finished is Smart Turn's score;
//   - a voice of another language says it speaks only its preview; an orb that is not there is not
//     found; an empty recording, or one past 5 MB, is refused; without the kit his voice says why.
import assert from "node:assert/strict";
import { test } from "node:test";
import { serve } from "../src/api.ts";
import { agentHome } from "./helpers.ts";

async function door(t: Parameters<typeof agentHome>[0], kit: boolean) {
  const { home } = await agentHome(t, [], { kit });
  if (!home.inbox.orb("hazel")) home.inbox.addOrb("hazel", "Hazel");
  const d = await serve(home, { port: 0 });
  t.after(() => d.close());
  const post = (path: string, body: RequestInit["body"], type = "application/json") =>
    fetch(`http://127.0.0.1:${d.port}${path}`, { method: "POST", headers: { authorization: `Bearer ${d.token}`, "content-type": type }, body });
  return { home, post };
}

test("his voice and his ears, through the door", { timeout: 300_000 }, async (t) => {
  const { post } = await door(t, true);
  const ph = (await (await post("/orbs/hazel/voice/phrases", JSON.stringify({ text: "**Done.** I saved `notes.md` for you.", voice: "af_heart", speed: 1 }))).json()) as { phrases: string[] };
  assert.ok(ph.phrases.length >= 1 && !/[*`]/.test(ph.phrases.join(" ")), `phrases for the ear: ${JSON.stringify(ph.phrases)}`);

  const said = await post("/orbs/hazel/voice/say", JSON.stringify({ phrase: "Hey Hazel, what is on my calendar today?", voice: "af_heart", speed: 1 }));
  assert.deepEqual([said.status, said.headers.get("content-type")], [200, "audio/wav"]);
  const wav = Buffer.from(await said.arrayBuffer());
  assert.equal(wav.subarray(0, 4).toString("latin1"), "RIFF", "a WAV of the phrase, in her voice");

  const heard = (await (await post("/orbs/hazel/voice/hear", wav, "audio/wav")).json()) as { text: string };
  assert.match(heard.text.toLowerCase(), /calendar/, `heard: ${heard.text}`);
  // waking listens to the last moments the page heard (2.5 s), as the page sends them: a call alone
  const call = Buffer.from(await (await post("/orbs/hazel/voice/say", JSON.stringify({ phrase: "Hey Hazel.", voice: "af_heart", speed: 1 }))).arrayBuffer());
  const woke = (await (await post("/orbs/hazel/voice/woken", call, "audio/wav")).json()) as { woken: boolean };
  assert.equal(woke.woken, true, "her name wakes her");
  const notHim = (await (await post("/orbs/juniper/voice/woken", call, "audio/wav")).json()) as { woken: boolean };
  assert.equal(notHim.woken, false, "Juniper does not wake to Hazel's name");
  const fin = (await (await post("/orbs/hazel/voice/finished", wav, "audio/wav")).json()) as { finished: boolean; p: number };
  assert.ok(fin.p >= 0 && fin.p <= 1, "whether you finished: Smart Turn's score");

  assert.equal((await post("/orbs/hazel/voice/say", JSON.stringify({ phrase: "Bonjour.", voice: "ff_siwis" }))).status, 400, "another language: its preview only, and it says so");
  assert.equal((await post("/orbs/nobody/voice/phrases", JSON.stringify({ text: "hi" }))).status, 404);
  assert.equal((await post("/orbs/hazel/voice/hear", Buffer.alloc(0), "audio/wav")).status, 400, "an empty recording is refused");
  assert.equal((await post("/orbs/hazel/voice/hear", Buffer.alloc(6 * 1024 * 1024), "audio/wav")).status, 413, "a recording past 5 MB is refused before the kit hears it");
});

test("without the kit, his voice says why", { timeout: 60_000 }, async (t) => {
  const { post } = await door(t, false);
  const r = await post("/orbs/hazel/voice/phrases", JSON.stringify({ text: "hi" }));
  assert.equal(r.status, 503);
  assert.match(((await r.json()) as { error: string }).error, /the kit is not running/);
});
