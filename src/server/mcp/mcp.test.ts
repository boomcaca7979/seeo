import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, afterAll, beforeAll } from "vitest";
import { normalizeMcpError, McpNormalizedError } from "./errors";
import { backlinkOutputSchema, keywordOutputSchema, serpOutputSchema } from "./output-schemas";
import { keywordInputSchema, serpInputSchema } from "./schemas";
import { SeoProviderError } from "@/lib/seo/provider";

const protocolVersion = "2026-07-28";
const clientHeaders = {
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": protocolVersion,
};

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const protocol = req.headers["x-forwarded-proto"] ?? "http";
  const host = req.headers.host ?? "127.0.0.1";
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return new Request(`${protocol}://${host}${req.url ?? "/api/mcp"}`, {
    method: req.method,
    headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
    // Node's Request implementation requires duplex when a body is supplied.
    ...(chunks.length ? { duplex: "half" as const } : {}),
  });
}

async function writeWebResponse(response: Response, res: ServerResponse) {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } finally {
    res.end();
  }
}

let endpoint = "";
let httpServer: ReturnType<typeof createHttpServer>;
let POST: typeof import("@/app/api/mcp/route").POST;
let GET: typeof import("@/app/api/mcp/route").GET;
let DELETE: typeof import("@/app/api/mcp/route").DELETE;

