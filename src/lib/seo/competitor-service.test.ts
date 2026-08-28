// ===== CompetitorService 单元测试（P0-02-C） =====
// 覆盖：SERP-based discovery（聚合/去重/项目域名排除/平台过滤/阈值/成本上限）、
//       keyword gap 四分类（shared/weaklyOwned/competitorOnly/projectOnly）、
//       rankGap、缺排名、空数据、metrics 降级、授权相关的 DB 依赖由 route 层测试覆盖

import { beforeEach, describe, expect, it, vi } from "vitest";

const searchSerpMock = vi.fn();
const enrichKeywordMetricsMock = vi.fn();
const checkCompetitorRanksMock = vi.fn();
const addCompetitorRankMock = vi.fn();
const getLatestCompetitorRanksMock = vi.fn();

vi.mock("./serp-service", () => ({
  searchSerp: (...args: unknown[]) => searchSerpMock(...args),
  domainsMatch: (a: string, b: string) => {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
  },
  summarizeSerp: vi.fn(),
  calculateSerpOverlap: vi.fn(),
}));

vi.mock("./keyword-research-service", () => ({
  enrichKeywordMetrics: (...args: unknown[]) => enrichKeywordMetricsMock(...args),
  normalizeKeywordForDedup: (k: string) => k.trim().toLowerCase(),
}));

vi.mock("./competitor", () => ({
  checkCompetitorRanks: (...args: unknown[]) => checkCompetitorRanksMock(...args),
}));

vi.mock("@/lib/db", () => ({
  addCompetitorRank: (...args: unknown[]) => addCompetitorRankMock(...args),
  getLatestCompetitorRanks: (...args: unknown[]) => getLatestCompetitorRanksMock(...args),
}));

vi.mock("./serpapi", () => ({
  extractRegistrableDomain: (url: string) => {
    const host = url.replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "").toLowerCase();
    return host;
  },
}));

import {
  classifyDomain,
  discoverCompetitorsFromSerp,
  getCompetitorKeywordGap,
} from "./competitor-service";

function serpFor(keyword: string, rows: Array<{ domain: string; position: number }>) {
  return {
    keyword,
    location: "中国",
    device: "PC" as const,
    fetchedAt: "2026-08-28T00:00:00.000Z",
    organic: rows.map((row) => ({
      position: row.position,
      title: "t",
      link: `https://${row.domain}/page`,
      domain: row.domain,
      snippet: "s",
    })),
    relatedSearches: [],
    relatedQuestions: [],
    features: [],
  };
}

beforeEach(() => {
  searchSerpMock.mockReset();
  enrichKeywordMetricsMock.mockReset().mockResolvedValue({ rows: [], source: null, fromCache: false, warnings: [] });
  checkCompetitorRanksMock.mockReset();
  addCompetitorRankMock.mockReset().mockResolvedValue(undefined);
  getLatestCompetitorRanksMock.mockReset().mockResolvedValue([]);
});

describe("classifyDomain", () => {
  it("平台域名归类 platform，其余为 site", () => {
    expect(classifyDomain("wikipedia.org")).toBe("platform");
    expect(classifyDomain("YouTube.com")).toBe("platform");
    expect(classifyDomain("example.com")).toBe("site");
  });
});

