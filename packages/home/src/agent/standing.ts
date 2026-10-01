// The standing context (PLAN 1.5): what every request to the model starts with. Rebuilt for every
// request and never stored in the conversation, so compaction, /clear and a restart can neither
// lose it nor say it twice (Ash's context-survival lesson: the block that IS the brain was lost
// after compaction, and duplicated by re-injection).
//
// Orbs writes only the first two lines (who the orb is, where it works). Everything else is the
// owner's, read as it is (CLAUDE.md rule 6): <data>/brain/CONSTITUTION.md, each skill's name and
// description from <data>/brain/skills/*/SKILL.md, and <data>/brain/memory/MEMORY.md.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function standingContext(o: { orbName: string; brainDir: string; workspace: string }): string {
  const parts = [
    `You are ${o.orbName}, one of the person's orbs: an assistant that works on its own computer and asks before anything that matters.`,
    `Working directory: ${o.workspace}`,
  ];
  const constitution = read(join(o.brainDir, "CONSTITUTION.md"));
  if (constitution) parts.push(constitution);
  const skills = skillsIndex(join(o.brainDir, "skills"));
  if (skills) parts.push(`Skills you can use:\n${skills}`);
  const memory = read(join(o.brainDir, "memory", "MEMORY.md"));
  if (memory) parts.push(`What you remember (the index):\n${memory}`);
  return parts.join("\n\n");
}

function read(file: string): string {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function skillsIndex(dir: string): string {
  if (!existsSync(dir)) return "";
  const lines: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const text = read(join(dir, name, "SKILL.md"));
    if (!text) continue;
    const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    const field = (k: string): string => new RegExp(`^${k}:\\s*(.*)$`, "m").exec(front)?.[1]?.trim() ?? "";
    lines.push(`- ${field("name") || name}: ${field("description") || "(no description)"}`);
  }
  return lines.join("\n");
}
