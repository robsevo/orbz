// A connector's tools as an orb's (PLAN 4.2): `mcp__<server>__<tool>`, each asking by default (the
// person's rules can allow one), the floor reading its name (toolFloor), and what comes back marked
// as from outside: a turn that read it acts outward only with a fresh yes (the one-way switch).
import type { ToolDef } from "../agent/tools.ts";
import { toolFloor } from "../rules/floor.ts";
import type { Connectors } from "./connectors.ts";

/** A model's tool name: letters, digits, _ and -, at most 64. */
export const toolName = (server: string, tool: string): string => `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);

export function connectorTools(c: Connectors): ToolDef[] {
  return c.tools().map(({ server, tool }) => ({
    name: toolName(server, tool.name),
    label: `Using ${server}`,
    description: `${tool.description?.trim() || tool.name} (your ${server} connector)`.slice(0, 1000),
    parameters: tool.inputSchema && typeof tool.inputSchema === "object" ? tool.inputSchema : { type: "object", properties: {} },
    describe: (a) => {
      const shown = JSON.stringify(a);
      return `use ${server}'s ${tool.name}${shown === "{}" ? "" : ` with ${shown.length > 240 ? `${shown.slice(0, 239)}…` : shown}`}`;
    },
    decision: "ask",
    act: "send", // someone else's code, reaching outside: treated as outward
    untrusted: "document",
    floor: () => toolFloor(tool.name),
    run: (a, ctx) => c.call(server, tool.name, a, ctx.signal),
  }));
}
