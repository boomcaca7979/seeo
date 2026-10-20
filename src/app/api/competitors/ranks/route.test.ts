// ===== /api/competitors/ranks BUG-01 回归 =====
// 打开竞品分析页（GET）必须是纯只读：
//   - 不触发排名刷新（checkCompetitorRanks → SerpApi）、不扣日/月额度
//   - 「无缓存」= 200 + needsRefresh，不是 API 故障，也不是空结果伪装成实时数据
//   - 「数据库故障」= 5xx + 错误 code，不得降级成无数据
// 只有用户显式点击「刷新排名并对比」（POST）才允许请求上游。

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuthOrDemo: vi.fn(async () => ({
    allowed: true,
    skip: false,
    user: { id: "user-1" },
    plan: "free" as const,
    subscriptionStatus: null,
    error: undefined,
  })),
}));

type RankRow = {
  competitor_id: number;
  domain: string;
  rank: number | null;
  target_url: string | null;
  checked_at: string;
};

const state = {
  keyword: { id: 7, keyword: "seo audit tool", domain: "toolstep.xyz", location: "United States", device: "PC" } as
    | { id: number; keyword: string; domain: string; location: string; device: "PC" | "移动端" }
    | null,
  latest: [] as RankRow[],
  history: [] as { date: string; position: number | null; url: string | null }[],
  usage: { used: 3, limit: 3, month: "2026-10" },
  checkResult: {
    results: [
      { competitorId: 0, domain: "toolstep.xyz", rank: 5, targetUrl: "https://toolstep.xyz/" },
      { competitorId: 11, domain: "competitor-a.com", rank: 3, targetUrl: "https://competitor-a.com/x" },
    ],
    fromCache: false,
    usage: { used: 2, limit: 3, month: "2026-10" },
  },
  dbFailure: null as string | null,
};

/** SQLite datetime('now') 同款格式（UTC，"YYYY-MM-DD HH:MM:SS"） */
function sqlDateTime(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace("T", " ");
}

function throwIfDbFailed(): void {
  if (state.dbFailure) throw new Error(state.dbFailure);
}

vi.mock("@/lib/db", () => ({
  getTrackedKeywordById: vi.fn(async (_userId: string, id: number) => {
    throwIfDbFailed();
    return state.keyword && state.keyword.id === id ? state.keyword : null;
  }),
  getLatestCompetitorRanks: vi.fn(async () => {
    throwIfDbFailed();
    return state.latest;
  }),
  getRankHistory: vi.fn(async () => {
    if (state.dbFailure) throw new Error(state.dbFailure);
    return state.history.map((h, i) => ({
      id: i + 1,
      keyword_id: 7,
      date: h.date,
      position: h.position,
      url: h.url,
      featureTypes: [],
      created_at: h.date,
    }));
  }),
  addCompetitorRank: vi.fn(async () => true),
  listCompetitors: vi.fn(async () => [{ id: 11, project_id: 2, domain: "competitor-a.com" }]),
  getProjectByDomain: vi.fn(async () => ({ id: 2, domain: "toolstep.xyz", name: "toolstep" })),
}));

// 只读路径绝不许碰的两处：上游查询入口 + 额度消耗入口
// QuotaExceededError 必须一并导出：serp-route-errors 用 `instanceof` 判分支
vi.mock("@/lib/seo/competitor", () => ({
  checkCompetitorRanks: vi.fn(async () => state.checkResult),
}));

vi.mock("@/lib/seo/cache", () => {
  class QuotaExceededError extends Error {
    readonly code = "QUOTA_EXCEEDED";
    readonly used: number;
    readonly limit: number;
    readonly apiType: string;
    readonly month: string;
    readonly scope: "monthly" | "daily";
    constructor(used: number, limit: number, apiType: string, month: string, scope: "monthly" | "daily" = "monthly") {
      super(
        scope === "daily"
          ? `今日SerpApi额度已用尽（${used}/${limit}），明日自动重置`
          : `本月SerpApi额度已用尽（${used}/${limit}），下月 1 日自动重置`
      );
      this.name = "QuotaExceededError";
      this.used = used;
      this.limit = limit;
      this.apiType = apiType;
      this.month = month;
      this.scope = scope;
    }
  }
  return {
    QuotaExceededError,
    peekUsage: vi.fn(async () => state.usage),
    consumeQuota: vi.fn(async () => ({ used: 4, limit: 3, month: "2026-10" })),
  };
});

