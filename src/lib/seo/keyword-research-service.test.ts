// ===== KeywordResearchService 单元测试（P0-02-A） =====
// 覆盖：候选合并去重、指标归一化、null 指标、provider 错误降级、缓存、配额、limit

import { beforeEach, describe, expect, it, vi } from "vitest";

const readCacheMock = vi.fn();
const writeCacheMock = vi.fn();
const consumeQuotaMock = vi.fn();
const peekUsageMock = vi.fn();
const expandKeywordMock = vi.fn();
const getSerpUsageMock = vi.fn();
const fetchKeywordMetricsMock = vi.fn();
const fetchBacklinksMock = vi.fn();

vi.mock("./cache", () => ({
  readCache: (...args: unknown[]) => readCacheMock(...args),
  writeCache: (...args: unknown[]) => writeCacheMock(...args),
  consumeQuota: (...args: unknown[]) => consumeQuotaMock(...args),
  peekUsage: (...args: unknown[]) => peekUsageMock(...args),
  QuotaExceededError: class QuotaExceededError extends Error {
    readonly code = "QUOTA_EXCEEDED";
    constructor(_used: number, _limit: number, apiType: string) {
      super(`本月${apiType}额度已用尽`);
    }
  },
}));

vi.mock("./serp-service", () => ({
  expandKeyword: (...args: unknown[]) => expandKeywordMock(...args),
  getSerpUsage: (...args: unknown[]) => getSerpUsageMock(...args),
  searchSerp: vi.fn(),
}));

vi.mock("./dataforseo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./dataforseo")>();
  return {
    ...actual,
    fetchKeywordMetrics: (...args: unknown[]) => fetchKeywordMetricsMock(...args),
    fetchBacklinks: (...args: unknown[]) => fetchBacklinksMock(...args),
  };
});

import {
  computeUnavailableMetrics,
  mergeKeywordCandidates,
  normalizeKeywordForDedup,
  researchKeywords,
} from "./keyword-research-service";
import { QuotaExceededError } from "./cache";

const serpUsage = { used: 3, limit: 30, month: "2026-08" };
const dfsUsage = { used: 1, limit: 5, month: "2026-08" };

beforeEach(() => {
  readCacheMock.mockReset().mockResolvedValue(null);
  writeCacheMock.mockReset().mockResolvedValue(undefined);
  consumeQuotaMock.mockReset().mockResolvedValue(dfsUsage);
  peekUsageMock.mockReset().mockResolvedValue(dfsUsage);
  expandKeywordMock.mockReset().mockResolvedValue({
    seed: "seo 工具",
    related: ["seo 工具 推荐", "免费 SEO 工具"],
    paa: ["什么是 SEO 工具？", "SEO 工具 推荐"],
    location: "中国",
    device: "desktop",
    fromCache: false,
  });
  getSerpUsageMock.mockReset().mockResolvedValue(serpUsage);
  fetchKeywordMetricsMock.mockReset().mockResolvedValue({ rows: [], difficultyAvailable: false, warnings: [] });
});

const emptyMetricRow = (keyword: string) => ({
  keyword,
  searchVolume: null,
  cpc: null,
  competition: null,
  competitionLevel: null,
  difficulty: null,
  intent: null as null,
  trend: null,
  currency: null,
});

describe("mergeKeywordCandidates", () => {
  it("合并 seed/related/paa 并大小写不敏感去重", () => {
    const merged = mergeKeywordCandidates(
      "SEO Tool",
      ["seo tool", "Free SEO Tools", "seo 优化"],
      ["SEO TOOL", "site audit"],
      50
    );
    expect(merged.map((item) => item.keyword)).toEqual(["SEO Tool", "Free SEO Tools", "seo 优化", "site audit"]);
    expect(merged.map((item) => item.origin)).toEqual(["seed", "related", "related", "paa"]);
  });

  it("尊重 limit 且跳过空白项", () => {
    const merged = mergeKeywordCandidates("kw", ["kw2", "  ", "kw3"], ["kw4"], 2);
    expect(merged.map((item) => item.keyword)).toEqual(["kw", "kw2"]);
  });

  it("空输入返回空列表", () => {
    expect(mergeKeywordCandidates("", [], [], 10)).toEqual([]);
  });
});

