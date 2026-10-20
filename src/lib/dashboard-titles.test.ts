// ===== BUG-09 回归测试：/app 页签标题的路由 ↔ 语言 ↔ 标题对应关系 =====
// 根因：(default) 根布局只有一份兜底 title "SeeO Account"，/app 下 13 个功能页是
// "use client" 无法各自导出 metadata，于是所有工作台页签标题相同。
// 修复：dashboard layout 的 generateMetadata 按 x-seeo-pathname 解析功能标题（SSR），
// 项目详情页因带 params 由页面自己的 generateMetadata 输出「项目：<domain>」。
// 断言针对「映射表 + 双语目录 + 组合结果」，而不是源码里恰好出现了某个字符串。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DASHBOARD_BRAND,
  DASHBOARD_TITLE_ROUTES,
  TITLE_SEPARATOR,
  composeDashboardTitle,
  matchDashboardTitleRoute,
} from "./dashboard-titles";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EN = JSON.parse(readFileSync(`${ROOT}messages/en.json`, "utf-8"));
const ZH = JSON.parse(readFileSync(`${ROOT}messages/zh.json`, "utf-8"));

const LAYOUT_SRC = readFileSync(
  `${ROOT}src/app/(default)/(dashboard)/app/layout.tsx`,
  "utf-8"
);
const PROJECT_PAGE_SRC = readFileSync(
  `${ROOT}src/app/(default)/(dashboard)/app/projects/[id]/page.tsx`,
  "utf-8"
);
const PROXY_SRC = readFileSync(`${ROOT}src/lib/supabase/middleware.ts`, "utf-8");
const ACCESS_SRC = readFileSync(`${ROOT}src/lib/project-access.ts`, "utf-8");

/** 按 next-intl 的点号嵌套语义从 dashboard 命名空间取文案 */
function lookup(catalog: Record<string, unknown>, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], catalog.dashboard);
}

describe("BUG-09：标题映射表自身成立", () => {
  it("每个 /app 功能路由的标题键在中英文目录里都是非空文案", () => {
    for (const route of DASHBOARD_TITLE_ROUTES) {
      for (const [name, catalog] of [["en", EN], ["zh", ZH]] as const) {
        const value = lookup(catalog, route.titleKey);
        expect(typeof value, `${name} ${route.path} → dashboard.${route.titleKey}`).toBe("string");
        expect((value as string).trim().length, `${name} ${route.path} 标题为空`).toBeGreaterThan(0);
      }
    }
  });

  it("同一语言下各功能页标题互不重复（含打印版报告与报表中心的区分）", () => {
    for (const catalog of [EN, ZH]) {
      const titles = DASHBOARD_TITLE_ROUTES.map((r) => composeDashboardTitle(lookup(catalog, r.titleKey) as string));
      expect(new Set(titles).size).toBe(titles.length);
    }
  });

  it("英文路由取英文文案、中文路由取中文文案，且都保留品牌后缀", () => {
    const enBacklinks = composeDashboardTitle(lookup(EN, "backlinks.title") as string);
    const zhBacklinks = composeDashboardTitle(lookup(ZH, "backlinks.title") as string);
    expect(enBacklinks).toBe("Backlink Analysis · SeeO");
    expect(zhBacklinks).toBe("外链分析 · SeeO");
    for (const title of [enBacklinks, zhBacklinks]) {
      expect(title.endsWith(`${TITLE_SEPARATOR}${DASHBOARD_BRAND}`)).toBe(true);
    }
  });
});

