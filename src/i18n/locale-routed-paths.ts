// ===== locale 路由白名单（proxy 与前端语言切换器共用）=====
// 只有这些营销路径参与 locale 路由（en 无前缀 · zh 加 /zh 前缀）。
// 其余路径（/app、/payment、/api、legacy 中文页）不走 locale 路由。

import { locales } from "./config";

export const LOCALE_ROUTED_PATHS = new Set([
  "/",
  "/pricing",
  "/docs",
  "/features/seo-audit",
  "/features/rank-tracking",
  "/features/backlink-analysis",
  "/features/keyword-research",
  "/features/competitor-analysis",
  "/features/content-optimization",
  "/alternatives/semrush",
  "/alternatives/ahrefs",
  "/guides/how-to-do-a-technical-seo-audit",
  "/guides/how-to-track-keyword-rankings",
  "/guides/how-to-analyze-backlinks",
  "/tools/backlink-checker",
  // H｜SEO 获客基地：问题型（症状诊断）搜索入口
  // 与 /features/*（功能说明）分工不同，内容来自 src/lib/seo/landing-pages.ts
  "/seo-issues",
  "/seo-issues/duplicate-title-tags",
  "/seo-issues/missing-canonical",
  "/seo-issues/pages-not-indexed",
  "/seo-issues/broken-internal-links",
  "/seo-issues/sitemap-errors",
  "/seo-issues/slow-pages",
  "/seo-issues/thin-content",
  "/seo-issues/orphan-pages",
  "/seo-issues/keyword-cannibalization",
  "/about",
  "/privacy",
  "/terms",
  "/refund",
  "/contact",
  // 公开运营材料（第五阶段）：公开更新日志（Owner 决定不设独立路线图/数据来源页）
  "/changelog",
]);

/**
 * 剥离 locale 前缀，返回逻辑路径。
 *
 * 必须覆盖全部 locale，不能只处理 /zh：`[locale]` 段的静态产物按**内部路径**
 * 预渲染（en.html、en/pricing.html），因此服务端渲染时 usePathname() 拿到的是
 * `/en`、`/en/pricing`，而浏览器地址是 as-needed 规范下的 `/`、`/pricing`。
 * 只剥 /zh 会让英文页首轮 SSR 的 Navbar 按 `/en/...` 判定（语言切换整段缺失、
 * aria-current 丢失、锚点多带前缀），与客户端首轮渲染不一致 → React #418。
 */
export function stripLocalePrefix(pathname: string): string {
  for (const locale of locales) {
    const prefix = `/${locale}`;
    if (pathname === prefix || pathname === `${prefix}/`) return "/";
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length) || "/";
  }
  return pathname;
}

/** 判断某条 pathname 是否参与 locale 路由（兼容带 /zh 前缀与不带前缀两种输入） */
export function isLocaleRoutedPath(pathname: string): boolean {
  return LOCALE_ROUTED_PATHS.has(stripLocalePrefix(pathname));
}

/**
 * 单 URL + cookie/Accept-Language 出界面的路径空间（无 [locale] 段）：
 * 工作台、认证、支付结果、退订。它们的未知子路径在路由层就不匹配任何页面，
 * 由 global-not-found 输出 404 文档；404 必须沿用同一套界面语言规则，
 * 否则中文界面用户的 404 标题/正文恒为英文。
 */
export const UI_LOCALE_SEGMENTS = new Set([
  "app",
  "login",
  "signup",
  "payment",
  "unsubscribe",
]);

/** pathname 首段是否属于 UI locale（cookie 驱动）路径空间 */
export function isUiLocalePath(pathname: string | null | undefined): boolean {
  const first = (pathname ?? "").split("?")[0].split("#")[0].split("/")[1];
  return first !== undefined && UI_LOCALE_SEGMENTS.has(first);
}

/**
 * pathname 首段的 locale（/zh/xxx → zh，/zh → zh，其余 → null）。
 *
 * 404 的 metadata 解析运行在没有 [locale] params 的隔离上下文（requestLocale
 * 为空 → 回退 defaultLocale），只按 URL 前缀取 locale 才能与 not-found 正文
 * 的 locale 一致：/zh/未知路径正文是中文，标题却会是英文。
 * 首段是无效 locale（/nope、/app/未知路径）时返回 null，由调用方决定回退规则：
 * 非 UI 路径（/nope）与 request config「requested 无效 → defaultLocale，不解析
 * cookie」同规则；UI locale 路径空间（/app/未知路径）改走 cookie/Accept-Language
 * 解析（见 notFoundLocale）。
 */
export function localeSegmentFromPathname(
  pathname: string | null | undefined
): "en" | "zh" | null {
  const first = (pathname ?? "").split("?")[0].split("#")[0].split("/")[1];
  return first === "zh" ? "zh" : first === "en" ? "en" : null;
}
