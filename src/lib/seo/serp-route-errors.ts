// ===== SerpApi 系路由统一错误映射 =====
// 契约与第九阶段修复的 /api/seo/rank mapError 完全一致：
//   1. 用户套餐配额（cache.ts QuotaExceededError，日/月双 guard）
//      → { code: "QUOTA_EXCEEDED", used, limit, scope }，billing 错误，前端可引导升级
//      （scope=daily → 「今日…明日重置」；monthly → 「本月…下月 1 日重置」）
//   2. 上游 SerpApi 账户自身额度（SeoProviderError "QUOTA_EXCEEDED"）
//      → { code: "UPSTREAM_QUOTA" }，非 billing，前端只提示服务暂不可用，不得弹升级窗
//   3. 上游超时 / 参数错误 / 其他 → TIMEOUT(504) / BAD_REQUEST(400) / UPSTREAM_ERROR(500)
//
// 供 /api/seo/rank、/api/seo/serp、/api/keywords/expand、/api/competitors/*、
// /api/opportunities/verify 等 serp-service 调用方复用，避免各路由复制漂移。

import { NextResponse } from "next/server";
import { SeoProviderError } from "./provider";
import { QuotaExceededError } from "./cache";
import type { SeoApiError } from "./types";

export type SerpApiErrorResponseBody = SeoApiError & {
  used?: number;
  limit?: number;
  scope?: "daily" | "monthly";
};

export function serpApiErrorResponse(e: unknown): NextResponse<SerpApiErrorResponseBody> {
  // 用户套餐配额（daily/monthly）：带真实 used/limit/scope 供前端模板插值
  if (e instanceof QuotaExceededError) {
    return NextResponse.json<SerpApiErrorResponseBody>(
      { error: e.message, code: "QUOTA_EXCEEDED", used: e.used, limit: e.limit, scope: e.scope },
      { status: 429 }
    );
  }
  if (e instanceof SeoProviderError) {
    // 上游 SerpApi 账户自身额度耗尽 ≠ 用户套餐配额：
    // 用户升级解决不了站长的 SerpApi 账户额度，必须用独立 code 避免误导升级。
    const status =
      e.code === "INVALID_KEY" ? 401 :
      e.code === "QUOTA_EXCEEDED" ? 429 :
      e.code === "TIMEOUT" ? 504 :
      e.code === "BAD_REQUEST" ? 400 : 502;
    const code = e.code === "QUOTA_EXCEEDED" ? "UPSTREAM_QUOTA" : e.code;
    return NextResponse.json<SerpApiErrorResponseBody>({ error: e.message, code }, { status });
  }
  return NextResponse.json<SerpApiErrorResponseBody>(
    { error: `服务器内部错误：${(e as Error).message}`, code: "UPSTREAM_ERROR" },
    { status: 500 }
  );
}
