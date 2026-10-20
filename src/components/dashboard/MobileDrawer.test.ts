// ===== BUG-18 回归测试：移动端抽屉关闭后必须退出焦点顺序，且能按 Escape 收起 =====
// 根因（390×844 实测）：收起的 Sidebar 只有 `-translate-x-full`，`visibility` 仍是
// visible → 进入 /app 后连按 Tab，前 10 个焦点全部落在屏外导航链接上；
// 同时抽屉只能靠点击遮罩关闭，键盘用户打开后关不掉；汉堡按钮没有 aria-expanded。
// 测试框架限制：无 @testing-library/react，按仓库惯例采用「源码契约断言」。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SIDEBAR = readFileSync(fileURLToPath(new URL("./Sidebar.tsx", import.meta.url)), "utf-8");
const TOPBAR = readFileSync(fileURLToPath(new URL("./Topbar.tsx", import.meta.url)), "utf-8");
const SHELL = readFileSync(fileURLToPath(new URL("./DashboardShell.tsx", import.meta.url)), "utf-8");

describe("BUG-18：收起的抽屉不可聚焦", () => {
  it("aside 基址含 visibility 过渡，桌面端用 lg:visible 保常驻", () => {
    expect(SIDEBAR).toMatch(/transition-\[transform,visibility\]/);
    expect(SIDEBAR).toMatch(/lg:static lg:translate-x-0 lg:visible/);
  });

  it("mobileOpen=false 分支同时加 -translate-x-full 与 invisible", () => {
    const cls = SIDEBAR.match(/mobileOpen \? "([^"]*)" : "([^"]*)"/);
    expect(cls, "找不到 aside 的 mobileOpen 三元 class").not.toBeNull();
    const closed = cls![2];
    expect(closed).toContain("-translate-x-full");
    expect(closed).toContain("invisible");
    // 展开分支不能残留 invisible
    expect(cls![1]).not.toContain("invisible");
  });
});

describe("BUG-18：汉堡按钮可感知展开状态", () => {
  it("TopbarProps 暴露 mobileMenuOpen", () => {
    expect(TOPBAR).toMatch(/interface TopbarProps \{[\s\S]*?mobileMenuOpen\?: boolean;[\s\S]*?\}/);
    expect(TOPBAR).toContain("onMobileMenuClick, mobileMenuOpen }: TopbarProps");
  });

  it("lg:hidden 汉堡按钮带 aria-expanded 与 aria-label", () => {
    const btn = TOPBAR.slice(
      TOPBAR.indexOf("{onMobileMenuClick && ("),
      TOPBAR.indexOf("</svg>")
    );
    expect(btn).toContain('className="flex h-9 w-9');
    expect(btn).toContain("lg:hidden");
    expect(btn).toContain('aria-label={t("menu")}');
    expect(btn).toContain("aria-expanded={mobileMenuOpen ?? false}");
  });

  it("DashboardShell 把 mobileNavOpen 透传给 Topbar（状态与 aria 不会脱节）", () => {
    expect(SHELL).toContain("mobileMenuOpen={mobileNavOpen}");
  });
});

describe("BUG-18：Escape 收起抽屉", () => {
  it("DashboardShell 展开期间监听 keydown，Escape 置 false，卸载时移除监听", () => {
    const eff = SHELL.slice(SHELL.indexOf("useEffect(() => {"));
    expect(eff).toContain("if (!mobileNavOpen) return;");
    expect(eff).toContain('if (e.key === "Escape") setMobileNavOpen(false);');
    expect(eff).toContain('document.addEventListener("keydown", onKey)');
    expect(eff).toContain('document.removeEventListener("keydown", onKey)');
    expect(eff).toMatch(/\}, \[mobileNavOpen\]\);/);
  });

  it("遮罩仍保留点击关闭（不能只修键盘而回退鼠标路径）", () => {
    expect(SHELL).toContain('className="fixed inset-0 z-40 bg-black/40 lg:hidden"');
    expect(SHELL).toContain("onClick={() => setMobileNavOpen(false)}");
  });
});
