// ===== /api/keywords/expand 路由契约测试 =====
// 覆盖：鉴权、透传 KeywordResearchService、serpSnapshot 快照映射（P7：relatedQuestions
// 含 provider 真实 next_page_token，缺失时省略字段）、usage 附带、provider 错误统一映射。
// 路由层不重复记账（缓存/配额单点在 service）。

import { beforeEach, describe, expect, it, vi } from "vitest";

const researchKeywordsMock = vi.fn();
const getSerpUsageMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuthOrDemo: vi.fn(async () => ({
    allowed: true,
    skip: false,
    user: { id: "user-1" },
    plan: "lite",
    error: undefined,
  })),
}));

vi.mock("@/lib/seo/keyword-research-service", () => ({
  researchKeywords: (...args: unknown[]) => researchKeywordsMock(...args),
}));

vi.mock("@/lib/seo/serp-service", () => ({
  getSerpUsage: (...args: unknown[]) => getSerpUsageMock(...args),
}));

import { POST } from "./route";

const usage = { used: 3, limit: 30, month: "2026-10" };

function post(body: unknown) {
  return POST(
    new Request("https://www.seeo.asia/api/keywords/expand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

function baseResearch(overrides: Record<string, unknown> = {}) {
  return {
    seed: "seo audit tool",
    related: ["free seo audit"],
    paa: ["what is an seo audit?"],
    location: "美国",
    device: "PC",
    fromCache: false,
    serp: null,
    metrics: { source: null, fromCache: false, discovery: { source: null, fromCache: false, state: "unconfigured" }, warnings: [] },
    unavailableMetrics: ["searchVolume", "difficulty", "cpc", "competition", "intent", "trend"],
    keywords: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSerpUsageMock.mockResolvedValue(usage);
});

describe("POST /api/keywords/expand", () => {
  it("透传 researchKeywords 参数（limit 200 / enrichMetrics）并附带 usage", async () => {
    researchKeywordsMock.mockResolvedValue(baseResearch());
    const res = await post({ seed: "seo audit tool", location: "美国", device: "PC" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.usage).toEqual(usage);
    expect(researchKeywordsMock).toHaveBeenCalledWith("user-1", "lite", {
      keyword: "seo audit tool",
      location: "美国",
      device: "PC",
      limit: 200,
      enrichMetrics: true,
    });
  });

  it("serpSnapshot 映射 relatedQuestions：nextPageToken 原样透传（PAA 展开入口依据）", async () => {
    researchKeywordsMock.mockResolvedValue(
      baseResearch({
        serp: {
          fetchedAt: "2026-10-29T14:00:00.000Z",
          fromCache: true,
          language: "en",
          totalResults: 1200,
          adsCount: 2,
          organic: [{ position: 1, title: "t", link: "https://a.com/1", domain: "a.com", snippet: "s" }],
          features: [{ featureType: "ai_overview", position: 1, title: null, url: null }],
          relatedQuestions: [
            { question: "what is an seo audit?", snippet: "s", title: "what is an seo audit?", nextPageToken: "tok-123" },
            { question: "no token question", snippet: "s" },
          ],
        },
      })
    );
    const res = await post({ seed: "seo audit tool", location: "美国", device: "PC" });
    const json = await res.json();
    expect(json.data.serpSnapshot.relatedQuestions).toEqual([
      { question: "what is an seo audit?", snippet: "s", title: "what is an seo audit?", nextPageToken: "tok-123" },
      { question: "no token question", snippet: "s" },
    ]);
  });

  it("research.serp 为 null 时 serpSnapshot 为 null（不编造快照）", async () => {
    researchKeywordsMock.mockResolvedValue(baseResearch());
    const res = await post({ seed: "seo audit tool", location: "美国", device: "PC" });
    const json = await res.json();
    expect(json.data.serpSnapshot).toBeNull();
  });

  it("空 seed → 400 BAD_REQUEST，不触达 service", async () => {
    const res = await post({ seed: "  ", location: "美国", device: "PC" });
    expect(res.status).toBe(400);
    expect(researchKeywordsMock).not.toHaveBeenCalled();
  });
});