describe("normalizeKeywordForDedup", () => {
  it("trim + 小写", () => {
    expect(normalizeKeywordForDedup("  SEO 工具 ")).toBe("seo 工具");
  });
});

describe("computeUnavailableMetrics", () => {
  it("全 null 时列出全部指标", () => {
    const rows = [{ keyword: "a", searchVolume: null, difficulty: null, cpc: null, competition: null, intent: null, trend: null }];
    expect(computeUnavailableMetrics(rows as never)).toEqual([
      "searchVolume", "difficulty", "cpc", "competition", "intent", "trend",
    ]);
  });

  it("任一行有真实数据即不计入 unavailable", () => {
    const rows = [
      { keyword: "a", searchVolume: 100, difficulty: null, cpc: null, competition: null, intent: null, trend: null },
      { keyword: "b", searchVolume: null, difficulty: null, cpc: null, competition: null, intent: null, trend: null },
    ];
    expect(computeUnavailableMetrics(rows as never)).toEqual([
      "difficulty", "cpc", "competition", "intent", "trend",
    ]);
  });
});

describe("researchKeywords", () => {
  it("返回扩词 + null 指标并在 provider 无数据时标记 unavailableMetrics", async () => {
    fetchKeywordMetricsMock.mockResolvedValue({
      rows: [
        { ...emptyMetricRow("seo 工具") },
        { ...emptyMetricRow("seo 工具 推荐") },
        { ...emptyMetricRow("免费 SEO 工具") },
        { ...emptyMetricRow("什么是 SEO 工具？") },
      ],
      difficultyAvailable: false,
      warnings: ["keyword difficulty 端点未返回数据"],
    });

    const result = await researchKeywords("user-1", "free", { keyword: "seo 工具", location: "中国", device: "PC" });

    expect(result.related).toEqual(["seo 工具 推荐", "免费 SEO 工具"]);
    expect(result.paa).toEqual(["什么是 SEO 工具？", "SEO 工具 推荐"]);
    expect(result.device).toBe("desktop");
    expect(result.keywords).toHaveLength(4); // paa 中与 related 重复的 "SEO 工具 推荐" 被去重
    expect(result.keywords.every((row) => row.searchVolume === null && row.difficulty === null)).toBe(true);
    expect(result.keywords.every((row) => row.source === "dataforseo")).toBe(true);
    expect(result.unavailableMetrics).toEqual(["searchVolume", "difficulty", "cpc", "competition", "intent", "trend"]);
    expect(result.metrics.source).toBe("dataforseo");
    expect(result.metrics.fromCache).toBe(false);
    expect(result.usage.serp).toEqual(serpUsage);
    expect(result.usage.dataforseo).toEqual(dfsUsage);
  });

  it("缓存命中时不调用 provider、不消耗 dataforseo 配额", async () => {
    const cachedRows = [
      {
        keyword: "seo 工具",
        searchVolume: 1000,
        cpc: 1.5,
        competition: 0.5,
        competitionLevel: "MEDIUM",
        difficulty: 42,
        intent: null as null,
        trend: [{ year: 2026, month: 7, searchVolume: 900 }],
        currency: "USD",
      },
    ];
    readCacheMock.mockResolvedValue(cachedRows);

    const result = await researchKeywords("user-1", "pro", { keyword: "seo 工具", location: "中国", device: "PC", limit: 10 });

    expect(fetchKeywordMetricsMock).not.toHaveBeenCalled();
    expect(consumeQuotaMock).not.toHaveBeenCalled();
    expect(writeCacheMock).not.toHaveBeenCalled();
    expect(result.metrics.fromCache).toBe(true);
    expect(result.keywords[0]).toMatchObject({
      keyword: "seo 工具",
      searchVolume: 1000,
      difficulty: 42,
      competition: 0.5,
      trend: [{ year: 2026, month: 7, searchVolume: 900 }],
      source: "dataforseo",
      origin: "seed",
    });
    expect(result.unavailableMetrics).toEqual(["intent"]); // cpc/competition 随首个关键词有值而不算 unavailable
  });

  it("缓存未命中时调用 provider 并写入缓存", async () => {
    fetchKeywordMetricsMock.mockResolvedValue({
      rows: [emptyMetricRow("seo 工具"), emptyMetricRow("seo 工具 推荐"), emptyMetricRow("免费 SEO 工具"), emptyMetricRow("什么是 SEO 工具？")],
      difficultyAvailable: true,
      warnings: [],
    });

    await researchKeywords("user-1", "lite", { keyword: "seo 工具", location: "中国", device: "PC" });

    expect(fetchKeywordMetricsMock).toHaveBeenCalledTimes(1);
    expect(consumeQuotaMock).toHaveBeenCalledTimes(1);
    expect(consumeQuotaMock).toHaveBeenCalledWith("user-1", "dataforseo", "lite");
    expect(writeCacheMock).toHaveBeenCalledTimes(1);
  });

  it("dataforseo 配额超限时优雅降级：扩词结果不受影响、指标为 null", async () => {
    consumeQuotaMock.mockRejectedValue(
      new QuotaExceededError(5, 5, "dataforseo")
    );

    const result = await researchKeywords("user-1", "free", { keyword: "seo 工具", location: "中国", device: "PC" });

    expect(fetchKeywordMetricsMock).not.toHaveBeenCalled();
    expect(result.keywords).toHaveLength(4);
    expect(result.keywords.every((row) => row.source === "serpapi")).toBe(true);
    expect(result.metrics.source).toBe(null);
    expect(result.metrics.warnings.join(" ")).toContain("dataforseo");
    expect(result.related).toEqual(["seo 工具 推荐", "免费 SEO 工具"]);
  });

  it("enrichMetrics=false 时不请求指标并给出说明", async () => {
    const result = await researchKeywords("user-1", "pro", {
      keyword: "seo 工具", location: "中国", device: "PC", enrichMetrics: false,
    });

    expect(fetchKeywordMetricsMock).not.toHaveBeenCalled();
    expect(consumeQuotaMock).not.toHaveBeenCalled();
    expect(result.metrics.source).toBe(null);
    expect(result.keywords.every((row) => row.source === "serpapi")).toBe(true);
    expect(result.metrics.warnings.join(" ")).toContain("enrichMetrics=false");
  });

  it("指标覆盖部分关键词时 source 区分有数据与无数据的行为", async () => {
    fetchKeywordMetricsMock.mockResolvedValue({
      rows: [
        {
          keyword: "seo 工具",
          searchVolume: 5000,
          cpc: 2.1,
          competition: 0.62,
          competitionLevel: "HIGH",
          difficulty: 55,
          intent: null,
          trend: null,
          currency: "USD",
        },
        emptyMetricRow("seo 工具 推荐"),
        emptyMetricRow("免费 SEO 工具"),
        emptyMetricRow("什么是 SEO 工具？"),
      ],
      difficultyAvailable: true,
      warnings: [],
    });

    const result = await researchKeywords("user-1", "pro", { keyword: "seo 工具", location: "中国", device: "PC" });

    expect(result.keywords[0]).toMatchObject({ searchVolume: 5000, difficulty: 55, competition: 0.62, source: "dataforseo" });
    expect(result.keywords[1].source).toBe("dataforseo"); // provider 返回了该行（即使值为 null）
    expect(result.unavailableMetrics).toEqual(["intent", "trend"]);
  });
});
