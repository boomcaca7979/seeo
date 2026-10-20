// ===== 404 的界面语言解析 =====
// 与 not-found-meta（纯 head 组包）分开：这里读 cookie/Accept-Language
// （@/i18n/request），只允许 404 入口本身（global-not-found）调用。营销页只用
// notFoundPageMeta/notFoundPageMetadata，若把它们也拉进 request 作用域，等于给每个
// 营销页的模块图加上 cookie 解析依赖（并让「静态渲染上下文误触 cookie store →
// BUG-004」只差一次误用）。

import { defaultLocale, type Locale } from "@/i18n/config";
import { isUiLocalePath, localeSegmentFromPathname } from "@/i18n/locale-routed-paths";
import { resolveUiLocale } from "@/i18n/request";

/**
 * 三级规则，与路由设计一一对应：
 *   1. URL 前缀有 zh/en（营销 locale 路由）→ 前缀说了算，不读 cookie
 *      （爬虫协商、hreflang canonical 都只认前缀）。
 *   2. 首段属于 UI locale 路径空间（/app、/login、/signup、/payment、/unsubscribe
 *      的未知子路径）→ 与工作台/认证页同一套 cookie → Accept-Language → en
 *      解析，中文界面用户的 404 才是中文。
 *   3. 其余无效首段（/nope、/x/y/z）→ defaultLocale，且不解析 cookie
 *      （BUG-004：动态 fallback 静态渲染上下文触碰 cookie store 会 500）。
 */
export async function notFoundLocale(
  pathname: string | null | undefined
): Promise<Locale> {
  const fromPrefix = localeSegmentFromPathname(pathname);
  if (fromPrefix) return fromPrefix;
  if (isUiLocalePath(pathname)) return await resolveUiLocale();
  return defaultLocale;
}
