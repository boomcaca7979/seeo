// ===== GSC 运营机会派生测试（纯函数）=====
// 关键约束（任务第四条）：三个运营表（High Impression/Low CTR、Position 5–20、
// Top Queries）的阈值**必须从站点自身数据派生**，不引入外部行业基准常量；
// 样本不足时**不产出结论**（宁可空表，也不编造"机会"）。

import { describe, it, expect } from "vitest";
import {
  MIN_OPPORTUNITY_SAMPLE,
  POSITION_OPPORTUNITY_RANGE,
  deriveCtrOpportunities,
  derivePositionOpportunities,
  deriveTopQueries,
  median,
  type GscDimensionRow,
} from "./gsc-metrics";

function g(over: Partial<GscDimensionRow> & { key: string }): GscDimensionRow {
  return {
    clicks: 0,
    impressions: 0,
    ctr: 0,
    position: null,
    windowDays: 28,
    ...over,
  };
}

describe("median", () => {
  it("奇偶长度 / 单值 / 空", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(median([])).toBeNull();
  });

  it("忽略非有限值", () => {
    expect(median([Number.NaN, 5, Infinity, 1])).toBe(3);
  });
});

describe("deriveCtrOpportunities：高曝光低 CTR", () => {
  it(`样本 < ${MIN_OPPORTUNITY_SAMPLE} 行 → 不产出结论（basis 也是 null）`, () => {
    const rows = [
      g({ key: "a", impressions: 1000, clicks: 10, ctr: 0.01, position: 8 }),
      g({ key: "b", impressions: 800, clicks: 80, ctr: 0.1, position: 2 }),
      g({ key: "c", impressions: 600, clicks: 60, ctr: 0.1, position: 3 }),
      g({ key: "d", impressions: 400, clicks: 40, ctr: 0.1, position: 1 }),
    ];
    expect(rows.length).toBeLessThan(MIN_OPPORTUNITY_SAMPLE);
    expect(deriveCtrOpportunities(rows)).toEqual({ basis: null, items: [] });
  });

  it("门槛 = 本窗口中位曝光；CTR 基准 = 本站 position ≤ 3 中位 CTR", () => {
    const rows = [
      g({ key: "r1", impressions: 1000, clicks: 100, ctr: 0.1, position: 2 }),
      g({ key: "r2", impressions: 800, clicks: 80, ctr: 0.1, position: 3 }),
      g({ key: "r3", impressions: 600, clicks: 12, ctr: 0.02, position: 8 }),
      g({ key: "r4", impressions: 400, clicks: 4, ctr: 0.01, position: 12 }),
      g({ key: "r5", impressions: 200, clicks: 10, ctr: 0.05, position: 5 }),
      g({ key: "r6", impressions: 100, clicks: 10, ctr: 0.1, position: 1 }),
    ];
    const { basis, items } = deriveCtrOpportunities(rows);
    expect(basis).toEqual({
      impressionFloor: 500, // median(100,200,400,600,800,1000)
      ctrCeiling: 0.1, // median(0.1, 0.1, 0.1)
      ctrBasis: "position-1-3",
      sampleSize: 6,
    });
    // 只有 r3 同时满足：曝光 ≥ 500 且 CTR < 10%
    expect(items.map((i) => i.key)).toEqual(["r3"]);
    expect(items[0].ctrGapPct).toBeCloseTo(8, 6);
    expect(items[0].potentialClicks).toBe(48); // round(600 * 0.1 - 12)
  });

  it("没有 position ≤ 3 的行 → CTR 基准退回全体中位（ctrBasis=all-rows）", () => {
    const rows = [
      g({ key: "r1", impressions: 1000, clicks: 10, ctr: 0.01, position: 8 }),
      g({ key: "r2", impressions: 900, clicks: 36, ctr: 0.04, position: 6 }),
      g({ key: "r3", impressions: 800, clicks: 40, ctr: 0.05, position: 9 }),
      g({ key: "r4", impressions: 300, clicks: 15, ctr: 0.05, position: 15 }),
      g({ key: "r5", impressions: 200, clicks: 12, ctr: 0.06, position: 18 }),
      g({ key: "r6", impressions: 100, clicks: 2, ctr: 0.02, position: 20 }),
    ];
    const { basis, items } = deriveCtrOpportunities(rows);
    expect(basis?.ctrBasis).toBe("all-rows");
    expect(basis?.impressionFloor).toBe(550);
    expect(basis?.ctrCeiling).toBe(0.045);
    // 按"可多获得的点击"降序（r1 比 r2 更值得优化）
    expect(items.map((i) => i.key)).toEqual(["r1", "r2"]);
    expect(items[0].potentialClicks).toBe(35);
  });

  it("全站 CTR 为 0 → 没有可派生的基准，不产出机会", () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      g({ key: `q${i}`, impressions: 100 * (i + 1), clicks: 0, ctr: 0, position: 9 })
    );
    expect(deriveCtrOpportunities(rows)).toEqual({ basis: null, items: [] });
  });

  it("limit 生效且不改变排序（取排序后的前 N 条）", () => {
    const rows = [
      // 唯一 position ≤ 3 的行，同时是本站 CTR 基准（10%）
      g({ key: "top", impressions: 9999, clicks: 1000, ctr: 0.1, position: 2 }),
      ...Array.from({ length: 8 }, (_, i) =>
        g({
          key: `k${i}`,
          impressions: 1100 + i * 100,
          clicks: Math.round((1100 + i * 100) * 0.01),
          ctr: 0.01,
          position: 9,
        })
      ),
    ];
    const all = deriveCtrOpportunities(rows).items;
    expect(all.length).toBeGreaterThan(3);
    const limited = deriveCtrOpportunities(rows, 3).items;
    expect(limited).toHaveLength(3);
    expect(limited.map((i) => i.key)).toEqual(all.slice(0, 3).map((i) => i.key));
    // 自身也保持按「可多获得点击」降序
    const potential = limited.map((i) => i.potentialClicks);
    expect(potential).toEqual([...potential].sort((a, b) => b - a));
  });
});

