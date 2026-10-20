// ===== /api/tracking GET 的域名范围（报表中心按项目生成周报/排名报告）=====
// 该 GET 原先完全忽略查询参数，只能返回账号级全量列表；
// 报表生成因此会把别的项目的关键词算进当前项目。
// 现在：?domain=<域名> → 走 listTrackedKeywords(userId, domain)（SQL 层按 (user_id, domain) 过滤）；
// 不带或为空 → 保持账号级全量，老调用方行为不变。usage / limit 字段语义不受影响。

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

const ALL = [K(1, "a one", "acme.test"), K(2, "a two", "acme.test"), K(3, "b one", "other.test")];

const listTrackedKeywords = vi.fn();

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
  listTrackedKeywords: (...args: unknown[]) => listTrackedKeywords(...args),
}));

vi.mock("@/lib/seo/cache", () => ({
  peekUsage: vi.fn(async () => ({ used: 3, limit: 100, month: "2026-10" })),
}));

import { GET } from "./route";

function mockRowsByDomain() {
  listTrackedKeywords.mockImplementation(async (_userId: string, domain?: string) =>
    domain ? ALL.filter((k) => k.domain === domain) : ALL
  );
}

const get = (qs: string) => GET(new Request(`https://seeo.test/api/tracking${qs}`));

beforeEach(() => {
  listTrackedKeywords.mockReset();
  mockRowsByDomain();
});

describe("GET /api/tracking 的域名过滤", () => {
  it("带 domain 时按 (user_id, domain) 过滤，只返回该项目关键词", async () => {
    const res = await get("?domain=acme.test");
    const json = await res.json();
    expect(listTrackedKeywords).toHaveBeenCalledWith("user-1", "acme.test");
    expect(json.data.map((k: { keyword: string }) => k.keyword)).toEqual(["a one", "a two"]);
  });

  it("URL 编码的域名照常命中", async () => {
    const res = await get(`?domain=${encodeURIComponent("www.toolstep.top")}`);
    await res.json();
    expect(listTrackedKeywords).toHaveBeenCalledWith("user-1", "www.toolstep.top");
  });

  it("不带 domain 仍是账号级全量（老调用方行为不变）", async () => {
    const res = await get("");
    const json = await res.json();
    expect(listTrackedKeywords).toHaveBeenCalledWith("user-1", undefined);
    expect(json.data).toHaveLength(3);
  });

  it("空串与纯空白域名等同于不过滤，不会查出一个空项目", async () => {
    await get("?domain=");
    expect(listTrackedKeywords).toHaveBeenLastCalledWith("user-1", undefined);
    await get("?domain=%20%20");
    expect(listTrackedKeywords).toHaveBeenLastCalledWith("user-1", undefined);
  });

  it("响应仍带 usage 与 limit 字段，分页额度语义未被改动", async () => {
    const json = await (await get("?domain=acme.test")).json();
    expect(json.usage).toEqual({ used: 3, limit: 100, month: "2026-10" });
    expect(json.limit).toBe(50);
  });

  it("该项目没有关键词时返回空数组，而不是回落到全量", async () => {
    const json = await (await get("?domain=nothing.test")).json();
    expect(json.data).toEqual([]);
  });
});
