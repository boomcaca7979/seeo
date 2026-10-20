// ===== serp-route-errors：SerpApi 系路由统一错误映射测试 =====
// 契约与第九阶段 /api/seo/rank 修复一致（第十阶段推广到全部 SerpApi 路由）：
//   1. 用户套餐配额（daily/monthly）→ QUOTA_EXCEEDED + used/limit/scope
//   2. 上游 SerpApi 账户额度 → UPSTREAM_QUOTA（非 billing，不误导升级）
//   3. 上游超时 → 504 TIMEOUT；其他 → 500 UPSTREAM_ERROR
import { describe, it, expect } from "vitest";

import { serpApiErrorResponse } from "./serp-route-errors";
import { SeoProviderError } from "./provider";
import { QuotaExceededError } from "./cache";

async function bodyOf(e: unknown) {
  const res = serpApiErrorResponse(e);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("serpApiErrorResponse", () => {
  it("用户套餐每日限额：QUOTA_EXCEEDED + used/limit + scope=daily", async () => {
    const { status, body } = await bodyOf(new QuotaExceededError(3, 3, "serpapi", "2026-10", "daily"));
    expect(status).toBe(429);
    expect(body.code).toBe("QUOTA_EXCEEDED");
    expect(body.used).toBe(3);
    expect(body.limit).toBe(3);
    expect(body.scope).toBe("daily");
    expect(String(body.error)).toContain("今日");
  });

  it("用户套餐月度配额：scope=monthly，文案为下月 1 日重置", async () => {
    const { status, body } = await bodyOf(new QuotaExceededError(30, 30, "serpapi", "2026-10"));
    expect(status).toBe(429);
    expect(body.scope).toBe("monthly");
    expect(String(body.error)).toContain("下月 1 日");
  });

  it("上游 SerpApi 账户额度耗尽：映射为 UPSTREAM_QUOTA（非 billing code）", async () => {
    const { status, body } = await bodyOf(new SeoProviderError("QUOTA_EXCEEDED", "SerpApi 额度已耗尽：plan limit"));
    expect(status).toBe(429);
    expect(body.code).toBe("UPSTREAM_QUOTA");
    expect(body.used).toBeUndefined();
    expect(body.scope).toBeUndefined();
    expect(String(body.error)).toContain("SerpApi 额度已耗尽");
  });

  it("上游超时：504 TIMEOUT，error 保留原始 detail（不为空）", async () => {
    const { status, body } = await bodyOf(new SeoProviderError("TIMEOUT", "SerpApi 请求超时（10s）"));
    expect(status).toBe(504);
    expect(body.code).toBe("TIMEOUT");
    expect(String(body.error)).toBe("SerpApi 请求超时（10s）");
  });

  it("INVALID_KEY：401；普通错误：500 UPSTREAM_ERROR", async () => {
    expect((await bodyOf(new SeoProviderError("INVALID_KEY", "key 无效"))).status).toBe(401);
    const other = await bodyOf(new Error("boom"));
    expect(other.status).toBe(500);
    expect(other.body.code).toBe("UPSTREAM_ERROR");
    expect(String(other.body.error)).toContain("boom");
  });

  it("返回值可直接作为 Response 返回（路由 catch 单返回点）", () => {
    const res = serpApiErrorResponse(new QuotaExceededError(1, 3, "serpapi", "2026-10", "daily"));
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(429);
  });
});
