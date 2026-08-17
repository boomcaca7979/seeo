// ===== next-intl 请求级配置 =====
// 由 next.config.ts 的 createNextIntlPlugin 挂载（默认路径 src/i18n/request.ts）。
//
// locale 解析优先级：
//   1. [locale] URL 段（营销页 /zh、rewrite 后的 en）
//   2. NEXT_LOCALE cookie（Dashboard /app、/login、/signup 等无 [locale] 段路由）
//   3. Accept-Language 请求头（含 zh* → zh）
//   4. defaultLocale (en)
// Dashboard 不做双 URL：同一 /app 下按 cookie/header 切换 UI 语言。

import { getRequestConfig } from "next-intl/server";
import { hasLocale } from "next-intl";
import { cookies, headers } from "next/headers";
import { routing } from "./routing";
import { locales, type Locale } from "./config";

/** Accept-Language 中是否包含中文（zh / zh-CN / zh-TW / zh-HK …） */
function acceptsChinese(acceptLanguage: string): boolean {
  return /(^|,)\s*zh(-|;|$|\s)/i.test(acceptLanguage);
}

/** 无 [locale] 段路由（dashboard/auth）的 locale：cookie → Accept-Language → en */
export async function resolveUiLocale(): Promise<Locale> {
  const store = await cookies();
  const cookieLocale = store.get("NEXT_LOCALE")?.value;
  if (hasLocale(routing.locales, cookieLocale)) return cookieLocale;
  const acceptLanguage = (await headers()).get("accept-language") ?? "";
  if (acceptsChinese(acceptLanguage)) return "zh";
  return routing.defaultLocale;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : await resolveUiLocale();

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});

export type { Locale };
export { locales };
