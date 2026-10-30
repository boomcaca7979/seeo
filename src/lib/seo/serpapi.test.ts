// ===== SerpApi Provider 单元测试（P0-02-B SERP Intelligence） =====
// 覆盖：organic 归一化、malformed URL、缺字段、domain extraction（www/子域/国家域/punycode），
//       provider 错误映射、空响应、feature 块解析、language 参数、device 参数

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeoQueryParams } from "./provider";

const originalFetch = globalThis.fetch;

function serpApiJson(overrides: Record<string, unknown> = {}) {
  return {
    search_information: { total_results: 1000 },
    organic_results: [
      { position: 1, title: "First", link: "https://www.example.com/a?x=1#frag", snippet: "First snippet" },
      { position: 2, title: "Second", link: "https://blog.subdomain.example.org/b", snippet: "Second snippet" },
      { position: 3, link: "https://www.example.co.uk/c" },
    ],
    related_searches: [{ query: "related 1" }],
    related_questions: [{ question: "Q1?" }],
    ...overrides,
  };
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.stubEnv("SERPAPI_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

async function searchWith(
  body: unknown,
  params: SeoQueryParams = { keyword: "test", location: "中国", device: "PC" }
) {
  const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
  vi.stubGlobal("fetch", fetchMock);
  const { serpApiProvider } = await import("./serpapi");
  const result = await serpApiProvider.searchSerp(params);
  return { result, fetchMock };
}

describe("SerpApiProvider.searchSerp 归一化", () => {
  it("常规 organic 结果：position/title/snippet/domain", async () => {
    const { result } = await searchWith(serpApiJson());
    expect(result.organic).toHaveLength(3);
    expect(result.organic[0]).toMatchObject({
      position: 1,
      title: "First",
      snippet: "First snippet",
      domain: "example.com",
    });
  });

  it("缺 title 用占位、缺 snippet 为空串；无 link 的结果被过滤", async () => {
    const { result } = await searchWith(serpApiJson());
    expect(result.organic[2].title).toBe("(无标题)");
    expect(result.organic[2].snippet).toBe("");
    const empty = await searchWith(serpApiJson({ organic_results: [{ position: 1, title: "no link" }] }));
    expect(empty.result.organic).toHaveLength(0);
  });

  it("domain extraction：www、子域名、国家多段后缀、query/fragment 剥离", async () => {
    const { result } = await searchWith(serpApiJson());
    expect(result.organic[0].domain).toBe("example.com"); // www + query + fragment
    expect(result.organic[1].domain).toBe("example.org"); // 子域名归并
    expect(result.organic[2].domain).toBe("example.co.uk"); // 多段后缀
  });

  it("malformed link 不抛错，走字符串清理兜底", async () => {
    const { result } = await searchWith(serpApiJson({
      organic_results: [{ position: 1, title: "t", link: "not a url" }],
    }));
    expect(result.organic[0].domain).toBe("not a url");
  });

  it("punycode 域名转 Unicode", async () => {
    const { result } = await searchWith(serpApiJson({
      organic_results: [{ position: 1, title: "t", link: "https://www.xn--mnchen-3ya.de/path" }],
    }));
    expect(result.organic[0].domain).toBe("münchen.de"); // IDN 归一（xn--mnchen-3ya = münchen）
  });

  it("空响应：organic/related/questions/features 均为空数组", async () => {
    const { result } = await searchWith({});
    expect(result.organic).toEqual([]);
    expect(result.relatedSearches).toEqual([]);
    expect(result.relatedQuestions).toEqual([]);
    expect(result.features).toEqual([]);
  });

  it("provider error 映射为 SeoProviderError", async () => {
    const { SeoProviderError } = await import("./provider");
    await expect(searchWith(serpApiJson({ error: 'Error: "Invalid API key"' }))).rejects.toThrow(SeoProviderError);
    await expect(searchWith(serpApiJson({ error: "You have exhausted your rate limit" }))).rejects.toThrow(SeoProviderError);
  });

  it("feature 块解析：只记录 provider 真实返回的块，无内容的空块不伪造", async () => {
    const { result } = await searchWith(serpApiJson({
      featured_snippet: { position: 1, title: "FS title", link: "https://fs.example.com/x" },
      local_pack: { title: "Local pack", position: 3, items: [{ title: "Place A", position: 3 }] },
      video_results: { items: [{ position: 5, title: "Video 1", link: "https://video.example.com/v" }] },
      ai_overview: { text: [{ snippet: "AI answer" }] }, // provider 未给出 position/title/link → 不记录
    }));
    const features = result.features ?? [];
    const types = features.map((feature) => feature.featureType);
    expect(types).toEqual(["featured_snippet", "local_pack", "video_results"]);
    expect(features[0]).toMatchObject({ position: 1, title: "FS title", url: "https://fs.example.com/x" });
    // 块级 position 缺失时退回首 item
    expect(features[2]).toMatchObject({ featureType: "video_results", position: 5, title: "Video 1", url: "https://video.example.com/v" });
  });
});

describe("SerpApiProvider.buildBaseParams（language / device / location）", () => {
  it("language 合法时透传为 hl，结果带 language 字段", async () => {
    const { result, fetchMock } = await searchWith(serpApiJson(), { keyword: "test", location: "美国", device: "PC", language: "en" });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("hl")).toBe("en");
    expect(url.searchParams.get("gl")).toBe("us");
    expect(result.language).toBe("en");
  });

  it("language 非法时回退所选市场的默认 hl（中国 → zh-cn）", async () => {
    const { fetchMock } = await searchWith(serpApiJson(), { keyword: "test", location: "中国", device: "PC", language: "DROP TABLE;--" });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("hl")).toBe("zh-cn");
  });

  it("缺省 language 时使用市场默认 hl（中国 → zh-cn）", async () => {
    const { fetchMock, result } = await searchWith(serpApiJson());
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("hl")).toBe("zh-cn");
    expect(result.language).toBe("zh-cn");
  });

  it("美国缺省 language → hl=en（修复：不再所有市场固定 zh-cn）", async () => {
    const { fetchMock, result } = await searchWith(serpApiJson(), { keyword: "test", location: "美国", device: "PC" });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("hl")).toBe("en");
    expect(url.searchParams.get("gl")).toBe("us");
    expect(url.searchParams.get("location")).toBe("United States");
    expect(result.language).toBe("en");
  });

  it("显式 language 覆盖市场默认（美国 + zh-cn → hl=zh-cn）", async () => {
    const { fetchMock } = await searchWith(serpApiJson(), { keyword: "test", location: "美国", device: "PC", language: "zh-cn" });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("hl")).toBe("zh-cn");
  });

  it("香港映射完整：gl=hk + location=Hong Kong + hl=zh-tw，不静默回落 cn", async () => {
    const { fetchMock } = await searchWith(serpApiJson(), { keyword: "test", location: "香港", device: "PC" });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("gl")).toBe("hk");
    expect(url.searchParams.get("location")).toBe("Hong Kong");
    expect(url.searchParams.get("hl")).toBe("zh-tw");
  });

  it("台湾映射完整：gl=tw + location=Taiwan + hl=zh-tw，不静默回落 cn", async () => {
    const { fetchMock } = await searchWith(serpApiJson(), { keyword: "test", location: "台湾", device: "PC" });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("gl")).toBe("tw");
    expect(url.searchParams.get("location")).toBe("Taiwan");
    expect(url.searchParams.get("hl")).toBe("zh-tw");
  });

  it("非英文与英文市场默认：日本 → hl=ja；英国 → gl=uk + hl=en", async () => {
    const jp = await searchWith(serpApiJson(), { keyword: "test", location: "日本", device: "PC" });
    const jpUrl = new URL(jp.fetchMock.mock.calls[0][0] as string);
    expect(jpUrl.searchParams.get("hl")).toBe("ja");
    expect(jpUrl.searchParams.get("gl")).toBe("jp");
    expect(jpUrl.searchParams.get("location")).toBe("Japan");

    const uk = await searchWith(serpApiJson(), { keyword: "test", location: "英国", device: "PC" });
    const ukUrl = new URL(uk.fetchMock.mock.calls[0][0] as string);
    expect(ukUrl.searchParams.get("gl")).toBe("uk");
    expect(ukUrl.searchParams.get("hl")).toBe("en");
    expect(ukUrl.searchParams.get("location")).toBe("United Kingdom");
  });

  it("移动端 device=mobile", async () => {
    const { fetchMock } = await searchWith(serpApiJson(), { keyword: "test", location: "中国", device: "移动端" });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("device")).toBe("mobile");
  });
});

