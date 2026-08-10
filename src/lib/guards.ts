// ===== 统一权限入口（P2 商业化基础设施） =====
// 所有商业限制走这里，API 路由不直接调用 cache.ts 的 consumeQuota
//
// 提供：
//   - requireFeature(userId, feature)：检查 Feature 权限（如 PDF 导出）
//   - requireQuota(userId, apiType)：检查并消耗 API 额度
//   - requirePlanLimit(userId, resource, currentCount)：检查套餐数量上限
//   - checkFeatureOnly(userId, feature)：仅检查不抛错
//
// 设计原则：
//   - requireFeature：抛 FeatureNotAllowedError（403）
//   - requireQuota：抛 QuotaExceededError（429）
//   - requirePlanLimit：抛 PlanLimitError（403）
//   - 两者都自动查询用户套餐，调用方无需传 plan

import { checkFeature, getUserPlan, getPlanLimits, type Feature } from "@/lib/billing";
import { consumeQuota, peekUsage } from "@/lib/seo/cache";
import type { ApiType } from "@/lib/db";
import type { PlanLimits } from "@/lib/billing";
import type { ApiUsage } from "@/lib/seo/types";
import type { PlanTier } from "@/lib/auth";
import {
  FeatureNotAllowedError,
  QuotaExceededError,
  PlanLimitError,
} from "@/lib/errors/billing-errors";

// re-export 统一错误类型供调用方 import 自 guards（统一入口）
export {
  FeatureNotAllowedError,
  QuotaExceededError,
  PlanLimitError,
  isBillingError,
  billingErrorToResponse,
  type BillingErrorBody,
} from "@/lib/errors/billing-errors";

// ---------- 公共 API ----------

/**
 * 检查用户是否拥有某 Feature 权限
 * 不通过时抛 FeatureNotAllowedError，调用方需 try/catch
 *
 * 用法：
 *   try {
 *     await requireFeature(userId, "pdf_export");
 *     // 继续执行导出
 *   } catch (e) {
 *     if (e instanceof FeatureNotAllowedError) {
 *       const { status, body } = billingErrorToResponse(e);
 *       return NextResponse.json(body, { status });
 *     }
 *     throw e;
 *   }
 */
export async function requireFeature(
  userId: string,
  feature: Feature
): Promise<void> {
  const { plan } = await getUserPlan(userId);
  const result = await checkFeature(userId, feature);
  if (!result.allowed) {
    throw new FeatureNotAllowedError(feature, plan, result.reason);
  }
}

/**
 * 仅检查 Feature 权限，不抛错
 * 返回 { allowed, reason }
 */
export async function checkFeatureOnly(
  userId: string,
  feature: Feature
): Promise<{ allowed: boolean; reason?: string }> {
  return checkFeature(userId, feature);
}

/**
 * 检查并消耗 API 额度
 * 自动查询用户套餐，超限时抛 QuotaExceededError
 *
 * 用法：
 *   try {
 *     const usage = await requireQuota(userId, "serpapi");
 *     // 继续调用 SerpApi
 *   } catch (e) {
 *     if (e instanceof QuotaExceededError) {
 *       const { status, body } = billingErrorToResponse(e);
 *       return NextResponse.json(body, { status });
 *     }
 *     throw e;
 *   }
 */
export async function requireQuota(
  userId: string,
  apiType: ApiType
): Promise<ApiUsage> {
  const { plan } = await getUserPlan(userId);
  try {
    return await consumeQuota(userId, apiType, plan);
  } catch (e) {
    // 将 cache.ts 的 QuotaExceededError 转换为 billing-errors 的统一格式
    if (e instanceof Error && e.name === "QuotaExceededError") {
      const cacheErr = e as unknown as { used: number; limit: number; apiType: ApiType; month: string };
      throw new QuotaExceededError(
        cacheErr.used,
        cacheErr.limit,
        cacheErr.apiType,
        cacheErr.month,
        plan
      );
    }
    throw e;
  }
}

/**
 * 仅查询当前用量，不消耗额度
 * 自动查询用户套餐
 */
export async function peekQuota(
  userId: string,
  apiType: ApiType
): Promise<ApiUsage> {
  const { plan } = await getUserPlan(userId);
  return peekUsage(userId, apiType, plan);
}

/**
 * 检查套餐数量上限（如项目数、关键词数）
 * 超限时抛 PlanLimitError
 *
 * @param userId 用户 ID
 * @param resource 资源名称（如 "项目" "追踪关键词"）
 * @param currentCount 当前已用数量
 * @param limitField 对应 PlanLimits 中的字段名
 * @param code 错误码（默认 PROJECT_LIMIT_REACHED）
 */
export async function requirePlanLimit(
  userId: string,
  resource: string,
  currentCount: number,
  limitField: keyof PlanLimits,
  code?: string
): Promise<void> {
  const { plan } = await getUserPlan(userId);
  const limits = await getPlanLimits(plan);
  const limit = limits[limitField];
  if (typeof limit === "number" && currentCount >= limit) {
    throw new PlanLimitError(resource, plan, limit, code);
  }
}

/**
 * 一次性获取用户套餐 + 限制（供 API 路由快速访问）
 */
export async function getUserBillingContext(
  userId: string
): Promise<{ plan: PlanTier; limits: PlanLimits }> {
  const { plan } = await getUserPlan(userId);
  const limits = await getPlanLimits(plan);
  return { plan, limits };
}
