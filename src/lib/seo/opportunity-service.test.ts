// ===== Opportunity Engine 单元测试（P1） =====
// 覆盖：规则边界、priority 确定性、dedup、dismissed 抑制、lifecycle、
//       CTR baseline 公式、AI 无数据 → DATA GAP、verify 分层

import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertOpportunityMock = vi.fn();
const getRankWindowMock = vi.fn();
const getLatestCompetitorRanksMock = vi.fn();
const getLatestAuditMock = vi.fn();
const getAuditIssuesMock = vi.fn();
const listAiSearchRunsMock = vi.fn();
const searchRankMock = vi.fn();
const searchAnalyticsMock = vi.fn();
const getProjectByIdMock = vi.fn();

vi.mock("@/lib/db/opportunities", () => ({
  buildOpportunityFingerprint: vi.fn((_p: number, type: string, target: string) => `${type}:${target}`),
  upsertOpportunity: (...args: unknown[]) => upsertOpportunityMock(...args),
  saveOpportunityActionPlan: vi.fn(),
  saveOpportunityVerification: vi.fn(),
  canTransition: (from: string, to: string) => {
    const map: Record<string, string[]> = {
      new: ["reviewed", "dismissed"], reviewed: ["approved", "dismissed"],
      approved: ["in_progress", "dismissed"], in_progress: ["completed", "dismissed"],
      completed: [], dismissed: [],
    };
    return (map[from] ?? []).includes(to);
  },
}));

vi.mock("@/lib/db/rankings", () => ({
  getRankWindow: (...args: unknown[]) => getRankWindowMock(...args),
}));

vi.mock("@/lib/db", () => ({
  getProjectById: (...args: unknown[]) => getProjectByIdMock(...args),
  listTrackedKeywords: vi.fn(),
  getLatestCompetitorRanks: (...args: unknown[]) => getLatestCompetitorRanksMock(...args),
}));

vi.mock("@/lib/db/audits", () => ({
  getLatestAudit: (...args: unknown[]) => getLatestAuditMock(...args),
  getAuditIssues: (...args: unknown[]) => getAuditIssuesMock(...args),
}));

vi.mock("@/lib/db/ai-search", () => ({
  listAiSearchRuns: (...args: unknown[]) => listAiSearchRunsMock(...args),
}));

vi.mock("./serp-service", () => ({
  searchRank: (...args: unknown[]) => searchRankMock(...args),
}));

vi.mock("./gsc-service", () => ({
  searchAnalytics: (...args: unknown[]) => searchAnalyticsMock(...args),
}));

import {
  evaluateAiVisibilityGap,
  evaluateCompetitorGap,
  evaluateContentRefresh,
  evaluateCtrOpportunity,
  evaluateLostRecovery,
  evaluateRankImprovement,
  expectedCtrForPosition,
  scanOpportunities,
  verifyOpportunity,
  type GscQueryRow,
} from "./opportunity-service";

function signal(overrides: Partial<{ currentRank: number | null; previousRank: number | null; currentUrl: string | null; previousUrl: string | null }> = {}) {
  return {
    keywordId: 1, keyword: "seo audit tool", location: "中国", device: "PC" as const,
    currentRank: 14, previousRank: 14, currentUrl: "https://me.site/a", previousUrl: "https://me.site/a",
    ...overrides,
  };
}

const competitor = (rank: number | null, domain = "rival.com") => ({ keywordId: 1, competitorDomain: domain, competitorRank: rank });

beforeEach(() => {
  upsertOpportunityMock.mockReset().mockResolvedValue({ isNew: true, suppressed: false });
  getRankWindowMock.mockReset().mockResolvedValue([]);
  getLatestCompetitorRanksMock.mockReset().mockResolvedValue([]);
  getLatestAuditMock.mockReset().mockResolvedValue(null);
  getAuditIssuesMock.mockReset().mockResolvedValue([]);
  listAiSearchRunsMock.mockReset().mockResolvedValue([]);
  searchRankMock.mockReset();
  searchAnalyticsMock.mockReset().mockResolvedValue({ rows: [] });
  getProjectByIdMock.mockReset().mockResolvedValue({ id: 2, domain: "me.site" });
});

