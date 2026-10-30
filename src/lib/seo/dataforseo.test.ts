// ===== DataForSEO Keyword Metrics provider 单元测试（P0-02-A） =====
// 覆盖：真实数据归一化、null 指标、响应形态兼容、difficulty 降级、未知地点、空批次

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;

function dfsResponse(taskResult: unknown, statusCode = 20000) {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        version: "test",
        status_code: statusCode,
        status_message: "Ok.",
        tasks: [{ status_code: statusCode, status_message: "Ok.", result: taskResult }],
      }),
  } as Response;
}

function volumeItem(keyword: string, overrides: Record<string, unknown> = {}) {
  return {
    keyword,
    search_volume: 1200,
    competition: "MEDIUM",
    competition_index: 54,
    cpc: 1.23,
    currency: "USD",
    monthly_searches: [
      { year: 2026, month: 7, search_volume: 1100 },
      { year: 2026, month: 6, search_volume: 1300 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("DATAFORSEO_LOGIN", "login");
  vi.stubEnv("DATAFORSEO_PASSWORD", "password");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

describe("fetchKeywordMetrics", () => {
  it("归一化 search_volume 端点数据（competition_index/100、trend、difficulty）", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input.toString();
      if (path.includes("search_volume")) {
        return dfsResponse([{ items: [volumeItem("seo tool"), volumeItem("kw null", { search_volume: null, cpc: null, competition_index: null, competition: null, monthly_searches: null })] }]);
      }
      return dfsResponse([{ items: [{ keyword: "seo tool", keyword_difficulty: 42 }, { keyword: "kw null", keyword_difficulty: null }] }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchKeywordMetrics } = await import("./dataforseo");
    const result = await fetchKeywordMetrics(["SEO Tool", "kw null"], { location: "美国" });

    expect(result.difficultyAvailable).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.rows[0]).toEqual({
      keyword: "SEO Tool",
      searchVolume: 1200,
      cpc: 1.23,
      competition: 0.54,
      competitionLevel: "MEDIUM",
      difficulty: 42,
      intent: null,
      trend: [
        { year: 2026, month: 7, searchVolume: 1100 },
        { year: 2026, month: 6, searchVolume: 1300 },
      ],
      currency: "USD",
    });
    expect(result.rows[1]).toMatchObject({ keyword: "kw null", searchVolume: null, cpc: null, competition: null, difficulty: null, trend: null });
    // 请求体应携带美国 + 默认英语
    const volumeCall = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(volumeCall).toMatchObject({ keywords: ["SEO Tool", "kw null"], location_name: "United States", language_name: "English" });
  });

  it("兼容 result 本身是 item 数组的响应形态", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input.toString();
      if (path.includes("search_volume")) {
        return dfsResponse([volumeItem("solo keyword")]);
      }
      return dfsResponse([{ items: [{ keyword: "solo keyword", keyword_difficulty: 10 }] }]);
    }));

    const { fetchKeywordMetrics } = await import("./dataforseo");
    const result = await fetchKeywordMetrics(["solo keyword"], { location: "中国" });
    expect(result.rows[0].searchVolume).toBe(1200);
    expect(result.rows[0].difficulty).toBe(10);
  });

  it("difficulty 端点失败时降级：volume 数据保留 + 告警", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input.toString();
      if (path.includes("search_volume")) {
        return dfsResponse([{ items: [volumeItem("seo tool")] }]);
      }
      return dfsResponse(undefined, 40300);
    }));

    const { fetchKeywordMetrics } = await import("./dataforseo");
    const result = await fetchKeywordMetrics(["seo tool"], { location: "德国" });

    expect(result.difficultyAvailable).toBe(false);
    expect(result.warnings.join(" ")).toContain("difficulty");
    expect(result.rows[0]).toMatchObject({ searchVolume: 1200, difficulty: null });
  });

  it("未知地点不调用 provider 并返回告警", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { fetchKeywordMetrics } = await import("./dataforseo");
    const result = await fetchKeywordMetrics(["seo tool"], { location: "火星" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].searchVolume).toBeNull();
    expect(result.warnings.join(" ")).toContain("火星");
  });

  it("language 参数覆盖默认语言", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      dfsResponse([{ items: [] }])
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchKeywordMetrics } = await import("./dataforseo");
    await fetchKeywordMetrics(["kw"], { location: "中国", language: "English" });

    const volumeCall = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(volumeCall.language_name).toBe("English");
  });

  it("空批次直接返回空结果", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { fetchKeywordMetrics } = await import("./dataforseo");
    const result = await fetchKeywordMetrics(["", "   "], { location: "中国" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.rows).toEqual([]);
  });

  it("批次上限 700", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => dfsResponse([{ items: [] }]));
    vi.stubGlobal("fetch", fetchMock);

    const { fetchKeywordMetrics, DFS_KEYWORD_BATCH_LIMIT } = await import("./dataforseo");
    expect(DFS_KEYWORD_BATCH_LIMIT).toBe(700);
    await fetchKeywordMetrics(Array.from({ length: 900 }, (_, i) => `kw-${i}`), { location: "美国" });

    const volumeCall = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(volumeCall.keywords).toHaveLength(700);
  });
});

