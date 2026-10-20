// ===== Dashboard 页签标题映射（BUG-09）=====
// /app 下 13 个功能页是 "use client"，无法各自导出 metadata，
// 因此标题由 dashboard layout 的 generateMetadata 按当前 pathname 解析（SSR 输出，
// 不做 document.title 补丁——那会造成首屏标题错误与 hydration 不一致）。
// 本模块只做「路由 ↔ dashboard.* 标题键」的纯映射，不触碰 i18n 运行时，
// 便于测试直接断言对应关系，而不是断言某个字符串碰巧出现在源码里。

export const DASHBOARD_BRAND = "SeeO";

/** 功能名与品牌之间的分隔符 */
export const TITLE_SEPARATOR = " · ";

export interface DashboardTitleRoute {
  /** /app 下的路由前缀（不含 query） */
  readonly path: string;
  /** dashboard 命名空间内的标题键（next-intl 支持点号嵌套） */
  readonly titleKey: string;
}

// /app/projects/[id] 不在表内：该页有 params，标题由页面自己的 generateMetadata 生成。
export const DASHBOARD_TITLE_ROUTES: readonly DashboardTitleRoute[] = [
  { path: "/app/reports/audit", titleKey: "printAudit.pageTitle" },
  { path: "/app/reports", titleKey: "reportsPage.title" },
  { path: "/app/keyword-overview", titleKey: "keywords.overview.title" },
  { path: "/app/keyword-expand", titleKey: "keywords.expand.title" },
  { path: "/app/position-tracking", titleKey: "positionTracking.title" },
  { path: "/app/rank-check", titleKey: "rankCheck.title" },
  { path: "/app/opportunities", titleKey: "opportunities.title" },
  { path: "/app/actions", titleKey: "actions.title" },
  { path: "/app/competitors", titleKey: "competitors.title" },
  { path: "/app/content", titleKey: "content.title" },
  { path: "/app/backlinks", titleKey: "backlinks.title" },
  { path: "/app/settings", titleKey: "settings.title" },
  { path: "/app/audit", titleKey: "audit.title" },
  { path: "/app", titleKey: "workspace.title" },
];

/**
 * 最长前缀命中。
 * `/app/reports/audit` 必须命中打印版报告条目而非 `/app/reports`，
 * `/app/projects/13` 这类未单独登记的子路由回退到 `/app` 条目。
 */
export function matchDashboardTitleRoute(
  pathname: string | null | undefined
): DashboardTitleRoute | null {
  const clean = normalize(pathname);
  let best: DashboardTitleRoute | null = null;
  for (const route of DASHBOARD_TITLE_ROUTES) {
    if (clean === route.path || clean.startsWith(`${route.path}/`)) {
      if (!best || route.path.length > best.path.length) best = route;
    }
  }
  return best;
}

function normalize(pathname: string | null | undefined): string {
  const raw = (pathname ?? "").split("?")[0].split("#")[0];
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw;
}

/** 「<功能名> · SeeO」：保留品牌后缀，同时让每个功能页标题互不相同 */
export function composeDashboardTitle(feature: string): string {
  return `${feature}${TITLE_SEPARATOR}${DASHBOARD_BRAND}`;
}
