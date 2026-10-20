// ===== 套餐显示名称（UI 层唯一来源）=====
// 只翻译显示名称；真实额度/价格/功能限制一律来自 src/lib/billing.ts 单一数据源。

import type { Locale } from "@/i18n/config";
import type { SubscriptionStatus } from "@/lib/auth";

export const PLAN_LABELS: Record<Locale, Record<string, string>> = {
  en: { free: "Free", lite: "Lite", pro: "Pro" },
  zh: { free: "免费版", lite: "Lite 版", pro: "专业版" },
};

export function planLabel(plan: string, locale: Locale): string {
  return PLAN_LABELS[locale]?.[plan] ?? plan;
}

/** 功能权益显示名称（UpgradeModal 等处展示用） */
export const FEATURE_LABELS: Record<Locale, Record<string, string>> = {
  en: {
    pdf_export: "PDF export",
    excel_export: "CSV export (Excel-compatible)",
    full_audit: "Full site audit",
    backlinks: "Backlink analysis",
    email_report: "Email reports",
  },
  zh: {
    pdf_export: "PDF 导出",
    excel_export: "CSV 导出（Excel 兼容）",
    full_audit: "完整审计",
    backlinks: "外链分析",
    email_report: "邮件报告",
  },
};

export function featureLabel(feature: string, locale: Locale): string {
  return FEATURE_LABELS[locale]?.[feature] ?? feature;
}

/**
 * 订阅状态显示名称。
 * 取值域来自 profiles.subscription_status 的 DB CHECK 六值（0003_subscription.sql），
 * 语义按 billing.getUserPlan / isSubscriptionActive / membership-expire cron 的实际判定：
 * inactive 是「从未订阅」的默认态，与 canceled（用户取消）/ expired（到期降级 free）互斥，
 * 因此三者各用一条文案，不合并成「已退订」。
 */
export const SUBSCRIPTION_STATUS_LABELS: Record<Locale, Record<SubscriptionStatus, string>> = {
  en: {
    active: "Active",
    trialing: "Trialing",
    past_due: "Payment overdue",
    canceled: "Canceled",
    expired: "Expired",
    inactive: "Not subscribed",
  },
  zh: {
    active: "生效中",
    trialing: "试用中",
    past_due: "付款逾期",
    canceled: "已取消订阅",
    expired: "已到期",
    inactive: "未订阅",
  },
};

/** 未识别枚举值的安全回退：内部枚举不得作为用户可见主文案，也不得留空 */
export const UNKNOWN_SUBSCRIPTION_STATUS: Record<Locale, string> = {
  en: "Unknown status",
  zh: "状态未知",
};

export function subscriptionStatusLabel(status: string, locale: Locale): string {
  const labels: Record<string, string> = SUBSCRIPTION_STATUS_LABELS[locale];
  return labels[status] ?? UNKNOWN_SUBSCRIPTION_STATUS[locale];
}
