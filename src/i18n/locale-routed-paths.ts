// ===== locale 路由白名单（proxy 与前端语言切换器共用）=====
// 只有这些营销路径参与 locale 路由（en 无前缀 · zh 加 /zh 前缀）。
// 其余路径（/app、/payment、/api、legacy 中文页）不走 locale 路由。

export const LOCALE_ROUTED_PATHS = new Set([
  "/",
  "/pricing",
  "/docs",
  "/features/seo-audit",
  "/features/rank-tracking",
  "/features/backlink-analysis",
  "/about",
  "/privacy",
  "/terms",
  "/refund",
]);

/** 剥离 /zh locale 前缀，返回逻辑路径（en 即原样） */
export function stripLocalePrefix(pathname: string): string {
  if (pathname === "/zh" || pathname === "/zh/") return "/";
  if (pathname.startsWith("/zh/")) {
    return pathname.slice(3) || "/";
  }
  return pathname;
}

/** 判断某条 pathname 是否参与 locale 路由（兼容带 /zh 前缀与不带前缀两种输入） */
export function isLocaleRoutedPath(pathname: string): boolean {
  return LOCALE_ROUTED_PATHS.has(stripLocalePrefix(pathname));
}
