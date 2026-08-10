// ===== 前端 Billing 错误处理工具 =====
// 解析后端 billingErrorToResponse 返回的结构化错误
// 并触发 UpgradeModal 升级引导

import { triggerUpgradeModal } from "@/components/billing/UpgradeModal";

// ===== Billing 错误码 =====
export const BILLING_ERROR_CODES = {
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  FEATURE_NOT_AVAILABLE: "FEATURE_NOT_AVAILABLE",
  PLAN_LIMIT_REACHED: "PLAN_LIMIT_REACHED",
  PROJECT_LIMIT_REACHED: "PROJECT_LIMIT_REACHED",
  KEYWORD_LIMIT_REACHED: "KEYWORD_LIMIT_REACHED",
  AUDIT_DAILY_LIMIT_REACHED: "AUDIT_DAILY_LIMIT_REACHED",
  COMPETITOR_LIMIT_REACHED: "COMPETITOR_LIMIT_REACHED",
  KEYWORD_GROUP_LIMIT_REACHED: "KEYWORD_GROUP_LIMIT_REACHED",
} as const;

export type BillingErrorCode = typeof BILLING_ERROR_CODES[keyof typeof BILLING_ERROR_CODES];

const ALL_LIMIT_CODES = new Set<string>([
  BILLING_ERROR_CODES.PLAN_LIMIT_REACHED,
  BILLING_ERROR_CODES.PROJECT_LIMIT_REACHED,
  BILLING_ERROR_CODES.KEYWORD_LIMIT_REACHED,
  BILLING_ERROR_CODES.AUDIT_DAILY_LIMIT_REACHED,
  BILLING_ERROR_CODES.COMPETITOR_LIMIT_REACHED,
  BILLING_ERROR_CODES.KEYWORD_GROUP_LIMIT_REACHED,
]);

export interface BillingErrorBody {
  code?: string;
  message?: string;
  plan?: string;
  feature?: string;
  limit?: number;
  used?: number;
  error?: string; // 兼容非 billing 错误的 error 字段
}

/**
 * 判断 API 响应是否为 billing 错误
 */
export function isBillingError(body: BillingErrorBody): boolean {
  if (!body?.code) return false;
  return (
    body.code === BILLING_ERROR_CODES.QUOTA_EXCEEDED ||
    body.code === BILLING_ERROR_CODES.FEATURE_NOT_AVAILABLE ||
    ALL_LIMIT_CODES.has(body.code)
  );
}

/**
 * 处理 billing 错误：
 * - QUOTA_EXCEEDED / *_LIMIT_REACHED → 触发 UpgradeModal + 返回 toast 文案
 * - FEATURE_NOT_AVAILABLE → 触发 UpgradeModal + 返回 toast 文案
 * - 非 billing 错误 → 返回原始错误文案
 *
 * @param body API 响应 JSON
 * @param fallbackMessage 默认错误文案
 * @returns { isBillingError: boolean, message: string }
 */
export function handleBillingError(
  body: BillingErrorBody,
  fallbackMessage: string
): { isBillingError: boolean; message: string } {
  if (!isBillingError(body)) {
    return { isBillingError: false, message: body?.error ?? body?.message ?? fallbackMessage };
  }

  const currentPlan = body.plan ?? "free";
  const message = body.message ?? fallbackMessage;

  // 触发全局 UpgradeModal
  triggerUpgradeModal({
    currentPlan,
    reason: message,
    feature: body.feature,
    limit: body.limit,
    used: body.used,
  });

  return { isBillingError: true, message };
}
