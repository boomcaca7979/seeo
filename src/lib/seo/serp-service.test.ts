// ===== SerpService 单元测试（P0-02-B SERP Intelligence） =====
// 覆盖：cache key 隔离（device/location/language/providerVersion）、旧缓存归一化、
//       quota 只在 miss 时消耗、summarizeSerp（域名频次/项目识别）、calculateSerpOverlap

import { beforeEach, describe, expect, it, vi } from "vitest";

const readCacheMock = vi.fn();
const writeCacheMock = vi.fn();
const consumeQuotaMock = vi.fn();
const peekUsageMock = vi.fn();
const searchSerpProviderMock = vi.fn();
const checkRankProviderMock = vi.fn();

vi.mock("./cache", () => ({
  readCache: (...args: unknown[]) => readCacheMock(...args),
  writeCache: (...args: unknown[]) => writeCacheMock(...args),
  consumeQuota: (...args: unknown[]) => consumeQuotaMock(...args),
  peekUsage: (...args: unknown[]) => peekUsageMock(...args),
}));

vi.mock("./serpapi", () => ({
  serpApiProvider: {
    searchSerp: (...args: unknown[]) => searchSerpProviderMock(...args),
    checkRank: (...args: unknown[]) => checkRankProviderMock(...args),
  },
}));

import {
  calculateSerpOverlap,
  searchRank,
  searchSerp,
  summarizeSerp,
} from "./serp-service";
import type { SerpResult } from "./types";

const usage = { used: 1, limit: 30, month: "2026-08" };

function makeSerpResult(overrides: Partial<SerpResult> = {}): SerpResult {
  return {
    keyword: "seo 工具",
    location: "中国",
    device: "PC",
    fetchedAt: "2026-08-28T00:00:00.000Z",
    organic: [
      { position: 1, title: "A", link: "https://a.example.com/1", domain: "example.com", snippet: "s" },
      { position: 2, title: "B", link: "https://blog.example.com/2", domain: "example.com", snippet: "s" },
      { position: 3, title: "C", link: "https://other.org/3", domain: "other.org", snippet: "s" },
    ],
    relatedSearches: [],
    relatedQuestions: [],
    ...overrides,
  };
}

beforeEach(() => {
  readCacheMock.mockReset().mockResolvedValue(null);
  writeCacheMock.mockReset().mockResolvedValue(undefined);
  consumeQuotaMock.mockReset().mockResolvedValue(usage);
  peekUsageMock.mockReset().mockResolvedValue(usage);
  searchSerpProviderMock.mockReset().mockResolvedValue(makeSerpResult());
  checkRankProviderMock.mockReset();
});

describe("searchSerp cache", () => {
  it("cache key 包含 provider 版本 + keyword + location + language + device", async () => {
    await searchSerp("u1", "free", { keyword: "kw", location: "中国", device: "PC" });
    expect(readCacheMock).toHaveBeenCalledWith("serp", {
      provider: "serpapi-v2",
      keyword: "kw",
      location: "中国",
      language: "",
      device: "PC",
    });
  });

  it("不同 device / location / language 使用不同 cache key（不共用快照）", async () => {
    const cases: [string, Record<string, string>][] = [
      ["desktop-default", { provider: "serpapi-v2", keyword: "kw", location: "中国", language: "", device: "PC" }],
      ["mobile", { provider: "serpapi-v2", keyword: "kw", location: "中国", language: "", device: "移动端" }],
      ["us", { provider: "serpapi-v2", keyword: "kw", location: "美国", language: "", device: "PC" }],
      ["en", { provider: "serpapi-v2", keyword: "kw", location: "中国", language: "en", device: "PC" }],
    ];
    const keys = new Set<string>();
    for (const [, expected] of cases) {
      await searchSerp("u1", "free", {
        keyword: expected.keyword,
        location: expected.location,
        device: expected.device as "PC" | "移动端",
        ...(expected.language ? { language: expected.language } : {}),
      });
      keys.add(JSON.stringify(expected));
    }
    // 每次调用都产生独立的 cache key（readCache 参数互不相同）
    const calls = readCacheMock.mock.calls.map((call) => JSON.stringify(call[1]));
    expect(new Set(calls).size).toBe(calls.length);
    for (const [, expected] of cases) {
      expect(calls).toContain(JSON.stringify(expected));
    }
  });

  it("命中缓存时不调 provider、不消耗 quota，并归一化旧缓存缺失的 features/language", async () => {
    // 模拟 P0-02-B 之前的旧缓存条目：无 features/language
    const legacy = makeSerpResult() as SerpResult;
    delete (legacy as Partial<SerpResult>).features;
    delete (legacy as Partial<SerpResult>).language;
    readCacheMock.mockResolvedValue(legacy);

    const { result, fromCache } = await searchSerp("u1", "free", { keyword: "seo 工具", location: "中国", device: "PC" });

    expect(searchSerpProviderMock).not.toHaveBeenCalled();
    expect(consumeQuotaMock).not.toHaveBeenCalled();
    expect(fromCache).toBe(true);
    expect(result.features).toEqual([]);
    expect(result.language).toBe("zh-cn");
    expect(result.fromCache).toBe(true);
  });

  it("cache miss 时消耗一次 serpapi quota 并写缓存", async () => {
    await searchSerp("u1", "lite", { keyword: "kw", location: "中国", device: "PC" });
    expect(consumeQuotaMock).toHaveBeenCalledTimes(1);
    expect(consumeQuotaMock).toHaveBeenCalledWith("u1", "serpapi", "lite");
    expect(searchSerpProviderMock).toHaveBeenCalledTimes(1);
    expect(writeCacheMock).toHaveBeenCalledTimes(1);
  });
});

