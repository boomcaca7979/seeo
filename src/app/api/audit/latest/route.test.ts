// ===== /api/audit/latest 检查项覆盖（coverage）链路测试 =====
// 背景 bug：报告页"检查项覆盖（0/0 通过）"。
// 根因：coverage 只在 latest 路由按 issues 计算，但旧版把未执行的检查项也计为
// "通过"，且 reports 历史快照未保存 coverage、回退为空数组。
// 本测试验证 latest 路由的 coverage 输出：按 depth 过滤实际执行的检查项、
// passed/failed 与 issues 互补、name 按 locale 输出、comparison/history 正常返回。

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuditRow, AuditIssueRow } from "@/lib/db";

// ---- mock auth：始终放行 ----
vi.mock("@/lib/auth", () => ({
  requireAuthOrDemo: vi.fn(async () => ({ allowed: true, user: { id: "user-1" } })),
}));

// ---- mock DB：可按用例注入 audit 与 issues ----
const state: { audit: AuditRow | null; issues: AuditIssueRow[] } = {
  audit: null,
  issues: [],
};

vi.mock("@/lib/db", () => ({
  reapStaleRunningAudit: vi.fn(async () => undefined),
  getLatestAudit: vi.fn(async () => state.audit),
  getAuditIssues: vi.fn(async () => state.issues),
  getAuditHistory: vi.fn(async () => []),
}));

import { GET } from "./route";
import { allCheckMeta, pageRuleIds, crossPageCheckIds } from "@/lib/seo/audit-checks";

function makeAudit(overrides: Partial<AuditRow>): AuditRow {
  return {
    id: 1,
    domain: "example.com",
    started_at: "2026-08-20T10:00:00Z",
    finished_at: "2026-08-20T10:00:30Z",
    pages_crawled: 10,
    health_score: 66,
    status: "completed",
    errors: 3,
    warnings: 3,
    notices: 1,
    comparison: null,
    error: null,
    depth: "full",
    pages_detail: null,
    engine_version: "v2",
    rule_set_version: "2.0",
    dashboard_json: null,
    ...overrides,
  };
}

function makeIssue(type: string, severity: AuditIssueRow["severity"], url = "https://example.com/"): AuditIssueRow {
  return {
    id: Math.random(),
    audit_id: 1,
    type,
    severity,
    url,
    detail: JSON.stringify({ en: "d", zh: "详情" }),
    suggestion: JSON.stringify({ en: "s", zh: "建议" }),
  };
}

function request(locale: "en" | "zh" = "en") {
  const headers: Record<string, string> = locale === "zh" ? { cookie: "NEXT_LOCALE=zh" } : {};
  return new Request("http://localhost/api/audit/latest?domain=example.com", { headers });
}

beforeEach(() => {
  state.audit = null;
  state.issues = [];
});

interface CoverageEntry {
  id: string;
  name: string;
  description: string;
  passed: boolean;
  affectedPages: number;
  weight: number;
  category: string;
}

describe("latest 路由 coverage：full 深度", () => {
  it("coverage 覆盖全部检查项；failed 与 issues 的 checkId 集合一致", async () => {
    state.audit = makeAudit({ depth: "full" });
    state.issues = [
      makeIssue("missing-h1", "error"),
      makeIssue("title-length", "warning", "https://example.com/a"),
      makeIssue("title-length", "warning", "https://example.com/b"),
      makeIssue("no-h2-h3", "warning"),
    ];

    const res = await GET(request());
    const body = (await res.json()) as { data: { coverage: CoverageEntry[] } };
    const coverage = body.data.coverage;

    // 总数 = 全部检查项（不再 0/0）
    expect(coverage.length).toBe(allCheckMeta.length);
    expect(coverage.length).toBeGreaterThan(0);

    // failed 集合 = issues 命中的 checkId（去重）
    const failed = coverage.filter((c) => !c.passed);
    expect(failed.map((c) => c.id).sort()).toEqual(["missing-h1", "no-h2-h3", "title-length"]);

    // passed + failed = total
    expect(coverage.filter((c) => c.passed).length + failed.length).toBe(coverage.length);

    // affectedPages 与 issue 条数一致
    expect(coverage.find((c) => c.id === "title-length")?.affectedPages).toBe(2);
    expect(coverage.find((c) => c.id === "missing-h1")?.affectedPages).toBe(1);
    expect(coverage.find((c) => c.id === "missing-title")?.affectedPages).toBe(0);
  });

  it("comparison JSON 被解析并随响应返回", async () => {
    state.audit = makeAudit({
      comparison: JSON.stringify({
        previousScore: 70,
        currentScore: 66,
        newIssues: [{ checkId: "missing-h1", checkName: "missing-h1", message: JSON.stringify({ en: "d", zh: "缺 H1" }), url: "https://example.com/", severity: "error" }],
        resolvedIssues: [],
        unchangedIssues: [],
      }),
    });
    const res = await GET(request());
    const body = (await res.json()) as { data: { comparison: { previousScore: number; newIssues: Array<{ checkId: string; checkName: string }> } | null } };
    expect(body.data.comparison?.previousScore).toBe(70);
    expect(body.data.comparison?.newIssues[0].checkId).toBe("missing-h1");
  });
});

describe("latest 路由 coverage：quick 深度", () => {
  it("只输出单页检查项（跨页检查不得计为通过）", async () => {
    state.audit = makeAudit({ depth: "quick" });
    state.issues = [makeIssue("missing-title", "error")];

    const res = await GET(request());
    const body = (await res.json()) as { data: { coverage: CoverageEntry[] } };
    const coverage = body.data.coverage;

    expect(coverage.length).toBe(pageRuleIds.size);
    for (const c of coverage) {
      expect(crossPageCheckIds.has(c.id)).toBe(false);
    }
    expect(coverage.find((c) => c.id === "missing-title")?.passed).toBe(false);
  });
});

describe("latest 路由 coverage：本地化", () => {
  it("ZH locale 输出中文检查项名称", async () => {
    state.audit = makeAudit({ depth: "full" });
    state.issues = [];

    const res = await GET(request("zh"));
    const body = (await res.json()) as { data: { coverage: CoverageEntry[] } };
    const zhName = body.data.coverage.find((c) => c.id === "missing-title")?.name;
    expect(zhName).toBe("缺失标题");

    const enRes = await GET(request("en"));
    const enBody = (await enRes.json()) as { data: { coverage: CoverageEntry[] } };
    const enName = enBody.data.coverage.find((c) => c.id === "missing-title")?.name;
    expect(enName).toBe("Missing title");
  });
});

describe("latest 路由：边界行为", () => {
  it("无审计记录时 data 为 null", async () => {
    state.audit = null;
    const res = await GET(request());
    const body = (await res.json()) as { data: null };
    expect(body.data).toBeNull();
  });

  it("running 状态审计不返回 issues 与 coverage 统计失败项", async () => {
    state.audit = makeAudit({ status: "running", depth: "full" });
    state.issues = [makeIssue("missing-title", "error")];

    const res = await GET(request());
    const body = (await res.json()) as { data: { issues: unknown[]; coverage: CoverageEntry[] } };
    // running：getAuditIssues 不被调用 → issues 为空，coverage 全部通过
    expect(body.data.issues).toEqual([]);
    expect(body.data.coverage.every((c) => c.passed)).toBe(true);
  });
});
