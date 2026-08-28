// ===== RankTrackingService 单元测试（P0-02-D） =====
// 覆盖：rankChange 方向、status 全分类（improved/declined/stable/new/lost/not_ranked）、
//       rankingUrl 变化信号、trend deterministic 规则、项目分布统计、竞品变动、日期窗口

import { beforeEach, describe, expect, it, vi } from "vitest";

const getRankHistoryMock = vi.fn();
const getRankWindowMock = vi.fn();
const getCompetitorRankMovementMock = vi.fn();
const getTrackedKeywordByIdMock = vi.fn();
const listTrackedKeywordsMock = vi.fn();

vi.mock("@/lib/db", () => ({
  getRankHistory: (...args: unknown[]) => getRankHistoryMock(...args),
  getRankWindow: (...args: unknown[]) => getRankWindowMock(...args),
  getCompetitorRankMovement: (...args: unknown[]) => getCompetitorRankMovementMock(...args),
  getTrackedKeywordById: (...args: unknown[]) => getTrackedKeywordByIdMock(...args),
  listTrackedKeywords: (...args: unknown[]) => listTrackedKeywordsMock(...args),
}));

import {
  classifyRankStatus,
  computeRankChange,
  computeRankTrend,
  getKeywordRankIntelligence,
  getProjectRankSummary,
} from "./rank-tracking-service";

function historyRows(entries: Array<[string, number | null, string | null]>) {
  return entries.map(([date, position, url], i) => ({
    id: i + 1,
    keyword_id: 1,
    date,
    position,
    url,
    featureTypes: [] as string[],
    created_at: `${date} 00:00:00`,
  }));
}

beforeEach(() => {
  getRankHistoryMock.mockReset().mockResolvedValue([]);
  getRankWindowMock.mockReset().mockResolvedValue([]);
  getCompetitorRankMovementMock.mockReset().mockResolvedValue([]);
  getTrackedKeywordByIdMock.mockReset();
  listTrackedKeywordsMock.mockReset().mockResolvedValue([]);
});

describe("computeRankChange", () => {
  // 与 tracking UI 口径一致：正 = 上升（previous 12 → current 8 = +4）
  it("previous 12 / current 8 → +4（上升为正）", () => {
    expect(computeRankChange(12, 8)).toBe(4);
  });
  it("下降为负、持平为 0、任一侧 null 为 null", () => {
    expect(computeRankChange(8, 12)).toBe(-4);
    expect(computeRankChange(10, 10)).toBe(0);
    expect(computeRankChange(null, 8)).toBe(null);
    expect(computeRankChange(8, null)).toBe(null);
  });
});

describe("classifyRankStatus", () => {
  it("improved / declined / stable", () => {
    expect(classifyRankStatus(12, 10)).toBe("improved");
    expect(classifyRankStatus(10, 12)).toBe("declined");
    expect(classifyRankStatus(10, 10)).toBe("stable");
  });
  it("null 不当作 100：new / lost / not_ranked", () => {
    expect(classifyRankStatus(null, 15)).toBe("new");
    expect(classifyRankStatus(15, null)).toBe("lost");
    expect(classifyRankStatus(null, null)).toBe("not_ranked");
  });
});

describe("computeRankTrend", () => {
  it("后半中位排名明显变小 → improving", () => {
    // 18,16,14,13 | 11,10,10,8 → median 15 vs 10 → improving
    const history = [18, 16, 14, 13, 11, 10, 10, 8].map((position) => ({ position }));
    expect(computeRankTrend(history)).toBe("improving");
  });
  it("后半明显变大 → declining；持平 → stable", () => {
    const declining = [8, 10, 10, 11, 13, 14, 16, 18].map((position) => ({ position }));
    expect(computeRankTrend(declining)).toBe("declining");
    const stable = [10, 10, 10, 10, 10, 10, 10, 10].map((position) => ({ position }));
    expect(computeRankTrend(stable)).toBe("stable");
  });
  it("有排名记录不足 4 条 → null（样本不足不下结论）", () => {
    expect(computeRankTrend([{ position: 5 }, { position: 3 }])).toBe(null);
  });
  it("null 排名记录被过滤，不参与中位数", () => {
    const history = [{ position: 20 }, { position: null }, { position: 18 }, { position: 16 }, { position: 14 }, { position: 12 }, { position: 10 }, { position: 8 }];
    expect(computeRankTrend(history)).toBe("improving");
  });
});

