// ===== AI Search Provider 单元测试（P0-03-B） =====
// 硬性成本防护测试：invalid model 绝不产生 provider task；白名单来自官方 /models 目录

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;

function dfsJson(taskResult: unknown, statusCode = 20000, cost = 0.101) {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        version: "test",
        status_code: statusCode,
        status_message: "Ok.",
        cost,
        tasks: [{ status_code: statusCode, status_message: "Ok.", cost, result: taskResult }],
      }),
  } as Response;
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

describe("model whitelist（防失败任务扣费的硬门槛）", () => {
  it("invalid model → AI_SEARCH_INVALID_MODEL，且零 provider 请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { fetchAiLlmResponse } = await import("./dataforseo");
    await expect(
      fetchAiLlmResponse({ platform: "chat_gpt", modelName: "gpt-9-fake", userPrompt: "test" })
    ).rejects.toMatchObject({ code: "AI_SEARCH_INVALID_MODEL" });
    expect(fetchMock).not.toHaveBeenCalled(); // 未产生任何 provider task
  });

  it("unsupported platform → AI_SEARCH_UNSUPPORTED_PLATFORM，零请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { fetchAiLlmResponse } = await import("./dataforseo");
    await expect(
      fetchAiLlmResponse({ platform: "gemini" as never, modelName: "gemini-2.5-pro", userPrompt: "test" })
    ).rejects.toMatchObject({ code: "AI_SEARCH_UNSUPPORTED_PLATFORM" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("空 prompt / 超 500 字符 → 拒绝且零请求（DataForSEO user_prompt 限制）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { fetchAiLlmResponse } = await import("./dataforseo");
    await expect(fetchAiLlmResponse({ platform: "chat_gpt", modelName: "gpt-5", userPrompt: "   " })).rejects.toThrow();
    await expect(fetchAiLlmResponse({ platform: "chat_gpt", modelName: "gpt-5", userPrompt: "x".repeat(501) })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("白名单模型 + 正常 payload 派发到当前端点（chat_gpt/llm_responses/live）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(dfsJson([{
      model_name: "gpt-5-2025-08-07",
      web_search: true,
      output_tokens: 500,
      items: [{ type: "message", sections: [{ text: "Answer text", annotations: [{ url: "https://seeo.asia/", title: "SeeO" }] }] }],
    }]));
    vi.stubGlobal("fetch", fetchMock);
    const { fetchAiLlmResponse } = await import("./dataforseo");
    const result = await fetchAiLlmResponse({ platform: "chat_gpt", modelName: "gpt-5", userPrompt: "best seo tools?", webSearchCountryCode: "US" });
    expect(result.text).toBe("Answer text");
    expect(result.citations).toEqual([{ url: "https://seeo.asia/", title: "SeeO" }]);
    expect(result.cost.usd).toBeCloseTo(0.101);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/ai_optimization/chat_gpt/llm_responses/live");
    const body = JSON.parse((init as RequestInit).body as string)[0];
    expect(body).toMatchObject({ user_prompt: "best seo tools?", model_name: "gpt-5", web_search: true, max_output_tokens: 4096 });
  });
});

describe("llm_mentions 当前端点归一化", () => {
  it("search_mentions：items 归一（sources/brand_entities/ai_search_volume/monthly_searches）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(dfsJson([{
      items: [{
        platform: "chat_gpt", model_name: "gpt-5", question: "best seo audit tools?",
        ai_search_volume: 1200,
        monthly_searches: [{ year: 2026, month: 8, search_volume: 1100 }],
        sources: [{ url: "https://seeo.asia/x", domain: "seeo.asia", title: "SeeO", position: 1 }],
        brand_entities: [{ title: "SeeO" }],
        is_web_search_based: true,
      }],
    }])));
    const { fetchAiMentionsSearch } = await import("./dataforseo");
    const { items, cost } = await fetchAiMentionsSearch({
      entities: [{ domain: "seeo.asia" }], platform: "chat_gpt", locationCode: 2840, languageCode: "en",
    });
    expect(items[0]).toMatchObject({
      platform: "chat_gpt", question: "best seo audit tools?", aiSearchVolume: 1200,
      sources: [{ url: "https://seeo.asia/x", domain: "seeo.asia" }],
      brandEntities: ["SeeO"], isWebSearchBased: true,
    });
    expect(cost.usd).toBeCloseTo(0.101);
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.target[0]).toEqual({ domain: "seeo.asia", search_filter: "include", include_subdomains: false });
  });

  it("multi_target_metrics：按 key 归一 target 分组", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(dfsJson([{
      items: [
        { key: "SeeO", total: { mentions: 12, ai_search_volume: 500 }, platform: [{ key: "chat_gpt", mentions: 7, ai_search_volume: 300 }] },
        { key: "Rival", total: { mentions: 30, ai_search_volume: 900 }, platform: [{ key: "chat_gpt", mentions: 20, ai_search_volume: 600 }] },
      ],
    }])));
    const { fetchAiMultiTargetMetrics } = await import("./dataforseo");
    const { items } = await fetchAiMultiTargetMetrics({
      groups: [
        { key: "SeeO", entities: [{ domain: "seeo.asia" }] },
        { key: "Rival", entities: [{ domain: "rival.com" }] },
      ],
      platform: "chat_gpt", locationCode: 2840, languageCode: "en",
    });
    expect(items[0]).toMatchObject({ key: "SeeO", totalMentions: 12, platformGroups: [{ key: "chat_gpt", mentions: 7 }] });
  });

  it("target_metrics：total + platform 分组", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(dfsJson([{
      total: { mentions: 26465, ai_search_volume: 1203984 },
      aggregated_metrics: { platform: [{ key: "chat_gpt", mentions: 100, ai_search_volume: 900 }] },
    }])));
    const { fetchAiTargetMetrics } = await import("./dataforseo");
    const result = await fetchAiTargetMetrics({ entities: [{ domain: "seeo.asia" }], platform: "chat_gpt", locationCode: 2840, languageCode: "en" });
    expect(result.totalMentions).toBe(26465);
    expect(result.platformGroups[0]).toMatchObject({ key: "chat_gpt", mentions: 100 });
  });

  it("计费类错误 → AI_SEARCH_BILLING_ISSUE（fatal，不可降级吞掉）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(dfsJson(null, 40200)));
    const { fetchAiTargetMetrics } = await import("./dataforseo");
    // status 40200 + message 不含 billing → 普通 provider error（task 层）
    await expect(fetchAiTargetMetrics({ entities: [{ domain: "x.com" }], platform: "google", locationCode: 2840, languageCode: "en" }))
      .rejects.toThrow();
  });
});
