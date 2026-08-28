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

  it("language 非法时回退 zh-cn（默认行为不变）", async () => {
    const { fetchMock } = await searchWith(serpApiJson(), { keyword: "test", location: "中国", device: "PC", language: "DROP TABLE;--" });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("hl")).toBe("zh-cn");
  });

  it("缺省 language 时 hl=zh-cn，行为与 P0-02-B 之前一致", async () => {
    const { fetchMock, result } = await searchWith(serpApiJson());
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("hl")).toBe("zh-cn");
    expect(result.language).toBe("zh-cn");
  });

  it("移动端 device=mobile", async () => {
    const { fetchMock } = await searchWith(serpApiJson(), { keyword: "test", location: "中国", device: "移动端" });
    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.searchParams.get("device")).toBe("mobile");
  });
});