describe("evaluateRankImprovement", () => {
  it("rank 8-30 且竞品 Top10 → 命中；rank≤15 且竞品≤5 → P0", () => {
    const result = evaluateRankImprovement(signal({ currentRank: 14 }), [competitor(4)]);
    expect(result?.priority).toBe("P0");
    expect(result?.evidence.length).toBe(2);
  });

  it("P1 边界：rank>15 或竞品>5", () => {
    expect(evaluateRankImprovement(signal({ currentRank: 16 }), [competitor(5)])?.priority).toBe("P1");
    expect(evaluateRankImprovement(signal({ currentRank: 14 }), [competitor(6)])?.priority).toBe("P1");
  });

  it("边界：rank 7 / 31 不命中；无竞品 Top10 不命中", () => {
    expect(evaluateRankImprovement(signal({ currentRank: 7 }), [competitor(4)])).toBe(null);
    expect(evaluateRankImprovement(signal({ currentRank: 31 }), [competitor(4)])).toBe(null);
    expect(evaluateRankImprovement(signal({ currentRank: 14 }), [competitor(11)])).toBe(null);
    expect(evaluateRankImprovement(signal({ currentRank: 14 }), [competitor(null)])).toBe(null);
  });
});

describe("evaluateLostRecovery / evaluateCompetitorGap", () => {
  it("lost：previous 有排名、current null → P0", () => {
    const result = evaluateLostRecovery(signal({ currentRank: null, previousRank: 8 }));
    expect(result?.priority).toBe("P0");
  });
  it("仍在排名 / 双 null 不命中", () => {
    expect(evaluateLostRecovery(signal({ currentRank: 8, previousRank: 12 }))).toBe(null);
    expect(evaluateLostRecovery(signal({ currentRank: null, previousRank: null }))).toBe(null);
  });
  it("competitor gap：我方无排名 + 竞品 ≤10 → P1", () => {
    const result = evaluateCompetitorGap(signal({ currentRank: null, previousRank: 40 }), [competitor(6)]);
    expect(result?.priority).toBe("P1");
  });
  it("我方有排名 → competitor gap 不命中", () => {
    expect(evaluateCompetitorGap(signal({ currentRank: 20 }), [competitor(6)])).toBe(null);
  });
});

describe("evaluateContentRefresh", () => {
  it("decline ≥5 且 URL 未变 → 命中；≥8 → P0", () => {
    expect(evaluateContentRefresh(signal({ currentRank: 14, previousRank: 9 }))?.priority).toBe("P1");
    expect(evaluateContentRefresh(signal({ currentRank: 28, previousRank: 10 }))?.priority).toBe("P0");
  });
  it("decline <5 或 URL 已变 → 不命中（URL 切换不伪装成内容老化）", () => {
    expect(evaluateContentRefresh(signal({ currentRank: 14, previousRank: 12 }))).toBe(null);
    expect(evaluateContentRefresh(signal({
      currentRank: 20, previousRank: 10,
      currentUrl: "https://me.site/b", previousUrl: "https://me.site/a",
    }))).toBe(null);
  });
});

describe("evaluateCtrOpportunity（baseline 公式）", () => {
  it("expected CTR 曲线：位置越深越低，>10 无基线", () => {
    expect(expectedCtrForPosition(1)).toBe(0.28);
    expect(expectedCtrForPosition(3)).toBe(0.10);
    expect(expectedCtrForPosition(9)).toBe(0.02);
    expect(expectedCtrForPosition(11)).toBe(null);
  });
  it("CTR < 0.5×baseline 且 impressions≥100 → 命中", () => {
    const row: GscQueryRow = { keys: ["seo audit tool"], clicks: 2, impressions: 800, ctr: 0.01, position: 3 };
    const result = evaluateCtrOpportunity(row);
    expect(result).not.toBe(null);
    expect(result?.signals.expectedBaselineCtr).toBe(0.10);
  });
  it("impressions 不足 / position >10 / CTR 接近 baseline → 不命中", () => {
    expect(evaluateCtrOpportunity({ keys: ["q"], clicks: 1, impressions: 50, ctr: 0.01, position: 3 })).toBe(null);
    expect(evaluateCtrOpportunity({ keys: ["q"], clicks: 1, impressions: 500, ctr: 0.01, position: 12 })).toBe(null);
    expect(evaluateCtrOpportunity({ keys: ["q"], clicks: 20, impressions: 800, ctr: 0.08, position: 3 })).toBe(null);
  });
});

describe("evaluateAiVisibilityGap", () => {
  it("无 run / hasData=false → null（DATA GAP，不伪造）", () => {
    expect(evaluateAiVisibilityGap(null)).toBe(null);
    expect(evaluateAiVisibilityGap({ hasData: false, mentionsTotal: null, aiShareOfVoice: null })).toBe(null);
  });
  it("mentions 0 → P2 机会", () => {
    const result = evaluateAiVisibilityGap({ hasData: true, mentionsTotal: 0, aiShareOfVoice: null });
    expect(result?.priority).toBe("P2");
  });
  it("SOV 落后 → P2 机会", () => {
    const result = evaluateAiVisibilityGap({
      hasData: true, mentionsTotal: 5,
      aiShareOfVoice: [
        { label: "me", isTarget: true, mentions: 5, aiSharePct: 20 },
        { label: "rival", isTarget: false, mentions: 20, aiSharePct: 80 },
      ],
    });
    expect(result).not.toBe(null);
  });
});

