// ===== BUG-24 / BUG-25：弹层与下拉的无障碍语义契约 =====
// 实测入口（浏览器点击，见 acceptance 报告）：i1-overview 在 /app 打开「新建项目」后
// document.querySelector('[role=dialog]') 为 null、焦点仍在 BODY —— 整站在这一轮之前
// 没有任何一个弹层带 dialog 语义，Topbar 三个下拉也既没有开合状态、也关不掉。
// 本仓库 node 环境无 RTL，按既有 source-contract 约定断言"实现必须长这样"。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const MODAL = read("src/components/dashboard/Modal.tsx");
const UPGRADE = read("src/components/billing/UpgradeModal.tsx");
const REPORTS = read("src/app/(default)/(dashboard)/app/reports/page.tsx");
const COMPETITORS = read("src/app/(default)/(dashboard)/app/competitors/page.tsx");
const TOPBAR = read("src/components/dashboard/Topbar.tsx");
const HOOK = read("src/lib/useDialogA11y.ts");

describe("1. 共享 hook：焦点进入 / Tab 循环 / 归还焦点 / 只服务最上层弹层", () => {
  it("挂载即聚焦面板首个可聚焦元素，卸载后把焦点还给触发元素", () => {
    expect(HOOK).toContain("(items()[0] ?? panel)?.focus();");
    expect(HOOK).toContain("if (opener && opener !== document.body) opener.focus();");
  });

  it("Escape 与 Tab 都由 hook 统一处理，且弹层叠加时只认最上层（避免一次 Esc 关掉整叠弹层）", () => {
    expect(HOOK).toContain('if (e.key === "Escape")');
    expect(HOOK).toContain('if (e.key !== "Tab") return;');
    expect(HOOK).toContain("const isTop = () => stack[stack.length - 1] === entry;");
    expect(HOOK).toContain("if (!isTop()) return;");
  });

  it("onClose 走 ref：父组件重渲染不得把焦点从正在输入的框抢走", () => {
    expect(HOOK).toContain("closeRef.current = onClose;");
    expect(HOOK).toMatch(/\}, \[open\]\);/);
  });
});

describe("2. Modal / UpgradeModal：dialog 语义齐备", () => {
  for (const [name, src] of [["Modal", MODAL], ["UpgradeModal", UPGRADE]]) {
    it(`${name} 面板带 role=dialog / aria-modal / aria-labelledby，并挂 useDialogA11y`, () => {
      expect(src).toContain('role="dialog"');
      expect(src).toContain('aria-modal="true"');
      expect(src).toContain("aria-labelledby={");
      expect(src).toContain("useDialogA11y(");
      expect(src).toContain("tabIndex={-1}");
      expect(src).toContain("<h3 id={");
    });
  }

  it("不再各自留一份 Escape 监听（统一由 hook 处理，避免重复关闭与叠层抢事件）", () => {
    expect(MODAL).not.toContain('e.key === "Escape"');
    expect(UPGRADE).not.toContain('e.key === "Escape"');
  });
});

describe("3. 页面内自绘浮层也补齐（reports 预览 / 邮件弹窗 / 竞品删除确认）", () => {
  it("reports 两个浮层各挂一次 hook、各有一个 dialog 面板", () => {
    expect(REPORTS.match(/useDialogA11y\(/g)).toHaveLength(2);
    expect(REPORTS.match(/role="dialog"/g)).toHaveLength(2);
    expect(REPORTS).toContain("useDialogA11y(previewOpen, handleClosePreview)");
  });

  it("竞品的删除二次确认不再是无语义遮层", () => {
    expect(COMPETITORS).toContain("useDialogA11y(deleteId !== null");
    expect(COMPETITORS).toContain('role="dialog"');
  });
});

describe("4. Topbar 下拉：开合状态可读、Esc 可关", () => {
  it("三个触发按钮都报 aria-expanded + aria-controls（读屏才知道面板开没开）", () => {
    expect(TOPBAR.match(/aria-expanded=\{(projectOpen|bellOpen|userMenuOpen)\}/g)).toHaveLength(3);
    expect(TOPBAR.match(/aria-haspopup="true"/g)).toHaveLength(3);
    expect(TOPBAR.match(/aria-controls=\{(projectOpen|bellOpen|userMenuOpen) \? \w+PanelId : undefined\}/g)).toHaveLength(3);
  });

  it("三个面板都有 id + role=group + 标签，供 aria-controls 指向", () => {
    for (const id of ["projectPanelId", "bellPanelId", "userMenuPanelId"]) {
      expect(TOPBAR).toContain(`const ${id} = useId();`);
      expect(TOPBAR).toContain(`id={${id}}`);
    }
    expect(TOPBAR.match(/role="group"/g)).toHaveLength(3);
  });

  it("Esc 收起下拉（此前只能点外面关闭）", () => {
    expect(TOPBAR).toContain('if (e.key !== "Escape") return;');
    expect(TOPBAR).toContain("setUserMenuOpen(false);");
  });

  it("项目切换器与用户菜单的触发按钮有无障碍名称（原先只有头像/字母）", () => {
    expect(TOPBAR).toContain("aria-label={displayName}");
  });
});

describe("5. position-tracking 行内「+ 分组」弹层（BUG-31）", () => {
  const PT = read("src/app/(default)/(dashboard)/app/position-tracking/page.tsx");

  it("触发按钮报开合状态，弹层有 role=group 与标签", () => {
    expect(PT).toContain('aria-haspopup="true"');
    expect(PT).toContain("aria-expanded={groupMenuId === row.id}");
    expect(PT).toContain('role="group"');
    expect(PT).toContain("aria-label={t(\"addToGroup\")}");
  });

  it("Esc 可关闭，且卸载同时移除 click / keydown 两个监听", () => {
    expect(PT).toContain('if (e.key === "Escape") setGroupMenuId(null);');
    expect(PT).toContain("document.addEventListener(\"keydown\", onKey);");
    expect(PT).toContain("document.removeEventListener(\"keydown\", onKey);");
  });

  it("弹层内点击不冒泡到 window，否则选分组会先把弹层关掉", () => {
    expect(PT).toContain("onClick={(e) => e.stopPropagation()}");
  });
});
