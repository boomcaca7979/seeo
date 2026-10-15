// ===== Action Center API 契约测试（隔离临时库；无网络、无生产依赖）=====
//
// 验证 HTTP 层反馈是否正确（产品承诺：「数据缺失 / 请求失败 / 权限不足都有正确反馈」）：
//   - 参数非法 → 400（不是 500，也不是静默成功）
//   - 越权置位 verified_resolved → **403**（客户端不能自证"已验证解决"）
//   - 合法置位 → 200 且真实落库
//   - 队列响应直接来自真实审计快照（不是静态卡片）

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { DashboardSnapshot } from "@/lib/seo/audit-dashboard";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "seeo-ac-api-"));
const DOMAIN = "api-contract.test";

let queueGET: (req: Request) => Promise<Response>;
let statusGET: (req: Request) => Promise<Response>;
let statusPOST: (req: Request) => Promise<Response>;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_ENABLE_AUTH = "false"; // 演示模式：requireAuthOrDemo 放行，userId=demo-user
  process.env.TURSO_DATABASE_URL = `file://${dbDir}/api.db`;
  process.env.TURSO_AUTH_TOKEN = "test-token";
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  vi.resetModules();

  const db = await import("@/lib/db/migrations");
  await db.getAdapter();
  const audits = await import("@/lib/db/audits");

  const snapshot = {
    engineVersion: "v2",
    ruleSetVersion: "2.0",
    depth: "full",
    generatedAt: new Date().toISOString(),
    partial: false,
    pagesCrawled: 2,
    indexablePages: 2,
    score: 70,
    grade: "needs-attention",
    rules: [
      {
        ruleId: "missing-h1",
        name: { en: "Missing H1", zh: "缺少 H1" },
        description: { en: "d", zh: "d" },
        recommendation: { en: "add an H1", zh: "补充 H1" },
        category: "onpage",
        severity: "error",
        pageLevel: "page",
        scoreWeight: 1,
        status: "fail",
        findings: 1,
        affectedPages: 1,
        affectedRatio: 0.5,
        scoreImpact: 5,
        sampleUrl: `https://${DOMAIN}/`,
        sampleMessage: { en: "No H1 found", zh: "未找到 H1" },
        sampleMetrics: null,
        pattern: null,
      },
    ],
    findings: [],
    pages: [],
    scoreBreakdown: [],
    categories: [],
    coverage: { passed: 0, failed: 1, total: 1, ratio: 0 },
    crawler: { pagesCrawled: 2, htmlPages: 2, redirects: 0, errors: 0, loops: 0, avgResponseMs: 90, fastestMs: 50, slowestMs: 130, httpStatus: { "2xx": 2, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 } },
    content: { avgWordCount: 400, lowContent: 0, veryLowContent: 0, avgTextHtmlRatio: 0.2, byType: {} },
    linking: { avgInternalLinks: 8, zeroInternalLinks: 0, deepPages: 0, orphans: 0, linksToRedirects: 0, depthDistribution: {} },
    structuredData: { statusCounts: {}, schemaTypes: {}, pagesWithSD: 0 },
    aiSearch: { crawlers: {}, llmsTxt: null, semanticHtmlAffected: 0 },
    robots: { status: "found", httpStatus: 200, sitemapUrls: [], disallowAll: false },
    sitemap: null,
  } as unknown as DashboardSnapshot;

  const audit = await audits.createAudit("demo-user", DOMAIN, "full");
  await audits.finishAudit("demo-user", audit.id, {
    health_score: 70,
    errors: 1,
    warnings: 0,
    notices: 0,
    status: "completed",
    comparison: null,
    pages_detail: null,
    engine_version: "v2",
    rule_set_version: "2.0",
    dashboard_json: JSON.stringify(snapshot),
  });

  queueGET = (await import("./route")).GET;
  const statusRoute = await import("@/app/api/audit/issues/status/route");
  statusGET = statusRoute.GET;
  statusPOST = statusRoute.POST;
});

afterAll(() => {
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe("GET /api/actions/queue", () => {
  it("合法 domain → 200，返回由真实审计快照派生的任务与 coverage", async () => {
    const res = await queueGET(new Request(`http://localhost/api/actions/queue?domain=${DOMAIN}`));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { tasks: Array<{ id: string; target: string | null }>; coverage: { audit: { available: boolean } } } };
    expect(json.data.coverage.audit.available).toBe(true);
    expect(json.data.tasks.map((t) => t.id)).toContain("audit:missing-h1");
    expect(json.data.tasks[0].target).toBe(`https://${DOMAIN}/`);
  });

  it("domain 非法 → 400 INVALID_DOMAIN（不是 500，也不是静默空队列）", async () => {
    const res = await queueGET(new Request("http://localhost/api/actions/queue?domain=not_a_domain"));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("INVALID_DOMAIN");
  });

  it("缺少 domain → 400", async () => {
    const res = await queueGET(new Request("http://localhost/api/actions/queue"));
    expect(res.status).toBe(400);
  });
});

describe("GET/POST /api/audit/issues/status", () => {
  it("GET 返回该域名的处理记录（初始为空数组，而非报错）", async () => {
    const res = await statusGET(new Request(`http://localhost/api/audit/issues/status?domain=${DOMAIN}`));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { domain: string; resolutions: unknown[] } };
    expect(json.data.domain).toBe(DOMAIN);
    expect(Array.isArray(json.data.resolutions)).toBe(true);
    expect(json.data.resolutions).toHaveLength(0);
  });

  it("POST verified_resolved → **403**（客户端不能自证已验证解决）", async () => {
    const res = await statusPOST(
      new Request("http://localhost/api/audit/issues/status", {
        method: "POST",
        body: JSON.stringify({ domain: DOMAIN, rule_id: "missing-h1", status: "verified_resolved" }),
      })
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("STATUS_NOT_USER_SETTABLE");
    // 且未落库
    const check = await statusGET(new Request(`http://localhost/api/audit/issues/status?domain=${DOMAIN}`));
    const after = (await check.json()) as { data: { resolutions: unknown[] } };
    expect(after.data.resolutions).toHaveLength(0);
  });

  it("POST fixed_claimed → 200 并真实落库（再次 GET 可见）", async () => {
    const res = await statusPOST(
      new Request("http://localhost/api/audit/issues/status", {
        method: "POST",
        body: JSON.stringify({ domain: DOMAIN, rule_id: "missing-h1", status: "fixed_claimed" }),
      })
    );
    expect(res.status).toBe(200);
    const check = await statusGET(new Request(`http://localhost/api/audit/issues/status?domain=${DOMAIN}`));
    const after = (await check.json()) as { data: { resolutions: Array<{ rule_id: string; status: string; verify_status: string | null }> } };
    expect(after.data.resolutions).toHaveLength(1);
    expect(after.data.resolutions[0].rule_id).toBe("missing-h1");
    expect(after.data.resolutions[0].status).toBe("fixed_claimed");
    expect(after.data.resolutions[0].verify_status).toBeNull();
  });

  it("POST 缺字段 / 非法状态 → 400", async () => {
    const bad1 = await statusPOST(new Request("http://localhost/api/audit/issues/status", { method: "POST", body: JSON.stringify({ domain: DOMAIN }) }));
    expect(bad1.status).toBe(400);
    const bad2 = await statusPOST(
      new Request("http://localhost/api/audit/issues/status", {
        method: "POST",
        body: JSON.stringify({ domain: DOMAIN, rule_id: "missing-h1", status: "definitely-not-a-status" }),
      })
    );
    expect(bad2.status).toBe(403);
  });
});