describe("SERP 抓取范围（第一页快照，修复「前 100 名」误标）", () => {
  it("searchSerp 不传 num（SerpApi 默认第一页），organic 截取前 10 条", async () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({
      position: i + 1,
      title: `R${i + 1}`,
      link: `https://example.com/${i + 1}`,
    }));
    const { result, fetchMock } = await searchWith(
      serpApiJson({ organic_results: rows }),
      { keyword: "test", location: "美国", device: "PC" }
    );
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("num")).toBeNull();
    expect(result.organic).toHaveLength(10);
    expect(result.organic[0].position).toBe(1);
    expect(result.organic[9].position).toBe(10);
  });
});

describe("市场映射：google_domain 纳入统一配置（核实自 SerpApi 官方域名列表）", () => {
  it.each([
    ["香港", "google.com.hk"],
    ["台湾", "google.com.tw"],
    ["日本", "google.co.jp"],
    ["英国", "google.co.uk"],
    ["德国", "google.de"],
    ["美国", "google.com"],
    // google.cn 已从 Google 域名体系退役：中国保留 google.com + gl=cn 的可行组合
    ["中国", "google.com"],
  ])("%s → google_domain=%s", async (location, domain) => {
    const { fetchMock } = await searchWith(serpApiJson(), { keyword: "test", location, device: "PC" });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("google_domain")).toBe(domain);
  });

  it("resolveSerpMarket：已知市场 fallback=false；未知市场显式 fallback=true（不静默伪装定位）", async () => {
    const { resolveSerpMarket } = await import("./serpapi");
    const hk = resolveSerpMarket("香港");
    expect(hk.fallback).toBe(false);
    expect(hk.googleDomain).toBe("google.com.hk");
    expect(hk.gl).toBe("hk");
    const unknown = resolveSerpMarket("火星");
    expect(unknown.fallback).toBe(true);
    expect(unknown.gl).toBe("cn");
    expect(unknown.googleDomain).toBe("google.com");
  });
});

