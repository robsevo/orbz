// The floor's small things that answer a press (owner, 10-10). Each answers only in its turn; what one gives is kept by
// the home (about.ts keepsakes, every device sees it) and carried in the side menu. Pure, so a test can walk it: the
// turns, what they give and the words they come with are read from the table below.
const KEY = "the floor keeps its own small things";
const TABLE = "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";
/** What a word typed at the game is checked against: a digest only (SHA-256), never the words. */
const ACCEPTED = "95431de6e3e19fe0ded52b08258a36313fc477bb1309d0eb78fdd40600ce09b5";

export type Thing = "shelf" | "arcade" | "paper" | "screen" | "bin";
export type Turn =
  | { k: "press"; on: Thing; n: number; drop: string }
  | { k: "carry"; on: Thing; with: string; gives: string }
  | { k: "move"; on: Thing; drop: string }
  | { k: "code"; on: Thing; with: string; gives: string };

type Job = { label: string; title: string; focus: string; limits: string };
type Names = {
  room: string; dept: string; one: string; home: string; empty: string; noBook: string; hireOne: string; hiring: string;
  ask: string; field: string; yes: string; no: string; stick: string; paper: string;
  jobs: Record<"deskhead" | "dealer" | "quant" | "onchain" | "risk", Job>;
};

const read = (): { s: Turn[]; w: string[]; n: Names } => {
  const raw = atob(TABLE);
  let out = "";
  for (let i = 0; i < raw.length; i++) out += String.fromCharCode(raw.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
  return JSON.parse(out) as { s: Turn[]; w: string[]; n: Names };
};
const { s: TURNS, w: WORDS, n: NAMES } = read();
/** The turns, and the words said with what they give and open. */
export { TURNS, NAMES };

/** What a turn leaves kept once it is done. */
export const keptBy = (t: Turn): string => ("drop" in t ? t.drop : t.gives);
/** The turn that answers now: the first whose keepsake is not yet kept (null: all done). */
export function turnNow(kept: readonly string[]): Turn | null {
  return TURNS.find((t) => !kept.includes(keptBy(t))) ?? null;
}
/** The pieces of the paper found so far, in their order: what the paper shows. */
export function piecesOf(kept: readonly string[]): (string | null)[] {
  const drops = TURNS.filter((t): t is Extract<Turn, { k: "press" | "move" }> => "drop" in t && t.drop.startsWith("p"));
  return drops.map((t, i) => (kept.includes(t.drop) ? WORDS[i] ?? null : null));
}
/** Whether the words typed are the ones: only as the paper has them, exact; spaces and the signs that close them forgiven. */
export async function opens(typed: string): Promise<boolean> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(typed.replace(/\s+/g, "").replace(/=+$/, ""))));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("") === ACCEPTED;
}
/** The keepsakes carried in the side menu, and what opens once all is done. */
export const CARRIED = { stick: keptBy(TURNS[0]!), pieces: TURNS.filter((t) => "drop" in t && t.drop.startsWith("p")).map(keptBy), open: keptBy(TURNS[TURNS.length - 1]!), seen: keptBy(TURNS[1]!) };
