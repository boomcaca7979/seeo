// ===== /api/keywords/trends 路由契约测试（P4） =====
// 覆盖：鉴权、参数校验（seed/dataType 白名单）、透传 trends-service、usage 附带、
//       provider 错误经统一错误映射。路由层不重复记账（缓存/配额单点在 service）。

import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchTrendsDataMock = vi.fn();
const getTrendsUsageMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireAuthOrDemo: vi.fn(async () => ({
    allowed: true,
    skip: false,
    user: { id: "user-1" },
    plan: "lite",
    error: undefined,
  })),
}));

vi.mock("@/lib/seo/trends-service", () => ({
  fetchTrendsData: (...args: unknown[]) => fetchTrendsDataMock(...args),
  getTrendsUsage: (...args: unknown[]) => getTrendsUsageMock(...args),
}));

import { POST } from "./route";
import { requireAuthOrDemo } from "@/lib/auth";

const usage = { used: 3, limit: 30, month: "2026-10" };

function post(body: unknown) {
  return POST(
    new Request("https://www.seeo.asia/api/keywords/trends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getTrendsUsageMock.mockResolvedValue(usage);
});

describe("POST /api/keywords/trends", () => {
  it("合法请求透传 trends-service 并附带 usage", async () => {
    const data = { dataType: "RELATED_QUERIES", keyword: "seo audit tool", top: [], rising: [], fromCache: false };
    fetchTrendsDataMock.mockResolvedValue(data);
    const res = await post({ seed: "seo audit tool", location: "美国", dataType: "RELATED_QUERIES" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual(data);
    expect(json.usage).toEqual(usage);
    expect(fetchTrendsDataMock).toHaveBeenCalledWith("user-1", "lite", {
      keyword: "seo audit tool",
      location: "美国",
      dataType: "RELATED_QUERIES",
    });
    expect(getTrendsUsageMock).toHaveBeenCalledWith("user-1", "lite");
  });

  it("date / language 缺省不透传空串（service 层白名单回退 today 12-m）", async () => {
    fetchTrendsDataMock.mockResolvedValue({ dataType: "TIMESERIES" });
    await post({ seed: "kw", location: "美国", dataType: "TIMESERIES", date: "", language: "" });
    expect(fetchTrendsDataMock).toHaveBeenCalledWith("user-1", "lite", {
      keyword: "kw",
      location: "美国",
      dataType: "TIMESERIES",
    });
  });

  it("缺 seed / 非法 dataType / 非法 JSON → 400 BAD_REQUEST，不触达 service", async () => {
    expect((await post({ location: "美国", dataType: "TIMESERIES" })).status).toBe(400);
    expect((await post({ seed: "kw", dataType: "RECURSIVE_EXPAND" })).status).toBe(400);
    expect((await post({ seed: "kw", dataType: "timeseries" })).status).toBe(400);
    const res = await POST(
      new Request("https://www.seeo.asia/api/keywords/trends", {
        method: "POST",
        body: "not-json",
      })
    );
    expect(res.status).toBe(400);
    expect(fetchTrendsDataMock).not.toHaveBeenCalled();
  });

  it("location 缺省回退「中国」", async () => {
    fetchTrendsDataMock.mockResolvedValue({ dataType: "TIMESERIES" });
    await post({ seed: "kw", dataType: "TIMESERIES" });
    expect(fetchTrendsDataMock).toHaveBeenCalledWith("user-1", "lite", {
      keyword: "kw",
      location: "中国",
      dataType: "TIMESERIES",
    });
  });

  it("service 抛 SeoProviderError → 统一错误映射（不写缓存语义由 service 保证）", async () => {
    const { SeoProviderError } = await import("@/lib/seo/provider");
    fetchTrendsDataMock.mockRejectedValue(new SeoProviderError("QUOTA_EXCEEDED", "额度已耗尽"));
    const res = await post({ seed: "kw", location: "美国", dataType: "GEO_MAP_0" });
    expect(res.status).toBe(429);
    const json = await res.json();
    // 上游 SerpApi 账户额度耗尽 → UPSTREAM_QUOTA（非用户套餐配额，升级不可解除）
    expect(json.code).toBe("UPSTREAM_QUOTA");
  });

  it("未登录 → 401 AUTH_REQUIRED", async () => {
    vi.mocked(requireAuthOrDemo).mockResolvedValueOnce({
      allowed: false,
      skip: false,
      user: null,
      plan: "free",
      error: "请先登录",
    } as never);
    const res = await post({ seed: "kw", dataType: "TIMESERIES" });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.code).toBe("AUTH_REQUIRED");
    expect(fetchTrendsDataMock).not.toHaveBeenCalled();
  });
});
