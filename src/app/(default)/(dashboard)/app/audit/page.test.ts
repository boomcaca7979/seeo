// ===== BUG-001 回归测试：「快速审计」按钮点击无反应 =====
// 根因：print header 在 audit=null（首次加载、SSR 阶段）渲染 new Date().toISOString() 时间文本，
// 服务端渲染时刻与客户端 hydration 时刻必然不同 → hydration mismatch →
// React 18 生产模式丢弃整棵 SSR 树并客户端重新渲染 → 重渲染窗口内页面事件未挂载，
// 点击「快速审计」无网络请求 / 无 DOM 变化 / 无报错（生产 bundle 大 + 慢网络时窗口可达数秒，稳定复现）。
// 修复：print header <h1> 加 suppressHydrationWarning；按钮禁用态补 title 提示（禁用不再静默）。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE_SRC = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");
const EN = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../../messages/en.json", import.meta.url)), "utf-8"));
const ZH = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../../../messages/zh.json", import.meta.url)), "utf-8"));

describe("BUG-001：audit 页 hydration 安全与快速审计按钮反馈", () => {
  it("print header 的 SSR 动态时间（new Date()）必须带 suppressHydrationWarning，防止整树客户端重渲染导致事件窗口期失活", () => {
    const h1Match = PAGE_SRC.match(/<h1[^>]*suppressHydrationWarning[^>]*>/);
    expect(h1Match).toBeTruthy();
    // 该 h1 内确实渲染动态时间（mismatch 风险源）
    const h1Block = PAGE_SRC.slice(PAGE_SRC.indexOf("suppressHydrationWarning"), PAGE_SRC.indexOf("suppressHydrationWarning") + 400);
    expect(h1Block).toContain("formatTime");
    expect(h1Block).toContain("new Date().toISOString()");
  });

  it("「快速审计」按钮绑定 openConfirm('quick')，disabled 条件为 auditing||starting，且禁用时有 title 提示（不静默）", () => {
    const btnMatch = PAGE_SRC.match(
      /<button\s+onClick=\{\(\) => openConfirm\("quick"\)\}\s+disabled=\{auditing \|\| starting\}\s+title=\{auditing \|\| starting \? t\("auditInProgress"\) : undefined\}/
    );
    expect(btnMatch).toBeTruthy();
  });

  it("auditInProgress 提示文案 en/zh 双语齐备", () => {
    expect(typeof EN.dashboard.audit.auditInProgress).toBe("string");
    expect(typeof ZH.dashboard.audit.auditInProgress).toBe("string");
    expect(ZH.dashboard.audit.auditInProgress.length).toBeGreaterThan(0);
    expect(EN.dashboard.audit.auditInProgress.length).toBeGreaterThan(0);
  });
});
