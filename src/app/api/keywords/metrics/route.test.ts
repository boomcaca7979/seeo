// ===== /api/keywords/metrics 路由契约测试（DEF-06）=====
// 该路由只做真实指标补全：不调用 expand、不编造数值、失败时如实降级。

import { beforeEach, describe, expect, it, vi } from "vitest";

const enrichMock = vi.fn<
  (userId: string, plan: string, keywords: string[], location: string, language?: string) => Promise<unknown>
>();

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
  enrichKeywordMetrics: (userId: string, plan: string, keywords: string[], location: string, language?: string) =>
    enrichMock(userId, plan, keywords, location, language),
}));

import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("https://www.seeo.asia/api/keywords/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  enrichMock.mockResolvedValue({
    rows: [{ keyword: "seo", searchVolume: 12100, cpc: 1.5, competition: 0.3, competitionLevel: "LOW", difficulty: 42, intent: null, trend: null, currency: "USD" }],
    source: "dataforseo",
    fromCache: true,
    warnings: [],
  });
});

describe("POST /api/keywords/metrics", () => {
  it("正常补全：返回真实 rows 与来源，并去重关键词", async () => {
    const res = await post({ keywords: ["seo", " seo ", "seo tools"], location: "中国", language: "zh-cn" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.source).toBe("dataforseo");
    expect(json.data.requested).toBe(2);
    expect(json.data.rows).toHaveLength(1);
    expect(enrichMock).toHaveBeenCalledWith("user-1", "lite", ["seo", "seo tools"], "中国", "zh-cn");
  });

  it("数据源不可用时 source=null 且带 warnings，不伪造数值", async () => {
    enrichMock.mockResolvedValue({
      rows: [],
      source: null,
      fromCache: false,
      warnings: ["keyword metrics 不可用：DataForSEO 凭据未配置"],
    });
    const res = await post({ keywords: ["seo"] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.source).toBeNull();
    expect(json.data.rows).toEqual([]);
    expect(json.data.warnings[0]).toContain("不可用");
  });

  it("keywords 非数组 → 400，不触达 service", async () => {
    const res = await post({ keywords: "seo" });
    expect(res.status).toBe(400);
    expect(enrichMock).not.toHaveBeenCalled();
  });

  it("空数组 / 全空白 → 400", async () => {
    expect((await post({ keywords: [] })).status).toBe(400);
    expect((await post({ keywords: ["  ", ""] })).status).toBe(400);
    expect(enrichMock).not.toHaveBeenCalled();
  });

  it("超过 200 个关键词 → 400（成本保护）", async () => {
    const many = Array.from({ length: 201 }, (_, i) => `kw-${i}`);
    const res = await post({ keywords: many });
    expect(res.status).toBe(400);
    expect(enrichMock).not.toHaveBeenCalled();
  });

  // ===== 可用数值计数（2026-11-01 定向修复）=====
  // 「返回了 N 行」≠「N 个关键词有指标」：全部为 null 时必须能被前端识别，
  // 否则会显示「已从缓存读取 N 个关键词的指标」这种误导性成功提示。
  it("全部为 null：returned>0 但 withValues=0", async () => {
    enrichMock.mockResolvedValue({
      rows: [
        { keyword: "seo", searchVolume: null, cpc: null, competition: null, competitionLevel: null, difficulty: null, intent: null, trend: null, currency: null },
        { keyword: "seo tools", searchVolume: null, cpc: null, competition: null, competitionLevel: null, difficulty: null, intent: null, trend: null, currency: null },
      ],
      source: "dataforseo",
      fromCache: true,
      warnings: [],
    });
    const res = await post({ keywords: ["seo", "seo tools"] });
    const json = await res.json();
    expect(json.data.returned).toBe(2);
    expect(json.data.withValues).toBe(0);
    expect(json.data.fromCache).toBe(true);
  });

  it("部分为 null：withValues 只统计真正带数字的行", async () => {
    enrichMock.mockResolvedValue({
      rows: [
        { keyword: "seo", searchVolume: 12100, cpc: 1.5, competition: 0.3, competitionLevel: "LOW", difficulty: 42, intent: null, trend: null, currency: "USD" },
        { keyword: "seo tools", searchVolume: null, cpc: null, competition: null, competitionLevel: null, difficulty: null, intent: null, trend: null, currency: null },
        // 只有 difficulty 也算有可用数值
        { keyword: "seo audit", searchVolume: null, cpc: null, competition: null, competitionLevel: null, difficulty: 17, intent: null, trend: null, currency: null },
      ],
      source: "dataforseo",
      fromCache: false,
      warnings: [],
    });
    const res = await post({ keywords: ["seo", "seo tools", "seo audit"] });
    const json = await res.json();
    expect(json.data.returned).toBe(3);
    expect(json.data.withValues).toBe(2);
    expect(json.data.requested).toBe(3);
  });

  // ===== 套餐边界 vs 数据源配置（2026-11-01 R3）=====
  // 免费套餐额度为 0：用户拿不到数据的原因不是「DataForSEO 没配置」，
  // 而是「你的套餐里没有这项」，API 必须把这个区别透出去。
  it("套餐不含（free）：透出 reason=plan_not_included + planIncluded=false", async () => {
    enrichMock.mockResolvedValue({
      rows: [],
      source: null,
      fromCache: false,
      warnings: ["当前套餐（free）不含市场指标额度（0 次/月），未发起数据请求"],
      planIncluded: false,
      reason: "plan_not_included",
    });
    const res = await post({ keywords: ["seo"] });
    const json = await res.json();
    expect(json.data.reason).toBe("plan_not_included");
    expect(json.data.planIncluded).toBe(false);
    expect(json.data.source).toBeNull();
  });

  it("数据源未配置（lite/pro）：reason=unconfigured，不得标成套餐不含", async () => {
    enrichMock.mockResolvedValue({
      rows: [],
      source: null,
      fromCache: false,
      warnings: ["keyword metrics 不可用：未配置 DataForSEO 凭证（DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD）"],
      planIncluded: true,
      reason: "unconfigured",
    });
    const res = await post({ keywords: ["seo"] });
    const json = await res.json();
    expect(json.data.reason).toBe("unconfigured");
    expect(json.data.planIncluded).toBe(true);
  });

  it("有数据时 reason=null（不把成功响应标成任何失败原因）", async () => {
    const res = await post({ keywords: ["seo"] });
    const json = await res.json();
    expect(json.data.reason).toBeNull();
    expect(json.data.withValues).toBe(1);
  });
});