describe("fetchAutocompleteSuggestions（engine=google_autocomplete）", () => {
  interface AcJson {
    suggestions?: Array<{ value: string; relevance?: number; type?: string }>;
    error?: string;
  }

  async function autocompleteWith(
    body: AcJson,
    keyword = "seo audit",
    location = "美国",
    language?: string
  ) {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchAutocompleteSuggestions } = await import("./serpapi");
    const result = await fetchAutocompleteSuggestions(keyword, location, language);
    return { result, fetchMock };
  }

  it("请求参数：engine=google_autocomplete + q + gl + hl（无 google_domain / device / num）", async () => {
    const { fetchMock } = await autocompleteWith({ suggestions: [{ value: "s" }] }, "seo audit", "美国", "en");
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("engine")).toBe("google_autocomplete");
    expect(url.searchParams.get("q")).toBe("seo audit");
    expect(url.searchParams.get("gl")).toBe("us");
    expect(url.searchParams.get("hl")).toBe("en");
    expect(url.searchParams.get("google_domain")).toBeNull();
    expect(url.searchParams.get("device")).toBeNull();
  });

  it("解析 suggestions（value/relevance/type）；relevance/type 缺失为 null，不猜测", async () => {
    const { result } = await autocompleteWith({
      suggestions: [
        { value: "seo audit tool free", relevance: 900, type: "QUERY" },
        { value: "seo audit checklist" },
      ],
    });
    expect(result).toEqual([
      { value: "seo audit tool free", relevance: 900, type: "QUERY" },
      { value: "seo audit checklist", relevance: null, type: null },
    ]);
  });

  it("无 value / 空串 / 非对象条目被跳过；无 suggestions 字段 → 空数组（诚实空结果）", async () => {
    const { result } = await autocompleteWith({
      suggestions: [{ relevance: 1 }, { value: "  " }, "bad", { value: "ok word" }] as AcJson["suggestions"],
    });
    expect(result.map((row) => row.value)).toEqual(["ok word"]);
    const empty = await autocompleteWith({});
    expect(empty.result).toEqual([]);
  });

  it("provider error 与 searchSerp 同一套错误映射", async () => {
    const { SeoProviderError } = await import("./provider");
    await expect(autocompleteWith({ error: 'Error: "Invalid API key"' })).rejects.toThrow(SeoProviderError);
    await expect(autocompleteWith({ error: "You have exhausted your rate limit" })).rejects.toThrow(SeoProviderError);
  });

  it("空白关键词 → BAD_REQUEST，不发起请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { fetchAutocompleteSuggestions } = await import("./serpapi");
    await expect(fetchAutocompleteSuggestions("   ", "美国")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("P4 快照新增字段：totalResults / adsCount", () => {
  it("search_information.total_results 存在时透传为 Google 自报总数", async () => {
    const { result } = await searchWith(serpApiJson({ search_information: { total_results: 1250000 } }));
    expect(result.totalResults).toBe(1250000);
  });

  it("total_results 缺失/非数值 → null（不编造总数）", async () => {
    const missing = await searchWith(serpApiJson({ search_information: {} }));
    expect(missing.result.totalResults).toBeNull();
    const absent = await searchWith(serpApiJson({ search_information: undefined }));
    expect(absent.result.totalResults).toBeNull();
  });

  it("ads 块存在时 adsCount = 数组长度；无 ads 块 → 0（无广告，不是未捕获）", async () => {
    const withAds = await searchWith(serpApiJson({
      ads: [{ position: 1, block: "top" }, { position: 2, block: "top" }, { position: 3, block: "bottom" }],
    }));
    expect(withAds.result.adsCount).toBe(3);
    const noAds = await searchWith(serpApiJson());
    expect(noAds.result.adsCount).toBe(0);
  });
});

describe("SERP 分页 start 参数（P4：加载更多）", () => {
  it("start>0 透传给 SerpApi（官方 offset 参数）", async () => {
    const { fetchMock } = await searchWith(serpApiJson(), {
      keyword: "test", location: "美国", device: "PC", start: 20,
    });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("start")).toBe("20");
  });

  it("start 缺省 / 0 / 非法值不透传（保持第一页行为与历史 cache key）", async () => {
    for (const start of [undefined, 0, 3.5, -10]) {
      const { fetchMock } = await searchWith(serpApiJson(), {
        keyword: "test", location: "美国", device: "PC",
        ...(start === undefined ? {} : { start: start as number }),
      });
      const url = new URL(fetchMock.mock.calls[0][0] as string);
      expect(url.searchParams.get("start")).toBeNull();
    }
  });
});

describe("fetchGoogleTrends（engine=google_trends，P4）", () => {
  const TIMELINE_BODY = {
    interest_over_time: {
      timeline_data: [
        { date: "Nov 1 – Nov 7, 2025", values: [{ query: null, value: 42, extracted_value: 42 }] },
        { date: "bad-point", values: "not-array" },
        { date: "Nov 8 – Nov 14, 2025", values: [{ query: "seo audit tool", value: 58, extracted_value: 58 }] },
      ],
    },
  };
  const RELATED_QUERIES_BODY = {
    related_queries: {
      top: [
        { query: "free seo audit tool", value: 100, extracted_value: 100 },
        { query: "  " },
        "bad",
      ],
      rising: [{ query: "ai seo audit", value: "+250%", extracted_value: 250 }, { query: "breakout one", value: "Breakout", extracted_value: null }],
    },
  };
  const RELATED_TOPICS_BODY = {
    related_topics: {
      top: [{ topic: { title: "Search engine optimization", type: "Concept" }, value: 100, extracted_value: 100 }],
      rising: [{ topic: { title: "AI overview", type: "Search term" }, value: "Breakout", extracted_value: null }],
    },
  };
  const GEO_BODY = {
    interest_by_subregion: [
      { geo: "US-CA", geo_name: "California", value: 100, extracted_value: 100 },
      { geo: "US-TX", geo_name: "", value: 50 }, // geo_name 缺失回退 geo 码
      { geo: "US-NY", geo_name: "New York", value: "bad" },
    ],
  };

  async function trendsWith(
    body: unknown,
    keyword = "seo audit tool",
    location = "美国",
    dataType: string = "TIMESERIES",
    options?: { date?: string; language?: string }
  ) {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGoogleTrends } = await import("./serpapi");
    const result = await fetchGoogleTrends(keyword, location, dataType as never, options);
    return { result, fetchMock };
  }

  it("请求参数：engine=google_trends + q + data_type + date + hl + no_cache；美国 → geo=US", async () => {
    const { fetchMock } = await trendsWith(TIMELINE_BODY, "seo audit tool", "美国", "TIMESERIES", { date: "today 5-y" });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("engine")).toBe("google_trends");
    expect(url.searchParams.get("q")).toBe("seo audit tool");
    expect(url.searchParams.get("data_type")).toBe("TIMESERIES");
    expect(url.searchParams.get("date")).toBe("today 5-y");
    expect(url.searchParams.get("hl")).toBe("en");
    expect(url.searchParams.get("geo")).toBe("US");
    expect(url.searchParams.get("no_cache")).toBe("true");
  });

  it("英国 Trends geo 是 GB（ISO alpha-2），与 Google gl=uk 不同口径", async () => {
    const { fetchMock } = await trendsWith(GEO_BODY, "kw", "英国", "GEO_MAP_0");
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("geo")).toBe("GB");
  });

  it("未映射市场不传 geo（= 全球范围），调用方明示；缺省 date 白名单回退 today 12-m", async () => {
    const { fetchMock, result } = await trendsWith(TIMELINE_BODY, "kw", "火星", "TIMESERIES", { date: "DROP TABLE" });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("geo")).toBeNull();
    expect(url.searchParams.get("date")).toBe("today 12-m");
    expect(result.geo).toBeNull();
    expect(result.dateRange).toBe("today 12-m");
  });

  it("TIMESERIES：timeline_data 归一化，values 非数组的畸形点降级为空 values，value 缺失为 null", async () => {
    const { result } = await trendsWith(TIMELINE_BODY);
    expect(result.timeline).toHaveLength(3);
    expect(result.timeline?.[0]).toEqual({
      date: "Nov 1 – Nov 7, 2025",
      values: [{ query: null, value: 42, extractedValue: 42 }],
    });
    expect(result.timeline?.[1]).toEqual({ date: "bad-point", values: [] });
    expect(result.top).toBeUndefined();
    expect(result.geoInterest).toBeUndefined();
  });

  it("RELATED_QUERIES：top/rising 归一化；rising 保留增长率字符串与 Breakout 字面值（绝不换算成搜索量）", async () => {
    const { result } = await trendsWith(RELATED_QUERIES_BODY, "kw", "美国", "RELATED_QUERIES");
    expect(result.top).toEqual([{ label: "free seo audit tool", topicType: null, value: 100, extractedValue: 100 }]);
    expect(result.rising).toEqual([
      { label: "ai seo audit", topicType: null, value: "+250%", extractedValue: 250 },
      { label: "breakout one", topicType: null, value: "Breakout", extractedValue: null },
    ]);
  });

  it("RELATED_TOPICS：label 取 topic.title，topicType 保留原始类型标注", async () => {
    const { result } = await trendsWith(RELATED_TOPICS_BODY, "kw", "美国", "RELATED_TOPICS");
    expect(result.top).toEqual([
      { label: "Search engine optimization", topicType: "Concept", value: 100, extractedValue: 100 },
    ]);
    expect(result.rising?.[0].topicType).toBe("Search term");
  });

  it("GEO_MAP_0：interest_by_subregion 归一化；geo_name 缺失回退 geo 码；value 非数值 → null（条目保留）", async () => {
    const { result } = await trendsWith(GEO_BODY, "kw", "美国", "GEO_MAP_0");
    expect(result.geoInterest).toHaveLength(3);
    expect(result.geoInterest?.[0]).toEqual({ geoName: "California", value: 100, extractedValue: 100 });
    expect(result.geoInterest?.[1].geoName).toBe("US-TX");
    expect(result.geoInterest?.[1].value).toBe(50);
    expect(result.geoInterest?.[1].extractedValue).toBeNull();
    expect(result.geoInterest?.[2]).toEqual({ geoName: "New York", value: null, extractedValue: null });
  });

  it("各 data_type 只填充自己的区块（响应结构不同，不可混存）", async () => {
    const timeseries = await trendsWith(RELATED_QUERIES_BODY, "kw", "美国", "TIMESERIES");
    expect(timeseries.result.timeline).toEqual([]);
    expect(timeseries.result.top).toBeUndefined();
    const related = await trendsWith(TIMELINE_BODY, "kw", "美国", "RELATED_QUERIES");
    expect(related.result.timeline).toBeUndefined();
    expect(related.result.top).toEqual([]);
    expect(related.result.rising).toEqual([]);
  });

  it("空响应 / 无对应区块 → 空数组（诚实空结果，不编造趋势点）", async () => {
    const empty = await trendsWith({});
    expect(empty.result.timeline).toEqual([]);
    const noGeo = await trendsWith({}, "kw", "美国", "GEO_MAP_0");
    expect(noGeo.result.geoInterest).toEqual([]);
  });

  it("BAD_REQUEST：空白关键词 / 非法 data_type，均不发起请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGoogleTrends } = await import("./serpapi");
    await expect(fetchGoogleTrends("   ", "美国", "TIMESERIES")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(fetchGoogleTrends("kw", "美国", "RECURSIVE_EXPAND" as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("provider error 与 search 同一套错误映射", async () => {
    const { SeoProviderError } = await import("./provider");
    await expect(trendsWith({ error: 'Error: "Invalid API key"' })).rejects.toThrow(SeoProviderError);
    await expect(trendsWith({ error: "You have exhausted your quota" })).rejects.toThrow(SeoProviderError);
  });
});

// ===== PAA 深度展开（P7）：next_page_token 解析 + google_related_questions 引擎调用 =====
describe("PAA next_page_token（P7）", () => {
  it("searchSerp：related_questions 的 next_page_token 解析为 nextPageToken；无 token 保持 undefined", async () => {
    const { result } = await searchWith(
      serpApiJson({
        related_questions: [
          { question: "Q with token?", next_page_token: "  tok-abc  " },
          { question: "Q without token?" },
          { title: "Title only?", next_page_token: "" },
        ],
      })
    );
    expect(result.relatedQuestions).toHaveLength(3);
    expect(result.relatedQuestions[0]).toMatchObject({ question: "Q with token?", nextPageToken: "tok-abc" });
    expect(result.relatedQuestions[1].nextPageToken).toBeUndefined();
    expect(result.relatedQuestions[2].nextPageToken).toBeUndefined();
  });

  it("fetchRelatedQuestions：engine=google_related_questions + next_page_token 直通；嵌套 token 透传", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        related_questions: [
          { question: "Child 1?", next_page_token: "tok-child-1" },
          { question: "Child 2?" },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { fetchRelatedQuestions } = await import("./serpapi");
    const { questions } = await fetchRelatedQuestions("tok-parent");
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({ question: "Child 1?", nextPageToken: "tok-child-1" });
    expect(questions[1].nextPageToken).toBeUndefined();
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("engine")).toBe("google_related_questions");
    expect(url.searchParams.get("next_page_token")).toBe("tok-parent");
    expect(url.searchParams.get("no_cache")).toBe("true");
  });

  it("fetchRelatedQuestions：空 token 拒绝且不发起请求；空响应返回空数组", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { fetchRelatedQuestions } = await import("./serpapi");
    await expect(fetchRelatedQuestions("   ")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse({})));
    const { fetchRelatedQuestions: f2 } = await import("./serpapi");
    expect((await f2("tok")).questions).toEqual([]);
  });
});

