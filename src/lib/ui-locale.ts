// ===== Dashboard UI 数字/日期格式化 locale 工具 =====
// 仅影响 UI 展示：数据库存储、API 数据格式、时间戳均不变。
// EN → en-US（1,234 / Aug 17, 2026），ZH → zh-CN（1,234 / 2026年8月17日）。

import type { Locale } from "@/i18n/config";

export type { Locale };

/** UI locale → Intl locale */
export function intlLocale(locale: Locale): "en-US" | "zh-CN" {
  return locale === "zh" ? "zh-CN" : "en-US";
}

/** 数字千分位 */
export function formatNumber(value: number, locale: Locale): string {
  return value.toLocaleString(intlLocale(locale));
}

/** 日期显示（不含时间） */
export function formatDate(value: Date | string | number, locale: Locale): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(intlLocale(locale), {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
