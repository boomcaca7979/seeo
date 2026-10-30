// ===== /api/keywords/researches 路由契约测试 =====
// 覆盖：鉴权、GET 列表透传、POST 保存（服务端去重 keywordCount 口径）、参数校验、
// payload 体积上限。路由只做本地库操作——契约上不得出现任何供应商调用面。

import { beforeEach, describe, expect, it, vi } from "vitest";

const listMock = vi.fn<(userId: string) => Promise<unknown>>();
const saveMock = vi.fn<(userId: string, input: unknown) => Promise<unknown>>();

vi.mock("@/lib/auth", () => ({
  requireAuthOrDemo: vi.fn(async () => ({
    allowed: true,
    skip: false,
    user: { id: "user-1" },
    plan: "lite",
    error: undefined,
  })),
}));

vi.mock("@/lib/db", () => ({
  listKeywordResearches: (userId: string) => listMock(userId),
  saveKeywordResearch: (userId: string, input: unknown) => saveMock(userId, input),
}));

import { GET, POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("https://www.seeo.asia/api/keywords/researches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/keywords/researches", () => {
  it("返回当前用户的保存列表", async () => {
    const list = [{ id: 1, seed: "seo", keywordCount: 3, savedAt: "2026-10-30 10:00:00" }];
    listMock.mockResolvedValue(list);
    const res = await GET();
    const json = await res.json();
    expect(listMock).toHaveBeenCalledWith("user-1");
    expect(res.status).toBe(200);
    expect(json.data).toEqual(list);
  });

  it("列表为空时返回空数组", async () => {
    listMock.mockResolvedValue([]);
    const res = await GET();
    const json = await res.json();
    expect(json.data).toEqual([]);
  });
});

describe("POST /api/keywords/researches", () => {
  const basePayload = {
    expandData: {
      seed: "seo",
      related: ["SEO Tools", " free seo tools "],
      paa: ["what is seo?"],
      metrics: { keywords: [{ keyword: "SEO TOOLS" }, { keyword: "seo pricing" }] },
    },
    suggestions: ["seo tools"],
    directionSuggestions: [],
    trendsQueries: [{ query: "What Is SEO?" }, { query: "seo pricing" }],
    paaExpanded: [{ parent: "what is seo?", question: "why is seo important" }],
  };

  it("保存成功：keywordCount 为跨来源归一去重后的诚实计数", async () => {
    saveMock.mockImplementation(async (_userId, input) => ({
      id: 9,
      ...(input as Record<string, unknown>),
      savedAt: "2026-10-30 10:00:00",
    }));
    const res = await post({ seed: "seo", location: "美国", device: "PC", payload: basePayload });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.seed).toBe("seo");
    expect(json.data.location).toBe("美国");
    expect(json.data.device).toBe("PC");
    // 去重集合：seo tools / free seo tools / what is seo? / seo pricing / why is seo important
    expect(saveMock).toHaveBeenCalledTimes(1);
    const input = saveMock.mock.calls[0][1] as { keywordCount: number; payload: string };
    expect(input.keywordCount).toBe(5);
    expect(typeof input.payload).toBe("string");
    expect(JSON.parse(input.payload)).toEqual(basePayload);
  });

  it("seed/location 缺失或 device 非法时 400", async () => {
    for (const body of [
      { seed: "", location: "美国", device: "PC", payload: {} },
      { seed: "seo", location: "  ", device: "PC", payload: {} },
      { seed: "seo", location: "美国", device: "MOBILE", payload: {} },
      { seed: "seo", location: "美国", device: "PC" },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
    }
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("payload 非对象或超上限时 400，不落库", async () => {
    const res1 = await post({ seed: "seo", location: "美国", device: "PC", payload: [1, 2] });
    expect(res1.status).toBe(400);
    const res2 = await post({
      seed: "seo",
      location: "美国",
      device: "PC",
      payload: { blob: "x".repeat(2_000_001) },
    });
    expect(res2.status).toBe(400);
    expect(saveMock).not.toHaveBeenCalled();
  });
});
