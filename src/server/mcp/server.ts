import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createMcpContext, requireScope, type ToolAuthContext } from "./context";
import { errorResult, McpNormalizedError } from "./errors";
import { getRegisteredTools } from "./tools";

export function createMcpServer(request: Request) {
  const server = new Server({ name: "seeo-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });
  const tools = getRegisteredTools();
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }));
  server.setRequestHandler(CallToolRequestSchema, async (call) => {
    try {
      const tool = tools.find((candidate) => candidate.name === call.params.name);
      if (!tool) return errorResult(new McpNormalizedError("BAD_REQUEST", "The requested tool does not exist."));
      const ctx = await createMcpContext(request);
      requireScope(ctx, "mcp:read");
      const data = await tool.execute(ctx, call.params.arguments ?? {});
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown> };
    } catch (error) { return errorResult(error); }
  });
  return server;
}

export type { ToolAuthContext };
