// ===== i18n 基础配置（Phase 0 骨架）=====
// 语言策略：英文为默认语言（URL 无前缀），中文挂在 /zh 前缀下。
// Dashboard（/app）、API（/api）、支付（/payment）不参与 locale 路由，
// 后续 Dashboard 采用 UI locale（cookie 驱动），不做双 URL。

export const locales = ["en", "zh"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

/** locale → <html lang> 值 */
export const localeToHtmlLang: Record<Locale, string> = {
  en: "en",
  zh: "zh-CN",
};

/** locale → OpenGraph og:locale 值 */
export const localeToOgLocale: Record<Locale, string> = {
  en: "en_US",
  zh: "zh_CN",
};

/** hreflang 使用的 locale 标识（zh 输出 zh-CN） */
export const localeToHreflang: Record<Locale, string> = {
  en: "en",
  zh: "zh-CN",
};

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
