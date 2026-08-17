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

import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";
import { locales, defaultLocale } from "./config";

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "as-needed",
});

// locale-aware 导航 API（Link/useRouter/usePathname）：
// href 无需手写 /zh 前缀，按当前 locale 自动生成，避免出现 /en、/zh/zh 等错误路径
export const { Link, useRouter, usePathname } = createNavigation(routing);
