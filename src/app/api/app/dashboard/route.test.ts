// ===== /api/app/dashboard：概况页按项目范围取数的行为测试 =====
//
// 覆盖（对应 2026-10 概况页单项目范围修复的验收口径）：
//   1. projectId 指向已审计项目 → 只返回该项目自己的健康分/技术问题，绝无其他项目数据；
//   2. projectId 指向未审计项目 → 诚实空态（hasAudit=false、audit=null），不借用别项目结果；
//   3. scope=all → 全部项目汇总（跨项目模式保留）；
//   4. 非法/不存在的 projectId → 404（不返回任何项目的数据）；
//   5. 缺参数 → 400。
//
// 演示模式（isAuthEnabled=false）+ 隔离临时库，与 workspace-dashboard.test.ts 同一套做法，
// 不触网、不碰生产库。鉴权模式的 UUID→domain 所有权映射在 route 源码契约测试中锁定。

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import type { DashboardSnapshot } from "@/lib/seo/audit-dashboard";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-apidash-"));
const USER = "demo-user";
const DOMAIN_A = "audited-a.test";
const DOMAIN_B = "unaudited-b.test";

let projects: typeof import("@/lib/db/projects");
let audits: typeof import("@/lib/db/audits");
let route: typeof import("./route");

beforeAll(async () => {
  process.env.NEXT_PUBLIC_ENABLE_AUTH = "false";
  process.env.TURSO_DATABASE_URL = `file://${dbDir}/test.db`;
  process.env.TURSO_AUTH_TOKEN = "test-token";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  vi.resetModules();
  projects = await import("@/lib/db/projects");
  audits = await import("@/lib/db/audits");
  route = await import("./route");
  const db = await import("@/lib/db/migrations");
  await db.getAdapter();
});

