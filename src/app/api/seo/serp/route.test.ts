// ===== /api/seo/serp 路由契约测试 =====
// 覆盖：start 分页参数校验、start>0 时 organic position 换算为绝对位置
//（真实响应核实：SerpApi start>0 返回页内相对位置 1-10）、透传 service、usage 附带。

import { beforeEach, describe, expect, it, vi } from "vitest";

const searchSerpMock = vi.fn<(userId: string, plan: string, params: unknown) => Promise<unknown>>();
const getSerpUsageMock = vi.fn<(userId: string, plan: string) => Promise<unknown>>();
const summarizeSerpMock = vi.fn<(result: unknown) => { domains: number }>();

vi.mock("@/lib/auth", () => ({
  requireAuthOrDemo: vi.fn(async () => ({
    allowed: true,
    skip: false,
    user: { id: "user-1" },
    plan: "lite",
    error: undefined,
  })),
}));

vi.mock("@/lib/seo/serp-service", () => ({
  searchSerp: (userId: string, plan: string, params: unknown) => searchSerpMock(userId, plan, params),
  getSerpUsage: (userId: string, plan: string) => getSerpUsageMock(userId, plan),
  summarizeSerp: (result: unknown) => summarizeSerpMock(result),
}));

import { GET } from "./route";

const usage = { used: 3, limit: 30, month: "2026-10" };

function get(query: string) {
  return GET(new Request(`https://www.seeo.asia/api/seo/serp?${query}`));
}

function serpResult() {
  return {
    keyword: "seo audit tool",
    organic: [
      { position: 1, title: "a", link: "https://a.com/1", domain: "a.com", snippet: "s" },
      { position: 10, title: "b", link: "https://b.com/2", domain: "b.com", snippet: "s" },
    ],
    relatedSearches: [],
    relatedQuestions: [],
    features: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSerpUsageMock.mockResolvedValue(usage);
  searchSerpMock.mockResolvedValue({ result: serpResult(), fromCache: false });
});

describe("GET /api/seo/serp", () => {
  it("start 缺省 = 第一页，position 原样透传", async () => {
    const res = await get("keyword=seo%20audit%20tool&location=%E7%BE%8E%E5%9B%BD&device=PC");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.organic.map((r: { position: number }) => r.position)).toEqual([1, 10]);
    expect(searchSerpMock).toHaveBeenCalledWith("user-1", "lite", {
      keyword: "seo audit tool",
      location: "美国",
      device: "PC",
    });
  });

  it("start=10 时 position 换算为绝对位置（页内 1-10 → 11-20）", async () => {
    const res = await get("keyword=seo%20audit%20tool&location=%E7%BE%8E%E5%9B%BD&device=PC&start=10");
    const json = await res.json();
    expect(json.data.organic.map((r: { position: number }) => r.position)).toEqual([11, 20]);
    expect(searchSerpMock).toHaveBeenCalledWith("user-1", "lite", {
      keyword: "seo audit tool",
      location: "美国",
      device: "PC",
      start: 10,
    });
  });

  it("start 非 10 的倍数 → 400 BAD_REQUEST，不触达 service", async () => {
    const res = await get("keyword=kw&device=PC&start=7");
    expect(res.status).toBe(400);
    expect(searchSerpMock).not.toHaveBeenCalled();
  });

  // ===== DEF-02 回归：expand 对外口径是 desktop/mobile，页面直接透传曾导致 400 =====
  it("device=desktop（expand 口径）被接受并归一化为 PC", async () => {
    const res = await get("keyword=seo&device=desktop&start=10");
    expect(res.status).toBe(200);
    expect(searchSerpMock).toHaveBeenCalledWith("user-1", "lite", {
      keyword: "seo",
      location: "中国",
      device: "PC",
      start: 10,
    });
  });

  it("device=mobile 被接受并归一化为移动端", async () => {
    const res = await get("keyword=seo&device=mobile");
    expect(res.status).toBe(200);
    expect(searchSerpMock).toHaveBeenCalledWith("user-1", "lite", {
      keyword: "seo",
      location: "中国",
      device: "移动端",
    });
  });

  it("无法识别的 device 仍返回 400 且带明确文案", async () => {
    const res = await get("keyword=seo&device=tablet");
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(String(json.error)).toContain("device");
    expect(searchSerpMock).not.toHaveBeenCalled();
  });

  it("device 缺省保持既有默认 PC（不改变旧调用方行为）", async () => {
    const res = await get("keyword=seo");
    expect(res.status).toBe(200);
    expect(searchSerpMock).toHaveBeenCalledWith("user-1", "lite", {
      keyword: "seo",
      location: "中国",
      device: "PC",
    });
  });
});
