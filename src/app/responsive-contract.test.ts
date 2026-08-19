// ===== 响应式布局 contract 测试 =====
// 目标 B（大屏自适应 + 移动端不溢出）的源码级契约：
// 1. 全局容器系统（site-shell / dash-container / doc-shell）在 ≥1536px 放宽 max-width
// 2. 大屏根字号等比缩放（≥1920 → 17px，≥2560 → 18px，有上限）
// 3. Dashboard 页面统一使用 dash-container，不再残留固定 max-w-7xl 容器
// 4. 营销页结构组件统一使用 site-shell
// 5. Sidebar 移动端为抽屉（<lg 隐藏 + 抽屉位移），Topbar 有 <lg 汉堡按钮
// 6. 全站文字大小使用 rem（text-[Npx] 清零），随根字号等比缩放
// 7. 关键数据表格包裹 overflow-x-auto（小屏横向滚动而非撑破页面）

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf-8");

const GLOBALS = read("src/app/globals.css");

function collectFiles(dir: string, exts: string[], acc: string[] = []): string[] {
  const abs = path.join(ROOT, dir);
  for (const name of readdirSync(abs)) {
    const full = path.join(abs, name);
    if (statSync(full).isDirectory()) {
      collectFiles(path.relative(ROOT, full), exts, acc);
    } else if (exts.some((e) => name.endsWith(e))) {
      acc.push(full);
    }
  }
  return acc;
}