afterAll(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

function makeSnapshot(score: number): DashboardSnapshot {
  return {
    engineVersion: "v2",
    ruleSetVersion: "2.0",
    depth: "full",
    generatedAt: new Date().toISOString(),
    partial: false,
    pagesCrawled: 2,
    indexablePages: 2,
    score,
    grade: "ok",
    rules: [
      {
        ruleId: "title-missing",
        name: { en: "title-missing", zh: "title-missing" },
        description: { en: "test rule", zh: "测试规则" },
        recommendation: { en: "fix it", zh: "修复它" },
        category: "onpage",
        severity: "error",
        pageLevel: "page",
        scoreWeight: 1,
        status: "fail",
        findings: 2,
        affectedPages: 2,
        affectedRatio: 0,
        scoreImpact: 0,
        sampleUrl: `https://${DOMAIN_A}/a`,
        sampleMessage: null,
        sampleMetrics: null,
        pattern: null,
      },
    ],
    findings: [],
    pages: [],
    scoreBreakdown: [],
    categories: [],
    coverage: { passed: 0, failed: 1, total: 1, ratio: 0 },
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

async function getJson(url: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await route.GET(new Request(url));
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

describe("GET /api/app/dashboard", () => {
  let idA: string;
  let idB: string;

  beforeAll(async () => {
    await projects.addProject(USER, "Audited A", DOMAIN_A);
    await projects.addProject(USER, "Unaudited B", DOMAIN_B);
    idA = String((await projects.getProjectByDomain(USER, DOMAIN_A))!.id);
    idB = String((await projects.getProjectByDomain(USER, DOMAIN_B))!.id);
    const audit = await audits.createAudit(USER, DOMAIN_A, "full");
    await audits.finishAudit(USER, audit.id, {
      health_score: 96,
      errors: 2,
      warnings: 1,
      notices: 0,
      dashboard_json: JSON.stringify(makeSnapshot(96)),
    });
  });

  it("projectId=已审计项目：只返回该项目自己的健康分与队列（无其他项目数据）", async () => {
    const { status, body } = await getJson(`http://localhost/api/app/dashboard?projectId=${idA}`);
    expect(status).toBe(200);
    const data = body.data as { scope: string; overview: { hasAudit: boolean; audit: { domain: string; healthScore: number | null } | null }; actionSummary: { auditedDomains: number } };
    expect(data.scope).toBe("project");
    expect(data.overview.hasAudit).toBe(true);
    expect(data.overview.audit?.domain).toBe(DOMAIN_A);
    expect(data.overview.audit?.healthScore).toBe(96);
    expect(data.actionSummary.auditedDomains).toBe(1);
  });

  it("projectId=未审计项目：诚实空态（hasAudit=false、audit=null），不借用其他项目结果", async () => {
    const { status, body } = await getJson(`http://localhost/api/app/dashboard?projectId=${idB}`);
    expect(status).toBe(200);
    const data = body.data as { scope: string; overview: { hasAudit: boolean; audit: unknown; tasks: unknown[]; gaps: string[] }; actionSummary: { auditedDomains: number; open: number } };
    expect(data.scope).toBe("project");
    expect(data.overview.hasAudit).toBe(false);
    expect(data.overview.audit).toBeNull();
    expect(data.overview.tasks).toEqual([]);
    expect(data.overview.gaps).toContain("no_completed_audit");
    expect(data.actionSummary.auditedDomains).toBe(0);
    expect(data.actionSummary.open).toBe(0);
  });

  it("scope=all：返回全部项目汇总", async () => {
    const { status, body } = await getJson("http://localhost/api/app/dashboard?scope=all");
    expect(status).toBe(200);
    const data = body.data as { scope: string; overview: { hasProjects: boolean; auditedDomains: number } };
    expect(data.scope).toBe("all");
    expect(data.overview.hasProjects).toBe(true);
    expect(data.overview.auditedDomains).toBe(1); // 只有 A 审计过
  });

  it("不存在的 projectId：404，不返回任何项目的数据", async () => {
    const { status, body } = await getJson("http://localhost/api/app/dashboard?projectId=999999");
    expect(status).toBe(404);
    expect((body as { code?: string }).code).toBe("PROJECT_NOT_FOUND");
  });

  it("缺参数：400", async () => {
    const { status } = await getJson("http://localhost/api/app/dashboard");
    expect(status).toBe(400);
  });
});

describe("源码契约：范围数据流（SSR cookie → 服务端聚合，客户端不做二次聚合）", () => {
  const ROUTE_SRC = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf-8");
  const PAGE_SRC = readFileSync(
    fileURLToPath(new URL("../../../(default)/(dashboard)/app/page.tsx", import.meta.url)),
    "utf-8"
  );
  const BOUNDARY_SRC = readFileSync(
    fileURLToPath(new URL("../../../../components/dashboard/ScopedOverview.tsx", import.meta.url)),
    "utf-8"
  );

  it("API 路由：鉴权模式下 UUID 必须命中本人项目列表（显式所有权比对）", () => {
    expect(ROUTE_SRC).toContain("domainByUuid.has(projectId)");
    expect(ROUTE_SRC).toContain("PROJECT_NOT_FOUND");
    // 指标口径唯一来源：getWorkspaceDashboard（不建立第二套计算）
    expect(ROUTE_SRC).toContain("getWorkspaceDashboard(userId, scoped)");
  });

  it("page.tsx：SSR 按范围 cookie 解析，cookie 非法回退全部项目", () => {
    expect(PAGE_SRC).toContain("OVERVIEW_SCOPE_COOKIE");
    expect(PAGE_SRC).toContain("resolveInitialScope(scopeCookie, scopedAll, domainByUuid)");
    expect(PAGE_SRC).toContain("resolveInitialScope(scopeCookie, scopedAll, null)");
  });

  it("ScopedOverview：seq 防竞态 + 旧响应丢弃 + 失败显示错误态而非回退旧数据", () => {
    expect(BOUNDARY_SRC).toContain("seqRef.current !== seq");
    expect(BOUNDARY_SRC).toContain("setErrorFor(scope)");
    expect(BOUNDARY_SRC).toContain("role=\"alert\"");
    // 取数状态是派生值（loadedFor ≠ scope 即在取数），不在 effect 里 setState
    expect(BOUNDARY_SRC).toContain("const syncing = !isLoaded && !hasError;");
    // 范围 cookie 与当前项目同步（刷新后 SSR 从顶部项目开始）
    expect(BOUNDARY_SRC).toContain("setOverviewScope(");
  });

  it("ScopedOverview：mode 一律从 follow 开始 + 顶部切换自动退出全部项目模式（2026-10-20 真实会话 FAIL 修复）", () => {
    // mode 不得按 SSR 初值（cookie 缺失时为 all）初始化——否则老用户（localStorage
    // 有项目、无 cookie）会永久停在跨项目模式，必须手动点「当前项目」才能纠正
    expect(BOUNDARY_SRC).toContain('useState<"follow" | "all">("follow")');
    expect(BOUNDARY_SRC).not.toContain('initialScope.kind === "all" ? "all" : "follow"');
    // 顶部用户切换 / 页面写回上下文 → 自动回到当前项目模式；init 恢复广播不打断显式选择
    expect(BOUNDARY_SRC).toContain('detail.source === "user" || detail.source === "context"');
    expect(BOUNDARY_SRC).toContain('setMode("follow")');
    // cookie 只跟踪当前项目：「全部项目」不落 cookie，刷新后总是回到顶部项目
    expect(BOUNDARY_SRC).toContain('if (scope.kind === "project") setOverviewScope(scope.id)');
    expect(BOUNDARY_SRC).not.toContain('scope.kind === "all" ? "all" : scope.id');
  });

  it("ActiveProjectContext：跨 tab storage 同步走 writeActiveProject（cookie + 事件广播）", () => {
    const CTX_SRC = readFileSync(
      fileURLToPath(new URL("../../../../components/dashboard/ActiveProjectContext.tsx", import.meta.url)),
      "utf-8"
    );
    expect(CTX_SRC).toContain("writeActiveProject(stored, \"user\")");
  });
});
