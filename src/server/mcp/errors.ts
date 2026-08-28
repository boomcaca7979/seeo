import { ZodError } from "zod";
import { DataForSeoApiError, DataForSeoNotConfiguredError } from "@/lib/seo/dataforseo";
import { SeoProviderError } from "@/lib/seo/provider";
import { FeatureNotAllowedError, PlanLimitError, QuotaExceededError } from "@/lib/errors/billing-errors";

export type McpErrorCode =
  | "AUTH_REQUIRED" | "PROJECT_ACCESS_DENIED" | "PROJECT_NOT_FOUND" | "BAD_REQUEST"
  | "RATE_LIMITED" | "PLAN_LIMIT_REACHED" | "PROVIDER_ERROR" | "PROVIDER_QUOTA"
  | "NOT_CONFIGURED" | "PROVIDER_ACCESS_DENIED" | "INTERNAL_ERROR";

export class McpNormalizedError extends Error {
  constructor(
    readonly code: McpErrorCode,
    message: string,
    readonly retryable = false,
    readonly details?: Record<string, unknown>,
  ) { super(message); this.name = "McpNormalizedError"; }
}

export function normalizeMcpError(error: unknown): McpNormalizedError {
  if (error instanceof McpNormalizedError) return error;
  if (error instanceof ZodError) return new McpNormalizedError("BAD_REQUEST", "The tool input is invalid.", false, { issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) });
  if (error instanceof DataForSeoNotConfiguredError) return new McpNormalizedError("NOT_CONFIGURED", "The DataForSEO provider is not configured.");
  if (error instanceof DataForSeoApiError) return new McpNormalizedError("PROVIDER_ERROR", "The backlink provider returned an error.", error.status_code >= 500);
  if (error instanceof FeatureNotAllowedError || error instanceof PlanLimitError) return new McpNormalizedError("PLAN_LIMIT_REACHED", "This operation is not available on the current plan.");
  if (error instanceof QuotaExceededError) return new McpNormalizedError("PLAN_LIMIT_REACHED", "The SeeO quota for this operation is exhausted.");
  if (error instanceof SeoProviderError) {
    if (error.code === "QUOTA_EXCEEDED") return new McpNormalizedError("PROVIDER_QUOTA", "The SEO provider quota is exhausted.");
    if (error.code === "INVALID_KEY") return new McpNormalizedError("PROVIDER_ERROR", "The SEO provider credentials were rejected.");
    if (error.code === "TIMEOUT") return new McpNormalizedError("PROVIDER_ERROR", "The SEO provider request timed out.", true);
    if (error.code === "BAD_REQUEST") return new McpNormalizedError("BAD_REQUEST", "The SEO provider rejected the request.");
    return new McpNormalizedError("PROVIDER_ERROR", "The SEO provider request failed.", error.code === "UPSTREAM_ERROR");
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("NOT_CONFIGURED:")) return new McpNormalizedError("NOT_CONFIGURED", message.slice(15).trim());
  if (message.startsWith("RATE_LIMITED:")) return new McpNormalizedError("RATE_LIMITED", message.slice(13).trim(), true);
  if (message.includes("QuotaExceeded") || message.includes("额度已用尽") || message.includes("QUOTA_EXCEEDED")) {
    return new McpNormalizedError("PROVIDER_QUOTA", "The provider quota for this operation is exhausted.", false);
  }
  const code = (error as { code?: string })?.code;
  if (code === "QUOTA_EXCEEDED") return new McpNormalizedError("PROVIDER_QUOTA", "The provider quota for this operation is exhausted.");
  if (code === "INVALID_KEY") return new McpNormalizedError("PROVIDER_ERROR", "The SEO provider credentials were rejected.");
  if (code === "TIMEOUT") return new McpNormalizedError("PROVIDER_ERROR", "The SEO provider request timed out.", true);
  if (code === "BAD_REQUEST") return new McpNormalizedError("BAD_REQUEST", "The SEO provider rejected the request.");
  return new McpNormalizedError("INTERNAL_ERROR", "The request could not be completed.");
}

export function errorResult(error: unknown) {
  const normalized = normalizeMcpError(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: normalized.message, code: normalized.code, retryable: normalized.retryable, details: normalized.details }) }],
  };
}
