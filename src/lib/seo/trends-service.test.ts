// ===== Google Trends Service 单元测试（P4） =====
// 覆盖：命中缓存不消耗配额、miss 扣一次配额、per-dataType 独立缓存命名空间、
//       并发去重（in-flight Map，双击不重复扣费）、缓存写入失败不影响返回。

import { beforeEach, describe, expect, it, vi } from "vitest";

const readCacheMock = vi.fn();
const writeCacheMock = vi.fn();
const consumeQuotaMock = vi.fn();
const peekUsageMock = vi.fn();
const fetchTrendsMock = vi.fn();

vi.mock("./cache", () => ({
  readCache: (...args: unknown[]) => readCacheMock(...args),
  writeCache: (...args: unknown[]) => writeCacheMock(...args),
  consumeQuota: (...args: unknown[]) => consumeQuotaMock(...args),
  peekUsage: (...args: unknown[]) => peekUsageMock(...args),
  refundQuota: () => Promise.resolve(),
}));

vi.mock("./serpapi", () => ({
  fetchGoogleTrends: (...args: unknown[]) => fetchTrendsMock(...args),
  assertSerpApiConfigured: () => undefined,
  TRENDS_DATE_OPTIONS: ["today 12-m", "today 5-y"],
  TRENDS_DEFAULT_DATE: "today 12-m",
}));

import { fetchTrendsData, getTrendsUsage, TRENDS_PROVIDER_VERSION } from "./trends-service";
import type { TrendsResult } from "./serpapi";

const usage = { used: 2, limit: 30, month: "2026-10" };

function makeTrendsResult(overrides: Partial<TrendsResult> = {}): TrendsResult {
  return {
    dataType: "RELATED_QUERIES",
    keyword: "seo audit tool",
    geo: "US",
    hl: "en",
    dateRange: "today 12-m",
    fetchedAt: "2026-10-29T00:00:00.000Z",
    top: [{ label: "free seo audit tool", topicType: null, value: 100, extractedValue: 100 }],
    rising: [{ label: "ai seo audit", topicType: null, value: "Breakout", extractedValue: null }],
    ...overrides,
  };
}

beforeEach(() => {
  readCacheMock.mockReset().mockResolvedValue(null);
  writeCacheMock.mockReset().mockResolvedValue(undefined);
  consumeQuotaMock.mockReset().mockResolvedValue(usage);
  peekUsageMock.mockReset().mockResolvedValue(usage);
  fetchTrendsMock.mockReset().mockImplementation(
    async (_kw: string, _loc: string, dataType: string) => makeTrendsResult({ dataType: dataType as TrendsResult["dataType"] })
  );
});

describe("fetchTrendsData 缓存与配额", () => {
  it("cache miss：扣一次 serpapi 配额、调 provider、写缓存", async () => {
    const result = await fetchTrendsData("u1", "free", {
      keyword: "SEO Audit Tool",
      location: "美国",
      dataType: "RELATED_QUERIES",
    });
    expect(consumeQuotaMock).toHaveBeenCalledTimes(1);
    expect(consumeQuotaMock).toHaveBeenCalledWith("u1", "serpapi", "free");
    expect(fetchTrendsMock).toHaveBeenCalledTimes(1);
    expect(fetchTrendsMock).toHaveBeenCalledWith("SEO Audit Tool", "美国", "RELATED_QUERIES", {
      date: undefined,
      language: undefined,
    });
    expect(writeCacheMock).toHaveBeenCalledTimes(1);
    expect(result.fromCache).toBe(false);
  });

  it("cache hit：不调 provider、不消耗配额", async () => {
    readCacheMock.mockResolvedValue(makeTrendsResult());
    const result = await fetchTrendsData("u1", "free", {
      keyword: "seo audit tool",
      location: "美国",
      dataType: "RELATED_QUERIES",
    });
    expect(consumeQuotaMock).not.toHaveBeenCalled();
    expect(fetchTrendsMock).not.toHaveBeenCalled();
    expect(result.fromCache).toBe(true);
    expect(result.top).toHaveLength(1);
  });

  it("每个 data_type 独立缓存命名空间与 key（响应结构不同，不可混存）", async () => {
    const cases: Parameters<typeof fetchTrendsData>[2]["dataType"][] = [
      "TIMESERIES",
      "GEO_MAP_0",
      "RELATED_QUERIES",
      "RELATED_TOPICS",
    ];
    for (const dataType of cases) {
      await fetchTrendsData("u1", "free", { keyword: "kw", location: "美国", dataType });
    }
    const namespaces = readCacheMock.mock.calls.map((call) => call[0]);
    expect(new Set(namespaces)).toEqual(
      new Set(["trends-timeseries", "trends-geo_map_0", "trends-related_queries", "trends-related_topics"])
    );
    // 同一 namespace 的 cacheParams：provider 版本 + dataType + keyword 归一 + date/language
    const key = readCacheMock.mock.calls.find((call) => call[0] === "trends-related_queries")?.[1];
    expect(key).toEqual({
      provider: TRENDS_PROVIDER_VERSION,
      dataType: "RELATED_QUERIES",
      keyword: "kw",
      location: "美国",
      date: "today 12-m",
      language: "",
    });
  });

  it("date 不在白名单时回退 today 12-m（key 与实际请求一致）；显式 date 保留", async () => {
    await fetchTrendsData("u1", "free", { keyword: "kw", location: "美国", dataType: "TIMESERIES", date: "today 5-y" });
    expect(readCacheMock.mock.calls[0][1].date).toBe("today 5-y");

    await fetchTrendsData("u1", "free", { keyword: "kw", location: "美国", dataType: "TIMESERIES", date: "arbitrary" });
    expect(readCacheMock.mock.calls[1][1].date).toBe("today 12-m");
  });

  it("关键词大小写/首尾空格在 cache key 中归一（同一词不重复扣费）", async () => {
    await fetchTrendsData("u1", "free", { keyword: "  SEO AUDIT tool ", location: "美国", dataType: "RELATED_QUERIES" });
    await fetchTrendsData("u1", "free", { keyword: "seo audit tool", location: "美国", dataType: "RELATED_QUERIES" });
    expect(readCacheMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(readCacheMock.mock.calls[0][1])).toBe(JSON.stringify(readCacheMock.mock.calls[1][1]));
  });
});

