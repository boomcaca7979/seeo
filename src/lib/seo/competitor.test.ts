// ===== competitor.ts 单元测试（P0-02-C） =====
// 覆盖：SERP 获取统一走 searchSerp（缓存/计费单点）、竞品域名匹配口径（子域名命中、
//       URL 路径中包含竞品域名不误判）、无匹配返回 null

import { beforeEach, describe, expect, it, vi } from "vitest";

const searchSerpMock = vi.fn();
const peekUsageMock = vi.fn();

vi.mock("./serp-service", () => ({
  searchSerp: (...args: unknown[]) => searchSerpMock(...args),
}));

vi.mock("./cache", () => ({
  peekUsage: (...args: unknown[]) => peekUsageMock(...args),
}));

import { checkCompetitorRanks, parseSerpForCompetitors } from "./competitor";
import type { SerpResult } from "./types";

function makeSerp(overrides: Partial<SerpResult> = {}): SerpResult {
  return {
    keyword: "kw",
    location: "中国",
    device: "PC",
    fetchedAt: "2026-08-28T00:00:00.000Z",
    organic: [
      { position: 1, title: "A", link: "https://rival.com/1", domain: "rival.com", snippet: "" },
      { position: 2, title: "B", link: "https://blog.rival.com/2", domain: "rival.com", snippet: "" },
      { position: 3, title: "C", link: "https://other.com/?ref=rival.com", domain: "other.com", snippet: "" },
    ],
    relatedSearches: [],
    relatedQuestions: [],
    ...overrides,
  };
}

beforeEach(() => {
  searchSerpMock.mockReset().mockResolvedValue({ result: makeSerp(), fromCache: true });
  peekUsageMock.mockReset().mockResolvedValue({ used: 1, limit: 30, month: "2026-08" });
});

describe("checkCompetitorRanks", () => {
  it("经 searchSerp 获取 SERP（共享缓存与计费），并解析竞品排名", async () => {
    const result = await checkCompetitorRanks({
      keyword: "kw", location: "中国", device: "PC",
      competitors: [{ id: 1, domain: "rival.com" }, { id: 2, domain: "missing.com" }],
      userId: "u1", plan: "lite",
    });

    expect(searchSerpMock).toHaveBeenCalledWith("u1", "lite", { keyword: "kw", location: "中国", device: "PC" });
    expect(result.results[0]).toEqual({ competitorId: 1, domain: "rival.com", rank: 1, targetUrl: "https://rival.com/1" });
    expect(result.results[1]).toEqual({ competitorId: 2, domain: "missing.com", rank: null, targetUrl: null });
    expect(result.fromCache).toBe(true);
  });

  it("子域名命中（blog.rival.com 记为 rival.com 的排名）", async () => {
    const result = await checkCompetitorRanks({
      keyword: "kw", location: "中国", device: "PC",
      competitors: [{ id: 1, domain: "www.rival.com" }],
      userId: "u1",
    });
    expect(result.results[0].rank).toBe(1);
  });

  it("URL 参数中出现竞品域名不误判（other.com/?ref=rival.com）", () => {
    const results = parseSerpForCompetitors(makeSerp(), [{ id: 1, domain: "rival.com" }]);
    // 首个命中仍是真正的 rival.com 结果（position 1），而不是 other.com 的参数
    expect(results[0].rank).toBe(1);
  });

  it("竞争域名只出现在 URL 参数里时返回 null", () => {
    const serp = makeSerp({
      organic: [
        { position: 1, title: "A", link: "https://other.com/?ref=rival.com", domain: "other.com", snippet: "" },
      ],
    });
    const results = parseSerpForCompetitors(serp, [{ id: 1, domain: "rival.com" }]);
    expect(results[0]).toEqual({ competitorId: 1, domain: "rival.com", rank: null, targetUrl: null });
  });
});
