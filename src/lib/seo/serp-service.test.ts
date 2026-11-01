// ===== SerpService 单元测试（P0-02-B SERP Intelligence） =====
// 覆盖：cache key 隔离（device/location/language/providerVersion）、旧缓存归一化、
//       quota 只在 miss 时消耗、summarizeSerp（域名频次/项目识别）、calculateSerpOverlap

import { beforeEach, describe, expect, it, vi } from "vitest";

const readCacheMock = vi.fn();
const writeCacheMock = vi.fn();
const consumeQuotaMock = vi.fn();
const peekUsageMock = vi.fn();
const refundQuotaMock = vi.fn();
const assertSerpApiConfiguredMock = vi.fn();
const searchSerpProviderMock = vi.fn();
const checkRankProviderMock = vi.fn();
const autocompleteProviderMock = vi.fn();

vi.mock("./cache", () => ({
  readCache: (...args: unknown[]) => readCacheMock(...args),
  writeCache: (...args: unknown[]) => writeCacheMock(...args),
  consumeQuota: (...args: unknown[]) => consumeQuotaMock(...args),
  peekUsage: (...args: unknown[]) => peekUsageMock(...args),
  refundQuota: (...args: unknown[]) => refundQuotaMock(...args),
}));

const relatedQuestionsProviderMock = vi.fn();

vi.mock("./serpapi", () => ({
  serpApiProvider: {
    searchSerp: (...args: unknown[]) => searchSerpProviderMock(...args),
    checkRank: (...args: unknown[]) => checkRankProviderMock(...args),
  },
  fetchRelatedQuestions: (...args: unknown[]) => relatedQuestionsProviderMock(...args),
  fetchAutocompleteSuggestions: (...args: unknown[]) => autocompleteProviderMock(...args),
  // 与真实实现同规则的最小镜像：未配置凭据时抛 INVALID_KEY（预检）
  assertSerpApiConfigured: () => assertSerpApiConfiguredMock(),
  // 与真实实现同规则的最小镜像（市场默认 hl；显式 language 优先）
  resolveSerpHl: (location: string, language?: string) =>
    language?.trim() || (location === "美国" || location === "英国" ? "en" : "zh-cn"),
}));

import {
  calculateSerpOverlap,
  expandPaaQuestions,
  fetchKeywordSuggestions,
  searchRank,
  searchSerp,
  summarizeSerp,
} from "./serp-service";
import { SeoProviderError } from "./provider";
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
  refundQuotaMock.mockReset().mockResolvedValue(undefined);
  assertSerpApiConfiguredMock.mockReset().mockImplementation(() => undefined);
  searchSerpProviderMock.mockReset().mockResolvedValue(makeSerpResult());
  checkRankProviderMock.mockReset();
  autocompleteProviderMock.mockReset().mockResolvedValue([]);
  relatedQuestionsProviderMock.mockReset().mockResolvedValue({ questions: [] });
});

