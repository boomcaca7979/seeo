import { NextResponse } from "next/server";
import { createMcpServer } from "@/server/mcp/server";
import { WebMcpTransport } from "@/server/mcp/transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isJsonRpcNotification(body: unknown): body is { method: string } {
  return Boolean(body && typeof body === "object" && "method" in body && !("id" in body));
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, { status: 400 }); }
  const transport = new WebMcpTransport(body);
  const server = createMcpServer(request);
  try {
    await server.connect(transport);
    // MCP notifications (for example notifications/initialized) do not have
    // a JSON-RPC response. Return 202 rather than waiting for the one-shot
    // transport's response promise until the timeout.
    if (isJsonRpcNotification(body)) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await server.close();
      return new Response(null, { status: 202 });
    }
    const message = await Promise.race([
      transport.responsePromise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("MCP request timeout")), 60_000)),
    ]);
    await server.close();
    return NextResponse.json(message);
  } catch {
    await server.close().catch(() => undefined);
    return NextResponse.json({ jsonrpc: "2.0", error: { code: -32603, message: "MCP request failed" }, id: (body as { id?: unknown })?.id ?? null }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ name: "seeo-mcp", endpoint: "/api/mcp", protocol: "2024-11-05" });
}
