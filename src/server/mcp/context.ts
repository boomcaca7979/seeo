import { requireAuthOrDemo, type PlanTier } from "@/lib/auth";
import { isAuthEnabled } from "@/lib/auth-config";
import { authenticateApiKey } from "./api-key-auth";
import { McpNormalizedError } from "./errors";

export interface ToolAuthContext { userId: string; plan: PlanTier; scopes: string[]; baseUrl: string; authMode: "session" | "api-key" | "demo"; }

export async function createMcpContext(request: Request): Promise<ToolAuthContext> {
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? request.headers.get("x-api-key");
  if (bearer) {
    const key = await authenticateApiKey(bearer);
    if (!key) throw new McpNormalizedError("AUTH_REQUIRED", "A valid SeeO API key is required.");
    // API keys carry their own identity; plan is still read from SeeO billing for that identity.
    const { getUserPlan } = await import("@/lib/billing");
    const plan = (await getUserPlan(key.userId)).effectivePlan;
    return { userId: key.userId, plan, scopes: key.scopes, baseUrl: new URL(request.url).origin, authMode: "api-key" };
  }
  const auth = await requireAuthOrDemo();
  if (!auth.allowed) throw new McpNormalizedError("AUTH_REQUIRED", "A SeeO session or API key is required.");
  return { userId: auth.user?.id ?? "demo-user", plan: auth.plan, scopes: ["mcp:read"], baseUrl: new URL(request.url).origin, authMode: isAuthEnabled ? "session" : "demo" };
}

/** Enforce the scope attached to an API key (session callers receive mcp:read). */
export function requireScope(ctx: ToolAuthContext, scope: string): void {
  if (!ctx.scopes.includes(scope)) {
    throw new McpNormalizedError("PROJECT_ACCESS_DENIED", `The API key does not grant scope '${scope}'.`);
  }
}

/** Demo sessions must never be able to incur third-party provider costs. */
export function requireProviderAccess(ctx: ToolAuthContext): void {
  if (ctx.authMode === "demo") {
    throw new McpNormalizedError(
      "PROVIDER_ACCESS_DENIED",
      "Provider-backed MCP tools are unavailable in demo mode.",
    );
  }
}
