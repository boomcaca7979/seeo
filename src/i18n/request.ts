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
  // BUG-004：无 [locale] 段的未匹配路径（如 /this-page-not-exist）由 global-not-found
  // 渲染，requestLocale 为空并走到此处。若渲染上下文是静态的（构建期/无请求上下文），
  // cookies()/headers() 会抛 DYNAMIC_SERVER_USAGE（生产 500）——静态上下文没有用户请求，
  // 直接回退默认语言。global-not-found 自身声明 force-dynamic，运行时有请求上下文。
  try {
    const store = await cookies();
    const cookieLocale = store.get("NEXT_LOCALE")?.value;
    if (hasLocale(routing.locales, cookieLocale)) return cookieLocale;
    const acceptLanguage = (await headers()).get("accept-language") ?? "";
    if (acceptsChinese(acceptLanguage)) return "zh";
  } catch (err) {
    if (!(err instanceof Error && (err as Error & { digest?: string }).digest === "DYNAMIC_SERVER_USAGE")) {
      throw err;
    }
  }
  return routing.defaultLocale;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  // BUG-004：requested 存在但无效（首段被当成 [locale] 值）时直接用 defaultLocale，
  // 不解析用户 locale —— SSG 路由的动态 fallback 渲染一旦触碰 cookies()（即使被 catch）
  // 也会污染静态渲染 store（staticBailoutInfo）→ E132 → 500。
  // 现在 [locale] 布局已声明 dynamicParams=false，无效 locale 段在路由层就交给
  // global-not-found，本分支只剩防御作用；requested 为空（无 [locale] 段的
  // dashboard/auth 路由）才走 cookie 解析（这些路由本就是动态渲染）。
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : requested === undefined
      ? await resolveUiLocale()
      : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});

export type { Locale };
export { locales };
