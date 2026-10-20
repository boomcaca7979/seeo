// ===== 营销页语言切换的导航契约 =====
// 切换必须「写 cookie + 整份文档重新加载」，不能走 App Router 的客户端导航：
// 实测 Next 16.2.12 + React 19.2.4 下，同一页面的两个 locale 之间做客户端切换时
// React 不会替换服务端文档里已有的 head 标签，而是再追加一份——
// :3300 真实浏览器量到 descCount / canonCount / ogCount 各自从 1 变成 2，
// 且旧语言的那一份排在前面（/ 切到 /zh 后 canonical 仍指向 https://www.seeo.asia）。
// 重复且相互冲突的 canonical / og:locale 对搜索引擎是实质错误，
// 而整份文档加载由服务端一次输出唯一且正确的 head（同路径 reload 实测各为 1）。
//
// cookie 必须先写：next-intl 对无前缀 URL（/、/pricing）按 cookie → Accept-Language
// 解析语言，若仍是旧语言就会被 middleware 307 送回原语言路径（表现为「点了没反应」）。

import { type Locale } from "./config";
import { localePath } from "./seo";

/** 与 next-intl 默认 localeCookie 同名同站点策略；Path=/ 保证跨前缀路径一致可读 */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** 切换目标 URL（en 无前缀，zh 带 /zh），与页面 hreflang/canonical 同源（localePath） */
export function localeSwitchHref(locale: Locale, path: string): string {
  return localePath(locale, path);
}

/** document.cookie 可直写的序列化串 */
export function localeSwitchCookie(locale: Locale): string {
  return (
    `${LOCALE_COOKIE_NAME}=${locale}; ` +
    `Path=/; ` +
    `Max-Age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; ` +
    `SameSite=Lax`
  );
}
