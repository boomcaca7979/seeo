// ===== 套餐显示名称（UI 层唯一来源）=====
// 只翻译显示名称；真实额度/价格/功能限制一律来自 src/lib/billing.ts 单一数据源。

import type { Locale } from "@/i18n/config";

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
    excel_export: "Excel export",
    full_audit: "Full site audit",
    backlinks: "Backlink analysis",
    email_report: "Email reports",
  },
  zh: {
    pdf_export: "PDF 导出",
    excel_export: "Excel 导出",
    full_audit: "完整审计",
    backlinks: "外链分析",
    email_report: "邮件报告",
  },
};

export function featureLabel(feature: string, locale: Locale): string {
  return FEATURE_LABELS[locale]?.[feature] ?? feature;
}
