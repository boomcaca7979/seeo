// ===== /app 首屏取数顺序契约（2026-10-21 登录后等待）=====
//
// 背景：登录成功后用户要等约 10 秒才看到工作台，而这段时间登录页仍挂载。
// 结构层面可证的一部分是「串行往返堆叠」：/app 渲染链上有多个互不依赖的读取
// 被写成连续 `await`，在「远程 Supabase + 远程 Turso」下每个往返都直接叠加进
// 用户等待的空白里。
//
// 本文件只钉住两件事：
//   1. 互不依赖的三个读取（告警列表、未读数、概览+队列）在同一次 Promise.all 里发起；
//   2. 有真实依赖的链路（会话 → 项目 → 指标 → 队列）保持原顺序，不做投机并行。
// 它不证明生产端到端耗时下降——那需要真实登录后的浏览器时间线，见交付报告。

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE = readFileSync(fileURLToPath(new URL("./page.tsx", import.meta.url)), "utf-8");

describe("互不依赖的读取合并发起", () => {
  it("告警、未读数、概览队列在同一个 Promise.all 里", () => {
    expect(PAGE).toContain("const [alerts, unread, dashboard] = await Promise.all([");
    const block = PAGE.slice(
      PAGE.indexOf("const [alerts, unread, dashboard] = await Promise.all(["),
    ).slice(0, 400);
    expect(block).toContain("listAlerts(userId, 50)");
    expect(block).toContain("countUnreadAlerts(userId)");
    expect(block).toContain("loadDashboardData(userId, scopedProjects)");
  });

  it("鉴权分支的旧串行写法不再出现（回归即失败）", () => {
    // 演示分支（demo-user / 本地 SQLite）不在登录链路上，保持原样
    expect(PAGE).not.toMatch(/const alerts = await listAlerts\(userId/);
    expect(PAGE).not.toMatch(/const unread = await countUnreadAlerts\(userId/);
    expect(PAGE).not.toMatch(/const dashboard = await loadDashboardData\(userId/);
  });
});

describe("有依赖的链路保持串行", () => {
  it("会话 → 项目 → 指标 → 队列：依赖顺序不变", () => {
    const sessionIdx = PAGE.indexOf("const session = await getDashboardSession();");
    const projectsIdx = PAGE.indexOf('.from("projects")');
    const metricsIdx = PAGE.indexOf("listProjectsWithMetricsForUser(");
    const queueIdx = PAGE.indexOf("loadDashboardData(userId, scopedProjects)");
    expect(sessionIdx).toBeGreaterThan(-1);
    expect(projectsIdx).toBeGreaterThan(sessionIdx);
    expect(metricsIdx).toBeGreaterThan(projectsIdx);
    expect(queueIdx).toBeGreaterThan(metricsIdx);
  });

  it("并行不改变失败语义：项目为空仍先回 Onboarding，不进入取数", () => {
    const emptyIdx = PAGE.indexOf("if (projects.length === 0) {");
    const parallelIdx = PAGE.indexOf("const [alerts, unread, dashboard] = await Promise.all([");
    expect(emptyIdx).toBeGreaterThan(-1);
    expect(emptyIdx).toBeLessThan(parallelIdx);
  });
});

describe("会话校验没有被削弱", () => {
  it("/app 仍然在页面层校验会话，故障即登出", () => {
    expect(PAGE).toContain("const session = await getDashboardSession();");
    expect(PAGE).toContain("if (!session.userId) {");
    expect(PAGE).toContain("session.authUnavailable ? \"&auth=unavailable\" : \"\"");
  });

  it("未登录 / 上游不可用的重定向目标未被改动", () => {
    expect(PAGE).toContain("`/login?redirect=${encodeURIComponent(\"/app\")}");
  });
});
