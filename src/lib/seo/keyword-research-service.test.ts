// ===== KeywordResearchService 单元测试（P0-02-A） =====
// 覆盖：候选合并去重（含跨来源 origins 合并）、指标归一化、null 指标、provider 错误降级、
//       缓存、配额、limit、数据库扩词（Labs suggestions + ideas）与批量补全的分工

import { beforeEach, describe, expect, it, vi } from "vitest";

const readCacheMock = vi.fn();
const writeCacheMock = vi.fn();
const consumeQuotaMock = vi.fn();
const peekUsageMock = vi.fn();
const refundQuotaMock = vi.fn();
const getPlanLimitMock = vi.fn();
const assertDataForSeoConfiguredSpy = vi.fn();
const expandKeywordMock = vi.fn();
const getSerpUsageMock = vi.fn();
const fetchKeywordMetricsMock = vi.fn();
const fetchKeywordDiscoveryMock = vi.fn();
const fetchBacklinksMock = vi.fn();

vi.mock("./cache", () => ({
  readCache: (...args: unknown[]) => readCacheMock(...args),
  writeCache: (...args: unknown[]) => writeCacheMock(...args),
  consumeQuota: (...args: unknown[]) => consumeQuotaMock(...args),
  peekUsage: (...args: unknown[]) => peekUsageMock(...args),
  getPlanLimit: (...args: unknown[]) => getPlanLimitMock(...args),
  refundQuota: (...args: unknown[]) => refundQuotaMock(...args),
  QuotaExceededError: class QuotaExceededError extends Error {
    readonly code = "QUOTA_EXCEEDED";
    constructor(used: number, limit: number, apiType: string, month: string) {
      super(`本月${apiType}额度已用尽（${used}/${limit}，${month}）`);
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
    // 真实预检照常执行（决定是否抛错），额外记录调用次数
    assertDataForSeoConfigured: () => { assertDataForSeoConfiguredSpy(); return actual.assertDataForSeoConfigured(); },
    fetchKeywordMetrics: (...args: unknown[]) => fetchKeywordMetricsMock(...args),
    fetchKeywordDiscovery: (...args: unknown[]) => fetchKeywordDiscoveryMock(...args),
    fetchBacklinks: (...args: unknown[]) => fetchBacklinksMock(...args),
  };
});

import {
  computeUnavailableMetrics,
  enrichKeywordMetrics,
  mergeKeywordCandidates,
  normalizeKeywordForDedup,
  researchKeywords,
} from "./keyword-research-service";
import { dedupeKeywordList } from "./keyword-merge";
import { DataForSeoApiError, DataForSeoNotConfiguredError } from "./dataforseo";
import { QuotaExceededError } from "./cache";

const serpUsage = { used: 3, limit: 30, month: "2026-08" };
const dfsUsage = { used: 1, limit: 5, month: "2026-08" };

beforeEach(() => {
  // DataForSEO 凭据预检要求环境变量存在（预检本身在真实模块里，未被 mock）；
  // 具体 provider 调用仍由 mock 决定，凭据值不参与任何断言。
  vi.stubEnv("DATAFORSEO_LOGIN", "test-login");
  vi.stubEnv("DATAFORSEO_PASSWORD", "test-password");
  readCacheMock.mockReset().mockResolvedValue(null);
  writeCacheMock.mockReset().mockResolvedValue(undefined);
  consumeQuotaMock.mockReset().mockResolvedValue(dfsUsage);
  peekUsageMock.mockReset().mockResolvedValue(dfsUsage);
  refundQuotaMock.mockReset().mockResolvedValue(undefined);
  // 套餐额度：free = 0（不含市场指标），lite/pro 有额度。与 DEFAULT_PLAN_LIMITS 一致。
  getPlanLimitMock.mockReset().mockImplementation(async (plan: unknown, apiType: unknown) =>
    apiType === "dataforseo" ? (plan === "free" ? 0 : 5) : 30);
  assertDataForSeoConfiguredSpy.mockReset();
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
  // 默认：数据库扩词不可用（未配置凭据）——与无凭据环境一致，走优雅降级
  fetchKeywordDiscoveryMock.mockReset().mockRejectedValue(new DataForSeoNotConfiguredError());
});

const emptyMetricRow = (keyword: string) => ({
  keyword,
  searchVolume: null,
  cpc: null,
  competition: null,
  competitionLevel: null,
  difficulty: null,
  intent: null,
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
    // 跨来源大小写重复（"seo tool"/"SEO TOOL" 命中种子词）合并进 origins，不重复生成行
    expect(merged.map((item) => item.origins)).toEqual([
      ["seed", "related", "paa"],
      ["related"],
      ["related"],
      ["paa"],
    ]);
  });

  it("额外来源（数据库扩词）与已有词合并 origins，不重复生成行", () => {
    const merged = mergeKeywordCandidates("kw", ["kw a"], ["kw b"], 50, [
      { origin: "labs_suggestions", keywords: ["KW A", "kw c"] },
      { origin: "labs_ideas", keywords: ["kw a", "kw d"] },
    ]);
    const a = merged.find((item) => item.keyword === "kw a");
    expect(a?.origins).toEqual(["related", "labs_suggestions", "labs_ideas"]);
    expect(merged.filter((item) => item.keyword.toLowerCase() === "kw a")).toHaveLength(1);
    expect(merged.map((item) => item.keyword)).toEqual(["kw", "kw a", "kw b", "kw c", "kw d"]);
  });

  it("autocomplete 来源与其他来源合并 origins（Google 自动补全不重复计数）", () => {
    const merged = mergeKeywordCandidates("seo tool", ["seo tool free"], [], 50, [
      { origin: "autocomplete", keywords: ["SEO Tool Free", "seo audit"] },
    ]);
    const free = merged.find((item) => item.keyword === "seo tool free");
    expect(free?.origins).toEqual(["related", "autocomplete"]);
    expect(merged.filter((item) => item.keyword.toLowerCase() === "seo tool free")).toHaveLength(1);
    expect(merged.map((item) => item.keyword)).toEqual(["seo tool", "seo tool free", "seo audit"]);
  });

  it("dedupeKeywordList：与 mergeKeywordCandidates 同一套归一口径", () => {
    expect(dedupeKeywordList(["A", " a ", "B", ""])).toEqual(["A", "B"]);
  });

  it("尊重 limit 且跳过空白项", () => {    const merged = mergeKeywordCandidates("kw", ["kw2", "  ", "kw3"], ["kw4"], 2);
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

    const result = await researchKeywords("user-1", "lite", { keyword: "seo 工具", location: "中国", device: "PC" });

    expect(result.related).toEqual(["seo 工具 推荐", "免费 SEO 工具"]);
    expect(result.paa).toEqual(["什么是 SEO 工具？", "SEO 工具 推荐"]);
    expect(result.device).toBe("desktop");
    expect(result.keywords).toHaveLength(4); // paa 中与 related 重复的 "SEO 工具 推荐" 被去重
    expect(result.keywords.every((row) => row.searchVolume === null && row.difficulty === null)).toBe(true);
    expect(result.keywords.every((row) => row.source === "dataforseo")).toBe(true);
    expect(result.unavailableMetrics).toEqual(["searchVolume", "difficulty", "cpc", "competition", "intent", "trend"]);
    expect(result.metrics.source).toBe("dataforseo");
    expect(result.metrics.fromCache).toBe(false);
    expect(result.metrics.discovery).toEqual({ source: null, fromCache: false, state: "unconfigured" });
    expect(result.usage.serp).toEqual(serpUsage);
    expect(result.usage.dataforseo).toEqual(dfsUsage);
  });

  it("数据库扩词：发现行带真实指标与 provider 意图，发现词不再走批量补全，种子词用 seedRow", async () => {
    fetchKeywordDiscoveryMock.mockResolvedValue({
      rows: new Map([
        ["seo 工具 免费", {
          keyword: "seo 工具 免费", origin: "labs_suggestions", searchVolume: 2400, cpc: 5.1,
          competition: 0.31, competitionLevel: "MEDIUM", difficulty: 72, intent: "commercial",
          trend: [{ year: 2026, month: 9, searchVolume: 2300 }], currency: "USD",
        }],
        ["网站诊断", {
          keyword: "网站诊断", origin: "labs_ideas", searchVolume: 880, cpc: null,
          competition: null, competitionLevel: null, difficulty: 40, intent: "informational",
          trend: null, currency: null,
        }],
      ]),
      seedRow: {
        keyword: "seo 工具", origin: "labs_suggestions", searchVolume: 2900, cpc: 7.6,
        competition: 0.11, competitionLevel: "LOW", difficulty: 72, intent: "informational",
        trend: null, currency: "USD",
      },
      warnings: [],
    });

    const result = await researchKeywords("user-1", "pro", { keyword: "seo 工具", location: "中国", device: "PC", limit: 50 });

    const byKw = new Map(result.keywords.map((row) => [row.keyword.toLowerCase(), row]));
    // 发现行：真实指标 + provider 意图
    expect(byKw.get("seo 工具 免费")).toMatchObject({
      origin: "labs_suggestions",
      origins: ["labs_suggestions"],
      searchVolume: 2400,
      difficulty: 72,
      intent: "commercial",
      intentSource: "provider",
      source: "dataforseo",
    });
    // 种子词：来自 seedRow（include_seed_keyword）
    expect(byKw.get("seo 工具")).toMatchObject({
      origin: "seed",
      searchVolume: 2900,
      difficulty: 72,
      competition: 0.11,
      intentSource: "provider",
    });
    // 批量补全只覆盖 SerpApi 来源词（发现词不重复补全）
    const enrichArg = fetchKeywordMetricsMock.mock.calls[0]?.[0] as string[] | undefined;
    expect(enrichArg).toBeDefined();
    expect(enrichArg).toContain("seo 工具 推荐");
    expect(enrichArg).not.toContain("seo 工具 免费");
    // provider 意图有真实数据 → intent 不再整体不可用
    expect(result.unavailableMetrics).not.toContain("intent");
    expect(result.metrics.discovery).toEqual({ source: "dataforseo", fromCache: false, state: "ok" });
  });

  it("同一关键词多来源合并为一条且 origins 保留全部来源（不重复计数）", async () => {
    fetchKeywordDiscoveryMock.mockResolvedValue({
      rows: new Map([
        // 与 SerpApi related 重复的词：合并 origins 而不是生成两行
        ["seo 工具 推荐", {
          keyword: "seo 工具 推荐", origin: "labs_ideas", searchVolume: 900, cpc: null,
          competition: null, competitionLevel: null, difficulty: null, intent: null, trend: null, currency: null,
        }],
      ]),
      seedRow: null,
      warnings: [],
    });

    const result = await researchKeywords("user-1", "pro", { keyword: "seo 工具", location: "中国", device: "PC" });

    const dup = result.keywords.filter((row) => row.keyword === "seo 工具 推荐");
    expect(dup).toHaveLength(1);
    expect(dup[0].origin).toBe("related"); // 首个来源优先
    // related 与 paa 各含该词 + labs_ideas 命中 → 三个来源合并到同一行
    expect(dup[0].origins).toEqual(["related", "paa", "labs_ideas"]);
  });

  it("发现可用与未配置时 metrics.discovery 分别如实标记", async () => {
    fetchKeywordDiscoveryMock.mockResolvedValue({ rows: new Map(), seedRow: null, warnings: [] });
    const ok = await researchKeywords("user-1", "pro", { keyword: "seo 工具", location: "中国", device: "PC" });
    expect(ok.metrics.discovery).toEqual({ source: "dataforseo", fromCache: false, state: "ok" });

    fetchKeywordDiscoveryMock.mockRejectedValue(new DataForSeoNotConfiguredError());
    const bad = await researchKeywords("user-1", "pro", { keyword: "seo 工具", location: "中国", device: "PC" });
    expect(bad.metrics.discovery).toEqual({ source: null, fromCache: false, state: "unconfigured" });
    expect(bad.metrics.warnings.join(" ")).toContain("数据库扩词不可用");

    // 供应商失败 ≠ 未配置：state 如实区分（可重试）
    fetchKeywordDiscoveryMock.mockRejectedValue(new Error("DataForSEO 错误 [50000]: Task in queue"));
    const failed = await researchKeywords("user-1", "pro", { keyword: "seo 工具", location: "中国", device: "PC" });
    expect(failed.metrics.discovery).toEqual({ source: null, fromCache: false, state: "error" });
    expect(failed.metrics.warnings.join(" ")).toContain("Task in queue");
  });

  it("kw-metrics 缓存命中时不调用批量 provider，discovery 未配置不消耗配额", async () => {
    const cachedRows = [
      {
        keyword: "seo 工具",
        searchVolume: 1000,
        cpc: 1.5,
        competition: 0.5,
        competitionLevel: "MEDIUM",
        difficulty: 42,
        intent: null,
        trend: [{ year: 2026, month: 7, searchVolume: 900 }],
        currency: "USD",
      },
    ];
    readCacheMock.mockImplementation((namespace: string) => (namespace === "kw-metrics" ? cachedRows : null));

    const result = await researchKeywords("user-1", "pro", { keyword: "seo 工具", location: "中国", device: "PC", limit: 10 });

    expect(fetchKeywordMetricsMock).not.toHaveBeenCalled();
    // discovery 尝试计费一次（随后因未配置凭据被捕获降级）；补全走缓存不扣费
    expect(consumeQuotaMock).toHaveBeenCalledTimes(1);
    expect(writeCacheMock).not.toHaveBeenCalled();
    expect(result.metrics.fromCache).toBe(true);
    expect(result.metrics.discovery).toEqual({ source: null, fromCache: false, state: "unconfigured" });
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

  it("缓存未命中时调用 provider 并写入缓存（discovery 与补全各计费一次）", async () => {
    fetchKeywordMetricsMock.mockResolvedValue({
      rows: [emptyMetricRow("seo 工具"), emptyMetricRow("seo 工具 推荐"), emptyMetricRow("免费 SEO 工具"), emptyMetricRow("什么是 SEO 工具？")],
      difficultyAvailable: true,
      warnings: [],
    });

    await researchKeywords("user-1", "lite", { keyword: "seo 工具", location: "中国", device: "PC" });

    expect(fetchKeywordMetricsMock).toHaveBeenCalledTimes(1);
    // discovery（双端点一组）+ 批量补全：各自按 1 个 dataforseo 单位计费
    expect(consumeQuotaMock).toHaveBeenCalledTimes(2);
    expect(consumeQuotaMock).toHaveBeenCalledWith("user-1", "dataforseo", "lite");
    expect(writeCacheMock).toHaveBeenCalledTimes(1);
  });

  it("dataforseo 配额超限时优雅降级：扩词结果不受影响、指标为 null", async () => {
    consumeQuotaMock.mockRejectedValue(
      new QuotaExceededError(5, 5, "dataforseo", "2026-08")
    );

    const result = await researchKeywords("user-1", "lite", { keyword: "seo 工具", location: "中国", device: "PC" });

    expect(fetchKeywordMetricsMock).not.toHaveBeenCalled();
    expect(result.keywords).toHaveLength(4);
    expect(result.keywords.every((row) => row.source === "serpapi")).toBe(true);
    expect(result.metrics.source).toBe(null);
    expect(result.metrics.warnings.join(" ")).toContain("dataforseo");
    expect(result.related).toEqual(["seo 工具 推荐", "免费 SEO 工具"]);
  });

  it("enrichMetrics=false 时不请求指标与发现并给出说明", async () => {
    const result = await researchKeywords("user-1", "pro", {
      keyword: "seo 工具", location: "中国", device: "PC", enrichMetrics: false,
    });

    expect(fetchKeywordMetricsMock).not.toHaveBeenCalled();
    expect(fetchKeywordDiscoveryMock).not.toHaveBeenCalled();
    expect(consumeQuotaMock).not.toHaveBeenCalled();
    expect(result.metrics.source).toBe(null);
    expect(result.metrics.discovery).toEqual({ source: null, fromCache: false, state: "unconfigured" });
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

// ===== 市场指标套餐边界（2026-11-01 R3）=====
// A. free(0) + 无缓存 + 无凭据 → 必须说「套餐不含」，不能说「DataForSEO 未配置」
// B. lite/pro + 无缓存 + 无凭据 → 必须说「数据源未配置」，不能说「套餐不含」
// C. 有效缓存 → 任何套餐都按原值返回，不消耗额度、不查套餐表
describe("市场指标套餐边界", () => {
  const metricRow = (keyword: string) => ({ ...emptyMetricRow(keyword), searchVolume: 1200 });

  it("A. free 套餐（额度 0）：不请求 provider、不扣额度、reason=plan_not_included", async () => {
    const result = await enrichKeywordMetrics("user-1", "free", ["seo 工具"], "中国");

    expect(getPlanLimitMock).toHaveBeenCalledWith("free", "dataforseo");
    expect(result.planIncluded).toBe(false);
    expect(result.reason).toBe("plan_not_included");
    expect(result.source).toBe(null);
    expect(result.rows).toEqual([]);
    // 未发起任何请求、未扣任何额度
    expect(assertDataForSeoConfiguredSpy).not.toHaveBeenCalled();
    expect(consumeQuotaMock).not.toHaveBeenCalled();
    expect(fetchKeywordMetricsMock).not.toHaveBeenCalled();
    // 文案指向套餐，而不是凭据
    expect(result.warnings.join(" ")).toContain("不含市场指标额度");
    expect(result.warnings.join(" ")).not.toContain("未配置");
  });

  it("A'. free 套餐即便凭据齐全也仍然不发请求（额度是唯一判定）", async () => {
    vi.stubEnv("DATAFORSEO_LOGIN", "test-login");
    vi.stubEnv("DATAFORSEO_PASSWORD", "test-password");
    const result = await enrichKeywordMetrics("user-1", "free", ["seo 工具"], "中国");
    expect(result.reason).toBe("plan_not_included");
    expect(fetchKeywordMetricsMock).not.toHaveBeenCalled();
    expect(consumeQuotaMock).not.toHaveBeenCalled();
  });

  it("B. lite 套餐 + 凭据缺失：reason=unconfigured，不扣额度、不请求", async () => {
    vi.stubEnv("DATAFORSEO_LOGIN", "");
    vi.stubEnv("DATAFORSEO_PASSWORD", "");

    const result = await enrichKeywordMetrics("user-1", "lite", ["seo 工具"], "中国");

    expect(result.planIncluded).toBe(true);
    expect(result.reason).toBe("unconfigured");
    expect(result.source).toBe(null);
    expect(consumeQuotaMock).not.toHaveBeenCalled();
    expect(fetchKeywordMetricsMock).not.toHaveBeenCalled();
    expect(result.warnings.join(" ")).toContain("未配置 DataForSEO");
    expect(result.warnings.join(" ")).not.toContain("不含市场指标额度");
  });

  it("B'. pro 套餐 + 凭据缺失：同样归因为数据源未配置", async () => {
    vi.stubEnv("DATAFORSEO_LOGIN", "");
    vi.stubEnv("DATAFORSEO_PASSWORD", "");
    const result = await enrichKeywordMetrics("user-1", "pro", ["seo 工具"], "中国");
    expect(result.reason).toBe("unconfigured");
    expect(result.planIncluded).toBe(true);
    expect(consumeQuotaMock).not.toHaveBeenCalled();
  });

  it("B''. lite 套餐额度用尽：reason=quota_exceeded，不退款、不请求 provider", async () => {
    consumeQuotaMock.mockRejectedValue(new QuotaExceededError(5, 5, "dataforseo", "2026-11"));

    const result = await enrichKeywordMetrics("user-1", "lite", ["seo 工具"], "中国");

    // 扣费动作发生了尝试（429 是真实计费边界），但供应商请求为零、无退款
    expect(consumeQuotaMock).toHaveBeenCalledTimes(1);
    expect(refundQuotaMock).not.toHaveBeenCalled();
    expect(fetchKeywordMetricsMock).not.toHaveBeenCalled();
    expect(result.planIncluded).toBe(true);
    expect(result.reason).toBe("quota_exceeded");
    expect(result.source).toBe(null);
    expect(result.rows).toEqual([]);
    // 不得把 429 误标成「套餐不含」或「未配置」
    expect(result.warnings.join(" ")).not.toContain("不含市场指标额度");
    expect(result.warnings.join(" ")).not.toContain("未配置 DataForSEO");
  });

  it("C. free 套餐命中有效缓存：按原值返回、零额度、零套餐查询", async () => {
    readCacheMock.mockResolvedValue([metricRow("seo 工具")]);

    const result = await enrichKeywordMetrics("user-1", "free", ["seo 工具"], "中国");

    expect(result.fromCache).toBe(true);
    expect(result.source).toBe("dataforseo");
    expect(result.rows[0].searchVolume).toBe(1200);
    expect(result.reason).toBe(null);
    expect(getPlanLimitMock).not.toHaveBeenCalled(); // 缓存热路径不查套餐表
    expect(consumeQuotaMock).not.toHaveBeenCalled();
    expect(fetchKeywordMetricsMock).not.toHaveBeenCalled();
  });
});

// ===== 平台凭据错误不得扣减用户额度（2026-11-01 定向修复）=====
describe("DataForSEO 凭据预检与额度", () => {
  it("未配置凭据：扣额度之前就失败，state=unconfigured 且量=0", async () => {
    vi.stubEnv("DATAFORSEO_LOGIN", "");
    vi.stubEnv("DATAFORSEO_PASSWORD", "");

    const result = await researchKeywords("user-1", "pro", {
      keyword: "seo 工具",
      location: "中国",
      device: "PC",
    });

    expect(result.metrics.discovery.state).toBe("unconfigured");
    // 补全与发现都必须失败在扣费之前
    expect(consumeQuotaMock).not.toHaveBeenCalled();
    expect(fetchKeywordDiscoveryMock).not.toHaveBeenCalled();
    expect(fetchKeywordMetricsMock).not.toHaveBeenCalled();
  });

  it("供应商认证失败（401xx）：回滚本次预扣，指标仍按缺失降级", async () => {
    const authError = new DataForSeoApiError(40102, "Invalid login or password");
    fetchKeywordDiscoveryMock.mockRejectedValue(authError);
    fetchKeywordMetricsMock.mockRejectedValue(authError);

    const result = await researchKeywords("user-1", "pro", {
      keyword: "seo 工具",
      location: "中国",
      device: "PC",
    });

    expect(refundQuotaMock).toHaveBeenCalled();
    expect(refundQuotaMock.mock.calls.every((c) => c[1] === "dataforseo")).toBe(true);
    // 指标不外泄成假数值
    expect(result.keywords.every((k) => k.searchVolume === null || typeof k.searchVolume === "number")).toBe(true);
    expect(result.metrics.discovery.state).toBe("error");
  });
});
