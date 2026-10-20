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
  /** 后端按套餐拒绝的运维/高级动作（如 Pro 专属缓存清理）：与 FEATURE_NOT_AVAILABLE 同类，必须给升级出口 */
  PLAN_REQUIRED: "PLAN_REQUIRED",
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
  /** QUOTA_EXCEEDED 的超限维度：daily（每日限额，次日重置）/ monthly（月度配额，下月 1 日重置） */
  scope?: "daily" | "monthly";
  /** 解锁该动作真正需要的套餐；缺省时弹窗按「升一级」推荐 */
  requiredPlan?: string;
  error?: string; // 兼容非 billing 错误的 error 字段
  /**
   * BUG-44：语言中立的补充信息（如 "HTTP 503"），只允许由服务端算好的技术 token。
   * `{detail}` 模板优先取它，取不到才退回 error/message——避免把中文原文插进英文文案。
   */
  detail?: string;
}

/**
 * 判断 API 响应是否为 billing 错误
 */
export function isBillingError(body: BillingErrorBody): boolean {
  if (!body?.code) return false;
  return (
    body.code === BILLING_ERROR_CODES.QUOTA_EXCEEDED ||
    body.code === BILLING_ERROR_CODES.FEATURE_NOT_AVAILABLE ||
    body.code === BILLING_ERROR_CODES.PLAN_REQUIRED ||
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

/**
 * 读取当前 UI locale：NEXT_LOCALE cookie → <html lang> → en。
 * cookie 只在用户用过语言切换器后才存在；直接访问 /zh 的用户没有 cookie，
 * 此时以 SSR 输出的 <html lang>（反映该请求真实渲染语言）为准，避免中文页面弹英文错误。
 */
export function readUiLocale(): ApiErrorLocale {
  if (typeof document !== "undefined") {
    const m = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=(zh)(?:;|$)/);
    if (m) return "zh";
    if (/^zh/i.test(document.documentElement?.lang ?? "")) return "zh";
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
  if (code) {
    // 每日限额与月度配额重置周期不同，文案必须分开：
    // scope=daily → QUOTA_EXCEEDED_DAILY（今日…明日重置）；缺省沿用月度模板。
    // daily 模板缺失时回退月度模板（不因 catalog 缺项渲染空文案）。
    const catalogKey =
      code === "QUOTA_EXCEEDED" && body.scope === "daily" ? "QUOTA_EXCEEDED_DAILY" : code;
    const template = catalog[catalogKey] ?? catalog[code];
    if (template) {
      // {detail} 占位符（TIMEOUT / INVALID_URL / HTTP_ERROR / UNKNOWN 等模板）：
      // 优先取服务端算好的语言中立 token（body.detail），其次才是 error/message 原文；
      // 两者皆缺失时给双语兜底，避免出现「抓取超时：」这类空冒号。
      const detail =
        body.detail ?? body.error ?? body.message ?? (locale === "zh" ? "暂时无法获取详细信息" : "no further details available");
      return interpolate(template, {
        plan: body.plan,
        // used/limit 缺省时显示占位「–」，避免渲染成空括号「（/）」
        limit: body.limit ?? "–",
        used: body.used ?? "–",
        feature: body.feature ? (locale === "en" ? FEATURE_EN[body.feature] ?? body.feature : body.feature) : undefined,
        detail: detail || (locale === "zh" ? "暂时无法获取详细信息" : "no further details available"),
      });
    }
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

  // 关键词数量上限（KEYWORD_LIMIT_REACHED）的 used/limit 语义就是「账号关键词总数 / 套餐关键词上限」，
  // 与 QUOTA_EXCEEDED 的 SerpApi 每日/每月用量口径完全不同：这里改成按语义分列，
  // 其余 code（项目数、竞品数、分组数、SerpApi 日/月额度）保持原有 used/limit 单行口径。
  // 响应缺少 used 时不进关键词分支——宁可不分列，也不替用户编一个数字。
  const keywordQuota =
    body.code === BILLING_ERROR_CODES.KEYWORD_LIMIT_REACHED &&
    typeof body.used === "number" &&
    typeof body.limit === "number"
      ? { total: body.used, limit: body.limit }
      : null;

  // 触发全局 UpgradeModal
  triggerUpgradeModal({
    currentPlan,
    reason: message,
    feature: body.feature,
    ...(body.requiredPlan ? { requiredPlan: body.requiredPlan } : {}),
    ...(keywordQuota ? { keywordQuota } : { limit: body.limit, used: body.used }),
  });

  return { isBillingError: true, message };
}