describe("summarizeSerp", () => {
  it("统计 domain 频次与 topDomains（降序）", () => {
    const summary = summarizeSerp(makeSerpResult());
    expect(summary.organicCount).toBe(3);
    expect(summary.domainFrequency).toEqual({ "example.com": 2, "other.org": 1 });
    expect(summary.topDomains[0]).toEqual({ domain: "example.com", count: 2 });
    expect(summary.featureCount).toBe(0);
    expect(summary.featureTypes).toEqual([]);
  });

  it("项目域名识别：子域名也算命中，返回首个命中位置与 URL", () => {
    const result = makeSerpResult();
    result.organic[1].link = "https://www.example.com/2";
    const summary = summarizeSerp(result, "example.com");
    expect(summary.projectPresent).toBe(true);
    expect(summary.projectRank).toBe(1);
    expect(summary.projectRankingUrl).toBe("https://a.example.com/1");
  });

  it("项目域名不在结果中：projectPresent=false、rank=null", () => {
    const summary = summarizeSerp(makeSerpResult(), "seeo.asia");
    expect(summary.projectPresent).toBe(false);
    expect(summary.projectRank).toBe(null);
    expect(summary.projectRankingUrl).toBe(null);
  });

  it("未提供项目域名时为 null（区分「无上下文」与「不在结果里」）", () => {
    const summary = summarizeSerp(makeSerpResult());
    expect(summary.projectPresent).toBe(null);
    expect(summary.projectRank).toBe(null);
  });

  it("feature 统计来自 provider 真实块", () => {
    const summary = summarizeSerp(makeSerpResult({
      features: [
        { featureType: "featured_snippet", position: 1, title: "t", url: "u" },
        { featureType: "local_pack", position: 3, title: null, url: null },
      ],
    }));
    expect(summary.featureCount).toBe(2);
    expect(summary.featureTypes).toEqual(["featured_snippet", "local_pack"]);
  });
});

