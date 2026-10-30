// ===== /api/keywords/researches/[id] 路由契约测试 =====
// 覆盖：GET 完整 payload（JSON 解析与旧数据兜底）、404、非法 id 400、DELETE 成功与 404。
// 路由只做本地库操作——不得出现任何供应商调用面。

import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn<(userId: string, id: number) => Promise<unknown>>();
const deleteMock = vi.fn<(userId: string, id: number) => Promise<boolean>>();

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
  getKeywordResearch: (userId: string, id: number) => getMock(userId, id),
  deleteKeywordResearch: (userId: string, id: number) => deleteMock(userId, id),
}));

import { DELETE, GET } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/keywords/researches/[id]", () => {
  it("返回完整记录且 payload 已解析为对象", async () => {
    const payload = { expandData: { seed: "seo", related: ["a"] } };
    getMock.mockResolvedValue({
      id: 3,
      seed: "seo",
      location: "美国",
      device: "PC",
      keywordCount: 2,
      payload: JSON.stringify(payload),
      savedAt: "2026-10-30 10:00:00",
    });
    const res = await GET(new Request("https://www.seeo.asia/api/keywords/researches/3"), ctx("3"));
    const json = await res.json();
    expect(getMock).toHaveBeenCalledWith("user-1", 3);
    expect(res.status).toBe(200);
    expect(json.data.payload).toEqual(payload);
    expect(json.data.savedAt).toBe("2026-10-30 10:00:00");
  });

  it("payload 不是合法 JSON 时原样返回（旧数据兜底，不 500）", async () => {
    getMock.mockResolvedValue({ id: 3, seed: "seo", location: "美国", device: "PC", keywordCount: 0, payload: "not-json", savedAt: "x" });
    const res = await GET(new Request("https://www.seeo.asia/api/keywords/researches/3"), ctx("3"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.payload).toBe("not-json");
  });

  it("记录不存在时 404 RESEARCH_NOT_FOUND", async () => {
    getMock.mockResolvedValue(null);
    const res = await GET(new Request("https://www.seeo.asia/api/keywords/researches/3"), ctx("3"));
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.code).toBe("RESEARCH_NOT_FOUND");
  });

  it("非法 id 返回 400，不查库", async () => {
    const res = await GET(new Request("https://www.seeo.asia/api/keywords/researches/abc"), ctx("abc"));
    expect(res.status).toBe(400);
    expect(getMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/keywords/researches/[id]", () => {
  it("删除成功返回 ok:true", async () => {
    deleteMock.mockResolvedValue(true);
    const res = await DELETE(new Request("https://www.seeo.asia/api/keywords/researches/3", { method: "DELETE" }), ctx("3"));
    const json = await res.json();
    expect(deleteMock).toHaveBeenCalledWith("user-1", 3);
    expect(res.status).toBe(200);
    expect(json.data.ok).toBe(true);
  });

  it("删除不存在时 404", async () => {
    deleteMock.mockResolvedValue(false);
    const res = await DELETE(new Request("https://www.seeo.asia/api/keywords/researches/3", { method: "DELETE" }), ctx("3"));
    expect(res.status).toBe(404);
  });
});