// ===== fetchKeywordDiscovery（Labs suggestions + ideas 数据库扩词） =====
// fixture 按官方文档字段构造（Verified 2026-10-29）：keyword_info.competition 为 0-1（无
// competition_index/currency 字段）、keyword_properties.keyword_difficulty、
// search_intent_info.main_intent、seed_keyword_data。

function labsItem(keyword: string, overrides: Record<string, unknown> = {}) {
  return {
    keyword,
    keyword_info: {
      competition: 0.31,
      competition_level: "MEDIUM",
      cpc: 5.1,
      search_volume: 2400,
      monthly_searches: [
        { year: 2026, month: 9, search_volume: 2300 },
        { year: 2026, month: 8, search_volume: 2500 },
      ],
    },
    keyword_properties: { keyword_difficulty: 72 },
    search_intent_info: { main_intent: "commercial" },
    ...overrides,
  };
}

function discoveryFetchMock(suggestionsResult: unknown, ideasResult: unknown) {
  return vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const path = typeof input === "string" ? input : input.toString();
    if (path.includes("keyword_suggestions")) {
      return dfsResponse(suggestionsResult);
    }
    if (path.includes("keyword_ideas")) {
      return dfsResponse(ideasResult);
    }
    throw new Error(`unexpected path: ${path}`);
  });
}

describe("fetchKeywordDiscovery", () => {
  it("解析 suggestions + ideas 两端点，competition 直接使用 0-1 不二次换算", async () => {
    const fetchMock = discoveryFetchMock(
      [{ items: [labsItem("seo audit tool free")], seed_keyword_data: [labsItem("seo audit tool", { search_intent_info: { main_intent: "informational" } })] }],
      [{ items: [labsItem("website auditor", { origin_placeholder: true, search_intent_info: { main_intent: "informational" } })] }]
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchKeywordDiscovery } = await import("./dataforseo");
    const result = await fetchKeywordDiscovery("SEO audit tool", { location: "美国" });

    expect(result.warnings).toEqual([]);
    const free = result.rows.get("seo audit tool free");
    expect(free).toMatchObject({
      origin: "labs_suggestions",
      searchVolume: 2400,
      cpc: 5.1,
      competition: 0.31, // Labs competition 本身是 0-1，不得被 /100
      competitionLevel: "MEDIUM",
      difficulty: 72,
      intent: "commercial",
      currency: "USD",
      trend: [
        { year: 2026, month: 9, searchVolume: 2300 },
        { year: 2026, month: 8, searchVolume: 2500 },
      ],
    });
    const idea = result.rows.get("website auditor");
    expect(idea?.origin).toBe("labs_ideas");
    expect(idea?.intent).toBe("informational");
    expect(result.seedRow).toMatchObject({ keyword: "seo audit tool", searchVolume: 2400, intent: "informational" });

    // 请求体：suggestions 携带 include_seed_keyword + limit；ideas 用 keywords 数组
    const suggestionsCall = fetchMock.mock.calls.find(([p]) => String(p).includes("keyword_suggestions"));
    const suggestionsBody = JSON.parse((suggestionsCall?.[1] as RequestInit).body as string);
    expect(suggestionsBody).toMatchObject({
      keyword: "SEO audit tool",
      location_name: "United States",
      language_name: "English",
      limit: 100,
      include_seed_keyword: true,
    });
    const ideasCall = fetchMock.mock.calls.find(([p]) => String(p).includes("keyword_ideas"));
    const ideasBody = JSON.parse((ideasCall?.[1] as RequestInit).body as string);
    expect(ideasBody.keywords).toEqual(["SEO audit tool"]);
    expect(ideasBody.location_name).toBe("United States");
  });

  it("单端点失败不阻塞另一端点，并记录 warning", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const path = typeof input === "string" ? input : input.toString();
      if (path.includes("keyword_suggestions")) {
        return dfsResponse({ status_message: "Task in queue" }, 50000);
      }
      return dfsResponse([{ items: [labsItem("website auditor")] }]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { fetchKeywordDiscovery } = await import("./dataforseo");
    const result = await fetchKeywordDiscovery("seo audit tool", { location: "美国" });

    expect(result.rows.has("website auditor")).toBe(true);
    expect(result.warnings.join(" ")).toContain("keyword suggestions 不可用");
  });

  it("未知 location 返回空结果 + warning，不发起请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { fetchKeywordDiscovery } = await import("./dataforseo");
    const result = await fetchKeywordDiscovery("kw", { location: "火星" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.rows.size).toBe(0);
    expect(result.warnings.join(" ")).toContain("火星");
  });

  it("未配置凭证时抛 DataForSeoNotConfiguredError（由上层优雅降级）", async () => {
    vi.stubEnv("DATAFORSEO_LOGIN", "");
    vi.stubEnv("DATAFORSEO_PASSWORD", "");
    vi.stubGlobal("fetch", vi.fn());

    const { fetchKeywordDiscovery, DataForSeoNotConfiguredError } = await import("./dataforseo");
    await expect(fetchKeywordDiscovery("kw", { location: "美国" })).rejects.toThrow(DataForSeoNotConfiguredError);
  });
});