describe("getKeywordRankIntelligence", () => {
  it("current/previous/change/status 与 ranking URL 变化信号", async () => {
    getRankHistoryMock.mockResolvedValue(historyRows([
      ["2026-08-26", 12, "https://me.site/old"],
      ["2026-08-27", 8, "https://me.site/new"],
    ]));

    const result = await getKeywordRankIntelligence({ userId: "u1", keywordId: 1 });

    expect(result.current).toMatchObject({ rank: 8, rankingUrl: "https://me.site/new" });
    expect(result.previous).toMatchObject({ rank: 12, rankingUrl: "https://me.site/old" });
    expect(result.change).toBe(4);
    expect(result.status).toBe("improved");
    expect(result.rankingUrlChanged).toBe(true); // Google 换了 ranking page
    expect(result.history).toHaveLength(2);
  });

  it("仅一条历史 → previous null、status new、URL 变化为 null", async () => {
    getRankHistoryMock.mockResolvedValue(historyRows([["2026-08-28", 5, "https://me.site/a"]]));
    const result = await getKeywordRankIntelligence({ userId: "u1", keywordId: 1 });
    expect(result.current?.rank).toBe(5);
    expect(result.previous).toBe(null);
    expect(result.status).toBe("new");
    expect(result.rankingUrlChanged).toBe(null);
  });

  it("空历史 → 全 null + not_ranked", async () => {
    const result = await getKeywordRankIntelligence({ userId: "u1", keywordId: 1 });
    expect(result.current).toBe(null);
    expect(result.change).toBe(null);
    expect(result.status).toBe("not_ranked");
    expect(result.trend).toBe(null);
  });

  it("竞品变动复用 getCompetitorRankMovement", async () => {
    getRankHistoryMock.mockResolvedValue(historyRows([["2026-08-28", 5, null]]));
    getCompetitorRankMovementMock.mockResolvedValue([
      { competitor_id: 11, domain: "rival.com", currentRank: 2, previousRank: 3, change: 1 },
    ]);
    const result = await getKeywordRankIntelligence({ userId: "u1", keywordId: 1 });
    expect(result.competitorMovement).toEqual([
      { competitor_id: 11, domain: "rival.com", currentRank: 2, previousRank: 3, change: 1 },
    ]);
  });

  it("featureTypes 透传（rank_history.feature_types）", async () => {
    getRankHistoryMock.mockResolvedValue(historyRows([["2026-08-28", 5, null]]).map((row) => ({
      ...row,
      featureTypes: ["featured_snippet", "local_pack"],
    })));
    const result = await getKeywordRankIntelligence({ userId: "u1", keywordId: 1 });
    expect(result.current?.featureTypes).toEqual(["featured_snippet", "local_pack"]);
  });
});

describe("getProjectRankSummary", () => {
  function windowRows(items: Array<{ id: number; keyword: string; series: Array<[string, number | null, string | null]> }>) {
    return items.flatMap(({ id, keyword, series }) =>
      series.map(([date, position, url]) => ({
        keyword_id: id, keyword, domain: "me.site", location: "中国",
        device: "PC" as const, date, position, url, featureTypes: [] as string[],
      }))
    );
  }

  it("分布统计 + 每词 status（多序列按 keyword+location+device 隔离）", async () => {
    getRankWindowMock.mockResolvedValue(windowRows([
      { id: 1, keyword: "top", series: [["2026-08-27", 5, "u1"], ["2026-08-28", 2, "u1"]] },
      { id: 2, keyword: "dropper", series: [["2026-08-27", 3, null], ["2026-08-28", 15, null]] },
      { id: 3, keyword: "lost", series: [["2026-08-27", 9, null], ["2026-08-28", null, null]] },
      { id: 4, keyword: "newcomer", series: [["2026-08-28", 25, null]] },
      { id: 5, keyword: "mobile", series: [["2026-08-28", 45, null]] }, // 同名关键词 mobile 序列
    ]));

    const summary = await getProjectRankSummary("u1", "me.site", 30);

    expect(summary.distribution).toEqual({
      trackedCount: 5, rankedCount: 4,
      top3Count: 1, top10Count: 1, top20Count: 2, top50Count: 4,
      notRankingCount: 1,
      averageRank: 21.8, // (2+15+25+45)/4
      medianRank: 20,   // [2,15,25,45] → (15+25)/2
    });
    const top = summary.keywords.find((k) => k.keyword === "top");
    expect(top).toMatchObject({ currentRank: 2, previousRank: 5, change: 3, status: "improved" });
    expect(summary.keywords.find((k) => k.keyword === "dropper")).toMatchObject({ status: "declined", change: -12 });
    expect(summary.keywords.find((k) => k.keyword === "lost")).toMatchObject({ status: "lost", currentRank: null });
    expect(summary.keywords.find((k) => k.keyword === "newcomer")).toMatchObject({ status: "new" });
  });

  it("空窗口 → 全零分布", async () => {
    const summary = await getProjectRankSummary("u1", "me.site", 30);
    expect(summary.distribution.trackedCount).toBe(0);
    expect(summary.distribution.averageRank).toBe(null);
    expect(summary.keywords).toEqual([]);
  });

  it("同关键词不同 location 是独立序列（window 查询以 tracked_keywords 为准）", async () => {
    getRankWindowMock.mockResolvedValue([
      { keyword_id: 1, keyword: "seo", domain: "me.site", location: "中国", device: "PC" as const, date: "2026-08-28", position: 8, url: null, featureTypes: [] },
      { keyword_id: 2, keyword: "seo", domain: "me.site", location: "美国", device: "PC" as const, date: "2026-08-28", position: 30, url: null, featureTypes: [] },
    ]);
    const summary = await getProjectRankSummary("u1", "me.site", 30);
    const seoCn = summary.keywords.find((k) => k.location === "中国");
    const seoUs = summary.keywords.find((k) => k.location === "美国");
    expect(seoCn).toMatchObject({ currentRank: 8 });
    expect(seoUs).toMatchObject({ currentRank: 30 });
  });
});