// ===== P7 真实 SerpApi 响应形状回归（2026-10-29 实录，非编造）：
// TIMESERIES / GEO_MAP_0 的 value 与 RELATED_QUERIES 同为字符串，数值口径回退 extracted_value =====
describe("P7 Trends 真实响应形状（value 字符串 → extracted_value 回退）", () => {
  async function run(body: unknown, keyword: string, location: string, dataType: "TIMESERIES" | "GEO_MAP_0") {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchGoogleTrends } = await import("./serpapi");
    return { result: await fetchGoogleTrends(keyword, location, dataType) };
  }
  it("TIMESERIES：真实形状 value:\"47\"（字符串）→ 数值 47", async () => {
    const { result } = await run(
      {
        interest_over_time: {
          timeline_data: [
            {
              date: "Oct 26 – Nov 1, 2025",
              timestamp: "1761436800",
              values: [{ query: "SEO audit tool", query_index: 0, value: "47", extracted_value: 47 }],
            },
          ],
        },
      },
      "SEO audit tool",
      "美国",
      "TIMESERIES"
    );
    expect(result.timeline?.[0]?.values[0]).toEqual({
      query: "SEO audit tool",
      value: 47,
      extractedValue: 47,
    });
  });

  it("GEO_MAP_0：真实形状 value:\"100\"（字符串）→ 数值 100", async () => {
    const { result } = await run(
      {
        interest_by_subregion: [
          { geo: "US-CA", geo_name: "California", value: "100", extracted_value: 100 },
        ],
      },
      "kw",
      "美国",
      "GEO_MAP_0"
    );
    expect(result.geoInterest).toEqual([{ geoName: "California", value: 100, extractedValue: 100 }]);
  });
});