describe("scanOpportunities（dedup / 抑制 / DATA GAP）", () => {
  function windowRow(keywordId: number, keyword: string, date: string, position: number | null, url: string | null) {
    return { keyword_id: keywordId, keyword, domain: "me.site", location: "中国", device: "PC" as const, date, position, url, featureTypes: [] as string[] };
  }

  it("dedupe：同 target 多规则命中只保留一条（fingerprint 唯一）", async () => {
    getRankWindowMock.mockResolvedValue([
      windowRow(1, "kw a", "2026-08-27", 14, "https://me.site/a"),
      windowRow(1, "kw a", "2026-08-28", 14, "https://me.site/a"),
    ]);
    getLatestCompetitorRanksMock.mockResolvedValue([
      { competitor_id: 11, domain: "rival.com", rank: 4, target_url: null, checked_at: "2026-08-28" },
    ]);

    const result = await scanOpportunities("u1", "lite", 2);
    expect(result.generated).toBe(1);
    expect(result.candidates[0]).toMatchObject({ type: "rank_improvement", priority: "P0", isNew: true });
  });

  it("dismissed 机会被抑制（suppressed 计数，不重建）", async () => {
    upsertOpportunityMock.mockResolvedValue({ isNew: false, suppressed: true });
    getRankWindowMock.mockResolvedValue([
      windowRow(1, "kw lost", "2026-08-27", 8, "https://me.site/a"),
      windowRow(1, "kw lost", "2026-08-28", null, null),
    ]);
    const result = await scanOpportunities("u1", "lite", 2);
    expect(result.suppressed).toBe(1);
    expect(result.generated).toBe(0);
  });

  it("无审计/无 AI run → 对应 DATA GAP（不伪造）", async () => {
    getRankWindowMock.mockResolvedValue([]);
    const result = await scanOpportunities("u1", "lite", 2);
    expect(result.dataGaps.join(" ")).toContain("technical");
    expect(result.dataGaps.join(" ")).toContain("ai_visibility");
  });

  it("technical 机会来自真实 audit_issues（error 级按 URL 聚合）", async () => {
    getRankWindowMock.mockResolvedValue([]);
    getLatestAuditMock.mockResolvedValue({ id: 9 });
    getAuditIssuesMock.mockResolvedValue([
      { id: 1, audit_id: 9, type: "missing_title", severity: "error", url: "https://me.site/a", detail: "", suggestion: "" },
      { id: 2, audit_id: 9, type: "broken_link", severity: "error", url: "https://me.site/a", detail: "", suggestion: "" },
      { id: 3, audit_id: 9, type: "thin", severity: "warning", url: "https://me.site/b", detail: "", suggestion: "" },
    ]);
    const result = await scanOpportunities("u1", "lite", 2);
    expect(result.candidates.some((candidate) => candidate.type === "technical" && candidate.target === "https://me.site/a")).toBe(true);
  });
});

describe("verifyOpportunity（分层验证）", () => {
  it("rank 复检调 searchRank（真实 provider），GSC/AI 标 PENDING", async () => {
    searchRankMock.mockResolvedValue({ result: { rank: 9, matchedUrl: "https://me.site/a" }, fromCache: false });
    const { checks } = await verifyOpportunity("u1", "lite", {
      projectId: 2, type: "rank_improvement", targetType: "keyword", targetValue: "seo audit tool", signals: {},
    });
    expect(searchRankMock).toHaveBeenCalledTimes(1);
    expect(checks[0]).toMatchObject({ check: "rank", status: "pass" });
    expect(checks.some((check) => check.check === "gsc" && check.status === "pending")).toBe(true);
    expect(checks.some((check) => check.check === "ai_search" && check.status === "pending")).toBe(true);
  });

  it("复检失败 → PENDING（不判失败，不抛异常）", async () => {
    searchRankMock.mockRejectedValue(new Error("quota"));
    const { checks } = await verifyOpportunity("u1", "lite", {
      projectId: 2, type: "rank_improvement", targetType: "keyword", targetValue: "kw", signals: {},
    });
    expect(checks[0]).toMatchObject({ check: "rank", status: "pending" });
  });

  it("technical：以最新审计 error 数判定 PASS/FAILED", async () => {
    getProjectByIdMock.mockResolvedValue({ id: 2, domain: "me.site" });
    getLatestAuditMock.mockResolvedValue({ id: 9 });
    getAuditIssuesMock.mockResolvedValue([]);
    const { checks } = await verifyOpportunity("u1", "lite", {
      projectId: 2, type: "technical", targetType: "url", targetValue: "https://me.site/a", signals: {},
    });
    expect(checks[0]).toMatchObject({ check: "technical", status: "pass" });
  });
});
