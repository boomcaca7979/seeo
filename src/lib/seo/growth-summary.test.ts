// ===== 增长机会集成测试（隔离临时库，真实 scanner 链路，无网络/无生产依赖）=====
//
// 验证「第一刀」产品改造的两个关键承诺：
//   1. 审计完成后自动生成机会（autoScanOpportunitiesAfterAudit）：
//      复用现有 scanner；真实排名历史 → lost_recovery 机会被自动创建；
//      重复扫描被 fingerprint 抑制（不重复造机会）；失败/无项目时静默（不影响审计）。
//   2. 工作区摘要的价值分层（getWorkspaceActionSummary.growth）：
//      lost_recovery → regain 出现在增长机会首位；技术问题绝不进入增长层；
//      topAction 与队列首个 open 任务仍同源（无第二套任务系统）。
//      机会卡 CTA 深链必须携带机会上下文（from/otype/otitle/otitlezh/oreason）。

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DashboardSnapshot } from "@/lib/seo/audit-dashboard";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-growth-"));
const USER = "u-growth";
const DOMAIN = "growth.test";

let projects: typeof import("@/lib/db/projects");
let keywords: typeof import("@/lib/db/keywords");
let rankings: typeof import("@/lib/db/rankings");
let audits: typeof import("@/lib/db/audits");
let trigger: typeof import("./audit-opportunity-trigger");
let queueMod: typeof import("./work-queue");

beforeAll(async () => {
  process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
  process.env.TURSO_DATABASE_URL = `file://${dbDir}/test.db`;
  process.env.TURSO_AUTH_TOKEN = "test-token";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  vi.resetModules();
  projects = await import("@/lib/db/projects");
  keywords = await import("@/lib/db/keywords");
  rankings = await import("@/lib/db/rankings");
  audits = await import("@/lib/db/audits");
  trigger = await import("./audit-opportunity-trigger");
  queueMod = await import("./work-queue");
  const db = await import("@/lib/db/migrations");
  await db.getAdapter();
});