import { GET, POST } from "./route";
import { checkCompetitorRanks } from "@/lib/seo/competitor";
import { consumeQuota, peekUsage, QuotaExceededError } from "@/lib/seo/cache";
import { addCompetitorRank, getLatestCompetitorRanks } from "@/lib/db";
import { SeoProviderError } from "@/lib/seo/provider";

const ranksGet = (keywordId: number | string) =>
  GET(new Request(`https://www.seeo.asia/api/competitors/ranks?keyword_id=${keywordId}`));

beforeEach(() => {
  vi.clearAllMocks();
  state.keyword = { id: 7, keyword: "seo audit tool", domain: "toolstep.xyz", location: "United States", device: "PC" };
  state.latest = [];
  state.history = [];
  state.usage = { used: 3, limit: 3, month: "2026-10" };
  state.dbFailure = null;
});

describe("GET 只读：不消耗额度（BUG-01 根因）", () => {
  it("无缓存 → 200 + needsRefresh，绝不触发排名刷新与额度扣减", async () => {
    state.latest = [];
    const res = await ranksGet(7);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({
      results: [],
      fromCache: false,
      stale: false,
      needsRefresh: true,
      checkedAt: null,
      keyword: "seo audit tool",
    });
    expect(json.usage).toEqual(state.usage);
    expect(checkCompetitorRanks).not.toHaveBeenCalled();
    expect(consumeQuota).not.toHaveBeenCalled();
    expect(getLatestCompetitorRanks).toHaveBeenCalledWith("user-1", 7);
    // 只读用量：peek 不递增
    expect(peekUsage).toHaveBeenCalledWith("user-1", "serpapi", "free");
  });

  it("额度已耗尽（3/3）时打开页面仍是一条上游请求都不发", async () => {
    state.usage = { used: 3, limit: 3, month: "2026-10" };
    const res = await ranksGet(7);
    expect(res.status).toBe(200);
    expect(checkCompetitorRanks).not.toHaveBeenCalled();
    expect(consumeQuota).not.toHaveBeenCalled();
  });

  it("24h 内的已入库排名照常返回（保留缓存回退能力），fromCache=true", async () => {
    state.latest = [
      { competitor_id: 11, domain: "competitor-a.com", rank: 3, target_url: "https://competitor-a.com/x", checked_at: sqlDateTime(-60 * 60 * 1000) },
    ];
    state.history = [{ date: "2026-10-15", position: 8, url: "https://toolstep.xyz/blog" }];
    const json = await (await ranksGet(7)).json();
    expect(json.data.fromCache).toBe(true);
    expect(json.data.stale).toBe(false);
    expect(json.data.needsRefresh).toBe(false);
    expect(json.data.checkedAt).toBe(state.latest[0].checked_at);
    // 「本站」基准取 rank_history 最新快照，不为此请求上游
    expect(json.data.results).toEqual([
      expect.objectContaining({ domain: "toolstep.xyz", is_self: true, rank: 8, target_url: "https://toolstep.xyz/blog" }),
      expect.objectContaining({ domain: "competitor-a.com", is_self: false, rank: 3 }),
    ]);
    expect(checkCompetitorRanks).not.toHaveBeenCalled();
    expect(consumeQuota).not.toHaveBeenCalled();
  });

  it("超过 24h → 数据仍返回，但标记 stale + needsRefresh（数据状态与时间要说真话）", async () => {
    state.latest = [
      { competitor_id: 11, domain: "competitor-a.com", rank: 3, target_url: null, checked_at: sqlDateTime(-25 * 60 * 60 * 1000) },
    ];
    const json = await (await ranksGet(7)).json();
    expect(json.data.results).toHaveLength(1);
    expect(json.data.stale).toBe(true);
    expect(json.data.needsRefresh).toBe(true);
    expect(checkCompetitorRanks).not.toHaveBeenCalled();
  });

  it("无 rank_history 快照时不编造「本站」行", async () => {
    state.latest = [
      { competitor_id: 11, domain: "competitor-a.com", rank: 3, target_url: null, checked_at: sqlDateTime(-1000) },
    ];
    state.history = [];
    const json = await (await ranksGet(7)).json();
    expect(json.data.results.map((r: { is_self: boolean }) => r.is_self)).toEqual([false]);
  });

  it("数据库故障 → 500 UPSTREAM_ERROR，不伪装成「没有数据」", async () => {
    state.dbFailure = "TURSO connection reset";
    const res = await ranksGet(7);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe("UPSTREAM_ERROR");
    expect(json.data).toBeUndefined();
    expect(checkCompetitorRanks).not.toHaveBeenCalled();
  });

  it("既有契约保持：关键词缺失 404、keyword_id 非法 400", async () => {
    state.keyword = null;
    const missing = await ranksGet(7);
    expect(missing.status).toBe(404);
    expect((await missing.json()).code).toBe("KEYWORD_NOT_FOUND");

    for (const bad of ["", "0", "-1", "abc"]) {
      const res = await ranksGet(bad);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("BAD_REQUEST");
    }
  });
});