describe("derivePositionOpportunities：Position 5–20", () => {
  it(`只保留 position ∈ [${POSITION_OPPORTUNITY_RANGE.min}, ${POSITION_OPPORTUNITY_RANGE.max}]，按曝光降序`, () => {
    const rows = [
      g({ key: "p3", impressions: 9999, position: 3 }), // 已在首页前列，不算机会
      g({ key: "p4", impressions: 9999, position: 4.9 }), // 4.9 < 5
      g({ key: "p5", impressions: 500, position: 5 }),
      g({ key: "p10", impressions: 900, position: 10.2 }),
      g({ key: "p20", impressions: 700, position: 20 }),
      g({ key: "p21", impressions: 9999, position: 20.1 }), // 20.1 > 20
      g({ key: "pnull", impressions: 9999, position: null }),
    ];
    expect(derivePositionOpportunities(rows).map((r) => r.key)).toEqual(["p10", "p20", "p5"]);
  });

  it("曝光相同则按点击降序；limit 生效", () => {
    const rows = [
      g({ key: "a", impressions: 100, clicks: 1, position: 7 }),
      g({ key: "b", impressions: 100, clicks: 9, position: 7 }),
      g({ key: "c", impressions: 50, clicks: 9, position: 7 }),
    ];
    expect(derivePositionOpportunities(rows).map((r) => r.key)).toEqual(["b", "a", "c"]);
    expect(derivePositionOpportunities(rows, 1).map((r) => r.key)).toEqual(["b"]);
  });
});

describe("deriveTopQueries：真正带来点击的搜索词", () => {
  it("过滤 0 点击，按点击降序（同点击按曝光降序）", () => {
    const rows = [
      g({ key: "no-clicks", impressions: 9999, clicks: 0 }),
      g({ key: "q1", impressions: 100, clicks: 5 }),
      g({ key: "q2", impressions: 400, clicks: 12 }),
      g({ key: "q3", impressions: 800, clicks: 5 }),
    ];
    expect(deriveTopQueries(rows).map((r) => r.key)).toEqual(["q2", "q3", "q1"]);
  });

  it("limit 生效；空输入返回空", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      g({ key: `q${i}`, impressions: 100, clicks: i + 1 })
    );
    expect(deriveTopQueries(rows)).toHaveLength(25);
    expect(deriveTopQueries(rows, 2).map((r) => r.key)).toEqual(["q29", "q28"]);
    expect(deriveTopQueries([])).toEqual([]);
  });
});