describe("searchSerp cache", () => {
  it("cache key 包含 provider 版本 + keyword + location + language + device", async () => {
    await searchSerp("u1", "free", { keyword: "kw", location: "中国", device: "PC" });
    expect(readCacheMock).toHaveBeenCalledWith("serp", {
      provider: "serpapi-v5",
      keyword: "kw",
      location: "中国",
      language: "",
      device: "PC",
    });
  });

  it("不同 device / location / language 使用不同 cache key（不共用快照）", async () => {
    const cases: [string, Record<string, string>][] = [
      ["desktop-default", { provider: "serpapi-v5", keyword: "kw", location: "中国", language: "", device: "PC" }],
      ["mobile", { provider: "serpapi-v5", keyword: "kw", location: "中国", language: "", device: "移动端" }],
      ["us", { provider: "serpapi-v5", keyword: "kw", location: "美国", language: "", device: "PC" }],
      ["en", { provider: "serpapi-v5", keyword: "kw", location: "中国", language: "en", device: "PC" }],
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

  it("SERP 分页：start>0 进入 cache key（逐页独立缓存），start=0/缺省与旧 key 保持一致", async () => {
    await searchSerp("u1", "free", { keyword: "kw", location: "中国", device: "PC", start: 10 });
    expect(readCacheMock).toHaveBeenLastCalledWith("serp", {
      provider: "serpapi-v5",
      keyword: "kw",
      location: "中国",
      language: "",
      device: "PC",
      start: "10",
    });
    // 缺省 start：cache key 不含 start 字段（与分页前的历史 key 字节一致）
    await searchSerp("u1", "free", { keyword: "kw", location: "中国", device: "PC" });
    expect(readCacheMock).toHaveBeenLastCalledWith("serp", {
      provider: "serpapi-v5",
      keyword: "kw",
      location: "中国",
      language: "",
      device: "PC",
    });
    // start=0 等价缺省
    await searchSerp("u1", "free", { keyword: "kw", location: "中国", device: "PC", start: 0 });
    expect(readCacheMock).toHaveBeenLastCalledWith("serp", {
      provider: "serpapi-v5",
      keyword: "kw",
      location: "中国",
      language: "",
      device: "PC",
    });
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
      provider: "serpapi-v3", keyword: "kw", domain: "me.site", location: "中国", language: "", device: "PC",
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
    expect(keys).toContain(JSON.stringify({ provider: "serpapi-v3", keyword: "kw", domain: "me.site", location: "中国", language: "", device: "移动端" }));
    expect(keys).toContain(JSON.stringify({ provider: "serpapi-v3", keyword: "kw", domain: "me.site", location: "中国", language: "en", device: "PC" }));
  });
});

describe("fetchKeywordSuggestions（Google 自动补全，用户主动触发）", () => {
  it("cache miss 时：消耗一次 serpapi 配额 → provider 调用 → 写 suggest 缓存（24h TTL 由 cache 层默认）", async () => {
    autocompleteProviderMock.mockResolvedValue([
      { value: "seo audit tool free", relevance: 900, type: "QUERY" },
      { value: "seo audit checklist", relevance: 800 },
    ]);
    const result = await fetchKeywordSuggestions("u1", "free", { keyword: "SEO Audit", location: "美国" });

    expect(consumeQuotaMock).toHaveBeenCalledTimes(1);
    expect(consumeQuotaMock).toHaveBeenCalledWith("u1", "serpapi", "free");
    expect(autocompleteProviderMock).toHaveBeenCalledTimes(1);
    expect(autocompleteProviderMock).toHaveBeenCalledWith("SEO Audit", "美国", undefined);
    expect(writeCacheMock).toHaveBeenCalledWith("suggest", {
      provider: "serpapi-ac-v1",
      keyword: "seo audit",
      location: "美国",
      language: "",
    }, ["seo audit tool free", "seo audit checklist"]);
    expect(result.suggestions).toEqual(["seo audit tool free", "seo audit checklist"]);
    expect(result.fromCache).toBe(false);
    expect(result.language).toBe("en");
  });

  it("cache 命中时零 provider 调用、零扣费", async () => {
    readCacheMock.mockResolvedValue(["cached suggestion"]);
    const result = await fetchKeywordSuggestions("u1", "free", { keyword: "kw", location: "中国" });
    expect(autocompleteProviderMock).not.toHaveBeenCalled();
    expect(consumeQuotaMock).not.toHaveBeenCalled();
    expect(result.suggestions).toEqual(["cached suggestion"]);
    expect(result.fromCache).toBe(true);
  });

  it("并发去重：同关键词/市场的并发请求共享同一次 provider 调用（双击不重复扣费）", async () => {
    autocompleteProviderMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([{ value: "s1" }]), 10))
    );
    const [a, b] = await Promise.all([
      fetchKeywordSuggestions("u1", "free", { keyword: "kw", location: "中国" }),
      fetchKeywordSuggestions("u1", "free", { keyword: "kw", location: "中国" }),
    ]);
    expect(autocompleteProviderMock).toHaveBeenCalledTimes(1);
    expect(consumeQuotaMock).toHaveBeenCalledTimes(1);
    expect(a.suggestions).toEqual(["s1"]);
    expect(b.suggestions).toEqual(["s1"]);
  });

  it("provider 失败时错误上抛（路由层负责映射 429/504 等），不写缓存", async () => {
    autocompleteProviderMock.mockRejectedValue(new Error("TIMEOUT"));
    await expect(
      fetchKeywordSuggestions("u1", "free", { keyword: "kw", location: "中国" })
    ).rejects.toThrow("TIMEOUT");
    expect(writeCacheMock).not.toHaveBeenCalled();
  });

  it("language 参与缓存 key；不同语言各自独立", async () => {
    await fetchKeywordSuggestions("u1", "free", { keyword: "kw", location: "中国", language: "en" });
    await fetchKeywordSuggestions("u1", "free", { keyword: "kw", location: "中国" });
    const keys = readCacheMock.mock.calls
      .filter((call) => call[0] === "suggest")
      .map((call) => JSON.stringify(call[1]));
    expect(new Set(keys).size).toBe(2);
    expect(keys).toContain(JSON.stringify({ provider: "serpapi-ac-v1", keyword: "kw", location: "中国", language: "en" }));
  });
});

