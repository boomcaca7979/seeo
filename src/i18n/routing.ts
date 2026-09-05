// ===== next-intl 路由定义 =====
// localePrefix: "as-needed" —— 默认语言 en 无 URL 前缀（/pricing），
// 非默认语言 zh 带前缀（/zh/pricing）。
// 语言检测优先级（next-intl middleware 默认行为）：
//   1. URL 路径前缀（/zh/...）
//   2. NEXT_LOCALE cookie
//   3. Accept-Language 请求头
//   4. defaultLocale (en)
// 爬虫（Googlebot/Bingbot 不发送 Accept-Language）→ 命中 defaultLocale en，
// 不会被重定向到 /zh。
//
// alternateLinks: false —— 禁用 middleware 自动输出的 HTTP `Link: rel=alternate`
// header：其 hreflang 使用内部 locale 标识（zh 而非 zh-CN），与页面 <link>
// hreflang="zh-CN"（HreflangAlternates，SEO 工具链按小写 hreflang 匹配）
// 不一致。页面级 <link> 是 hreflang 的唯一来源。

import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";
import { locales, defaultLocale } from "./config";

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "as-needed",
  alternateLinks: false,
});

// locale-aware 导航 API（Link/useRouter/usePathname）：
// href 无需手写 /zh 前缀，按当前 locale 自动生成，避免出现 /en、/zh/zh 等错误路径。
// 注意：只用于 locale 路由白名单内的营销路径；/login、/signup、/app 等
// 单语言页必须用 next/link（否则会被加上 /zh 前缀指向 404，如 /zh/signup）。
export const { Link, useRouter, usePathname } = createNavigation(routing);
