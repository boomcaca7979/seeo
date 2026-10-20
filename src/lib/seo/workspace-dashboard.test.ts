// ===== /app 首页「一次队列构建 → 两套视图模型」等价性测试 =====
//
// 背景（已证实的性能回归）：/app 首页同时调用 getWorkspaceOverview 与
// getWorkspaceActionSummary，两者各自对每个域名跑一次 buildWorkQueue
// （≤5 域 × 2 遍，每遍 5 条查询）。修复后统一走 getWorkspaceDashboard，
// 同一批项目只构建一次队列。
//
// 这个文件证明"只构建一次"没有改变任何业务结果：
//   1. actionSummary 与旧入口 getWorkspaceActionSummary 深度相等（分类/排序/top 3 上限）；
//   2. overview 与旧入口 getWorkspaceOverview 深度相等（计数/任务/审计快照）；
//   3. 空项目列表仍是诚实空态，且不抛错；
//   4. 源码契约：首页只调一次 getWorkspaceDashboard，getWorkspaceDashboard 内只构建一次队列。
//
// 使用隔离临时库（与 growth-summary.test.ts 同一套做法），不触网、不碰生产库。

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import type { DashboardSnapshot } from "@/lib/seo/audit-dashboard";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-wsdash-"));
const USER = "u-wsdash";
const DOMAIN = "wsdash.test";

let projects: typeof import("@/lib/db/projects");
let audits: typeof import("@/lib/db/audits");
let queueMod: typeof import("@/lib/seo/work-queue");
let overviewMod: typeof import("@/lib/seo/workspace-overview");

beforeAll(async () => {
  process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
  process.env.TURSO_DATABASE_URL = `file://${dbDir}/test.db`;
  process.env.TURSO_AUTH_TOKEN = "test-token";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  vi.resetModules();
  projects = await import("@/lib/db/projects");
  audits = await import("@/lib/db/audits");
  queueMod = await import("./work-queue");
  overviewMod = await import("./workspace-overview");
  const db = await import("@/lib/db/migrations");
  await db.getAdapter();
});

