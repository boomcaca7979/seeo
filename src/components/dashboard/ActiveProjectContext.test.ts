// ===== 全局项目上下文接线（源码契约）=====
//
// 这一层只断言"接线是否正确"，不替代真实浏览器验收：
//   - 顶部选择器 → 共享 Provider → 五个曾各自兜底的项目页
//   - 切换项目只改数据范围，不做导航
//   - 深链（?domain= / ?url=）优先于全局项目
//   - 快速切换时旧响应不得覆盖新选择
//
// 真实页面行为仍需用户在浏览器里逐项点验（本阶段不启动浏览器）。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf-8");

const PROVIDER = read("./ActiveProjectContext.tsx");
const SHELL = read("./DashboardShell.tsx");
const TOPBAR = read("./Topbar.tsx");
const PAGE = {
  audit: read("../../app/(default)/(dashboard)/app/audit/page.tsx"),
  content: read("../../app/(default)/(dashboard)/app/content/page.tsx"),
  backlinks: read("../../app/(default)/(dashboard)/app/backlinks/page.tsx"),
  rankCheck: read("../../app/(default)/(dashboard)/app/rank-check/page.tsx"),
  keywordExpand: read("../../app/(default)/(dashboard)/app/keyword-expand/page.tsx"),
  keywordOverview: read("../../app/(default)/(dashboard)/app/keyword-overview/page.tsx"),
};

describe("Provider 接线", () => {
  it("DashboardShell 用 ActiveProjectProvider 包住 Topbar 与所有 /app 页面", () => {
    expect(SHELL).toContain('import { ActiveProjectProvider } from "@/components/dashboard/ActiveProjectContext";');
    expect(SHELL).toContain("<ActiveProjectProvider>");
    // Provider 必须在 Inner（Topbar/children 所在层）之外
    expect(SHELL.indexOf("<ActiveProjectProvider>")).toBeLessThan(SHELL.indexOf("<DashboardShellInner"));
  });

  it("Provider 暴露唯一真源：projects / activeId / activeDomain / setActive / reload", () => {
    for (const key of ["projects,", "activeId,", "activeDomain:", "setActive,", "reload,"]) {
      expect(PROVIDER, key).toContain(key);
    }
    expect(PROVIDER).toContain("export function useActiveProject()");
    // 失败与空列表必须分开（BUG-16 的同类语义）
    expect(PROVIDER).toContain("failed: boolean");
  });

  it("Topbar 只读上下文，不再自己持有列表/选中态", () => {
    expect(TOPBAR).toContain("useActiveProject()");
    expect(TOPBAR).not.toContain('fetch("/api/projects"');
    expect(TOPBAR).not.toContain("useState<string | null>(null)");
  });
});

describe("五个曾各自兜底的项目页：全部消费共享上下文", () => {
  const entries = Object.entries(PAGE).filter(([k]) => k !== "keywordOverview");

  it("每页都读 useActiveProject 并使用 activeDomain", () => {
    for (const [name, src] of entries) {
      expect(src, name).toContain("useActiveProject()");
      expect(src, name).toContain("activeDomain");
    }
  });

  it("每页都不再自己请求 /api/projects", () => {
    for (const [name, src] of entries) {
      expect(src, name).not.toContain('fetch("/api/projects"');
    }
  });

  it("切换项目不是导航：不跳转到别的 /app 页面", () => {
    for (const [name, src] of entries) {
      expect(src, name).not.toMatch(/router\.(push|replace)\(\s*[`'"]\/app\/(content|backlinks|rank-check|keyword-expand)/);
      expect(src, name).not.toMatch(/window\.location\.(assign|href)/);
    }
    // 审计页唯一允许的 replace 是「清掉 ?domain= 后留在本页」
    expect(PAGE.audit).toMatch(/router\.replace\(`\/app\/audit\$\{qs \? `\?\$\{qs\}` : ""\}`/);
  });

  it("深链范围优先：URL 明确指定域名/URL 时不应用全局项目", () => {
    expect(PAGE.audit).toContain('searchParams.get("domain")');
    expect(PAGE.content).toContain('searchParams.get("url")');
    expect(PAGE.content).toContain('searchParams.get("domain")');
    expect(PAGE.backlinks).toContain('searchParams.get("domain")');
  });

  it("审计页按请求序号丢弃过期响应（快速 A→B 时以 B 为准）", () => {
    expect(PAGE.audit).toContain("loadSeqRef");
    expect(PAGE.audit).toContain("if (seq !== loadSeqRef.current) return null;");
  });

  it("审计页在切项目时清掉 ?domain=（它代表上一轮显式范围）", () => {
    expect(PAGE.audit).toContain('detail.source !== "user"');
    expect(PAGE.audit).toContain('next.delete("domain")');
  });
});

describe("keyword-overview：独立关键词工具 + 项目维 GSC 表现（2026-11 契约更新）", () => {
  // 契约演进说明：概览页升级为 Semrush 式工作台后新增「GSC 实际表现」区，
  // 该区按当前项目读取 GSC 数据（真实项目依赖）；而关键词研究链路
  // （SERP 研究 / 市场指标 / 扩词）仍完全独立于顶部项目筛选。
  // 本测试钉住两条边界：研究请求不带项目参数；GSC 区显式标注项目范围。
  it("关键词研究请求不带项目参数（SERP/指标/扩词不受顶部项目筛选）", () => {
    expect(PAGE.keywordOverview).toContain("/api/keywords/");
    const keywordCalls = [...PAGE.keywordOverview.matchAll(/fetch\(`([^`]*\/api\/keywords\/[^`]*)`/g)].map((m) => m[1]);
    expect(keywordCalls.length).toBeGreaterThan(0);
    for (const call of keywordCalls) {
      expect(call, `关键词请求不得携带项目参数: ${call}`).not.toContain("project");
    }
    // GSC 请求是唯一允许携带 project_id 的调用
    const gscCalls = [...PAGE.keywordOverview.matchAll(/fetch\(`([^`]*\/api\/gsc\/[^`]*)`/g)].map((m) => m[1]);
    for (const call of gscCalls) {
      expect(call, "GSC 请求应按当前项目读取").toContain("project_id");
    }
  });

  it("界面上明确说明关键词链路不受顶部项目筛选（避免「切了项目却没变」被当成故障）", () => {
    expect(PAGE.keywordOverview).toContain('t("scopeNote")');
  });

  it("GSC 表现区消费项目上下文时显式标注项目域名（不静默跟随）", () => {
    expect(PAGE.keywordOverview).toContain("activeProject?.activeId");
    expect(PAGE.keywordOverview).toContain("gscNotConnected");
    expect(PAGE.keywordOverview).toContain("gapDescProject");
  });
});