describe("全局容器与字号系统（globals.css）", () => {
  it("定义 site-shell / dash-container / doc-shell，且 ≥96rem（1536px）放宽 max-width", () => {
    expect(GLOBALS).toMatch(/\.site-shell\s*\{[^}]*max-width:\s*80rem/);
    expect(GLOBALS).toMatch(/\.dash-container\s*\{[^}]*max-width:\s*80rem/);
    expect(GLOBALS).toMatch(/\.doc-shell\s*\{[^}]*max-width:\s*56rem/);
    // 2xl 档放宽：site-shell 90rem(1440px)、dash-container 100rem(1600px)、doc-shell 72rem(1152px)
    const siteBlock = GLOBALS.slice(GLOBALS.indexOf(".site-shell"), GLOBALS.indexOf(".dash-container"));
    expect(siteBlock).toMatch(/@media \(min-width: 96rem\)\s*\{\s*\.site-shell \{ max-width: 90rem; \}/);
    const dashBlock = GLOBALS.slice(GLOBALS.indexOf(".dash-container"), GLOBALS.indexOf(".doc-shell"));
    expect(dashBlock).toMatch(/@media \(min-width: 96rem\)\s*\{\s*\.dash-container \{ max-width: 100rem; \}/);
    const docBlock = GLOBALS.slice(GLOBALS.indexOf(".doc-shell"));
    expect(docBlock).toMatch(/@media \(min-width: 96rem\)\s*\{\s*\.doc-shell \{ max-width: 72rem; \}/);
  });

  it("大屏根字号等比缩放：≥120rem(1920px) → 17px，≥160rem(2560px) → 18px（有上限，不无限放大）", () => {
    expect(GLOBALS).toMatch(/@media \(min-width: 120rem\)\s*\{\s*html \{ font-size: 17px; \}/);
    expect(GLOBALS).toMatch(/@media \(min-width: 160rem\)\s*\{\s*html \{ font-size: 18px; \}/);
  });
});

describe("Dashboard 页面容器契约", () => {
  const dashDir = "src/app/(default)/(dashboard)/app";
  const pages = collectFiles(dashDir, [".tsx"]).filter((f) => /page\.tsx$/.test(f));

  it("dashboard 目录下存在待检页面", () => {
    expect(pages.length).toBeGreaterThanOrEqual(10);
  });

  it("所有 dashboard page 使用 dash-container（不残留 mx-auto max-w-7xl 固定容器）", () => {
    let withContainer = 0;
    for (const f of pages) {
      const src = readFileSync(f, "utf-8");
      expect(src.includes("mx-auto max-w-7xl"), `${path.relative(ROOT, f)} 残留 max-w-7xl 固定容器`).toBe(false);
      if (src.includes("dash-container")) {
        withContainer++;
        continue;
      }
      // 未直接使用 dash-container 的页面不得自渲染固定宽度容器（委派给 ProjectList/Onboarding 等组件）
      // 例外：reports/audit 打印视图与 rank-check 表单页有意保持较窄阅读宽度（max-w-5xl）
      const narrowAllowed = /reports\/audit|rank-check/.test(path.relative(ROOT, f));
      if (!narrowAllowed) {
        expect(src).not.toMatch(/mx-auto max-w-\dxl/);
      }
    }
    // 至少 10 个页面直接使用响应式容器（覆盖全部数据页）
    expect(withContainer).toBeGreaterThanOrEqual(10);
    // 承担 /app 渲染的共享组件也使用 dash-container
    expect(read("src/components/dashboard/ProjectList.tsx")).toContain("dash-container");
    expect(read("src/components/dashboard/Onboarding.tsx")).toContain("dash-container");
    expect(read("src/components/dashboard/PlaceholderPage.tsx")).toContain("dash-container");
  });
});

describe("营销页结构组件容器契约", () => {
  const shellComponents = [
    "src/components/Navbar.tsx",
    "src/components/Hero.tsx",
    "src/components/FeatureCards.tsx",
    "src/components/DashboardPreview.tsx",
    "src/components/Footer.tsx",
  ];
  it("Navbar/Hero/FeatureCards/DashboardPreview/Footer 使用 site-shell", () => {
    for (const p of shellComponents) {
      const src = read(p);
      expect(src.includes("site-shell"), `${p} 应使用 site-shell`).toBe(true);
      expect(src.includes("max-w-7xl"), `${p} 残留 max-w-7xl`).toBe(false);
    }
  });
});

describe("移动端抽屉导航契约", () => {
  it("Sidebar：<lg 为 fixed 抽屉（默认 -translate-x-full），≥lg 常驻（lg:static lg:translate-x-0）", () => {
    const src = read("src/components/dashboard/Sidebar.tsx");
    expect(src).toContain("fixed inset-y-0 left-0 z-50");
    expect(src).toContain("-translate-x-full");
    expect(src).toContain("lg:static lg:translate-x-0");
    expect(src).toContain("transition-transform duration-150"); // 动效 ≤150ms
  });

  it("Topbar：有 <lg 汉堡按钮（lg:hidden）并通过 onMobileMenuClick 打开抽屉", () => {
    const src = read("src/components/dashboard/Topbar.tsx");
    expect(src).toContain("onMobileMenuClick");
    expect(src).toMatch(/lg:hidden[^"]*"/);
  });

  it("DashboardShell：管理 mobileNavOpen 状态 + lg:hidden 遮罩 backdrop", () => {
    const src = read("src/components/dashboard/DashboardShell.tsx");
    expect(src).toContain("mobileNavOpen");
    expect(src).toContain("fixed inset-0 z-40 bg-black/40 lg:hidden");
  });

  it("topbar.menu 文案 en/zh 双语齐备", () => {
    const EN = JSON.parse(read("messages/en.json"));
    const ZH = JSON.parse(read("messages/zh.json"));
    expect(EN.dashboard.topbar.menu.length).toBeGreaterThan(0);
    expect(ZH.dashboard.topbar.menu.length).toBeGreaterThan(0);
  });
});

describe("全站字号 rem 化（随根字号等比缩放）", () => {
  it("tsx 源码中不再出现 text-[Npx] 像素字号", () => {
    const files = collectFiles("src", [".tsx"]);
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      const m = src.match(/text-\[\d+(\.\d+)?px\]/g);
      if (m) offenders.push(`${path.relative(ROOT, f)}: ${m.join(", ")}`);
    }
    expect(offenders, `像素字号残留：\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("表格横向滚动契约", () => {
  const tablePages = [
    "src/app/(default)/(dashboard)/app/audit/page.tsx",
    "src/app/(default)/(dashboard)/app/position-tracking/page.tsx",
    "src/app/(default)/(dashboard)/app/backlinks/page.tsx",
    "src/app/(default)/(dashboard)/app/keyword-overview/page.tsx",
  ];
  it("关键数据页表格均包裹 overflow-x-auto（小屏滚动而非撑破容器）", () => {
    for (const p of tablePages) {
      const src = read(p);
      expect(src.includes("overflow-x-auto"), `${p} 缺少 overflow-x-auto 表格容器`).toBe(true);
    }
  });
});