describe("discoverCompetitorsFromSerp", () => {
  it("跨关键词聚合 domain 频次、平均/最佳排名与共同关键词", async () => {
    searchSerpMock.mockImplementation((_u, _p, { keyword }) => {
      if (keyword === "kw a") {
        return Promise.resolve({ result: serpFor("kw a", [
          { domain: "leader.com", position: 1 },
          { domain: "rival.io", position: 3 },
          { domain: "me.site", position: 5 },
        ]) });
      }
      return Promise.resolve({ result: serpFor("kw b", [
        { domain: "leader.com", position: 2 },
        { domain: "other.net", position: 4 },
      ]) });
    });

    const result = await discoverCompetitorsFromSerp("u1", "free", {
      projectDomain: "me.site",
      keywords: ["kw a", "kw b"],
      location: "中国",
      device: "PC",
    });

    expect(result.keywordsAnalyzed).toBe(2);
    const leader = result.competitors.find((c) => c.domain === "leader.com");
    expect(leader).toMatchObject({ frequency: 2, percentage: 100, avgRank: 2, bestRank: 1 });
    expect(leader?.sharedKeywords).toEqual(["kw a", "kw b"]);
    // 项目自身域名被排除
    expect(result.competitors.find((c) => c.domain === "me.site")).toBeUndefined();
    // minAppearances=2 过滤只出现一次的域名
    expect(result.competitors.find((c) => c.domain === "rival.io")).toBeUndefined();
    expect(result.competitors.find((c) => c.domain === "other.net")).toBeUndefined();
  });

  it("minAppearances=1 时单次出现的域名也计入", async () => {
    searchSerpMock.mockResolvedValue({ result: serpFor("kw", [
      { domain: "one.com", position: 1 },
      { domain: "two.com", position: 2 },
    ]) });
    const result = await discoverCompetitorsFromSerp("u1", "free", {
      projectDomain: "me.site", keywords: ["kw"], location: "中国", device: "PC", minAppearances: 1,
    });
    expect(result.competitors).toHaveLength(2);
  });

  it("默认排除平台域名，includePlatforms=true 时保留", async () => {
    searchSerpMock.mockResolvedValue({ result: serpFor("kw", [
      { domain: "wikipedia.org", position: 1 },
      { domain: "shop.com", position: 2 },
    ]) });
    const excluded = await discoverCompetitorsFromSerp("u1", "free", {
      projectDomain: "me.site", keywords: ["kw"], location: "中国", device: "PC", minAppearances: 1,
    });
    expect(excluded.competitors.find((c) => c.domain === "wikipedia.org")).toBeUndefined();

    const included = await discoverCompetitorsFromSerp("u1", "free", {
      projectDomain: "me.site", keywords: ["kw"], location: "中国", device: "PC", minAppearances: 1, includePlatforms: true,
    });
    expect(included.competitors.find((c) => c.domain === "wikipedia.org")).toMatchObject({ category: "platform" });
  });

  it("项目子域名也被排除；关键词去重；limit 截断", async () => {
    searchSerpMock.mockImplementation((_u, _p, { keyword }) =>
      Promise.resolve({ result: serpFor(keyword, [
        { domain: `blog.me.site`, position: 1 },
        { domain: keyword === "a" ? "x1.com" : "x2.com", position: 2 },
        { domain: "x3.com", position: 3 },
      ]) })
    );
    const result = await discoverCompetitorsFromSerp("u1", "free", {
      projectDomain: "me.site",
      keywords: ["a", "A ", "b"], // "a" 与 "A " 去重
      location: "中国", device: "PC", minAppearances: 1, limit: 1,
    });
    expect(result.competitors).toHaveLength(1);
    expect(searchSerpMock).toHaveBeenCalledTimes(2); // a, b（去重后）
  });

  it("空关键词列表直接返回空结果且不调 SERP", async () => {
    const result = await discoverCompetitorsFromSerp("u1", "free", {
      projectDomain: "me.site", keywords: [], location: "中国", device: "PC",
    });
    expect(result.competitors).toEqual([]);
    expect(result.keywordsAnalyzed).toBe(0);
    expect(searchSerpMock).not.toHaveBeenCalled();
  });

  it("单关键词 SERP 失败记录 warning 不中断，全部失败时 competitors 为空", async () => {
    searchSerpMock.mockRejectedValue(new Error("SerpApi 超时"));
    const result = await discoverCompetitorsFromSerp("u1", "free", {
      projectDomain: "me.site", keywords: ["a", "b"], location: "中国", device: "PC",
    });
    expect(result.keywordsAnalyzed).toBe(0);
    expect(result.competitors).toEqual([]);
    expect(result.warnings.join(" ")).toContain("SerpApi 超时");
  });

  it("所有结果来自同一域名时仍能产出该候选", async () => {
    searchSerpMock.mockResolvedValue({ result: serpFor("kw", [
      { domain: "monopoly.com", position: 1 },
      { domain: "monopoly.com", position: 2 },
    ]) });
    const result = await discoverCompetitorsFromSerp("u1", "free", {
      projectDomain: "me.site", keywords: ["kw"], location: "中国", device: "PC", minAppearances: 1,
    });
    expect(result.competitors[0]).toMatchObject({ domain: "monopoly.com", frequency: 1, avgRank: 2, bestRank: 1 });
  });
});

