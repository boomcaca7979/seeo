// ===== AI Search API 错误归一化（供 /api/ai-search/* 路由共用） =====
// 不透出 provider raw payload / 凭证信息。

import { NextResponse } from "next/server";
import { AiSearchProviderError, DataForSeoNotConfiguredError } from "@/lib/seo/dataforseo";
import { QuotaExceededError } from "@/lib/seo/cache";

export function mapAiSearchError(e: unknown) {
  if (e instanceof QuotaExceededError) {
    return NextResponse.json({ error: e.message, code: "AI_SEARCH_PROVIDER_QUOTA" }, { status: 429 });
  }
  if (e instanceof DataForSeoNotConfiguredError) {
    return NextResponse.json({ error: e.message, code: "AI_SEARCH_NOT_CONFIGURED" }, { status: 503 });
  }
  if (e instanceof AiSearchProviderError) {
    const status = e.code === "AI_SEARCH_INVALID_MODEL" || e.code === "AI_SEARCH_UNSUPPORTED_PLATFORM" ? 400
      : e.code === "AI_SEARCH_BILLING_ISSUE" ? 402
      : 502;
    return NextResponse.json({ error: e.message, code: e.code }, { status });
  }
  return NextResponse.json(
    { error: `服务器内部错误：${(e as Error).message}`, code: "AI_SEARCH_PROVIDER_ERROR" },
    { status: 500 }
  );
}