describe("POST：用户主动刷新才查上游", () => {
  function refresh(keywordId: number) {
    return POST(
      new Request("https://www.seeo.asia/api/competitors/ranks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword_id: keywordId }),
      })
    );
  }

  it("调用上游并入库，返回 needsRefresh=false + checkedAt", async () => {
    state.latest = [
      { competitor_id: 11, domain: "competitor-a.com", rank: 3, target_url: "https://competitor-a.com/x", checked_at: sqlDateTime(-1000) },
    ];
    const res = await refresh(7);
    expect(res.status).toBe(200);
    expect(checkCompetitorRanks).toHaveBeenCalledTimes(1);
    // 「我自己」（competitorId 0）不写入 competitor_ranks
    expect(addCompetitorRank).toHaveBeenCalledTimes(1);
    expect(addCompetitorRank).toHaveBeenCalledWith("user-1", expect.objectContaining({ competitor_id: 11, keyword_id: 7 }));
    const json = await res.json();
    expect(json.data).toMatchObject({ fromCache: false, stale: false, needsRefresh: false });
    expect(json.data.checkedAt).toBeTruthy();
    expect(json.data.results.some((r: { is_self: boolean; rank: number | null }) => r.is_self && r.rank === 5)).toBe(true);
  });

  it("今日额度耗尽 → 429 QUOTA_EXCEEDED + scope daily（前端据此显示明日重置）", async () => {
    vi.mocked(checkCompetitorRanks).mockRejectedValueOnce(
      new QuotaExceededError(3, 3, "serpapi", "2026-10", "daily")
    );
    const res = await refresh(7);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json).toMatchObject({ code: "QUOTA_EXCEEDED", used: 3, limit: 3, scope: "daily" });
  });

  it("本月配额耗尽 → 429 QUOTA_EXCEEDED + scope monthly", async () => {
    vi.mocked(checkCompetitorRanks).mockRejectedValueOnce(
      new QuotaExceededError(30, 30, "serpapi", "2026-10", "monthly")
    );
    const json = await (await refresh(7)).json();
    expect(json).toMatchObject({ code: "QUOTA_EXCEEDED", used: 30, limit: 30, scope: "monthly" });
  });

  it("上游 SerpApi 账户自身额度耗尽 → UPSTREAM_QUOTA（不是 billing code，前端不弹升级窗）", async () => {
    vi.mocked(checkCompetitorRanks).mockRejectedValueOnce(
      new SeoProviderError("QUOTA_EXCEEDED", "SerpApi account plan limit reached")
    );
    const res = await refresh(7);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.code).toBe("UPSTREAM_QUOTA");
    expect(json.scope).toBeUndefined();
  });

  it("刷新失败不清空已有对比数据：失败响应不带 data 字段（前端据此保留旧结果）", async () => {
    vi.mocked(checkCompetitorRanks).mockRejectedValueOnce(new SeoProviderError("TIMEOUT", "SerpApi 请求超时（10s）"));
    const json = await (await refresh(7)).json();
    expect(json).toMatchObject({ code: "TIMEOUT" });
    expect(json.data).toBeUndefined();
  });

  it("POST 同样校验关键词存在", async () => {
    state.keyword = null;
    const res = await refresh(7);
    expect(res.status).toBe(404);
    expect(checkCompetitorRanks).not.toHaveBeenCalled();
  });
});