describe("fetchTrendsData 并发去重", () => {
  it("同一 data_type/关键词/市场并发的请求共享同一个 Promise（不重复扣配额）", async () => {
    let release!: (value: TrendsResult & { fromCache: boolean }) => void;
    fetchTrendsMock.mockImplementation(
      () => new Promise<TrendsResult & { fromCache: boolean }>((resolve) => (release = resolve))
    );
    const params = { keyword: "kw", location: "美国", dataType: "RELATED_QUERIES" as const };
    const first = fetchTrendsData("u1", "free", params);
    const second = fetchTrendsData("u1", "free", params);
    // readCache 是异步 mock：让 miss 分支推进到 provider 调用后再放行
    await new Promise((resolve) => setTimeout(resolve, 0));
    release(makeTrendsResult() as TrendsResult & { fromCache: boolean });
    const [a, b] = await Promise.all([first, second]);
    expect(consumeQuotaMock).toHaveBeenCalledTimes(1);
    expect(fetchTrendsMock).toHaveBeenCalledTimes(1);
    expect(a.top).toHaveLength(1);
    expect(b.top).toHaveLength(1);
  });

  it("不同 data_type 并发不共享（各自独立扣费）", async () => {
    await Promise.all([
      fetchTrendsData("u1", "free", { keyword: "kw", location: "美国", dataType: "TIMESERIES" }),
      fetchTrendsData("u1", "free", { keyword: "kw", location: "美国", dataType: "GEO_MAP_0" }),
    ]);
    expect(consumeQuotaMock).toHaveBeenCalledTimes(2);
  });

  it("请求完成后清理 in-flight 条目：下一次调用重新走缓存判定", async () => {
    fetchTrendsMock.mockResolvedValue(makeTrendsResult());
    await fetchTrendsData("u1", "free", { keyword: "kw", location: "美国", dataType: "TIMESERIES" });
    await fetchTrendsData("u1", "free", { keyword: "kw", location: "美国", dataType: "TIMESERIES" });
    expect(fetchTrendsMock).toHaveBeenCalledTimes(2);
  });
});

describe("写入缓存失败不影响返回（best-effort）", () => {
  it("writeCache 抛错时结果照常返回", async () => {
    writeCacheMock.mockRejectedValue(new Error("disk full"));
    const result = await fetchTrendsData("u1", "free", { keyword: "kw", location: "美国", dataType: "RELATED_TOPICS" });
    expect(result.dataType).toBe("RELATED_TOPICS");
    expect(result.fromCache).toBe(false);
  });
});

describe("getTrendsUsage", () => {
  it("透传 peekUsage（不额外消耗配额）", async () => {
    const result = await getTrendsUsage("u1", "lite");
    expect(peekUsageMock).toHaveBeenCalledWith("u1", "serpapi", "lite");
    expect(result).toEqual(usage);
  });
});
