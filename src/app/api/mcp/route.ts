import { createMcpHandler, hostHeaderValidationResponse, originValidationResponse, localhostAllowedHostnames, localhostAllowedOrigins } from "@modelcontextprotocol/server";
import { createMcpServer } from "@/server/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function configuredHostnames(name: string, fallback: string[]): string[] {
  const configured = process.env[name];
  return configured ? configured.split(",").map((value) => value.trim()).filter(Boolean) : fallback;
}

const handler = createMcpHandler(({ requestInfo }) => createMcpServer(requestInfo ?? new Request("http://localhost/api/mcp")), {
  legacy: "stateless",
  responseMode: "auto",
});

async function serve(request: Request): Promise<Response> {
  const hostRejected = hostHeaderValidationResponse(request, configuredHostnames("SEEO_MCP_ALLOWED_HOSTS", localhostAllowedHostnames()));
  if (hostRejected) return hostRejected;
  const originRejected = originValidationResponse(request, configuredHostnames("SEEO_MCP_ALLOWED_ORIGINS", localhostAllowedOrigins()));
  if (originRejected) return originRejected;
  return handler.fetch(request);
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
