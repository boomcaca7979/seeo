// ===== F1：Topbar「+ 新建项目」真实创建入口测试 =====
// 根因：原「+ 新建项目」为 <Link href="/app">，点击仅重新导航 /app，静默无响应。
// 修复：改为 button，接入共享 CreateProjectContext（openCreateProject），并做额度校验：
//   - projects.length < max_projects → openCreateProject()（打开创建 Modal）
//   - projects.length >= max_projects → triggerUpgradeModal()（额度/升级提示）
// 禁止：href="/app"、重新跳转 /app、silent no-op。
// 测试框架限制：无 @testing-library/react，按仓库惯例采用「源码契约断言」。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(fileURLToPath(new URL("./Topbar.tsx", import.meta.url)), "utf-8");
const PROJECT_LIST_SRC = readFileSync(
  fileURLToPath(new URL("./ProjectList.tsx", import.meta.url)),
  "utf-8"
);
const CTX_SRC = readFileSync(
  fileURLToPath(new URL("./CreateProjectContext.tsx", import.meta.url)),
  "utf-8"
);
const SHELL_SRC = readFileSync(
  fileURLToPath(new URL("./DashboardShell.tsx", import.meta.url)),
  "utf-8"
);

describe("F1：Topbar「+ 新建项目」不再是导航链接", () => {
  it("「+ 新建项目」是 button（onClick={handleNewProject}），不是 <Link href=\"/app\">", () => {
    expect(SRC).toContain("onClick={handleNewProject}");
    const btnIdx = SRC.indexOf("onClick={handleNewProject}");
    const slice = SRC.slice(btnIdx, btnIdx + 400);
    expect(slice).not.toContain("href=");
    expect(slice).toContain('{t("newProject")}');
  });

  it("handleNewProject 先关闭项目下拉（setProjectOpen(false)），不触发 /app 导航", () => {
    expect(SRC).toContain("const handleNewProject = () => {");
    expect(SRC).toContain("setProjectOpen(false);");
    const fnStart = SRC.indexOf("const handleNewProject = () => {");
    const fnEnd = SRC.indexOf("const handleLogout", fnStart);
    const fnBody = SRC.slice(fnStart, fnEnd);
    expect(fnBody).not.toContain("href=");
    expect(fnBody).not.toMatch(/push\(["'`]\/app/);
    expect(fnBody).not.toMatch(/assign\(["'`]\/app/);
  });
});

describe("F1：共享 create-project trigger", () => {
  it("Topbar 导入并使用共享 useCreateProject（openCreateProject）", () => {
    expect(SRC).toContain('import { useCreateProject } from "@/components/dashboard/CreateProjectContext";');
    expect(SRC).toContain("const { openCreateProject } = useCreateProject();");
  });

  it("ProjectList 复用同一 openCreateProject（不再有自己的 setModalOpen/handleCreate/创建 Modal）", () => {
    expect(PROJECT_LIST_SRC).toContain('import { useCreateProject } from "@/components/dashboard/CreateProjectContext";');
    expect(PROJECT_LIST_SRC).toContain("const { openCreateProject } = useCreateProject();");
    expect(PROJECT_LIST_SRC).toContain("onClick={openCreateProject}");
    expect(PROJECT_LIST_SRC).not.toContain("setModalOpen");
    expect(PROJECT_LIST_SRC).not.toContain('id="new-project-form"');
    expect(PROJECT_LIST_SRC).not.toContain("handleCreate");
  });

  it("CreateProjectContext 提供唯一创建流程（openCreateProject + Modal + POST /api/projects）", () => {
    expect(CTX_SRC).toContain("openCreateProject");
    expect(CTX_SRC).toContain('id="new-project-form"');
    expect(CTX_SRC).toContain('fetch("/api/projects"');
  });

  it("DashboardShell 用 CreateProjectProvider 包装（Topbar/ProjectList 共享上下文）", () => {
    expect(SHELL_SRC).toContain("<CreateProjectProvider>");
  });
});

describe("F1：额度分支（未达额度→Modal，达额度→升级提示）", () => {
  it("未达额度：projects.length < max_projects 时 openCreateProject()（打开创建 Modal）", () => {
    expect(SRC).toContain("if (maxProjects !== null && projects.length >= maxProjects)");
    expect(SRC).toContain("openCreateProject();");
  });

  it("达额度：触发 triggerUpgradeModal（含 currentPlan/limit/used），显示额度升级提示", () => {
    expect(SRC).toContain("triggerUpgradeModal({");
    expect(SRC).toContain("currentPlan,");
    expect(SRC).toContain("limit: maxProjects");
    expect(SRC).toContain("used: projects.length");
  });

  it("达额度时错误码为 PROJECT_LIMIT_REACHED 且走 locale 文案（resolveApiErrorMessage）", () => {
    expect(SRC).toContain('code: "PROJECT_LIMIT_REACHED"');
    expect(SRC).toContain('import { resolveApiErrorMessage } from "@/lib/billing-error-client";');
  });

  it("不允许 silent no-op：两分支必然落点 openCreateProject 或 triggerUpgradeModal", () => {
    const fnStart = SRC.indexOf("const handleNewProject = () => {");
    const fnEnd = SRC.indexOf("const handleLogout", fnStart);
    const fnBody = SRC.slice(fnStart, fnEnd);
    expect(fnBody).toContain("triggerUpgradeModal({");
    expect(fnBody).toContain("openCreateProject();");
    expect(fnBody.indexOf("return;")).toBeGreaterThan(-1);
  });

  it("max_projects 从 EntitlementsContext 单一数据源读取（context 内 fetch /api/account/usage，Topbar 不重复请求）", () => {
    // Topbar 通过 useEntitlements() 读取 plan + limits（不再自行 fetch，避免 3× 重复请求）
    expect(SRC).toContain("useEntitlements()");
    expect(SRC).toContain("entitlementLimits?.max_projects");
    expect(SRC).not.toContain('fetch("/api/account/usage"');
    // Provider 内仍以真实 usage API 为数据源
    const ctxSrc = readFileSync(fileURLToPath(new URL("../billing/EntitlementsContext.tsx", import.meta.url)), "utf-8");
    expect(ctxSrc).toContain('fetch("/api/account/usage"');
    expect(ctxSrc).toContain("max_projects");
    // 不允许硬编码额度
    expect(SRC).not.toMatch(/maxProjects\s*=\s*2\b/);
  });

  it("下拉打开时刷新项目列表（loadProjects），避免创建/删除后额度校验用旧数据", () => {
    expect(SRC).toContain("const loadProjects = useCallback(async () => {");
    expect(SRC).toContain("if (!projectOpen) void loadProjects();");
    expect(SRC).toMatch(/useEffect\(\(\) => \{\s*void \(async \(\) => \{ await loadProjects\(\); \}\)\(\);\s*\}, \[loadProjects\]\);/);
  });
});