// ===== PAA 深度展开（P7）：token 缓存/配额/并发去重 =====
describe("expandPaaQuestions cache", () => {
  it("miss：consumeQuota 后调用 provider，写入缓存并返回 fromCache:false", async () => {
    relatedQuestionsProviderMock.mockResolvedValue({
      questions: [{ question: "Child?", nextPageToken: "tok2" }],
    });
    const { questions, fromCache } = await expandPaaQuestions("u1", "free", "tok1");
    expect(fromCache).toBe(false);
    expect(questions).toEqual([{ question: "Child?", nextPageToken: "tok2" }]);
    expect(consumeQuotaMock).toHaveBeenCalledTimes(1);
    expect(consumeQuotaMock).toHaveBeenCalledWith("u1", "serpapi", "free");
    expect(readCacheMock).toHaveBeenCalledWith("paa", { provider: "serpapi-paa-v1", token: "tok1" });
    expect(writeCacheMock).toHaveBeenCalledWith(
      "paa",
      { provider: "serpapi-paa-v1", token: "tok1" },
      [{ question: "Child?", nextPageToken: "tok2" }]
    );
  });

  it("hit：缓存命中零消耗，不调用 provider", async () => {
    readCacheMock.mockResolvedValue([{ question: "Cached?" }]);
    const { questions, fromCache } = await expandPaaQuestions("u1", "free", "tok1");
    expect(fromCache).toBe(true);
    expect(questions).toEqual([{ question: "Cached?" }]);
    expect(consumeQuotaMock).not.toHaveBeenCalled();
    expect(relatedQuestionsProviderMock).not.toHaveBeenCalled();
  });

  it("token 前后空白归一：同 token 共享缓存 key 与并发 Promise", async () => {
    let resolveProvider: (v: unknown) => void = () => {};
    relatedQuestionsProviderMock.mockReturnValue(
      new Promise((resolve) => { resolveProvider = resolve; })
    );
    const a = expandPaaQuestions("u1", "free", "  tok-x  ");
    const b = expandPaaQuestions("u1", "free", "tok-x");
    resolveProvider({ questions: [{ question: "Q?" }] });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(rb);
    expect(consumeQuotaMock).toHaveBeenCalledTimes(1);
  });
});

// ===== 平台凭据错误不得扣减用户额度（2026-11-01 定向修复）=====
// 契约：
//   1) 未配置凭据 → 配置预检在 consumeQuota **之前**抛 INVALID_KEY（量=0、不请求）
//   2) 供应商判定 Key 无效 → 回滚本次预扣（refundQuota 被调用一次）
//   3) 其他错误（超时/上游故障/额度超限）不回滚：这些是真实请求的正常结果
describe("凭据错误与额度一致性", () => {
  it("未配置 SERPAPI_KEY：预检失败，不扣额度、不请求供应商", async () => {
    assertSerpApiConfiguredMock.mockImplementation(() => {
      throw new SeoProviderError("INVALID_KEY", "服务端未配置 SERPAPI_KEY");
    });

    await expect(
      searchSerp("u1", "free", { keyword: "kw", location: "中国", device: "PC" })
    ).rejects.toThrow(SeoProviderError);

    expect(consumeQuotaMock).not.toHaveBeenCalled();
    expect(refundQuotaMock).not.toHaveBeenCalled();
    expect(searchSerpProviderMock).not.toHaveBeenCalled();
  });

  it("搜索：供应商判定 Key 无效 → 回滚本次预扣（serpapi）", async () => {
    searchSerpProviderMock.mockRejectedValue(new SeoProviderError("INVALID_KEY", "SerpApi Key 无效"));

    await expect(
      searchSerp("u1", "free", { keyword: "kw", location: "中国", device: "PC" })
    ).rejects.toThrow(SeoProviderError);

    expect(consumeQuotaMock).toHaveBeenCalledTimes(1);
    expect(refundQuotaMock).toHaveBeenCalledTimes(1);
    expect(refundQuotaMock).toHaveBeenCalledWith("u1", "serpapi", "free");
    expect(writeCacheMock).not.toHaveBeenCalled();
  });

  it("rank / 建议词 / PAA 同样预检 + 认证失败回滚", async () => {
    assertSerpApiConfiguredMock.mockImplementation(() => {
      throw new SeoProviderError("INVALID_KEY", "未配置");
    });
    await expect(
      searchRank("u1", "free", { keyword: "kw", domain: "a.com", location: "中国", device: "PC" })
    ).rejects.toThrow(SeoProviderError);
    await expect(
      fetchKeywordSuggestions("u1", "free", { keyword: "kw", location: "中国" })
    ).rejects.toThrow(SeoProviderError);
    await expect(expandPaaQuestions("u1", "free", "tok-cred")).rejects.toThrow(SeoProviderError);
    expect(consumeQuotaMock).not.toHaveBeenCalled();

    assertSerpApiConfiguredMock.mockImplementation(() => undefined);
    checkRankProviderMock.mockRejectedValue(new SeoProviderError("INVALID_KEY", "无效"));
    await expect(
      searchRank("u1", "free", { keyword: "kw2", domain: "a.com", location: "中国", device: "PC" })
    ).rejects.toThrow(SeoProviderError);
    expect(refundQuotaMock).toHaveBeenCalledWith("u1", "serpapi", "free");
  });

  it("超时/上游故障超出凭据错误范围：不回滚（真实请求已发出）", async () => {
    searchSerpProviderMock.mockRejectedValue(new SeoProviderError("TIMEOUT", "超时"));
    await expect(
      searchSerp("u1", "free", { keyword: "kw", location: "中国", device: "PC" })
    ).rejects.toThrow(SeoProviderError);
    expect(consumeQuotaMock).toHaveBeenCalledTimes(1);
    expect(refundQuotaMock).not.toHaveBeenCalled();
  });
});