describe("getCompetitorKeywordGap", () => {
  const tracked = [
    { id: 1, keyword: "kw shared", location: "中国", device: "PC" as const, todayPosition: 5, todayUrl: "https://me.site/a" },
    { id: 2, keyword: "kw weak", location: "中国", device: "PC" as const, todayPosition: 12, todayUrl: null },
    { id: 3, keyword: "kw comp-only", location: "中国", device: "PC" as const, todayPosition: null, todayUrl: null },
    { id: 4, keyword: "kw proj-only", location: "中国", device: "PC" as const, todayPosition: 3, todayUrl: "https://me.site/d" },
    { id: 5, keyword: "kw none", location: "中国", device: "PC" as const, todayPosition: null, todayUrl: null },
  ];

  function mockCompetitorRanks(mapping: Record<number, number | null>) {
    getLatestCompetitorRanksMock.mockImplementation(async (_u, keywordId) =>
      mapping[keywordId] === undefined ? [] : [{
        competitor_id: 11, domain: "rival.com", rank: mapping[keywordId], target_url: `https://rival.com/${keywordId}`, checked_at: "2026-08-28 00:00:00",
      }]
    );
  }

  it("四分类 + rankGap + 汇总；双方均无排名的关键词跳过", async () => {
    // kw shared: 5 vs 4 → shared；kw weak: 12 vs 2 → weaklyOwned（competitor<=10 且 gap>=5）；
    // kw comp-only: null vs 7 → competitorOnly；kw proj-only: 3 vs null → projectOnly；kw none: 跳过
    mockCompetitorRanks({ 1: 4, 2: 2, 3: 7, 4: null });

    const result = await getCompetitorKeywordGap({
      userId: "u1", plan: "lite",
      projectDomain: "me.site", trackedKeywords: tracked,
      competitorId: 11, competitorDomain: "rival.com",
      enrichMetrics: false,
    });

    expect(result.competitor).toEqual({ id: 11, domain: "rival.com", registrableDomain: "rival.com" });
    expect(result.summary).toEqual({ analyzedKeywords: 4, shared: 1, weaklyOwned: 1, competitorOnly: 1, projectOnly: 1 });
    const shared = result.keywords.find((k) => k.keyword === "kw shared");
    expect(shared).toMatchObject({ projectRank: 5, competitorRank: 4, rankGap: 1, category: "shared" });
    expect(result.keywords.find((k) => k.keyword === "kw weak")).toMatchObject({ category: "weaklyOwned", rankGap: 10 });
    expect(result.keywords.find((k) => k.keyword === "kw comp-only")).toMatchObject({ category: "competitorOnly", rankGap: null });
    expect(result.keywords.find((k) => k.keyword === "kw proj-only")).toMatchObject({ category: "projectOnly" });
    expect(result.keywords.find((k) => k.keyword === "kw none")).toBeUndefined();
    // 排序：competitorOnly → weaklyOwned → shared → projectOnly
    expect(result.keywords.map((k) => k.category)).toEqual(["competitorOnly", "weaklyOwned", "shared", "projectOnly"]);
  });

  it("enrichMetrics=true 时经 enrichKeywordMetrics 补全并按 location 分组", async () => {
    mockCompetitorRanks({ 1: 2 });
    enrichKeywordMetricsMock.mockResolvedValue({
      rows: [{ keyword: "kw shared", searchVolume: 900, cpc: 1.1, competition: 0.4, competitionLevel: "MEDIUM", difficulty: 33, intent: null, trend: null, currency: "USD" }],
      source: "dataforseo", fromCache: false, warnings: [],
    });

    const result = await getCompetitorKeywordGap({
      userId: "u1", plan: "lite",
      projectDomain: "me.site", trackedKeywords: tracked.slice(0, 1),
      competitorId: 11, competitorDomain: "rival.com",
    });

    expect(enrichKeywordMetricsMock).toHaveBeenCalledWith("u1", "lite", ["kw shared"], "中国");
    expect(result.keywords[0]).toMatchObject({ searchVolume: 900, difficulty: 33, cpc: 1.1, competition: 0.4 });
  });

  it("metrics 补全失败优雅降级：keywords 保留、metrics 为 null、warning 记录", async () => {
    mockCompetitorRanks({ 1: 2 });
    enrichKeywordMetricsMock.mockResolvedValue({
      rows: [], source: null, fromCache: false, warnings: ["keyword metrics 不可用：quota"],
    });

    const result = await getCompetitorKeywordGap({
      userId: "u1", plan: "free",
      projectDomain: "me.site", trackedKeywords: tracked.slice(0, 1),
      competitorId: 11, competitorDomain: "rival.com",
    });

    expect(result.keywords[0]).toMatchObject({ searchVolume: null, difficulty: null });
    expect(result.warnings.join(" ")).toContain("quota");
  });

  it("refresh=true 时经 checkCompetitorRanks 刷新并入库竞品排名", async () => {
    checkCompetitorRanksMock.mockResolvedValue({
      results: [
        { competitorId: 0, domain: "me.site", rank: 6, targetUrl: "https://me.site/a" },
        { competitorId: 11, domain: "rival.com", rank: 1, targetUrl: "https://rival.com/x" },
      ],
      fromCache: false,
      usage: { used: 1, limit: 30, month: "2026-08" },
    });

    const result = await getCompetitorKeywordGap({
      userId: "u1", plan: "lite",
      projectDomain: "me.site",
      trackedKeywords: [{ id: 1, keyword: "kw", location: "中国", device: "PC", todayPosition: null, todayUrl: null }],
      competitorId: 11, competitorDomain: "rival.com",
      refresh: true,
      enrichMetrics: false,
    });

    expect(checkCompetitorRanksMock).toHaveBeenCalledTimes(1);
    expect(addCompetitorRankMock).toHaveBeenCalledWith("u1", {
      competitor_id: 11, keyword_id: 1, rank: 1, target_url: "https://rival.com/x",
    });
    // todayPosition 为 null 时用本次 SERP 自排名兜底
    expect(result.keywords[0]).toMatchObject({ projectRank: 6, competitorRank: 1, category: "weaklyOwned" });
  });

  it("空 tracked keywords → 空 gap", async () => {
    const result = await getCompetitorKeywordGap({
      userId: "u1", plan: "free",
      projectDomain: "me.site", trackedKeywords: [],
      competitorId: 11, competitorDomain: "rival.com",
    });
    expect(result.summary.analyzedKeywords).toBe(0);
    expect(result.keywords).toEqual([]);
  });

  it("limit 截断输出", async () => {
    mockCompetitorRanks({ 1: 2, 2: 3, 3: 4 });
    const many = [1, 2, 3].map((i) => ({
      id: i, keyword: `kw ${i}`, location: "中国", device: "PC" as const,
      todayPosition: null, todayUrl: null,
    }));
    const result = await getCompetitorKeywordGap({
      userId: "u1", plan: "free",
      projectDomain: "me.site", trackedKeywords: many,
      competitorId: 11, competitorDomain: "rival.com",
      limit: 2, enrichMetrics: false,
    });
    expect(result.keywords).toHaveLength(2);
    expect(result.summary.analyzedKeywords).toBe(3);
  });
});
