import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Schema-transparent bridge: always fetches the actual tools from Meta Manager.
// No stale static Facebook/Instagram-only tool definitions.
const ENDPOINT = process.env.META_MANAGER_MCP_URL || "http://127.0.0.1:38939/mcp";
let nextId = 1;

async function callLocal(method, params = {}) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error("Meta Manager local service HTTP " + response.status);
  const envelope = response.headers.get("content-type")?.includes("text/event-stream")
    ? JSON.parse(text.split(/\r?\n/).filter(x=>x.startsWith("data: ")).map(x=>x.slice(6)).find(Boolean) || "null")
    : JSON.parse(text);
  if (!envelope || envelope.error) throw new Error(envelope?.error?.message || "Local MCP returned no result");
  if (!envelope.result) throw new Error("Meta Manager returned no MCP result");
  return envelope.result;
}

const server = new Server(
  { name: "meta-manager-proxy", version: "0.1.13" },
  { capabilities: { tools: { listChanged: true } } },
);
server.setRequestHandler(ListToolsRequestSchema, async (req) =>
  callLocal("tools/list", req.params || {}),
);
server.setRequestHandler(CallToolRequestSchema, async (req) =>
  callLocal("tools/call", req.params || {}),
);
server.connect(new StdioServerTransport()).catch((error) => {
  process.stderr.write(`Meta Manager proxy startup failed: ${error.message}\n`);
  process.exitCode = 1;
});