describe("BUG-09：pathname → 标题键的解析结果", () => {
  const CASES: [string, string][] = [
    ["/app", "workspace.title"],
    ["/app/reports", "reportsPage.title"],
    ["/app/reports/audit", "printAudit.pageTitle"],
    ["/app/backlinks", "backlinks.title"],
    ["/app/audit", "audit.title"],
    ["/app/keyword-overview", "keywords.overview.title"],
    ["/app/keyword-expand", "keywords.expand.title"],
    ["/app/position-tracking", "positionTracking.title"],
    ["/app/rank-check", "rankCheck.title"],
    ["/app/opportunities", "opportunities.title"],
    ["/app/actions", "actions.title"],
    ["/app/competitors", "competitors.title"],
    ["/app/content", "content.title"],
    ["/app/settings", "settings.title"],
  ];

  it.each(CASES)("%s → %s", (pathname, titleKey) => {
    expect(matchDashboardTitleRoute(pathname)?.titleKey).toBe(titleKey);
  });

  it("/app/reports/audit 不会被更短的 /app/reports 前缀吃掉", () => {
    expect(matchDashboardTitleRoute("/app/reports/audit")?.path).toBe("/app/reports/audit");
  });

  it("容忍尾斜杠与 query；项目详情子路由回退到 /app 条目（页面 metadata 再覆盖）", () => {
    expect(matchDashboardTitleRoute("/app/backlinks/")?.titleKey).toBe("backlinks.title");
    expect(matchDashboardTitleRoute("/app/competitors?domain=a.com")?.titleKey).toBe("competitors.title");
    expect(matchDashboardTitleRoute("/app/projects/13")?.titleKey).toBe("workspace.title");
  });

  it("营销页与认证页不属于 Dashboard 标题范围（不得被批量改写）", () => {
    for (const path of ["/", "/zh", "/pricing", "/login", "/signup", "/payment/result", "/admin", "/unsubscribe"]) {
      expect(matchDashboardTitleRoute(path), path).toBeNull();
    }
  });

  it("缺失 pathname 不猜标题", () => {
    expect(matchDashboardTitleRoute(null)).toBeNull();
    expect(matchDashboardTitleRoute("")).toBeNull();
  });
});

describe("BUG-09：metadata 层实现位置", () => {
  it("dashboard layout 导出 generateMetadata 并按 header pathname 组标题", () => {
    expect(LAYOUT_SRC).toContain("export async function generateMetadata(): Promise<Metadata>");
    expect(LAYOUT_SRC).toContain('headersList.get("x-seeo-pathname")');
    expect(LAYOUT_SRC).toContain("matchDashboardTitleRoute(pathname)");
    expect(LAYOUT_SRC).toContain('getTranslations("dashboard")');
    expect(LAYOUT_SRC).toContain("composeDashboardTitle(t(route.titleKey))");
    expect(LAYOUT_SRC).not.toMatch(/title:\s*"SeeO Account"/);
  });

  it("pathname 读不到时退回品牌名，不猜某个功能的标题；两个分支都输出本地化 description", () => {
    const FN = LAYOUT_SRC.slice(
      LAYOUT_SRC.indexOf("export async function generateMetadata"),
      LAYOUT_SRC.indexOf("export default async function DashboardLayout")
    );
    expect(FN).toContain("pathname ? matchDashboardTitleRoute(pathname) : null");
    expect(FN).toContain("if (!route) return { title: DASHBOARD_BRAND, description }");
    expect(FN).toContain("{ title: composeDashboardTitle(t(route.titleKey)), description }");
    // description 只能来自 dashboard catalog：漏掉就会继承 (default)/layout 的英文兜底描述
    expect(FN).toContain('const description = t("metaDescription")');
    expect(FN).not.toContain('?? "/app"');
  });

  it("标题全部来自 SSR metadata，不存在 document.title 补丁", () => {
    expect(LAYOUT_SRC).not.toMatch(/document\.title\s*=/);
    expect(PROJECT_PAGE_SRC).not.toMatch(/document\.title\s*=/);
  });

  it("项目详情页用自己的 generateMetadata 输出含 domain 的功能标题", () => {
    expect(PROJECT_PAGE_SRC).toContain("export async function generateMetadata({ params }: PageProps)");
    expect(PROJECT_PAGE_SRC).toContain('t("pageTitle", { domain:');
    expect(lookup(EN, "shared.projectDetail.pageTitle")).toBe("Project: {domain}");
    expect(lookup(ZH, "shared.projectDetail.pageTitle")).toBe("项目：{domain}");
  });

  it("项目归属判定只有一份实现，标题、渲染与 proxy 的路由级 404 共用", () => {
    expect(PROJECT_PAGE_SRC).toContain("async function loadProjectIdentity(");
    // 判据本体在 @/lib/project-access：页面与 proxy 都只调用它，谁都不再自己写查询。
    // user_id 过滤全局只出现一次（在判据里），出现第二处就说明有人复制了一套隔离逻辑。
    expect(PROJECT_PAGE_SRC).toContain("readOwnedProject(");
    expect(PROXY_SRC).toContain("readOwnedProject(");
    expect(PROJECT_PAGE_SRC.match(/eq\("user_id"/g)?.length ?? 0).toBe(0);
    expect(PROXY_SRC.match(/eq\("user_id"/g)?.length ?? 0).toBe(0);
    expect(ACCESS_SRC.match(/eq\("user_id", userId\)/g)?.length).toBe(1);
    expect(PROJECT_PAGE_SRC.match(/supabase\.auth\.getUser\(\)/g)?.length).toBe(1);
  });
});