afterAll(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

/** 最小审计快照：只填队列/概览真正读取的字段 */
function makeSnapshot(
  rules: Array<{ ruleId: string; status: "pass" | "fail"; severity?: "error" | "warning"; affectedPages?: number }>
): DashboardSnapshot {
  return {
    engineVersion: "v2",
    ruleSetVersion: "2.0",
    depth: "full",
    generatedAt: new Date().toISOString(),
    partial: false,
    pagesCrawled: 2,
    indexablePages: 2,
    score: 72,
    grade: "ok",
    rules: rules.map((r) => ({
      ruleId: r.ruleId,
      name: { en: r.ruleId, zh: r.ruleId },
      description: { en: "test rule", zh: "测试规则" },
      recommendation: { en: "fix it", zh: "修复它" },
      category: "onpage",
      severity: r.severity ?? "error",
      pageLevel: "page",
      scoreWeight: 1,
      status: r.status,
      findings: r.status === "fail" ? 2 : 0,
      affectedPages: r.affectedPages ?? (r.status === "fail" ? 2 : 0),
      affectedRatio: 0,
      scoreImpact: 0,
      sampleUrl: r.status === "fail" ? `https://${DOMAIN}/a` : null,
      sampleMessage: null,
      sampleMetrics: null,
      pattern: null,
    })),
    findings: [],
    pages: [],
    scoreBreakdown: [],
    categories: [],
    coverage: { passed: 1, failed: rules.filter((r) => r.status === "fail").length, total: rules.length, ratio: 0.5 },
    crawler: {
      pagesCrawled: 2,
      htmlPages: 2,
      redirects: 0,
      errors: 0,
      loops: 0,
      avgResponseMs: 100,
      fastestMs: 50,
      slowestMs: 200,
      httpStatus: { "2xx": 2, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 },
    },
    content: { avgWordCount: 500, lowContent: 0, veryLowContent: 0, avgTextHtmlRatio: 0.2, byType: {} },
    linking: { avgInternalLinks: 10, zeroInternalLinks: 0, deepPages: 0, orphans: 0, linksToRedirects: 0, depthDistribution: {} },
    structuredData: { statusCounts: {}, schemaTypes: {}, pagesWithSD: 0 },
    aiSearch: { crawlers: {}, llmsTxt: null, semanticHtmlAffected: 0 },
    robots: { status: "found", httpStatus: 200, sitemapUrls: [], disallowAll: false },
    sitemap: null,
  } as unknown as DashboardSnapshot;
}

describe("getWorkspaceDashboard：一次队列构建产出两套视图模型", () => {
  it("actionSummary 与旧入口 getWorkspaceActionSummary 深度相等（分类/排序/上限不变）", async () => {
    const project = await projects.addProject(USER, "WS Dash", DOMAIN);
    const scoped = [{ id: Number(project.id), domain: DOMAIN }];

    const audit = await audits.createAudit(USER, DOMAIN, "full");
    await audits.finishAudit(USER, audit.id, {
      health_score: 72,
      errors: 1,
      warnings: 1,
      notices: 0,
      dashboard_json: JSON.stringify(
        makeSnapshot([
          { ruleId: "title-missing", status: "fail", severity: "error" },
          { ruleId: "h1-missing", status: "fail", severity: "warning" },
          { ruleId: "canonical-ok", status: "pass" },
        ])
      ),
    });

    const dashboard = await overviewMod.getWorkspaceDashboard(USER, scoped);
    const legacyAction = await queueMod.getWorkspaceActionSummary(USER, [DOMAIN], scoped);

    // 完整深度比较：任何分类、排序、数量、gaps 的差异都会在这里暴露
    expect(dashboard.actionSummary).toEqual(legacyAction);
    // 数据确实非空（防止两边都是空态导致"假相等"）
    expect(dashboard.actionSummary.auditedDomains).toBe(1);
    expect(dashboard.actionSummary.open).toBeGreaterThan(0);
    expect(dashboard.actionSummary.topAction).not.toBeNull();
  });

  it("overview 与旧入口 getWorkspaceOverview 深度相等", async () => {
    const scoped = [{ id: Number((await projects.getProjectByDomain(USER, DOMAIN))!.id), domain: DOMAIN }];
    const dashboard = await overviewMod.getWorkspaceDashboard(USER, scoped);
    const legacyOverview = await overviewMod.getWorkspaceOverview(USER, scoped);
    expect(dashboard.overview).toEqual(legacyOverview);
    expect(dashboard.overview.hasAudit).toBe(true);
    expect(dashboard.overview.audit?.domain).toBe(DOMAIN);
  });

  it("空项目列表：不构建队列、不抛错，返回诚实空态", async () => {
    const dashboard = await overviewMod.getWorkspaceDashboard("u-wsdash-empty", []);
    expect(dashboard.overview.hasProjects).toBe(false);
    expect(dashboard.overview.hasAudit).toBe(false);
    expect(dashboard.overview.tasks).toEqual([]);
    expect(dashboard.actionSummary.open).toBe(0);
    expect(dashboard.actionSummary.topAction).toBeNull();
    expect(dashboard.actionSummary.growth.top).toEqual([]);
  });
});

describe("源码契约：首页只构建一次工作队列", () => {
  const PAGE_SRC = readFileSync(
    fileURLToPath(new URL("../../app/(default)/(dashboard)/app/page.tsx", import.meta.url)),
    "utf-8"
  );
  const OVERVIEW_SRC = readFileSync(fileURLToPath(new URL("./workspace-overview.ts", import.meta.url)), "utf-8");

  it("首页不再分别调用 getWorkspaceOverview / getWorkspaceActionSummary", () => {
    expect(PAGE_SRC).not.toContain("getWorkspaceOverview(");
    expect(PAGE_SRC).not.toContain("getWorkspaceActionSummary(");
    // 唯一入口：getWorkspaceDashboard，并且只被调用一次（demo 与 live 各一条分支）
    const calls = PAGE_SRC.match(/loadDashboardData\(/g) ?? [];
    expect(calls.length).toBe(3); // 定义 1 次 + 两个分支各调用 1 次
  });

  it("getWorkspaceDashboard 只调用一次 buildWorkspaceQueues（overview 与 summary 共用）", () => {
    const start = OVERVIEW_SRC.indexOf("export async function getWorkspaceDashboard");
    expect(start).toBeGreaterThan(-1);
    const body = OVERVIEW_SRC.slice(start, OVERVIEW_SRC.indexOf("async function buildOverviewFromQueues"));
    expect(body.match(/buildWorkspaceQueues\(/g)?.length).toBe(1);
    expect(body).toContain("summarizeActionQueues(queues)");
    expect(body).toContain("buildOverviewFromQueues(userId, scoped, queues)");
  });
});
