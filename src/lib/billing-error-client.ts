// ===== 前端 Billing 错误处理工具（Phase 4：locale 感知）=====
// 解析后端 billingErrorToResponse 返回的结构化错误
// 并触发 UpgradeModal 升级引导
//
// Phase 4 约定：
//   - API 错误响应保留原有 `error`（中文原文）并新增 `code`（machine-readable）
//   - 前端优先按 code + 当前 UI locale（NEXT_LOCALE cookie）显示 EN/ZH message
//   - 无 code 的旧响应继续 fallback 到 error/message 字段

import { triggerUpgradeModal } from "@/components/billing/UpgradeModal";
import EN_MESSAGES from "../../messages/en.json";
import ZH_MESSAGES from "../../messages/zh.json";

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

// ===== locale 感知错误文案（Phase 4）=====

type ApiErrorLocale = "en" | "zh";

const API_ERRORS: Record<ApiErrorLocale, Record<string, string>> = {
  en: EN_MESSAGES.apiErrors,
  zh: ZH_MESSAGES.apiErrors,
};

/** feature（machine-readable 枚举）→ 友好展示名 */
const FEATURE_EN: Record<string, string> = {
  pdf_export: "PDF export",
  excel_export: "Excel export",
  full_audit: "full audit",
  email_report: "email reports",
};

/** 读取当前 UI locale：NEXT_LOCALE cookie → en（与 i18n request.ts 优先级一致） */
export function readUiLocale(): ApiErrorLocale {
  if (typeof document !== "undefined") {
    const m = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=(zh)(?:;|$)/);
    if (m) return "zh";
  }
  return "en";
}

function interpolate(template: string, values: Record<string, string | number | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = values[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

/**
 * 按 code + locale 解析 API 错误文案：
 *   - code 命中 apiErrors catalog → 返回插值后的 EN/ZH message
 *   - 未命中 / 无 code → fallback 到 error / message / fallbackMessage（旧响应兼容）
 */
export function resolveApiErrorMessage(
  body: BillingErrorBody,
  locale: ApiErrorLocale = readUiLocale(),
  fallbackMessage = ""
): string {
  const code = body?.code;
  const catalog = API_ERRORS[locale] ?? API_ERRORS.en;
  if (code && catalog[code]) {
    return interpolate(catalog[code], {
      plan: body.plan,
      limit: body.limit,
      used: body.used,
      feature: body.feature ? (locale === "en" ? FEATURE_EN[body.feature] ?? body.feature : body.feature) : undefined,
    });
  }
  return body?.error ?? body?.message ?? fallbackMessage;
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
    return { isBillingError: false, message: resolveApiErrorMessage(body, readUiLocale(), fallbackMessage) || fallbackMessage };
  }

  const currentPlan = body.plan ?? "free";
  const locale = readUiLocale();
  const message = resolveApiErrorMessage(body, locale, fallbackMessage) || fallbackMessage;

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
