import { describe, expect, it } from "vitest";
import { createMcpServer } from "./server";
import { WebMcpTransport } from "./transport";
import { normalizeMcpError, McpNormalizedError } from "./errors";
import { backlinkOutputSchema, keywordOutputSchema } from "./output-schemas";
import { keywordInputSchema, serpInputSchema } from "./schemas";
import { SeoProviderError } from "@/lib/seo/provider";
import { POST as mcpPost } from "@/app/api/mcp/route";

async function request(message: unknown) {
  const transport = new WebMcpTransport(message);
  const server = createMcpServer(new Request("http://localhost/api/mcp"));
  await server.connect(transport);
  const response = await transport.responsePromise;
  await server.close();
  return response as Record<string, unknown>;
}

describe("SeeO MCP foundation", () => {
  async function routeRequest(message: unknown, headers?: HeadersInit) {
    const response = await mcpPost(new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(message),
    }));
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as Record<string, unknown> : {} };
  }

  it("supports MCP initialization", async () => {
    const response = await request({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    expect(response.result).toMatchObject({ serverInfo: { name: "seeo-mcp" }, capabilities: { tools: {} } });
  });

  it("serves initialize and tools/list through the HTTP route", async () => {
    const initialized = await routeRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "route-test", version: "1" } } });
    expect(initialized.status).toBe(200);
    expect(initialized.body.result).toMatchObject({ serverInfo: { name: "seeo-mcp" } });

    const listed = await routeRequest({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(listed.status).toBe(200);
    expect((listed.body.result as { tools: unknown[] }).tools).toHaveLength(6);
  });

  it("returns a structured tool error for invalid tools/call input", async () => {
    const response = await routeRequest({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "project_context", arguments: {} } });
    expect(response.status).toBe(200);
    expect(response.body.result).toMatchObject({ isError: true });
    expect(JSON.stringify(response.body)).toContain("BAD_REQUEST");
  });

  it("executes a legal list_projects call through the HTTP route", async () => {
    const response = await routeRequest({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_projects", arguments: {} } });
    expect(response.status).toBe(200);
    const result = response.body.result as { isError?: boolean; structuredContent?: Record<string, unknown> };
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toHaveProperty("projects");
  });

  it("rejects a project that is not owned by the caller", async () => {
    const response = await routeRequest({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "project_context", arguments: { projectId: "999999999" } } });
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).toContain("PROJECT_ACCESS_DENIED");
  });

  it("accepts MCP notifications without waiting for a response", async () => {
    const response = await routeRequest({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({});
  });

  it("lists the first-party tools", async () => {
    const response = await request({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const names = ((response.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name);
    expect(names).toEqual(["list_projects", "project_context", "research_keywords", "get_serp_results", "get_backlinks_profile", "search_console_tools"]);
  });

  it("normalizes provider errors without leaking provider details", () => {
    const normalized = normalizeMcpError(new SeoProviderError("INVALID_KEY", "secret provider response"));
    expect(normalized).toMatchObject({ code: "PROVIDER_ERROR", message: "The SEO provider credentials were rejected." });
    expect(normalized.message).not.toContain("secret");
  });

  it("validates tool inputs and outputs", () => {
    expect(() => keywordInputSchema.parse({ projectId: "p", seedKeywords: [] })).toThrow();
    expect(() => serpInputSchema.parse({ projectId: "p", keyword: "seo" })).not.toThrow();
    expect(() => backlinkOutputSchema.parse({ summary: { totalBacklinks: null, referringDomains: null, domainRank: null, dofollowPct: null }, rows: [], page: 1, pageSize: 25, totalCount: 0, hasMore: false, cachedAt: null, fromCache: false, limitations: [] })).not.toThrow();
    expect(() => keywordOutputSchema.parse({ data: { keywords: [] }, meta: { count: 0, source: "serpapi", unavailableMetrics: [] } })).not.toThrow();
  });

  it("preserves normalized authorization failures", () => {
    const error = new McpNormalizedError("PROJECT_ACCESS_DENIED", "The project is not accessible to this caller.");
    expect(error.code).toBe("PROJECT_ACCESS_DENIED");
  });
});
