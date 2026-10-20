// ===== /api/tracking/refresh 域名范围测试（第十三阶段：位置追踪项目上下文）=====
// tracked_keywords 以 (domain, user_id) 归属项目，位置追踪页的项目范围就是域名。
// 覆盖：带 domain 只刷新该项目关键词（额度与批次不串项目）、不带 domain 保持账号级刷新、
//       该项目无关键词时不调用 SerpApi 批次。

import { describe, it, expect, vi, beforeEach } from "vitest";

const K = (id: number, keyword: string, domain: string) => ({
  id,
  keyword,
  location: "美国",
  device: "PC" as const,
  domain,
  created_at: "2026-10-01 09:00:00",
  last_refreshed_at: null,
  todayPosition: null,
  yesterdayPosition: null,
  change: null,
  matchedUrl: null,
  groups: [],
});

const state = {
  all: [
    K(1, "a one", "acme.test"),
    K(2, "a two", "acme.test"),
    K(3, "b one", "other.test"),
  ],
};

vi.mock("@/lib/auth", () => ({
  requireAuthOrDemo: vi.fn(async () => ({
    allowed: true,
    skip: false,
    user: { id: "user-1" },
    plan: "pro",
    subscriptionStatus: "active",
    limits: { max_tracked_keywords: 50 },
    error: undefined,
  })),
}));

vi.mock("@/lib/db", () => ({
  listTrackedKeywords: vi.fn(async () => state.all),
}));

vi.mock("@/lib/seo/rank-tracking-service", () => ({
  listTrackedKeywordsForProject: vi.fn(async (_userId: string, domain: string) =>
    state.all.filter((k) => k.domain === domain)
  ),
}));

vi.mock("@/lib/seo/cache", () => ({
  peekUsage: vi.fn(async () => ({ used: 3, limit: 100, month: "2026-10" })),
}));

vi.mock("@/lib/seo/refresh", () => ({
  MAX_KEYWORDS_PER_REQUEST: 20,
  refreshRanksBatch: vi.fn(async (_userId: string, _plan: string, batch: Array<{ keyword: string }>) =>
    batch.map((k) => ({ keyword: k.keyword, position: 10, url: null, featureTypes: [] }))
  ),
}));

import { POST } from "./route";
import { listTrackedKeywords } from "@/lib/db";
import { listTrackedKeywordsForProject } from "@/lib/seo/rank-tracking-service";
import { refreshRanksBatch } from "@/lib/seo/refresh";

const post = (qs: string) =>
  POST(new Request(`https://seeo.test/api/tracking/refresh?${qs}`, { method: "POST" }));

beforeEach(() => {
  vi.clearAllMocks();
  state.all = [
    K(1, "a one", "acme.test"),
    K(2, "a two", "acme.test"),
    K(3, "b one", "other.test"),
  ];
});

describe("POST /api/tracking/refresh", () => {
  it("带 domain：只刷新该项目关键词，走按域名的现有过滤", async () => {
    const res = await post("offset=0&domain=acme.test");
    expect(res.status).toBe(200);
    expect(listTrackedKeywordsForProject).toHaveBeenCalledWith("user-1", "acme.test");
    expect(listTrackedKeywords).not.toHaveBeenCalled();
    const batch = (refreshRanksBatch as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0][2] as Array<{ keyword: string; domain: string }>;
    expect(batch.map((k) => k.keyword)).toEqual(["a one", "a two"]);
    expect(batch.every((k) => k.domain === "acme.test")).toBe(true);
    const json = await res.json();
    expect(json.data.hasMore).toBe(false);
    expect(json.data.nextOffset).toBe(2);
  });

  it("不带 domain：保持原有账号级刷新（侧边栏直接进入的全量视图）", async () => {
    const res = await post("offset=0");
    expect(res.status).toBe(200);
    expect(listTrackedKeywords).toHaveBeenCalledWith("user-1");
    expect(listTrackedKeywordsForProject).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.data.items).toHaveLength(3);
  });

  it("该项目没有关键词：不调用 SerpApi 批次", async () => {
    const res = await post("offset=0&domain=empty.test");
    expect(res.status).toBe(200);
    expect(refreshRanksBatch).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.data.items).toEqual([]);
    expect(json.data.hasMore).toBe(false);
  });

  it("域名过滤后仍按 offset 分批续请求", async () => {
    state.all = [
      K(1, "a one", "acme.test"),
      K(2, "a two", "acme.test"),
      K(3, "a three", "acme.test"),
      K(4, "b one", "other.test"),
    ];
    const res = await post("offset=2&domain=acme.test");
    const json = await res.json();
    expect(json.data.items).toHaveLength(1);
    expect(json.data.nextOffset).toBe(3);
    expect(json.data.hasMore).toBe(false);
  });
});
