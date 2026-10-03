// A stand-in MCP server for the connector tests (PLAN 4.2), over stdio, on the SDK's own server:
// `node mcp-server.ts [--hang-start]`. Its tools: echo, send_email, whoami (whether the secret it
// was started with arrived, never the secret itself), list_events, create_event, and hang (it
// never answers).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

if (process.argv.includes("--hang-start")) {
  // never shakes hands, and stays: an unsettled top-level await with nothing else alive exits Node (code 13)
  setInterval(() => {}, 60_000);
  await new Promise(() => {});
}

const obj = (props: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties: props, required });
const TOOLS = [
  { name: "echo", description: "Says back what it is given.", inputSchema: obj({ text: { type: "string" } }, ["text"]) },
  { name: "send_email", description: "Sends an email.", inputSchema: obj({ to: { type: "string" }, body: { type: "string" } }, ["to", "body"]) },
  { name: "whoami", description: "Who it is signed in as.", inputSchema: obj({}) },
  { name: "list_events", description: "Lists the calendar's events.", inputSchema: obj({}) },
  { name: "create_event", description: "Adds an event to the calendar.", inputSchema: obj({ title: { type: "string" } }, ["title"]) },
  { name: "hang", description: "Never answers.", inputSchema: obj({}) },
];

const server = new Server({ name: "stand-in", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const a = (req.params.arguments ?? {}) as Record<string, string>;
  const say = (text: string) => ({ content: [{ type: "text", text }] });
  switch (req.params.name) {
    case "echo":
      return say(`echo: ${a.text}`);
    case "send_email":
      return say(`sent to ${a.to}`);
    case "whoami":
      return say(process.env.STAND_IN_TOKEN === "tok-not-real-1234" ? "signed in: the token reached me" : "not signed in");
    case "list_events":
      return say("Dentist, Tuesday 15:00");
    case "create_event":
      return say(`added ${a.title}`);
    case "hang":
      return new Promise(() => {});
    default:
      return { content: [{ type: "text", text: `no tool ${req.params.name}` }], isError: true };
  }
});
await server.connect(new StdioServerTransport());