afterAll(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/** 最小审计快照（只含队列真正读取的字段） */
function makeSnapshot(
  rules: Array<{ ruleId: string; status: "pass" | "fail"; severity?: "error" | "warning"; findings?: number; affectedPages?: number; affectedRatio?: number; scoreImpact?: number; pattern?: "site-wide" | "repeated" | null; pageLevel?: "page" | "site"; sampleUrl?: string | null }>
): DashboardSnapshot {
  return {
    engineVersion: "v2",
    ruleSetVersion: "2.0",
    depth: "full",
    generatedAt: new Date().toISOString(),
    partial: false,
    pagesCrawled: 3,
    indexablePages: 3,
    score: 80,
    grade: "good",
    rules: rules.map((r) => ({
      ruleId: r.ruleId,
      name: { en: r.ruleId, zh: r.ruleId },
      description: { en: "test rule", zh: "测试规则" },
      recommendation: { en: "fix it", zh: "修复它" },
      category: "onpage",
      severity: r.severity ?? "error",
      pageLevel: r.pageLevel ?? "page",
      scoreWeight: 1,
      status: r.status,
      findings: r.findings ?? 0,
      affectedPages: r.affectedPages ?? 0,
      affectedRatio: r.affectedRatio ?? 0,
      scoreImpact: r.scoreImpact ?? 0,
      sampleUrl: r.sampleUrl ?? null,
      sampleMessage: null,
      sampleMetrics: null,
      pattern: r.pattern ?? null,
    })),
    findings: [],
    pages: [],
    scoreBreakdown: [],
    categories: [],
    coverage: { passed: 1, failed: rules.filter((r) => r.status === "fail").length, total: rules.length, ratio: 0.5 },
    crawler: {
      pagesCrawled: 3, htmlPages: 3, redirects: 0, errors: 0, loops: 0, avgResponseMs: 100,
      fastestMs: 50, slowestMs: 200, httpStatus: { "2xx": 3, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 },
    },
    content: { avgWordCount: 500, lowContent: 0, veryLowContent: 0, avgTextHtmlRatio: 0.2, byType: {} },
    linking: { avgInternalLinks: 10, zeroInternalLinks: 0, deepPages: 0, orphans: 0, linksToRedirects: 0, depthDistribution: {} },
    structuredData: { statusCounts: {}, schemaTypes: {}, pagesWithSD: 0 },
    aiSearch: { crawlers: {}, llmsTxt: null, semanticHtmlAffected: 0 },
    robots: { status: "found", httpStatus: 200, sitemapUrls: [], disallowAll: false },
    sitemap: null,
  } as unknown as DashboardSnapshot;
}

describe("审计完成后的自动机会扫描（复用现有 scanner，fire-and-forget）", () => {
  it("真实排名历史（曾 #1 → 现未进榜）→ 自动创建 lost_recovery 机会", async () => {
    const project = await projects.addProject(USER, "Growth Test", DOMAIN);
    const kw = await keywords.addTrackedKeyword(USER, { keyword: "ai生成视频", location: "中国", device: "PC", domain: DOMAIN });
    await rankings.upsertRankHistory(USER, { keyword_id: kw.id, date: daysAgo(20), position: 1, url: `https://${DOMAIN}/a` });
    await rankings.upsertRankHistory(USER, { keyword_id: kw.id, date: daysAgo(1), position: null, url: null });

    // 不抛错（graceful），且机会确实被创建
    await expect(trigger.autoScanOpportunitiesAfterAudit(USER, "free", DOMAIN)).resolves.toBeUndefined();

    const summary = await queueMod.getWorkspaceActionSummary(USER, [DOMAIN], [
      { id: Number(project.id), domain: DOMAIN },
    ]);
    expect(summary.growth.counts.regain).toBeGreaterThanOrEqual(1);
    const top = summary.growth.top[0];
    expect(top).toBeTruthy();
    expect(top!.valueCategory).toBe("regain");
    expect(top!.type).toBe("lost_recovery");
    expect(top!.target).toBe("ai生成视频");
    // WHAT/WHY/EVIDENCE/ACTION 四要素齐备：证据来自真实排名历史
    expect(top!.evidence.length).toBeGreaterThan(0);
    expect(top!.reasonCodes.length).toBeGreaterThan(0);
    // CTA 携带机会上下文（执行页据此显示"你为什么来到这里"）
    expect(top!.execution.available).toBe(true);
    expect(top!.execution.href).toContain("/app/keyword-overview");
    expect(top!.execution.href).toContain("from=opportunity");
    expect(top!.execution.href).toContain("otype=lost_recovery");
    expect(top!.execution.href).toContain("otitlezh=");
    // 双语推荐语随行（UI 按 locale 渲染 WHAT）
    expect(top!.recommendationI18n?.en).toContain("ai生成视频");
    expect(top!.recommendationI18n?.zh).toContain("ai生成视频");
  });

  it("重复扫描被 fingerprint 抑制：不重复造机会（幂等）", async () => {
    await trigger.autoScanOpportunitiesAfterAudit(USER, "free", DOMAIN);
    const summary = await queueMod.getWorkspaceActionSummary(USER, [DOMAIN], [
      { id: 1, domain: DOMAIN },
    ]);
    expect(summary.growth.counts.regain).toBe(1);
  });

  it("无项目的域名 → 静默跳过（不抛错、不伪造机会）", async () => {
    await expect(trigger.autoScanOpportunitiesAfterAudit(USER, "free", "no-such-domain.test")).resolves.toBeUndefined();
  });
});

describe("工作区摘要的价值分层：增长机会与技术问题语义分离", () => {
  it("技术问题不进入 growth.top；topAction 与队列首个 open 任务同源（无第二套任务系统）", async () => {
    // 种入一次真实审计：一个 warning 级失败规则（P1 以下）
    const audit = await audits.createAudit(USER, DOMAIN, "full");
    await audits.finishAudit(USER, audit.id, {
      health_score: 80,
      errors: 0,
      warnings: 1,
      notices: 0,
      status: "completed",
      comparison: "null",
      pages_detail: "[]",
      engine_version: "v2",
      rule_set_version: "2.0",
      dashboard_json: JSON.stringify(
        makeSnapshot([
          { ruleId: "missing-meta-description", status: "fail", severity: "warning", findings: 2, affectedPages: 2, affectedRatio: 0.4, scoreImpact: 2, sampleUrl: `https://${DOMAIN}/` },
        ])
      ),
    });

    const summary = await queueMod.getWorkspaceActionSummary(USER, [DOMAIN], [{ id: 1, domain: DOMAIN }]);
    // growth.top 只含增长分层（regain/capture/improve），audit:missing-meta-description 绝不出现
    for (const o of summary.growth.top) {
      expect(o.valueCategory).not.toBe("issue");
      expect(o.taskId.startsWith("audit:")).toBe(false);
    }
    expect(summary.growth.counts.regain).toBe(1);
    // topAction 与队列首个 open 任务一致（同源，不重排）
    const q = await queueMod.buildWorkQueue({ userId: USER, domain: DOMAIN, projectId: 1 });
    const firstOpen = q.tasks.find((t) => t.status === "open");
    expect(summary.topAction!.taskId).toBe(firstOpen!.id);
    // 队列里技术任务带 issue 分层（派生字段已附加）
    const auditTask = q.tasks.find((t) => t.id === "audit:missing-meta-description");
    expect(auditTask!.valueCategory).toBe("issue");
  });
});
