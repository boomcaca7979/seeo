import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createMcpContext, requireProviderAccess, requireScope, type ToolAuthContext } from "./context";
import { errorResult } from "./errors";
import { backlinkInputSchema, gscInputSchema, keywordInputSchema, projectIdSchema, rankHistoryInputSchema, serpInputSchema } from "./schemas";
import { getRegisteredTools } from "./tools";

const providerBackedTools = new Set(["research_keywords", "get_serp_results", "get_backlinks_profile"]);

export function createMcpServer(request: Request) {
  const server = new McpServer({ name: "seeo-mcp", version: "0.1.0" });
  const tools = getRegisteredTools();
  const inputSchemas = {
    list_projects: z.object({}),
    project_context: projectIdSchema,
    research_keywords: keywordInputSchema,
    get_serp_results: serpInputSchema,
    get_backlinks_profile: backlinkInputSchema,
    search_console_tools: gscInputSchema,
    get_rank_history: rankHistoryInputSchema,
  } as const;

  // The registry intentionally stores heterogeneous Zod schemas. The SDK's
  // overloads model each registration separately, so this narrow adapter
  // keeps that implementation detail out of the transport boundary.
  const registerTool = server.registerTool.bind(server) as unknown as (
    name: string,
    config: { description: string; inputSchema: z.ZodType },
    callback: (input: unknown) => Promise<{
      content: ReadonlyArray<{ type: "text"; text: string }>;
      structuredContent?: Record<string, unknown>;
      isError?: boolean;
    }>,
  ) => unknown;

  for (const tool of tools) {
    registerTool(tool.name, {
      description: tool.description,
      inputSchema: inputSchemas[tool.name] as z.ZodType,
    }, async (input: unknown) => {
      try {
        if (providerBackedTools.has(tool.name)) {
          const ctx = await createMcpContext(request);
          requireScope(ctx, "mcp:read");
          requireProviderAccess(ctx);
          const data = await tool.execute(ctx, input);
          return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown> };
        }
        const ctx = await createMcpContext(request);
        requireScope(ctx, "mcp:read");
        const data = await tool.execute(ctx, input);
        return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: data as Record<string, unknown> };
      } catch (error) { return errorResult(error); }
    });
  }
  return server;
}

export type { ToolAuthContext };