describe("calculateSerpOverlap", () => {
  const resultA = { organic: [
    { position: 1, title: "", link: "https://a.example.com/1", domain: "example.com", snippet: "" },
    { position: 2, title: "", link: "https://shared.org/x", domain: "shared.org", snippet: "" },
    { position: 3, title: "", link: "https://only-a.net/", domain: "only-a.net", snippet: "" },
  ] };
  const resultB = { organic: [
    { position: 1, title: "", link: "https://www.example.com/other-page", domain: "example.com", snippet: "" },
    { position: 2, title: "", link: "https://shared.org/x", domain: "shared.org", snippet: "" },
    { position: 3, title: "", link: "https://b-only.io/", domain: "b-only.io", snippet: "" },
  ] };

  it("domain 粒度：Jaccard = 交集/并集", () => {
    // 交集：example.com, shared.org；并集：example.com, shared.org, only-a.net, b-only.io
    const result = calculateSerpOverlap(resultA, resultB);
    expect(result.commonCount).toBe(2);
    expect(result.unionCount).toBe(4);
    expect(result.overlap).toBe(0.5);
    expect(result.common).toEqual(["example.com", "shared.org"]);
  });

  it("url 粒度：同域名不同页面不算重叠", () => {
    const result = calculateSerpOverlap(resultA, resultB, "url");
    expect(result.commonCount).toBe(1); // 仅 shared.org/x 完全一致
    expect(result.overlap).toBe(1 / 5);
  });

  it("完全相同 → 1；完全不相交 → 0", () => {
    const single = { organic: [resultA.organic[0]] };
    expect(calculateSerpOverlap(single, single).overlap).toBe(1);
    const disjoint = { organic: [{ position: 1, title: "", link: "https://z.io/", domain: "z.io", snippet: "" }] };
    const other = { organic: [{ position: 1, title: "", link: "https://y.io/", domain: "y.io", snippet: "" }] };
    expect(calculateSerpOverlap(disjoint, other).overlap).toBe(0);
  });

  it("一侧为空且并集非空 → 0；两侧均为空 → overlap=null（无有意义基数）", () => {
    const empty = { organic: [] };
    expect(calculateSerpOverlap(empty, resultA).overlap).toBe(0);
    expect(calculateSerpOverlap(resultA, empty).overlap).toBe(0);
    expect(calculateSerpOverlap(empty, empty)).toEqual({ overlap: null, commonCount: 0, unionCount: 0, common: [] });
  });
});

describe("searchRank（P0-02-D 统一 rank 检查）", () => {
  const rankResult = {
    keyword: "kw", domain: "me.site", location: "中国", device: "PC" as const,
    fetchedAt: "2026-08-28T00:00:00.000Z", rank: 8, matchedUrl: "https://me.site/a",
  };

  beforeEach(() => {
    checkRankProviderMock.mockReset().mockResolvedValue(rankResult);
  });

  it("cache miss 时经 provider 查询并单点计费，key 含 provider 版本 + language + device", async () => {
    const result = await searchRank("u1", "lite", { keyword: "kw", domain: "me.site", location: "中国", device: "PC" });

    expect(checkRankProviderMock).toHaveBeenCalledTimes(1);
    expect(consumeQuotaMock).toHaveBeenCalledTimes(1);
    expect(consumeQuotaMock).toHaveBeenCalledWith("u1", "serpapi", "lite");
    expect(writeCacheMock).toHaveBeenCalledWith("rank", {
      provider: "serpapi-v1", keyword: "kw", domain: "me.site", location: "中国", language: "", device: "PC",
    }, rankResult);
    expect(result.result.rank).toBe(8);
    expect(result.fromCache).toBe(false);
  });

  it("cache 命中时零 provider 调用、零扣费", async () => {
    readCacheMock.mockResolvedValue(rankResult);
    const result = await searchRank("u1", "free", { keyword: "kw", domain: "me.site", location: "中国", device: "PC" });
    expect(checkRankProviderMock).not.toHaveBeenCalled();
    expect(consumeQuotaMock).not.toHaveBeenCalled();
    expect(result.fromCache).toBe(true);
    expect(result.result.rank).toBe(8);
  });

  it("不同 device / location / language 使用不同 cache key", async () => {
    await searchRank("u1", "free", { keyword: "kw", domain: "me.site", location: "中国", device: "PC" });
    await searchRank("u1", "free", { keyword: "kw", domain: "me.site", location: "中国", device: "移动端" });
    await searchRank("u1", "free", { keyword: "kw", domain: "me.site", location: "美国", device: "PC" });
    await searchRank("u1", "free", { keyword: "kw", domain: "me.site", location: "中国", device: "PC", language: "en" });
    const keys = readCacheMock.mock.calls.map((call) => JSON.stringify(call[1]));
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain(JSON.stringify({ provider: "serpapi-v1", keyword: "kw", domain: "me.site", location: "中国", language: "", device: "移动端" }));
    expect(keys).toContain(JSON.stringify({ provider: "serpapi-v1", keyword: "kw", domain: "me.site", location: "中国", language: "en", device: "PC" }));
  });
});