beforeAll(async () => {
  // auth-config is intentionally evaluated once. Keep this integration test
  // deterministic and exercise the MCP demo boundary without changing
  // production authentication behavior.
  process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
  ({ POST, GET, DELETE } = await import("@/app/api/mcp/route"));
  httpServer = createHttpServer(async (req, res) => {
    try {
      const request = await toWebRequest(req);
      const handler = req.method === "POST" ? POST : req.method === "GET" ? GET : req.method === "DELETE" ? DELETE : undefined;
      if (!handler) {
        res.statusCode = 405;
        res.end();
        return;
      }
      await writeWebResponse(await handler(request), res);
    } catch {
      res.statusCode = 500;
      res.end();
    }
  });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  endpoint = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/api/mcp`;
});

afterAll(async () => {
  httpServer.close();
  await once(httpServer, "close");
});

async function httpRequest(body: unknown, headers: Record<string, string> = clientHeaders, method = "POST") {
  const response = await fetch(endpoint, {
    method,
    headers,
    body: method === "GET" || method === "DELETE" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = undefined;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = undefined; }
  return { response, text, body: parsed as Record<string, unknown> | undefined };
}

function modernParams(extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    _meta: {
      "io.modelcontextprotocol/protocolVersion": protocolVersion,
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": { name: "http-test", version: "1" },
    },
  };
}

function modernHeaders(method: string, accept = "application/json, text/event-stream", toolName?: string) {
  return {
    ...clientHeaders,
    accept,
    "mcp-method": method,
    ...(toolName ? { "mcp-name": toolName } : {}),
  };
}

async function officialClient() {
  const client = new Client(
    { name: "seeo-official-client-test", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: protocolVersion } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(endpoint));
  await client.connect(transport);
  return { client, transport };
}

describe("SeeO MCP standard Streamable HTTP compatibility", () => {
  it("connects with the official MCP client and lists exactly six tools", async () => {
    const { client } = await officialClient();
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "list_projects", "project_context", "research_keywords", "get_serp_results", "get_backlinks_profile", "search_console_tools",
    ]);
    await client.close();
  });

  it("calls a tool through the official MCP client and returns structured output", async () => {
    const { client } = await officialClient();
    const result = await client.callTool({ name: "list_projects", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toHaveProperty("projects");
    await client.close();
  });

  it("handles initialize, protocol metadata, content negotiation, and notifications over HTTP", async () => {
    const initialized = await httpRequest({ jsonrpc: "2.0", id: 1, method: "server/discover", params: modernParams() }, modernHeaders("server/discover"));
    expect(initialized.response.status).toBe(200);
    expect(initialized.response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(initialized.body?.result).toMatchObject({
      resultType: "complete",
      supportedVersions: [protocolVersion],
      capabilities: { tools: { listChanged: true } },
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "seeo-mcp", version: "0.1.0" } },
    });

    const notification = await httpRequest({ jsonrpc: "2.0", method: "notifications/initialized", params: modernParams() }, modernHeaders("notifications/initialized"));
    expect(notification.response.status).toBe(202);
    expect(notification.text).toBe("");

    const sse = await httpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list", params: modernParams() }, modernHeaders("tools/list", "text/event-stream"));
    expect(sse.response.status).toBe(200);
    expect(["application/json", "text/event-stream"]).toContain(sse.response.headers.get("content-type")?.split(";")[0]);
    if (sse.response.headers.get("content-type")?.startsWith("text/event-stream")) expect(sse.text).toContain("data:");
  });

  it("returns standard errors for malformed JSON and invalid tool input", async () => {
    const malformed = await httpRequest("{", clientHeaders);
    expect(malformed.response.status).toBe(400);
    expect(malformed.body?.error).toMatchObject({ code: -32700 });

    const invalid = await httpRequest({ jsonrpc: "2.0", id: 3, method: "tools/call", params: modernParams({ name: "project_context", arguments: {} }) }, modernHeaders("tools/call", undefined, "project_context"));
    expect(invalid.response.status).toBe(200);
    expect(invalid.body?.result).toMatchObject({ isError: true });
    expect(JSON.stringify(invalid.body)).toContain("Input validation error");
  });

  it("enforces Origin and Host validation before MCP handling", async () => {
    const badOrigin = await httpRequest({ jsonrpc: "2.0", id: 4, method: "tools/list", params: modernParams() }, { ...clientHeaders, origin: "https://evil.example" });
    expect(badOrigin.response.status).toBe(403);

    const badHost = await fetch(endpoint, { method: "POST", headers: { ...clientHeaders, host: "evil.example" }, body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list", params: modernParams() }) });
    expect([400, 403]).toContain(badHost.status);
  });

  it("rejects unauthorized project access without calling provider services", async () => {
    const denied = await httpRequest({ jsonrpc: "2.0", id: 6, method: "tools/call", params: modernParams({ name: "project_context", arguments: { projectId: "999999999" } }) }, modernHeaders("tools/call", undefined, "project_context"));
    expect(denied.response.status).toBe(200);
    expect(denied.body?.result).toMatchObject({ isError: true });
    expect(JSON.stringify(denied.body)).toContain("PROJECT_ACCESS_DENIED");

    const unauthorized = await httpRequest({ jsonrpc: "2.0", id: 7, method: "tools/call", params: modernParams({ name: "research_keywords", arguments: { projectId: "1", seedKeywords: ["seo"] } }) }, modernHeaders("tools/call", undefined, "research_keywords"));
    expect(JSON.stringify(unauthorized.body)).toMatch(/PROVIDER_ACCESS_DENIED|PROJECT_ACCESS_DENIED|AUTH_REQUIRED/);
  });

  it("supports stateless GET/DELETE semantics and legacy protocol handling", async () => {
    const get = await fetch(endpoint, { headers: { ...clientHeaders, accept: "text/event-stream" } });
    expect([400, 405]).toContain(get.status);
    const del = await fetch(endpoint, { method: "DELETE", headers: clientHeaders });
    expect([400, 405]).toContain(del.status);

    const legacy = await httpRequest({ jsonrpc: "2.0", id: 8, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "legacy", version: "1" } } }, { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2024-11-05" });
    expect(legacy.response.status).toBe(200);
    const legacyMessage = legacy.text.match(/data: (.+)\n/)?.[1];
    expect(legacyMessage).toBeTruthy();
    expect(JSON.parse(legacyMessage!).result).toMatchObject({ serverInfo: { name: "seeo-mcp" }, protocolVersion: "2024-11-05" });
  });

  it("normalizes provider errors and validates output schemas without leaking secrets", () => {
    const normalized = normalizeMcpError(new SeoProviderError("INVALID_KEY", "secret provider response"));
    expect(normalized).toMatchObject({ code: "PROVIDER_ERROR", message: "The SEO provider credentials were rejected." });
    expect(normalized.message).not.toContain("secret");
    expect(keywordInputSchema.safeParse({ projectId: "p", seedKeywords: [] }).success).toBe(false);
    expect(serpInputSchema.safeParse({ projectId: "p", keyword: "seo" }).success).toBe(true);
    expect(backlinkOutputSchema.safeParse({ summary: { totalBacklinks: null, referringDomains: null, domainRank: null, dofollowPct: null }, rows: [], page: 1, pageSize: 25, totalCount: 0, hasMore: false, cachedAt: null, fromCache: false, limitations: [] }).success).toBe(true);
    expect(keywordOutputSchema.safeParse({ data: { keywords: [] }, meta: { count: 0, source: "serpapi", unavailableMetrics: [] } }).success).toBe(true);
    // P0-02-B：serp 输出新增 features / summary / isProjectDomain / market meta，既有字段保持必填
    expect(serpOutputSchema.safeParse({
      data: {
        organic: [{ rank: 1, title: "t", url: "https://a.example.com/", domain: "example.com", snippet: "s", featureType: null, isProjectDomain: true }],
        features: [{ featureType: "featured_snippet", position: 1, title: "f", url: "https://a.example.com/" }],
        summary: { organicCount: 1, featureCount: 1, featureTypes: ["featured_snippet"], projectPresent: true, projectRank: 1, projectRankingUrl: "https://a.example.com/", topDomains: [{ domain: "example.com", count: 1 }], domainFrequency: { "example.com": 1 } },
      },
      meta: { count: 1, source: "serpapi", fromCache: false, language: "zh-cn", location: "中国", device: "desktop" },
    }).success).toBe(true);
    expect(JSON.stringify(normalized)).not.toMatch(/secret|api[_ -]?key|stack|\/Users\//i);
  });

  it("preserves normalized authorization errors", () => {
    const error = new McpNormalizedError("PROJECT_ACCESS_DENIED", "The project is not accessible to this caller.");
    expect(error.code).toBe("PROJECT_ACCESS_DENIED");
  });
});
