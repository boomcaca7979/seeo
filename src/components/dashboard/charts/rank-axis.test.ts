// 排名轴量程单元测试：锚定第 1 名 + 覆盖全部真实名次 + 整数刻度且不超过 6 段。
// 这里守的是"不能为了好看而截断坐标轴"和"不能把前 20 名的数据压成一小条"两条底线。

import { describe, it, expect } from "vitest";
import { rankAxisScale, shortDateLabel, SPARSE_TREND_MAX } from "./rank-axis";

describe("rankAxisScale", () => {
  it("无数据时退回可用量程，不产生 NaN 轴", () => {
    const s = rankAxisScale([]);
    expect(s.domain[0]).toBe(1);
    expect(s.domain[1]).toBeGreaterThan(1);
    expect(s.ticks.every(Number.isInteger)).toBe(true);
  });

  it("全是 null（未进前 100）同样退回量程", () => {
    expect(rankAxisScale([null, undefined, NaN]).domain[0]).toBe(1);
  });

  it("锚点始终是第 1 名，不做 min-max 截断", () => {
    // 数据最好名次是 3，也不能把轴起点抬到 3（那会夸大波动幅度）
    expect(rankAxisScale([3, 5, 8]).domain[0]).toBe(1);
  });

  it("量程必须覆盖最差名次，极端值靠加大量程而不是裁掉", () => {
    const s = rankAxisScale([2, 3, 4, 97]);
    expect(s.domain[1]).toBeGreaterThanOrEqual(97);
    expect(s.domain[1]).toBeLessThanOrEqual(100);
  });

  it("常见前 20 名数据不会撑到 100，刻度落在整数网格上", () => {
    const s = rankAxisScale([3, 7, 12, 21]);
    expect(s.domain).toEqual([1, 25]);
    expect(s.ticks).toEqual([1, 5, 10, 15, 20, 25]);
  });

  it("全部记录都是第 1 名时量程不会退化成零高度", () => {
    const s = rankAxisScale([1, 1, 1]);
    expect(s.domain[0]).toBe(1);
    expect(s.domain[1]).toBeGreaterThan(1);
    expect(s.ticks[0]).toBe(1);
  });

  it("刻度自始至终包含 1 与轴尾，且严格递增无重复", () => {
    for (const values of [[1], [4], [1, 100], [6, 9, 44], Array.from({ length: 30 }, (_, i) => i + 1)]) {
      const { domain, ticks } = rankAxisScale(values);
      expect(ticks[0]).toBe(1);
      expect(ticks[ticks.length - 1]).toBe(domain[1]);
      expect(new Set(ticks).size).toBe(ticks.length);
      expect(ticks.every((t, i) => i === 0 || t > ticks[i - 1])).toBe(true);
      expect(ticks.length).toBeLessThanOrEqual(7);
      expect(Math.max(...values)).toBeLessThanOrEqual(domain[1]);
    }
  });
});

describe("shortDateLabel", () => {
  it("30 天窗口只显示月-日，年份等冗余信息留给 Tooltip", () => {
    expect(shortDateLabel("2026-10-15")).toBe("10-15");
  });

  it("已经很短的标签原样返回", () => {
    expect(shortDateLabel("10-15")).toBe("10-15");
  });
});

describe("SPARSE_TREND_MAX", () => {
  it("两点及以下判定为稀疏：两点连成的直线不是可信趋势", () => {
    expect(SPARSE_TREND_MAX).toBe(2);
  });
});
